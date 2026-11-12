"use client";
// UX GATE 4 — THE MONEY SHOT: Ad Match Score + transparent breakdown +
// suggestion list. Every number here is read straight from
// /api/graph/score, which itself reads the SAME claimsForMatching() set
// the ad marketplace matches against — nothing here is a separate,
// possibly-inconsistent estimate.
import { useCallback, useEffect, useState } from "react";
import type { ClaimCategory, GraphClaim } from "@/lib/adapters/types";

interface ScoreFactor {
  claimId: string;
  category: ClaimCategory;
  label: string;
  source: GraphClaim["source"];
  points: number;
}
interface ScoreSuggestion {
  connectorId: string;
  label: string;
  delta: number;
}

const SOURCE_LABEL: Record<GraphClaim["source"], string> = {
  self: "self-declared",
  "x-inferred": "platform-inferred",
  attested: "attested",
};
const SOURCE_COLOR: Record<GraphClaim["source"], string> = {
  self: "text-x-sec",
  "x-inferred": "text-[#b7791f]",
  attested: "text-[#00ba7c]",
};

export function BackpackScore({ refreshKey = 0 }: { refreshKey?: number }) {
  const [score, setScore] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<ScoreFactor[]>([]);
  const [suggestions, setSuggestions] = useState<ScoreSuggestion[]>([]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/graph/score", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error ?? "score unavailable");
      const j = await res.json();
      setScore(j.score);
      setBreakdown(j.breakdown ?? []);
      setSuggestions(j.suggestions ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const sum = breakdown.reduce((a, f) => a + f.points, 0);

  return (
    <div data-testid="backpack-score" className="border-b border-x-border px-4 py-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[20px] font-black leading-6">Ad Match Score</h2>
          <p className="mt-1 max-w-md text-[13px] leading-4 text-x-sec" data-testid="score-honesty-copy">
            This is an ad-targeting-value score, not a trustworthiness or personal-attractiveness
            score. A higher number means more — and better-priced — ad inventory gets pointed at
            you. Every input counted here is something you chose to share; nothing sensitive counts
            unless you opted it in.
          </p>
        </div>
        <div data-testid="score-value" className="shrink-0 text-[40px] font-black leading-none">
          {score ?? "–"}
          <span className="text-[16px] font-bold text-x-sec">/100</span>
        </div>
      </div>

      {error && <p className="mt-2 text-[13px] text-[#f4212e]">{error}</p>}

      <button
        data-testid="score-breakdown-toggle"
        onClick={() => setShowBreakdown((v) => !v)}
        className="mt-3 text-[13px] font-bold text-x-blue hover:underline"
      >
        {showBreakdown ? "Hide" : "Show"} breakdown ({breakdown.length} factor{breakdown.length === 1 ? "" : "s"})
      </button>

      {showBreakdown && (
        <div data-testid="score-breakdown" className="mt-2 rounded-2xl border border-x-border">
          {breakdown.map((f) => (
            <div
              key={f.claimId}
              data-testid="score-factor"
              data-points={f.points}
              data-source={f.source}
              className="flex items-center justify-between border-b border-x-border px-3 py-2 text-[13px] last:border-b-0"
            >
              <span className="min-w-0 truncate">
                {f.label}{" "}
                <span className={`font-bold ${SOURCE_COLOR[f.source]}`}>· {SOURCE_LABEL[f.source]}</span>
              </span>
              <span className="shrink-0 font-bold">+{f.points}</span>
            </div>
          ))}
          {breakdown.length === 0 && (
            <p className="px-3 py-3 text-[13px] text-x-sec">No counted claims yet.</p>
          )}
          <div
            data-testid="score-breakdown-sum"
            data-sum={sum}
            className="flex items-center justify-between px-3 py-2 text-[13px] font-bold"
          >
            <span>Sum of factors</span>
            <span>{sum}{sum > 100 ? ` (capped at 100)` : ""}</span>
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="mt-3">
          <p className="text-[13px] font-bold text-x-sec">Suggestions</p>
          <div data-testid="score-suggestions" className="mt-1 space-y-1.5">
            {suggestions.map((s) => (
              <p key={s.connectorId} data-testid="score-suggestion" data-delta={s.delta} className="text-[13px]">
                {s.label}: <span className="font-bold text-[#00ba7c]">+{s.delta}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
