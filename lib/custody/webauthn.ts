import "server-only";
// BROWSER KEYSTORE PASS Gate 2 — WebAuthn ASSERTION verification on the app server, for the wrap path only
// (D-CU-2-NO-CBOR-NO-ATTESTATION). No attestation object is ever parsed: the browser hands over the credential's
// SPKI public key at registration, and every release verifies an assertion over authenticatorData ‖ SHA-256(clientDataJSON)
// with WebCrypto — Ed25519 raw, or ECDSA P-256 after DER-to-raw — plus the challenge, the origin, the RP id hash and
// the user-present flag. Nothing here is a primitive of our own.
//
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — the owner service's sign-in reuses this verifier, unchanged in approach (still
// no CBOR, still no attestation), with four additions that are no-ops for the custody wrap path:
//   * VerifyContext.requireUserVerification — the UV flag (Face ID / fingerprint / device PIN actually ran), which the
//     owner gate demands and the wrap path never asked for
//   * the parsed flags and signature counter come back on success, so a caller can enforce counter monotonicity and
//     the backup-eligible / backup-state rules (WebAuthn L3 §7.2 steps 18, 19 and 23)
//   * RS256 (-257), the algorithm Windows Hello credentials have historically used
//   * verifyRegistration: the CREATE ceremony's own checks (type, challenge, origin, RP id hash, UP/UV, the attested
//     credential id) over getAuthenticatorData() — the fixed-layout bytes, not the CBOR attestation object — with the
//     SPKI the browser's getPublicKey() returns, imported by WebCrypto to prove it is a key of the declared algorithm
// Two spec MUSTs are now enforced for every caller, the wrap path included: clientData.crossOrigin true is refused
// (no page of this app is framed: middleware.ts sends frame-ancestors 'none'), and a backup state without backup
// eligibility is refused. A real authenticator never produces either on a top-level page.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface AssertionInput {
  credentialId: string; // base64url
  authenticatorData: string; // base64url
  clientDataJSON: string; // base64url
  signature: string; // base64url
  spkiHex: string;
  alg: number; // -8 Ed25519, -7 ES256, -257 RS256
}

const fromB64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const toB64url = (b: Buffer | Uint8Array): string => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** the COSE algorithms this verifier understands */
export const WEBAUTHN_ALG = { ES256: -7, EdDSA: -8, RS256: -257 } as const;

/** authenticatorData's flags byte (WebAuthn L3 §6.1) */
export interface AuthenticatorFlags {
  /** user present */
  up: boolean;
  /** user verified: the biometric or device PIN ran */
  uv: boolean;
  /** backup eligible: the credential can be synced (a "passkey" in a password manager); fixed for its lifetime */
  be: boolean;
  /** backup state: the credential IS currently backed up / synced */
  bs: boolean;
  /** attested credential data follows (registration only) */
  at: boolean;
  /** extension data follows */
  ed: boolean;
}

export interface ParsedAuthenticatorData {
  rpIdHash: Buffer;
  flags: AuthenticatorFlags;
  signCount: number;
  /** present when the AT flag is set: the authenticator's model id and the new credential's id */
  attested: { aaguid: string; credentialId: Buffer } | null;
}

/** authenticatorData's fixed layout: rpIdHash(32) ‖ flags(1) ‖ signCount(4, big-endian) ‖ [aaguid(16) ‖ idLen(2) ‖
 *  credentialId(idLen) ‖ COSE key ‖ extensions]. Only the fixed-layout part is read — the COSE key and the extensions
 *  are CBOR and are never parsed (D-CU-2-NO-CBOR-NO-ATTESTATION). Throws on a truncated buffer. */
export function parseAuthenticatorData(authData: Buffer): ParsedAuthenticatorData {
  if (authData.length < 37) throw new Error("webauthn: authenticatorData is shorter than 37 bytes");
  const f = authData[32];
  const flags: AuthenticatorFlags = { up: (f & 0x01) !== 0, uv: (f & 0x04) !== 0, be: (f & 0x08) !== 0, bs: (f & 0x10) !== 0, at: (f & 0x40) !== 0, ed: (f & 0x80) !== 0 };
  const signCount = authData.readUInt32BE(33);
  let attested: ParsedAuthenticatorData["attested"] = null;
  if (flags.at) {
    if (authData.length < 55) throw new Error("webauthn: attested credential data is truncated");
    const len = authData.readUInt16BE(53);
    // the spec caps a credential id at 1023 bytes (L3 §7.1 step 25)
    if (len < 1 || len > 1023 || authData.length < 55 + len) throw new Error("webauthn: the attested credential id is out of range");
    attested = { aaguid: authData.subarray(37, 53).toString("hex"), credentialId: authData.subarray(55, 55 + len) };
  }
  return { rpIdHash: authData.subarray(0, 32), flags, signCount, attested };
}

/** a verifying key for one COSE algorithm, from SPKI DER; null for an algorithm this verifier does not support. Throws
 *  when the bytes are not a key of that algorithm (WebCrypto's own parser decides — no DER of ours). */
async function importVerifyKey(spki: Buffer, alg: number): Promise<CryptoKey | null> {
  const subtle = globalThis.crypto.subtle;
  const data = view(spki);
  if (alg === WEBAUTHN_ALG.EdDSA) return subtle.importKey("spki", data, { name: "Ed25519" }, false, ["verify"]);
  if (alg === WEBAUTHN_ALG.ES256) return subtle.importKey("spki", data, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (alg === WEBAUTHN_ALG.RS256) {
    const key = await subtle.importKey("spki", data, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    // a short RSA modulus is not a key worth accepting at registration or trusting at sign-in
    if ((key.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) throw new Error("webauthn: RSA modulus shorter than 2048 bits");
    return key;
  }
  return null;
}

// TypeScript 5.7 types Buffer over ArrayBufferLike; WebCrypto wants ArrayBuffer-backed views — these are
function view(b: Buffer): BufferSource {
  return b as unknown as BufferSource;
}

/** ES256 signatures arrive DER-encoded; WebCrypto wants r ‖ s, 32 bytes each */
function derToRaw(der: Buffer): Buffer {
  if (der[0] !== 0x30) throw new Error("webauthn: ECDSA signature is not a DER sequence");
  let i = 2;
  if (der[1] & 0x80) i += der[1] & 0x7f;
  const read = (): Buffer => {
    if (der[i++] !== 0x02) throw new Error("webauthn: DER integer expected");
    let len = der[i++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let k = 0; k < n; k++) len = (len << 8) | der[i++];
    }
    let v = der.subarray(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    if (v.length > 32) throw new Error("webauthn: DER integer too long");
    return Buffer.concat([Buffer.alloc(32 - v.length), v]);
  };
  const r = read();
  const s = read();
  return Buffer.concat([r, s]);
}

export interface VerifyContext {
  expectedChallenge: string; // base64url, as issued
  allowedOrigins: string[];
  rpId: string;
  /** OWNER PASSKEYS: refuse an assertion whose UV flag is clear (the wrap path leaves this unset: user-present only) */
  requireUserVerification?: boolean;
}

export interface AssertionResult {
  ok: boolean;
  /** for the server log, never for the response */
  reason?: string;
  /** on success: the assertion's flags and signature counter, for the caller's counter / backup-state rules */
  flags?: AuthenticatorFlags;
  signCount?: number;
}

type ClientData = { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };

/** the clientDataJSON checks both ceremonies share: type, challenge (constant time), an EXACT origin from the
 *  caller's configured list (never the request's), and no cross-origin iframe */
function clientDataProblem(cd: ClientData, type: "webauthn.get" | "webauthn.create", ctx: { expectedChallenge: string; allowedOrigins: string[] }): string | null {
  if (cd.type !== type) return "type";
  if (typeof cd.challenge !== "string" || !safeEq(cd.challenge, ctx.expectedChallenge)) return "challenge";
  if (typeof cd.origin !== "string" || !ctx.allowedOrigins.includes(cd.origin)) return "origin";
  if (cd.crossOrigin === true) return "crossOrigin";
  return null;
}

/** true only if EVERY check passes; the reason is for the server log, never for the response */
export async function verifyAssertion(a: AssertionInput, ctx: VerifyContext): Promise<AssertionResult> {
  try {
    const clientDataJSON = fromB64url(a.clientDataJSON);
    const clientData = JSON.parse(clientDataJSON.toString("utf8")) as ClientData;
    const cdProblem = clientDataProblem(clientData, "webauthn.get", ctx);
    if (cdProblem) return { ok: false, reason: cdProblem };

    const authData = fromB64url(a.authenticatorData);
    if (authData.length < 37) return { ok: false, reason: "authenticatorData" };
    const parsed = parseAuthenticatorData(authData);
    const rpIdHash = createHash("sha256").update(ctx.rpId).digest();
    if (!safeEq(parsed.rpIdHash.toString("hex"), rpIdHash.toString("hex"))) return { ok: false, reason: "rpIdHash" };
    if (!parsed.flags.up) return { ok: false, reason: "user-present" };
    if (ctx.requireUserVerification && !parsed.flags.uv) return { ok: false, reason: "user-verified" };
    // L3 §7.2 step 18: a credential cannot be backed up without being backup-eligible
    if (parsed.flags.bs && !parsed.flags.be) return { ok: false, reason: "backup-state" };

    const signed = Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]);
    const sig = fromB64url(a.signature);
    const spki = Buffer.from(a.spkiHex, "hex");
    const subtle = globalThis.crypto.subtle;
    const key = await importVerifyKey(spki, a.alg);
    if (!key) return { ok: false, reason: "alg" };
    let ok: boolean;
    if (a.alg === WEBAUTHN_ALG.EdDSA) ok = await subtle.verify({ name: "Ed25519" }, key, view(sig), view(signed));
    else if (a.alg === WEBAUTHN_ALG.ES256) ok = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, view(derToRaw(sig)), view(signed));
    else ok = await subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, view(sig), view(signed));
    return ok ? { ok: true, flags: parsed.flags, signCount: parsed.signCount } : { ok: false, reason: "signature" };
  } catch (e) {
    return { ok: false, reason: "malformed: " + (e as Error).message };
  }
}

/** OWNER PASSKEYS — what the browser hands over after navigator.credentials.create(), all base64url */
export interface RegistrationInput {
  /** the credential's rawId */
  credentialId: string;
  clientDataJSON: string;
  /** AuthenticatorAttestationResponse.getAuthenticatorData() — the fixed-layout bytes, no CBOR */
  authenticatorData: string;
  /** AuthenticatorAttestationResponse.getPublicKey() — SPKI DER */
  publicKey: string;
  /** AuthenticatorAttestationResponse.getPublicKeyAlgorithm() — a COSE algorithm number */
  alg: number;
}

export interface RegistrationContext {
  expectedChallenge: string; // base64url, as issued
  allowedOrigins: string[];
  rpId: string;
  requireUserVerification: boolean;
  /** the algorithms the options offered (pubKeyCredParams) */
  allowedAlgorithms: readonly number[];
}

export interface RegistrationResult {
  ok: boolean;
  reason?: string;
  credentialId?: string; // base64url, canonical
  spkiHex?: string;
  alg?: number;
  signCount?: number;
  flags?: AuthenticatorFlags;
  aaguid?: string;
}

/**
 * OWNER PASSKEYS — the registration (create) ceremony's checks, WebAuthn L3 §7.1, without the attestation statement
 * (the options ask for attestation "none"; trust in a new credential comes from the CALLER's precondition — on the
 * owner service, a fresh passphrase session — not from the authenticator's maker). Checked: clientData type
 * "webauthn.create", the challenge, the exact origin, no cross-origin iframe; authenticatorData's RP id hash, UP, UV
 * when required, BS only with BE, the AT flag and its credential id equal to the rawId; the algorithm one the options
 * offered; and the public key a key of that algorithm (WebCrypto imports it, or the registration is refused).
 *
 * Stated limit (D-CU-2-NO-CBOR-NO-ATTESTATION, kept): the SPKI is the browser's getPublicKey(), not decoded from the
 * COSE key inside authenticatorData. A client that lied about it would only register a key its authenticator cannot
 * sign for — its first sign-in fails. It cannot widen access: the precondition already is the owner.
 */
export async function verifyRegistration(r: RegistrationInput, ctx: RegistrationContext): Promise<RegistrationResult> {
  try {
    const clientData = JSON.parse(fromB64url(r.clientDataJSON).toString("utf8")) as ClientData;
    const cdProblem = clientDataProblem(clientData, "webauthn.create", ctx);
    if (cdProblem) return { ok: false, reason: cdProblem };

    const parsed = parseAuthenticatorData(fromB64url(r.authenticatorData));
    const rpIdHash = createHash("sha256").update(ctx.rpId).digest();
    if (!safeEq(parsed.rpIdHash.toString("hex"), rpIdHash.toString("hex"))) return { ok: false, reason: "rpIdHash" };
    if (!parsed.flags.up) return { ok: false, reason: "user-present" };
    if (ctx.requireUserVerification && !parsed.flags.uv) return { ok: false, reason: "user-verified" };
    if (parsed.flags.bs && !parsed.flags.be) return { ok: false, reason: "backup-state" };
    if (!parsed.attested) return { ok: false, reason: "attested-credential-data" };
    const rawId = fromB64url(r.credentialId);
    // the id the browser reports must be the id the authenticator attested, byte for byte, and canonically encoded
    if (toB64url(rawId) !== r.credentialId || !rawId.equals(parsed.attested.credentialId)) return { ok: false, reason: "credential-id" };

    if (!ctx.allowedAlgorithms.includes(r.alg)) return { ok: false, reason: "alg" };
    const spki = fromB64url(r.publicKey);
    if (spki.length < 32 || spki.length > 1024) return { ok: false, reason: "public-key" };
    const key = await importVerifyKey(spki, r.alg);
    if (!key) return { ok: false, reason: "alg" };
    return {
      ok: true,
      credentialId: r.credentialId,
      spkiHex: spki.toString("hex"),
      alg: r.alg,
      signCount: parsed.signCount,
      flags: parsed.flags,
      aaguid: parsed.attested.aaguid,
    };
  } catch (e) {
    return { ok: false, reason: "malformed: " + (e as Error).message };
  }
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** a challenge the server can recognise later without storing it: random bytes, an expiry, and an HMAC over both */
export function issueChallenge(secret: Buffer, ttlMs = 120_000): { challenge: string; exp: number; sig: string } {
  const challenge = toB64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const exp = Date.now() + ttlMs;
  const sig = createHmac("sha256", secret).update("layers/custody/challenge/v1|" + challenge + "|" + exp).digest("hex");
  return { challenge, exp, sig };
}

const spent = new Map<string, number>();
export function acceptChallenge(secret: Buffer, c: { challenge: string; exp: number; sig: string }): boolean {
  if (typeof c?.challenge !== "string" || typeof c?.exp !== "number" || typeof c?.sig !== "string") return false;
  if (Date.now() > c.exp) return false;
  const expect = createHmac("sha256", secret).update("layers/custody/challenge/v1|" + c.challenge + "|" + c.exp).digest("hex");
  if (!safeEq(expect, c.sig)) return false;
  if (spent.has(c.challenge)) return false;
  spent.set(c.challenge, c.exp);
  const now = Date.now();
  for (const [k, e] of spent) if (e < now) spent.delete(k);
  return true;
}
