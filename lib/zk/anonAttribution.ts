import "server-only";
// MULTI-FID PASS — anon-post ATTRIBUTION (the anoncast reveal pattern): prove ownership of a past
// anonymous cast, later, at your own choice, and attribute it to one of your real accounts.
//
// At post time (requestAnonPost, lib/zk/gate.ts) this device generates a fresh 32-byte SECRET, keeps it under the
// cast's hash, and hands back only its COMMITMENT — sha256(secret) — which rides the anon-post's message alongside the
// cast hash, so the ZK proof authenticates it: nobody, not even the validator relaying the cast, can swap the
// commitment for a different one after the fact. The commitment reveals nothing (it is a hash of 256 random bits)
// until the secret behind it is shown.
//
// WHERE THE SECRET LIVES (ANON REVIEW R1-01 / R3-07): in memory from the moment Post is pressed, and then — only
// when the queue's own deferred write runs, 30 s to 15 min after the proof is queued — inside the sealed `zkQueue`
// record on the validator, as a record of claimKind "anon-attribution" (lib/zk/anon/queue.ts). It used to be a
// namespace of its own (`anonAttribution`), flushed with a device-signed PUT the instant Post was pressed, before the
// once-per-window refusal: the one row in the validator's database that joined an anonymous compose to a root, and a
// beacon the validator operator could line up with the anonymous submission that followed. The namespace name no
// longer announces anything, the write lands on the queue's schedule, and the ciphertext grows with the queue, not
// with the number of anon posts alone. The cost, stated: a crash inside the deferred-persist window after the send
// loses the reveal secret, and that post stays anonymous forever (SECURITY-POSTURE.md §14.1).
//
// Later, from any session on this device, revealAttribution() reads the secret back, requires the caller to already
// own the chosen persona (the same rule every other own-persona action uses), requires that persona to hold its own
// real fid in THIS universe (attributing to the shared/throwaway account would say nothing; a fixture fid on a live
// row would be a lie), and sends {castHash, secret, fid, signerPubKey, signature} to the validator — the signature
// being by that fid's derived signer key. HONEST SCOPE (R1-07 / R3-06): on today's Neynar-managed accounts that key
// is NOT one of the fid's registered keys (`derivedRegistered: false`), so the finished record is checkable INSIDE
// LAYERS ONLY — by a client that holds this device's own persona↔fid record. A third-party reader doing the
// KeyRegistry check finds the key absent and must render plain anon. Reveals become checkable by anyone only once the
// self-custody pass registers the derived key on the fid (§14.2).
// The validator checks the hash preimage and the signature and, on a match, records the FID and the key against that
// cast — a fact anyone reading the anon-casts list can then see, forever (first reveal wins; the same persona
// re-revealing is a no-op, a DIFFERENT persona is refused). Nothing about this is automatic, forced, or coerced: the
// secret never leaves this module except at the moment its owner chooses to spend it.
import { randomBytes, createHash } from "@/lib/platform/crypto";
import { validatorUrl } from "@/lib/ports";
import { attributionCastHashes, attributionCastHashesFor as castHashesForPersona, attributionRecord, putAttributionRecord } from "./anon/queue";
//
// PERSONA LAUNCH P3 — THE PERSONA IN THE SEALED RECORD. An anon post is now made AS one of the root's personas (POST
// /api/anon {text, personaId}); the record above also keeps WHICH persona, so the launch (P6) can reveal every anon post
// of that persona in one batch and none of its siblings'. The persona id lives in exactly two places: this process's
// memory and the one sealed, padded zkQueue record. It is never on the envelope, the public signal, the payload, the
// wire, a validator row or a log — the proof still names the constant "anon" and the scope still omits the persona.
// revealAttribution's rule was UNCHANGED in P3 (any own fid-holding persona may be named).
//
// PERSONA LAUNCH P6 — ONLY THE PERSONA THAT POSTED IT. A single reveal may now name only the persona the sealed record
// says posted the cast: naming a SIBLING would publicly join two of the root's personas through a post only one of them
// wrote (and the sibling's account would claim words it never wrote). The refusal runs before anything is signed or
// sent. A record made before P3 names no persona; it keeps the old rule (any own fid-holding persona), so a post from
// then is never stranded. The launch's BATCH reveal (lib/launch/reveal.ts) is the all-at-once form of the same rule.

/** the RETIRED namespace name — kept only so the dev reset's purge list and old vault rows still resolve */
export const VAULT_NS = "anonAttribution";
const COMMITMENT_RE = /^[0-9a-f]{64}$/;
const SECRET_RE = /^[0-9a-f]{64}$/;

/** DELIBERATE DUPLICATE of revealCanonical() in validator/zk.js — byte-identical or every reveal is
 * refused. Binds the universe, the cast, the fid being claimed AND the key doing the claiming, so a
 * signature cannot be lifted onto a different cast, a different fid, or a different key. */
export function revealCanonical(mode: string, castHash: string, fid: number, signerPubKey: string): string {
  return ["layers-anon-reveal/1", mode, castHash, String(fid), signerPubKey].join("|");
}

export function commitmentOf(secretHex: string): string {
  return createHash("sha256").update("layers-anon-attribution/1|" + secretHex, "utf8").digest("hex");
}

/** a fresh secret and its commitment — pure (the harness calls it) */
export function mintAttributionSecret(): { secret: string; commitment: string } {
  const secret = randomBytes(32).toString("hex");
  return { secret, commitment: commitmentOf(secret) };
}

/** requestAnonPost calls this AFTER its refusals, before the post is queued: mint a fresh secret for this specific
 * cast, hold it IN MEMORY, and return the commitment to bind into the proof. One secret per cast hash — a re-post
 * under the same (nonce, text) pair never happens (the nonce is fresh every call), so this always inserts, never
 * overwrites. Nothing is written to the validator here (see the header). */
export async function sealSecretForPost(mode: "fixture" | "live", castHash: string, text: string, personaId: string): Promise<{ commitment: string }> {
  // PERSONA LAUNCH P3: the persona is required — every post from here on belongs to one persona (the caller checked it
  // is this device's own, lib/identity/postMode.ts anonPersonaRefusal)
  if (typeof personaId !== "string" || !/^[A-Za-z0-9_]{1,80}$/.test(personaId)) throw new Error("anon attribution: a persona id is required");
  const { secret, commitment } = mintAttributionSecret();
  await putAttributionRecord({ mode, castHash, secret, commitment, text, at: Date.now(), personaId });
  return { commitment };
}

/** the cast hashes THIS device holds a reveal secret for — never the secrets themselves */
export async function revealableCastHashes(): Promise<string[]> {
  return attributionCastHashes();
}

/** PERSONA LAUNCH P3 — the P6 batch-reveal seam: the cast hashes this device can reveal that were posted AS this persona */
export async function attributionCastHashesFor(personaId: string): Promise<string[]> {
  return castHashesForPersona(personaId);
}

export interface RevealResult {
  ok: boolean;
  reason?: string;
  fid?: number;
  attributedAt?: number;
  alreadyAttributed?: boolean;
}

/** The actual reveal: resolve the chosen persona to a fid THIS device owns, recover the secret for that cast, and ask
 * the validator to check the hash preimage and record it. Refuses (never guesses) if the persona is not the caller's
 * own, if it has no fid of its own in this universe to name, or if this device never kept a secret for that cast
 * (someone else's anon post, or a reset since it was made). */
export async function revealAttribution(castHash: string, personaId: string, mode: "fixture" | "live" = "fixture"): Promise<RevealResult> {
  if (!COMMITMENT_RE.test(castHash)) return { ok: false, reason: "castHash malformed" };
  const { isOwnPersona } = await import("@/lib/identity/keystore");
  const { SEED_VIEWER } = await import("@/lib/adapters/mock/store");
  if (!isOwnPersona(personaId) && !SEED_VIEWER.personas.includes(personaId)) {
    return { ok: false, reason: "not one of your personas" };
  }
  const { personaFidRecord } = await import("@/lib/fc/personaFid");
  const rec = await personaFidRecord(personaId);
  if (!rec) return { ok: false, reason: "this persona owns no fid of its own yet — attributing to the shared account says nothing; acquire a fid first or choose a different persona" };
  // PERSONA LAUNCH P6 (fix UX-L2, D7 / R7): a LAUNCHED account reveals its anonymous posts together, at launch, in one
  // signed batch — never one at a time. A single reveal here (while the launch waits for relays, or for a post made
  // after it) would be the drip reveal D7 rules out: each one another reveal-time event to correlate. Refused before
  // anything is signed or sent; the reveal control does not offer launched accounts either.
  if (rec.origin === "layers-launch") return { ok: false, reason: "a launched account reveals its anonymous posts together, at launch — never one at a time" };
  // ANON REVIEW (R3-12): the record's universe must be the reveal's — a fixture fid (9,000,000+) on a live row, or a
  // live fid on a fixture row, would be a claim about an account that does not exist there
  if (rec.mode !== mode) {
    return { ok: false, reason: mode === "live" ? "this persona's account is a test account — a live reveal needs a real one" : "this persona's account is a live account — a fixture reveal cannot name it" };
  }
  const sealed = await attributionRecord(castHash);
  if (!sealed) return { ok: false, reason: "this device holds no reveal secret for that cast — either it is not one this device posted anonymously, or the secret was cleared by a reset" };
  if (sealed.mode !== mode) return { ok: false, reason: "this cast was posted in the other universe" };
  // PERSONA LAUNCH P6: only the persona that posted it may be named (a pre-P3 record names none: the old rule stands)
  if (sealed.personaId && sealed.personaId !== personaId) {
    const pm = (await import("@/lib/identity/postMode")) as { handleOfPersona?: (id: string) => string | null };
    const poster = typeof pm.handleOfPersona === "function" ? pm.handleOfPersona(sealed.personaId) : null;
    return { ok: false, reason: `only the persona that posted it can reveal it${poster ? " (@" + poster + ")" : ""} — naming another of your personas would tie the two together publicly` };
  }
  if (!SECRET_RE.test(sealed.secret)) return { ok: false, reason: "sealed secret malformed" };
  // §14.2 — the secret proves who POSTED it; it says nothing about which account is being named. The fid half of the
  // claim is signed by that fid's derived signer key. On a managed-signer account that key is not registered on the
  // fid, so the finished record is checkable inside Totem only (header; R3-06) — the validator still binds it.
  const { fcSignerPublicKeyFor, signAsFcSignerFor } = await import("@/lib/identity/keys");
  const signerPubKey = fcSignerPublicKeyFor(personaId);
  if (!signerPubKey) return { ok: false, reason: "no signer key for this persona's fid — a reveal has to be signed by the account it names" };
  const signature = signAsFcSignerFor(personaId, revealCanonical(mode, castHash, rec.fid, signerPubKey));
  if (!signature) return { ok: false, reason: "this persona's fid signer key is unavailable on this device — reveal from the device that holds it" };
  const res = await fetch(`${validatorUrl()}/zk/anon/reveal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, castHash, secret: sealed.secret, fid: rec.fid, signerPubKey, signature }),
  }).catch((e) => {
    throw new Error("validator unreachable: " + (e as Error).message);
  });
  const json = (await res.json().catch(() => null)) as { error?: string; attributedFid?: number; attributedAt?: number; alreadyAttributed?: boolean } | null;
  if (!res.ok) return { ok: false, reason: json?.error ?? `validator refused (${res.status})` };
  return { ok: true, fid: json?.attributedFid ?? rec.fid, attributedAt: json?.attributedAt, alreadyAttributed: !!json?.alreadyAttributed };
}

/**
 * Kept for its callers (the dev reset, reloadIdentity): the secrets now live in the store's own `zkQueue` namespace,
 * which those paths reset and re-hydrate themselves, so there is no separate cache to forget here any more.
 */
export function resetAnonAttributionCache(): void {
  /* nothing cached outside the store */
}
