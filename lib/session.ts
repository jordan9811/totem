// Active session resolution. No login wall for reads: with no cookies set,
// the seeded dev identity (fid 9152) is the viewer. Signer connect (stub)
// overrides via cookies.
//
// ZK PASS 2 Gate 2: the session's persona list is the DEVICE's knowledge
// (lib/identity/rootRoster.ts for signer-registered roots; the seed
// grouping for the fixture self) — never a validator roster, because the
// validator no longer holds persona → root (migration 006).
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { getSelf } from "./data";
import { personasByFid, personasForRoot } from "./validator";
import type { Persona } from "./types";
import { rootForHandle } from "./identity/sessionHandles";
import { isEmptyWorld, realPersonas } from "./world";

export const ROOT_COOKIE = "layers_root";
export const PERSONA_COOKIE = "layers_active_persona";

export interface Session {
  /** SERVER-INTERNAL ONLY. Never serialize this into a response or cookie
   *  payload — the root-leak test greps for it. */
  rootId: string | null;
  personas: Persona[];
  active: Persona | null;
}

export const getSession = cache(async (): Promise<Session> => {
  const jar = cookies();
  // The cookie holds an OPAQUE handle, never the root id itself.
  const handle = jar.get(ROOT_COOKIE)?.value ?? null;
  const rootId = handle ? await rootForHandle(handle) : null;
  const activeId = jar.get(PERSONA_COOKIE)?.value ?? null;

  // LAYERS_WORLD=empty (lib/world.ts): the roster is the device's REAL personas — the ones its keystore minted —
  // read from the keystore on every request, exactly as the browser device's session shim reads its own
  // (lib/device/shims/session.ts). Never the seeded self's fixture roster, never a validator persona. The active
  // persona IS the acting persona (review WORLD-ID-3): one identity, not the demo world's two tracks. The switcher's
  // cookie used to win here, so a switch made through /api/seed-persona (Settings > Account & Personas) moved the
  // pill and the kind check to A while the rail, the switcher's checkmark and the cast's author stayed on B — a post
  // published as a different persona than the pill named. The acting persona (activeSeedPersonaId) decides; the
  // switcher's cookie is only a fallback when no acting persona resolves; none at all is an honest null.
  if (isEmptyWorld()) {
    const { adoptRealPersonas } = await import("./adapters/mock/store");
    adoptRealPersonas();
    // review WORLD-ID-2 ("migrate on first load"): the service's own root is registered, and the personas the device
    // already holds are filed under it, in the background on the first request after the deploy — never blocking
    // or failing a session, which lists the keystore's personas whether or not the roster could be sealed
    const { ensureOwnRootSoon } = await import("./identity/rootRoster");
    ensureOwnRootSoon();
    const real: Persona[] = realPersonas().map((p) => ({
      id: p.id,
      name: p.name,
      handle: p.handle,
      avatarUrl: p.avatarUrl,
      bio: p.bio,
      createdAt: p.createdAt,
    }));
    const { activeSeedPersonaId } = await import("./activePersona");
    const acting = activeSeedPersonaId();
    const chosen = real.find((p) => p.id === acting) || (activeId && real.find((p) => p.id === activeId)) || real[0] || null;
    return { rootId, personas: real, active: chosen };
  }

  let personas: Persona[] = [];
  if (rootId) {
    personas = await personasForRoot(rootId); // the device roster, fleshed out by id
  } else {
    // Default dev identity: the seeded self root (the seed grouping, device-side).
    personas = await personasByFid(getSelf().fid);
  }
  const active =
    (activeId && personas.find((p) => p.id === activeId)) || personas[0] || null;
  return { rootId, personas, active };
});
