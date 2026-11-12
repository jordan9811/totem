import "server-only";
// MULTI-FID PASS Gate 0 — which fid-facts adapter the neynar.* issuers
// read. Fixture by default; live is opt-in (ATTEST_FID_SOURCE=live, or the
// rig's runtime override for a recorded live run) — sweeps never touch
// the network.
import { fixtureFidFacts } from "./fixture";
import { liveFidFacts } from "./live";
import type { FidFactsAdapter } from "./types";

export type FidSource = "fixture" | "live";
const g = globalThis as unknown as { __layersFidSourceOverride?: FidSource | null };

export function setFidSourceOverride(source: FidSource | null): void {
  g.__layersFidSourceOverride = source;
}

export function fidSource(): FidSource {
  const o = g.__layersFidSourceOverride;
  if (o) return o;
  return process.env.ATTEST_FID_SOURCE === "live" ? "live" : "fixture";
}

export function fidFacts(): FidFactsAdapter {
  return fidSource() === "live" ? liveFidFacts : fixtureFidFacts;
}
