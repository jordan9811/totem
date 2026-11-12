import { NextRequest, NextResponse } from "next/server";
// CALL OPTION A — X alt linking. Experimental, fixture-only (never hits
// real X — see lib/x/altlink.ts for why there is no real setTimeout here,
// and for why this is one persona's primary + a separately linked alt
// handle rather than two Totem personas).
import { activeSeedPersonaId } from "@/lib/activePersona";
import { personaByHandle } from "@/lib/adapters/mock/store";
import {
  ALT_LINK_DAILY_CAP,
  AltLinkRefusal,
  ackDisclaimer,
  altLinkStatusFor,
  attemptsToday,
  attemptStatus,
  dailyRemaining,
  hasAckedDisclaimer,
  linkAltHandle,
  runAltLink,
} from "@/lib/x/altlink";

export const dynamic = "force-dynamic";

export async function GET() {
  const personaId = activeSeedPersonaId();
  const status = altLinkStatusFor(personaId);
  return NextResponse.json({
    status,
    dailyCap: ALT_LINK_DAILY_CAP,
    dailyRemaining: status ? dailyRemaining(personaId) : 0,
    disclaimerAcked: hasAckedDisclaimer(personaId),
    recentAttempts: attemptsToday(personaId).map((a) => ({ ...a, status: attemptStatus(a) })),
  });
}

// accepts a handle OR a raw persona id — same resolution the existing
// identity/grant route uses, so "who are you disclosing to" never
// silently no-ops on a typed handle
const idOf = (v: string | undefined | null): string | null => {
  if (!v) return null;
  const byHandle = personaByHandle.get(v.replace(/^@/, ""));
  if (byHandle) return byHandle.id;
  if (v.startsWith("persona_") || v.startsWith("p_")) return v;
  return null;
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const personaId = activeSeedPersonaId();
  try {
    if (body.action === "ackDisclaimer") {
      await ackDisclaimer(personaId);
      return NextResponse.json({ acked: true });
    }
    if (body.action === "linkAlt") {
      const altHandles = await linkAltHandle(personaId, String(body.handle ?? ""));
      return NextResponse.json({ altHandles });
    }
    if (body.action === "run") {
      const audienceMember = idOf(body.audienceMember);
      if (!audienceMember) return NextResponse.json({ error: "unknown audience member" }, { status: 400 });
      const { attempt, grant } = await runAltLink({
        personaId,
        altHandle: String(body.altHandle ?? ""),
        targetPostId: String(body.targetPostId ?? ""),
        audienceMember,
      });
      return NextResponse.json({ attempt: { ...attempt, status: attemptStatus(attempt) }, grant });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof AltLinkRefusal) {
      const status = e.reason === "rate_limited" ? 429 : e.reason === "disclaimer_required" ? 412 : 403;
      return NextResponse.json({ error: e.message, reason: e.reason }, { status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
