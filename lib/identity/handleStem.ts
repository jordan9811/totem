// THE HANDLE STEM RULE — a public account name that is another one with a suffix, a prefix of it, or the other one
// minus its trailing digits publishes the link between them in the fname registry (and on every profile), and no
// onchain care undoes matching names. MULTI-FID Gate 5 (attack-fid-1 #5) applied it between a fork and its source;
// CONNECT MAIN review (PL-4) applies it between the owner's MAIN account and every persona, in both directions, at
// connect time and whenever a persona is created, forked or given an account afterwards. Pure: no imports.

const norm = (h: string) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const strip = (x: string) => x.replace(/\d+$/, "");

/** true when either handle is derived from the other (prefix either way, or the same stem minus trailing digits) */
export function handleDerivedFrom(newHandle: string, oldHandle: string): boolean {
  const n = norm(newHandle);
  const o = norm(oldHandle);
  if (!n || !o) return false;
  return n.startsWith(o) || o.startsWith(n) || (strip(n).length >= 3 && strip(n) === strip(o));
}

/** the main account's name in the forms a persona handle or fname could copy: "jordan.eth" → ["jordan.eth", "jordan"] */
export function mainNameStems(mainName: string | null | undefined): string[] {
  const s = String(mainName ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!s) return [];
  const out = new Set<string>([s]);
  const dot = s.indexOf(".");
  if (dot > 0) out.add(s.slice(0, dot));
  return [...out];
}

/** does `handle` (a persona handle or an fname) derive from the main account's name, or the main name from it? */
export function derivedFromMain(handle: string, mainName: string | null | undefined): boolean {
  return mainNameStems(mainName).some((stem) => handleDerivedFrom(handle, stem));
}

// PERSONA LAUNCH P1 (SIWF) — THE READ-ONLY PUBLIC SELF. The persona a Sign in with Farcaster minted (KeystorePersona
// .publicSelf) is the visitor's own Farcaster account: shown, never acted as, never forked from (a fork carries a
// continuity proof to its source, which would publicly link the new persona to that account). Every acting route asks
// publicSelfRefusalFor() with a thunk that reads the keystore record. It lives HERE, in this import-free module, so a
// route's refusal never drags the sign-in flow (lib/fc/siwf/*) into a bundle that only needed one keystore read
// (scripts/unit-fc-buttons.mjs bundles the action routes against a mocked keystore). lib/identity/mainName.ts re-exports it.
// POST AS YOU (2026-11-05): posting as the account IS built now, through its OWN door (app/api/fc/root/route.ts, a key in
// the visitor's vault), never through these persona routes: the public self still never acts as a persona, so the
// refusal stays and its sentence says where posting as the account lives instead.
// ACTING AS YOURSELF (2026-11-05): on the live site the visitor's own account IS a switch target ("You" in the account
// menu: no persona acts). The persona routes still never act as it; the sentence says where acting as yourself lives.
export const PUBLIC_SELF_READ_ONLY = "PUBLIC_SELF_READ_ONLY";
export const PUBLIC_SELF_READ_ONLY_SENTENCE =
  "Persona actions never act as your Farcaster account. To act as yourself, choose You in the account menu: then the Post box and the Like, Recast and Reply on Farcaster's posts act as your account, once you allow Totem to post as you. To do this as a persona, switch to one of your personas.";
/** ACTING AS YOURSELF: a persona write route asked while NO persona is the tab's acting identity (lib/device/actingRoot.ts
 *  refuses it before the route runs, so nothing is ever done as some default persona) */
export const NO_ACTING_PERSONA = "NO_ACTING_PERSONA";
export const NO_ACTING_PERSONA_SENTENCE =
  "You're acting as yourself, not as a persona, so persona actions are off. Switch to one of your personas in the account menu (or make one) to do this.";
export const PUBLIC_SELF_NO_FORK_SENTENCE =
  "Your Farcaster account can't be forked: a fork carries a proof back to where it came from, which would publicly link the new persona to your Farcaster account.";

/** the 403 body for acting as (or forking from) the read-only public self, or null for any other persona. `read`
 *  answers the keystore record; one that throws (no keystore in this process: a public server, where no public self
 *  can exist) is read as "not a public self" — the device that holds one always has its keystore. */
export function publicSelfRefusalFor(
  read: () => { publicSelf?: boolean } | null | undefined,
  sentence: string = PUBLIC_SELF_READ_ONLY_SENTENCE
): { error: string; code: string } | null {
  let p: { publicSelf?: boolean } | null | undefined = null;
  try {
    p = read();
  } catch {
    p = null;
  }
  return p && p.publicSelf === true ? { error: sentence, code: PUBLIC_SELF_READ_ONLY } : null;
}
