"use client";
// PROD-LIVE PASS (D-CU-0-4) — Explore's discovery timeline, as a client island.
//
// The discovery surface is policy-filtered for the VIEWER: tier-1 personas drop out except the viewer's own, the
// viewer's (and their siblings') blocks apply, and the persona layer (attribution, a granted viewer's merge) is the
// acting persona's. A public deployment's server holds none of that, so there this island fetches
// /api/feed?tab=foryou&page=0 — the same getFeed + applyFeedPolicy the page ran — and the browser device answers it.
// On the rig the server computes the page exactly as before and hands it in as `initial`; Timeline pages further with
// /api/feed as it always did.
import { useApiJson } from "@/lib/client/useApiJson";
import { useApp } from "@/components/Providers";
import type { Cast } from "@/lib/types";
import { Timeline } from "@/components/Timeline";
import { TimelineSkeleton } from "@/components/Skeletons";
import { LiveSourceChip, readLiveSource } from "@/components/SeededTimeline";
import { noteFeedLiveSource } from "@/components/Composer";
import { useEffect } from "react";

export interface ExploreFeed {
  casts: Cast[];
  nextPage: number | null;
}

export function ExploreFeedIsland({ initial }: { initial: ExploreFeed | null }) {
  const { deviceIsThePage, refresh, publicLive } = useApp();
  const feed = useApiJson<ExploreFeed>("/api/feed?tab=foryou&page=0", { initial });
  const retry = deviceIsThePage ? feed.reload : refresh;
  // FC-READ: Explore reads the same "discovery" relay op as home For You, so it carries the same honest label
  const liveSource = readLiveSource((feed.data as { liveSource?: unknown } | null)?.liveSource);
  const liveKey = liveSource?.source ?? null;
  useEffect(() => {
    noteFeedLiveSource(liveKey);
  }, [liveKey]);

  // PROD-LIVE (review fix): error before data — a failed re-read never leaves the previous feed drawn as current
  if (feed.error || !feed.data) {
    if (feed.error) {
      return (
        <p data-testid="explore-feed-error" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
          Couldn&rsquo;t load posts right now ({feed.error}).
          <button type="button" data-testid="explore-feed-retry" onClick={retry} className="ml-2 font-bold text-x-blue hover:underline">
            Retry
          </button>
        </p>
      );
    }
    return <TimelineSkeleton />;
  }
  return (
    <>
      <LiveSourceChip liveSource={liveSource} live={publicLive} />
      <Timeline initialCasts={feed.data.casts} tab="foryou" nextPage={feed.data.nextPage} />
    </>
  );
}
