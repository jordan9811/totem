import "server-only";
// CONNECT MAIN (BUILD B) — the owner's EXISTING Farcaster account, connected by QR, on the owner service only.
//
// What the owner does: types his username, scans a QR code (or taps a button on his phone), approves in the Farcaster
// app while logged in as that account. No seed phrase, ever. Totem can then post as him through a Neynar-managed
// signer; he can revoke it any time in the Farcaster app's connected apps.
//
// THE REQUESTFID (research verdict, 2026-10-07, read onchain): every signer approved by QR carries, onchain and
// forever, the fid of the app that requested it (SignedKeyRequestMetadata.requestFid) and that app's custody address.
// Neynar sponsorship only changes who pays; the shared Neynar requestFid (6131) went away with Sign In with Neynar on
// 2026-08-14, and no app can sign as 6131 or 9152. So a zero-fingerprint QR connect does not exist today. The honest
// minimum is a CONNECTOR fid C that main uses and nothing else ever uses:
//   - C is ONE config value, FC_CONNECT_APP_FID, and its custody key is read by NAME from FC_CONNECT_APP_CUSTODY_KEY
//     at call time (never logged, never echoed, never returned; a malformed value is reported by name only);
//   - C is refused when it is the shared test account (FC_TEST_FID), a reserved Totem fid (FC_RESERVED_FIDS), any
//     persona fid, the anon fid (FC_ANON_FID), main itself, or a system account (6131, 9152); when its custody is main's
//     custody or a verified address of main, a persona's custody address, or a Totem address (FC_LAYERS_ADDRESSES —
//     the developer's Neynar App Wallet); when its name says "layers" (the approval screen and every client show it);
//     and when the configured key is not custodyOf(C) onchain. Totem's own account numbers and wallet addresses are
//     NEVER written into this file: every route ships in the public browser bundle, and a list of them there would
//     publish the linkage this flow exists to avoid. They come from the owner service's environment.
//   - Creating C is the OWNER'S choice (about $1), and since the CONNECTOR SETUP pass it is the owner SERVICE'S action:
//     lib/fc/connector.server.ts generates C's custody and recovery keys, seals them, and — once the owner has funded
//     the address from an exchange withdrawal and typed REGISTER in scripts/owner/arm-connector.ps1 — registers C
//     through IdGateway from that key and names it (optional, neutral). The owner never sees or types a key. This
//     file then sources C from that sealed record whenever the two environment names are unset (connectorFor); the
//     environment stays as an alternative and wins when set. What the public sees either way: "main's key was
//     requested by fid C" — that main uses a private app, never which alts he has. Do NOT register C through Neynar's
//     POST /v2/farcaster/user (it would join the developer App Wallet's batch beside the Totem-named throwaway), nor
//     with "Create Agent" (Neynar would hold its custody), nor in the Farcaster app (a recovery phrase).
//
// THE FLOW (server-side; the page polls):
//   start   resolve main (Neynar user lookup) → the refusals above → POST /v2/farcaster/signer → sign the EIP-712
//           SignedKeyRequest{requestFid: C, key, deadline} with C's custody key (a separate code path from the persona
//           custody signer in lib/fc/custodySign.ts; only the domain and types are shared) → self-check the signature
//           → POST /v2/farcaster/signer/signed_key (sponsored by Neynar unless FC_CONNECT_SPONSOR=none) → the approval
//           link, as a QR and a phone button. The signer uuid goes to the sealed vault only (lib/fc/personaFid.ts).
//   poll    GET /v2/farcaster/signer (0 credits): pending → approved for main, or a WRONG account (nothing recorded;
//           the owner removes the stray connection in that account's connected apps), revoked, or expired.
//   finish  re-read the approval (never trusted from the poll) → READ THE CHAIN: the KeyRegistry Add event for main
//           with exactly this key, its metadata decoded — requestFid == C, requestSigner == C's custody, deadline ==
//           the one signed — and the transaction submitted by Farcaster's shared relayer, never a Totem address →
//           mint a keystore persona for main (public, deterministic nonce so a retried finish never mints twice, the
//           sealed roster synced so the 24 words recover it) → recordConnectedFid (origin "connected", publicSelf).
//   The app/api/signer/route.ts stub is never used: its registerRoot row would rebuild the root → persona grouping
//   migration 006 removed.
//
// WHERE IT RUNS: the owner service only — a rig-shaped server (ZK_DEV_HOOKS=true) behind the owner access gate
// (OWNER_ACCESS_SECRET), with Farcaster writes armed (ENABLE_FC_WRITE=true) and a Neynar key. Refused on a public
// deployment and inside the browser device. The laptop rig (no owner secret) runs the FIXTURE network below — an
// in-process stand-in for Neynar and the chain that makes no request at all — so suites can drive the whole flow.
//
// COSTS (Neynar compute units): user lookups 1 each (main and C), create signer 2, signed_key 5, polling 0, the
// author lookups of the self-link guard 2 per uncached cast; Neynar's sponsorship fee is charged in credits and its
// amount is not documented. Once main writes: about 20,000 credits per active signer per month, 150 a cast.
//
// AFTER IT: the self-link guard in lib/fc/writes.ts refuses any reply, like, recast, follow or @mention between main
// and any other own account, in both directions, failing closed (D-FID-5-NO-CLIENT-FINGERPRINT). Main stays "main"
// to the guard after a disconnect.
import { privateKeyToAccount } from "viem/accounts";
import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, keccak256, pad, recoverTypedDataAddress, toBytes, toHex } from "viem";
import { writeEnabled } from "@/lib/adapters/neynar/mode";
import { isPublicDeployment, ownerSecretProblem } from "@/lib/platform/env-contract";
import { isEmptyWorld } from "@/lib/world-flag";
import { derivedFromMain } from "@/lib/identity/handleStem";
import { SIGNED_KEY_REQUEST_DOMAIN, SIGNED_KEY_REQUEST_TYPES } from "./custodySign";
import { sealedConnectorForConnect, type SealedConnectorSummary } from "./connector.server";
import { qrSvgPath } from "@/lib/qr";
import {
  ConnectRecordRefusal,
  allPersonaFids,
  anonAccountFid,
  connectSession,
  connectedRecords,
  disconnectConnectedFid,
  neverMainFids,
  putConnectSession,
  recordConnectedFid,
  type ConnectSession,
  type ConnectStage,
} from "./personaFid";

// ------------------------------------------------------------------------------------------------- constants

/** Optimism mainnet: the Farcaster contracts the chain check reads (public reads, no key) */
export const ID_REGISTRY = "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b";
export const KEY_REGISTRY = "0x00000000Fc1237824fb747aBDE0FF18990E59b7e";
export const KEY_GATEWAY = "0x00000000fC56947c7E7183f8Ca4B62398CaAdf0B";
/** keccak256("Add(uint256,uint32,bytes,bytes,uint8,bytes)") — KeyRegistry's Add(fid, keyType, key indexed; keyBytes,
 *  metadataType, metadata) */
export const KEY_ADD_TOPIC = "0x7d285df41058466977811345cd453c0c52e8d841ffaabc74fc050f277ad4de02";
/** the one relayer every third-party key approval in the Farcaster app was submitted by (research, onchain samples
 *  for requestFids 9152, 309998, 16823, 1351215, 3315145). FC_CONNECT_RELAYERS (comma-separated) replaces the list
 *  if Farcaster rotates it — the check then still refuses anything else. */
export const FARCASTER_RELAYER = "0x2d93c2f74b2c4697f9ea85d0450148aa45d4d5a2";
/** accounts no connector may be: @neynar (6131, the retired shared requestFid) and @warpcast (9152) */
export const SYSTEM_FIDS: readonly number[] = [6131, 9152];
/** the key request is valid for six hours (Neynar recommends ≤ 24 h); the session dies with it */
export const CONNECT_DEADLINE_SECONDS = 6 * 60 * 60;
/** Optimism produces a block every two seconds */
const OP_BLOCK_SECONDS = 2;
const LOG_CHUNK_BLOCKS = 2000;
const LOG_MIN_CHUNK_BLOCKS = 125;
const LOG_MARGIN_BLOCKS = 300;
/** enough for a whole request window (6 h = 10,800 blocks, plus margins) even at the smallest chunk */
const LOG_MAX_CHUNKS = 120;

const KEY_ENV = "FC_CONNECT_APP_" + "CUSTODY_KEY"; // read by NAME, at call time (the dynamic key keeps it out of bundles)
const NEYNAR = "https://api.neynar.com/v2/farcaster";
const DEFAULT_RPC = "https://mainnet.optimism.io";

// FIXTURE: the laptop rig's stand-in connector. Its custody key is a PUBLIC constant by construction — it signs fixture
// requests that reach nothing, and the fixture network is refused wherever the owner secret is set.
export const FIXTURE_APP_FID = 9_100_001;
const FIXTURE_APP_KEY = keccak256(toBytes("layers-fixture-connector/v1"));
export const FIXTURE_MAIN = { fid: 9_200_001, username: "fixture-main" } as const;
export const FIXTURE_OTHER = { fid: 9_200_002, username: "fixture-other" } as const;

// ------------------------------------------------------------------------------------------------- errors & views

export class ConnectError extends Error {
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

export type ConnectMode = "fixture" | "live";

export interface ConnectSessionView {
  id: string;
  mode: ConnectMode;
  stage: ConnectStage;
  expectedFid: number;
  expectedUsername: string;
  displayName: string | null;
  pfpUrl: string | null;
  appFid: number;
  appUsername: string | null;
  deadline: number;
  sponsored: boolean;
  createdAt: number;
  approvedFid: number | null;
  note: string | null;
  /** present only while the request can still be approved */
  approval: { url: string; appLink: string; qr: { viewBox: number; path: string } } | null;
}

export interface ConnectedView {
  personaId: string;
  handle: string | null;
  fid: number;
  fname: string | null;
  requestFid: number | null;
  mode: ConnectMode;
  verifiedAt: number | null;
  disconnected: boolean;
  /** CONNECT MAIN review (UXC-02): the owner removed Totem in the Farcaster app (Farcaster reported the key revoked) */
  removedInApp: boolean;
  /** what Farcaster said about main's signer on THIS read (live only): "approved", "revoked", or "unknown" when it
   *  could not be asked just now; null = not asked (fixture, or nothing connected) */
  signerCheck: "approved" | "revoked" | "unknown" | null;
}

export interface ConnectStatusView {
  available: boolean;
  /** why not, when not available */
  code: string | null;
  reason: string | null;
  mode: ConnectMode | null;
  /** CONNECTOR SETUP: `source` says what signs — the environment names, the sealed record the owner service created
   *  (lib/fc/connector.server.ts), or the rig's fixture; `setup` is the sealed record's public state (stage, address,
   *  fid, name) whenever one exists, configured or not, so the page can say what is left to do */
  connector: { configured: boolean; appFid: number | null; fixture: boolean; source: "env" | "sealed" | "fixture" | null; setup: SealedConnectorSummary | null; reason: string | null } | null;
  connected: ConnectedView | null;
  session: ConnectSessionView | null;
}

// ------------------------------------------------------------------------------------------------- where it runs

export type ConnectGate = { ok: true; mode: ConnectMode } | { ok: false; code: string; reason: string; status: number };

/** Owner service → live; laptop rig → fixture; everything else refused. Writes must be armed for live. */
export function connectGate(): ConnectGate {
  const ownerOnly = "Connecting your Farcaster account runs only on your private owner service.";
  if (typeof window !== "undefined") return { ok: false, code: "device", status: 404, reason: ownerOnly + " This page is answered by the browser preview." };
  if (isPublicDeployment()) return { ok: false, code: "public_site", status: 403, reason: ownerOnly + " This is the public site." };
  if (process.env.ZK_DEV_HOOKS !== "true") return { ok: false, code: "not_owner_service", status: 403, reason: ownerOnly + " This server is not one (it holds no keystore)." };
  if (ownerSecretProblem() === null) {
    if (!writeEnabled())
      return { ok: false, code: "writes_unarmed", status: 409, reason: "Farcaster writes are switched off on this service (ENABLE_FC_WRITE is not \"true\"). Arm them first — connecting gives Totem nothing to do until writes are on." };
    if (!(process.env.NEYNAR_API_KEY ?? "").trim()) return { ok: false, code: "no_neynar_key", status: 409, reason: "NEYNAR_API_KEY is not set on this service." };
    // the shared test account must be configured: the write door refuses every write when writes are armed without it,
    // and it has to be in the set main and the connector are checked against
    if (!/^[1-9][0-9]{0,11}$/.test((process.env.FC_TEST_FID ?? "").trim()) || !(process.env.FC_TEST_SIGNER_UUID ?? "").trim())
      return { ok: false, code: "writes_misconfigured", status: 409, reason: "Farcaster writes are armed but the shared test account (FC_TEST_FID / FC_TEST_SIGNER_UUID) is not configured — the write door refuses every write like this." };
    return { ok: true, mode: "live" };
  }
  // the laptop rig: the fixture network only — it reaches nothing, and is demo furniture the empty world refuses
  if (isEmptyWorld()) return { ok: false, code: "empty_world", status: 403, reason: "The fixture connect is refused under LAYERS_WORLD=empty (it would mint demo furniture into a real keystore)." };
  return { ok: true, mode: "fixture" };
}

// ------------------------------------------------------------------------------------------------- the connector

interface Connector {
  appFid: number;
  /** C's custody ADDRESS (public) */
  address: string;
  fixture: boolean;
  /** CONNECTOR SETUP: what holds C's key — the environment (by name), the sealed record, or the rig's fixture constant */
  source: "env" | "sealed" | "fixture";
  signKeyRequest(publicKey: string, deadline: number): Promise<string>;
}

type ConnectorResult = { ok: true; c: Connector; setup: SealedConnectorSummary | null } | { ok: false; reason: string; setup: SealedConnectorSummary | null };

/** C, in this order: the rig's fixture; the ENVIRONMENT names when either is set (a half-set or malformed pair is
 *  reported, never fallen through — two connectors must never disagree); else the SEALED record the owner service
 *  created (lib/fc/connector.server.ts), which counts only once it is registered. A vault that cannot be read is a
 *  reason, never "no connector" (never fail open). */
async function connectorFor(mode: ConnectMode): Promise<ConnectorResult> {
  if (mode === "fixture") return { ok: true, c: accountConnector(FIXTURE_APP_FID, FIXTURE_APP_KEY, true), setup: null };
  const fidRaw = (process.env.FC_CONNECT_APP_FID ?? "").trim();
  const keyRaw = (process.env[KEY_ENV] ?? "").trim();
  if (!fidRaw && !keyRaw) {
    const sealed = await sealedConnectorForConnect();
    if (!sealed.ok) return { ok: false, reason: sealed.reason, setup: sealed.summary };
    return {
      ok: true,
      setup: sealed.summary,
      c: signingConnector(sealed.fid, sealed.address, false, "sealed", (publicKey, deadline) => sealed.signKeyRequest(publicKey, deadline)),
    };
  }
  if (!fidRaw) return { ok: false, reason: "FC_CONNECT_APP_CUSTODY_KEY is set but FC_CONNECT_APP_FID is not — set both, or neither (then the connector the owner service created is used).", setup: null };
  if (!/^[1-9][0-9]{0,11}$/.test(fidRaw)) return { ok: false, reason: "FC_CONNECT_APP_FID is not a fid (a whole number).", setup: null };
  if (!keyRaw) return { ok: false, reason: "FC_CONNECT_APP_CUSTODY_KEY is not set (the connector account's custody key, by name) — set it, or unset FC_CONNECT_APP_FID too (then the connector the owner service created is used).", setup: null };
  // the shape is checked HERE so no library error can ever echo the value
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(keyRaw)) return { ok: false, reason: "FC_CONNECT_APP_CUSTODY_KEY is not a 32-byte hex private key (value not shown).", setup: null };
  const key = (keyRaw.startsWith("0x") ? keyRaw : "0x" + keyRaw).toLowerCase() as `0x${string}`;
  try {
    return { ok: true, c: accountConnector(Number(fidRaw), key, false), setup: null };
  } catch {
    return { ok: false, reason: "FC_CONNECT_APP_CUSTODY_KEY could not be loaded as a key (value not shown).", setup: null };
  }
}

/** a connector whose key this file holds (the environment's, or the fixture constant) */
function accountConnector(appFid: number, key: `0x${string}`, fixture: boolean): Connector {
  const account = privateKeyToAccount(key);
  return signingConnector(appFid, account.address, fixture, fixture ? "fixture" : "env", (publicKey, deadline) =>
    account.signTypedData({
      domain: SIGNED_KEY_REQUEST_DOMAIN,
      types: SIGNED_KEY_REQUEST_TYPES,
      primaryType: "SignedKeyRequest",
      message: { requestFid: BigInt(appFid), key: publicKey, deadline: BigInt(deadline) },
    })
  );
}

/** the connector's ONLY signing path: a SignedKeyRequest for requestFid = C over a key Neynar generated for main —
 *  never a general-purpose signer (lib/fc/custodySign.ts is the persona custody path; this one shares its domain only).
 *  `sign` is the one operation the key's holder exposes: for the sealed connector the key never leaves
 *  lib/fc/connector.server.ts's closure. The checks on the inputs run HERE, before any holder is asked. */
function signingConnector(appFid: number, address: string, fixture: boolean, source: Connector["source"], sign: (publicKey: `0x${string}`, deadline: number) => Promise<string>): Connector {
  return {
    appFid,
    address,
    fixture,
    source,
    async signKeyRequest(publicKey, deadline) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(publicKey)) throw new ConnectError("bad_key", "the signer key to request is malformed", 502);
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isInteger(deadline) || deadline <= now || deadline > now + 24 * 3600) throw new ConnectError("bad_deadline", "the key request deadline is malformed, past, or more than 24 hours out", 500);
      try {
        return await sign(publicKey.toLowerCase() as `0x${string}`, deadline);
      } catch {
        throw new ConnectError("sign_failed", "the connector account could not sign the key request", 500);
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------- the network

export interface FcUser {
  fid: number;
  username: string;
  displayName: string | null;
  pfpUrl: string | null;
  bio: string | null;
  custodyAddress: string;
  verifiedAddresses: string[];
}
export interface SignerState {
  status: string;
  fid: number | null;
  publicKey: string | null;
}
export interface KeyAddFact {
  txHash: string;
  blockNumber: number;
  from: string;
  to: string | null;
  requestFid: number;
  requestSigner: string;
  deadline: number;
  keyType: number;
  metadataType: number;
}
interface ConnectNetwork {
  lookupUser(q: { username?: string; fid?: number }): Promise<FcUser | null>;
  createSigner(): Promise<{ signerUuid: string; publicKey: string }>;
  registerSignedKey(i: { signerUuid: string; appFid: number; deadline: number; signature: string; sponsored: boolean }): Promise<{ approvalUrl: string; status: string; publicKey: string | null }>;
  lookupSigner(signerUuid: string): Promise<SignerState>;
  custodyOf(fid: number): Promise<string>;
  findKeyAdd(i: { fid: number; publicKey: string; sinceMs: number; deadline: number }): Promise<KeyAddFact | null>;
}

const HEX40 = /^0x[0-9a-fA-F]{40}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

function neynarKey(): string {
  const k = (process.env.NEYNAR_API_KEY ?? "").trim();
  if (!k) throw new ConnectError("no_neynar_key", "NEYNAR_API_KEY is not set", 409);
  return k;
}

/** Neynar's own one-line error, trimmed; never anything of ours (the key is a header, never echoed) */
function neynarMessage(body: unknown): string {
  const m = body && typeof body === "object" ? (body as { message?: unknown }).message : null;
  return typeof m === "string" ? m.slice(0, 200) : "";
}

async function neynarCall(method: "GET" | "POST", path: string, body: unknown, retries: number): Promise<{ status: number; body: unknown }> {
  const key = neynarKey();
  let last = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(NEYNAR + path, {
        method,
        headers: body === undefined ? { "x-api-key": key } : { "x-api-key": key, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch (e) {
      last = "Neynar unreachable (" + ((e as Error)?.name ?? "error") + ")";
      if (attempt < retries) await sleep(300 * (attempt + 1));
      continue;
    }
    const parsed = await res.json().catch(() => null);
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      last = "Neynar answered " + res.status;
      await sleep(300 * (attempt + 1));
      continue;
    }
    return { status: res.status, body: parsed };
  }
  throw new ConnectError("neynar_unavailable", last || "Neynar did not answer", 502, true);
}

function toUser(u: unknown): FcUser | null {
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  const fid = Number(r.fid);
  const custody = String(r.custody_address ?? "");
  if (!Number.isInteger(fid) || fid <= 0 || !HEX40.test(custody)) return null;
  const va = (r.verified_addresses as { eth_addresses?: unknown } | undefined)?.eth_addresses;
  const bio = ((r.profile as { bio?: { text?: unknown } } | undefined)?.bio?.text ?? null) as string | null;
  return {
    fid,
    username: String(r.username ?? ""),
    displayName: typeof r.display_name === "string" ? r.display_name : null,
    pfpUrl: typeof r.pfp_url === "string" ? r.pfp_url : null,
    bio: typeof bio === "string" ? bio : null,
    custodyAddress: custody,
    verifiedAddresses: Array.isArray(va) ? va.filter((a): a is string => typeof a === "string" && HEX40.test(a)).map((a) => a.toLowerCase()) : [],
  };
}

function rpcUrl(): string {
  const raw = (process.env.FC_CONNECT_RPC_URL ?? "").trim() || DEFAULT_RPC;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ConnectError("bad_rpc", "FC_CONNECT_RPC_URL is not a URL", 500);
  }
  if (u.protocol !== "https:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) throw new ConnectError("bad_rpc", "FC_CONNECT_RPC_URL must be https", 500);
  return u.toString();
}

let rpcId = 0;
/** one JSON-RPC call. Transport failures (unreachable, 5xx, 429, unreadable) are retried; a JSON-RPC `error` is the
 *  node's definitive answer and comes back at once as code "rpc_error" (the log scan reads it to shrink its range). */
async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const url = rpcUrl();
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    let j: { result?: unknown; error?: { message?: string } } | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error("rpc answered " + res.status);
      j = (await res.json()) as { result?: unknown; error?: { message?: string } };
    } catch (e) {
      last = (e as Error).message;
      if (attempt < 2) await sleep(400 * (attempt + 1));
      continue;
    }
    if (j && j.error) throw new ConnectError("rpc_error", "the Optimism RPC refused " + method + ": " + String(j.error.message ?? "unknown").slice(0, 160), 503, true);
    if (!j || !("result" in j)) {
      last = "rpc answered no result";
      continue;
    }
    return j.result;
  }
  throw new ConnectError("chain_unavailable", "the Optimism RPC could not be read (" + last + ") — try again", 503, true);
}

const ID_REGISTRY_ABI = [
  { type: "function", name: "custodyOf", stateMutability: "view", inputs: [{ name: "fid", type: "uint256" }], outputs: [{ name: "owner", type: "address" }] },
] as const;

const liveNetwork: ConnectNetwork = {
  async lookupUser(q) {
    if (q.fid !== undefined) {
      const r = await neynarCall("GET", `/user/bulk?fids=${q.fid}`, undefined, 2);
      if (r.status !== 200) throw new ConnectError("lookup_failed", `the account lookup failed (Neynar ${r.status}${neynarMessage(r.body) ? ": " + neynarMessage(r.body) : ""})`, 502, true);
      const users = (r.body as { users?: unknown[] } | null)?.users ?? [];
      return toUser(users[0]);
    }
    const r = await neynarCall("GET", `/user/by_username?username=${encodeURIComponent(q.username ?? "")}`, undefined, 2);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new ConnectError("lookup_failed", `the account lookup failed (Neynar ${r.status}${neynarMessage(r.body) ? ": " + neynarMessage(r.body) : ""})`, 502, true);
    return toUser((r.body as { user?: unknown } | null)?.user);
  },
  async createSigner() {
    // one retry: a lost response leaves an unregistered signer behind, which nothing can approve and costs nothing more
    const r = await neynarCall("POST", "/signer", {}, 1);
    const b = r.body as { signer_uuid?: unknown; public_key?: unknown } | null;
    const uuid = typeof b?.signer_uuid === "string" ? b.signer_uuid : "";
    const pk = typeof b?.public_key === "string" ? b.public_key : "";
    if (r.status !== 200 || !uuid || uuid.length > 128 || !/^0x[0-9a-fA-F]{64}$/.test(pk))
      throw new ConnectError("signer_failed", `Neynar did not create a signer (${r.status}${neynarMessage(r.body) ? ": " + neynarMessage(r.body) : ""})`, 502, true);
    return { signerUuid: uuid, publicKey: pk.toLowerCase() };
  },
  async registerSignedKey(i) {
    // NOT retried: a second registration of one signer is not idempotent — a failure here means "start again"
    const body: Record<string, unknown> = { signer_uuid: i.signerUuid, app_fid: i.appFid, deadline: i.deadline, signature: i.signature };
    if (i.sponsored) body.sponsor = { sponsored_by_neynar: true };
    const r = await neynarCall("POST", "/signer/signed_key", body, 0);
    const b = r.body as { signer_approval_url?: unknown; status?: unknown; public_key?: unknown } | null;
    if (r.status !== 200 || typeof b?.signer_approval_url !== "string")
      throw new ConnectError("signed_key_failed", `Neynar refused the key request (${r.status}${neynarMessage(r.body) ? ": " + neynarMessage(r.body) : ""})`, 502, true);
    return { approvalUrl: b.signer_approval_url, status: String(b.status ?? ""), publicKey: typeof b.public_key === "string" ? b.public_key : null };
  },
  async lookupSigner(signerUuid) {
    const r = await neynarCall("GET", `/signer?signer_uuid=${encodeURIComponent(signerUuid)}`, undefined, 2);
    if (r.status !== 200) throw new ConnectError("signer_lookup_failed", `the signer could not be read (Neynar ${r.status})`, 502, true);
    const b = r.body as { status?: unknown; fid?: unknown; public_key?: unknown } | null;
    const fid = Number(b?.fid);
    return { status: String(b?.status ?? ""), fid: Number.isInteger(fid) && fid > 0 ? fid : null, publicKey: typeof b?.public_key === "string" ? b.public_key : null };
  },
  async custodyOf(fid) {
    const data = encodeFunctionData({ abi: ID_REGISTRY_ABI, functionName: "custodyOf", args: [BigInt(fid)] });
    const out = await rpc("eth_call", [{ to: ID_REGISTRY, data }, "latest"]);
    if (typeof out !== "string" || !/^0x[0-9a-fA-F]*$/.test(out)) throw new ConnectError("chain_unavailable", "custodyOf answered nothing readable", 503, true);
    try {
      return decodeFunctionResult({ abi: ID_REGISTRY_ABI, functionName: "custodyOf", data: out as `0x${string}` }) as string;
    } catch {
      throw new ConnectError("chain_unavailable", "custodyOf answered nothing readable", 503, true);
    }
  },
  async findKeyAdd(i) {
    const head = await rpc("eth_blockNumber", []);
    const latest = typeof head === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(head) ? Number(BigInt(head)) : NaN;
    if (!Number.isSafeInteger(latest) || latest <= 0) throw new ConnectError("chain_unavailable", "the RPC named no block", 503, true);
    const nowSec = Math.floor(Date.now() / 1000);
    const from = Math.max(0, latest - Math.ceil((nowSec - Math.floor(i.sinceMs / 1000)) / OP_BLOCK_SECONDS) - LOG_MARGIN_BLOCKS);
    const to = nowSec > i.deadline ? Math.min(latest, latest - Math.floor((nowSec - i.deadline) / OP_BLOCK_SECONDS) + LOG_MARGIN_BLOCKS) : latest;
    const topics = [KEY_ADD_TOPIC, pad(toHex(i.fid), { size: 32 }), pad(toHex(1), { size: 32 }), keccak256(i.publicKey as `0x${string}`)];
    type Log = { address?: string; topics?: string[]; data?: string; transactionHash?: string; blockNumber?: string; removed?: boolean };
    let found: Log | null = null;
    let chunks = 0;
    let span = LOG_CHUNK_BLOCKS;
    let hi = to;
    // newest first: the add happened moments before Neynar reported the approval. A node that refuses the range (many
    // public RPCs cap eth_getLogs) gets a smaller one, down to LOG_MIN_CHUNK_BLOCKS, never a skipped window.
    while (hi >= from && !found && chunks < LOG_MAX_CHUNKS) {
      const lo = Math.max(from, hi - span + 1);
      let logs: Log[] | null;
      try {
        logs = (await rpc("eth_getLogs", [{ address: KEY_REGISTRY, topics, fromBlock: toHex(lo), toBlock: toHex(hi) }])) as Log[] | null;
      } catch (e) {
        if (e instanceof ConnectError && e.code === "rpc_error" && span > LOG_MIN_CHUNK_BLOCKS && /range|limit|exceed|too (many|large|big)|results|blocks/i.test(e.message)) {
          span = Math.max(LOG_MIN_CHUNK_BLOCKS, Math.floor(span / 4));
          continue;
        }
        throw e;
      }
      chunks++;
      if (!Array.isArray(logs)) throw new ConnectError("chain_unavailable", "eth_getLogs answered nothing readable", 503, true);
      const ok = logs.filter((l) => !l.removed && lc(l.address) === lc(KEY_REGISTRY) && lc(l.topics?.[0]) === KEY_ADD_TOPIC);
      if (ok.length) found = ok[ok.length - 1];
      hi = lo - 1;
    }
    if (!found && hi >= from) throw new ConnectError("chain_unavailable", "the key add could not be searched for in full (the RPC's range limit) — set FC_CONNECT_RPC_URL to a fuller node, or try again", 503, true);
    if (!found) return null;
    let keyBytes: string, metadataType: number, metadata: `0x${string}`;
    try {
      const d = decodeAbiParameters([{ type: "bytes" }, { type: "uint8" }, { type: "bytes" }], found.data as `0x${string}`);
      keyBytes = d[0];
      metadataType = Number(d[1]);
      metadata = d[2];
    } catch {
      throw new ConnectError("chain_mismatch", "the KeyRegistry Add event could not be decoded", 502);
    }
    if (lc(keyBytes) !== lc(i.publicKey)) throw new ConnectError("chain_mismatch", "the KeyRegistry Add event names another key", 502);
    let meta: { requestFid: bigint; requestSigner: string; deadline: bigint };
    try {
      const [m] = decodeAbiParameters(
        [{ type: "tuple", components: [{ name: "requestFid", type: "uint256" }, { name: "requestSigner", type: "address" }, { name: "signature", type: "bytes" }, { name: "deadline", type: "uint256" }] }],
        metadata
      );
      meta = m;
    } catch {
      throw new ConnectError("chain_mismatch", "the key's metadata could not be decoded as a SignedKeyRequest", 502);
    }
    const tx = (await rpc("eth_getTransactionByHash", [found.transactionHash])) as { from?: string; to?: string | null } | null;
    if (!tx || !HEX40.test(String(tx.from ?? ""))) throw new ConnectError("chain_unavailable", "the key add's transaction could not be read", 503, true);
    const hexNum = (v: unknown): number => (typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v) ? Number(BigInt(v)) : -1);
    return {
      txHash: String(found.transactionHash),
      blockNumber: hexNum(found.blockNumber),
      from: lc(tx.from),
      to: tx.to ? lc(tx.to) : null,
      requestFid: Number(meta.requestFid),
      requestSigner: lc(meta.requestSigner),
      deadline: Number(meta.deadline),
      keyType: hexNum(found.topics?.[2]),
      metadataType,
    };
  },
};

// FIXTURE — the laptop rig's network: no request leaves the process. A rig suite approves a request with
// fixtureApprove (optionally as the wrong account, or with a doctored chain fact, for the negative cases).
interface FixtureSigner {
  status: string;
  fid: number | null;
  publicKey: string;
  appFid: number | null;
  deadline: number | null;
  chain?: { requestFid?: number; submittedBy?: string; requestSigner?: string } | null;
}
const gf = globalThis as unknown as { __layersConnectFixture?: Map<string, FixtureSigner> };
gf.__layersConnectFixture ??= new Map();

function fixtureAddressOf(fid: number): string {
  return ("0x" + keccak256(toBytes("layers-fixture-custody/" + fid)).slice(-40)).toLowerCase();
}

const fixtureNetwork: ConnectNetwork = {
  async lookupUser(q) {
    const named: Record<string, { fid: number; displayName: string }> = {
      [FIXTURE_MAIN.username]: { fid: FIXTURE_MAIN.fid, displayName: "Fixture Main" },
      [FIXTURE_OTHER.username]: { fid: FIXTURE_OTHER.fid, displayName: "Fixture Other" },
      "fixture-connector": { fid: FIXTURE_APP_FID, displayName: "Fixture Connector" },
    };
    let fid: number;
    let username: string;
    let displayName: string;
    if (q.fid !== undefined) {
      fid = q.fid;
      const hit = Object.entries(named).find(([, v]) => v.fid === fid);
      username = hit ? hit[0] : "fid" + fid;
      displayName = hit ? hit[1].displayName : "Fixture " + fid;
    } else {
      // "fxmain-<suffix>" is a fresh fixture main per rig run (kept although a resetSeed now unmakes the minted persona —
      // UXC-13 — so suites never depend on reset ordering); an fname is at most 16 characters, so the suffix is at most 8
      const run = /^fxmain-([a-z0-9]{1,8})$/.exec(q.username ?? "");
      const hit = named[q.username ?? ""] ?? (run ? { fid: 9_200_100 + (parseInt(run[1], 36) % 790_000), displayName: "Fixture Main " + run[1] } : undefined);
      if (!hit) return null;
      fid = hit.fid;
      username = q.username!;
      displayName = hit.displayName;
    }
    const custody = fid === FIXTURE_APP_FID ? privateKeyToAccount(FIXTURE_APP_KEY).address.toLowerCase() : fixtureAddressOf(fid);
    return { fid, username, displayName, pfpUrl: null, bio: "fixture account", custodyAddress: custody, verifiedAddresses: [] };
  },
  async createSigner() {
    const uuid = "fixture-" + toHex(globalThis.crypto.getRandomValues(new Uint8Array(12))).slice(2);
    const publicKey = toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    gf.__layersConnectFixture!.set(uuid, { status: "generated", fid: null, publicKey, appFid: null, deadline: null });
    return { signerUuid: uuid, publicKey };
  },
  async registerSignedKey(i) {
    const s = gf.__layersConnectFixture!.get(i.signerUuid);
    if (!s) throw new ConnectError("signed_key_failed", "Neynar refused the key request (fixture: unknown signer)", 502);
    const custody = await fixtureNetwork.custodyOf(i.appFid);
    const signer = await recoverTypedDataAddress({
      domain: SIGNED_KEY_REQUEST_DOMAIN,
      types: SIGNED_KEY_REQUEST_TYPES,
      primaryType: "SignedKeyRequest",
      message: { requestFid: BigInt(i.appFid), key: s.publicKey as `0x${string}`, deadline: BigInt(i.deadline) },
      signature: i.signature as `0x${string}`,
    });
    // the same refusal Neynar answers when the signature is not by custodyOf(app_fid)
    if (lc(signer) !== lc(custody)) throw new ConnectError("signed_key_failed", "Neynar refused the key request (400: requestSigner does not match app custody address)", 502);
    s.status = "pending_approval";
    s.appFid = i.appFid;
    s.deadline = i.deadline;
    const token = toHex(globalThis.crypto.getRandomValues(new Uint8Array(12)));
    return { approvalUrl: "https://client.farcaster.xyz/deeplinks/signed-key-request?token=" + token, status: "pending_approval", publicKey: s.publicKey };
  },
  async lookupSigner(uuid) {
    const s = gf.__layersConnectFixture!.get(uuid);
    if (!s) throw new ConnectError("signer_lookup_failed", "the signer could not be read (fixture: unknown signer)", 502, true);
    return { status: s.status, fid: s.fid, publicKey: s.publicKey };
  },
  async custodyOf(fid) {
    if (fid === FIXTURE_APP_FID) return privateKeyToAccount(FIXTURE_APP_KEY).address;
    return "0x0000000000000000000000000000000000000000";
  },
  async findKeyAdd(i) {
    for (const [uuid, s] of gf.__layersConnectFixture!) {
      if (s.status !== "approved" || s.fid !== i.fid || lc(s.publicKey) !== lc(i.publicKey)) continue;
      return {
        txHash: keccak256(toBytes("fixture-key-add/" + uuid)),
        blockNumber: 1,
        from: lc(s.chain?.submittedBy ?? FARCASTER_RELAYER),
        to: lc(KEY_GATEWAY),
        requestFid: s.chain?.requestFid ?? s.appFid ?? 0,
        requestSigner: lc(s.chain?.requestSigner ?? privateKeyToAccount(FIXTURE_APP_KEY).address),
        deadline: s.deadline ?? 0,
        keyType: 1,
        metadataType: 1,
      };
    }
    return null;
  },
};

function networkFor(mode: ConnectMode): ConnectNetwork {
  return mode === "live" ? liveNetwork : fixtureNetwork;
}

// ------------------------------------------------------------------------------------------------- helpers

/** "@name", "name", "name.eth" or a fid → the lookup */
export function parseMainInput(raw: string): { username: string } | { fid: number } {
  const s = String(raw ?? "").trim().replace(/^@/, "").toLowerCase();
  if (/^[1-9][0-9]{0,11}$/.test(s)) return { fid: Number(s) };
  if (/^[a-z0-9][a-z0-9-]{0,15}$/.test(s) || /^[a-z0-9][a-z0-9-]{0,62}(\.[a-z0-9-]{1,63})*\.eth$/.test(s)) return { username: s };
  throw new ConnectError("bad_handle", "Type your Farcaster username (like alice, or alice.eth) or your fid.", 400);
}

/** the approval link Neynar returned, validated against the forms Farcaster uses — never an arbitrary href on the page */
export function parseApprovalUrl(raw: string): { url: string; token: string; appLink: string } {
  let u: URL;
  try {
    u = new URL(String(raw));
  } catch {
    throw new ConnectError("bad_approval_url", "Neynar returned an approval link that is not a URL", 502, true);
  }
  const token = u.searchParams.get("token") ?? "";
  if (!/^0x[0-9a-fA-F]{8,256}$/.test(token)) throw new ConnectError("bad_approval_url", "Neynar returned an approval link without a valid token", 502, true);
  const https = u.protocol === "https:" && ["client.farcaster.xyz", "client.warpcast.com"].includes(u.hostname) && u.pathname === "/deeplinks/signed-key-request";
  const custom = u.protocol === "farcaster:" && (u.hostname === "signed-key-request" || u.pathname.replace(/^\/+/, "") === "signed-key-request");
  if (!https && !custom) throw new ConnectError("bad_approval_url", "Neynar returned an approval link to an unexpected place — refused", 502, true);
  const url = https ? u.toString() : "https://client.farcaster.xyz/deeplinks/signed-key-request?token=" + token;
  return { url, token, appLink: "farcaster://signed-key-request?token=" + token };
}

/** FC_LAYERS_ADDRESSES: Totem-controlled addresses (comma-separated; the developer's Neynar App Wallet first) — the
 *  connector's custody may never be one, and no key add Totem accepts may have been submitted by one */
function layersAddresses(): Set<string> {
  return new Set(
    (process.env.FC_LAYERS_ADDRESSES ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => HEX40.test(s))
  );
}

function relayers(): Set<string> {
  const raw = (process.env.FC_CONNECT_RELAYERS ?? "").trim();
  const list = raw ? raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => HEX40.test(s)) : [FARCASTER_RELAYER];
  return new Set(list);
}

function personaHandleFor(username: string): string {
  const h = username.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
  return h || "main";
}

async function handleTaken(handle: string): Promise<boolean> {
  const { listPersonas } = await import("@/lib/identity/keystore");
  if (listPersonas().some((p) => p.handle.toLowerCase() === handle)) return true;
  const { personaByHandle } = await import("@/lib/adapters/mock/store");
  return personaByHandle.has(handle);
}

const gs = globalThis as unknown as { __layersConnectQueue?: Promise<unknown> };
/** one connect step at a time in this process: a poll and a finish racing must never mint or record twice */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const prev = gs.__layersConnectQueue ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  gs.__layersConnectQueue = next.catch(() => undefined);
  return next;
}

function openGate(): ConnectMode {
  const gate = connectGate();
  if (!gate.ok) throw new ConnectError(gate.code, gate.reason, gate.status);
  return gate.mode;
}

function sessionView(s: ConnectSession): ConnectSessionView {
  const now = Math.floor(Date.now() / 1000);
  const live = s.stage === "pending_approval" && now < s.deadline;
  return {
    id: s.id,
    mode: s.mode,
    stage: s.stage === "pending_approval" && now >= s.deadline ? "expired" : s.stage,
    expectedFid: s.expectedFid,
    expectedUsername: s.expectedUsername,
    displayName: s.displayName,
    pfpUrl: s.pfpUrl,
    appFid: s.appFid,
    appUsername: s.appUsername,
    deadline: s.deadline,
    sponsored: s.sponsored,
    createdAt: s.createdAt,
    approvedFid: s.approvedFid,
    note: s.stage === "pending_approval" && now >= s.deadline ? "The request expired before it was approved. Start again." : s.note,
    approval: live ? { url: s.approvalUrl, appLink: "farcaster://signed-key-request?token=" + s.approvalToken, qr: qrSvgPath(s.approvalUrl) } : null,
  };
}

// ------------------------------------------------------------------------------------------------- the steps

/** GET: where things stand. Never a secret: no signer uuid, no key, nothing but the owner's own public facts.
 *  CONNECT MAIN review (UXC-02): on the live network a connected main's signer is asked about on every read (GET
 *  /v2/farcaster/signer, 0 credits) — the page tells the owner he can remove Totem in the Farcaster app at any time,
 *  and when he has, the record is marked (reason "revoked_in_app") so this page and the composer stop saying Totem
 *  can post as him. A signer that cannot be asked just now is reported as unknown, never as fine. */
export async function connectStatus(): Promise<ConnectStatusView> {
  const gate = connectGate();
  if (!gate.ok) return { available: false, code: gate.code, reason: gate.reason, mode: null, connector: null, connected: null, session: null };
  const conn = await connectorFor(gate.mode);
  let records = await connectedRecords();
  let signerCheck: ConnectedView["signerCheck"] = null;
  const live = records[0] ?? null;
  if (gate.mode === "live" && live && live.mode === "live" && !live.connected?.disconnectedAt && live.signer.kind === "neynar-managed" && live.signer.uuid) {
    try {
      const st = await networkFor("live").lookupSigner(live.signer.uuid);
      if (st.status === "revoked") {
        await disconnectConnectedFid(live.personaId, "revoked_in_app");
        records = await connectedRecords();
        signerCheck = "revoked";
      } else signerCheck = st.status === "approved" && st.fid === live.fid ? "approved" : "unknown";
    } catch {
      signerCheck = "unknown"; // could not ask: the page says so; nothing is changed on a guess
    }
  }
  const main = records[0] ?? null;
  let handle: string | null = null;
  if (main) {
    try {
      const { getPersona } = await import("@/lib/identity/keystore");
      handle = getPersona(main.personaId)?.handle ?? null;
    } catch {
      handle = null;
    }
  }
  const session = await connectSession();
  return {
    available: true,
    code: null,
    reason: null,
    mode: gate.mode,
    connector: conn.ok
      ? { configured: true, appFid: conn.c.appFid, fixture: conn.c.fixture, source: conn.c.source, setup: conn.setup, reason: null }
      : { configured: false, appFid: null, fixture: false, source: null, setup: conn.setup, reason: conn.reason },
    connected: main
      ? {
          personaId: main.personaId,
          handle,
          fid: main.fid,
          fname: main.fname,
          requestFid: main.connected?.requestFid ?? null,
          mode: main.mode,
          verifiedAt: main.connected?.verifiedAt ?? null,
          disconnected: !!main.connected?.disconnectedAt,
          removedInApp: !!main.connected?.disconnectedAt && main.connected?.disconnectReason === "revoked_in_app",
          signerCheck,
        }
      : null,
    session: session && session.mode === gate.mode ? sessionView(session) : null,
  };
}

/** START: resolve main, refuse every linking configuration, create the signer, sign and register the key request. */
export function startConnect(input: { handle: string }): Promise<ConnectStatusView> {
  return serialized(async () => {
    const mode = openGate();
    const conn = await connectorFor(mode);
    if (!conn.ok) throw new ConnectError("connector_unconfigured", conn.reason, 409);
    const C = conn.c;
    const net = networkFor(mode);
    const q = parseMainInput(input.handle);

    // never abandon a request the owner may already have approved: ask the network about it first
    const existing = await connectSession();
    if (existing && existing.mode === mode && (existing.stage === "pending_approval" || existing.stage === "approved")) {
      const st = await net.lookupSigner(existing.signerUuid);
      if (st.status === "approved")
        throw new ConnectError("approved_pending_finish", "Your earlier request was already approved in the Farcaster app — reload this page to finish it, rather than starting another.", 409);
    }

    const prior = await connectedRecords();
    if (prior.length > 1) throw new ConnectError("corrupted", "This vault holds more than one connected account — refusing to add another.", 409);

    const main = await net.lookupUser(q);
    if (!main) throw new ConnectError("no_such_account", "username" in q ? `There is no Farcaster account named @${q.username}.` : `There is no Farcaster account with fid ${q.fid}.`, 404);
    const M = main.fid;
    let rearmPersona: string | null = null;
    if (prior[0]) {
      if (prior[0].fid !== M) throw new ConnectError("other_main_connected", `Another account (@${prior[0].fname ?? prior[0].fid}) is already your connected main account — Totem keeps one per root.`, 409);
      if (!prior[0].connected?.disconnectedAt) throw new ConnectError("already_connected", `@${main.username} is already connected.`, 409);
      rearmPersona = prior[0].personaId; // reconnecting the same account after a disconnect keeps its persona
    }

    const records = await allPersonaFids();
    // PUB-8 / PL-2: the anonymous account is one of the owner's other accounts too — named by FC_ANON_FID, or by the
    // validator's live relay config; while it cannot be named the connection is refused, never guessed
    let anonFid: number | null;
    try {
      anonFid = await anonAccountFid();
    } catch (e) {
      throw new ConnectError("own_accounts_unknown", (e as Error).message + " — nothing was started.", 503, true);
    }
    const never = neverMainFids(records, anonFid);
    if (never.has(M))
      throw new ConnectError("main_is_own_account", `fid ${M} is one of your other accounts (a persona's, the shared test account, or the anon account) — it can never be your main account.`, 403);
    // CONNECTOR SETUP: the refusals name what holds C — the environment variables, or the account this service created
    const cName = C.source === "sealed" ? `the connector account this service created (fid ${C.appFid})` : "FC_CONNECT_APP_FID";
    if (C.appFid === M) throw new ConnectError("connector_is_main", `${cName} is your main account itself — the connector must be a separate account.`, 409);
    if (never.has(C.appFid) || SYSTEM_FIDS.includes(C.appFid))
      throw new ConnectError("connector_refused", `The connector fid ${C.appFid} is one of your other accounts (or a system account) — main's key request would link them onchain. Use a connector that nothing else uses.`, 409);

    // the connector's custody: the configured key must be custodyOf(C) onchain, and must share nothing with main,
    // the personas or the App Wallet
    const custody = await net.custodyOf(C.appFid);
    if (lc(custody) !== lc(C.address))
      throw new ConnectError(
        "connector_key_mismatch",
        C.source === "sealed"
          ? `The key this service holds for the connector (fid ${C.appFid}) is no longer that account's custody onchain (its custody is ${custody}) — the account was moved or recovered elsewhere. Tell Claude; nothing was started.`
          : `FC_CONNECT_APP_CUSTODY_KEY is not the custody key of fid ${C.appFid} (its custody is ${custody}).`,
        409
      );
    if (lc(C.address) === lc(main.custodyAddress) || main.verifiedAddresses.includes(lc(C.address)))
      throw new ConnectError("connector_shares_main_wallet", "The connector's custody address is your main account's custody or verified address — they would be linked onchain.", 409);
    if (layersAddresses().has(lc(C.address)) || records.some((r) => lc(r.custodyAddress) === lc(C.address)))
      throw new ConnectError("connector_shares_layers_wallet", "The connector's custody address is the Totem App Wallet or a persona's custody address — refused.", 409);

    // the connector's public name is on the approval screen and on every client: it must not say Totem.
    // CONNECT MAIN review (PL-5): a connector Neynar returns no readable profile for (not indexed yet, or malformed) is
    // REFUSED before any signer exists — its name cannot be checked, and never fail open — and the bio is checked too
    const appUser = await net.lookupUser({ fid: C.appFid });
    if (!appUser)
      throw new ConnectError(
        "connector_unreadable",
        `Farcaster (through Neynar) returns no readable profile for the connector fid ${C.appFid} yet, so Totem can't check its name — nothing was started. Try again once the account shows up on Farcaster.`,
        503,
        true
      );
    if (/layers|totem/i.test(appUser.username + " " + (appUser.displayName ?? "") + " " + (appUser.bio ?? "")))
      throw new ConnectError("connector_named_layers", `The connector account (@${appUser.username}) mentions Totem in its name or bio — anyone could then tie your main account to this app's personas. Make its profile neutral first.`, 409);

    if (!rearmPersona) {
      const handle = personaHandleFor(main.username);
      if (await handleTaken(handle))
        throw new ConnectError("handle_taken", `One of your personas already uses the handle @${handle}. A persona's handle must never derive from your main account's name — rename that persona first.`, 409);
    }
    // CONNECT MAIN review (PL-4): the stem rule between main's name and EVERY persona of this device, both directions
    // (a persona "jordan" beside main "jordan.eth", or "jordan2" beside "jordan") — matching names are a public link
    // that no onchain care undoes. The persona re-armed for main itself is main's own, so it is left out.
    {
      const { listPersonas } = await import("@/lib/identity/keystore");
      const clash = listPersonas().find((p) => p.id !== rearmPersona && derivedFromMain(p.handle, main.username));
      if (clash)
        throw new ConnectError(
          "handle_stem",
          `Your persona @${clash.handle} shares a name stem with @${main.username} — matching names would publicly link that persona to your main account. Rename the persona first, then connect.`,
          409
        );
    }

    const signer = await net.createSigner();
    const deadline = Math.floor(Date.now() / 1000) + CONNECT_DEADLINE_SECONDS;
    const signature = await C.signKeyRequest(signer.publicKey, deadline);
    // self-check before Neynar sees it: the signature must recover to C's custody
    const recovered = await recoverTypedDataAddress({
      domain: SIGNED_KEY_REQUEST_DOMAIN,
      types: SIGNED_KEY_REQUEST_TYPES,
      primaryType: "SignedKeyRequest",
      message: { requestFid: BigInt(C.appFid), key: signer.publicKey as `0x${string}`, deadline: BigInt(deadline) },
      signature: signature as `0x${string}`,
    });
    if (lc(recovered) !== lc(C.address)) throw new ConnectError("signature_self_check", "The key request signature did not verify against the connector's custody — refused before sending.", 500);
    const sponsored = mode === "live" && (process.env.FC_CONNECT_SPONSOR ?? "neynar").trim().toLowerCase() !== "none";
    const reg = await net.registerSignedKey({ signerUuid: signer.signerUuid, appFid: C.appFid, deadline, signature, sponsored });
    if (reg.publicKey && lc(reg.publicKey) !== lc(signer.publicKey)) throw new ConnectError("signer_mismatch", "Neynar's answer names a different key than the one requested — refused.", 502);
    const approval = parseApprovalUrl(reg.approvalUrl);

    const session: ConnectSession = {
      id: toHex(globalThis.crypto.getRandomValues(new Uint8Array(16))).slice(2),
      mode,
      stage: "pending_approval",
      expectedFid: M,
      expectedUsername: main.username,
      displayName: main.displayName,
      pfpUrl: main.pfpUrl,
      bio: main.bio,
      custodyAddress: lc(main.custodyAddress),
      appFid: C.appFid,
      appCustody: lc(C.address),
      appUsername: appUser?.username ?? null,
      signerUuid: signer.signerUuid,
      signerPublicKey: signer.publicKey,
      approvalToken: approval.token,
      approvalUrl: approval.url,
      deadline,
      sponsored,
      createdAt: Date.now(),
      approvedFid: null,
      approvedAt: null,
      personaId: rearmPersona,
      note: null,
    };
    await putConnectSession(session);
    return connectStatus();
  });
}

async function pollInner(mode: ConnectMode, s: ConnectSession): Promise<ConnectSession> {
  if (s.stage !== "pending_approval") return s;
  const st = await networkFor(mode).lookupSigner(s.signerUuid);
  const now = Math.floor(Date.now() / 1000);
  let next: ConnectSession = s;
  if (st.status === "approved") {
    if (st.fid === s.expectedFid) next = { ...s, stage: "approved", approvedFid: st.fid, approvedAt: Date.now(), note: null };
    else
      next = {
        ...s,
        stage: "wrong_account",
        approvedFid: st.fid,
        note: `That approval came from ${st.fid ? "fid " + st.fid : "another account"}, not @${s.expectedUsername} — nothing was saved. In that account's Farcaster settings, remove @${s.appUsername ?? "fid " + s.appFid} from its connected apps, then start again while the app is logged in as @${s.expectedUsername}.`,
      };
  } else if (st.status === "revoked")
    // CONNECT MAIN review (UXC-10): a DECLINE is never reported (Farcaster's request stays "pending" until it expires —
    // the pending card says to press Cancel); "revoked" is a key that was approved and then removed
    next = { ...s, stage: "revoked", note: "The approval was revoked in the Farcaster app. Start again to retry." };
  else if (now >= s.deadline) next = { ...s, stage: "expired", note: "The request expired before it was approved. Start again." };
  if (next !== s) await putConnectSession(next);
  return next;
}

/** POLL: one look at the signer (0 credits). */
export function pollConnect(sessionId: string): Promise<ConnectStatusView> {
  return serialized(async () => {
    const mode = openGate();
    const s = await connectSession();
    if (!s || s.id !== sessionId) throw new ConnectError("no_session", "That connection is not in progress (it finished, was cancelled, or another one replaced it).", 404);
    if (s.mode !== mode) throw new ConnectError("mode_changed", "That connection belongs to another network mode.", 409);
    await pollInner(mode, s);
    return connectStatus();
  });
}

/** the chain fact must say exactly what was asked for — anything else refuses (and records nothing) */
function assertKeyAddMatches(fact: KeyAddFact, s: ConnectSession): void {
  const bad = (why: string): never => {
    throw new ConnectError("chain_mismatch", "The onchain key add does not match the request: " + why + ". Nothing was recorded.", 409);
  };
  if (fact.keyType !== 1) bad("key type " + fact.keyType);
  if (fact.metadataType !== 1) bad("metadata type " + fact.metadataType);
  if (fact.requestFid !== s.appFid) bad(`requestFid is ${fact.requestFid}, not the connector ${s.appFid}`);
  if (lc(fact.requestSigner) !== lc(s.appCustody)) bad("requestSigner is not the connector's custody");
  if (fact.deadline !== s.deadline) bad("the signed deadline differs");
  const from = lc(fact.from);
  if (layersAddresses().has(from) || from === lc(s.appCustody)) bad("it was submitted by a Totem address");
  if (!relayers().has(from)) bad(`it was submitted by ${from}, not Farcaster's relayer (set FC_CONNECT_RELAYERS if Farcaster rotated it)`);
}

async function mintMainPersona(s: ConnectSession): Promise<string> {
  const { createPersona, listPersonas, FIXTURE_CONNECT_NONCE_PREFIX } = await import("@/lib/identity/keystore");
  // deterministic from the session: a finish retried after a crash finds the persona the first attempt minted. A FIXTURE
  // connection's persona carries a recognisable nonce prefix, so a seed reset unmakes it like a fork's
  // (CONNECT MAIN review UXC-13: lib/adapters/mock/store.ts resetState → purgeFixtureConnectPersonas). A live one never
  // carries it, and resetSeed is refused on the owner service anyway.
  const nonce = (s.mode === "fixture" ? FIXTURE_CONNECT_NONCE_PREFIX : "") + keccak256(toBytes("layers-connect-main/v1|" + s.id)).slice(2, 34);
  let persona = listPersonas().find((p) => p.nonce === nonce) ?? null;
  if (!persona) {
    try {
      persona = createPersona({
        name: (s.displayName ?? "").trim().slice(0, 50) || s.expectedUsername,
        handle: personaHandleFor(s.expectedUsername),
        kind: "public",
        avatarUrl: s.pfpUrl && /^https:\/\//.test(s.pfpUrl) ? s.pfpUrl : null,
        bio: s.bio ? s.bio.slice(0, 500) : null,
        cluster: null,
        nonce,
        forkedFrom: null,
      });
    } catch (e) {
      throw new ConnectError("persona_mint_failed", "Your main account's persona could not be created on this device (" + String((e as Error)?.message ?? "keystore error").slice(0, 160) + ") — trying again finishes it.", 500, true);
    }
  }
  await putConnectSession({ ...s, personaId: persona.id });
  return persona.id;
}

/** the sealed roster: recovery from the 24 words brings main's persona back. Run on EVERY finish (idempotent), so a
 *  retry after a failed flush still seals it — a loud flush, since a lost write is a lost persona. */
async function sealRoster(): Promise<void> {
  try {
    const { syncRoster } = await import("@/lib/identity/roster");
    await syncRoster();
  } catch (e) {
    throw new ConnectError("roster_unavailable", "Your main account's persona was created, but the recovery roster could not be sealed (" + String((e as Error)?.message ?? "").slice(0, 120) + ") — trying again finishes it.", 503, true);
  }
}

/** FINISH: re-read the approval, read the chain, mint main's persona, record. Retry-safe at every step. */
export function finishConnect(sessionId: string): Promise<ConnectStatusView> {
  return serialized(async () => {
    const mode = openGate();
    let s = await connectSession();
    if (!s || s.id !== sessionId) throw new ConnectError("no_session", "That connection is not in progress.", 404);
    if (s.mode !== mode) throw new ConnectError("mode_changed", "That connection belongs to another network mode.", 409);
    s = await pollInner(mode, s);
    if (s.stage === "pending_approval") throw new ConnectError("not_approved_yet", "Not approved yet — approve the request in the Farcaster app first.", 409, true);
    if (s.stage !== "approved") throw new ConnectError("not_approved", s.note ?? "This request was not approved.", 409);
    const net = networkFor(mode);

    // 1. the approval, re-read — never trusted from the earlier poll
    const st = await net.lookupSigner(s.signerUuid);
    if (st.status !== "approved" || st.fid !== s.expectedFid) {
      if (st.status === "revoked") await putConnectSession({ ...s, stage: "revoked", note: "The approval was revoked in the Farcaster app." });
      throw new ConnectError("not_approved", `The signer is no longer approved for @${s.expectedUsername} (status ${st.status}).`, 409);
    }
    if (st.publicKey && lc(st.publicKey) !== lc(s.signerPublicKey)) {
      await stopRefused(s, "The approved signer names a different key than the one requested — nothing was recorded.");
      throw new ConnectError("signer_mismatch", "The approved signer names a different key — refused.", 409);
    }

    // 2. the chain: main's KeyRegistry add for exactly this key, requested by the connector, submitted by the relayer
    const fact = await net.findKeyAdd({ fid: s.expectedFid, publicKey: s.signerPublicKey, sinceMs: s.createdAt, deadline: s.deadline });
    if (!fact) throw new ConnectError("not_on_chain_yet", "The approval is not visible onchain yet — this usually takes a few seconds. Trying again.", 503, true);
    try {
      assertKeyAddMatches(fact, s);
    } catch (e) {
      // DEFINITIVE: a retry would read the same chain. The session stops here (so a new start is possible), and the
      // owner is told to remove the key that did land on main.
      await stopRefused(s, (e as Error).message);
      throw e;
    }

    // 3. main's persona: minted for this connection (or re-armed after a disconnect), public, keystore-rooted — and
    //    sealed into the recovery roster before anything is recorded against it
    const personaId = s.personaId ?? (await mintMainPersona(s));
    await sealRoster();

    // 4. the record — recordConnectedFid re-checks everything it can and clears the session in the same seal
    try {
      await recordConnectedFid({
        personaId,
        fid: s.expectedFid,
        fname: s.expectedUsername || null,
        custodyAddress: s.custodyAddress,
        signerUuid: s.signerUuid,
        signerPublicKey: s.signerPublicKey,
        approvedStatus: st.status,
        approvedFid: st.fid,
        requestFid: fact.requestFid,
        requestSigner: fact.requestSigner,
        keyAddTx: fact.txHash,
        submittedBy: fact.from,
        approvedAt: s.approvedAt ?? Date.now(),
        sessionStartedAt: s.createdAt,
        mode,
      });
    } catch (e) {
      if (e instanceof ConnectRecordRefusal) {
        await stopRefused(s, e.message);
        throw new ConnectError("record_refused", e.message, 409);
      }
      throw e;
    }
    return connectStatus();
  });
}

/** a definitive refusal after the owner approved: stop the session honestly (a key did land on main) */
async function stopRefused(s: ConnectSession, why: string): Promise<void> {
  const current = (await connectSession()) ?? s;
  if (current.id !== s.id) return;
  await putConnectSession({
    ...current,
    stage: "refused",
    note: `${why} In the Farcaster app logged in as @${s.expectedUsername}, remove @${s.appUsername ?? "fid " + s.appFid} from Settings → Connected apps, then start again.`,
  });
}

/** CANCEL: drop a request that was not approved (an approved one must be finished, or removed in the Farcaster app). */
export function cancelConnect(sessionId: string): Promise<ConnectStatusView> {
  return serialized(async () => {
    const mode = openGate();
    const s = await connectSession();
    if (!s || s.id !== sessionId) throw new ConnectError("no_session", "That connection is not in progress.", 404);
    if (s.mode !== mode) throw new ConnectError("mode_changed", "That connection belongs to another network mode.", 409);
    if (s.stage === "pending_approval" || s.stage === "approved") {
      // never drop a request the owner already approved: its key would sit on main with nothing here to use it
      const st = await networkFor(mode).lookupSigner(s.signerUuid);
      if (st.status === "approved" && st.fid === s.expectedFid)
        throw new ConnectError("approved_pending_finish", "This request was already approved — finish it, or remove the connection in the Farcaster app.", 409);
    }
    await putConnectSession(null);
    return connectStatus();
  });
}

/** DISCONNECT: Totem forgets main's signer and refuses every write as main; the guard keeps main apart regardless.
 *  Only the Farcaster app can remove the key itself (Settings → Connected apps). */
export function disconnectMain(confirm: string): Promise<ConnectStatusView> {
  return serialized(async () => {
    openGate();
    if (confirm !== "DISCONNECT") throw new ConnectError("confirm_required", 'Type DISCONNECT to confirm.', 400);
    const main = (await connectedRecords())[0];
    if (!main) throw new ConnectError("not_connected", "No main account is connected.", 404);
    await disconnectConnectedFid(main.personaId);
    return connectStatus();
  });
}

/** RIG ONLY (fixture network): approve a pending request as if the owner scanned it — optionally as the wrong account,
 *  or with a doctored chain fact, so a suite can drive every refusal. Refused everywhere the live network runs. */
export function fixtureApprove(input: { sessionId: string; fid?: number; status?: string; requestFid?: number; submittedBy?: string; requestSigner?: string }): Promise<ConnectStatusView> {
  return serialized(async () => {
    const mode = openGate();
    if (mode !== "fixture" || process.env.ZK_DEV_HOOKS !== "true") throw new ConnectError("rig_only", "fixtureApprove is a rig action.", 403);
    const s = await connectSession();
    if (!s || s.id !== input.sessionId) throw new ConnectError("no_session", "That connection is not in progress.", 404);
    const f = gf.__layersConnectFixture!.get(s.signerUuid);
    if (!f) throw new ConnectError("no_session", "The fixture signer is gone (the process restarted).", 404);
    f.status = input.status ?? "approved";
    f.fid = f.status === "approved" ? input.fid ?? s.expectedFid : null;
    f.chain = { requestFid: input.requestFid, submittedBy: input.submittedBy, requestSigner: input.requestSigner };
    return connectStatus();
  });
}

/** resetSeed / tests: forget the fixture network's signers */
export function resetConnectFixture(): void {
  gf.__layersConnectFixture = new Map();
}

// ------------------------------------------------------------------------------------------------- QR
// PERSONA LAUNCH P1 (SIWF) Gate 1a: the encoder moved verbatim to lib/qr.ts (one copy for connect, Sign in with
// Farcaster and the later friend drop); re-exported here so every existing caller and test:connect stay unchanged.
export { qrMatrix, qrSvgPath } from "@/lib/qr";
