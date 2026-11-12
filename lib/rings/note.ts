// PERSONA LAUNCH P4 — THE RING NOTE (plan R8). Every anon post carries one fixed 256-byte note, real or random, the
// same size with or without a ring; sha256(note) is bound into the anon-post proof's message beside the attribution
// commitment (lib/zk/gate.ts + lib/zk/prove.ts + validator/zk.js — the reach track applies those seams).
//
//   REAL   = 12-byte CSPRNG nonce || AES-256-GCM(228-byte plaintext {v:1, ref} padded with spaces), AAD =
//            "layers-ring-note/1|" + castHash, under K(persona, current generation). The key is shared by EVERY ring that
//            holds the persona at depth "posts" (one note per post, never one per ring); adding a member steps the key
//            one link along its one-way chain, revoking a member or lowering a ring's depth starts a fresh random chain
//            (either way a new generation for future posts — see chainNext below).
//   RANDOM = 256 CSPRNG bytes, when no ring holds the persona at depth "posts".
//
// Members trial-decrypt locally with the keys their envelopes carried. The AAD binds the note to THIS post: a real
// note copied onto another cast opens under no key. Nothing here fetches or writes, and the work is the same whether
// or not a ring exists (the AES-GCM pass runs under a throwaway key when there is no real one) — the composer's timing
// must not say whether this persona has an audience.
//
// Pure and isomorphic except noteForPost, which reads the rings document from memory (lib/rings/model.ts) and THROWS
// when it cannot (lib/zk/gate.ts turns the throw into a refusal that keeps the words in the box).
import { aesGcmOpen, aesGcmSeal, hkdfSha256, randomBytes } from "@/lib/platform/crypto";

export const NOTE_BYTES = 256;
export const NOTE_HEX_LEN = NOTE_BYTES * 2;
export const NOTE_NONCE_BYTES = 12;
/** 256 = 12 (nonce) + 228 (plaintext) + 16 (GCM tag) */
export const NOTE_PT_BYTES = NOTE_BYTES - NOTE_NONCE_BYTES - 16;
export const NOTE_AAD_PREFIX = "layers-ring-note/1|";
export const NOTE_RE = /^[0-9a-f]{512}$/;
const CAST_HASH_RE = /^[0-9a-f]{64}$/;
const REF_RE = /^[0-9a-f]{16}$/;

const te = new TextEncoder();
const td = new TextDecoder();
const hexOf = (u: Uint8Array): string => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const bytesOf = (h: string): Uint8Array => {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
};
const aadFor = (castHash: string): Uint8Array => te.encode(NOTE_AAD_PREFIX + castHash);

function paddedPlaintext(ref: string): Uint8Array {
  const raw = te.encode(JSON.stringify({ v: 1, ref }));
  if (raw.length > NOTE_PT_BYTES) throw new Error("internal: a ring note's plaintext does not fit");
  const out = new Uint8Array(NOTE_PT_BYTES);
  out.fill(0x20);
  out.set(raw, 0);
  return out;
}

/** a REAL note: nonce || AES-256-GCM(padded {v, ref}) with the cast-hash AAD, as 512 hex */
export function sealNote(keyHex: string, ref: string, castHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error("internal: a ring note key is not 32 bytes of hex");
  if (!REF_RE.test(ref)) throw new Error("internal: a ring note ref is malformed");
  if (!CAST_HASH_RE.test(castHash)) throw new Error("a ring note needs the post's 64-hex cast hash");
  const nonce = randomBytes(NOTE_NONCE_BYTES);
  const sealed = aesGcmSeal(bytesOf(keyHex), new Uint8Array(nonce), paddedPlaintext(ref), aadFor(castHash));
  const out = new Uint8Array(NOTE_BYTES);
  out.set(nonce, 0);
  out.set(sealed, NOTE_NONCE_BYTES);
  return hexOf(out);
}

// ------------------------------------------------------------------------------------------------ the key chain
// PERSONA LAUNCH P4 (W2-RINGS-KEEP3-HISTORY-LOSS): generation g + 1 of a chain is HKDF-SHA256(K_g) — one-way, so a
// holder of K_g reaches every later step and none before it. The owner keeps each chain's random head
// (lib/rings/model.ts NoteSegment) and seals a member the key of the first generation it may open plus a step count
// (lib/rings/envelope.ts RingNoteKey); the member derives the rest here. Same code on both sides, isomorphic.
const CHAIN_INFO = "layers-ring-note/chain/v1";
const NO_SALT = new Uint8Array(0);

/** one chain step: K_{g+1} from K_g */
export function chainNext(keyHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error("internal: a ring chain key is not 32 bytes of hex");
  return hexOf(hkdfSha256(bytesOf(keyHex), NO_SALT, CHAIN_INFO, 32));
}

/** the key `steps` generations on from `headHex` */
export function chainKeyAt(headHex: string, steps: number): string {
  if (!Number.isSafeInteger(steps) || steps < 0) throw new Error("internal: a ring chain step count is not a whole number");
  let k = headHex;
  for (let i = 0; i < steps; i++) k = chainNext(k);
  if (steps === 0 && !/^[0-9a-f]{64}$/.test(k)) throw new Error("internal: a ring chain key is not 32 bytes of hex");
  return k;
}

/** `n` consecutive keys starting at `startHex` (a member's side: one sealed stretch → the keys it may try) */
export function chainKeys(startHex: string, n: number): string[] {
  const out: string[] = [];
  let k = startHex;
  for (let i = 0; i < n; i++) {
    if (i > 0) k = chainNext(k);
    out.push(k);
  }
  return out;
}

/** a RANDOM note: 256 CSPRNG bytes (indistinguishable from a real one without the key) */
export function randomNote(): string {
  return randomBytes(NOTE_BYTES).toString("hex");
}

/** try one key: the ref inside, or null (wrong key, another cast's note, a random note, a tampered byte) */
export function openNoteWith(noteHex: string, castHash: string, keyHex: string): string | null {
  if (!NOTE_RE.test(noteHex) || !CAST_HASH_RE.test(castHash) || !/^[0-9a-f]{64}$/.test(keyHex)) return null;
  const b = bytesOf(noteHex);
  let pt: Uint8Array;
  try {
    pt = aesGcmOpen(bytesOf(keyHex), b.subarray(0, NOTE_NONCE_BYTES), b.subarray(NOTE_NONCE_BYTES), aadFor(castHash));
  } catch {
    return null;
  }
  try {
    const j = JSON.parse(td.decode(pt)) as { v?: unknown; ref?: unknown };
    return j && j.v === 1 && typeof j.ref === "string" && REF_RE.test(j.ref) ? j.ref : null;
  } catch {
    return null;
  }
}

/** openNote(noteHex, castHash, keys) → the ref the first key that opens it names, or null */
export function openNote(noteHex: string, castHash: string, keys: Array<string | { keyHex: string }>): string | null {
  for (const k of keys) {
    const ref = openNoteWith(noteHex, castHash, typeof k === "string" ? k : k.keyHex);
    if (ref) return ref;
  }
  return null;
}

/**
 * THE NOTE FOR ONE ANON POST (called by lib/zk/gate.ts requestAnonPost, before the reveal secret is minted).
 * `mode` is the universe the post is made in; the key does not depend on it (a ring sees a persona in both), and it is
 * taken so the call site reads the same as every other per-post step. Constant work: the AES-GCM pass always runs.
 * THROWS when the rings document cannot be read from memory (never "no ring" on an unread document).
 * PERSONA LAUNCH GO-LIVE (UXH-9): a DELETED ring sees nothing — noteKeyForPost asks lib/rings/model.ts seenAtPosts,
 * which counts rings in use only, so a persona whose only "posts" ring was deleted gets a random note again.
 */
export async function noteForPost(mode: "fixture" | "live", personaId: string, castHash: string): Promise<string> {
  void mode;
  if (!CAST_HASH_RE.test(castHash)) throw new Error("a ring note needs the post's 64-hex cast hash");
  const { noteKeyForPost } = await import("./model");
  const real = noteKeyForPost(personaId); // THROWS on an unread document
  const throwaway = randomBytes(32).toString("hex");
  const sealed = sealNote(real ? real.keyHex : throwaway, real ? real.ref : "0000000000000000", castHash);
  return real ? sealed : randomNote();
}
