// PERSONA LAUNCH P8 — WHERE IS MY COPY TO @totem ON X? PURE: this device's own knowledge of one X copy (its sealed record,
// its submission's state, the tick's outcome log, whether it still waits for its proof) matched against the outbox's
// PUBLIC list as the last tick read it (lib/zk/prefetch.ts cachedXOutbox — the whole list, never a per-id read). Nothing
// here fetches, and nothing is ever said that is not test data: every sentence says so (the owner rule — never present
// test data as live; no X call leaves the fixture).
//
// The order matters: the PUBLIC list is the outbox's own word, so a row there wins over anything this device remembers
// (a copy sent and accepted shows as "waiting for review" the moment the list has it). Before it is listed, the device's
// own states speak: waiting for its proof, queued, sent. A refusal is final and says why.

export type XCopyState =
  | "wanted"
  | "deferred"
  | "queued"
  | "sent"
  | "review"
  | "approved"
  | "posted"
  | "rejected"
  | "failed"
  | "replay"
  | "refused"
  | "expired"
  | "dropped"
  | "unknown";

export interface XCopyInputs {
  /** the outbox's public row for this copy, when the last tick's list holds it */
  row: { status: string; hour: number; postedId: string | null; text: string | null } | null;
  /** this device's submission for it (queue item), when held */
  item: { status: string; outcome: string | null } | null;
  /** how a pruned submission ended (the sealed record's copy) */
  settled: { status: string; outcome: string | null } | null;
  /** the tick's outcome log entry */
  outcome: { stage: string; reason: string | null } | null;
  /** still in the wanted set (waiting for its proof) */
  wanted: boolean;
}

export interface XCopyStatus {
  state: XCopyState;
  /** the plain sentence the composer line and the settings panel show */
  sentence: string;
  /** a final state: polling can stop */
  final: boolean;
  postedId: string | null;
  hour: number | null;
}

/** every sentence ends by saying this is test data */
const TEST = "(test data)";

export function xCopyStatus(i: XCopyInputs): XCopyStatus {
  const r = i.row;
  if (r) {
    const base = { postedId: null as string | null, hour: Number.isFinite(r.hour) ? r.hour : null };
    switch (r.status) {
      case "review":
        return { ...base, state: "review", final: false, sentence: `Waiting for review ${TEST}. Nothing goes to X until a moderator approves it.` };
      case "approved":
        return { ...base, state: "approved", final: false, sentence: `Approved — goes out in the next X slot ${TEST}.` };
      case "posted":
        return { ...base, postedId: r.postedId, state: "posted", final: true, sentence: "Posted (test data — nothing reached X)." };
      // PERSONA LAUNCH wave 3 (UXH-7): NOT final — the moderator may still approve a rejected copy until it is posted
      // (validator/xoutbox.js: a rejected row is kept and can be re-decided), so the status line keeps following it
      case "rejected":
        return { ...base, state: "rejected", final: false, sentence: `Not approved ${TEST}. It stays off X unless the moderator approves it after all; your anonymous post is not affected.` };
      case "failed":
        return { ...base, state: "failed", final: true, sentence: `Couldn't go out ${TEST}.` };
      default:
        return { ...base, state: "unknown", final: false, sentence: `The outbox lists this copy in a state this app doesn't know ${TEST}.` };
    }
  }
  const sub = i.item ?? i.settled;
  if (sub) {
    if (sub.status === "queued") return { state: "queued", final: false, postedId: null, hour: null, sentence: `Queued to send at a random moment ${TEST}.` };
    if (sub.status === "sent" && sub.outcome === "accepted") return { state: "sent", final: false, postedId: null, hour: null, sentence: `Sent; waiting to show up in the outbox ${TEST}.` };
    if (sub.status === "sent" && sub.outcome === "replay") return { state: "replay", final: true, postedId: null, hour: null, sentence: `Not sent: this window's post to @totem on X was already used ${TEST}.` };
    // PERSONA LAUNCH wave 3 (L7): its window ended before it could go out (the app was closed or off) — it never left this
    // device, so nothing was seen and the words may be sent again
    if (sub.status === "refused" && sub.outcome === "expired") return { state: "expired", final: true, postedId: null, hour: null, sentence: `Not sent: its window ended before it could go out, so it never left this device. You can send it again ${TEST}.` };
    // W3-X-DUP-AS-REPLAY: the outbox's content refusals (the same words as a copy from the last 7 days, a text it no
    // longer takes) come back as a refusal, never as "the window's post was already used"
    return { state: "refused", final: true, postedId: null, hour: null, sentence: `Not sent: the anonymous channel or the validator refused it — the outbox refuses words it already took this week ${TEST}.` };
  }
  if (i.outcome?.stage === "dropped") return { state: "dropped", final: true, postedId: null, hour: null, sentence: `Not sent: ${i.outcome.reason ?? "it could not be proved"} ${TEST}.` };
  if (i.wanted || i.outcome?.stage === "wanted" || i.outcome?.stage === "retrying" || i.outcome?.stage === "deferred") {
    const deferred = i.outcome?.stage === "deferred" || i.outcome?.stage === "retrying";
    return { state: deferred ? "deferred" : "wanted", final: false, postedId: null, hour: null, sentence: deferred ? `Waiting for its proof — it will be tried again ${TEST}.` : `Waiting for its proof ${TEST}.` };
  }
  return { state: "unknown", final: true, postedId: null, hour: null, sentence: `There is no record of this copy on this device ${TEST}.` };
}

/** the outbox's queue counts from the public list (for the settings panel) */
export function xQueueCounts(list: ReadonlyArray<{ status: string }> | null): { review: number; approved: number; posted: number; rejected: number; failed: number; total: number } | null {
  if (!list) return null;
  const c = { review: 0, approved: 0, posted: 0, rejected: 0, failed: 0, total: list.length };
  for (const r of list) if (r.status in c && r.status !== "total") (c as Record<string, number>)[r.status]++;
  return c;
}
