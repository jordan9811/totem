import "server-only";
// ATTESTATION PASS Gate 2 — the LIVE chain-facts adapter. Public, keyless,
// READ-ONLY sources; no wallet is ever asked to sign a transaction and
// nothing here can spend:
//   - native balance: JSON-RPC eth_getBalance on public endpoints (viem)
//   - first transaction + protocol history: Blockscout's Etherscan-style
//     module API (`?module=account&action=txlist`, ascending, first page)
//     on each tracked chain — no API key
//   - governance: Snapshot's public GraphQL hub, votes by voter
// Used by live-att1 only; sweeps run the fixture adapter. Every source
// failure throws (the issuer then REFUSES — never an attestation from a
// half-read wallet).
//
// THE TRACKED CONTRACT SET is the initial one the prompt names (Aave,
// Morpho, Compound, Uniswap — Aerodrome dropped by the user mid-pass);
// addresses per chain are listed here as A-ATT-CONTRACT-SET in the
// posture doc: a wrong or missing address under-reports a protocol (a
// refusal to vouch), never over-reports.
import { createPublicClient, http, type Chain } from "viem";
import { base, mainnet, optimism } from "viem/chains";
import { TRACKED_PROTOCOLS, type ChainFactsAdapter, type WalletFacts } from "./types";

interface TrackedChain {
  id: string;
  chain: Chain;
  /** keyless public RPCs, tried in order — one flaky endpoint must not refuse an issuance on its own */
  rpcs: string[];
  blockscout: string;
  contracts: Record<string, string[]>;
}

const withEnv = (env: string | undefined, defaults: string[]) => (env ? [env, ...defaults] : defaults);

const CHAINS: TrackedChain[] = [
  {
    id: "ethereum",
    chain: mainnet,
    rpcs: withEnv(process.env.ATTEST_RPC_ETHEREUM, ["https://eth.drpc.org", "https://rpc.ankr.com/eth", "https://1rpc.io/eth", "https://cloudflare-eth.com", "https://eth-mainnet.public.blastapi.io"]),
    blockscout: "https://eth.blockscout.com/api",
    contracts: {
      aave: ["0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2"],
      morpho: ["0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb"],
      compound: ["0xc3d688b66703497daa19211eedff47f25384cdc3", "0xa17581a9e3356d9a858b789d68b4d866e593ae94"],
      uniswap: ["0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", "0xe592427a0aece92de3edee1f18e0157c05861564", "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"],
    },
  },
  {
    id: "base",
    chain: base,
    rpcs: withEnv(process.env.ATTEST_RPC_BASE, ["https://mainnet.base.org", "https://base.drpc.org", "https://1rpc.io/base"]),
    blockscout: "https://base.blockscout.com/api",
    contracts: {
      aave: ["0xa238dd80c259a72e81d7e4664a9801593f98d1c5"],
      morpho: ["0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb"],
      compound: ["0xb125e6687d4313864e53df431d5425969c15eb2f", "0x46e6b214b524310239732d51387075e0e70970bf"],
      uniswap: ["0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", "0x2626664c2603336e57b271c5c0b26f421741e481"],
    },
  },
  {
    id: "optimism",
    chain: optimism,
    rpcs: withEnv(process.env.ATTEST_RPC_OPTIMISM, ["https://mainnet.optimism.io", "https://optimism.drpc.org", "https://1rpc.io/op"]),
    blockscout: "https://optimism.blockscout.com/api",
    contracts: {
      aave: ["0x794a61358d6845594f94dc1db02a252b5b4814ad"],
      morpho: [],
      compound: ["0x2e44e174f7d53f0212823acc11c01a11d58c5bcb"],
      uniswap: ["0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", "0xe592427a0aece92de3edee1f18e0157c05861564"],
    },
  },
];

function trackedChains(): TrackedChain[] {
  const want = (process.env.ATTEST_CHAINS || "ethereum,base,optimism").split(",").map((x) => x.trim());
  return CHAINS.filter((c) => want.includes(c.id));
}

async function getJson(url: string, init?: RequestInit, timeoutMs = 20000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

interface TxRow {
  to?: string;
  timeStamp?: string;
  isError?: string;
}

/** ascending txlist, first page (up to 1000): first tx + the protocols touched early */
async function txlist(c: TrackedChain, address: string): Promise<TxRow[]> {
  const url = `${c.blockscout}?module=account&action=txlist&address=${address}&sort=asc&page=1&offset=1000`;
  const j = (await getJson(url)) as { status?: string; message?: string; result?: TxRow[] | string };
  if (Array.isArray(j.result)) return j.result;
  if (j.message && /No transactions found/i.test(j.message)) return [];
  throw new Error(`blockscout ${c.id}: ${typeof j.result === "string" ? j.result : j.message || "malformed response"}`);
}

async function snapshotVotes(address: string): Promise<number> {
  const query = `query Votes($voter: String!) { votes(first: 1000, where: { voter: $voter }) { id } }`;
  const j = (await getJson("https://hub.snapshot.org/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { voter: address } }),
  })) as { data?: { votes?: unknown[] }; errors?: unknown[] };
  if (!j.data || !Array.isArray(j.data.votes)) throw new Error("snapshot: malformed response");
  return j.data.votes.length;
}

/** eth_getBalance over the chain's RPC list, first success wins; the error
 * carries the SOURCES only — a transport library's message quotes the
 * request body, and the request body is the wallet address */
async function balanceWithFallback(c: TrackedChain, addr: string): Promise<bigint> {
  const failures: string[] = [];
  for (const rpc of c.rpcs) {
    const client = createPublicClient({ chain: c.chain, transport: http(rpc, { timeout: 15000, retryCount: 0 }) });
    try {
      return await client.getBalance({ address: addr as `0x${string}` });
    } catch (e) {
      failures.push(`${new URL(rpc).host}: ${((e as Error).message || "").split("\n")[0].replace(/0x[0-9a-fA-F]{40}/g, "0x<redacted>").slice(0, 60)}`);
    }
  }
  throw new Error(`rpc ${c.id}: every endpoint failed (${failures.join("; ")})`);
}

export const liveChainFacts: ChainFactsAdapter = {
  kind: "live",
  async facts(address: string): Promise<WalletFacts> {
    const addr = address.toLowerCase();
    let firstTxAt: number | null = null;
    let wei = BigInt(0);
    const protocols = new Set<string>();
    for (const c of trackedChains()) {
      wei += await balanceWithFallback(c, addr);
      const txs = await txlist(c, addr);
      for (const tx of txs) {
        const at = Number(tx.timeStamp) * 1000;
        if (Number.isFinite(at) && at > 0 && (firstTxAt === null || at < firstTxAt)) firstTxAt = at;
        const to = (tx.to || "").toLowerCase();
        if (!to) continue;
        for (const p of TRACKED_PROTOCOLS) if ((c.contracts[p] || []).includes(to)) protocols.add(p);
      }
    }
    const votes = await snapshotVotes(addr);
    return { firstTxAt, ethWei: wei.toString(10), protocols: [...protocols], votes };
  },
};
