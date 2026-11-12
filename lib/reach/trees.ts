// PERSONA LAUNCH P5 (D1, R6) — REACH TIERS: which trees an anonymous post may prove, which of them this person is
// OFFERED, and every sentence about them in plain words. PURE and browser-safe on purpose (no "server-only", no
// process.env, no node:* import, no fetch): the composer route, the gate, the For You label and P7's in-tab prover all
// run this file as-is. Every number that matters (the floor, the census, what is held) is a PARAMETER.
//
// THE MODEL. A reach tier is an issuer bucket tree "attest:<issuer>/<bucket>" — today fc.reach (Farcaster followers of
// the root's OWN main account, Neynar score >= 0.7 to enter) and x.reach (fixture only: the Farcaster-verified X handle
// of that account). Buckets NEST: a 100k account is issued gte-1k, gte-10k AND gte-100k, so it may prove any of them.
// An anonymous post proves ONE tree — the plain anon tree (no boost) or a reach tree — and the tree rides the post in
// the clear (A-REACH-TREE-ON-EVERY-POST). The tree is never in the scope (lib/zk/scopes.ts): the K slots are the
// person's whatever tree a post proves.
//
// THE CROWD FLOOR (R6). A reach tree is OFFERED only while the census of the last tick says at least `floor` accounts
// are in it — the client's own floor (ZK_REACH_FLOOR, never below ZK_ANON_FLOOR), compared with the served SIZE, never
// with the validator's clearsFloor boolean (the validator's opinion of its own floor is not the client's floor). A tier
// under the floor is never rendered, never proved into (the gate refuses before minting; prove.ts refuses at the cohort
// stage) and never accepted (validator/zk.js refuses on the frozen tree's size). The default is the HIGHEST offered
// bucket, so a 100k account boosts as 10k+ until the 100k+ tier has its 50.
//
// THE BAND RULE (PERSONA LAUNCH wave 3, L3). Because the default is the highest offered tier, a post at tier T comes — to
// anyone who knows the census — from T's BAND: T's members who hold no offered tier above it. With 52 of gte-1k's 55 also
// in gte-10k, a gte-1k post came from one of three accounts while both trees cleared the floor. So a tier is OFFERABLE
// (to anyone) only while it holds the floor AND leaves the floor in the band below it: walking each issuer's chain upward
// from the PLAIN anon tree (its size rides the same tick as the census: OfferInput.plainSize), T is offerable when
//   size(T) >= floor  and  size(last offerable below T) - size(T) >= floor
// and a tier that is not offerable is skipped (the next is compared with the last one that was). Every band — between two
// consecutive offerable tiers, and the top one — then holds the floor. No plain size on the tick = nothing offered. A
// DELIBERATE DUPLICATE of validator/zk.js reachBandRefusal (the frozen epoch's sizes); per issuer
// (A-REACH-BANDS-PER-ISSUER). lib/zk/gate.ts narrows a launched persona's device-local crowd to the band of each post
// made at its default tier, which the launch preview reads.

export type ReachBucket = "gte-1k" | "gte-10k" | "gte-100k";

/** the buckets, lowest first — the nesting order (gte-100k ⊂ gte-10k ⊂ gte-1k) */
export const REACH_BUCKETS: ReadonlyArray<ReachBucket> = Object.freeze(["gte-1k", "gte-10k", "gte-100k"]);

/** followers needed for each bucket */
export const REACH_THRESHOLDS: Readonly<Record<ReachBucket, number>> = Object.freeze({ "gte-1k": 1_000, "gte-10k": 10_000, "gte-100k": 100_000 });

/** the Neynar score an account needs to enter ANY reach tier (D1) */
export const REACH_MIN_SCORE = 0.7;

export interface ReachIssuerSpec {
  /** the issuer id on the validator's open registry */
  readonly id: string;
  /** where the followers are counted, for the words */
  readonly source: "Farcaster" | "X";
  readonly buckets: ReadonlyArray<ReachBucket>;
}

/** the reach issuers this client knows, in display order (Farcaster first) */
export const REACH_ISSUERS: ReadonlyArray<ReachIssuerSpec> = Object.freeze([
  Object.freeze({ id: "fc.reach", source: "Farcaster" as const, buckets: REACH_BUCKETS }),
  Object.freeze({ id: "x.reach", source: "X" as const, buckets: REACH_BUCKETS }),
]);
export const REACH_ISSUER_IDS: ReadonlyArray<string> = Object.freeze(REACH_ISSUERS.map((i) => i.id));

/** the nested buckets a follower count supports, lowest first; none for a missing or non-finite count */
export function reachBucketsFor(followers: number | null | undefined): ReachBucket[] {
  if (typeof followers !== "number" || !Number.isFinite(followers)) return [];
  return REACH_BUCKETS.filter((b) => followers >= REACH_THRESHOLDS[b]);
}

/** 1 (1k+) … 3 (100k+); 0 for anything else */
export function bucketRank(bucket: string): number {
  const i = (REACH_BUCKETS as ReadonlyArray<string>).indexOf(bucket);
  return i < 0 ? 0 : i + 1;
}

/** "1k+", "10k+", "100k+" */
export function shortBucket(bucket: string): string {
  return bucket === "gte-1k" ? "1k+" : bucket === "gte-10k" ? "10k+" : bucket === "gte-100k" ? "100k+" : bucket;
}

export function reachTreeOf(issuer: string, bucket: string): string {
  return `attest:${issuer}/${bucket}`;
}

export interface ReachTree {
  tree: string;
  issuer: string;
  bucket: ReachBucket;
  rank: number;
  source: "Farcaster" | "X";
}

/** a reach tree this client knows (a known issuer AND one of its buckets), else null — "attest:onchain.x/y" is not one */
export function parseReachTree(tree: unknown): ReachTree | null {
  if (typeof tree !== "string" || !tree.startsWith("attest:")) return null;
  const parts = tree.slice(7).split("/");
  if (parts.length !== 2) return null;
  const spec = REACH_ISSUERS.find((i) => i.id === parts[0]);
  if (!spec || !(spec.buckets as ReadonlyArray<string>).includes(parts[1])) return null;
  const bucket = parts[1] as ReachBucket;
  return { tree, issuer: spec.id, bucket, rank: bucketRank(bucket), source: spec.source };
}

/** may an anonymous post prove this tree at all? The plain anon tree, or a known reach tree */
export function isAllowedAnonTree(tree: unknown, plainTree: string): boolean {
  return tree === plainTree || parseReachTree(tree) !== null;
}

/** the picker's words: "10k+ followers" (" on X" for x.reach) */
export function pickerLabel(issuer: string, bucket: string): string {
  return `${shortBucket(bucket)} followers${issuer === "x.reach" ? " on X" : ""}`;
}

/** the For You label: "posted by an account with 10k+ followers" — the tier, never which account */
export function reachLabel(issuer: string, bucket: string): string {
  return `posted by an account with ${pickerLabel(issuer, bucket)}`;
}

/** one tree of the last tick's census (lib/zk/prefetch.ts snapshot.buckets): its SIZE, never its clearsFloor */
export interface CensusEntry {
  tree: string;
  size: number;
}

export interface OfferInput {
  /** the last tick's census; null when no tick has run yet (nothing is offered then) */
  census: ReadonlyArray<CensusEntry> | null;
  /** the reach trees this root holds an active issuance for (lib/reach/held.ts) */
  held: ReadonlyArray<string>;
  /** the client's floor (ZK_REACH_FLOOR) */
  floor: number;
  /** the plain anon tree (ZK_ANON_POST_TREE): the default when no reach tree is offered */
  plainTree: string;
  /** the issuers both honoured by THIS client (by key) and accepted by the validator for anon posts; null = all known */
  issuers?: ReadonlyArray<string> | null;
  /** PERSONA LAUNCH wave 3 (L3): the PLAIN anon tree's size on the same tick as the census — the band rule's bottom rung;
   *  null/undefined = not read, and nothing is offered */
  plainSize?: number | null;
}

export interface OfferedTree {
  tree: string;
  issuer: string;
  bucket: ReachBucket;
  /** the picker's words */
  label: string;
  size: number;
}

export interface Offer {
  /** highest tier first; never a tree under the floor */
  offered: OfferedTree[];
  /** the highest offered tree, else the plain anon tree */
  defaultTree: string;
  /** why a tier this person holds is not the default, in plain words; null when there is nothing to say */
  reason: string | null;
}

const byTier = (a: { rank: number; issuer: string }, b: { rank: number; issuer: string }) =>
  b.rank - a.rank || REACH_ISSUER_IDS.indexOf(a.issuer) - REACH_ISSUER_IDS.indexOf(b.issuer);

/** why a reach tree is not offerable to anyone right now: under the floor itself, or leaving too small a band below it */
export type NotOfferable = "floor" | "band";

/**
 * PERSONA LAUNCH wave 3 (L3) — THE POPULATION-LEVEL OFFER: for every known reach tree, offerable (null) or why not, by the
 * band rule (header) — whatever any one person holds. A tree missing from the census, an unusable size, a broken floor or
 * an unread plain size: not offerable ("floor"). PURE.
 */
export function offerableChain(input: Pick<OfferInput, "census" | "floor" | "plainSize">): Map<string, NotOfferable | null> {
  const floor = Number.isFinite(input.floor) && input.floor >= 1 ? input.floor : Number.POSITIVE_INFINITY;
  const out = new Map<string, NotOfferable | null>();
  const sizeOf = new Map((input.census ?? []).map((c) => [c.tree, Number.isInteger(c.size) && c.size >= 0 ? c.size : -1]));
  const plain = typeof input.plainSize === "number" && Number.isInteger(input.plainSize) && input.plainSize >= 0 ? input.plainSize : null;
  for (const spec of REACH_ISSUERS) {
    let below = plain;
    for (const b of spec.buckets) {
      const t = reachTreeOf(spec.id, b);
      const n = sizeOf.get(t);
      if (input.census === null || below === null || n === undefined || n < 0 || n < floor) {
        out.set(t, "floor");
        continue;
      }
      if (below - n < floor) {
        out.set(t, "band");
        continue;
      }
      out.set(t, null);
      below = n;
    }
  }
  return out;
}

/** the reach trees this person may boost an anonymous post with right now, the default, and why */
export function offeredAnonTrees(input: OfferInput): Offer {
  const allowed = input.issuers ? new Set(input.issuers) : null;
  const held = [...new Set(input.held)]
    .map(parseReachTree)
    .filter((t): t is ReachTree => t !== null && (!allowed || allowed.has(t.issuer)))
    .sort(byTier);
  // no census yet, or no plain size on that tick: the band rule cannot be judged — nothing is offered (fail toward less)
  if (input.census === null || typeof input.plainSize !== "number") {
    return { offered: [], defaultTree: input.plainTree, reason: held.length ? "Your reach tier is checked at the next sync — until then your posts are not boosted." : null };
  }
  const chain = offerableChain(input);
  const sizeOf = new Map(input.census.map((c) => [c.tree, Number.isInteger(c.size) && c.size >= 0 ? c.size : -1]));
  const offered: OfferedTree[] = [];
  const under: Array<{ t: ReachTree; why: NotOfferable }> = [];
  for (const t of held) {
    // (null = offerable: never coalesced — a tree the chain does not know is "floor")
    const why = chain.has(t.tree) ? (chain.get(t.tree) as NotOfferable | null) : "floor";
    if (why !== null) under.push({ t, why });
    else offered.push({ tree: t.tree, issuer: t.issuer, bucket: t.bucket, label: pickerLabel(t.issuer, t.bucket), size: sizeOf.get(t.tree) as number });
  }
  const top = offered[0] ?? null;
  const defaultTree = top ? top.tree : input.plainTree;
  // the sentence: the highest tier this person HOLDS that is not offered, when it is above what they get
  const missed = under.find((u) => !top || u.t.rank > bucketRank(top.bucket)) ?? null;
  const gets = top ? `boosted as ${shortBucket(top.bucket)}` : "not boosted";
  const reason = !missed
    ? null
    : missed.why === "floor"
      ? `Not enough accounts are in the ${shortBucket(missed.t.bucket)} tier yet, so your posts are ${gets}.`
      : `The ${shortBucket(missed.t.bucket)} tier isn't offered yet: too few accounts are in the tier below it alone, and a post there could be traced to them. Your posts are ${gets}.`;
  return { offered, defaultTree, reason };
}

export type ReachRefusalCode = "bad-tree" | "reach";

/** why an anonymous post may NOT prove `tree` right now (null: it may). Judged from the same inputs as the offer, so a
 *  tree the picker would not show is refused with the words the picker would have said. */
export function reachRefusal(tree: string, input: OfferInput): { code: ReachRefusalCode; reason: string } | null {
  if (tree === input.plainTree) return null;
  const t = parseReachTree(tree);
  if (!t) return { code: "bad-tree", reason: "That isn't a reach tier an anonymous post can be boosted with." };
  if (!input.held.includes(tree)) return { code: "reach", reason: `Your account isn't in the ${pickerLabel(t.issuer, t.bucket)} tier, so this post can't be boosted as ${shortBucket(t.bucket)}.` };
  // no sync has been read yet: the issuer list and the census both come from it, so say that rather than "not available"
  if (input.census === null) return { code: "reach", reason: "Your reach tier hasn't been checked yet — try again in a few minutes, or post without a boost." };
  if (input.issuers && !input.issuers.includes(t.issuer)) return { code: "reach", reason: `Boosting by ${t.source} followers isn't available here.` };
  const offer = offeredAnonTrees(input);
  if (!offer.offered.some((o) => o.tree === tree)) {
    if (typeof input.plainSize === "number" && offerableChain(input).get(tree) === "band")
      return { code: "reach", reason: `The ${shortBucket(t.bucket)} tier isn't offered yet: too few accounts are in the tier below it alone, so this post can't be boosted as ${shortBucket(t.bucket)}.` };
    return { code: "reach", reason: `Not enough accounts are in the ${shortBucket(t.bucket)} tier yet, so this post can't be boosted as ${shortBucket(t.bucket)}.` };
  }
  return null;
}
