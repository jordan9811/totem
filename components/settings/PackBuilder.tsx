"use client";
// THE PACK BUILDER — compose a shareable filter pack from primitives that
// already exist: your rules, claim predicates over the audience index, and
// curator desks whose flag actions ride along. Nothing here can mint a new
// capability; the export runs through the same sanitizer imports face.
import { useEffect, useState } from "react";

const CLAIMS = [
  "longform_reader",
  "market_structure",
  "espresso",
  "telescope",
  "astronomy",
  "fantasy_football",
  "watches_sports",
  "coffee_weekly",
  "ramen",
  "military_history",
];

interface RuleRow {
  id: string;
  name: string;
}
interface FeedRow {
  id: string;
  name: string;
}
interface Pred {
  claim: string;
  mode: "holding" | "lacking";
}

export function PackBuilder() {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [feeds, setFeeds] = useState<FeedRow[]>([]);
  const [ruleIds, setRuleIds] = useState<string[]>([]);
  const [preds, setPreds] = useState<Pred[]>([]);
  const [subs, setSubs] = useState<string[]>([]);
  const [artifact, setArtifact] = useState<unknown | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setRules((j.rules ?? []).map((r: RuleRow) => ({ id: r.id, name: r.name }))))
      .catch(() => {});
    fetch("/api/curators", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setFeeds((j.feeds ?? []).map((f: FeedRow) => ({ id: f.id, name: f.name }))))
      .catch(() => {});
  }, []);

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  async function doExport() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/packs/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          summary,
          ruleIds,
          attestationPredicates: preds,
          curatorSubscriptions: subs.map((feedId) => ({ feedId, action: "badge" })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `status ${r.status}`);
      setArtifact(j.artifact);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!artifact) return;
    setBusy(true);
    try {
      const r = await fetch("/api/algo/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact, activate: false }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `status ${r.status}`);
      setImported(j.pack?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="pack-builder" className="px-4 py-4">
      <p className="text-[15px] leading-5 text-x-sec">
        A pack bundles rules, claim predicates and curator desks into one
        signed, shareable artifact. Receivers get the same mandatory preview
        and guardrails as algorithm imports — and packs are off until
        attached to a mode.
      </p>

      <label className="mt-4 block">
        <span className="text-[13px] font-bold text-x-sec">Name</span>
        <input
          data-testid="pack-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-xl border border-x-border bg-transparent px-3 py-2 text-[15px] outline-none focus:border-x-blue"
        />
      </label>
      <label className="mt-3 block">
        <span className="text-[13px] font-bold text-x-sec">One-line summary</span>
        <input
          data-testid="pack-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="mt-1 w-full rounded-xl border border-x-border bg-transparent px-3 py-2 text-[15px] outline-none focus:border-x-blue"
        />
      </label>

      <h3 className="mt-5 text-[15px] font-extrabold text-x-text">Claim predicates</h3>
      <p className="text-[13px] leading-4 text-x-sec">
        Hide accounts holding — or lacking — a claim from the audience index.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {CLAIMS.map((c) => {
          const current = preds.find((p) => p.claim === c);
          return (
            <button
              key={c}
              data-testid={`pred-${c}`}
              data-mode={current?.mode ?? "off"}
              onClick={() =>
                setPreds((prev) => {
                  const cur = prev.find((p) => p.claim === c);
                  if (!cur) return [...prev, { claim: c, mode: "lacking" }];
                  if (cur.mode === "lacking")
                    return prev.map((p) => (p.claim === c ? { ...p, mode: "holding" as const } : p));
                  return prev.filter((p) => p.claim !== c);
                })
              }
              className={`h-8 rounded-full px-3 text-[13px] font-bold ${
                current
                  ? current.mode === "lacking"
                    ? "bg-x-black-btn text-white"
                    : "bg-[#f4212e] text-white"
                  : "border border-[#cfd9de] hover:bg-x-hover"
              }`}
            >
              {current ? `${current.mode === "lacking" ? "requires" : "excludes"} ${c}` : c}
            </button>
          );
        })}
      </div>

      {rules.length > 0 && (
        <>
          <h3 className="mt-5 text-[15px] font-extrabold text-x-text">Post rules</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {rules.map((r) => (
              <button
                key={r.id}
                onClick={() => setRuleIds(toggle(ruleIds, r.id))}
                className={`h-8 rounded-full px-3 text-[13px] font-bold ${
                  ruleIds.includes(r.id) ? "bg-x-blue text-white" : "border border-[#cfd9de] hover:bg-x-hover"
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
        </>
      )}

      {feeds.length > 0 && (
        <>
          <h3 className="mt-5 text-[15px] font-extrabold text-x-text">Curator desks</h3>
          <p className="text-[13px] leading-4 text-x-sec">Their flag actions ride along with the pack.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {feeds.map((f) => (
              <button
                key={f.id}
                data-testid={`pack-feed-${f.id}`}
                onClick={() => setSubs(toggle(subs, f.id))}
                className={`h-8 rounded-full px-3 text-[13px] font-bold ${
                  subs.includes(f.id) ? "bg-x-black-btn text-white" : "border border-[#cfd9de] hover:bg-x-hover"
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-5 flex gap-2">
        <button
          data-testid="pack-export"
          disabled={busy || !name}
          onClick={doExport}
          className="rounded-full bg-x-text px-5 py-2 text-[15px] font-bold text-x-bg disabled:opacity-50"
        >
          {busy ? "Working…" : "Export signed pack"}
        </button>
        {artifact != null && (
          <button
            data-testid="pack-import-self"
            disabled={busy}
            onClick={doImport}
            className="rounded-full border border-x-border px-5 py-2 text-[15px] font-bold text-x-text hover:bg-x-hover"
          >
            Import to my packs
          </button>
        )}
      </div>
      {artifact != null && (
        <p data-testid="pack-exported" className="mt-2 text-[13px] text-x-sec">
          Signed artifact ready — share it, or import it to yourself.
        </p>
      )}
      {imported && (
        <p data-testid="pack-imported" className="mt-1 text-[13px] font-bold text-x-text">
          Imported as {imported}. Attach it to a mode in Settings → Modes.
        </p>
      )}
      {error && <p className="mt-2 text-[13px] text-[#f4212e]">{error}</p>}
    </div>
  );
}
