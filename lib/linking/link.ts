import "server-only";
// DEVICE LINKING — the Signal-style flow: the seed-holding device
// authorizes a new device WITHOUT the seed ever crossing the wire.
//
// What actually crosses (and why it is NOT the seed):
//   - a DEVICE DELEGATION for the new device's own key, signed by the
//     root's device-auth key — authorizes the new device to write, but
//     is public material (the validator already stores it);
//   - the VAULT KEY (the 32-byte symmetric key), so the new device can
//     DECRYPT vault content — this IS sensitive, so it never travels in
//     the clear.
// The seed itself, the root secret, and every persona SIGNING key stay
// on the origin device. A linked device can read the vault and make
// envelope-authenticated writes; it cannot mint the root's disclosure
// personas (those need the seed), which is the honest boundary and is
// stated in the report.
//
// THE CHANNEL. The payload is sealed under a HIGH-ENTROPY linking secret
// (32 bytes, shown as a QR / long code on the origin device and carried
// out-of-band to the new device). The relay — the untrusted validator —
// only ever stores the CIPHERTEXT; the secret never touches it. Someone
// who can read the relay learns nothing without the secret.
import { aesGcmOpen, aesGcmSeal, randomBytes } from "@/lib/platform/crypto";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";

export interface LinkPayload {
  delegation: unknown; // DeviceDelegation for the new device (public)
  vaultKeyHex: string; // the symmetric vault key (sensitive → sealed)
  fid?: number | null;
}

export interface SealedLink {
  v: 1;
  nonce: string; // hex
  ct: string; // hex (ciphertext + GCM tag)
}

/** A fresh linking secret: 32 bytes, the QR/long-code. High entropy, so
 * the channel's security does not rest on a short human code. */
export function newLinkingSecret(): string {
  return randomBytes(32).toString("hex");
}

function channelKey(secretHex: string): Uint8Array {
  // domain-separated from every other derivation in the system
  return hkdf(sha256, Buffer.from(secretHex, "hex"), new Uint8Array(0), new TextEncoder().encode("layers/link/1"), 32);
}

/** Seal the payload under the linking secret. Only the ciphertext is
 * ever handed to the relay. */
export function sealLink(secretHex: string, payload: LinkPayload): SealedLink {
  const key = channelKey(secretHex);
  const nonce = randomBytes(12);
  const pt = Buffer.from(JSON.stringify(payload), "utf8");
  const body = Buffer.from(aesGcmSeal(key, nonce, pt));
  return { v: 1, nonce: nonce.toString("hex"), ct: body.toString("hex") };
}

/** Open a sealed payload with the secret. Throws on a wrong secret or a
 * tampered relay record — a linking payload that will not open is not a
 * partial link, it is no link. */
export function openLink(secretHex: string, sealed: SealedLink): LinkPayload {
  const key = channelKey(secretHex);
  const body = Buffer.from(sealed.ct, "hex");
  if (body.length < 16) throw new Error("link: sealed payload too short");
  const pt = Buffer.from(aesGcmOpen(key, Buffer.from(sealed.nonce, "hex"), body));
  return JSON.parse(pt.toString("utf8")) as LinkPayload;
}
