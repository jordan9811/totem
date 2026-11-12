import "server-only";
// ATTESTATION PASS Gate 3 — WHAT A PERSONA HAS PROVEN, for the surfaces.
//
// Modes, filter packs, channel gates and the advertiser's audience builder
// predicate on attestations. They evaluate against what a persona has
// PROVEN this epoch — the validator's presence log of accepted attestation
// proofs, read once per feed build through the gated map endpoint — and
// never against the validator's trees: a root that HOLDS an issuance but
// whose persona never proved it matches nothing. Same discipline as tier.
//
// The map is fetched by the feed build (lib/zk/gate.ts, under the zk
// binding) and cached here for the synchronous evaluators that run inside
// that build (the rules engine, packPasses, the audience matcher). Under
// any other rep binding the cache is EMPTY: an attestation predicate can
// only be satisfied by a proof. Un-honoured issuers are filtered out at
// the read, so a client's allowlist shapes every surface the same way.
import type { ZkMode } from "@/lib/zk/config";
import { fetchAttestedMap, fetchIssuers } from "@/lib/zk/validatorClient";
import { isHonoredIssuer } from "./subscriber";

interface ProvenCache {
  epoch: number | null;
  claims: Record<string, string[]>;
  at: number;
  error: string | null;
}
const g = globalThis as unknown as { __layersProvenAttestations?: ProvenCache };
const EMPTY: ProvenCache = { epoch: null, claims: {}, at: 0, error: null };

/** "issuer/bucket" strings this persona PROVED this epoch (+ grace), honoured issuers only */
export function provenAttestationsFor(personaId: string): string[] {
  return g.__layersProvenAttestations?.claims[personaId] ?? [];
}

export function provenAttestationsSnapshot(): ProvenCache {
  return g.__layersProvenAttestations ?? EMPTY;
}

/** one gated read per feed build; on failure the cache is EMPTY (fail closed), never stale */
export async function refreshProvenAttestations(mode: ZkMode): Promise<Record<string, string[]>> {
  try {
    const [r, reg] = await Promise.all([fetchAttestedMap(mode), fetchIssuers(mode)]);
    // honour by KEY (Gate 4): the registry as read on this build decides which ids are the issuers this client pinned
    const keyOf = new Map(reg.issuers.map((i) => [i.id, i.pubkey]));
    const claims: Record<string, string[]> = {};
    for (const [p, list] of Object.entries(r.claims)) {
      const kept = list.filter((k) => isHonoredIssuer(k.split("/")[0], keyOf.get(k.split("/")[0]) ?? null));
      if (kept.length) claims[p] = kept;
    }
    g.__layersProvenAttestations = { epoch: r.epoch, claims, at: Date.now(), error: null };
    return claims;
  } catch (e) {
    g.__layersProvenAttestations = { epoch: null, claims: {}, at: Date.now(), error: (e as Error).message };
    return {};
  }
}

/** the non-zk bindings: nothing is proven, so nothing matches */
export function clearProvenAttestations(): void {
  g.__layersProvenAttestations = { ...EMPTY, at: Date.now() };
}
