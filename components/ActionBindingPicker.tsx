"use client";
// MEGA PASS 2 Gate 3 — the binding picker a long-press on any action button
// opens. Picking rebinds THAT slot of the active mode's row (a PATCH on the
// mode; composer and nav slots ride along untouched). Refusals (an action
// already bound elsewhere in the row, an unknown id) come back from the
// mode route's validator and are shown, never guessed around.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CAST_ACTIONS, CAST_ACTION_LABELS, type CastAction } from "@/lib/actions/bindings";
import { useActionRow } from "./ActionRowContext";

export function ActionBindingPicker({ slotIndex, current, onClose }: { slotIndex: number; current: CastAction; onClose: () => void }) {
  const router = useRouter();
  const { modeId, row, slots } = useActionRow();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (action: CastAction) => {
    if (!modeId) {
      setError("this surface has no mode to bind to");
      return;
    }
    const next = [...row];
    next[slotIndex] = action;
    setBusy(true);
    try {
      const r = await fetch("/api/modes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modeId, patch: { actionButtonSlots: { composer: slots?.composer ?? [], nav: slots?.nav ?? [], cast: next } } }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "refused");
        return;
      }
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="action-binding-picker"
      data-slot={slotIndex}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      className="absolute bottom-10 left-0 z-30 w-56 rounded-2xl border border-x-border bg-white py-1 shadow-[0_0_15px_rgba(101,119,134,0.2)]"
    >
      <p className="px-3 py-1 text-[13px] text-x-sec">Bind slot {slotIndex + 1} to…</p>
      {CAST_ACTIONS.map((a) => (
        <button
          key={a}
          role="menuitem"
          data-testid={`bind-${a}`}
          disabled={busy || row.includes(a) && a !== current}
          onClick={() => pick(a)}
          className={`block w-full px-3 py-1.5 text-left text-[15px] hover:bg-x-hover disabled:opacity-40 ${a === current ? "font-bold" : ""}`}
        >
          {CAST_ACTION_LABELS[a]}
          {row.includes(a) && a !== current ? <span className="ml-1 text-[12px] text-x-sec">(bound)</span> : null}
        </button>
      ))}
      {error ? <p data-testid="action-binding-error" className="px-3 py-1 text-[13px] text-x-sec">{error}</p> : null}
      <button onClick={onClose} className="block w-full px-3 py-1.5 text-left text-[13px] text-x-sec hover:bg-x-hover">Cancel</button>
    </div>
  );
}
