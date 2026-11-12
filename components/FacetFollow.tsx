"use client";
// Layered following: on a profile whose root posts across multiple topics,
// follow one facet instead of the whole account. The feed then only shows
// that root's posts in the followed clusters.
//
// PROD-LIVE (D-CU-0-4): the facet read is re-run on the chrome's refresh signal (a persona switch, a write) — which
// facets are followed is the ACTING persona's answer — and a write re-reads the page with useApp().refresh(), which
// on a public deployment is what refetches the device-answered profile island. A failed facet read is shown with a
// Retry: it used to collapse to "this account has fewer than two topics" and render nothing (never fail open).
import { useCallback, useEffect, useState } from "react";
import type { Facet } from "@/lib/adapters/types";
import { useApp } from "@/components/Providers";

export function FacetFollow({ personaId }: { personaId: string }) {
  const { refresh, refreshTick } = useApp();
  const [facets, setFacets] = useState<Facet[] | null>(null);
  const [followed, setFollowed] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/disclosure/facets?personaId=${encodeURIComponent(personaId)}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "could not load facets");
      const data = await res.json();
      setFacets(data.facets);
      setFollowed(data.followed);
      setLoadFailed(false);
    } catch (e) {
      setError((e as Error).message);
      setLoadFailed(true);
      setFacets([]);
    }
  }, [personaId]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  async function toggle(facetId: string, follow: boolean) {
    setBusy(facetId);
    setError(null);
    try {
      const res = await fetch("/api/disclosure/facets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facetId, follow }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "request failed");
      setFollowed((await res.json()).followed);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (facets === null) {
    return (
      <div data-testid="facets-loading" className="border-b border-x-border px-4 py-3">
        <div className="skeleton h-3.5 w-48 rounded-full" />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div data-testid="facets-error" className="border-b border-x-border px-4 py-3 text-[13px] text-x-sec">
        Couldn&rsquo;t read this account&rsquo;s topics{error ? ` (${error})` : ""}.
        <button type="button" onClick={() => void load()} className="ml-2 font-bold text-x-blue hover:underline">
          Retry
        </button>
      </div>
    );
  }

  // Only meaningful when the root actually spans more than one topic.
  if (facets.length < 2) return null;

  return (
    <div data-testid="facet-follow" className="border-b border-x-border px-4 py-3">
      <p className="text-[15px] font-bold leading-5">Follow just part of this account</p>
      <p className="mt-0.5 text-[13px] leading-4 text-x-sec">
        This account posts across {facets.length} topics. Follow only the ones you want in your timeline.
      </p>
      {error && <p className="mt-2 text-[13px] text-[#f4212e]">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {facets.map((facet) => {
          const on = followed.includes(facet.id);
          return (
            <button
              key={facet.id}
              data-testid={`facet-${facet.cluster}`}
              data-followed={on}
              onClick={() => toggle(facet.id, !on)}
              disabled={busy !== null}
              className={`h-8 rounded-full px-3 text-[13px] font-bold transition-colors disabled:opacity-50 ${
                on ? "bg-x-black-btn text-white hover:bg-x-black-btn-hover" : "border border-[#cfd9de] hover:bg-x-hover"
              }`}
            >
              {busy === facet.id ? "…" : on ? `Following ${facet.cluster}` : `Follow ${facet.cluster}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
