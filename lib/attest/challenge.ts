import "server-only";
// MULTI-FID PASS Gate 0 — the issuer-minted CHALLENGE, shared by every
// issuer that binds an external identity to the subject's root: a wallet
// (onchain.*), an X account (x.*), a Farcaster signer (neynar.*). The
// subject signs the challenge with the thing it claims to control; the
// issuer verifies and CONSUMES it. One challenge, one issuance request,
// ten minutes: a replayed challenge is refused, and a challenge minted for
// one issuer / mode / commitment is not live for another.
import { randomBytes } from "@/lib/platform/crypto";
import type { SubjectRef } from "./types";

export const CHALLENGE_DOMAIN = "layers-attest-challenge/1";
const CHALLENGE_TTL_MS = 10 * 60_000;
const pending = new Map<string, number>(); // challenge -> minted at

export function mintChallenge(issuerId: string, subject: Pick<SubjectRef, "mode" | "commitment">, epoch: number): string {
  const c = [CHALLENGE_DOMAIN, issuerId, subject.mode, subject.commitment, String(epoch), randomBytes(16).toString("hex")].join("|");
  pending.set(c, Date.now());
  for (const [k, at] of pending) if (Date.now() - at > CHALLENGE_TTL_MS) pending.delete(k);
  return c;
}

export function challengeIsLive(challenge: string, issuerId: string, subject: Pick<SubjectRef, "mode" | "commitment">): boolean {
  const at = pending.get(challenge);
  if (at === undefined || Date.now() - at > CHALLENGE_TTL_MS) return false;
  const parts = challenge.split("|");
  return parts[0] === CHALLENGE_DOMAIN && parts[1] === issuerId && parts[2] === subject.mode && parts[3] === subject.commitment;
}

/** single use: the issuer consumes the challenge once the bound identities verified */
export function consumeChallenge(challenge: string): void {
  pending.delete(challenge);
}
