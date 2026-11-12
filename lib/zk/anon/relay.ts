import "server-only";
// ZK PASS 1 Gate 1 — the PLUGGABLE RELAY LAYER for IP decoupling.
//
//   direct  — straight to the validator over an isolated socket. The
//             operator sees the client's IP. FAILS the privacy condition
//             set by definition (Gate 3), and says so.
//   ohttp   — Oblivious HTTP (RFC 9458) through a configured relay: the
//             relay sees the client's IP and ciphertext; the validator
//             (gateway) sees the relay's IP and plaintext. Private ONLY if
//             the relay is run by a party that does not collude with the
//             operator — a standing external dependency the operator must
//             ATTEST (ZK_RELAY_THIRD_PARTY), because it cannot be checked.
//   tor     — SOCKS5 to an onion service. STUBBED (TODO): this environment
//             cannot exercise a Tor client; selecting it refuses to submit
//             rather than silently downgrading to direct.
//
// See lib/zk/anon/README.md for candidate public relays and the trust
// statement.
//
// PERSONA LAUNCH P7 — THE BROWSER DEVICE gets its own adapters for the same three kinds. A tab has no node:http (the
// device's node-net shim refuses it, on purpose), so in the browser `currentRelay()` returns the WEB adapters below,
// which call lib/zk/anon/webChannel.ts and nothing else: direct → the validator's web route (a CORS simple request,
// PoW in the query); ohttp → HPKE encapsulation in the tab, ciphertext to the relay the device environment names, the
// key configuration fetched through that relay (no relay URL = a refusal, never a fallback to direct); tor → refused.
// The node adapters above them are unchanged, byte for byte: the server-side device and accept-z1 still use them.
import { ZK_RELAY, ZK_RELAY_THIRD_PARTY, ZK_RELAY_URL, VALIDATOR_URL, type RelayKind } from "../config";
import { encodeRequest, decodeResponse } from "./bhttp";
import { isolatedRequest } from "./client";
import { encapsulateRequest, parseKeyConfig } from "./ohttp";
import { webGetDirect, webOhttpKeys, webOhttpPost, webSubmitDirect } from "./webChannel";

export interface RelaySendResult {
  httpStatus: number;
  body: Uint8Array;
  ms: number;
  /** node: true only when a keep-alive socket was reused (must be false). PERSONA LAUNCH P7: null on the web channel — a
   *  page cannot see or choose the browser's connection pooling (A-WEB-CHANNEL-DIRECT-UA) */
  reusedSocket: boolean | null;
  headersSent: string[];
}

export interface RelayAdapter {
  readonly kind: RelayKind;
  /** whether this adapter CAN decouple IP (direct: never) */
  readonly privacyCapable: boolean;
  /** send the submission body + headers; returns the (inner) HTTP response */
  send(body: Uint8Array, headers: Record<string, string>): Promise<RelaySendResult>;
  /** an ANONYMOUS GET of public material (the second-viewpoint head) over the same path */
  get(path: string): Promise<RelaySendResult>;
}

const SUBMIT_PATH = "/zk/anon/submit";
const HEAD_PATH = "/zk/anon/head";

export const directRelay: RelayAdapter = {
  kind: "direct",
  privacyCapable: false,
  async send(body, headers) {
    const r = await isolatedRequest(VALIDATOR_URL + SUBMIT_PATH, { method: "POST", headers, body });
    return { httpStatus: r.status, body: r.body, ms: r.ms, reusedSocket: r.reusedSocket, headersSent: r.headersSent };
  },
  async get(path) {
    const r = await isolatedRequest(VALIDATOR_URL + path, { method: "GET" });
    return { httpStatus: r.status, body: r.body, ms: r.ms, reusedSocket: r.reusedSocket, headersSent: r.headersSent };
  },
};

export function ohttpRelay(relayUrl: string): RelayAdapter {
  return {
    kind: "ohttp",
    privacyCapable: true,
    async send(body, headers) {
      if (!relayUrl) throw new Error("ohttp relay: ZK_RELAY_URL is not configured");
      // key config is fetched THROUGH the relay (never a direct contact
      // with the gateway from the client's IP)
      const keys = await isolatedRequest(relayUrl.replace(/\/$/, "") + "/keys", { method: "GET" });
      if (keys.status !== 200) throw new Error(`ohttp relay: key fetch HTTP ${keys.status}`);
      const cfg = parseKeyConfig(keys.body);
      const authority = new URL(VALIDATOR_URL).host;
      const inner = encodeRequest({ method: "POST", scheme: "http", authority, path: SUBMIT_PATH, headers, body });
      const enc = await encapsulateRequest(cfg, inner);
      const r = await isolatedRequest(relayUrl, { method: "POST", headers: { "content-type": "message/ohttp-req" }, body: enc.encRequest });
      if (r.status !== 200) throw new Error(`ohttp relay: HTTP ${r.status}`);
      let innerRes;
      try {
        innerRes = decodeResponse(await enc.open(r.body));
      } catch (e) {
        // an unopenable blob is the gateway's constant-shape refusal
        return { httpStatus: 200, body: new TextEncoder().encode(JSON.stringify({ outcome: "refused" })), ms: r.ms, reusedSocket: r.reusedSocket, headersSent: r.headersSent };
      }
      return { httpStatus: innerRes.status, body: innerRes.body, ms: r.ms, reusedSocket: r.reusedSocket, headersSent: r.headersSent };
    },
    async get(path) {
      if (!relayUrl) throw new Error("ohttp relay: ZK_RELAY_URL is not configured");
      const keys = await isolatedRequest(relayUrl.replace(/\/$/, "") + "/keys", { method: "GET" });
      if (keys.status !== 200) throw new Error(`ohttp relay: key fetch HTTP ${keys.status}`);
      const cfg = parseKeyConfig(keys.body);
      const authority = new URL(VALIDATOR_URL).host;
      const inner = encodeRequest({ method: "GET", scheme: "http", authority, path, headers: {}, body: new Uint8Array(0) });
      const enc = await encapsulateRequest(cfg, inner);
      const r = await isolatedRequest(relayUrl, { method: "POST", headers: { "content-type": "message/ohttp-req" }, body: enc.encRequest });
      if (r.status !== 200) throw new Error(`ohttp relay: HTTP ${r.status}`);
      const innerRes = decodeResponse(await enc.open(r.body)); // an unopenable blob throws: no head, a refusal upstream
      return { httpStatus: innerRes.status, body: innerRes.body, ms: r.ms, reusedSocket: r.reusedSocket, headersSent: r.headersSent };
    },
  };
}

export const torRelay: RelayAdapter = {
  kind: "tor",
  privacyCapable: true,
  async send() {
    // TODO(tor): SOCKS5 to an onion-service gateway. Not exercisable here;
    // refusing beats a silent downgrade to direct.
    throw new Error("tor relay is not available in this environment (stub) — refusing to submit rather than downgrade");
  },
  async get() {
    throw new Error("tor relay is not available in this environment (stub) — refusing to fetch rather than downgrade");
  },
};

/** THE SECOND VIEWPOINT (Pass 2 Gate 0): the newest history entry for
 * (mode, tree) as served over the ANONYMOUS path — no device envelope, no
 * cookies, a fresh socket, through the relay when one is configured. A
 * validator that forks the history per identity (attack-3's A-SPLIT-VIEW)
 * must now serve the same head to an unidentified caller, or be caught. */
export interface AnonHead {
  mode: string;
  tree: string;
  epoch: number;
  hash: string;
  root: string;
}
export async function anonymousHead(mode: string, tree: string): Promise<AnonHead> {
  const r = await currentRelay().get(`${HEAD_PATH}?mode=${encodeURIComponent(mode)}&tree=${encodeURIComponent(tree)}`);
  if (r.httpStatus !== 200) throw new Error(`anonymous head: HTTP ${r.httpStatus}`);
  const j = JSON.parse(new TextDecoder().decode(r.body)) as Partial<AnonHead>;
  if (j.mode !== mode || j.tree !== tree || !Number.isInteger(j.epoch) || !/^[0-9a-f]{64}$/.test(j.hash ?? "") || typeof j.root !== "string") {
    throw new Error("anonymous head: malformed");
  }
  return { mode, tree, epoch: j.epoch as number, hash: j.hash as string, root: j.root as string };
}

// Runtime override (dev/test only — the suites switch relays without a
// process restart). Production reads the env once.
interface RelayOverride {
  kind: RelayKind;
  url: string;
  thirdParty: boolean;
}
const g = globalThis as unknown as { __layersRelayOverride?: RelayOverride | null };
export function setRelayOverride(o: RelayOverride | null): void {
  g.__layersRelayOverride = o;
}

export interface RelayConfig {
  kind: RelayKind;
  url: string;
  thirdPartyAttested: boolean;
  privacyCapable: boolean;
}

export function relayConfig(): RelayConfig {
  const o = g.__layersRelayOverride;
  const kind = o?.kind ?? ZK_RELAY;
  const url = o?.url ?? ZK_RELAY_URL;
  const thirdPartyAttested = o?.thirdParty ?? ZK_RELAY_THIRD_PARTY;
  return { kind, url, thirdPartyAttested, privacyCapable: kind !== "direct" };
}

// ---------------------------------------------------------------- PERSONA LAUNCH P7: the browser device's adapters

/** true inside the browser device (the public preview's tab); the node device and the rig take the adapters above */
export function inBrowserDevice(): boolean {
  return typeof window !== "undefined";
}

/** which channel a submission leaves on HERE: "web" in the browser device, "node" on a server-side device */
export function relayChannel(): "node" | "web" {
  return inBrowserDevice() ? "web" : "node";
}

const webResult = (r: { status: number; body: Uint8Array; ms: number; headersSet: string[] }): RelaySendResult => ({ httpStatus: r.status, body: r.body, ms: r.ms, reusedSocket: null, headersSent: r.headersSet });

export const webDirectRelay: RelayAdapter = {
  kind: "direct",
  privacyCapable: false,
  async send(body, headers) {
    // the strict channel's x-zk-pow header becomes the web route's ?pow= (a custom header would force a preflight)
    return webResult(await webSubmitDirect(VALIDATOR_URL, body, headers["x-zk-pow"] ?? ""));
  },
  async get(path) {
    return webResult(await webGetDirect(VALIDATOR_URL, path));
  },
};

export function webOhttpRelay(relayUrl: string): RelayAdapter {
  const encapsulated = async (inner: Uint8Array) => {
    const keys = await webOhttpKeys(relayUrl); // throws on a missing or malformed relay URL: no fallback to direct
    if (keys.status !== 200) throw new Error(`ohttp relay: key fetch HTTP ${keys.status}`);
    const enc = await encapsulateRequest(parseKeyConfig(keys.body), inner);
    const r = await webOhttpPost(relayUrl, enc.encRequest);
    if (r.status !== 200) throw new Error(`ohttp relay: HTTP ${r.status}`);
    return { enc, r };
  };
  return {
    kind: "ohttp",
    privacyCapable: true,
    async send(body, headers) {
      const authority = new URL(VALIDATOR_URL).host;
      // the INNER request is the strict channel's, exactly: the gateway hands it to the same allowlist and classify
      const { enc, r } = await encapsulated(encodeRequest({ method: "POST", scheme: "http", authority, path: SUBMIT_PATH, headers, body }));
      let innerRes;
      try {
        innerRes = decodeResponse(await enc.open(r.body));
      } catch {
        // an unopenable blob is the gateway's constant-shape refusal
        return { httpStatus: 200, body: new TextEncoder().encode(JSON.stringify({ outcome: "refused" })), ms: r.ms, reusedSocket: null, headersSent: r.headersSet };
      }
      return { httpStatus: innerRes.status, body: innerRes.body, ms: r.ms, reusedSocket: null, headersSent: r.headersSet };
    },
    async get(path) {
      const authority = new URL(VALIDATOR_URL).host;
      const { enc, r } = await encapsulated(encodeRequest({ method: "GET", scheme: "http", authority, path, headers: {}, body: new Uint8Array(0) }));
      const innerRes = decodeResponse(await enc.open(r.body)); // an unopenable blob throws: no head, a refusal upstream
      return { httpStatus: innerRes.status, body: innerRes.body, ms: r.ms, reusedSocket: null, headersSent: r.headersSet };
    },
  };
}

export function currentRelay(): RelayAdapter {
  const c = relayConfig();
  if (inBrowserDevice()) {
    // PERSONA LAUNCH P7: the browser device — same three kinds, the web channel underneath; tor refuses here too
    if (c.kind === "ohttp") return webOhttpRelay(c.url);
    if (c.kind === "tor") return torRelay;
    return webDirectRelay;
  }
  if (c.kind === "ohttp") return ohttpRelay(c.url);
  if (c.kind === "tor") return torRelay;
  return directRelay;
}
