import "server-only";
// THE VERIFICATION GATE for grants — Gate 1's enforcement point.
//
// Before the crypto pass, verifyGrant existed with ZERO callers:
// presence in the grantsV3 map WAS validity. Every decision surface
// (resolver, private-post visibility, fork resolution, feed block
// fan-out, the identity adapter's own reads) now consumes THIS module
// instead of reading state().grantsV3 raw — an unverifiable grant is
// not a rejected grant, it is an ABSENT one, which is exactly how the
// disclosure model treats absence everywhere else.
//
// Fail-closed at every hop: no resolvable key for fromPersona → false;
// malformed signature → false; tampered field (the canonical moves) →
// false. The memo caches the (canonical, signature, KEY) verdict, which
// is pure math and never changes its answer — a re-signed revocation has
// a NEW canonical and misses the memo by construction.
//
// It deliberately does NOT cache the no-key-yet branch: "fromPersona has
// no resolvable key" is a fact about process state, not about the grant,
// and it CAN change — a persona minted or a fixture registered later
// makes a previously-keyless grant verifiable. Caching false there would
// pin a grant absent for the process lifetime after its persona appears.
// (Re-review finding.)
import { state } from "@/lib/adapters/mock/store";
import { grantCanonical, verifyGrantSig, type Grant } from "@/lib/identity/grants";
import { publicKeyForPersona } from "@/lib/identity/keys";

const memo = new Map<string, boolean>();

export function grantVerifies(g: Grant): boolean {
  const key = g.signature + "|" + grantCanonical(g);
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const pub = publicKeyForPersona(g.fromPersona);
  if (pub === null) return false; // NOT memoized — key availability is mutable
  const ok = verifyGrantSig(g, pub);
  memo.set(key, ok);
  return ok;
}

/** Every grant that verifies — the ONLY sanctioned way to read the
 * grant set for a decision. */
export function verifiedGrants(): Grant[] {
  return [...state().grantsV3.values()].filter(grantVerifies);
}
