"use client";
// PROD-LIVE PASS (D-CU-0-4) — the permalink page's body: the cast, the reply composer and the thread.
//
// Everything here is viewer-scoped: the persona layer (shared-FID attribution, a granted viewer's merged identity),
// the curator-attested refutations (from the feeds THIS persona subscribes to), and — for a visitor's own fresh
// cast — whether the cast exists at all, since it lives only in the browser device's store. So:
//   * RIG: the server computes the thread (lib/views/social.server.ts threadView) exactly as before and hands it in
//     as `initial`; nothing is fetched and the DOM is unchanged;
//   * PUBLIC: this island fetches /api/thread?hash=, which the device answers in the browser.
// A failed read is an error with a Retry; an unknown hash says so, it is never an empty thread.
import Link from "next/link";
import { useApiJson } from "@/lib/client/useApiJson";
import { useApp } from "@/components/Providers";
import { CAST_MISSING, livePausedSentence, type ThreadView } from "@/lib/views/social";
import { formatCount } from "@/lib/format";
import { ActionRow, CastCard, CastEmbeds, MediaImg, NetworkMarker, RichText, isNetworkCast, networkReadOnlySentence } from "@/components/CastCard";
import { LiveSourceChip, readLiveSource } from "@/components/SeededTimeline";
import { EmbedList } from "@/components/EmbedList";
import { Composer } from "@/components/Composer";
import { TierBadge } from "@/components/TierBadge";
import { TimelineSkeleton } from "@/components/Skeletons";
import { VerifiedBadge, KebabIcon } from "@/components/icons";

export function ThreadIsland({ hash, initial }: { hash: string; initial: ThreadView | null }) {
  const { deviceIsThePage, refresh } = useApp();
  const thread = useApiJson<ThreadView>(`/api/thread?hash=${encodeURIComponent(hash)}`, { initial });
  const retry = deviceIsThePage ? thread.reload : refresh;

  // PROD-LIVE (review fix): the error is checked before the data — a failed re-read never leaves the previous
  // thread on screen without a word (useApiJson drops the data on a failed re-read; this is the island's half)
  if (thread.error || !thread.data) {
    if (thread.error === CAST_MISSING) {
      return (
        <div data-testid="permalink-not-found" className="px-8 py-10">
          <p className="text-[31px] font-extrabold leading-9">This post doesn&rsquo;t exist</p>
          <p className="mt-2 text-[15px] leading-5 text-x-sec">
            It may have been deleted, or it was never shared with you.{" "}
            <Link href="/home" className="text-x-blue hover:underline">
              Back to your timeline
            </Link>
            .
          </p>
        </div>
      );
    }
    // FC-READ (review, correctness-paused-relay-renders-load-error-needle): a network cast the read relay did not
    // answer (switched off, budget spent, rate-limited, the provider down, a framed page) is not a broken page. The
    // route answers 503 {error, code} with one of the relay's fixed sentences; that sentence (a closed table shared
    // with the device, lib/views/social.ts) renders as the paused state with a Retry — never inside the generic
    // load-error block below, whose "Couldn't load" is a page-health needle and whose testid reads as an error.
    const paused = livePausedSentence(thread.error);
    if (paused) {
      return (
        <div data-testid="live-paused" role="status" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
          {paused}
          <button type="button" data-testid="live-paused-retry" onClick={retry} className="ml-2 font-bold text-x-blue hover:underline">
            Retry
          </button>
        </div>
      );
    }
    if (thread.error) {
      return (
        <p data-testid="permalink-error" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
          Couldn&rsquo;t load this post right now ({thread.error}).
          <button type="button" data-testid="permalink-retry" onClick={retry} className="ml-2 font-bold text-x-blue hover:underline">
            Retry
          </button>
        </p>
      );
    }
    return (
      <div data-testid="permalink-loading" aria-busy="true">
        <TimelineSkeleton count={3} />
      </div>
    );
  }

  const { cast, replies } = thread.data;
  // FC-READ: a network root (read through the public relay) renders its avatar and embeds through the network-safe
  // image path — no referrer, lazy, click-to-load off the allowlist. A local/seed root keeps EmbedList as it was.
  const network = isNetworkCast(cast) || (thread.data as { network?: unknown }).network === true;
  // Refutation chains render distinctly from ordinary replies: a
  // reply that declares (or is curator-attested as) a refutation of
  // THIS cast gets the treatment. Author-declared and desk-attested
  // are labelled differently — testimony vs a checked claim.
  const refuters = new Map(thread.data.refuters);
  // FC-READ (review, privacy-safety-3): the relay's freshness for this thread (live, or off a shelf) — the same chip
  // the timelines render; absent (no chip) for every local/seed thread and on every rig
  const liveSource = readLiveSource(thread.data.liveSource);

  return (
    <>
      <LiveSourceChip liveSource={liveSource} />
      {/* FC-READ: a live root carries the same marks a live timeline card does (data-live, data-hash), so every rule
          keyed on "this is network content" — the page-health needle scan, the tests — sees the thread's root too */}
      <article className="px-4 pt-3" data-testid="permalink-cast" data-hash={cast.hash} data-live={network ? "true" : undefined}>
        <div className="flex items-start justify-between">
          <div className="flex min-w-0">
            <MediaImg src={cast.author.pfpUrl} network={network} avatar className="mr-2 h-10 w-10 rounded-full object-cover" placeholderClassName="mr-2 h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0">
              <p className="flex items-center text-[15px] font-bold leading-5">
                <span className="truncate hover:underline">{cast.author.displayName}</span>
                {cast.author.verified && <VerifiedBadge size={18.75} className="ml-0.5 shrink-0" />}
                <TierBadge tier={cast.tier} />
              </p>
              <p className="text-[15px] leading-5 text-x-sec">@{cast.author.username}</p>
              {/* FC-READ (review, privacy-safety-4): the root's own visible mark */}
              {network && <NetworkMarker className="mt-0.5" />}
            </div>
          </div>
          <button className="-mr-2 flex h-[34.75px] w-[34.75px] items-center justify-center rounded-full text-x-sec hover:bg-[#1d9bf01a] hover:text-x-blue">
            <KebabIcon size={18.75} />
          </button>
        </div>
        <RichText text={cast.text} className="mt-3 block text-[17px] leading-6" />
        {network ? <CastEmbeds embeds={cast.embeds} network /> : <EmbedList embeds={cast.embeds} />}
        <p className="border-b border-x-border py-4 text-[15px] leading-5 text-x-sec">
          <span className="hover:underline">{thread.data.permalinkTime}</span>
          {/* Farcaster has no impression metric. In live mode this is absent
              rather than zero — a fabricated "0 Views" on a real cast would
              be the one number on the page that is not true. */}
          {typeof cast.views === "number" && (
            <>
              <span className="mx-1">·</span>
              <span className="font-bold text-x-text">{formatCount(cast.views)}</span> Views
            </>
          )}
        </p>
        <div className="border-b border-x-border py-1">
          <ActionRow cast={cast} large showViews={false} />
        </div>
      </article>
      {/* PROD-LIVE: on a public deployment the new reply exists only in the device's store, so the thread is re-read
          from the device after posting (the rig's router.refresh() re-renders it on the server, as before) */}
      {network ? (
        // FC-READ: a reply to a live Farcaster cast is a network write this preview does not make — say so up front
        // instead of letting the visitor type a reply that the route then refuses (403 NETWORK_READ_ONLY)
        <p data-testid="reply-read-only" className="border-b border-x-border px-4 py-3 text-[15px] leading-5 text-x-sec">
          {networkReadOnlySentence()}
        </p>
      ) : (
        <Composer
          placeholder="Post your reply"
          buttonLabel="Reply"
          compact
          collapsedUntilFocus
          replyToHash={cast.hash}
          onPosted={deviceIsThePage ? thread.reload : undefined}
        />
      )}
      <div data-testid="replies">
        {replies.map((reply, i) => {
          const nextIsContinuation = i + 1 < replies.length && replies[i + 1].parentIsSelf;
          const refutes = refuters.get(reply.hash);
          const card = (
            <CastCard
              key={reply.hash}
              cast={reply}
              connectorBelow={!!nextIsContinuation}
              connectorAbove={!!reply.parentIsSelf}
            />
          );
          if (!refutes) return card;
          return (
            <div
              key={reply.hash}
              data-testid="refutation-reply"
              data-declared-by={refutes}
              className="border-l-2 border-[#f4212e66]"
            >
              <p className="flex items-center px-4 pt-2 text-[13px] font-bold leading-4 text-[#f4212e]">
                <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} className="mr-1.5">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
                {refutes === "curator" ? "Attested refutation" : "Marked as refutation by its author"}
              </p>
              {card}
            </div>
          );
        })}
        <div className="h-32" />
      </div>
    </>
  );
}
