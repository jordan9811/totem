"use client";
import type { Embed } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { VerifiedBadge } from "./icons";
import { RichText } from "./CastCard";

// Standalone embed renderer for server pages (permalink main cast).
export function EmbedList({ embeds }: { embeds: Embed[] }) {
  return (
    <>
      {embeds.map((embed, i) => {
        if (embed.type === "image") {
          return (
            <div key={i} className="mt-3 overflow-hidden rounded-2xl border border-x-border">
              <img referrerPolicy="no-referrer" loading="lazy" src={embed.url} alt="" className="max-h-[510px] w-full object-cover" />
            </div>
          );
        }
        if (embed.type === "link") {
          return (
            <div key={i} className="mt-3 cursor-pointer overflow-hidden rounded-2xl border border-x-border hover:bg-x-hover">
              {embed.image && (
                <div className="relative border-b border-x-border">
                  <img referrerPolicy="no-referrer" loading="lazy" src={embed.image} alt="" className="max-h-[300px] w-full object-cover" />
                  {embed.article && (
                    <span className="absolute bottom-3 left-3 flex items-center rounded-[4px] bg-[#000000c4] px-1.5 py-0.5 text-[13px] font-bold text-white">
                      <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" className="mr-1">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                      Article
                    </span>
                  )}
                </div>
              )}
              <div className="px-3 py-3">
                <p className="text-[15px] font-bold leading-5">{embed.title}</p>
                {embed.description && (
                  <p className="clamp-2 mt-0.5 text-[15px] leading-5 text-x-sec">{embed.description}</p>
                )}
                <p className="mt-0.5 text-[13px] leading-4 text-x-sec">{embed.domain}</p>
              </div>
            </div>
          );
        }
        const q = embed.quote;
        return (
          <div key={i} className="mt-3 overflow-hidden rounded-2xl border border-x-border">
            <div className="px-3 pt-3 pb-2">
              <p className="flex items-center text-[15px] leading-5">
                <img referrerPolicy="no-referrer" loading="lazy" src={q.author.pfpUrl} alt="" className="mr-1.5 h-5 w-5 rounded-full object-cover" />
                <span className="max-w-[45%] truncate font-bold">{q.author.displayName}</span>
                {q.author.verified && <VerifiedBadge size={16} className="ml-0.5 shrink-0" />}
                <span className="ml-1 truncate text-x-sec">@{q.author.username}</span>
                <span className="mx-1 text-x-sec">·</span>
                <span className="shrink-0 text-x-sec">{relativeTime(q.timestamp)}</span>
              </p>
              <RichText text={q.text} className="clamp-10 mt-0.5 block text-[15px] leading-5" />
            </div>
            {q.embeds.map((e2, j) =>
              e2.type === "image" ? (
                <img referrerPolicy="no-referrer" loading="lazy" key={j} src={e2.url} alt="" className="max-h-[430px] w-full border-t border-x-border object-cover" />
              ) : null
            )}
          </div>
        );
      })}
    </>
  );
}
