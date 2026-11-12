"use client";
// FOLLOWING FROM THE HUB — the Following tab for a visitor signed in with Farcaster on the live site: the people their
// own Farcaster account follows, and their posts, newest first, read by THIS TAB straight from a Farcaster node
// (lib/fc/hubRead/read.ts; no Neynar, nothing through Totem's servers).
//
// PROGRESSIVE: the device answers a snapshot of what is in and keeps reading; while it says `loading` this island asks
// again (the device holds each ask up to 1.5 s for progress, so the asking is cheap). Posts already shown keep their
// place; newer ones that arrive slot in above them, in order.
// NEVER FAIL OPEN: a read that failed is an error with Retry ("Couldn't read who you follow … this is not an empty
// list"), never "you follow nobody"; accounts whose posts could not be read are counted; a profile that could not be read
// shows the account's number and is counted. "You don't follow anyone" and "No posts yet" only after reads that worked.
// REFRESH: "Check for new posts", the tab regaining focus, and every two minutes while it is visible ask the device to
// re-read the accounts that are due (each on its own clock). A cast or delete as the root (ROOT_CAST_EVENT) asks at once.
// YOUR MODE (spec A): the device applies the root's active mode to the page it read (lib/fc/hubRead/mode.ts) and says
// what it did: how many posts it hid ("Your mode hid all N posts." when it hid every one: never "No posts yet"), which
// of its settings Farcaster posts can't carry ("Not available on Farcaster posts"), never-miss posts marked at the top,
// the banner tier's strip, and a mode that could not be applied as an error with Retry (never the page unfiltered). A
// switch on the mode pill, a tier set on a card or any other write that refreshes the page asks the device again at
// once (Providers' refresh tick and render nonce): the answer is the same posts, read once, under the new mode.
// ADS, PHASE 1 (lib/ads/plan.ts): once a page is shaped, the device is asked which ads it carries for the mode it was
// shaped under (the mode's ad dial; house ads from the shipped, reviewed list; what this identity hid). The rows come
// back merged by the one injection queue: an ad at position 5, then every 15th, never last. No request leaves the tab
// for it. "Hide this ad" and "Hide this advertiser" are sealed on the device and undoable from the line they leave.
// SPEC C — THE EXTRAS ON REAL POSTS: the device answers the page as cards (lib/fc/hubRead/extras.ts). A post of the page
// carries what is ON it: the reading chrome when it is a reading piece (dwell measured on screen, sealed on the device;
// "read"; the bin), a note from a desk you subscribe to, "Sent to you by …" when a ring sent it. What the one injection
// queue spliced in sits between them, each saying why it is there: an unfinished piece back in your reading queue, a
// post you liked that a desk has noted since, a post a ring sent you. None of them was read from the network for this.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { HubCardView, HubExtrasView, HubModeView, HubTimelineView } from "@/lib/fc/hubRead/copy";
import { FOLLOWS_STALE_SENTENCE, HUB_MODE_GAPS_HEAD, HUB_PIECE_LABEL, HUB_REQUEUE_LABEL, HUB_SENDS_EVENT, HUB_SOURCE_LINE, HUB_WHO_SEES, NO_POSTS_SENTENCE, cappedSentence, followsCountSentence, hubNoteLine, hubSentByLine, progressSentence } from "@/lib/fc/hubRead/copy";
import type { AdRow, AdUnitView } from "@/lib/ads/plan";
import { CastCard } from "@/components/CastCard";
import { PreviewStrip } from "@/components/PreviewStrip";
import { TimelineSkeleton } from "@/components/Skeletons";
import { useApp } from "@/components/Providers";
import { AdUnit } from "@/components/ads/AdUnit";
import { adsCall, useAdPlan } from "@/components/ads/useAdPlan";
import { READWISE_CHANGED_EVENT, ReadwiseChunk } from "@/components/ReadwiseChunk";
import { ROOT_CAST_EVENT, hubCall } from "./hubCall";

/** one line above a card saying why it is there (the sample feed's attribution line: 13px bold, 26px indent) */
function Why({ testid, children }: { testid: string; children: React.ReactNode }) {
  return (
    <p data-testid={testid} className="flex items-center pl-[26px] pt-2 text-[13px] font-bold leading-4 text-x-sec">
      {children}
    </p>
  );
}

/** a desk's note on a post (the curator correction surface's look; no vote row: voting is a persona's act) */
function HubNote({ note, resurfaced }: { note: NonNullable<HubCardView["note"]>; resurfaced: boolean }) {
  return (
    <div data-testid="hub-note" data-desk={note.desk} data-resurfaced={resurfaced ? "true" : "false"} className="px-4 pb-1">
      <p data-testid="hub-note-desk" className="pt-2 text-[13px] font-bold leading-4 text-x-sec">
        {hubNoteLine(note.desk, resurfaced)}
      </p>
      <div className="mt-1 rounded-xl border border-x-border p-3">
        <p data-testid="hub-note-claim" className="text-[15px] leading-5 text-x-text">
          {note.claim}
        </p>
        {note.evidenceLink ? (
          /^https?:\/\//i.test(note.evidenceLink) ? (
            <a href={note.evidenceLink} target="_blank" rel="noreferrer noopener" data-testid="evidence-link" className="mt-1 block truncate text-[13px] text-x-blue hover:underline">
              {note.evidenceLink}
            </a>
          ) : (
            <span data-testid="evidence-link" className="mt-1 block truncate text-[13px] text-x-sec">
              {note.evidenceLink}
            </span>
          )
        ) : null}
      </div>
    </div>
  );
}

/** one card of the page: a post with what is on it, or an extra the queue spliced in */
function HubCard({ c, pinned, quiet }: { c: HubCardView; pinned: boolean; quiet: boolean }) {
  const body = <CastCard cast={c.cast} />;
  return (
    <div data-hub-item={c.cast.hash} data-hub-card={c.kind} data-placement={c.placement} data-pinned={pinned ? "true" : undefined} data-quiet={quiet ? "true" : undefined}>
      {pinned ? (
        <p data-testid="hub-pinned-label" className="px-4 pt-2 text-[13px] font-bold leading-4 text-x-sec">
          Never miss
        </p>
      ) : null}
      {c.kind === "sent" || c.sentBy ? <Why testid="hub-sent-by">{hubSentByLine(c.sentBy ?? "a friend")}</Why> : null}
      {c.note ? <HubNote note={c.note} resurfaced={c.kind === "correction"} /> : null}
      {c.piece ? (
        <div data-testid="hub-piece" data-chunk-id={c.piece.chunkId} data-read={c.piece.read ? "true" : "false"} data-requeued={c.kind === "readwise" ? "true" : "false"}>
          <ReadwiseChunk chunkId={c.piece.chunkId} priority={c.piece.priority} initiallyRead={c.piece.read}>
            <Why testid="hub-piece-label">{c.kind === "readwise" ? HUB_REQUEUE_LABEL : HUB_PIECE_LABEL}</Why>
            {body}
          </ReadwiseChunk>
        </div>
      ) : (
        body
      )}
    </div>
  );
}

/** what the extras could not do, said once above the page */
function ExtrasNotices({ extras }: { extras: HubExtrasView }) {
  if (!extras.notices.length) return null;
  return (
    <div data-testid="hub-extras-notices" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec">
      {extras.notices.map((n0) => (
        <p key={n0.kind} data-testid="hub-extras-notice" data-kind={n0.kind} role={n0.kind === "readwise_unavailable" || n0.kind === "notes_unreadable" ? "alert" : undefined} className="py-0.5">
          {n0.sentence}
        </p>
      ))}
    </div>
  );
}

/** the mode's line under the status: its name, what it hid, and what Farcaster posts can't carry (For You uses it too) */
export function ModeLine({ mode }: { mode: HubModeView }) {
  return (
    <div
      data-testid="hub-mode"
      data-mode-id={mode.id ?? ""}
      data-mode-name={mode.name ?? ""}
      data-hidden={mode.hidden}
      data-of={mode.of}
      data-ranked={mode.ranked ? "true" : "false"}
      data-pinned={mode.pinned.length}
      data-quiet={mode.quiet.length}
      className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec"
    >
      <span className="font-bold text-x-text">{mode.name ?? "Your mode"}</span>
      <span>{mode.ranked ? " · ranked by your mode" : " · newest first"}</span>
      {mode.sentence && !mode.hidAll ? (
        <span data-testid="hub-mode-hid" className="ml-1">
          · {mode.sentence}
        </span>
      ) : null}
      {mode.tiers.unreadable ? (
        <p data-testid="hub-mode-tiers-error" role="alert" className="mt-1 text-[#f4212e]">
          {mode.tiers.unreadable}
        </p>
      ) : null}
      {mode.gaps.length ? (
        <details data-testid="hub-mode-gaps" data-count={mode.gaps.length} className="mt-1">
          <summary className="cursor-pointer">
            {HUB_MODE_GAPS_HEAD}: {mode.gaps.map((g) => g.term).join(", ")}
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {mode.gaps.map((g, i) => (
              <li key={i} data-testid="hub-mode-gap" data-kind={g.kind} data-term={g.term}>
                {g.sentence}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

const PAGE = 50;
const MAX = 500;

export function HubFollowing() {
  const [view, setView] = useState<HubTimelineView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const want = useRef(PAGE);
  const seq = useRef(0);
  const alive = useRef(true);
  const timer = useRef<number | undefined>(undefined);

  const ask = useCallback(async (opts: { refresh?: "auto" | "manual"; retry?: boolean; waitMs?: number } = {}) => {
    const my = ++seq.current;
    window.clearTimeout(timer.current);
    const r = await hubCall<HubTimelineView>({ op: "timeline", want: want.current, waitMs: opts.waitMs ?? 1500, refresh: opts.refresh, retry: opts.retry === true });
    if (!alive.current || my !== seq.current) return; // an answer to an older question never lands over a newer one
    if (!r.ok) {
      // the failure REPLACES what was shown: never yesterday's posts under an error nobody sees
      setView(null);
      setFailure(r.error);
      return;
    }
    setFailure(null);
    setView(r.data);
    if (r.data.loading) timer.current = window.setTimeout(() => void ask(), 150);
  }, []);

  // a mode switch (the pill), a tier set on a card, any write that refreshes the page: the same posts, under the mode
  // now active. No refresh flag: nothing is re-read from the network for it.
  const { refreshTick, renderNonce } = useApp();
  // ADS, PHASE 1: the plan for the page as shaped, under the mode it was shaped under (none while the mode failed or the
  // page is an error; a page the mode emptied gets a plan too, with no slot, so the dial it is under is still said)
  const adModeId = view && (view.state === "ready" || view.state === "loading") && view.mode && view.mode.state === "ok" ? view.mode.id : null;
  // SPEC C + ADS: each card of the page is one row of the ad plan (a spliced extra is a row too), keyed kind:hash
  const adHashes = useMemo(() => (view ? (view.cards ? view.cards.map((c) => c.kind + ":" + c.cast.hash) : view.items.map((c) => c.hash)) : []), [view]);
  const { plan: adPlan, replan } = useAdPlan("following", adModeId, adHashes, `${refreshTick}:${renderNonce}`);
  const [adNotice, setAdNotice] = useState<{ what: "ad" | "advertiser"; id: string; label: string; actor: string; error: string | null } | null>(null);
  const onAdHide = useCallback(
    async (what: "ad" | "advertiser", ad: AdUnitView): Promise<string | null> => {
      const actor = adPlan?.actor;
      if (!actor) return "Couldn't hide this ad just now. Try again.";
      const r = await adsCall<{ ok: true }>({ op: "hide", what, lot: ad.lotId, actor });
      if (!r.ok) return r.error;
      setAdNotice({ what, id: what === "ad" ? ad.lotId : ad.advertiserId, label: what === "ad" ? "that ad" : "ads from " + ad.advertiserName, actor, error: null });
      replan();
      return null;
    },
    [adPlan, replan]
  );
  const onAdUndo = useCallback(async () => {
    if (!adNotice) return;
    const r = await adsCall<{ ok: true }>({ op: "unhide", what: adNotice.what, id: adNotice.id, actor: adNotice.actor });
    if (!r.ok) {
      setAdNotice({ ...adNotice, error: r.error });
      return;
    }
    setAdNotice(null);
    replan();
  }, [adNotice, replan]);
  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    void ask({ waitMs: 300 });
  }, [refreshTick, renderNonce, ask]);

  useEffect(() => {
    alive.current = true;
    void ask({ refresh: "auto", waitMs: 1200 });
    // SPEC C: what a ring sends you arrives on this device's background tick (lib/zk/prefetch.ts: every device's same
    // reads of the validator, rings or not, sent anything or not). A live tab starts it only from a few surfaces, so the
    // Following makes sure it runs; it reads nothing from Farcaster's network and names nothing
    void fetch("/api/zk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prefetchStatus" }), cache: "no-store" }).catch(() => undefined);
    const onFocus = () => void ask({ refresh: "auto", waitMs: 300 });
    const onRootCast = () => void ask({ waitMs: 600 });
    // SPEC C: a piece put in the bin: the same posts, read once, with the piece off (nothing re-read from the network)
    const onReadwise = () => void ask({ waitMs: 300 });
    const every = window.setInterval(() => {
      if (document.visibilityState === "visible") void ask({ refresh: "auto", waitMs: 300 });
    }, 120_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener(ROOT_CAST_EVENT, onRootCast);
    window.addEventListener(READWISE_CHANGED_EVENT, onReadwise);
    // SPEC C: a ring sent this device something new (its tick read the drop): the same posts, with the send spliced in
    window.addEventListener(HUB_SENDS_EVENT, onReadwise);
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
      window.clearInterval(every);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(ROOT_CAST_EVENT, onRootCast);
      window.removeEventListener(READWISE_CHANGED_EVENT, onReadwise);
      window.removeEventListener(HUB_SENDS_EVENT, onReadwise);
    };
  }, [ask]);

  const retryButton = (testid: string) => (
    <button type="button" data-testid={testid} onClick={() => void ask({ retry: true })} className="ml-2 font-bold text-x-blue hover:underline">
      Retry
    </button>
  );

  if (failure) {
    return (
      <div data-testid="hub-following-error" data-code="device" role="alert" className="border-b border-x-border px-4 py-6">
        <p className="text-[17px] font-bold leading-6">Couldn&rsquo;t read your Following</p>
        <p className="mt-1 text-[15px] leading-5 text-x-sec">{failure}</p>
        <button type="button" data-testid="hub-following-retry" onClick={() => void ask({ retry: true })} className="mt-3 inline-flex h-9 items-center rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover">
          Retry
        </button>
      </div>
    );
  }
  if (!view) {
    return (
      <div data-testid="hub-following-loading" aria-busy="true">
        <TimelineSkeleton count={6} />
      </div>
    );
  }
  if (view.state === "not_signed_in") {
    return (
      <div data-testid="hub-following-signed-out" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
        {view.reason}
      </div>
    );
  }
  if (view.state === "error") {
    return (
      <div data-testid="hub-following-error" data-code={view.code ?? ""} role="alert" className="border-b border-x-border px-4 py-6">
        <p className="text-[17px] font-bold leading-6">Couldn&rsquo;t read your Following</p>
        <p className="mt-1 text-[15px] leading-5 text-x-sec">{view.reason}</p>
        <button type="button" data-testid="hub-following-retry" onClick={() => void ask({ retry: true })} className="mt-3 inline-flex h-9 items-center rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover">
          Retry
        </button>
      </div>
    );
  }

  const count = view.follows.count;
  const filling = view.loading && view.progress.accounts > 0 && view.progress.pending > 0;
  const mode = view.mode ?? null;
  const modeFailed = mode?.state === "error";
  const pinned = new Set(mode?.pinned ?? []);
  const quiet = new Set(mode?.quiet ?? []);
  // ADS, PHASE 1: the plan's rows, only when they are exactly this page's posts in this order (a plan for an older page
  // is never laid over a newer one: until its own plan lands the page shows its posts alone)
  const byHash = new Map(view.items.map((c) => [c.hash, c]));
  const planPosts = adPlan && adPlan.state === "ok" ? adPlan.rows.filter((r): r is Extract<AdRow, { kind: "post" }> => r.kind === "post").map((r) => r.hash) : null;
  const byCardKey = new Map((view.cards ?? []).map((c) => [c.kind + ":" + c.cast.hash, c]));
  const rowKeys = view.cards ? view.cards.map((c) => c.kind + ":" + c.cast.hash) : view.items.map((c) => c.hash);
  const planFits = !!planPosts && planPosts.length === rowKeys.length && planPosts.every((h, i) => h === rowKeys[i]);
  const rows: AdRow[] = planFits && adPlan ? adPlan.rows : rowKeys.map((hash) => ({ kind: "post", hash }));
  const adCount = rows.filter((r) => r.kind === "ad").length;
  return (
    <div data-testid="hub-following" data-state={view.state} data-count={view.items.length}>
      <div data-testid="hub-following-status" role="status" data-state={view.loading ? "loading" : "ready"} className="flex flex-wrap items-center gap-x-2 border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec">
        {/* NEYNAR AS A SWITCH (§42): the feed's source, machine-readable too (Following is network-only, whatever any switch says) */}
        <span data-testid="feed-source" data-source="network">{HUB_SOURCE_LINE}</span>
        {count !== null ? (
          <Link href="/fc/following" prefetch={false} data-testid="hub-following-count" data-count={count} className="font-bold text-x-text hover:underline">
            {followsCountSentence(count, view.follows.truncated)}
          </Link>
        ) : null}
        {filling ? (
          <span data-testid="hub-following-progress" data-read={view.progress.read + view.progress.failed} data-total={view.progress.accounts}>
            {progressSentence(view.progress.read + view.progress.failed, view.progress.accounts)}
          </span>
        ) : null}
        <button type="button" data-testid="hub-following-refresh" onClick={() => void ask({ refresh: "manual", waitMs: 1500 })} className="ml-auto font-bold text-x-blue hover:underline">
          Check for new posts
        </button>
      </div>
      {view.paused ? (
        <p data-testid="hub-following-paused" role="status" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec">
          {view.paused.sentence}
        </p>
      ) : null}
      {view.capped ? (
        <p data-testid="hub-following-capped" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec">
          {cappedSentence(view.capped.reading, view.capped.of, view.follows.truncated)}
        </p>
      ) : null}
      {view.follows.stale ? (
        <p data-testid="hub-following-stale-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
          {FOLLOWS_STALE_SENTENCE}
          {retryButton("hub-following-stale-retry")}
        </p>
      ) : null}
      {view.partial ? (
        <p data-testid="hub-following-partial-error" data-failed={view.partial.failed} role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
          {view.partial.sentence}
          {retryButton("hub-following-partial-retry")}
        </p>
      ) : null}
      {view.olderFailed ? (
        <p data-testid="hub-following-older-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
          {view.olderFailed.sentence}
          {retryButton("hub-following-older-retry")}
        </p>
      ) : null}
      {view.profilesFailed ? (
        <p data-testid="hub-following-profiles-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
          {view.profilesFailed.sentence}
          {retryButton("hub-following-profiles-retry")}
        </p>
      ) : null}
      {mode && !modeFailed ? <ModeLine mode={mode} /> : null}
      {view.extras && !modeFailed ? <ExtrasNotices extras={view.extras} /> : null}
      {modeFailed ? (
        <div data-testid="hub-mode-error" role="alert" className="border-b border-x-border px-4 py-6">
          <p className="text-[17px] font-bold leading-6">Couldn&rsquo;t apply your mode</p>
          <p className="mt-1 text-[15px] leading-5 text-x-sec">{mode?.reason}</p>
          <button type="button" data-testid="hub-mode-retry" onClick={() => void ask({ waitMs: 600 })} className="mt-3 inline-flex h-9 items-center rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover">
            Retry
          </button>
        </div>
      ) : null}
      {mode && !modeFailed && mode.strip.length ? (
        <PreviewStrip items={mode.strip.map((s) => ({ hash: s.hash, authorPersonaId: "", handle: s.handle, text: s.text, minutesAgo: s.minutesAgo, href: s.href }))} />
      ) : null}
      {view.followsNone ? (
        <div data-testid="hub-following-empty" data-kind="follows-none" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
          {followsCountSentence(0, false)} Follow people in the Farcaster app and they show up here.
        </div>
      ) : view.noPosts ? (
        <div data-testid="hub-following-empty" data-kind="no-posts" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
          {NO_POSTS_SENTENCE}
        </div>
      ) : mode && mode.hidAll ? (
        // the mode hid every post on the page: said as that, never as an empty Following
        <div data-testid="hub-mode-hid-all" data-of={mode.of} className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
          <p className="font-bold text-x-text">{mode.sentence}</p>
          <p className="mt-1">Switch modes from the pill at the top, or change what this mode hides in Settings.</p>
        </div>
      ) : null}
      {adNotice ? (
        <p data-testid="ad-hidden-notice" data-what={adNotice.what} role="status" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec">
          Hidden: you won&rsquo;t see {adNotice.label} again as the identity acting now.
          <button type="button" data-testid="ad-hidden-undo" onClick={() => void onAdUndo()} className="ml-2 font-bold text-x-blue hover:underline">
            Undo
          </button>
          {adNotice.error ? (
            <span data-testid="ad-hidden-undo-error" role="alert" className="ml-2 text-[#f4212e]">
              {adNotice.error}
            </span>
          ) : null}
        </p>
      ) : null}
      <div
        data-testid="hub-timeline"
        data-count={view.items.length}
        data-ads-state={adPlan?.state ?? "pending"}
        data-ads-dial={adPlan?.dial ?? ""}
        data-ads-dormant={adPlan?.dormant ? "true" : "false"}
        data-ads={adCount}
        data-pieces={view.extras ? view.extras.pieces : undefined}
        data-requeued={view.extras ? view.extras.requeued : undefined}
        data-notes={view.extras ? view.extras.notes.onPage + view.extras.notes.resurfaced : undefined}
        data-sent={view.extras ? view.extras.sent.onPage + view.extras.sent.spliced : undefined}
      >
        {rows.map((r) => {
          if (r.kind === "ad")
            return (
              <div key={"ad:" + r.ad.slot} data-hub-ad={r.ad.slot}>
                <AdUnit ad={r.ad} modeName={adPlan?.modeName ?? null} dial={adPlan?.dial ?? null} onHide={onAdHide} />
              </div>
            );
          const card = byCardKey.get(r.hash);
          if (card) return <HubCard key={r.hash} c={card} pinned={card.placement === "page" && pinned.has(card.cast.hash)} quiet={card.placement === "page" && quiet.has(card.cast.hash)} />;
          const c = byHash.get(r.hash);
          if (!c) return null;
          return (
            <div key={c.hash} data-hub-item={c.hash} data-pinned={pinned.has(c.hash) ? "true" : undefined} data-quiet={quiet.has(c.hash) ? "true" : undefined}>
              {pinned.has(c.hash) ? (
                <p data-testid="hub-pinned-label" className="px-4 pt-2 text-[13px] font-bold leading-4 text-x-sec">
                  Never miss
                </p>
              ) : null}
              <CastCard cast={c} />
            </div>
          );
        })}
      </div>
      {adPlan && adPlan.state === "error" && adPlan.reason ? (
        <p data-testid="ads-error" className="px-4 pt-3 text-[12px] leading-4 text-x-sec">
          {adPlan.reason}
        </p>
      ) : null}
      {view.loading && view.items.length === 0 && !modeFailed && !mode?.hidAll ? <TimelineSkeleton count={3} /> : null}
      {view.more && !view.loading && want.current < MAX ? (
        <button
          type="button"
          data-testid="hub-more"
          onClick={() => {
            want.current = Math.min(MAX, want.current + PAGE);
            void ask({ waitMs: 2500 });
          }}
          className="block w-full border-b border-x-border px-4 py-4 text-left text-[15px] text-x-blue hover:bg-x-hover"
        >
          Show older posts
        </button>
      ) : null}
      <p data-testid="hub-who-sees" className="px-4 py-3 text-[12px] leading-4 text-x-sec">
        {HUB_WHO_SEES}
      </p>
    </div>
  );
}
