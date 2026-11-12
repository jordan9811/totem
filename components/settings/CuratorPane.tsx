"use client";
// Subscription management for curator annotation feeds. The action setting
// is per subscription and the default is the least invasive one: badge only.
import { useEffect, useState } from "react";

interface FeedRow {
  id: string;
  name: string;
  threshold: number;
  curators: string[];
  annotations: { id: string; claim: string; flagsAuthor: boolean }[];
  accuracy?: { concur: number; dispute: number; accuracy: number | null };
}
interface Sub {
  feedId: string;
  action: "badge" | "demote" | "autoblock";
}

export function CuratorPane() {
  const [feeds, setFeeds] = useState<FeedRow[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch("/api/curators", { cache: "no-store" });
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = await r.json();
        setFeeds(j.feeds);
        setSubs(j.subscriptions);
        setError(null);
        return;
      } catch (e) {
        if (i === 2) setError((e as Error).message);
      }
    }
  };
  useEffect(() => {
    load();
  }, []);

  async function update(feedId: string, subscribe: boolean, action?: string) {
    setBusy(feedId);
    try {
      const r = await fetch("/api/curators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedId, subscribe, action }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `status ${r.status}`);
      setSubs(j.subscriptions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="px-4 py-6 text-[15px] text-x-sec">Could not load curators ({error}).</p>;

  return (
    <div data-testid="curator-pane">
      <p className="px-4 pt-4 text-[15px] leading-5 text-x-sec">
        Subscribed feeds annotate posts in your timeline through the same
        correction surfaces community notes use, tagged with the curator&rsquo;s
        name. Annotations below a feed&rsquo;s signature threshold never render.
      </p>
      {feeds.map((f) => {
        const sub = subs.find((s) => s.feedId === f.id);
        return (
          <div key={f.id} data-testid="curator-feed" data-feed={f.id} className="border-b border-x-border px-4 py-4">
            <div className="flex items-center">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold leading-5 text-x-text">{f.name}</p>
                <p className="truncate text-[13px] leading-4 text-x-sec">
                  {f.curators.map((c) => "@" + c).join(", ")} · {f.threshold} signature
                  {f.threshold === 1 ? "" : "s"} required · {f.annotations.length} annotation
                  {f.annotations.length === 1 ? "" : "s"}
                  {f.accuracy && f.accuracy.accuracy !== null && (
                    <span data-testid="curator-accuracy">
                      {" "}· {f.accuracy.accuracy}% held ({f.accuracy.concur}/{f.accuracy.concur + f.accuracy.dispute} votes)
                    </span>
                  )}
                </p>
              </div>
              <button
                data-testid={`curator-sub-${f.id}`}
                data-subscribed={sub ? "true" : "false"}
                disabled={busy === f.id}
                onClick={() => update(f.id, !sub)}
                className={`h-8 shrink-0 rounded-full px-4 text-[14px] font-bold ${
                  sub ? "border border-[#cfd9de] text-x-text hover:bg-x-hover" : "bg-x-black-btn text-white"
                }`}
              >
                {sub ? "Unsubscribe" : "Subscribe"}
              </button>
            </div>
            {sub && (
              <div className="mt-3 flex gap-2">
                {(["badge", "demote", "autoblock"] as const).map((a) => (
                  <button
                    key={a}
                    data-testid={`curator-action-${a}`}
                    onClick={() => update(f.id, true, a)}
                    className={`h-8 rounded-full px-3 text-[13px] font-bold ${
                      sub.action === a ? "bg-x-black-btn text-white" : "border border-[#cfd9de] hover:bg-x-hover"
                    }`}
                  >
                    {a === "badge" ? "badge only" : a === "autoblock" ? "auto-block" : a}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
