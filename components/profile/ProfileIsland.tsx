"use client";
// PROD-LIVE PASS (D-CU-0-4) — the profile page's body, as ONE client island.
//
// A profile is identity-bearing from top to bottom: whether it is YOUR profile (Edit profile, resurface controls),
// what PersonaResolver lets THIS viewer see (linked identities), whether you blocked it, your relationship history
// with it, and — for a visitor's own persona, minted in the browser — whether the handle exists at all. On a public
// deployment the server knows none of that (it holds no identity, and it has never heard of a persona the device
// minted, so it used to 404 a visitor's own profile). So:
//
//   * RIG: the server page computes the profile (lib/views/social.server.ts profileView) and the relationship history
//     exactly as it used to, and hands both in as `initial` — nothing is fetched, the DOM is what it always was;
//   * PUBLIC: the server renders only this island; it fetches /api/profile?handle= and, for someone else's seeded
//     profile, /api/eventlog/history?target= — both answered in the browser by the device.
//
// Never fails open: an unread profile is an error with a Retry, an unread block list never renders "not blocked",
// and an unread history is said out loud rather than drawn as "no history".
//
// PERSONA LAUNCH P1 (SIWF): the visitor's OWN Farcaster account (the read-only public self a Sign in with Farcaster
// minted; the view carries its sealed facts as `publicSelf` {fname, verifiedAt, disconnected}, never the fid) renders
// with the "That's me" badge, "Farcaster · read-only" (no Follow, no Edit profile), "Open on farcaster.xyz" (the
// browser's own request, in a new tab), its picture under the held-media rule, and — only when this page reads
// through the preview's read relay, and only when pressed, with the sentence that says what it reveals — "Show my
// Farcaster posts here" (GET /api/profile?handle=…&live=1). Never automatic.
import { useState } from "react";
import Link from "next/link";
import { useApiJson } from "@/lib/client/useApiJson";
import { useApp } from "@/components/Providers";
import { PROFILE_MISSING, livePausedSentence, type ProfileView, type RelationshipHistoryView } from "@/lib/views/social";
import { formatFull } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { ProfileHeader, ProfileTabs } from "@/components/ProfileHeader";
import { LinkedIdentitiesSection, RingSharedSection, type RingSharedView } from "@/components/LinkedIdentity";
import { RelationshipHistory, RelationshipHistoryError } from "@/components/RelationshipHistory";
import { ImportedFromX } from "@/components/x/ImportedFromX";
import { CastCard, isNetworkCast, mediaHostAllowed, pageReadsThroughRelay } from "@/components/CastCard";
import type { FcSourceLabel } from "@/lib/fc/source/switch";
import { LiveSourceChip, readLiveSource } from "@/components/SeededTimeline";
import { TierBadge } from "@/components/TierBadge";
import { FacetFollow } from "@/components/FacetFollow";
import { BlockPersonasButton } from "@/components/BlockPersonasButton";
import { TimelineSkeleton } from "@/components/Skeletons";
import { GrokIcon, SearchIcon, VerifiedBadge } from "@/components/icons";
import { ThatsMeBadge } from "@/components/profile/ThatsMeBadge";
import { ConnectFarcaster } from "@/components/x/ConnectFarcaster";

function HeaderRight() {
  return (
    <span className="flex items-center">
      <button aria-label="Grok" className="flex h-[34px] w-[34px] items-center justify-center rounded-full hover:bg-x-hover">
        <GrokIcon size={20} />
      </button>
      <button aria-label="Search" className="-mr-2 ml-1 flex h-[34px] w-[34px] items-center justify-center rounded-full hover:bg-x-hover">
        <SearchIcon size={20} />
      </button>
    </span>
  );
}

/** FC-READ: the held-back avatar — a neutral disc, inline (no host learns anything from it) */
const HELD_PFP =
  "data:image/svg+xml," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#cfd9de"/></svg>');

function hostOf(src: string): string {
  try {
    return new URL(src).hostname.replace(/^www\./, "");
  } catch {
    return "another site";
  }
}

/** PERSONA LAUNCH P1 (SIWF): the public self's sealed facts, when the view carries them (lib/views/social.server.ts,
 *  or app/api/profile filling them in) */
interface PublicSelfFacts {
  fname: string;
  verifiedAt: number;
  disconnected: boolean;
  /** PUBLIC GO-LIVE (This is you): the X account its Farcaster account verifies, when the owner chose Show */
  xShown?: string;
  /** SIGN IN WITH X: "x" when this root signed in with X only (fname is then its Totem handle) */
  via?: "x";
  /** SIGN IN WITH X: the X account this root signed in with */
  x?: { username: string; disconnected: boolean };
}
function publicSelfOf(v: ProfileView | null): PublicSelfFacts | null {
  if (!v || v.kind !== "seeded") return null;
  const ps = (v as ProfileView & { publicSelf?: PublicSelfFacts }).publicSelf;
  return ps && typeof ps.fname === "string" ? ps : null;
}

/** NEYNAR AS A SWITCH (§42), THE HARD RULE: "Show my Farcaster posts here" (a relay lookup of the visitor's own fname, which
 *  names their account to Totem's server) is RETIRED. Their own posts are read from Farcaster's network on their profile
 *  there (/fc/profile, read by this browser from a Farcaster node, §36), so the page says that, and asks nothing. */
function PublicSelfNetworkNote() {
  const source: FcSourceLabel = "network";
  return (
    <p data-testid="own-posts-network" data-source={source} className="border-b border-x-border px-4 py-3 text-[13px] leading-4 text-x-sec">
      Your Farcaster posts are read from Farcaster&rsquo;s network on your Farcaster profile (open it from Following), never through Neynar: that read would hand your account to Totem&rsquo;s server.
    </p>
  );
}

function RetryButton({ onClick, testid }: { onClick: () => void; testid: string }) {
  return (
    <button type="button" data-testid={testid} onClick={onClick} className="ml-2 font-bold text-x-blue hover:underline">
      Retry
    </button>
  );
}

export function ProfileIsland({
  handle,
  initial,
  initialHistory,
}: {
  handle: string;
  /** the server's render on the rig; null on a public deployment (the device answers /api/profile) */
  initial: ProfileView | null;
  /** the rig's relationship history (someone else's seeded profile only); null otherwise */
  initialHistory: RelationshipHistoryView | null;
}) {
  const { deviceIsThePage, refresh } = useApp();
  // FC-READ: the visitor asked to load a network profile's off-allowlist avatar/banner (see the fixture branch)
  const [loadProfileMedia, setLoadProfileMedia] = useState(false);
  const profile = useApiJson<ProfileView>(`/api/profile?handle=${encodeURIComponent(handle)}`, { initial });
  const v = profile.data;
  // PERSONA LAUNCH P1 (SIWF): your own Farcaster account is not someone you have a history WITH
  const historyTarget = v && v.kind === "seeded" && !v.isOwn && !publicSelfOf(v) ? v.personaId : null;
  const history = useApiJson<RelationshipHistoryView>(
    historyTarget ? `/api/eventlog/history?target=${encodeURIComponent(historyTarget)}` : null,
    { initial: initialHistory }
  );
  // PERSONA LAUNCH P4: a Farcaster account a RING shared with this device — asked of the device (memory only: what its
  // background check received), never of a server, and only for an account with a real fid
  const ringFid = v && v.kind === "fixture" && v.user.fid > 0 ? v.user.fid : null;
  const ringShared = useApiJson<{ shared: RingSharedView | null }>(ringFid ? `/api/rings?fid=${ringFid}` : null);
  // Retry re-runs the READ, never a document load (an unsaved visitor identity lives only in this tab): on the rig
  // that is the server render (router.refresh()); on a public deployment it is the island's own fetch.
  const retryProfile = deviceIsThePage ? profile.reload : refresh;
  const retryHistory = deviceIsThePage ? history.reload : refresh;

  // PROD-LIVE (review fix): the ERROR is checked before the data, never only when the data is missing — a re-read
  // that failed (after a persona switch, after a block) must not leave the previous answer on screen with no error.
  // (useApiJson also drops the data on a failed re-read; this ordering is the island's half of the same rule.)
  if (profile.error || !v) {
    if (profile.error === PROFILE_MISSING) {
      return (
        <>
          <PageHeader back title="Profile" />
          <div data-testid="profile-not-found" className="px-8 py-10">
            <p className="text-[31px] font-extrabold leading-9">This account doesn&rsquo;t exist</p>
            <p className="mt-2 text-[15px] leading-5 text-x-sec">
              Try{" "}
              <Link href="/search" className="text-x-blue hover:underline">
                searching for another
              </Link>
              .
            </p>
          </div>
        </>
      );
    }
    // FC-READ (review, correctness-paused-relay-renders-load-error-needle): a network account the read relay did not
    // answer is not a broken page — the relay's fixed sentence (the closed table in lib/views/social.ts, the same one
    // the device builds the 503's `error` from) renders as the paused state with a Retry, never inside the generic
    // load-error block below ("Couldn't load" is a page-health needle, and "-error" testids read as a broken page)
    const paused = livePausedSentence(profile.error);
    if (paused) {
      return (
        <>
          <PageHeader back title={`@${handle}`} />
          <div data-testid="live-paused" role="status" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
            {paused}
            <RetryButton onClick={retryProfile} testid="live-paused-retry" />
          </div>
        </>
      );
    }
    if (profile.error) {
      return (
        <>
          <PageHeader back title="Profile" />
          <p data-testid="profile-error" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
            Couldn&rsquo;t load @{handle} right now ({profile.error}).
            <RetryButton onClick={retryProfile} testid="profile-retry" />
          </p>
        </>
      );
    }
    return (
      <>
        <PageHeader back overlayOnMobile title={`@${handle}`} />
        <div data-testid="profile-loading" aria-busy="true">
          <div className="h-[130px] bg-[#cfd9de] sm:h-[200px]" />
          <TimelineSkeleton count={3} />
        </div>
      </>
    );
  }

  // ---- phase-1 fixture profile ----
  if (v.kind === "fixture") {
    const { casts, isSelf, tier } = v;
    // FC-READ: a live Farcaster profile (read through the public relay) names its own avatar and banner hosts, and
    // ProfileHeader renders them as bare <img>s. Off the allowlist they are held back (a blank disc, no banner) until
    // the visitor taps to load them — the same rule as a network cast's media (CastCard MediaImg). Fixture profiles
    // use the seed's allowlisted hosts, and no rig ever reads through the relay, so both render exactly as before.
    //
    // FC-READ (review, correctness-fixture-profile-marked-network): whether this IS a network account comes from the
    // data alone — the view's mark, the user's mark, or a network cast among its posts. pageReadsThroughRelay() says
    // only that this PAGE's device can read the relay, which is true on every relay-armed page, fixture profiles
    // included; OR-ing it in rendered every fixture account (fake fids, X-style handles) as a live, read-only
    // Farcaster account. It still decides one thing: whether media is held back (a cautious default on such a page).
    const network =
      v.network === true ||
      v.user.network === true ||
      casts.some(isNetworkCast);
    const holdMedia = network || pageReadsThroughRelay();
    const held =
      holdMedia && !loadProfileMedia ? [v.user.pfpUrl, v.user.bannerUrl].filter((u): u is string => !!u && !mediaHostAllowed(u)) : [];
    // FC-READ (review, privacy-safety-3): the relay's freshness for this account (live, or off a shelf); no chip unless
    // the page's content came through the relay
    const liveSource = network ? readLiveSource(v.liveSource) : null;
    const user =
      held.length > 0
        ? {
            ...v.user,
            pfpUrl: mediaHostAllowed(v.user.pfpUrl) ? v.user.pfpUrl : HELD_PFP,
            bannerUrl: v.user.bannerUrl && mediaHostAllowed(v.user.bannerUrl) ? v.user.bannerUrl : undefined,
          }
        : v.user;
    const heldHosts = [...new Set(held.map(hostOf))].join(", ");
    return (
      <>
        <PageHeader
          back
          overlayOnMobile
          title={user.displayName}
          titleBadge={
            <span className="flex shrink-0 items-center">
              {user.verified && <VerifiedBadge size={18} className="ml-0.5" />}
              <TierBadge tier={tier} />
            </span>
          }
          subtitle={`${formatFull(user.postCount ?? casts.length)} posts`}
          right={<HeaderRight />}
        />
        <ProfileHeader user={user} isSelf={isSelf} tier={tier} network={network} live={v.live === true && !network} />
        {ringShared.data?.shared ? <RingSharedSection shared={ringShared.data.shared} /> : null}
        <LiveSourceChip liveSource={liveSource} />
        {held.length > 0 && (
          <button
            type="button"
            data-testid="media-click-to-load"
            data-host={heldHosts}
            title={`Tap to load (${heldHosts} will see your IP address).`}
            onClick={() => setLoadProfileMedia(true)}
            className="block w-full border-b border-x-border px-4 py-2 text-left text-[13px] leading-4 text-x-sec hover:bg-x-hover"
          >
            Profile images from {heldHosts} &middot; tap to load
          </button>
        )}
        <ProfileTabs />
        <div>
          {casts.map((cast) => (
            <CastCard key={cast.hash} cast={cast} />
          ))}
          <div className="h-24" />
        </div>
      </>
    );
  }

  // ---- PERSONA LAUNCH P1 (SIWF): the visitor's own Farcaster account (read-only public self) ----
  const publicSelf = publicSelfOf(v);
  if (publicSelf && v.kind === "seeded") {
    const heldPfp = !loadProfileMedia && !!v.user.pfpUrl && !mediaHostAllowed(v.user.pfpUrl);
    const selfUser = { ...v.user, pfpUrl: heldPfp ? HELD_PFP : v.user.pfpUrl, bannerUrl: undefined };
    return (
      <>
        <PageHeader
          back
          overlayOnMobile
          title={v.name}
          titleBadge={
            <span className="flex shrink-0 items-center">
              <ThatsMeBadge fname={publicSelf.fname} verifiedAt={publicSelf.verifiedAt} disconnected={publicSelf.disconnected} />
            </span>
          }
          subtitle={publicSelf.via === "x" ? "Your X account" : publicSelf.x ? "Your Farcaster and X accounts" : "Your Farcaster account"}
          right={<HeaderRight />}
        />
        <div data-testid="public-self-profile" data-state={publicSelf.disconnected ? "disconnected" : "signed-in"}>
          <ProfileHeader user={selfUser} isSelf={false} tier={undefined} network />
          <div className="flex flex-wrap items-center gap-2 border-b border-x-border px-4 pb-3">
            {publicSelf.via === "x" ? null : (
              <a
                data-testid="open-on-farcaster"
                href={"https://farcaster.xyz/" + encodeURIComponent(publicSelf.fname)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[15px] font-bold text-x-blue hover:underline"
              >
                Open on farcaster.xyz
              </a>
            )}
            {/* SIGN IN WITH X: the X account this root signed in with (X itself said so), when This is you said Show */}
            {publicSelf.x && publicSelf.xShown === publicSelf.x.username ? (
              <a
                data-testid="public-self-x"
                data-source="signed-in"
                href={"https://x.com/" + encodeURIComponent(publicSelf.x.username)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[15px] text-x-sec hover:underline"
              >
                {publicSelf.via === "x" ? "" : "· "}
                <span className="font-bold text-x-text">@{publicSelf.x.username}</span> on X, signed in with X{publicSelf.x.disconnected ? " (disconnected)" : ""}
              </a>
            ) : publicSelf.xShown ? (
              <span data-testid="public-self-x" className="text-[15px] text-x-sec">
                · <span className="font-bold text-x-text">@{publicSelf.xShown}</span> on X, verified on your Farcaster account
              </span>
            ) : null}
          </div>
          {heldPfp && (
            <button
              type="button"
              data-testid="media-click-to-load"
              data-host={hostOf(v.user.pfpUrl)}
              title={`Tap to load (${hostOf(v.user.pfpUrl)} will see your IP address).`}
              onClick={() => setLoadProfileMedia(true)}
              className="block w-full border-b border-x-border px-4 py-2 text-left text-[13px] leading-4 text-x-sec hover:bg-x-hover"
            >
              Profile picture from {hostOf(v.user.pfpUrl)} &middot; tap to load
            </button>
          )}
          {publicSelf.via === "x" ? (
            // SIGN IN WITH X: an X-only root has no Farcaster posts to show; say what needs a Farcaster account
            <ConnectFarcaster what="profile" />
          ) : (
            <>
              <p className="border-b border-x-border px-4 py-3 text-[13px] leading-4 text-x-sec">
                Read-only here. Posting to Farcaster as this account from Totem isn&rsquo;t built yet: post as it in the Farcaster app, or as one of your personas.
              </p>
              <PublicSelfNetworkNote />
            </>
          )}
        </div>
        <div className="h-24" />
      </>
    );
  }

  // ---- seeded persona profile (Waves 1-3 surfaces live here) ----
  const { user, casts, isOwn, isBlocked, blockCheckFailed, tier } = v;
  return (
    <>
      <PageHeader
        back
        overlayOnMobile
        title={v.name}
        titleBadge={
          <span className="flex shrink-0 items-center">
            {user.verified && <VerifiedBadge size={18} className="ml-0.5" />}
            <TierBadge tier={tier} />
          </span>
        }
        subtitle={`${formatFull(v.postCount)} posts`}
        right={<HeaderRight />}
      />
      <ProfileHeader user={user} isSelf={isOwn} tier={tier} />
      {/* Disclosure surface. Everything shown here came from
          PersonaResolver, which already decided what this viewer may see. */}
      <LinkedIdentitiesSection identity={v.identity} />
      {/* PROD-LIVE (review fix): error before data — a failed re-read never leaves the previous history drawn */}
      {!isOwn &&
        (history.error ? (
          <RelationshipHistoryError onRetry={retryHistory} />
        ) : history.data ? (
          <RelationshipHistory view={history.data} onRetry={retryHistory} />
        ) : (
          <div data-testid="relationship-history-loading" aria-busy="true" className="border-b border-x-border px-4 py-3">
            <div className="skeleton h-3.5 w-40 rounded-full" />
          </div>
        ))}
      {blockCheckFailed && (
        <p data-testid="block-check-failed" className="border-b border-x-border px-4 py-3 text-[15px] text-x-sec">
          Couldn&rsquo;t confirm your block settings for this account.
          <RetryButton onClick={retryProfile} testid="block-check-retry" />
        </p>
      )}
      {!isOwn && <FacetFollow personaId={v.personaId} />}
      {!isOwn && !isBlocked && !blockCheckFailed && <BlockPersonasButton personaId={v.personaId} handle={v.handle} />}
      {isBlocked && (
        <p data-testid="profile-blocked" className="border-b border-x-border px-4 py-3 text-[15px] text-x-sec">
          You blocked this account. All of its personas are hidden from your feed, search, and replies.
        </p>
      )}
      <ProfileTabs />
      <div data-testid="profile-posts">
        {casts.map((cast) => (
          <CastCard key={cast.hash} cast={cast} />
        ))}
        {casts.length === 0 && <p className="px-4 py-6 text-[15px] text-x-sec">No posts yet.</p>}
      </div>
      <ImportedFromX imported={v.imported} isOwn={isOwn} />
      <div className="h-24" />
    </>
  );
}
