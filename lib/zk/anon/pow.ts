// ZK PASS 1 Gate 1 — STATELESS rate limiting for the anonymous channel:
// hashcash-style proof of work bound to the exact body bytes.
//
//   h = sha256( hex(sha256(body)) | "|" | nonce ),  require ≥ bits leading zeros
//
// Bound to the body so a solution cannot be reused for a different
// submission; bound to nothing else — no per-root state, no token, no
// nullifier of its own (C2: RLN, whose per-epoch nullifier re-links a
// root's submissions, is banned on this endpoint). DELIBERATE DUPLICATE of
// validator/anon.js powValid().
//
// PERSONA LAUNCH P7: browser-safe. The browser device solves this on the tab's own thread before the web channel sends
// (lib/zk/anon/webChannel.ts), so the module speaks Uint8Array and @noble/hashes directly — no Buffer, no node:crypto,
// nothing a plain browser or Web Worker lacks. The bytes hashed are unchanged (utf-8 of the same strings), so a nonce
// solved here is valid on both the strict and the web route; scripts/unit-prover.mjs pins it to validator/anon.js.
import { sha256 } from "@noble/hashes/sha2";

const te = new TextEncoder();
const HEX = "0123456789abcdef";
function toHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return s;
}

export function leadingZeroBits(buf: Uint8Array): number {
  let n = 0;
  for (const b of buf) {
    if (b === 0) {
      n += 8;
      continue;
    }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
}

function bodyHashHex(body: Uint8Array): string {
  return toHex(sha256(body));
}

export function powValid(body: Uint8Array, nonce: string, bits: number): boolean {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(nonce)) return false;
  const h = sha256(te.encode(bodyHashHex(body) + "|" + nonce));
  return leadingZeroBits(h) >= bits;
}

/** Solve synchronously; ~2^bits hashes expected (16 bits ≈ 65k ≈ tens of ms in node, ~0.1–0.3 s in a phone's tab). */
export function solvePow(body: Uint8Array, bits: number): { nonce: string; attempts: number; ms: number } {
  const t0 = performance.now();
  const bh = bodyHashHex(body);
  // a random starting point so two clients do not race the same nonces (CSPRNG: the start says nothing about the body)
  const r = new Uint8Array(5);
  globalThis.crypto.getRandomValues(r);
  let i = r.reduce((acc, b) => acc * 256 + b, 0);
  let attempts = 0;
  for (;;) {
    attempts++;
    const nonce = (i++).toString(36);
    const h = sha256(te.encode(bh + "|" + nonce));
    if (leadingZeroBits(h) >= bits) return { nonce, attempts, ms: performance.now() - t0 };
  }
}
