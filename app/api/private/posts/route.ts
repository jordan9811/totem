import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { visiblePrivatePosts } from "@/lib/private/visibility";
import { createPrivatePost } from "@/lib/private/store";
import { isPrivatePersona } from "@/lib/identity/personaKind";
import { personaById } from "@/lib/adapters/mock/store";

export const dynamic = "force-dynamic";

/** Every private post this viewer is entitled to. Never more. */
export async function GET() {
  const viewer = activeSeedPersonaId();
  const posts = visiblePrivatePosts(viewer).map((p) => ({
    ...p,
    author: {
      personaId: p.authorPersonaId,
      handle: personaById.get(p.authorPersonaId)?.handle ?? null,
      name: personaById.get(p.authorPersonaId)?.name ?? null,
      avatarUrl: personaById.get(p.authorPersonaId)?.avatarUrl ?? null,
    },
  }));
  return NextResponse.json({ posts });
}

/**
 * Post as the active private persona.
 *
 * The AUTHOR is the active persona, taken from the server session — never
 * from the request body. A client that could name its own author could post
 * as anyone.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const viewer = activeSeedPersonaId();
  if (!body.text || typeof body.text !== "string")
    return NextResponse.json({ error: "text required" }, { status: 400 });

  // A reply is authored by whoever is acting, but only if they can see the
  // parent — otherwise replying is a way to write into a thread you were
  // never shown.
  if (body.replyToHash) {
    const { visiblePrivatePost } = await import("@/lib/private/visibility");
    if (!visiblePrivatePost(body.replyToHash, viewer))
      return NextResponse.json({ error: "not found" }, { status: 404 });
  } else if (!isPrivatePersona(viewer)) {
    return NextResponse.json(
      { error: "only a private persona can author a private post" },
      { status: 403 }
    );
  }

  const post = await createPrivatePost({
    authorPersonaId: viewer,
    text: body.text,
    replyToHash: body.replyToHash ?? null,
  });
  return NextResponse.json({ post });
}
