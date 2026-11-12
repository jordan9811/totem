import "server-only";
// ATTESTATION PASS Gate 1 — THE SUBSCRIBER'S CHOICE. Registration on the
// validator is open; TRUST is decided here, per client. The reference
// client honours the `onchain.*` family by default and nothing else
// (ATTEST_HONORED_ISSUERS overrides: a comma list of ids or "<ns>.*"
// patterns). An un-honoured issuer's attestation proves nothing on this
// client: the gate refuses to even schedule a proof for it, and the
// "attested" reads answer false however the validator's presence log
// looks. The test rig may override the list (a dev action) so the mock
// issuer can be honoured in fixtures — and only there.
import { issuerMatches, validIssuer } from "./ids";
import { issuerKeyFor } from "./issuerKey";

// THE DEFAULT PIN (Gate 4, attack-att-1 #3 / attack-att-3 #1): the reference client
// honours the onchain family ONLY under the key its own onchain issuer module holds —
// in this repository the issuer is co-hosted and the key is minted here; a product
// client ships the issuer's public key. An id alone is honoured by nobody by default:
// the registry is open and first-come, so "onchain.holdings" registered by a stranger
// (or by the operator before the reference issuer) is a different issuer.
function defaultPatterns(): string[] {
  try {
    // MULTI-FID Gate 0: the x.* and neynar.* families are co-hosted the same way and pinned by their own keys
    // PERSONA LAUNCH P5: and the two reach issuers, each pinned by EXACT id to the reach family's key — "x.*" under the x
    // key does not reach x.reach (another key), and no other id under the reach key is honoured
    const reach = issuerKeyFor("reach").pubHex;
    return ["onchain.*@" + issuerKeyFor("onchain").pubHex, "x.*@" + issuerKeyFor("x").pubHex, "neynar.*@" + issuerKeyFor("neynar").pubHex, "fc.reach@" + reach, "x.reach@" + reach];
  } catch {
    return [];
  }
}
const g = globalThis as unknown as { __layersHonoredIssuersOverride?: string[] | null };

function parse(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const list = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return list;
}

export function honoredIssuerPatterns(): string[] {
  if (g.__layersHonoredIssuersOverride !== undefined && g.__layersHonoredIssuersOverride !== null) return [...g.__layersHonoredIssuersOverride];
  return parse(process.env.ATTEST_HONORED_ISSUERS) ?? defaultPatterns();
}

/** `pubkey` is the issuer's REGISTERED key as the caller read it (registry snapshot,
 * the proven-map refresh, the vault record); a pinned pattern never matches without it */
export function isHonoredIssuer(issuerId: string, pubkey?: string | null): boolean {
  if (!validIssuer(issuerId)) return false;
  return honoredIssuerPatterns().some((p) => issuerMatches(p, issuerId, pubkey ?? null));
}

/** TEST RIG ONLY (app/api/zk setHonoredIssuers, behind ZK_DEV_HOOKS): null restores the env/default list */
export function setHonoredIssuersOverride(list: string[] | null): void {
  g.__layersHonoredIssuersOverride = list;
}
