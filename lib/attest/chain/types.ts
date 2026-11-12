// ATTESTATION PASS Gate 2 — the chain-facts seam. The onchain issuers read
// public chain facts about a WALLET through this adapter and nothing
// else; a fixture implementation replays recorded facts for seeded
// wallets (sweeps), a live one reads public RPC / indexers (live-att1
// only, read-only, no spend). What comes back is EXACT — a first-tx
// timestamp, a wei balance, a vote count — and exact is what the issuer
// must never let out: it buckets before it signs, and the exact values
// die with the request (SECURITY-POSTURE.md, Issuers).

export interface WalletFacts {
  /** ms since epoch of the wallet's first transaction on any tracked chain; null = none seen */
  firstTxAt: number | null;
  /** native ETH balance summed across tracked chains, in wei, as a decimal string */
  ethWei: string;
  /** protocols the wallet has interacted with (the tracked set: aave, morpho, compound, uniswap) */
  protocols: string[];
  /** governance votes cast (Snapshot, any space) */
  votes: number;
}

export interface ChainFactsAdapter {
  readonly kind: "fixture" | "live";
  /** the facts for one wallet address; throws on transport failure (never fails open) */
  facts(address: string): Promise<WalletFacts>;
  /** FIXTURE ONLY: synthetic facts for a cohort commitment (test furniture:
   * the decoy crowd needs buckets to clear the floor). Absent on live. */
  cohortFacts?(commitment: string, index?: number): WalletFacts;
}

/** the initial set is Aave, Morpho, Compound, Uniswap (Aerodrome is OUT — the user's decision);
 * ATTEST_PROTOCOLS (comma list of ids, [a-z0-9-]) extends or replaces it — the buckets ARE the set */
const DEFAULT_PROTOCOLS = ["aave", "morpho", "compound", "uniswap"];
function protocolsFromEnv(): string[] {
  const raw = process.env.ATTEST_PROTOCOLS;
  if (!raw) return DEFAULT_PROTOCOLS;
  const ids = raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[a-z0-9][a-z0-9-]{0,30}$/.test(x));
  return ids.length ? [...new Set(ids)] : DEFAULT_PROTOCOLS;
}
export const TRACKED_PROTOCOLS: readonly string[] = Object.freeze(protocolsFromEnv());
