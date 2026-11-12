import type { Metadata } from "next";
import { search, type SearchResults } from "@/lib/search";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { SearchBox } from "@/components/SearchBox";
// MEGA PASS 2 Gate 4: unified search — vault-local, keyword + AI, one box over everything this root touched
import { UnifiedSearch } from "@/components/UnifiedSearch";
import { SearchResultsIsland } from "@/components/search/SearchResultsIsland";
import { NetworkSearchIsland } from "@/components/search/NetworkSearchIsland";

export const metadata: Metadata = { title: "Search / X" };
export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q ?? "";
  // The viewer comes from the server. Every result row below was already
  // authorized for THIS viewer inside search() — nothing here re-decides it.
  //
  // PROD-LIVE (D-CU-0-4): on a public deployment the server has no viewer — activeSeedPersonaId() there is the
  // FIXTURE persona, so the server would have searched with someone else's grants, channels and shared posts (and
  // swallowed the block read it cannot make). There the results island fetches /api/search from the browser device,
  // where the viewer is the visitor. On the rig the search runs here exactly as before and is handed in.
  //
  // PROD-LIVE (review fix): search() now THROWS when the viewer's block list cannot be read (it used to search as if
  // nothing were blocked). The page catches it and hands the island the failure, which draws search-error with a
  // Retry (a re-render, never a document load) — rather than a 500 page, and rather than results that include
  // accounts the viewer blocked.
  let results: SearchResults | null = null;
  let searchError: string | null = null;
  if (!isPublicDeployment() && q) {
    try {
      results = await search(q, activeSeedPersonaId());
    } catch (e) {
      searchError = (e as Error)?.message || "search failed";
    }
  }

  return (
    <>
      <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-md">
        <div className="flex h-[53px] items-center px-4">
          <SearchBox initial={q} autoFocus={!q} />
        </div>
      </div>

      {!q && (
        <p className="px-4 py-8 text-[15px] leading-5 text-x-sec">
          Search posts, people and channels — and everything you have touched, below.
        </p>
      )}

      {/* MEGA PASS 2 Gate 4: everything this root touched, from one box. The index is built in this process
          from the vault and never leaves it; the public search above is unchanged. (UnifiedSearch is a client
          component that reads /api/search/unified itself — the browser device answers it on a public deployment.) */}
      <section data-testid="search-everything" className="border-b border-x-border">
        <h2 className="px-4 pt-4 text-[20px] font-extrabold leading-6 text-x-text">Everything you&rsquo;ve touched</h2>
        <UnifiedSearch initialQuery={q} />
      </section>

      <SearchResultsIsland q={q} initial={results} initialError={searchError} />
      {/* NEYNAR AS A SWITCH (SECURITY-POSTURE.md §42): after the device's own results, posts and people via Neynar when the
          operator switched search to Neynar (or why not); the browser device answers it, the rig renders nothing */}
      <NetworkSearchIsland q={q} />
      <div className="h-24" />
    </>
  );
}
