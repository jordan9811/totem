import { NextRequest, NextResponse } from "next/server";
import { acceptChallenge, verifyAssertion } from "@/lib/custody/webauthn";
import { allowedOrigins, releaseKeyFor, releaseSecret, rpId } from "@/lib/custody/release";
import { validatorUrl } from "@/lib/ports";

export const dynamic = "force-dynamic";

// BROWSER KEYSTORE PASS Gate 2 — release the wrap-path KEK for one credential after a verified assertion
// (D-CU-2-THE-WRAP-PATH-IS-STATELESS-ON-THE-SERVER, D-CU-2-NO-CBOR-NO-ATTESTATION). SERVER-ONLY.
//
// The public key the assertion is verified against comes from the validator's method record when one exists; on
// the credential's FIRST use (registration, before the device has written its record) the key the browser supplied
// at creation is accepted — trust on first use by the device creating the account. Every later release ignores the
// supplied key and uses the recorded one.
export async function POST(req: NextRequest) {
  const secret = releaseSecret();
  if (!secret) return NextResponse.json({ error: "the passkey wrap path is not configured on this server (CUSTODY_RELEASE_SECRET)" }, { status: 503 });
  const body = await req.json().catch(() => null);
  const { challenge, assertion, credentialId, spkiHex, alg } = (body ?? {}) as {
    challenge?: { challenge: string; exp: number; sig: string };
    assertion?: { authenticatorData: string; clientDataJSON: string; signature: string };
    credentialId?: string;
    spkiHex?: string;
    alg?: number;
  };
  if (!challenge || !assertion || typeof credentialId !== "string" || !/^[A-Za-z0-9_-]{16,}$/.test(credentialId))
    return NextResponse.json({ error: "challenge, assertion and credentialId required" }, { status: 400 });
  if (!acceptChallenge(secret, challenge)) return NextResponse.json({ error: "challenge refused (expired, spent or not ours)" }, { status: 403 });

  // The recorded public key wins. The supplied one is accepted ONLY on a confirmed 404 from the validator (the
  // credential's first use, before its record exists). Any other outcome — the validator unreachable, a 5xx, a
  // record without a key — fails CLOSED (attack-custody-1 #3, -2 #5, -3 #5): a caller-supplied key is never the
  // fallback for a lookup that did not answer.
  let key: { spkiHex: string; alg: number } | null = null;
  let confirmedAbsent = false;
  try {
    const r = await fetch(`${validatorUrl()}/custody/method/${encodeURIComponent("pk:" + credentialId)}`, { cache: "no-store" });
    if (r.status === 404) confirmedAbsent = true;
    else if (r.ok) {
      const m = (await r.json())?.method as { pubkey_spki?: string; alg?: number } | undefined;
      if (m?.pubkey_spki && typeof m.alg === "number") key = { spkiHex: m.pubkey_spki, alg: m.alg };
      else return NextResponse.json({ error: "the recorded method carries no verifiable key" }, { status: 409 });
    } else return NextResponse.json({ error: "cannot verify: the validator answered " + r.status }, { status: 503 });
  } catch {
    return NextResponse.json({ error: "cannot verify: the validator is unreachable — try again" }, { status: 503 });
  }
  if (!key) {
    if (!confirmedAbsent) return NextResponse.json({ error: "cannot verify" }, { status: 503 });
    if (typeof spkiHex !== "string" || !/^[0-9a-f]{40,400}$/.test(spkiHex) || (alg !== -8 && alg !== -7))
      return NextResponse.json({ error: "no recorded key for this credential and none supplied" }, { status: 404 });
    key = { spkiHex, alg };
  }
  const v = await verifyAssertion(
    { credentialId, ...assertion, spkiHex: key.spkiHex, alg: key.alg },
    { expectedChallenge: challenge.challenge, allowedOrigins: allowedOrigins(), rpId: rpId() }
  );
  if (!v.ok) {
    console.warn("[custody] release refused: " + v.reason);
    return NextResponse.json({ error: "assertion did not verify" }, { status: 403 });
  }
  return NextResponse.json({ kek: releaseKeyFor(secret, credentialId) });
}
