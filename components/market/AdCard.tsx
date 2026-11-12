"use client";
// Native ad unit. Matches X's promoted-post anatomy exactly (same avatar
// size, name row, body metrics, action row spacing) plus the required
// disclosure label. The mini-app embed slot renders one working demo: a
// simplified live-auction card.
import { useState } from "react";
import Link from "next/link";
import type { FeedCard } from "@/lib/feed";
import { KebabIcon } from "../icons";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function AdCard({ card }: { card: FeedCard }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const ad = card.ad!;

  return (
    <article
      data-testid="ad-card"
      data-campaign={ad.campaignId}
      className="border-b border-x-border px-4 pt-3 pb-2"
    >
      <div className="flex">
        <img
          src={ad.advertiserAvatarUrl}
          alt=""
          className="mr-2 h-10 w-10 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between">
            <p className="flex min-w-0 items-center text-[15px] leading-5">
              <span className="truncate font-bold">{ad.advertiserName}</span>
              <span className="ml-1 truncate text-x-sec">@{ad.advertiserHandle}</span>
            </p>
            <button
              onClick={() => setDismissed(true)}
              className="-mr-2 -mt-1 flex h-[34.75px] w-[34.75px] items-center justify-center rounded-full text-x-sec hover:bg-[#1d9bf01a] hover:text-x-blue"
              aria-label="Ad options"
            >
              <KebabIcon size={18.75} />
            </button>
          </div>
          <p className="text-[15px] leading-5">{ad.body}</p>

          {/* mini-app embed slot: one working demo embed */}
          {ad.embed && (
            <div
              data-testid="miniapp-embed"
              className="mt-3 overflow-hidden rounded-2xl border border-x-border"
            >
              <div className="bg-[#f7f9f9] px-3 py-2">
                <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">
                  Live auction · mini app
                </p>
              </div>
              <div className="px-3 py-3">
                <p className="text-[15px] font-bold leading-5">{ad.embed.title}</p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-[13px] leading-4 text-x-sec">Current bid</span>
                  <span className="text-[17px] font-black leading-6">{money(ad.embed.currentBid)}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-[13px] leading-4 text-x-sec">Slots filled</span>
                  <span className="text-[15px] font-bold leading-5">
                    {ad.embed.slotsFilled}/{ad.embed.slots}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-x-border">
                  <div
                    className="h-full rounded-full bg-x-blue"
                    style={{ width: `${(ad.embed.slotsFilled / ad.embed.slots) * 100}%` }}
                  />
                </div>
                <Link
                  href={ad.embed.href}
                  className="mt-3 flex h-8 items-center justify-center rounded-full bg-x-blue px-4 text-[14px] font-bold text-white hover:bg-x-blue-hover"
                >
                  Open auction
                </Link>
              </div>
            </div>
          )}

          {/* disclosure label — X's promoted-post treatment */}
          <p
            data-testid="ad-disclosure"
            className="mt-2 flex items-center text-[13px] leading-4 text-x-sec"
          >
            <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor" className="mr-1">
              <path d="M19.5 2h-15A2.5 2.5 0 0 0 2 4.5v15A2.5 2.5 0 0 0 4.5 22h15a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 19.5 2zM13 17h-2v-6H8l4-5 4 5h-3v6z" />
            </svg>
            Ad · matched on {ad.reasons.join(" + ")}
          </p>
        </div>
      </div>
    </article>
  );
}
