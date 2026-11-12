import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { exportMode, publishAlgoCard } from "@/lib/algo/service";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { AdapterError } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

/** Export a mode and publish it as a shareable algo card; optionally file it
 * into a folder (marketplace-lite). */
export async function POST(req: NextRequest) {
  const { modeId, folderId } = await req.json();
  if (!modeId) return NextResponse.json({ error: "modeId required" }, { status: 400 });
  try {
    const actor = activeSeedPersonaId();
    const artifact = await exportMode(modeId, actor);
    const card = await publishAlgoCard(artifact, actor);
    if (folderId) await retryAdapter(() => adapters.space.addToFolder(folderId, card.id));
    return NextResponse.json({ card });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
