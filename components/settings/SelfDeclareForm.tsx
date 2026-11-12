"use client";
// UX GATE 4 — the fourth backpack source type: a plain self-declared
// claim. No new backend path — this posts to the SAME /api/graph route
// the existing context-graph builder already uses (source defaults to
// "self" there), it just gives the backpack page its own compact entry
// point so all 4 source types live on one screen.
import { useCallback, useEffect, useState } from "react";
import type { ClaimCategory } from "@/lib/adapters/types";

export function SelfDeclareForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const [categories, setCategories] = useState<ClaimCategory[]>([]);
  const [category, setCategory] = useState<ClaimCategory | "">("");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then((j) => {
        const cats = Object.keys(j.catalogue ?? {}) as ClaimCategory[];
        setCategories(cats);
        if (cats.length) setCategory(cats[0]);
      })
      .catch(() => {});
  }, []);

  const submit = async () => {
    if (!category || !label.trim() || !value.trim()) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch("/api/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, label: label.trim(), value: value.trim() }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "could not add claim");
        return;
      }
      setLabel("");
      setValue("");
      setDone(true);
      onSubmitted?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="self-declare-form" className="mb-3 rounded-2xl border border-x-border p-4">
      <p className="text-[15px] font-bold leading-5">Declare a claim yourself</p>
      <p className="mt-0.5 text-[13px] leading-4 text-x-sec">
        No issuer, no signature — the lightest-weight source type, weighted accordingly.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          data-testid="self-declare-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as ClaimCategory)}
          className="h-9 rounded-md border border-[#cfd9de] px-2 text-[14px]"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          data-testid="self-declare-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Prefers window seats)"
          className="h-9 min-w-[180px] flex-1 rounded-md border border-[#cfd9de] px-2 text-[14px]"
        />
        <input
          data-testid="self-declare-value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value key (e.g. window_seats)"
          className="h-9 min-w-[140px] flex-1 rounded-md border border-[#cfd9de] px-2 text-[14px]"
        />
        <button
          data-testid="self-declare-submit"
          disabled={busy || !category || !label.trim() || !value.trim()}
          onClick={submit}
          className="h-9 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && (
        <p data-testid="self-declare-error" className="mt-2 text-[13px] text-[#f4212e]">
          {error}
        </p>
      )}
      {done && !error && (
        <p data-testid="self-declare-done" className="mt-2 text-[13px] font-bold text-[#00ba7c]">
          Added.
        </p>
      )}
    </div>
  );
}
