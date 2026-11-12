import "server-only";
// THE FARCASTER WRITE LEDGER — safety-set, mirror of the X spend ledger
// (lib/x/spend.ts), because a public permanent post is spend in a currency
// you cannot refund:
//
//   1. Every outbound Farcaster write records through THIS file BEFORE the
//      network attempt. The entry lands as "pending", the outcome updates
//      it to "sent"/"failed" — so a crash mid-publish leaves a visible
//      pending record for check-before-retry, never an untracked write.
//   2. Hard caps checked BEFORE anything sends: 10 casts/day, 30 total
//      actions/day (env-overridable). A cap hit REFUSES LOUDLY — never
//      queue-and-retry-later, since a retried post after a cap is a
//      surprise public post.
//   3. Entries carry a content hash so a resumed/ambiguous publish can
//      QUERY for the just-attempted cast before any second attempt —
//      "exactly one cast exists on the network" is an exit criterion.
import { createHash } from "@/lib/platform/crypto";
import { state, persistNs } from "@/lib/adapters/mock/store";

/** Env override, NaN-proof: a typo'd value must not fail OPEN to
 * unlimited (NaN comparisons are all false, which would disable both
 * caps). Anything non-numeric or non-positive falls back to the default. */
function capFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
export const FC_CASTS_PER_DAY = capFromEnv("FC_CASTS_PER_DAY", 10);
export const FC_ACTIONS_PER_DAY = capFromEnv("FC_ACTIONS_PER_DAY", 30);
/** BUILD A — THE FOLLOW BUDGET. A follow is an action (it counts against FC_ACTIONS_PER_DAY like every other write),
 * and it also has a smaller daily budget of its own, so a batch of follows (a "follow my X contacts" import, a runaway
 * client, a held-down button) can never spend the whole day's actions and starve posts, replies and likes. A new
 * account that follows dozens of accounts in a day also reads as spam on Farcaster. Default 10, raised with
 * FC_FOLLOWS_PER_DAY (NaN-proof like the caps above), never above the actions cap it sits inside. Per mode, like
 * every cap here. */
export const FC_FOLLOWS_PER_DAY = Math.min(capFromEnv("FC_FOLLOWS_PER_DAY", 10), FC_ACTIONS_PER_DAY);
/** BUILD A review (UXC-04, PUB-2) — how long a SENT receipt makes the same words "a retry". Check-before-retry exists
 * for an attempt whose outcome is unknown, and for the double-submit right after a send; a confirmed cast older than
 * this with the same text is the owner posting it again on purpose ("gm" tomorrow), which Farcaster accepts. PENDING
 * receipts (outcome unknown) are always checked, whatever their age. */
export const FC_RETRY_WINDOW_MS = 10 * 60 * 1000;

export type FcWriteKind = "cast" | "reply" | "like" | "recast" | "delete" | "follow";
export type FcWriteStatus = "pending" | "sent" | "failed" | "refused";

export interface FcWriteEntry {
  id: string;
  kind: FcWriteKind;
  status: FcWriteStatus;
  /** sha256 of the outbound content (casts/replies) — the check-before-retry key */
  contentHash: string | null;
  /** the network hash once the write lands (casts) or the target (reactions/deletes) */
  castHash: string | null;
  /** BUILD A: the followed account (follows only; absent on entries written before it was recorded) — what lets the
   *  app's Follow button answer "already following" instead of spending a second budget slot */
  targetFid?: number | null;
  fid: number | null;
  mode: "fixture" | "live";
  at: number;
  note: string;
}

export class FcWriteCapError extends Error {
  cap: "casts_per_day" | "actions_per_day" | "follows_per_day";
  constructor(cap: FcWriteCapError["cap"], message: string) {
    super(message);
    this.cap = cap;
  }
}

export function contentHashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function fcWrites(): FcWriteEntry[] {
  return [...state().fcWrites.values()];
}

/** Counted = anything that reached (or may have reached) the network
 * today. Refused entries never count (a refusal that consumed budget would
 * make the cap self-tightening) and neither do FAILED ones — "failed" is
 * only ever assigned when the check-before-retry PROVED nothing landed, so
 * holding its budget would punish verified non-events the same way.
 * Pending counts: an in-flight write may have landed. */
function countedToday(mode?: "fixture" | "live"): FcWriteEntry[] {
  const start = todayStart();
  return fcWrites().filter(
    (e) =>
      e.at >= start &&
      e.status !== "refused" &&
      e.status !== "failed" &&
      (mode === undefined || e.mode === mode)
  );
}

/**
 * The cap gate. Runs BEFORE the ledger entry is created, BEFORE anything
 * sends. Throws FcWriteCapError — the caller surfaces a refusal and makes
 * ZERO network attempts after it.
 */
export function assertFcWriteAllowed(kind: FcWriteKind, mode: "fixture" | "live" = "live"): void {
  // MODE-SCOPED, for the same reason check-before-retry is: the two
  // transports are different universes and one must not spend the other's
  // budget. The cap's whole purpose is bounding writes to the REAL public
  // network, and a fixture write reaches no network at all — so counting it
  // against the live budget protects nothing while quietly consuming it.
  //
  // The collision is not hypothetical: preserved live receipts (kept across
  // resetSeed deliberately, being calendar-day facts about the real network)
  // exhausted the shared budget and made every fixture cap test fail after
  // the first real live run. Live writes remain capped exactly as before.
  // Default "live" so a caller that forgets is capped, never uncapped.
  const today = countedToday(mode);
  const casts = today.filter((e) => e.kind === "cast" || e.kind === "reply").length;
  // BUILD A review (UXC-07): ONE budget for every account of this service (every persona, the shared account and a
  // connected main) — the refusal says so, and names the setting that raises it
  if ((kind === "cast" || kind === "reply") && casts >= FC_CASTS_PER_DAY) {
    throw new FcWriteCapError(
      "casts_per_day",
      `daily cast cap: ${casts} of ${FC_CASTS_PER_DAY} used today, one budget shared by all your accounts — refusing, not queueing (FC_CASTS_PER_DAY on this service raises it)`
    );
  }
  if (kind === "follow") {
    // BUILD A: the follow budget, inside the actions cap (same counting: pending and sent hold a slot)
    const follows = today.filter((e) => e.kind === "follow").length;
    if (follows >= FC_FOLLOWS_PER_DAY) {
      throw new FcWriteCapError(
        "follows_per_day",
        `daily follow budget: ${follows} of ${FC_FOLLOWS_PER_DAY} used today, shared by all your accounts — refusing, not queueing (FC_FOLLOWS_PER_DAY raises it, up to the ${FC_ACTIONS_PER_DAY}-action cap)`
      );
    }
  }
  if (today.length >= FC_ACTIONS_PER_DAY) {
    throw new FcWriteCapError(
      "actions_per_day",
      `daily action cap: ${today.length} of ${FC_ACTIONS_PER_DAY} used today (posts, replies, likes, recasts and follows), one budget shared by all your accounts — refusing, not queueing (FC_ACTIONS_PER_DAY on this service raises it)`
    );
  }
}

let seq = 0;
// ids mix timestamp + module seq + randomness: the module counter resets
// with the process while the ledger map is persisted, so timestamp+seq
// alone could collide across a restart landing in the same millisecond
const rand = () => Math.random().toString(36).slice(2, 6);
/** Open a PENDING entry — the before-send record. The only write path in. */
export async function openWrite(input: {
  kind: FcWriteKind;
  contentHash?: string | null;
  castHash?: string | null;
  /** BUILD A: follows only — the followed account */
  targetFid?: number | null;
  fid?: number | null;
  mode: "fixture" | "live";
  note: string;
}): Promise<FcWriteEntry> {
  const entry: FcWriteEntry = {
    id: "fcw_" + Date.now().toString(36) + "_" + (seq++).toString(36) + rand(),
    kind: input.kind,
    status: "pending",
    contentHash: input.contentHash ?? null,
    castHash: input.castHash ?? null,
    ...(input.targetFid !== undefined && input.targetFid !== null ? { targetFid: input.targetFid } : {}),
    fid: input.fid ?? null,
    mode: input.mode,
    at: Date.now(),
    note: input.note,
  };
  state().fcWrites.set(entry.id, entry);
  await persistNs("fcWrites");
  return entry;
}

export async function settleWrite(
  id: string,
  status: Exclude<FcWriteStatus, "pending">,
  castHash?: string | null
): Promise<void> {
  const e = state().fcWrites.get(id);
  if (!e) return;
  e.status = status;
  if (castHash !== undefined) e.castHash = castHash;
  await persistNs("fcWrites");
}

/** check-before-retry: is there a pending/sent entry for this content? */
/** MULTI-FID Gate 5 (attack-fid-3 #10): scoped to the acting fid when one is given — the same content under another
 * account is another cast; entries from before fids were recorded (fid null) match the shared path only.
 * BUILD A review (UXC-04): a PENDING entry (outcome unknown) always matches; a SENT one only inside
 * FC_RETRY_WINDOW_MS — an older confirmed cast with the same words is not a retry, it is a new post. A pending match
 * wins over a sent one: it is the attempt whose outcome the check must establish. */
export function priorWriteFor(contentHash: string, fid?: number | null, now: number = Date.now()): FcWriteEntry | null {
  const mine = fcWrites().filter((e) => e.contentHash === contentHash && (fid === undefined || (e.fid ?? null) === fid));
  return (
    mine.find((e) => e.status === "pending") ??
    mine.find((e) => e.status === "sent" && now - e.at <= FC_RETRY_WINDOW_MS) ??
    null
  );
}

interface LedgerCounts {
  today: number;
  casts: number;
  /** BUILD A: follows today (the follow budget's count) */
  follows: number;
}
function countsFor(mode?: "fixture" | "live"): LedgerCounts {
  const today = countedToday(mode);
  return {
    today: today.length,
    casts: today.filter((e) => e.kind === "cast" || e.kind === "reply").length,
    follows: today.filter((e) => e.kind === "follow").length,
  };
}

/** Caps are enforced PER MODE, so a single total would misdescribe what is
 * actually allowed next. `today`/`casts` remain the all-modes totals (what a
 * human wants to see); `fixture` and `live` are the numbers the caps are
 * actually compared against. */
export function ledgerSummary(): LedgerCounts & {
  capCasts: number;
  capActions: number;
  capFollows: number;
  fixture: LedgerCounts;
  live: LedgerCounts;
} {
  return {
    ...countsFor(),
    capCasts: FC_CASTS_PER_DAY,
    capActions: FC_ACTIONS_PER_DAY,
    capFollows: FC_FOLLOWS_PER_DAY,
    fixture: countsFor("fixture"),
    live: countsFor("live"),
  };
}
