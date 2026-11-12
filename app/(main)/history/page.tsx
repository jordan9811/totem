import type { Metadata } from "next";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { historyShelfView } from "@/lib/views/social.server";
import { PageHeader } from "@/components/PageHeader";
import { HistoryIsland } from "@/components/history/HistoryIsland";
import { ChevronDown, SearchIcon } from "@/components/icons";

export const metadata: Metadata = { title: "History / X" };
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  // PROD-LIVE (D-CU-0-4): the persona layer over this list (attribution, a granted viewer's merge) is the acting
  // persona's; a public deployment's server would have applied the FIXTURE viewer's. There the island fetches
  // /api/history from the browser device; on the rig the list is computed exactly as before and handed in.
  const initial = isPublicDeployment() ? null : await historyShelfView();
  return (
    <>
      <PageHeader
        back
        title="History"
        right={
          <button className="-mr-2 flex h-[34px] w-[34px] items-center justify-center rounded-full hover:bg-x-hover">
            <SearchIcon size={20} />
          </button>
        }
      />
      <div className="flex border-b border-x-border">
        <button className="flex h-[53px] flex-1 items-center justify-center transition-colors hover:bg-x-hover">
          <span className="relative flex h-full items-center text-[15px] font-bold text-x-text">
            <svg viewBox="0 0 24 24" width={18.75} height={18.75} fill="currentColor" className="mr-1.5">
              <path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z" />
            </svg>
            Bookmarks
            <ChevronDown size={16} className="ml-0.5" />
            <span className="absolute bottom-0 left-0 right-0 h-1 rounded-full bg-x-blue" />
          </span>
        </button>
        <button className="flex h-[53px] flex-1 items-center justify-center transition-colors hover:bg-x-hover">
          <span className="flex items-center text-[15px] font-medium text-x-sec">
            <svg viewBox="0 0 24 24" width={18.75} height={18.75} fill="currentColor" className="mr-1.5">
              <path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z" />
            </svg>
            Likes
          </span>
        </button>
      </div>
      <HistoryIsland initial={initial} />
      <div className="h-24" />
    </>
  );
}
