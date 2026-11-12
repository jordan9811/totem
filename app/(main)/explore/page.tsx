import { SearchBox } from "@/components/SearchBox";
import type { Metadata } from "next";
import { getFeed, getTrends } from "@/lib/data";
import { applyFeedPolicy } from "@/lib/policy";
import { getSession } from "@/lib/session";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { ExploreFeedIsland, type ExploreFeed } from "@/components/explore/ExploreFeedIsland";
import { KebabIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Explore / X" };
export const dynamic = "force-dynamic";

/** RIG: the discovery timeline exactly as this page always computed it (the same shape /api/feed answers). */
async function discoveryFeed(): Promise<ExploreFeed> {
  const session = await getSession();
  const { casts, nextPage } = await getFeed("foryou");
  // Discovery surface: tier-1 filtered (validator policy).
  const filtered = await applyFeedPolicy(casts, { surface: "discovery", viewer: session.active, own: session.personas.map((p) => p.id) });
  return { casts: filtered, nextPage };
}

export default async function ExplorePage() {
  // PROD-LIVE (D-CU-0-4): the discovery filter and the persona layer are the VIEWER's (their blocks, their own
  // personas, their granted merges). A public deployment's server has no viewer — getSession() there is either the
  // fixture self or a throw — so it renders the trends (fixture, not identity) and the island fetches /api/feed from
  // the browser device. On the rig the feed is computed exactly as before and handed to the same island.
  const initial = isPublicDeployment() ? null : await discoveryFeed();
  const trends = await getTrends();
  const tabs = ["For You", "Trending", "News", "Sports", "Entertainment"];

  return (
    <>
      <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-md">
        <div className="flex h-[53px] items-center px-4">
          <SearchBox />
        </div>
        <div className="flex border-b border-x-border">
          {tabs.map((tab, i) => (
            <button
              key={tab}
              className="flex h-[53px] flex-1 items-center justify-center px-4 transition-colors hover:bg-x-hover"
            >
              <span
                className={`relative flex h-full items-center text-[15px] ${
                  i === 0 ? "font-bold text-x-text" : "font-medium text-x-sec"
                }`}
              >
                {tab}
                {i === 0 && <span className="absolute bottom-0 left-0 right-0 h-1 rounded-full bg-x-blue" />}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="border-b border-x-border">
        {trends
          .filter((t) => t.kind === "trend")
          .map((t, i) => (
            <div key={i} className="flex cursor-pointer items-start justify-between px-4 py-3 hover:bg-x-hover">
              <div>
                <p className="text-[13px] leading-4 text-x-sec">{t.category}</p>
                <p className="mt-0.5 text-[15px] font-bold leading-5">{t.title}</p>
              </div>
              <button className="-mr-1 rounded-full p-1.5 text-x-sec hover:bg-[#1d9bf01a] hover:text-x-blue">
                <KebabIcon size={18.75} />
              </button>
            </div>
          ))}
      </div>
      <ExploreFeedIsland initial={initial} />
    </>
  );
}
