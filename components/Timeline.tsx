"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Cast } from "@/lib/types";
import { CastCard } from "./CastCard";
import { TimelineSkeleton } from "./Skeletons";

export function Timeline({
  initialCasts,
  tab,
  nextPage: initialNext,
}: {
  initialCasts: Cast[];
  tab: string;
  nextPage: number | null;
}) {
  const router = useRouter();
  const [casts, setCasts] = useState(initialCasts);
  const [nextPage, setNextPage] = useState(initialNext);
  const [loading, setLoading] = useState(false);
  // PROD-LIVE (D-CU-0-4): the next page is read from /api/feed, which on a public deployment the browser device
  // answers. A failed page is an error with a Retry, never a crash in the state updater and never a silent end of
  // the feed (the old code spread `data.casts` from an error body straight into the list).
  const [pageError, setPageError] = useState<string | null>(null);
  const [selected, setSelected] = useState(-1);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    setCasts(initialCasts);
    setNextPage(initialNext);
    setPageError(null);
    setSelected(-1);
  }, [initialCasts, initialNext, tab]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || nextPage === null) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/feed?tab=${tab}&page=${nextPage}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !Array.isArray(data.casts)) {
        throw new Error((data && typeof data.error === "string" && data.error) || `HTTP ${res.status}`);
      }
      setPageError(null);
      setCasts((prev) => [...prev, ...data.casts]);
      setNextPage(data.nextPage);
    } catch (e) {
      setPageError((e as Error).message || "could not load more");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [nextPage, tab]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || pageError) return; // a failed page waits for its Retry, not a retry storm from the observer
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "600px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore, pageError]);

  // j/k keyboard navigation, Enter to open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "TEXTAREA" ||
        target.tagName === "INPUT" ||
        target.isContentEditable ||
        e.metaKey ||
        e.ctrlKey
      )
        return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setSelected((prev) => {
          const next =
            e.key === "j" ? Math.min(prev + 1, casts.length - 1) : Math.max(prev - 1, 0);
          const el = document.querySelectorAll("[data-testid='cast']")[next];
          el?.scrollIntoView({ block: "center", behavior: "auto" });
          return next;
        });
      } else if (e.key === "Enter" && selected >= 0) {
        const cast = casts[selected];
        if (cast) router.push(`/${cast.author.username}/status/${cast.hash}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [casts, selected, router]);

  return (
    <div data-testid="timeline">
      {casts.map((cast, i) => (
        <CastCard key={cast.hash + i} cast={cast} selected={i === selected} />
      ))}
      {loading && <TimelineSkeleton />}
      {pageError && !loading ? (
        <div data-testid="timeline-page-error" className="border-b border-x-border px-4 py-3">
          <p className="text-[15px] leading-5 text-[#f4212e]">Couldn&rsquo;t load more posts. {pageError}</p>
          <button
            type="button"
            onClick={() => {
              setPageError(null);
              void loadMore();
            }}
            className="mt-2 h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold text-white hover:bg-x-blue-hover"
          >
            Retry
          </button>
        </div>
      ) : null}
      <div ref={sentinel} className="h-1" />
      {nextPage === null && <div className="h-24" />}
    </div>
  );
}
