import "server-only";
// ATTESTATION PASS Gate 1 — the issuer REGISTRY as the client sees it: the
// built-in issuer modules this process can run, and the validator's open
// registry of ids / schemas / buckets / keys. Registration is lazy and
// idempotent: an issuer registers itself (self-signed) before its first
// issuance in a universe, and again harmlessly after a fixture reset.
import type { ZkMode } from "@/lib/zk/config";
import { fetchIssuers, registerIssuerOnValidator } from "@/lib/zk/validatorClient";
import { issuerCanonical, schemaHash } from "./canonical";

import { MOCK_ISSUER_ID, MOCK_ISSUER_LONG_ID, mockIssuer, mockIssuerLong } from "./issuers/mock";
import { onchainIssuers } from "./issuers/onchain";
import { neynarScoreIssuer } from "./issuers/neynar";
import { xIssuers } from "./issuers/x";
import { fcReachIssuer } from "./issuers/fcReach";
import { xReachIssuer } from "./issuers/xReach";
import type { AttestationIssuer, RegisteredIssuer } from "./types";

/** the issuer modules built into this process, by id */
export function builtinIssuers(): Map<string, AttestationIssuer> {
  const m = new Map<string, AttestationIssuer>();
  m.set(MOCK_ISSUER_ID, mockIssuer);
  m.set(MOCK_ISSUER_LONG_ID, mockIssuerLong);
  // Gate 2: the onchain-facts reference issuer family (one shared key)
  for (const issuer of Object.values(onchainIssuers)) m.set(issuer.id, issuer);
  // MULTI-FID Gate 0: the X-account family (one key "x") and the Neynar score issuer (key "neynar")
  for (const issuer of Object.values(xIssuers)) m.set(issuer.id, issuer);
  m.set(neynarScoreIssuer.id, neynarScoreIssuer);
  // PERSONA LAUNCH P5 (D1): the reach-tier issuers (one family key "reach") — fc.reach (Farcaster followers of the root's
  // own main account) and x.reach (fixture only this wave). Their bucket trees are the boostable anon trees.
  m.set(fcReachIssuer.id, fcReachIssuer);
  m.set(xReachIssuer.id, xReachIssuer);
  return m;
}

export function builtinIssuer(id: string): AttestationIssuer | null {
  return builtinIssuers().get(id) ?? null;
}

/**
 * PERSONA LAUNCH (wave 2 close): the reach issuers sign the tiers For You boosts by, so they must run on a host the
 * people who read the boost can trust. Inside the public site's browser device the issuer key would be the visitor's
 * own: the first visitor to register "fc.reach" on the public validator would hold the id (an open registry is
 * first-come, A-ATT-OPEN-REGISTRY-COST) and could issue themselves any tier. So in the browser device they refuse to
 * register or issue, in plain words, until an issuer Totem runs exists (a later step). The owner service and the rig
 * host the issuer server-side, as before.
 */
export const HOST_ONLY_ISSUERS = new Set(["fc.reach", "x.reach"]);
export function issuerUnavailableHere(issuerId: string): string | null {
  if (typeof window !== "undefined" && HOST_ONLY_ISSUERS.has(issuerId)) return "Reach tiers aren't available on the public site yet: they need an issuer Totem runs, not one in your browser.";
  return null;
}

/** register (or re-assert) an issuer on the validator, self-signed under its key */
export async function ensureRegistered(issuer: AttestationIssuer, mode: ZkMode): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const unavailable = issuerUnavailableHere(issuer.id);
  if (unavailable) return { status: 403, json: { error: unavailable, code: "issuer_not_here" } };
  const body = {
    mode,
    id: issuer.id,
    displayName: issuer.displayName,
    claimSchema: issuer.claimSchema,
    buckets: [...issuer.buckets],
    validityEpochs: issuer.validity.epochs,
    pubkey: issuer.publicKey,
  };
  // self-signed under the issuer's OWN key (a family may share one; the issuer knows which)
  const sig = issuer.sign(issuerCanonical({ mode, id: issuer.id, displayName: issuer.displayName, schemaHash: schemaHash(issuer.claimSchema), buckets: issuer.buckets, validityEpochs: issuer.validity.epochs, pubkey: issuer.publicKey }));
  return registerIssuerOnValidator({ ...body, sig });
}

export async function listRegisteredIssuers(mode: ZkMode): Promise<{ epoch: number; issuers: RegisteredIssuer[] }> {
  return fetchIssuers(mode);
}
