import { NextRequest, NextResponse } from "next/server";
// X ACCOUNT LINKING — OAuth PKCE behind the adapter; the result is an
// ACCOUNT ATTESTATION on the ACTIVE persona. Fixture mode plays a recorded
// exchange and says so — the mode is in every response, never conflated.
//
// PERSONA LAUNCH P2 (BYX G0, the honesty gate): a fixture exchange proves nothing about who holds the X account, so
// it is attested as method "fixture" (proofRef "fixture:users/me:<id>") and every surface reads it as "test link, not
// verified" (lib/x/attestations.ts attestationLabel — the GET ships the label, so the panel never words it itself).
// The fixture link exists ONLY on the rig: `fixtureAvailable` is true for a rig server process and false everywhere
// else (a public deployment's server, the browser device, whose window is defined, the owner service — rig-shaped but
// holding the owner's real root — and the empty world), and a fixture link is refused off the rig — the handle box and the Link button render only when the GET says it is available.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { personaById } from "@/lib/adapters/mock/store";
import { retryAdapter } from "@/lib/adapters/retry";
import { xOAuth } from "@/lib/x/oauth";
import {
  attestationFor,
  attestationLabel,
  attestHandle,
  unlinkHandle,
  xRigFixturesAvailable,
} from "@/lib/x/attestations";

export const dynamic = "force-dynamic";

/** PERSONA LAUNCH P2 (BYX G0): the rig's fixture conveniences (the fixture link, the fixture archive) — a rig SERVER
 *  only, never the owner service or the empty world (review W1-R5; the one predicate, lib/x/attestations.ts) */
function fixtureAvailable(): boolean {
  return xRigFixturesAvailable();
}

export async function GET() {
  const personaId = activeSeedPersonaId();
  const attestation = attestationFor(personaId);
  return NextResponse.json({
    mode: xOAuth().mode,
    personaId,
    personaHandle: personaById.get(personaId)?.handle ?? personaId,
    attestation,
    label: attestation ? attestationLabel(attestation) : null,
    fixtureAvailable: fixtureAvailable(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const personaId = activeSeedPersonaId();
  const oauth = xOAuth();
  try {
    if (body.action === "begin") {
      const begun = await retryAdapter(() => oauth.beginAuth());
      return NextResponse.json({ mode: oauth.mode, ...begun });
    }
    if (body.action === "link") {
      // PERSONA LAUNCH P2 (BYX G0): the recorded exchange is the rig's — off the rig there is no link to make here
      // (live OAuth is not built; a Farcaster-verified X account is linked through /api/x/identity instead)
      if (oauth.mode === "fixture" && !fixtureAvailable())
        return NextResponse.json({ error: "Linking an X account by test link is not available on this site." }, { status: 404 });
      // fixture one-shot: begin + exchange + users/me + attest. Live mode
      // uses begin → user authorizes on x.com → callback carries the code.
      const begun = await retryAdapter(() => oauth.beginAuth());
      const token = await retryAdapter(() =>
        oauth.exchangeCode(String(body.code ?? "fixture-code-" + begun.state), begun.codeVerifier)
      );
      const me = await retryAdapter(() => oauth.fetchMe(token.access_token, body.fixtureHandle));
      const attestation = await attestHandle({
        personaId,
        handle: me.data.username,
        platformUserId: me.data.id,
        // PERSONA LAUNCH P2 (BYX G0): a recorded exchange is a TEST link — it must never read as a verification
        method: oauth.mode === "fixture" ? "fixture" : "oauth",
        // a REFERENCE to the proof, never the token itself — tokens do not
        // land in attestation payloads
        proofRef: `${oauth.mode}:users/me:${me.data.id}`,
      });
      return NextResponse.json({ mode: oauth.mode, attestation, label: attestationLabel(attestation) });
    }
    if (body.action === "unlink") {
      await unlinkHandle(String(body.handle ?? ""), personaId);
      return NextResponse.json({ mode: oauth.mode, unlinked: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    const msg = (e as Error).message ?? "error";
    const refusal = /private personas|already attested|only the attested|handle required|no attestation/.test(msg);
    return NextResponse.json({ error: msg }, { status: refusal ? (msg.includes("private") ? 403 : 409) : 503 });
  }
}
