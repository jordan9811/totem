import "server-only";
// PERSONA LAUNCH P6 — THE PREVIEW: everything a launch will make public, shown BEFORE anything is signed or sent.
//
// DEVICE-LOCAL, AND IT WRITES AND FETCHES NOTHING. The anon posts that will be linked are this device's own sealed reveal
// records for the persona (lib/zk/anon/queue.ts attributionCastHashesFor — never sent anywhere) joined to the OWN-ROWS
// MIRROR of the complete public anon list that every device's launch tick keeps (lib/launch/tick.ts — the uniform read
// every device makes on every tick, launch or not). No request leaves at all: no registrar, no chain, no name server,
// not even the anon list — so previewing (and walking away) leaves no trace a launch was considered. The suite checks
// the validator's request log. (fix W2-LAUNCH-REVEAL-200: it used to read the newest-200 feed list, so an older post was
// missing and counted as "still on the way"; a mirror that has not finished its first complete read refuses instead of
// showing a partial list.)
//
// WHAT IT SAYS (plan §2.5, R7, R10): every anon post that will be linked, with its date and its tier; the posts still on
// the way (revealed too, once relayed) and the ones that were never posted (refused: they stay private); the new
// account's name, picture and bio; what launch NARROWS (the crowd — fix LP-4 —, the posting hours, the writing style, the
// windows used: A-LAUNCH-WINDOW-OCCUPANCY, A-LAUNCH-TIER-NARROWS); what STAYS HIDDEN; what the launch posts on Farcaster
// (fix UX-L8); the 2–48 hour timing; the price (not set up); and that the registrar is simulated.
//
// THE CROWD (fix LP-4). After launch everyone can join a persona's posts, so anyone who knows each post's tree and epoch
// (the operator knows every tree's members, and the public rows name each post's tree and its size) can intersect those
// crowds: two crowds of 60 can overlap in a handful. The preview reports the intersection, not the smallest crowd:
//   exact    the device-local running intersection (anonPostCrowdOf below — kept at prove time by lib/zk/gate.ts), when
//            it COVERS every relayed post of the persona; or a single (tree, epoch) whose size is public
//   unknown  otherwise: "at most N, possibly far fewer" (N = the smallest crowd)
// Below the floor, or unknown, the launch needs an explicit acknowledgement (lib/launch/confirm.ts checks it against the
// verdict this preview left IN MEMORY — nothing is written).
import { REACH_ISSUER_IDS, parseReachTree, pickerLabel } from "@/lib/reach/trees";
import { LAUNCH_HISTORY_SENTENCE, LAUNCH_PRICE_SENTENCE, LAUNCH_TIMING_SENTENCE, SIMULATED_NOTICE, noUndoSentence, type LaunchProfile } from "./request";

export interface LaunchPreviewPost {
  /** the internal cast hash (what the reveal names, and what the confirm's quote choices name) */
  castHash: string;
  /** the network hash the @anon cast went out under */
  networkHash: string;
  text: string;
  /** when it was relayed (hour-grained) */
  at: number;
  tree: string | null;
  treeSize: number | null;
  epoch: number | null;
  tierLabel: string;
}

export interface LaunchCrowd {
  /** the intersection's size (exact), or its upper bound (the smallest crowd) */
  size: number | null;
  exact: boolean;
  /** how many distinct (tree, epoch) crowds the posts were proved in */
  crowds: number;
  floor: number;
  /** the confirm must carry an explicit acknowledgement */
  needsAck: boolean;
  /** the sentence the owner acknowledges (null when none is needed) */
  ackSentence: string | null;
}

export interface LaunchPreview {
  ok: true;
  personaId: string;
  handle: string;
  posts: LaunchPreviewPost[];
  /** this persona's anon posts not relayed yet: the launch waits for them (D7: all at once) */
  waiting: number;
  /** this persona's anon posts that were refused (never posted): never revealed, they stay private */
  refused: number;
  crowd: LaunchCrowd;
  account: { fname: string } & LaunchProfile;
  narrows: string[];
  staysHidden: string[];
  /** what the launch posts on Farcaster (fix UX-L8) */
  history: string;
  timing: string;
  price: string;
  noUndo: string;
  simulated: true;
  notice: string;
}

/**
 * The reach label of a row (P5), or the plain tree's. fix UX-L7: built from the reach model's own words
 * (lib/reach/trees.ts parseReachTree + pickerLabel) — "10k+ followers tier (312 accounts when you posted)", "1k+
 * followers on X tier (…)" — never "10k+ accounts", which named the wrong thing (the bucket counts FOLLOWERS).
 */
export function tierLabel(tree: string | null | undefined, treeSize: number | null | undefined): string {
  const size = typeof treeSize === "number" && Number.isFinite(treeSize) && treeSize > 0 ? ` (${treeSize} accounts when you posted)` : "";
  if (!tree) return "basic check" + size;
  const reach = parseReachTree(tree);
  if (reach) return `${pickerLabel(reach.issuer, reach.bucket)} tier${size}`;
  const t = /^tier-(\d+)$/.exec(tree);
  if (t) return `basic check, tier ${t[1]}${size}`;
  return tree + size;
}

const STAYS_HIDDEN = [
  "Your root identity (who you are across Totem).",
  "Your other personas, and that they share a root with this one.",
  "Your main Farcaster account.",
  "Anonymous posts you made as your other personas.",
  "Your rings and who is in them.",
];

/** the hours of day (UTC) the posts went out, as "09:00, 14:00 UTC" */
function hoursOf(posts: LaunchPreviewPost[]): string {
  const hs = [...new Set(posts.map((p) => new Date(p.at).getUTCHours()))].sort((a, b) => a - b);
  return hs.map((h) => String(h).padStart(2, "0") + ":00").join(", ") + " UTC";
}

/**
 * THE CROWD (fix LP-4), PURE: the posts' distinct (tree, epoch) crowds; `localIntersection` is the device-local running
 * intersection's size (null when this device has none). Unknown (several crowds, no local count) or below the floor →
 * an acknowledgement is needed. Posts still on the way make the count unknown too (their crowds are not known yet).
 */
export function launchCrowd(posts: Array<{ tree: string | null; epoch: number | null; treeSize: number | null }>, localIntersection: number | null, floor: number, waiting: number): LaunchCrowd {
  const sets = new Map<string, number | null>();
  for (const p of posts) sets.set(`${p.tree ?? ""}@${p.epoch ?? "?"}`, typeof p.treeSize === "number" && p.treeSize > 0 ? p.treeSize : null);
  const sizes = [...sets.values()].filter((n): n is number => n !== null);
  const smallest = sizes.length ? Math.min(...sizes) : null;
  if (!posts.length) {
    const unknown = waiting > 0;
    return { size: null, exact: !unknown, crowds: 0, floor, needsAck: unknown, ackSentence: unknown ? `I understand the posts still on the way will be linked to this account too, and how much they narrow who I am isn't known yet.` : null };
  }
  let size: number | null;
  let exact: boolean;
  if (localIntersection !== null) {
    size = smallest === null ? localIntersection : Math.min(localIntersection, smallest);
    exact = true;
  } else if (sets.size === 1 && smallest !== null && !posts.some((p) => parseReachTree(p.tree))) {
    // PERSONA LAUNCH wave 3 (L3): a single REACH crowd is not exact without the device-local count — a post made at the
    // default (highest offered) tier comes from that tier's BAND (its members who hold no offered tier above it), which
    // can be far smaller than the tree; the device-local count (lib/zk/gate.ts) narrows to the band, the tree size cannot
    size = smallest;
    exact = true;
  } else {
    size = smallest;
    exact = false;
  }
  if (waiting > 0) exact = false;
  const below = size !== null && size < floor;
  const needsAck = !exact || below;
  const ackSentence = !needsAck
    ? null
    : below
      ? `I understand my posts narrow this account to ${exact ? "" : "at most "}${size} accounts — fewer than Totem's floor of ${floor} — and someone who compares those crowds may be able to tell which person I am.`
      : `I understand Totem can't count how far my posts narrow this account (${size === null ? "the crowds are unknown" : `at most ${size} accounts, possibly far fewer`}), and someone who compares those crowds may be able to tell which person I am.`;
  return { size, exact, crowds: sets.size, floor, needsAck, ackSentence };
}

/**
 * fix LP-4 — the DEVICE-LOCAL running intersection of the crowds a persona's anon posts were proved in, kept beside the
 * seed (lib/zk/localPins.ts, never sent) under this key. The proof layer keeps it as it proves (the reach track's half,
 * lib/zk/gate.ts: the members of every tree an anon post is proved into, for the persona its sealed record names, and a
 * refusal of a reach proof that would take it under the reach floor); the preview only reads it.
 * DELIBERATE DUPLICATE of the key the proof layer writes (scripts/unit-launch.mjs reads it through this function).
 */
export const ANON_CROWD_KEY_PREFIX = "anon-post|";
/** the cast hashes that running intersection covers (written beside it by lib/zk/gate.ts) */
export const ANON_CROWD_COVERED_PREFIX = "anon-post-covered|";
/** the size of this persona's running intersection, or null when this device keeps none for it OR it does not cover
 *  every one of `castHashes` (final verify, LP-4: a post proved on another device of this root, or before this device
 *  kept the count, narrowed the crowd too — the count is then an over-statement, so the crowd is unknown and the launch
 *  needs the acknowledgement) */
export async function anonPostCrowdOf(mode: "fixture" | "live", personaId: string, castHashes: string[]): Promise<number | null> {
  const { intersectionFor } = await import("@/lib/zk/localPins");
  const v = intersectionFor(mode, ANON_CROWD_KEY_PREFIX + personaId);
  if (v === null) return null;
  const covered = new Set(intersectionFor(mode, ANON_CROWD_COVERED_PREFIX + personaId) ?? []);
  if (castHashes.some((h) => !covered.has(h))) return null;
  return v.length;
}

/**
 * PERSONA LAUNCH wave 3 (UXH-4): how many of this device's X copies (sealed records, lib/zk/anon/queue.ts) were sent AS
 * this persona and copy one of `castHashes` (its anon posts), less the ones that never reached the outbox: a submission
 * that ended refused (the channel or the validator refused it) or expired here before it was sent. A copy still waiting
 * for its proof, queued, sent, in review or posted counts — each may reach X. Device-local; nothing is fetched.
 */
export async function xCopiesOf(mode: "fixture" | "live", personaId: string, castHashes: string[]): Promise<number> {
  const { xRecords, xSubmissionItems } = await import("@/lib/zk/anon/queue");
  const mine = new Set(castHashes);
  const subOf = new Map((await xSubmissionItems()).filter((q) => q.xHash).map((q) => [q.xHash as string, q]));
  const neverReached = (s: { status: string; outcome: string | null } | null | undefined) => !!s && (s.status === "refused" || (s.status === "sent" && (s.outcome === "refused" || s.outcome === "malformed")));
  let n = 0;
  for (const r of await xRecords(mode)) {
    if (r.personaId !== personaId || r.copyOf === null || !mine.has(r.copyOf)) continue;
    if (neverReached(subOf.get(r.xHash)) || neverReached(r.settled)) continue;
    n++;
  }
  return n;
}

/** the preview's crowd verdict per persona, IN MEMORY ONLY (the confirm checks the acknowledgement against it) */
const g = globalThis as unknown as { __layersLaunchPreviewVerdicts?: Map<string, { at: number; needsAck: boolean; mode: "fixture" | "live" }> };
const verdicts = () => (g.__layersLaunchPreviewVerdicts ??= new Map());
/** how long a preview's verdict stands for the confirm */
export const PREVIEW_VERDICT_TTL_MS = 30 * 60_000;
export function previewVerdictFor(personaId: string, mode: "fixture" | "live", now: number = Date.now()): { needsAck: boolean } | null {
  const v = verdicts().get(personaId);
  return v && v.mode === mode && now - v.at <= PREVIEW_VERDICT_TTL_MS ? { needsAck: v.needsAck } : null;
}
export function resetPreviewVerdicts(): void {
  g.__layersLaunchPreviewVerdicts = new Map();
}

/**
 * The preview for one of THIS device's personas. Refuses (no preview) for a persona that is not this device's own, is
 * not launchable, or already has an account, and — fail closed — while this device has not finished reading the whole
 * public anon list (a preview that could not list every post must not look complete).
 */
export async function launchPreview(personaId: string, mode: "fixture" | "live"): Promise<LaunchPreview | { ok: false; status: number; code: string; reason: string }> {
  const { isOwnPostingPersona, handleOfPersona } = await import("@/lib/identity/postMode");
  const { isKeystoreRootedPersona } = await import("@/lib/identity/keys");
  if (typeof personaId !== "string" || !isOwnPostingPersona(personaId)) return { ok: false, status: 403, code: "not_own", reason: "That isn't one of your personas." };
  const handle = handleOfPersona(personaId);
  if (!handle || !isKeystoreRootedPersona(personaId)) return { ok: false, status: 403, code: "not_launchable", reason: "Only a persona made on this device can be launched — a demo persona's keys are public, so anyone could take its account." };
  const { kindOf } = await import("@/lib/identity/personaKind");
  if (kindOf(personaId) !== "public") return { ok: false, status: 403, code: "private", reason: `@${handle} is a private persona: private personas never get a Farcaster account.` };
  const { personaFidRecord } = await import("@/lib/fc/personaFid");
  if (await personaFidRecord(personaId)) return { ok: false, status: 409, code: "has_account", reason: `@${handle} already has its own Farcaster account.` };
  const { anonMirror } = await import("./tick");
  const mirror = anonMirror(mode);
  if (!mirror || !mirror.complete) return { ok: false, status: 503, code: "not_read_yet", reason: "Totem hasn't finished reading the anonymous posts yet. Try again in a minute." };
  const { attributionCastHashesFor } = await import("@/lib/zk/anonAttribution");
  const mine = await attributionCastHashesFor(personaId);
  const posts: LaunchPreviewPost[] = mine
    .map((h) => mirror.rows.get(h))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ castHash: r.castHash, networkHash: r.hash, text: r.text, at: r.at, tree: r.tree, treeSize: r.treeSize, epoch: r.epoch, tierLabel: tierLabel(r.tree, r.treeSize) }))
    .sort((a, b) => a.at - b.at);
  const unrelayed = mine.filter((h) => !mirror.rows.has(h));
  const { anonPostOutcomes } = await import("@/lib/zk/anon/queue");
  const outcomes = await anonPostOutcomes(unrelayed);
  const refused = unrelayed.filter((h) => outcomes.get(h) === "refused").length;
  const waiting = unrelayed.length - refused;
  const { ZK_ANON_FLOOR } = await import("@/lib/zk/config");
  const crowd = launchCrowd(posts, await anonPostCrowdOf(mode, personaId, posts.map((x) => x.castHash)), ZK_ANON_FLOOR, waiting);
  const { proposedAccount } = await import("./request");
  const proposed = await proposedAccount(personaId);
  const narrows: string[] = [];
  if (posts.length) {
    // PERSONA LAUNCH wave 3 (UXH-14): ONE line PER ISSUER — a persona boosted by Farcaster followers and by X followers
    // discloses both tiers at launch, and the old single line named only the smaller of the two. Per issuer, the HIGHEST
    // bucket any post proved (the buckets nest: proving 10k+ says 1k+ too), its smallest crowd for the words.
    const byIssuer = new Map<string, LaunchPreviewPost>();
    for (const p of posts) {
      const r = parseReachTree(p.tree);
      if (!r) continue;
      const cur = byIssuer.get(r.issuer);
      const curRank = cur ? parseReachTree(cur.tree)?.rank ?? 0 : -1;
      if (!cur || r.rank > curRank || (r.rank === curRank && (p.treeSize ?? Infinity) < (cur.treeSize ?? Infinity))) byIssuer.set(r.issuer, p);
    }
    for (const [issuer, top] of [...byIssuer.entries()].sort((a, b) => REACH_ISSUER_IDS.indexOf(a[0]) - REACH_ISSUER_IDS.indexOf(b[0]))) {
      const source = issuer === "x.reach" ? "X" : "Farcaster";
      narrows.push(`Your boosted posts carried "${top.tierLabel}" (${source} followers). Launching tells everyone @${handle} is in that tier.`);
    }
    narrows.push(
      crowd.exact && crowd.size !== null
        ? `Your posts were made inside a crowd of ${crowd.size} accounts. Launching tells everyone @${handle} is one of them.`
        : `Your posts were made in ${crowd.crowds} different crowds (tiers or 6-hour windows). Someone who compares them can narrow @${handle} to the accounts in all of them: ${crowd.size === null ? "how many is not known" : `at most ${crowd.size}, possibly far fewer`}. Totem can't count that overlap on this device yet.`
    );
    if (crowd.size !== null && crowd.size < crowd.floor) narrows.push(`That is fewer than ${crowd.floor} accounts, Totem's smallest safe crowd. Someone who compares the crowds may be able to tell which person you are.`);
    narrows.push(`Your posting hours: ${hoursOf(posts)}. Everyone will see when @${handle} posts.`);
    narrows.push(`Your writing style: everything @${handle} wrote anonymously becomes its public words, and that helps match it to anonymous posts it makes later.`);
    const windows = new Set(posts.map((p) => Math.floor(p.at / (6 * 3_600_000)))).size;
    narrows.push(`The 6-hour windows you posted in (${windows}): in each of them, your other personas had fewer anonymous posts left. That hints where your other anonymous posts could be.`);
  }
  // fix UX-L4: "only creates its account" is said ONLY when nothing at all will be revealed — never while posts are on the way
  if (waiting > 0)
    narrows.push(`${waiting} anonymous post${waiting === 1 ? " is" : "s are"} still on the way to @anon. ${waiting === 1 ? "It" : "They"} will be revealed too, once relayed; ${waiting === 1 ? "its" : "their"} tier and hour aren't known yet.`);
  if (refused > 0) narrows.push(`${refused} anonymous post${refused === 1 ? " was" : "s were"} refused and never posted. ${refused === 1 ? "It stays" : "They stay"} private: nothing to reveal.`);
  // PERSONA LAUNCH wave 3 (UXH-4): THE @totem X COPIES. A copy sent with "Also post to @totem on X" has the same words
  // as the anon post it copies (the composer's toggle says so: A-X-COPY-LINKED-BY-WORDS), so once the launch reveals
  // that post anyone can match the copy to this persona by its words — the confirm screen must say it, as the toggle did.
  // Device-local: this device's sealed X records of THIS persona that copy one of its posts (lib/zk/anon/queue.ts), less
  // the ones that never reached the outbox (refused, or expired before they were sent). Nothing is fetched.
  const copies = await xCopiesOf(mode, personaId, mine);
  if (copies > 0)
    narrows.push(`${copies} ${copies === 1 ? "copy" : "copies"} you sent to @totem on X ${copies === 1 ? "has" : "have"} the same words as these posts: once launched, anyone can match ${copies === 1 ? "it" : "them"} to @${handle} (test data: nothing reached X).`);
  if (!posts.length && waiting === 0) narrows.push(`@${handle} has no anonymous posts to reveal: launching only creates its account.`);
  verdicts().set(personaId, { at: Date.now(), needsAck: crowd.needsAck, mode });
  return {
    ok: true,
    personaId,
    handle,
    posts,
    waiting,
    refused,
    crowd,
    account: { fname: proposed.fname, ...proposed.profile },
    narrows,
    staysHidden: STAYS_HIDDEN,
    history: LAUNCH_HISTORY_SENTENCE,
    timing: LAUNCH_TIMING_SENTENCE,
    price: LAUNCH_PRICE_SENTENCE,
    noUndo: noUndoSentence(handle),
    simulated: true,
    notice: SIMULATED_NOTICE,
  };
}
