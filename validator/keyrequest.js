"use strict";
// POST AS YOU — THE APP ACCOUNT'S KEY REQUESTS AND THE THIN HUB RELAY (the public validator's side).
//
// A signed-in visitor's browser device makes an Ed25519 key for the visitor's OWN Farcaster account (the root: their
// existing fid) and keeps it sealed in their vault (lib/fc/rootSigner/store.ts). For Farcaster to accept that key, the
// visitor approves it in the Farcaster app, and the approval needs a SignedKeyRequest: an EIP-712 signature by the custody
// of the APP that asks (Totem's own app account, FC_APP_FID). That custody key lives here, on the PUBLIC validator only
// (FC_APP_CUSTODY_KEY; the public app refuses it at boot: lib/platform/env-contract.ts APP_ONLY_REFUSES). This process uses
// it to sign key requests and nothing else, and holds no signer. As the custody it COULD add a key to the app account (and
// so post as @ontotem, whose one signer, the profile key, stays on the owner's laptop) or move the app fid; it can never add
// a key to a visitor's account (SECURITY-POSTURE.md §35).
//
//   GET  /fc/app-account          public: { ready, appFid, custodyAddress, sponsored, ttlSec, problems } (names, never values)
//   POST /fc/key-request {key}    sign the SignedKeyRequest for `key` (0x + 64 hex, a usable Ed25519 point) and create the
//                                 signed key request with Farcaster's API (POST /v2/signed-key-requests) → 201 { token,
//                                 deeplinkUrl, key, requestFid, deadline, state, sponsored }
//   GET  /fc/key-request?token=   one look at Farcaster's GET /v2/signed-key-request → { token, key, state, userFid }
//   POST /fc/hub/submit           application/octet-stream: ONE already-signed Farcaster message, forwarded unchanged to
//                                 FC_HUB_URL's POST /v1/submitMessage. The public Snapchain node allows browser CORS on
//                                 its reads but not on submitMessage (it requires Content-Type application/octet-stream,
//                                 which a browser preflights, and it answers OPTIONS 404: snapchain src/network/
//                                 http_server.rs handle_protobuf_request, checked 2026-11-05). The relay cannot alter a
//                                 message: the node checks the hash and the Ed25519 signature against the KeyRegistry.
//
// THE FARCASTER API (verified 2026-11-05: docs.neynar.com/farcaster/reference/farcaster/signer-requests, the Farcaster
// docs mirror; and live, read-only: GET https://api.farcaster.xyz/v2/signed-key-request?token=<unknown> answers 400 {"errors":
// [{"message":"No signed key request found with token ..."}]} with Access-Control-Allow-Origin *):
//   POST https://api.farcaster.xyz/v2/signed-key-requests  { key, requestFid, signature, deadline, sponsorship? }
//        → { result: { signedKeyRequest: { token, deeplinkUrl, key, state: "pending" } } }
//   GET  https://api.farcaster.xyz/v2/signed-key-request?token=…
//        → { result: { signedKeyRequest: { token, deeplinkUrl, key, state: pending|approved|completed, userFid? } } }
// FC_KEY_REQUEST_API_URL overrides the base: https, or loopback http off a hosting platform (the tests' stub).
//
// SPONSORSHIP (FC_APP_SPONSOR=on, default off): the same page's "Sponsoring a signer": the request carries
// { sponsorFid, signature } where the signature is an EIP-191 message whose raw bytes are the key request signature,
// signed by the sponsor's custody; then the visitor's Farcaster app shows the fee as paid by the app. Farcaster requires
// the sponsoring account to be signed up in the Farcaster app with at least 100 warps; Totem's app account is a bare
// protocol account, so this stays off until the owner has done that (notes/runbooks/GO-LIVE-TODAY.md). Without it the visitor's own
// Farcaster app asks THEM for the network fee.
//
// FAIL CLOSED, NEVER SILENT: an unarmed account answers 503 with what is missing; Farcaster's refusal or silence is a 502
// with its own short words; nothing here is retried into a different answer. NEVER LOGGED: the custody key, a user's key,
// a token, a deeplink, a message. The only log lines are counts.
const express = require("express");
const { isUsablePubkey } = require("./crypto");
const { edgeClientAddress } = require("./caps");
const eip = require("./eip712");
const hub = require("./hubmessage");
const { blake3 } = require("@noble/hashes/blake3");
const { ed25519 } = require("@noble/curves/ed25519");

const DEFAULT_API = "https://api.farcaster.xyz";
const DEFAULT_HUB = "https://snap.farcaster.xyz:3381";
const TTL_DEFAULT = 900; // 15 minutes: long enough to approve on a phone, short enough that a link someone else made goes stale fast
const TTL_MIN = 600;
const TTL_MAX = 86_400;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** per client address: new key requests an hour; polls an hour; relayed messages an hour */
const LIMITS = Object.freeze({ requestsPerAddressHour: 6, requestsPerHour: 600, pollsPerAddressHour: 1800, submitsPerAddressHour: 240, submitsPerFidDay: 500 });
const MAX_MESSAGE_BYTES = 4096;
/** the message types the relay forwards: casts, their removal, likes/recasts and their removal (snapchain message.proto) */
const RELAYED_TYPES = new Set([1, 2, 3, 4]);
const TOKEN_RE = /^[A-Za-z0-9_-]{8,160}$/;
const KEY_RE = /^0x[0-9a-f]{64}$/;
/** where a deeplink may point: the Farcaster app's own scheme, or its web hosts (the device checks the same list) */
const DEEPLINK_HOSTS = Object.freeze(["farcaster.xyz", "www.farcaster.xyz", "client.farcaster.xyz", "warpcast.com", "www.warpcast.com", "client.warpcast.com"]);

const isLoopbackHost = (h) => {
  const x = String(h).trim().toLowerCase().replace(/^\[|\]$/g, "");
  return x === "localhost" || x === "::1" || /^127\.\d+\.\d+\.\d+$/.test(x);
};
const hosted = (env) => require("./env-contract").isHostedPlatform(env);

/** an API/hub base: https (no credentials, query or fragment), or loopback http off a hosting platform */
function baseOf(raw, dflt, isHosted) {
  const s = String(raw ?? "").trim();
  if (!s) return { base: dflt, error: null };
  let u;
  try {
    u = new URL(s);
  } catch {
    return { base: null, error: "not a URL" };
  }
  if (u.username || u.password || u.search || u.hash) return { base: null, error: "carries credentials, a query or a fragment" };
  if (/(^|\.)neynar\.com$/i.test(u.hostname)) return { base: null, error: "is a Neynar address (this path does not depend on Neynar)" };
  if (u.protocol === "https:" || (u.protocol === "http:" && isLoopbackHost(u.hostname) && !isHosted)) return { base: u.origin + u.pathname.replace(/\/+$/, ""), error: null };
  return { base: null, error: "must be an https address" };
}

/**
 * The app account as this process's environment has it: { ready, appFid, custodyAddress, sponsored, ttlSec, api, hub,
 * problems }. Names only in `problems`, never a value. The key itself is read at call time (signRequest), never kept.
 */
function appAccount(env = process.env) {
  const problems = [];
  const rawFid = String(env.FC_APP_FID ?? "").trim();
  const fid = /^[1-9]\d{0,15}$/.test(rawFid) ? Number(rawFid) : null;
  if (!rawFid) problems.push("FC_APP_FID is unset (Totem's app account number)");
  else if (!Number.isSafeInteger(fid)) problems.push("FC_APP_FID is not a positive whole number");
  const key = String(env.FC_APP_CUSTODY_KEY ?? "").trim();
  const custodyAddress = key ? eip.custodyAddressOf(key) : null;
  if (!key) problems.push("FC_APP_CUSTODY_KEY is unset (the app account's custody key)");
  else if (!custodyAddress) problems.push("FC_APP_CUSTODY_KEY is not a 0x + 64 hex secp256k1 private key");
  const anonFid = String(env.FC_ANON_FID ?? "").trim();
  if (fid && anonFid && anonFid === String(fid)) problems.push("FC_APP_FID is the @anon account's fid (the app account must be its own account)");
  const isHosted = hosted(env);
  const api = baseOf(env.FC_KEY_REQUEST_API_URL, DEFAULT_API, isHosted);
  if (api.error) problems.push("FC_KEY_REQUEST_API_URL " + api.error);
  const hubBase = baseOf(env.FC_HUB_URL, DEFAULT_HUB, isHosted);
  if (hubBase.error) problems.push("FC_HUB_URL " + hubBase.error);
  const rawTtl = String(env.FC_KEY_REQUEST_TTL_SEC ?? "").trim();
  let ttlSec = TTL_DEFAULT;
  if (rawTtl) {
    const n = Number(rawTtl);
    if (Number.isSafeInteger(n) && n >= TTL_MIN && n <= TTL_MAX) ttlSec = n;
    else problems.push("FC_KEY_REQUEST_TTL_SEC must be a whole number of seconds from " + TTL_MIN + " to " + TTL_MAX);
  }
  const sponsorRaw = String(env.FC_APP_SPONSOR ?? "").trim().toLowerCase();
  if (sponsorRaw && !["on", "off", "true", "false", "0", "1"].includes(sponsorRaw)) problems.push("FC_APP_SPONSOR must be on or off");
  const sponsored = sponsorRaw === "on" || sponsorRaw === "true" || sponsorRaw === "1";
  return { ready: problems.length === 0, appFid: fid, custodyAddress, sponsored, ttlSec, api: api.base, hub: hubBase.base, problems };
}

/** a JSON fetch with a timeout: { status, json, text } (never throws on an HTTP status; throws on no answer) */
async function getJson(url, init, timeoutMs = 15_000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}
/** Farcaster's own short refusal (its "errors"[0].message, else its text), bounded; never anything of ours */
function farcasterWords(r) {
  const j = r && r.json;
  const m = j && Array.isArray(j.errors) && j.errors[0] && typeof j.errors[0].message === "string" ? j.errors[0].message : typeof (j && j.message) === "string" ? j.message : r ? r.text : "";
  return String(m || "").replace(/\s+/g, " ").slice(0, 200) || "HTTP " + (r ? r.status : 0);
}
/** is this deeplink one the Farcaster app opens (its scheme, or one of its web hosts), carrying the token? */
function deeplinkOk(url, token) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  const carries = String(url).includes(token);
  if (u.protocol === "farcaster:") return carries;
  return u.protocol === "https:" && DEEPLINK_HOSTS.includes(u.hostname.toLowerCase()) && carries;
}
function readRequest(j) {
  const r = j && j.result && j.result.signedKeyRequest;
  if (!r || typeof r !== "object") return null;
  const token = typeof r.token === "string" ? r.token : "";
  const key = typeof r.key === "string" ? r.key.toLowerCase() : "";
  const state = typeof r.state === "string" ? r.state : "";
  const userFid = Number.isSafeInteger(r.userFid) && r.userFid > 0 ? r.userFid : null;
  return { token, key, state, userFid, deeplinkUrl: typeof r.deeplinkUrl === "string" ? r.deeplinkUrl : "" };
}

// ---------------------------------------------------------------------------------------------- the message check
function readVarint(b, i) {
  let v = 0n;
  let s = 0n;
  for (let n = 0; n < 10; n++) {
    if (i >= b.length) throw new Error("truncated");
    const x = b[i++];
    v |= BigInt(x & 0x7f) << s;
    if (!(x & 0x80)) return [v, i];
    s += 7n;
  }
  throw new Error("varint too long");
}
/** { field: [values] } for one protobuf message (varints as BigInt, length-delimited as Uint8Array); throws on junk */
function decodeProto(b) {
  const out = {};
  let i = 0;
  while (i < b.length) {
    let key;
    [key, i] = readVarint(b, i);
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    let val;
    if (wire === 0) [val, i] = readVarint(b, i);
    else if (wire === 2) {
      let len;
      [len, i] = readVarint(b, i);
      if (i + Number(len) > b.length) throw new Error("truncated");
      val = b.subarray(i, i + Number(len));
      i += Number(len);
    } else if (wire === 5) {
      if (i + 4 > b.length) throw new Error("truncated");
      val = b.subarray(i, i + 4);
      i += 4;
    } else if (wire === 1) {
      if (i + 8 > b.length) throw new Error("truncated");
      val = b.subarray(i, i + 8);
      i += 8;
    } else throw new Error("unsupported wire type");
    if (field <= 0) throw new Error("bad field");
    (out[field] ??= []).push(val);
  }
  return out;
}
const one = (o, f) => (o[f] ? o[f][0] : undefined);
/**
 * What the relay checks BEFORE forwarding (the node checks it all again, against the chain): a Message with BLAKE3 /
 * Ed25519, a 20-byte hash that IS the BLAKE3 of its data bytes, a valid signature by its signer over that hash, a
 * relayed type on MAINNET with a fid. → { fid, type, hash } or a plain-words refusal. It reads; it never rewrites.
 */
function checkMessage(bytes) {
  let m, d, dataBytes;
  try {
    m = decodeProto(bytes);
    dataBytes = one(m, 7) ?? one(m, 1);
    if (!(dataBytes instanceof Uint8Array)) return { error: "the message has no data" };
    d = decodeProto(dataBytes);
  } catch {
    return { error: "the message is not a Farcaster message" };
  }
  const hash = one(m, 2);
  const sig = one(m, 4);
  const signer = one(m, 6);
  if (!(hash instanceof Uint8Array) || hash.length !== 20 || !(sig instanceof Uint8Array) || sig.length !== 64 || !(signer instanceof Uint8Array) || signer.length !== 32) return { error: "the message's hash, signature or signer is malformed" };
  if (Number(one(m, 3) ?? 0n) !== 1 || Number(one(m, 5) ?? 0n) !== 1) return { error: "the message is not BLAKE3 / Ed25519" };
  if (Buffer.compare(Buffer.from(blake3(dataBytes, { dkLen: 20 })), Buffer.from(hash)) !== 0) return { error: "the message's hash does not match its data" };
  let sigOk = false;
  try {
    sigOk = ed25519.verify(sig, hash, signer);
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { error: "the message's signature does not verify" };
  const type = Number(one(d, 1) ?? 0n);
  const fidBig = one(d, 2) ?? 0n;
  if (typeof fidBig !== "bigint" || fidBig <= 0n || fidBig > BigInt(Number.MAX_SAFE_INTEGER)) return { error: "the message names no account" };
  if (Number(one(d, 4) ?? 0n) !== 1) return { error: "the message is not for Farcaster mainnet" };
  if (!RELAYED_TYPES.has(type)) return { error: "this relay forwards casts, deletes, likes and recasts only" };
  return { fid: Number(fidBig), type, hash: "0x" + Buffer.from(hash).toString("hex"), signer: Buffer.from(signer).toString("hex") };
}

// ---------------------------------------------------------------------------------------------- the routes
function mountKeyRequest(app, { devHooks = false, trustProxy = process.env.TRUST_PROXY === "true", log = console, now = () => Date.now(), limits = LIMITS } = {}) {
  const caps = limits; // the tests shrink the caps; production uses the frozen defaults
  const buckets = new Map(); // "kind|key" → { n, at }
  const counts = { requests: 0, refused: 0, submits: 0, hubRefused: 0 };
  const address = (req) => edgeClientAddress(req, trustProxy);
  /** take one from a bucket; → seconds to wait when it is empty, else 0 */
  const take = (kind, key, max, windowMs) => {
    if (devHooks) return 0;
    const t = now();
    const k = kind + "|" + key;
    let b = buckets.get(k);
    if (!b || t - b.at >= windowMs) {
      b = { n: 0, at: t };
      buckets.set(k, b);
    }
    if (b.n >= max) return Math.max(1, Math.ceil((b.at + windowMs - t) / 1000));
    b.n++;
    return 0;
  };
  /** is a bucket empty? (looks, never takes) → seconds to wait, else 0 */
  const full = (kind, key, max, windowMs) => {
    if (devHooks) return 0;
    const t = now();
    const b = buckets.get(kind + "|" + key);
    if (!b || t - b.at >= windowMs || b.n < max) return 0;
    return Math.max(1, Math.ceil((b.at + windowMs - t) / 1000));
  };
  const sweep = setInterval(() => {
    const t = now();
    for (const [k, b] of buckets) if (t - b.at >= DAY) buckets.delete(k);
    if (counts.requests || counts.refused || counts.submits || counts.hubRefused) {
      log.log("[post-as-you] last 10 min: " + counts.requests + " key request(s), " + counts.refused + " refused, " + counts.submits + " relayed message(s), " + counts.hubRefused + " refused by the hub");
      counts.requests = counts.refused = counts.submits = counts.hubRefused = 0;
    }
  }, 600_000);
  if (sweep.unref) sweep.unref();
  const limited = (res, retry, what) => {
    res.setHeader("Retry-After", String(retry));
    return res.status(429).json({ error: "Too many " + what + " from this address just now. Try again in a few minutes.", code: "rate_limited", retryAfterSeconds: retry });
  };
  const notArmed = (res, acct) => res.status(503).json({ error: "Posting as your own account isn't switched on on this site yet.", code: "not_armed", problems: acct.problems });

  app.get("/fc/app-account", (req, res) => {
    const a = appAccount();
    res.setHeader("Cache-Control", "no-store");
    res.json({ ready: a.ready, appFid: a.appFid, custodyAddress: a.custodyAddress, sponsored: a.sponsored, ttlSec: a.ttlSec, problems: a.problems });
  });

  app.post("/fc/key-request", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const acct = appAccount();
    if (!acct.ready) return notArmed(res, acct);
    const key = typeof (req.body && req.body.key) === "string" ? req.body.key.trim().toLowerCase() : "";
    if (!KEY_RE.test(key) || !isUsablePubkey(key.slice(2))) return res.status(400).json({ error: "That is not an Ed25519 public key (0x + 64 hex, a usable point).", code: "bad_key" });
    const wait = take("req-addr", address(req), caps.requestsPerAddressHour, HOUR) || take("req-all", "*", caps.requestsPerHour, HOUR);
    if (wait) {
      counts.refused++;
      return limited(res, wait, "key requests");
    }
    const deadline = Math.floor(now() / 1000) + acct.ttlSec;
    let signature;
    let sponsorship;
    try {
      // the custody key is read HERE, at call time, and goes no further than the signer
      const privHex = String(process.env.FC_APP_CUSTODY_KEY ?? "").trim();
      signature = eip.signKeyRequest({ privHex, requestFid: acct.appFid, key, deadline });
      if (acct.sponsored) sponsorship = { sponsorFid: acct.appFid, signature: eip.signSponsorship({ privHex, keyRequestSignature: signature }) };
    } catch {
      return res.status(503).json({ error: "The app account could not sign the request.", code: "not_armed", problems: ["FC_APP_CUSTODY_KEY could not sign"] });
    }
    const body = { key, requestFid: acct.appFid, signature, deadline, ...(sponsorship ? { sponsorship } : {}) };
    let r = null;
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      try {
        r = await getJson(acct.api + "/v2/signed-key-requests", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
      } catch {
        r = null; // no answer: tried once more, then said
      }
    }
    if (!r) {
      counts.refused++;
      return res.status(502).json({ error: "Farcaster's key request service did not answer. Try again in a moment.", code: "farcaster_unreachable" });
    }
    if (r.status < 200 || r.status >= 300) {
      counts.refused++;
      return res.status(502).json({ error: "Farcaster refused the key request: " + farcasterWords(r), code: "farcaster_refused", status: r.status });
    }
    const got = readRequest(r.json);
    if (!got || !TOKEN_RE.test(got.token) || got.key !== key || !deeplinkOk(got.deeplinkUrl, got.token)) {
      counts.refused++;
      return res.status(502).json({ error: "Farcaster's answer to the key request was not one this site can use (a different key, or a link it does not recognise). Nothing was shown.", code: "farcaster_answer" });
    }
    counts.requests++;
    return res.status(201).json({ token: got.token, deeplinkUrl: got.deeplinkUrl, key, requestFid: acct.appFid, deadline, state: got.state || "pending", sponsored: !!sponsorship });
  });

  app.get("/fc/key-request", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const acct = appAccount();
    if (!acct.ready) return notArmed(res, acct);
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: "That is not a key request token.", code: "bad_token" });
    const wait = take("poll-addr", address(req), caps.pollsPerAddressHour, HOUR);
    if (wait) return limited(res, wait, "checks");
    let r;
    try {
      r = await getJson(acct.api + "/v2/signed-key-request?token=" + encodeURIComponent(token), { headers: { accept: "application/json" } });
    } catch {
      return res.status(502).json({ error: "Farcaster's key request service did not answer. Checking again shortly.", code: "farcaster_unreachable" });
    }
    if (r.status === 400 || r.status === 404) {
      if (/not ?found|no signed key request/i.test(farcasterWords(r))) return res.status(404).json({ error: "Farcaster has no such key request (it expired, or it was never made).", code: "not_found" });
    }
    if (r.status < 200 || r.status >= 300) return res.status(502).json({ error: "Farcaster could not be asked about the key request: " + farcasterWords(r), code: "farcaster_refused", status: r.status });
    const got = readRequest(r.json);
    if (!got || got.token !== token || !KEY_RE.test(got.key) || !["pending", "approved", "completed"].includes(got.state)) return res.status(502).json({ error: "Farcaster's answer about the key request was not one this site can read.", code: "farcaster_answer" });
    return res.json({ token, key: got.key, state: got.state, userFid: got.userFid });
  });

  const raw = express.raw({ type: () => true, limit: MAX_MESSAGE_BYTES });
  app.post(
    "/fc/hub/submit",
    (req, res, next) => {
      if (String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/octet-stream") return res.status(415).json({ error: "Send the signed message as application/octet-stream.", code: "bad_type" });
      raw(req, res, (err) => (err ? res.status(err.status === 413 ? 413 : 400).json({ error: err.status === 413 ? "The message is larger than " + MAX_MESSAGE_BYTES + " bytes." : "The message could not be read.", code: "bad_message" }) : next()));
    },
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const acct = appAccount();
      if (!acct.ready) return notArmed(res, acct);
      const bytes = req.body instanceof Buffer ? new Uint8Array(req.body) : new Uint8Array(0);
      if (!bytes.length) return res.status(400).json({ error: "No message was sent.", code: "bad_message" });
      const c = checkMessage(bytes);
      if (c.error) return res.status(400).json({ error: "Not relayed: " + c.error + ".", code: "bad_message" });
      // the account's daily cap is only LOOKED at here and spent once the node takes the message: anyone can sign junk
      // naming any fid with a key of their own, and that junk must never use up a real account's day (the node refuses
      // a key the account never added; only then would a take() here have burned the victim's allowance)
      const wait = take("sub-addr", address(req), caps.submitsPerAddressHour, HOUR) || full("sub-fid", String(c.fid), caps.submitsPerFidDay, DAY);
      if (wait) return limited(res, wait, "posts");
      let r;
      try {
        r = await hub.submitMessage(acct.hub, { bytes, hash: c.hash });
      } catch {
        return res.status(502).json({ error: "Farcaster's node did not answer. Nothing was posted; try again.", code: "hub_unreachable" });
      }
      if (!r.ok) {
        counts.hubRefused++;
        return res.status(502).json({ error: "Farcaster's node refused it: " + (r.error || "HTTP " + r.status), code: "hub_refused", status: r.status });
      }
      take("sub-fid", String(c.fid), caps.submitsPerFidDay, DAY);
      counts.submits++;
      return res.json({ ok: true, hash: c.hash, fid: c.fid, type: c.type });
    }
  );
  return { appAccount, checkMessage, limits: caps, stop: () => clearInterval(sweep) };
}

module.exports = { mountKeyRequest, appAccount, checkMessage, deeplinkOk, DEEPLINK_HOSTS, LIMITS, MAX_MESSAGE_BYTES };
