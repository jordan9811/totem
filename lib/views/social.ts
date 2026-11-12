// PROD-LIVE PASS (D-CU-0-4) — the data shapes of the social pages: a profile, a cast thread, notifications and the
// history shelf. Types and constants only, with no runtime imports, so BOTH sides can use this module:
//
//   * the server (lib/views/social.server.ts) computes these on the RIG, where it still holds the seeded keystore,
//     and hands them to the page's client island as its `initial` data — the rig's DOM is what it always was;
//   * the same computation runs as an /api/* route (app/api/profile, app/api/thread, app/api/notifications,
//     app/api/history, app/api/eventlog/history). On a PUBLIC deployment the server holds no identity, so those
//     routes are answered IN THE BROWSER by the device (lib/device/host.ts) and the island renders their answer.
//
// Every value a client renders that depends on the clock or the locale (relative times, the permalink timestamp,
// an imported post's original date, "1,234 likes") is computed where the data is computed and shipped as a string,
// so the server's HTML and the client's first render agree (no hydration drift at a minute boundary, and no
// timezone-dependent text that differs between the server and the browser on the rig).
import type { ResolvedIdentity } from "@/lib/identity/resolver";
import type { Cast, NotificationItem, User } from "@/lib/types";

/** /api/profile answers 404 with exactly this error when the handle names no account this viewer can resolve */
export const PROFILE_MISSING = "no such account";
/** /api/thread answers 404 with exactly this error when the hash names no cast this viewer can resolve */
export const CAST_MISSING = "no such post";

// ---------- FC-READ (review): the live-read status a thread or profile page carries ----------
//
// FC-READ (review): a thread or profile read through the public read relay used to drop the relay's freshness on the
// way to the page — a 24 h shelf answer rendered exactly like a live one (privacy-safety-3). The views now carry it,
// and the islands render the same chip the timelines do. Only "live" | "stale" here: a read that did not answer at
// all is not a view, it is the paused state below.

/** where a thread's or profile's network content came from — present only when it came through the read relay */
export interface ViewLiveSource {
  source: "relay";
  state: "live" | "stale";
}

/**
 * FC-READ (review): the FIXED sentences a refused relay read carries (lib/adapters/neynar/content.ts RelayReadError
 * takes its message from here, keyed by the relay's code). /api/thread and /api/profile answer 503 {error, code} with
 * one of them; the islands read `error` through useApiJson, which surfaces the message only — so the islands tell a
 * relay refusal from any other failure by matching this CLOSED table (both sides import it: they cannot drift), and
 * render the paused state (data-testid "live-paused") instead of the generic load-error block, whose copy carries a
 * page-health needle word. None of these may carry one ("Couldn't load", "refusing to", "404", "Couldn't confirm",
 * "Couldn't read" — scripts/lib/page-health.mjs).
 */
export const LIVE_PAUSED_SENTENCES = {
  /** fc_read_off, fc_read_unarmed (and the device's own server-side guard) */
  off: "Live Farcaster posts are paused on this preview right now.",
  /** fc_read_budget */
  budget: "Live Farcaster posts are paused on this preview for today.",
  /** fc_read_rate (429) */
  rate: "Too many live Farcaster lookups from here just now. Try again in a few minutes.",
  /** fc_read_upstream: the relay reached Farcaster's provider and it did not answer */
  upstream: "Farcaster did not answer just now. Try again shortly.",
  /** fc_read_framed: the page is inside another site's frame, where this device makes no lookups */
  framed: "Live Farcaster posts open only on this site's own pages.",
  /** any other relay failure (unreachable, malformed, a bare 5xx, an unreadable locality check) */
  error: "Live Farcaster posts are unavailable at the moment. Try again shortly.",
  /** NEYNAR AS A SWITCH (§42) fc_source_off: the operator keeps this surface on Farcaster's network (FC_SOURCE_*) */
  switchedOff: "This Farcaster read is switched to Farcaster's network on this site, so Neynar is not asked.",
} as const;

const LIVE_PAUSED_SET: ReadonlySet<string> = new Set(Object.values(LIVE_PAUSED_SENTENCES));

/** FC-READ (review): the sentence, when an island's read error IS a relay refusal; null for every other failure */
export function livePausedSentence(error: string | null | undefined): string | null {
  return typeof error === "string" && LIVE_PAUSED_SET.has(error) ? error : null;
}

// ---------- profile ----------

// PROD-LIVE (review fix): the history view carries the TEXT the tab draws and nothing else. The first version
// shipped each event's log id (`ev_…`) and its `triggeringCastId`, plus a hash-keyed receipts map — and on the rig
// the profile page hands this view to a "use client" island, so all of it rode the page's RSC payload, where HEAD's
// server-rendered tab had emitted only rendered text (a receipt's handle and text, or a 10-character hash prefix).
// Event-log material stays in the log: strikes are keyed by position, each event carries its own receipt already
// resolved, and a cast that cannot be resolved ships only the prefix the tab prints. The same stripped view answers
// /api/eventlog/history, since the island needs nothing more there either.

/** a receipt: the cast that triggered a relationship event, reduced to what the history tab draws */
export type HistoryReceipt =
  | {
      kind: "cast";
      /** undefined when the post's author is not a known persona (renders "@", exactly as before) */
      handle?: string;
      /** first 140 characters */
      text: string;
    }
  /** the cast is not known here: the tab prints "cast <prefix>…", so the first 10 characters are all that ships */
  | { kind: "unresolved"; hashPrefix: string };

/** one relationship event, reduced to what the history tab draws */
export interface HistoryEvent {
  /** the surface it happened on ("profile", "hover_card", …) — printed as "from the hover card" */
  context: string;
  /** "12m ago" / "3d ago" / "before the log existed" — computed with the data */
  when: string;
  /** the triggering cast, resolved; null when the event had none */
  receipt: HistoryReceipt | null;
}

/** The relationship-history tab (CALL OPTION B). Served by the event-log endpoint family (/api/eventlog/history)
 *  and handed to the profile island on the rig — which is why it holds rendered text only, never log material. */
export type RelationshipHistoryView =
  | { status: "error"; error: string }
  | {
      status: "ok";
      /** no events at all: the tab renders nothing */
      empty: boolean;
      follow: HistoryEvent | null;
      /** only drawn when there is no logged follow: "you were already following before the log existed" */
      backfilledFollow: boolean;
      /** the tab draws the receipt alone ("First interaction:") */
      firstInteraction: { receipt: HistoryReceipt | null } | null;
      engagements: number;
      strikes: HistoryEvent[];
      muted: boolean;
      strikesOn: boolean;
      strikeThreshold: number;
    };

/** one imported-from-X post, with its display strings computed alongside it */
export interface ImportedRow {
  id: string;
  text: string;
  /** the ORIGINAL X date, formatted */
  date: string;
  likes: string;
  reposts: string;
  isReply: boolean;
  /** PERSONA LAUNCH P2 (BYX G3): "RT @…" — hidden on the shelf unless the viewer asks for them */
  isRetweet: boolean;
  resurfaced: boolean;
}

/** PERSONA LAUNCH P2 (BYX G3): how many rows one shelf page carries (the rest arrive by "Show more") */
export const SHELF_PAGE_SIZE = 100;

/**
 * PERSONA LAUNCH P2 (BYX G3/G6): the shelf, or the honest reason it could not be read. The shelf is a chunked sealed
 * document now; an unreadable one is an ERROR the profile shows ("Your X history couldn't be read: …"), never an
 * empty shelf. The attribution line is computed now from the persona's current link (never stored on the posts):
 *   verified     the archive's account is the persona's Farcaster-verified X account (verifiedBy names how)
 *   test-link    the persona carries a fixture link of that handle — "test link, not verified"
 *   self-supplied anything else — "self-supplied archive, unverified"
 */
export type ImportedView =
  | {
      status: "ok";
      personaId: string;
      handle: string;
      verified: boolean;
      verifiedBy: "oauth" | "web-proof" | "fixture" | "farcaster-verified" | null;
      attribution: "verified" | "test-link" | "self-supplied";
      unlinked: boolean;
      anyResurfaced: boolean;
      /** the whole shelf, for the line "2,600 posts from X · 400 retweets hidden" */
      counts: { total: number; retweets: number; replies: number };
      /** the first page under the default view (retweets hidden, replies shown) */
      posts: ImportedRow[];
      nextOffset: number | null;
    }
  | { status: "error"; personaId: string; error: string };

/** one page of a shelf (GET /api/x/import?view=shelf) */
export interface ShelfPageView {
  rows: ImportedRow[];
  nextOffset: number | null;
  shown: number;
  counts: { total: number; retweets: number; replies: number };
}

export type ProfileView =
  | {
      kind: "seeded";
      personaId: string;
      name: string;
      handle: string;
      user: User;
      /** ZK PASS 2 Gate 1: PROOF under zk (0 = not proven), the seed's tier otherwise */
      tier?: number;
      postCount: number;
      casts: Cast[];
      /** the profile is the ACTING persona's own (the same track as useApp().actingPersonaId) */
      isOwn: boolean;
      /** the block read failed after retries: never render "not blocked" on a guess */
      blockCheckFailed: boolean;
      isBlocked: boolean;
      /** PersonaResolver's answer for THIS viewer */
      identity: ResolvedIdentity;
      imported: ImportedView | null;
      /** PERSONA LAUNCH P1 (SIWF, applied by the byx track that owns this file): this persona IS the visitor's own
       *  Farcaster account signed in read-only — its sealed facts for the "That's me" badge. NEVER the fid. */
      publicSelf?: { fname: string; verifiedAt: number; disconnected: boolean; xShown?: string; via?: "x"; x?: { username: string; disconnected: boolean } };
    }
  | {
      kind: "fixture";
      user: User;
      casts: Cast[];
      isSelf: boolean;
      tier?: number;
      /** FC-READ: a real Farcaster account read through the preview's read relay — live and READ-ONLY here (no
       *  follow, no persona layer); absent for every seed/fixture profile */
      network?: true;
      /** FC-READ (review): the relay's freshness for this account and its casts (stale when either came off a shelf);
       *  absent unless the page's content came through the relay */
      liveSource?: ViewLiveSource;
      /** BUILD A review (UXC-12): a real Farcaster account read DIRECTLY (the owner service's live content): its Follow
       *  is a Farcaster follow by the acting persona (or the honest reason it is not); absent everywhere else */
      live?: true;
    };

// ---------- thread ----------

export interface ThreadView {
  cast: Cast;
  /** "2:41 PM · Aug 17, 2026", computed with the data */
  permalinkTime: string;
  replies: Cast[];
  /** [reply hash, declaredBy] for every reply that refutes this cast (author-declared or curator-attested) */
  refuters: [string, string][];
  /** FC-READ: the cast is a network cast read through the preview's read relay — READ-ONLY here (like, recast,
   *  reply, quote and act-as answer 403 NETWORK_READ_ONLY); absent for every local/seed cast */
  network?: true;
  /** FC-READ (review): the relay's freshness for the cast and its replies (stale when either came off a shelf);
   *  absent unless the page's content came through the relay */
  liveSource?: ViewLiveSource;
}

// ---------- notifications ----------

export type NotificationPolicyName = "all" | "mentions_only" | "muted";

export interface NotificationRowView extends NotificationItem {
  /** relative time, computed with the data */
  when: string;
}

export interface NotificationsView {
  tab: string;
  /** the active mode's policy, or null when the mode could not be read */
  policy: NotificationPolicyName | null;
  /** set when the mode read failed: the page says so (with a Retry) instead of silently ignoring the policy */
  policyError: string | null;
  notifications: NotificationRowView[];
  /** LAYERS_WORLD=empty: there is no persona yet — nobody to notify, and no mode to read (the page says so) */
  noPersona?: boolean;
}

// ---------- history ----------

export interface HistoryShelfView {
  casts: Cast[];
}
