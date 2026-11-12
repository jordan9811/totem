"use client";
import React, { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Cast, Embed, User } from "@/lib/types";
import { formatCount, formatFull, relativeTime } from "@/lib/format";
import { hubCastHref, hubProfileHref } from "@/lib/fc/hubRead/copy";
import { localAvatar } from "@/lib/identity/localAvatar";
import { useApp } from "./Providers";
import { TierBadge } from "./TierBadge";
import { FollowButton } from "./FollowButton";
import { ActAsPicker } from "./ActAsPicker";
import { AnonRevealControl } from "./AnonRevealControl";
// PUBLIC GO-LIVE (the relay track): Report on every @anon card (the reports reach the moderators' takedown queue)
import { AnonReportButton } from "./zk/AnonReportButton";
// PERSONA LAUNCH P4: the half-and-half avatar (root left, persona right) and its inline faces
import { Face, SplitAvatar } from "./rings/SplitAvatar";
// PERSONA LAUNCH P5 (reach's line): the reach tier an anon post proved
import { ReachBadge } from "./ReachBadge";
// MEGA PASS 2 Gate 3: bindable action row + reading-layout long-form
import { useActionRow } from "./ActionRowContext";
import { ActionBindingPicker } from "./ActionBindingPicker";
import { CAST_ACTION_LABELS, type CastAction } from "@/lib/actions/bindings";
import { DeliveryTierPicker } from "./DeliveryTierPicker";
import { hubAccountKey } from "@/lib/fc/hubRead/copy";
// POST AS YOU ON HUB CARDS: reply, like, recast (and undo) and Delete as the visitor's own Farcaster account
import { HubReplyComposer, pressedOf, recheckRootWrites, rootCall, useHubReacted, useHubWriteGate } from "./hub/HubWrite";
import { ROOT_CAST_EVENT } from "./hub/hubCall";
import { HubSendToRing } from "./hub/HubSend";
import {
  BookmarkOutline,
  GrokIcon,
  HeartFilled,
  HeartOutline,
  KebabIcon,
  ReplyIcon,
  RepostIcon,
  ShareIcon,
  VerifiedBadge,
  ViewsIcon,
} from "./icons";

// ---------- FC-READ: network casts (public live reads) ----------
//
// On a public deployment whose server holds a read key, the browser device reads real Farcaster casts through the
// server's read relay. Those casts are READ-ONLY here (no write key ships to a public deployment), and the write
// routes refuse them per target with this sentence (lib/fc/networkTarget.ts NETWORK_READ_ONLY — the same words, so
// the tooltip and the server's refusal never disagree). A card that LOOKED writable would click into a 403, so the
// write controls are disabled up front, and the server's refusal still stands behind them.

/** the server's NETWORK_READ_ONLY sentence (lib/fc/networkTarget.ts), shown as the disabled controls' tooltip */
export const NETWORK_READ_ONLY_SENTENCE =
  "Posting to Farcaster isn't on this preview yet. Reading is live; your own posts, folders and private posts still work.";
/** PUBLIC GO-LIVE (onboard F11): the live site's words (lib/fc/networkTarget.ts NETWORK_READ_ONLY_LIVE, the same words) */
export const NETWORK_READ_ONLY_SENTENCE_LIVE =
  "Liking, replying to or recasting Farcaster posts from Totem isn't on this site yet. Reading is live; your own posts, folders and private posts still work.";
/** PUBLIC GO-LIVE (F11): the sentence HERE — the live words when this page's device env says PUBLIC_LIVE=on (the server
 *  hands it only while live), the preview's otherwise. Read like pageReadsThroughRelay: a network card exists only where
 *  the device renders it, so its render and hydration read the same env. */
export function networkReadOnlySentence(): string {
  if (typeof window === "undefined") return NETWORK_READ_ONLY_SENTENCE;
  const env = (window as unknown as { __LAYERS_DEVICE_ENV?: Record<string, string | undefined> }).__LAYERS_DEVICE_ENV;
  return env?.PUBLIC_LIVE === "on" ? NETWORK_READ_ONLY_SENTENCE_LIVE : NETWORK_READ_ONLY_SENTENCE;
}

/** FC-READ: the bindable extras whose routes refuse a network target (stake, folder add, send, act-as) — and, FC-READ
 *  (review, privacy-safety-1), the three that would put a network hash into a SERVER REQUEST PATH: "custom-rule"
 *  (/settings/rules?from=<hash>), "refute" and "note" (/<fname>/status/<hash>?refute=1 / ?note=1). A client navigation
 *  to a force-dynamic page is an RSC request the platform's HTTP log records with the visitor's address — exactly what
 *  the relay's POST body exists to keep out of logs. Disabled here with the same sentence as the other refusals. */
const NETWORK_REFUSED_EXTRAS: ReadonlySet<CastAction> = new Set<CastAction>([
  "stake-as",
  "bookmark-to-folder",
  "send-to-friend",
  "act-as",
  "custom-rule",
  "refute",
  "note",
]);

/**
 * FC-READ (review, privacy-safety-4): the small VISIBLE mark every network surface carries — each data-live card, the
 * network permalink's root and a network profile's header. The timeline chip names the source once per timeline; a
 * card met anywhere else (a profile, a thread, a card scrolled far from the chip) must say on its own face that it is
 * a real Farcaster post this preview only reads. One compact line of 12 px text, so it never crowds the header row on
 * a phone. No page-health needle words.
 */
export function NetworkMarker({ className = "" }: { className?: string }) {
  return (
    <span
      data-testid="network-marker"
      title={networkReadOnlySentence()}
      className={`flex items-center gap-1 text-[12px] leading-4 text-x-sec ${className}`}
    >
      {/* a plain arch — a generic gateway glyph, not a brand asset */}
      <svg aria-hidden="true" viewBox="0 0 24 24" width={12} height={12} fill="currentColor" className="shrink-0">
        <path d="M4 4h16v16h-4v-6a4 4 0 0 0-8 0v6H4z" />
      </svg>
      Farcaster · read-only
    </span>
  );
}

/** FC-READ: whether THIS page's device reads through the public relay — the device env hint the server sets only
 *  while the relay is armed (never the key). False during a server render and on every rig. */
export function pageReadsThroughRelay(): boolean {
  if (typeof window === "undefined") return false;
  const env = (window as unknown as { __LAYERS_DEVICE_ENV?: Record<string, string | undefined> }).__LAYERS_DEVICE_ENV;
  return env?.FC_READ_RELAY === "on";
}

/** FC-READ: a network cast — tagged `network` by the read path, or a live-wire cast (contentPure's `live`) on a page
 *  that reads through the relay (every live cast there came from it). A rig's own live mode (DATA_SOURCE=neynar)
 *  never sets the relay hint, so its cards are untouched. Short-circuits before touching `window` for seed casts,
 *  so a server render and its hydration always agree. */
export function isNetworkCast(cast: Cast): boolean {
  return (cast as Cast & { network?: boolean }).network === true || (cast.live === true && pageReadsThroughRelay());
}

/** PERSONA LAUNCH P6 (UX-L9) — how a "revealed from @anon" reveal can be checked, in plain words. Never "anyone can
 *  check it" while the KeyRegistry it was checked against is the validator's SIMULATED chain: `chainSimulated` absent
 *  counts as simulated (test data is never presented as live). */
export function chainCheckWords(chainSimulated: boolean | undefined, sentence = false): string {
  const words =
    chainSimulated === false
      ? "anyone can check it against the account's registered key"
      : "checkable against the account's registered key (test data: simulated chain)";
  return sentence ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

// FC-READ: any Farcaster user picks their own avatar / embed host, and an <img> from an attacker-chosen host learns
// the visitor's IP and viewing time (A-FCREAD-THIRD-PARTY-MEDIA). Network media loads directly only from the hosts
// Farcaster clients actually use for avatars and uploads (Warpcast's Cloudflare Images, imgur, Cloudinary — the
// recorded corpus in fixtures/neynar and Neynar's own examples) and the seed's fixed hosts; anything else is
// click-to-load. Every image goes out with no referrer and loads lazily.
const MEDIA_HOSTS = ["imagedelivery.net", "i.imgur.com", "res.cloudinary.com", "i.pravatar.cc", "picsum.photos", "api.dicebear.com"];

export function mediaHostAllowed(src: string | undefined | null): boolean {
  if (!src) return true; // nothing to fetch
  if (src.startsWith("data:")) return true; // inline (contentPure's FALLBACK_PFP, the anon avatar)
  if (src.startsWith("/") && !src.startsWith("//")) return true; // same origin
  let host: string;
  try {
    const u = new URL(src);
    if (u.protocol !== "https:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return MEDIA_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

/** PUBLIC GO-LIVE (verify): a persona's picture in the app's own chrome (the account button, the phone drawer, the
 *  composer), through the held-media rule above. A Farcaster public self's picture sits on whatever host that account
 *  chose; an <img> from it would tell that host this visitor's address the moment the chrome draws (in live mode the
 *  public self is the visitor's only roster entry until the first persona, so it IS the active one). A picture on a
 *  host outside MEDIA_HOSTS is drawn on the device instead (lib/identity/localAvatar.ts); no picture stays null (the
 *  caller's blank disc). scripts/accept-onboard-prod.mjs O13 counts zero requests to any non-loopback host. */
export function chromeAvatarSrc(p: { avatarUrl?: string | null; handle?: string | null } | null | undefined): string | null {
  const src = p?.avatarUrl ?? null;
  if (!src) return null;
  return mediaHostAllowed(src) ? src : localAvatar(p?.handle || "persona");
}

function mediaHostLabel(src: string): string {
  try {
    return new URL(src).hostname.replace(/^www\./, "");
  } catch {
    return "another site";
  }
}

/**
 * FC-READ: the one <img> for anything that can show network content. Non-network images render exactly as before
 * (plus no-referrer and lazy loading). A network image from a host outside the allowlist renders a placeholder that
 * loads it only when the visitor asks — the click stays on the placeholder, never opening the post underneath.
 */
export function MediaImg({
  src,
  network = false,
  alt = "",
  className,
  style,
  onClick,
  placeholderClassName,
  avatar = false,
}: {
  src: string;
  network?: boolean;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLImageElement>) => void;
  /** the placeholder's box (defaults to the image's own classes) */
  placeholderClassName?: string;
  /** a round avatar: the placeholder is a blank disc with the host in its tooltip, not a text box */
  avatar?: boolean;
}) {
  const [load, setLoad] = useState(false);
  if (network && !load && !mediaHostAllowed(src)) {
    const host = mediaHostLabel(src);
    return (
      <button
        type="button"
        data-testid="media-click-to-load"
        data-host={host}
        title={`Image from ${host}. Tap to load it (${host} will see your IP address).`}
        onClick={(e) => {
          e.stopPropagation();
          setLoad(true);
        }}
        style={style}
        className={`${placeholderClassName ?? className ?? ""} ${
          avatar ? "block bg-[#cfd9de]" : "flex min-h-[72px] w-full items-center justify-center bg-[#f7f9f9] px-3 py-4 text-[13px] leading-4 text-x-sec hover:bg-x-hover"
        }`}
      >
        {avatar ? <span className="sr-only">Load image from {host}</span> : <span>Image from {host} &middot; tap to load</span>}
      </button>
    );
  }
  return <img src={src} alt={alt} referrerPolicy="no-referrer" loading="lazy" className={className} style={style} onClick={onClick} />;
}

/** FC-READ: the hover card's Follow on a live author — a Farcaster follow this preview cannot make, so it says so
 *  instead of flipping to "Following" with nothing recorded (FollowButton's chrome-only path for persona-less users) */
function NetworkFollowButton() {
  const { toast } = useApp();
  return (
    <button
      type="button"
      data-testid="follow-button"
      data-following="false"
      data-live="true"
      aria-disabled="true"
      title={networkReadOnlySentence()}
      onClick={(e) => {
        e.stopPropagation();
        toast(networkReadOnlySentence());
      }}
      className="h-8 shrink-0 cursor-not-allowed rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white opacity-50"
    >
      Follow
    </button>
  );
}

/** BUILD A: the hover card's Follow on a LIVE Farcaster author read directly (the owner service, a rig's live mode — not
 *  a public preview's relay, which keeps NetworkFollowButton). It used to be FollowButton's chrome-only path: it flipped
 *  to "Following" and recorded nothing anywhere. Now it asks /api/actions/follow, which follows on Farcaster as the
 *  acting persona when that persona owns its own account and writes are armed, and otherwise answers why not — the
 *  button flips only on a real follow. Exported for the profile header's Follow on a live account (`large`). */
export function FarcasterFollowButton({ fid, username, large = false }: { fid: number; username: string; large?: boolean }) {
  const { toast, actingPersonaId, refresh } = useApp();
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/actions/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // BUILD A review (PUB-1): the persona this page was rendered for — the server refuses the follow if another tab
        // has switched the acting persona since (a follow is public, and it is never made as someone not shown here)
        body: JSON.stringify({ targetFid: fid, follow: !following, targetHandle: username, actingPersonaId }),
      });
      const j = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown; delivery?: { message?: unknown } } | null;
      if (res.ok) {
        setFollowing(true);
        toast(j?.delivery && typeof j.delivery.message === "string" ? j.delivery.message : `Following @${username} on Farcaster`);
      } else {
        toast(j && typeof j.error === "string" && j.error ? j.error : "Something went wrong. Try again.");
        if (j?.code === "FC_PERSONA_CHANGED") refresh(); // the page catches up with the persona that is acting now
      }
    } catch {
      toast("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      data-testid="follow-button"
      data-following={following ? "true" : "false"}
      data-farcaster="true"
      aria-busy={busy || undefined}
      onClick={(e) => {
        e.stopPropagation();
        void act();
      }}
      className={`${large ? "h-9 text-[15px]" : "h-8 text-[14px]"} ${
        following
          ? "shrink-0 rounded-full border border-[#cfd9de] bg-white px-4 font-bold text-x-text"
          : "shrink-0 rounded-full bg-x-black-btn px-4 font-bold text-white hover:bg-x-black-btn-hover"
      }`}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

// ---------- text rendering ----------

const TOKEN = /(https?:\/\/\S+|@[A-Za-z0-9_]+|#[A-Za-z0-9_]+|\$[A-Za-z]{2,6}\b)/g;

export function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(TOKEN);
  return (
    <span className={className} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {parts.map((part, i) => {
        if (!part) return null;
        if (/^https?:\/\//.test(part)) {
          const display = part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 33);
          return (
            <a key={i} href="#" onClick={(e) => e.stopPropagation()} className="text-x-blue hover:underline">
              {display}
              {part.replace(/^https?:\/\/(www\.)?/, "").length > 33 ? "…" : ""}
            </a>
          );
        }
        if (/^[@#$]/.test(part) && part.length > 1) {
          return (
            <a key={i} href="#" onClick={(e) => e.stopPropagation()} className="text-x-blue hover:underline">
              {part}
            </a>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </span>
  );
}

// ---------- hover profile card ----------

function ProfileHoverCard({
  user,
  tier,
  personaId,
  castHash,
  network = false,
  live = false,
}: {
  user: User;
  tier?: number;
  personaId?: string;
  castHash?: string;
  network?: boolean;
  /** BUILD A: the author of a live Farcaster cast read directly (its Follow is a Farcaster follow) */
  live?: boolean;
}) {
  return (
    <div className="absolute left-0 top-full z-40 mt-1 w-[300px] cursor-default rounded-2xl bg-white p-4 shadow-[0_0_15px_rgba(101,119,134,0.2),0_0_3px_1px_rgba(101,119,134,0.15)]">
      <div className="flex items-start justify-between">
        <MediaImg src={user.pfpUrl} network={network} avatar className="h-16 w-16 rounded-full object-cover" />
        {/* FC-READ: a live author's Follow would be a Farcaster follow — disabled with the reason, never chrome-only.
            BUILD A: a live author read directly (no persona of ours behind it) follows on Farcaster, or says why not */}
        {network ? (
          <NetworkFollowButton />
        ) : live && !personaId && user.fid > 0 ? (
          <FarcasterFollowButton fid={user.fid} username={user.username} />
        ) : (
          <FollowButton personaId={personaId} triggeringCastId={castHash} context="hover_card" />
        )}
      </div>
      <p className="mt-2 flex items-center text-[17px] font-extrabold leading-5">
        {user.displayName}
        {user.verified && <VerifiedBadge size={18} className="ml-0.5" />}
        <TierBadge tier={tier} />
      </p>
      <p className="text-[15px] leading-5 text-x-sec">@{user.username}</p>
      {user.bio && <p className="mt-2 text-[15px] leading-5">{user.bio}</p>}
      {/* FOLLOWING FROM THE HUB: a Farcaster node keeps no follower counts, so a hub account shows none (never a 0) */}
      {user.hub ? null : (
      <div className="mt-2 flex gap-5 text-[14px] leading-4">
        <span>
          <span className="font-bold">{formatFull(user.followingCount)}</span>
          <span className="text-x-sec"> Following</span>
        </span>
        <span>
          <span className="font-bold">{formatFull(user.followerCount)}</span>
          <span className="text-x-sec"> Followers</span>
        </span>
      </div>
      )}
    </div>
  );
}

function HoverableIdentity({
  personaId,
  castHash,
  user,
  tier,
  children,
  className,
  network = false,
  live = false,
}: {
  user: User;
  tier?: number;
  children: React.ReactNode;
  className?: string;
  personaId?: string;
  castHash?: string;
  /** FC-READ: the author of a network cast (read-only here) */
  network?: boolean;
  /** BUILD A: the author of a live Farcaster cast read directly */
  live?: boolean;
}) {
  const [show, setShow] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  return (
    <span
      className={`relative ${className ?? ""}`}
      onMouseEnter={() => {
        timer.current = window.setTimeout(() => setShow(true), 500);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        setShow(false);
      }}
    >
      {children}
      {show && <ProfileHoverCard user={user} tier={tier} personaId={personaId} castHash={castHash} network={network} live={live} />}
    </span>
  );
}

// ---------- embeds ----------

/** FC-READ: a network cast's embeds (images through MediaImg) for surfaces outside the card — the permalink's root
 *  cast. Non-network embeds there keep using EmbedList, unchanged. */
export function CastEmbeds({ embeds, network = false }: { embeds: Embed[]; network?: boolean }) {
  return (
    <>
      {embeds.map((embed, i) => (
        <EmbedView key={i} embed={embed} network={network} />
      ))}
    </>
  );
}

function EmbedView({ embed, compactMedia, network = false }: { embed: Embed; compactMedia?: boolean; network?: boolean }) {
  if (embed.type === "image") {
    return (
      <div className="mt-3 overflow-hidden rounded-2xl border border-x-border">
        <MediaImg src={embed.url} network={network} className={`w-full object-cover ${compactMedia ? "max-h-[290px]" : "max-h-[510px]"}`} />
      </div>
    );
  }
  if (embed.type === "link") {
    return (
      <div
        className="mt-3 cursor-pointer overflow-hidden rounded-2xl border border-x-border hover:bg-x-hover"
        onClick={(e) => e.stopPropagation()}
      >
        {embed.image && (
          <div className="relative border-b border-x-border">
            <MediaImg src={embed.image} network={network} className="max-h-[300px] w-full object-cover" />
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
  // quote
  const q = embed.quote;
  return (
    <div
      className="mt-3 cursor-pointer overflow-hidden rounded-2xl border border-x-border hover:bg-[#00000008]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 pt-3 pb-2">
        <p className="flex items-center text-[15px] leading-5">
          <MediaImg src={q.author.pfpUrl} network={network} avatar className="mr-1.5 h-5 w-5 rounded-full object-cover" placeholderClassName="mr-1.5 h-5 w-5 shrink-0 rounded-full" />
          <span className="max-w-[45%] truncate font-bold">{q.author.displayName}</span>
          {q.author.verified && <VerifiedBadge size={16} className="ml-0.5 shrink-0" />}
          <span className="ml-1 truncate text-x-sec">@{q.author.username}</span>
          <span className="mx-1 text-x-sec">·</span>
          <span className="shrink-0 text-x-sec">{relativeTime(q.timestamp)}</span>
        </p>
        <RichText text={q.text} className="clamp-10 mt-0.5 block text-[15px] leading-5" />
      </div>
      {q.embeds.map((e2, i) =>
        e2.type === "image" ? (
          <MediaImg key={i} src={e2.url} network={network} className="max-h-[430px] w-full border-t border-x-border object-cover" />
        ) : null
      )}
    </div>
  );
}

// ---------- action row ----------

function Action({
  icon,
  count,
  hoverClass,
  active,
  activeClass,
  onClick,
  testid,
  grow = true,
  refusal,
  onRefused,
  busy = false,
  pressed,
  note,
  ...pointer
}: {
  icon: React.ReactNode;
  count?: number;
  hoverClass: string;
  active?: boolean;
  activeClass?: string;
  onClick?: (e: React.MouseEvent) => void;
  testid?: string;
  grow?: boolean;
  /** FC-READ: set on a network cast's write controls — the button is disabled (aria-disabled, so the tooltip still
   *  shows and a tap can say why) and the action never fires */
  refusal?: string;
  onRefused?: () => void;
  /** BUILD A review (PUB-6): the button's last request has not been answered yet (taps wait for it) */
  busy?: boolean;
  /** POST AS YOU ON HUB CARDS: the network's state for this button (true / false / null = cannot be told); absent on
   *  every other card, so their markup is unchanged */
  pressed?: boolean | null;
  /** a tooltip when the button works (the refusal is the tooltip when it does not) */
  note?: string;
} & Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, "onPointerDown" | "onPointerUp" | "onPointerLeave" | "onPointerCancel" | "onContextMenu">) {
  return (
    <button
      {...pointer}
      data-testid={testid}
      aria-disabled={refusal ? true : undefined}
      aria-busy={busy || undefined}
      aria-pressed={pressed === undefined ? undefined : pressed === true}
      data-disabled={refusal ? "true" : undefined}
      data-pressed={pressed === undefined ? undefined : pressed === null ? "unknown" : pressed ? "true" : "false"}
      title={refusal ?? note}
      onClick={(e) => {
        e.stopPropagation();
        if (refusal) {
          onRefused?.();
          return;
        }
        onClick?.(e);
      }}
      className={`group flex items-center ${grow ? "sm:flex-1" : ""} ${
        active ? activeClass : "text-x-sec"
      } ${refusal ? "cursor-not-allowed opacity-50" : hoverClass}`}
    >
      <span className="relative flex h-[34.75px] w-[34.75px] -m-2 items-center justify-center rounded-full transition-colors group-hover:bg-[var(--hover-bg)]">
        {icon}
      </span>
      <span className="ml-1 min-w-[16px] text-left text-[13px] leading-4 transition-colors">
        {count !== undefined && count > 0 ? formatCount(count) : ""}
      </span>
    </button>
  );
}

export function ActionRow({
  cast,
  large = false,
  showViews = true,
  className = "",
}: {
  cast: Cast;
  large?: boolean;
  showViews?: boolean;
  className?: string;
}) {
  const [liked, setLiked] = useState(!!cast.viewerLiked);
  const [recast, setRecast] = useState(!!cast.viewerRecast);
  const [likes, setLikes] = useState(cast.likes);
  const [recasts, setRecasts] = useState(cast.recasts);
  const [bookmarked, setBookmarked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const size = large ? 22.5 : 18.75;
  const router = useRouter();

  // MEGA PASS 2 Gate 3: the row is BOUND per mode (X's row when nothing is bound — the parity baseline). Long-press
  // on any button (or right-click, the desktop analog) opens that slot's binding picker; a tap that followed a
  // long-press is swallowed so rebinding never fires the button it was rebinding.
  const { row } = useActionRow();
  const [picker, setPicker] = useState<number | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const clearPress = () => {
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current.timer = null;
  };
  const longPress = (slot: number) => ({
    onPointerDown: () => {
      press.current.fired = false;
      clearPress();
      press.current.timer = setTimeout(() => {
        press.current.fired = true;
        setPicker(slot);
      }, 550);
    },
    onPointerUp: clearPress,
    onPointerLeave: clearPress,
    onPointerCancel: clearPress,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setPicker(slot);
    },
  });
  const guard = (fn: () => void) => () => {
    if (press.current.fired) {
      press.current.fired = false;
      return;
    }
    fn();
  };

  // FC-READ: the reaction's answer is READ, not thrown away. It used to be fire-and-forget: a refused like (a network
  // cast's 403, a live rig's 503) left the heart filled and the count bumped until reload — the "success, nothing
  // happened" failure the server's guard exists to prevent, re-created by the client. A non-OK answer now undoes the
  // optimistic toggle and says why, in the server's own words.
  const { toast, actingPersonaId, refresh } = useApp();
  const network = isNetworkCast(cast);
  const refuse = () => toast(networkReadOnlySentence());
  // BUILD A review (PUB-6): one request per button at a time — a double tap no longer sends a like and its un-like at
  // once (the un-like could answer "nothing changed on Farcaster" while the like was still on its way)
  const inflight = useRef<{ like: boolean; recast: boolean }>({ like: false, recast: false });
  const [busy, setBusy] = useState<{ like: boolean; recast: boolean }>({ like: false, recast: false });
  const send = async (kind: "like" | "recast", on: boolean, revert: () => void) => {
    inflight.current[kind] = true;
    setBusy((b) => ({ ...b, [kind]: true }));
    try {
      let res: Response;
      try {
        res = await fetch("/api/actions/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // BUILD A: the author's fid rides along — the server refuses (never sends) a Farcaster like or recast that
          // would publicly tie two of the owner's own accounts, and the card is the one place that knows it for free.
          // BUILD A review (PUB-1): so does the persona this page was rendered for — refused if another tab switched it
          body: JSON.stringify({ hash: cast.hash, kind, on, authorFid: typeof cast.author?.fid === "number" ? cast.author.fid : null, actingPersonaId }),
        });
      } catch {
        revert();
        toast("Something went wrong. Try again.");
        return;
      }
      const j = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown; delivery?: { to?: unknown; message?: unknown } } | null;
      if (res.ok) {
        // BUILD A: say where it went when it went to Farcaster ("Liked on Farcaster as @x"), and when a live Farcaster
        // post's like stayed in Totem ("Liked in Totem only — <why>"). A seed or local post's like stays silent, as
        // it always was.
        const d = j?.delivery;
        if (d && typeof d.message === "string" && d.message && (d.to === "farcaster" || cast.live === true)) toast(d.message);
        return;
      }
      revert();
      toast(j && typeof j.error === "string" && j.error ? j.error : "Something went wrong. Try again.");
      if (j?.code === "FC_PERSONA_CHANGED") refresh(); // the page catches up with the persona that is acting now
    } finally {
      inflight.current[kind] = false;
      setBusy((b) => ({ ...b, [kind]: false }));
    }
  };

  // POST AS YOU ON HUB CARDS (components/hub/HubWrite.tsx): a card read straight from a Farcaster node replies, likes and
  // recasts AS THE VISITOR'S OWN ACCOUNT through the device's post-as-you route, once Totem may post as them, no persona
  // is acting and the card is not one of their personas'; otherwise the three stay disabled with the reason. A button is
  // pressed only after the node accepted the message (never optimistically), and a refusal is a sentence under the row.
  const hubGate = useHubWriteGate(cast.hub ? cast : null, network ? networkReadOnlySentence() : null);
  const reacted = useHubReacted(hubGate.ok);
  const [hubLocal, setHubLocal] = useState<{ like?: boolean; recast?: boolean }>({});
  const [hubLine, setHubLine] = useState<string | null>(null);
  const [hubReplyOpen, setHubReplyOpen] = useState(false);
  const hubPressed = (kind: "like" | "recast"): boolean | null => hubLocal[kind] ?? pressedOf(reacted, kind, cast);
  const hubSay = () => setHubLine(hubGate.reason);
  const hubReact = async (kind: "like" | "recast") => {
    if (!hubGate.ok || inflight.current[kind]) return;
    const on = hubPressed(kind) !== true;
    inflight.current[kind] = true;
    setBusy((b) => ({ ...b, [kind]: true }));
    setHubLine(null);
    try {
      const r = await rootCall({ action: "react", reaction: kind, target: { fid: cast.author.fid, hash: cast.hash }, remove: !on });
      if (r.ok && r.json && typeof r.json.hash === "string") setHubLocal((l) => ({ ...l, [kind]: on }));
      else {
        const what = kind === "like" ? (on ? "Not liked" : "Like not removed") : on ? "Not recast" : "Recast not removed";
        setHubLine(what + ": " + (r.error || "Farcaster did not accept it."));
        recheckRootWrites(r.code);
      }
    } finally {
      inflight.current[kind] = false;
      setBusy((b) => ({ ...b, [kind]: false }));
    }
  };
  const unknownNote = (kind: "like" | "recast") => (hubGate.ok && hubPressed(kind) === null ? (kind === "like" ? "Totem couldn't tell whether you already liked this." : "Totem couldn't tell whether you already recast this.") : undefined);

  // the bindable extras: a one-tap action where one exists, the relevant surface otherwise (named in REPORT-MEGA2)
  const extra = async (action: CastAction) => {
    // PROD-LIVE (D-CU-0-4): was window.location.assign — a full document load, which on a public deployment wipes
    // an unsaved visitor identity (it lives only in tab memory) and mints a brand-new one. A client push instead.
    const go = (href: string) => router.push(href);
    // FC-READ (review, privacy-safety-1): the second line behind the disabled control — a refused extra never runs on
    // a network cast, whatever reaches here (a network hash must not enter a server request path or a write route)
    if (network && NETWORK_REFUSED_EXTRAS.has(action)) {
      refuse();
      return;
    }
    switch (action) {
      case "stake-as": {
        const r = await fetch("/api/influence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stake", castHash: cast.hash, stakeAction: "curate" }) });
        const j = await r.json().catch(() => null);
        setNotice(r.ok ? `staked ${j?.stake?.amount ?? 0} as worth reading` : (j?.error ?? "stake refused"));
        return;
      }
      case "mark-caught-up": {
        if (!cast.storyId) { setNotice("not part of a story"); return; }
        const r = await fetch("/api/feed-health/saturation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storyId: cast.storyId }) });
        setNotice(r.ok ? "caught up on this story" : "could not mark");
        return;
      }
      case "bookmark-to-folder":
        go("/folders?add=" + encodeURIComponent(cast.hash));
        return;
      case "send-to-friend":
        go("/settings/feed-health?send=" + encodeURIComponent(cast.hash));
        return;
      case "act-as":
        document.dispatchEvent(new CustomEvent("layers:act-as", { detail: { hash: cast.hash } }));
        setNotice("open the ··· menu → Act as…");
        return;
      case "refute":
        // ANON (R3-15, the extras too): an anon cast has no permalink of its own (/<username>/status/<hash> 404s on the
        // rig and fetches a foreign network cast under DATA_SOURCE=neynar) — the card's click already refuses; so does this
        if (cast.anon) { setNotice("an anonymous post has no page of its own"); return; }
        go(`/${cast.author.username}/status/${cast.hash}?refute=1`);
        return;
      case "note":
        go(`/${cast.author.username}/status/${cast.hash}?note=1`);
        return;
      case "custom-rule":
        go("/settings/rules?from=" + encodeURIComponent(cast.hash));
        return;
      default:
        return;
    }
  };

  // FC-READ: on a network cast the write controls are disabled with the server's sentence; a tap says it (the long-press
  // rebind still works — the binding is a local preference, not a write)
  const refusal = network ? networkReadOnlySentence() : undefined;
  const render = (action: CastAction, slot: number) => {
    const key = action + slot;
    switch (action) {
      case "reply":
        if (hubGate.hub) {
          return (
            <Action key={key} testid="action-reply" icon={<ReplyIcon size={size} />} hoverClass="hover:text-x-blue [--hover-bg:#1d9bf01a]" active={hubReplyOpen} activeClass="text-x-blue" pressed={hubGate.ok ? hubReplyOpen : undefined} refusal={hubGate.ok ? undefined : hubGate.reason ?? "Not available here."} onRefused={guard(hubSay)} onClick={guard(() => setHubReplyOpen((v) => !v))} {...longPress(slot)} />
          );
        }
        return (
          <Action key={key} testid="action-reply" icon={<ReplyIcon size={size} />} count={cast.replies} hoverClass="hover:text-x-blue [--hover-bg:#1d9bf01a]" refusal={refusal} onRefused={guard(refuse)} {...longPress(slot)} />
        );
      case "recast":
        if (hubGate.hub) {
          const on = hubPressed("recast");
          return (
            <Action key={key} testid="action-recast" icon={<RepostIcon size={size} />} active={on === true} activeClass="text-x-green" hoverClass="hover:text-x-green [--hover-bg:#00ba7c1a]" pressed={on} note={unknownNote("recast")} refusal={hubGate.ok ? undefined : hubGate.reason ?? "Not available here."} onRefused={guard(hubSay)} busy={busy.recast} onClick={guard(() => void hubReact("recast"))} {...longPress(slot)} />
          );
        }
        return (
          <Action
            key={key}
            testid="action-recast"
            icon={<RepostIcon size={size} />}
            count={recasts}
            active={recast}
            activeClass="text-x-green"
            hoverClass="hover:text-x-green [--hover-bg:#00ba7c1a]"
            refusal={refusal}
            onRefused={guard(refuse)}
            busy={busy.recast}
            onClick={guard(() => {
              if (inflight.current.recast) return; // PUB-6: the last tap's answer first
              const on = !recast;
              setRecast(on);
              setRecasts((n) => n + (on ? 1 : -1));
              void send("recast", on, () => {
                setRecast(!on);
                setRecasts((n) => n - (on ? 1 : -1));
              });
            })}
            {...longPress(slot)}
          />
        );
      case "like":
        if (hubGate.hub) {
          const on = hubPressed("like");
          return (
            <Action key={key} testid="action-like" icon={on === true ? <HeartFilled size={size} /> : <HeartOutline size={size} />} active={on === true} activeClass="text-x-pink" hoverClass="hover:text-x-pink [--hover-bg:#f918801a]" pressed={on} note={unknownNote("like")} refusal={hubGate.ok ? undefined : hubGate.reason ?? "Not available here."} onRefused={guard(hubSay)} busy={busy.like} onClick={guard(() => void hubReact("like"))} {...longPress(slot)} />
          );
        }
        return (
          <Action
            key={key}
            testid="action-like"
            icon={liked ? <HeartFilled size={size} /> : <HeartOutline size={size} />}
            count={likes}
            active={liked}
            activeClass="text-x-pink"
            hoverClass="hover:text-x-pink [--hover-bg:#f918801a]"
            refusal={refusal}
            onRefused={guard(refuse)}
            busy={busy.like}
            onClick={guard(() => {
              if (inflight.current.like) return; // PUB-6: the last tap's answer first
              const on = !liked;
              setLiked(on);
              setLikes((n) => n + (on ? 1 : -1));
              void send("like", on, () => {
                setLiked(!on);
                setLikes((n) => n - (on ? 1 : -1));
              });
            })}
            {...longPress(slot)}
          />
        );
      case "views":
        return showViews && typeof cast.views === "number" ? (
          <Action key={key} testid="action-views" icon={<ViewsIcon size={size} />} count={cast.views} hoverClass="hover:text-x-blue [--hover-bg:#1d9bf01a]" {...longPress(slot)} />
        ) : null;
      case "bookmark":
        return (
          <Action
            key={key}
            grow={false}
            testid="action-bookmark"
            icon={
              bookmarked ? (
                <svg viewBox="0 0 24 24" width={size} height={size} fill="#1d9bf0">
                  <path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z" />
                </svg>
              ) : (
                <BookmarkOutline size={size} />
              )
            }
            active={bookmarked}
            activeClass="text-x-blue"
            hoverClass="hover:text-x-blue [--hover-bg:#1d9bf01a]"
            onClick={guard(() => setBookmarked((v) => !v))}
            {...longPress(slot)}
          />
        );
      case "share":
        return <Action key={key} grow={false} testid="action-share" icon={<ShareIcon size={size} />} hoverClass="hover:text-x-blue [--hover-bg:#1d9bf01a]" {...longPress(slot)} />;
      default:
        // an extra binding: the bookmark glyph with the action's label, same chrome as every other button
        return (
          <Action
            key={key}
            grow={false}
            testid={`action-${action}`}
            icon={<BookmarkOutline size={size} />}
            hoverClass="hover:text-x-blue [--hover-bg:#1d9bf01a]"
            // FC-READ: the extras that write against the cast (stake, folder add, send, act-as) are refused on a
            // network cast by their routes — disabled here with the same sentence rather than clicked into a 403.
            // FC-READ (review): so are custom-rule, refute and note, which would carry the hash in a request path.
            refusal={network && NETWORK_REFUSED_EXTRAS.has(action) ? networkReadOnlySentence() : undefined}
            onRefused={guard(refuse)}
            onClick={guard(() => {
              void extra(action);
            })}
            {...longPress(slot)}
          />
        );
    }
  };

  // X's row: the first four grow (reply, repost, like, views), the trailing two sit in a tight group — kept exactly
  // when the row IS X's; a bound row renders its slots in order with the same components
  const isDefault = row.length === 6 && ["reply", "recast", "like", "views", "bookmark", "share"].every((a, i) => row[i] === a);
  const parts = row.map((a, i) => render(a, i));
  const rowEl = (
    <div className={`flex items-center justify-between ${className}`} onClick={picker !== null ? (e) => e.stopPropagation() : undefined}>
      {cast.stakes && cast.stakes.total > 0 ? (
        // MEGA PASS 2 Gate 1: the stake summary rides the card INVISIBLY — the default UI keeps the spectrum quiet
        // (the influence layer in settings is where it shows). Assertable; never a pixel of the parity row.
        <span
          hidden
          data-testid="cast-stake"
          data-stake-total={cast.stakes.total}
          data-stake-wrong={cast.stakes.byDirection.wrong + cast.stakes.byDirection.misleading}
          data-stake-note={cast.stakes.byDirection["note-worthy"]}
          data-viewer-staked={cast.stakes.viewerStaked ?? 0}
        />
      ) : null}
      {isDefault ? (
        <>
          {parts.slice(0, 4)}
          <div className="flex items-center">
            {parts[4]}
            <span className="w-1" />
            {parts[5]}
          </div>
        </>
      ) : (
        parts
      )}
      {picker !== null ? (
        <span className="relative">
          <ActionBindingPicker slotIndex={picker} current={row[picker]} onClose={() => setPicker(null)} />
        </span>
      ) : null}
      {notice ? (
        <span data-testid="action-notice" role="status" className="sr-only">
          {notice} · {CAST_ACTION_LABELS[row[0]]}
        </span>
      ) : null}
    </div>
  );
  if (!hubGate.hub) return rowEl;
  // POST AS YOU ON HUB CARDS: the reason or the refusal under the row, and the reply composer (parent = this card)
  return (
    <>
      {rowEl}
      {hubLine ? (
        <p data-testid="hub-action-error" role="alert" onClick={(e) => e.stopPropagation()} className="mt-1.5 text-[13px] leading-4 text-[#f4212e]">
          {hubLine}
        </p>
      ) : null}
      {hubReplyOpen && hubGate.ok && hubGate.handle ? (
        <HubReplyComposer parent={{ fid: cast.author.fid, hash: cast.hash }} handle={hubGate.handle} testid="hub-card-reply" autoFocus className="mt-2 border-t border-x-border pt-2" />
      ) : null}
    </>
  );
}

// ---------- kebab menu ----------

function KebabMenu({ cast }: { cast: Cast }) {
  const [open, setOpen] = useState(false);
  const [actAsKind, setActAsKind] = useState<"reply" | "quote" | "recast" | null>(null);
  const { blockPersona, activePersona, toast } = useApp();
  const canBlock = !!cast.personaId && cast.personaId !== activePersona?.id;
  // FC-READ: reply / quote / recast AS a persona on a network cast is a Farcaster write — disabled with the reason
  const network = isNetworkCast(cast);
  // POST AS YOU ON HUB CARDS: the root's OWN cast can be deleted from Farcaster (two taps: the second one deletes)
  const hubGate = useHubWriteGate(cast.hub ? cast : null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const del = async () => {
    setOpen(false);
    setConfirmDelete(false);
    setDeleting(true);
    const r = await rootCall({ action: "delete", hash: cast.hash });
    setDeleting(false);
    if (r.ok) {
      toast("Deleted from Farcaster.");
      window.dispatchEvent(new Event(ROOT_CAST_EVENT));
    } else {
      toast("Not deleted: " + (r.error || "Farcaster did not accept it."));
      recheckRootWrites(r.code);
    }
  };
  return (
    <div className="relative flex items-start">
      <button
        aria-label="Grok actions"
        onClick={(e) => e.stopPropagation()}
        className="-mt-1 flex h-[34.75px] w-[34.75px] items-center justify-center rounded-full text-x-sec hover:bg-[#1d9bf01a] hover:text-x-blue"
      >
        <GrokIcon size={18.75} />
      </button>
      <button
        data-testid="cast-kebab"
        aria-busy={deleting || undefined}
        onClick={(e) => {
          e.stopPropagation();
          setConfirmDelete(false);
          setOpen((v) => !v);
        }}
        className="-mr-2 -mt-1 flex h-[34.75px] w-[34.75px] items-center justify-center rounded-full text-x-sec hover:bg-[#1d9bf01a] hover:text-x-blue"
      >
        <KebabIcon size={18.75} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); setConfirmDelete(false); }} />
          <div className="absolute right-0 top-0 z-40 w-[300px] overflow-hidden rounded-xl bg-white py-1 shadow-[0_0_15px_rgba(101,119,134,0.2),0_0_3px_1px_rgba(101,119,134,0.15)]">
            {hubGate.ok && hubGate.mine ? (
              <button
                type="button"
                data-testid="hub-delete"
                data-confirm={confirmDelete ? "true" : "false"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!confirmDelete) setConfirmDelete(true);
                  else void del();
                }}
                className="flex w-full items-center px-4 py-3 text-left text-[15px] font-bold text-[#f4212e] hover:bg-x-hover"
              >
                {confirmDelete ? "Tap again to delete it from Farcaster" : "Delete from Farcaster"}
              </button>
            ) : null}
            {canBlock && (
              <button
                data-testid="block-personas"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  blockPersona(cast.personaId!);
                }}
                className="flex w-full items-center px-4 py-3 text-left text-[15px] font-bold hover:bg-x-hover"
              >
                <svg viewBox="0 0 24 24" width={18.75} height={18.75} fill="currentColor" className="mr-3">
                  <path d="M12 3.75c-4.55 0-8.25 3.69-8.25 8.25 0 1.92.66 3.68 1.75 5.08L17.08 5.5c-1.4-1.1-3.16-1.75-5.08-1.75zm5.08 3.16L5.5 18.5c1.4 1.1 3.16 1.75 5.08 1.75 4.56 0 8.25-3.69 8.25-8.25 0-1.92-.65-3.68-1.75-5.09zM1.75 12C1.75 6.34 6.34 1.75 12 1.75S22.25 6.34 22.25 12 17.66 22.25 12 22.25 1.75 17.66 1.75 12z" />
                </svg>
                Block all their personas
              </button>
            )}
            {cast.personaId ? (
              <div data-testid="cast-menu-delivery" className="border-b border-x-border pb-1">
                <DeliveryTierPicker
                  personaId={cast.personaId}
                  handle={cast.author.username}
                  onDone={() => setOpen(false)}
                />
              </div>
            ) : hubGate.hub && !cast.hubOwn && !hubGate.mine ? (
              // SPEC A: where a Farcaster account you follow shows up in this mode, keyed `fc:<fid>` (the tiers are this
              // device's sealed record; the real Following applies them). Never on a card by one of your personas.
              <div data-testid="cast-menu-delivery" data-hub="true" className="border-b border-x-border pb-1">
                <DeliveryTierPicker
                  personaId={hubAccountKey(cast.author.fid)}
                  handle={cast.author.username}
                  omit={["facet-only"]}
                  onDone={() => setOpen(false)}
                />
              </div>
            ) : null}
            {hubGate.hub && !cast.hubOwn ? (
              // SPEC C: send this Farcaster post to the people in one of your rings (the root's; never a persona's card)
              <HubSendToRing
                fid={cast.author.fid}
                hash={cast.hash}
                onDone={(said) => {
                  setOpen(false);
                  toast(said);
                }}
              />
            ) : null}
            <button
              data-testid="cast-menu-act-as"
              aria-disabled={network ? true : undefined}
              data-disabled={network ? "true" : undefined}
              title={network ? networkReadOnlySentence() : undefined}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                if (network) {
                  toast(networkReadOnlySentence());
                  return;
                }
                setActAsKind("reply");
              }}
              className={`flex w-full items-center px-4 py-3 text-left text-[15px] font-bold ${network ? "cursor-not-allowed opacity-50" : "hover:bg-x-hover"}`}
            >
              <svg viewBox="0 0 24 24" width={18.75} height={18.75} fill="currentColor" className="mr-3">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.54 0 3-.35 4.31-.97l1.36 1.36a1 1 0 001.7-.71V12c0-5.52-4.48-10-10-10zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8v6.59l-1.29-1.3a1 1 0 00-1.05-.23A7.94 7.94 0 0112 20zm-3-9a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0zm4.5 0a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0z" />
              </svg>
              Act as&hellip; (reply, quote, recast)
            </button>
            <button className="flex w-full items-center px-4 py-3 text-left text-[15px] font-bold hover:bg-x-hover">
              <svg viewBox="0 0 24 24" width={18.75} height={18.75} fill="currentColor" className="mr-3">
                <path d="M18 6.59V1.2L8.71 7H5.5C4.12 7 3 8.12 3 9.5v5C3 15.88 4.12 17 5.5 17h2.09l-2.3 2.29 1.42 1.42 15.5-15.5-1.42-1.42L18 6.59zm-8 8V8.55l6-3.75v3.79l-6 6zM5 9.5c0-.28.22-.5.5-.5H8v6H5.5c-.28 0-.5-.22-.5-.5v-5zm6.5 9.24l1.45-1.45L16 19.2V14l2 .02v8.78l-6.5-4.06z" />
                </svg>
              Mute @{cast.author.username}
            </button>
            <button className="flex w-full items-center px-4 py-3 text-left text-[15px] font-bold hover:bg-x-hover">
              <svg viewBox="0 0 24 24" width={18.75} height={18.75} fill="currentColor" className="mr-3">
                <path d="M3 2h18.61l-3.5 7 3.5 7H5v6H3V2zm2 12h13.38l-2.5-5 2.5-5H5v10z" />
              </svg>
              Report post
            </button>
          </div>
        </>
      )}
      {actAsKind && (
        <ActAsPicker cast={cast} initialKind={actAsKind} onClose={() => setActAsKind(null)} />
      )}
    </div>
  );
}

// ---------- the card ----------

export function CastCard({
  cast,
  connectorBelow = false,
  connectorAbove = false,
  selected = false,
}: {
  cast: Cast;
  connectorBelow?: boolean;
  connectorAbove?: boolean;
  selected?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  // MEGA PASS 2 Gate 3: this device's scroll-zone layout (from the timeline's provider; null on surfaces without one)
  const { zones } = useActionRow();
  const readingLayout = !!zones && zones.zones.length > 0;
  // FOLLOWING FROM THE HUB: a cast read from a Farcaster node opens by its protocol id (fid + hash) on /fc/cast, the id
  // in the URL FRAGMENT so Totem's server never learns which cast was opened; its author opens on /fc/profile the same way
  const href = cast.hub ? hubCastHref(cast.author.fid, cast.hash) : `/${cast.author.username}/status/${cast.hash}`;
  const authorHref = cast.hub ? hubProfileHref(cast.author.fid) : `/${cast.author.username}`;
  // FC-READ: a network cast (read through the public relay) is marked on the element itself — the machine-readable
  // fact every check starts from (a "live card" assertion without it is vacuous) — and its media and author chrome
  // go through the network-safe paths below. Absent on every seed/local card, so their DOM is unchanged.
  const network = isNetworkCast(cast);

  return (
    <article
      data-testid="cast"
      data-mirror={cast.mirrorOf ? "true" : "false"}
      data-hash={cast.hash}
      data-live={network ? "true" : undefined}
      // ANON REVIEW (R3-15): an anon card has no permalink of its own — /anon/<castHash> is not built, and
      // `/${username}/status/${hash}` 404s on the rig and, under DATA_SOURCE=neynar, fetches the real network cast and
      // renders it with no anon badge and no reveal control. So an anon card does not navigate, and never routes the
      // anon author to a persona profile. Every other card keeps its click.
      onClick={() => {
        if (!cast.anon) router.push(href);
      }}
      className={`relative ${cast.anon ? "" : "cursor-pointer"} border-b border-x-border px-4 transition-colors hover:bg-[#00000006] ${
        selected ? "kb-selected" : ""
      } ${cast.recastedBy ? "pt-1" : "pt-3"} pb-2`}
    >
      {cast.recastedBy && (
        <p className="mb-1 flex items-center pl-[26px] text-[13px] font-bold leading-4 text-x-sec">
          <RepostIcon size={16} className="mr-2" />
          {cast.recastedBy.displayName} reposted
        </p>
      )}
      {cast.mirrorOf && (
        <p data-testid="mirror-attribution" className="mb-1 flex items-center pl-[26px] text-[13px] font-bold leading-4 text-x-sec">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} className="mr-2">
            <path d="M8 7h11M15 3l4 4-4 4M16 17H5M9 21l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          The same post, as it appears elsewhere
        </p>
      )}
      {!cast.mirrorOf && (cast.alsoPostedTo?.length ?? 0) > 0 && (
        <p data-testid="crosspost-chip" className="mb-1 flex items-center pl-[26px] text-[13px] font-bold leading-4 text-x-sec">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} className="mr-2">
            <path d="M8 7h11M15 3l4 4-4 4M16 17H5M9 21l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Also posted to {cast.alsoPostedTo!.join(", ")} · probably seen there
        </p>
      )}
      <div className="flex">
        <div className="relative mr-2 flex w-10 shrink-0 flex-col items-center">
          {connectorAbove && <div className="absolute -top-3 h-3 w-0.5 bg-[#cfd9de]" />}
          <HoverableIdentity user={cast.author} tier={cast.tier} personaId={cast.personaId} castHash={cast.hash} network={network} live={cast.live === true}>
            {cast.anon && cast.ringShared ? (
              // PERSONA LAUNCH P4: a ring member's view of an anon post — the root on the left, the persona that wrote it
              // on the right, both drawn inline (sealed thumbnails or monograms): no request names either half
              <SplitAvatar
                left={<Face thumb={cast.ringShared.root.thumb} name={cast.ringShared.root.displayName} />}
                right={<Face thumb={cast.ringShared.persona.thumb} name={cast.ringShared.persona.displayName} />}
                leftName={cast.ringShared.root.fname ? "@" + cast.ringShared.root.fname : cast.ringShared.root.displayName}
                rightName={"@" + cast.ringShared.persona.handle}
                onClick={(e) => e.stopPropagation()}
              />
            ) : cast.author.merged && cast.author.linked ? (
              // MULTI-FID Gate 2: the granted viewer's merge — a split avatar, half each identity. PERSONA LAUNCH P4: the
              // sides follow one rule everywhere — the root / linked identity LEFT, the persona that wrote the card RIGHT;
              // a ring's root half (tier "ring") is its sealed inline thumbnail or a monogram, never a URL
              <SplitAvatar
                left={
                  cast.author.linked.tier === "ring" ? (
                    <Face thumb={cast.author.linked.thumb ?? null} name={cast.author.linked.displayName} />
                  ) : (
                    <MediaImg src={cast.author.linked.pfpUrl} network={network} avatar className="h-full w-full object-cover" />
                  )
                }
                right={<MediaImg src={cast.author.pfpUrl} network={network} avatar className="h-full w-full object-cover" />}
                leftName={"@" + (cast.author.linked.username || cast.author.linked.displayName)}
                rightName={"@" + cast.author.username}
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/${cast.author.username}`);
                }}
              />
            ) : (
              <MediaImg
                src={cast.author.pfpUrl}
                network={network}
                avatar
                className="h-10 w-10 rounded-full object-cover transition-opacity hover:opacity-90"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(authorHref);
                }}
              />
            )}
          </HoverableIdentity>
          {connectorBelow && <div className="mt-1 w-0.5 flex-1 bg-[#cfd9de]" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between">
            <p className="flex min-w-0 items-center text-[15px] leading-5">
              <HoverableIdentity user={cast.author} tier={cast.tier} className="min-w-0" personaId={cast.personaId} castHash={cast.hash} network={network} live={cast.live === true}>
                {/* PROD-LIVE (D-CU-0-4): next/link — a client navigation, never a full document load (the old anchor
                    did the same by hand with preventDefault + router.push). The click stops here (the card's own
                    click opens the post); no viewport prefetch — a timeline of author links must not fan out a
                    server render per card. */}
                <Link
                  href={authorHref}
                  prefetch={false}
                  onClick={(e) => e.stopPropagation()}
                  className="flex min-w-0 items-center"
                >
                  <span className="truncate font-bold hover:underline">{cast.author.displayName}</span>
                  {cast.author.verified && <VerifiedBadge size={18.75} className="ml-0.5 shrink-0" />}
                </Link>
              </HoverableIdentity>
              {cast.author.merged && cast.author.linked && (
                // MULTI-FID Gate 2: "bob / fluffypanda69" — the linked sibling, visible to this viewer only. PERSONA LAUNCH
                // P4: a RING's merge says who shared it ("ring", titled "Shared with you by <name>")
                <span data-testid="cast-merged-identity" data-linked={cast.author.linked.username} className="ml-1 flex min-w-0 items-center text-x-sec">
                  <span className="mx-0.5">/</span>
                  <span className="truncate font-bold text-x-text">{cast.author.linked.displayName}</span>
                  {cast.author.linked.tier === "ring" ? (
                    <span className="ml-1 inline-flex items-center rounded-[3px] border border-[#cfd9de] px-1 text-[10px] font-medium leading-[14px] text-x-sec" title={`Shared with you by ${cast.author.linked.sharedBy ?? "a ring"} — only you see this`}>
                      ring
                    </span>
                  ) : (
                    <span className="ml-1 inline-flex items-center rounded-[3px] border border-[#cfd9de] px-1 text-[10px] font-medium leading-[14px] text-x-sec" title="Linked identities — visible to you">linked</span>
                  )}
                </span>
              )}
              <span className="ml-1 truncate text-x-sec">@{cast.author.username}</span>
              {cast.anon ? (
                <>
                  {/* MULTI-FID Gate 4: the shared anon account — a visible treatment, no tier, no persona.
                      MULTI-FID PASS: if the poster later chose to reveal it, say so — never guessed, only
                      ever what they themselves proved with the secret from post time. */}
                  <span
                    data-testid="cast-anon"
                    data-attributed={cast.attributedTo ? cast.attributedTo.handle : undefined}
                    className="ml-1 inline-flex items-center rounded-[3px] border border-[#cfd9de] px-1 text-[10px] font-medium leading-[14px] text-x-sec"
                    // ANON REVIEW (R3-17, R3-06): the badge names the NETWORK account the reveal picker offered (its fname),
                    // falling back to the Totem handle; and it says where the reveal is checkable — inside Totem only: the
                    // claim is signed by a key no live fid has registered, and nothing changes on Farcaster. PERSONA LAUNCH
                    // P6 (launch's line): a launched persona's batch reveal, signed by the account's REGISTERED key, is
                    // checkable by anyone — "revealed from @anon · @fname"
                    // UX-L9: while the chain is the validator's SIMULATED one (absent chainSimulated = simulated — fail
                    // closed), both titles say test data; the anyone-can-check wording only for a key read from the real network
                    title={
                      cast.attributedTo?.checkable === "chain"
                        ? `Posted anonymously, later revealed by @${cast.attributedTo.fname ?? cast.attributedTo.handle} — ${chainCheckWords(cast.attributedTo.chainSimulated)}`
                        : cast.attributedTo
                          ? `Posted anonymously — later revealed inside Totem by @${cast.attributedTo.fname ?? cast.attributedTo.handle}`
                          : "Posted anonymously through the shared account — attributed to no one"
                    }
                  >
                    {cast.attributedTo?.checkable === "chain" ? (
                      <span data-testid="cast-revealed-from-anon" data-chain={cast.attributedTo.chainSimulated === false ? "network" : "simulated"} title={chainCheckWords(cast.attributedTo.chainSimulated, true)}>
                        revealed from @anon · @{cast.attributedTo.fname ?? cast.attributedTo.handle}
                      </span>
                    ) : cast.attributedTo ? (
                      `anon · revealed as @${cast.attributedTo.fname ?? cast.attributedTo.handle} (inside Totem only)`
                    ) : (
                      "anon"
                    )}
                  </span>
                  {cast.previewOnly ? (
                    // PERSONA LAUNCH P7: a public-preview anonymous post (the test universe) — said beside the badge, in
                    // plain words: it stays inside this preview and was never posted to Farcaster.
                    // PUBLIC GO-LIVE: lib/feed.ts marks a card previewOnly only in the TEST universe on a public deployment, so
                    // the label is gone exactly on the armed-and-live path (the tab handed ZK_MODE=live by the app's hint);
                    // on the unarmed and fixture paths it stays, word for word
                    <span
                      data-testid="cast-anon-preview"
                      className="ml-1 inline-flex shrink-0 items-center rounded-[3px] border border-dashed border-[#cfd9de] px-1 text-[10px] font-medium leading-[14px] text-x-sec"
                      title="This anonymous post was made on the test preview. It stays inside the preview and was never posted to Farcaster."
                    >
                      Preview only · not on Farcaster
                    </span>
                  ) : null}
                  {cast.reach ? <ReachBadge reach={cast.reach} /> : null}
                  {cast.ringShared ? (
                    // PERSONA LAUNCH P4: what a ring told THIS device — only a member's card carries it (absent otherwise)
                    <span
                      data-testid="cast-ring-shared"
                      data-persona={cast.ringShared.persona.handle}
                      className="ml-1 truncate text-[13px] text-x-sec"
                      title="Only you see this: a ring you are in shared which persona wrote this anonymous post. Nobody else, and no other app, can tell."
                    >
                      @{cast.ringShared.persona.handle} · shared with you by {cast.ringShared.label}
                    </span>
                  ) : null}
                </>
              ) : (
                <TierBadge tier={cast.tier} />
              )}
              <span className="mx-1 text-x-sec">·</span>
              <span className="shrink-0 text-x-sec hover:underline">{relativeTime(cast.timestamp)}</span>
            </p>
            <KebabMenu cast={cast} />
          </div>
          {/* FC-READ (review, privacy-safety-4): the visible mark, on its own line under the name row (the row already
              truncates on a phone; a pill in it would squeeze the name out). Pulled up into the gap the kebab leaves,
              and only as wide as its text so it never covers the kebab. */}
          {network && <NetworkMarker className="-mt-2 mb-0.5 w-fit" />}
          {cast.replyingTo && (
            <p className="text-[15px] leading-5 text-x-sec">
              Replying to <span className="text-x-blue">{cast.replyingTo}</span>
            </p>
          )}
          {readingLayout && cast.truncate ? (
            // MEGA PASS 2 Gate 3: under a reading layout the article owns its scroll — the zone router scrolls it in
            // place, so reading it never ejects you from the feed
            <div data-scroll-target="longform" data-testid="longform-body" className="max-h-[60vh] overflow-y-auto pr-1">
              <RichText text={cast.text} className="block text-[15px] leading-5" />
            </div>
          ) : (
            <RichText
              text={cast.text}
              className={`block text-[15px] leading-5 ${cast.truncate && !expanded ? "clamp-9" : ""}`}
            />
          )}
          {cast.anon && cast.castHash && !cast.attributedTo && <AnonRevealControl castHash={cast.castHash} />}
          {/* PUBLIC GO-LIVE (the relay track): every @anon card can be reported — a fixed list of reasons, nothing that names
              the reporter (components/zk/AnonReportButton.tsx → /api/anon/report → the validator's takedown queue) */}
          {cast.anon && cast.castHash ? <AnonReportButton castHash={cast.castHash} /> : null}
          {cast.truncate && !expanded && !readingLayout && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
              className="text-[15px] leading-5 text-x-blue hover:underline"
            >
              Show more
            </button>
          )}
          {cast.embeds.map((embed, i) => (
            <EmbedView key={i} embed={embed} network={network} />
          ))}
          <ActionRow cast={cast} className="mt-3 max-w-full" />
        </div>
      </div>
    </article>
  );
}
