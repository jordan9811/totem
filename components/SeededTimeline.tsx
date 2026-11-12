"use client";
// UX GATE 2 — timeline refresh undo. X's actual failure mode: you see a
// post, the feed refreshes, it's gone forever. Refreshing here pushes the
// PRIOR feed (cards + scroll position) onto a per-(persona,mode) undo
// stack before swapping in new content; "N new posts — tap to keep, or
// undo" stays up until you scroll or dismiss it, so the swap is never a
// silent replacement. Ctrl-Z (⌘Z) does the same as the banner's Undo.
//
// The stack is SESSION-scoped, not persisted: sessionStorage, not
// localStorage — it survives navigating away and back within the tab, and
// is gone with the tab or a hard restart. That's deliberate: this is
// ephemeral UX, not data (restart-survival must never see it).
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedCard } from "@/lib/feed";
import type { ModeDefinition } from "@/lib/adapters/types";
import { FeedCardView, DebunkIndicator } from "./FeedCards";
import { TimelineSkeleton } from "./Skeletons";
// MEGA PASS 2 Gate 3: the per-mode action-row binding for every card below, and the device's scroll zones
import { ActionRowProvider } from "./ActionRowContext";
import { ScrollZoneShell } from "./ScrollZoneShell";
import { castRowFor } from "@/lib/actions/bindings";
import type { ZoneConfig } from "@/lib/zones/types";
import { noteFeedLiveSource } from "./Composer";
import { useApp } from "@/components/Providers";

// ---------- FC-READ: where this timeline's network content came from ----------
//
// GET /api/feed2 and GET /api/feed answer `liveSource`: "relay" when the browser device reads real Farcaster casts
// through the public read relay, "seed" otherwise (every rig, and a deployment with no read key). The chip is the
// honest label for a relay timeline in every state — live, the stale shelf, and paused (kill switch, budget spent,
// relay not armed, or a failed read) — so seed content never passes for live and live never passes for seed.
// Copy stays clear of the page-health needle words (scripts/lib/page-health.mjs): a status line must never read as
// a broken page.
//
// FC-READ (review): "filtered" — the relay would serve this surface, but the active mode hides authors it cannot rate
// (an author.* hide rule; every network author is an unattributed stranger), so the seeded cards stand in. Before,
// such a mode blanked the timeline under a "live" chip. The same chip also renders on the thread and profile pages
// (ThreadIsland, ProfileIsland) when their content came through the relay — live or stale only there.
// NEYNAR AS A SWITCH (§42): "network" — the relay is armed but the operator keeps this surface on Farcaster's network
// (FC_SOURCE_FORYOU), so nothing was read through Neynar; it comes with source "seed" and the chip shows nothing
export type LiveSourceState = "live" | "stale" | "filtered" | "off" | "budget" | "unarmed" | "error" | "network";
export interface LiveSource {
  source: "relay" | "seed";
  state: LiveSourceState;
}

const LIVE_SOURCE_STATES: readonly LiveSourceState[] = ["live", "stale", "filtered", "off", "budget", "unarmed", "error", "network"];

/** the payload's liveSource, validated — an unknown state renders as paused, never as live */
export function readLiveSource(v: unknown): LiveSource | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { source?: unknown; state?: unknown };
  if (o.source !== "relay" && o.source !== "seed") return null;
  const state = LIVE_SOURCE_STATES.includes(o.state as LiveSourceState) ? (o.state as LiveSourceState) : "error";
  return { source: o.source, state };
}

// PUBLIC GO-LIVE: `live` = public live mode (no demo world), where there is no preview content to fall back on, so the
// paused and filtered states say so without promising preview posts. Flag off: the words are unchanged.
export function LiveSourceChip({ liveSource, live = false }: { liveSource?: LiveSource | null; live?: boolean }) {
  if (!liveSource || liveSource.source !== "relay") return null;
  const s = liveSource.state;
  // NEYNAR AS A SWITCH (§42): every relay timeline says where its posts came from ("Via Neynar", FC_SOURCE_LABELS)
  const text =
    s === "live"
      ? "Live from Farcaster · Via Neynar · read-only"
      : s === "stale"
        ? "Showing cached Farcaster posts · Via Neynar"
        : s === "filtered"
          ? live
            ? "This mode hides accounts it can't rate"
            : "This mode hides accounts it can't rate — showing preview posts"
          : live
            ? "Live Farcaster posts paused"
            : "Live Farcaster posts paused — showing preview content";
  const dot = s === "live" ? "bg-[#00ba7c]" : s === "stale" ? "bg-[#ffd400]" : "bg-[#8b98a5]";
  return (
    <div
      data-testid="live-source"
      data-source={liveSource.source}
      data-via="neynar"
      data-state={s}
      role="status"
      className="flex items-center gap-2 border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec"
    >
      <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
      {text}
    </div>
  );
}

interface UndoEntry {
  cards: FeedCard[];
  scrollY: number;
}

const undoKey = (modeId: string) => `layers:undo:${modeId}`;
const SCROLL_DISMISS_PX = 80;

function loadStack(modeId: string): UndoEntry[] {
  try {
    const raw = sessionStorage.getItem(undoKey(modeId));
    return raw ? (JSON.parse(raw) as UndoEntry[]) : [];
  } catch {
    return [];
  }
}
function saveStack(modeId: string, stack: UndoEntry[]): void {
  try {
    sessionStorage.setItem(undoKey(modeId), JSON.stringify(stack));
  } catch {
    /* private-browsing / quota — undo degrades to unavailable, not a crash */
  }
}

export function SeededTimeline({
  initialCards,
  mode,
  debunkedStories,
  debunkSources,
  surface,
  undoDepth = 3,
  initialContentStale = false,
  zones = null,
  initialLiveSource = null,
  emptyWorld = false,
}: {
  initialCards: FeedCard[];
  mode: ModeDefinition;
  debunkedStories: string[];
  debunkSources?: Record<string, string>;
  surface: "discovery" | "following";
  /** UX Gate 2: how many prior states the undo stack keeps, default 3 */
  undoDepth?: number;
  /** FC Gate 2: live content came from the stale cache shelf (rate-limit /
   * transport failure after backoff) — shown, never laundered as fresh */
  initialContentStale?: boolean;
  /** MEGA PASS 2 Gate 3: this device's scroll-zone layout (vault); null = default (the browser scrolls the timeline) */
  zones?: ZoneConfig | null;
  /** FC-READ: the feed payload's liveSource (absent on the rig's server render = seed, no chip) */
  initialLiveSource?: LiveSource | null;
  /** LAYERS_WORLD=empty (lib/world.ts): the demo world is hidden, so an empty timeline means nothing real yet */
  emptyWorld?: boolean;
}) {
  const router = useRouter();
  const { publicLive } = useApp();
  const [cards, setCards] = useState(initialCards);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stackSize, setStackSize] = useState(0);
  const [newBanner, setNewBanner] = useState<number | null>(null);
  const [contentStale, setContentStale] = useState(initialContentStale);
  const [liveSource, setLiveSource] = useState<LiveSource | null>(readLiveSource(initialLiveSource));
  const pendingScrollRestore = useRef<number | null>(null);

  // FC-READ: a new payload (tab switch, refetch after a write) carries its own liveSource; keyed on the VALUES so an
  // equal answer in a new object never resets anything
  useEffect(() => {
    setLiveSource(readLiveSource(initialLiveSource));
  }, [initialLiveSource?.source, initialLiveSource?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  // the composer's success toast names where a post went; it learns the feed's source from here
  useEffect(() => {
    noteFeedLiveSource(liveSource?.source ?? null);
  }, [liveSource?.source]);

  useEffect(() => {
    setCards(initialCards);
    setError(null);
    setNewBanner(null);
    setContentStale(initialContentStale);
    // a mode/persona SWITCH loads a DIFFERENT feed context entirely — sync
    // this feed's own stack size for the undo control, never touch the
    // stack itself here (only an explicit refresh pushes onto it)
    setStackSize(loadStack(mode.id).length);
  }, [initialCards, mode.id, initialContentStale]);

  useEffect(() => {
    if (pendingScrollRestore.current !== null) {
      window.scrollTo(0, pendingScrollRestore.current);
      pendingScrollRestore.current = null;
    }
  }, [cards]);

  const undo = useCallback(() => {
    const stack = loadStack(mode.id);
    const entry = stack.shift();
    if (!entry) return;
    saveStack(mode.id, stack);
    setStackSize(stack.length);
    setNewBanner(null);
    pendingScrollRestore.current = entry.scrollY;
    setCards(entry.cards);
  }, [mode.id]);

  // Ctrl-Z / Cmd-Z, ignored while typing anywhere text-editable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || (document.activeElement as HTMLElement)?.isContentEditable) return;
      if (loadStack(mode.id).length === 0) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode.id, undo]);

  // the banner is an offer, not a lock: scrolling away reads as "seen it,
  // moving on" and dismisses it — same "explicit rather than silent" spirit
  // without demanding an extra tap from someone who's already reading
  useEffect(() => {
    if (newBanner === null) return;
    const onScroll = () => {
      if (window.scrollY > SCROLL_DISMISS_PX) setNewBanner(null);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [newBanner]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const priorScrollY = window.scrollY;
      const priorCards = cards;
      const res = await fetch(`/api/feed2?surface=${surface}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "feed unavailable");
      const data = await res.json();
      const nextCards: FeedCard[] = data.cards;

      const stack = loadStack(mode.id);
      stack.unshift({ cards: priorCards, scrollY: priorScrollY });
      const trimmed = stack.slice(0, Math.max(1, undoDepth));
      saveStack(mode.id, trimmed);
      setStackSize(trimmed.length);

      const priorHashes = new Set(priorCards.map((c) => c.cast.hash));
      const freshCount = nextCards.filter((c) => !priorHashes.has(c.cast.hash)).length;

      setCards(nextCards);
      setContentStale(!!data.contentStale);
      setLiveSource(readLiveSource(data.liveSource));
      window.scrollTo(0, 0);
      setNewBanner(freshCount > 0 ? freshCount : null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [cards, surface, mode.id, undoDepth]);

  const markCaughtUp = useCallback(
    async (storyId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/feed-health/saturation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyId, modeId: mode.id }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "could not mark caught up");
        const r2 = await fetch(`/api/feed2?surface=${surface}`);
        if (r2.ok) setCards((await r2.json()).cards);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [mode.id, surface, router]
  );

  const debunked = new Set(debunkedStories);

  if (loading && cards.length === 0) return <TimelineSkeleton count={6} />;

  return (
    <ActionRowProvider value={{ modeId: mode.id, row: castRowFor(mode.actionButtonSlots), slots: mode.actionButtonSlots, zones }}>
    <ScrollZoneShell config={zones}>
    <div data-testid="seeded-timeline" data-mode={mode.name} data-mode-id={mode.id}>
      {/* Sticky, not just top-of-timeline: refreshing from deep in your
          scroll position is the whole point of preserving it. A control
          you'd have to scroll away from your place to reach would defeat
          its own feature. */}
      <div className="sticky top-[53px] z-10 flex items-center justify-between border-b border-x-border bg-white/85 px-4 py-2 backdrop-blur-md">
        <button
          data-testid="timeline-refresh"
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-[13px] font-bold text-x-sec hover:text-x-blue disabled:opacity-50"
        >
          <span className={refreshing ? "inline-block animate-spin" : "inline-block"}>↻</span>
          Refresh timeline
        </button>
        {stackSize > 0 && (
          <button
            data-testid="timeline-undo"
            data-stack-size={stackSize}
            onClick={undo}
            className="text-[13px] font-bold text-x-blue hover:underline"
          >
            Restore previous ({stackSize})
          </button>
        )}
      </div>

      <LiveSourceChip liveSource={liveSource} live={publicLive} />

      {contentStale && (
        <div
          data-testid="stale-content-banner"
          className="border-b border-x-border bg-[#fff8e6] px-4 py-2 text-[13px] leading-4 text-x-sec"
        >
          Live content unavailable — showing cached or fallback content instead. It will retry on
          the next refresh.
        </div>
      )}

      {newBanner !== null && (
        <div
          data-testid="new-posts-banner"
          data-count={newBanner}
          className="flex items-center justify-between border-b border-x-border bg-[#f7f9f9] px-4 py-2.5 text-[14px]"
        >
          <span>
            {newBanner} new post{newBanner === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-3">
            <button
              data-testid="new-posts-keep"
              onClick={() => setNewBanner(null)}
              className="font-bold text-x-sec hover:text-x-text"
            >
              Keep
            </button>
            <button data-testid="new-posts-undo" onClick={undo} className="font-bold text-x-blue">
              Undo
            </button>
          </span>
        </div>
      )}

      {error && (
        <div data-testid="feed-error" className="border-b border-x-border px-4 py-3">
          <p className="text-[15px] leading-5 text-[#f4212e]">Something went wrong. {error}</p>
          <button
            onClick={refresh}
            className="mt-2 h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold text-white hover:bg-x-blue-hover"
          >
            Retry
          </button>
        </div>
      )}
      {loading && <TimelineSkeleton count={2} />}
      {cards.map((card, i) => {
        const storyId = card.cast.storyId ?? null;
        return (
          <div key={card.cast.hash + i}>
            {storyId && debunked.has(storyId) && <DebunkIndicator source={debunkSources?.[storyId]} />}
            <FeedCardView
              card={card}
              storyId={card.kind === "post" ? storyId : null}
              onCaughtUp={markCaughtUp}
              relaySourced={liveSource?.source === "relay"}
            />
          </div>
        );
      })}
      {cards.length === 0 && !loading && (
        emptyWorld ? (
          <div data-testid="world-empty-feed" className="px-8 py-10 text-center">
            <p className="text-[20px] font-black leading-6">Nothing here yet</p>
            <p className="mt-1 text-[15px] leading-5 text-x-sec">
              This service shows only real content — live Farcaster casts when its content source is live, and what
              your own personas post. Nothing has arrived yet.
            </p>
          </div>
        ) : (
        <div className="px-8 py-10 text-center">
          <p className="text-[20px] font-black leading-6">Nothing here right now</p>
          <p className="mt-1 text-[15px] leading-5 text-x-sec">
            This mode&rsquo;s filters are hiding everything in the current feed. Try switching modes.
          </p>
        </div>
        )
      )}
      <div className="h-24" />
    </div>
    </ScrollZoneShell>
    </ActionRowProvider>
  );
}
