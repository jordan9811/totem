// SIGN IN WITH X (2026-11-06) — THE PURE HALF: PKCE, the state, the authorize URL, the callback's checks and the shape of
// X's /2/users/me answer. No imports and no I/O: randomness and SHA-256 come from WebCrypto (globalThis.crypto), which the
// browser and Node 18+ both have. scripts/unit-x-signin.mjs calls every function here directly and mutates the guards.
//
// X's OAuth 2.0 Authorization Code flow with PKCE (docs.x.com, read 2026-11-06; docs/mechanism/sign-in-with-x.md has the
// sources): the tab sends the visitor to https://x.com/i/oauth2/authorize with response_type=code, client_id, redirect_uri
// (an EXACT match of a callback registered on the X app), scope, state and code_challenge (S256). X sends the visitor back
// to the redirect_uri with ?state=…&code=… (or ?error=access_denied&state=…). The code lives 30 seconds, and only the
// holder of the code_verifier can redeem it (POST https://api.x.com/2/oauth2/token). X's token endpoint and its API answer
// no browser CORS for a third-party origin (measured 2026-11-06: the preflight is a 404 with no Access-Control-* header),
// so the redemption goes through the validator's thin stateless relay (validator/xsignin.js), never the app server.
//
// WHAT THE TAB KEEPS, AND WHERE: the verifier and the state, in THIS TAB's sessionStorage only (they must survive the trip
// to x.com and back, which replaces the document), for ten minutes at most, and read ONCE: the callback removes them
// before it checks anything, so a reload of the callback, the Back button or a replayed link finds nothing and is refused.
// Never a server, never localStorage, never a cookie.

/** X's authorize page (twitter.com/i/oauth2/authorize answers a 301 to this one) */
export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
/** the least GET /2/users/me needs (docs.x.com/x-api/users/get-my-user: users.read and tweet.read). No offline.access:
 *  Totem keeps no token, so it asks for no refresh token. */
export const X_SIGNIN_SCOPES: readonly string[] = ["users.read", "tweet.read"];
/** the callback page on Totem's own origin (the owner registers `<origin>/welcome/x` on the X app, exactly) */
export const X_CALLBACK_PATH = "/welcome/x";
/** the tab's sessionStorage key for the request in flight */
export const PENDING_KEY = "totem:x-signin";
/** a request older than this is refused at the callback (X's own code lives 30 seconds; the visitor gets ten minutes on X) */
export const PENDING_TTL_MS = 10 * 60_000;
/** the account the persona minted by Sign in with X is keyed on (deterministic: a retried record never mints twice) */
export const X_PERSONA_NONCE = (xid: string) => "x-main/v1|" + xid;

/** the callback refusals this module decides (lib/x/signin/flow.ts words them) */
export type CallbackRefusal = "xsi_no_request" | "xsi_expired" | "xsi_state" | "xsi_denied" | "xsi_answer";

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `n` random bytes as base64url (getRandomValues) */
export function randomToken(n: number): string {
  return base64url(globalThis.crypto.getRandomValues(new Uint8Array(n)));
}

/** RFC 7636 §4.1: 43 to 128 characters of [A-Z a-z 0-9 - . _ ~] */
export function verifierOk(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(v);
}

/** a state this module made: base64url, 22 to 128 characters (X allows up to 500) */
export function stateOk(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{22,128}$/.test(s);
}

/** the code_challenge for a verifier: BASE64URL(SHA-256(ASCII(verifier))) (RFC 7636 §4.2, method S256) */
export async function s256(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** a fresh PKCE pair and state: a 32-byte verifier (43 characters), its S256 challenge, a 24-byte state (32 characters) */
export async function freshRequest(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = randomToken(32);
  return { verifier, challenge: await s256(verifier), state: randomToken(24) };
}

/** the callback URL for a page origin (https://ontotem.com → https://ontotem.com/welcome/x) */
export function redirectUriFor(origin: string): string {
  return String(origin).replace(/\/+$/, "") + X_CALLBACK_PATH;
}

/** the authorize URL the tab navigates to. S256 only (X also accepts "plain"; this never sends it). */
export function authorizeUrlFor(o: { base: string; clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    scope: X_SIGNIN_SCOPES.join(" "),
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
  });
  // URLSearchParams writes a space as "+", which X's authorize page reads as a space; %20 is the documented spelling
  return o.base + "?" + q.toString().replace(/\+/g, "%20");
}

/** the request in flight, as the tab stored it */
export interface Pending {
  v: 1;
  state: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  createdAt: number;
}

export function pendingText(p: Pending): string {
  return JSON.stringify(p);
}

/** a stored request read back: every field shaped, or null (a damaged entry is no request, never a partial one) */
export function readPending(raw: string | null | undefined): Pending | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  if (o.v !== 1 || !stateOk(o.state) || !verifierOk(o.verifier) || typeof o.redirectUri !== "string" || typeof o.clientId !== "string") return null;
  if (typeof o.createdAt !== "number" || !Number.isFinite(o.createdAt)) return null;
  return { v: 1, state: o.state, verifier: o.verifier, redirectUri: o.redirectUri, clientId: o.clientId, createdAt: o.createdAt };
}

/** equal strings, compared without an early exit (the state is a capability: no timing hint about how much matched) */
export function sameString(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** the callback's query, read: each value bounded, anything else ignored */
export function callbackParams(search: string): { state: string | null; code: string | null; error: string | null } {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  } catch {
    return { state: null, code: null, error: null };
  }
  const one = (k: string, max: number) => {
    const all = q.getAll(k);
    if (all.length !== 1) return null; // a repeated parameter is refused, never "the first one"
    const v = all[0];
    return v.length > 0 && v.length <= max ? v : null;
  };
  return { state: one("state", 512), code: one("code", 1024), error: one("error", 64) };
}

/**
 * THE CALLBACK'S VERDICT, in order: a request must be in flight in this tab (else xsi_no_request: a reload, Back, another
 * tab, a replayed link), not older than ten minutes (xsi_expired), for this page's own callback URL (xsi_no_request), and
 * the answer's state must equal the stored one (xsi_state: an answer this tab did not ask for — the CSRF case). Then X's
 * own refusal (xsi_denied) or a code that looks like a code (xsi_answer). The state is checked BEFORE the error, so an
 * answer this tab did not ask for is always reported as a mismatch, never as "you didn't allow it". (Any answer at all
 * ends the request — the caller removes it before judging — so a forged link can only make the visitor start again.)
 */
export function judgeCallback(
  pending: Pending | null,
  params: { state: string | null; code: string | null; error: string | null },
  now: number,
  redirectUri: string
): { ok: true; code: string; pending: Pending } | { ok: false; code: CallbackRefusal } {
  if (!pending) return { ok: false, code: "xsi_no_request" };
  if (!(now - pending.createdAt >= 0 && now - pending.createdAt <= PENDING_TTL_MS)) return { ok: false, code: "xsi_expired" };
  if (!sameString(pending.redirectUri, redirectUri)) return { ok: false, code: "xsi_no_request" };
  if (!params.state || !sameString(params.state, pending.state)) return { ok: false, code: "xsi_state" };
  if (params.error) return { ok: false, code: "xsi_denied" };
  if (!params.code || !/^[A-Za-z0-9._~-]{8,1024}$/.test(params.code)) return { ok: false, code: "xsi_answer" };
  return { ok: true, code: params.code, pending };
}

/** X's own image hosts: the only picture addresses kept (anything else is dropped, never fetched) */
export const X_IMAGE_HOSTS: readonly string[] = ["pbs.twimg.com", "abs.twimg.com"];

export interface XUser {
  id: string;
  username: string;
  name: string | null;
  pfpUrl: string | null;
  verified: boolean;
  verifiedType: string | null;
}

/**
 * /2/users/me's `data`, as the relay forwards it, shaped: the id (a decimal string), the username (1 to 15 letters, digits
 * or underscores), the name (at most 50 characters), the picture (https on X's own image host, the 400x400 size instead of
 * the 48x48 "_normal"), `verified` and `verified_type`. null when the id or the username is not one X would send.
 */
export function readXUser(j: unknown): XUser | null {
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || !/^[0-9]{1,20}$/.test(o.id)) return null;
  if (typeof o.username !== "string" || !/^[A-Za-z0-9_]{1,15}$/.test(o.username)) return null;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 50) : null;
  let pfpUrl: string | null = null;
  if (typeof o.profile_image_url === "string" && o.profile_image_url.length <= 512) {
    try {
      const u = new URL(o.profile_image_url);
      if (u.protocol === "https:" && !u.username && !u.password && X_IMAGE_HOSTS.includes(u.hostname.toLowerCase())) {
        const s = u.toString().replace(/_normal\.(jpg|jpeg|png|gif|webp)$/i, "_400x400.$1");
        pfpUrl = s.length <= 200 ? s : null;
      }
    } catch {
      pfpUrl = null;
    }
  }
  const vt = typeof o.verified_type === "string" && /^[a-z_]{1,16}$/.test(o.verified_type) ? o.verified_type : null;
  return { id: o.id, username: o.username, name, pfpUrl, verified: o.verified === true, verifiedType: vt };
}

/** a Totem handle from an X username: lower case letters, digits and underscores, at most 30 */
export function handleFromX(username: string): string {
  const h = String(username ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
  return h || "x_main";
}
