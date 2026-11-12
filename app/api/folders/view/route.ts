import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { folderDetailView, foldersView } from "@/lib/views/spaces";
import { VIEW_NOT_FOUND } from "@/lib/views/types";

export const dynamic = "force-dynamic";

// PROD-LIVE (D-CU-0-4): the /folders and /folders/[folderId] pages, as data. On a public deployment the server has
// no identity, so the page renders a shell and its island asks for this; the browser device answers it in-process
// against the visitor's own store. The rig computes the same view with the same builder on the server.
//
// FAIL CLOSED: a folder this persona may not see answers 404 exactly like one that does not exist; a failed read
// answers 503 (the island shows an error and a Retry) — never an empty folder presented as the truth.
export async function GET(req: NextRequest) {
  const personaId = activeSeedPersonaId();
  const folderId = req.nextUrl.searchParams.get("folderId");
  try {
    if (folderId) {
      const view = await folderDetailView(folderId, personaId);
      if (!view) return NextResponse.json({ error: VIEW_NOT_FOUND }, { status: 404 });
      return NextResponse.json(view);
    }
    return NextResponse.json(await foldersView(personaId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "folders unavailable" }, { status: 503 });
  }
}
