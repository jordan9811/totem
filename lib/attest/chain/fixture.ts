import "server-only";
// ATTESTATION PASS Gate 2 — the FIXTURE chain-facts adapter: recorded facts
// for seeded wallets (seed/data/chain-facts.json) whose keys are
// keccak256(seed) — the acceptance suite derives the same keys to sign the
// issuer's challenge. Plus synthetic COHORT facts for decoy commitments,
// deterministic per commitment, spread so that most buckets clear the
// anonymity floor and two ("compound", "gt4y") are deliberately THIN —
// the sub-floor refusal has to have something to refuse.
import { createHash } from "@/lib/platform/crypto";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import recorded from "@/seed/data/chain-facts.json";
import type { ChainFactsAdapter, WalletFacts } from "./types";

interface Recorded {
  wallets: { seed: string; facts: WalletFacts }[];
}

let byAddress: Map<string, WalletFacts> | null = null;
function table(): Map<string, WalletFacts> {
  if (byAddress) return byAddress;
  byAddress = new Map();
  for (const w of (recorded as Recorded).wallets) {
    const account = privateKeyToAccount(keccak256(toBytes(w.seed)));
    byAddress.set(account.address.toLowerCase(), w.facts);
  }
  return byAddress;
}

/** deterministic per-commitment index for the cohort spread */
function cohortIndex(commitment: string): number {
  return createHash("sha256").update("layers-chain-cohort/1|" + commitment).digest()[0];
}

const YEAR = 365.25 * 24 * 3600 * 1000;

export const fixtureChainFacts: ChainFactsAdapter = {
  kind: "fixture",
  async facts(address: string): Promise<WalletFacts> {
    const f = table().get(address.toLowerCase());
    if (!f) throw new Error("fixture chain facts: unknown wallet (not a seeded fixture wallet)");
    return { ...f, protocols: [...f.protocols] };
  },
  cohortFacts(commitment: string, index?: number): WalletFacts {
    // BY INDEX when the cohort loop gives one (deterministic populations —
    // with N decoys: gt1y/gt2y 7N/8, eth-gte-1 4N/5, aave/morpho/votes-gte-1
    // 2N/3, uniswap 3N/4; thin: gt4y N/8, eth-gte-10 N/16, compound N/10,
    // votes-gte-20 N/7 — and the pairwise intersections the linkage test
    // holds to the floor: morpho∩gt2y ≈ 7N/12, eth-gte-1∩votes-gte-1 ≈ 8N/15),
    // by hash otherwise
    const i = index ?? cohortIndex(commitment);
    const now = Date.now();
    const firstTxAt = i % 8 === 0 ? now - 0.5 * YEAR : i % 8 === 7 ? now - 5 * YEAR : now - 3 * YEAR;
    const ethWei = i % 5 === 0 ? "10000000000000000" : i % 16 === 1 ? "25000000000000000000" : "3000000000000000000";
    const protocols: string[] = [];
    if (i % 3 !== 1) protocols.push("aave");
    if (i % 3 !== 0) protocols.push("morpho");
    if (i % 10 === 0) protocols.push("compound");
    if (i % 4 !== 3) protocols.push("uniswap");
    const votes = i % 3 === 0 ? 0 : i % 7 === 0 ? 25 : i % 2 === 0 ? 6 : 2;
    return { firstTxAt, ethWei, protocols, votes };
  },
};
