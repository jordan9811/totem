"use client";
// Feed-health card variants. Each wraps the existing CastCard chrome with a
// small attribution header, matching X's existing "reposted by" line
// treatment (13px bold, x-sec, 26px left indent) so nothing looks bolted on.
import { useState } from "react";
import Link from "next/link";
import type { FeedCard } from "@/lib/feed";
import { CastCard, MediaImg, isNetworkCast } from "./CastCard";
import { BookmarkFilled, RepostIcon } from "./icons";
import { TierBadge } from "./TierBadge";
import { AdCard } from "./market/AdCard";
import { ReadwiseChunk } from "./ReadwiseChunk";

function AttributionLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center pl-[26px] pt-2 text-[13px] font-bold leading-4 text-x-sec">
      <span className="mr-2 flex">{icon}</span>
      {children}
    </p>
  );
}

/** FC-READ: the read path may tag the CARD `network` rather than its cast — carried onto the cast, so CastCard (which
 *  only sees the cast) disables the write controls and guards the media either way */
function withNetwork(card: FeedCard): FeedCard {
  if ((card as FeedCard & { network?: boolean }).network !== true) return card;
  if ((card.cast as FeedCard["cast"] & { network?: boolean }).network === true) return card;
  return { ...card, cast: { ...card.cast, network: true } as FeedCard["cast"] };
}

export function FeedCardView({
  card: rawCard,
  onCaughtUp,
  storyId,
  relaySourced = false,
}: {
  card: FeedCard;
  onCaughtUp?: (storyId: string) => void;
  storyId?: string | null;
  /** FC-READ: this timeline's base came from the public read relay (its liveSource.source is "relay") */
  relaySourced?: boolean;
}) {
  const card = withNetwork(rawCard);
  if (card.kind === "readwise") {
    return (
      <div data-testid="readwise-card" data-chunk={card.chunkIndex} data-readwise-source={card.readwiseSource ?? "bookmarks"}>
        <ReadwiseChunk chunkId={card.cast.hash} priority={card.readwisePriority}>
          <AttributionLine icon={<BookmarkFilled size={16} />}>
            From {card.readwiseSource ?? "your bookmarks"} · {card.chunkIndex}/{card.chunkTotal}
          </AttributionLine>
          <CastCard cast={card.cast} />
        </ReadwiseChunk>
      </div>
    );
  }

  if (card.kind === "sent") {
    return (
      <div data-testid="sent-card">
        <AttributionLine
          icon={
            <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor">
              <path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" />
            </svg>
          }
        >
          Sent by @{card.sentByHandle}
        </AttributionLine>
        <CastCard cast={card.cast} />
      </div>
    );
  }

  if (card.kind === "correction" && card.curatorName) {
    return <CuratorCorrectionCard card={card} />;
  }

  if (card.kind === "correction") {
    return (
      <div data-testid="correction-card">
        <AttributionLine
          icon={
            <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor">
              <path d="M12 1.75L1.75 8.5v9.75h20.5V8.5L12 1.75zm0 2.4l8.25 5.44v6.66H3.75V9.59L12 4.15zM11 9h2v5h-2V9zm0 6h2v2h-2v-2z" />
            </svg>
          }
        >
          Community note added since you engaged
        </AttributionLine>
        <div className="border-b border-x-border">
          <div className="[&>article]:border-b-0">
            <CastCard cast={card.cast} />
          </div>
          <div className="mx-4 mb-3 rounded-2xl border border-x-border bg-[#f7f9f9] p-3">
            <p className="text-[13px] font-bold leading-4 text-x-sec">
              Readers added context · note by @{card.noteAuthorHandle}
            </p>
            <p className="mt-1 text-[15px] leading-5">{card.noteText}</p>
          </div>
        </div>
      </div>
    );
  }

  if (card.kind === "migration") {
    // the deferred auto-follow moment: someone joined, or people were
    // waiting for you. An explanation of a change that already happened.
    return (
      <div
        data-testid="migration-card"
        data-migration-kind={card.migrationKind}
        className="border-b border-x-border px-4 py-3"
      >
        <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">
          {card.migrationKind === "waiting" ? "Welcome back" : "From your X list"}
        </p>
        <p className="mt-1 text-[15px] leading-5">{card.migrationText}</p>
      </div>
    );
  }

  if (card.kind === "resurfaced") {
    // UX Gate 0: an explicitly-promoted X import. It behaves as a real post
    // (fresh timestamp, enters the ranked feed) but stays labeled — the
    // same provenance-never-silently-blended discipline as "Imported from
    // X" itself, just inline instead of on the profile shelf.
    return (
      <div data-testid="resurfaced-card">
        <AttributionLine
          icon={
            <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor">
              <path d="M18.36 5.64c-1.95-1.96-5.11-1.96-7.07 0L9.88 7.05 8.46 5.64l1.42-1.42c2.73-2.73 7.16-2.73 9.9 0 2.73 2.74 2.73 7.17 0 9.9l-1.42 1.42-1.41-1.42 1.41-1.41c1.96-1.96 1.96-5.12 0-7.07zm-2.12 3.53l-7.07 7.07-1.41-1.41 7.07-7.07 1.41 1.41zm-12.02.35l1.42-1.42 1.41 1.42-1.41 1.41c-1.96 1.96-1.96 5.12 0 7.07 1.95 1.96 5.11 1.96 7.07 0l1.41-1.41 1.42 1.41-1.42 1.42c-2.73 2.73-7.16 2.73-9.9 0-2.73-2.74-2.73-7.17 0-9.9z" />
            </svg>
          }
        >
          Resurfaced from your X import
        </AttributionLine>
        <CastCard cast={card.cast} />
      </div>
    );
  }

  if (card.kind === "caughtup") {
    // The hard stop. Everything below this line is reading material the user
    // chose (bookmarks, followed folders) — never ranked backfill.
    return (
      <div data-testid="caughtup-banner" className="border-b border-x-border px-4 py-8 text-center">
        <p className="text-[20px] font-extrabold leading-6 text-x-text">You&rsquo;re caught up.</p>
        <p className="mt-1 text-[15px] leading-5 text-x-sec">
          Enjoy your longform — your bookmarks and folders pick up from here.
        </p>
      </div>
    );
  }

  if (card.kind === "post" && card.private) {
    // Badge-marked, per the gate. A private post sits INLINE in the timeline
    // rather than in a separate section — that is the product claim — so the
    // only thing distinguishing it is this line, and it has to be present.
    return (
      <div data-testid="private-card">
        <AttributionLine
          icon={
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8}>
              <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
              <path d="M8 10.5V7.6a4 4 0 018 0v2.9" />
            </svg>
          }
        >
          <span data-testid="private-badge">Shared with you &middot; not public</span>
        </AttributionLine>
        <CastCard cast={card.cast} />
      </div>
    );
  }

  if (card.kind === "moved" && card.moved) {
    // The payoff card. Only rendered for a viewer named on a forward grant —
    // the gate is in the feed builder, not here, so this component never
    // needs to know who is allowed to see it. It cannot leak what it is
    // never handed.
    const m = card.moved;
    return (
      <div data-testid="moved-card" data-to={m.toPersonaId} className="border-b border-x-border px-4 py-3">
        <AttributionLine
          icon={
            <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor">
              <path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" />
            </svg>
          }
        >
          Someone you follow moved accounts
        </AttributionLine>
        <div className="mt-2 rounded-2xl border border-x-border p-3">
          <div className="flex items-center">
            <MediaImg src={m.toAvatarUrl} className="mr-3 h-12 w-12 shrink-0 rounded-full object-cover" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold leading-5 text-x-text">{m.toName}</p>
              <p className="truncate text-[15px] leading-5 text-x-sec">@{m.toHandle}</p>
            </div>
            {/* PROD-LIVE (D-CU-0-4): a client navigation — a full document load wipes an unsaved visitor identity */}
            <Link
              href={"/" + m.toHandle}
              prefetch={false}
              data-testid="moved-follow"
              className="ml-auto shrink-0 rounded-full bg-x-text px-4 py-1.5 text-[15px] font-bold text-x-bg"
            >
              View
            </Link>
          </div>
          <p className="mt-3 text-[15px] leading-5 text-x-sec">
            <span className="font-bold text-x-text">@{m.fromHandle}</span> moved here. You are seeing
            this because they chose to bring you with them — it was not announced publicly.
          </p>
        </div>
      </div>
    );
  }

  if (card.kind === "ad") {
    return <AdCard card={card} />;
  }

  if (card.kind === "folder") {
    return (
      <div data-testid="folder-card" data-folder={card.folderId}>
        <AttributionLine icon={<BookmarkFilled size={16} />}>
          Added to {card.folderName} by @{card.folderCuratorHandle}
        </AttributionLine>
        <CastCard cast={card.cast} />
      </div>
    );
  }

  if (card.kind === "highlight") {
    return (
      <div data-testid="highlight-card" data-room={card.roomId}>
        <AttributionLine
          icon={
            <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor">
              <path d="M12 2l2.4 6.1L21 9l-4.8 4.3L17.6 20 12 16.6 6.4 20l1.4-6.7L3 9l6.6-.9L12 2z" />
            </svg>
          }
        >
          Highlights from {card.roomTitle}
        </AttributionLine>
        <article className="border-b border-x-border px-4 pb-3 pt-1">
          {/* Full attribution on every highlighted message — a nobody's
              highlighted line carries the same identity treatment as the
              host's. That is the upward-mobility mechanic, not a detail. */}
          {card.highlights?.map((h, i) => (
            <div
              key={i}
              data-testid="highlight-entry"
              data-handle={h.handle}
              className="mt-2 flex rounded-2xl border border-x-border p-3"
            >
              <MediaImg src={h.avatarUrl} className="mr-2 h-10 w-10 shrink-0 rounded-full object-cover" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center text-[15px] leading-5">
                  <span className="truncate font-bold hover:underline">{h.name}</span>
                  <span className="ml-1 truncate text-x-sec">@{h.handle}</span>
                  <TierBadge tier={h.tier} />
                </p>
                <p className="mt-0.5 text-[15px] leading-5">{h.text}</p>
              </div>
            </div>
          ))}
        </article>
      </div>
    );
  }

  if (relaySourced && (card.anon || card.cast.anon) && !isNetworkCast(card.cast)) {
    // FC-READ: an anon post relayed through the FIXTURE anon relay sits in a timeline of real Farcaster casts. It was
    // never posted to Farcaster, so it says so — the "anon" account chip alone read as one more network cast.
    return (
      <div data-testid="preview-only">
        <AttributionLine
          icon={
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        >
          Preview only &middot; not posted to Farcaster
        </AttributionLine>
        <CastCard cast={card.cast} />
      </div>
    );
  }

  // plain post — with the "I'm caught up" control when story-tagged
  return (
    <div>
      <CastCard cast={card.cast} />
      {storyId && onCaughtUp && (
        <div className="-mt-px flex items-center justify-between border-b border-x-border px-4 py-2">
          <span className="text-[13px] leading-4 text-x-sec">You&rsquo;re seeing this because it&rsquo;s a developing story</span>
          <button
            data-testid="caught-up"
            onClick={() => onCaughtUp(storyId)}
            className="h-7 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover"
          >
            I&rsquo;m caught up
          </button>
        </div>
      )}
    </div>
  );
}

export function DebunkIndicator({ source }: { source?: string }) {
  return (
    <p
      data-testid="debunk-indicator"
      className="flex items-center border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec"
    >
      <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" className="mr-2 shrink-0">
        <path d="M12 3.75c-4.55 0-8.25 3.69-8.25 8.25 0 1.92.66 3.68 1.75 5.08L17.08 5.5c-1.4-1.1-3.16-1.75-5.08-1.75zm5.08 3.16L5.5 18.5c1.4 1.1 3.16 1.75 5.08 1.75 4.56 0 8.25-3.69 8.25-8.25 0-1.92-.65-3.68-1.75-5.09z" />
      </svg>
      This story has been corrected
      {source && source !== "Community note" ? (
        <span data-testid="debunk-source" className="ml-1 font-bold">
          by {source}
        </span>
      ) : (
        ""
      )}
      .
      <a href="#" className="ml-1 text-x-blue hover:underline">
        See the correction
      </a>
    </p>
  );
}


function CuratorCorrectionCard({ card }: { card: FeedCard }) {
  return (
    <div data-testid="correction-card" data-curator={card.curatorName}>
      <AttributionLine
        icon={
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="8.5" />
          </svg>
        }
      >
        <span data-testid="curator-tag">Annotation from {card.curatorName}</span>
      </AttributionLine>
      <div className="border-b border-x-border px-4 pb-3">
        <div className="mt-1 rounded-xl border border-x-border p-3">
          <p className="text-[15px] leading-5 text-x-text">{card.noteText}</p>
          {/* PROD-LIVE (review fix): the evidence is someone else's site. A same-tab <a> navigated this tab away,
              and on a public deployment an unsaved visitor identity lives only in this tab — so it opens in a new
              one (noopener: the evidence page gets no handle on this window; noreferrer: nor the URL it came from).
              The link is a curator's free text, so only an http(s) URL is ever made clickable — a javascript: or
              data: "link" renders as the text it is. The testid is the same either way. */}
          {card.evidenceLink &&
            (/^https?:\/\//i.test(card.evidenceLink) ? (
              <a
                href={card.evidenceLink}
                target="_blank"
                rel="noreferrer noopener"
                data-testid="evidence-link"
                className="mt-1 block truncate text-[13px] text-x-blue hover:underline"
              >
                {card.evidenceLink}
              </a>
            ) : (
              <span data-testid="evidence-link" className="mt-1 block truncate text-[13px] text-x-sec">
                {card.evidenceLink}
              </span>
            ))}
          {card.annotationId && <AnnotationVoteRow annotationId={card.annotationId} />}
        </div>
        <CastCard cast={card.cast} />
      </div>
    </div>
  );
}

/** One-tap "was this actually unaddressed?" — feeds the per-curator
 * accuracy tally shown in subscription settings. */
function AnnotationVoteRow({ annotationId }: { annotationId: string }) {
  const [tally, setTally] = useState<{ concur: number; dispute: number } | null>(null);
  const [busy, setBusy] = useState(false);
  async function vote(v: "concur" | "dispute") {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/annotations/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotationId, vote: v }),
      });
      const j = await r.json();
      if (r.ok) setTally(j.tally);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 flex items-center gap-2 text-[13px]">
      <span className="text-x-sec">Was this addressed?</span>
      <button
        data-testid="annotation-concur"
        onClick={(e) => {
          e.stopPropagation();
          vote("concur");
        }}
        className="rounded-full border border-x-border px-2.5 py-0.5 font-bold text-x-sec hover:bg-x-hover"
      >
        Holds{tally ? ` · ${tally.concur}` : ""}
      </button>
      <button
        data-testid="annotation-dispute"
        onClick={(e) => {
          e.stopPropagation();
          vote("dispute");
        }}
        className="rounded-full border border-x-border px-2.5 py-0.5 font-bold text-x-sec hover:bg-x-hover"
      >
        Disputed{tally ? ` · ${tally.dispute}` : ""}
      </button>
    </div>
  );
}
