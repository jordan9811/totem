"use client";
// Advertiser console. The audience predicate builder IS the rules engine UI
// — same RuleGroup shape, same evaluator, same plain-language description
// helper the feed rule builder uses. Not a fork.
//
// k-floor is enforced in BOTH layers: submit is disabled here with the
// reason shown, and the API rejects independently (criterion 12).
import { useCallback, useEffect, useRef, useState } from "react";
import type { RuleCondition, RuleGroup } from "@/lib/adapters/types";
import { describeGroup } from "@/lib/rules/evaluate";

const CLAIM_OPTIONS = [
  "espresso",
  "telescope",
  "longform_reader",
  "market_structure",
  "military_history",
  "coffee_weekly",
  "fantasy_football",
];

export function AdvertiserConsole() {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("2500");
  const [claim, setClaim] = useState(CLAIM_OPTIONS[0]);
  const [minTier, setMinTier] = useState("1");
  const [size, setSize] = useState<number | null>(null);
  const [kFloor, setKFloor] = useState(8);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const audience: RuleGroup = {
    combinator: "AND",
    clauses: [
      { field: "graph.claim", op: "contains", value: claim } as RuleCondition,
      ...(Number(minTier) > 1
        ? [{ field: "author.tier", op: "gte", value: Number(minTier) } as RuleCondition]
        : []),
    ],
  };

  // Sequence guard: changing the audience twice quickly fires two estimates,
  // and mock latency is 200-1500ms, so responses can land out of order. Only
  // the newest request may write state — otherwise a stale count can
  // overwrite a fresh one, which is exactly the "stale count" this screen is
  // required never to show.
  const seq = useRef(0);

  const estimate = useCallback(async () => {
    const mine = ++seq.current;
    setSizeError(null);
    // Drop the previous count the instant the audience changes. Keeping it on
    // screen while a new estimate is in flight means displaying a number we
    // cannot currently confirm — and, worse, leaving submit enabled against
    // it. Mock latency is 200-1500ms, so that window is wide enough to click
    // through. Unknown-while-checking is the honest state, and it fails
    // closed.
    setPending(true);
    setSize(null);
    try {
      const res = await fetch(
        `/api/market/campaign?audience=${encodeURIComponent(JSON.stringify(audience))}`
      );
      if (!res.ok) throw new Error((await res.json()).error ?? "estimate unavailable");
      const data = await res.json();
      if (mine !== seq.current) return; // superseded
      setSize(data.size);
      setKFloor(data.kFloor);
      setPending(false);
    } catch (e) {
      if (mine !== seq.current) return; // superseded
      // FAIL CLOSED: never show a stale or guessed count. Clearing size
      // disables submit, because we cannot prove the floor is satisfied.
      setSize(null);
      setSizeError((e as Error).message);
      setPending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim, minTier]);

  useEffect(() => {
    estimate();
  }, [estimate]);

  const belowFloor = size !== null && size < kFloor;
  const unknownSize = size === null;
  const canSubmit = !busy && !pending && !!name && !belowFloor && !unknownSize;

  return (
    <div data-testid="advertiser-console" className="px-4 py-4">
      <section className="mb-4">
        <label className="block text-[13px] font-bold uppercase tracking-wide text-x-sec">
          Campaign name
        </label>
        <input
          data-testid="campaign-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rowan &amp; Vine — spring roast"
          className="mt-1 w-full rounded-[4px] border border-[#cfd9de] px-3 py-2 text-[15px] outline-none focus:border-x-blue"
        />
      </section>

      <section className="mb-4">
        <label className="block text-[13px] font-bold uppercase tracking-wide text-x-sec">
          Budget (cents)
        </label>
        <input
          data-testid="campaign-budget"
          value={budget}
          onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ""))}
          className="mt-1 w-full rounded-[4px] border border-[#cfd9de] px-3 py-2 text-[15px] outline-none focus:border-x-blue"
        />
      </section>

      {/* the rules-engine audience builder */}
      <section className="mb-4 rounded-2xl border border-x-border p-4">
        <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">Audience</p>
        <p data-testid="audience-plain-language" className="mt-1 text-[15px] font-bold leading-5">
          Reach people where {describeGroup(audience)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            data-testid="audience-claim"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            className="h-9 rounded-[4px] border border-[#cfd9de] px-2 text-[15px]"
          >
            {CLAIM_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select
            data-testid="audience-min-tier"
            value={minTier}
            onChange={(e) => setMinTier(e.target.value)}
            className="h-9 rounded-[4px] border border-[#cfd9de] px-2 text-[15px]"
          >
            {[1, 3, 5, 7, 9].map((t) => (
              <option key={t} value={t}>
                {t === 1 ? "any tier" : `tier ${t}+`}
              </option>
            ))}
          </select>
        </div>

        <div
          data-testid="audience-estimate"
          data-size={size ?? ""}
          data-below-floor={belowFloor ? "true" : "false"}
          data-pending={pending ? "true" : "false"}
          className={`mt-3 rounded-xl px-3 py-2 text-[15px] leading-5 ${
            pending
              ? "bg-[#f7f9f9] text-x-sec"
              : belowFloor || unknownSize
                ? "bg-[#f4212e0d] text-[#f4212e]"
                : "bg-[#f7f9f9] text-x-sec"
          }`}
        >
          {pending ? (
            <>Checking audience size&hellip;</>
          ) : unknownSize ? (
            <>Audience size unavailable — can&rsquo;t confirm the privacy floor, so this campaign can&rsquo;t be submitted.</>
          ) : belowFloor ? (
            <>
              Estimated audience: <strong>{size}</strong>. Below the k-anonymity floor of {kFloor} —
              too few people to run without identifying them.
            </>
          ) : (
            <>
              Estimated audience: <strong>{size}</strong> people (floor is {kFloor}).
            </>
          )}
        </div>
      </section>

      <button
        data-testid="submit-campaign"
        disabled={!canSubmit}
        onClick={async () => {
          setBusy(true);
          setSubmitError(null);
          setCreated(null);
          try {
            const res = await fetch("/api/market/campaign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, budget: Number(budget), audience }),
            });
            const data = await res.json();
            if (!res.ok) {
              setSubmitError(data.error ?? "campaign rejected");
              return;
            }
            setCreated(data.campaign.id);
          } finally {
            setBusy(false);
          }
        }}
        className="h-9 rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Launch campaign"}
      </button>
      {!pending && (belowFloor || unknownSize) && (
        <p data-testid="submit-blocked-reason" className="mt-2 text-[13px] leading-4 text-[#f4212e]">
          {unknownSize
            ? `Can't verify audience size${sizeError ? ` (${sizeError})` : ""}.`
            : `Audience of ${size} is below the floor of ${kFloor}.`}
        </p>
      )}
      {submitError && (
        <p data-testid="submit-error" className="mt-2 text-[13px] leading-4 text-[#f4212e]">
          {submitError}
        </p>
      )}
      {created && (
        <p data-testid="campaign-created" className="mt-2 text-[13px] leading-4 text-x-sec">
          Campaign {created} is live.
        </p>
      )}
    </div>
  );
}
