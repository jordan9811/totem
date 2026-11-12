import "server-only";
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — Face ID / fingerprint sign-in for the owner service: the WebAuthn policy over
// lib/custody/webauthn.ts (the custody wrap path's verifier, reused: WebCrypto, no CBOR, no attestation) and
// lib/platform/owner-store.server.ts (the volume).
//
//   relying party   RP ID = APP_URL's host, origin = APP_URL's origin, compared EXACTLY — never the request's Host
//                   or Origin header; no APP_URL (or one WebAuthn cannot use) and passkeys are simply unavailable
//   sign-in         a discoverable credential, so the options carry NO allowCredentials — a stranger who asks learns
//                   a challenge and the RP ID, nothing else (not whether any passkey exists, not one credential id);
//                   user verification REQUIRED; the challenge is server-stored, single-use, two minutes
//   assertion       the stored key, the exact origin and RP ID hash, UP + UV, the user handle, the backup-eligible
//                   flag unchanged since registration, and the signature counter strictly increasing (both zero is
//                   the synced-passkey case and passes); the counter and backup state are written back in the same
//                   synchronous step that re-reads the record, so two replays of one counter cannot both pass
//   registration    only from a PASSPHRASE session at most OWNER_ENROLL_FRESH_MS old; at most OWNER_PASSKEYS_MAX;
//                   a platform authenticator, a discoverable credential, UV required, attestation "none"; the
//                   challenge belongs to the session that asked for it; a duplicate credential id is refused; a
//                   credential id shorter than OWNER_PASSKEY_ID_MIN_BYTES is refused (review PK-2); and the commit
//                   is refused when the session's epoch is no longer the volume's (signed out meanwhile — review UX-1:
//                   the route then signs THIS device in with the new passkey, for that epoch)
import { WEBAUTHN_ALG, verifyAssertion, verifyRegistration } from "@/lib/custody/webauthn";
import {
  OWNER_ENROLL_FRESH_MS,
  OWNER_PASSKEYS_MAX,
  OWNER_PASSKEY_ID_MIN_BYTES,
  VIA_PASSPHRASE,
  ownerPasskeyBinding,
  type OwnerSession,
} from "@/lib/platform/owner-access";
import {
  OwnerStateError,
  cleanPasskeyName,
  issueOwnerChallenge,
  livePasskeys,
  newPasskeySlot,
  readOwnerState,
  takeOwnerChallenge,
  withOwnerState,
  type StoredPasskey,
} from "@/lib/platform/owner-store.server";

export interface OwnerRelyingParty {
  rpId: string;
  origin: string;
}

/** ES256 first: every platform authenticator the owner will meet supports it, and the first supported entry wins */
export const OWNER_PASSKEY_ALGS = [WEBAUTHN_ALG.ES256, WEBAUTHN_ALG.EdDSA, WEBAUTHN_ALG.RS256] as const;
export const OWNER_WEBAUTHN_TIMEOUT_MS = 60_000;
export const OWNER_RP_NAME = "Totem (owner)";
/** the account name a passkey is saved under (user.name and user.displayName) */
export const OWNER_PASSKEY_USER_NAME = "Totem owner";

/** the relying party, from APP_URL only; null when it is unset or WebAuthn cannot use it (not https — loopback http
 *  aside — or an IP address, which can never be an RP ID) */
export function ownerRelyingParty(env: Record<string, string | undefined> = process.env): OwnerRelyingParty | null {
  const raw = (env.APP_URL ?? "").trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!host || /^[0-9.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (host === "localhost" || host.endsWith(".localhost")))) return null;
  return { rpId: host, origin: u.origin };
}

/** the Origin header of a browser request to a passkey route must be the relying party's own, exactly. Browsers send
 *  it on every POST; a missing one is refused here (these routes are for a browser, never a script). */
export function passkeyOriginOk(headers: Headers, rp: OwnerRelyingParty): boolean {
  return headers.get("origin") === rp.origin;
}

export type Outcome<T> = ({ ok: true } & T) | { ok: false; reason: string; status: number; code?: string };

/** a refusal reason as it may be logged: a parse error can quote a few characters of what the caller sent, so only
 *  plain characters survive, and never more than a short line */
export function loggableReason(reason: string): string {
  return reason.replace(/[^A-Za-z0-9 :._-]/g, "?").slice(0, 80);
}
const fail = (reason: string, status: number, code?: string): { ok: false; reason: string; status: number; code?: string } => ({ ok: false, reason, status, code });

const B64URL = /^[A-Za-z0-9_-]+$/;
function b64(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max && B64URL.test(v) ? v : null;
}
/** the challenge INSIDE what the authenticator signed — the one value a caller cannot choose apart from the signature */
function challengeOf(clientDataJSON: string): unknown {
  try {
    return (JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as { challenge?: unknown })?.challenge;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------------------------------------ sign-in

export interface SignInOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: "required";
}

/** what a stranger may have: a fresh challenge and the RP ID. No allowCredentials, no count, no user — the same
 *  answer whether no passkey or five are registered. Null when too many sign-ins are outstanding. */
export function ownerSignInOptions(rp: OwnerRelyingParty, now = Date.now()): SignInOptions | null {
  const challenge = issueOwnerChallenge("login", null, now);
  if (!challenge) return null;
  return { challenge, rpId: rp.rpId, timeout: OWNER_WEBAUTHN_TIMEOUT_MS, userVerification: "required" };
}

/** what an AUTHENTICATED owner's browser may be told after a passkey sign-in, for the WebAuthn Signal API (review
 *  UX-10): the passkeys still registered, so a removed or retired one disappears from the iCloud Keychain / Google
 *  Password Manager picker. Never sent to anyone who has not just signed in. */
export interface OwnerPasskeySignal {
  rpId: string;
  userId: string;
  allAcceptedCredentialIds: string[];
}

/** a passkey sign-in: a verified assertion in, the epoch and slot to mint a session for out (and, for the device's
 *  hint and the Signal API, the slots and credential ids still live) */
export async function verifyOwnerPasskeySignIn(
  secret: string,
  rp: OwnerRelyingParty,
  body: unknown,
  now = Date.now()
): Promise<Outcome<{ slot: string; epoch: string; liveSlots: string[]; signal: OwnerPasskeySignal }>> {
  const b = (body ?? {}) as { id?: unknown; rawId?: unknown; type?: unknown; response?: unknown };
  const r = (b.response ?? {}) as Record<string, unknown>;
  const id = b64(b.rawId, 1400);
  const clientDataJSON = b64(r.clientDataJSON, 4096);
  const authenticatorData = b64(r.authenticatorData, 4096);
  const signature = b64(r.signature, 2048);
  const userHandle = r.userHandle === null || r.userHandle === undefined ? null : b64(r.userHandle, 128);
  if (!id || !clientDataJSON || !authenticatorData || !signature || (b.id !== undefined && b.id !== id)) return fail("malformed", 400);
  // spend the challenge FIRST: whatever happens below, this assertion can never be presented again
  const challenge = challengeOf(clientDataJSON);
  if (!takeOwnerChallenge(challenge, "login", null, now)) return fail("challenge", 401);

  const binding = await ownerPasskeyBinding(secret);
  let cred: StoredPasskey | undefined;
  let ownerHandle: string;
  try {
    const s = readOwnerState();
    if (!s) return fail("no-state", 401);
    cred = livePasskeys(s, binding).find((p) => p.id === id);
    ownerHandle = s.userHandle;
  } catch {
    return fail("state-unreadable", 503);
  }
  // L3 §7.2 step 6: a discoverable sign-in names its user; it must be this service's owner
  if (!cred) return fail("unknown-credential", 401);
  if (userHandle !== ownerHandle) return fail("user-handle", 401);

  const v = await verifyAssertion(
    { credentialId: id, clientDataJSON, authenticatorData, signature, spkiHex: cred.publicKey, alg: cred.alg },
    { expectedChallenge: challenge as string, allowedOrigins: [rp.origin], rpId: rp.rpId, requireUserVerification: true }
  );
  if (!v.ok || !v.flags || typeof v.signCount !== "number") return fail(v.reason ?? "assertion", 401);
  const flags = v.flags;
  const signCount = v.signCount;
  // L3 §7.2 step 19: backup eligibility is fixed for a credential's lifetime
  if (flags.be !== cred.backupEligible) return fail("backup-eligibility", 401);

  // the commit: one synchronous read-modify-write — the record re-read (removed meanwhile? refused), the counter
  // re-checked against what is stored NOW (L3 §7.2 step 23: not increasing means a possible clone — refused)
  try {
    return withOwnerState<Outcome<{ slot: string; epoch: string; liveSlots: string[]; signal: OwnerPasskeySignal }>>((s) => {
      const live = livePasskeys(s, binding);
      const c = live.find((p) => p.id === id);
      if (!c) return { write: false, result: fail("unknown-credential", 401) };
      if ((signCount !== 0 || c.signCount !== 0) && signCount <= c.signCount) return { write: false, result: fail("counter", 401) };
      c.signCount = signCount;
      c.backupState = flags.bs;
      c.lastUsedAt = now;
      return {
        write: true,
        result: {
          ok: true as const,
          slot: c.slot,
          epoch: s.epoch,
          liveSlots: live.map((p) => p.slot),
          signal: { rpId: rp.rpId, userId: s.userHandle, allAcceptedCredentialIds: live.map((p) => p.id) },
        },
      };
    });
  } catch (e) {
    return fail(e instanceof OwnerStateError ? "state-" + e.kind : "state", 503);
  }
}

// ------------------------------------------------------------------------------------------------ registration

/** registration needs a passphrase session, freshly signed in — the precondition that makes a new credential the owner's */
export function enrollmentProblem(session: OwnerSession, now = Date.now()): { status: number; code: string; error: string } | null {
  if (session.via !== VIA_PASSPHRASE || now - session.iat > OWNER_ENROLL_FRESH_MS) {
    return {
      status: 403,
      code: "passphrase_required",
      error: "To add Face ID / fingerprint, sign in with your passphrase first (it keeps a stolen session from adding its own way back in).",
    };
  }
  return null;
}

export interface RegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout: number;
  attestation: "none";
  authenticatorSelection: { authenticatorAttachment: "platform"; residentKey: "required"; requireResidentKey: true; userVerification: "required" };
  /** the registered credentials, so a device that already has one is not asked to make a second — sent only to an
   *  owner session (this route is gated) */
  excludeCredentials: { type: "public-key"; id: string; transports?: string[] }[];
}

export async function ownerRegistrationOptions(
  secret: string,
  rp: OwnerRelyingParty,
  session: OwnerSession,
  now = Date.now()
): Promise<Outcome<{ options: RegistrationOptions }>> {
  const binding = await ownerPasskeyBinding(secret);
  let live: StoredPasskey[];
  let userHandle: string;
  try {
    const s = readOwnerState();
    if (!s) return fail("no-state", 409, "sign_in_again");
    live = livePasskeys(s, binding);
    userHandle = s.userHandle;
  } catch {
    return fail("state-unreadable", 503);
  }
  if (live.length >= OWNER_PASSKEYS_MAX) return fail("full", 409, "passkeys_full");
  const challenge = issueOwnerChallenge("register", session.nonce, now);
  if (!challenge) return fail("challenges-full", 503);
  return {
    ok: true,
    options: {
      challenge,
      rp: { id: rp.rpId, name: OWNER_RP_NAME },
      // review UX-12: the name the phone's passkey screens and the Passwords app show — one he recognises
      user: { id: userHandle, name: OWNER_PASSKEY_USER_NAME, displayName: OWNER_PASSKEY_USER_NAME },
      pubKeyCredParams: OWNER_PASSKEY_ALGS.map((alg) => ({ type: "public-key" as const, alg })),
      timeout: OWNER_WEBAUTHN_TIMEOUT_MS,
      attestation: "none",
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", requireResidentKey: true, userVerification: "required" },
      excludeCredentials: live.map((p) => ({ type: "public-key" as const, id: p.id, ...(p.transports.length ? { transports: p.transports } : {}) })),
    },
  };
}

function cleanTransports(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) if (typeof t === "string" && /^[a-z-]{1,32}$/.test(t) && !out.includes(t) && out.length < 8) out.push(t);
  return out;
}

/** a new passkey: the create() response verified, then stored in one synchronous step (cap, duplicates and the
 *  session's epoch re-checked). Out: the new passkey, and the epoch it was stored in — the route signs THIS device in
 *  with it (review UX-1), so the device's session ends when its passkey is removed. */
export async function verifyOwnerPasskeyRegistration(
  secret: string,
  rp: OwnerRelyingParty,
  session: OwnerSession,
  body: unknown,
  now = Date.now()
): Promise<Outcome<{ passkey: { slot: string; name: string }; epoch: string }>> {
  const b = (body ?? {}) as { name?: unknown; credential?: unknown };
  const c = (b.credential ?? {}) as { id?: unknown; rawId?: unknown; response?: unknown };
  const r = (c.response ?? {}) as Record<string, unknown>;
  const rawId = b64(c.rawId, 1400);
  const clientDataJSON = b64(r.clientDataJSON, 4096);
  const authenticatorData = b64(r.authenticatorData, 8192);
  const publicKey = b64(r.publicKey, 2048);
  const alg = typeof r.publicKeyAlgorithm === "number" ? r.publicKeyAlgorithm : NaN;
  if (!rawId || !clientDataJSON || !authenticatorData || !publicKey || !Number.isInteger(alg) || (c.id !== undefined && c.id !== rawId)) return fail("malformed", 400);
  const challenge = challengeOf(clientDataJSON);
  // review UX-5: a spent or expired registration challenge (the prompt sat open past two minutes, the service
  // restarted) is "try again" (400), never 401 — 401 means "no session", and this session is still signed in
  if (!takeOwnerChallenge(challenge, "register", session.nonce, now)) return fail("challenge", 400, "try_again");

  const v = await verifyRegistration(
    { credentialId: rawId, clientDataJSON, authenticatorData, publicKey, alg },
    { expectedChallenge: challenge as string, allowedOrigins: [rp.origin], rpId: rp.rpId, requireUserVerification: true, allowedAlgorithms: OWNER_PASSKEY_ALGS }
  );
  if (!v.ok || !v.credentialId || !v.spkiHex || typeof v.alg !== "number" || typeof v.signCount !== "number" || !v.flags || !v.aaguid) {
    return fail(v.reason ?? "registration", 400);
  }
  // review PK-2: the shared verifier (the custody path's too) accepts any id of 1 to 1023 bytes; the owner's volume
  // keeps ids of OWNER_PASSKEY_ID_MIN_BYTES or more — refused here, by name, before anything is stored
  if (Buffer.from(v.credentialId, "base64url").length < OWNER_PASSKEY_ID_MIN_BYTES) return fail("credential-id-short", 400);
  const flags = v.flags;
  const name = cleanPasskeyName(b.name) ?? "Passkey";
  const binding = await ownerPasskeyBinding(secret);
  const record = {
    id: v.credentialId,
    publicKey: v.spkiHex,
    alg: v.alg,
    signCount: v.signCount,
    aaguid: v.aaguid,
  };
  try {
    return withOwnerState<Outcome<{ passkey: { slot: string; name: string }; epoch: string }>>((s) => {
      // signed out everywhere (or the session's epoch otherwise retired) while the prompt was open: nothing is stored,
      // and no session is minted for the new epoch from a session that belonged to the old one
      if (s.epoch !== session.epoch) return { write: false, result: fail("epoch", 401) };
      if (s.passkeys.some((p) => p.id === record.id)) return { write: false, result: fail("duplicate", 409, "passkey_exists") };
      if (livePasskeys(s, binding).length >= OWNER_PASSKEYS_MAX) return { write: false, result: fail("full", 409, "passkeys_full") };
      const slot = newPasskeySlot(s);
      s.passkeys.push({
        slot,
        id: record.id,
        name,
        publicKey: record.publicKey,
        alg: record.alg,
        signCount: record.signCount,
        backupEligible: flags.be,
        backupState: flags.bs,
        transports: cleanTransports(r.transports),
        aaguid: record.aaguid,
        createdAt: now,
        lastUsedAt: null,
        binding,
      });
      return { write: true, result: { ok: true as const, passkey: { slot, name }, epoch: s.epoch } };
    });
  } catch (e) {
    if (e instanceof OwnerStateError && e.kind === "absent") return fail("no-state", 409, "sign_in_again");
    // the volume's reader would not accept the record (the writer's guard): nothing was stored — a refusal, not an outage
    if (e instanceof OwnerStateError && e.kind === "rejected") return fail("state-rejected", 400);
    return fail(e instanceof OwnerStateError ? "state-" + e.kind : "state", 503);
  }
}

// ------------------------------------------------------------------------------------------------ the Security page

export interface OwnerPasskeyView {
  slot: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** a syncable passkey (iCloud Keychain, Google Password Manager, …) */
  synced: boolean;
}

/** what the Security page lists: names and dates, never a key or a credential id */
export async function ownerPasskeyViews(secret: string): Promise<{ passkeys: OwnerPasskeyView[]; epochAt: number | null }> {
  const binding = await ownerPasskeyBinding(secret);
  const s = readOwnerState();
  if (!s) return { passkeys: [], epochAt: null };
  return {
    passkeys: livePasskeys(s, binding).map((p) => ({ slot: p.slot, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt, synced: p.backupEligible })),
    epochAt: s.epochAt,
  };
}
