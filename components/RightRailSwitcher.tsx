"use client";
import { usePathname } from "next/navigation";
import type { LiveItem, NewsItem, Trend, User } from "@/lib/types";
import {
  LiveOnXCard,
  NewsCard,
  RailFooter,
  SearchPill,
  TrendsCard,
  WhoToFollowCard,
} from "./RightRail";

// PUBLIC GO-LIVE: in public live mode the server hands this rail the EMPTY twin of the fixture bank (lib/world-flag.ts
// bank): no trends, no news, no "live on X" rooms, no one to follow. The cards are then left out entirely (an empty
// "What's happening" box would be a frame around nothing), and the rail is the search box and the help links. With the
// flag off every card renders exactly as before.
export function RightRailSwitcher({
  trends,
  news,
  live,
  whoToFollow,
  publicLive = false,
}: {
  trends: Trend[];
  news: NewsItem[];
  live: LiveItem[];
  whoToFollow: User[];
  publicLive?: boolean;
}) {
  const pathname = usePathname();
  if (publicLive) {
    return (
      <div data-chrome="rail-right" data-world="live" className="persona-chrome ml-[30px] hidden w-[350px] shrink-0 lg:block">
        <SearchPill />
        <div className="pt-2">
          {live.length ? <LiveOnXCard items={live} /> : null}
          {trends.length ? <TrendsCard trends={trends} /> : null}
          {whoToFollow.length ? <WhoToFollowCard users={whoToFollow} /> : null}
          <RailFooter />
        </div>
      </div>
    );
  }
  const isHome = pathname === "/home";
  const isNotifications = pathname.startsWith("/notifications");
  const isExplore = pathname.startsWith("/explore");

  return (
    <div data-chrome="rail-right" className="persona-chrome ml-[30px] hidden w-[350px] shrink-0 lg:block">
      {!isExplore && <SearchPill />}
      <div className={isExplore ? "pt-2" : "pt-2"}>
        <LiveOnXCard items={live} />
        {isHome && <NewsCard items={news} />}
        {isHome || isNotifications || isExplore ? (
          <>
            <TrendsCard trends={trends} />
            <WhoToFollowCard users={whoToFollow} />
          </>
        ) : (
          <>
            <WhoToFollowCard users={whoToFollow} title="You might like" />
            <TrendsCard trends={trends} />
          </>
        )}
        <RailFooter />
      </div>
    </div>
  );
}
