import "server-only";
// PERSONA LAUNCH P1 (SIWF) Gate 1c: SIGN IN WITH FARCASTER, THE FLOW. research/spec-siwf-passkey-first-2026-10-08.txt.
//
// WHAT IT IS: identity, not custody. A verified sign-in proves "the human in this tab controls fid M right now" and
// binds M to this tab's ROOT as one sealed record (./links.ts) plus a read-only "public self" persona in the keystore
// (publicSelf: true). It saves nothing: a passkey saves the identity (D-CU-0-6), so the card says so and the Save
// moment fires right after a sign-in.
//
// WHERE IT RUNS (siwfGate):
//   - the BROWSER DEVICE (the public site, and the rig's /device page): the whole flow, in the tab. It creates the
//     relay channel, shows the QR, polls, verifies (./verify.ts) and checks the chain with eth_call FROM THE BROWSER,
//     through the UNPATCHED fetch (window.__layersOrigFetch) with credentials "omit" and referrerPolicy
//     "no-referrer". The Totem app server receives nothing (the route refuses a server request on a public deployment
//     before reading its body); the validator receives one sealed, padded PUT every device makes anyway.
//   - the RIG's server (ZK_DEV_HOOKS=true, no owner secret): the FIXTURE network only, so suites can drive it over
//     plain HTTP. The fixture relay and fixture chain are in-process stand-ins: no request leaves the process.
//   - the OWNER SERVICE: not offered ("Use Settings > Connect your Farcaster account on this service").
//   - a PUBLIC server: device_only (the route answers 404 before the body is read).
//
// THE DEVICE ENV IS PAGE-SETTABLE (A-SIWF-PAGE-IS-THE-DEVICE): the relay and RPC overrides are honoured only as the
// default, an http(s) LOOPBACK URL, or (RPC only) a bare https origin; anything carrying userinfo, a query, a fragment
// or a path is refused BY NAME (one log line "[siwf] bad_config (NAME)") and no request is made. A keyed provider URL
// can therefore never sit in the page. On a hosted platform the SERVER forwards no override at all (siwfDeviceHints).
//
// SESSION: process memory only (globalThis), never persisted: an unsaved identity dies with the tab anyway, and a
// saved one simply starts again. The channel token, the signed message and the signature live here only, and only
// until the sign-in is verified or refused. Steps run one at a time (serialized), like lib/fc/connect.ts.
//
// FIXED SENTENCES: every error is one of SENTENCES below. No token, signature, message, address or upstream text is
// ever placed in an error, a view or a log line (scripts/unit-siwf.mjs U7).
import { createSiweMessage } from "viem/siwe";
import { decodeFunctionData, encodeFunctionResult, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { qrSvgPath } from "@/lib/qr";
import { createHash } from "@/lib/platform/crypto";
import { isHostedPlatform, isPublicDeployment, ownerSecretProblem } from "@/lib/platform/env-contract";
import { isEmptyWorld } from "@/lib/world-flag";
import { derivedFromMain } from "@/lib/identity/handleStem";
import {
  ID_REGISTRY,
  ID_REGISTRY_ABI,
  KEY_REGISTRY,
  KEY_REGISTRY_ABI,
  SIWF_CHAIN_ID,
  SIWF_STATEMENT,
  SiwfRpcError,
  SiwfVerifyError,
  VERIFY_SENTENCES,
  verifySiwf,
  type SiwfRpc,
} from "./verify";
import type { AccountLink } from "./links";
import { liveUniverseHinted } from "@/lib/zk/anon/universe";

// ------------------------------------------------------------------------------------------------- constants

export const DEFAULT_RELAY_URL = "https://relay.farcaster.xyz";
export const DEFAULT_RPC_URL = "https://mainnet.optimism.io";
/** a sign-in request lives ten minutes (the relay keeps a channel an hour; ours ends first) */
export const SIWF_DEADLINE_MS = 10 * 60_000;
/** where the relay's sign-in link may point: the Farcaster app's web hosts (or its farcaster: scheme). VERIFY-YOURSELF
 *  on the first real run which host the relay returns today; widen THIS constant by name, never with a pattern. */
export const SIWF_LINK_HOSTS: readonly string[] = ["farcaster.xyz", "www.farcaster.xyz", "client.farcaster.xyz", "warpcast.com", "www.warpcast.com"];
/** the keystore nonce of the persona minted for a signed-in account: deterministic, so a retried finish never mints twice */
export const SIWF_PERSONA_NONCE = (fid: number) => "siwf-main/v1|" + fid;
const OFF = new Set(["off", "false", "0", "no", "disabled"]);
const RELAY_TIMEOUT_MS = 10_000;

// FIXTURE: the rig's stand-in accounts. Their keys are PUBLIC constants by construction — they sign fixture
// sign-ins that reach nothing, and the fixture network exists only where siwfGate says "fixture".
export const FIXTURE_SIWF_MAIN = { fid: 9_200_001, username: "fixture-main", displayName: "Fixture Main" } as const;
export const FIXTURE_SIWF_OTHER = { fid: 9_200_002, username: "fixture-other", displayName: "Fixture Other" } as const;
const FIXTURE_ACCOUNTS: Record<number, { username: string; displayName: string }> = {
  [FIXTURE_SIWF_MAIN.fid]: FIXTURE_SIWF_MAIN,
  [FIXTURE_SIWF_OTHER.fid]: FIXTURE_SIWF_OTHER,
};
/** every fixture channel token starts with this, so a suite can grep any surface for a leaked token */
export const FIXTURE_TOKEN_PREFIX = "fixture-siwf-token-";
export const fixtureCustodyKey = (fid: number) => keccak256(toBytes("layers-fixture-siwf-custody/" + fid));
export const fixtureAuthKey = (fid: number) => keccak256(toBytes("layers-fixture-siwf-auth/" + fid));

// ------------------------------------------------------------------------------------------------- errors & sentences

export type SiwfCode =
  | "siwf_relay"
  | "siwf_url"
  | "siwf_message"
  | "siwf_signature"
  | "siwf_chain_unavailable"
  | "siwf_fid_mismatch"
  | "siwf_one_main"
  | "siwf_handle_stem"
  | "siwf_linked_device"
  | "siwf_seal"
  | "siwf_expired"
  | "siwf_links_unreadable"
  | "siwf_off"
  | "bad_config"
  | "owner"
  | "device_only"
  | "empty_world"
  | "rig_only"
  | "no_session"
  | "not_signed_in"
  | "confirm_required"
  | "bad_request";

export const SENTENCES: Record<SiwfCode, string> = {
  siwf_relay: "Farcaster's sign-in service did not answer. Try again in a moment.",
  siwf_url: "The sign-in link pointed somewhere unexpected, so it was not shown. Nothing was saved.",
  siwf_message: VERIFY_SENTENCES.siwf_message,
  siwf_signature: VERIFY_SENTENCES.siwf_signature,
  siwf_chain_unavailable: VERIFY_SENTENCES.siwf_chain_unavailable,
  siwf_fid_mismatch: VERIFY_SENTENCES.siwf_fid_mismatch,
  siwf_one_main: "Another Farcaster account is already linked to this identity. Totem keeps one per identity, even after a disconnect.",
  siwf_handle_stem: "One of your personas shares a name with this Farcaster account. Matching names would publicly link them. Rename that persona first, then sign in.",
  siwf_linked_device: "Sign in on a device that holds your identity. A linked device cannot add accounts.",
  siwf_seal: "Signed in, but it couldn't be saved just now. Trying again.",
  siwf_expired: "The sign-in request expired. Start again.",
  siwf_links_unreadable: "Couldn't read your linked accounts just now. Nothing was changed. Try again.",
  siwf_off: "Sign in with Farcaster is switched off on this preview.",
  bad_config: "Sign in with Farcaster is not available on this deployment (misconfigured).",
  owner: "Use Settings > Connect your Farcaster account on this service.",
  device_only: "Sign in with Farcaster runs in your browser; this server does not verify sign-ins",
  empty_world: "Sign in with Farcaster's test mode is off on this service.",
  rig_only: "That is a test action, and this is not a test setup.",
  no_session: "That sign-in is not in progress (it finished, was cancelled, or a new one replaced it).",
  not_signed_in: "No Farcaster account is linked to this identity.",
  confirm_required: "Type DISCONNECT to confirm.",
  bad_request: "That request was not understood.",
};

const STATUS: Partial<Record<SiwfCode, number>> = {
  siwf_relay: 502,
  siwf_url: 502,
  siwf_chain_unavailable: 503,
  siwf_seal: 503,
  siwf_links_unreadable: 503,
  siwf_one_main: 409,
  siwf_handle_stem: 409,
  siwf_linked_device: 409,
  siwf_off: 403,
  bad_config: 503,
  owner: 403,
  device_only: 404,
  empty_world: 403,
  rig_only: 403,
  no_session: 404,
  not_signed_in: 404,
  confirm_required: 400,
  bad_request: 400,
};

export class SiwfError extends Error {
  readonly code: SiwfCode;
  readonly status: number;
  readonly retryable: boolean;
  constructor(code: SiwfCode, sentence?: string) {
    super(sentence ?? SENTENCES[code]);
    this.code = code;
    this.status = STATUS[code] ?? 409;
    this.retryable = code === "siwf_relay" || code === "siwf_chain_unavailable" || code === "siwf_seal" || code === "siwf_links_unreadable";
  }
}

// ------------------------------------------------------------------------------------------------- the runtime seam

/** where this module runs: the browser device or a Node server, its env, and the network it may use */
interface SiwfRuntime {
  device: boolean;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
  log: (line: string) => void;
}

const gr = globalThis as unknown as { __layersSiwfRuntime?: SiwfRuntime | null };

function runtime(): SiwfRuntime {
  if (gr.__layersSiwfRuntime) return gr.__layersSiwfRuntime;
  const device = typeof window !== "undefined";
  const w = globalThis as unknown as { __layersOrigFetch?: typeof fetch };
  return {
    device,
    env: process.env,
    // the UNPATCHED fetch in the device: the device's own patch answers /api/* in the tab; the relay and the RPC are
    // other origins, and the original fetch is the one that reaches them (lib/adapters/neynar/content.ts precedent)
    fetch: (device && w.__layersOrigFetch) || fetch,
    now: () => Date.now(),
    log: (line) => console.warn(line),
  };
}

/** NODE HARNESS ONLY (scripts/unit-siwf.mjs): run as a device with an injected network and clock. Refused in a browser. */
export function __setSiwfRuntimeForTests(r: Partial<SiwfRuntime> | null): void {
  if (typeof window !== "undefined") throw new Error("__setSiwfRuntimeForTests is a node-harness seam");
  gr.__layersSiwfRuntime = r
    ? { device: true, env: process.env, fetch, now: () => Date.now(), log: (l) => console.warn(l), ...r }
    : null;
}

// ------------------------------------------------------------------------------------------------- config rules

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

export type UrlRule = { ok: true; url: string; host: string } | { ok: false };

function parsed(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** FC_SIWF_RELAY_URL: unset = the default; otherwise an http(s) LOOPBACK origin only (never on a hosted platform) */
export function relayUrlRule(raw: string | undefined, hosted: boolean): UrlRule {
  const v = (raw ?? "").trim();
  if (!v) return { ok: true, url: DEFAULT_RELAY_URL, host: new URL(DEFAULT_RELAY_URL).host };
  const u = parsed(v);
  if (!u || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return { ok: false };
  if (u.origin === DEFAULT_RELAY_URL) return { ok: true, url: DEFAULT_RELAY_URL, host: u.host };
  if (hosted) return { ok: false };
  if ((u.protocol === "http:" || u.protocol === "https:") && isLoopbackHost(u.hostname)) return { ok: true, url: u.origin, host: u.host };
  return { ok: false };
}

/** FC_SIWF_RPC_URL: unset = the default; otherwise a bare https origin (no userinfo, query, fragment or path: a keyed
 *  provider URL is refused) or an http(s) loopback origin; on a hosted platform only the default */
export function rpcUrlRule(raw: string | undefined, hosted: boolean): UrlRule {
  const v = (raw ?? "").trim();
  if (!v) return { ok: true, url: DEFAULT_RPC_URL, host: new URL(DEFAULT_RPC_URL).host };
  const u = parsed(v);
  if (!u || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return { ok: false };
  if (u.origin === DEFAULT_RPC_URL) return { ok: true, url: DEFAULT_RPC_URL, host: u.host };
  if (hosted) return { ok: false };
  if (u.protocol === "https:" || (u.protocol === "http:" && isLoopbackHost(u.hostname))) return { ok: true, url: u.origin, host: u.host };
  return { ok: false };
}

const gl = globalThis as unknown as { __layersSiwfBadConfigSaid?: Set<string> };
function sayBadConfig(rt: SiwfRuntime, name: string): void {
  const said = (gl.__layersSiwfBadConfigSaid ??= new Set());
  if (said.has(name)) return;
  said.add(name);
  rt.log(`[siwf] bad_config (${name})`);
}

/**
 * The device env hints the SERVER hands the page (lib/device/deviceEnv.server.ts). Names and checked values only:
 * a refused value is never forwarded (the page gets FC_SIWF "bad_config" and the variable's NAME), and on a hosted
 * platform no override is forwarded at all.
 */
export function siwfDeviceHints(env: Record<string, string | undefined> = process.env): Record<string, string> {
  if (env.ZK_DEV_HOOKS === "true") {
    // the rig (fixture, in the /device page's tab) or the owner service (not offered there)
    if (ownerSecretProblem(env) === null) return { FC_SIWF: "owner" };
    if (isEmptyWorld()) return { FC_SIWF: "off" };
    return { FC_SIWF: "fixture" };
  }
  if (OFF.has((env.FC_SIWF ?? "").trim().toLowerCase())) return { FC_SIWF: "off" };
  const hosted = isHostedPlatform(env);
  const rt = runtime();
  const out: Record<string, string> = { FC_SIWF: "on" };
  const relay = relayUrlRule(env.FC_SIWF_RELAY_URL, hosted);
  const rpc = rpcUrlRule(env.FC_SIWF_RPC_URL, hosted);
  if (!relay.ok || !rpc.ok) {
    const name = !relay.ok ? "FC_SIWF_RELAY_URL" : "FC_SIWF_RPC_URL";
    sayBadConfig(rt, name);
    return { FC_SIWF: "bad_config", FC_SIWF_BAD: name };
  }
  if ((env.FC_SIWF_RELAY_URL ?? "").trim() && relay.url !== DEFAULT_RELAY_URL) out.FC_SIWF_RELAY_URL = relay.url;
  if ((env.FC_SIWF_RPC_URL ?? "").trim() && rpc.url !== DEFAULT_RPC_URL) out.FC_SIWF_RPC_URL = rpc.url;
  return out;
}

/**
 * PERSONA LAUNCH P1 (review UX-7): may a page PROMISE Sign in with Farcaster on this deployment? Only where the
 * device will offer it for real: FC_SIWF "on". The kill switch ("off"), the owner service ("owner"), an empty world, a
 * refused relay/RPC URL ("bad_config") and the rig ("fixture": its app pages run no device; only /device has the
 * fixture) all say no — the landing used to promise it unconditionally while /device said "not available".
 * Whether the PUBLIC default stays "on" before the owner's first real sign-in is the owner's call (spec Q1).
 */
export function siwfOfferedHere(env: Record<string, string | undefined> = process.env): boolean {
  return siwfDeviceHints(env).FC_SIWF === "on";
}

export type SiwfMode = "live" | "fixture";
export type SiwfGate =
  | { ok: true; mode: SiwfMode; relayUrl: string; rpcUrl: string; relayHost: string; rpcHost: string }
  | { ok: false; code: SiwfCode; mode: null; relayHost: string | null; rpcHost: string | null };

/** where this process may run a sign-in, and against which network. Pure over the runtime (no I/O). */
export function siwfGate(): SiwfGate {
  const rt = runtime();
  const env = rt.env;
  const refused = (code: SiwfCode): SiwfGate => ({ ok: false, code, mode: null, relayHost: null, rpcHost: null });
  const fixture: SiwfGate = { ok: true, mode: "fixture", relayUrl: "fixture:", rpcUrl: "fixture:", relayHost: "fixture relay", rpcHost: "fixture chain" };
  if (!rt.device) {
    // a Node server: never the live network. A public server never verifies (the route already answered 404).
    if (isPublicDeployment(env)) return refused("device_only");
    if (env.ZK_DEV_HOOKS !== "true") return refused("device_only");
    if (ownerSecretProblem(env) === null) return refused("owner");
    if (isEmptyWorld()) return refused("empty_world");
    return fixture;
  }
  const mode = (env.FC_SIWF ?? "").trim().toLowerCase();
  if (OFF.has(mode)) return refused("siwf_off");
  if (mode === "owner") return refused("owner");
  if (mode === "bad_config") {
    const name = env.FC_SIWF_BAD === "FC_SIWF_RPC_URL" ? "FC_SIWF_RPC_URL" : "FC_SIWF_RELAY_URL";
    sayBadConfig(rt, name);
    return refused("bad_config");
  }
  if (mode === "fixture") {
    // the fixture exists in a tab only when the page declared BOTH rig flags (the server declares them only when it
    // has ZK_DEV_HOOKS: lib/device/deviceEnv.server.ts) — the same trust the custody fixture provider has
    if (env.LAYERS_DEVICE_DEBUG === "1" && env.CUSTODY_FIXTURE_PROVIDER === "allow") return fixture;
    sayBadConfig(rt, "FC_SIWF");
    return refused("bad_config");
  }
  const relay = relayUrlRule(env.FC_SIWF_RELAY_URL, false);
  if (!relay.ok) {
    sayBadConfig(rt, "FC_SIWF_RELAY_URL");
    return refused("bad_config");
  }
  const rpc = rpcUrlRule(env.FC_SIWF_RPC_URL, false);
  if (!rpc.ok) {
    sayBadConfig(rt, "FC_SIWF_RPC_URL");
    return refused("bad_config");
  }
  return { ok: true, mode: "live", relayUrl: relay.url, rpcUrl: rpc.url, relayHost: relay.host, rpcHost: rpc.host };
}

function openGate(): Extract<SiwfGate, { ok: true }> {
  const gate = siwfGate();
  if (!gate.ok) throw new SiwfError(gate.code);
  return gate;
}

// ------------------------------------------------------------------------------------------------- session memory

export type SiwfStage = "pending" | "checking" | "verified" | "refused" | "expired";

interface Completion {
  message: string;
  signature: string;
  fid: number;
  nonce: string;
  authMethod: string;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  bio: string | null;
}

interface Verified {
  fid: number;
  address: string;
  authMethod: "custody" | "authAddress";
  fname: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  bio: string | null;
  nonceHash: string;
  messageHash: string;
}

interface Session {
  id: string;
  mode: SiwfMode;
  nonce: string;
  /** SECRET: the relay channel's bearer token. Memory only: never in a view, an error, a log or the vault. */
  token: string;
  /** the relay's sign-in link (it carries the token: shown only as the QR and the phone button, on request) */
  url: string;
  origin: string;
  host: string;
  createdAt: number;
  deadline: number;
  stage: SiwfStage;
  code: SiwfCode | null;
  /** the relay's completed answer, kept ONLY while the chain could not be checked (a retry re-verifies it) */
  completion: Completion | null;
  /** verified but not yet sealed: a retry seals without a new approval */
  verified: Verified | null;
  /** one-shot: the poll that verified says so, so the card can show the Save moment once */
  justVerified: boolean;
  /** PUBLIC GO-LIVE (anonpage): "miniapp" = started inside a Farcaster Mini App — no relay channel (token and url are
   *  empty): the host signs over this session's nonce (sdk.actions.signIn) and finishMiniAppSiwf hands the answer in */
  kind?: "relay" | "miniapp";
  /** PUBLIC GO-LIVE (PRIV-LIVE-3): the live crowd's join, KEPT here from verification until record() has sealed the sign-in
   *  (then sent once, and cleared); a sign-in record() refuses never tells the validator the account. Memory only; cleared
   *  by endSession; a siwf_seal retry keeps it (the validator's own freshness check still bounds it). */
  joinInput?: { message: string; signature: string; fid: number; authMethod: string; nonce: string } | null;
}

interface Memory {
  session: Session | null;
  chainChecked: boolean;
  queue: Promise<unknown>;
}

const gm = globalThis as unknown as { __layersSiwf?: Memory };
function memory(): Memory {
  return (gm.__layersSiwf ??= { session: null, chainChecked: false, queue: Promise.resolve() });
}

/** one step at a time in this process: a poll and a disconnect racing must never mint or seal twice */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const m = memory();
  const next = m.queue.catch(() => undefined).then(fn);
  m.queue = next.catch(() => undefined);
  return next;
}

const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** 16 base62 characters from getRandomValues, unbiased (rejection sampling) — the device's own nonce, known first */
export function siwfNonce(): string {
  let out = "";
  while (out.length < 16) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    for (const b of bytes) {
      if (b >= 248) continue; // 248 = 4 * 62
      out += B62[b % 62];
      if (out.length === 16) break;
    }
  }
  return out;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

// ------------------------------------------------------------------------------------------------- the network

interface RelayChannel {
  channelToken: string;
  url: string;
  nonce: string;
}
interface RelayStatus {
  state: "pending" | "completed";
  nonce: string | null;
  message: string | null;
  signature: string | null;
  authMethod: string | null;
  fid: number | null;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  bio: string | null;
}

interface SiwfNetwork {
  createChannel(body: { siweUri: string; domain: string; nonce: string; expirationTime: string; acceptAuthAddress: true }): Promise<RelayChannel>;
  status(token: string): Promise<RelayStatus>;
  rpc: SiwfRpc;
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

function toStatus(j: unknown): RelayStatus {
  const r = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  const fid = Number(r.fid);
  return {
    state: r.state === "completed" ? "completed" : "pending",
    nonce: str(r.nonce, 128),
    message: str(r.message, 8192),
    signature: str(r.signature, 20_000),
    authMethod: str(r.authMethod, 32),
    fid: Number.isSafeInteger(fid) && fid > 0 ? fid : null,
    username: str(r.username, 128),
    displayName: str(r.displayName, 256),
    pfpUrl: str(r.pfpUrl, 2048),
    bio: str((r.bio as unknown) ?? null, 1024),
  };
}

function liveNetwork(gate: Extract<SiwfGate, { ok: true }>, rt: SiwfRuntime): SiwfNetwork {
  const opts = (init: RequestInit): RequestInit => ({
    ...init,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    mode: "cors",
    signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(RELAY_TIMEOUT_MS) : undefined,
  });
  let rpcId = 0;
  return {
    async createChannel(body) {
      let res: Response;
      try {
        res = await rt.fetch(gate.relayUrl + "/v1/channel", opts({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      } catch {
        throw new SiwfError("siwf_relay");
      }
      if (!res.ok) throw new SiwfError("siwf_relay");
      const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const channelToken = str(j?.channelToken, 512);
      const url = str(j?.url, 2048);
      const nonce = str(j?.nonce, 128);
      if (!channelToken || !/^[A-Za-z0-9._~-]+$/.test(channelToken) || !url || !nonce) throw new SiwfError("siwf_relay");
      return { channelToken, url, nonce };
    },
    async status(token) {
      let res: Response;
      try {
        // the token rides the Authorization header, never a URL (a URL is what logs record)
        res = await rt.fetch(gate.relayUrl + "/v1/channel/status", opts({ method: "GET", headers: { authorization: "Bearer " + token } }));
      } catch {
        throw new SiwfError("siwf_relay");
      }
      if (!(res.status === 200 || res.status === 202)) throw new SiwfError("siwf_relay");
      const j = await res.json().catch(() => null);
      if (!j) throw new SiwfError("siwf_relay");
      return toStatus(j);
    },
    async rpc(method, params) {
      // two attempts for a transport failure; a JSON-RPC error is the node's answer and comes back at once
      type RpcAnswer = { result?: unknown; error?: { code?: unknown; message?: unknown } };
      for (let attempt = 0; attempt < 2; attempt++) {
        let j: RpcAnswer | null;
        try {
          const res = await rt.fetch(gate.rpcUrl, opts({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) }));
          if (!res.ok) throw new Error("not ok");
          j = (await res.json()) as RpcAnswer | null;
        } catch {
          if (attempt === 0) await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        if (j && j.error) {
          const reverted = Number(j.error.code) === 3 || /revert/i.test(String(j.error.message ?? ""));
          throw new SiwfRpcError(reverted ? "reverted" : "unavailable");
        }
        if (j && "result" in j) return j.result;
        throw new SiwfRpcError("unavailable");
      }
      throw new SiwfRpcError("unavailable");
    },
  };
}

// ---- the FIXTURE network: an in-process relay and chain. Nothing here makes a request.

interface FixtureChannel {
  nonce: string;
  domain: string;
  siweUri: string;
  expirationTime: string;
  completed: RelayStatus | null;
}
interface FixtureState {
  channels: Map<string, FixtureChannel>;
  /** `${fid}|${address}` → KeyRegistry key data */
  keyData: Map<string, { state: number; keyType: number }>;
  relayDown: number;
  rpcDown: number;
  rpcCalls: string[];
}
const gx = globalThis as unknown as { __layersSiwfFixture?: FixtureState };
function fx(): FixtureState {
  return (gx.__layersSiwfFixture ??= { channels: new Map(), keyData: new Map(), relayDown: 0, rpcDown: 0, rpcCalls: [] });
}

function fixtureFidOfCustody(address: string): number {
  for (const fid of Object.keys(FIXTURE_ACCOUNTS).map(Number))
    if (privateKeyToAccount(fixtureCustodyKey(fid)).address.toLowerCase() === address.toLowerCase()) return fid;
  return 0;
}

const fixtureNetwork: SiwfNetwork = {
  async createChannel(body) {
    const token = FIXTURE_TOKEN_PREFIX + hex(globalThis.crypto.getRandomValues(new Uint8Array(12)));
    fx().channels.set(token, { nonce: body.nonce, domain: body.domain, siweUri: body.siweUri, expirationTime: body.expirationTime, completed: null });
    return { channelToken: token, url: "https://farcaster.xyz/~/siwf?channelToken=" + token, nonce: body.nonce };
  },
  async status(token) {
    const f = fx();
    if (f.relayDown > 0) {
      f.relayDown--;
      throw new SiwfError("siwf_relay");
    }
    const c = f.channels.get(token);
    if (!c) throw new SiwfError("siwf_relay");
    return c.completed ?? { state: "pending", nonce: c.nonce, message: null, signature: null, authMethod: null, fid: null, username: null, displayName: null, pfpUrl: null, bio: null };
  },
  async rpc(method, params) {
    const f = fx();
    f.rpcCalls.push(method);
    if (f.rpcCalls.length > 200) f.rpcCalls.splice(0, f.rpcCalls.length - 200);
    if (f.rpcDown > 0) {
      f.rpcDown--;
      throw new SiwfRpcError("unavailable");
    }
    if (method === "eth_chainId") return "0x" + SIWF_CHAIN_ID.toString(16);
    if (method !== "eth_call") throw new SiwfRpcError("unavailable");
    const call = (params[0] ?? {}) as { to?: string; data?: `0x${string}` };
    const to = String(call.to ?? "").toLowerCase();
    if (to === ID_REGISTRY.toLowerCase()) {
      const d = decodeFunctionData({ abi: ID_REGISTRY_ABI, data: call.data! });
      return encodeFunctionResult({ abi: ID_REGISTRY_ABI, functionName: "idOf", result: BigInt(fixtureFidOfCustody(String(d.args[0]))) });
    }
    if (to === KEY_REGISTRY.toLowerCase()) {
      const d = decodeFunctionData({ abi: KEY_REGISTRY_ABI, data: call.data! });
      const fid = Number(d.args[0]);
      const key = String(d.args[1]).toLowerCase();
      const address = "0x" + key.slice(-40);
      const kd = f.keyData.get(fid + "|" + address) ?? { state: 0, keyType: 0 };
      return encodeFunctionResult({ abi: KEY_REGISTRY_ABI, functionName: "keyDataOf", result: kd });
    }
    throw new SiwfRpcError("reverted"); // no contract wallets in the fixture: a deployless 6492 call reverts
  },
};

function networkFor(gate: Extract<SiwfGate, { ok: true }>): SiwfNetwork {
  return gate.mode === "fixture" ? fixtureNetwork : liveNetwork(gate, runtime());
}

/** the relay's sign-in link, checked: an allowlisted Farcaster host over https, or the farcaster: scheme */
export function checkSignInUrl(raw: string): string {
  const u = parsed(raw);
  if (!u || raw.length > 2048 || u.username || u.password) throw new SiwfError("siwf_url");
  if (u.protocol === "farcaster:") return u.toString();
  if (u.protocol === "https:" && SIWF_LINK_HOSTS.includes(u.hostname.toLowerCase())) return u.toString();
  throw new SiwfError("siwf_url");
}

// ------------------------------------------------------------------------------------------------- views

export interface SiwfLinkView {
  fid: number;
  fname: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  personaId: string;
  handle: string | null;
  authMethod: "custody" | "authAddress";
  verifiedAt: number;
  disconnected: boolean;
}

export interface SiwfSessionView {
  id: string;
  stage: SiwfStage;
  deadline: number;
  code: SiwfCode | null;
  note: string | null;
  retryable: boolean;
  /** present only while the request can still be approved: the QR as an SVG path (the link itself, which carries
   *  the channel token, comes from POST {action: "approval"} and never rides this view) */
  approval: { qr: { viewBox: number; path: string } } | null;
}

export interface SiwfStatusView {
  available: boolean;
  code: SiwfCode | null;
  reason: string | null;
  mode: SiwfMode | null;
  relayHost: string | null;
  rpcHost: string | null;
  link: SiwfLinkView | null;
  session: SiwfSessionView | null;
  /** one-shot: "signed-in" on the answer that verified (the card shows the Save moment while the identity is unsaved) */
  moment?: "signed-in";
}

function sessionView(s: Session, now: number): SiwfSessionView {
  const open = (s.stage === "pending" || s.stage === "checking") && now < s.deadline;
  const stage: SiwfStage = (s.stage === "pending" || s.stage === "checking") && now >= s.deadline ? "expired" : s.stage;
  const code = stage === "expired" ? "siwf_expired" : s.code;
  return {
    id: s.id,
    stage,
    deadline: s.deadline,
    code,
    note: code ? SENTENCES[code] : null,
    retryable: code === "siwf_chain_unavailable" || code === "siwf_seal" || code === "siwf_relay",
    approval: open && s.stage === "pending" && s.kind !== "miniapp" ? { qr: qrSvgPath(s.url) } : null,
  };
}

async function linkView(link: AccountLink | null): Promise<SiwfLinkView | null> {
  if (!link) return null;
  let handle: string | null = null;
  try {
    const { getPersona } = await import("@/lib/identity/keystore");
    handle = getPersona(link.personaId)?.handle ?? null;
  } catch {
    handle = null;
  }
  return {
    fid: link.fid,
    fname: link.fname,
    displayName: link.displayName,
    pfpUrl: link.pfpUrl,
    personaId: link.personaId,
    handle,
    authMethod: link.authMethod,
    verifiedAt: link.verifiedAt,
    disconnected: link.disconnectedAt !== null,
  };
}

async function readMainLink(): Promise<AccountLink | null> {
  const { mainLink } = await import("./links");
  try {
    return await mainLink();
  } catch {
    throw new SiwfError("siwf_links_unreadable");
  }
}

/** GET: where things stand. A pure read of config, memory and the sealed record: no network call, never a token,
 *  a signature or a message. THROWS siwf_links_unreadable when the sealed record cannot be read (never "no link"). */
export async function siwfStatus(): Promise<SiwfStatusView> {
  const gate = siwfGate();
  if (!gate.ok) return { available: false, code: gate.code, reason: SENTENCES[gate.code], mode: null, relayHost: null, rpcHost: null, link: null, session: null };
  const link = await linkView(await readMainLink());
  const s = memory().session;
  const now = runtime().now();
  const view: SiwfStatusView = {
    available: true,
    code: null,
    reason: null,
    mode: gate.mode,
    relayHost: gate.relayHost,
    rpcHost: gate.rpcHost,
    link,
    session: s && s.mode === gate.mode ? sessionView(s, now) : null,
  };
  if (s && s.justVerified) {
    s.justVerified = false;
    view.moment = "signed-in";
  }
  return view;
}

// ------------------------------------------------------------------------------------------------- the steps

/** START: the device's own nonce, a relay channel, the checked link. Replaces any earlier unfinished session. */
export function startSiwf(where: { origin: string; host: string }): Promise<SiwfStatusView> {
  return serialized(async () => {
    const gate = openGate();
    const rt = runtime();
    try {
      const { isLinkedDevice } = await import("@/lib/identity/keystore");
      if (isLinkedDevice()) throw new SiwfError("siwf_linked_device");
    } catch (e) {
      if (e instanceof SiwfError) throw e;
      throw new SiwfError("siwf_linked_device"); // no keystore here: nothing could be minted
    }
    const link = await readMainLink();
    // PUBLIC GO-LIVE (D-PUBLIC-LIVE-TREE): while the site's anonymous posts are LIVE (lib/zk/anon/universe.ts), a visitor
    // who is already signed in may sign in AGAIN with the same account — that is how a sign-in made before the relay was
    // armed (or a lost passkey's) joins the live anonymous crowd. Another account is still refused at record (one main).
    const liveJoin = liveUniverseHinted();
    if (link && link.disconnectedAt === null && !liveJoin)
      throw new SiwfError("siwf_one_main", "You are already signed in with a Farcaster account here. Disconnect it first to sign in again.");
    const origin = String(where.origin ?? "");
    const host = String(where.host ?? "");
    if (!/^https?:\/\/[^/\s]+$/.test(origin) || !host || new URL(origin).host !== host) throw new SiwfError("bad_request");
    // PUBLIC GO-LIVE: the nonce BINDS this root's commitment when the live crowd is joined with this sign-in
    // (lib/zk/anon/fcJoin.ts joinNonceFor); otherwise, or when the commitment cannot be read, the random nonce as before
    const bound = liveJoin ? await (await import("@/lib/zk/anon/fcJoin")).fcJoinNonce() : null;
    const nonce = bound?.nonce ?? siwfNonce();
    const now = rt.now();
    const deadline = now + SIWF_DEADLINE_MS;
    const net = networkFor(gate);
    const ch = await net.createChannel({ siweUri: origin + "/device", domain: host, nonce, expirationTime: new Date(deadline).toISOString(), acceptAuthAddress: true });
    // the relay must echo OUR nonce (the device knew it first), and its link must point at Farcaster
    if (ch.nonce !== nonce) throw new SiwfError("siwf_message");
    const url = checkSignInUrl(ch.url);
    memory().session = {
      id: hex(globalThis.crypto.getRandomValues(new Uint8Array(16))),
      mode: gate.mode,
      nonce,
      token: ch.channelToken,
      url,
      origin,
      host,
      createdAt: now,
      deadline,
      stage: "pending",
      code: null,
      completion: null,
      verified: null,
      justVerified: false,
    };
    return siwfStatus();
  });
}

function sessionFor(id: string, gate: Extract<SiwfGate, { ok: true }>): Session {
  const s = memory().session;
  if (!s || typeof id !== "string" || s.id !== id || s.mode !== gate.mode) throw new SiwfError("no_session");
  return s;
}

/** APPROVAL: the sign-in link for the QR's phone button (it carries the channel token, so it is asked for, never
 *  pushed: the status view carries only the QR's drawing). Only while the request can still be approved. */
export function siwfApproval(sessionId: string): Promise<{ url: string; appLink: string }> {
  return serialized(async () => {
    const gate = openGate();
    const s = sessionFor(sessionId, gate);
    if (s.kind === "miniapp" || s.stage !== "pending" || runtime().now() >= s.deadline) throw new SiwfError("no_session");
    return { url: s.url, appLink: s.url };
  });
}

/** POLL: one look at the channel; on completion, verify at once, then record. Every refusal is a fixed code on the
 *  session; nothing is recorded unless everything checked. */
export function pollSiwf(sessionId: string): Promise<SiwfStatusView> {
  return serialized(async () => {
    const gate = openGate();
    const rt = runtime();
    const s = sessionFor(sessionId, gate);
    const now = rt.now();
    if (s.stage !== "pending" && s.stage !== "checking") return siwfStatus();
    if (now >= s.deadline) {
      endSession(s, "expired", "siwf_expired");
      return siwfStatus();
    }
    const net = networkFor(gate);
    // PUBLIC GO-LIVE (anonpage): a Mini App session has no relay channel to look at — it waits for finishMiniAppSiwf
    if (s.kind === "miniapp" && !s.verified && !s.completion) return siwfStatus();
    if (!s.verified && !s.completion) {
      let st: RelayStatus;
      try {
        st = await net.status(s.token);
      } catch {
        // UXC-09: a poll that errors is "couldn't check just now, still trying" — the session stays open
        s.code = "siwf_relay";
        return siwfStatus();
      }
      if (st.state !== "completed") {
        s.code = null;
        return siwfStatus();
      }
      if (!st.message || !st.signature || st.fid === null || !st.nonce) {
        endSession(s, "refused", "siwf_message");
        return siwfStatus();
      }
      s.completion = {
        message: st.message,
        signature: st.signature,
        fid: st.fid,
        nonce: st.nonce,
        authMethod: st.authMethod ?? "",
        username: st.username,
        displayName: st.displayName,
        pfpUrl: st.pfpUrl,
        bio: st.bio,
      };
      s.stage = "checking";
    }
    if (!s.verified && s.completion) {
      const c = s.completion;
      try {
        const r = await verifySiwf(
          { message: c.message, signature: c.signature, fid: c.fid, nonce: c.nonce, authMethod: c.authMethod },
          { domain: s.host, origin: s.origin, nonce: s.nonce, deadlineMs: s.deadline, nowMs: now },
          { rpc: net.rpc, chainChecked: memory().chainChecked }
        );
        memory().chainChecked = true;
        const fname = c.username && /^[a-z0-9][a-z0-9.-]{0,63}$/i.test(c.username) ? c.username.toLowerCase() : null;
        s.verified = {
          fid: r.verified.fid,
          address: r.verified.address,
          authMethod: r.verified.authMethod,
          fname,
          displayName: c.displayName,
          pfpUrl: c.pfpUrl && /^https:\/\//.test(c.pfpUrl) ? c.pfpUrl : null,
          bio: c.bio,
          nonceHash: sha256hex(s.nonce),
          messageHash: sha256hex(c.message),
        };
        // PUBLIC GO-LIVE (D-PUBLIC-LIVE-TREE): a sign-in whose nonce bound this device's crowd commitment joins the live
        // anonymous crowd — PRIV-LIVE-3: only once record() below has SEALED it. The join is kept on the session until then
        // (a sign-in record() refuses — another account already linked, a clashing persona name — must never have told the
        // validator the account); lib/zk/anon/fcJoin.ts sends only sign-ins it started a binding for
        s.joinInput = liveUniverseHinted() ? { message: c.message, signature: c.signature, fid: r.verified.fid, authMethod: r.verified.authMethod, nonce: s.nonce } : null;
        s.completion = null; // the relay's answer leaves memory the moment it is verified (only the pending join keeps the signed message)
      } catch (e) {
        const code: SiwfCode = e instanceof SiwfVerifyError ? e.code : "siwf_chain_unavailable";
        if (code === "siwf_chain_unavailable") {
          s.code = code; // retryable: the completed answer stays in memory and the next poll re-verifies it
          return siwfStatus();
        }
        endSession(s, "refused", code);
        return siwfStatus();
      }
    }
    if (s.verified) {
      try {
        await record(s, gate);
      } catch (e) {
        if (e instanceof SiwfError && !e.retryable) {
          endSession(s, "refused", e.code);
          return siwfStatus();
        }
        s.code = "siwf_seal"; // verified, not saved: kept in memory, the next poll seals without a new approval
        return siwfStatus();
      }
      s.stage = "verified";
      s.code = null;
      s.justVerified = true;
      s.token = ""; // nothing more to ask the relay
      // PUBLIC GO-LIVE (PRIV-LIVE-3): the sign-in is sealed — NOW the live crowd's join goes, once (fire and forget: a join
      // never fails a sign-in; lib/zk/anon/fcJoin.ts records its outcome), and the signed message leaves memory
      const join = s.joinInput ?? null;
      s.joinInput = null;
      if (join) void import("@/lib/zk/anon/fcJoin").then((m) => m.fcJoinAfterSignIn(join)).catch(() => undefined);
    }
    return siwfStatus();
  });
}

function endSession(s: Session, stage: SiwfStage, code: SiwfCode): void {
  s.stage = stage;
  s.code = code;
  s.completion = null;
  s.verified = null;
  s.token = "";
  s.joinInput = null; // PUBLIC GO-LIVE (PRIV-LIVE-3): a refused or expired sign-in never joins the crowd
}

function personaHandleFor(fname: string | null): string {
  const h = (fname ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
  return h || "farcaster_main";
}

/** SIGN IN WITH X: the public self Sign in with X minted for this root (its X link names it), or null. THROWS
 *  siwf_links_unreadable when the record cannot be read (never "no X account"). */
async function xPublicSelf(ks: typeof import("@/lib/identity/keystore")): Promise<ReturnType<typeof ks.getPersona>> {
  let x: { personaId: string } | null;
  try {
    x = await (await import("./links")).xLink();
  } catch {
    throw new SiwfError("siwf_links_unreadable");
  }
  if (!x) return null;
  const p = ks.getPersona(x.personaId);
  return p && p.publicSelf === true ? p : null;
}

/** e. record: mint or resume the persona, sync the rosters (loud), seal the link (loud). Idempotent: a retry after a
 *  failed seal finds the persona the first attempt minted (deterministic nonce) and seals again. */
async function record(s: Session, gate: Extract<SiwfGate, { ok: true }>): Promise<void> {
  const v = s.verified!;
  const rt = runtime();
  const ks = await import("@/lib/identity/keystore");
  if (ks.isLinkedDevice()) throw new SiwfError("siwf_linked_device");
  const link = await readMainLink();
  // one main per root: a live link or a TOMBSTONE for another fid refuses (main stays main after a disconnect)
  if (link && link.fid !== v.fid) throw new SiwfError("siwf_one_main");
  const nonce = (gate.mode === "fixture" ? ks.FIXTURE_SIWF_NONCE_PREFIX : "") + SIWF_PERSONA_NONCE(v.fid);
  const existing = ks.listPersonas().find((p) => p.nonce === nonce) ?? null;
  // SIGN IN WITH X (2026-11-06): ONE public self per root. A root that signed in with X first already has one (the persona
  // Sign in with X minted, named by its X link): the Farcaster account JOINS it — this link names that persona, and the
  // persona keeps the name, username and picture the visitor confirmed on This is you. It is the root itself, never
  // "another persona", so the stem rule below does not count it.
  const adopted = existing ? null : await xPublicSelf(ks);
  let handle = existing?.handle ?? adopted?.handle ?? personaHandleFor(v.fname);
  const selfId = existing?.id ?? adopted?.id ?? null;
  // the stem rule, both directions (CONNECT MAIN review PL-4): no OTHER persona of this root may share a stem with
  // the account's fname, nor already hold the handle the public self would take
  const clash = ks.listPersonas().find((p) => p.nonce !== nonce && p.id !== selfId && ((v.fname && derivedFromMain(p.handle, v.fname)) || p.handle.toLowerCase() === handle));
  if (clash)
    throw new SiwfError(
      "siwf_handle_stem",
      `Your persona @${clash.handle} shares a name with this Farcaster account. Matching names would publicly link them. Rename that persona first, then sign in.`
    );
  if (!existing && !adopted) {
    try {
      const { personaByHandle } = await import("@/lib/adapters/mock/store");
      // PUBLIC GO-LIVE (This is you): the username is taken inside Totem by someone else — the sign-in no longer refuses;
      // the public self takes the first free alternative (lib/onboarding/state.ts handleSuggestions), and the next step
      // says "@x is taken on Totem" with alternatives to pick from. Its Farcaster username is untouched.
      if (personaByHandle.has(handle)) {
        const own = new Set(ks.listPersonas().map((p) => p.handle.toLowerCase()));
        const { handleSuggestions } = await import("@/lib/onboarding/state");
        const free = handleSuggestions(handle, (h) => personaByHandle.has(h) || own.has(h), 1)[0];
        if (!free) throw new SiwfError("siwf_handle_stem", `Another account here already uses @${handle}. Rename it first, then sign in.`);
        handle = free;
      }
    } catch (e) {
      if (e instanceof SiwfError) throw e;
    }
  }
  const name = (v.displayName ?? "").trim().slice(0, 50) || v.fname || "Farcaster account";
  const avatarUrl = v.pfpUrl && v.pfpUrl.length <= 256 ? v.pfpUrl : null;
  const bio = v.bio ? v.bio.slice(0, 160) : null;
  let persona = existing ?? adopted;
  if (!persona) {
    persona = ks.createPersona({ name, handle, kind: "public", avatarUrl, bio, cluster: null, nonce, forkedFrom: null, publicSelf: true });
  } else if (!adopted && (persona.name !== name || persona.avatarUrl !== avatarUrl || persona.bio !== bio)) {
    persona = ks.updatePersona(persona.id, { name, avatarUrl, bio }) ?? persona;
  }
  // the sealed recovery roster (a passkey unlock and the 24 words restore the public self) and, in the device, the
  // device roster under this device's own root. Loud: a lost roster write is a persona recovery will miss.
  try {
    const { syncRoster } = await import("@/lib/identity/roster");
    await syncRoster();
    if (rt.device) {
      const { getSession } = await import("@/lib/session");
      const session = await getSession(); // the device's session shim adopts the new persona into the store maps
      if (session.rootId) {
        const { recordPersona } = await import("@/lib/identity/rootRoster");
        await recordPersona(session.rootId, persona.id, {
          id: persona.id,
          name: persona.name,
          handle: persona.handle,
          avatarUrl: persona.avatarUrl,
          bio: persona.bio,
          createdAt: persona.createdAt,
          publicSelf: true,
        });
      }
    }
  } catch {
    throw new SiwfError("siwf_seal");
  }
  const personaId = persona.id;
  const next: AccountLink = {
    kind: "farcaster",
    fid: v.fid,
    fname: v.fname,
    displayName: v.displayName,
    pfpUrl: v.pfpUrl,
    bio: v.bio,
    personaId,
    authMethod: v.authMethod,
    signer: v.address,
    nonceHash: v.nonceHash,
    messageHash: v.messageHash,
    verifiedAt: rt.now(),
    verifier: { rpcHost: gate.rpcHost },
    disconnectedAt: null,
  };
  const { updateAccountLinks } = await import("./links");
  try {
    await updateAccountLinks((all) => {
      // SIGN IN WITH X: the record may also hold the root's X link, which this write keeps as it is; the checks below see
      // the Farcaster link alone
      const doc = { v: 1 as const, links: all.links.filter((l): l is AccountLink => l.kind === "farcaster") };
      // re-checked INSIDE the write, on the document the validator holds (a second tab may have linked meanwhile)
      if (doc.links[0] && doc.links[0].fid !== v.fid) throw new SiwfError("siwf_one_main");
      return { v: 1, links: [next, ...all.links.filter((l) => l.kind !== "farcaster")] };
    });
  } catch (e) {
    if (e instanceof SiwfError) throw e;
    throw new SiwfError("siwf_seal");
  }
}

// ------------------------------------------------------------------------------------------------- inside a Mini App
// PUBLIC GO-LIVE (anonpage) — SIGN IN WITH FARCASTER INSIDE A FARCASTER MINI APP (the /anon page opened in a Farcaster
// client). There is no relay channel: the HOST signs a Sign in with Farcaster message over the device's own nonce
// (@farcaster/miniapp-sdk sdk.actions.signIn({nonce, acceptAuthAddress: true}) -> {message, signature, authMethod}). The
// device trusts none of it: finishMiniAppSiwf hands the answer to the SAME verification and record as a relay completion
// (pollSiwf: verifySiwf checks the statement, the domain = this page's host, the uri's origin, OUR nonce, issuedAt and
// expiry, the signature, then the chain — idOf or keyDataOf — and record() seals the same one link), and the live crowd's
// fid gate binds the nonce exactly as startSiwf does (lib/zk/anon/fcJoin.ts). The account number is the message's own
// farcaster://fid/N resource (the verifier checks it again); the username, display name and picture are the HOST's word
// (sdk.context.user, used only when its fid is the signed one), like the relay's metadata (A-SIWF-PROFILE-FROM-RELAY).

/** START (Mini App): the device's own nonce, kept in a session with no relay channel. The host signs over it. */
export function startMiniAppSiwf(where: { origin: string; host: string }): Promise<{ sessionId: string; nonce: string; expirationTime: string; status: SiwfStatusView }> {
  return serialized(async () => {
    const gate = openGate();
    const rt = runtime();
    try {
      const { isLinkedDevice } = await import("@/lib/identity/keystore");
      if (isLinkedDevice()) throw new SiwfError("siwf_linked_device");
    } catch (e) {
      if (e instanceof SiwfError) throw e;
      throw new SiwfError("siwf_linked_device");
    }
    const link = await readMainLink();
    const liveJoin = liveUniverseHinted();
    if (link && link.disconnectedAt === null && !liveJoin)
      throw new SiwfError("siwf_one_main", "You are already signed in with a Farcaster account here. Disconnect it first to sign in again.");
    const origin = String(where.origin ?? "");
    const host = String(where.host ?? "");
    if (!/^https?:\/\/[^/\s]+$/.test(origin) || !host || new URL(origin).host !== host) throw new SiwfError("bad_request");
    const bound = liveJoin ? await (await import("@/lib/zk/anon/fcJoin")).fcJoinNonce() : null;
    const nonce = bound?.nonce ?? siwfNonce();
    const now = rt.now();
    const deadline = now + SIWF_DEADLINE_MS;
    const id = hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    memory().session = { id, mode: gate.mode, nonce, token: "", url: "", origin, host, createdAt: now, deadline, stage: "pending", code: null, completion: null, verified: null, justVerified: false, kind: "miniapp" };
    return { sessionId: id, nonce, expirationTime: new Date(deadline).toISOString(), status: await siwfStatus() };
  });
}

/** the message's own account number (its one farcaster://fid/N resource line); null when it names none */
function fidOfSiwfMessage(message: string): number | null {
  const m = /^- farcaster:\/\/fid\/([1-9]\d{0,15})\/?$/m.exec(message);
  const n = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** FINISH (Mini App): the host's answer, then the very verification and record a relay completion gets (pollSiwf) */
export async function finishMiniAppSiwf(
  sessionId: string,
  input: { message: string; signature: string; authMethod?: string; profile?: { fid?: unknown; username?: unknown; displayName?: unknown; pfpUrl?: unknown } | null }
): Promise<SiwfStatusView> {
  await serialized(async () => {
    const gate = openGate();
    const s = sessionFor(sessionId, gate);
    if (s.kind !== "miniapp") throw new SiwfError("no_session");
    if (s.stage !== "pending" || s.completion || s.verified) return; // already handed in: the poll below says where it is
    const message = typeof input.message === "string" ? input.message : "";
    const signature = typeof input.signature === "string" ? input.signature : "";
    const fid = fidOfSiwfMessage(message);
    if (!message || !signature || message.length > 4096 || signature.length > 20_000 || fid === null) {
      endSession(s, "refused", "siwf_message");
      return;
    }
    const p = input.profile && typeof input.profile === "object" && input.profile.fid === fid ? input.profile : null;
    const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
    s.completion = {
      message,
      signature,
      fid,
      nonce: s.nonce,
      authMethod: input.authMethod === "authAddress" ? "authAddress" : "custody",
      username: p ? str(p.username, 64) : null,
      displayName: p ? str(p.displayName, 100) : null,
      pfpUrl: p ? str(p.pfpUrl, 256) : null,
      bio: null,
    };
    s.stage = "checking";
  });
  return pollSiwf(sessionId);
}

/** CANCEL: forget the request (the relay's channel simply expires) */
export function cancelSiwf(sessionId: string): Promise<SiwfStatusView> {
  return serialized(async () => {
    const gate = openGate();
    sessionFor(sessionId, gate);
    memory().session = null;
    return siwfStatus();
  });
}

/** DISCONNECT: tombstone the link (disconnectedAt); the persona is kept and shown "disconnected". Signing in again as
 *  the same account re-arms it in place; another account stays refused (main stays main). */
export function disconnectSiwf(confirm: string): Promise<SiwfStatusView> {
  return serialized(async () => {
    openGate();
    if (confirm !== "DISCONNECT") throw new SiwfError("confirm_required");
    const link = await readMainLink();
    if (!link) throw new SiwfError("not_signed_in");
    if (link.disconnectedAt === null) {
      const { updateAccountLinks } = await import("./links");
      const at = runtime().now();
      try {
        await updateAccountLinks((doc) => {
          // SIGN IN WITH X: only the Farcaster link is tombstoned; an X link stays as it is
          const fc = doc.links.find((l) => l.kind === "farcaster");
          if (!fc) throw new SiwfError("not_signed_in");
          return { v: 1, links: doc.links.map((l) => (l === fc ? { ...fc, disconnectedAt: at } : l)) };
        });
      } catch (e) {
        if (e instanceof SiwfError) throw e;
        throw new SiwfError("siwf_seal");
      }
    }
    memory().session = null;
    return siwfStatus();
  });
}

export interface FixtureApproveInput {
  sessionId: string;
  fid?: number;
  /** the message names fid X, signed by X's custody, but the chain says that custody owns another fid */
  wrongFid?: boolean;
  /** the signature is by a different key than the message's address */
  wrongSigner?: boolean;
  badNonce?: boolean;
  badDomain?: boolean;
  /** issued twenty minutes ago */
  expired?: boolean;
  /** signed by the account's registered auth address (KeyRegistry keyType 2, state 1) */
  authAddress?: boolean;
  /** signed by an auth address KeyRegistry does not list as active */
  unregisteredAuthAddress?: boolean;
  /** the next N relay status reads fail */
  relayDown?: number;
  /** the next N fixture chain calls fail (the fixture chain has no retry: each failed call is one "could not check") */
  rpcDown?: number;
}

/** RIG ONLY (fixture network): approve a pending request as if a phone scanned it, optionally doctored so a suite can
 *  drive every refusal. 403 everywhere the fixture is not the network. */
export function fixtureApproveSiwf(input: FixtureApproveInput): Promise<SiwfStatusView> {
  return serialized(async () => {
    const gate = siwfGate();
    const rt = runtime();
    const rig = rt.device ? gate.ok && gate.mode === "fixture" : gate.ok && gate.mode === "fixture" && rt.env.ZK_DEV_HOOKS === "true";
    if (!rig || !gate.ok) throw new SiwfError("rig_only");
    const s = sessionFor(input.sessionId, gate);
    if (s.stage !== "pending") throw new SiwfError("no_session");
    const f = fx();
    const ch = f.channels.get(s.token);
    if (!ch) throw new SiwfError("no_session");
    const fid = Number.isSafeInteger(input.fid) && (input.fid as number) > 0 ? (input.fid as number) : FIXTURE_SIWF_MAIN.fid;
    const account = FIXTURE_ACCOUNTS[fid] ?? { username: "fid" + fid, displayName: "Fixture " + fid };
    const custody = privateKeyToAccount(input.wrongFid ? fixtureCustodyKey(fid === FIXTURE_SIWF_OTHER.fid ? FIXTURE_SIWF_MAIN.fid : FIXTURE_SIWF_OTHER.fid) : fixtureCustodyKey(fid));
    const auth = privateKeyToAccount(fixtureAuthKey(fid));
    const useAuth = !!(input.authAddress || input.unregisteredAuthAddress);
    const signerAccount = useAuth ? auth : custody;
    if (useAuth) f.keyData.set(fid + "|" + auth.address.toLowerCase(), input.unregisteredAuthAddress ? { state: 0, keyType: 2 } : { state: 1, keyType: 2 });
    const now = rt.now();
    const message = createSiweMessage({
      domain: input.badDomain ? "elsewhere.example" : ch.domain,
      address: signerAccount.address,
      statement: SIWF_STATEMENT,
      uri: ch.siweUri,
      version: "1",
      chainId: SIWF_CHAIN_ID,
      nonce: input.badNonce ? "WrongNonce000000" : ch.nonce,
      issuedAt: new Date(input.expired ? now - 20 * 60_000 : now),
      expirationTime: new Date(ch.expirationTime),
      resources: [`farcaster://fid/${fid}`],
    });
    const signer = input.wrongSigner ? privateKeyToAccount(fixtureCustodyKey(fid + 7)) : signerAccount;
    const signature = await signer.signMessage({ message });
    ch.completed = {
      state: "completed",
      nonce: ch.nonce,
      message,
      signature,
      authMethod: useAuth ? "authAddress" : "custody",
      fid,
      username: account.username,
      displayName: account.displayName,
      pfpUrl: null,
      bio: "fixture account",
    };
    if (Number.isSafeInteger(input.relayDown) && (input.relayDown as number) > 0) f.relayDown = Math.min(input.relayDown as number, 20);
    if (Number.isSafeInteger(input.rpcDown) && (input.rpcDown as number) > 0) f.rpcDown = Math.min(input.rpcDown as number, 20);
    return siwfStatus();
  });
}

/** resetSeed / reloadIdentity / tests: forget the session, the chain check and the fixture network */
export function resetSiwf(): void {
  gm.__layersSiwf = { session: null, chainChecked: false, queue: Promise.resolve() };
  gx.__layersSiwfFixture = { channels: new Map(), keyData: new Map(), relayDown: 0, rpcDown: 0, rpcCalls: [] };
}
