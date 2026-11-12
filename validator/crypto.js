"use strict";
// Ed25519 verification for the validator — node:crypto (OpenSSL) only,
// zero new dependencies. The validator VERIFIES; it never holds a
// private key of any kind.
//
// Raw 32-byte public keys arrive as hex. node:crypto wants a KeyObject,
// so the raw key is wrapped in the fixed RFC 8410 SPKI DER prefix —
// format plumbing around the platform primitive, not cryptography.
const { createPublicKey, verify } = require("node:crypto");

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// ATTESTATION PASS Gate 0 — SMALL-ORDER KEYS ARE NOT KEYS. The runner's own
// regression test handed the probe an all-zero public key with an all-zero
// signature and it VERIFIED: 32 zero bytes decode to a point of order 4,
// and with S = 0 the Ed25519 equation S·B = R + h·A collapses to
// (1 + h)·P = 0, which holds for a quarter of all messages. node:crypto
// (OpenSSL) does not reject small-order points, so every signature this
// validator checks — device anchors, delegations, envelopes, revocations,
// and now issuer registrations and issuances — was forgeable with retries
// under a key nobody holds. A usable key is a canonical encoding of a
// point that is neither small-order nor outside the prime-order subgroup
// (@noble/curves, audited; the same check as lib/crypto/ed25519.ts and
// scripts/lib/health-probe.mjs).
const { ed25519 } = require("@noble/curves/ed25519");
const EdPoint = ed25519.Point ?? ed25519.ExtendedPoint;
function isUsablePubkey(publicKeyHex) {
  try {
    if (!/^[0-9a-f]{64}$/.test(publicKeyHex || "")) return false;
    const p = EdPoint.fromHex(publicKeyHex);
    return !p.isSmallOrder() && p.isTorsionFree();
  } catch {
    return false;
  }
}

/** Never throws: every malformed input is the same answer as a wrong
 * key — false. Callers refuse the write. */
function verifyEd25519(signatureHex, canonical, publicKeyHex) {
  try {
    if (!isUsablePubkey(publicKeyHex)) return false;
    if (!/^[0-9a-f]{128}$/.test(signatureHex || "")) return false;
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(canonical, "utf8"), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/** Canonical forms — byte-identical to lib/identity/deviceKeys.ts. A
 * drift between these two files is a security bug; the acceptance suite
 * signs on one side and verifies on the other to pin them together. */
function delegationCanonical(d) {
  return [
    "layers-device-delegation/1",
    d.deviceId,
    d.devicePubKey,
    (d.scopes || []).join(","),
    String(d.issuedAt),
    String(d.expiresAt ?? ""),
  ].join("|");
}

function envelopeCanonical(namespace, bodyHashHex, counter) {
  return ["layers-envelope/1", namespace, bodyHashHex, String(counter)].join("|");
}

function revokeCanonical(deviceId, issuedAt) {
  return ["layers-device-revoke/1", deviceId, String(issuedAt)].join("|");
}

module.exports = { verifyEd25519, isUsablePubkey, delegationCanonical, envelopeCanonical, revokeCanonical };
