"use strict";
// POST AS YOU (the root's own Farcaster key) — EIP-712 BY HAND for the ONE typed message the validator signs: the
// SignedKeyRequest that attributes a user's new Ed25519 key to Totem's app account (requestFid = FC_APP_FID). The
// validator image installs production dependencies only (Dockerfile.validator: npm ci --omit=dev) and viem is a dev
// dependency, so this is @noble/curves secp256k1 + @noble/hashes keccak_256, the libraries the image already carries.
// scripts/unit-root-post.mjs and validator/test/keyrequest.test.js cross-check every signature here against viem's
// recoverTypedDataAddress (a dev dependency in the tests only).
//
// THE CONTRACT (verified 2026-11-05 against the Farcaster docs mirror, docs.neynar.com/farcaster/reference/farcaster/
// signer-requests and .../contracts/reference/signed-key-request-validator):
//   domain  { name: "Farcaster SignedKeyRequestValidator", version: "1", chainId: 10,
//             verifyingContract: 0x00000000FC700472606ED4fA22623Acf62c60553 }
//   type    SignedKeyRequest(uint256 requestFid,bytes key,uint256 deadline)
// and the OPTIONAL sponsorship (same page, "Sponsoring a signer"): an EIP-191 personal message whose RAW bytes are the
// 65-byte SignedKeyRequest signature, signed by the sponsoring fid's custody (viem signMessage({ message: { raw } })).
//
// SECRETS: the custody private key is an argument to the functions below only; nothing here stores, logs or returns it,
// and no error message carries it.
const { secp256k1 } = require("@noble/curves/secp256k1");
const { keccak_256 } = require("@noble/hashes/sha3");

const SKR_DOMAIN = Object.freeze({ name: "Farcaster SignedKeyRequestValidator", version: "1", chainId: 10, verifyingContract: "0x00000000FC700472606ED4fA22623Acf62c60553" });
const te = new TextEncoder();
const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

const keccak = (b) => keccak_256(b);
function hexToBytes(h) {
  const s = String(h).replace(/^0x/i, "");
  if (!/^([0-9a-fA-F]{2})*$/.test(s)) throw new Error("hex malformed");
  return Uint8Array.from(Buffer.from(s, "hex"));
}
const toHex = (b) => "0x" + Buffer.from(b).toString("hex");
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
/** a uint256 as its 32-byte big-endian word */
function word(n) {
  let v = BigInt(n);
  if (v < 0n || v >= 1n << 256n) throw new Error("uint256 out of range");
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
/** an address as its 32-byte word (left-padded) */
function addressWord(a) {
  const b = hexToBytes(a);
  if (b.length !== 20) throw new Error("address malformed");
  return concat(new Uint8Array(12), b);
}

/** is this a secp256k1 private key (0x + 64 hex, inside the curve order)? */
function isCustodyKey(k) {
  if (typeof k !== "string" || !KEY_RE.test(k.trim())) return false;
  try {
    return secp256k1.utils.isValidPrivateKey(hexToBytes(k.trim()));
  } catch {
    return false;
  }
}
/** the checksummed Ethereum address of a custody private key, or null when it is not one */
function custodyAddressOf(privHex) {
  if (!isCustodyKey(privHex)) return null;
  const pub = secp256k1.getPublicKey(hexToBytes(privHex.trim()), false); // 65 bytes: 0x04 ‖ X ‖ Y
  const addr = Buffer.from(keccak(pub.slice(1)).slice(12)).toString("hex");
  // EIP-55 checksum
  const h = Buffer.from(keccak(te.encode(addr))).toString("hex");
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  return out;
}

const DOMAIN_TYPEHASH = keccak(te.encode("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
const SKR_TYPEHASH = keccak(te.encode("SignedKeyRequest(uint256 requestFid,bytes key,uint256 deadline)"));
function domainSeparator(d = SKR_DOMAIN) {
  return keccak(concat(DOMAIN_TYPEHASH, keccak(te.encode(d.name)), keccak(te.encode(d.version)), word(d.chainId), addressWord(d.verifyingContract)));
}
/** the 32-byte EIP-712 digest of SignedKeyRequest(requestFid, key, deadline) */
function signedKeyRequestDigest({ requestFid, key, deadline }, domain = SKR_DOMAIN) {
  const structHash = keccak(concat(SKR_TYPEHASH, word(requestFid), keccak(hexToBytes(key)), word(deadline)));
  return keccak(concat(Uint8Array.from([0x19, 0x01]), domainSeparator(domain), structHash));
}
/** r ‖ s ‖ v (v = 27 + recovery), the 65-byte form every Ethereum verifier takes */
function sign65(digest, privHex) {
  const sig = secp256k1.sign(digest, hexToBytes(privHex.trim()), { lowS: true });
  return toHex(concat(sig.toCompactRawBytes(), Uint8Array.from([27 + sig.recovery])));
}

/**
 * Sign the SignedKeyRequest for `key` (0x + 64 hex: the user's Ed25519 public key) on behalf of `requestFid` with that
 * fid's custody key. → "0x" + 130 hex. Throws (plain words, never the key) on a malformed input.
 */
function signKeyRequest({ privHex, requestFid, key, deadline }) {
  if (!isCustodyKey(privHex)) throw new Error("the app custody key is not a secp256k1 private key");
  if (!Number.isSafeInteger(requestFid) || requestFid <= 0) throw new Error("the request fid is malformed");
  if (typeof key !== "string" || !KEY_RE.test(key)) throw new Error("the key is not 0x + 64 hex");
  if (!Number.isSafeInteger(deadline) || deadline <= 0) throw new Error("the deadline is malformed");
  return sign65(signedKeyRequestDigest({ requestFid, key, deadline }), privHex);
}

/** the EIP-191 personal-message digest of RAW bytes ("\x19Ethereum Signed Message:\n" + length + bytes) */
function personalDigest(raw) {
  return keccak(concat(te.encode("\x19Ethereum Signed Message:\n" + raw.length), raw));
}
/** the sponsorship signature over a SignedKeyRequest signature (its raw 65 bytes), by the sponsor's custody */
function signSponsorship({ privHex, keyRequestSignature }) {
  if (!isCustodyKey(privHex)) throw new Error("the sponsor custody key is not a secp256k1 private key");
  const raw = hexToBytes(keyRequestSignature);
  if (raw.length !== 65) throw new Error("the key request signature is not 65 bytes");
  return sign65(personalDigest(raw), privHex);
}

module.exports = { SKR_DOMAIN, isCustodyKey, custodyAddressOf, signedKeyRequestDigest, signKeyRequest, signSponsorship, personalDigest };
