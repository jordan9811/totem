import { NextRequest, NextResponse } from "next/server";
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — step 2 of the one-tap sign-in: a signed assertion in, a session out. EXEMPT from
// the owner gate (middleware.ts admits this EXACT path without a session) and metered there like the passphrase route.
//
// Everything is decided in lib/platform/owner-passkeys.server.ts: the challenge inside the signed clientDataJSON is
// spent first (single use, whatever follows), then the credential must be one registered under the current
// passphrase, the user handle the owner's, the origin and RP ID exactly APP_URL's, UP + UV set, backup eligibility
// unchanged and the counter increasing — the counter and backup state written back in one synchronous step. On
// success: the session cookie for the volume's current epoch, naming the passkey that signed in (so removing that
// passkey signs this session out), plus — when the passkey lives on THIS device — the "this device has a passkey"
// hint cookie. On failure: one generic answer after a short delay; the reason goes to the server log only (a fixed
// word, never a credential or a value).
//
// Review UX-2: the browser reports how the authenticator was reached (PublicKeyCredential.authenticatorAttachment).
// "cross-platform" is a phone over the QR code (hybrid) or a security key: the passkey is NOT on this device, so no
// hint is set — a laptop that signed in with the phone's passkey is not told it "has" one, keeps getting the offer to
// add its own (Windows Hello), and its Security page does not call the phone's passkey "this device". A hint that
// names a live passkey is kept; one that names a removed passkey is cleared (review UX-10 — the caller has just
// authenticated, so telling it which hint is stale reveals nothing). "platform" — this device's own or a synced
// passkey — sets the hint, and so does a browser that does not report the attachment (the old behaviour).
// Review UX-10: the answer also carries the passkeys still registered, for the WebAuthn Signal API, so a removed one
// leaves the device's passkey picker. Only after a successful sign-in; a refusal never says what the volume holds.
//
// Server-only (scripts/device-routes.mjs: the /api/owner-login prefix). No secret configured: 404.
import {
  OWNER_HINT_COOKIE,
  OWNER_SECRET_MIN,
  isPasskeySlot,
  mintOwnerCookie,
  ownerCookieHeader,
  ownerHintCookieHeader,
  ownerSessionMs,
  readOwnerSecret,
  safeNextPath,
} from "@/lib/platform/owner-access";
import { loggableReason, ownerRelyingParty, passkeyOriginOk, verifyOwnerPasskeySignIn } from "@/lib/platform/owner-passkeys.server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16384;
/** a refused assertion costs the caller this long, on top of the middleware's budget */
const FAIL_DELAY_MS = 400;

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const secret = readOwnerSecret();
  if (!secret) return json({ error: "owner access is not configured on this deployment" }, 404);
  if (secret.length < OWNER_SECRET_MIN) return json({ error: "the owner gate on this deployment is shut until its passphrase is replaced" }, 503);
  const rp = ownerRelyingParty();
  if (!rp) return json({ error: "Face ID / fingerprint sign-in isn't switched on for this service yet; use the passphrase", code: "owner_passkeys_unavailable" }, 503);
  if (!passkeyOriginOk(req.headers, rp)) return json({ error: "cross-origin request refused" }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "request body too large" }, 413);
  let body: { next?: unknown; authenticatorAttachment?: unknown } | null = null;
  try {
    const text = await req.text();
    if (text.length <= MAX_BODY_BYTES) body = JSON.parse(text) as { next?: unknown; authenticatorAttachment?: unknown };
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return json({ error: "malformed sign-in body" }, 400);

  const r = await verifyOwnerPasskeySignIn(secret, rp, body);
  if (!r.ok) {
    console.warn("[owner-gate] passkey sign-in refused: " + loggableReason(r.reason));
    await new Promise((res) => setTimeout(res, FAIL_DELAY_MS));
    if (r.status === 503) return json({ error: "the owner service could not check the sign-in right now; try again in a moment", code: "owner_state_unavailable" }, 503);
    return json({ error: "That Face ID / fingerprint sign-in was not accepted. Try again, or use your passphrase.", code: "owner_passkey_refused" }, r.status === 400 ? 400 : 401);
  }
  const cookie = await mintOwnerCookie(secret, { epoch: r.epoch, via: r.slot });
  const res = json({ ok: true, next: safeNextPath(body.next), expiresInSeconds: Math.floor(ownerSessionMs() / 1000), signal: r.signal }, 200);
  res.headers.append("set-cookie", ownerCookieHeader(cookie));
  const onThisDevice = body.authenticatorAttachment !== "cross-platform";
  const hint = req.cookies.get(OWNER_HINT_COOKIE)?.value;
  if (onThisDevice) res.headers.append("set-cookie", ownerHintCookieHeader(r.slot));
  else if (isPasskeySlot(hint) && !r.liveSlots.includes(hint)) res.headers.append("set-cookie", ownerHintCookieHeader(null));
  return res;
}
