import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { exportMode } from "@/lib/algo/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { modeId } = await req.json();
  if (!modeId) return NextResponse.json({ error: "modeId required" }, { status: 400 });
  try {
    const artifact = await exportMode(modeId, activeSeedPersonaId());
    return NextResponse.json({ artifact });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
