import "server-only";
// THE CHOKEPOINT. Nothing outside lib/private/ may read state().privatePosts;
// everything goes through here, and the gate script greps to prove it.
//
// Why a chokepoint rather than a convention: private posts are reachable from
// the feed, three parity routes, a permalink page, bookmarks and search. Six
// call sites each doing their own authorization is six chances to write the
// one `catch { return all }` that undoes the feature. There is one function
// that decides, and it fails closed.
//
// SINGLE STORE, READ-TIME AUTHORIZATION. Private posts are never copied into
// per-viewer feed stores. If they were, revoking an audience grant could not
// retract anything already fanned out — the spec's stated Gate 3 failure
// mode, and the reason the whole disclosure model would be a lie.
import { grantKind, isLive, OPEN_AUDIENCE, type Grant } from "@/lib/identity/grants";
import { verifiedGrants } from "@/lib/identity/verifiedGrants";
import { state } from "@/lib/adapters/mock/store";
import type { PrivatePost } from "@/lib/adapters/mock/privateStore";

/** Live audience grants for one private persona — verified only: an
 * unverifiable grant admits nobody. */
function audienceGrants(personaId: string, now = Date.now()): Grant[] {
  return verifiedGrants().filter(
    (g) =>
      grantKind(g) === "audience" &&
      g.fromPersona === personaId &&
      isLive(g, now) &&
      // An open-audience "private" post is a contradiction. Such a row should
      // never be written (issueAudienceGrant rejects it), but if one existed
      // it would silently publish every private post to everyone, so it is
      // refused on read as well.
      g.audienceMember !== OPEN_AUDIENCE
  );
}

/** Exactly who can see this persona's private posts. Author included. */
export function audienceOf(personaId: string, now = Date.now()): string[] {
  return [...new Set(audienceGrants(personaId, now).map((g) => g.audienceMember))];
}

/**
 * May `viewer` see `author`'s private posts?
 *
 * Fail-closed in every direction: no viewer, no grant, or a throw all mean
 * no. There is deliberately no "unless it's your own post" shortcut that
 * skips the grant lookup — the author holds a grant like everyone else, so
 * the ordinary path covers them and there is one rule instead of two.
 */
export function canViewPrivate(author: string, viewer: string | null, now = Date.now()): boolean {
  if (!viewer) return false;
  try {
    if (viewer === author) return true; // the author, by construction
    return audienceGrants(author, now).some((g) => g.audienceMember === viewer);
  } catch {
    return false;
  }
}

/**
 * Every private post this viewer is entitled to, newest first.
 *
 * The ONLY way private posts leave the store. Callers cannot filter more
 * loosely than this because they never see the unfiltered set.
 */
export function visiblePrivatePosts(viewer: string | null, now = Date.now()): PrivatePost[] {
  if (!viewer) return [];
  const out: PrivatePost[] = [];
  for (const post of state().privatePosts.values()) {
    if (canViewPrivate(post.authorPersonaId, viewer, now)) out.push(post);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** One post, or null if this viewer may not have it. */
export function visiblePrivatePost(hash: string, viewer: string | null, now = Date.now()): PrivatePost | null {
  const post = state().privatePosts.get(hash);
  if (!post) return null;
  return canViewPrivate(post.authorPersonaId, viewer, now) ? post : null;
}
