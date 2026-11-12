import "server-only";
// MULTI-FID PASS Gate 0 — which web-proof adapter the x.* issuers read.
// Fixture by default; live is opt-in (ATTEST_WEBPROOF_SOURCE=live, or the
// rig's runtime override) — the chain-facts discipline: live data is never
// the thing you get by accident, and sweeps never touch the network.
import { fixtureWebProof } from "./fixture";
import { liveWebProof } from "./live";
import type { WebProofAdapter } from "./types";

export type WebProofSource = "fixture" | "live";
const g = globalThis as unknown as { __layersWebProofSourceOverride?: WebProofSource | null };

export function setWebProofSourceOverride(source: WebProofSource | null): void {
  g.__layersWebProofSourceOverride = source;
}

export function webProofSource(): WebProofSource {
  const o = g.__layersWebProofSourceOverride;
  if (o) return o;
  return process.env.ATTEST_WEBPROOF_SOURCE === "live" ? "live" : "fixture";
}

export function webProof(): WebProofAdapter {
  return webProofSource() === "live" ? liveWebProof : fixtureWebProof;
}
