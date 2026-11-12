import "server-only";
// DEVICE KEYS + DELEGATIONS — the primitive that makes multi-device work
// without copying the seed.
//
// A device is a RANDOM Ed25519 keypair (deliberately not derived from
// the seed: the whole point is that this key can act while the seed is
// absent). It is authorized by a DELEGATION CERT signed by the root's
// device-auth key (keystore.signAsDeviceAuth — a dedicated HKDF branch,
// see kdf.ts for why not a persona key). The validator's trust chain:
//
//   registered device-auth pubkey → delegation cert → device signature
//
// Revocation is forward-looking only, and the UI must say so: a revoked
// device's future envelopes are refused; what it already wrote stands.
//
// DEMO TOPOLOGY: a "device" is a keystore directory. The primary device
// owns .keystore/ (seed + device.json). A linked device is another
// directory holding ONLY device.json + its delegation — no root.json,
// which is the point, and what the Gate 3 test asserts ("the payload
// contains no seed material" is checkable because the second device's
// dir simply never receives one).
import { randomBytes } from "@/lib/platform/crypto";
import { storage } from "@/lib/platform/storage";
import path from "node:path";
import { fromHex, publicKeyOf, signCanonical, toHex, verifyCanonical } from "@/lib/crypto/ed25519";

export interface DeviceRecord {
  deviceId: string;
  privHex: string; // device private key — never serialized outward, leak-grepped
  pubHex: string;
  createdAt: number;
}

export interface DeviceDelegation {
  v: 1;
  deviceId: string;
  devicePubKey: string;
  scopes: string[]; // e.g. ["state-write", "vault-read"]
  issuedAt: number;
  expiresAt: number | null;
  signature: string; // by the root's device-auth key
}

const DEFAULT_DIR = process.env.KEYSTORE_DIR || path.join(process.cwd(), ".keystore");

function deviceFile(dir: string): string {
  return path.join(dir, "device.json");
}

/** Same loud-load / atomic-write discipline as the keystore: corrupt
 * throws (a device key is real material), missing creates. */
export function deviceIdentity(dir: string = DEFAULT_DIR): DeviceRecord {
  const file = deviceFile(dir);
  if (storage.exists(file)) {
    let rec: DeviceRecord;
    try {
      rec = JSON.parse(storage.readText(file)) as DeviceRecord;
    } catch {
      throw new Error(`deviceKeys: ${file} is corrupt. Refusing to regenerate over key material.`);
    }
    if (!/^[0-9a-f]{64}$/.test(rec.privHex ?? "") || !rec.deviceId) {
      throw new Error(`deviceKeys: ${file} failed validation. Refusing to regenerate.`);
    }
    return rec;
  }
  // BROWSER KEYSTORE PASS Gate 5: a production SERVER has no device — the device is the browser (docs/custody-model.md,
  // the one rule). Minting a device key there would leave key material in a directory scripts/probe-no-keystore.mjs
  // asserts stays empty (it did, once the registration started signing a device proof before the keystore door was
  // reached). Same rule as the keystore's refusal; the rig (ZK_DEV_HOOKS=true) and the browser are unaffected.
  if (typeof window === "undefined" && process.env.NODE_ENV === "production" && process.env.ZK_DEV_HOOKS !== "true") {
    throw new Error("deviceKeys: refusing to mint a device key on a production server — the device is the browser; the server holds no seed, no vault key and no device key (docs/custody-model.md, the one rule)");
  }
  const priv = randomBytes(32);
  const rec: DeviceRecord = {
    deviceId: "dev_" + randomBytes(8).toString("hex"),
    privHex: priv.toString("hex"),
    pubHex: publicKeyOf(new Uint8Array(priv)),
    createdAt: Date.now(),
  };
  storage.writeText(file, JSON.stringify(rec, null, 2) + "\n");
  return rec;
}

// ---------- delegation certs ----------

/** ONE canonical form, assembled here and nowhere else — the exact
 * bytes the device-auth key signs and every verifier checks. */
export function delegationCanonical(d: Omit<DeviceDelegation, "signature">): string {
  return [
    "layers-device-delegation/1",
    d.deviceId,
    d.devicePubKey,
    d.scopes.join(","),
    String(d.issuedAt),
    String(d.expiresAt ?? ""),
  ].join("|");
}

export function verifyDelegation(d: DeviceDelegation, deviceAuthPub: string, now = Date.now()): boolean {
  if (d.expiresAt !== null && d.expiresAt <= now) return false;
  return verifyCanonical(d.signature, delegationCanonical(d), deviceAuthPub);
}

// ---------- envelopes (the signed transport wrapper) ----------

/** What a device signs over one write: the namespace, a hash of the
 * body, and a monotonic counter — so the untrusted server can neither
 * forge a write nor replay an old one as new ("ordering only" made
 * checkable). */
export function envelopeCanonical(namespace: string, bodyHashHex: string, counter: number): string {
  return ["layers-envelope/1", namespace, bodyHashHex, String(counter)].join("|");
}

export function signEnvelope(
  device: DeviceRecord,
  namespace: string,
  bodyHashHex: string,
  counter: number
): string {
  return signCanonical(envelopeCanonical(namespace, bodyHashHex, counter), fromHex(device.privHex));
}

/** Key material this module contributes to the leak grep. */
export function deviceKeyMaterialForLeakTest(dir: string = DEFAULT_DIR): string[] {
  if (!storage.exists(deviceFile(dir))) return [];
  return [deviceIdentity(dir).privHex];
}

/** Gate 5 (attack-custody-1 #2): proof of possession of THIS device key over an arbitrary canonical — what a
 *  device sends when it moves between anchors (recovery, linking), so a public key alone never moves it */
export function signAsDevice(canonical: string, dir: string = DEFAULT_DIR): string {
  return signCanonical(canonical, fromHex(deviceIdentity(dir).privHex));
}
