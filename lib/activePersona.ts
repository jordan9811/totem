import "server-only";
import { cookies } from "next/headers";
import { SEED_VIEWER, personaById } from "./adapters/mock/store";
import { listPersonas, ownPersonaIds } from "./identity/keystore";
import { isEmptyWorld, isRealPersona } from "./world";

export const SEED_PERSONA_COOKIE = "layers_seed_persona";
/**
 * "View as" — render every surface as some other seeded persona.
 *
 * This exists because disclosure is only demonstrable from the other side:
 * the product's central claim is "a granted viewer sees a link and a
 * non-granted viewer does not", and you cannot show that, or TEST it at the
 * page level, without being able to occupy the other seat.
 *
 * It also closed a real blind spot: the Gate 1 suite drove the resolver
 * through /api/identity with an explicit viewer, while pages resolved through
 * this function — so page-level disclosure was never asserted at all.
 */
export const VIEW_AS_COOKIE = "layers_view_as";

/** The persona all seeded/mock surfaces act as. Distinct from the phase-1
 *  validator session (lib/session.ts) — seed personas live in seed data,
 *  not in the validator DB. */
export function activeSeedPersonaId(): string {
  const jar = cookies();

  // View-as wins, and may name ANY seeded persona (not just one of the
  // viewer's own) — that is the point of it.
  const viewAs = jar.get(VIEW_AS_COOKIE)?.value;
  if (viewAs && personaById.has(viewAs)) return viewAs;

  // POST-DEPLOY Gate 1 (D-POST-1-ONE-ROSTER-ONE-TRUTH): a persona this device MINTED is as much one of the
  // viewer's own as a seeded one. The check used to be the seeded snapshot alone, so switching to a forked or
  // cloned persona set the cookie, passed the route's own ownership check, and then silently acted as the seeded
  // default instead — every write landed on the wrong persona, which is worse than refusing.
  //
  // GATE 5 (attack-post-1 F-7): the first version of that fix widened the check to `personaById.has(...)`, and
  // that map holds EVERY SEEDED ACCOUNT, not just this device's. A crafted cookie naming a stranger's persona
  // would have been honoured — the silent cookie would have had view-as's reach without view-as's banner, and on
  // a WRITE path rather than a read one. The check is now an explicit allowlist: the seeded self, the personas
  // this device's keystore minted, and whatever /api/seed-persona has ACCEPTED after checking the session roster.
  // Anything else falls through to the default, as before.
  const fromCookie = jar.get(SEED_PERSONA_COOKIE)?.value;
  // LAYERS_WORLD=empty (review WORLD-ID-3): the acting persona is the session's active persona there, so it must be a
  // REAL one — the keystore also holds personas adopted from the seed (a `seeded:` nonce), which mayActAs accepts
  if (fromCookie && mayActAs(fromCookie, jar.get(ROOT_HANDLE_COOKIE)?.value ?? null) && (!isEmptyWorld() || isRealPersona(fromCookie))) return fromCookie;
  // ACTING AS YOURSELF (lib/device/actingRoot.ts): on the LIVE public site's device no persona named means NO persona acts
  // (the visitor chose "You", or has no persona yet). The answer is the visitor's own account (the public self), which
  // every persona write refuses, or nothing: never the first persona, which an empty jar used to fall back to.
  if (liveDeviceHere()) return publicSelfId() ?? "";
  return SEED_VIEWER.activePersonaId;
}

/** the live public site's browser device (the only place a tab may act as itself) */
function liveDeviceHere(): boolean {
  return typeof window !== "undefined" && isEmptyWorld();
}
/** this device's public self (the visitor's own Farcaster account), when it holds one */
function publicSelfId(): string | null {
  try {
    return listPersonas().find((p) => p.publicSelf === true)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The personas this process has established the device may act as, KEYED BY ROOT.
 *
 * GATE 5 (attack-post-1 F-7, residual): the first version kept one process-global set, so a
 * persona the legitimate holder of root R1 switched to could then be used from a DIFFERENT
 * browser that sent nothing but `layers_seed_persona=<that id>` — no root cookie, no session.
 * The id is discoverable (the profile page emits it), which made it an unauthenticated read
 * of that persona's relationship log. The acceptance is now recorded against the root handle
 * it was accepted under, and a request that does not present that handle does not inherit it.
 *
 * The seeded self is exempt, deliberately and unchanged: it is the no-login demo identity the
 * whole fixture is built on, and it belongs to no root in particular.
 */
export const ROOT_HANDLE_COOKIE = "layers_root";
const g = globalThis as unknown as { __layersActable?: Map<string, Set<string>> };
function actable(rootHandle: string | null): Set<string> {
  if (!g.__layersActable) g.__layersActable = new Map();
  const key = rootHandle ?? "\u0000no-root";
  let set = g.__layersActable.get(key);
  if (!set) {
    set = new Set<string>();
    g.__layersActable.set(key, set);
  }
  return set;
}

export function mayActAs(personaId: string, rootHandle: string | null): boolean {
  if (SEED_VIEWER.personas.includes(personaId)) return true;
  if (actable(rootHandle).has(personaId)) return true;
  try {
    // the keystore is this device's own; a persona it minted is the device's by definition.
    // Statically imported rather than require()d: this module is server-only and the
    // keystore does not import back, so there is no cycle, and a require() inside a bundled
    // server component is the kind of thing that works until the bundler changes.
    if (ownPersonaIds().includes(personaId)) {
      actable(rootHandle).add(personaId);
      return true;
    }
  } catch {
    /* no keystore in this process: the allowlist is the seeded set plus what was accepted */
  }
  return false;
}

/** Called by /api/seed-persona AFTER it has checked the persona against the session roster,
 *  with the root handle that session presented. */
export function allowActingAs(personaId: string, rootHandle: string | null): void {
  actable(rootHandle).add(personaId);
}

/** resetSeed: the allowlist is process state derived from a roster the reset wipes. */
export function resetActable(): void {
  g.__layersActable = undefined;
}

/** True when the session is impersonating someone else (banner + tests). */
export function isViewingAs(): boolean {
  const viewAs = cookies().get(VIEW_AS_COOKIE)?.value;
  return !!viewAs && personaById.has(viewAs) && !SEED_VIEWER.personas.includes(viewAs);
}
