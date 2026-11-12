// OWNER PASSKEYS (D-OWNER-PASSKEYS) — the owner gate's NAMES: cookies, pages, routes, limits. Plain constants and
// nothing else (no environment read, no crypto), so the sign-in page's browser code can import them without pulling
// lib/platform/owner-access.ts into a client bundle. owner-access.ts re-exports every one of them.

export const OWNER_COOKIE = "__Host-layers-owner";
/** "this device has a passkey for this service" — a hint for the sign-in page (which button leads) and the Security
 *  page ("this device"); it holds an opaque slot id and grants nothing */
export const OWNER_HINT_COOKIE = "__Host-layers-owner-pk";
export const OWNER_LOGIN_PATH = "/owner-login";
/** the post-sign-in offer: "Add Face ID / fingerprint for this device" (a gated page — it needs the new session) */
export const OWNER_ADD_PASSKEY_PATH = "/owner-login/add-passkey";
export const OWNER_SECURITY_PATH = "/settings/owner-security";
export const OWNER_LOGIN_API = "/api/owner-login";
/** EXEMPT from the gate (exact path), metered like the passphrase route: a sign-in challenge, nothing else */
export const OWNER_PASSKEY_OPTIONS_API = "/api/owner-login/passkey/options";
/** EXEMPT from the gate (exact path), metered: a signed assertion in, a session out */
export const OWNER_PASSKEY_VERIFY_API = "/api/owner-login/passkey/verify";
/** gated: add / rename / remove passkeys, "lost this device", "this isn't my device", sign out everywhere (POST); and
 *  GET → {ok:true} for a live session — the sign-in page's "already signed in?" check (review UX-13) */
export const OWNER_SECURITY_API = "/api/owner-login/security";
/** INTERNAL: the gate's state (epoch + live passkey slots) for the Edge middleware; answers only with the header below */
export const OWNER_STATE_API = "/api/owner-login/state";
export const OWNER_INTERNAL_HEADER = "x-layers-owner-internal";
/** the gate refuses to let a passphrase shorter than this open it (the boot check refuses to start with one) */
export const OWNER_SECRET_MIN = 16;
export const OWNER_SESSION_DAYS_DEFAULT = 30;
export const OWNER_SESSION_DAYS_MAX = 90;
/** review PK-4: a SCRIPT's sign-in (the JSON passphrase path — the arm, acquisition and check commands sign in fresh
 *  on every run and never sign out) lasts at most a day, never OWNER_SESSION_DAYS: a cookie left in a crash dump or a
 *  copied terminal must not be a month of owner access. Longer than any run (check-anon-live waits up to 90 minutes),
 *  and the PowerShell commands sign in again by themselves on a 401. */
export const OWNER_SCRIPT_SESSION_MS = 24 * 60 * 60 * 1000;
/** review UX-4: "This isn't my device" — the session on a borrowed or shared computer ends this soon (the server's own
 *  expiry), and its cookie carries no Max-Age, so most browsers also drop it when they close */
export const OWNER_SHARED_SESSION_MS = 2 * 60 * 60 * 1000;
/** a passkey's name: at most this many characters (code points). The volume's reader accepts exactly what the cleaner
 *  can produce — this many code points, so at most twice as many UTF-16 units (review PK-1) */
export const OWNER_PASSKEY_NAME_MAX = 40;
/** review PK-2: a credential id shorter than this many bytes is refused at registration (the spec's entropy guidance;
 *  every platform authenticator makes 16 or more), so the volume's reader can never meet one */
export const OWNER_PASSKEY_ID_MIN_BYTES = 16;
/** review UX-8: what /owner-login?error= says — a wrong passphrase, a service that could not finish, too many tries */
export const OWNER_LOGIN_ERRORS = { wrong: "1", unavailable: "unavailable", busy: "busy" } as const;
/** adding a passkey needs a PASSPHRASE session this fresh: a stolen or forgotten-open session cannot quietly mint
 *  itself a lasting way back in */
export const OWNER_ENROLL_FRESH_MS = 30 * 60 * 1000;
/** at most this many passkeys */
export const OWNER_PASSKEYS_MAX = 5;
/** a session's sign-in method when it came from the passphrase; a passkey session carries that passkey's slot id */
export const VIA_PASSPHRASE = "p";
