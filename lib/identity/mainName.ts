import "server-only";
// PERSONA LAUNCH P1 (SIWF) Gate 1e: THE MAIN ACCOUNT'S RULES, in one place, wherever the main account is recorded.
//
// Two representations of "your own Farcaster account" exist now (spec RISKS: the write-relay pass must unify them
// behind one accessor before any write path reads the public one):
//   - the OWNER SERVICE's connected main: lib/fc/personaFid.ts records with origin "connected" (QR connect with a
//     posting signer, lib/fc/connect.ts) — server only, the browser device never holds one;
//   - the PUBLIC SITE's signed-in main: the sealed accountLinks record (lib/fc/siwf/links.ts), written by Sign in
//     with Farcaster in the device (and by the rig's fixture on the rig's server).
//
// Two rules key on it:
//   1. THE STEM RULE (CONNECT MAIN review PL-4), both directions: no persona handle (or the fname it would register)
//      may share a name stem with the main account's name: matching names publicly link a persona to the main account,
//      and no onchain care undoes that. mainNameDerivation() answers the refusal sentence, or null. It THROWS when a
//      record it must consult cannot be read (the caller refuses; never a guess). The personas and fork routes call
//      it on the device too now (they used to skip it there because "the browser device never holds a main account").
//   2. READ-ONLY PUBLIC SELF: the persona a sign-in minted (KeystorePersona.publicSelf) is never an acting target: no
//      switch to it, no cast, reaction, follow or act-as as it, no fork from it (a fork carries a continuity proof to
//      its source, which would publicly link the new persona to the main account). publicSelfRefusal() is the one
//      check every such route makes.
import {
  PUBLIC_SELF_NO_FORK_SENTENCE,
  PUBLIC_SELF_READ_ONLY,
  PUBLIC_SELF_READ_ONLY_SENTENCE,
  derivedFromMain,
  publicSelfRefusalFor,
} from "@/lib/identity/handleStem";
import { getPersona } from "@/lib/identity/keystore";

// the refusal itself is in the import-free lib/identity/handleStem.ts (the action routes import it from there)
export { PUBLIC_SELF_NO_FORK_SENTENCE, PUBLIC_SELF_READ_ONLY, PUBLIC_SELF_READ_ONLY_SENTENCE, publicSelfRefusalFor };

/** is this one of this device's personas minted by Sign in with Farcaster (the read-only public self)? No keystore in
 *  this process (a public server) means no public self can exist here, so the answer is no. */
export function isPublicSelfPersona(personaId: string | null | undefined): boolean {
  return publicSelfRefusalFor(() => (personaId ? getPersona(personaId) : null)) !== null;
}

/** the 403 body every acting route answers for the public self, or null for any other persona */
export function publicSelfRefusal(personaId: string | null | undefined, sentence: string = PUBLIC_SELF_READ_ONLY_SENTENCE): { error: string; code: string } | null {
  return publicSelfRefusalFor(() => (personaId ? getPersona(personaId) : null), sentence);
}

/** does the signed-in main (accountLinks) apply in this process? The device always; a server only where the rig's
 *  fixture sign-in can run (the owner service has no SIWF, a public server has no keystore). */
async function signedInMainApplies(): Promise<boolean> {
  if (typeof window !== "undefined") return true;
  const { siwfGate } = await import("@/lib/fc/siwf/flow");
  return siwfGate().ok;
}

/**
 * The refusal for `handle` (a persona handle, or an fname it would register) that derives from the main account's
 * name, or null. Main stays main after a disconnect (a tombstoned link still names it). THROWS on an unreadable record.
 */
export async function mainNameDerivation(handle: string): Promise<string | null> {
  if (typeof window === "undefined") {
    const { mainNameDerivation: connected } = await import("@/lib/fc/personaFid");
    const why = await connected(handle); // THROWS on an unreadable vault
    if (why) return why;
  }
  if (await signedInMainApplies()) {
    const links = await import("@/lib/fc/siwf/links");
    const link = await links.mainLink(); // THROWS on an unreadable namespace
    if (link && link.fname && derivedFromMain(handle, link.fname))
      return `@${handle} shares a name with your Farcaster account (@${link.fname}). Matching names would publicly link a persona to your Farcaster account. Pick a handle that shares no part of it.`;
    // SIGN IN WITH X: the same rule for the root's X account (a persona named like your X handle is linked to it by its
    // name). The same cached document as the read above; THROWS on an unreadable namespace too.
    const x = await links.xLink();
    if (x && derivedFromMain(handle, x.username))
      return `@${handle} shares a name with your X account (@${x.username}). Matching names would publicly link a persona to your X account. Pick a handle that shares no part of it.`;
  }
  return null;
}
