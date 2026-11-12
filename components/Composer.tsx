"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./Providers";
import { chromeAvatarSrc } from "./CastCard";
import { FC_CAST_MAX_BYTES, castBytes } from "@/lib/fc/castLimits";
import { anonDefaultNoteShown, expectationFrom, refusalKind, type LineDelivery } from "./deliveryLine";
import { AnonPostStatus, AnonRecentStatus } from "./AnonPostStatus";
import { PostModePicker, type PostModeOption } from "./PostModePicker";
import { ReachPicker, type ReachOption } from "./ReachPicker";
import { RingAudienceLine } from "./rings/RingAudienceLine";
import { XOutboxToggle } from "./XOutboxToggle";
import { XOutboxStatusLine } from "./XOutboxStatusLine";
import { cadenceSentence } from "@/lib/zk/anon/slots";
import Link from "next/link";
import { JOIN_LABEL, REJOIN_LABEL, crowdSignInAsked, readAnonDestination, welcomeHref, type AnonDestinationAnswer } from "@/lib/onboarding/state";
import { liveUniverseHinted } from "@/lib/zk/anon/universe";
import { AnonTermsLink } from "@/components/zk/AnonTermsLink";
import { MAKE_PERSONA_EVENT, MAKE_PERSONA_HREF } from "@/lib/onboarding/state";
import { RootComposer, RootPostConnect, useRootPost } from "@/components/root/RootPost";
import { ACTING_AS_YOU_LINE, ROOT_OFF_WHILE_PERSONA } from "@/lib/fc/rootSigner/copy";
import {
  EmojiIcon,
  FlagIcon,
  GifIcon,
  GrokIcon,
  ImageIcon,
  LocationIcon,
  PollIcon,
  ScheduleIcon,
} from "./icons";

// ---------- FC-READ + BUILD A: where a post goes, said honestly ----------
//
// A public deployment never posts to Farcaster (no write key ships there): every post lands in the visitor's own Totem
// preview, so the toast says exactly that — "Posted to your Totem preview, not to Farcaster". (FC-READ said it only
// beside a relay-sourced timeline and a generic "your post was sent" line elsewhere; BUILD A retired that line
// everywhere, because it claimed a send that never happened.)
//
// The rig and the owner service ask the server (GET /api/actions/delivery) BEFORE the click — "Posts to Farcaster as
// @x — public", or "Saved in Totem only — <why>" — and show the server's answer AFTER it: the cast and its address on
// farcaster.xyz, or the exact refusal. The words live in app/api/actions/farcasterDelivery.ts, not here.
//
// BUILD A review (PUB-1): the line is BOUND to the click. The post carries what the line said (`expect`: where, as which
// persona, under which account); the server decides again and refuses — nothing posted, the fresh line returned — when
// the answer changed (the acting persona is one cookie shared by every tab; an account can arrive while a tab is
// open). The line is asked again whenever this window regains focus or its tab becomes visible. (PUB-2) A Farcaster
// post shows its size against Farcaster's 320-byte limit, and Post is held back over it.
const PREVIEW_SENTENCE = "Posted to your Totem preview, not to Farcaster";

// ---------- PUBLIC GO-LIVE: where a persona's post goes, in the anon route's own words ----------
//
// GET /api/anon answers where a persona's post goes (the relay track's contract: destination "farcaster" | "layers" |
// "off", destinationSentence, postedSentence, castUrl; read by lib/onboarding/state.ts readAnonDestination). BEFORE the
// click the status line shows destinationSentence (and castUrl's link when there is one); AFTER it the toast is
// postedSentence. This file writes none of its own words about where a post goes: a route that does not answer the
// contract leaves the line exactly as it was. In public live mode, a visitor signed in with Farcaster and no persona sees
// "Posting as @you" — their own account, the root. POST AS YOU (2026-11-05): "Allow Totem to post as you" is BUILT
// (components/root/RootPost.tsx → app/api/fc/root/route.ts → lib/fc/rootSigner/flow.ts): a key made and sealed in the
// visitor's own vault, approved in their Farcaster app, checked on Farcaster's network; once it is active this composer
// IS the root's ("Posts go to Farcaster as @you."). Until then the line says what allowing it does, the button asks, and
// a site whose validator holds no app account says so ("isn't switched on on this site yet"). A persona stays the
// other way to post (no name on it, through @anon). A guest sees "Sign in with Farcaster to post" (→ the guided first
// run) and the same persona offer. A visitor with a persona of their own gets that persona's composer while it acts, and
// the root's box once they choose "You" in the account menu (ACTING AS YOURSELF, lib/device/actingRoot.ts).
/** PUBLIC GO-LIVE / POST AS YOU: the one line about the public self before Totem may post as it */
export function publicSelfPostLine(handle: string): string {
  return `Totem posts to Farcaster as @${handle} once you allow it, with a key kept in your own vault.`;
}
/** what else works for a visitor with no persona */
export const PERSONA_WORKS_TODAY = "Or use a persona: it posts to Farcaster with no name on it, through @anon.";

/** PERSONA LAUNCH P3: the persona a post would be made as, from GET /api/anon `postAs` (the server's answer) */
interface PostAs {
  personaId: string | null;
  handle: string | null;
  mode: PostModeOption | null;
  options: PostModeOption[];
  settable: boolean;
  /** may this persona post anonymously at all (own, public, not set to Totem only) */
  available: boolean;
  reason: string | null;
  /** PRIV-2: does the persona own its own Farcaster account (then "anon" mode keeps that account silent) */
  ownAccount: boolean;
  /** was the mode chosen (true) or is it the default for the persona's situation (false) */
  explicit: boolean;
  /** PERSONA LAUNCH P4: the rings that will see this post is yours (labels), and why they could not be read */
  rings: string[];
  ringsError: string | null;
  /** PERSONA LAUNCH P6 (D2): a launched persona that has not chosen where its posts go — Post waits for the choice */
  choiceRequired: boolean;
  launched: boolean;
  /** PERSONA LAUNCH P6 (UX-L1): the persona's launch is under way, so an anon post now is REVEALED with its other ones
   *  (not "attributed to no one"); `launchNotice` is the server's sentence for it (lib/zk/gate.ts launchRevealSentence) */
  launchPending: boolean;
  launchNotice: string | null;
  /** PERSONA LAUNCH P7 (UXH-8): the owner service — rings made there reach nobody yet */
  ownerService: boolean;
}
/** PERSONA LAUNCH P5: the reach tiers the server offers for this post (never one under the crowd floor) */
interface ReachAnswer {
  offered: ReachOption[];
  defaultTree: string;
  plainTree: string;
  reason: string | null;
}
function readReach(v: unknown): ReachAnswer | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.defaultTree !== "string" || typeof o.plainTree !== "string") return null;
  const offered = Array.isArray(o.offered)
    ? (o.offered as unknown[]).filter((x): x is ReachOption => !!x && typeof x === "object" && typeof (x as ReachOption).tree === "string" && typeof (x as ReachOption).label === "string" && typeof (x as ReachOption).size === "number")
    : [];
  return { offered, defaultTree: o.defaultTree, plainTree: o.plainTree, reason: typeof o.reason === "string" ? o.reason : null };
}
function readPostAs(v: unknown): PostAs | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const isMode = (m: unknown): m is PostModeOption => m === "anon" || m === "private" || m === "direct";
  return {
    personaId: typeof o.personaId === "string" ? o.personaId : null,
    handle: typeof o.handle === "string" ? o.handle : null,
    mode: isMode(o.mode) ? o.mode : null,
    options: Array.isArray(o.options) ? (o.options as unknown[]).filter(isMode) : [],
    settable: o.settable === true,
    available: o.available === true,
    reason: typeof o.reason === "string" ? o.reason : null,
    ownAccount: o.ownAccount === true,
    explicit: o.explicit === true,
    rings: Array.isArray(o.rings) ? (o.rings as unknown[]).filter((x): x is string => typeof x === "string") : [],
    ringsError: typeof o.ringsError === "string" ? o.ringsError : null,
    choiceRequired: o.choiceRequired === true,
    launched: o.launched === true,
    launchPending: o.launchPending === true,
    launchNotice: typeof o.launchNotice === "string" && o.launchNotice ? o.launchNotice : null,
    ownerService: o.ownerService === true,
  };
}
/** PERSONA LAUNCH P6 (UX-L1): who sees what of an anon post made while its persona's launch is under way — the server's
 *  sentence (never "attributed to no one": the launch's batch reveal will hold this post too), then who sees it as yours
 *  before that (the rings that see this persona's posts, else nobody but you) */
function launchRevealLine(postAs: PostAs, who: string): string {
  const first = postAs.launchNotice ?? `${who} is being launched, so this post will become public as ${who}'s when the launch reveals its anonymous posts.`;
  const r = postAs.ownerService ? [] : postAs.rings; // UXH-8: rings made on the owner service reach nobody yet
  const ringWords = r.length === 0 ? "" : r.length === 1 ? `, except your ring ${r[0]}, which sees it is yours right away` : `, except your rings ${r.slice(0, -1).join(", ")} and ${r[r.length - 1]}, which see it is yours right away`;
  return `${first} Until then everyone sees @anon${ringWords}.`;
}

/** BYX G0 (applied by the anon track, which owns this file): the crosspost answer as one sentence — the route's own
 *  per-destination sentences when it gives them, else the destinations it published to */
function crosspostSentence(j: unknown, names: Record<string, string>): string {
  const o = (j && typeof j === "object" ? j : {}) as { message?: unknown; results?: unknown; published?: unknown };
  if (Array.isArray(o.results)) {
    const said = (o.results as Array<{ sentence?: unknown; message?: unknown }>).map((r) => (typeof r?.sentence === "string" ? r.sentence : typeof r?.message === "string" ? r.message : "")).filter(Boolean);
    if (said.length) return said.join(" ");
  }
  if (typeof o.message === "string" && o.message) return o.message;
  const published = Array.isArray(o.published) ? (o.published as Array<{ destinationId?: unknown; deduped?: unknown }>) : [];
  if (!published.length) return "Crosspost sent nowhere.";
  return "Also posted to " + published.map((p) => (names[String(p.destinationId)] ?? String(p.destinationId)) + (p.deduped === true ? " (already there)" : "")).join(", ") + ".";
}

/** BUILD A: the server's answer about where a post goes (app/api/actions/farcasterDelivery.ts FcDelivery, the fields
 *  this component shows) */
type Delivery = LineDelivery;

/** BUILD A: the line under the box after a post: where it went, or why it did not */
interface PostResult {
  kind: "farcaster" | "layers" | "refused" | "unconfirmed";
  message: string;
  url?: string | null;
  hash?: string;
  detail?: string;
}

// The timelines still report their payload's liveSource (components/home/HomeFeed.tsx, SeededTimeline.tsx,
// explore/ExploreFeedIsland.tsx); since BUILD A the public sentence no longer depends on it, and it is kept as the one
// place a later composer surface can ask what the page is reading.
let feedLiveSource: "relay" | "seed" | null = null;

/** called by the timelines with their payload's liveSource.source (null = the payload said nothing) */
export function noteFeedLiveSource(source: "relay" | "seed" | null | undefined): void {
  if (source === "relay" || source === "seed") feedLiveSource = source;
}

/** the last liveSource a timeline reported on this page (null = none yet) */
export function lastFeedLiveSource(): "relay" | "seed" | null {
  return feedLiveSource;
}

/** Slot ids a mode may list in actionButtonSlots.composer. */
export const COMPOSER_SLOTS = [
  "media",
  "gif",
  "grok",
  "poll",
  "emoji",
  "schedule",
  "location",
  "flag",
] as const;

export function ComposerIconRow({
  disabledLocation = true,
  muted = false,
  slots,
}: {
  disabledLocation?: boolean;
  muted?: boolean;
  /** from the active mode; undefined means "the mode did not restrict this" */
  slots?: string[];
}) {
  const all = [
    { slot: "media", icon: <ImageIcon size={20} />, label: "Media" },
    { slot: "gif", icon: <GifIcon size={20} />, label: "GIF" },
    { slot: "grok", icon: <GrokIcon size={20} />, label: "Grok" },
    { slot: "poll", icon: <PollIcon size={20} />, label: "Poll" },
    { slot: "emoji", icon: <EmojiIcon size={20} />, label: "Emoji" },
    { slot: "schedule", icon: <ScheduleIcon size={20} />, label: "Schedule" },
    { slot: "location", icon: <LocationIcon size={20} />, label: "Location", disabled: disabledLocation },
    { slot: "flag", icon: <FlagIcon size={20} />, label: "Flag" },
  ];
  // A mode that names slots gets exactly those, in the mode's order. This is
  // the field being enforced: before, actionButtonSlots was stored, displayed
  // in the builder, and read by nothing.
  const icons =
    slots && slots.length
      ? slots.map((s) => all.find((i) => i.slot === s)).filter(Boolean as unknown as (v: typeof all[number] | undefined) => v is typeof all[number])
      : all;
  return (
    <div className="-ml-2 flex items-center gap-1.5">
      {icons.map((it) => (
        <button
          key={it.label}
          data-testid="composer-action"
          data-slot={it.slot}
          aria-label={it.label}
          onClick={(e) => e.stopPropagation()}
          className={`flex h-[34px] w-[34px] items-center justify-center rounded-full ${
            muted ? "text-[#829aab]" : "text-x-blue"
          } ${it.disabled ? "opacity-50" : "hover:bg-[#1d9bf01a]"}`}
        >
          {it.icon}
        </button>
      ))}
    </div>
  );
}

export function Composer({
  placeholder = "What’s happening?",
  buttonLabel = "Post",
  onPosted,
  autoFocus = false,
  compact = false,
  collapsedUntilFocus = false,
  personaKind = "public",
  audience,
  slots,
  replyToHash,
  disabled = false,
}: {
  placeholder?: string;
  buttonLabel?: string;
  onPosted?: () => void;
  autoFocus?: boolean;
  compact?: boolean;
  collapsedUntilFocus?: boolean;
  /** resolved on the SERVER from the acting persona, never guessed here */
  personaKind?: "public" | "private" | "unknown";
  audience?: { handle: string; name: string }[];
  slots?: string[];
  /** when replying, the cast being replied to — carried so the relationship
   * log can record which thread the reply happened in */
  replyToHash?: string;
  /** PROD-LIVE (D-CU-0-4): on a public deployment the acting persona's kind/audience/slots come from the browser
   * device (GET /api/home), not a server prop. Until they have (or when that read failed) the composer renders
   * DISABLED — never with guessed props: a composer that assumed "public" for a private persona would post in
   * the open. Absent/false everywhere on the rig, so its DOM is unchanged there. */
  disabled?: boolean;
}) {
  const { activePersona, actingPersonaId, actingAsYou, toast, deviceIsThePage, emptyWorld, personas, publicLive, rosterStatus } = useApp();
  const router = useRouter();
  // POST AS YOU: the visitor's own account (the public self) and whether Totem may post as it — asked of the device only
  // on the public live site, for a top-level post (never a reply: a reply's parent account is not known here)
  const rootSelf = personas.find((p) => p.publicSelf === true) ?? null;
  const rootPost = useRootPost(publicLive && deviceIsThePage && rosterStatus === "ready" && !!rootSelf && !replyToHash);
  // declared before the effects that list it as a dependency (a `const` is in its dead zone until its line runs)
  const isPrivate = personaKind === "private";
  // PROD-LIVE (D-CU-0-4): the fallback avatar is the rig fixture SELF's (pravatar img=12). On a public deployment
  // the roster is the visitor's device's and arrives after mount, so until it has, the avatar is a blank disc —
  // never the fixture's face beside a composer that posts as the visitor. On the rig, unchanged.
  // LAYERS_WORLD=empty (review WORLD-LEAK-1): the owner service has no fixture self to show either.
  // PUBLIC GO-LIVE (verify): through the held-media rule (components/CastCard.tsx chromeAvatarSrc): a public self's own
  // picture host never learns the visitor's address from the composer
  const avatarSrc = chromeAvatarSrc(activePersona) ?? (deviceIsThePage || emptyWorld ? null : "https://i.pravatar.cc/160?img=12");
  const [text, setText] = useState("");
  const [markRefutation, setMarkRefutation] = useState(false);
  const [destinations, setDestinations] = useState<
    { id: string; displayName: string; cost: { amount: number; currency: string }; degradation: { truncated: boolean; mediaDropped: boolean; linksDropped: boolean }; rateCardVerified?: string }[]
  >([]);
  const [crosspostTo, setCrosspostTo] = useState<string[]>([]);
  // spend confirmation: any selected destination above the confirm threshold
  // requires an explicit tick — the server refuses (402) without it
  const [confirmSpend, setConfirmSpend] = useState(false);
  const needsSpendConfirm = destinations.some(
    (d) => crosspostTo.includes(d.id) && d.id === "x" && d.cost.amount > 0.1
  );

  // Bound destinations + live cost/degradation for the current draft. The
  // estimate must be on screen BEFORE send — a 13x link surcharge is
  // information for the moment before the button, not the receipt after.
  //
  // Sequence-guarded: mock latency is 200-1500ms per call, so an earlier
  // draft's estimate can land AFTER the current one and silently show a
  // stale price. Out-of-order responses are dropped, and while an estimate
  // is in flight the panel says "estimating" rather than showing the old
  // number — a wrong price on the money surface is worse than no price.
  const estimateSeq = useRef(0);
  const [estimating, setEstimating] = useState(false);
  useEffect(() => {
    if (disabled || replyToHash || personaKind !== "public") return;
    setEstimating(true);
    const t = window.setTimeout(() => {
      const seq = ++estimateSeq.current;
      fetch("/api/crosspost?text=" + encodeURIComponent(text), { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (seq !== estimateSeq.current) return; // a newer draft superseded this
          setDestinations(j.destinations ?? []);
          setEstimating(false);
        })
        .catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, [text, replyToHash, personaKind, disabled]);
  const [posting, setPosting] = useState(false);
  const [focused, setFocused] = useState(false);
  // BUILD A: where this post goes — asked BEFORE the click (a public, permanent Farcaster post is a decision worth
  // seeing first), and what happened AFTER it. Not on a public preview (its toast says it all) and not for a private
  // persona (its audience line does).
  const [where, setWhere] = useState<Delivery | null>(null);
  const [whereTick, setWhereTick] = useState(0);
  const [result, setResult] = useState<PostResult | null>(null);
  useEffect(() => {
    if (deviceIsThePage || disabled || personaKind === "private") {
      setWhere(null);
      return;
    }
    let alive = true;
    fetch("/api/actions/delivery" + (replyToHash ? "?replyTo=" + encodeURIComponent(replyToHash) : ""), { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { delivery?: Delivery; error?: unknown } | null;
        if (!alive) return;
        if (r.ok && j?.delivery && typeof j.delivery.message === "string") setWhere(j.delivery);
        // never a guess: an unanswered question says so, and the post itself is checked again by the server
        else setWhere({ to: "unknown", message: j && typeof j.error === "string" && j.error ? j.error : "Couldn't check where this posts." });
      })
      .catch(() => {
        if (alive) setWhere({ to: "unknown", message: "Couldn't check where this posts." });
      });
    return () => {
      alive = false;
    };
  }, [deviceIsThePage, disabled, personaKind, replyToHash, activePersona?.id, whereTick]);
  // PUB-1: another tab (or the laptop's acquire-fid command) may have changed the answer while this one sat open — ask
  // again when the owner comes back to this window, before the next click. Not on a public preview (no line there).
  useEffect(() => {
    if (deviceIsThePage || disabled || personaKind === "private") return;
    const again = () => setWhereTick((t) => t + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") again();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [deviceIsThePage, disabled, personaKind]);
  // MULTI-FID Gate 4: post anonymously through the anonymous account — proof-gated, attributed to no one.
  // The privacy label is COMPUTED on the server (lib/zk/privacy.ts): DEMO until every condition holds.
  //
  // ANON REVIEW (R1-10, R3-13, A2-2, R3-14): the same GET /api/anon also answers whether anonymous posting is possible
  // HERE at all (`available` + `unavailableReason`: the browser-device preview has no anonymous channel, a server with
  // the reputation binding off has no proof layer, a live service with no armed account has nowhere to post) and, on
  // the owner service, the one-line honest `framing` that stands in for the red developer label. It is asked ONCE per
  // composer mount — before the toggle is ticked, not after — so a toggle that cannot work is never offered (the GET
  // is not cheap: it re-hashes the proving artifacts and calls the validator, so it is not repeated per tick).
  // After a 202 the cast hash mounts AnonPostStatus, which says in clock times where the post is; the toast alone used
  // to promise a post that a refused proof then dropped without a word.
  const [anon, setAnon] = useState(false);
  const [anonLabel, setAnonLabel] = useState<{
    private: boolean;
    label: string;
    failing: string[];
    conditions: { ok: boolean; detail: string }[];
    available: boolean | null;
    unavailableReason: string | null;
    framing: string | null;
    /** PERSONA LAUNCH P3: the persona a post would be made as, its post mode, and the cadence numbers */
    postAs: PostAs | null;
    slotsPerWindow: number;
    windowHours: number;
    /** UX-3: anonymous posting does not exist on this deployment at all (the preview, no proof layer) — the reason is
     *  already a plain sentence and the technical one is `unavailableDetail` */
    deploymentOff: boolean;
    unavailableDetail: string | null;
    /** UX-2: the anonymous account's lifetime cap on the live universe (null: none) */
    lifetimeCap: number | null;
    /** PERSONA LAUNCH P5: the reach tiers offered for this post (null: the server said nothing about reach) */
    reach: ReachAnswer | null;
    /** PERSONA LAUNCH P7 (the prover's line, landed by xout): an anonymous post here stays inside a labelled test preview */
    previewOnly: boolean;
    previewSentence: string | null;
    /** PERSONA LAUNCH P7 (UXH-2): why it is off, in a word ("checking": read again shortly; "crowd": nothing this visitor can do here) */
    unavailableCode: string | null;
    host: "tab" | "server" | null;
    /** PUBLIC GO-LIVE: where a persona's post goes, the route's own words (null: the route said nothing) */
    dest: AnonDestinationAnswer | null;
    /** PUBLIC GO-LIVE (F2): the site handed this tab the LIVE universe and the route's words ask for a Farcaster sign-in to
     *  join its crowd (lib/onboarding/state.ts crowdSignInAsked) — the sentence then carries the way to do it */
    joinAsk: boolean;
  } | null>(null);
  const [anonCastHash, setAnonCastHash] = useState<string | null>(null);
  // PERSONA LAUNCH P8: "Also post to @totem on X" — DEFAULT OFF and never defaulted on (components/XOutboxToggle.tsx);
  // the line under the composer follows the copy, or says why it was not sent
  const [xCopy, setXCopy] = useState(false);
  const [xLine, setXLine] = useState<{ xHash: string | null; refusal: string | null } | null>(null);
  // PERSONA LAUNCH P3: asked again when the acting persona changes or its post mode is changed here
  const [anonTick, setAnonTick] = useState(0);
  useEffect(() => {
    // the anon panel is not rendered for a private persona, a reply or a disabled composer — nothing to ask then
    if (isPrivate || replyToHash || disabled) return;
    let alive = true;
    fetch("/api/anon", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const v = j?.privacy;
        const conditions: { ok: boolean; detail: string }[] = Array.isArray(v?.conditions)
          ? v.conditions.map((c: { ok?: unknown; detail?: unknown }) => ({ ok: c?.ok === true, detail: String(c?.detail ?? "") }))
          : [];
        const availability = {
          available: typeof j?.available === "boolean" ? j.available : null,
          unavailableReason: typeof j?.unavailableReason === "string" ? j.unavailableReason : null,
          framing: typeof j?.framing === "string" ? j.framing : null,
          postAs: readPostAs(j?.postAs),
          slotsPerWindow: typeof j?.slotsPerWindow === "number" && j.slotsPerWindow > 0 ? j.slotsPerWindow : 4,
          windowHours: typeof j?.windowHours === "number" && j.windowHours > 0 ? j.windowHours : 6,
          deploymentOff: j?.anonDeploymentOff === true,
          unavailableDetail: typeof j?.unavailableDetail === "string" ? j.unavailableDetail : null,
          lifetimeCap: typeof j?.lifetimeCap === "number" && Number.isInteger(j.lifetimeCap) && j.lifetimeCap >= 0 ? j.lifetimeCap : null,
          reach: readReach(j?.reach),
          previewOnly: j?.previewOnly === true, previewSentence: typeof j?.previewSentence === "string" ? j.previewSentence : null,
          unavailableCode: typeof j?.unavailableCode === "string" ? j.unavailableCode : null,
          host: j?.host === "tab" ? ("tab" as const) : j?.host === "server" ? ("server" as const) : null,
          dest: readAnonDestination(j),
          // F2: the device env's live hint (a page-settable global: it chooses words and a link, it grants nothing)
          joinAsk:
            crowdSignInAsked(j) &&
            liveUniverseHinted((window as unknown as { __LAYERS_DEVICE_ENV?: Record<string, string | undefined> }).__LAYERS_DEVICE_ENV ?? {}),
        };
        if (v) setAnonLabel({ private: !!v.private, label: String(v.label ?? ""), failing: conditions.filter((c) => !c.ok).map((c) => c.detail), conditions, ...availability });
        // a 503 (the verdict could not be computed) carries its reason — shown as the verdict, never read as private
        else setAnonLabel({ private: false, label: "DEMO — not yet private: " + (typeof j?.error === "string" && j.error ? j.error : "the privacy verdict could not be read"), failing: [], conditions: [], ...availability });
      })
      .catch(() => {
        // the public preview's device always answers (it never needs the validator for "not on here"); a page that could
        // not even ask is the preview's own failure too: deployment-wide, said plainly, no "by default" note
        // PUBLIC GO-LIVE: on the live site this is a read that failed, said as one (the preview keeps its words, byte for byte)
        if (alive) setAnonLabel({ private: false, label: "DEMO — not yet private: the privacy verdict could not be read", failing: [], conditions: [], available: false, unavailableReason: deviceIsThePage ? (publicLive ? "Anonymous posting couldn't be checked on this site just now." : "Anonymous posting isn't on this preview yet.") : "the anonymous posting status could not be read", framing: null, postAs: null, slotsPerWindow: 4, windowHours: 6, deploymentOff: deviceIsThePage, unavailableDetail: null, lifetimeCap: null, reach: null, previewOnly: false, previewSentence: null, unavailableCode: null, host: null, dest: null, joinAsk: false });
      });
    return () => {
      alive = false;
    };
  }, [isPrivate, replyToHash, disabled, activePersona?.id, anonTick, deviceIsThePage, publicLive]);
  // PERSONA LAUNCH P7 (UXH-2): while the answer is "checking", ask the memory-only ?availability=1 (no fetch, no tick on the
  // device) every few seconds and read the full answer again once it changes
  useEffect(() => {
    if (anonLabel?.unavailableCode !== "checking") return;
    let alive = true;
    let n = 0;
    const timer = setInterval(() => {
      if (++n > 60) return clearInterval(timer);
      fetch("/api/anon?availability=1", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (alive && j && j.unavailableCode !== "checking") {
            clearInterval(timer);
            setAnonTick((t) => t + 1);
          }
        })
        .catch(() => {});
    }, 4_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [anonLabel?.unavailableCode]);
  // a toggle ticked before the answer arrived is unticked by an answer of "not available here" — for the server, or for
  // this persona (private, Totem only, the read-only public self)
  useEffect(() => {
    if ((anonLabel?.available === false || anonLabel?.postAs?.available === false) && anon) setAnon(false);
  }, [anonLabel?.available, anonLabel?.postAs?.available, anon]);
  // PERSONA LAUNCH P8: the X box belongs to the anonymous post — unticking "Post anonymously" unticks it too, so a box
  // ticked once never rides along unseen with a later anonymous post
  useEffect(() => {
    if (!anon && xCopy) setXCopy(false);
  }, [anon, xCopy]);
  // PERSONA LAUNCH wave 3 (UXH-5) — THE COPY'S WORDS ARE CHECKED BEFORE THE ANONYMOUS POST IS SENT. The X copy is sent only
  // after its anonymous post's 202 (which clears the box), so a copy the outbox's rules refuse (over 280 weighted
  // characters, a mention, two links, a full article) used to be refused AFTER the post went — and could not be fixed:
  // the words were gone, and the status line rightly tells the owner not to repost the same words. Now, while the box is
  // ticked, the same rules (lib/x/outbox/policy.ts validateXText, the validator's twin) run here on every edit; the
  // reason shows under the box and Post is held until the words fit or the box is unticked. `xCheckedFor` is the text the
  // answer is FOR: until it matches the box (the policy module loads on first use), Post is held too — and submit()
  // checks again itself before anything is sent.
  const [xProblem, setXProblem] = useState<string | null>(null);
  const [xCheckedFor, setXCheckedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!anon || !xCopy) {
      setXProblem(null);
      setXCheckedFor(null);
      return;
    }
    let alive = true;
    const words = text;
    import("@/lib/x/outbox/policy")
      .then(({ validateXText }) => {
        if (!alive) return;
        setXProblem(words.trim() ? validateXText(words) : null);
        setXCheckedFor(words);
      })
      .catch(() => {
        if (!alive) return;
        setXProblem("Couldn't check the copy's words for X here.");
        setXCheckedFor(words);
      });
    return () => {
      alive = false;
    };
  }, [anon, xCopy, text]);
  const xHold = anon && xCopy && (xCheckedFor !== text || xProblem !== null);
  // PERSONA LAUNCH P3 (D2): the toggle DEFAULTS ON for a persona whose post mode is "anon" (the default for a persona
  // without its own account) — only once the server said anonymous posting works HERE and for THIS persona, never for a
  // reply or a private persona, and never over the owner's own click (a touched toggle keeps the owner's choice until
  // the persona or its mode changes). Off everywhere the proof layer is not on (the functional suites, the public preview).
  const anonTouched = useRef<string | null>(null);
  const anonDefaultKey = `${anonLabel?.postAs?.personaId ?? ""}|${anonLabel?.postAs?.mode ?? ""}`;
  useEffect(() => {
    if (!anonLabel) return;
    // touched before the first answer arrived: that click is the owner's choice for this persona too
    if (anonTouched.current === "|") anonTouched.current = anonDefaultKey;
    if (anonTouched.current === anonDefaultKey) return;
    const want = anonLabel.available === true && anonLabel.postAs?.available === true && anonLabel.postAs.mode === "anon" && !replyToHash && !isPrivate && !disabled;
    setAnon(want);
  }, [anonLabel, anonDefaultKey, replyToHash, isPrivate, disabled]);
  // PERSONA LAUNCH P5: THE REACH TIER this anonymous post is boosted as — the server's default (the highest tier offered)
  // until the owner picks; a pick that is no longer offered (the tier fell under the floor at the next read) falls back to
  // the default, never to a tier the server stopped offering
  const [reachTree, setReachTree] = useState<string | null>(null);
  const reachTouched = useRef(false);
  useEffect(() => {
    const r = anonLabel?.reach ?? null;
    if (!r) {
      setReachTree(null);
      return;
    }
    setReachTree((cur) => {
      const stillOffered = cur !== null && (cur === r.plainTree || r.offered.some((o) => o.tree === cur));
      if (reachTouched.current && stillOffered) return cur;
      reachTouched.current = false;
      return r.defaultTree;
    });
  }, [anonLabel?.reach]);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // PUBLIC GO-LIVE: autoFocus that arrives AFTER mount (the home island swaps a disabled composer for the ready one in
  // place, so the textarea's own autoFocus attribute never fires) still focuses it — the guided first run's hand-off
  useEffect(() => {
    if (autoFocus && !disabled) areaRef.current?.focus();
  }, [autoFocus, disabled]);

  /** BUILD A: the sentence for a post that went through — the server's own words, never a generic "sent" */
  const postedSentence = (d: Delivery | undefined): PostResult => {
    // a public preview never posts to Farcaster, whatever its timeline reads
    if (deviceIsThePage) return { kind: "layers", message: PREVIEW_SENTENCE };
    if (isPrivate) return { kind: "layers", message: `Saved in Totem only — only ${seenBy} ${seenBy === 1 ? "person" : "people"} can see it` };
    if (d?.to === "farcaster" && d.message) return { kind: "farcaster", message: d.message, url: d.url ?? null, hash: d.hash, detail: d.warning };
    return { kind: "layers", message: d?.message || "Saved in Totem only", detail: d?.pointer };
  };

  /** PERSONA LAUNCH P8: the copy to @totem on X, sent only AFTER its anonymous post was accepted (202). A refusal here
   *  keeps that post and says why; nothing about the copy is sent before the anonymous post is in. */
  const sendXCopy = async (words: string, castHash: string | null, asPersona: string | null | undefined) => {
    try {
      const xr = await fetch("/api/x/outbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: words, ...(asPersona ? { personaId: asPersona } : {}), ...(castHash ? { copyOf: castHash } : {}) }) });
      const xj = (await xr.json().catch(() => null)) as { xHash?: unknown; error?: unknown } | null;
      if (xr.ok && typeof xj?.xHash === "string") setXLine({ xHash: xj.xHash, refusal: null });
      else setXLine({ xHash: null, refusal: typeof xj?.error === "string" && xj.error ? xj.error : "the outbox did not answer." });
    } catch {
      setXLine({ xHash: null, refusal: "the outbox could not be reached." });
    }
  };

  const submit = async () => {
    if (disabled || !text.trim() || posting) return;
    // PUB-2: Farcaster takes 320 bytes; the button is held back over it, and so is this (the server refuses it too)
    if (personaKind !== "private" && !anon && where?.to === "farcaster" && castBytes(text) > FC_CAST_MAX_BYTES) return;
    setPosting(true);
    setResult(null);
    try {
      if (anon && !isPrivate && !replyToHash) {
        // PERSONA LAUNCH wave 3 (UXH-5): with the X box ticked, the copy's words must pass the outbox's rules BEFORE the
        // anonymous post goes — checked here again (not only by the held button), and nothing is sent when they fail:
        // the reason is under the box, the words stay, and unticking the box posts without the copy
        if (xCopy) {
          let problem: string | null;
          try {
            problem = (await import("@/lib/x/outbox/policy")).validateXText(text);
          } catch {
            problem = "Couldn't check the copy's words for X here.";
          }
          if (problem) {
            setXProblem(problem);
            setXCheckedFor(text);
            toast("Not sent: the copy to @totem on X can't go as written. Fix the words or untick the box.");
            return;
          }
        }
        // MULTI-FID Gate 4: nothing is posted now — the proof is made at idle and sent at a random time
        // PERSONA LAUNCH P3: AS the persona the line named (the server checks it is yours; the post itself names no one)
        const asPersona = anonLabel?.postAs?.personaId;
        // PERSONA LAUNCH P5: the reach tier picked (or defaulted) — the server re-judges it before anything is minted
        const body: Record<string, unknown> = asPersona ? { text, personaId: asPersona } : { text };
        if (reachTree) body.tree = reachTree;
        // PERSONA LAUNCH P6 (UX-L1): the post carries what the line said about this persona's launch; the server refuses
        // (409 'launch', nothing minted) when that no longer holds — a launch confirmed in another tab, or finished
        if (anonLabel?.postAs?.launchPending === true) body.launchPending = true;
        const res = await fetch("/api/anon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await res.json().catch(() => null);
        if (res.ok) {
          // PERSONA LAUNCH P3 (PRIV-4): NO save moment here. The passkey save (SaveMoment → savePasskey) makes
          // device-signed writes and custody calls seconds after the compose — exactly the compose-time identified write
          // R1-01 / P-FID-ATTR-SEAL-IS-NOT-A-BEACON removed from the anon path. The plain post below keeps its moment.
          setText("");
          // ANON REVIEW (A2-2 / R3-14): the toast promises nothing about the post itself — the line under the composer
          // follows it (waiting for its proof → queued → accepted → posted, or refused with the reason). The parent's
          // "posted" reaction is NOT fired: it closes the compose modal / refreshes the feed, and there is nothing to
          // show for a post that leaves at a random moment within hours — the line must stay on screen instead.
          setAnonCastHash(typeof j?.castHash === "string" ? j.castHash : null);
          // PUBLIC GO-LIVE: the route's own sentence for a post that went (postedSentence: the 202's, else the GET's)
          toast(
            typeof j?.postedSentence === "string" && j.postedSentence.trim()
              ? j.postedSentence
              : anonLabel?.dest?.postedSentence ?? "Queued anonymously — the line under the composer says where it is."
          );
          // PERSONA LAUNCH P8: the ticked X copy follows, as a copy of THIS post (its own proof, its own moment)
          setXLine(null);
          if (xCopy) await sendXCopy(text, typeof j?.castHash === "string" ? j.castHash : null, asPersona);
        } else {
          toast(j?.error ? String(j.error) : "Something went wrong. Try again.");
          // UX-L1: the line was out of date about a launch — read it again so it says what the post would really do
          // (the words stay in the box; the next Post sends what the fresh line says)
          if (j?.code === "launch") setAnonTick((t) => t + 1);
        }
        return;
      }
      // The server decides this too — this only picks the right door, and
      // the public door refuses a private persona regardless.
      // PUB-1: the public door also gets the line the owner was shown, and refuses if where it goes has changed since
      const res = await fetch(
        isPrivate ? "/api/private/posts" : "/api/actions/cast",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isPrivate ? { text, replyToHash, markRefutation } : { text, replyToHash, markRefutation, expect: expectationFrom(where) }),
        }
      );
      // BUILD A: the answer is read ONCE — it carries the hash and where the post went (or the exact refusal)
      const j = (await res.json().catch(() => null)) as { hash?: unknown; error?: unknown; code?: unknown; hint?: unknown; delivery?: Delivery } | null;
      // PUB-1: where it goes changed — the fresh line replaces the stale one, the text stays, nothing was posted
      if (res.status === 409 && j?.code === "FC_DELIVERY_CHANGED" && j.delivery && typeof j.delivery.message === "string") setWhere(j.delivery);
      if (res.ok) {
        // SIWF (P1, applied by the anon track): a post is a moment worth offering the passkey save
        window.dispatchEvent(new CustomEvent("layers:moment", { detail: { kind: "post" } }));
        setText("");
        // BUILD A: never a generic "sent" — "Posted to Farcaster as @x" when it went there (with its address),
        // "Saved in Totem only — <why>" when it did not, and the preview sentence on a public deployment
        const said = postedSentence(j?.delivery);
        toast(said.message);
        setResult(said);
        // BYX G0 (applied by the anon track): the crosspost is AWAITED and its answer said — no fire-and-forget. It runs
        // after the post's own line is set (the line under the box keeps where the post went; the toast then says what
        // the crosspost did, or why it failed, in the route's own words)
        if (crosspostTo.length && !isPrivate && !replyToHash) {
          const hash = typeof j?.hash === "string" ? j.hash : null;
          if (hash) {
            try {
              const cp = await fetch("/api/crosspost", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ castHash: hash, text, hasMedia: false, destinationIds: crosspostTo, confirmSpend }),
              });
              const cj = (await cp.json().catch(() => null)) as { error?: unknown } | null;
              const names = Object.fromEntries(destinations.map((d) => [d.id, d.displayName]));
              toast(cp.ok ? crosspostSentence(cj, names) : typeof cj?.error === "string" && cj.error ? cj.error : "Crosspost failed.");
            } catch {
              toast("Crosspost failed.");
            }
          }
        }
        setWhereTick((t) => t + 1); // an account, a cap or a target may have changed: ask again before the next post
        onPosted?.();
        router.refresh();
      } else {
        // FC-READ: the server's own refusal, in its own words (a reply to a network cast answers 403
        // NETWORK_READ_ONLY with the sentence; a private persona's public post, a live rig's disabled writes, …) —
        // the generic line only when the answer carried no message. BUILD A: the Farcaster refusals too (a daily cap,
        // the identity rule, another of your accounts, an unconfirmed send with what to do next); the text stays in
        // the box, so trying again is one click
        const msg = j && typeof j.error === "string" && j.error ? j.error : "Something went wrong. Try again.";
        toast(msg);
        // BUILD A review (PUB-2): only an outcome Farcaster did not confirm carries the "doing it again is safe" hint;
        // a refusal Farcaster answered, a cap, a guard or a changed line is shown as what it is
        const kind = refusalKind(j?.code);
        setResult({
          kind,
          message: msg,
          detail: kind === "unconfirmed" && j && typeof j.hint === "string" ? j.hint : undefined,
        });
      }
    } finally {
      setPosting(false);
    }
  };

  const seenBy = audience?.length ?? 0;
  const engaged = focused || text.length > 0;
  const collapsed = collapsedUntilFocus && !engaged;
  // PUB-2: a post the line says goes to Farcaster counts its bytes against Farcaster's limit
  const toFarcaster = !!where && where.to === "farcaster" && !where.refused && !isPrivate && !anon && !deviceIsThePage;
  const bytes = toFarcaster ? castBytes(text) : 0;
  const overLimit = toFarcaster && bytes > FC_CAST_MAX_BYTES;

  // NON-DISMISSABLE by construction: no state guards this, so there is no
  // "got it" affordance and nothing to remember dismissing. If you are
  // posting privately, the screen says so, every time.
  // PERSONA LAUNCH P6 (UX-L1): the persona's launch is under way — this anon post will be revealed with its other ones
  const launchPendingNow = anon && anonLabel?.postAs?.launchPending === true;
  // PUBLIC GO-LIVE: where this anonymous post goes, BEFORE the click — the anon route's sentence word for word, and its
  // cast link when it gave one
  const dest = anonLabel?.dest ?? null;
  const destinationLine = dest ? (
    <span data-testid="composer-destination" data-destination={dest.destination}>
      {" "}
      {dest.destinationSentence}
      {dest.castUrl ? (
        <>
          {" "}
          <a href={dest.castUrl} target="_blank" rel="noopener noreferrer" data-testid="composer-destination-link" className="font-bold text-x-blue hover:underline" onClick={(e) => e.stopPropagation()}>
            view it on Farcaster
          </a>
        </>
      ) : null}
    </span>
  ) : null;
  const audienceLine = (
    <p
      data-testid="composer-audience"
      data-launch={launchPendingNow ? "pending" : undefined}
      className={`text-[13px] leading-4 ${isPrivate ? "text-x-text" : "text-x-sec"}`}
    >
      {isPrivate ? (
        <>
          Only <span className="font-bold">{seenBy}</span>{" "}
          {seenBy === 1 ? "person" : "people"} can see this
          {audience && audience.length > 0 && (
            <>: {audience.map((a) => "@" + a.handle).join(", ")}</>
          )}
          . Not on the public timeline.
        </>
      ) : launchPendingNow && anonLabel?.postAs ? (
        // PERSONA LAUNCH P6 (UX-L1): NOT "attributed to no one" — the launch's batch reveal reads every anon post of the
        // persona when its account appears (lib/launch/tick.ts), this one included; the server's sentence says so, then
        // who sees it as yours before that (the rings line below says the same, so it is not shown twice)
        <>
          Posting as <span className="font-bold">@{anonLabel.postAs.handle ?? activePersona?.handle ?? "your persona"}</span> through @anon.{" "}
          <span data-testid="composer-launch-reveal">{launchRevealLine(anonLabel.postAs, "@" + (anonLabel.postAs.handle ?? activePersona?.handle ?? "this persona"))}</span>{" "}
          {cadenceSentence(anonLabel.slotsPerWindow ?? 4, anonLabel.windowHours ?? 6, anonLabel.lifetimeCap ?? null)}
          {anonLabel?.previewOnly && <span data-testid="composer-anon-preview"> {anonLabel.previewSentence ?? "Preview only: your anonymous post stays inside this test preview. Nothing is posted to Farcaster."}</span>}
        </>
      ) : anon ? (
        // ANON REVIEW (R3-13): plain words — the account, who cannot attribute it, who still can, and the real cadence.
        // PERSONA LAUNCH P3: which persona it is posted AS (only this device knows), and K a window shared across personas
        <>
          Posting as <span className="font-bold">@{anonLabel?.postAs?.handle ?? activePersona?.handle ?? "your persona"}</span> through @anon — attributed to no one by hubs, other clients, this client or the validator; not hidden from Neynar under managed custody.{" "}
          {cadenceSentence(anonLabel?.slotsPerWindow ?? 4, anonLabel?.windowHours ?? 6, anonLabel?.lifetimeCap ?? null)}
          {anonLabel?.previewOnly && anonLabel.dest?.destinationSentence !== anonLabel.previewSentence && <span data-testid="composer-anon-preview"> {anonLabel.previewSentence ?? "Preview only: your anonymous post stays inside this test preview. Nothing is posted to Farcaster."}</span>}
          {destinationLine}
        </>
      ) : (
        <>Everyone can see this.</>
      )}
    </p>
  );
  // MULTI-FID Gate 4: the anon toggle + the computed privacy label (never a hardcoded claim).
  // ANON REVIEW (R1-10 / R3-13): when the server says anonymous posting is impossible here, the toggle is not offered —
  // one plain sentence says why (composer-anon-unavailable). On the owner service the label is the honest framing (grey,
  // not a red DEMO line the owner cannot act on); the computed verdict and the full condition list stay one <details>
  // away. data-state is unchanged: accept-fid4.mjs asserts data-state="demo" with text starting DEMO on the rig, where
  // there is no framing. Nothing here presents a reveal as publicly checkable: it is checkable inside Totem only.
  // PERSONA LAUNCH P3: the persona's post mode, from the server (a persona whose mode is "anon" posts through @anon by
  // default — D2). The picker changes it; the line under it says what that means for THIS post.
  const postAs = anonLabel?.postAs ?? null;
  const postAsWho = "@" + (postAs?.handle ?? activePersona?.handle ?? "this persona");
  // UX-3: where anonymous posting does not exist at all, the picker never offers "through @anon" — a persona in "anon"
  // mode is shown going where its posts really go here (Totem only)
  // PERSONA LAUNCH P7 (UXH-11): a tab outside the crowd (or not checked yet) is offered no @anon routing either
  const anonOff = anonLabel?.deploymentOff === true || (anonLabel?.host === "tab" && (anonLabel?.unavailableCode === "crowd" || anonLabel?.unavailableCode === "checking"));
  const modePicker = postAs && postAs.personaId && postAs.mode && postAs.options.length > 0 && (
    <PostModePicker
      personaId={postAs.personaId}
      handle={postAs.handle}
      mode={postAs.mode}
      options={postAs.options}
      settable={postAs.settable}
      anonOff={anonOff}
      choiceRequired={postAs?.choiceRequired === true}
      launched={postAs?.launched === true}
      onChanged={() => {
        anonTouched.current = null; // a new mode: its default applies again
        setAnonTick((t) => t + 1);
        setWhereTick((t) => t + 1); // where a plain post goes may have changed too (Totem only)
      }}
    />
  );
  const anonControls = !isPrivate && !replyToHash && !disabled && (
    <div data-testid="composer-anon-panel" className="mb-2">
      {anonLabel?.available === false && anonLabel.deploymentOff ? (
        // UX-3: not on this deployment at all — one plain sentence (no "by default" note: nothing posts through @anon
        // here); the technical reason stays one <details> away
        <div data-testid="composer-anon-unavailable" data-scope="deployment" className="text-[13px] leading-4 text-x-sec">
          <p>
            {anonLabel.unavailableReason ?? "Anonymous posting isn't on here yet."}
            {/* PUBLIC GO-LIVE: the route's destination sentence too, when it says something the reason does not */}
            {dest && dest.destinationSentence !== anonLabel.unavailableReason ? destinationLine : null}
          </p>
          {anonLabel.unavailableDetail && (
            <details data-testid="composer-anon-unavailable-detail" className="mt-1 text-[12px]">
              <summary className="cursor-pointer">why</summary>
              <p className="mt-1">{anonLabel.unavailableDetail}</p>
            </details>
          )}
        </div>
      ) : anonLabel?.available === false ? (
        <p data-testid="composer-anon-unavailable" data-scope="now" className="text-[13px] leading-4 text-x-sec">
          {anonLabel.unavailableReason && /[.!?…]$/.test(anonLabel.unavailableReason.trim()) ? anonLabel.unavailableReason : <>Anonymous posting is not available here: {anonLabel.unavailableReason ?? "this server has no anonymous channel"}.</>}
          {/* PUBLIC GO-LIVE (F2): the live crowd asks for a Farcaster sign-in — the way to it, beside the words that ask
              (the guided run's Farcaster step, pinned by its explicit target: its card offers the sign-in, or the sign-in
              again for a visitor who is signed in already) */}
          {anonLabel.joinAsk ? (
            <>
              {" "}
              <Link href={welcomeHref("farcaster")} data-testid="composer-anon-rejoin" className="font-bold text-x-blue hover:underline">
                {personas.some((p) => p.publicSelf === true) ? REJOIN_LABEL : JOIN_LABEL}
              </Link>
            </>
          ) : null}
          {/* PRIV-2: said only when the delivery line AGREES the post stays in Totem (components/deliveryLine.ts) */}
          {anonDefaultNoteShown({ available: anonLabel.available, deploymentOff: anonOff, postAsMode: postAs?.mode, where }) && (
            <span data-testid="composer-anon-default-note">
              {" "}
              {postAsWho} {postAs?.explicit ? "is set to post through @anon" : "posts through @anon by default"}; this post stays in Totem.
            </span>
          )}
        </p>
      ) : postAs && postAs.available === false ? (
        // this persona cannot post anonymously (Totem only, private, the read-only public self): said, not offered
        <p data-testid="composer-anon-persona" className="text-[13px] leading-4 text-x-sec">
          {postAs.reason ?? `${postAsWho} can't post anonymously.`}
        </p>
      ) : (
        <label className="flex cursor-pointer items-center gap-2 text-[13px] leading-4">
          <input
            data-testid="composer-anon"
            type="checkbox"
            checked={anon}
            onChange={(e) => {
              anonTouched.current = anonDefaultKey; // the owner's own choice is never overridden by the default
              setAnon(e.target.checked);
            }}
            className="h-4 w-4 accent-x-blue"
          />
          <span className="font-bold">Post anonymously</span>
          {/* UX-L1: while the persona's launch is under way the post is revealed with the rest — "until" says so */}
          <span className="text-x-sec">
            — from an account with no name on it{postAs?.launchPending === true ? `, until ${postAsWho}'s launch reveals it` : ""}
          </span>
        </label>
      )}
      {/* PUBLIC GO-LIVE (the relay track's line): anonymous posting's terms and takedown policy, beside the toggle */}
      {anonLabel?.available !== false && !(postAs && postAs.available === false) ? <AnonTermsLink className="mt-0.5 block pl-6" /> : null}
      {modePicker}
      {/* PERSONA LAUNCH P5: "Boost as: 10k+ followers · 1k+ followers · no boost" — only the tiers the server offers */}
      {anon && anonLabel?.available !== false && anonLabel?.reach && reachTree !== null && (
        <ReachPicker
          offered={anonLabel.reach.offered}
          value={reachTree}
          plainTree={anonLabel.reach.plainTree}
          reason={anonLabel.reach.reason}
          onChange={(t) => {
            reachTouched.current = true;
            setReachTree(t);
          }}
        />
      )}
      {anon && anonLabel?.available !== false && (
        <>
          <p
            data-testid="composer-anon-label"
            data-state={anonLabel ? (anonLabel.private ? "private" : "demo") : "pending"}
            className={`mt-1 text-[13px] leading-4 ${anonLabel?.framing ? "text-x-sec" : anonLabel?.private ? "text-[#00ba7c]" : "text-[#f4212e]"}`}
          >
            {anonLabel ? (anonLabel.framing ?? anonLabel.label) : "Checking the privacy conditions…"}
          </p>
          {anonLabel && anonLabel.conditions.length > 0 && (
            <details data-testid="composer-anon-conditions" className="mt-1 text-[12px] leading-4 text-x-sec">
              <summary className="cursor-pointer">
                the full condition list ({anonLabel.failing.length} of {anonLabel.conditions.length} not met)
              </summary>
              {anonLabel.framing && <p className={`mt-1 ${anonLabel.private ? "text-[#00ba7c]" : "text-[#f4212e]"}`}>{anonLabel.label}</p>}
              <ul className="mt-1 list-disc pl-4">
                {anonLabel.conditions.map((c, i) => (
                  <li key={i} className={c.ok ? "" : "text-[#f4212e]"}>
                    {c.ok ? "met — " : "not met — "}
                    {c.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {/* PERSONA LAUNCH P8: "Also post to @totem on X" — only while "Post anonymously" is ticked and works here, never on
          the public browser device or a labelled preview (D-X-PUBLIC-OFF); default off; it asks the server if it is offered */}
      <XOutboxToggle show={anon && anonLabel?.available !== false && !deviceIsThePage && anonLabel?.previewOnly !== true} checked={xCopy} onChange={setXCopy} problem={xCopy && text.trim() ? xProblem : null} />
    </div>
  );

  // PUBLIC GO-LIVE: in live mode, no persona of your own yet (the read-only public self is not one) — no composer, one
  // way forward: the guided first run's persona step. The rig and the preview never take this branch.
  const ownPersonas = personas.filter((p) => p.publicSelf !== true);
  const publicSelfPersona = personas.find((p) => p.publicSelf === true) ?? null;
  // POST AS YOU: once Totem may post as the visitor's own account, the composer IS that account's whenever they act as
  // themselves: with no persona of their own, or after choosing "You" in the account menu (ACTING AS YOURSELF,
  // lib/device/actingRoot.ts)
  const rootActive = !!publicSelfPersona && rootPost.status?.state === "active";
  // PERSONA SEPARATION FOR WRITES (SECURITY-POSTURE.md §35): never while a persona is the acting identity — the device
  // refuses any root write then (acting_persona), so the root's box is not offered beside a persona's
  const actingAsPersona = !!actingPersonaId && personas.some((p) => p.id === actingPersonaId && p.publicSelf !== true);
  const asYourself = ownPersonas.length === 0 || (actingAsYou && !actingAsPersona);
  if (publicLive && deviceIsThePage && rosterStatus === "ready" && rootActive && publicSelfPersona && rootPost.status && !replyToHash && asYourself) {
    return (
      <RootComposer
        handle={publicSelfPersona.handle}
        avatar={chromeAvatarSrc(publicSelfPersona)}
        status={rootPost.status}
        onChange={rootPost.set}
        autoFocus={autoFocus}
        note={ownPersonas.length ? ACTING_AS_YOU_LINE : undefined}
      />
    );
  }
  if (publicLive && deviceIsThePage && rosterStatus === "ready" && asYourself && !replyToHash) {
    const root = publicSelfPersona;
    const rootPic = root ? chromeAvatarSrc(root) : null;
    return (
      <div data-testid="composer-no-persona" data-root={root ? root.handle : ""} className="border-b border-x-border px-4 py-4">
        {root ? (
          <div className="flex items-center gap-3">
            {rootPic ? <img src={rootPic} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" /> : <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-full bg-x-pill" />}
            <p data-testid="composer-posting-as" className="text-[17px] font-bold leading-6">
              Posting as @{root.handle}
            </p>
          </div>
        ) : (
          <p className="text-[17px] font-bold leading-6">Sign in with Farcaster to post</p>
        )}
        <p className="mt-1 text-[14px] leading-5 text-x-sec">
          {root ? <span data-testid="composer-public-self">{publicSelfPostLine(root.handle)}</span> : <>Your Farcaster account is you in Totem.</>}{" "}
          {ownPersonas.length ? <span data-testid="composer-acting-as-you">{ACTING_AS_YOU_LINE}</span> : PERSONA_WORKS_TODAY}
        </p>
        {/* POST AS YOU: the real offer (the device's answer: available, pending with its approval, or why not here) */}
        {root ? (
          <div data-testid="composer-allow" className="mt-3">
            {rootPost.status ? (
              <RootPostConnect status={rootPost.status} onChange={rootPost.set} />
            ) : rootPost.error ? (
              <p data-testid="composer-allow-error" role="alert" className="text-[13px] text-[#f4212e]">
                {rootPost.error}{" "}
                <button type="button" onClick={rootPost.reload} className="font-bold underline">
                  Try again
                </button>
              </p>
            ) : (
              <p className="text-[13px] text-x-sec">Checking whether Totem can post as you…</p>
            )}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {root ? null : (
            /* PUBLIC GO-LIVE (F8): past the welcome screen, at the first step not met yet (lib/onboarding/state.ts welcomeHref) */
            <Link href={welcomeHref("next")} data-testid="composer-sign-in" className="inline-flex h-9 items-center rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover">
              Sign in with Farcaster
            </Link>
          )}
          {/* the persona form lives on the home feed's "Pick up where you left off" card (components/home/PickUp.tsx) */}
          <Link
            href={MAKE_PERSONA_HREF}
            onClick={() => window.dispatchEvent(new Event(MAKE_PERSONA_EVENT))}
            data-testid="composer-make-persona"
            className={
              root
                ? "inline-flex h-9 items-center rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover"
                : "inline-flex h-9 items-center rounded-full border border-x-border-dark px-4 text-[15px] font-bold hover:bg-x-hover"
            }
          >
            Make a persona
          </Link>
        </div>
      </div>
    );
  }
  // PUBLIC GO-LIVE / POST AS YOU: signed in with Farcaster beside a persona's composer. PERSONA SEPARATION FOR WRITES: this
  // box never switches to the visitor's own account while a persona acts (the device would refuse it: acting_persona);
  // the line says how to act as yourself instead ("You" in the account menu), or where to allow posting as you
  const publicSelfLine =
    publicLive && deviceIsThePage && publicSelfPersona && !replyToHash ? (
      <p data-testid="composer-public-self" className="mt-1.5 px-1 text-[12px] leading-4 text-x-sec">
        {rootActive ? (
          <span data-testid="composer-root-off-while-persona">{ROOT_OFF_WHILE_PERSONA}</span>
        ) : (
          <>
            {publicSelfPostLine(publicSelfPersona.handle)}{" "}
            <Link href="/settings/account#post-as-you" data-testid="composer-allow-settings" className="font-bold text-x-blue hover:underline">
              Allow it in Settings
            </Link>
          </>
        )}
      </p>
    ) : null;

  if (collapsed) {
    return (
      <div
        data-testid="composer"
        data-persona-kind={personaKind}
        data-disabled={disabled ? "true" : undefined}
        className={`border-b px-4 py-3 ${
          isPrivate ? "border-x-border bg-[#1d9bf00a] ring-1 ring-inset ring-x-blue/25" : "border-x-border"
        }`}
      >
      <div className="flex items-center">
        {avatarSrc ? (
          <img src={avatarSrc} alt="" className="mr-2 h-10 w-10 shrink-0 rounded-full object-cover" />
        ) : (
          <span aria-hidden="true" className="mr-2 h-10 w-10 shrink-0 rounded-full bg-x-pill" />
        )}
        <input
          data-testid="composer-input"
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-xl leading-6 outline-none placeholder:text-x-sec"
          readOnly
        />
        <button
          disabled
          className="ml-3 h-9 rounded-full bg-[#c2c6c9] px-4 text-[15px] font-bold text-white"
        >
          {isPrivate ? `Post to ${seenBy}` : buttonLabel}
        </button>
      </div>
      <div className="mt-2 pl-12">{audienceLine}</div>
      </div>
    );
  }

  return (
    <div
      data-testid="composer"
      data-persona-kind={personaKind}
      data-disabled={disabled ? "true" : undefined}
      aria-busy={disabled ? true : undefined}
      className={`border-b px-4 pt-3 pb-2 ${
        isPrivate ? "border-x-border bg-[#1d9bf00a] ring-1 ring-inset ring-x-blue/25" : "border-x-border"
      }`}
    >
    <div className="flex">
      {avatarSrc ? (
        <img src={avatarSrc} alt="" className="mr-2 h-10 w-10 shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden="true" className="mr-2 h-10 w-10 shrink-0 rounded-full bg-x-pill" />
      )}
      <div className="min-w-0 flex-1 pt-1">
        <textarea
          ref={areaRef}
          data-testid="composer-input"
          value={text}
          disabled={disabled || undefined}
          autoFocus={autoFocus || (collapsedUntilFocus && focused)}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setText(e.target.value);
            if (result) setResult(null); // a new draft: the last post's line has said its piece
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          placeholder={placeholder}
          rows={1}
          className="w-full resize-none bg-transparent text-xl leading-6 outline-none placeholder:text-x-sec"
        />
        {replyToHash && (focused || text) && (
          <label className="mb-2 mt-1 flex w-fit cursor-pointer items-center rounded-full border border-x-border px-3 py-1 text-[13px] font-bold text-x-sec hover:bg-x-hover">
            <input
              type="checkbox"
              data-testid="mark-refutation"
              checked={markRefutation}
              onChange={(e) => setMarkRefutation(e.target.checked)}
              className="mr-2 h-4 w-4 accent-x-blue"
            />
            Mark as refutation
          </label>
        )}
        {anonControls}
        {/* Rendered unconditionally when private: who can see a post is not
            a detail that earns its place only once you have started typing. */}
        {(isPrivate || ((focused || text) && !compact)) && (
          <div className="mb-2 mt-1 flex items-center px-1 py-0.5">
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.7} className={`mr-1.5 shrink-0 ${isPrivate ? "text-x-text" : "text-x-blue"}`}>
              {isPrivate ? (
                <>
                  <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
                  <path d="M8 10.5V7.6a4 4 0 018 0v2.9" />
                </>
              ) : (
                <>
                  <circle cx="12" cy="12" r="8.6" />
                  <path d="M3.4 12h17.2M12 3.4c-2.5 2.3-3.9 5.2-3.9 8.6s1.4 6.3 3.9 8.6c2.5-2.3 3.9-5.2 3.9-8.6s-1.4-6.3-3.9-8.6z" />
                </>
              )}
            </svg>
            {audienceLine}
          </div>
        )}
        {/* PERSONA LAUNCH P4 (rings' line): under "Posting as @x through @anon" — which rings will see this post is yours */}
        {/* UX-L1: while the persona's launch is under way its "Everyone else sees @anon." no longer holds — the audience
            line above says who sees what (rings included); only an unread rings document is still said here */}
        {anon && !isPrivate && !replyToHash && (focused || text) && !compact && (!launchPendingNow || !!anonLabel?.postAs?.ringsError) && (
          <div className="mb-2 px-1">
            <RingAudienceLine rings={anonLabel?.postAs?.rings ?? []} error={anonLabel?.postAs?.ringsError ?? null} ownerService={anonLabel?.postAs?.ownerService === true} />
          </div>
        )}
        {/* BUILD A: where this post goes, before the click — the server's answer, never a guess */}
        {where && !isPrivate && !anon && !deviceIsThePage && (focused || text) && (
          <p
            data-testid="composer-delivery"
            data-delivery={where.refused ? "refused" : where.to}
            data-mode={where.mode}
            className={`mb-2 px-1 text-[13px] leading-4 ${
              where.refused || where.to === "unknown" ? "text-[#f4212e]" : where.to === "farcaster" ? "font-bold text-x-text" : "text-x-sec"
            }`}
          >
            {where.message}
            {where.pointer && <span className="mt-0.5 block text-[12px] font-normal text-x-sec">{where.pointer}</span>}
          </p>
        )}
        {/* PUB-2: Farcaster's limit is 320 BYTES (an emoji is up to 4) — shown before the click, never learned from a refusal */}
        {toFarcaster && (focused || text) && (
          <p
            data-testid="composer-bytes"
            data-over={overLimit ? "true" : undefined}
            className={`mb-2 px-1 text-[12px] leading-4 ${overLimit ? "font-bold text-[#f4212e]" : "text-x-sec"}`}
          >
            {bytes}/{FC_CAST_MAX_BYTES} bytes{overLimit ? " — too long for Farcaster: shorten it to post" : ""}
          </p>
        )}
        {!replyToHash && personaKind === "public" && destinations.length > 0 && (focused || text) && (
          <div data-testid="crosspost-panel" className="mb-2 rounded-xl border border-x-border p-2.5">
            <p className="text-[13px] font-bold text-x-sec">Also post to</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {destinations.map((d) => (
                <button
                  key={d.id}
                  data-testid={`crosspost-${d.id}`}
                  data-selected={crosspostTo.includes(d.id) ? "true" : "false"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCrosspostTo((prev) =>
                      prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                    );
                  }}
                  className={`h-8 rounded-full px-3 text-[13px] font-bold ${
                    crosspostTo.includes(d.id)
                      ? "bg-x-black-btn text-white"
                      : "border border-[#cfd9de] hover:bg-x-hover"
                  }`}
                >
                  {d.displayName}
                  {d.cost.amount > 0 && ` · ~$${d.cost.amount}`}
                </button>
              ))}
            </div>
            {destinations
              .filter((d) => crosspostTo.includes(d.id))
              .map((d) => (
                <div key={d.id} className="mt-1.5 text-[13px] leading-4 text-x-sec">
                  {estimating ? (
                    <p data-testid={`cost-pending-${d.id}`}>Estimating cost…</p>
                  ) : (
                    d.cost.amount > 0 &&
                    /https?:/.test(text) && (
                      <p data-testid={`cost-note-${d.id}`}>
                        This crosspost contains a link: ~${d.cost.amount} on {d.displayName}.
                        {d.rateCardVerified && (
                          <span data-testid={`rate-verified-${d.id}`} className="ml-1 text-x-sec">
                            (rates verified {d.rateCardVerified})
                          </span>
                        )}
                      </p>
                    )
                  )}
                  {d.degradation.truncated && (
                    <p data-testid={`degrade-truncate-${d.id}`}>
                      {d.displayName} will truncate this post to fit.
                    </p>
                  )}
                  {d.degradation.linksDropped && (
                    <p data-testid={`degrade-links-${d.id}`}>
                      {d.displayName} does not carry links — they will be removed there.
                    </p>
                  )}
                  {d.degradation.mediaDropped && <p>{d.displayName} will drop the media.</p>}
                </div>
              ))}
            {needsSpendConfirm && (
              <label className="mt-2 flex items-center gap-2 text-[13px]" data-testid="confirm-spend">
                <input
                  type="checkbox"
                  checked={confirmSpend}
                  onChange={(e) => setConfirmSpend(e.target.checked)}
                />
                <span>
                  Confirm spending{" "}
                  <span className="font-bold">
                    ~$
                    {destinations
                      .filter((d) => crosspostTo.includes(d.id) && d.id === "x")
                      .reduce((a, d) => a + d.cost.amount, 0)
                      .toFixed(3)}
                  </span>{" "}
                  on X — required above $0.10.
                </span>
              </label>
            )}
          </div>
        )}
        <div className={`flex items-center justify-between ${engaged ? "border-t border-x-border pt-2" : "pt-1"}`}>
          <ComposerIconRow muted={!engaged} slots={slots} />
          <button
            data-testid="composer-submit"
            onClick={submit}
            disabled={anonLabel?.postAs?.choiceRequired === true || disabled || !text.trim() || posting || overLimit || xHold}
            className={`ml-3 h-9 rounded-full px-4 text-[15px] font-bold text-white ${
              text.trim()
                ? "bg-x-blue hover:bg-x-blue-hover disabled:opacity-50"
                : "bg-[#c2c6c9]"
            }`}
          >
            {isPrivate ? `Post to ${seenBy}` : buttonLabel}
          </button>
        </div>
        {/* BUILD A: what the last post did — where it went and its address, or the exact refusal and what to do next */}
        {result && !deviceIsThePage && (
          <p
            data-testid="composer-result"
            data-delivery={result.kind}
            role="status"
            className={`mt-1.5 px-1 text-[13px] leading-4 ${
              result.kind === "farcaster" ? "text-[#00ba7c]" : result.kind === "layers" ? "text-x-sec" : "text-[#f4212e]"
            }`}
          >
            {result.message}
            {result.url ? (
              <>
                {" · "}
                <a
                  data-testid="composer-result-link"
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="font-bold text-x-blue hover:underline"
                >
                  view it on Farcaster
                </a>
              </>
            ) : result.hash ? (
              <>
                {" · "}
                <span data-testid="composer-result-hash" className="font-mono">
                  {result.hash.slice(0, 10)}
                </span>
              </>
            ) : null}
            {result.detail && <span className="mt-0.5 block text-[12px] text-x-sec">{result.detail}</span>}
          </p>
        )}
        {/* ANON REVIEW (A2-2, R3-02, R3-14): where the anonymous post is, in clock times, until the owner dismisses it */}
        {/* PERSONA LAUNCH P7 (UXH-3): this device's anonymous posts that still need the owner, so a reload or reopen never loses the line */}
        {!isPrivate && !replyToHash && !disabled && <AnonRecentStatus exclude={anonCastHash} />}
        {anonCastHash && <AnonPostStatus castHash={anonCastHash} onDismiss={() => setAnonCastHash(null)} />}
        {publicSelfLine}
        {/* PERSONA LAUNCH P8: where the copy to @totem on X is (or why it was not sent) — test data, nothing reaches X */}
        {xLine && <XOutboxStatusLine xHash={xLine.xHash} refusal={xLine.refusal} onDismiss={() => setXLine(null)} />}
      </div>
    </div>
    </div>
  );
}
