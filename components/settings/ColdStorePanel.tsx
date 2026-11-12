"use client";
// UX GATE 3 — designate a cold source (X bookmark folder / DM thread) to
// resolve into the readwise populator. Cold ids are retained but never
// auto-resolved; a count stays visible so "1,240 in cold storage, 40
// resolved" is always an honest, exact number, not an estimate.
import { useCallback, useEffect, useState } from "react";

interface ColdSource {
  id: string;
  kind: "bookmarkFolder" | "dmThread";
  label: string;
  totalCount: number;
  resolvedCount: number;
  coldCount: number;
}

export function ColdStorePanel() {
  const [sources, setSources] = useState<ColdSource[]>([]);
  const [summary, setSummary] = useState({ totalCold: 0, totalResolved: 0 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [prompts, setPrompts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const j = await fetch("/api/x/coldstore", { cache: "no-store" }).then((r) => r.json());
      setSources(j.sources ?? []);
      setSummary(j.summary ?? { totalCold: 0, totalResolved: 0 });
    } catch {
      /* panel stays quiet; retrying the resolve button re-fetches anyway */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resolve = async (sourceId: string) => {
    setBusyId(sourceId);
    setMessages((m) => ({ ...m, [sourceId]: "" }));
    setPrompts((p) => ({ ...p, [sourceId]: "" }));
    try {
      const res = await fetch("/api/x/coldstore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", sourceId }),
      });
      const j = await res.json();
      if (res.status === 402) {
        setPrompts((p) => ({ ...p, [sourceId]: j.error }));
        return;
      }
      if (!res.ok) {
        setMessages((m) => ({ ...m, [sourceId]: j.error ?? "resolve failed" }));
        return;
      }
      setMessages((m) => ({
        ...m,
        [sourceId]:
          j.resolved > 0
            ? `Resolved ${j.resolved}. $${j.cost.toFixed(3)} spent (fixture).`
            : `Already resolved (${j.alreadyResolved}) — nothing new, nothing charged.`,
      }));
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  return (
    <div data-testid="coldstore-panel" className="border-t border-x-border px-4 py-4">
      <h3 className="text-[17px] font-extrabold">Cold storage</h3>
      <p className="mt-0.5 text-[15px] text-x-sec" data-testid="coldstore-summary">
        <span className="font-bold text-x-text">{summary.totalCold.toLocaleString()}</span> ids in cold
        storage · <span className="font-bold text-x-text">{summary.totalResolved.toLocaleString()}</span>{" "}
        resolved
      </p>
      <p className="mt-1 text-[13px] text-x-sec">
        Cold ids are kept for later (agent/library use) but never auto-resolved. Designating a source
        below pays one owned-read per id, through the spend ledger, and flows resolved items into your
        readwise queue as shortform.
      </p>

      <div className="mt-3 divide-y divide-x-border">
        {sources.map((s) => (
          <div key={s.id} data-testid={`coldsource-${s.id}`} className="flex items-center justify-between py-2.5">
            <div>
              <p className="text-[15px] font-bold">
                {s.label}{" "}
                <span className="font-normal text-x-sec">
                  · {s.kind === "dmThread" ? "DM thread" : "bookmark folder"}
                </span>
              </p>
              <p className="text-[13px] text-x-sec" data-testid={`coldsource-counts-${s.id}`}>
                <span data-testid={`coldsource-cold-${s.id}`}>{s.coldCount.toLocaleString()}</span> cold ·{" "}
                <span data-testid={`coldsource-resolved-${s.id}`}>{s.resolvedCount.toLocaleString()}</span>{" "}
                resolved
              </p>
              {messages[s.id] && (
                <p className="mt-0.5 text-[13px] font-bold text-[#00ba7c]" data-testid={`coldsource-result-${s.id}`}>
                  {messages[s.id]}
                </p>
              )}
              {prompts[s.id] && (
                <p
                  className="mt-0.5 max-w-sm text-[13px] font-bold text-[#f4212e]"
                  data-testid={`coldsource-cap-prompt-${s.id}`}
                >
                  {prompts[s.id]}
                </p>
              )}
            </div>
            <button
              data-testid={`coldsource-resolve-${s.id}`}
              disabled={busyId === s.id || s.coldCount === 0}
              onClick={() => resolve(s.id)}
              className="h-8 shrink-0 rounded-full bg-x-black-btn px-3.5 text-[13px] font-bold text-white disabled:opacity-50"
            >
              {s.coldCount === 0 ? "Fully resolved" : busyId === s.id ? "Resolving…" : "Resolve"}
            </button>
          </div>
        ))}
        {sources.length === 0 && (
          <p className="py-2.5 text-[15px] text-x-sec" data-testid="coldstore-empty">
            No cold sources yet.
          </p>
        )}
      </div>
    </div>
  );
}
