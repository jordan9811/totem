// ATTESTATION PASS Gate 1 — issuer / bucket / tree grammar. Pure; imported
// by the client, the issuers and the suites. DELIBERATE DUPLICATE of
// validator/zk.js (validIssuer / validBucket / attestTreeName /
// parseAttestTree): a drift fails the acceptance suite loudly.
//
// An issuer id is namespaced lowercase — "onchain.wallet-age",
// "test.mock-issuer" — at most 48 chars. A bucket is the COARSE public
// attribute an issuance lands in — "gt2y", "morpho", "any" — at most 32.
// The attestation tree for (issuer, bucket) is "attest:<issuer>/<bucket>",
// and the gate id of an attestation claim IS that tree name.

export const ISSUER_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
export const BUCKET_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export function validIssuer(x: unknown): x is string {
  return typeof x === "string" && x.length <= 48 && ISSUER_RE.test(x);
}

export function validBucket(x: unknown): x is string {
  return typeof x === "string" && x.length <= 32 && BUCKET_RE.test(x);
}

export function attestTreeName(issuer: string, bucket: string): string {
  return `attest:${issuer}/${bucket}`;
}

export function parseAttestTree(t: unknown): { issuer: string; bucket: string } | null {
  if (typeof t !== "string" || !t.startsWith("attest:")) return null;
  const parts = t.slice(7).split("/");
  if (parts.length !== 2 || !validIssuer(parts[0]) || !validBucket(parts[1])) return null;
  return { issuer: parts[0], bucket: parts[1] };
}

/** the scope qualifier of an attestation claim: "<issuer>/<bucket>" */
export function attestQualifier(issuer: string, bucket: string): string {
  return `${issuer}/${bucket}`;
}

/** an honour pattern: "<id>", "<ns>.*", or either PINNED to a key — "<id>@<pubkey>" / "<ns>.*@<pubkey>".
 * Gate 4 (attack-att-1 #3, attack-att-3 #1): the registry is open and first-come, so an id
 * proves nothing; a pinned pattern matches only when the issuer's REGISTERED key is the pin. */
export function parseHonourPattern(pattern: string): { id: string; pubkey: string | null } {
  const at = pattern.indexOf("@");
  if (at < 0) return { id: pattern, pubkey: null };
  const pubkey = pattern.slice(at + 1).toLowerCase();
  return { id: pattern.slice(0, at), pubkey: /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : "invalid" };
}

/** "does issuer X (registered under `pubkey`) match this honour pattern?" A pinned pattern with
 * no key to compare — the caller could not read the registry — does NOT match (fail closed). */
export function issuerMatches(pattern: string, issuerId: string, pubkey?: string | null): boolean {
  const p = parseHonourPattern(pattern);
  if (p.pubkey !== null) {
    if (p.pubkey === "invalid" || !pubkey || pubkey.toLowerCase() !== p.pubkey) return false;
  }
  if (p.id === "*") return true;
  if (p.id.endsWith(".*")) return issuerId.startsWith(p.id.slice(0, -1));
  return p.id === issuerId;
}
