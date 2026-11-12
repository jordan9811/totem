import { NextRequest, NextResponse } from "next/server";
import { ANON_PREVIEW_SENTENCE as ANON_PREVIEW_SENTENCE_TEXT } from "@/lib/zk/anon/availability";

export const dynamic = "force-dynamic";

// MULTI-FID PASS Gate 4 — anon-post mode (the anoncast pattern, inside Totem).
//
// POST { text }: queue an ANONYMOUS post. Nothing is posted here and nothing
// leaves here: the text waits in the gate's wanted set, the next prefetch tick
// proves the ROOT's membership in the configured gate tree under a message that
// binds sha256(text) (the signal carries the constant "anon" where a persona id
// would be; the scope omits the persona — one per root per window), and the
// drain sends the envelope over the anonymous channel at a jittered time. The
// validator verifies and relays the text through ITS shared anon account,
// recording no persona, no root and no attribution row. The relayed cast is
// attributed to no one, in every client including ours.
//
// GET: the composer's status line — the COMPUTED privacy verdict (DEMO until
// every Pass-1 condition holds), the relay configuration the validator reports,
// this device's queued anon posts (status only), which of them this device can
// still reveal, whether anon posting is AVAILABLE here at all and why not
// (ANON REVIEW R1-10 / R3-13), and `?castHash=` for one post: its queue item,
// its outcome log entry (wanted / deferred / retrying / queued / dropped, with
// the reason — A2-2 / R3-02), the timing the owner can expect (R3-14) and, for a
// refused submission, the validator's own reason when the reviewed validator
// serves one to the signed reader (A2-5). `?revealable=1` answers only the
// reveal list (one cheap read per anon card — R3-18). `&envelope=1` (dev hooks
// only) hands a rig the envelope as sent, for the leak grep.
//
// POST { action: "reveal", castHash, personaId }: the anoncast pattern — prove
// ownership of a past anon post, at your own choice, and attribute it to one of
// your real accounts. Nothing here is automatic: this device must hold the
// secret it kept at post time, and the chosen persona must be your own and
// own a real fid in this universe. The claim is checkable INSIDE LAYERS ONLY on
// today's managed-signer accounts (§14.2, lib/zk/anonAttribution.ts).
//
// POST { action: "ownFidCheck", fid }: is this fid one of THIS device's persona
// accounts (ALL records, hidden siblings included — R3-11), the app's throwaway,
// or the seed's borrowed fid? Booleans only; the arm script asks it about the
// anon account before arming.

//
// PERSONA LAUNCH P3 — PERSONA-SCOPED ANON POSTING. POST { text, personaId? }: the post is made AS one of this root's
// personas — the acting persona when none is named (under LAYERS_WORLD=empty the session's, which is the acting one or
// the first real persona). It stays anonymous: the persona rides only the sealed reveal record (lib/zk/anonAttribution.ts),
// never the envelope, the signal or the wire. Refused (403/409) when the persona is not this device's own, is the
// read-only public self, is private, or is set to post in Totem only (lib/identity/postMode.ts) — before anything is
// minted or written. D4: up to K posts per PERSON per window, shared across the person's personas; the (K+1)th is 409.
// GET adds `postAs` (the persona a post would be made as, its post mode, whether it may post anonymously), the client's
// own `slotsPerWindow` and `windowHours` (the composer's cadence sentence), `personaId` on each item (device-local), and
// `relaySpreadMs` in the timing.
//
// PERSONA LAUNCH P5 — REACH TIERS. GET adds `reach`: { offered: [{ tree, label, size }], defaultTree, reason } — the
// reach tiers this root may boost an anonymous post with right now (held, honoured by key, accepted by the validator,
// at or above the crowd floor in the last tick's census — lib/reach/trees.ts offeredAnonTrees; a tier under the floor is
// never listed), the default (the highest offered, else the plain anon tree) and, in plain words, why a held tier is
// not offered. Nothing is offered where anonymous posting is off (the public preview proves nothing: P7). POST takes
// `tree` (absent = the plain anon tree, no boost); a tree the picker would not offer is refused before anything is
// minted (400 bad-tree, 409 reach). PERSONA LAUNCH P4: `postAs.rings` — the rings that will see this post is yours.
// PERSONA LAUNCH P6: `postAs.choiceRequired` — a launched persona must choose where its posts go first.
// PERSONA LAUNCH P7 — STRANGERS ON THE PUBLIC SITE. Whether anonymous posting is on HERE is one decision now
// (lib/zk/anon/availability.ts, D-ANON-SWITCH): the deployment's switch, then the host — in the visitor's BROWSER DEVICE
// the test universe is on and PREVIEW ONLY (a Web Worker proves, the web channel sends; the post stays inside the
// preview), the live universe is off, and a root that is not in the plain anon tree's crowd is told so in plain words
// BEFORE anything is minted (POST refuses 409 'crowd'); on a server-side device the old rule (ZK_ANON_POST=on, else the
// zk rep binding) holds. GET answers `previewOnly` and `previewSentence` (the composer shows it beside the cadence line),
// and the 202 says `previewOnly` too. Reach tiers are not offered in the browser (D-PUBLIC-ANON-TREE: strangers prove
// the plain anon tree; the reach issuers are host-only, D-REACH-ISSUER-HOST-ONLY).
// PERSONA LAUNCH P7 review fixes: UXH-2 — a tab that cannot judge yet says "checking" (off, POST 409 'checking', nothing
// minted), runs one check at once (firstCheckIfNone) and answers `unavailableCode` + `host`; `?availability=1` is the
// composer's memory-only poll while it says "checking". UXH-3 — `?recent=1` lists this device's anonymous posts that
// still need the owner (memory only), so the per-post line survives a reload; `expiredWindow` on a post's status.
// UXH-8 — `postAs.ownerService`: rings made on the owner service reach nobody yet, and the ring line must say so.
// PERSONA LAUNCH P6 (UX-L1): `postAs.launchPending` + `postAs.launchNotice` — while the persona's launch is under way
// (confirmed, its batch reveal not landed: lib/launch/confirm.ts launchUnderWay) an anon post is revealed WITH the rest,
// so the composer says that instead of "attributed to no one". POST takes `launchPending` (what the line said); the gate
// refuses 409 'launch' — nothing minted — when it no longer matches (lib/zk/gate.ts requestAnonPost), and the 202 says
// `launchPending: true` with a note that says the post will be revealed.

//
// PUBLIC GO-LIVE (the relay track) — THE CONTRACTS this route (and the validator beside it) gives the composer (onboard),
// the native /anon page and the Mini App (anonpage). Every field below is ADDED; nothing that existed changes meaning.
//
//   GET /api/anon (the composer's full read) adds:
//     destination          "farcaster" | "layers" | "off" — where a post made here goes RIGHT NOW (lib/zk/anon/universe.ts
//                          anonDestinationFor, judged from the same availability the POST is refused by): "farcaster" only
//                          when the site's tabs were handed the live universe AND the validator's relay was armed at the last
//                          check; "layers" for the test universe (the public preview: anyone using Totem on the site can
//                          read it in the anonymous feed; nothing reaches Farcaster); "off" when nothing would be posted
//     destinationSentence  the words to show BEFORE the click (never write your own wording about where a post goes)
//     postedSentence       the words for the toast after a 202 (null when off)
//   GET /api/anon?castHash=<64 hex> (one post's status) adds castUrl: the post's Farcaster link once the validator relayed
//                        it in the live universe (from the anon list this device last read — never a read of its own), else null
//   POST /api/anon { text, postAs: "root" } — a post made AS YOURSELF, with no persona (the /anon page): no persona or
//                        launch check, the reveal secret kept with personaId null; everything else (availability, the text
//                        filter, the slots, the caps) exactly as a persona's post. A personaId beside postAs "root" is 403.
//   POST answers code "filter" (400) when the automatic text filter refuses the words (lib/zk/anon/textCheck.ts
//                        anonFilterRefusal: slurs, phone numbers, email and street addresses, scam links), its sentence in error
//   GET /api/anon?recent=1&casts=1 adds { universe: "fixture" | "live", casts: [{ castHash, text, at, castUrl }] | null,
//                        castsError } — the newest relayed anonymous posts of this site's universe, hidden (removed) ones
//                        excluded by the validator; null + castsError when the list could not be read (never [] on a failure).
//                        Only with casts=1 (the /anon page's feed asks for it): the composer's own ?recent=1 poll stays
//                        MEMORY ONLY (no validator read), as UXH-3 requires — it answers universe and casts: null, castsError: null
//   POST /api/anon/report { castHash, reason } (app/api/anon/report/route.ts, device-answered) → the validator's
//                        POST /zk/anon/report; reasons: lib/zk/anon/moderation.ts REPORT_REASONS
//   GET/POST /api/anon/moderation (app/api/anon/moderation/route.ts) — this device's moderator key, and for a moderator
//                        the reported posts (a SIGNED read) and Remove / Keep (SIGNED decisions)
//   components/zk/AnonReportButton { castHash, universe }; components/zk/AnonTermsLink (no props); the page /terms
//   the validator's GET /zk/anon-cast?mode=&hash= — ONE relayed, non-hidden cast ({ cast: { castHash, hash, text, at, fid,
//                        tree, castUrl } }), 404 when hidden or unknown: the /anon/p/<castHash> share page's server render
//                        reads it with no device and no key
//   GET /api/anon?crowd=1 (PRIV-LIVE-1) — in a tab, live universe only: { commitment, join } — this device's CROWD commitment
//                        (the one a Farcaster join adds; never the root's registered one) and the last join's answer; memory only
//   POST /api/anon { action: "leaveCrowd" } (ASM-5) — in a tab, live universe only: leave the Farcaster-joined anonymous
//                        crowd ({ ok, leftFromEpoch } | { error }); joining again takes a fresh Sign in with Farcaster
//   GET /api/anon?castHash= in a TAB never asks the validator for a refused post's reason (PRIV-LIVE-2): that read is
//                        device-signed and names the post; validatorRefusal is then null and the line stays generic

function isDev(): boolean {
  return process.env.ZK_DEV_HOOKS === "true";
}

// PERSONA LAUNCH P3 (PRIV-1): "replayed" — the words already came back as a replay (lib/zk/gate.ts); 409, nothing minted.
// (UX-2): "relay-cap" — the anonymous account's own cap (lifetime live / daily) is reached; 409, the words stay in the box
// PERSONA LAUNCH P5: "bad-tree" — not a tree an anon post may prove (400); "reach" — a tier this person may not boost with now (409)
// PERSONA LAUNCH P6 (UX-L1): "launch" — the line said something else about this persona's launch than is true now (409)
// PERSONA LAUNCH P7: "crowd" — this browser's root is not in the anonymous crowd (409, nothing minted; scope "now")
// PERSONA LAUNCH P7 (UXH-2): "checking" — no check has said yet whether it is (409, nothing minted, the words stay)
// PUBLIC GO-LIVE: "filter" — the automatic text filter refused the words (400, nothing minted, the words stay in the box)
const STATUS_OF_CODE: Record<string, number> = { unavailable: 503, relay: 503, window: 409, "bad-text": 400, full: 429, persona: 403, "post-mode": 409, replayed: 409, "relay-cap": 409, "bad-tree": 400, reach: 409, launch: 409, crowd: 409, checking: 409, filter: 400 };

/**
 * PERSONA LAUNCH P7 (UXH-2) — A TAB WITH NO CHECK YET RUNS ONE NOW. Availability no longer says yes before a check has
 * read the crowd (lib/zk/anon/availability.ts: unknown is "checking", off), and the browser device's scheduled first
 * tick comes ZK_PREFETCH_MS (10 minutes on the public site) after the loop starts — a stranger would read "checking" for
 * that long. So the composer's read (and a post) in a tab with no snapshot for this universe runs ONE prefetch tick at
 * once and waits for it up to FIRST_CHECK_WAIT_MS. Why this is not a beacon: the tick's fetches are the uniform set every
 * device makes on every tick; it happens at the composer's first read after a page load, the moment that read's own
 * identified config fetch (fetchAnonPostConfig) already tells the validator about; and nothing is wanted yet (a post is
 * refused while checking). A server-side device is untouched (its tick log is the rig's to drive). One tick at a time,
 * at most one every FIRST_CHECK_RETRY_MS after a failed one; the scheduled loop carries on as before.
 */
const FIRST_CHECK_WAIT_MS = 15_000;
const FIRST_CHECK_RETRY_MS = 30_000;
const gFirst = globalThis as unknown as { __layersAnonFirstCheck?: { at: number; done: boolean; p: Promise<unknown> } };
async function firstCheckIfNone(mode: "fixture" | "live"): Promise<void> {
  if (typeof window === "undefined") return;
  const { cachedSnapshot, prefetchTick, ensurePrefetchLoop } = await import("@/lib/zk/prefetch");
  ensurePrefetchLoop();
  if (cachedSnapshot(mode)) return;
  let f = gFirst.__layersAnonFirstCheck;
  if (!f || (f.done && Date.now() - f.at >= FIRST_CHECK_RETRY_MS)) {
    const rec: { at: number; done: boolean; p: Promise<unknown> } = { at: Date.now(), done: false, p: Promise.resolve() };
    rec.p = prefetchTick(mode)
      .catch(() => undefined) // recorded in the tick log; availability then still says "checking"
      .finally(() => {
        rec.done = true;
      });
    gFirst.__layersAnonFirstCheck = f = rec;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([f.p, new Promise((r) => (timer = setTimeout(r, FIRST_CHECK_WAIT_MS)))]);
  if (timer) clearTimeout(timer);
}

/**
 * PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE) — A FRESH VISITOR JOINS THE CROWD. On the public preview strangers prove the
 * plain tree "valid" (every registered root), but a fresh tab's root was never registered, so "you can't join it from here
 * yet" was a dead end. Now the composer's FULL read (and a post), in a TAB, in the TEST universe, for a root that is not a
 * leaf, registers this root's fixture commitment once (lib/zk/registration.ts registerCommitment: signed by the device's
 * own anchor, exactly the path a server device takes) and hands the join state to availability.ts, which says WHEN the
 * root can post (the validator batches a new member to the NEXT epoch: up to 6 hours). Why at the composer's read and not
 * at a post: every visitor whose composer mounts is joined — so a registration says nothing about who wants to post
 * anonymously (a join at post time would be exactly that signal). What the validator learns is what any registration
 * tells it: this root holds this commitment, at hour grain (§27; the root ↔ commitment residual of the ZK pass). Memory
 * only (one record per tab, keyed by universe and commitment); a failed join is retried at most every JOIN_RETRY_MS; the
 * poll (?availability=1) never joins. A server-side device never joins from here (its registration is the owner's step).
 */
const JOIN_WAIT_MS = 15_000;
const JOIN_RETRY_MS = 30_000;
type JoinRecord = { key: string; at: number; done: boolean; p: Promise<void>; state: import("@/lib/zk/anon/availability").AnonJoinState | null };
const gJoin = globalThis as unknown as { __layersAnonJoin?: JoinRecord; __layersAnonRefresh?: { at: number; done: boolean; p: Promise<unknown> } };
const joinKeyOf = (mode: string, commitment: string) => mode + "|" + commitment;
function joinStateFor(mode: string, commitment: string | null) {
  const r = gJoin.__layersAnonJoin;
  return commitment && r && r.key === joinKeyOf(mode, commitment) ? r.state : null;
}
async function joinCrowd(mode: "fixture" | "live", commitment: string): Promise<void> {
  if (typeof window === "undefined" || mode !== "fixture") return;
  const key = joinKeyOf(mode, commitment);
  let r = gJoin.__layersAnonJoin;
  const reuse = r && r.key === key && (!r.done || r.state?.registered === true || Date.now() - r.at < JOIN_RETRY_MS);
  if (!reuse) {
    const rec: JoinRecord = { key, at: Date.now(), done: false, p: Promise.resolve(), state: null };
    rec.p = (async () => {
      try {
        const { registerCommitment } = await import("@/lib/zk/registration");
        const res = await registerCommitment(mode, commitment);
        rec.state =
          res.ok && typeof res.activeFromEpoch === "number"
            ? { registered: true, activeFromEpoch: res.activeFromEpoch, error: null }
            : { registered: false, activeFromEpoch: null, error: (res.error ?? "the validator answered " + res.status).slice(0, 200) };
      } catch (e) {
        rec.state = { registered: false, activeFromEpoch: null, error: String((e as Error)?.message ?? e).slice(0, 200) };
      } finally {
        rec.done = true;
      }
    })();
    gJoin.__layersAnonJoin = r = rec;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([(r as JoinRecord).p, new Promise((res) => (timer = setTimeout(res, JOIN_WAIT_MS)))]);
  if (timer) clearTimeout(timer);
}
/** PERSONA LAUNCH GO-LIVE: a joined root whose first window has started while the last check is from the window before —
 *  one fresh check now (the same uniform tick firstCheckIfNone runs; at most one every FIRST_CHECK_RETRY_MS), so the
 *  composer says "you can post" at the boundary instead of after the scheduled cadence */
async function refreshAfterJoin(mode: "fixture" | "live"): Promise<void> {
  if (typeof window === "undefined") return;
  const { prefetchTick } = await import("@/lib/zk/prefetch");
  let f = gJoin.__layersAnonRefresh;
  if (!f || (f.done && Date.now() - f.at >= FIRST_CHECK_RETRY_MS)) {
    const rec: { at: number; done: boolean; p: Promise<unknown> } = { at: Date.now(), done: false, p: Promise.resolve() };
    rec.p = prefetchTick(mode)
      .catch(() => undefined)
      .finally(() => {
        rec.done = true;
      });
    gJoin.__layersAnonRefresh = f = rec;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([f.p, new Promise((r) => (timer = setTimeout(r, FIRST_CHECK_WAIT_MS)))]);
  if (timer) clearTimeout(timer);
}

/** PERSONA LAUNCH P7: what availability.ts says HERE, with this device's last snapshot and (in the browser) its own
 *  commitment — the membership sentence needs both. The commitment is device-local and never leaves this function.
 *  UXH-2: `firstCheck` (the composer's read and a post, never the memory-only poll) runs one check first in a tab that
 *  has none. PERSONA LAUNCH GO-LIVE: `join` (the same two callers, never the poll) joins a root that is not in the crowd
 *  (joinCrowd) and, once its window has started, runs one fresh check (refreshAfterJoin); every caller — the poll too —
 *  passes the join state this tab already holds, so the sentence says when it can post. */
async function availabilityHere(mode: "fixture" | "live", opts: { firstCheck?: boolean; join?: boolean } = {}) {
  if (opts.firstCheck) await firstCheckIfNone(mode);
  const { anonPostingAvailability } = await import("@/lib/zk/anon/availability");
  const { cachedSnapshot } = await import("@/lib/zk/prefetch");
  let commitment: string | null = null;
  if (typeof window !== "undefined") {
    try {
      // PUBLIC GO-LIVE (PRIV-LIVE-1): the live universe's crowd, on a validator whose fid gate is on, is joined with this
      // device's CROWD identity (lib/zk/anon/fcJoin.ts — never the root's registered commitment), so that is the leaf judged
      commitment =
        mode === "live" && cachedSnapshot(mode)?.anonConfig?.fidGate === true
          ? (await import("@/lib/zk/anon/fcJoin")).anonFidTreeCommitment()
          : (await import("@/lib/zk/identity")).zkCommitment();
    } catch {
      commitment = null; // no identity to judge: availability says "checking" (off), never yes
    }
  }
  const judge = () => anonPostingAvailability({ mode, snap: cachedSnapshot(mode), commitment, join: joinStateFor(mode, commitment) });
  // PUBLIC GO-LIVE (D-PUBLIC-LIVE-TREE): in the LIVE universe a tab joins the crowd with a verified Sign in with Farcaster
  // (lib/zk/anon/fcJoin.ts), never with a plain registration, so the join state it judges from is the Farcaster join's
  // (the fixture judgement above is gpl's line, kept verbatim: scripts/unit-prover.mjs S2 pins it)
  const { fcJoinState } = await import("@/lib/zk/anon/fcJoin");
  // PUBLIC GO-LIVE (onboard F2): a signed-in tab with no join known hears "may already be joined" (the join's outcome is memory only). Unreadable: not said.
  let signedIn = false;
  if (mode === "live" && typeof window !== "undefined") {
    try {
      const link = await (await import("@/lib/fc/siwf/links")).mainLink();
      signedIn = !!link && link.disconnectedAt === null;
    } catch {
      signedIn = false;
    }
  }
  const judgeLive = () => anonPostingAvailability({ mode, snap: cachedSnapshot(mode), commitment, join: fcJoinState(commitment), signedIn });
  let av = mode === "live" ? judgeLive() : judge();
  if (opts.join && typeof window !== "undefined" && commitment && mode === "fixture") {
    if (av.code === "crowd" && joinStateFor(mode, commitment)?.registered !== true) {
      await joinCrowd(mode, commitment);
      av = judge();
    }
    if (av.code === "checking" && joinStateFor(mode, commitment)?.registered === true) {
      await refreshAfterJoin(mode);
      av = judge();
    }
  }
  // PUBLIC GO-LIVE: a Farcaster-joined tab whose first live window has started reads a fresh check at once, like a fixture join
  if (opts.join && typeof window !== "undefined" && commitment && mode === "live" && av.code === "checking" && fcJoinState(commitment)?.registered === true) {
    await refreshAfterJoin(mode);
    av = judgeLive();
  }
  return av;
}

/** PUBLIC GO-LIVE: where a post made here goes, from availability's verdict, the host and the last read of the validator's
 *  config (lib/zk/anon/universe.ts anonDestinationFor) — the same words before the click (GET) and after it (the 202) */
async function destinationHere(mode: "fixture" | "live", av: { on: boolean; previewOnly: boolean; reason: string | null }, liveRelayRead?: boolean | null) {
  const { anonDestinationFor } = await import("@/lib/zk/anon/universe");
  const { cachedSnapshot } = await import("@/lib/zk/prefetch");
  const { ZK_JITTER_MAX_MS } = await import("@/lib/zk/config");
  const snap = cachedSnapshot(mode);
  const iv = typeof snap?.anonConfig?.relayIntervalMs === "number" ? snap.anonConfig.relayIntervalMs : 3_600_000;
  const spread = typeof snap?.anonConfig?.relaySpreadMs === "number" ? snap.anonConfig.relaySpreadMs : 0;
  const withinMinutes = (ZK_JITTER_MAX_MS + iv + spread + Math.min(Math.floor(iv / 6), 600_000)) / 60_000;
  const liveRelay = typeof liveRelayRead === "boolean" ? liveRelayRead : snap?.anonConfig ? snap.anonConfig.liveRelay === true : null;
  return anonDestinationFor({ on: av.on, previewOnly: av.previewOnly, mode, host: typeof window !== "undefined" ? "tab" : "server", liveRelay, reason: av.reason, withinMinutes });
}

/** the refusal code a POST answers for an availability that is off (UXH-2: "checking" is its own; "crowd" only for a root
 *  that IS outside the crowd; anything else "unavailable") */
function refusalCodeOf(av: { scope: "deployment" | "now" | null; code: string | null }): string {
  if (av.code === "checking") return "checking";
  if (av.code === "crowd") return "crowd";
  return "unavailable";
}

/** PERSONA LAUNCH P3: what the composer shows about the persona a post would be made as. Never throws: a persona whose
 *  mode cannot be read is `available: false` with the reason (the composer then leaves the toggle off — fail closed). */
interface PostAsView {
  personaId: string | null;
  handle: string | null;
  mode: string | null;
  explicit: boolean;
  ownAccount: boolean;
  options: string[];
  settable: boolean;
  available: boolean;
  reason: string | null;
  /** PERSONA LAUNCH P4: the labels of the rings that see this persona at depth "posts" (they will see this post is yours) */
  rings: string[];
  /** PERSONA LAUNCH P4: set when the rings document could not be read (the post would then be refused, never sent blind) */
  ringsError?: string;
  /** PERSONA LAUNCH P6: a launched persona with no choice made — the composer asks where its posts go before Post */
  choiceRequired: boolean;
  /** PERSONA LAUNCH P6: the persona has its own launched account (the picker's "direct" note) */
  launched: boolean;
  /** PERSONA LAUNCH P6 (UX-L1): the persona's launch is under way — an anon post now is revealed with its other ones */
  launchPending: boolean;
  /** UX-L1: the plain sentence that says so (null when no launch is under way) — the composer shows it, never its own */
  launchNotice: string | null;
  /** PERSONA LAUNCH P7 (UXH-8): this is the owner service (lib/world-flag.ts isOwnerService) — its rings publish to its
   *  own validator, which no device outside the service reads, so a ring set to see this post reaches nobody for now
   *  (Settings › Rings and the status page say the same, UX-R2); the ring line says that instead of "will see" */
  ownerService: boolean;
}
/** PERSONA LAUNCH P4 (rings' line): which rings see this persona's posts — memory only (no fetch, no write); a throw is
 *  "couldn't read your rings", never an empty list that would read as "nobody" */
async function ringsFor(personaId: string): Promise<{ rings: string[]; ringsError?: string }> {
  try {
    return { rings: await (await import("@/lib/rings/model")).ringsSeeingPosts(personaId) };
  } catch {
    return { rings: [], ringsError: "couldn't read your rings" };
  }
}
async function postAsFor(personaId: string | null): Promise<PostAsView> {
  const { isOwnerService } = await import("@/lib/world-flag");
  return { ...(await postAsForPersona(personaId)), ownerService: isOwnerService() };
}
async function postAsForPersona(personaId: string | null): Promise<Omit<PostAsView, "ownerService">> {
  if (!personaId) return { personaId: null, handle: null, mode: null, explicit: false, ownAccount: false, options: [], settable: false, available: false, reason: "No persona yet — create one in Settings › Account & Personas first.", rings: [], choiceRequired: false, launched: false, launchPending: false, launchNotice: null };
  const { anonPersonaRefusal, handleOfPersona, postModeView } = await import("@/lib/identity/postMode");
  try {
    const refusal = await anonPersonaRefusal(personaId);
    if (refusal && refusal.code === "persona") return { personaId, handle: handleOfPersona(personaId), mode: null, explicit: false, ownAccount: false, options: [], settable: false, available: false, reason: refusal.message, rings: [], choiceRequired: false, launched: false, launchPending: false, launchNotice: null };
    const v = await postModeView(personaId);
    const r = await ringsFor(personaId);
    // UX-L1: is a launch of this persona under way (its batch reveal would hold a post made now)? Memory only (the sealed
    // queue). Unreadable is NOT "no launch": the persona may not post anonymously until it can be read (fail closed — the
    // gate refuses such a post too)
    let launchPending: boolean;
    try {
      launchPending = (await (await import("@/lib/launch/confirm")).launchUnderWay(personaId)) === true;
    } catch (e) {
      return { personaId, handle: v.handle, mode: v.mode, explicit: v.explicit, ownAccount: v.ownAccount, options: v.options, settable: v.settable, available: false, reason: "couldn't read whether @" + (v.handle ?? "this persona") + " is being launched (" + (e as Error).message + ")", ...r, choiceRequired: v.choiceRequired === true, launched: v.launched === true, launchPending: false, launchNotice: null };
    }
    const { launchRevealSentence } = await import("@/lib/zk/gate");
    return { personaId, handle: v.handle, mode: v.mode, explicit: v.explicit, ownAccount: v.ownAccount, options: v.options, settable: v.settable, available: refusal === null, reason: refusal ? refusal.message : null, ...r, choiceRequired: v.choiceRequired === true, launched: v.launched === true, launchPending, launchNotice: launchPending ? launchRevealSentence(v.handle) : null };
  } catch (e) {
    return { personaId, handle: handleOfPersona(personaId), mode: null, explicit: false, ownAccount: false, options: [], settable: false, available: false, reason: "couldn't read this persona's post mode (" + (e as Error).message + ")", rings: [], choiceRequired: false, launched: false, launchPending: false, launchNotice: null };
  }
}

/** PERSONA LAUNCH P5: the reach block — from the last tick's snapshot and this root's held tiers (the vault, re-read here:
 *  the composer's mount, never a compose). Off where anonymous posting is off. */
async function reachBlock(mode: "fixture" | "live", snap: import("@/lib/zk/prefetch").PrefetchSnapshot | null, off: boolean): Promise<{ offered: Array<{ tree: string; label: string; size: number }>; defaultTree: string; plainTree: string; reason: string | null }> {
  const { anonPostTree, reachOfferInputFor } = await import("@/lib/zk/gate");
  if (off) return { offered: [], defaultTree: anonPostTree(), plainTree: anonPostTree(), reason: null };
  const { refreshHeldReach } = await import("@/lib/reach/held");
  const held = await refreshHeldReach(mode);
  const { offeredAnonTrees } = await import("@/lib/reach/trees");
  const offer = offeredAnonTrees(reachOfferInputFor(mode, snap));
  return {
    offered: offer.offered.map((o) => ({ tree: o.tree, label: o.label, size: o.size })),
    defaultTree: offer.defaultTree,
    plainTree: anonPostTree(),
    reason: held.error ? "Your reach tiers couldn't be read just now, so this post isn't boosted." : offer.reason,
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; text?: unknown; force?: unknown; castHash?: unknown; personaId?: unknown; fid?: unknown; tree?: unknown; launchPending?: unknown; postAs?: unknown };

  if (body.action === "reveal") {
    const castHash = typeof body.castHash === "string" ? body.castHash : "";
    const personaId = typeof body.personaId === "string" ? body.personaId : "";
    if (!castHash || !personaId) return NextResponse.json({ error: "castHash and personaId required" }, { status: 400 });
    const { revealAttribution } = await import("@/lib/zk/anonAttribution");
    const { zkMode } = await import("@/lib/zk/config");
    const r = await revealAttribution(castHash, personaId, zkMode());
    if (!r.ok) {
      const status = (r.reason ?? "").includes("not one of your") ? 403 : (r.reason ?? "").includes("already attributed") ? 409 : 400;
      return NextResponse.json({ error: r.reason }, { status });
    }
    return NextResponse.json({ ok: true, attributedFid: r.fid, attributedAt: r.attributedAt, alreadyAttributed: !!r.alreadyAttributed, scope: "inside Totem only — nothing changes on Farcaster" });
  }

  // PUBLIC GO-LIVE (ASM-5): leave the live anonymous crowd — this device's crowd identity signs a leave and the validator
  // drops its commitment from the next epoch (lib/zk/anon/fcJoin.ts fcLeaveCrowd); joining again takes a fresh Sign in with
  // Farcaster. In a tab, in the live universe only (the test universe is joined by registration, not by Farcaster).
  if (body.action === "leaveCrowd") {
    const { zkMode } = await import("@/lib/zk/config");
    if (typeof window === "undefined" || zkMode() !== "live") return NextResponse.json({ error: "Leaving the anonymous crowd is done in your browser, on a site whose anonymous posts go to Farcaster." }, { status: 409 });
    const r = await (await import("@/lib/zk/anon/fcJoin")).fcLeaveCrowd();
    return NextResponse.json(r.ok ? { ok: true, leftFromEpoch: r.leftFromEpoch } : { error: r.error ?? "The validator didn't take the request to leave." }, { status: r.ok ? 200 : r.status >= 400 && r.status < 600 ? r.status : 503 });
  }

  if (body.action === "ownFidCheck") {
    const fid = Number(body.fid);
    if (!Number.isInteger(fid) || fid <= 0) return NextResponse.json({ error: "fid (positive integer) required" }, { status: 400 });
    const { ownIdentityFacts } = await import("@/lib/zk/privacy");
    const { SEED_SELF_FID } = await import("@/lib/zk/anon/relayAccount");
    const own = await ownIdentityFacts();
    if (own.personaFids === null) return NextResponse.json({ error: "this device's own account list could not be read — refusing to answer (fail closed)" }, { status: 503 });
    return NextResponse.json({ fid, own: own.personaFids.includes(fid), throwaway: own.throwawayFid === fid, seedSelf: fid === SEED_SELF_FID });
  }

  // PERSONA LAUNCH P7: in the BROWSER DEVICE the availability is judged here first, WITH the last check's snapshot and
  // this root's commitment, so a stranger who is not in the crowd is told so in plain words and nothing is minted (the
  // gate's own call has no snapshot). A server-side device leaves the decision to the gate, exactly as before.
  // UXH-2: in a tab with no check yet, one runs first; still unknown after it is "checking" — refused (409), nothing
  // minted, the words stay in the box (never accepted on a guess and dropped a day later)
  const { zkMode: zkModeNow } = await import("@/lib/zk/config");
  // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): a root outside the crowd is joined here too (when the composer's read did
  // not already), and the refusal names when it can post
  const here = typeof window !== "undefined" ? await availabilityHere(zkModeNow(), { firstCheck: true, join: true }) : null;
  if (here && !here.on) {
    return NextResponse.json({ error: here.reason, code: refusalCodeOf(here), detail: here.detail, ...(typeof here.availableFrom === "number" ? { availableFrom: here.availableFrom } : {}) }, { status: here.scope === "now" ? 409 : 503 });
  }
  const { requestAnonPost } = await import("@/lib/zk/gate");
  // `force` (dev hooks only): bypass the client-side K-per-window refusal so a rig can watch the VALIDATOR refuse a
  // re-used slot by nullifier — the product never sets it
  const force = body.force === true && isDev();
  // PUBLIC GO-LIVE: postAs "root" — a post made as yourself, with no persona (the /anon page); anything else in postAs is refused
  if (body.postAs !== undefined && body.postAs !== "root") return NextResponse.json({ error: "postAs takes only \"root\" (a post made as yourself).", code: "persona" }, { status: 400 });
  const asRoot = body.postAs === "root";
  if (asRoot && body.personaId !== undefined) return NextResponse.json({ error: "A post made as yourself names no persona.", code: "persona" }, { status: 403 });
  // PERSONA LAUNCH P3: the persona the post is made as — named, or the acting one; the gate checks it is this device's own
  let personaId: string | null;
  if (asRoot) personaId = null;
  else if (body.personaId !== undefined) personaId = typeof body.personaId === "string" ? body.personaId : "";
  else {
    const { defaultPostingPersonaId } = await import("@/lib/identity/postMode");
    personaId = await defaultPostingPersonaId();
  }
  if (!asRoot && !personaId) return NextResponse.json({ error: "No persona yet — create one in Settings › Account & Personas first.", code: "persona" }, { status: 409 });
  // PERSONA LAUNCH P5: the reach tree to boost with (absent = the plain anon tree); anything but a string is refused
  if (body.tree !== undefined && typeof body.tree !== "string") return NextResponse.json({ error: "That isn't a reach tier an anonymous post can be boosted with.", code: "bad-tree" }, { status: 400 });
  // PERSONA LAUNCH P6 (UX-L1): what the composer's line said about this persona's launch (only `true` says "pending")
  const r = await requestAnonPost(typeof body.text === "string" ? body.text : "", { force, personaId, tree: typeof body.tree === "string" ? body.tree : undefined, ...(asRoot ? { postAs: "root" as const } : {}), launchPending: body.launchPending === true });
  if (!r.ok) {
    const status = STATUS_OF_CODE[r.code ?? ""] ?? ((r.reason ?? "").startsWith("anon posting needs") ? 503 : 400);
    return NextResponse.json({ error: r.reason, code: r.code ?? null }, { status });
  }
  // PUBLIC GO-LIVE: where it went, in the words the toast shows (the same rule the GET's destinationSentence follows)
  const posted = await destinationHere(zkModeNow(), { on: true, previewOnly: here?.previewOnly === true, reason: null });
  return NextResponse.json(
    {
      queued: true,
      castHash: r.castHash,
      tree: r.tree,
      destination: posted.destination,
      postedSentence: posted.postedSentence,
      // device-local: which of YOUR personas this was posted as (the post itself names no one)
      personaId,
      warnings: r.warnings ?? [],
      // UX-L1: a post made while its persona's launch is under way is revealed with the rest — the note says so
      launchPending: r.launchPending === true,
      // PERSONA LAUNCH P7: made in a browser on the public preview — it stays inside the preview, never on Farcaster
      ...(here?.previewOnly ? { previewOnly: true, previewSentence: ANON_PREVIEW_SENTENCE_TEXT } : {}),
      note:
        r.launchPending === true
          ? "proved at idle, sent at a random time inside the window, relayed by the validator at its next slot, and revealed as this persona's with its other anonymous posts when its launch reveals them"
          : "proved at idle, sent at a random time inside the window, relayed by the validator at its next slot, attributed to no one unless you later choose to reveal it",
    },
    { status: 202 }
  );
}

export async function GET(req: NextRequest) {
  const castHash = req.nextUrl.searchParams.get("castHash");
  const wantEnvelope = req.nextUrl.searchParams.get("envelope") === "1" && isDev();
  const { zkMode, ZK_PREFETCH_MS, ZK_JITTER_MAX_MS, ZK_ANON_POST_SLOTS } = await import("@/lib/zk/config");
  const mode = zkMode();
  // R3-18: one cheap read per anon card — the reveal list alone, no verdict, no validator call
  if (req.nextUrl.searchParams.get("revealable") === "1") {
    const { revealableCastHashes } = await import("@/lib/zk/anonAttribution");
    return NextResponse.json({ mode, revealable: await revealableCastHashes() });
  }
  // PERSONA LAUNCH P7: `host` — "tab" in the browser device (a post still waiting for its proof lives only in the tab's
  // memory, and a proof made for a window that ended while the tab was closed is refused when the tab sends it), else
  // "server"; `previewOnly` — the browser's test universe: an accepted post stays inside the preview
  const host: "tab" | "server" = typeof window !== "undefined" ? "tab" : "server";
  const previewOnly = host === "tab" && mode === "fixture";
  // PUBLIC GO-LIVE (PRIV-LIVE-1): this device's CROWD commitment — public by design (it is what a Farcaster join adds to the
  // live tree; lib/zk/anon/fcJoin.ts) — and what the last join said. Memory only: never a fetch. A tab in the live universe
  // only (anywhere else: null). For the /anon page and the suites: never the root's registered commitment.
  if (req.nextUrl.searchParams.get("crowd") === "1") {
    if (host !== "tab" || mode !== "live") return NextResponse.json({ mode, host, commitment: null, join: null });
    const fj = await import("@/lib/zk/anon/fcJoin");
    let commitment: string | null = null;
    try {
      commitment = fj.anonFidTreeCommitment();
    } catch {
      commitment = null;
    }
    return NextResponse.json({ mode, host, commitment, join: fj.fcJoinState(commitment) });
  }
  // PERSONA LAUNCH P7 (UXH-2): the composer's MEMORY-ONLY poll while its line says "checking" — availability alone, from
  // this device's last snapshot and its own commitment: never a fetch, never a tick (the composer's full read below runs
  // the first check). The composer re-reads the full answer once the code is no longer "checking".
  if (req.nextUrl.searchParams.get("availability") === "1") {
    const av = await availabilityHere(mode);
    return NextResponse.json({ mode, host, on: av.on, unavailableReason: av.on ? null : av.reason, unavailableCode: av.code, anonDeploymentOff: !av.on && av.scope === "deployment", previewOnly: av.previewOnly === true });
  }
  // UXH-2: the composer's FULL read (not a per-post poll, not the recent list) runs the first check in a tab that has
  // none, before anything below reads the snapshot
  if (!castHash && req.nextUrl.searchParams.get("recent") !== "1") await firstCheckIfNone(mode);
  const { anonPostItems } = await import("@/lib/zk/anon/queue");
  const { wantedAnonPosts } = await import("@/lib/zk/gate");
  const { cachedSnapshot } = await import("@/lib/zk/prefetch");
  const items = await anonPostItems();
  const snap = cachedSnapshot(mode);
  const relayIntervalMs = snap?.anonConfig?.relayIntervalMs ?? 3_600_000;
  // R3-14: the timing the owner should expect, in numbers the status line turns into clock times
  // PERSONA LAUNCH P3 (D4): plus the relay SPREAD (30 minutes on the public shape) — a post lands anywhere in it
  const relaySpreadMs = typeof snap?.anonConfig?.relaySpreadMs === "number" ? snap.anonConfig.relaySpreadMs : 0;
  const timing = { nextTickWithinMs: Math.round(ZK_PREFETCH_MS * 1.25), jitterMaxMs: ZK_JITTER_MAX_MS, relayIntervalMs, relaySlotJitterMaxMs: Math.min(Math.floor(relayIntervalMs / 6), 600_000), relaySpreadMs };
  /**
   * one post's status (the AnonPostStatus line's input). `reads`: the per-post poll may ask the validator (the signed
   * reader's refusal reason, the public list for a replay) exactly as before; the composer's recent list (UXH-3) never
   * does — memory only. PERSONA LAUNCH P7 (UXH-3): `expiredWindow` — the submission was sent after the end of the window
   * its proof was made for (the tab was closed across it), judged locally from the last check's epoch timing, so the
   * line can say so without asking the validator.
   */
  const statusOf = async (castHash: string, reads: boolean) => {
    let item: (typeof items)[number] | null = items.find((i) => i.castHash === castHash) ?? null;
    // PERSONA LAUNCH P3 (PRIV-3): a submission pruned after its window closed left how it ended on its sealed reveal
    // record — the status line reads that instead of "no record of this post" (the envelope is gone: none to hand a rig)
    if (!item && /^[0-9a-f]{64}$/.test(castHash)) {
      const { attributionRecord } = await import("@/lib/zk/anon/queue");
      const rec = await attributionRecord(castHash);
      if (rec?.settled) item = { id: "zka_" + castHash, castHash, status: rec.settled.status, outcome: rec.settled.outcome, epoch: -1, notBefore: 0, sentAt: rec.settled.sentAt, personaId: rec.personaId };
    }
    const wanted = !item && wantedAnonPosts().some((w) => w.castHash === castHash);
    const { anonOutcome } = await import("@/lib/zk/anon/outcomes");
    const outcome = anonOutcome(castHash);
    let envelope: unknown = undefined;
    if (reads && wantEnvelope && item) {
      const { hydrate, state } = await import("@/lib/adapters/mock/store");
      await hydrate();
      envelope = state().zkQueue.get(item.id)?.envelope ?? null;
    }
    // A2-5: the anonymous channel answers a constant "refused"; the reviewed validator keeps the reason for the
    // signed reader (never on the anonymous wire) — asked only once a submission was refused
    // PUBLIC GO-LIVE (PRIV-LIVE-2): and ONLY by a server-side device (the owner's own app over its private network). A TAB
    // never asks: that read is device-signed (signedReadHeaders) and names the refused post's cast hash, so on the public
    // site it would tell the validator which device sent the post it just refused. A tab shows the generic refusal line.
    let validatorRefusal: { reason: string; at: number } | null = null;
    if (reads && host === "server" && item && item.status === "sent" && item.outcome === "refused") {
      try {
        const { fetchAnonPostConfig } = await import("@/lib/zk/validatorClient");
        validatorRefusal = (await fetchAnonPostConfig(mode, castHash)).lastRefusal ?? null;
      } catch {
        validatorRefusal = null;
      }
    }
    const status = item ? item.status : outcome?.stage === "dropped" ? "dropped" : wanted || outcome?.stage === "wanted" || outcome?.stage === "deferred" || outcome?.stage === "retrying" ? "wanted" : "unknown";
    // PERSONA LAUNCH P3: which of this device's personas posted it (device-local, from the sealed record; null once the
    // record is gone — a dropped post keeps no secret)
    let personaId: string | null = item?.personaId ?? null;
    if (!personaId && /^[0-9a-f]{64}$/.test(castHash)) {
      const { attributionRecord } = await import("@/lib/zk/anon/queue");
      personaId = (await attributionRecord(castHash))?.personaId ?? null;
    }
    // PERSONA LAUNCH P3 (A-ANON-SLOT-COLLISION-ACROSS-DEVICES): with K slots a "replay" no longer always means "this very
    // post was sent twice" — another device of the same person may have spent that slot first, and then THIS text was
    // never posted. The public list can CONFIRM the first (true); it can never prove the second: it holds relayed rows
    // only (a pending original waits for its slot), the newest 200 — so false is "not seen", and AnonPostStatus says
    // so, without ever advising to post the same words again (PRIV-1). null when it could not be read.
    let relayed: boolean | null = null;
    if (reads && item && item.status === "sent" && item.outcome === "replay") {
      try {
        const { fetchAnonCasts } = await import("@/lib/zk/validatorClient");
        relayed = (await fetchAnonCasts(mode)).some((c) => c.castHash === castHash);
      } catch {
        relayed = null;
      }
    }
    let expiredWindow = false;
    if (item && item.outcome === "refused" && typeof item.sentAt === "number" && item.epoch >= 0 && snap?.epoch && Number.isFinite(snap.epoch.epochMs) && Number.isFinite(snap.epoch.msRemaining)) {
      // the end of window `item.epoch`, counted back from the end of the window the last check read
      const end = snap.fetchedAt + snap.epoch.msRemaining - (snap.epoch.epoch - item.epoch) * snap.epoch.epochMs;
      expiredWindow = item.sentAt >= end;
    }
    // PUBLIC GO-LIVE: the post's Farcaster link once the validator relayed it (live only), from the anon list this device
    // last read on its uniform reads (lib/zk/validatorClient.ts lastAnonCasts) — never a read of this one post
    let castUrl: string | null = null;
    if (mode === "live") {
      const { lastAnonCasts } = await import("@/lib/zk/validatorClient");
      const { castUrlFor } = await import("@/lib/zk/anon/universe");
      const hit = lastAnonCasts(mode)?.casts.find((c) => c.castHash === castHash) ?? null;
      castUrl = hit ? castUrlFor(hit.hash) : null;
    }
    return { castHash, mode, status, personaId, item, outcome, validatorRefusal, relayed, timing, host, previewOnly, expiredWindow, castUrl, ...(reads && wantEnvelope ? { envelope } : {}) };
  };
  if (castHash) return NextResponse.json(await statusOf(castHash, true));
  // PERSONA LAUNCH P7 (UXH-3) — THIS DEVICE'S ANONYMOUS POSTS THAT STILL NEED YOU, for the composer to show on mount: the
  // per-post line was mounted only from the composer's own state after a 202, so after a reload, a reopen or a navigation
  // it was gone, and the "closed tab" sentences never showed in the case they were written for. Listed: posts waiting for
  // their proof (memory), proved and not yet sent, refused or dropped in the last RECENT_MS, and — in a tab — a post whose
  // reveal record survived but whose proof never did (lost with the tab). MEMORY ONLY: no validator read (the per-post
  // poll is where the signed refusal reason is asked, as before). Never the words.
  if (req.nextUrl.searchParams.get("recent") === "1") {
    const RECENT_MS = 48 * 3_600_000;
    const now = Date.now();
    const hashes = new Set<string>();
    for (const w of wantedAnonPosts()) hashes.add(w.castHash);
    const { anonOutcomes, anonOutcome } = await import("@/lib/zk/anon/outcomes");
    for (const o of anonOutcomes()) if (o.stage === "dropped" && now - o.lastAt <= RECENT_MS) hashes.add(o.castHash);
    for (const i of items) {
      if (!i.castHash) continue;
      if (i.status === "queued") hashes.add(i.castHash);
      else if ((i.status === "sent" || i.status === "refused") && i.outcome !== "accepted" && i.outcome !== "replay" && now - (i.sentAt ?? i.notBefore) <= RECENT_MS) hashes.add(i.castHash);
    }
    if (host === "tab") {
      const { attributionCastHashes, attributionRecord } = await import("@/lib/zk/anon/queue");
      for (const h of await attributionCastHashes()) {
        if (hashes.has(h) || items.some((i) => i.castHash === h) || anonOutcome(h)) continue;
        const rec = await attributionRecord(h);
        if (rec && !rec.settled && rec.mode === mode && now - rec.at <= RECENT_MS) hashes.add(h);
      }
    }
    const recent = [];
    for (const h of hashes) recent.push(await statusOf(h, false));
    // PUBLIC GO-LIVE: and, ONLY when asked (casts=1: the /anon page's feed), the site's newest relayed anonymous posts — the
    // PUBLIC list, read whole (the same read every tick and every feed build makes; never one post's), the validator leaving
    // removed ones out; a list that cannot be read is null with the reason, never an empty list (never fail open). Without
    // casts=1 nothing is read (the composer's 20-second poll stays memory only: UXH-3)
    const wantCasts = req.nextUrl.searchParams.get("casts") === "1";
    const { castUrlFor } = await import("@/lib/zk/anon/universe");
    let casts: Array<{ castHash: string; text: string; at: number; castUrl: string | null }> | null = null;
    let castsError: string | null = null;
    for (let attempt = 0; wantCasts && attempt < 2 && casts === null; attempt++) {
      try {
        const { fetchAnonCasts } = await import("@/lib/zk/validatorClient");
        casts = (await fetchAnonCasts(mode)).map((c) => ({ castHash: c.castHash, text: c.text, at: c.at, castUrl: mode === "live" ? castUrlFor(c.hash) : null }));
        castsError = null;
      } catch (e) {
        castsError = "the anonymous posts couldn't be read just now (" + (e as Error).message + ")";
      }
    }
    return NextResponse.json({ mode, host, previewOnly, recent, universe: mode, casts, castsError });
  }
  // PERSONA LAUNCH P3: the persona a post would be made as (the acting one), its post mode and whether it may post
  // anonymously — computed before (and whatever happens to) the validator read below
  const { defaultPostingPersonaId, isOwnPostingPersona } = await import("@/lib/identity/postMode");
  const askedFor = req.nextUrl.searchParams.get("personaId");
  const postAs = await postAsFor(askedFor && isOwnPostingPersona(askedFor) ? askedFor : await defaultPostingPersonaId().catch(() => null));
  const { anonWindowHours } = await import("@/lib/zk/gate");
  const cadence = { slotsPerWindow: ZK_ANON_POST_SLOTS, windowHours: anonWindowHours(snap) };
  // PERSONA LAUNCH P3 (UX-3): a DEPLOYMENT-WIDE reason — the deployment's switch, the live universe in a visitor's tab,
  // or a server whose reputation binding is not the proof layer — needs no validator read, so it is decided first and
  // survives a failed read below. It is
  // said in plain words with `anonDeploymentOff: true`: the composer then neither offers the toggle nor claims the
  // persona "posts through @anon by default" where nothing posts through @anon at all; the technical reason rides
  // `unavailableDetail` (the composer keeps it one <details> away).
  // PERSONA LAUNCH P7 (D-ANON-SWITCH): the decision is lib/zk/anon/availability.ts's — the switch, then the host. In the
  // browser device the test universe is now ON and preview-only (P7 built the in-tab prover and the web channel); the
  // live universe stays off there, deployment-wide. A root outside the crowd is off for NOW (not deployment-wide): said
  // in plain words right after the deployment reason, and it survives a failed validator read like that one does.
  const onDevice = typeof window !== "undefined";
  // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the composer's full read joins a tab outside the crowd (availabilityHere)
  const av = await availabilityHere(mode, { join: true });
  const deploymentOff: { reason: string; detail: string } | null = !av.on && av.scope === "deployment" ? { reason: av.reason ?? "Anonymous posting is off here.", detail: av.detail ?? "" } : null;
  const nowOff: { reason: string; detail: string } | null = !av.on && av.scope === "now" ? { reason: av.reason ?? "Anonymous posting isn't possible from here right now.", detail: av.detail ?? "" } : null;
  // UXH-2 / UXH-11: `unavailableCode` names WHY in a word the composer can act on ("checking": read again shortly via the
  // memory-only ?availability=1; "crowd": not a step this visitor can take here) and `host` says whether this is a tab
  const offFields = {
    ...(deploymentOff ? { anonDeploymentOff: true, unavailableDetail: deploymentOff.detail } : nowOff ? { anonDeploymentOff: false, unavailableDetail: nowOff.detail } : { anonDeploymentOff: false }),
    unavailableCode: av.on ? null : av.code,
    host,
    // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): a tab that joined the crowd — when its first window starts (the sentence
    // says it in words; this is the same moment as a number, device-local, for the composer and the suites)
    availableFrom: typeof av.availableFrom === "number" ? av.availableFrom : null,
  };
  // PERSONA LAUNCH P7: preview-only — a browser's anonymous post on this site stays inside the preview
  const previewFields = { previewOnly: av.previewOnly === true, previewSentence: av.previewOnly === true ? ANON_PREVIEW_SENTENCE_TEXT : null };
  // PERSONA LAUNCH P5: the reach block, decided before (and whatever happens to) the validator read below
  let reach: Awaited<ReturnType<typeof reachBlock>>;
  try {
    // PERSONA LAUNCH P7 (D-PUBLIC-ANON-TREE): nothing is offered in the browser either — strangers prove the plain tree
    reach = await reachBlock(mode, snap, deploymentOff !== null || av.previewOnly === true);
  } catch (e) {
    const { anonPostTree } = await import("@/lib/zk/gate");
    reach = { offered: [], defaultTree: anonPostTree(), plainTree: anonPostTree(), reason: "Your reach tiers couldn't be read just now (" + (e as Error).message + "), so this post isn't boosted." };
  }
  try {
    const { privacyConditions } = await import("@/lib/zk/privacy");
    const { fetchAnonPostConfig } = await import("@/lib/zk/validatorClient");
    const { relayCapReason } = await import("@/lib/zk/anon/slots");
    const { anonPostsAhead } = await import("@/lib/zk/anon/queue");
    const readAt = Date.now();
    const config = await fetchAnonPostConfig(mode);
    // MULTI-FID Gate 5: the tenth condition — the anon relay account is distinct from this app's Neynar identity
    const privacy = await privacyConditions(mode, { anon: { liveRelay: config.liveRelay, fid: config.fid, relayKeyFingerprint: config.relayKeyFingerprint ?? null } });
    // the anoncast pattern: which of THIS device's anon posts it still holds a reveal secret for
    const { revealableCastHashes } = await import("@/lib/zk/anonAttribution");
    const revealable = await revealableCastHashes();
    // R1-10 / R3-13: is anonymous posting possible HERE at all — plain words the composer can show instead of a
    // red label it cannot act on (the browser-device preview has no anonymous channel: its node:http shim refuses)
    // UX-2: the relay's own budget with this device's posts the validator has not counted yet (see the chain below)
    const capReason = relayCapReason(mode, config, wantedAnonPosts().length + (await anonPostsAhead(mode, readAt)));
    let unavailableReason: string | null = null;
    if (deploymentOff) unavailableReason = deploymentOff.reason;
    // PERSONA LAUNCH P7: this browser's root is not in the crowd (yet) — plain words, nothing minted (POST refuses 'crowd')
    else if (nowOff) unavailableReason = nowOff.reason;
    else if (mode === "live" && !config.liveRelay) unavailableReason = "the validator has no armed anonymous account yet";
    // PERSONA LAUNCH P7: the browser now has its own anonymous viewpoint (the web channel's head); only a server-side
    // device still hears the old sentence
    else if (snap && !snap.anonHead && onDevice) unavailableReason = "the anonymous channel can't be reached from this tab right now (" + (snap.anonHeadError ?? "no anonymous viewpoint") + ")";
    else if (snap && !snap.anonHead) unavailableReason = "the anonymous channel is unavailable from here (" + (snap.anonHeadError ?? "no anonymous viewpoint") + ") — anonymous posting needs a server-side device";
    // PERSONA LAUNCH P3: the validator's K must be this app's K (the client never adopts a served K — lib/zk/gate.ts)
    else if (typeof config.slotsPerWindow === "number" && config.slotsPerWindow !== ZK_ANON_POST_SLOTS) unavailableReason = `the validator allows ${config.slotsPerWindow} anonymous posts per window and this app allows ${ZK_ANON_POST_SLOTS} — they must agree`;
    else if (typeof snap?.anonConfig?.slotsPerWindow === "number" && snap.anonConfig.slotsPerWindow !== ZK_ANON_POST_SLOTS) unavailableReason = `the validator allowed ${snap.anonConfig.slotsPerWindow} anonymous posts per window at the last check and this app allows ${ZK_ANON_POST_SLOTS} — they must agree`;
    // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the validator's plain tree must be this app's (every proof into another
    // tree is refused there) — on every host; a tab already hears it from availability.ts (deployment-wide, above)
    else if (typeof config.tree === "string" && config.tree !== (await import("@/lib/zk/gate")).anonPostTree()) unavailableReason = (await import("@/lib/zk/anon/availability")).ANON_OFF_TREE_MISMATCH;
    // PERSONA LAUNCH P3 (UX-2): the RELAY's own budget, from the signed config read — the owner service's lifetime live
    // cap (1 until the owner checked the first live cast: every post after it was refused at submission, after the box
    // was cleared) and the global daily cap — counting this device's posts the validator has not counted yet (waiting
    // for their proof, queued, or sent since the read). Reached = not offered, not defaulted on, said in plain words.
    else if (capReason) unavailableReason = capReason;
    const c10 = privacy.conditions.find((c) => c.id === 10);
    const { relayJoinRefusesPosting, relayAccountVerdict } = await import("@/lib/zk/anon/relayAccount");
    const { ownIdentityFacts } = await import("@/lib/zk/privacy");
    if (!unavailableReason && mode === "live" && c10 && !c10.ok) {
      const v = relayAccountVerdict({ mode, liveRelay: config.liveRelay, fid: config.fid, relayKeyFingerprint: config.relayKeyFingerprint ?? null }, await ownIdentityFacts());
      if (relayJoinRefusesPosting(v)) unavailableReason = "the anonymous account is not distinct from this app (" + v.detail + ")";
    }
    const { isOwnerService } = await import("@/lib/world-flag");
    // PUBLIC GO-LIVE: where a post made here goes right now, in the words to show before the click and after it
    const dest = await destinationHere(mode, { on: av.on && unavailableReason === null, previewOnly: av.previewOnly === true, reason: unavailableReason }, config.liveRelay === true);
    return NextResponse.json({
      mode,
      privacy,
      config,
      items,
      revealable,
      destination: dest.destination,
      destinationSentence: dest.destinationSentence,
      postedSentence: dest.postedSentence,
      // PERSONA LAUNCH P3: a KNOWN reason is "not available" whether or not a tick has run (the public preview never runs
      // one — its composer must say so, not offer a toggle that cannot work); no reason and no snapshot yet is "unknown"
      available: unavailableReason !== null ? false : snap ? true : null,
      unavailableReason,
      ...offFields,
      ...previewFields,
      timing,
      postAs,
      ...cadence,
      reach,
      // PERSONA LAUNCH P3 (UX-2): the anonymous account's LIFETIME cap on the live universe (the cadence sentence says it)
      lifetimeCap: mode === "live" && typeof config.cap === "number" ? config.cap : null,
      wanted: wantedAnonPosts(),
      // R3-13: the honest one-line framing for a one-owner service — an extra account with no name on it, not a crowd
      framing: isOwnerService()
        ? "On your private service the anonymous account is an extra Farcaster account with no name on it, not a crowd to hide in: its cover is how it was made, a separate Neynar key, the hourly relay slot and what you write."
        : null,
    });
  } catch (e) {
    // the verdict could not be computed: the composer shows this as the reason and offers no toggle (fail closed); the
    // persona line still says who a post would be made as
    // (UX-3: a deployment-wide reason is still the reason — known without the read)
    // (PERSONA LAUNCH P7: and so is "not in the crowd yet", and the preview line)
    const why = deploymentOff ? deploymentOff.reason : nowOff ? nowOff.reason : "the anonymous posting status could not be read (" + (e as Error).message + ")";
    // PUBLIC GO-LIVE: a verdict that could not be computed is "off" — never a destination guessed without it
    return NextResponse.json({ error: (e as Error).message, available: false, unavailableReason: why, destination: "off", destinationSentence: why, postedSentence: null, ...offFields, ...previewFields, postAs, ...cadence, reach }, { status: 503 });
  }
}
