"use client";
// POST-DEPLOY Gate 3 — the per-account delivery control, wherever an account is.
//
// It answers the question people actually have — WHERE do this person's posts
// show up — instead of the one the industry asks, which is whether to send a
// notification. And it is scoped to the current MODE, stated on the control
// itself: "never miss in Personal" and "quiet in Work" is one setting on one
// account, so the control has to say which mode it is setting or the owner will
// read it as global and be surprised later.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type DeliveryTier = "never-miss" | "banner" | "normal" | "facet-only" | "quiet";

export const TIER_LABEL: Record<DeliveryTier, string> = {
  "never-miss": "Never miss",
  banner: "Banner",
  normal: "Normal",
  "facet-only": "Facet only",
  quiet: "Quiet",
};
export const TIER_BLURB: Record<DeliveryTier, string> = {
  "never-miss": "always in the timeline, near the top on refresh",
  banner: "surfaces in the strip above the timeline — not a notification",
  normal: "ranked like everything else",
  "facet-only": "only the facets of theirs you follow",
  quiet: "followed, but well down the ranking",
};

export function DeliveryTierPicker({
  personaId,
  handle,
  onDone,
  omit = [],
}: {
  personaId: string;
  handle: string;
  onDone?: () => void;
  /** SPEC A: tiers this account cannot have (a Farcaster account has no facets, so no "facet only") */
  omit?: DeliveryTier[];
}) {
  const router = useRouter();
  const [tier, setTier] = useState<DeliveryTier | null>(null);
  const [modeName, setModeName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/delivery?personaId=" + encodeURIComponent(personaId), { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "delivery unavailable");
      setTier(j.tier);
      setModeName(j.modeName);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [personaId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pick(next: DeliveryTier) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId, tier: next }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "could not set the tier");
      setTier(j.tier);
      router.refresh();
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="delivery-picker" data-persona={personaId} data-tier={tier ?? ""} className="px-4 py-2">
      <p className="text-[13px] font-bold text-x-sec">
        Where @{handle} shows up{modeName ? " in " + modeName : ""}
      </p>
      <div className="mt-1 space-y-0.5">
        {(Object.keys(TIER_LABEL) as DeliveryTier[]).filter((t) => !omit.includes(t)).map((t) => (
          <button
            key={t}
            data-testid={"delivery-option-" + t}
            data-selected={tier === t ? "1" : "0"}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              void pick(t);
            }}
            className={`flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left hover:bg-x-hover disabled:opacity-60 ${
              tier === t ? "bg-x-hover" : ""
            }`}
          >
            <span className="text-[15px] font-bold leading-5">
              {TIER_LABEL[t]}
              {tier === t ? <span className="ml-1.5 text-[12px] text-x-blue">current</span> : null}
            </span>
            <span className="text-[13px] leading-4 text-x-sec">{TIER_BLURB[t]}</span>
          </button>
        ))}
      </div>
      {error ? (
        <p data-testid="delivery-error" className="mt-1 text-[13px] text-[#f4212e]">
          {error}
        </p>
      ) : null}
      {/* PROD-LIVE (D-CU-0-4): a client navigation, never a full document load (an unsaved visitor identity lives
          only in tab memory on a public deployment). The picker sits inside a cast card whose own click opens the
          post, so the click stops HERE — otherwise the card's router.push would win over this one. */}
      <Link
        href="/settings/delivery"
        prefetch={false}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 block text-[13px] font-bold text-x-blue hover:underline"
      >
        Everything you have set
      </Link>
    </div>
  );
}
