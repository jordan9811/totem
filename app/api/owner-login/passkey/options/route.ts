import { NextRequest, NextResponse } from "next/server";
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — step 1 of the one-tap sign-in: a WebAuthn challenge. EXEMPT from the owner gate
// (middleware.ts admits this EXACT path without a session — it is how a signed-out owner signs in) and metered there
// like the passphrase route, per address and globally.
//
// What a stranger learns here: a random challenge, the RP ID (the owner app's own host, which they already typed) and
// the timeout. No allowCredentials (the owner's passkeys are discoverable, so the browser finds them itself), no
// credential id, no user handle, no count — the answer is the same with no passkey registered or five. The challenge
// is held server-side, single use, two minutes (lib/platform/owner-store.server.ts).
//
// Server-only (scripts/device-routes.mjs: the /api/owner-login prefix). No secret configured: 404.
import { OWNER_SECRET_MIN, readOwnerSecret } from "@/lib/platform/owner-access";
import { ownerRelyingParty, ownerSignInOptions, passkeyOriginOk } from "@/lib/platform/owner-passkeys.server";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const secret = readOwnerSecret();
  if (!secret) return json({ error: "owner access is not configured on this deployment" }, 404);
  if (secret.length < OWNER_SECRET_MIN) return json({ error: "the owner gate on this deployment is shut until its passphrase is replaced" }, 503);
  const rp = ownerRelyingParty();
  // the code is what the browser reads (lib/owner/passkeyClient.ts: "isn't switched on for this service yet"); the
  // operator's reason — APP_URL unset, or not an https address WebAuthn can use — stays in this comment, not the UI
  if (!rp) return json({ error: "Face ID / fingerprint sign-in isn't switched on for this service yet; use the passphrase", code: "owner_passkeys_unavailable" }, 503);
  if (!passkeyOriginOk(req.headers, rp)) return json({ error: "cross-origin request refused" }, 403);
  const options = ownerSignInOptions(rp);
  if (!options) return json({ error: "too many sign-ins are in progress; try again in a minute", code: "owner_passkey_busy" }, 503);
  return json(options, 200);
}
