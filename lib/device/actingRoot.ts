// ACTING AS YOURSELF (2026-11-05, the owner's rule: identity is ONE explicit dial; the root is the default identity; never
// both at once). On the live public site the visitor's own Farcaster account (the public self Sign in with Farcaster
// minted) is a switch target: "You" in the account menu. Choosing it makes NO persona the tab's acting identity:
//   * the device jar's persona cookie goes, so lib/fc/hubRead/separation.ts personaActing() is false: the root's
//     Following is read from the node, and the root may post, like, recast and reply (lib/fc/rootSigner/flow.ts);
//   * a marker stays in the jar, so boot (lib/device/boot.ts) never re-names a persona during this tab's life (the jar is
//     tab memory: a reload starts over on the first persona, the safe direction, and the account menu says so);
//   * lib/activePersona.ts activeSeedPersonaId() answers the public self (or nothing), never the first persona, so a
//     surface built from the acting persona shows what a visitor with no persona sees;
//   * EVERY persona write is refused here, in the device's request host (lib/device/host.ts), before the route runs:
//     409 NO_ACTING_PERSONA with one sentence. The ROOT's own writes go through (ROOT_WRITES below).
//
// THE SPLIT (2026-11-05 review: personas are OPTIONAL, and the root itself has all three dials). The test for every write
// route: does it publish, or act toward other people or a network, AS a persona, or write a persona-linked record the
// validator can see? Then it is a PERSONA action and is refused while no persona acts. Everything else is the root's own
// and works the same for a visitor with no persona (the default path) and for one acting as "You", keyed to the root or
// its public self exactly as before this guard existed:
//   who I am     the identity itself: post as you and its reads, sign-in, switching to or making a persona (and its post
//                mode), the first run, custody (devices, recovery), the crowd's account-level membership (/api/zk), the
//                chrome's own scope and colours;
//   anoncast     the root's anonymous post (/api/anon with postAs "root": the proof is the ROOT's crowd membership and
//                names no persona), leaving the crowd, the own-fid check, a reveal that names the root's own account, the
//                root's reach tiers, reporting an @anon post (names no reporter), a moderator's signed decision. A post
//                or a reveal that names a PERSONA is a persona action;
//   what I see   modes, rules, lenses, zones, readwise, delivery tiers, feed health (not a send: that acts toward someone
//                else), algorithm previews / imports / exports, filter-pack exports, unified search, subscribing to a
//                curator desk (a reading choice; drafting or signing a desk's annotation is publishing);
//   your data    the X archive import, its cold storage and Find your people, the data backpack's import (each sealed in
//                the root's own vault);
//   who sees me  rings ("works with zero personas": the root chooses who learns which voices are its).
// Refused (persona actions or publications): casting, reacting, following, act-as, blocking, Farcaster writes and persona
// accounts, crossposting, influence stakes, refutations, strikes, annotation votes, private posts and audiences, disclosure
// grants and forks, launches, the market, rooms, channels, folders, publishing an algorithm, the X outbox and X account
// links, signers, the graph's consent and connectors, persona bindings, sending a post to someone (feed-health/send) and
// attestation connections (bound to the acting identity on the validator).
// Choosing a persona again (POST /api/seed-persona, or making one) names it, and the root goes quiet: the reads and
// writes as the root re-check the jar when they leave (the separation guards), so one already queued stops.
// Everything here is the DEVICE's (a server never answers these routes on the live site); off the live site nothing
// here applies and every path is as it was.
import { deviceJar } from "@/lib/device/jar";
import { isPublicLive } from "@/lib/platform/publicLive";
import { NO_ACTING_PERSONA, NO_ACTING_PERSONA_SENTENCE } from "@/lib/identity/handleStem";

/** lib/activePersona.ts SEED_PERSONA_COOKIE, repeated so the request host never loads the store (pinned equal by
 *  scripts/unit-acting-root.mjs) */
export const SEED_PERSONA_COOKIE_NAME = "layers_seed_persona";
/** the tab chose to act as itself: boot leaves the persona cookie empty */
export const ROOT_ACTING_COOKIE = "layers_acting_root";

/** the live public site's browser device (the only place acting as yourself exists) */
export function liveDevice(): boolean {
  return typeof window !== "undefined" && isPublicLive();
}

/** no persona is this tab's acting identity: the live device with no persona named in its jar */
export function noPersonaActs(): boolean {
  return liveDevice() && !deviceJar.get(SEED_PERSONA_COOKIE_NAME);
}

type Body = Record<string, unknown> | null;
/** a route whose writes are the root's own (true), or the root's only for some bodies (the predicate says which) */
type RootRule = true | ((body: Body, ctx: { publicSelfId: string | null }) => boolean);

/** /api/anon: the root's own anonymous post (postAs "root", no persona named), leaving the crowd, the own-fid check, and a
 *  reveal that names the root's own account. A post naming a persona, or one with no postAs (the route would pick a
 *  default posting persona), and a reveal naming a persona are persona actions. */
const anonRootOnly = (b: Body, ctx: { publicSelfId: string | null }): boolean => {
  if (!b) return false;
  if (b.action === "leaveCrowd" || b.action === "ownFidCheck") return true;
  if (b.action === "reveal") return !!ctx.publicSelfId && b.personaId === ctx.publicSelfId;
  if (b.action !== undefined) return false;
  return b.postAs === "root" && b.personaId === undefined;
};
/** /api/curators: subscribing to a desk (badge / demote / auto-block) is a reading choice; drafting or signing a desk's
 *  annotation is publishing as a desk member */
const curatorsReadingOnly = (b: Body): boolean => !!b && b.action !== "draft" && b.action !== "sign";

/** THE ROOT'S OWN WRITES (the split in the header): every other write route is a persona action */
export const ROOT_WRITES: Readonly<Record<string, RootRule>> = Object.freeze({
  // who I am
  "/api/fc/root": true,
  "/api/fc/hub": true,
  "/api/fc/siwf": true,
  // SIGN IN WITH X: the root's own sign-in (no persona is ever involved: it binds the root's X account to the root)
  "/api/x/signin": true,
  "/api/seed-persona": true,
  "/api/personas/active": true,
  "/api/personas": true,
  "/api/personas/post-mode": true,
  "/api/onboarding": true,
  "/api/device": true,
  "/api/recovery": true,
  "/api/zk": true,
  "/api/persona/chrome": true,
  "/api/dev": true,
  // the anoncast foundation
  "/api/anon": anonRootOnly,
  "/api/reach": true,
  "/api/anon/report": true,
  "/api/anon/moderation": true,
  // what I see
  "/api/modes": true,
  "/api/modes/active": true,
  "/api/rules": true,
  "/api/rules/preview": true,
  "/api/lenses": true,
  "/api/zones": true,
  "/api/readwise": true,
  "/api/delivery": true,
  "/api/actions/delivery": true,
  "/api/feed-health": true,
  "/api/feed-health/permission": true,
  "/api/feed-health/saturation": true,
  "/api/feed-health/readwise": true,
  "/api/algo/preview": true,
  "/api/algo/import": true,
  "/api/algo/export": true,
  "/api/packs/export": true,
  "/api/search/unified": true,
  "/api/curators": curatorsReadingOnly,
  // ADS, PHASE 1: the page's ad plan (a read, in a POST so nothing rides a URL) and the root's own hidden ads
  "/api/ads": true,
  // your own data (sealed in the root's own vault)
  "/api/x/import": true,
  "/api/x/coldstore": true,
  "/api/x/match": true,
  "/api/graph/import": true,
  // who sees me
  "/api/rings": true,
});
/** the routes with at least one root write (kept for the docs and the tests) */
export const ROOT_WRITE_ROUTES: readonly string[] = Object.freeze(Object.keys(ROOT_WRITES));

function bodyOf(text: string | null): Body {
  if (!text) return {};
  try {
    const j = JSON.parse(text) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
async function publicSelfId(): Promise<string | null> {
  try {
    return (await import("@/lib/identity/keystore")).listPersonas().find((p) => p.publicSelf === true)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The request host's question: refuse this request before its route runs? (a persona write while no persona acts).
 * `bodyText` is the request's body as text, for the routes whose root writes depend on it; a body that is not JSON text
 * fails those routes closed.
 */
export async function noPersonaWriteRefusal(pattern: string, method: string, bodyText: string | null = null): Promise<{ status: number; body: { error: string; code: string } } | null> {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  if (!noPersonaActs()) return null;
  const rule = Object.prototype.hasOwnProperty.call(ROOT_WRITES, pattern) ? ROOT_WRITES[pattern] : undefined;
  if (rule === true) return null;
  if (typeof rule === "function" && rule(bodyOf(bodyText), { publicSelfId: await publicSelfId() })) return null;
  return { status: 409, body: { error: NO_ACTING_PERSONA_SENTENCE, code: NO_ACTING_PERSONA } };
}

/** the switch to yourself: no persona acts, and boot will not re-name one during this tab's life */
export function actAsRoot(): void {
  deviceJar.delete(SEED_PERSONA_COOKIE_NAME);
  deviceJar.set(ROOT_ACTING_COOKIE, "1");
}

/** a persona was named: the tab no longer acts as itself */
export function actAsPersona(personaId: string): void {
  deviceJar.set(SEED_PERSONA_COOKIE_NAME, personaId);
  deviceJar.delete(ROOT_ACTING_COOKIE);
}

/** is the tab acting as itself by its own choice (the marker), with no persona named */
export function rootChosen(): boolean {
  return deviceJar.get(ROOT_ACTING_COOKIE) === "1" && !deviceJar.get(SEED_PERSONA_COOKIE_NAME);
}

/**
 * Boot, live mode: the acting persona is the first one that can post, unless this boot already has one, or the tab chose
 * to act as itself (then the cookie stays empty). The jar is tab memory, so a fresh tab or a reload names the first
 * persona again.
 */
export function nameDefaultActingPersona(personas: ReadonlyArray<{ id: string; publicSelf?: boolean }>): void {
  const first = personas.find((p) => p.publicSelf !== true);
  if (!first) return;
  if (rootChosen()) return;
  const named = deviceJar.get(SEED_PERSONA_COOKIE_NAME);
  if (!named || !personas.some((p) => p.id === named && p.publicSelf !== true)) deviceJar.set(SEED_PERSONA_COOKIE_NAME, first.id);
}
