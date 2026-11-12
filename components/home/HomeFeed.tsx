"use client";
// PROD-LIVE (D-CU-0-4, built) — THE HOME ISLAND.
//
// /home is the most identity-bearing page in the app: the timeline is built FOR the acting persona under its active
// mode, the header pill names that (persona, mode) pair, the composer must know whether that persona is public or
// private, the scroll zones are this device's own vault record, and the undo depth is a per-persona setting. On a
// PUBLIC deployment the server holds no identity at all, so every one of those server reads threw ("refusing to
// mint a device key on a production server"), the page printed "Couldn't load your timeline", and the ModePill —
// the rig's only link into settings — never rendered.
//
// So the page is split the way D-CU-0-4 says it must be:
//   - RIG (ZK_DEV_HOOKS=true, every acceptance suite): the server computes everything exactly as before and hands
//     it here as `initial`. Nothing is fetched; the DOM is the one the page always rendered (same components, same
//     order, same testids). router.refresh() re-renders the server and hands a fresh `initial`.
//   - PUBLIC (initial === null): the server renders the shell and nothing else. This island reads the same data
//     from the same routes the device answers in the browser — /api/feed2 (cards, mode, preview strip, stale flag,
//     debunk attribution), /api/modes (the pill), /api/zones (this device's layout), /api/home (composer props,
//     the pill's persona, the undo depth) — and refetches whenever the server render nonce changes or
//     Providers.refresh() is called, so every write that ends in router.refresh() still shows up.
//
// NEVER FAIL OPEN: a failed read renders a visible error with a Retry that re-reads in place (reload(), never a
// full document load — on a public deployment an unsaved visitor identity lives only in tab memory, and a full load
// mints a brand-new one). The composer is DISABLED until the device has said who is posting: a composer that
// guessed "public" for a private persona would post in the open.
//
// PUBLIC GO-LIVE (public live mode, Providers.publicLive): the device runs the empty world, so this timeline is only what
// is real — live Farcaster reads through the read relay when the owner has armed it, this visitor's own personas'
// posts, and the @anon posts. With reads not armed the page says so in one line ("Live Farcaster reads aren't switched
// on on this site yet") above whatever is real; a paused relay says that; an empty timeline says nothing has arrived
// (never fixture cards). Every read keeps its retry-then-error shape (FeedError + Retry). /home?compose=1 (the guided
// first run's hand-off) focuses the composer — on a phone, where the inline composer is hidden, it opens the compose
// sheet instead.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedCard } from "@/lib/feed";
import type { ModeDefinition } from "@/lib/adapters/types";
import type { ZoneConfig } from "@/lib/zones/types";
import type { Cast } from "@/lib/types";
import type { ComposerProps } from "@/lib/private/composerProps";
import { useApiJson } from "@/lib/client/useApiJson";
import { useApp } from "@/components/Providers";
import { HomeTabs } from "@/components/HomeTabs";
import { ModePill, type ActivePersonaInfo } from "@/components/ModePill";
import { PickUp } from "./PickUp";
import { Composer, noteFeedLiveSource } from "@/components/Composer";
import { PreviewStrip, type PreviewItem } from "@/components/PreviewStrip";
import { LiveSourceChip, SeededTimeline, readLiveSource, type LiveSource } from "@/components/SeededTimeline";
import { Timeline } from "@/components/Timeline";
import { TimelineSkeleton } from "@/components/Skeletons";
import { NoPersonaYet } from "@/components/world/NoPersonaYet";
import { HubFollowing } from "@/components/hub/HubFollowing";
import { HubForYou } from "@/components/hub/HubForYou";
import { ConnectFarcaster } from "@/components/x/ConnectFarcaster";
import { useRootAccounts } from "@/components/x/useRootAccounts";

type Surface = "discovery" | "following";
type Channel = { id: string; name: string };

/** what /api/feed2 answers (and what the rig's server page computed with buildFeed + debunkSourcesFor) */
export interface HomeFeedPayload {
  cards: FeedCard[];
  mode: ModeDefinition;
  contentStale: boolean;
  previewStrip?: PreviewItem[];
  pinnedHashes?: string[];
  debunk: Record<string, string>;
  /** FC-READ: where the network content came from — "relay" (public live reads) or "seed"; absent on the rig's
   *  server render, which is seed by construction */
  liveSource?: LiveSource;
}

/** the rig's server render, handed over whole — exactly what page.tsx used to put in its own JSX */
export interface HomeInitial {
  /** null when the server's read failed (then loadError says why) */
  feed: HomeFeedPayload | null;
  modes: ModeDefinition[];
  loadError: string | null;
  zones: ZoneConfig | null;
  undoDepth: number;
  composer: ComposerProps;
  persona?: ActivePersonaInfo;
  /** LAYERS_WORLD=empty (lib/world.ts): an empty timeline is "nothing real has arrived", not "your filters hid it" */
  emptyWorld?: boolean;
}

/** GET /api/home (app/api/home/route.ts) */
interface HomeExtras {
  personaId: string;
  persona: ActivePersonaInfo | null;
  composer: ComposerProps;
  undoDepth: number;
}
interface ModesPayload {
  modes: ModeDefinition[];
  activeId: string;
}
interface ZonesPayload {
  config: ZoneConfig;
  saved: boolean;
}

// UX Gate 2's documented default — the same one the server page and /api/personas/bindings use for a persona that
// never set a depth. Used on a public deployment only while /api/home has not answered (or could not): the depth
// is how many PRIOR feeds the session-scoped undo stack keeps, never content and never identity.
const DEFAULT_UNDO_DEPTH = 3;

function FeedError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div data-testid="feed-error" className="border-b border-x-border px-4 py-6">
      <p className="text-[17px] font-bold leading-6">Couldn&rsquo;t load your timeline</p>
      <p className="mt-1 text-[15px] leading-5 text-x-sec">{message}</p>
      {/* PROD-LIVE: was <a href="/home"> — a full document load, which on a public deployment wipes an unsaved
          visitor identity and mints a new one. Retry re-reads in place instead. */}
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex h-9 items-center rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover"
      >
        Retry
      </button>
    </div>
  );
}

function FeedBody({
  feed,
  surface,
  undoDepth,
  zones,
  emptyWorld = false,
}: {
  feed: HomeFeedPayload;
  surface: Surface;
  undoDepth: number;
  zones: ZoneConfig | null;
  emptyWorld?: boolean;
}) {
  const debunk = feed.debunk ?? {};
  return (
    <>
      {/* POST-DEPLOY Gate 3: the banner tier surfaces HERE — above the timeline,
          never as a notification, and never below the caught-up banner. */}
      <PreviewStrip items={feed.previewStrip ?? []} />
      <SeededTimeline
        initialCards={feed.cards}
        mode={feed.mode}
        debunkedStories={Object.keys(debunk)}
        debunkSources={debunk}
        surface={surface}
        undoDepth={undoDepth}
        initialContentStale={feed.contentStale}
        zones={zones}
        initialLiveSource={feed.liveSource ?? null}
        emptyWorld={emptyWorld}
      />
    </>
  );
}

/** PUBLIC GO-LIVE: the one line above a live timeline about where its network posts come from (null: nothing to say) */
export function liveReadsLine(liveSource: LiveSource | null): { state: "unarmed" | "paused" | "network"; text: string } | null {
  // NEYNAR AS A SWITCH (§42): the read key is set, but the operator keeps For You on Farcaster's network (FC_SOURCE_FORYOU)
  if (liveSource && liveSource.source === "seed" && liveSource.state === "network")
    return { state: "network", text: "For You via Neynar is switched off on this site, so nothing here comes from Neynar. Your personas' posts and @anon posts show here." };
  if (!liveSource || liveSource.source !== "relay") return { state: "unarmed", text: "Live Farcaster reads aren't switched on on this site yet. Your personas' posts and @anon posts show here." };
  if (liveSource.state === "live" || liveSource.state === "stale" || liveSource.state === "filtered") return null;
  if (liveSource.state === "unarmed") return { state: "unarmed", text: "Live Farcaster reads aren't switched on on this site yet. Your personas' posts and @anon posts show here." };
  return { state: "paused", text: "Live Farcaster reads are paused on this site right now. Your personas' posts and @anon posts still show here." };
}

export function HomeFeed({
  tab,
  surface,
  channels,
  initial,
  privacyLabel = null,
  focusComposer = false,
}: {
  tab: string;
  surface: Surface;
  channels: Channel[];
  /** the rig's server render; null on a public deployment (the device answers) */
  initial: HomeInitial | null;
  /** ZK PASS 1 Gate 3's server-computed label (rig only — a public server has no zk state to compute it from) */
  privacyLabel?: React.ReactNode;
  /** PUBLIC GO-LIVE: /home?compose=1 — focus the composer once it can be used */
  focusComposer?: boolean;
}) {
  const router = useRouter();
  const { actingPersonaId, personas, publicLive, setComposeOpen, rosterStatus, refreshTick } = useApp();
  const device = initial === null;

  // PROD-LIVE: on the rig every url is null, so nothing is ever fetched and `initial` is the whole truth
  const feedUrl = `/api/feed2?surface=${surface}`;
  // PUBLIC GO-LIVE: in live mode a visitor with no persona of their own (a guest, or only the read-only public self)
  // has no timeline to build — the device runs the empty world, where a mode and a feed need a persona — so nothing is
  // fetched for them: the page says the timeline starts with a persona (NoPersonaYet → the guided first run) and the
  // composer says "Make a persona to post". The roster is waited for first (never a guess either way).
  const ownCount = personas.filter((p) => p.publicSelf !== true).length;
  const liveGuest = device && publicLive && rosterStatus === "ready" && ownCount === 0;
  const holdForRoster = device && publicLive && rosterStatus === "loading";
  const fetchOn = device && !liveGuest && !holdForRoster;
  // FOLLOWING FROM THE HUB: on the live site, a visitor signed in with Farcaster (the root) sees THEIR OWN Farcaster
  // graph on Following, read by this tab straight from a Farcaster node (components/hub/HubFollowing.tsx →
  // lib/fc/hubRead/read.ts). The hub wins for Following whether or not the read relay is armed: the relay has no
  // following op, by design (it would hand the root's fid to the app server). For You for the same root comes from the
  // hub too (SPEC B, below). Without a Farcaster sign-in, Following and For You stay what they were.
  // PERSONA SEPARATION (§36): while a persona acts, Following is the persona's, never the root's graph (the device
  // refuses those reads too, acting_persona): the two never share a screen or a moment on Farcaster's network.
  const rootSignedIn = personas.some((p) => p.publicSelf === true);
  const actingAsPersona = !!actingPersonaId && personas.some((p) => p.id === actingPersonaId && p.publicSelf !== true);
  // SIGN IN WITH X: a root signed in with X ONLY has no Farcaster graph to read: Following says so and offers Connect Farcaster
  // (never a Farcaster read that fails). Unknown accounts (still reading, or unreadable) change nothing.
  const rootAccounts = useRootAccounts(device && publicLive && rosterStatus === "ready" && rootSignedIn, refreshTick);
  const rootXOnly = !!rootAccounts && rootAccounts.x && !rootAccounts.farcaster;
  const xOnlyFollowing = device && publicLive && surface === "following" && rosterStatus === "ready" && rootSignedIn && !actingAsPersona && rootXOnly;
  const hubFollowing = device && publicLive && surface === "following" && rosterStatus === "ready" && rootSignedIn && !actingAsPersona && !rootXOnly;
  // SPEC B, FOR YOU FROM THE HUB: the same visitor, acting as themselves, gets For You from their own Farcaster graph, read
  // by this tab from the node (components/hub/HubForYou.tsx → lib/fc/hubRead/forYou.ts). The hub wins for the root whether
  // or not the read relay is armed (consistency with Following, and the Neynar dependency risk); the relay stays For You
  // for everyone else (a persona acting, no Farcaster sign-in), unchanged. While a persona acts this is false and For You
  // is the persona's world exactly as before: nothing is read from the node (the device refuses those reads too).
  const hubForYou = device && publicLive && surface === "discovery" && rosterStatus === "ready" && rootSignedIn && !actingAsPersona && !rootXOnly;
  const hubRoot = hubFollowing || hubForYou;
  const feedQ = useApiJson<HomeFeedPayload>(fetchOn && !hubRoot ? feedUrl : null);
  // SPEC A: the real Following (and SPEC B's For You) runs the root's active mode (lib/fc/hubRead/mode.ts), so its pill is
  // there too, for a visitor with no persona at all as well (the root keeps all three dials: /api/modes answers the public
  // self's modes)
  const modesQ = useApiJson<ModesPayload>(fetchOn || hubRoot ? "/api/modes" : null);
  const zonesQ = useApiJson<ZonesPayload>(fetchOn ? "/api/zones" : null);
  const homeQ = useApiJson<HomeExtras>(fetchOn ? "/api/home" : null);

  // Which surface the device's feed data belongs to. A tab switch changes the url, and until the new surface's
  // cards arrive the hook still holds the old surface's — rendering those under the new tab would be a quiet lie,
  // so the body shows the skeleton until the answer for THIS surface is in. A refetch of the SAME surface (after a
  // write) keeps the timeline mounted, the way router.refresh() does on the rig.
  const [feedShownFor, setFeedShownFor] = useState<string | null>(null);
  useEffect(() => {
    if (device && feedQ.data && !feedQ.loading && !feedQ.error) setFeedShownFor(feedUrl);
    // feedUrl deliberately omitted: it must be read at the moment the data SETTLES, not when the tab changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, feedQ.data, feedQ.loading, feedQ.error]);

  // PUBLIC GO-LIVE: the hand-off's focus, once (desktop: the inline composer's autoFocus; phone: the compose sheet)
  const focusDone = useRef(false);
  const [focusNow, setFocusNow] = useState(false);
  const homeReady = device ? !!homeQ.data && !homeQ.error : true;
  useEffect(() => {
    if (!focusComposer || focusDone.current || !homeReady) return;
    focusDone.current = true;
    if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 639px)").matches) setComposeOpen(true);
    else setFocusNow(true);
  }, [focusComposer, homeReady, setComposeOpen]);

  let header: React.ReactNode;
  let composer: React.ReactNode;
  let composerNotice: React.ReactNode = null;
  let body: React.ReactNode;

  if (!device) {
    // ---- RIG: exactly the page's former render, from the server's own reads ----
    const init = initial as HomeInitial;
    header = init.feed ? (
      <ModePill initialModes={init.modes} initialActiveId={init.feed.mode.id} activePersona={init.persona} />
    ) : null;
    composer = <Composer {...init.composer} />;
    body = init.loadError ? (
      <FeedError message={init.loadError} onRetry={() => router.refresh()} />
    ) : init.feed ? (
      <FeedBody feed={init.feed} surface={surface} undoDepth={init.undoDepth} zones={init.zones} emptyWorld={init.emptyWorld} />
    ) : (
      <TimelineSkeleton count={6} />
    );
  } else {
    // ---- PUBLIC: the device's answers ----
    // The pill's persona is the SEEDED ACTING persona, as the device resolves it (/api/home). If the device's
    // seeded store does not know it (a persona this device minted), fall back to the chrome's roster entry for the
    // acting id — never the server's fixture persona.
    let persona: ActivePersonaInfo | undefined = homeQ.data?.persona ?? undefined;
    if (!persona && actingPersonaId) {
      const p = personas.find((x) => x.id === actingPersonaId);
      if (p) persona = { id: p.id, handle: p.handle, name: p.name, avatarUrl: p.avatarUrl ?? "" };
    }
    // SPEC A: on the real Following no persona acts: the pill names the root (its public self), never a persona. Its
    // picture is the visitor's Farcaster profile picture on some outside host, and the pill draws a plain <img> (no
    // allowlist, unlike a hub card's MediaImg), so it is left out unless it is self-contained: naming the root here
    // must not make the browser fetch from a third party (scripts/accept-hub-read-prod.mjs HR11)
    if (hubRoot) {
      const self = personas.find((x) => x.publicSelf === true);
      const pic = self?.avatarUrl ?? "";
      if (self) persona = { id: self.id, handle: self.handle, name: self.name, avatarUrl: pic.startsWith("data:") ? pic : "" };
    }

    if (liveGuest && !hubRoot) {
      // PUBLIC GO-LIVE: no persona, no mode — no pill (and never a skeleton that waits for a read that is not made)
      header = null;
    } else if (modesQ.error) {
      // never an empty pill presented as "no modes": the read failed, say so, re-read in place
      header = (
        <button
          type="button"
          data-testid="mode-pill-error"
          title={modesQ.error}
          onClick={modesQ.reload}
          className="flex h-8 items-center rounded-full bg-x-pill px-3 text-[13px] font-bold text-[#f4212e] hover:bg-[#e1e8ed]"
        >
          Modes unavailable &middot; Retry
        </button>
      );
    } else if (modesQ.data && (homeQ.data || homeQ.error || hubRoot)) {
      header = (
        <ModePill
          initialModes={modesQ.data.modes}
          // the mode the feed was BUILT under wins (buildFeed applies a due activation rule first); the modes
          // route's active id stands in until the feed has answered. The real Following builds no feed here: the
          // modes route's active id is the mode its device applies.
          initialActiveId={(hubRoot ? null : feedQ.data?.mode.id) ?? modesQ.data.activeId}
          activePersona={persona}
        />
      );
    } else {
      // the pill's own skeleton (components/Skeletons.tsx's `skeleton` treatment) until the device has answered
      header = <span data-testid="mode-pill-loading" aria-hidden="true" className="skeleton block h-8 w-24 rounded-full" />;
    }

    // The composer stays the SAME element in every state (so a draft survives a refetch); only its props change.
    if (homeQ.data && !homeQ.error) {
      composer = <Composer {...homeQ.data.composer} autoFocus={focusNow} />;
    } else {
      composer = <Composer disabled personaKind="unknown" />;
      if (homeQ.error) {
        composerNotice = (
          <div data-testid="composer-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
            Couldn&rsquo;t read who you&rsquo;re posting as, so posting is off until it can: {homeQ.error}
            <button type="button" onClick={homeQ.reload} className="ml-2 font-bold text-x-blue hover:underline">
              Retry
            </button>
          </div>
        );
      }
    }

    // MEGA PASS 2 Gate 3's rule, unchanged: an unreadable zone layout is the DEFAULT layout (the browser scrolls
    // the timeline), never a guess at one. The body waits for the read to settle so the shell does not jump.
    const zonesSettled = !!zonesQ.data || !!zonesQ.error;
    const zones = zonesQ.data && zonesQ.data.saved ? zonesQ.data.config : null;
    const feedReady = !!feedQ.data && feedShownFor === feedUrl;

    // PUBLIC GO-LIVE: the live line, from the payload's own liveSource (the device's answer, never a guess)
    const reads = publicLive && feedReady ? liveReadsLine(readLiveSource((feedQ.data as HomeFeedPayload).liveSource)) : null;
    body = xOnlyFollowing ? (
      <ConnectFarcaster what="following" />
    ) : hubFollowing ? (
      <HubFollowing />
    ) : hubForYou ? (
      <HubForYou />
    ) : liveGuest ? (
      <NoPersonaYet what="Your timeline" />
    ) : feedQ.error ? (
      <FeedError message={feedQ.error} onRetry={feedQ.reload} />
    ) : feedReady && zonesSettled ? (
      <>
        {reads ? (
          <p data-testid="live-reads-line" data-state={reads.state} role="status" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec">
            {reads.text}
          </p>
        ) : null}
        <FeedBody
          feed={feedQ.data as HomeFeedPayload}
          surface={surface}
          undoDepth={homeQ.data?.undoDepth ?? DEFAULT_UNDO_DEPTH}
          zones={zones}
          {...(publicLive ? { emptyWorld: true } : {})}
        />
      </>
    ) : (
      <TimelineSkeleton count={6} />
    );
  }

  return (
    <>
      <HomeTabs active={tab} channels={channels} right={header} />
      <div className="hidden sm:block">
        {composer}
        {composerNotice}
      </div>
      {/* PUBLIC GO-LIVE: "Pick up where you left off" (live mode, the visitor's own device; renders nothing elsewhere) */}
      {device ? <PickUp /> : null}
      {/* ZK PASS 1 Gate 3: on the proof-mediated discovery surface, the
          COMPUTED privacy label — DEMO until every condition holds. */}
      {privacyLabel}
      {body}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The phase-1 classic fixture timeline (?feed=classic) — the validator-backed surface scripts/functional.mjs drives.
// PROD-LIVE (D-CU-0-4): its server reads (getSession, applyFeedPolicy against the session's personas) are identity
// reads too, so on a public deployment the device answers GET /api/feed instead — the same route the timeline's
// own infinite scroll already pages through. One honest difference, named: /api/feed does not run the crosspost
// collapse (decorateCrossposts) the rig's server render applies to page 0, so on a public deployment a crossposted
// cast shows without its "Also posted to" chip / mirror copy on this rig-only surface.
export interface ClassicInitial {
  casts: Cast[];
  nextPage: number | null;
  /** FC-READ: /api/feed's live status (absent on the rig's server render) */
  liveSource?: LiveSource;
}

export function ClassicHomeFeed({
  tab,
  channels,
  initial,
}: {
  tab: string;
  channels: Channel[];
  initial: ClassicInitial | null;
}) {
  const q = useApiJson<ClassicInitial>(initial ? null : `/api/feed?tab=${encodeURIComponent(tab)}`, { initial });
  const data = initial ?? q.data;
  // PUBLIC GO-LIVE: in live mode the paused chip promises no preview content (there is none)
  const { publicLive } = useApp();
  // FC-READ: the composer's success toast names where a post went; it learns the feed's source from here
  const classicSource = readLiveSource(data?.liveSource)?.source ?? null;
  useEffect(() => {
    noteFeedLiveSource(classicSource);
  }, [classicSource]);
  return (
    <>
      <HomeTabs active={tab} channels={channels} />
      <div className="hidden sm:block">
        <Composer />
      </div>
      {!initial && q.error ? (
        <FeedError message={q.error} onRetry={q.reload} />
      ) : data ? (
        <>
          {/* FC-READ (no channels): the classic timeline's For You reads through the relay too — same honest label; channel tabs stay seed */}
          <LiveSourceChip liveSource={readLiveSource(data.liveSource)} live={publicLive} />
          <Timeline initialCasts={data.casts} tab={tab} nextPage={data.nextPage} />
        </>
      ) : (
        <TimelineSkeleton count={6} />
      )}
    </>
  );
}
