import "server-only";
// PUBLIC GO-LIVE (the relay track) — THE PUBLIC @anon's MODERATOR KEY AND REPORT REASONS, on the visitor's device.
//
// Strangers posting through one shared Farcaster account need a way to take a post down. The validator stays keyless for
// moderation: it holds the moderators' PUBLIC keys only (ANON_MODERATORS) and verifies a signature over every read of the
// reported posts and every decision. The private half is DERIVED here, in the browser device of whoever moderates (the
// owner, on the public site), never stored and never sent:
//   seed = HKDF-SHA256(ikm = this root's vault key, salt = empty, info = "layers/anon-moderator/1"), 32 bytes → Ed25519
// Its own info string, so it never equals any other key this root holds (lib/x/outbox/moderation.ts mirrors the pattern
// with "layers/x-moderator/1"). A passkey restore re-derives it with everything else: nothing to back up, no phrase shown.
//
// DELIBERATE DUPLICATES of validator/anonpublic.js: takedownCanonical, reviewCanonical, REPORT_REASONS. Byte-identical, or
// every decision is refused; scripts/unit-anon-relay.mjs signs here and verifies there.
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";

export const ANON_MODERATOR_INFO = "layers/anon-moderator/1";
const HOUR = 3_600_000;

/** the reasons a Report may give, and how each reads on the button (the validator takes the ids only) */
export const REPORT_REASONS = Object.freeze(["spam", "harassment", "hate", "doxxing", "violence", "illegal", "scam", "other"] as const);
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Readonly<Record<ReportReason, string>> = Object.freeze({
  spam: "Spam",
  harassment: "Harassment or bullying",
  hate: "Hate or slurs",
  doxxing: "Shares someone's private details",
  violence: "Threats or violence",
  illegal: "Illegal content",
  scam: "A scam or fraud",
  other: "Something else",
});

/** what a moderator signs to decide one post: remove (hide it, delete it from Farcaster) or keep (dismiss the reports) */
export const takedownCanonical = (mode: string, castHash: string, decision: "remove" | "keep", issuedHour: number, nonce: string): string =>
  ["layers-anon-takedown/1", mode, castHash, decision, String(issuedHour), String(nonce)].join("|");
/** what a moderator signs to read the reported posts */
export const reviewCanonical = (mode: string, issuedHour: number, pubkey: string): string => ["layers-anon-review/1", mode, String(issuedHour), pubkey].join("|");

/** the hour number a signature carries (the validator accepts this hour and one either side) */
export const hourNumber = (t: number = Date.now()): number => Math.floor(t / HOUR);

/** PURE: the moderator seed for a given vault key (the harness pins the derivation with it) */
export function anonModeratorSeedFor(vaultKey: Uint8Array): Uint8Array {
  if (!(vaultKey instanceof Uint8Array) || vaultKey.length !== 32) throw new Error("anon moderator: the vault key must be 32 bytes");
  return hkdf(sha256, vaultKey, new Uint8Array(0), new TextEncoder().encode(ANON_MODERATOR_INFO), 32);
}

async function seed(): Promise<Uint8Array> {
  const { vaultKeyBytes } = await import("@/lib/identity/keystore");
  return anonModeratorSeedFor(vaultKeyBytes());
}

/** this device's moderator PUBLIC key (64 hex) — what the owner puts in ANON_MODERATORS (arm-public-anon.ps1 -ModeratorKey) */
export async function anonModeratorPublicKey(): Promise<string> {
  const { publicKeyOf } = await import("@/lib/crypto/ed25519");
  return publicKeyOf(await seed());
}

/** sign one decision: {mode, castHash, decision, issuedHour, nonce, pubkey, sig} — a fresh CSPRNG nonce each time */
export async function signTakedown(mode: "fixture" | "live", castHash: string, decision: "remove" | "keep", now: number = Date.now()) {
  const { publicKeyOf, signCanonical } = await import("@/lib/crypto/ed25519");
  const { randomBytes } = await import("@/lib/platform/crypto");
  const s = await seed();
  const issuedHour = hourNumber(now);
  const nonce = randomBytes(16).toString("hex");
  return { mode, castHash, decision, issuedHour, nonce, pubkey: publicKeyOf(s), sig: signCanonical(takedownCanonical(mode, castHash, decision, issuedHour, nonce), s) };
}

/** sign the read of the reported posts: {mode, issuedHour, pubkey, sig} */
export async function signAnonReview(mode: "fixture" | "live", now: number = Date.now()) {
  const { publicKeyOf, signCanonical } = await import("@/lib/crypto/ed25519");
  const s = await seed();
  const issuedHour = hourNumber(now);
  const pubkey = publicKeyOf(s);
  return { mode, issuedHour, pubkey, sig: signCanonical(reviewCanonical(mode, issuedHour, pubkey), s) };
}
