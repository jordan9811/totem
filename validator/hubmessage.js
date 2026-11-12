"use strict";
// THE HUB ROUTE (Neynar-free @anon) — FARCASTER MESSAGES BY HAND, AND THE HUB'S HTTP API. The public @anon relay
// (validator/anonpublic.js, ZK_ANON_TRANSPORT=hub) and the owner's one-time account script
// (scripts/owner/make-anon-account.mjs) build, sign and submit Farcaster protocol messages here, straight to a
// Snapchain node's HTTP API (FC_HUB_URL), with no Neynar SDK, no Neynar key and no managed signer: the account's own
// Ed25519 signer key (registered on the KeyRegistry by the account's custody) signs every message, and the node checks
// the signature against the chain itself.
//
// THE FORMAT (farcasterxyz/snapchain proto/message.proto; checked live against snap.farcaster.xyz:3381 on 2026-11-04 —
// a CastAdd built here for a real fid, signed by an UNREGISTERED key, is refused for its signer, after the node decoded
// it and checked its hash and signature: see docs/mechanism/anon-relay.md "The hub route"):
//   Message      { 1 data: MessageData, 2 hash: bytes, 3 hash_scheme: BLAKE3=1, 4 signature: bytes,
//                  5 signature_scheme: ED25519=1, 6 signer: bytes, 7 data_bytes: bytes }
//   MessageData  { 1 type, 2 fid: uint64, 3 timestamp: uint32 (seconds since 2021-01-01T00:00:00Z), 4 network: MAINNET=1,
//                  then ONE body: 5 cast_add_body | 6 cast_remove_body | 7 reaction_body | 12 user_data_body }
//   CastAddBody  { 3 parent_cast_id: CastId (a reply), 4 text, 8 type: CAST=0 (the default, omitted) }
//   CastRemoveBody { 1 target_hash: bytes }                               CastId { 1 fid: uint64, 2 hash: bytes }
//   ReactionBody { 1 type: LIKE=1 | RECAST=2, 2 target_cast_id: CastId }
//   UserDataBody { 1 type: PFP=1 | DISPLAY=2 | BIO=3 | URL=5 | USERNAME=6, 2 value: string }
//   types: CAST_ADD=1, CAST_REMOVE=2, REACTION_ADD=3, REACTION_REMOVE=4, USER_DATA_ADD=11
// POST AS YOU added the reply parent and the reactions (field numbers from farcasterxyz/snapchain
// proto/definitions/message.proto, read 2026-11-05); lib/fc/hub/message.ts is this module's TypeScript port for the browser
// device, and scripts/unit-root-post.mjs asserts the two produce IDENTICAL bytes for the same inputs.
// hash = BLAKE3(MessageData bytes), first 20 bytes; signature = Ed25519(hash) by the signer key. The encoding is canonical
// proto3 (fields in number order, defaults omitted) and the same bytes are ALSO sent as data_bytes, so a node that hashes
// data_bytes and one that re-encodes data agree.
//
// SECRETS: the signer's private key is an argument to sign() and makeMessage() only; nothing here logs, stores or returns
// it, and no error message carries it.
const { blake3 } = require("@noble/hashes/blake3");
const { ed25519 } = require("@noble/curves/ed25519");

const FARCASTER_EPOCH_MS = 1_609_459_200_000;
const NETWORK_MAINNET = 1;
/** a regular cast's text limit, in UTF-8 BYTES (the node's rule for CastType CAST) */
const CAST_TEXT_MAX_BYTES = 320;
const USER_DATA = Object.freeze({ pfp: { type: 1, max: 256 }, display: { type: 2, max: 32 }, bio: { type: 3, max: 256 }, url: { type: 5, max: 256 }, username: { type: 6, max: 16 } });
const MESSAGE_TYPE = Object.freeze({ CastAdd: 1, CastRemove: 2, ReactionAdd: 3, ReactionRemove: 4, UserDataAdd: 11 });
const REACTION_TYPE = Object.freeze({ like: 1, recast: 2 });
const HASH20_RE = /^0x[0-9a-f]{40}$/;
const KEY_HEX_RE = /^(0x)?[0-9a-fA-F]{64}$/;
const te = new TextEncoder();

/** Farcaster time: whole seconds since 2021-01-01T00:00:00Z */
function farcasterTime(ms) {
  const t = Math.floor((ms - FARCASTER_EPOCH_MS) / 1000);
  if (!Number.isSafeInteger(t) || t < 0 || t > 0xffffffff) throw new Error("the timestamp is outside Farcaster time");
  return t;
}
const fromFarcasterTime = (t) => FARCASTER_EPOCH_MS + Number(t) * 1000;

// ---------------------------------------------------------------------------------------------- the wire format
function varint(n) {
  let v = BigInt(n);
  if (v < 0n) throw new Error("varint: negative");
  const out = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return out;
}
const tag = (field, wire) => varint((field << 3) | wire);
/** a varint field, omitted at its default (0) */
const fVarint = (field, v) => (BigInt(v) === 0n ? [] : [...tag(field, 0), ...varint(v)]);
/** a length-delimited field; `always` keeps an empty one (a oneof member is present even when empty) */
function fBytes(field, b, always = false) {
  const arr = Array.from(b);
  if (!arr.length && !always) return [];
  return [...tag(field, 2), ...varint(arr.length), ...arr];
}
const fString = (field, s) => fBytes(field, te.encode(s));
function hexBytes(h) {
  const s = String(h).replace(/^0x/i, "");
  if (!/^([0-9a-fA-F]{2})*$/.test(s)) throw new Error("hex malformed");
  return Uint8Array.from(Buffer.from(s, "hex"));
}
const toHex = (b) => Buffer.from(b).toString("hex");

// ---------------------------------------------------------------------------------------------- the rules
/** what is wrong with a body (plain words), or null — the node's own limits, checked before anything is signed */
function bodyProblem(body) {
  if (!body || typeof body !== "object") return "no message body";
  if (body.type === "CastAdd") {
    if (typeof body.text !== "string" || body.text === "") return "the cast's text is missing";
    if (te.encode(body.text).length > CAST_TEXT_MAX_BYTES) return `the cast is longer than ${CAST_TEXT_MAX_BYTES} bytes`;
    if (body.parent !== undefined && body.parent !== null && castIdProblem(body.parent)) return "the reply's parent cast is malformed";
    return null;
  }
  if (body.type === "ReactionAdd" || body.type === "ReactionRemove") {
    if (!REACTION_TYPE[body.reaction]) return "the reaction is not a like or a recast";
    return castIdProblem(body.target) ? "the reaction's target cast is malformed" : null;
  }
  if (body.type === "CastRemove") return HASH20_RE.test(String(body.targetHash || "")) ? null : "the removed cast's hash is malformed";
  if (body.type === "UserDataAdd") {
    const f = USER_DATA[body.field];
    if (!f) return "the profile field is unknown";
    if (typeof body.value !== "string" || te.encode(body.value).length > f.max) return `the ${body.field} is longer than ${f.max} bytes`;
    if (body.field === "username" && body.value !== "" && !/^[a-z0-9][a-z0-9-]{0,15}$/.test(body.value)) return "the username is not a Farcaster name";
    return null;
  }
  return "the message type is not one this relay sends";
}

/** what is wrong with a CastId { fid, hash } (plain words), or null */
function castIdProblem(c) {
  if (!c || typeof c !== "object") return "no cast id";
  if (!Number.isSafeInteger(c.fid) || c.fid <= 0) return "the cast's fid is malformed";
  return HASH20_RE.test(String(c.hash || "")) ? null : "the cast's hash is malformed";
}
const castIdBytes = (c) => [...fVarint(1, c.fid), ...fBytes(2, hexBytes(c.hash))];
/** MessageData's canonical bytes */
function encodeMessageData(fid, timestampMs, body, network = NETWORK_MAINNET) {
  if (!Number.isSafeInteger(fid) || fid <= 0) throw new Error("fid malformed");
  const problem = bodyProblem(body);
  if (problem) throw new Error(problem);
  const head = [...fVarint(1, MESSAGE_TYPE[body.type]), ...fVarint(2, fid), ...fVarint(3, farcasterTime(timestampMs)), ...fVarint(4, network)];
  let b;
  if (body.type === "CastAdd") b = fBytes(5, [...(body.parent ? fBytes(3, castIdBytes(body.parent), true) : []), ...fString(4, body.text)], true);
  else if (body.type === "CastRemove") b = fBytes(6, fBytes(1, hexBytes(body.targetHash)), true);
  else if (body.type === "ReactionAdd" || body.type === "ReactionRemove") b = fBytes(7, [...fVarint(1, REACTION_TYPE[body.reaction]), ...fBytes(2, castIdBytes(body.target), true)], true);
  else b = fBytes(12, [...fVarint(1, USER_DATA[body.field].type), ...fString(2, body.value)], true);
  return Uint8Array.from([...head, ...b]);
}
/** BLAKE3 of the MessageData bytes, the first 20 bytes */
const messageHash = (dataBytes) => blake3(dataBytes, { dkLen: 20 });
/** the Message bytes: data AND data_bytes (the same canonical bytes), the hash, the signature, the signer */
function encodeMessage(dataBytes, hash, signature, signerPub) {
  if (hash.length !== 20 || signature.length !== 64 || signerPub.length !== 32) throw new Error("the hash, signature or signer has the wrong length");
  return Uint8Array.from([...fBytes(1, dataBytes, true), ...fBytes(2, hash), ...fVarint(3, 1), ...fBytes(4, signature), ...fVarint(5, 1), ...fBytes(6, signerPub), ...fBytes(7, dataBytes, true)]);
}

// ---------------------------------------------------------------------------------------------- the signer
/** is this an Ed25519 private key (32 bytes as 64 hex, optional 0x)? */
const isSignerKey = (k) => typeof k === "string" && KEY_HEX_RE.test(k.trim());
/** the signer's PUBLIC key (64 lowercase hex) for a private key, or null when it is not one */
function signerPublicKey(privHex) {
  if (!isSignerKey(privHex)) return null;
  try {
    return toHex(ed25519.getPublicKey(hexBytes(privHex.trim())));
  } catch {
    return null;
  }
}

/**
 * Build and sign one message: { bytes (the protobuf Message, for POST /v1/submitMessage), hash ("0x" + 40 hex: the hash
 * everyone will see), signer (64 hex) }. Throws on a body the node would refuse (plain words) or a malformed key.
 */
function makeMessage({ fid, timestampMs = Date.now(), body, privateKey, network = NETWORK_MAINNET }) {
  if (!isSignerKey(privateKey)) throw new Error("the signer key is not a 64-hex Ed25519 private key");
  const priv = hexBytes(privateKey.trim());
  const pub = ed25519.getPublicKey(priv);
  const dataBytes = encodeMessageData(fid, timestampMs, body, network);
  const hash = messageHash(dataBytes);
  const sig = ed25519.sign(hash, priv);
  return { bytes: encodeMessage(dataBytes, hash, sig, pub), hash: "0x" + toHex(hash), signer: toHex(pub), dataBytes };
}

// ---------------------------------------------------------------------------------------------- the hub's HTTP API
const isLoopbackHost = (h) => {
  const x = String(h).trim().toLowerCase().replace(/^\[|\]$/g, "");
  return x === "localhost" || x === "::1" || /^127\.\d+\.\d+\.\d+$/.test(x);
};
/** a usable hub base: https, or (tests only, never on a hosting platform) loopback http; no credentials, query or hash */
function hubBaseOf(raw, hosted = false) {
  const s = String(raw ?? "").trim();
  if (!s) return { base: null, error: "FC_HUB_URL is unset (a Snapchain node's HTTP API, e.g. https://snap.farcaster.xyz:3381)" };
  let u;
  try {
    u = new URL(s);
  } catch {
    return { base: null, error: "FC_HUB_URL is not a URL" };
  }
  if (u.username || u.password || u.search || u.hash) return { base: null, error: "FC_HUB_URL carries credentials, a query or a fragment" };
  if (/(^|\.)neynar\.com$/i.test(u.hostname)) return { base: null, error: "FC_HUB_URL is a Neynar address (the hub route exists so @anon does not depend on Neynar)" };
  if (u.protocol === "https:" || (u.protocol === "http:" && isLoopbackHost(u.hostname) && !hosted)) return { base: u.origin + u.pathname.replace(/\/+$/, ""), error: null };
  return { base: null, error: "FC_HUB_URL must be an https address" };
}
async function readText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
/** the node's own short refusal (its errCode and words), never anything of ours */
function hubWords(text) {
  try {
    const j = JSON.parse(text);
    const parts = [j.errCode, j.code, j.error_detail || j.details || j.message || j.error].filter((x) => typeof x === "string" && x);
    if (parts.length) return parts.join(": ").replace(/\s+/g, " ").slice(0, 240);
  } catch {
    /* not JSON */
  }
  return String(text || "").replace(/\s+/g, " ").slice(0, 240);
}

/**
 * POST one Message to <base>/v1/submitMessage (application/octet-stream, no key). ONE attempt (the callers own their
 * bounded retries). → { ok, status, hash, error }: ok only on a 2xx whose answer names this message's hash (or no hash);
 * a node that answers another hash is NOT ok (never take a different message for ours).
 */
async function submitMessage(base, msg, timeoutMs = 30_000) {
  const res = await fetch(base + "/v1/submitMessage", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: Buffer.from(msg.bytes), signal: AbortSignal.timeout(timeoutMs) });
  const text = await readText(res);
  if (!res.ok) return { ok: false, status: res.status, hash: null, error: hubWords(text) || "HTTP " + res.status };
  let answered = null;
  try {
    const j = JSON.parse(text);
    if (j && typeof j.hash === "string") answered = j.hash.toLowerCase();
  } catch {
    answered = null;
  }
  if (answered && answered !== msg.hash) return { ok: false, status: res.status, hash: null, error: "the node answered a different message hash" };
  return { ok: true, status: res.status, hash: msg.hash, error: null };
}

async function getJson(url, timeoutMs = 15_000) {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await readText(res);
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}
/** is `pubHex` an ACTIVE Ed25519 signer (keyType 1) of `fid`, per the node's GET /v1/onChainSignersByFid? true / false;
 *  THROWS when the node could not be read (never "no" for "unknown") */
async function signerActive(base, fid, pubHex) {
  const want = "0x" + String(pubHex).toLowerCase().replace(/^0x/, "");
  const r = await getJson(base + "/v1/onChainSignersByFid?fid=" + encodeURIComponent(String(fid)) + "&signer=" + want);
  if (r.status === 404 || (r.status === 400 && /not ?found|no.*signer/i.test(r.text))) return false;
  if (r.status !== 200 || !r.json || !Array.isArray(r.json.events)) throw new Error("the hub's signer list could not be read (HTTP " + r.status + ")");
  let active = false;
  for (const e of r.json.events) {
    const b = e && e.signerEventBody;
    if (!b || Number(e.fid) !== Number(fid) || String(b.key || "").toLowerCase() !== want) continue;
    if (Number(b.keyType) !== 1) continue;
    if (b.eventType === "SIGNER_EVENT_TYPE_ADD") active = true;
    else if (b.eventType === "SIGNER_EVENT_TYPE_REMOVE") active = false;
  }
  return active;
}
/** a node's cast message as { hash, text, at (ms), fid } (null when it is not a plain CastAdd) */
function castOf(m) {
  const d = m && m.data;
  if (!d || d.type !== "MESSAGE_TYPE_CAST_ADD" || !d.castAddBody || typeof m.hash !== "string") return null;
  const hash = m.hash.toLowerCase();
  if (!HASH20_RE.test(hash)) return null;
  return { hash, text: typeof d.castAddBody.text === "string" ? d.castAddBody.text : "", at: Number.isFinite(Number(d.timestamp)) ? fromFarcasterTime(d.timestamp) : null, fid: Number(d.fid), reply: !!(d.castAddBody.parentCastId || d.castAddBody.parentUrl) };
}
/** the newest casts of `fid` (GET /v1/castsByFid?reverse=true), at most `pageSize` (1..100); THROWS when unread */
async function castsByFid(base, fid, pageSize = 50) {
  const n = Math.max(1, Math.min(100, Math.floor(Number(pageSize) || 50)));
  const r = await getJson(base + "/v1/castsByFid?fid=" + encodeURIComponent(String(fid)) + "&pageSize=" + n + "&reverse=true");
  if (r.status !== 200 || !r.json || !Array.isArray(r.json.messages)) throw new Error("the hub's cast list could not be read (HTTP " + r.status + ")");
  return r.json.messages.map(castOf).filter((c) => c && c.fid === Number(fid));
}
/** one cast of `fid` by its hash (GET /v1/castById): the cast, or null when the node says it is not there; THROWS when unread */
async function castById(base, fid, hash) {
  if (!HASH20_RE.test(String(hash))) return null;
  const r = await getJson(base + "/v1/castById?fid=" + encodeURIComponent(String(fid)) + "&hash=" + hash);
  if (r.status === 404 || (r.status >= 400 && r.status < 500 && /not ?found/i.test(r.text))) return null;
  if (r.status !== 200 || !r.json) throw new Error("the hub's cast could not be read (HTTP " + r.status + ")");
  const c = castOf(r.json);
  return c && c.fid === Number(fid) && c.hash === hash ? c : null;
}

module.exports = {
  FARCASTER_EPOCH_MS,
  CAST_TEXT_MAX_BYTES,
  USER_DATA,
  MESSAGE_TYPE,
  REACTION_TYPE,
  farcasterTime,
  bodyProblem,
  encodeMessageData,
  messageHash,
  encodeMessage,
  isSignerKey,
  signerPublicKey,
  makeMessage,
  hubBaseOf,
  hubWords,
  submitMessage,
  signerActive,
  castsByFid,
  castById,
  castOf,
};
