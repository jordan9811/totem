import { NextRequest, NextResponse } from "next/server";
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — the owner's Security actions. GATED: middleware.ts lets no request without a
// live owner session reach this path, and the route checks the session again itself (statefully, from the volume) —
// it needs to know HOW the session signed in anyway.
//
//   GET                                                  → {ok:true} for a live session: the sign-in page's "already
//                                                          signed in?" check (review UX-13). A GET, so the gate's
//                                                          state cache is not marked dirty by it.
//   POST {action: "register-options"}                    → WebAuthn creation options (a PASSPHRASE session at most
//                                                          30 minutes old; at most 5 passkeys)
//   POST {action: "register", name, credential}          → the new passkey verified and stored; THIS device is then
//                                                          signed in WITH it (a session naming the new passkey, for the
//                                                          volume's epoch) and gets the device hint — so removing that
//                                                          passkey later also signs this device out (review UX-1)
//   POST {action: "rename", slot, name}                  → renames one passkey
//   POST {action: "remove", slot}                        → removes one passkey; every session it signed in ends with
//                                                          it (this one included, when it was the one)
//   POST {action: "lost", slot}                          → "Lost this device?": removes that passkey (if it is still
//                                                          there) AND draws a new session epoch, in ONE write — the
//                                                          lost device's passkey stops working and every session ends,
//                                                          its passphrase sessions included (review UX-1)
//   POST {action: "shared-device"}                       → "This isn't my device": THIS session ends within
//                                                          OWNER_SHARED_SESSION_MS (same issue time, so the enrollment
//                                                          window never restarts) and its cookie carries no Max-Age
//                                                          (review UX-4)
//   POST {action: "signout-everywhere"}                  → a new session epoch on the volume: every device, this one
//                                                          included, signs in again (passkeys stay: one tap)
//
// Browser-only: JSON, and an Origin header that is this service's own (SameSite=Strict already keeps the cookie off
// any cross-site request). Server-only (scripts/device-routes.mjs: the /api/owner-login prefix). No secret: 404.
import {
  OWNER_COOKIE,
  OWNER_HINT_COOKIE,
  OWNER_LOGIN_PATH,
  OWNER_SHARED_SESSION_MS,
  currentOwnerSession,
  isPasskeySlot,
  mintOwnerCookie,
  ownerCookieHeader,
  ownerHintCookieHeader,
  ownerPasskeyBinding,
  publicOrigin,
  readOwnerSecret,
  shortenOwnerCookie,
} from "@/lib/platform/owner-access";
import {
  OwnerStateError,
  cleanPasskeyName,
  livePasskeys,
  ownerGateStateSource,
  rotateOwnerEpoch,
  withOwnerState,
} from "@/lib/platform/owner-store.server";
import {
  enrollmentProblem,
  loggableReason,
  ownerRegistrationOptions,
  ownerRelyingParty,
  verifyOwnerPasskeyRegistration,
} from "@/lib/platform/owner-passkeys.server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16384;

function json(body: unknown, status: number, cookies: string[] = []): NextResponse {
  const res = NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
  for (const c of cookies) res.headers.append("set-cookie", c);
  return res;
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false; // a browser always sends one on a POST; these actions are for a browser only
  return origin === publicOrigin(req.headers) || origin === publicOrigin(req.headers, {});
}

const UNAVAILABLE = { error: "the owner state on the volume could not be read or written; nothing changed — try again", code: "owner_state_unavailable" };
/** review UX-5: a passkey that is no longer there (removed from another device meanwhile) has its own code */
const GONE = { error: "no such passkey", code: "passkey_gone" };
const LOGIN_REQUIRED = { error: "owner login required", code: "owner_login_required", login: OWNER_LOGIN_PATH };

/** review UX-13: is this browser signed in? Answers only a live session (the gate already turned everyone else away). */
export async function GET(req: NextRequest) {
  const secret = readOwnerSecret();
  if (!secret) return json({ error: "owner access is not configured on this deployment" }, 404);
  const session = await currentOwnerSession(req.cookies.get(OWNER_COOKIE)?.value, secret, process.env, ownerGateStateSource);
  if (!session) return json(LOGIN_REQUIRED, 401);
  return json({ ok: true }, 200);
}

export async function POST(req: NextRequest) {
  const secret = readOwnerSecret();
  if (!secret) return json({ error: "owner access is not configured on this deployment" }, 404);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return json({ error: "JSON only" }, 415);
  if (!sameOrigin(req)) return json({ error: "cross-origin request refused" }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "request body too large" }, 413);
  let body: Record<string, unknown> | null = null;
  try {
    const text = await req.text();
    if (text.length <= MAX_BODY_BYTES) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return json({ error: "malformed request body" }, 400);

  const session = await currentOwnerSession(req.cookies.get(OWNER_COOKIE)?.value, secret, process.env, ownerGateStateSource);
  if (!session) return json(LOGIN_REQUIRED, 401);
  const hint = req.cookies.get(OWNER_HINT_COOKIE)?.value;

  switch (body.action) {
    case "register-options":
    case "register": {
      const problem = enrollmentProblem(session);
      if (problem) return json({ error: problem.error, code: problem.code }, problem.status);
      const rp = ownerRelyingParty();
      if (!rp) return json({ error: "Face ID / fingerprint sign-in isn't switched on for this service yet", code: "owner_passkeys_unavailable" }, 503);
      if (body.action === "register-options") {
        const r = await ownerRegistrationOptions(secret, rp, session);
        if (!r.ok) return json(registrationError(r.code), r.status);
        return json({ options: r.options }, 200);
      }
      const r = await verifyOwnerPasskeyRegistration(secret, rp, session, body);
      if (!r.ok) {
        console.warn("[owner-gate] passkey registration refused: " + loggableReason(r.reason));
        if (r.status === 503) return json(UNAVAILABLE, 503);
        if (r.status === 401) return json(LOGIN_REQUIRED, 401);
        return json(registrationError(r.code), r.status);
      }
      // review UX-1: this device is now signed in WITH its new passkey — a fresh session naming it, for the epoch the
      // passkey was stored in — so "Remove" on that passkey (from any device) signs this device out too. Registration
      // already required a fresh passphrase session, which is more than a passkey sign-in proves.
      const cookie = await mintOwnerCookie(secret, { epoch: r.epoch, via: r.passkey.slot });
      return json({ ok: true, passkey: r.passkey }, 200, [ownerCookieHeader(cookie), ownerHintCookieHeader(r.passkey.slot)]);
    }
    case "rename": {
      const slot = body.slot;
      const name = cleanPasskeyName(body.name);
      if (!isPasskeySlot(slot) || !name) return json({ error: "a passkey and a name are needed", code: "bad_name" }, 400);
      const binding = await ownerPasskeyBinding(secret);
      try {
        const found = withOwnerState((s) => {
          const p = livePasskeys(s, binding).find((x) => x.slot === slot);
          if (!p) return { write: false, result: false };
          p.name = name;
          return { write: true, result: true };
        });
        return found ? json({ ok: true, passkey: { slot, name } }, 200) : json(GONE, 404);
      } catch (e) {
        // the writer's guard refused a name the volume's reader would not accept: nothing changed (review PK-1)
        if (e instanceof OwnerStateError && e.kind === "rejected") return json({ error: "that name cannot be stored", code: "bad_name" }, 400);
        return json(UNAVAILABLE, 503);
      }
    }
    case "remove": {
      const slot = body.slot;
      if (!isPasskeySlot(slot)) return json({ error: "a passkey is needed" }, 400);
      const binding = await ownerPasskeyBinding(secret);
      try {
        const found = withOwnerState((s) => {
          const before = s.passkeys.length;
          s.passkeys = s.passkeys.filter((p) => !(p.slot === slot && p.binding === binding));
          return { write: s.passkeys.length !== before, result: s.passkeys.length !== before };
        });
        if (!found) return json(GONE, 404);
      } catch {
        return json(UNAVAILABLE, 503);
      }
      // the sessions it signed in are over (the gate checks the slot); when this is one of them, say so and clear it
      const cookies: string[] = [];
      const signedOut = session.via === slot;
      if (signedOut) cookies.push(ownerCookieHeader(null));
      if (hint === slot) cookies.push(ownerHintCookieHeader(null));
      return json({ ok: true, signedOut }, 200, cookies);
    }
    case "lost": {
      // review UX-1 — the one action that is right for a lost or stolen device: its passkey goes (whoever holds the
      // device cannot tap back in) AND a new epoch ends every session (the device's own, whichever way it signed in).
      // The epoch is drawn even when the passkey was already removed: "lost" always means "sign everything out".
      const slot = body.slot;
      if (!isPasskeySlot(slot)) return json({ error: "a passkey is needed" }, 400);
      const binding = await ownerPasskeyBinding(secret);
      let removed: boolean;
      try {
        removed = withOwnerState((s) => {
          const before = s.passkeys.length;
          s.passkeys = s.passkeys.filter((p) => !(p.slot === slot && p.binding === binding));
          rotateOwnerEpoch(s);
          return { write: true, result: s.passkeys.length !== before };
        });
      } catch (e) {
        console.error("[owner-gate] 'lost this device' could not write the new epoch (" + (e instanceof OwnerStateError ? e.kind : "error") + ")");
        return json(UNAVAILABLE, 503);
      }
      const cookies = [ownerCookieHeader(null)];
      if (hint === slot) cookies.push(ownerHintCookieHeader(null));
      return json({ ok: true, removed, signedOut: true }, 200, cookies);
    }
    case "shared-device": {
      // review UX-4 — "This isn't my device": the same session, ending within OWNER_SHARED_SESSION_MS, in a cookie the
      // browser keeps only until it closes. Its issue time is unchanged, so nothing here can reopen the enrollment window.
      const cookie = await shortenOwnerCookie(secret, session, Date.now() + OWNER_SHARED_SESSION_MS);
      const expiresAt = Math.min(session.exp, Date.now() + OWNER_SHARED_SESSION_MS);
      return json({ ok: true, expiresAt }, 200, [ownerCookieHeader(cookie, process.env, null)]);
    }
    case "signout-everywhere": {
      try {
        withOwnerState((s) => {
          rotateOwnerEpoch(s);
          return { write: true, result: null };
        });
      } catch (e) {
        console.error("[owner-gate] sign out everywhere could not write the new epoch (" + (e instanceof OwnerStateError ? e.kind : "error") + ")");
        return json(UNAVAILABLE, 503);
      }
      return json({ ok: true, signedOut: true }, 200, [ownerCookieHeader(null)]);
    }
    default:
      return json({ error: "unknown action" }, 400);
  }
}

function registrationError(code: string | undefined): { error: string; code: string } {
  if (code === "passkeys_full") return { error: "This service already has 5 Face ID / fingerprint sign-ins. Remove one first.", code };
  if (code === "passkey_exists") return { error: "That passkey is already registered.", code };
  if (code === "sign_in_again") return { error: "Sign in with your passphrase again, then add Face ID / fingerprint.", code };
  if (code === "try_again") return { error: "That took too long or was interrupted. Try again.", code };
  return { error: "That Face ID / fingerprint could not be added. Try again.", code: "owner_passkey_not_added" };
}
