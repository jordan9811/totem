"use client";
// PROD-LIVE PASS (D-CU-0-4) — the public search results (people, posts, channels), as a client island.
//
// Every row is authorized for the VIEWER inside search(): their blocks, the channels they are a member of, the
// private posts shared with them, and PersonaResolver's answer for each person row. A public deployment's server has
// no viewer (it would have searched as the fixture persona — someone else's grants, someone else's channels), so
// there this island fetches /api/search?q= and the browser device answers it with the visitor as the viewer. On the
// rig the server searches exactly as before and hands the results in as `initial`.
import Link from "next/link";
import { useApiJson } from "@/lib/client/useApiJson";
import { useApp } from "@/components/Providers";
import type { SearchResults, SearchSection } from "@/lib/search";
import { TimelineSkeleton } from "@/components/Skeletons";
import { SourceLabel } from "@/components/source/SourceLabel";

/** PROD-LIVE (review fix): what the page says for each part of an answer that could not be read */
const UNAVAILABLE_TEXT: Record<SearchSection, string> = {
  channels: "Channels couldn’t be searched right now, so none are listed.",
  channelPosts: "Your channel memberships couldn’t be read, so posts in channels are left out.",
  // (worded without "shared with you": that is the private-result badge's text, and a suite reads its presence on an
  // outsider's page as a leak)
  sharedPosts: "Some posts you were given access to couldn’t be read, so they are left out.",
};

export function SearchResultsIsland({
  q,
  initial,
  initialError = null,
}: {
  q: string;
  initial: SearchResults | null;
  /** PROD-LIVE (review fix): the rig's server search failed (its block list could not be read) — draw the error
   *  with a Retry, and do not quietly re-run the search from here; the Retry re-renders the server */
  initialError?: string | null;
}) {
  const { deviceIsThePage, refresh } = useApp();
  const found = useApiJson<SearchResults>(q && !initialError ? `/api/search?q=${encodeURIComponent(q)}` : null, {
    initial,
  });
  const retry = deviceIsThePage ? found.reload : refresh;
  // an empty query asks nothing, so there is nothing to show (the page renders its hint instead)
  if (!q) return null;

  // PROD-LIVE (review fix): the error is checked BEFORE the data — a failed re-read never leaves the previous answer
  // on screen without a word. A failed block-list read is such an error: /api/search answers 503 rather than
  // results that include accounts you blocked (lib/search.ts).
  const error = initialError ?? found.error;
  if (error) {
    return (
      <p data-testid="search-error" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
        Couldn&rsquo;t search right now ({error}).
        <button type="button" data-testid="search-retry" onClick={retry} className="ml-2 font-bold text-x-blue hover:underline">
          Retry
        </button>
      </p>
    );
  }
  // results for a previous query are not results for this one (useApiJson drops an answer to another URL; this also
  // covers the server's copy on the rig)
  const results = found.data && found.data.query === q ? found.data : null;
  if (!results) {
    return (
      <div data-testid="search-loading" aria-busy="true">
        <TimelineSkeleton count={3} />
      </div>
    );
  }

  const empty = !results.posts.length && !results.people.length && !results.channels.length;
  // PROD-LIVE (review fix): the parts that could not be read, said out loud (a channel read that failed used to
  // drop the channels silently — "no channel matched" and "channels could not be read" looked the same)
  const unavailable = Array.isArray(results.unavailable)
    ? results.unavailable.filter((s): s is SearchSection => s in UNAVAILABLE_TEXT)
    : [];
  return (
    <>
      {/* NEYNAR AS A SWITCH (§42): every result says where it came from — these are what this device holds */}
      <p data-testid="search-source" data-source="device" className="px-4 pt-3 text-[13px] leading-4">
        <SourceLabel source="device" testid="search-source-label" />
      </p>
      {unavailable.length > 0 && (
        <p
          data-testid="search-incomplete"
          data-sections={unavailable.join(" ")}
          className="border-b border-x-border px-4 py-3 text-[15px] leading-5 text-x-sec"
        >
          {unavailable.map((s) => UNAVAILABLE_TEXT[s]).join(" ")}
          <button type="button" data-testid="search-incomplete-retry" onClick={retry} className="ml-2 font-bold text-x-blue hover:underline">
            Retry
          </button>
        </p>
      )}
      {empty && (
        // Deliberately identical wording whether nothing matched or something
        // matched that this viewer may not have. Distinguishing the two would
        // turn search into an oracle you can query about hidden things.
        <p data-testid="search-empty" className="px-4 py-8 text-[15px] leading-5 text-x-sec">
          No results for <span className="font-bold text-x-text">{q}</span>.
        </p>
      )}

      {results.people.length > 0 && (
        <section data-testid="search-people">
          <h2 className="px-4 pt-4 text-[20px] font-extrabold leading-6 text-x-text">People</h2>
          {results.people.map((p) => (
            <Link
              key={p.personaId}
              href={"/" + p.handle}
              data-testid="search-person"
              data-handle={p.handle}
              className="flex items-center border-b border-x-border px-4 py-3 hover:bg-x-hover"
            >
              <img src={p.avatarUrl} alt="" className="mr-3 h-10 w-10 shrink-0 rounded-full object-cover" />
              <div className="min-w-0">
                <p className="flex items-center truncate text-[15px] font-bold leading-5 text-x-text">
                  {p.displayName}
                </p>
                <p className="truncate text-[15px] leading-5 text-x-sec">@{p.handle}</p>
              </div>
            </Link>
          ))}
        </section>
      )}

      {results.posts.length > 0 && (
        <section data-testid="search-posts">
          <h2 className="px-4 pt-4 text-[20px] font-extrabold leading-6 text-x-text">Posts</h2>
          {results.posts.map((p) => (
            <article
              key={p.hash}
              data-testid="search-post"
              data-private={p.private ? "true" : "false"}
              className="border-b border-x-border px-4 py-3"
            >
              <div className="flex items-center">
                {p.avatarUrl && (
                  <img src={p.avatarUrl} alt="" className="mr-2 h-8 w-8 shrink-0 rounded-full object-cover" />
                )}
                <span className="truncate text-[15px] font-bold leading-5 text-x-text">{p.authorName}</span>
                <span className="ml-1 truncate text-[15px] leading-5 text-x-sec">@{p.authorHandle}</span>
                {p.private && (
                  <span
                    data-testid="search-private-badge"
                    className="ml-2 shrink-0 rounded-full bg-[#1d9bf01a] px-2 py-0.5 text-[11px] font-bold text-x-blue"
                  >
                    Shared with you
                  </span>
                )}
              </div>
              <p className="mt-1 text-[15px] leading-5 text-x-text">{p.text}</p>
            </article>
          ))}
        </section>
      )}

      {results.channels.length > 0 && (
        <section data-testid="search-channels">
          <h2 className="px-4 pt-4 text-[20px] font-extrabold leading-6 text-x-text">Channels</h2>
          {results.channels.map((c) => (
            <Link
              key={c.id}
              href={"/channels/" + c.id}
              data-testid="search-channel"
              className="block border-b border-x-border px-4 py-3 hover:bg-x-hover"
            >
              <p className="text-[15px] font-bold leading-5 text-x-text">{c.name}</p>
              {c.description && (
                <p className="mt-0.5 text-[15px] leading-5 text-x-sec">{c.description}</p>
              )}
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
