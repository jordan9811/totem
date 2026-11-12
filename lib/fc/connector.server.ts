import "server-only";
// CONNECTOR SETUP (no key handling) — the owner service CREATES the connector account C that lib/fc/connect.ts
// signs key requests with, so the owner can turn on "connect my main account by QR" without ever seeing, typing or
// storing a private key (the owner UX rule: no seed phrases, ever; one-command scripts; plain words).
//
// WHY A CONNECTOR AT ALL: every signer approved by QR carries, onchain and forever, the fid of the app that asked for
// it (SignedKeyRequestMetadata.requestFid). Sign In with Neynar (the shared requestFid 6131) retired on 2026-08-14,
// so main needs a small account of its own to be that app — one that nothing else ever uses, so the public learns
// only "main uses a private app", never which other accounts the owner has (research, postconnect 2026-10-07).
//
// WHAT THIS FILE DOES, in the owner's order (scripts/owner/arm-connector.ps1 drives it):
//   create    a random secp256k1 CUSTODY key and a separate fresh RECOVERY key, sealed in the vault under the
//             namespace "fcConnector" exactly as lib/fc/personaFid.ts seals its records (one padded record, the
//             validator sees ciphertext). Only the custody ADDRESS leaves this file. Idempotent: a second create
//             returns the record that exists and generates nothing.
//   fund      the OWNER sends about 0.0005 ETH on Optimism to that address from an exchange withdrawal — never from
//             the Neynar App Wallet, main's wallet or a persona (the funder is a public link to whoever funded it).
//             Status reads the balance and IdGateway.price() over a read-only RPC (FC_CONNECT_RPC_URL, default
//             https://mainnet.optimism.io) and says "funded" only once balance >= price + a gas margin.
//   register  typed REGISTER: IdGateway.register(recovery) from the custody key (viem signs the EIP-1559 transaction
//             here; eth_sendRawTransaction carries it), the receipt is waited for, IdRegistry.idOf(custody) is read
//             back and the fid is sealed. The transaction hash is sealed BEFORE it is sent, so a crash between the
//             send and the receipt resumes by reading the receipt, never by sending twice. Refused when the balance
//             is short, when the chain is not Optimism, or when the address is one Totem already uses (the App
//             Wallet in FC_LAYERS_ADDRESSES, a persona's custody, main's custody) — best effort: a FUNDING source
//             cannot be read from a plain RPC, so that rule is the owner's, stated in words.
//   fname     optional, free: a neutral name through the offchain fname registry (fnames.farcaster.xyz), a
//             UserNameProof signed by the custody key. A name that says "layers", shares a stem with main's name, or
//             is a persona's own name is refused. The registry transfer alone does not put the name on the profile
//             (that needs a signer and a UserData message — not built), and the status says so.
//
// WHERE IT RUNS: the owner service only — lib/fc/connect.ts connectGate() must answer "live" (owner secret, dev hooks,
// writes armed, Neynar key, the shared test account). Refused on a public deployment, inside the browser device, and
// on the laptop rig (its connector is the fixture constant). The route adds the owner-session check on top.
//
// WHAT CONNECT.TS GETS: sealedConnectorForConnect() — the fid, the address and a SignedKeyRequest signer whose key
// never leaves this module's closure. The environment names (FC_CONNECT_APP_FID + the key, read by name) stay as an
// alternative and WIN when set: then create refuses, so two connectors can never silently disagree.
//
// COSTS (read live, never asserted): IdGateway.price() was 77,733,916,415,441 wei (about 0.0000777 ETH) on
// 2026-10-07, plus Optimism gas of a few cents; the exchange withdrawal dominates, about $1-5 in practice.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionResult, encodeFunctionData, formatEther } from "viem";
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { fetchState, flushVault } from "@/lib/adapters/mock/persist";
import { SIGNED_KEY_REQUEST_DOMAIN, SIGNED_KEY_REQUEST_TYPES } from "./custodySign";
import { allPersonaFids, connectedRecords, mainNameDerivation } from "./personaFid";

// ------------------------------------------------------------------------------------------------- constants

/** the sealed namespace (listed in lib/adapters/mock/persist.ts ExtraNamespace and lib/vault/vault.ts VAULT_NAMESPACES) */
export const CONNECTOR_NS = "fcConnector";
/** Optimism mainnet: the Farcaster contracts the setup writes to and reads from */
export const ID_GATEWAY = "0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69";
export const ID_REGISTRY = "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b";
export const OP_CHAIN_ID = 10;
export const DEFAULT_RPC = "https://mainnet.optimism.io";
/** the offchain fname registry (hub-monorepo packages/core eip712: the UserNameProof domain is MAINNET, chainId 1) */
export const FNAME_REGISTRY = "https://fnames.farcaster.xyz";
export const FNAME_PROOF_DOMAIN = { name: "Farcaster name verification", version: "1", chainId: 1, verifyingContract: "0xe3be01d99baa8db9905b33a3ca391238234b79d1" } as const;
export const FNAME_PROOF_TYPES = { UserNameProof: [{ name: "name", type: "string" }, { name: "timestamp", type: "uint256" }, { name: "owner", type: "address" }] } as const;
/** the protocol's fname grammar (farcaster/core) */
export const FNAME_RE = /^[a-z0-9][a-z0-9-]{0,15}$/;
/** what the owner is told to send: ~6x the price, so one withdrawal covers the registration, gas and a retry */
export const FUNDING_AMOUNT_ETH = "0.0005";
/** "funded" before a live gas estimate exists: price + this (0.00005 ETH covers Optimism's L2 gas and L1 data fee
 *  for one register call many times over at 2026 fee levels; the register step re-checks with a live estimate) */
const STATUS_MARGIN_WEI = BigInt("50000000000000");
/** the L1 data fee is charged outside gas × price on Optimism: this allowance stands in for it (0.00002 ETH) */
const L1_FEE_ALLOWANCE_WEI = BigInt("20000000000000");
/** the receipt is waited for this long inside one request; after it the record says "registering" and the next
 *  status read resumes the wait (a proxy must never have to hold a minutes-long request) */
export const RECEIPT_WAIT_MS = 20_000;
const RECEIPT_POLL_MS = 2_000;
/** a sent transaction with no receipt for this long is treated as dropped: the next register sends again */
export const REGISTER_STALE_MS = 15 * 60 * 1000;
const KEY_ENV = "FC_CONNECT_APP_" + "CUSTODY_KEY"; // read by NAME (the dynamic key keeps the name out of bundles)
const HEX40 = /^0x[0-9a-fA-F]{40}$/;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

const ID_GATEWAY_ABI = [
  { type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ name: "price", type: "uint256" }] },
  { type: "function", name: "register", stateMutability: "payable", inputs: [{ name: "recovery", type: "address" }], outputs: [{ name: "fid", type: "uint256" }, { name: "overpayment", type: "uint256" }] },
] as const;
const ID_REGISTRY_ABI = [
  { type: "function", name: "idOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "fid", type: "uint256" }] },
] as const;

// ------------------------------------------------------------------------------------------------- errors & views

export class ConnectorError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(code: string, message: string, status = 400, retryable = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export type ConnectorStage = "none" | "created" | "unfunded" | "funded" | "registering" | "registered" | "named";

export interface ConnectorChainView {
  ok: boolean;
  /** the RPC's host only (never a URL with a key in it) */
  rpcHost: string;
  balanceWei: string | null;
  balanceEth: string | null;
  priceWei: string | null;
  priceEth: string | null;
  /** price + the status margin: the line "funded" is judged against */
  requiredWei: string | null;
  requiredEth: string | null;
  shortfallEth: string | null;
  reason: string | null;
}

/** the public view: never a key, never anything but the owner's own public facts */
export interface ConnectorStatusView {
  available: boolean;
  code: string | null;
  reason: string | null;
  /** what lib/fc/connect.ts would sign with right now */
  source: "env" | "sealed" | "none";
  /** FC_CONNECT_APP_FID or the custody key NAME is set on this service (names only) */
  envSet: boolean;
  stage: ConnectorStage;
  address: string | null;
  recoveryAddress: string | null;
  fid: number | null;
  fname: string | null;
  createdAt: number | null;
  registerTx: string | null;
  registeredAt: number | null;
  namedAt: number | null;
  chain: ConnectorChainView | null;
  /** the exact funding sentence, so every surface says the same thing */
  funding: { amountEth: string; chain: "Optimism"; instruction: string } | null;
  /** the last definitive outcome worth repeating (a reverted registration), cleared by the next success */
  note: string | null;
  /** what is left to do, in plain words */
  next: string;
}

// ------------------------------------------------------------------------------------------------- the sealed record

interface ConnectorRecord {
  v: 1;
  /** SECRET — the custody key: this sealed record and this module's closure only */
  custodyKey: `0x${string}`;
  /** SECRET — the recovery key (a fresh one, never main's recovery, never a Totem address) */
  recoveryKey: `0x${string}`;
  address: string;
  recoveryAddress: string;
  createdAt: number;
  fid: number | null;
  registeredAt: number | null;
  registerTx: string | null;
  registerSentAt: number | null;
  fname: string | null;
  namedAt: number | null;
  note: string | null;
}
interface Doc {
  record: ConnectorRecord | null;
  /** true only for a document that came from a successful validator read (personaFid.ts Gate 5) */
  loaded?: boolean;
}

const g = globalThis as unknown as { __layersConnector?: Doc; __layersConnectorQueue?: Promise<unknown> };

/** the same fail-closed read as lib/fc/personaFid.ts load(): a failed read REFUSES, never an empty record (an empty
 *  doc cached here would let create() seal a second key over the one that exists) */
async function load(): Promise<Doc> {
  if (g.__layersConnector) return g.__layersConnector;
  let doc: Doc = { record: null, loaded: false };
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(CONNECTOR_NS);
      if (res.status === 404) {
        doc.loaded = true;
        break;
      }
      if (!res.ok) throw new Error("validator answered " + res.status);
      const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
      if (entries && Object.keys(entries).length) {
        const plain = decryptNamespace(CONNECTOR_NS, entries); // throws on the wrong key: loud, never empty
        const rec = plain["_"] as { m?: Doc } | undefined;
        if (!rec)
          throw new Error("vault: " + CONNECTOR_NS + " holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one");
        doc = { record: rec.m && rec.m.record && typeof rec.m.record === "object" ? rec.m.record : null, loaded: true };
      } else doc.loaded = true;
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (String((e as Error).message).includes("vault")) break; // a wrong key is not transient
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  if (!doc.loaded) throw new ConnectorError("vault_unavailable", "the connector record could not be read (" + ((lastErr as Error)?.message ?? "validator unreachable") + ") — refusing rather than treating the vault as empty", 503, true);
  g.__layersConnector = doc;
  return doc;
}

async function save(doc: Doc): Promise<void> {
  if (!doc.loaded) throw new ConnectorError("vault_unavailable", "the connector record was never loaded from the validator — refusing to seal over it", 503, true);
  g.__layersConnector = doc;
  const body = { record: doc.record };
  const inner = JSON.stringify(body);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const sealed = encryptNamespace(CONNECTOR_NS, { _: { m: body, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
  try {
    await flushVault(CONNECTOR_NS, sealed);
  } catch (e) {
    g.__layersConnector = undefined; // the in-process copy must not outlive a failed seal
    throw new ConnectorError("vault_unavailable", "the connector record could not be sealed (" + String((e as Error)?.message ?? "").slice(0, 160) + ") — nothing was changed", 503, true);
  }
}

/** resetSeed / tests: forget the in-process copy (the validator's is the record) */
export function resetConnectorCache(): void {
  g.__layersConnector = undefined;
}

/** one connector step at a time in this process: two creates or two registers racing must never seal twice */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__layersConnectorQueue ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  g.__layersConnectorQueue = next.catch(() => undefined);
  return next;
}

// ------------------------------------------------------------------------------------------------- where it runs

export type ConnectorGate = { ok: true } | { ok: false; code: string; reason: string; status: number };

/** the owner service with everything connect.ts needs for the LIVE network; the gate is connect.ts's own (imported
 *  lazily: connect.ts imports this module, and a static import back would be a cycle) */
export async function connectorGate(): Promise<ConnectorGate> {
  if (typeof window !== "undefined") return { ok: false, code: "device", status: 404, reason: "The connector is set up on your private owner service, never inside the browser preview." };
  const { connectGate } = await import("./connect");
  const gate = connectGate();
  if (!gate.ok) return gate;
  if (gate.mode !== "live") return { ok: false, code: "not_owner_service", status: 403, reason: "The connector is set up on your private owner service only (this server runs the test rig's fixture connector)." };
  return { ok: true };
}

async function openGate(): Promise<void> {
  const gate = await connectorGate();
  if (!gate.ok) throw new ConnectorError(gate.code, gate.reason, gate.status);
}

/** FC_CONNECT_APP_FID or the custody key name is set: the environment connector wins, by name only */
export function envConnectorSet(): boolean {
  return !!(process.env.FC_CONNECT_APP_FID ?? "").trim() || !!(process.env[KEY_ENV] ?? "").trim();
}

// ------------------------------------------------------------------------------------------------- the chain (read-only RPC)

function rpcUrl(): string {
  const raw = (process.env.FC_CONNECT_RPC_URL ?? "").trim() || DEFAULT_RPC;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ConnectorError("bad_rpc", "FC_CONNECT_RPC_URL is not a URL", 500);
  }
  if (u.protocol !== "https:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) throw new ConnectorError("bad_rpc", "FC_CONNECT_RPC_URL must be https", 500);
  return u.toString();
}
function rpcHost(): string {
  try {
    return new URL(rpcUrl()).host;
  } catch {
    return "(unset)";
  }
}

let rpcId = 0;
/** one JSON-RPC call (the same discipline as lib/fc/connect.ts): transport failures are retried; a JSON-RPC `error`
 *  is the node's definitive answer and comes back at once as code "rpc_error" */
async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const url = rpcUrl();
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    let j: { result?: unknown; error?: { message?: string } } | null = null;
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }), cache: "no-store" });
      if (!res.ok) throw new Error("rpc answered " + res.status);
      j = (await res.json()) as { result?: unknown; error?: { message?: string } };
    } catch (e) {
      last = (e as Error).message;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      continue;
    }
    if (j && j.error) throw new ConnectorError("rpc_error", "the Optimism RPC refused " + method + ": " + String(j.error.message ?? "unknown").slice(0, 160), 503, true);
    if (!j || !("result" in j)) {
      last = "rpc answered no result";
      continue;
    }
    return j.result;
  }
  throw new ConnectorError("chain_unavailable", "the Optimism RPC could not be read (" + last + ") — try again", 503, true);
}

function quantity(v: unknown, what: string): bigint {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(v)) throw new ConnectorError("chain_unavailable", what + " answered nothing readable", 503, true);
  return BigInt(v);
}
const hexQty = (n: bigint) => "0x" + n.toString(16);

async function readChainId(): Promise<number> {
  return Number(quantity(await rpc("eth_chainId", []), "eth_chainId"));
}
async function readBalance(address: string): Promise<bigint> {
  return quantity(await rpc("eth_getBalance", [address, "latest"]), "eth_getBalance");
}
async function readPrice(): Promise<bigint> {
  const data = encodeFunctionData({ abi: ID_GATEWAY_ABI, functionName: "price" });
  const out = await rpc("eth_call", [{ to: ID_GATEWAY, data }, "latest"]);
  if (typeof out !== "string" || !/^0x[0-9a-fA-F]*$/.test(out)) throw new ConnectorError("chain_unavailable", "IdGateway.price answered nothing readable", 503, true);
  try {
    return decodeFunctionResult({ abi: ID_GATEWAY_ABI, functionName: "price", data: out as `0x${string}` }) as bigint;
  } catch {
    throw new ConnectorError("chain_unavailable", "IdGateway.price answered nothing readable", 503, true);
  }
}
async function readIdOf(address: string): Promise<number> {
  const data = encodeFunctionData({ abi: ID_REGISTRY_ABI, functionName: "idOf", args: [address as `0x${string}`] });
  const out = await rpc("eth_call", [{ to: ID_REGISTRY, data }, "latest"]);
  if (typeof out !== "string" || !/^0x[0-9a-fA-F]*$/.test(out)) throw new ConnectorError("chain_unavailable", "IdRegistry.idOf answered nothing readable", 503, true);
  try {
    const fid = decodeFunctionResult({ abi: ID_REGISTRY_ABI, functionName: "idOf", data: out as `0x${string}` }) as bigint;
    const n = Number(fid);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("not a fid");
    return n;
  } catch {
    throw new ConnectorError("chain_unavailable", "IdRegistry.idOf answered nothing readable", 503, true);
  }
}
async function readReceipt(txHash: string): Promise<{ mined: boolean; ok: boolean; blockNumber: number | null }> {
  const r = (await rpc("eth_getTransactionReceipt", [txHash])) as { status?: unknown; blockNumber?: unknown } | null;
  if (!r || typeof r !== "object") return { mined: false, ok: false, blockNumber: null };
  const status = typeof r.status === "string" ? r.status.toLowerCase() : "";
  const block = typeof r.blockNumber === "string" && /^0x[0-9a-fA-F]+$/.test(r.blockNumber) ? Number(BigInt(r.blockNumber)) : null;
  return { mined: true, ok: status === "0x1", blockNumber: block };
}

// ------------------------------------------------------------------------------------------------- helpers

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fundingInstruction(address: string): string {
  return `Send about ${FUNDING_AMOUNT_ETH} ETH on OPTIMISM to ${address} from an exchange withdrawal; never from the Neynar wallet, your main wallet or a persona.`;
}

/** FC_LAYERS_ADDRESSES (the developer's Neynar App Wallet first), every persona's custody, and main's custody: the
 *  connector's addresses may never be one of them (an address Totem already uses would tie C to the personas) */
async function knownAddresses(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const a of (process.env.FC_LAYERS_ADDRESSES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => HEX40.test(s))) out.set(a, "a Totem address (FC_LAYERS_ADDRESSES)");
  for (const r of await allPersonaFids()) {
    if (HEX40.test(r.custodyAddress)) out.set(lc(r.custodyAddress), r.origin === "connected" ? "your main account's custody address" : "a persona's custody address");
  }
  for (const r of await connectedRecords()) if (HEX40.test(r.custodyAddress)) out.set(lc(r.custodyAddress), "your main account's custody address");
  return out;
}

async function assertAddressesUnused(rec: ConnectorRecord): Promise<void> {
  const known = await knownAddresses();
  for (const [addr, what] of [[rec.address, "custody"], [rec.recoveryAddress, "recovery"]] as const) {
    const hit = known.get(lc(addr));
    if (hit) throw new ConnectorError("connector_shares_wallet", `The connector's ${what} address is ${hit} — the connector must share nothing with your other accounts. Nothing was sent.`, 409);
  }
}

function stageOf(rec: ConnectorRecord | null, chain: ConnectorChainView | null): ConnectorStage {
  if (!rec) return "none";
  if (rec.fname) return "named";
  if (rec.fid) return "registered";
  if (rec.registerTx) return "registering";
  if (!chain || !chain.ok || chain.balanceWei === null || chain.requiredWei === null) return "created";
  return BigInt(chain.balanceWei) >= BigInt(chain.requiredWei) ? "funded" : "unfunded";
}

function nextStep(stage: ConnectorStage, rec: ConnectorRecord | null, envSet: boolean): string {
  if (envSet) return "This service uses the connector named by FC_CONNECT_APP_FID and its key from the environment; the sealed connector (if any) is not used.";
  switch (stage) {
    case "none":
      return "Create the connector: scripts\\owner\\arm-connector.ps1 (it makes the account's address; you never handle a key).";
    case "created":
      return "The balance could not be read just now — try again; then fund the address if it is still empty.";
    case "unfunded":
      return fundingInstruction(rec?.address ?? "the address") + " Then run arm-connector.ps1 again and type REGISTER.";
    case "funded":
      return "Funded. Run arm-connector.ps1 and type REGISTER to register the account onchain (about the price plus gas).";
    case "registering":
      return "The registration transaction is waiting to be mined — check again in a moment (arm-connector.ps1 keeps checking).";
    case "registered":
      return "Registered. QR connect is ready: Settings › Connect your Farcaster account. Optional: a neutral name with arm-connector.ps1 -Fname <name>.";
    case "named":
      return "QR connect is ready: Settings › Connect your Farcaster account.";
  }
}

async function chainView(rec: ConnectorRecord): Promise<ConnectorChainView> {
  const host = rpcHost();
  try {
    const [balance, price] = await Promise.all([readBalance(rec.address), readPrice()]);
    const required = price + STATUS_MARGIN_WEI;
    const short = balance >= required ? null : formatEther(required - balance);
    return { ok: true, rpcHost: host, balanceWei: balance.toString(), balanceEth: formatEther(balance), priceWei: price.toString(), priceEth: formatEther(price), requiredWei: required.toString(), requiredEth: formatEther(required), shortfallEth: short, reason: null };
  } catch (e) {
    return { ok: false, rpcHost: host, balanceWei: null, balanceEth: null, priceWei: null, priceEth: null, requiredWei: null, requiredEth: null, shortfallEth: null, reason: (e as Error).message };
  }
}

function view(doc: Doc, chain: ConnectorChainView | null, gate: ConnectorGate): ConnectorStatusView {
  const rec = doc.record;
  const envSet = envConnectorSet();
  const stage = stageOf(rec, chain);
  const source: ConnectorStatusView["source"] = envSet ? "env" : rec && rec.fid ? "sealed" : "none";
  return {
    available: gate.ok,
    code: gate.ok ? null : gate.code,
    reason: gate.ok ? null : gate.reason,
    source,
    envSet,
    stage,
    address: rec?.address ?? null,
    recoveryAddress: rec?.recoveryAddress ?? null,
    fid: rec?.fid ?? null,
    fname: rec?.fname ?? null,
    createdAt: rec?.createdAt ?? null,
    registerTx: rec?.registerTx ?? null,
    registeredAt: rec?.registeredAt ?? null,
    namedAt: rec?.namedAt ?? null,
    chain,
    funding: rec && !rec.fid ? { amountEth: FUNDING_AMOUNT_ETH, chain: "Optimism", instruction: fundingInstruction(rec.address) } : null,
    note: rec?.note ?? null,
    // where the setup cannot run at all, "what is left to do" is the gate's own sentence (never "create it" on a
    // public site or a rig, where the script would be refused)
    next: gate.ok ? nextStep(stage, rec, envSet) : gate.reason,
  };
}

// ------------------------------------------------------------------------------------------------- the steps

/** GET: where the setup stands. Reads the chain (balance, price) while the account is not registered; a sent
 *  registration whose receipt has landed meanwhile is finished here, so the owner's script can simply keep asking. */
export function connectorStatus(): Promise<ConnectorStatusView> {
  return serialized(async () => {
    const gate = await connectorGate();
    if (!gate.ok) return view({ record: null, loaded: true }, null, gate);
    let doc = await load();
    if (doc.record && !doc.record.fid && doc.record.registerTx) doc = await settleRegistration(doc, 0);
    const chain = doc.record && !doc.record.fid && !doc.record.registerTx ? await chainView(doc.record) : null;
    return view(doc, chain, gate);
  });
}

/** CREATE: the custody and recovery keys, sealed; only the custody address comes back. Idempotent. */
export function createConnector(): Promise<ConnectorStatusView> {
  return serialized(async () => {
    await openGate();
    if (envConnectorSet()) throw new ConnectorError("env_connector_set", "This service already names a connector in its environment (FC_CONNECT_APP_FID and its key). Remove those two variables first if you want Totem to create and keep the connector instead — two connectors must never disagree.", 409);
    const doc = await load();
    if (doc.record) return view(doc, doc.record.fid || doc.record.registerTx ? null : await chainView(doc.record), { ok: true });
    const custodyKey = generatePrivateKey();
    const recoveryKey = generatePrivateKey();
    const rec: ConnectorRecord = {
      v: 1,
      custodyKey,
      recoveryKey,
      address: lc(privateKeyToAccount(custodyKey).address),
      recoveryAddress: lc(privateKeyToAccount(recoveryKey).address),
      createdAt: Date.now(),
      fid: null,
      registeredAt: null,
      registerTx: null,
      registerSentAt: null,
      fname: null,
      namedAt: null,
      note: null,
    };
    await assertAddressesUnused(rec); // astronomically unlikely for fresh random keys; checked anyway, it is free
    await save({ record: rec, loaded: doc.loaded });
    return view({ record: rec, loaded: true }, await chainView(rec), { ok: true });
  });
}

/** a sent registration: read its receipt (waiting up to `waitMs`), finish it or report it; never send again here */
async function settleRegistration(doc: Doc, waitMs: number): Promise<Doc> {
  const rec = doc.record!;
  const tx = rec.registerTx!;
  const until = Date.now() + waitMs;
  for (;;) {
    const r = await readReceipt(tx);
    if (r.mined) {
      if (!r.ok) {
        // DEFINITIVE: the call reverted (the price came back, the gas did not). The record goes back to "funded"
        // or "unfunded" by the next balance read, with the reason kept, and a new register may be sent.
        const next: ConnectorRecord = { ...rec, registerTx: null, registerSentAt: null, note: `The registration transaction ${tx} was mined but REVERTED (the gas was spent; the price was returned). Check the balance and try REGISTER again; if it reverts again, tell Claude the transaction hash.` };
        const out = { record: next, loaded: doc.loaded };
        await save(out);
        return out;
      }
      const fid = await readIdOf(rec.address);
      if (fid <= 0) throw new ConnectorError("chain_unavailable", `The registration transaction ${tx} succeeded but IdRegistry.idOf still reads 0 (the RPC may lag) — try again in a moment.`, 503, true);
      const next: ConnectorRecord = { ...rec, fid, registeredAt: Date.now(), note: null };
      const out = { record: next, loaded: doc.loaded };
      await save(out);
      return out;
    }
    if (Date.now() >= until) return doc;
    await sleep(RECEIPT_POLL_MS);
  }
}

/** REGISTER (typed): IdGateway.register(recovery) from the custody key, after every refusal below. Resumable. */
export function registerConnector(confirm: string): Promise<ConnectorStatusView> {
  return serialized(async () => {
    await openGate();
    if (confirm !== "REGISTER") throw new ConnectorError("confirm_required", "Type REGISTER to register the connector account onchain.", 400);
    let doc = await load();
    const rec = doc.record;
    if (!rec) throw new ConnectorError("not_created", "There is no connector to register yet — create it first (arm-connector.ps1 does both in order).", 404);
    if (rec.fid) return view(doc, null, { ok: true }); // already registered: idempotent, nothing sent
    const chainId = await readChainId();
    if (chainId !== OP_CHAIN_ID) throw new ConnectorError("wrong_chain", `FC_CONNECT_RPC_URL answers for chain ${chainId}, not Optimism (${OP_CHAIN_ID}) — nothing was sent.`, 500);
    // a registration whose receipt this process never saw (a crash, a restart): finish it from the chain
    const existing = await readIdOf(rec.address);
    if (existing > 0) {
      doc = { record: { ...rec, fid: existing, registeredAt: Date.now(), registerTx: rec.registerTx, note: null }, loaded: doc.loaded };
      await save(doc);
      return view(doc, null, { ok: true });
    }
    if (rec.registerTx) {
      const stale = rec.registerSentAt !== null && Date.now() - rec.registerSentAt > REGISTER_STALE_MS;
      doc = await settleRegistration(doc, stale ? 0 : RECEIPT_WAIT_MS);
      if (doc.record!.fid || doc.record!.registerTx) {
        if (!doc.record!.fid && stale) {
          // nothing landed in REGISTER_STALE_MS: the transaction was dropped; send again below with a fresh nonce
          doc = { record: { ...doc.record!, registerTx: null, registerSentAt: null, note: `An earlier registration transaction (${rec.registerTx}) was never mined and is treated as dropped.` }, loaded: doc.loaded };
          await save(doc);
        } else return view(doc, null, { ok: true });
      }
    }
    const cur = doc.record!;
    await assertAddressesUnused(cur);
    const [price, balance] = await Promise.all([readPrice(), readBalance(cur.address)]);
    if (balance < price + STATUS_MARGIN_WEI)
      throw new ConnectorError("unfunded", `Not funded enough: the address holds ${formatEther(balance)} ETH and needs about ${formatEther(price + STATUS_MARGIN_WEI)} ETH (the price ${formatEther(price)} ETH plus gas). ${fundingInstruction(cur.address)} Nothing was sent.`, 409);
    const data = encodeFunctionData({ abi: ID_GATEWAY_ABI, functionName: "register", args: [cur.recoveryAddress as `0x${string}`] });
    const gasEstimate = quantity(await rpc("eth_estimateGas", [{ from: cur.address, to: ID_GATEWAY, value: hexQty(price), data }]), "eth_estimateGas");
    const gas = (gasEstimate * BigInt(13)) / BigInt(10); // 30% headroom; unused gas is not charged
    const gasPrice = quantity(await rpc("eth_gasPrice", []), "eth_gasPrice");
    let priority: bigint;
    try {
      priority = quantity(await rpc("eth_maxPriorityFeePerGas", []), "eth_maxPriorityFeePerGas");
    } catch {
      priority = BigInt("1000000"); // 0.001 gwei: Optimism's usual tip when the node does not answer the method
    }
    const maxFee = gasPrice * BigInt(2) > priority ? gasPrice * BigInt(2) : priority;
    const required = price + gas * maxFee + L1_FEE_ALLOWANCE_WEI;
    if (balance < required)
      throw new ConnectorError("unfunded", `Not funded enough for today's gas: the address holds ${formatEther(balance)} ETH and the registration needs about ${formatEther(required)} ETH right now (price ${formatEther(price)} ETH, gas up to ${formatEther(gas * maxFee)} ETH, plus the L1 data fee). ${fundingInstruction(cur.address)} Nothing was sent.`, 409);
    const nonce = Number(quantity(await rpc("eth_getTransactionCount", [cur.address, "pending"]), "eth_getTransactionCount"));
    let raw: `0x${string}`;
    try {
      const account = privateKeyToAccount(cur.custodyKey);
      raw = await account.signTransaction({ chainId: OP_CHAIN_ID, type: "eip1559", to: ID_GATEWAY, value: price, data, nonce, gas, maxFeePerGas: maxFee, maxPriorityFeePerGas: priority });
    } catch {
      throw new ConnectorError("sign_failed", "The registration transaction could not be signed on this service — nothing was sent.", 500);
    }
    const { keccak256 } = await import("viem");
    const txHash = keccak256(raw);
    // sealed BEFORE the send: a crash between the two resumes by reading the receipt, never by sending twice
    doc = { record: { ...cur, registerTx: txHash, registerSentAt: Date.now(), note: null }, loaded: doc.loaded };
    await save(doc);
    let sent: unknown;
    try {
      sent = await rpc("eth_sendRawTransaction", [raw]);
    } catch (e) {
      // the node REFUSED the bytes (insufficient funds at today's fee, a bad nonce): nothing was broadcast, so the
      // sealed hash must not sit as "registering" until the 15-minute stale rule — cleared now, the ETH untouched.
      // "already known" / "nonce too low" / a replacement refusal mean an EARLIER send did reach the network: the hash
      // stays and the receipt (or the stale rule) settles it. A transport failure may have reached the node: same.
      const msg = String((e as Error)?.message ?? "");
      if (e instanceof ConnectorError && e.code === "rpc_error" && !/already known|known transaction|nonce too low|replacement|underpriced/i.test(msg)) {
        doc = { record: { ...doc.record!, registerTx: null, registerSentAt: null, note: `The Optimism RPC refused the registration transaction before sending it (${msg.slice(0, 160)}). Nothing was sent; the ETH is still at the address. Try REGISTER again in a moment.` }, loaded: doc.loaded };
        await save(doc);
      }
      throw e;
    }
    if (typeof sent === "string" && HEX32.test(sent) && lc(sent) !== lc(txHash)) {
      // the node computed another hash for the same bytes — follow the node's, which is what it will answer for
      doc = { record: { ...doc.record!, registerTx: sent }, loaded: doc.loaded };
      await save(doc);
    }
    doc = await settleRegistration(doc, RECEIPT_WAIT_MS);
    // a REVERTED registration leaves the record with neither fid nor hash: the stage is then the balance's (funded /
    // unfunded, read now), never "created" — whose next step would wrongly say the balance could not be read
    return view(doc, doc.record!.fid || doc.record!.registerTx ? null : await chainView(doc.record!), { ok: true });
  });
}

// ------------------------------------------------------------------------------------------------- the fname

async function fnameCall(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: unknown; text: string }> {
  let res: Response;
  try {
    res = await fetch(FNAME_REGISTRY + path, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  } catch (e) {
    throw new ConnectorError("fname_registry_unavailable", "the fname registry could not be reached (" + ((e as Error)?.name ?? "error") + ") — try again", 503, true);
  }
  const text = await res.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
}

/** the registry's own short error line, never anything of ours */
function registryMessage(body: unknown, text: string): string {
  const e = body && typeof body === "object" ? (body as { error?: unknown; code?: unknown }).error : null;
  const s = typeof e === "string" ? e : text;
  return String(s ?? "").replace(/\s+/g, " ").slice(0, 160);
}

/** the names the connector may not take: "layers" or "totem" anywhere, main's name stem, a persona's own fname, the shared
 *  test account's name (FC_TEST_FNAME) — the name is on the approval screen and on every client, forever */
async function assertNeutralName(name: string): Promise<void> {
  if (!FNAME_RE.test(name)) throw new ConnectorError("bad_name", "A Farcaster name is 1 to 16 characters of a-z, 0-9 and hyphens, and starts with a letter or a digit.", 400);
  if (/layers|totem/i.test(name)) throw new ConnectorError("name_says_layers", `"${name}" mentions Totem — anyone could then tie your main account to this app's personas. Pick a neutral name.`, 409);
  const test = (process.env.FC_TEST_FNAME ?? "").trim().toLowerCase();
  if (test && (name === test || name.startsWith(test) || test.startsWith(name))) throw new ConnectorError("name_is_test_account", `"${name}" is the shared test account's name (or its stem) — refused.`, 409);
  let stem: string | null;
  try {
    stem = await mainNameDerivation(name);
  } catch (e) {
    throw new ConnectorError("vault_unavailable", "couldn't check the name against your main account's (" + (e as Error).message + ") — try again", 503, true);
  }
  if (stem) throw new ConnectorError("name_stem", stem, 409);
  const personas = await allPersonaFids();
  const clash = personas.find((r) => r.origin !== "connected" && r.fname && lc(r.fname) === name);
  if (clash) throw new ConnectorError("name_is_persona", `"${name}" is one of your personas' names — the connector must not look like any of your accounts.`, 409);
}

/** FNAME (optional): a neutral name for C through the offchain registry, signed by the custody key. Free. */
export function nameConnector(nameRaw: string): Promise<ConnectorStatusView> {
  return serialized(async () => {
    await openGate();
    const name = String(nameRaw ?? "").trim().toLowerCase().replace(/^@/, "");
    const doc = await load();
    const rec = doc.record;
    if (!rec) throw new ConnectorError("not_created", "There is no connector yet — create and register it first.", 404);
    if (!rec.fid) throw new ConnectorError("not_registered", "The connector is not registered onchain yet — a name needs its fid. Type REGISTER first.", 409);
    if (rec.fname) {
      if (rec.fname === name) return view(doc, null, { ok: true });
      throw new ConnectorError("already_named", `The connector is already named @${rec.fname}. Renaming is not built; it keeps that name.`, 409);
    }
    await assertNeutralName(name);
    // availability: the registry lists every transfer of a name; it is taken while the latest transfer's `to` is not 0
    const cur = await fnameCall("GET", "/transfers?name=" + encodeURIComponent(name));
    if (cur.status !== 200) throw new ConnectorError("fname_registry_unavailable", `the fname registry answered ${cur.status} to the availability check — try again`, 503, true);
    const transfers = (cur.body as { transfers?: unknown[] } | null)?.transfers;
    if (!Array.isArray(transfers)) throw new ConnectorError("fname_registry_unavailable", "the fname registry's availability answer was not readable — try again", 503, true);
    const last = transfers[transfers.length - 1] as { to?: unknown } | undefined;
    if (last && Number(last.to) !== 0) throw new ConnectorError("name_taken", `@${name} is taken. Pick another neutral name.`, 409);
    const timestamp = Math.floor(Date.now() / 1000);
    let signature: string;
    let owner: string;
    try {
      const account = privateKeyToAccount(rec.custodyKey);
      owner = account.address;
      signature = await account.signTypedData({ domain: FNAME_PROOF_DOMAIN, types: FNAME_PROOF_TYPES, primaryType: "UserNameProof", message: { name, timestamp: BigInt(timestamp), owner: account.address } });
    } catch {
      throw new ConnectorError("sign_failed", "The name proof could not be signed on this service — nothing was sent.", 500);
    }
    const r = await fnameCall("POST", "/transfers", { name, from: 0, to: rec.fid, fid: rec.fid, owner, timestamp, signature });
    if (r.status !== 200 && r.status !== 201) throw new ConnectorError("fname_refused", `the fname registry refused @${name} (${r.status}${registryMessage(r.body, r.text) ? ": " + registryMessage(r.body, r.text) : ""})`, 502);
    const next: ConnectorRecord = { ...rec, fname: name, namedAt: Date.now() };
    const out = { record: next, loaded: doc.loaded };
    await save(out);
    return view(out, null, { ok: true });
  });
}

// ------------------------------------------------------------------------------------------------- for connect.ts

export interface SealedConnectorSummary {
  stage: ConnectorStage;
  address: string;
  fid: number | null;
  fname: string | null;
  createdAt: number;
}
export type SealedConnectorHandle =
  | { ok: true; fid: number; address: string; fname: string | null; summary: SealedConnectorSummary; signKeyRequest(publicKey: `0x${string}`, deadline: number): Promise<`0x${string}`> }
  | { ok: false; reason: string; summary: SealedConnectorSummary | null };

/** The sealed connector as lib/fc/connect.ts uses it, when the environment names are unset: the fid, the custody
 *  address and the ONE signing operation (a SignedKeyRequest for requestFid = C); the key stays in this closure. A
 *  vault that cannot be read is a reason, never "no connector". No chain read here (the settings page calls this on
 *  every render); the stage is judged from the record alone, so an unregistered record reads "created". */
export async function sealedConnectorForConnect(): Promise<SealedConnectorHandle> {
  let doc: Doc;
  try {
    doc = await load();
  } catch (e) {
    return { ok: false, reason: "The sealed connector record could not be read (" + String((e as Error)?.message ?? "").slice(0, 160) + ") — try again.", summary: null };
  }
  const rec = doc.record;
  if (!rec)
    return { ok: false, reason: "Not set up on this service yet: FC_CONNECT_APP_FID and FC_CONNECT_APP_CUSTODY_KEY are unset, and no connector has been created here. Run scripts\\owner\\arm-connector.ps1 on your laptop — it creates the connector account for you; you never handle a key.", summary: null };
  const summary: SealedConnectorSummary = { stage: stageOf(rec, null), address: rec.address, fid: rec.fid, fname: rec.fname, createdAt: rec.createdAt };
  if (!rec.fid) return { ok: false, reason: rec.registerTx ? "The connector's registration is waiting to be mined — run arm-connector.ps1 to finish it." : "The connector is created but not registered yet. " + fundingInstruction(rec.address) + " Then run arm-connector.ps1 and type REGISTER.", summary };
  const fid = rec.fid;
  return {
    ok: true,
    fid,
    address: rec.address,
    fname: rec.fname,
    summary,
    async signKeyRequest(publicKey, deadline) {
      const latest = (await load()).record;
      if (!latest || latest.fid !== fid) throw new ConnectorError("connector_changed", "the sealed connector changed while a key request was being signed — start again", 409);
      try {
        const account = privateKeyToAccount(latest.custodyKey);
        return await account.signTypedData({ domain: SIGNED_KEY_REQUEST_DOMAIN, types: SIGNED_KEY_REQUEST_TYPES, primaryType: "SignedKeyRequest", message: { requestFid: BigInt(fid), key: publicKey, deadline: BigInt(deadline) } });
      } catch {
        throw new ConnectorError("sign_failed", "the connector account could not sign the key request", 500);
      }
    },
  };
}
