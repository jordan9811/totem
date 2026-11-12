import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { issueStrike, setStrikeSetting, strikeSettingFor } from "@/lib/eventlog/strikes";
import { AdapterError } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ setting: strikeSettingFor(activeSeedPersonaId()) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const actor = activeSeedPersonaId();
  try {
    if (body.action === "setting") {
      await setStrikeSetting(actor, !!body.enabled);
      return NextResponse.json({ setting: strikeSettingFor(actor) });
    }
    if (!body.personaId || !body.triggeringCastId)
      return NextResponse.json(
        { error: "personaId and triggeringCastId required — a strike without a receipt is a mood, not a record" },
        { status: 400 }
      );
    const result = await issueStrike({
      actorPersonaId: actor,
      targetPersona: body.personaId,
      triggeringCastId: body.triggeringCastId,
      context: body.context ?? "cast_menu",
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
