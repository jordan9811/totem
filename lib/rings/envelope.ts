// PERSONA LAUNCH P4 — THE RING ENVELOPE (pure, isomorphic: the owner's device seals, a member's device and the /d card
// open, the node harness drives both; no fetch, no state, no "server-only").
//
// WHY THIS SHAPE (research/spec-friend-whitelist-2026-10-08.txt §2, adapted for rings; plan R8 / D8):
//   * HPKE (RFC 9180) in PSK mode, the suite the device already ships for root linking (lib/device/rootlink.ts):
//     X25519 + HKDF-SHA256 + AES-256-GCM. The PSK is the second half of the member's private address, its id is the
//     address id — so an envelope sealed to address A fails under address B even if a PSK leaked between them, and a
//     party holding only the public key (an operator who saw the address) cannot seal a note the member would accept.
//   * ONE FIXED PLAINTEXT SIZE for every envelope (4096 bytes): a statement is JSON padded with trailing spaces (which
//     JSON.parse ignores) to exactly ENVELOPE_PLAINTEXT_BYTES. A statement that does not fit is REFUSED at seal, never
//     truncated; thumbnails are the first thing dropped. Every row on the drop therefore has the same ct length
//     (8224 hex), real or dummy, one subject or ten.
//   * A 2-byte HINT = HKDF(psk, salt = enc): a member's device checks one HKDF per (row, address) and runs the X25519
//     only on a match. The operator cannot compute it without the PSK, and enc is fresh per envelope, so hints never
//     link one member's envelopes across generations (A-DROP-HINT-IS-A-PRF).
//   * DUMMIES are byte-shaped like real rows by construction: a real ephemeral X25519 public key as enc, CSPRNG bytes
//     of the real ct length, a random hint.
//   * No signature anywhere (deniable v1): a member who leaks a note leaks a claim, not a proof.
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Buffer, createHash, hkdfSha256, randomBytes } from "@/lib/platform/crypto";

export const ENVELOPE_PLAINTEXT_BYTES = 4096;
/** AES-256-GCM adds a 16-byte tag; the hex the drop stores is twice that */
export const ENVELOPE_CT_BYTES = ENVELOPE_PLAINTEXT_BYTES + 16;
export const ENVELOPE_CT_HEX_LEN = ENVELOPE_CT_BYTES * 2; // 8224 — a DELIBERATE DUPLICATE of validator/ringdrop.js
/** PERSONA LAUNCH P4 (W2-RINGS-DROP-FILL-DOS): a statement's lease is at most the publisher's 72 hours (it re-seals
 *  hourly), never the week the first cut allowed — the drop's own row ceiling (validator/ringdrop.js) is 72 h plus a
 *  little clock slack, so a row can occupy the shared table for three days at most */
export const MAX_LEASE_HOURS = 72;
export const ADDRESS_PREFIX = "LR1.";
/** the link a plain-Farcaster friend opens: the key rides the fragment, which never reaches a server */
export const LINK_PATH = "/d#";

export const ROW_ID_RE = /^[0-9a-f]{32}$/;
export const ENC_RE = /^[0-9a-f]{64}$/;
export const CT_RE = new RegExp(`^[0-9a-f]{${ENVELOPE_CT_HEX_LEN}}$`);
export const HINT_RE = /^[0-9a-f]{4}$/;
export const HASH_RE = /^[0-9a-f]{64}$/;
export const TOKEN_RE = /^[0-9a-f]{64}$/;
export const HEX16_RE = /^[0-9a-f]{16}$/;
export const ADDR_ID_RE = /^[0-9a-f]{32}$/;

const INFO = "layers-ring/envelope/v1";
const HINT_INFO = "layers-ring/hint/v1";
const ADDR_DOMAIN = "layers-ring/addr/v1|";
const LINK_KEM_INFO = "layers-ring/link/kem/v1";
const LINK_PSK_INFO = "layers-ring/link/psk/v1";

const te = new TextEncoder();
const td = new TextDecoder();
export const toHex = (b: ArrayBuffer | Uint8Array): string => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("hex");
export const fromHex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));
const ab = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

let suiteRef: CipherSuite | null = null;
/** one suite per process; built lazily so a module that only needs the shapes never touches WebCrypto */
export function ringSuite(): CipherSuite {
  return (suiteRef ??= new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() }));
}

// ------------------------------------------------------------------------------------------------ the statement

export type RingDepth = "name" | "posts";

/**
 * One stretch of a persona's note-key CHAIN a member may use (PERSONA LAUNCH P4 — W2-RINGS-KEEP3-HISTORY-LOSS, LP-5).
 * `keyHex` is the key of the first generation the member may open; the member derives `n` keys from it, each the one-way
 * step of the one before (lib/rings/note.ts chainNext). Why a chain: a member ADDED to the audience gets a key one step
 * on and cannot step back, so it never opens what was posted before it joined — while everyone already in the audience
 * steps forward to the new key from what it holds, so a routine add costs them NOTHING they already saw (the first cut
 * drew a fresh random key per add and kept three, so three adds erased every member's history). A revoke or a lowering
 * starts a fresh RANDOM chain nobody outside the remaining audience can reach. NO generation number is sealed (LP-5).
 * PERSONA LAUNCH wave 3 (L5, corrected claim): `n` is rounded up to a multiple of 4, which hides only where the member's
 * own stretch starts and ends: a member derives every later step itself, so the step difference between two notes it
 * opens is the exact number of audience joins in between, in any ring holding the persona at "posts", and a new stretch
 * brackets a revoke (A-RING-NOTE-INDEX-COUNTS-JOINS, SECURITY-POSTURE.md §24). PERSONA LAUNCH GO-LIVE: kept named, not
 * fixed — lib/rings/model.ts advance() says which guarantee each schedule-based fix would trade away.
 */
export interface RingNoteKey {
  keyHex: string;
  n: number;
}

/** One persona the ring sees. `ref` is an opaque per-persona token the owner's device drew — never the persona id —
 *  and it is what a ring note's plaintext names. noteKeys only at depth "posts": at most MAX_NOTE_KEYS chain stretches,
 *  covering every post made since the member was let in (bounded by the chains the owner keeps, lib/rings/model.ts). */
export interface RingSubject {
  ref: string;
  handle: string;
  display: string;
  fid?: number;
  kind: "persona" | "main";
  depth: RingDepth;
  thumb?: string;
  noteKeys?: RingNoteKey[];
}

/** The root's public face (the main account, read on the owner's device ONLY through rootHeadshot()); null when the
 *  owner has no main account connected — the member then sees the ring's label in its place. */
export interface RingRoot {
  fname: string;
  displayName: string | null;
  thumb?: string;
}

/**
 * SPEC C — CLOSE-FRIEND SENDS. A Farcaster post the ring's owner sent the ring, by its protocol id only (never its text,
 * never its author's name: the member's device shows it only if it already holds that very cast from reading its own
 * Following, so a send can neither put words in someone's mouth nor make the member's browser read anything). Rides
 * the same fixed-size sealed statement as everything else a ring tells its members: a send adds no row, no byte on the
 * drop, and says nothing to the operator about who received it.
 */
export interface RingSend {
  fid: number;
  /** the cast's hash, 0x + 40 hex */
  hash: string;
  /** when it was sent, epoch ms rounded down to the minute */
  at: number;
}
/** the newest sends a ring keeps for its members (a fifth pushes the oldest out) */
export const MAX_RING_SENDS = 4;
/** a send is told to the ring for at most this long (the publisher's lease: three days) */
export const RING_SEND_TTL_MS = MAX_LEASE_HOURS * 3_600_000;
export const RING_SEND_HASH_RE = /^0x[0-9a-f]{40}$/;

export interface RingStatement {
  v: 1;
  /** the address this envelope was sealed to (a member checks it equals the address that opened it) */
  addrId: string;
  /** the ring's own random id: one address may sit in several rings (and in several owners' rings) */
  rid: string;
  /** monotonic per (ring, member) — a re-served older generation never overrides a newer one */
  seq: number;
  issuedAt: number;
  expiresAt: number;
  /** how the owner wants to be named on the member's card ("Inner", "Jordan") */
  label: string;
  root: RingRoot | null;
  subjects: RingSubject[];
  /** SPEC C: posts the owner sent this ring, newest first (absent = none; a member running older code ignores it) */
  sends?: RingSend[];
}

export const LABEL_MAX = 48;
export const DISPLAY_MAX = 48;
export const HANDLE_MAX = 64;
export const THUMB_MAX = 1200;
export const MAX_SUBJECTS = 16;
/** chain stretches per subject: a fresh chain starts only on a revoke, a lowering or a full chain — so three cover a
 *  member's whole history unless two revokes or lowerings (or about 64 joins) happened since it joined */
export const MAX_NOTE_KEYS = 3;
/** the longest chain, in generations — a DELIBERATE DUPLICATE of lib/rings/model.ts NOTE_SEGMENT_MAX_GENS */
export const NOTE_CHAIN_MAX = 32;
const FNAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const HANDLE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** a thumbnail is an INLINE image the owner's device already holds — never a URL (a member would fetch it) */
export function thumbOk(t: unknown): t is string {
  return typeof t === "string" && t.length <= THUMB_MAX && /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/.test(t);
}

/** plain text for a label or a display name: printable, no control characters, trimmed, bounded */
export function plainText(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || t.length > max) return null;
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(t)) return null;
  return t;
}

/**
 * Validate an OPENED statement. Returns the statement or the reason it is refused. Everything a member's device will
 * render passes through here: a statement that is not exactly this shape is ignored and counted (never rendered).
 */
export function validateStatement(x: unknown, addrId: string, now: number): { ok: true; statement: RingStatement } | { ok: false; reason: string } {
  const s = x as Partial<RingStatement> | null;
  if (!s || typeof s !== "object") return { ok: false, reason: "not an object" };
  if (s.v !== 1) return { ok: false, reason: "version" };
  if (s.addrId !== addrId) return { ok: false, reason: "sealed to another address" };
  if (typeof s.rid !== "string" || !HEX16_RE.test(s.rid)) return { ok: false, reason: "ring id" };
  if (!Number.isSafeInteger(s.seq) || (s.seq as number) < 0) return { ok: false, reason: "seq" };
  if (!Number.isSafeInteger(s.issuedAt) || !Number.isSafeInteger(s.expiresAt)) return { ok: false, reason: "times" };
  if ((s.issuedAt as number) > now + 5 * 60_000) return { ok: false, reason: "issued in the future" };
  if ((s.expiresAt as number) <= now) return { ok: false, reason: "expired" };
  if ((s.expiresAt as number) - (s.issuedAt as number) > MAX_LEASE_HOURS * 3_600_000) return { ok: false, reason: "lease longer than " + MAX_LEASE_HOURS + " hours" };
  if (plainText(s.label, LABEL_MAX) === null) return { ok: false, reason: "label" };
  if (s.root !== null) {
    const r = s.root as Partial<RingRoot> | undefined;
    if (!r || typeof r !== "object") return { ok: false, reason: "root" };
    if (typeof r.fname !== "string" || !FNAME_RE.test(r.fname)) return { ok: false, reason: "root fname" };
    if (r.displayName !== null && plainText(r.displayName, DISPLAY_MAX) === null) return { ok: false, reason: "root display name" };
    if (r.thumb !== undefined && !thumbOk(r.thumb)) return { ok: false, reason: "root thumbnail" };
  }
  if (!Array.isArray(s.subjects) || s.subjects.length > MAX_SUBJECTS) return { ok: false, reason: "subjects" };
  const refs = new Set<string>();
  for (const sub of s.subjects as Partial<RingSubject>[]) {
    if (!sub || typeof sub !== "object") return { ok: false, reason: "subject" };
    if (typeof sub.ref !== "string" || !HEX16_RE.test(sub.ref) || refs.has(sub.ref)) return { ok: false, reason: "subject ref" };
    refs.add(sub.ref);
    if (typeof sub.handle !== "string" || !HANDLE_RE.test(sub.handle)) return { ok: false, reason: "subject handle" };
    if (plainText(sub.display, DISPLAY_MAX) === null) return { ok: false, reason: "subject display" };
    if (sub.fid !== undefined && !(Number.isSafeInteger(sub.fid) && (sub.fid as number) > 0 && (sub.fid as number) < 2 ** 31)) return { ok: false, reason: "subject fid" };
    if (sub.kind !== "persona" && sub.kind !== "main") return { ok: false, reason: "subject kind" };
    if (sub.depth !== "name" && sub.depth !== "posts") return { ok: false, reason: "subject depth" };
    if (sub.thumb !== undefined && !thumbOk(sub.thumb)) return { ok: false, reason: "subject thumbnail" };
    if (sub.noteKeys !== undefined) {
      if (sub.depth !== "posts") return { ok: false, reason: "note keys on a name-only subject" };
      if (!Array.isArray(sub.noteKeys) || sub.noteKeys.length > MAX_NOTE_KEYS) return { ok: false, reason: "note keys" };
      // exactly {keyHex, n}: a generation number (or anything else) riding a key is refused (LP-5)
      for (const k of sub.noteKeys as Partial<RingNoteKey>[]) {
        if (!k || typeof k !== "object" || Object.keys(k).sort().join() !== "keyHex,n") return { ok: false, reason: "note key shape" };
        if (typeof k.keyHex !== "string" || !/^[0-9a-f]{64}$/.test(k.keyHex)) return { ok: false, reason: "note key" };
        if (!Number.isSafeInteger(k.n) || (k.n as number) < 1 || (k.n as number) > NOTE_CHAIN_MAX) return { ok: false, reason: "note key span" };
      }
    }
  }
  // SPEC C: sends — exactly {fid, hash, at}, at most MAX_RING_SENDS, none from the future. Anything else refuses the whole
  // statement (a half-checked note is never rendered)
  if (s.sends !== undefined) {
    if (!Array.isArray(s.sends) || s.sends.length > MAX_RING_SENDS) return { ok: false, reason: "sends" };
    for (const x of s.sends as Partial<RingSend>[]) {
      if (!x || typeof x !== "object" || Object.keys(x).sort().join() !== "at,fid,hash") return { ok: false, reason: "send shape" };
      if (!Number.isSafeInteger(x.fid) || (x.fid as number) <= 0 || (x.fid as number) >= 2 ** 40) return { ok: false, reason: "send fid" };
      if (typeof x.hash !== "string" || !RING_SEND_HASH_RE.test(x.hash)) return { ok: false, reason: "send hash" };
      if (!Number.isSafeInteger(x.at) || (x.at as number) <= 0 || (x.at as number) > now + 5 * 60_000) return { ok: false, reason: "send time" };
    }
  }
  return { ok: true, statement: s as RingStatement };
}

export class RingStatementTooLarge extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super(`this ring's note is ${bytes} bytes, over the ${ENVELOPE_PLAINTEXT_BYTES}-byte envelope even without pictures — share fewer personas with this ring`);
    this.name = "RingStatementTooLarge";
    this.bytes = bytes;
  }
}

/** the same statement without any thumbnail (the first thing dropped when a statement does not fit) */
export function withoutThumbs(s: RingStatement): RingStatement {
  return {
    ...s,
    root: s.root ? { fname: s.root.fname, displayName: s.root.displayName } : null,
    subjects: s.subjects.map((x) => {
      const { thumb: _t, ...rest } = x;
      void _t;
      return rest;
    }),
  };
}

/** the padded plaintext, exactly ENVELOPE_PLAINTEXT_BYTES; thumbnails dropped first, then (SPEC C) the sends — a send
 *  never makes a ring's note stop fitting; REFUSED (thrown) if still over */
export function encodeStatement(s: RingStatement): { bytes: Uint8Array; thumbsDropped: boolean; sendsDropped?: boolean } {
  let json = JSON.stringify(s);
  let raw = te.encode(json);
  let thumbsDropped = false;
  let sendsDropped = false;
  if (raw.length > ENVELOPE_PLAINTEXT_BYTES) {
    json = JSON.stringify(withoutThumbs(s));
    raw = te.encode(json);
    thumbsDropped = true;
  }
  if (raw.length > ENVELOPE_PLAINTEXT_BYTES && s.sends?.length) {
    const { sends: _s, ...rest } = withoutThumbs(s);
    void _s;
    json = JSON.stringify(rest);
    raw = te.encode(json);
    sendsDropped = true;
  }
  if (raw.length > ENVELOPE_PLAINTEXT_BYTES) throw new RingStatementTooLarge(raw.length);
  const out = new Uint8Array(ENVELOPE_PLAINTEXT_BYTES);
  out.fill(0x20);
  out.set(raw, 0);
  return { bytes: out, thumbsDropped, ...(sendsDropped ? { sendsDropped } : {}) };
}

// ------------------------------------------------------------------------------------------------ addresses and keys

export const addrIdOf = (pkHex: string): string => createHash("sha256").update(ADDR_DOMAIN + pkHex, "utf8").digest("hex").slice(0, 32);

export function hintFor(pskHex: string, encHex: string): string {
  return toHex(hkdfSha256(fromHex(pskHex), fromHex(encHex), HINT_INFO, 2));
}

/** what a member's device holds per address (memory only; the ikm and psk come off the seed in the keystore) */
export interface InboxKey {
  addrId: string;
  pkHex: string;
  pskHex: string;
  kp: CryptoKeyPair;
}

/** the address keys from the keystore's material: an X25519 pair derived from ikm, the PSK as given */
export async function inboxKeyFrom(ikm: Uint8Array, psk: Uint8Array): Promise<InboxKey> {
  if (ikm.length !== 32 || psk.length !== 32) throw new Error("ring inbox material must be 32 + 32 bytes");
  const kp = await ringSuite().kem.deriveKeyPair(ab(ikm));
  const pkHex = toHex(await ringSuite().kem.serializePublicKey(kp.publicKey));
  return { addrId: addrIdOf(pkHex), pkHex, pskHex: toHex(psk), kp };
}

// base64url by hand: the browser's Buffer polyfill (buffer@6) has no "base64url" encoding, and the address must be
// byte-identical whichever host made it
const toB64url = (b: Uint8Array): string => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return new Uint8Array(Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64"));
};

/** the private address a member hands an owner: "LR1." + base64url(addrId(16) | pk(32) | psk(32)) */
export function addressString(k: { addrId: string; pkHex: string; pskHex: string }): string {
  const bytes = new Uint8Array(80);
  bytes.set(fromHex(k.addrId), 0);
  bytes.set(fromHex(k.pkHex), 16);
  bytes.set(fromHex(k.pskHex), 48);
  return ADDRESS_PREFIX + toB64url(bytes);
}

/** parse and CHECK a pasted address (a typo, a truncated paste and a tampered key all fail the addrId recomputation) */
export function parseAddress(input: string): { ok: true; addrId: string; pkHex: string; pskHex: string } | { ok: false; reason: string } {
  const s = String(input ?? "").trim();
  if (!s.startsWith(ADDRESS_PREFIX)) return { ok: false, reason: "that isn't a ring address — it should start with " + ADDRESS_PREFIX };
  const body = s.slice(ADDRESS_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{100,120}$/.test(body)) return { ok: false, reason: "that ring address is incomplete or has extra characters" };
  const bytes = fromB64url(body);
  if (bytes.length !== 80) return { ok: false, reason: "that ring address is the wrong length — copy it again" };
  const addrId = toHex(bytes.subarray(0, 16));
  const pkHex = toHex(bytes.subarray(16, 48));
  const pskHex = toHex(bytes.subarray(48, 80));
  if (addrIdOf(pkHex) !== addrId) return { ok: false, reason: "that ring address doesn't check out (a character changed) — copy it again" };
  return { ok: true, addrId, pkHex, pskHex };
}

/** a link-friend's key (32 random bytes the owner drew) → the same kind of inbox key an address gives */
export async function linkInboxKey(linkKeyHex: string): Promise<InboxKey> {
  if (!/^[0-9a-f]{64}$/.test(linkKeyHex)) throw new Error("this link is incomplete");
  const key = fromHex(linkKeyHex);
  const empty = new Uint8Array(0);
  return inboxKeyFrom(hkdfSha256(key, empty, LINK_KEM_INFO, 32), hkdfSha256(key, empty, LINK_PSK_INFO, 32));
}

// ------------------------------------------------------------------------------------------------ seal and open

export interface SealedEnvelope {
  enc: string;
  ct: string;
  hint: string;
  thumbsDropped: boolean;
}

/** seal one statement to one address (the owner's side). Throws RingStatementTooLarge rather than truncating. */
export async function sealStatement(s: RingStatement, to: { addrId: string; pkHex: string; pskHex: string }): Promise<SealedEnvelope> {
  if (s.addrId !== to.addrId) throw new Error("internal: a statement sealed to an address it does not name");
  const { bytes, thumbsDropped } = encodeStatement(s);
  const suite = ringSuite();
  const pk = await suite.kem.deserializePublicKey(ab(fromHex(to.pkHex)));
  const sender = await suite.createSenderContext({ recipientPublicKey: pk, info: ab(te.encode(INFO)), psk: { id: ab(fromHex(to.addrId)), key: ab(fromHex(to.pskHex)) } });
  const ct = toHex(await sender.seal(ab(bytes)));
  const enc = toHex(sender.enc);
  if (ct.length !== ENVELOPE_CT_HEX_LEN || !ENC_RE.test(enc)) throw new Error("internal: an envelope came out the wrong size");
  return { enc, ct, hint: hintFor(to.pskHex, enc), thumbsDropped };
}

/** a row's three public parts — what the drop serves */
export interface DropRowParts {
  enc: string;
  ct: string;
  hint: string;
}

/**
 * Open a row with one inbox key (a member's side, and the /d card's). The hint is checked first (one HKDF); on a
 * match the HPKE open runs; the plaintext is parsed and validated. Every failure is null — a wrong key, a tampered
 * byte, another address's envelope, a dummy, a malformed statement — so nothing here can render a half-checked note.
 * `malformed` is called when an envelope OPENED but its statement was refused (counted by the caller).
 */
export async function openRow(row: DropRowParts, key: InboxKey, now: number, malformed?: (reason: string) => void): Promise<RingStatement | null> {
  if (!ENC_RE.test(row.enc) || !CT_RE.test(row.ct) || !HINT_RE.test(row.hint)) return null;
  if (hintFor(key.pskHex, row.enc) !== row.hint) return null;
  let pt: ArrayBuffer;
  try {
    const ctx = await ringSuite().createRecipientContext({ recipientKey: key.kp, enc: ab(fromHex(row.enc)), info: ab(te.encode(INFO)), psk: { id: ab(fromHex(key.addrId)), key: ab(fromHex(key.pskHex)) } });
    pt = await ctx.open(ab(fromHex(row.ct)));
  } catch {
    return null; // a hint collision (1 in 65,536) or a forged/tampered row: not ours
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(td.decode(pt));
  } catch {
    malformed?.("not JSON");
    return null;
  }
  const v = validateStatement(parsed, key.addrId, now);
  if (!v.ok) {
    malformed?.(v.reason);
    return null;
  }
  return v.statement;
}

/** a dummy row, byte-shaped like a real one: a real ephemeral public key, random ct of the real length, a random hint */
export async function dummyRowParts(): Promise<DropRowParts> {
  const suite = ringSuite();
  const kp = await suite.kem.generateKeyPair();
  const enc = toHex(await suite.kem.serializePublicKey(kp.publicKey));
  return { enc, ct: randomBytes(ENVELOPE_CT_BYTES).toString("hex"), hint: randomBytes(2).toString("hex") };
}

export const newRowId = (): string => randomBytes(16).toString("hex");
export const newToken = (): string => randomBytes(32).toString("hex");
/** the drop stores sha256 over the token's 32 RAW bytes (validator/ringdrop.js computes the same) */
export const delHashOf = (tokenHex: string): string => createHash("sha256").update(fromHex(tokenHex)).digest("hex");
export const hourOf = (ms: number): number => Math.floor(ms / 3_600_000);
