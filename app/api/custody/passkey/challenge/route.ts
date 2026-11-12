import { NextRequest, NextResponse } from "next/server";
import { issueChallenge } from "@/lib/custody/webauthn";
import { releaseSecret, rpId } from "@/lib/custody/release";

export const dynamic = "force-dynamic";

// BROWSER KEYSTORE PASS Gate 2 — a challenge for a wrap-path assertion. SERVER-ONLY: the device never answers this
// route (scripts/device-routes.mjs), because the challenge is what the server recognises again at release. Stateless:
// an HMAC over the challenge and its expiry under the release secret.
export async function POST(req: NextRequest) {
  const secret = releaseSecret();
  if (!secret) return NextResponse.json({ error: "the passkey wrap path is not configured on this server (CUSTODY_RELEASE_SECRET)" }, { status: 503 });
  const c = issueChallenge(secret);
  void req;
  return NextResponse.json({ ...c, rpId: rpId() });
}
