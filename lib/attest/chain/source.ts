import "server-only";
// ATTESTATION PASS Gate 2 — which chain-facts adapter the onchain issuers
// read. Fixture by default; live is opt-in (ATTEST_CHAIN_SOURCE=live, or
// the test rig's runtime override for the live-att1 run) — the same
// discipline as the content data source: live data is never the thing
// you get by accident, and sweeps never touch the network.
import { fixtureChainFacts } from "./fixture";
import { liveChainFacts } from "./live";
import type { ChainFactsAdapter } from "./types";

export type ChainSource = "fixture" | "live";
const g = globalThis as unknown as { __layersChainSourceOverride?: ChainSource | null };

export function setChainSourceOverride(source: ChainSource | null): void {
  g.__layersChainSourceOverride = source;
}

export function chainSource(): ChainSource {
  const o = g.__layersChainSourceOverride;
  if (o) return o;
  return process.env.ATTEST_CHAIN_SOURCE === "live" ? "live" : "fixture";
}

export function chainFacts(): ChainFactsAdapter {
  return chainSource() === "live" ? liveChainFacts : fixtureChainFacts;
}
