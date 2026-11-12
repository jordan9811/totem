"use client";
// ADS, PHASE 1 — one ad in a feed, laid out like X's promoted post (avatar, name row, body, a link card, the label), with
// "Why this ad" computed on the device and "Hide this ad" / "Hide this advertiser" kept on the device (lib/ads/plan.ts).
//
// NOTHING ON THIS CARD MAKES A REQUEST: the avatar is drawn here (no image is fetched), and the link opens the
// advertiser's page only when tapped, with no referrer and nothing added to its address. Nobody counts that the card was
// shown or tapped (no impression or click reporting in Phase 1; Phase 4 brings private, noisy totals).
import { useState } from "react";
import Link from "next/link";
import type { AdUnitView } from "@/lib/ads/plan";
import { AD_DIAL_LABELS, type AdDial } from "@/lib/ads/dial";
import { NO_MEASUREMENT_SENTENCE, WHY_HOUSE_SENTENCE, WHY_WHERE_SENTENCE } from "@/lib/ads/match";
import { KebabIcon } from "../icons";

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function AdUnit({
  ad,
  modeName,
  dial,
  onHide,
}: {
  ad: AdUnitView;
  modeName: string | null;
  dial: AdDial | null;
  /** hide this lot or its advertiser for the acting identity; resolves to an error sentence, or null when it worked */
  onHide: (what: "ad" | "advertiser", ad: AdUnitView) => Promise<string | null>;
}) {
  const [why, setWhy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<"ad" | "advertiser" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hide = async (what: "ad" | "advertiser") => {
    setMenu(false);
    setBusy(what);
    setError(null);
    const e = await onHide(what, ad);
    setBusy(null);
    if (e) setError(e);
  };
  const label = ad.house ? "House ad" : "Ad";
  return (
    <article
      data-testid="ad-unit"
      data-lot={ad.lotId}
      data-advertiser={ad.advertiserId}
      data-house={ad.house ? "true" : "false"}
      data-slot={ad.slot}
      data-position={ad.position}
      data-why-kind={ad.whyKind}
      className="relative border-b border-x-border px-4 pt-3 pb-2"
    >
      <div className="flex">
        <div aria-hidden="true" className="mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-x-black-btn text-[17px] font-bold text-white">
          {ad.advertiserName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between">
            <p className="flex min-w-0 items-center text-[15px] leading-5">
              <span data-testid="ad-advertiser" className="truncate font-bold">
                {ad.advertiserName}
              </span>
              <span className="ml-1 truncate text-x-sec">@{ad.advertiserHandle}</span>
            </p>
            <button
              type="button"
              data-testid="ad-menu"
              onClick={() => setMenu((m) => !m)}
              className="-mr-2 -mt-1 flex h-[34.75px] w-[34.75px] items-center justify-center rounded-full text-x-sec hover:bg-[#1d9bf01a] hover:text-x-blue"
              aria-label="Ad options"
              aria-expanded={menu}
            >
              <KebabIcon size={18.75} />
            </button>
          </div>
          {menu ? (
            <div role="menu" data-testid="ad-menu-list" className="absolute right-4 top-10 z-10 w-64 overflow-hidden rounded-xl border border-x-border bg-white text-[15px] shadow-lg">
              <button type="button" role="menuitem" data-testid="ad-menu-why" onClick={() => {
                  setMenu(false);
                  setWhy(true);
                }} className="block w-full px-4 py-3 text-left font-bold hover:bg-x-hover">
                Why this ad?
              </button>
              <button type="button" role="menuitem" data-testid="ad-menu-hide" onClick={() => void hide("ad")} className="block w-full px-4 py-3 text-left font-bold hover:bg-x-hover">
                Hide this ad
              </button>
              <button type="button" role="menuitem" data-testid="ad-menu-hide-advertiser" onClick={() => void hide("advertiser")} className="block w-full px-4 py-3 text-left font-bold hover:bg-x-hover">
                Hide ads from {ad.advertiserName}
              </button>
            </div>
          ) : null}
          <p data-testid="ad-body" className="whitespace-pre-wrap text-[15px] leading-5">
            {ad.body}
          </p>
          <a
            data-testid="ad-link"
            href={ad.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
            className="mt-3 block overflow-hidden rounded-2xl border border-x-border hover:bg-x-hover"
          >
            <span className="block px-3 pt-2 text-[13px] leading-4 text-x-sec">{hostOf(ad.url)}</span>
            <span data-testid="ad-headline" className="block px-3 pb-1 text-[15px] font-bold leading-5">
              {ad.headline}
            </span>
            <span className="mx-3 mb-3 mt-1 inline-flex h-8 items-center rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white">{ad.cta}</span>
          </a>
          <p data-testid="ad-disclosure" className="mt-2 flex flex-wrap items-center gap-x-1 text-[13px] leading-4 text-x-sec">
            <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor" aria-hidden="true">
              <path d="M19.5 2h-15A2.5 2.5 0 0 0 2 4.5v15A2.5 2.5 0 0 0 4.5 22h15a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 19.5 2zM13 17h-2v-6H8l4-5 4 5h-3v6z" />
            </svg>
            <span data-testid="ad-label">{label}</span>
            <span aria-hidden="true">·</span>
            <button type="button" data-testid="ad-why-toggle" aria-expanded={why} onClick={() => setWhy((w) => !w)} className="font-bold text-x-blue hover:underline">
              Why this ad?
            </button>
          </p>
          {why ? (
            <div data-testid="ad-why" className="mt-2 rounded-2xl bg-[#f7f9f9] px-3 py-2 text-[13px] leading-5 text-x-text">
              <p data-testid="ad-why-reason" className="font-bold">
                {ad.why}
              </p>
              <p data-testid="ad-why-where">{WHY_WHERE_SENTENCE}</p>
              {ad.house ? <p data-testid="ad-why-house">{WHY_HOUSE_SENTENCE}</p> : null}
              <p data-testid="ad-why-measure">{NO_MEASUREMENT_SENTENCE}</p>
              <p data-testid="ad-why-dial">
                Ads in {modeName ?? "this mode"}: {dial ? AD_DIAL_LABELS[dial] : "unknown"}.{" "}
                <Link href="/settings/modes" prefetch={false} className="font-bold text-x-blue hover:underline">
                  Change it in Settings
                </Link>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" data-testid="ad-hide" disabled={busy !== null} onClick={() => void hide("ad")} className="h-8 rounded-full border border-[#cfd9de] bg-white px-3 text-[13px] font-bold hover:bg-x-hover disabled:opacity-50">
                  {busy === "ad" ? "Hiding…" : "Hide this ad"}
                </button>
                <button type="button" data-testid="ad-hide-advertiser" disabled={busy !== null} onClick={() => void hide("advertiser")} className="h-8 rounded-full border border-[#cfd9de] bg-white px-3 text-[13px] font-bold hover:bg-x-hover disabled:opacity-50">
                  {busy === "advertiser" ? "Hiding…" : "Hide ads from " + ad.advertiserName}
                </button>
              </div>
            </div>
          ) : null}
          {error ? (
            <p data-testid="ad-hide-error" role="alert" className="mt-2 text-[13px] leading-4 text-[#f4212e]">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
