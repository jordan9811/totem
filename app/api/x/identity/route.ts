import { NextRequest, NextResponse } from "next/server";
// PERSONA LAUNCH P2 (BYX G6) — the acting persona's X account as Farcaster verifies it (lib/x/identity.ts).
// GET reads (the index is downloaded whole, at most daily — the identity read is one of the two things that trigger
// it); POST {action:"attest"} links it on a click. A DEVICE route. On the public preview it is not offered at all
// ({offered:false}): a public persona has no Farcaster account to look up.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { attestationLabel } from "@/lib/x/attestations";
import { attestFromIndex, reconcileStaleness, xIdentityFor } from "@/lib/x/identity";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isPublicDeployment()) return NextResponse.json({ offered: false });
  const personaId = activeSeedPersonaId();
  try {
    const ident = await xIdentityFor(personaId);
    const a = await reconcileStaleness(personaId, ident);
    const linked = !!a && a.method === "farcaster-verified" && !!ident.x && a.handle === ident.x.handle.toLowerCase();
    return NextResponse.json({
      offered: true,
      fid: ident.fid,
      x: ident.x ? { handle: ident.x.handle, verifiedAt: ident.x.verifiedAt } : null,
      index: ident.index,
      linked,
      stale: !!a && a.method === "farcaster-verified" && !!a.staleSince,
      indexVersion: ident.index.available ? ident.index.builtAt : null,
    });
  } catch (e) {
    // an unreadable vault or a failed download: said, never "no X account"
    return NextResponse.json({ error: (e as Error).message || "the X identity could not be read" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (isPublicDeployment()) return NextResponse.json({ error: "not offered on this site" }, { status: 404 });
  let body: { action?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* refused below */
  }
  if (body.action !== "attest") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  try {
    const attestation = await attestFromIndex(activeSeedPersonaId());
    return NextResponse.json({ attestation, label: attestationLabel(attestation) });
  } catch (e) {
    const msg = (e as Error).message || "the X account could not be linked";
    const refusal = /private personas|already attested|no Farcaster account|shows no verified|isn't available/.test(msg);
    return NextResponse.json({ error: msg }, { status: refusal ? (msg.includes("private") ? 403 : 409) : 503 });
  }
}
