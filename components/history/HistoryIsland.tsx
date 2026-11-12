"use client";
// PROD-LIVE PASS (D-CU-0-4) — the history shelf's cast list, as a client island.
//
// The list itself is fixture data, but the persona layer over it is not: shared-FID attribution and a granted
// viewer's merged identity are decided for the ACTING persona, which a public deployment's server does not hold (it
// would have rendered the fixture viewer's view). So on a public deployment this island fetches /api/history and the
// browser device answers it; on the rig the server computes the same list as before and hands it in as `initial`.
import { useApiJson } from "@/lib/client/useApiJson";
import { useApp } from "@/components/Providers";
import type { HistoryShelfView } from "@/lib/views/social";
import { CastCard } from "@/components/CastCard";
import { TimelineSkeleton } from "@/components/Skeletons";

export function HistoryIsland({ initial }: { initial: HistoryShelfView | null }) {
  const { deviceIsThePage, refresh } = useApp();
  const shelf = useApiJson<HistoryShelfView>("/api/history", { initial });
  const retry = deviceIsThePage ? shelf.reload : refresh;

  // PROD-LIVE (review fix): error before data — a failed re-read never leaves the previous shelf drawn as current
  if (shelf.error || !shelf.data) {
    if (shelf.error) {
      return (
        <p data-testid="history-shelf-error" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
          Couldn&rsquo;t load your history right now ({shelf.error}).
          <button type="button" data-testid="history-shelf-retry" onClick={retry} className="ml-2 font-bold text-x-blue hover:underline">
            Retry
          </button>
        </p>
      );
    }
    return <TimelineSkeleton count={4} />;
  }
  return (
    <>
      {shelf.data.casts.map((cast) => (
        <CastCard key={cast.hash} cast={cast} />
      ))}
    </>
  );
}
