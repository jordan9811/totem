"use client";
// Escrow intent auction. Bids arrive on a deterministic script driven by the
// controllable market clock, so the countdown is real to the user but
// jumpable in tests. Both resolution paths — pick a winner, or let the
// window lapse — fire settlement.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Bid, Intent } from "@/lib/adapters/types";
import { RetryButton } from "@/components/spaces/IslandStatus";

type BidWithHandle = Bid & { advertiserHandle: string };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function IntentAuction({ intentId }: { intentId: string }) {
  const router = useRouter();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [bids, setBids] = useState<BidWithHandle[]>([]);
  const [now, setNow] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/market/intent?intentId=${intentId}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "auction unavailable");
      const data = await res.json();
      setIntent(data.intent);
      setBids(data.bids);
      setNow(data.now);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [intentId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while open so scripted bids land, and keep the countdown honest.
  useEffect(() => {
    if (intent?.status !== "open") return;
    const t = setInterval(load, 1200);
    return () => clearInterval(t);
  }, [intent?.status, load]);

  // PROD-LIVE (D-CU-0-4): a Retry that re-reads in place — on a public deployment a full reload would mint the
  // visitor a new identity, and the auction (theirs) would be gone with the old one
  if (error && !intent)
    return (
      <>
        <p data-testid="auction-error" className="px-4 py-6 text-[15px] text-x-sec">
          Couldn&rsquo;t load the auction. {error}
        </p>
        <div className="px-4">
          <RetryButton onRetry={load} testid="auction-retry" />
        </div>
      </>
    );
  if (!intent) return <p className="px-4 py-6 text-[15px] text-x-sec">Loading auction…</p>;

  const elapsed = now - intent.createdAt;
  const remaining = Math.max(0, intent.windowMs - elapsed);
  const expired = remaining <= 0;
  const slotsFilled = bids.length;

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/market/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId, ...body }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "action failed");
        return;
      }
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="intent-auction" data-status={intent.status} data-intent={intent.id}>
      <div className="border-b border-x-border px-4 py-4">
        <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">
          {intent.category}
        </p>
        <p className="mt-1 text-[20px] font-black leading-6">{intent.description}</p>
        <div className="mt-3 flex flex-wrap gap-4">
          <div>
            <p className="text-[13px] leading-4 text-x-sec">In escrow</p>
            <p data-testid="escrow-amount" className="text-[17px] font-bold leading-6">
              {money(intent.escrowAmount)}
            </p>
          </div>
          <div>
            <p className="text-[13px] leading-4 text-x-sec">Pitch slots</p>
            <p className="text-[17px] font-bold leading-6">
              {slotsFilled}/{intent.pitchSlots} filled
            </p>
          </div>
          <div>
            <p className="text-[13px] leading-4 text-x-sec">Decision window</p>
            <p data-testid="countdown" data-remaining={remaining} className="text-[17px] font-bold leading-6">
              {intent.status !== "open"
                ? intent.status === "awarded"
                  ? "Awarded"
                  : "Lapsed"
                : expired
                  ? "Expired"
                  : `${Math.ceil(remaining / 1000)}s left`}
            </p>
          </div>
        </div>

        {intent.status === "open" && (
          <div className="mt-3 flex gap-2">
            <button
              data-testid="advance-auction-clock"
              disabled={busy}
              onClick={() => act({ action: "advanceClock", ms: 2500 })}
              className="h-8 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold hover:bg-x-hover disabled:opacity-50"
            >
              Skip ahead
            </button>
            {expired && (
              <button
                data-testid="lapse-intent"
                disabled={busy}
                onClick={() => act({ action: "lapse" })}
                className="h-8 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
              >
                Let it lapse &amp; refund
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="border-b border-x-border px-4 py-2 text-[13px] text-x-sec">{error}</p>
      )}

      <div data-testid="bid-list">
        {bids.length === 0 && (
          <p className="px-4 py-8 text-center text-[15px] text-x-sec">
            No pitches yet. Advertisers are still bidding.
          </p>
        )}
        {bids.map((b) => (
          <div
            key={b.id}
            data-testid="bid-card"
            data-bid={b.id}
            className={`border-b border-x-border px-4 py-3 ${
              intent.winningBidId === b.id ? "bg-[#1d9bf00d]" : ""
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0 pr-4">
                <p className="text-[15px] font-bold leading-5">@{b.advertiserHandle}</p>
                <p className="mt-0.5 text-[15px] leading-5">{b.pitch}</p>
                <p className="mt-1 text-[13px] leading-4 text-x-sec">Offering {money(b.amount)}</p>
              </div>
              {intent.status === "open" ? (
                <button
                  data-testid="pick-winner"
                  data-bid={b.id}
                  disabled={busy}
                  onClick={() => act({ action: "award", bidId: b.id })}
                  className="h-8 shrink-0 rounded-full bg-x-blue px-4 text-[14px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50"
                >
                  Pick
                </button>
              ) : intent.winningBidId === b.id ? (
                <span data-testid="winning-bid" className="shrink-0 text-[13px] font-bold text-x-blue">
                  Winner
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="h-24" />
    </div>
  );
}
