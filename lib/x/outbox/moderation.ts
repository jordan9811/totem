import "server-only";
// PERSONA LAUNCH P8 — THE X OUTBOX'S MODERATOR KEY, on the OWNER's device. Nothing posts to @totem on X before a moderator
// approves it (the owner rule: X suspends a shared account that posts spam), and the validator stays KEYLESS: it holds the
// moderator's PUBLIC key only (X_OUTBOX_MODERATORS, or a rig's dev-registered key) and verifies a signature over each
// decision. The private half is DERIVED here, on the device, never stored and never sent:
//   seed = HKDF-SHA256(ikm = this root's vault key, salt = empty, info = "layers/x-moderator/1"), 32 bytes → Ed25519
// Its own info string, so the key can never equal any other key this root holds (the vault key itself, a persona key, a
// signer, the device-auth key). Recovery re-derives it from the 24 words with everything else — there is nothing to back
// up and no seed phrase to show. (lib/crypto/kdf.ts is the derivation tree's usual home; it is another track's file this
// wave, so the branch lives here with the same discipline — one versioned info string, assembled once — and the move is
// a cross-file request.)
//
// DELIBERATE DUPLICATES of validator/xoutbox.js: moderateCanonical, reviewCanonical. Byte-identical, or every decision is
// refused; scripts/unit-x-outbox.mjs signs here and verifies there.
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";

export const X_MODERATOR_INFO = "layers/x-moderator/1";
const HOUR = 3_600_000;

/** what a moderator signs to decide one row. PERSONA LAUNCH wave 3 (W3-X-MOD-SAME-HOUR): /2 binds a fresh 16-byte nonce —
 *  without it the same decision on the same row inside one hour signed byte-identically (Ed25519 is deterministic) and
 *  the validator refused the corrective one as a replay (validator/xoutbox.js moderate) */
export const moderateCanonical = (mode: string, id: string, decision: "approve" | "reject", issuedHour: number, nonce: string): string =>
  ["layers-x-moderate/2", mode, id, decision, String(issuedHour), String(nonce)].join("|");
/** what a moderator signs to read the texts waiting for a decision */
export const reviewCanonical = (mode: string, issuedHour: number, pubkey: string): string => ["layers-x-review/1", mode, String(issuedHour), pubkey].join("|");

/** the hour number a signature carries (the validator accepts this hour and one either side) */
export const hourNumber = (t: number = Date.now()): number => Math.floor(t / HOUR);

/** PURE: the moderator seed for a given vault key (the harness pins the derivation with it) */
export function moderatorSeedFor(vaultKey: Uint8Array): Uint8Array {
  if (!(vaultKey instanceof Uint8Array) || vaultKey.length !== 32) throw new Error("x moderator: the vault key must be 32 bytes");
  return hkdf(sha256, vaultKey, new Uint8Array(0), new TextEncoder().encode(X_MODERATOR_INFO), 32);
}

async function seed(): Promise<Uint8Array> {
  const { vaultKeyBytes } = await import("@/lib/identity/keystore");
  return moderatorSeedFor(vaultKeyBytes());
}

/** this device's moderator PUBLIC key (64 hex) — what the owner puts in X_OUTBOX_MODERATORS */
export async function moderatorPublicKey(): Promise<string> {
  const { publicKeyOf } = await import("@/lib/crypto/ed25519");
  return publicKeyOf(await seed());
}

/** sign one decision for the validator: {mode, id, decision, issuedHour, nonce, pubkey, sig} — a fresh CSPRNG nonce each time */
export async function signModeration(mode: "fixture", id: string, decision: "approve" | "reject", now: number = Date.now()): Promise<{ mode: "fixture"; id: string; decision: "approve" | "reject"; issuedHour: number; nonce: string; pubkey: string; sig: string }> {
  const { publicKeyOf, signCanonical } = await import("@/lib/crypto/ed25519");
  const { randomBytes } = await import("@/lib/platform/crypto");
  const s = await seed();
  const issuedHour = hourNumber(now);
  const nonce = randomBytes(16).toString("hex");
  return { mode, id, decision, issuedHour, nonce, pubkey: publicKeyOf(s), sig: signCanonical(moderateCanonical(mode, id, decision, issuedHour, nonce), s) };
}

/** sign the review read: {mode, issuedHour, pubkey, sig} as query parameters */
export async function signReview(mode: "fixture", now: number = Date.now()): Promise<{ mode: "fixture"; issuedHour: number; pubkey: string; sig: string }> {
  const { publicKeyOf, signCanonical } = await import("@/lib/crypto/ed25519");
  const s = await seed();
  const issuedHour = hourNumber(now);
  const pubkey = publicKeyOf(s);
  return { mode, issuedHour, pubkey, sig: signCanonical(reviewCanonical(mode, issuedHour, pubkey), s) };
}
