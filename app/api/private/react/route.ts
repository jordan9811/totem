import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { visiblePrivatePost } from "@/lib/private/visibility";
import { togglePrivateBookmark, togglePrivateLike } from "@/lib/private/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { hash, action } = await req.json();
  const viewer = activeSeedPersonaId();
  // You cannot react to what you cannot see, and being told so would itself
  // confirm the post exists.
  if (!hash || !visiblePrivatePost(hash, viewer))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const post =
    action === "bookmark"
      ? await togglePrivateBookmark(hash, viewer)
      : await togglePrivateLike(hash, viewer);
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ post });
}
