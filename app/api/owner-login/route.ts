import { NextRequest, NextResponse } from "next/server";
// PROD-LIVE (D-PRODLIVE-OWNER-SERVICE) — THE OWNER LOGIN. Issues the session cookie middleware.ts's owner gate checks.
//
//   POST  form (from /owner-login) or JSON {passphrase, next?}  → constant-time check against OWNER_ACCESS_SECRET;
//         success sets the httpOnly / Secure / SameSite=Strict __Host- cookie (an HMAC under a key derived from the
//         passphrase — never the passphrase) and sends a form on (303) or answers JSON {ok:true};
//         failure waits a moment and answers 401 (JSON) or back to the login page with an error flag (form)
//   POST  {logout: 1} / DELETE  → clears the cookie
//
// OWNER PASSKEYS (D-OWNER-PASSKEYS): the session is minted for the server's CURRENT epoch, read from — and on the first
// sign-in ever, written to — the owner app's volume (lib/platform/owner-store.server.ts), so "sign out everywhere" can
// end it. It lasts OWNER_SESSION_DAYS (default 30, capped at 90). A FORM sign-in on a device that has no passkey yet
// goes on to /owner-login/add-passkey, the one-tap offer ("Add Face ID / fingerprint for this device"), which forwards
// to `next` by itself when the browser cannot make one; a device with a passkey goes straight to `next`.
//
// Review PK-4: only a BROWSER's sign-in (the form) lasts OWNER_SESSION_DAYS. A JSON sign-in is a script's (the arm,
// acquisition and check commands sign in fresh on every run and never sign out): its session lasts at most
// OWNER_SCRIPT_SESSION_MS (a day), in the cookie's own expiry and in its Max-Age, and expiresInSeconds says so.
// Review UX-8: a FORM that fails gets a page, never a JSON body — a volume that cannot record the sign-in (or a gate
// shut by a too-short passphrase) sends the browser back to /owner-login?error=unavailable (the middleware does the
// same with error=busy when the budget is spent). Review UX-10: a sign-in from a device whose hint cookie names a
// passkey that is no longer registered clears that hint (the caller has just proved the passphrase — nothing leaks),
// so the sign-in page stops leading with a button that will be refused.
//
// Attempts are metered in middleware.ts (per address and globally) BEFORE this handler runs, whatever the rig flag
// says. Nothing here reads an identity, a keystore, a vault or the validator, and nothing is logged — not the
// submitted value, not whether it matched. With no secret configured the route does not exist (404).
//
// This route is server-only: scripts/device-routes.mjs keeps every /api/owner-login route out of the browser device,
// and the device's fetch patch sends the prefix to the server (public/device/boot.js). The login page posts a FORM,
// which the fetch patch never sees anyway.
import {
  OWNER_ADD_PASSKEY_PATH,
  OWNER_HINT_COOKIE,
  OWNER_LOGIN_ERRORS,
  OWNER_LOGIN_PATH,
  OWNER_PASSKEYS_MAX,
  OWNER_SCRIPT_SESSION_MS,
  OWNER_SECRET_MIN,
  VIA_PASSPHRASE,
  isPasskeySlot,
  mintOwnerCookie,
  ownerCookieHeader,
  ownerHintCookieHeader,
  ownerPasskeyBinding,
  ownerSessionMs,
  passphraseMatches,
  publicOrigin,
  readOwnerSecret,
  safeNextPath,
} from "@/lib/platform/owner-access";
import { OwnerStateError, ensureOwnerStateForPassphrase, livePasskeys } from "@/lib/platform/owner-store.server";
import { ownerRelyingParty } from "@/lib/platform/owner-passkeys.server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8192;
const MAX_PASSPHRASE = 1024;
/** a failed attempt costs the caller this long, on top of the middleware's budget */
const FAIL_DELAY_MS = 400;

interface LoginBody {
  passphrase: string;
  next: string;
  logout: boolean;
  form: boolean;
}

async function readBody(req: NextRequest): Promise<LoginBody | null> {
  const ctype = (req.headers.get("content-type") ?? "").toLowerCase();
  const form = !ctype.includes("application/json");
  let text: string;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  if (text.length > MAX_BODY_BYTES) return null;
  let get: (k: string) => unknown;
  if (form) {
    const params = new URLSearchParams(text);
    get = (k) => params.get(k);
  } else {
    let j: unknown;
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      return null;
    }
    if (!j || typeof j !== "object") return null;
    const o = j as Record<string, unknown>;
    get = (k) => o[k];
  }
  const passphrase = get("passphrase");
  const logout = get("logout");
  return {
    passphrase: typeof passphrase === "string" ? passphrase : "",
    next: safeNextPath(get("next")),
    logout: logout === true || logout === "1" || logout === 1 || logout === "true",
    form,
  };
}

/** a browser's form post must come from this deployment's own origin (defence in depth: SameSite=Strict already
 *  keeps the cookie off cross-site requests; this keeps a cross-site page from even trying passphrases) */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // scripts (the acquisition command, PowerShell) send none
  const allowed = new Set([publicOrigin(req.headers), publicOrigin(req.headers, {})]);
  return allowed.has(origin);
}

/** Set-Cookie header values, in order */
type Cookies = string[];

function redirect(req: NextRequest, path: string, cookies: Cookies = []): NextResponse {
  const res = new NextResponse(null, { status: 303, headers: { location: new URL(path, publicOrigin(req.headers)).toString(), "cache-control": "no-store" } });
  for (const c of cookies) res.headers.append("set-cookie", c);
  return res;
}

function json(body: unknown, status: number, cookies: Cookies = []): NextResponse {
  const res = NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
  for (const c of cookies) res.headers.append("set-cookie", c);
  return res;
}

/** review UX-8: back to the sign-in page with what went wrong, for a browser form */
function backToLogin(req: NextRequest, error: string, next: string): NextResponse {
  return redirect(req, `${OWNER_LOGIN_PATH}?error=${encodeURIComponent(error)}&next=${encodeURIComponent(next)}`);
}

export async function POST(req: NextRequest) {
  const secret = readOwnerSecret();
  if (!secret) return json({ error: "owner access is not configured on this deployment" }, 404);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "request body too large" }, 413);
  if (!sameOrigin(req)) return json({ error: "cross-origin login refused" }, 403);
  const body = await readBody(req);
  if (!body) return json({ error: "malformed login body" }, 400);

  if (body.logout) return body.form ? redirect(req, OWNER_LOGIN_PATH, [ownerCookieHeader(null)]) : json({ ok: true }, 200, [ownerCookieHeader(null)]);

  // a passphrase too short to be one keeps the gate SHUT — fail closed (the boot check also refuses to start with it)
  if (secret.length < OWNER_SECRET_MIN) {
    if (body.form) return backToLogin(req, OWNER_LOGIN_ERRORS.unavailable, body.next);
    return json({ error: `the owner passphrase on this deployment is shorter than ${OWNER_SECRET_MIN} characters; the gate stays shut until it is replaced` }, 503);
  }

  const submitted = body.passphrase.slice(0, MAX_PASSPHRASE + 1).trim();
  const ok = submitted.length > 0 && submitted.length <= MAX_PASSPHRASE && (await passphraseMatches(submitted, secret));
  if (!ok) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    if (body.form) return backToLogin(req, OWNER_LOGIN_ERRORS.wrong, body.next);
    return json({ error: "passphrase not accepted", code: "owner_login_refused" }, 401);
  }

  // the session's epoch is the volume's; the first sign-in ever writes it (and an unreadable state is replaced — the
  // passphrase is the root of trust). A volume that cannot be written mints nothing: there is no epoch to end it by.
  let liveSlots: string[] = [];
  let epoch: string;
  try {
    const binding = await ownerPasskeyBinding(secret);
    const state = ensureOwnerStateForPassphrase(binding);
    epoch = state.epoch;
    liveSlots = livePasskeys(state, binding).map((p) => p.slot);
  } catch (e) {
    const why = e instanceof OwnerStateError ? e.kind : "error";
    console.error("[owner-gate] passphrase sign-in could not read or write the owner state on the volume (" + why + ")");
    if (body.form) return backToLogin(req, OWNER_LOGIN_ERRORS.unavailable, body.next);
    return json({ error: "the owner service could not record the sign-in on its volume; try again, and if it keeps failing the volume needs a look", code: "owner_state_unavailable" }, 503);
  }
  // review UX-10: this device's hint names a passkey that is gone (removed, or retired with an old passphrase)
  const hint = req.cookies.get(OWNER_HINT_COOKIE)?.value;
  const hinted = isPasskeySlot(hint) && liveSlots.includes(hint);
  const staleHint = isPasskeySlot(hint) && !hinted ? [ownerHintCookieHeader(null)] : [];
  if (body.form) {
    const cookie = await mintOwnerCookie(secret, { epoch, via: VIA_PASSPHRASE });
    // the one-tap offer, unless this device already has a live passkey (its hint cookie names one still registered),
    // the service is full, or this deployment has no relying party (APP_URL) for passkeys at all
    const offer = !hinted && liveSlots.length < OWNER_PASSKEYS_MAX && ownerRelyingParty() !== null;
    return redirect(req, offer ? `${OWNER_ADD_PASSKEY_PATH}?next=${encodeURIComponent(body.next)}` : body.next, [ownerCookieHeader(cookie), ...staleHint]);
  }
  // a script's sign-in (review PK-4): a day at most, never the browser's OWNER_SESSION_DAYS
  const lifetimeMs = Math.min(ownerSessionMs(), OWNER_SCRIPT_SESSION_MS);
  const cookie = await mintOwnerCookie(secret, { epoch, via: VIA_PASSPHRASE, lifetimeMs });
  return json({ ok: true, expiresInSeconds: Math.floor(lifetimeMs / 1000) }, 200, [ownerCookieHeader(cookie, process.env, lifetimeMs), ...staleHint]);
}

export async function DELETE() {
  return json({ ok: true }, 200, [ownerCookieHeader(null)]);
}
