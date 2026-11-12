import "server-only";
// Writes to the private-post store. Reads go through ./visibility.ts.
//
// Every mutator takes the acting viewer and authorizes before touching
// anything, so there is no "trusted internal" variant to call by mistake.
import { randomBytes } from "@/lib/platform/crypto";
import { state, persistNs } from "@/lib/adapters/mock/store";
import type { PrivatePost } from "@/lib/adapters/mock/privateStore";
import { canViewPrivate, visiblePrivatePost } from "./visibility";

/**
 * BROWSER KEYSTORE PASS Gate 1 stage 3 (found by scripts/device-smoke.mjs): a private post's id is RANDOM, never
 * derived from its author and text. The vault seals values, not addresses, and this id IS the address of a
 * per-record row on the validator — a content-derived one lets an operator who guesses the text confirm it by
 * recomputing the hash. Nothing recomputes this id; it is only ever stored and looked up.
 * A-CU-3-PER-RECORD-VAULT-ROWS-REVEAL-COUNTS: the row count of a per-record namespace is still visible; that is
 * the shape the crypto and zk passes reviewed, and what an opaque id is for.
 */
function hashFor(): string {
  // 128 bits (attack-custody-2 #24): the id is a row address; a collision is a silently overwritten post
  return "0xpriv" + randomBytes(16).toString("hex");
}

export async function createPrivatePost(input: {
  authorPersonaId: string;
  text: string;
  replyToHash?: string | null;
}): Promise<PrivatePost> {
  const createdAt = Date.now();
  const post: PrivatePost = {
    hash: hashFor(),
    authorPersonaId: input.authorPersonaId,
    text: input.text,
    createdAt,
    replyToHash: input.replyToHash ?? null,
    likes: [],
    bookmarkedBy: [],
  };
  state().privatePosts.set(post.hash, post);
  await persistNs("privatePosts");
  return post;
}

/**
 * DELETION IS REAL. Single store means removing the row removes the post —
 * from the author, from every granted viewer, from search, everywhere. This
 * is the one place the product can promise deletion and mean it, and the UI
 * says so explicitly rather than letting people assume it of public posts too.
 *
 * Replies cascade: a reply whose parent is gone would otherwise render as an
 * orphan quoting text that no longer exists.
 */
export async function deletePrivatePost(hash: string, actor: string | null): Promise<boolean> {
  const s = state();
  const post = s.privatePosts.get(hash);
  if (!post) return false;
  if (post.authorPersonaId !== actor) return false; // author only
  s.privatePosts.delete(hash);
  for (const [h, p] of [...s.privatePosts.entries()]) {
    if (p.replyToHash === hash) s.privatePosts.delete(h);
  }
  await persistNs("privatePosts");
  return true;
}

/** Like/unlike. Authorized: you cannot react to what you cannot see. */
export async function togglePrivateLike(hash: string, viewer: string | null): Promise<PrivatePost | null> {
  const post = visiblePrivatePost(hash, viewer);
  if (!post || !viewer) return null;
  post.likes = post.likes.includes(viewer)
    ? post.likes.filter((v) => v !== viewer)
    : [...post.likes, viewer];
  await persistNs("privatePosts");
  return post;
}

export async function togglePrivateBookmark(hash: string, viewer: string | null): Promise<PrivatePost | null> {
  const post = visiblePrivatePost(hash, viewer);
  if (!post || !viewer) return null;
  post.bookmarkedBy = post.bookmarkedBy.includes(viewer)
    ? post.bookmarkedBy.filter((v) => v !== viewer)
    : [...post.bookmarkedBy, viewer];
  await persistNs("privatePosts");
  return post;
}

/** Replies to one post, already authorized for this viewer. */
export function repliesTo(hash: string, viewer: string | null): PrivatePost[] {
  if (!viewer) return [];
  return [...state().privatePosts.values()]
    .filter((p) => p.replyToHash === hash && canViewPrivate(p.authorPersonaId, viewer))
    .sort((a, b) => a.createdAt - b.createdAt);
}
