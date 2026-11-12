// PERSONA LAUNCH P7 — THE BROWSER'S ANONYMOUS CHANNEL. The one module that sends anything for the anonymous path from a
// browser tab; lib/zk/anon/relay.ts picks it in the browser device and calls only the functions below (relay.ts,
// submit.ts and client.ts contain no request call of their own: accept-z1 check 4 greps them).
//
// WHY A SEPARATE CHANNEL. The node device sends over a fresh socket with an exact header set (client.ts isolatedRequest,
// agent:false). A browser has no sockets to choose: the page's own network stack sends, adds the headers every page of
// this browser build adds (user-agent, origin, accept-language, client hints, sec-fetch-*), and pools connections. What
// a page CAN control is everything identifying it would otherwise attach, and every request here pins it:
//   credentials "omit"         no cookie, no HTTP auth, no client certificate — nothing that names a session
//   referrerPolicy "no-referrer"  no Referer: the validator never learns which page of the app the visitor was on
//   cache "no-store"           nothing of this exchange stays in the HTTP cache to be read back later
//   redirect "error"           a redirect is a refusal, never a second hop to somewhere the visitor did not choose
//   mode "cors", keepalive false  an ordinary cross-origin request that dies with the tab, never a beacon after it
//   content-type text/plain;charset=UTF-8 and NO other header — a CORS "simple request": no preflight, and the
//                              validator's Access-Control-Allow-Headers stays as it is (validator/server.js)
//   a body of exactly ZK_SUBMIT_BYTES (attack-1 finding 6's padding: a relay's log cannot join submissions by length)
//   the proof of work in the QUERY (?pow=), because a custom header would force a preflight
// The validator's web routes (validator/anon.js POST /zk/anon/web, GET /zk/anon/web/head) tolerate exactly the
// browser-forced headers and refuse cookie / authorization / x-layers-* / referer whatever else holds.
//
// WHAT IT DOES NOT HIDE, said plainly (lib/zk/anon/README.md): under the DIRECT relay the operator sees the visitor's IP
// and the browser's user-agent on every submission (A-WEB-CHANNEL-DIRECT-UA) — the privacy label stays DEMO until a
// third-party OHTTP relay is configured. OHTTP-READY: with ZK_RELAY=ohttp the request is encapsulated IN THE TAB (HPKE,
// ohttp.ts + bhttp.ts) and only ciphertext goes to the relay; the gateway's key configuration is fetched THROUGH the
// relay URL the device environment names, and there is never a silent fallback to direct. Tor stays refused.
import { ZK_SUBMIT_BYTES } from "../config";

export const WEB_SUBMIT_PATH = "/zk/anon/web";
export const WEB_HEAD_PATH = "/zk/anon/web/head";
export const WEB_CONTENT_TYPE = "text/plain;charset=UTF-8";
export const OHTTP_CONTENT_TYPE = "message/ohttp-req";
export const WEB_TIMEOUT_MS = 30_000;

/** the fixed part of EVERY request this channel makes (method, headers, body and the timeout signal are added per call) */
export const WEB_FETCH_INIT = Object.freeze({
  credentials: "omit",
  referrerPolicy: "no-referrer",
  cache: "no-store",
  redirect: "error",
  mode: "cors",
  keepalive: false,
} as const);

export interface WebSendResult {
  status: number;
  body: Uint8Array;
  ms: number;
  /** the headers THIS code set (the browser adds its own; the page cannot list them) */
  headersSet: string[];
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** a URL this channel may talk to: http(s) with no userinfo; plain http only to a loopback host (the rig and the test
 *  relay), never across a network */
function checkedUrl(raw: string, what: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`web channel: the ${what} URL is not a URL — refusing to send`);
  }
  if (u.username || u.password) throw new Error(`web channel: the ${what} URL carries credentials — refusing to send`);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOOPBACK.test(u.hostname))) throw new Error(`web channel: the ${what} URL must be https (plain http only on this machine) — refusing to send`);
  return u;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  const A = globalThis.AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal } | undefined;
  return A && typeof A.timeout === "function" ? A.timeout(ms) : undefined;
}

/** THE request of this channel — every send below goes through here and nowhere else */
async function channelSend(url: URL, method: "GET" | "POST", headers: Record<string, string>, body?: Uint8Array): Promise<WebSendResult> {
  const init: RequestInit = { ...WEB_FETCH_INIT, method, headers, signal: timeoutSignal(WEB_TIMEOUT_MS) };
  if (body) init.body = body as unknown as BodyInit;
  const t0 = performance.now();
  const res = await globalThis.fetch(url.href, init);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, body: bytes, ms: performance.now() - t0, headersSet: Object.keys(headers) };
}

const baseOf = (validatorUrl: string): URL => checkedUrl(validatorUrl.replace(/\/+$/, ""), "validator");

/** DIRECT: one padded submission to the validator's web route — a simple request, PoW in the query */
export async function webSubmitDirect(validatorUrl: string, body: Uint8Array, powNonce: string): Promise<WebSendResult> {
  if (!(body instanceof Uint8Array) || body.length !== ZK_SUBMIT_BYTES) throw new Error("web channel: the body is not the constant request size — refused, never sent unpadded");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(powNonce)) throw new Error("web channel: no proof of work for this body — refused");
  const base = baseOf(validatorUrl);
  const url = new URL(base.href.replace(/\/+$/, "") + WEB_SUBMIT_PATH);
  url.search = "?pow=" + encodeURIComponent(powNonce);
  return channelSend(url, "POST", { "content-type": WEB_CONTENT_TYPE }, body);
}

/** DIRECT: the second viewpoint's public head — the strict path (/zk/anon/head?…) is mapped onto the web route; any
 *  other path is refused (this channel GETs nothing else) */
export async function webGetDirect(validatorUrl: string, strictPath: string): Promise<WebSendResult> {
  const m = /^\/zk\/anon\/head(\?[^#]*)?$/.exec(strictPath);
  if (!m) throw new Error("web channel: only the anonymous history head is read over this channel");
  const base = baseOf(validatorUrl);
  const url = new URL(base.href.replace(/\/+$/, "") + WEB_HEAD_PATH + (m[1] ?? ""));
  return channelSend(url, "GET", {});
}

const relayBase = (relayUrl: string): URL => {
  if (!relayUrl) throw new Error("web channel: the OHTTP relay URL is not configured (ZK_RELAY_URL) — refusing; never a fallback to direct");
  return checkedUrl(relayUrl, "OHTTP relay");
};

/** OHTTP: the gateway's key configuration, fetched THROUGH the relay (never a direct contact with the gateway) */
export async function webOhttpKeys(relayUrl: string): Promise<WebSendResult> {
  const r = relayBase(relayUrl);
  return channelSend(new URL(r.href.replace(/\/+$/, "") + "/keys"), "GET", {});
}

/** OHTTP: one encapsulated request to the relay — ciphertext only; the relay sees this tab's IP, the gateway the relay's */
export async function webOhttpPost(relayUrl: string, encRequest: Uint8Array): Promise<WebSendResult> {
  const r = relayBase(relayUrl);
  return channelSend(r, "POST", { "content-type": OHTTP_CONTENT_TYPE }, encRequest);
}
