// POST AS YOU — FARCASTER MESSAGES BY HAND, IN THE BROWSER DEVICE. A TypeScript port of validator/hubmessage.js's message
// half (the validator's module is CommonJS and the device bundle never imports validator code): the same canonical
// protobuf, the same BLAKE3 hash, the same Ed25519 signature, so a message built here is byte for byte the message the
// validator's module builds for the same inputs (scripts/unit-root-post.mjs asserts it, and the loopback Snapchain stub's
// own decoder checks both). Uint8Array only (no Buffer): it runs in the tab.
//
// THE FORMAT (farcasterxyz/snapchain proto/definitions/message.proto, read 2026-11-05):
//   Message      { 1 data, 2 hash, 3 hash_scheme BLAKE3=1, 4 signature, 5 signature_scheme ED25519=1, 6 signer, 7 data_bytes }
//   MessageData  { 1 type, 2 fid, 3 timestamp (Farcaster seconds since 2021-01-01), 4 network MAINNET=1,
//                  5 cast_add_body | 6 cast_remove_body | 7 reaction_body }
//   CastAddBody  { 3 parent_cast_id: CastId, 4 text }   CastRemoveBody { 1 target_hash }   CastId { 1 fid, 2 hash }
//   ReactionBody { 1 type LIKE=1 | RECAST=2, 2 target_cast_id: CastId }
//   types: CAST_ADD=1, CAST_REMOVE=2, REACTION_ADD=3, REACTION_REMOVE=4
// hash = BLAKE3(MessageData bytes)[:20]; signature = Ed25519(hash). The same bytes go as data and data_bytes.
//
// SECRETS: the private key is an argument of makeMessage() only (lib/fc/rootSigner/store.ts holds it and calls this);
// nothing here keeps, logs or returns it.
import { blake3 } from "@noble/hashes/blake3";
import { ed25519 } from "@noble/curves/ed25519";

export const FARCASTER_EPOCH_MS = 1_609_459_200_000;
/** a regular cast's text limit in UTF-8 BYTES (the node's rule for CastType CAST); lib/fc/castLimits.ts says the same */
export const CAST_TEXT_MAX_BYTES = 320;
export const MESSAGE_TYPE = { CastAdd: 1, CastRemove: 2, ReactionAdd: 3, ReactionRemove: 4 } as const;
const REACTION_TYPE = { like: 1, recast: 2 } as const;
const HASH20_RE = /^0x[0-9a-f]{40}$/;
const te = new TextEncoder();

export interface CastId {
  fid: number;
  /** "0x" + 40 lowercase hex */
  hash: string;
}
export type HubBody =
  | { type: "CastAdd"; text: string; parent?: CastId | null }
  | { type: "CastRemove"; targetHash: string }
  | { type: "ReactionAdd" | "ReactionRemove"; reaction: "like" | "recast"; target: CastId };

export interface HubMessage {
  /** the protobuf Message, for POST /v1/submitMessage */
  bytes: Uint8Array;
  /** "0x" + 40 hex: the hash everyone will see */
  hash: string;
  /** the signer's public key, 64 lowercase hex */
  signer: string;
}

export function farcasterTime(ms: number): number {
  const t = Math.floor((ms - FARCASTER_EPOCH_MS) / 1000);
  if (!Number.isSafeInteger(t) || t < 0 || t > 0xffffffff) throw new Error("the timestamp is outside Farcaster time");
  return t;
}

// ---------------------------------------------------------------------------------------------- the wire format
// (no BigInt literals: the tsconfig targets below ES2020)
const B0 = BigInt(0);
const B7 = BigInt(7);
const B7F = BigInt(0x7f);
function varint(n: number | bigint): number[] {
  let v = BigInt(n);
  if (v < B0) throw new Error("varint: negative");
  const out: number[] = [];
  do {
    let b = Number(v & B7F);
    v >>= B7;
    if (v > B0) b |= 0x80;
    out.push(b);
  } while (v > B0);
  return out;
}
const tag = (field: number, wire: number) => varint((field << 3) | wire);
const fVarint = (field: number, v: number | bigint): number[] => (BigInt(v) === B0 ? [] : [...tag(field, 0), ...varint(v)]);
function fBytes(field: number, b: ArrayLike<number>, always = false): number[] {
  const arr = Array.from(b);
  if (!arr.length && !always) return [];
  return [...tag(field, 2), ...varint(arr.length), ...arr];
}
const fString = (field: number, s: string) => fBytes(field, te.encode(s));
export function hexToBytes(h: string): Uint8Array {
  const s = String(h).replace(/^0x/i, "");
  if (!/^([0-9a-fA-F]{2})*$/.test(s)) throw new Error("hex malformed");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

// ---------------------------------------------------------------------------------------------- the rules
function castIdProblem(c: CastId | null | undefined): string | null {
  if (!c || typeof c !== "object") return "no cast id";
  if (!Number.isSafeInteger(c.fid) || c.fid <= 0) return "the cast's fid is malformed";
  return HASH20_RE.test(String(c.hash || "")) ? null : "the cast's hash is malformed";
}
/** what is wrong with a body (plain words), or null — the node's own limits, checked before anything is signed */
export function bodyProblem(body: HubBody | null | undefined): string | null {
  if (!body || typeof body !== "object") return "no message body";
  if (body.type === "CastAdd") {
    if (typeof body.text !== "string" || body.text === "") return "the cast's text is missing";
    if (te.encode(body.text).length > CAST_TEXT_MAX_BYTES) return `the cast is longer than ${CAST_TEXT_MAX_BYTES} bytes`;
    if (body.parent !== undefined && body.parent !== null && castIdProblem(body.parent)) return "the reply's parent cast is malformed";
    return null;
  }
  if (body.type === "CastRemove") return HASH20_RE.test(String(body.targetHash || "")) ? null : "the removed cast's hash is malformed";
  if (body.type === "ReactionAdd" || body.type === "ReactionRemove") {
    if (!(body.reaction in REACTION_TYPE)) return "the reaction is not a like or a recast";
    return castIdProblem(body.target) ? "the reaction's target cast is malformed" : null;
  }
  return "the message type is not one Totem sends as you";
}
const castIdBytes = (c: CastId) => [...fVarint(1, c.fid), ...fBytes(2, hexToBytes(c.hash))];

/** MessageData's canonical bytes */
export function encodeMessageData(fid: number, timestampMs: number, body: HubBody): Uint8Array {
  if (!Number.isSafeInteger(fid) || fid <= 0) throw new Error("fid malformed");
  const problem = bodyProblem(body);
  if (problem) throw new Error(problem);
  const head = [...fVarint(1, MESSAGE_TYPE[body.type]), ...fVarint(2, fid), ...fVarint(3, farcasterTime(timestampMs)), ...fVarint(4, 1)];
  let b: number[];
  if (body.type === "CastAdd") b = fBytes(5, [...(body.parent ? fBytes(3, castIdBytes(body.parent), true) : []), ...fString(4, body.text)], true);
  else if (body.type === "CastRemove") b = fBytes(6, fBytes(1, hexToBytes(body.targetHash)), true);
  else b = fBytes(7, [...fVarint(1, REACTION_TYPE[body.reaction]), ...fBytes(2, castIdBytes(body.target), true)], true);
  return Uint8Array.from([...head, ...b]);
}

/** Build and sign one message with the Ed25519 private key (64 hex). Throws on a body the node would refuse. */
export function makeMessage({ fid, timestampMs = Date.now(), body, privateKeyHex }: { fid: number; timestampMs?: number; body: HubBody; privateKeyHex: string }): HubMessage {
  if (!/^[0-9a-f]{64}$/.test(privateKeyHex)) throw new Error("the signer key is not a 64-hex Ed25519 private key");
  const priv = hexToBytes(privateKeyHex);
  const pub = ed25519.getPublicKey(priv);
  const dataBytes = encodeMessageData(fid, timestampMs, body);
  const hash = blake3(dataBytes, { dkLen: 20 });
  const sig = ed25519.sign(hash, priv);
  const bytes = Uint8Array.from([...fBytes(1, dataBytes, true), ...fBytes(2, hash), ...fVarint(3, 1), ...fBytes(4, sig), ...fVarint(5, 1), ...fBytes(6, pub), ...fBytes(7, dataBytes, true)]);
  return { bytes, hash: "0x" + bytesToHex(hash), signer: bytesToHex(pub) };
}

/** the public key (64 lowercase hex) of an Ed25519 private key (64 hex) */
export function publicKeyHex(privateKeyHex: string): string {
  return bytesToHex(ed25519.getPublicKey(hexToBytes(privateKeyHex)));
}
