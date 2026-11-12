"use client";
// Plain-language rule composer with a live preview against the seeded feed:
// "hide posts where author tier below 3" → "catches 47 posts right now".
// The preview count comes from the same evaluator the feed uses, so the
// number is exact, not an estimate.
import { useCallback, useEffect, useState } from "react";
import type { Rule, RuleCondition, RuleField, RuleGroup, RuleOp } from "@/lib/adapters/types";
import { describeGroup } from "@/lib/rules/evaluate";
import { ErrorNote, LoadingRows, Row, SettingsGroup } from "./Chrome";

const FIELDS: { value: RuleField; label: string; ops: RuleOp[]; kind: "number" | "text" | "bool" }[] = [
  { value: "author.tier", label: "author tier", ops: ["lt", "lte", "eq", "gte", "gt"], kind: "number" },
  { value: "author.cluster", label: "author topic", ops: ["eq", "neq", "in"], kind: "text" },
  { value: "post.topicId", label: "story", ops: ["eq", "neq"], kind: "text" },
  { value: "post.isUpdate", label: "is an update", ops: ["eq"], kind: "bool" },
  { value: "post.hasMedia", label: "has media", ops: ["eq"], kind: "bool" },
  { value: "post.age", label: "post age (minutes)", ops: ["lt", "gt"], kind: "number" },
  // SPEC A: a muted word, any case — works on sample posts and on your real Farcaster Following alike
  { value: "post.text", label: "text", ops: ["contains"], kind: "text" },
  // Attestation pass Gate 3: "onchain.protocol-history/morpho" — what the author PROVED this epoch
  { value: "attest.holds", label: "proven attestation (issuer/bucket)", ops: ["eq", "neq"], kind: "text" },
];

const OP_LABEL: Record<RuleOp, string> = {
  eq: "is",
  neq: "is not",
  gt: "is above",
  gte: "is at least",
  lt: "is below",
  lte: "is at most",
  in: "is one of",
  contains: "contains",
};

export function RuleBuilder() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("Hide low-tier posts");
  const [combinator, setCombinator] = useState<"AND" | "OR">("AND");
  const [negate, setNegate] = useState(false);
  const [conditions, setConditions] = useState<RuleCondition[]>([
    { field: "author.tier", op: "lt", value: 3 },
  ]);
  const [preview, setPreview] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/rules");
      if (!res.ok) throw new Error((await res.json()).error ?? "could not load rules");
      setRules((await res.json()).rules);
    } catch (e) {
      setError((e as Error).message);
      setRules([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const root: RuleGroup = { combinator, negate, clauses: conditions };

  // Live preview, debounced.
  useEffect(() => {
    let cancelled = false;
    setPreviewing(true);
    setPreviewError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/rules/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "preview failed");
        const data = await res.json();
        if (!cancelled) setPreview(data.count);
      } catch (e) {
        if (!cancelled) setPreviewError((e as Error).message);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [combinator, negate, JSON.stringify(conditions)]);

  function updateCondition(i: number, patch: Partial<RuleCondition>) {
    setConditions((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, action: "hide", root }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "could not save rule");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ErrorNote error={error} onRetry={load} />

      <SettingsGroup title="Build a rule" note="Rules run against the same evaluator the timeline uses, so the preview count is exact.">
        <div className="px-4 pb-3">
          <input
            data-testid="rule-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rule name"
            className="mb-3 w-full rounded-[4px] border border-[#cfd9de] px-3 py-2 text-[15px] outline-none focus:border-x-blue"
          />

          <p className="mb-2 text-[15px] leading-5">
            <span className="font-bold">Hide posts where</span>{" "}
            {negate && <span className="font-bold text-x-blue">NOT </span>}
            <span className="text-x-sec">{describeGroup(root)}</span>
          </p>

          {conditions.map((cond, i) => {
            const fieldDef = FIELDS.find((f) => f.value === cond.field)!;
            return (
              <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  data-testid={`rule-field-${i}`}
                  value={cond.field}
                  onChange={(e) => {
                    const next = FIELDS.find((f) => f.value === (e.target.value as RuleField))!;
                    updateCondition(i, {
                      field: next.value,
                      op: next.ops[0],
                      value: next.kind === "number" ? 3 : next.kind === "bool" ? true : "",
                    });
                  }}
                  className="h-8 rounded-[4px] border border-[#cfd9de] px-2 text-[14px]"
                >
                  {FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>

                <select
                  data-testid={`rule-op-${i}`}
                  value={cond.op}
                  onChange={(e) => updateCondition(i, { op: e.target.value as RuleOp })}
                  className="h-8 rounded-[4px] border border-[#cfd9de] px-2 text-[14px]"
                >
                  {fieldDef.ops.map((op) => (
                    <option key={op} value={op}>
                      {OP_LABEL[op]}
                    </option>
                  ))}
                </select>

                {fieldDef.kind === "bool" ? (
                  <select
                    data-testid={`rule-value-${i}`}
                    value={String(cond.value)}
                    onChange={(e) => updateCondition(i, { value: e.target.value === "true" })}
                    className="h-8 rounded-[4px] border border-[#cfd9de] px-2 text-[14px]"
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    data-testid={`rule-value-${i}`}
                    value={String(cond.value)}
                    onChange={(e) =>
                      updateCondition(i, {
                        value: fieldDef.kind === "number" ? Number(e.target.value) || 0 : e.target.value,
                      })
                    }
                    className="h-8 w-32 rounded-[4px] border border-[#cfd9de] px-2 text-[14px] outline-none focus:border-x-blue"
                  />
                )}

                {conditions.length > 1 && (
                  <button
                    onClick={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))}
                    className="h-8 rounded-full border border-[#cfd9de] px-2 text-[13px] font-bold hover:bg-x-hover"
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              data-testid="rule-add-condition"
              onClick={() => setConditions((prev) => [...prev, { field: "author.cluster", op: "eq", value: "crypto" }])}
              className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover"
            >
              Add condition
            </button>
            <button
              onClick={() => setCombinator((c) => (c === "AND" ? "OR" : "AND"))}
              className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover"
            >
              Combine with: {combinator}
            </button>
            <button
              onClick={() => setNegate((n) => !n)}
              className={`h-8 rounded-full px-3 text-[13px] font-bold transition-colors ${
                negate ? "bg-x-blue text-white" : "border border-[#cfd9de] hover:bg-x-hover"
              }`}
            >
              NOT
            </button>
          </div>

          <div
            data-testid="rule-preview"
            data-count={preview ?? ""}
            className="mt-3 rounded-2xl border border-x-border bg-[#f7f9f9] p-3"
          >
            {previewError ? (
              <p className="text-[15px] leading-5 text-[#f4212e]">Preview unavailable. {previewError}</p>
            ) : previewing ? (
              <p className="flex items-center text-[15px] leading-5 text-x-sec">
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-x-border border-t-x-blue" />
                Checking the feed…
              </p>
            ) : (
              <p className="text-[15px] leading-5">
                Catches <span data-testid="rule-preview-count" className="font-bold">{preview ?? 0}</span> post
                {preview === 1 ? "" : "s"} in your current feed.
              </p>
            )}
          </div>

          <button
            data-testid="rule-save"
            onClick={save}
            disabled={busy}
            className="mt-3 h-9 rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save rule"}
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Saved rules" note="Attach any of these to a mode from the Modes screen.">
        {rules === null ? (
          <LoadingRows count={2} />
        ) : rules.length === 0 ? (
          <p className="px-4 py-3 text-[15px] text-x-sec">No rules yet.</p>
        ) : (
          rules.map((rule) => (
            <Row
              key={rule.id}
              testid={`saved-rule-${rule.id}`}
              label={rule.name}
              sub={describeGroup(rule.root)}
              right={
                <button
                  onClick={async () => {
                    await fetch(`/api/rules?ruleId=${rule.id}`, { method: "DELETE" });
                    load();
                  }}
                  className="text-[13px] font-bold text-[#f4212e]"
                >
                  Delete
                </button>
              }
            />
          ))
        )}
      </SettingsGroup>
      <div className="h-24" />
    </>
  );
}
