import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { visiblePrivatePost } from "@/lib/private/visibility";
import { deletePrivatePost, repliesTo } from "@/lib/private/store";

export const dynamic = "force-dynamic";

// 404, never 403. A 403 says "this exists and you may not have it", which is
// itself the disclosure. Not-found is the only honest answer to someone who
// was never told the post exists.
const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

export async function GET(_req: NextRequest, { params }: { params: { hash: string } }) {
  const viewer = activeSeedPersonaId();
  const post = visiblePrivatePost(params.hash, viewer);
  if (!post) return notFound();
  return NextResponse.json({ post, replies: repliesTo(params.hash, viewer) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { hash: string } }) {
  const viewer = activeSeedPersonaId();
  // Authorize visibility first so a non-viewer cannot distinguish "not yours"
  // from "does not exist".
  if (!visiblePrivatePost(params.hash, viewer)) return notFound();
  const done = await deletePrivatePost(params.hash, viewer);
  if (!done) return NextResponse.json({ error: "only the author can delete" }, { status: 403 });
  return NextResponse.json({ deleted: params.hash });
}
