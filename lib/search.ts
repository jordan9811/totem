import "server-only";
// SEARCH — where disclosure models die.
//
// A feed leaks by showing you something. Search leaks by *answering* — a
// count, a ranking, a "no results for X", or a row whose display name happens
// to be the merged form "A / B". Every one of those is an oracle you can
// query about things you were never shown.
//
// Three rules this file follows:
//   1. Every person row is an identity render through PersonaResolver, never
//      raw seed data. The resolver already knows what this viewer may see.
//   2. A hidden sibling's handle is not a MATCHABLE field. Matching on it is
//      itself the disclosure, even if the row is filtered afterwards.
//   3. The response never distinguishes "nothing matched" from "something
//      matched but you may not have it". Both are the empty list.
import { personaById, SEED_POSTS, postByHash, state } from "@/lib/adapters/mock/store";
import { resolveIdentity } from "@/lib/identity/resolver";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import type { PrivatePost } from "@/lib/adapters/mock/privateStore";
import { AdapterError } from "@/lib/adapters/types";

export interface SearchPost {
  hash: string;
  text: string;
  authorHandle: string;
  authorName: string;
  avatarUrl: string | null;
  timestamp: number;
  private?: true;
  score: number;
}

export interface SearchPerson {
  personaId: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  merged: boolean;
  linked?: { handle: string; name: string };
  score: number;
}

export interface SearchChannel {
  id: string;
  name: string;
  description?: string;
  cluster?: string;
  score: number;
}

/** a part of the answer whose read failed (after retries) — see SearchResults.unavailable */
export type SearchSection = "channels" | "channelPosts" | "sharedPosts";

export interface SearchResults {
  query: string;
  posts: SearchPost[];
  people: SearchPerson[];
  channels: SearchChannel[];
  /**
   * PROD-LIVE (review fix): the parts of this answer that could NOT be read, so the page can say so instead of
   * drawing a partial answer as a whole one. Absent when every read succeeded (the ordinary payload is byte-for-byte
   * what it was). It reports a failed READ, never a withheld row: rule 3 still holds — "nothing matched" and "matched
   * but not yours" remain the same empty list.
   */
  unavailable?: SearchSection[];
}

const norm = (s: string) => s.toLowerCase().trim();

/** Relevance: exact handle beats prefix beats substring beats body match. */
function scoreText(haystack: string, q: string): number {
  const h = norm(haystack);
  if (!h) return 0;
  if (h === q) return 100;
  if (h.startsWith(q)) return 60;
  if (h.includes(q)) return 30;
  return 0;
}

export async function search(rawQuery: string, viewer: string | null): Promise<SearchResults> {
  const q = norm(rawQuery);
  const empty: SearchResults = { query: rawQuery, posts: [], people: [], channels: [] };
  if (!q) return empty;

  const unavailable: SearchSection[] = [];

  // Blocks apply to search exactly as they apply to the feed. A blocked
  // author you can still find by searching is not blocked.
  //
  // PROD-LIVE (review fix): a failed block read used to fall back to an EMPTY
  // blocked set — every author the viewer blocked came back in the results
  // (fail OPEN; the old comment's "must not hide everything" traded the
  // viewer's block for a result count). There is no partial answer that
  // honours a block list nobody could read, so the whole search fails: an
  // AdapterError that /api/search answers as a 503 and the page draws as
  // search-error with a Retry.
  let blocked: Set<string>;
  try {
    blocked = new Set(await retryAdapter(() => adapters.rep.blockedFor(viewer ?? "")));
  } catch (e) {
    throw new AdapterError(
      "couldn't read your block list, so search is off until it can be — results would include accounts you blocked" +
        (e instanceof Error && e.message ? " (" + e.message + ")" : ""),
      "FAILED"
    );
  }

  let visibleChannels = new Set<string>();
  try {
    visibleChannels = new Set(await retryAdapter(() => adapters.space.visibleChannelIds(viewer ?? "")));
  } catch {
    // FAIL CLOSED: unknown membership means member of nothing, so channel
    // posts stay out of the results — and (PROD-LIVE) the answer says so.
    visibleChannels = new Set();
    unavailable.push("channelPosts");
  }

  // ---- posts ----
  const posts: SearchPost[] = [];
  for (const p of SEED_POSTS) {
    if (blocked.has(p.authorPersonaId)) continue;
    if (p.channelId && !visibleChannels.has(p.channelId)) continue;
    const score = scoreText(p.text, q);
    if (!score) continue;
    const author = personaById.get(p.authorPersonaId);
    if (!author) continue;
    posts.push({
      hash: p.hash,
      text: p.text,
      authorHandle: author.handle,
      authorName: author.name,
      avatarUrl: author.avatarUrl,
      timestamp: Date.now() - p.minutesAgo * 60_000,
      score,
    });
  }

  // Private posts come ONLY from the authorized read. There is no branch
  // that reads the private store directly, so there is nothing to filter
  // wrongly — an unentitled viewer is handed an empty list upstream.
  let privatePosts: PrivatePost[] = [];
  try {
    privatePosts = viewer ? await retryAdapter(() => adapters.identity.visiblePrivatePosts(viewer)) : [];
  } catch {
    privatePosts = []; // fail closed
    // PROD-LIVE: …and not silently — the posts shared with you may be missing, and the answer says so
    unavailable.push("sharedPosts");
  }
  for (const p of privatePosts) {
    const score = scoreText(p.text, q);
    if (!score) continue;
    const author = personaById.get(p.authorPersonaId);
    if (!author) continue;
    posts.push({
      hash: p.hash,
      text: p.text,
      authorHandle: author.handle,
      authorName: author.name,
      avatarUrl: author.avatarUrl,
      timestamp: p.createdAt,
      private: true,
      score,
    });
  }

  // ---- people ----
  const people: SearchPerson[] = [];
  for (const persona of personaById.values()) {
    if (blocked.has(persona.id)) continue;

    // MATCH ONLY ON WHAT THIS VIEWER MAY ALREADY SEE. The bare handle, name
    // and bio are public facts about this persona. A sibling's handle is NOT
    // matched here even when the viewer could resolve it — a linkage is a
    // fact about a pair, and letting it pull a persona into results makes
    // search a way to test for linkages.
    const score = Math.max(
      scoreText(persona.handle, q),
      scoreText(persona.name, q),
      scoreText(persona.bio ?? "", q) ? 10 : 0
    );
    if (!score) continue;

    // Rule 1: the row is an identity render, so whatever the viewer is
    // entitled to see about this persona is decided in exactly one place.
    const identity = resolveIdentity(persona.id, viewer);
    people.push({
      personaId: persona.id,
      handle: identity.handle,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      merged: identity.merged,
      linked: identity.linked
        ? { handle: identity.linked.handle, name: identity.linked.name }
        : undefined,
      score,
    });
  }

  // ---- channels ----
  const channels: SearchChannel[] = [];
  try {
    const all = await retryAdapter(() => adapters.space.listChannels(viewer ?? ""));
    for (const c of all) {
      // Name and id are the strong signals; topic and description are how
      // people actually look for a channel ("crypto" finds Open Floor, whose
      // name contains neither word).
      const score = Math.max(
        scoreText(c.name, q),
        scoreText(c.id, q),
        scoreText(c.cluster ?? "", q) ? 40 : 0,
        scoreText(c.description ?? "", q) ? 20 : 0
      );
      if (score)
        channels.push({
          id: c.id,
          name: c.name,
          description: c.description,
          cluster: c.cluster,
          score,
        });
    }
  } catch {
    // channels are additive; failing to read them must not fail the search.
    // PROD-LIVE (review fix): but it must not be SILENT either — the channel
    // results used to just vanish, indistinguishable from "no channel
    // matched". The answer now carries the failure and the page says so.
    unavailable.push("channels");
  }

  const byScore = <T extends { score: number }>(a: T, b: T) => b.score - a.score;
  return {
    query: rawQuery,
    posts: posts.sort(byScore).slice(0, 20),
    people: people.sort(byScore).slice(0, 10),
    channels: channels.sort(byScore).slice(0, 10),
    // absent unless a read failed, so an ordinary answer's payload is unchanged
    ...(unavailable.length ? { unavailable } : {}),
  };
}
