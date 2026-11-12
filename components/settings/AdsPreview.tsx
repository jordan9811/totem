"use client";
// "What ads would I see" — the product's transparency argument. Live graph
// on the left, matching campaigns on the right, per-match explanation on
// every card. Toggling a claim recomputes immediately against the
// precomputed match index; no spinner, no full-page reload.
import { useCallback, useEffect, useState } from "react";
import type { GraphClaim } from "@/lib/adapters/types";

interface Match {
  campaignId: string;
  name: string;
  advertiser: string;
  reasons: string[];
}

export function AdsPreview() {
  const [claims, setClaims] = useState<GraphClaim[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [sensitiveIncluded, setSensitiveIncluded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/graph/preview");
      if (!res.ok) throw new Error((await res.json()).error ?? "preview unavailable");
      const data = await res.json();
      setClaims(data.claims);
      setMatches(data.matches);
      setSensitiveIncluded(data.sensitiveIncluded);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (claim: GraphClaim) => {
    setPending(claim.id);
    // Optimistic: drop the claim locally and recompute matches right away so
    // the causal link between a claim and its ads is immediately visible.
    setClaims((prev) => prev.filter((c) => c.id !== claim.id));
    setMatches((prev) => prev.filter((m) => !m.reasons.includes(claim.label.toLowerCase())));
    try {
      await fetch("/api/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", claimId: claim.id, active: false }),
      });
      await load();
    } finally {
      setPending(null);
    }
  };

  if (!loaded) return <p className="px-4 py-6 text-[15px] text-x-sec">Computing your matches…</p>;
  if (error && claims.length === 0)
    return (
      <p data-testid="preview-error" className="px-4 py-6 text-[15px] text-x-sec">
        Couldn&rsquo;t compute matches. {error}
      </p>
    );

  return (
    <div data-testid="ads-preview" className="grid grid-cols-1 gap-px bg-x-border sm:grid-cols-2">
      {/* left: the live graph */}
      <section className="bg-white p-4">
        <h3 className="text-[17px] font-black leading-6">Your graph</h3>
        <p className="mt-1 text-[13px] leading-4 text-x-sec">
          {claims.length} active claims. Turn one off to see what stops matching.
        </p>
        {!sensitiveIncluded && (
          <p
            data-testid="sensitive-excluded-notice"
            className="mt-3 rounded-xl border border-[#f4212e33] px-3 py-2 text-[13px] leading-4 text-x-sec"
          >
            Sensitive claims couldn&rsquo;t be confirmed, so they&rsquo;re excluded from matching.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {claims.map((c) => (
            <button
              key={c.id}
              data-testid="preview-claim"
              data-value={c.value}
              data-source={c.source}
              disabled={pending === c.id}
              onClick={() => toggle(c)}
              className="group flex h-8 items-center rounded-full border border-x-blue bg-[#1d9bf01a] px-3 text-[14px] font-bold text-x-blue disabled:opacity-50"
            >
              {c.source === "attested" && (
                <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" className="mr-1">
                  <path d="M12 1.75l2.6 1.9 3.2-.1 1 3.05 2.6 1.85-1 3.05 1 3.05-2.6 1.85-1 3.05-3.2-.1-2.6 1.9-2.6-1.9-3.2.1-1-3.05L2.2 14.5l1-3.05-1-3.05 2.6-1.85 1-3.05 3.2.1 2.6-1.9zm-1.3 12.6l5-5-1.4-1.4-3.6 3.6-1.6-1.6-1.4 1.4 3 3z" />
                </svg>
              )}
              {c.label}
              <span className="ml-1.5 text-x-sec group-hover:text-x-text">×</span>
            </button>
          ))}
        </div>
      </section>

      {/* right: what currently matches, and why */}
      <section className="bg-white p-4">
        <h3 className="text-[17px] font-black leading-6">Ads you&rsquo;d see</h3>
        <p className="mt-1 text-[13px] leading-4 text-x-sec">
          {matches.length} campaigns match right now.
        </p>
        <div className="mt-3" data-testid="match-list">
          {matches.length === 0 && (
            <p className="rounded-2xl border border-x-border p-4 text-[15px] leading-5 text-x-sec">
              Nothing matches your graph. No advertiser can reach you right now.
            </p>
          )}
          {matches.map((m) => (
            <div
              key={m.campaignId}
              data-testid="match-card"
              data-campaign={m.campaignId}
              className="mb-3 rounded-2xl border border-x-border p-3"
            >
              <p className="text-[15px] font-bold leading-5">{m.name}</p>
              <p className="mt-0.5 text-[13px] leading-4 text-x-sec">from @{m.advertiser}</p>
              <p
                data-testid="match-reason"
                className="mt-2 rounded-lg bg-[#f7f9f9] px-2 py-1.5 text-[13px] leading-4 text-x-sec"
              >
                matched: {m.reasons.join(" + ")}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
