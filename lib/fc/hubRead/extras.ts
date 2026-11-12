// SPEC C — READWISE, DESK NOTES AND SENT POSTS ON REAL POSTS: the extras on the real Following (the hub timeline,
// lib/fc/hubRead/read.ts). PURE (no fetch, no vault, no clock of its own): the device's engine hands it the page as the
// mode left it, every cast this browser already holds for the Following, and the device's own records (the sealed
// readwise state, the desks the root subscribes to, what a ring sent this device), and it answers the page as cards.
// scripts/unit-hub-read.mjs H19-H21 pin it.
//
// THE SAME MACHINERY AS THE SAMPLE FEED (lib/feed.ts), not a second one:
//   * everything spliced in goes through lib/injection.ts injectIntoFeed, the ONE queue: a post already on the page owns
//     its hash (an extra for it is a duplicate, dropped and listed), first writer wins across types by priority
//     (correction, then sent, then readwise), and every type keeps its cap (readwise: the mode's cadence knob);
//   * a reading piece is keyed "<hash>#chunk1" in the same sealed dwell map and bin as a sample chunk, so "read", "in the
//     bin" and "skipped, comes back" mean exactly what they mean there;
//   * a desk's note is the curator annotation surface (lib/curators/annotations.ts subscribedAnnotations: VALID
//     annotations only, sub-threshold ones never reach here), targeted at a Farcaster post by "fc:<fid>:<hash>".
// WHAT DIFFERS, AND WHY (all of it follows from "nothing here reads Farcaster's node"):
//   * an extra can only be a cast this browser ALREADY HOLDS for the Following. A sent post or a noted post the browser
//     has not read is not fetched for it (a read prompted by a send would tell the node, and anyone watching it with the
//     sender, which browser the send reached): it is counted and said instead;
//   * a requeued piece, a resurfaced note and a sent post pass the mode's own per-post decision (mode.ts modeHides): an
//     extra never brings back a post your mode hides;
//   * a note RESURFACES only a post you liked or recast (the owner's "community notes resurfacing": the post you engaged
//     with comes back when it gets noted), as far as this browser knows your reactions; on the page any subscribed note
//     shows on its post.
import { injectIntoFeed, type InjectionItem } from "@/lib/injection";
import type { FeedCard } from "@/lib/feed";
import type { Cast } from "@/lib/types";
import {
  HUB_DESK_ACTIONS_SENTENCE,
  HUB_FOLDERS_UNREADABLE_SENTENCE,
  HUB_NOTES_UNREADABLE_SENTENCE,
  HUB_READWISE_UNAVAILABLE_SENTENCE,
  hubPieceChunkId,
  hubSentNotHeldSentence,
  isHubReadingPiece,
  type HubExtrasView,
  type HubNoteView,
  type HubPieceView,
} from "./copy";

/** what this module needs of a cast (lib/fc/hubRead/read.ts's record) */
export interface HubExtrasRec {
  hash: string;
  fid: number;
  ts: number;
  text: string;
  embeds: ReadonlyArray<{ url: string } | { castId: { fid: number; hash: string } }>;
}

/** the device's own records the extras are drawn from (lib/fc/hubRead/extrasSource.ts reads them) */
export interface HubExtrasSpec {
  /** the sealed readwise state (lib/readwise/state.ts). "unavailable": it could not be read, so no reading marks and no
   *  requeue (never "nothing read, nothing in the bin": that would hand back what you threw away) */
  readwise:
    | { state: "ok"; dwell: Record<string, { read: boolean }>; buried: ReadonlySet<string>; priority: ReadonlySet<string>; perBuild: number; foldersUnreadable: boolean }
    | { state: "unavailable" };
  /** the desks the root subscribes to: their VALID annotations on Farcaster posts */
  notes:
    | { state: "ok"; list: ReadonlyArray<{ fid: number; hash: string; desk: string; claim: string; evidenceLink: string; action: "badge" | "demote" | "autoblock"; flagsAuthor: boolean }> }
    | { state: "unreadable" };
  /** what a ring sent this device, newest first (lib/rings/received.ts receivedSends: memory only) */
  sends: ReadonlyArray<{ fid: number; hash: string; at: number; from: string }>;
}

export interface HubExtrasCard<R> {
  kind: "post" | "readwise" | "correction" | "sent";
  placement: "page" | "queue";
  rec: R;
  piece: HubPieceView | null;
  note: HubNoteView | null;
  sentBy: string | null;
}

export interface HubExtrasInput<R extends HubExtrasRec> {
  /** the page as the mode left it, in its order */
  page: readonly R[];
  /** every cast this browser holds for the Following (the page included), by hash */
  held: ReadonlyMap<string, R>;
  /** the casts the root liked or recast, as this browser read them for the cards; null = not known */
  engaged: ReadonlySet<string> | null;
  /** the mode's per-post decision (mode.ts modeHides); absent = no mode */
  hides?: (r: R) => boolean;
  spec: HubExtrasSpec;
  /** splice one extra after every `every` posts (lib/feed.ts uses 4) */
  every?: number;
}

/** the page as cards: the posts in the mode's order with what is ON them, and the extras the queue spliced in */
export function shapeExtras<R extends HubExtrasRec>(input: HubExtrasInput<R>): { cards: HubExtrasCard<R>[]; view: HubExtrasView } {
  const { page, held, engaged, spec } = input;
  const hides = input.hides ?? (() => false);
  const rw = spec.readwise.state === "ok" ? spec.readwise : null;
  const notes = spec.notes.state === "ok" ? spec.notes.list : [];
  const onPage = new Set(page.map((r) => r.hash));
  const pieceOf = (r: R): HubPieceView | null => {
    if (!rw || !isHubReadingPiece(r)) return null;
    const chunkId = hubPieceChunkId(r.hash);
    if (rw.buried.has(chunkId)) return null; // in the bin: a plain post again until it is restored
    return { chunkId, read: rw.dwell[chunkId]?.read === true, priority: rw.priority.has(r.hash) };
  };
  const noteOf = (r: R): HubNoteView | null => {
    const n0 = notes.find((x) => x.hash === r.hash && x.fid === r.fid);
    return n0 ? { desk: n0.desk, claim: n0.claim, evidenceLink: n0.evidenceLink } : null;
  };
  /** a send names a cast by (fid, hash): one this browser holds under that author, or none */
  const heldAs = (fid: number, hash: string): R | null => {
    const r = held.get(hash);
    return r && r.fid === fid ? r : null;
  };
  const sentOf = (r: R): string | null => spec.sends.find((s) => s.hash === r.hash && s.fid === r.fid)?.from ?? null;

  // ---- the page: each post with what is on it (never a second card for it)
  const drafts = new Map<FeedCard, HubExtrasCard<R>>();
  const posts: FeedCard[] = page.map((rec) => {
    const fc = { kind: "post", cast: { hash: rec.hash } as Cast } as FeedCard;
    drafts.set(fc, { kind: "post", placement: "page", rec, piece: pieceOf(rec), note: noteOf(rec), sentBy: sentOf(rec) });
    return fc;
  });

  // ---- the queue: only casts this browser holds, not on the page, that the mode does not hide
  const offPage = (r: R | null): r is R => !!r && !onPage.has(r.hash) && !hides(r);
  const items: InjectionItem[] = [];
  const queue = (type: "correction" | "sent" | "readwise", d: HubExtrasCard<R>, tenant?: string) => {
    const fc = { kind: type, cast: { hash: d.rec.hash } as Cast } as FeedCard;
    drafts.set(fc, d);
    items.push({ type, card: fc, sourceHash: d.rec.hash, ...(tenant ? { tenant } : {}) });
  };
  // notes: a post you liked or recast, noted since, comes back with the note
  if (engaged) {
    for (const n0 of notes) {
      const r = heldAs(n0.fid, n0.hash);
      if (!offPage(r) || !engaged.has(r.hash)) continue;
      queue("correction", { kind: "correction", placement: "queue", rec: r, piece: null, note: { desk: n0.desk, claim: n0.claim, evidenceLink: n0.evidenceLink }, sentBy: null }, "curator_annotation");
    }
  }
  // sends: newest first; one this browser has not read is counted, never fetched
  let notHeld = 0;
  for (const s of spec.sends) {
    const r = heldAs(s.fid, s.hash);
    if (!r) {
      notHeld++;
      continue;
    }
    if (!offPage(r)) continue;
    queue("sent", { kind: "sent", placement: "queue", rec: r, piece: null, note: null, sentBy: s.from });
  }
  // the readwise requeue: a piece you were shown and did not finish (its dwell record says unread) comes back, priority
  // folders first, then newest first; one in the bin never does
  if (rw) {
    const due: R[] = [];
    for (const r of held.values()) {
      // the dwell record first: a map lookup, where most held casts stop (the piece test and the mode run on few)
      const id = hubPieceChunkId(r.hash);
      const d = rw.dwell[id];
      if (!d || d.read || rw.buried.has(id)) continue;
      if (!offPage(r) || !isHubReadingPiece(r)) continue;
      due.push(r);
    }
    due.sort((a, b) => Number(rw.priority.has(b.hash)) - Number(rw.priority.has(a.hash)) || b.ts - a.ts || (a.hash < b.hash ? -1 : 1));
    for (const r of due) queue("readwise", { kind: "readwise", placement: "queue", rec: r, piece: { chunkId: hubPieceChunkId(r.hash), read: false, priority: rw.priority.has(r.hash) }, note: null, sentBy: null });
  }

  const { cards: merged, dropped } = injectIntoFeed(posts, items, { every: input.every ?? 4, caps: { readwise: rw ? rw.perBuild : 0 } });
  const cards = merged.map((fc) => drafts.get(fc)).filter((d): d is HubExtrasCard<R> => !!d);

  const notices: HubExtrasView["notices"] = [];
  if (spec.readwise.state === "unavailable") notices.push({ kind: "readwise_unavailable", sentence: HUB_READWISE_UNAVAILABLE_SENTENCE });
  else if (spec.readwise.foldersUnreadable) notices.push({ kind: "folders_unreadable", sentence: HUB_FOLDERS_UNREADABLE_SENTENCE });
  if (spec.notes.state === "unreadable") notices.push({ kind: "notes_unreadable", sentence: HUB_NOTES_UNREADABLE_SENTENCE });
  else if (notes.some((x) => x.flagsAuthor && x.action !== "badge")) notices.push({ kind: "desk_actions", sentence: HUB_DESK_ACTIONS_SENTENCE });
  if (notHeld > 0) notices.push({ kind: "sent_not_held", sentence: hubSentNotHeldSentence(notHeld) });
  const pageCards = cards.filter((c) => c.placement === "page");
  return {
    cards,
    view: {
      pieces: pageCards.filter((c) => c.piece).length,
      piecesRead: pageCards.filter((c) => c.piece?.read).length,
      requeued: cards.filter((c) => c.kind === "readwise").length,
      notes: { onPage: pageCards.filter((c) => c.note).length, resurfaced: cards.filter((c) => c.kind === "correction").length },
      sent: { onPage: pageCards.filter((c) => c.sentBy).length, spliced: cards.filter((c) => c.kind === "sent").length, notHeld },
      dropped: dropped.map((d) => ({ type: d.type, reason: d.reason })),
      notices,
    },
  };
}
