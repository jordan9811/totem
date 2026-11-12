// PERSONA LAUNCH P5 — THE FOR YOU BOOST and its label. PURE (no randomness, no clock, no fetch, browser-safe): the same
// rows and the same snapshot give the same order and the same labels in every build, on every device.
//
// THE LABEL — "posted by an account with 10k+ followers" — names the TIER, never the account. It is shown (and the
// boost applied) only when ALL of these hold, and otherwise the card is plain anon (fail toward less):
//   1. the row's tree is a reach tree this client knows (lib/reach/trees.ts);
//   2. its issuer is HONOURED BY KEY on this client (lib/attest/subscriber.ts, the registry key from the last tick) —
//      "fc.reach" on the open registry is first-come, so the id alone proves nothing;
//   3. the row's recorded tree size (tree_size: the frozen tree at the post's epoch) is at least the client's floor;
//   4. when this client holds a census of that tree FOR THAT EPOCH, the census size equals the recorded size (a row
//      whose size the validator rewrote after the fact disagrees with the client's own read and loses its label).
// Older epochs the client never read rest on the validator's recorded size — A-REACH-LABEL-TRUSTS-TREE-SIZE.
//
// THE BOOST is a recency head start on the DISCOVERY (For You) surface only: a labelled card sorts as if it were
// REACH_BOOST_MS[bucket] newer. It sits BELOW the demote, pin and quiet keys of the feed's final sort (a sunk or quieted
// card stays sunk; never-miss stays on top) and above nothing else. Ties break on the anon cast hash, so the order is a
// pure function of the rows. The Following surface is untouched.
import { parseReachTree, reachLabel, type ReachBucket } from "./trees";

export interface ReachLabel {
  issuer: string;
  bucket: string;
  /** "posted by an account with 10k+ followers" */
  label: string;
  /** the frozen tree's size at the post's epoch, as recorded */
  treeSize: number;
}

/** what the label reads off an anon row (lib/zk/validatorClient.ts AnonCast) */
export interface ReachRow {
  tree?: string | null;
  treeSize?: number | null;
  epoch?: number | null;
}

export interface ReachContext {
  /** is this issuer honoured BY KEY on this client right now (false when the registry key is unknown) */
  honoured: (issuer: string) => boolean;
  /** the client's floor (ZK_REACH_FLOOR) */
  floor: number;
  /** the last tick's census: its epoch and tree → size; null when no tick has run */
  census?: { epoch: number; sizes: Readonly<Record<string, number>> } | null;
}

export function reachLabelFor(row: ReachRow | null | undefined, ctx: ReachContext): ReachLabel | null {
  if (!row) return null;
  const t = parseReachTree(row.tree);
  if (!t) return null;
  if (!ctx.honoured(t.issuer)) return null;
  const size = row.treeSize;
  if (typeof size !== "number" || !Number.isInteger(size) || !Number.isFinite(ctx.floor) || size < ctx.floor) return null;
  const c = ctx.census;
  if (c && typeof row.epoch === "number" && row.epoch === c.epoch && Object.prototype.hasOwnProperty.call(c.sizes, t.tree) && c.sizes[t.tree] !== size) return null;
  return { issuer: t.issuer, bucket: t.bucket, label: reachLabel(t.issuer, t.bucket), treeSize: size };
}

/** the head start a labelled anon card gets on For You, by bucket */
export const REACH_BOOST_MS: Readonly<Record<ReachBucket, number>> = Object.freeze({
  "gte-1k": 1 * 3_600_000,
  "gte-10k": 2 * 3_600_000,
  "gte-100k": 4 * 3_600_000,
});

export function reachBoostMs(reach: { bucket: string } | null | undefined): number {
  if (!reach) return 0;
  return (REACH_BOOST_MS as Record<string, number>)[reach.bucket] ?? 0;
}

/** the slice of a feed card the final sort reads */
export interface SortableCard {
  cast?: { hash: string; castHash?: string; timestamp?: number; anon?: true; reach?: ReachLabel | null } | null;
}

/**
 * The feed's FINAL ordering (lib/feed.ts), as one comparator, keys in this order:
 *   1. sunk (a demoted author, or a post that lost standing) — last
 *   2. pinned (never-miss) — first
 *   3. quiet — last
 *   4. recency — newest first; on the discovery surface a labelled anon card's timestamp gets its REACH_BOOST_MS
 *   5. ties: two anon cards by their cast hash; any other tie keeps the order it came in (Array.prototype.sort is stable)
 * Keys 1–3 and the plain recency key are exactly the sort this replaced.
 * SPEC A (the real Following, lib/fc/hubRead/mode.ts): `rank` replaces key 4 with the mode's own score, highest first,
 * for a page whose posts are fixed by what was read (so the ranking can only order them); keys 1–3 are unchanged and a
 * tie still keeps the order it came in. Absent everywhere else: the sort is exactly as before.
 */
export function makeFinalComparator<T extends SortableCard>(o: { sunk: (c: T) => boolean; pinned: (c: T) => boolean; quiet: (c: T) => boolean; discovery: boolean; rank?: (c: T) => number }): (a: T, b: T) => number {
  const rank = o.rank;
  const effective = rank ?? ((c: T): number => (c.cast?.timestamp ?? 0) + (o.discovery ? reachBoostMs(c.cast?.reach ?? null) : 0));
  const tieKey = (c: T): string => (c.cast?.anon ? c.cast.castHash ?? c.cast.hash : "");
  return (a, b) => {
    const da = o.sunk(a) ? 1 : 0;
    const db = o.sunk(b) ? 1 : 0;
    if (da !== db) return da - db;
    const pa = o.pinned(a) ? 0 : 1;
    const pb = o.pinned(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const qa = o.quiet(a) ? 1 : 0;
    const qb = o.quiet(b) ? 1 : 0;
    if (qa !== qb) return qa - qb;
    const ea = effective(a);
    const eb = effective(b);
    if (ea !== eb) return eb - ea;
    const ka = tieKey(a);
    const kb = tieKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}
