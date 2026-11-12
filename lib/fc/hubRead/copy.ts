// FOLLOWING FROM THE HUB — the words and the answer shapes, once. A pure module (no imports at runtime): the device's
// engine (lib/fc/hubRead/read.ts) answers in these shapes and sentences, the islands (components/hub/*) render them, and
// scripts/unit-hub-read.mjs pins them. Each sentence about who sees what is SECURITY-POSTURE.md §36's wording, never a
// stronger claim.
import type { Cast, User } from "@/lib/types";

export type HubReadCode =
  | "device_only"
  | "not_signed_in"
  | "disconnected_account"
  | "vault"
  | "bad_config"
  | "follows_unreadable"
  | "casts_unreadable"
  | "cast_unreadable"
  | "not_found"
  | "profile_unreadable"
  | "bad_request"
  | "own_persona"
  | "acting_persona"
  // NOTIFICATIONS FROM FARCASTER
  | "notifications_unreadable"
  | "seen_unsaved"
  // SPEC B: For You from the hub
  | "foryou_unreadable";

/** Fixed sentences. A real failure says "Couldn't read" (the page-health scans treat it as the failure it is); a true
 *  empty never does. No sentence ever carries a fid, a hash or the node's own text. */
export const HUB_READ_SENTENCES: Record<HubReadCode, string> = {
  device_only: "Reading your Farcaster follows runs in your browser; this server never asks the network for them.",
  not_signed_in: "Sign in with Farcaster to see the people you follow and their posts here.",
  disconnected_account: "Your Farcaster account is disconnected here. Sign in with it again to see who you follow.",
  vault: "Couldn't read your Farcaster sign-in from your vault just now. Try again.",
  bad_config: "Reading Farcaster isn't available on this deployment (misconfigured).",
  follows_unreadable: "Couldn't read who you follow from Farcaster's network just now. Nothing was read, so this is not an empty list. Try again.",
  casts_unreadable: "Couldn't read posts from the accounts you follow: Farcaster's network did not answer. Try again.",
  cast_unreadable: "Couldn't read this post from Farcaster's network just now. Try again.",
  not_found: "This post isn't on Farcaster's network. It may have been deleted.",
  profile_unreadable: "Couldn't read this account from Farcaster's network just now. Try again.",
  bad_request: "That request was not understood.",
  // PERSONA SEPARATION (2026-11-05 review): the browser that reads as you never asks the network about your personas,
  // and never reads at all while a persona is acting (SECURITY-POSTURE.md §36, A-HUBREAD-PERSONA-SEPARATION)
  own_persona:
    "This is one of your personas. This browser reads Farcaster's network as you, so it never asks about your personas: that would link them to you. Open it from your persona instead.",
  acting_persona:
    "You're acting as a persona, so your own Farcaster account's follows and posts stay hidden here. Nothing is read from Farcaster's network as you until you're yourself again.",
  notifications_unreadable:
    "Couldn't read your notifications from Farcaster's network just now. Nothing was read, so this is not an empty list. Try again.",
  seen_unsaved: "Couldn't save that you've seen these, so they may show as new again.",
  foryou_unreadable:
    "Couldn't read For You from Farcaster's network just now: none of its reads answered. Nothing was read, so this is not an empty feed. Try again.",
};

/** the one line above the timeline about where it comes from */
export const HUB_SOURCE_LINE = "From Farcaster's network, read by this browser. Totem's server isn't asked.";
/** what reading it shows to whom, in one sentence (SECURITY-POSTURE.md §36) */
export const HUB_WHO_SEES =
  "Farcaster's network sees this browser's internet address and which accounts and posts it reads, including yours. Totem's server doesn't.";

const n = (x: number) => x.toLocaleString("en-US");
const accounts = (x: number) => (x === 1 ? "1 account" : n(x) + " accounts");

export function followsCountSentence(count: number, truncated: boolean): string {
  if (count === 0) return "You don't follow anyone on Farcaster yet.";
  return `You follow ${truncated ? "more than " + accounts(count) : accounts(count)} on Farcaster.`;
}
export function progressSentence(read: number, total: number): string {
  return `Reading posts from ${n(read)} of ${accounts(total)}…`;
}
export function cappedSentence(reading: number, of: number, truncated: boolean): string {
  return `Showing posts from the ${n(reading)} accounts you followed most recently, of the ${truncated ? "more than " + n(of) : n(of)} you follow.`;
}
export function partialSentence(failed: number, total: number): string {
  return `Couldn't read posts from ${n(failed)} of ${accounts(total)} just now, so posts from them may be missing.`;
}
export function olderPartialSentence(failed: number): string {
  return `Couldn't read older posts from ${accounts(failed)} just now, so the timeline stops here for now.`;
}
export function profilesFailedSentence(failed: number): string {
  return `Couldn't read ${failed === 1 ? "1 profile" : n(failed) + " profiles"} just now: those accounts show their number instead of a name.`;
}
export function pausedSentence(seconds: number): string {
  return `Farcaster's network asked this browser to slow down. Reading again in ${Math.max(1, Math.ceil(seconds))} s.`;
}
export const FOLLOWS_STALE_SENTENCE = "Couldn't re-read who you follow just now; showing the list read earlier.";
export const NO_POSTS_SENTENCE = "No posts yet from the accounts you follow.";
export const REPLIES_FAILED_SENTENCE = "Couldn't read the replies from Farcaster's network just now.";
export const ANCESTORS_FAILED_SENTENCE = "Couldn't read the post this replies to from Farcaster's network just now.";
export const ANCESTOR_MISSING_SENTENCE = "The post this replies to isn't on Farcaster's network any more.";
export const ANCESTOR_OWN_SENTENCE = "This replies to a post by one of your personas, which this browser doesn't read as you.";
export const QUOTE_OWN_TITLE = "A quoted post by one of your personas (not read as you)";
export const PROFILE_CASTS_FAILED_SENTENCE = "Couldn't read this account's posts from Farcaster's network just now.";

// ------------------------------------------------------------------------------------------------ the answers
export interface HubAccountView {
  fid: number;
  fname: string | null;
}
export interface HubTimelineView {
  state: "not_signed_in" | "loading" | "ready" | "error";
  code: HubReadCode | null;
  reason: string | null;
  account: HubAccountView | null;
  follows: { state: "loading" | "ok" | "error"; count: number | null; truncated: boolean; stale: boolean };
  progress: { accounts: number; read: number; failed: number; pending: number };
  /** the fan-out cap: the timeline reads the `reading` most recently followed accounts of `of` */
  capped: { reading: number; of: number } | null;
  items: Cast[];
  /** older posts can be read ("Show older posts") */
  more: boolean;
  /** still filling: the island asks again */
  loading: boolean;
  /** Farcaster's node answered 429: nothing goes out until `until` (epoch ms) */
  paused: { until: number; sentence: string } | null;
  /** accounts whose posts could not be read (their posts may be missing), and the sentence */
  partial: { failed: number; sentence: string } | null;
  olderFailed: { failed: number; sentence: string } | null;
  profilesFailed: { failed: number; sentence: string } | null;
  /** TRUE empties only, each after a read that succeeded */
  followsNone: boolean;
  noPosts: boolean;
  /** how many casts were left out of the order for a timestamp too far in the future */
  futureDated: number;
  refreshedAt: number | null;
  /** node requests this tab has made for these reads (counts only) */
  requests: number;
  /** SPEC A: what the active mode did to this page (lib/fc/hubRead/mode.ts); null when no mode was applied (not signed in) */
  mode?: HubModeView | null;
  /** SPEC C: the page as cards, the extras on it (reading pieces, desk notes, sent posts) and what the one injection queue
   *  spliced in (lib/fc/hubRead/extras.ts). Absent when no extras were looked at (the node harness, an error, signed out):
   *  the island then renders `items` exactly as before */
  cards?: HubCardView[];
  extras?: HubExtrasView | null;
}

// ------------------------------------------------------------------------------------------------ the extras (spec C)
// READWISE, DESK NOTES AND SENT POSTS ON REAL POSTS (lib/fc/hubRead/extras.ts). Every extra is drawn from what this
// browser already read for the Following and from this device's own sealed or in-memory records: none of them makes a
// read of Farcaster's node, and nothing about them (dwell above all) leaves the device in the clear.
export interface HubPieceView {
  /** "<cast hash>#chunk1": a Farcaster post is ONE reading piece (the dwell record and the bin key it) */
  chunkId: string;
  /** its dwell already crossed the length-scaled threshold (lib/readwise/state.ts dwellThresholdMs) */
  read: boolean;
  /** it sits in a folder you marked priority */
  priority: boolean;
}
export interface HubNoteView {
  /** the desk's name */
  desk: string;
  claim: string;
  evidenceLink: string;
}
export interface HubCardView {
  /** "post": a post of the page as read (the mode's order); the other kinds were spliced in by the injection queue */
  kind: "post" | "readwise" | "correction" | "sent";
  placement: "page" | "queue";
  cast: Cast;
  /** a reading piece (a long post, or one with a link): its dwell chrome and the bin */
  piece: HubPieceView | null;
  /** a note from a desk you subscribe to, on this post */
  note: HubNoteView | null;
  /** who sent you this post (the name a ring's owner chose to be shown by) */
  sentBy: string | null;
}
export interface HubExtrasView {
  /** reading pieces on this page, and how many of them are read */
  pieces: number;
  piecesRead: number;
  /** unread pieces you were shown before, spliced back in (the readwise requeue, capped by the mode's cadence knob) */
  requeued: number;
  notes: { onPage: number; resurfaced: number };
  sent: { onPage: number; spliced: number; notHeld: number };
  /** what the injection queue left out, and why (never silent) */
  /** "slot": an ad slot took the position (ads, Phase 1: lib/injection.ts fixed slots) */
  dropped: { type: string; reason: "cap" | "duplicate" | "slot" }[];
  /** plain sentences about what could not be done (each with its kind for the page and the suites) */
  notices: { kind: "readwise_unavailable" | "folders_unreadable" | "notes_unreadable" | "desk_actions" | "sent_not_held"; sentence: string }[];
}
/** the shortest reading piece the piece-length slider allows (lib/readwise/state.ts LIMITS.chunkWords[0], repeated so
 *  this pure module needs no import; scripts/unit-hub-read.mjs pins them equal): a Farcaster post with at least this many
 *  words is a reading piece, which in practice means a long cast (a 320-byte cast holds about 55 words) */
export const HUB_PIECE_MIN_WORDS = 80;
/** the hosts Farcaster clients upload pictures to: a URL embed there (or one ending in a picture's extension) is a picture,
 *  every other URL embed is a link. ONE rule: lib/fc/hubRead/read.ts castOf draws the card with it, and a cast with a
 *  link (not a picture) is a reading piece by it */
export const HUB_IMAGE_HOSTS: readonly string[] = ["imagedelivery.net", "i.imgur.com", "res.cloudinary.com"];
export function hubEmbedIsImage(url: string, host: string): boolean {
  return HUB_IMAGE_HOSTS.some((h) => host === h || host.endsWith("." + h)) || /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(url);
}
/** words, counted the way lib/readwise/state.ts dwellThresholdMs counts them */
export function hubWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
/** SPEC C: is this Farcaster post a reading piece? A long cast (at least HUB_PIECE_MIN_WORDS words), or one carrying a
 *  link to read (an http(s) URL embed that is not a picture; a quoted cast is not one) */
export function isHubReadingPiece(r: { text: string; embeds: ReadonlyArray<{ url: string } | { castId: unknown }> }): boolean {
  if (hubWordCount(r.text) >= HUB_PIECE_MIN_WORDS) return true;
  for (const e of r.embeds) {
    if (!("url" in e) || typeof e.url !== "string" || !/^https?:\/\/[^\s]+$/i.test(e.url)) continue;
    let host = "";
    try {
      host = new URL(e.url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!hubEmbedIsImage(e.url, host)) return true;
  }
  return false;
}
export const hubPieceChunkId = (hash: string): string => hash + "#chunk1";
/** a desk annotation's target when it is a Farcaster post: "fc:<fid>:<hash>" (the canonical form a desk signs) */
export function hubCastTargetId(fid: number, hash: string): string {
  return `fc:${fid}:${hash.toLowerCase()}`;
}
export function parseHubCastTarget(id: unknown): { fid: number; hash: string } | null {
  if (typeof id !== "string") return null;
  const m = /^fc:([1-9][0-9]{0,11}):(0x[0-9a-f]{40})$/.exec(id);
  if (!m) return null;
  const fid = Number(m[1]);
  return Number.isSafeInteger(fid) ? { fid, hash: m[2] } : null;
}
/** what a ring sent this device changed (lib/rings/received.ts, after a read of the drop): the Following island re-asks the
 *  device, which reads nothing from the network for it */
export const HUB_SENDS_EVENT = "totem:ring-sends";
export const HUB_PIECE_LABEL = "Reading piece · from your Following";
export const HUB_REQUEUE_LABEL = "Back in your reading queue · you haven't finished this";
export const HUB_READWISE_UNAVAILABLE_SENTENCE =
  "Couldn't read your reading queue just now, so posts show without their reading marks and nothing you put in the bin comes back. Try again.";
export const HUB_FOLDERS_UNREADABLE_SENTENCE = "Couldn't read your folders just now, so priority folders aren't weighted.";
export const HUB_NOTES_UNREADABLE_SENTENCE = "Couldn't read the desks you subscribe to just now, so their notes aren't shown.";
export const HUB_DESK_ACTIONS_SENTENCE = "A desk's demote and auto-block don't act on Farcaster accounts yet: the desk's note shows on the post instead.";
export function hubSentNotHeldSentence(n0: number): string {
  return `${n0 === 1 ? "1 post sent to you isn't" : n(n0) + " posts sent to you aren't"} shown: this browser hasn't read ${n0 === 1 ? "it" : "them"} for your Following, and reading ${n0 === 1 ? "it" : "them"} just for this could tell Farcaster's network that ${n0 === 1 ? "it" : "they"} reached you.`;
}
export function hubSentByLine(name: string): string {
  return `Sent to you by ${name}`;
}
export function hubNoteLine(desk: string, resurfaced: boolean): string {
  return resurfaced ? `Noted by ${desk} after you liked or recast it` : `Annotation from ${desk}`;
}

// ------------------------------------------------------------------------------------------------ the mode (spec A)
/** a setting of the active mode that Farcaster posts cannot carry, said instead of being quietly read as 0 */
export interface HubModeGap {
  kind: "ranking" | "lens" | "rule" | "pack";
  /** the setting's own name: "engagement", "likes", the rule's or the pack's name */
  term: string;
  sentence: string;
}
export interface HubModeView {
  /** "error": the mode could not be read or applied, so the page shows nothing rather than posts it might hide */
  state: "ok" | "error";
  id: string | null;
  name: string | null;
  reason: string | null;
  /** the posts the mode looked at (this page's posts, newest first, as read) and how many it hid */
  of: number;
  hidden: number;
  hidAll: boolean;
  /** "Your mode hid all N posts." / "Your mode hid H of these N posts." (null when it hid none) */
  sentence: string | null;
  /** never-miss: one post per account, at the top; quiet: last */
  pinned: string[];
  quiet: string[];
  /** the mode's ranking put this page in an order other than newest first */
  ranked: boolean;
  /** the banner tier's strip, from this page's posts */
  strip: Array<{ hash: string; fid: number; handle: string; text: string; minutesAgo: number; href: string }>;
  gaps: HubModeGap[];
  tiers: { accounts: number; unreadable: string | null };
}
/** a Farcaster account as the delivery tiers key it: `<modeId>|fc:<fid>` (lib/delivery/tiers.ts keys `<modeId>|<account>`;
 *  a hub card's tier control writes it, the real Following reads it) */
export const HUB_ACCOUNT_PREFIX = "fc:";
export function hubAccountKey(fid: number): string {
  return HUB_ACCOUNT_PREFIX + fid;
}
export function fidOfHubAccountKey(key: string): number | null {
  if (!key.startsWith(HUB_ACCOUNT_PREFIX)) return null;
  const s = key.slice(HUB_ACCOUNT_PREFIX.length);
  if (!/^[1-9][0-9]{0,11}$/.test(s)) return null;
  const v = Number(s);
  return Number.isSafeInteger(v) ? v : null;
}
export const HUB_MODE_GAPS_HEAD = "Not available on Farcaster posts";
export const HUB_MODE_ERROR_SENTENCE = "Couldn't read your mode just now, so Following shows nothing rather than posts it might hide. Try again.";
export function hubModeRuleErrorSentence(modeName: string): string {
  return `Your mode ${modeName} uses a rule this browser can't read, so Following shows nothing rather than posts that rule might hide. Fix or remove it in Settings, then try again.`;
}
export const HUB_TIERS_UNREADABLE_SENTENCE = "Couldn't read your delivery settings just now, so every account shows as Normal for now.";
export function hubModeHidSentence(hidden: number, of: number): string | null {
  if (hidden <= 0 || of <= 0) return null;
  if (hidden >= of) return of === 1 ? "Your mode hid the 1 post." : `Your mode hid all ${n(of)} posts.`;
  return `Your mode hid ${n(hidden)} of these ${n(of)} posts.`;
}
export interface HubPersonRow {
  fid: number;
  followedAt: number;
  user: User;
  profile: "ok" | "failed";
}
export interface HubPeopleView {
  account: HubAccountView;
  count: number;
  truncated: boolean;
  offset: number;
  rows: HubPersonRow[];
  more: boolean;
  profilesFailed: { failed: number; sentence: string } | null;
  stale: boolean;
}
export interface HubCountView {
  account: HubAccountView;
  count: number;
  truncated: boolean;
}
export interface HubThreadView {
  cast: Cast;
  /** the posts it replies to, oldest first */
  ancestors: Cast[];
  replies: Cast[];
  moreReplies: boolean;
  ancestorsError: string | null;
  ancestorMissing: string | null;
  repliesError: string | null;
}
export interface HubProfileView {
  user: User;
  casts: Cast[];
  more: boolean;
  castsError: string | null;
}
/** POST AS YOU ON HUB CARDS: which casts the root has already liked and recast, from its newest reactions on the node.
 *  `horizon` (epoch ms) is the oldest reaction read when the root has MORE than were read: a cast older than it may have
 *  been reacted to before the window, so it is "unknown" (null), never "not liked". null horizon = every reaction read. */
export interface HubReactedView {
  account: HubAccountView;
  /** "loading": still being read (ask again); "failed": could not be read (every card is "unknown", never "not liked") */
  state: "ok" | "loading" | "failed";
  like: { hashes: string[]; horizon: number | null };
  recast: { hashes: string[]; horizon: number | null };
  sentence: string | null;
}
export const REACTED_FAILED_SENTENCE = "Couldn't read which posts you've already liked or recast from Farcaster's network just now.";
/** a cast's pressed state from the root's reactions: true, false, or null when it cannot be told */
export function reactedState(v: HubReactedView | null, kind: "like" | "recast", hash: string, castTs: number): boolean | null {
  if (!v || v.state !== "ok") return null;
  const r = v[kind];
  if (r.hashes.includes(hash)) return true;
  return r.horizon === null || castTs >= r.horizon ? false : null;
}

// ------------------------------------------------------------------------------------------------ notifications
// NOTIFICATIONS FROM FARCASTER (lib/fc/hubRead/notifications.ts): the root's new followers, mentions, and the replies,
// likes and recasts on its newest posts, read by this browser from the node, grouped the way X groups them. The words
// about the window are the window's real numbers (HUB_NOTIF_LIMITS), never a stronger claim.
export type HubNotifKind = "follow" | "like" | "recast" | "reply" | "mention";
export type HubNotifTab = "all" | "priority" | "mentions";
export interface HubNotificationItem {
  /** stable within a view: the kind, the post and the group's bucket */
  id: string;
  kind: HubNotifKind;
  /** the newest event in the group (epoch ms) */
  at: number;
  /** newer than the last time this root's notifications were seen (always true while that was never recorded) */
  unread: boolean;
  /** the accounts, newest first: the first few, with their profiles (a failed profile shows the account's number) */
  actors: User[];
  /** how many accounts in all ("and 12 others") */
  count: number;
  /** the node's page was full, so there may be more than `count` ("at least") */
  atLeast: boolean;
  /** a like or recast: the root's own post it was on */
  target: { fid: number; hash: string; text: string } | null;
  /** a reply or mention: the post itself, as a hub card (reply, like and recast work on it) */
  cast: Cast | null;
}
export interface HubNotificationsView {
  state: "not_signed_in" | "loading" | "ready" | "error";
  code: HubReadCode | null;
  reason: string | null;
  account: HubAccountView | null;
  tab: HubNotifTab;
  /** newest first, this tab's, at most HUB_NOTIF_LIMITS.maxItems */
  items: HubNotificationItem[];
  /** unread notifications in All; null when the record of what was seen could not be read (never a guessed 0) */
  unread: number | null;
  /** the last time they were seen (epoch ms), null when never */
  seenAt: number | null;
  /** the newest notification's time in All: what viewing the page marks as seen */
  newestAt: number | null;
  /** the record of what was seen could not be read: said, with Retry */
  seenError: string | null;
  /** what the window covers (the sentence above the list) */
  coverage: { followers: number; mentions: number; posts: number };
  /** reads that failed (their notifications may be missing), and the sentence */
  partial: { failed: number; sentence: string } | null;
  profilesFailed: { failed: number; sentence: string } | null;
  paused: { until: number; sentence: string } | null;
  /** still reading: the island asks again */
  loading: boolean;
  /** a TRUE empty, only after every read succeeded */
  empty: boolean;
  /** events left out for a timestamp more than 10 minutes ahead */
  futureDated: number;
  refreshedAt: number | null;
  /** node requests this tab has made (counts only) */
  requests: number;
}
/** the badge's answer (no profile is read for it) */
export interface HubUnreadView {
  state: "not_signed_in" | "loading" | "ok" | "error";
  /** null when it cannot be told (a failed read, or the seen record unreadable): the badge says so, never 0 */
  unread: number | null;
  seenAt: number | null;
  newestAt: number | null;
  sentence: string | null;
}
export const NOTIF_UNREADABLE_SENTENCE = HUB_READ_SENTENCES.notifications_unreadable;
export const NOTIF_SEEN_UNREADABLE_SENTENCE = "Couldn't read which notifications you've already seen, so none are marked new. Try again.";
export const NOTIF_SEEN_SAVE_FAILED_SENTENCE = HUB_READ_SENTENCES.seen_unsaved;
/** TRUE empties, said only after every read succeeded, per tab */
export const NOTIF_EMPTY_SENTENCES: Record<HubNotifTab, string> = {
  all: "No notifications yet: nobody has followed you, mentioned you, or replied to, liked or recast your newest posts.",
  priority: "Nothing here yet: no new followers, mentions or replies in what was read.",
  mentions: "No mentions or replies yet in what was read.",
};
export const NOTIF_BADGE_UNKNOWN = "Couldn't check your Farcaster notifications just now.";
export function notifCoverageSentence(c: { followers: number; mentions: number; posts: number }): string {
  return `From Farcaster's network, read by this browser: your newest ${n(c.followers)} followers and ${n(c.mentions)} mentions, and the replies, likes and recasts on your newest ${n(c.posts)} posts.`;
}
/** which reads failed, in words (their notifications may be missing) */
export function notifPartialSentence(f: { followers: boolean; mentions: boolean; posts: boolean; onPosts: number }): string {
  const parts: string[] = [];
  if (f.followers) parts.push("your new followers");
  if (f.mentions) parts.push("your mentions");
  if (f.posts) parts.push("your newest posts");
  if (f.onPosts > 0) parts.push(`the replies, likes or recasts on ${f.onPosts === 1 ? "1 of your posts" : n(f.onPosts) + " of your posts"}`);
  const list = parts.length <= 1 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  return `Couldn't read ${list} just now, so some notifications may be missing.`;
}
const VERB: Record<HubNotifKind, string> = { follow: "followed you", like: "liked your post", recast: "recast your post", reply: "replied to your post", mention: "mentioned you" };
/** "Alice, Bob and 12 others liked your post" (the names are the actors' display names) */
export function notifSentence(item: Pick<HubNotificationItem, "kind" | "actors" | "count" | "atLeast">): string {
  const names = item.actors.map((a) => a.displayName || "@" + a.username);
  const first = names[0] ?? "Someone";
  const verb = VERB[item.kind];
  if (item.count <= 1) return `${first} ${verb}`;
  if (item.count === 2 && names.length >= 2) return `${first} and ${names[1]} ${verb}`;
  const shown = names.length >= 2 ? 2 : 1;
  const others = item.count - shown;
  const lead = shown === 2 ? `${first}, ${names[1]}` : first;
  return `${lead} and ${item.atLeast ? "at least " : ""}${others === 1 ? "1 other" : n(others) + " others"} ${verb}`;
}
/** the badge's words: "20+" past 20, as X shows it */
export function badgeText(unread: number): string {
  return unread > 20 ? "20+" : String(unread);
}

// ------------------------------------------------------------------------------------------------ For You (spec B)
// FOR YOU FROM THE HUB (lib/fc/hubRead/forYou.ts): posts the root's follows liked or recast lately, and recent posts from
// accounts several of them follow, read by this browser from the node and ordered by the root's mode. The coverage words
// are the real counts of what was read (HUB_FORYOU_LIMITS), never a stronger claim; a proof is a count of the people you
// follow who did something, never a network total (the node keeps none).
export interface HubForYouProof {
  /** the people you follow who liked it / recast it, from the newest reactions read */
  likes: number;
  recasts: number;
  /** the people you follow (of those sampled) who follow its author */
  followedBy: number;
  /** the first few who liked or recast it, named (their profiles) */
  actors: User[];
  /** "Liked by Alice and 2 others you follow" / "Followed by 9 people you follow" */
  sentence: string;
}
export interface HubForYouView {
  state: "not_signed_in" | "loading" | "ready" | "error";
  code: HubReadCode | null;
  reason: string | null;
  account: HubAccountView | null;
  follows: { state: "loading" | "ok" | "error"; count: number | null; truncated: boolean; stale: boolean };
  /** what was read: how many of the follows were checked for activity, how many active ones were read in full (the
   *  sample), how many accounts beyond them were read, over which window; the sentence above the feed */
  coverage: { probed: number; active: number; accounts: number; windowHours: number; sentence: string | null };
  /** still checking who of the people you follow is active, or reading what they liked and follow */
  progress: { probing: boolean; sampled: number; of: number };
  items: Cast[];
  /** by cast hash: why it is here */
  proof: Record<string, HubForYouProof>;
  mode?: HubModeView | null;
  /** what engagement, the lens's likes and recasts and author affinity read on For You */
  signals: string | null;
  /** more candidates were read than are on screen ("Show more" shows them; nothing more is read for it) */
  more: boolean;
  loading: boolean;
  paused: { until: number; sentence: string } | null;
  partial: { failed: number; sentence: string } | null;
  profilesFailed: { failed: number; sentence: string } | null;
  /** TRUE empties only, each after reads that succeeded */
  empty: { kind: "follows-none" | "none-active" | "nothing-new"; sentence: string } | null;
  futureDated: number;
  refreshedAt: number | null;
  requests: number;
}
export const FOR_YOU_SOURCE_LINE = "From Farcaster's network, read by this browser: what the people you follow liked, recast and followed lately. Totem's server isn't asked.";
export const FOR_YOU_WHO_SEES =
  "Farcaster's network sees this browser's internet address and which accounts and posts it reads, the people you follow and accounts beyond them. Totem's server doesn't. So that what it skips says little about your personas, For You reads only about half of the accounts it could, picked by a key only your vault holds.";
export const FOR_YOU_SIGNALS_SENTENCE =
  "On For You, engagement and your lens's likes and recasts count only the people you follow who liked or recast a post (Farcaster's network keeps no totals), and author affinity is how many of them follow its author.";
const days = (h: number) => (h % 24 === 0 ? (h / 24 === 1 ? "day" : h / 24 + " days") : h + " hours");
const people = (x: number) => (x === 1 ? "1 person" : n(x) + " people");
export function forYouCoverageSentence(active: number, accounts: number, windowHours: number): string {
  const lead = `From ${people(active)} you follow who liked a post in the last ${days(windowHours)}`;
  return accounts > 0 ? `${lead}, and ${accounts === 1 ? "1 account" : n(accounts) + " accounts"} several of them follow.` : lead + ".";
}
export function forYouProgressSentence(sampled: number, of: number, probing: boolean): string {
  return probing ? "Finding who of the people you follow is active…" : `Reading what ${n(sampled)} of ${people(of)} you follow liked and follow…`;
}
/** which reads failed, in words (their posts may be missing) */
export function forYouPartialSentence(f: { follows: number; posts: number; accounts: number }): string {
  const parts: string[] = [];
  if (f.follows > 0) parts.push(`what ${people(f.follows)} you follow liked or follow`);
  if (f.posts > 0) parts.push(f.posts === 1 ? "1 post" : n(f.posts) + " posts");
  if (f.accounts > 0) parts.push(`the newest posts of ${accounts(f.accounts)}`);
  const list = parts.length <= 1 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  return `Couldn't read ${list} just now, so some posts may be missing.`;
}
export function forYouEmptySentence(kind: "follows-none" | "none-active" | "nothing-new", probed: number, windowHours: number): string {
  if (kind === "follows-none") return "You don't follow anyone on Farcaster yet, so For You has no one to start from. Follow people in the Farcaster app and what they like shows up here.";
  if (kind === "none-active")
    return probed === 1
      ? `The 1 person you follow hasn't liked a post in the last ${days(windowHours)}, so there's nothing to show here yet.`
      : `None of the ${people(probed)} you follow that were checked liked a post in the last ${days(windowHours)}, so there's nothing to show here yet.`;
  return "Nothing here yet from beyond the people you follow: what they liked and follow lately is by people you already follow.";
}
/** the line above a For You card: who of the people you follow liked or recast it, or how many follow its author */
export function forYouProofSentence(p: { likes: number; recasts: number; followedBy: number; actorCount: number; names: string[] }): string {
  if (p.actorCount > 0) {
    const verb = p.likes > 0 && p.recasts > 0 ? "Liked or recast by" : p.likes > 0 ? "Liked by" : "Recast by";
    const first = p.names[0] ?? "someone you follow";
    if (p.actorCount === 1) return `${verb} ${first}`;
    if (p.actorCount === 2 && p.names.length >= 2) return `${verb} ${first} and ${p.names[1]}`;
    const others = p.actorCount - 1;
    return `${verb} ${first} and ${others === 1 ? "1 other" : n(others) + " others"} you follow`;
  }
  return `Followed by ${people(p.followedBy)} you follow`;
}

/** an identifier-free address for a hub cast or account: the fid and hash ride the FRAGMENT, which a browser never
 *  sends to the server, so Totem's app server never learns which cast or account was opened (SECURITY-POSTURE.md §36) */
export function hubCastHref(fid: number, hash: string): string {
  return `/fc/cast#${fid}/${hash}`;
}
export function hubProfileHref(fid: number): string {
  return `/fc/profile#${fid}`;
}
/** read the fragment the two pages above carry; null when it is not one */
export function parseHubCastFragment(hash: string): { fid: number; hash: string } | null {
  const m = /^#?(\d{1,12})\/(0x[0-9a-f]{40})$/.exec(hash.trim().toLowerCase());
  if (!m) return null;
  const fid = Number(m[1]);
  return Number.isSafeInteger(fid) && fid > 0 ? { fid, hash: m[2] } : null;
}
export function parseHubProfileFragment(hash: string): number | null {
  const m = /^#?(\d{1,12})$/.exec(hash.trim());
  if (!m) return null;
  const fid = Number(m[1]);
  return Number.isSafeInteger(fid) && fid > 0 ? fid : null;
}
