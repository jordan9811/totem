import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { folderId, follow } = await req.json();
  if (!folderId) return NextResponse.json({ error: "folderId required" }, { status: 400 });
  const personaId = activeSeedPersonaId();
  try {
    // Following a folder you can't see would leak its existence.
    const canView = await retryAdapter(() => adapters.space.canViewFolder(folderId, personaId));
    if (!canView) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (follow === false) {
      await retryAdapter(() => adapters.space.unfollowFolder(personaId, folderId));
    } else {
      await retryAdapter(() => adapters.space.followFolder(personaId, folderId));
    }
    const followed = await retryAdapter(() => adapters.space.followedFolders(personaId));
    return NextResponse.json({ followed });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
