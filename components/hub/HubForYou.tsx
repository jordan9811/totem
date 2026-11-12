"use client";
// FOR YOU FROM THE HUB (SPEC B) — the For You tab for a visitor signed in with Farcaster on the live site, while they act
// as themselves: posts the people their own Farcaster account follows liked or recast lately, and recent posts from
// accounts several of them follow, read by THIS TAB straight from a Farcaster node (lib/fc/hubRead/forYou.ts; no Neynar,
// nothing through Totem's servers), ordered by their active mode.
//
// PROGRESSIVE: the device answers a snapshot of what is in and keeps reading; while it says `loading` this island asks
// again. Posts already shown keep their place on screen; new ones slot in by the mode's order.
// SAYS WHAT IS COVERED: "From 40 people you follow who liked a post in the last 3 days, and 30 accounts several of them
// follow." Each card says why it is here ("Liked by Alice and 2 others you follow", "Followed by 9 people you follow"):
// counts of the people you follow, never a network total.
// NEVER FAIL OPEN: a read that failed is an error with Retry, never an empty feed; reads that failed beside ones that
// worked are counted; the empty states only after reads that all worked.
// YOUR MODE: the same mode line as Following (components/hub/HubFollowing.tsx ModeLine), and what the follow-based
// counts mean here. A mode switch asks the device again at once: the same posts, read once, in the new mode's order.
import { useCallback, useEffect, useRef, useState } from "react";
import type { HubForYouView } from "@/lib/fc/hubRead/copy";
import { FOR_YOU_SOURCE_LINE, FOR_YOU_WHO_SEES, FOLLOWS_STALE_SENTENCE, forYouProgressSentence } from "@/lib/fc/hubRead/copy";
import { CastCard } from "@/components/CastCard";
import { PreviewStrip } from "@/components/PreviewStrip";
import { TimelineSkeleton } from "@/components/Skeletons";
import { useApp } from "@/components/Providers";
import { ROOT_CAST_EVENT, hubCall } from "./hubCall";
import { ModeLine } from "./HubFollowing";

const PAGE = 50;
const MAX = 200;

export function HubForYou() {
  const [view, setView] = useState<HubForYouView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const want = useRef(PAGE);
  const seq = useRef(0);
  const alive = useRef(true);
  const timer = useRef<number | undefined>(undefined);

  const ask = useCallback(async (opts: { refresh?: "auto" | "manual"; retry?: boolean; waitMs?: number } = {}) => {
    const my = ++seq.current;
    window.clearTimeout(timer.current);
    const r = await hubCall<HubForYouView>({ op: "foryou", want: want.current, waitMs: opts.waitMs ?? 1500, refresh: opts.refresh, retry: opts.retry === true });
    if (!alive.current || my !== seq.current) return; // an answer to an older question never lands over a newer one
    if (!r.ok) {
      // the failure REPLACES what was shown: never older posts under an error nobody sees
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
    const onFocus = () => void ask({ refresh: "auto", waitMs: 300 });
    const onRootCast = () => void ask({ waitMs: 600 });
    const every = window.setInterval(() => {
      if (document.visibilityState === "visible") void ask({ refresh: "auto", waitMs: 300 });
    }, 120_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener(ROOT_CAST_EVENT, onRootCast);
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
      window.clearInterval(every);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(ROOT_CAST_EVENT, onRootCast);
    };
  }, [ask]);

  const retryButton = (testid: string) => (
    <button type="button" data-testid={testid} onClick={() => void ask({ retry: true })} className="ml-2 font-bold text-x-blue hover:underline">
      Retry
    </button>
  );
  const errorBlock = (code: string, reason: string | null) => (
    <div data-testid="hub-foryou-error" data-code={code} role="alert" className="border-b border-x-border px-4 py-6">
      <p className="text-[17px] font-bold leading-6">Couldn&rsquo;t read For You</p>
      <p className="mt-1 text-[15px] leading-5 text-x-sec">{reason}</p>
      <button type="button" data-testid="hub-foryou-retry" onClick={() => void ask({ retry: true })} className="mt-3 inline-flex h-9 items-center rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover">
        Retry
      </button>
    </div>
  );

  if (failure) return errorBlock("device", failure);
  if (!view) {
    return (
      <div data-testid="hub-foryou-loading" aria-busy="true">
        <TimelineSkeleton count={6} />
      </div>
    );
  }
  if (view.state === "not_signed_in") {
    return (
      <div data-testid="hub-foryou-signed-out" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
        {view.reason}
      </div>
    );
  }
  if (view.state === "error") return errorBlock(view.code ?? "", view.reason);

  const mode = view.mode ?? null;
  const modeFailed = mode?.state === "error";
  const pinned = new Set(mode?.pinned ?? []);
  const quiet = new Set(mode?.quiet ?? []);
  const filling = view.loading && (view.progress.probing || view.progress.sampled < view.progress.of);
  return (
    <div data-testid="hub-foryou" data-state={view.state} data-count={view.items.length}>
      <div data-testid="hub-foryou-status" role="status" data-state={view.loading ? "loading" : "ready"} className="flex flex-wrap items-center gap-x-2 border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec">
        {/* NEYNAR AS A SWITCH (§42): the feed's source, machine-readable too (the root's own For You never reads Neynar) */}
        <span data-testid="feed-source" data-source="network">{FOR_YOU_SOURCE_LINE}</span>
        {view.coverage.sentence ? (
          <span data-testid="hub-foryou-coverage" data-active={view.coverage.active} data-accounts={view.coverage.accounts} data-probed={view.coverage.probed} className="font-bold text-x-text">
            {view.coverage.sentence}
          </span>
        ) : null}
        {filling ? (
          <span data-testid="hub-foryou-progress" data-probing={view.progress.probing ? "true" : "false"} data-sampled={view.progress.sampled} data-of={view.progress.of}>
            {forYouProgressSentence(view.progress.sampled, view.progress.of, view.progress.probing)}
          </span>
        ) : null}
        <button type="button" data-testid="hub-foryou-refresh" onClick={() => void ask({ refresh: "manual", waitMs: 1500 })} className="ml-auto font-bold text-x-blue hover:underline">
          Check for new posts
        </button>
      </div>
      {view.paused ? (
        <p data-testid="hub-foryou-paused" role="status" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec">
          {view.paused.sentence}
        </p>
      ) : null}
      {view.follows.stale ? (
        <p data-testid="hub-foryou-stale-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
          {FOLLOWS_STALE_SENTENCE}
          {retryButton("hub-foryou-stale-retry")}
        </p>
      ) : null}
      {view.partial ? (
        <p data-testid="hub-foryou-partial-error" data-failed={view.partial.failed} role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
          {view.partial.sentence}
          {retryButton("hub-foryou-partial-retry")}
        </p>
      ) : null}
      {view.profilesFailed ? (
        <p data-testid="hub-foryou-profiles-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
          {view.profilesFailed.sentence}
          {retryButton("hub-foryou-profiles-retry")}
        </p>
      ) : null}
      {mode && !modeFailed ? <ModeLine mode={mode} /> : null}
      {mode && !modeFailed && view.signals ? (
        <p data-testid="hub-foryou-signals" className="border-b border-x-border px-4 py-2 text-[12px] leading-4 text-x-sec">
          {view.signals}
        </p>
      ) : null}
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
      {view.empty ? (
        <div data-testid="hub-foryou-empty" data-kind={view.empty.kind} className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
          {view.empty.sentence}
        </div>
      ) : mode && mode.hidAll ? (
        // the mode hid every post: said as that, never as an empty For You
        <div data-testid="hub-mode-hid-all" data-of={mode.of} className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
          <p className="font-bold text-x-text">{mode.sentence}</p>
          <p className="mt-1">Switch modes from the pill at the top, or change what this mode hides in Settings.</p>
        </div>
      ) : null}
      <div data-testid="hub-foryou-timeline" data-count={view.items.length}>
        {view.items.map((c) => {
          const p = view.proof[c.hash];
          return (
            <div key={c.hash} data-hub-item={c.hash} data-pinned={pinned.has(c.hash) ? "true" : undefined} data-quiet={quiet.has(c.hash) ? "true" : undefined}>
              {pinned.has(c.hash) ? (
                <p data-testid="hub-pinned-label" className="px-4 pt-2 text-[13px] font-bold leading-4 text-x-sec">
                  Never miss
                </p>
              ) : null}
              {p ? (
                <p data-testid="hub-foryou-proof" data-likes={p.likes} data-recasts={p.recasts} data-followed-by={p.followedBy} className="px-4 pt-2 text-[13px] leading-4 text-x-sec">
                  {p.sentence}
                </p>
              ) : null}
              <CastCard cast={c} />
            </div>
          );
        })}
      </div>
      {view.loading && view.items.length === 0 && !modeFailed && !mode?.hidAll ? <TimelineSkeleton count={3} /> : null}
      {view.more && want.current < MAX ? (
        <button
          type="button"
          data-testid="hub-foryou-more"
          onClick={() => {
            want.current = Math.min(MAX, want.current + PAGE);
            void ask({ waitMs: 600 });
          }}
          className="block w-full border-b border-x-border px-4 py-4 text-left text-[15px] text-x-blue hover:bg-x-hover"
        >
          Show more
        </button>
      ) : null}
      <p data-testid="hub-foryou-who-sees" className="px-4 py-3 text-[12px] leading-4 text-x-sec">
        {FOR_YOU_WHO_SEES}
      </p>
    </div>
  );
}
