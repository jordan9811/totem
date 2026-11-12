"use client";
// FROM X — the profile's history shelf. Imports are HISTORY, not fresh content: they render here with their ORIGINAL
// dates, never in anyone's feed, UNLESS the owner explicitly shows a post as new in their Totem feed (UX Gate 0).
// The resurface buttons are a small island (ResurfaceControls) that owns only the mutation + refresh.
//
// PROD-LIVE (D-CU-0-4): the shelf arrives as an ImportedView (lib/views/social.ts) computed with the rest of the
// profile — by the server on the rig, by the browser device on a public deployment (/api/profile).
//
// PERSONA LAUNCH P2 (BYX G3/G6):
//   - an unreadable shelf is SAID ("Your X history couldn't be read: …"), never drawn as an empty shelf;
//   - a big archive arrives a page at a time ("Show more"); retweets are hidden by default (a chip shows them), replies
//     are shown (a chip hides them) — the next pages come from GET /api/x/import?view=shelf, the same computation;
//   - the attribution line says how the archive is linked to this persona, in the server's three words: "verified on
//     Farcaster", "test link, not verified", or "self-supplied archive, unverified".
import { useState } from "react";
import type { ImportedRow, ImportedView, ShelfPageView } from "@/lib/views/social";
import { ResurfaceAllControl, ResurfaceToggle } from "./ResurfaceControls";

export function ImportedFromX({ imported, isOwn }: { imported: ImportedView | null; isOwn: boolean }) {
  const [extra, setExtra] = useState<{ key: string; rows: ImportedRow[]; nextOffset: number | null; shown: number } | null>(null);
  const [showRetweets, setShowRetweets] = useState(false);
  const [showReplies, setShowReplies] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  if (!imported) return null;
  if (imported.status === "error") {
    return (
      <div data-testid="imported-from-x" data-state="error" className="border-t-4 border-x-border px-4 py-3">
        <p className="text-[15px] font-extrabold">From X</p>
        <p className="mt-1 text-[13px] text-[#f4212e]" data-testid="shelf-error">
          Your X history couldn&rsquo;t be read: {imported.error}
        </p>
      </div>
    );
  }
  if (imported.posts.length === 0 && imported.counts.total === 0) return null;
  const { handle, unlinked, anyResurfaced, counts } = imported;
  const viewKey = `${imported.personaId}|${showRetweets ? 1 : 0}|${showReplies ? 1 : 0}`;
  const defaultView = !showRetweets && showReplies;
  // the first page is the view's own for the default filter; a changed filter or "Show more" fetches pages
  const rows: ImportedRow[] = extra && extra.key === viewKey ? extra.rows : defaultView ? imported.posts : [];
  const nextOffset = extra && extra.key === viewKey ? extra.nextOffset : defaultView ? imported.nextOffset : 0;

  const load = async (retweets: boolean, replies: boolean, offset: number, append: boolean) => {
    setBusy(true);
    setPageError(null);
    try {
      const qs = new URLSearchParams({ view: "shelf", personaId: imported.personaId, offset: String(offset), retweets: retweets ? "1" : "0", replies: replies ? "1" : "0" });
      const res = await fetch("/api/x/import?" + qs.toString(), { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as (ShelfPageView & { error?: string }) | null;
      if (!res.ok || !j || !Array.isArray(j.rows)) throw new Error((j && typeof j.error === "string" && j.error) || `HTTP ${res.status}`);
      const key = `${imported.personaId}|${retweets ? 1 : 0}|${replies ? 1 : 0}`;
      const base = append && extra && extra.key === key ? extra.rows : append && retweets === false && replies === true ? imported.posts : [];
      setExtra({ key, rows: base.concat(j.rows), nextOffset: j.nextOffset, shown: j.shown });
    } catch (e) {
      setPageError(`Couldn't load more of your X history: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const setFilter = (retweets: boolean, replies: boolean) => {
    setShowRetweets(retweets);
    setShowReplies(replies);
    if (!retweets && replies) setExtra(null);
    else void load(retweets, replies, 0, false);
  };

  return (
    <div data-testid="imported-from-x" data-state="ok" className="border-t-4 border-x-border">
      <div className="border-b border-x-border px-4 py-2.5">
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-extrabold">From X</p>
          {isOwn && <ResurfaceAllControl anyResurfaced={anyResurfaced} />}
        </div>
        <p className="text-[13px] text-x-sec" data-testid="import-attribution" data-attribution={imported.attribution}>
          @{handle} ·{" "}
          {imported.attribution === "verified" ? (
            <span data-testid="import-verified">verified on Farcaster</span>
          ) : imported.attribution === "test-link" ? (
            <span data-testid="import-test-link">test link, not verified</span>
          ) : (
            <span data-testid="import-unverified">self-supplied archive, unverified</span>
          )}
          {unlinked && <span data-testid="import-source-unlinked"> · source unlinked</span>}
        </p>
        <p className="mt-0.5 text-[13px] text-x-sec" data-testid="shelf-counts" data-total={counts.total} data-retweets={counts.retweets}>
          {(counts.total - counts.retweets).toLocaleString("en-US")} posts from X
          {counts.retweets > 0 && !showRetweets ? ` · ${counts.retweets.toLocaleString("en-US")} retweets hidden` : ""}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {counts.retweets > 0 && (
            <button
              data-testid="shelf-show-retweets"
              data-on={showRetweets ? "true" : "false"}
              disabled={busy}
              onClick={() => setFilter(!showRetweets, showReplies)}
              className="h-7 rounded-full border border-[#cfd9de] px-3 text-[12px] font-bold text-x-sec hover:bg-x-hover"
            >
              {showRetweets ? "Hide retweets" : `Show retweets (${counts.retweets.toLocaleString("en-US")})`}
            </button>
          )}
          {counts.replies > 0 && (
            <button
              data-testid="shelf-hide-replies"
              data-on={showReplies ? "true" : "false"}
              disabled={busy}
              onClick={() => setFilter(showRetweets, !showReplies)}
              className="h-7 rounded-full border border-[#cfd9de] px-3 text-[12px] font-bold text-x-sec hover:bg-x-hover"
            >
              {showReplies ? "Hide replies" : `Show replies (${counts.replies.toLocaleString("en-US")})`}
            </button>
          )}
        </div>
        {isOwn && (
          <p className="mt-1 text-[12px] text-x-sec">
            History by default, with the dates it had on X. You can show a post as new in your own Totem feed, one at a
            time or all at once; that stays in Totem and posts nothing anywhere.
          </p>
        )}
      </div>
      {rows.map((p) => (
        <div key={p.id} data-testid="imported-post" data-xid={p.id} data-resurfaced={p.resurfaced ? "true" : "false"} data-retweet={p.isRetweet ? "true" : "false"} className="border-b border-x-border px-4 py-3">
          <p className="text-[15px] leading-5">{p.text}</p>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-[13px] text-x-sec">
              <span data-testid="imported-post-date">{p.date}</span> on X ·{" "}
              {p.likes} likes · {p.reposts} reposts
              {p.isReply && " · reply"}
              {p.isRetweet && " · retweet"}
            </p>
            {isOwn && <ResurfaceToggle tweetId={p.id} resurfaced={p.resurfaced} />}
          </div>
        </div>
      ))}
      {pageError && (
        <p className="px-4 py-2 text-[13px] text-[#f4212e]" data-testid="shelf-page-error">
          {pageError}
        </p>
      )}
      {nextOffset !== null && (
        <button
          data-testid="shelf-more"
          disabled={busy}
          onClick={() => void load(showRetweets, showReplies, nextOffset ?? 0, true)}
          className="w-full px-4 py-3 text-left text-[14px] font-bold text-x-blue hover:bg-x-hover"
        >
          {busy ? "Loading…" : "Show more"}
        </button>
      )}
    </div>
  );
}
