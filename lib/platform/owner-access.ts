// PROD-LIVE (D-PRODLIVE-OWNER-SERVICE) — THE OWNER ACCESS GATE's crypto, shared by middleware.ts (Edge runtime) and
// the owner routes and pages (Node runtime). Web Crypto only (crypto.subtle), so the same code runs in the Edge
// sandbox, in Node 20+, and in a browser, where it is inert (the browser's environment carries no owner secret). No
// node: import may ever land here — middleware.ts bundles this file for the Edge runtime; the volume-backed half of
// the gate is lib/platform/owner-store.server.ts, which this file reaches only through a registered callback.
//
// What the cookie holds: when it was issued, when it expires, the server's SESSION EPOCH at issue, HOW the owner signed
// in (the passphrase, or one registered passkey's opaque slot id), a random nonce, and an HMAC over all of them under
// a key DERIVED from the owner's passphrase. Never the passphrase, never anything the passphrase can be read back
// from. The cookie is __Host- prefixed (Secure, Path=/, no Domain), httpOnly and SameSite=Strict: page script cannot
// read it, and a cross-site request never carries it, so the gate is also the owner service's CSRF defence.
//
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — a session is good only while ALL of these hold:
//   * its MAC verifies under the current passphrase (rotating OWNER_ACCESS_SECRET still ends every session at once,
//     and also retires every passkey registered under the old one: see ownerPasskeyBinding)
//   * it has not expired: OWNER_SESSION_DAYS (default 30, capped at 90) from sign-in, per device
//   * its epoch is the server's CURRENT epoch — "sign out everywhere" draws a new one on the volume, and every cookie
//     issued before it stops working
//   * when it came from a passkey, that passkey is still registered — removing a passkey signs out what it signed in
// The first two are stateless (checkable anywhere); the last two need the volume's state, which the Node side reads
// directly (ownerSessionRefused, the owner routes) and the Edge middleware fetches from the server's own internal
// route (middleware.ts, OWNER_STATE_API). A v1 cookie (no epoch: the one-day passphrase cookie this pass replaces)
// is refused — after this deploy the owner signs in once more.

// the gate's names (cookies, pages, routes, limits) live in a constants-only module the browser code can import too
export * from "@/lib/platform/owner-paths";
import { OWNER_COOKIE, OWNER_HINT_COOKIE, OWNER_LOGIN_API, OWNER_LOGIN_PATH, OWNER_SESSION_DAYS_DEFAULT, OWNER_SESSION_DAYS_MAX, VIA_PASSPHRASE } from "@/lib/platform/owner-paths";

const DAY_MS = 24 * 60 * 60 * 1000;
/** clock skew tolerated on issue and expiry checks */
const SKEW_MS = 60_000;

/** Read at REQUEST time, not build time. The dynamic key keeps any bundler from inlining the value into a build
 *  artifact (the same device lib/platform/maintenance.ts uses) — a passphrase must never land in .next/.
 *  Surrounding whitespace is dropped (a value piped into the platform from a file can carry a trailing newline);
 *  the submitted passphrase is trimmed the same way, so the two always compare like for like. */
export function readOwnerSecret(env: Record<string, string | undefined> = process.env): string | null {
  const key = "OWNER_" + "ACCESS_SECRET";
  const raw = env[key];
  const v = typeof raw === "string" ? raw.trim() : "";
  return v !== "" ? v : null;
}

/** OWNER_SESSION_DAYS: how long one device stays signed in. A whole number of days; unset, malformed or below 1 is
 *  the default (30); above the cap is the cap (90). */
export function ownerSessionDays(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.OWNER_SESSION_DAYS ?? "").trim();
  if (!/^[0-9]{1,6}$/.test(raw)) return OWNER_SESSION_DAYS_DEFAULT;
  const n = Number(raw);
  if (n < 1) return OWNER_SESSION_DAYS_DEFAULT;
  return Math.min(n, OWNER_SESSION_DAYS_MAX);
}
export function ownerSessionMs(env: Record<string, string | undefined> = process.env): number {
  return ownerSessionDays(env) * DAY_MS;
}

const enc = new TextEncoder();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/** a plain ArrayBuffer copy: Web Crypto takes a BufferSource, and newer TypeScript lib types will not accept a
 *  Uint8Array whose buffer might be shared */
function ab(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.length);
  new Uint8Array(out).set(u);
  return out;
}
function unhex(s: string): ArrayBuffer | null {
  if (!/^[0-9a-f]*$/.test(s) || s.length % 2) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return ab(out);
}
async function hmacKey(raw: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", ab(raw), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

let cached: { secret: string; key: Promise<CryptoKey> } | null = null;
/** the session MAC key: HMAC(passphrase, fixed label) — domain-separated from anything else the passphrase keys */
function sessionKey(secret: string): Promise<CryptoKey> {
  if (cached && cached.secret === secret) return cached.key;
  const key = (async () => {
    const base = await hmacKey(enc.encode(secret), ["sign"]);
    const derived = new Uint8Array(await crypto.subtle.sign("HMAC", base, enc.encode("layers-owner-session-key/v1")));
    return hmacKey(derived, ["sign", "verify"]);
  })();
  cached = { secret, key };
  return key;
}
/** a labelled tag under the session key — each label is its own domain, never a cookie's canonical string */
async function keyTag(secret: string, label: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", await sessionKey(secret), enc.encode(label))));
}

export interface OwnerSession {
  /** issued at, ms */
  iat: number;
  /** expires at, ms */
  exp: number;
  /** the server's session epoch when it was issued (32 hex) */
  epoch: string;
  /** "p" (the passphrase) or the slot id (16 hex) of the passkey that signed in */
  via: string;
  nonce: string;
}

const EPOCH_RE = /^[0-9a-f]{32}$/;
const SLOT_RE = /^[0-9a-f]{16}$/;
const VIA_RE = /^(?:p|[0-9a-f]{16})$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const MS_RE = /^[1-9][0-9]{0,15}$/; // canonical: no leading zero, so one session has exactly one spelling
const canonical = (s: OwnerSession) => `layers-owner-session/v2|${s.iat}|${s.exp}|${s.epoch}|${s.via}|${s.nonce}`;

export function isOwnerEpoch(v: unknown): v is string {
  return typeof v === "string" && EPOCH_RE.test(v);
}
export function isPasskeySlot(v: unknown): v is string {
  return typeof v === "string" && SLOT_RE.test(v);
}

/** the cookie VALUE for a session: v2.<iat>.<exp>.<epoch>.<via>.<nonce>.<mac> */
async function sealOwnerSession(secret: string, s: OwnerSession): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await sessionKey(secret), enc.encode(canonical(s))));
  return `v2.${s.iat}.${s.exp}.${s.epoch}.${s.via}.${s.nonce}.${hex(mac)}`;
}

/** a fresh session cookie VALUE for the epoch the volume holds NOW. It lasts OWNER_SESSION_DAYS, or `lifetimeMs` when
 *  that is shorter (review PK-4: a script's sign-in lasts a day at most) — never longer than the configured lifetime,
 *  never less than a minute. */
export async function mintOwnerCookie(
  secret: string,
  grant: { epoch: string; via: string; lifetimeMs?: number },
  env: Record<string, string | undefined> = process.env,
  now = Date.now()
): Promise<string> {
  if (!EPOCH_RE.test(grant.epoch) || !VIA_RE.test(grant.via)) throw new Error("owner-access: a session needs the server's epoch and a sign-in method");
  const full = ownerSessionMs(env);
  const life = typeof grant.lifetimeMs === "number" && Number.isFinite(grant.lifetimeMs) ? Math.max(60_000, Math.min(full, Math.floor(grant.lifetimeMs))) : full;
  return sealOwnerSession(secret, { iat: now, exp: now + life, epoch: grant.epoch, via: grant.via, nonce: hex(crypto.getRandomValues(new Uint8Array(16))) });
}

/** Review UX-4 ("This isn't my device"): the SAME session — its issue time, epoch, sign-in method and nonce — with an
 *  EARLIER expiry. Never a later one, and never a new issue time: the enrollment window (OWNER_ENROLL_FRESH_MS, from
 *  iat) must not restart, or any stale session could shorten itself into a fresh one and add a passkey. */
export async function shortenOwnerCookie(secret: string, s: OwnerSession, exp: number): Promise<string> {
  const e = Math.min(s.exp, Math.floor(exp));
  if (!Number.isSafeInteger(e) || e <= s.iat) throw new Error("owner-access: a shortened session must still end after it began");
  return sealOwnerSession(secret, { iat: s.iat, exp: e, epoch: s.epoch, via: s.via, nonce: s.nonce });
}

/** The STATELESS half: the session a cookie names when its MAC verifies under this passphrase and its times are
 *  sane — or null for anything malformed, stale, too long-lived for the configured lifetime, a v1 cookie, or foreign.
 *  NOT the whole answer: ownerSessionLive (epoch, passkey still registered) decides with the volume's state. */
export async function readOwnerCookie(
  value: string | null | undefined,
  secret: string,
  env: Record<string, string | undefined> = process.env,
  now = Date.now()
): Promise<OwnerSession | null> {
  if (!value || value.length > 256) return null;
  const parts = value.split(".");
  if (parts.length !== 7 || parts[0] !== "v2") return null;
  if (!MS_RE.test(parts[1]) || !MS_RE.test(parts[2])) return null;
  const iat = Number(parts[1]);
  const exp = Number(parts[2]);
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return null;
  const lifetime = ownerSessionMs(env);
  // expired; issued in the future; or longer-lived than this deployment now allows (lowering OWNER_SESSION_DAYS
  // shortens nothing in place — a session minted under the old, longer lifetime is refused, the owner signs in again)
  if (exp <= now || iat > now + SKEW_MS || exp <= iat || exp - iat > lifetime + SKEW_MS || exp - now > lifetime + SKEW_MS) return null;
  if (!EPOCH_RE.test(parts[3]) || !VIA_RE.test(parts[4]) || !NONCE_RE.test(parts[5])) return null;
  const mac = unhex(parts[6]);
  if (!mac || mac.byteLength !== 32) return null;
  const s: OwnerSession = { iat, exp, epoch: parts[3], via: parts[4], nonce: parts[5] };
  try {
    return (await crypto.subtle.verify("HMAC", await sessionKey(secret), mac, enc.encode(canonical(s)))) ? s : null;
  } catch {
    return null; // never fail open
  }
}

/** the volume's view the stateful half needs: the CURRENT epoch (null before the first sign-in ever wrote one) and
 *  the slot ids of the passkeys registered under the current passphrase */
export interface OwnerGateState {
  epoch: string | null;
  slots: readonly string[];
}

/** strict shape check for a state that crossed a process boundary (the middleware's fetch); null when malformed */
export function parseOwnerGateState(v: unknown): OwnerGateState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { epoch?: unknown; slots?: unknown };
  if (!(o.epoch === null || isOwnerEpoch(o.epoch))) return null;
  if (!Array.isArray(o.slots) || o.slots.length > 64 || !o.slots.every(isPasskeySlot)) return null;
  return { epoch: o.epoch as string | null, slots: [...(o.slots as string[])] };
}

/** THE STATEFUL HALF: issued in the current epoch, and — for a passkey session — by a passkey still registered */
export function ownerSessionLive(s: OwnerSession, state: OwnerGateState): boolean {
  if (!state.epoch || s.epoch !== state.epoch) return false;
  return s.via === VIA_PASSPHRASE || state.slots.includes(s.via);
}

/** where the Node side reads the gate's state from (lib/platform/owner-store.server.ts registers it). A function
 *  that throws means "could not read" — and every caller then refuses. */
export type OwnerStateSource = (secret: string) => Promise<OwnerGateState>;
const STATE_SOURCE = Symbol.for("layers.owner.gateStateSource");
export function registerOwnerStateSource(fn: OwnerStateSource): void {
  (globalThis as unknown as Record<symbol, unknown>)[STATE_SOURCE] = fn;
}
export function registeredOwnerStateSource(): OwnerStateSource | null {
  const f = (globalThis as unknown as Record<symbol, unknown>)[STATE_SOURCE];
  return typeof f === "function" ? (f as OwnerStateSource) : null;
}

/** the whole check, for Node callers: the session this cookie carries when it is live NOW, else null. No state source
 *  (nothing registered one in this process) or a source that fails is null — never fail open. */
export async function currentOwnerSession(
  value: string | null | undefined,
  secret: string,
  env: Record<string, string | undefined> = process.env,
  source: OwnerStateSource | null = registeredOwnerStateSource(),
  now = Date.now()
): Promise<OwnerSession | null> {
  const s = await readOwnerCookie(value, secret, env, now);
  if (!s || !source) return null;
  let state: OwnerGateState;
  try {
    state = await source(secret);
  } catch {
    return null;
  }
  return ownerSessionLive(s, state) ? s : null;
}

/**
 * PROD-LIVE (review: the matcher skipped /favicon.ico/…) — THE GATE'S SERVER-SIDE BACKSTOP, for the server components
 * that render the owner's identity: app/(main)/layout.tsx (the roster, the tier map, the chrome), app/device/page.tsx
 * (the device's boot environment, which names the private validator) and the owner pages. True when this process is
 * an owner service (a secret is set) and the request's cookie is not a LIVE session — the caller then redirects to
 * the login page. The same readOwnerCookie + ownerSessionLive the middleware runs, so the two can never disagree about
 * what a session is; here the state is read from the volume directly (the explicit `source`, else the one
 * lib/platform/owner-store.server.ts registered when it loaded — instrumentation.ts loads it at boot).
 *
 * `readCookie` is a thunk and is called ONLY when a secret is set: on the rig laptop and on the public preview
 * OWNER_ACCESS_SECRET is unset, this returns false without touching the request at all, and nothing changes.
 * A secret too short to be a passphrase has no session that verifies under it (the login route refuses to mint one),
 * so the backstop stays SHUT for it, exactly as the middleware does — never open.
 */
export async function ownerSessionRefused(
  readCookie: () => string | null | undefined,
  env: Record<string, string | undefined> = process.env,
  source?: OwnerStateSource
): Promise<boolean> {
  const secret = readOwnerSecret(env);
  if (!secret) return false;
  let value: string | null | undefined;
  try {
    value = readCookie();
  } catch {
    return true; // a cookie store that cannot be read is no session — never fail open
  }
  return (await currentOwnerSession(value, secret, env, source ?? registeredOwnerStateSource())) === null;
}

/** the header value the middleware presents to OWNER_STATE_API. Derived from the passphrase, so a stranger cannot
 *  make one; it only ever travels over the server's own loopback. */
export async function ownerInternalToken(secret: string): Promise<string> {
  return keyTag(secret, "layers-owner-internal/v1");
}
export async function ownerInternalTokenOk(presented: string | null | undefined, secret: string): Promise<boolean> {
  if (typeof presented !== "string" || !/^[0-9a-f]{64}$/.test(presented)) return false;
  const want = await ownerInternalToken(secret);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= want.charCodeAt(i) ^ presented.charCodeAt(i);
  return diff === 0;
}

/** Which passphrase a passkey was registered under (a 128-bit tag, never the passphrase). A passkey whose binding is
 *  not the CURRENT passphrase's is retired: it cannot sign in, its sessions are not live, and the next passphrase
 *  sign-in prunes it. So rotating OWNER_ACCESS_SECRET — the kill switch — also ends every one-tap way back in; the
 *  owner adds Face ID / fingerprint again after signing in with the new passphrase. */
export async function ownerPasskeyBinding(secret: string): Promise<string> {
  return (await keyTag(secret, "layers-owner-passkey-binding/v1")).slice(0, 32);
}

/** constant-time passphrase comparison: both sides are MACed under a fresh random key, then the equal-length digests
 *  are compared with an accumulate-XOR, so neither the content nor where a mismatch starts shapes the timing */
export async function passphraseMatches(submitted: string, secret: string): Promise<boolean> {
  const k = await hmacKey(crypto.getRandomValues(new Uint8Array(32)), ["sign"]);
  const [a, b] = await Promise.all([crypto.subtle.sign("HMAC", k, enc.encode(submitted)), crypto.subtle.sign("HMAC", k, enc.encode(secret))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i] ?? 0);
  return diff === 0;
}

/** the Set-Cookie header value for a session (or its removal); it lives exactly as long as the session inside it —
 *  OWNER_SESSION_DAYS by default, `maxAgeMs` for a shorter session (a script's), and with `maxAgeMs: null` no Max-Age
 *  at all: a browser-session cookie, for a device that is not the owner's (the server's own expiry still ends it) */
export function ownerCookieHeader(value: string | null, env: Record<string, string | undefined> = process.env, maxAgeMs?: number | null): string {
  const base = `${OWNER_COOKIE}=${value ?? ""}; Path=/; HttpOnly; Secure; SameSite=Strict`;
  if (!value) return `${base}; Max-Age=0`;
  if (maxAgeMs === null) return base;
  return `${base}; Max-Age=${Math.floor((maxAgeMs ?? ownerSessionMs(env)) / 1000)}`;
}

/** the Set-Cookie header value for the "this device has a passkey" hint. Lax, so a link from elsewhere still lands
 *  on the one-tap button; 400 days (the longest a browser keeps a cookie); it grants nothing. */
export function ownerHintCookieHeader(slot: string | null): string {
  const base = `${OWNER_HINT_COOKIE}=${slot ?? ""}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return slot ? `${base}; Max-Age=${400 * 24 * 60 * 60}` : `${base}; Max-Age=0`;
}

/** The origin the OWNER's browser is on. A self-hosted `next start` builds request URLs from its own listener
 *  (http://localhost:<port>), so a redirect built from req.url would send the owner's browser to localhost. APP_URL
 *  (the deployment's public origin, set on every hosted service) wins; otherwise the Host the request arrived with,
 *  over https unless it is loopback. */
export function publicOrigin(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  const app = (env.APP_URL ?? "").trim();
  if (app) {
    try {
      return new URL(app).origin;
    } catch {
      /* fall through to the request's own host */
    }
  }
  const host = (headers.get("x-forwarded-host") ?? "").split(",")[0].trim() || (headers.get("host") ?? "").trim() || "localhost";
  const loopback = /^(localhost|127\.[\d.]+|\[::1\])(:\d+)?$/i.test(host);
  const proto = (headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  return `${proto === "http" || proto === "https" ? proto : loopback ? "http" : "https"}://${host}`;
}

/** where to send the owner after logging in: a same-origin path only (never "//host", never a scheme), default /home */
export function safeNextPath(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\") || s.length > 512) return "/home";
  if (s.startsWith(OWNER_LOGIN_PATH) || s.startsWith(OWNER_LOGIN_API)) return "/home";
  return /^[\x21-\x7e]+$/.test(s) ? s : "/home";
}
