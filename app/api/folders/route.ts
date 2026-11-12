import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";
import { networkWriteRefusal } from "@/lib/fc/networkTarget";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const personaId = activeSeedPersonaId();
  const folderId = req.nextUrl.searchParams.get("folderId");
  try {
    if (folderId) {
      // FAIL CLOSED: never resolve a folder the viewer may not see. An
      // unreadable permission check must deny, not default to visible.
      const canView = await retryAdapter(() =>
        adapters.space.canViewFolder(folderId, personaId)
      );
      if (!canView) return NextResponse.json({ error: "not found" }, { status: 404 });
      const folder = await retryAdapter(() => adapters.space.getFolder(folderId));
      if (!folder) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ folder });
    }
    const [folders, followed] = await Promise.all([
      retryAdapter(() => adapters.space.listFolders(personaId)),
      retryAdapter(() => adapters.space.followedFolders(personaId)),
    ]);
    return NextResponse.json({ folders, followed });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  // FC-READ: a NETWORK cast (read through the public relay) added to a folder saved "successfully" and then vanished
  // — the folder view resolves only hashes the device holds (lib/views/spaces.ts). Refused per target, for an add and
  // for a folder created with posts; local and seed posts, and every rig, are unchanged (lib/fc/networkTarget.ts).
  {
    const targets: unknown[] =
      body?.action === "addPost" ? [body.postHash] : body?.action === "setPublic" ? [] : Array.isArray(body?.postHashes) ? body.postHashes : [];
    const refusal = await networkWriteRefusal(...targets.map((t) => (typeof t === "string" ? t : null)));
    if (refusal) return NextResponse.json(refusal, { status: 403 });
  }
  try {
    if (body.action === "addPost") {
      const folder = await retryAdapter(() =>
        adapters.space.addToFolder(body.folderId, body.postHash)
      );
      return NextResponse.json({ folder });
    }
    if (body.action === "setPublic") {
      const folder = await retryAdapter(() =>
        adapters.space.setFolderPublic(body.folderId, !!body.isPublic)
      );
      return NextResponse.json({ folder });
    }
    const folder = await retryAdapter(() =>
      adapters.space.createFolder({
        name: body.name,
        ownerPersonaId: activeSeedPersonaId(),
        isPublic: !!body.isPublic,
        postHashes: body.postHashes ?? [],
      })
    );
    return NextResponse.json({ folder });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
