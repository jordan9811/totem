"use client";
// Persona-layer UI (allowed divergence from X): subtle monochrome rep tier
// badge, rendered right of the handle from validator data only. Tapping it
// opens the tier explainer.
import { useEffect, useRef, useState } from "react";

export function TierBadge({ tier, interactive = true }: { tier?: number; interactive?: boolean }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<{ percentile: string; unlocks: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open || detail || tier === undefined) return;
    setLoading(true);
    fetch(`/api/tier?tier=${tier}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then((d) => setDetail({ percentile: d.percentile, unlocks: d.unlocks }))
      .catch(() => setDetail({ percentile: "—", unlocks: [] }))
      .finally(() => setLoading(false));
  }, [open, detail, tier]);

  if (tier === undefined || tier === null) return null;

  // ZK PASS 2 Gate 1: tier 0 is a REAL state — "not proven this epoch"
  // under the proof-mediated binding (the legacy bindings never yield 0).
  // Rendered honestly: a chip that says so, never a fake tier, never a
  // silent blank. Static copy; no explainer fetch for a non-tier.
  if (tier === 0) {
    return (
      <span
        data-testid="tier-badge"
        data-tier="unproven"
        title="Tier not proven this epoch"
        className="ml-1 inline-flex h-[15px] shrink-0 items-center justify-center rounded-[3px] border border-dashed border-[#cfd9de] px-[3px] align-[-1px] text-[10px] font-medium leading-none text-x-sec"
      >
        not proven
      </span>
    );
  }

  const badge = (
    <span
      data-testid="tier-badge"
      data-tier={tier}
      title={`Reputation tier ${tier} of 10`}
      className="ml-1 inline-flex h-[15px] min-w-[15px] shrink-0 items-center justify-center rounded-[3px] border border-[#cfd9de] px-[2.5px] align-[-1px] text-[10px] font-medium leading-none text-x-sec"
    >
      {tier}
    </span>
  );

  if (!interactive) return badge;

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="inline-flex"
        aria-label={`Reputation tier ${tier} of 10`}
      >
        {badge}
      </button>
      {open && (
        <span
          data-testid="tier-explainer"
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-5 z-50 block w-[280px] cursor-default rounded-2xl bg-white p-3 text-left shadow-[0_0_15px_rgba(101,119,134,0.2),0_0_3px_1px_rgba(101,119,134,0.15)]"
        >
          <span className="block text-[15px] font-bold leading-5">Reputation tier {tier} of 10</span>
          <span className="mt-0.5 block text-[13px] leading-4 text-x-sec">
            {loading ? "Loading…" : detail?.percentile}
          </span>
          <span className="mt-2 block text-[13px] leading-4 text-x-sec">
            Reputation lives on the account, not the persona — every persona of an account shares one tier.
          </span>
          {detail && detail.unlocks.length > 0 && (
            <span className="mt-2 block">
              <span className="block text-[13px] font-bold leading-4">Unlocked at this tier</span>
              {detail.unlocks.map((u) => (
                <span key={u} className="mt-0.5 block text-[13px] leading-4 text-x-sec">
                  · {u}
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
