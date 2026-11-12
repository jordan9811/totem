// PERSONA LAUNCH P7 — IS ANONYMOUS POSTING ON HERE? Decided in ONE place (D-ANON-SWITCH).
//
// Why this exists: until wave 3 the answer was "is the reputation binding the proof layer" (ADAPTER_REP=zk), asked
// separately by the gate (lib/zk/gate.ts requestAnonPost) and by the composer's route (app/api/anon/route.ts). That
// made anonymous posting a property of the WHOLE SITE's server configuration, which is meaningless on the public
// preview: there every request is answered by the visitor's own browser device, and ADAPTER_REP is a server variable
// the device never reads. Now one function answers for both callers, with three host shapes:
//
//   1. THE SWITCH. ZK_ANON_POST=off (the deployment's kill switch, forwarded to the browser device by
//      lib/device/deviceEnv.server.ts) or the rig's runtime override "off" turns it off everywhere, scope "deployment".
//      A value that is neither on nor off is unreadable, and unreadable is off (never fail open).
//   2. THE BROWSER DEVICE (typeof window !== "undefined", the public preview): the proof runs in a Web Worker and the
//      envelope leaves over the browser's anonymous channel (lib/zk/anon/webChannel.ts). The LIVE universe is off —
//      nothing a stranger's tab sends may reach Farcaster this wave (O2 is the owner's, and "never present test data as
//      live"). The FIXTURE universe is on and PREVIEW ONLY: the post stays inside the preview, every surface says so.
//      When the caller hands a prefetch snapshot of the plain anon tree AND this root's commitment, a commitment that is
//      not a leaf is off for NOW (scope "now"), in plain words, before anything is minted. The rep binding is never
//      consulted here: the device does not run the server's rep switch.
//   3. A SERVER-SIDE DEVICE (the rig, the owner service): ZK_ANON_POST=on → on; unset → on iff currentRepImpl() is
//      "zk" — exactly the rule every rig suite and the owner's arm-anon script rely on today. A PUBLIC deployment's
//      server holds no identity at all (the keyless server rule), so it is off there whatever the switch says.
//
// The membership sentence is ADVICE, not the guard: the tick never proves for a non-leaf (lib/zk/prove.ts stage
// "membership"), whatever this function said. A snapshot of the plain tree whose member list cannot be read is off
// (unreadable is off).
//
// PERSONA LAUNCH P7 (UXH-2) — UNKNOWN IS NOT YES. When the caller asks for the per-root judgement (it passes `snap`, even
// null — app/api/anon/route.ts does; the gate's and the outbox's deployment-only calls pass neither), a browser device
// that cannot judge — no check has run in this tab yet, this browser's identity could not be read, or the last check
// read another tree or another universe — is OFF for NOW (scope "now", code "checking"), in plain words, and nothing is
// accepted. Before this it said yes: the composer took the words, cleared the box, and a tab outside the crowd then
// retried the proof for about 25 hours ("membership" is not a terminal stage on a server) and dropped it. The route
// runs one check at once when it finds none, so "checking" lasts seconds, not the 10-minute cadence.
//
// PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE) — WHICH CROWD A STRANGER PROVES INTO, AND WHEN THEY MAY. The public preview
// runs ZK_ANON_POST_TREE=valid on the app (forwarded to the tab by lib/device/deviceEnv.server.ts) and on its validator:
// every registered root is a leaf of "valid", so a fresh visitor can try a preview-only anon post (tier-2 needed
// reputation a fresh root never has, so every stranger was refused). What this file adds, in the browser branch:
//   * the tree NAME must be well-formed (isPlainTreeName) — a garbled value is off, never "checking" forever;
//   * the tab and its validator must name the SAME tree (the validator's anon config, read on the tick) — a mismatch is
//     off deployment-wide, in plain words, because every proof would be refused there;
//   * a root outside the crowd hears WHEN it can post, not a dead end: the composer's route joins it (a fixture
//     registration, active from the NEXT epoch — the validator batches it) and passes the join state here (`join`), and
//     the sentence names the clock time the next window starts (availableFrom). A failed join says so;
//   * a leaf in a crowd under the client's floor (ZK_ANON_FLOOR, 50 by default; the tab is never told a lower one) is off
//     for now, saying how many people the crowd needs and has — the prover's cohort stage would refuse anyway, so the
//     composer must not offer what the tick would drop (never fail open).
// IMPORTS ARE LIMITED to @/lib/adapters/registry and @/lib/platform/env-contract on purpose: scripts/unit-anon-slots,
// unit-reach and unit-launch bundle lib/zk/gate.ts (which imports this file) with the registry mocked, and anything
// heavier would drag the device's world into those harnesses. The plain anon tree's name is therefore read from the
// environment HERE — a DELIBERATE DUPLICATE of lib/zk/config.ts ZK_ANON_POST_TREE (`tier-${ZK_GATE_TIER}`, the gate
// tier clamped to 1..10 exactly as config.ts clamps it); scripts/unit-prover.mjs pins the two together.
//
// PUBLIC GO-LIVE (the relay track) — LIVE FROM THE BROWSER, ONLY WHEN ARMED. In the browser branch the LIVE universe is on
// only when BOTH hold: the app's hint (lib/zk/anon/universe.ts — ZK_ANON_UNIVERSE=live, forwarded to every tab) AND the
// last tick's /zk/anon-post/config?mode=live said liveRelay: true (the caller passes the snapshot, or `liveRelay` from it).
// Otherwise today's ANON_OFF_BROWSER_LIVE words, deployment-wide, exactly as before. Armed, the per-root judgement is the
// fixture one (the served tree, a leaf, the client's floor of 50) over the LIVE public tree — which the validator builds,
// with its fid gate on, from one commitment per Farcaster account that joined with a verified sign-in — and its sentences
// say so (sign in with Farcaster to join; joined, you can post from <time>). An armed live post is NOT preview-only.
// In onboard's PUBLIC_LIVE mode the TEST universe is off in a tab (a live product posts no test data), said plainly.
// universe.ts has NO imports, so the import rule above still holds.
import { currentRepImpl } from "@/lib/adapters/registry";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { liveUniverseHinted, publicLiveHere } from "./universe";

/** why it is off, for the routes' refusal codes (the sentence is `reason`) — null when on */
export type AnonOffCode = "switch" | "unreadable" | "server" | "public-server" | "browser-live" | "crowd" | "checking" | "mismatch";

/** PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): what the composer's route knows about this tab joining the crowd (memory
 *  only: app/api/anon/route.ts joinCrowd). registered: the validator holds this root's fixture commitment; activeFromEpoch:
 *  the epoch it becomes a leaf (the next one when it joined now); error: why joining failed, in words (never a value). */
export interface AnonJoinState {
  registered: boolean;
  activeFromEpoch: number | null;
  error: string | null;
}

export interface AnonAvailability {
  on: boolean;
  previewOnly: boolean;
  scope: "deployment" | "now" | null;
  reason: string | null;
  detail: string | null;
  code: AnonOffCode | null;
  /** PERSONA LAUNCH GO-LIVE: when a root that has joined the crowd can post (ms since the epoch), else absent */
  availableFrom?: number | null;
}

/** the sentences, exported so the routes and the suites say (and look for) exactly the same words */
export const ANON_OFF_SWITCH = "Anonymous posting is switched off on this site.";
export const ANON_OFF_SERVER = "Anonymous posting is off on this server.";
export const ANON_OFF_PUBLIC_SERVER = "Anonymous posting runs in your browser on this site, never on its server.";
export const ANON_OFF_BROWSER_LIVE = "Anonymous posting to Farcaster isn't on this preview yet.";
/** PUBLIC GO-LIVE (onboard F11): the same refusal on the LIVE site (PUBLIC_LIVE): the live universe was handed to this tab but the relay is not armed */
export const ANON_OFF_LIVE_RELAY_OFF = "Anonymous posting to Farcaster is switched off on this site right now, so nothing can be posted anonymously.";
/** PERSONA LAUNCH P7 (UXH-11): one complete sentence (the composer shows it as its own sentence, never after a colon).
 *  PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): no longer the dead end ("you can't join it from here yet") — a fresh visitor
 *  now joins and hears WHEN (anonJoinSentence); this is what is left: no join is known yet in this tab, or a root that
 *  joined is still not listed after its window started (revoked, or refused by the validator) */
export const ANON_NOT_IN_CROWD = "This browser isn't in the anonymous crowd on this preview right now, so it can't post anonymously.";
/** PERSONA LAUNCH GO-LIVE: the composer's route tried to join this tab to the crowd and the validator refused or could not
 *  be reached (the technical reason rides `detail`) */
export const ANON_JOIN_FAILED = "This browser couldn't join the anonymous crowd on this preview just now, so it can't post anonymously yet.";
/** PERSONA LAUNCH GO-LIVE: joined, but the next window's start time could not be read from the last check */
export const ANON_JOINED_NEXT_WINDOW = "You've joined the anonymous crowd on this preview, and you can post anonymously once the next window starts.";
/** PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the tab and its validator name different plain trees — every proof would
 *  be refused there, so nothing is offered (a deployment fault: the two services' ZK_ANON_POST_TREE disagree) */
export const ANON_OFF_TREE_MISMATCH = "Anonymous posting is off on this site for now, because the site and its server don't agree on which crowd posts come from.";

/** PERSONA LAUNCH GO-LIVE: the clock time a window starts, in the visitor's own words and time zone ("2:00 PM", "tomorrow
 *  at 12:00 AM", "Saturday at 6:00 AM"). PURE given its inputs; the tests pass their own formatter. */
export function joinTimeText(startsAt: number, now: number): string {
  // to the nearest minute: the start is counted from the last check (its fetch time + the validator's msRemaining), a few
  // milliseconds after the true boundary — never shown as the minute before it
  const d = new Date(Math.round(startsAt / 60_000) * 60_000);
  const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => x.getFullYear() * 10000 + x.getMonth() * 100 + x.getDate();
  const n = new Date(now);
  if (day(d) === day(n)) return t;
  const tomorrow = new Date(now);
  tomorrow.setDate(n.getDate() + 1);
  if (day(d) === day(tomorrow)) return "tomorrow at " + t;
  return d.toLocaleDateString(undefined, { weekday: "long" }) + " at " + t;
}
/** PERSONA LAUNCH GO-LIVE: "joined; you can post from <time>" — and, when the crowd is still under the floor, what it needs */
export function anonJoinSentence(o: { when: string; hours: number; floor: number; crowd: number | null }): string {
  const every = Number.isFinite(o.hours) && o.hours > 0 ? ` (every ${o.hours} hours)` : "";
  const base = `You've joined the anonymous crowd on this preview, and you can post anonymously from ${o.when}, when new members are let in${every}.`;
  if (o.crowd !== null && o.crowd < o.floor) return base + ` Posting here also needs at least ${o.floor} people in the crowd, and there ${o.crowd === 1 ? "was 1" : "were " + o.crowd} at the last check.`;
  return base;
}
/** PERSONA LAUNCH GO-LIVE: a leaf in a crowd still under the client's floor */
export function anonFloorSentence(floor: number, crowd: number): string {
  return `Anonymous posting on this preview opens once at least ${floor} people are in the anonymous crowd, and there ${crowd === 1 ? "is 1" : "are " + crowd} now.`;
}
/** PUBLIC GO-LIVE: the LIVE crowd's sentences (the public site, relay armed) — one person per Farcaster account */
export const ANON_LIVE_SIGN_IN_FIRST = "To post anonymously to Farcaster, sign in with Farcaster on this device first. The anonymous crowd counts one person per Farcaster account, and it never shows which one posted.";
export const ANON_LIVE_JOIN_FAILED = "Your Farcaster sign-in couldn't add you to the anonymous crowd just now. Sign in with Farcaster again to try once more.";
export const ANON_LIVE_NOT_LISTED = "Your Farcaster sign-in hasn't added you to the anonymous crowd yet. Sign in with Farcaster again.";
export const ANON_LIVE_JOINED_NEXT_WINDOW = "You've joined the anonymous crowd with Farcaster, and you can post anonymously once the next window starts.";
/** PUBLIC GO-LIVE (onboard F2): signed in with Farcaster here, no join known in this tab (the join's outcome is memory only, so a reload forgets it). It must end by asking for a sign-in: lib/onboarding/state.ts crowdSignInAsked offers 'Sign in again' on it, and unit-onboarding U13 pins that. */
export const ANON_LIVE_MAYBE_JOINED = "You signed in with Farcaster here before, so this browser may already be in the anonymous crowd: it can post once its window starts. If it still can't after that, sign in with Farcaster again.";
/** PUBLIC GO-LIVE: joined (a verified Farcaster sign-in), posting opens at the next window — and what the crowd still needs */
export function anonLiveJoinSentence(o: { when: string; hours: number; floor: number; crowd: number | null }): string {
  const every = Number.isFinite(o.hours) && o.hours > 0 ? ` (every ${o.hours} hours)` : "";
  const base = `You've joined the anonymous crowd with Farcaster, and you can post anonymously from ${o.when}, when new members are let in${every}.`;
  if (o.crowd !== null && o.crowd < o.floor) return base + ` Posting also needs at least ${o.floor} people in the crowd, and there ${o.crowd === 1 ? "was 1" : "were " + o.crowd} at the last check.`;
  return base;
}
/** PUBLIC GO-LIVE: a leaf of the live crowd while it is still under the client's floor */
export function anonLiveFloorSentence(floor: number, crowd: number): string {
  return `Anonymous posting to Farcaster opens once at least ${floor} people are in the anonymous crowd, and there ${crowd === 1 ? "is 1" : "are " + crowd} now.`;
}
/** PUBLIC GO-LIVE: onboard's live product mode — the test universe posts nothing there */
export const ANON_OFF_LIVE_PRODUCT_TEST = "Anonymous posting isn't switched on for this site yet, so nothing can be posted anonymously right now.";

/** PERSONA LAUNCH P7 (UXH-2): no check has said yet whether this browser is in the crowd — off until one has */
export const ANON_CHECKING = "Checking whether you can post anonymously from here…";
export const ANON_OFF_UNREADABLE = "Anonymous posting is off here: whether it can work couldn't be read.";
export const ANON_PREVIEW_SENTENCE = "Preview only: your anonymous post stays inside this test preview. Nothing is posted to Farcaster.";

/**
 * PERSONA LAUNCH P7 (UXH-2) — the line for an anonymous post a TAB could not prove because its identity is not in the
 * crowd (lib/zk/prove.ts stage "membership"). In a tab that refusal is terminal (lib/zk/gate.ts anonRefused): retrying
 * it for a day only hid that the post was never going to leave. Plain words, and the words themselves given back so
 * nothing typed is lost (device-local: the outcome log lives in this tab's memory).
 */
export function anonDroppedInTabSentence(words: string | null | undefined): string {
  const w = typeof words === "string" ? words.trim() : "";
  const back = w ? ` Your words, so you can keep them: “${w}”` : "";
  return "this browser isn't in the anonymous crowd right now, so the post couldn't be proved to come from one of its members, and nothing was sent." + back;
}

/**
 * PERSONA LAUNCH P7 (UXH-3) — does THIS tab hold an anonymous post that closing it would lose or delay? A post waiting for
 * its proof lives only in the tab's memory (the wanted set), and one proved but not yet sent waits for the tab's drain.
 * PURE (the device passes its own counts in: lib/device/entry.ts asks it from a synchronous beforeunload handler).
 */
export function anonHeldInTab(wantedCount: number, queue: Iterable<{ claimKind?: unknown; status?: unknown }>): boolean {
  if (Number.isFinite(wantedCount) && wantedCount > 0) return true;
  for (const q of queue) if (q && q.claimKind === "anon-post" && q.status === "queued") return true;
  return false;
}

type Override = "on" | "off" | null;
const g = globalThis as unknown as { __layersAnonPostingOverride?: Override };

/** DEV ONLY (the rig's setAnonPosting action, refused without ZK_DEV_HOOKS and under LAYERS_WORLD=empty): force the
 *  switch for this process without a restart; null restores the environment's answer. resetZkRuntimeOverrides clears it. */
export function setAnonPostingOverride(v: "on" | "off" | null): void {
  g.__layersAnonPostingOverride = v === "on" || v === "off" ? v : null;
}

const off = (scope: "deployment" | "now", reason: string, detail: string | null, code: AnonOffCode): AnonAvailability => ({ on: false, previewOnly: false, scope, reason, detail, code });

/** the deployment's switch: "on", "off", null (unset), or "bad" (a value that is neither — read as off) */
function switchValue(): "on" | "off" | null | "bad" {
  const o = g.__layersAnonPostingOverride;
  if (o === "on" || o === "off") return o;
  const raw = String(process.env.ZK_ANON_POST ?? "").trim().toLowerCase();
  if (raw === "") return null;
  if (raw === "on") return "on";
  if (raw === "off") return "off";
  return "bad";
}

/** the plain anon tree's name — DELIBERATE DUPLICATE of lib/zk/config.ts ZK_ANON_POST_TREE (see the header) */
export function plainAnonTreeName(env: Record<string, string | undefined> = process.env): string {
  const tier = Math.max(1, Math.min(10, Number(env.ZK_GATE_TIER ?? 2)));
  return String(env.ZK_ANON_POST_TREE ?? "").trim() || `tier-${tier}`;
}

/** PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): a well-formed plain anon tree name — "valid", "tier-1".."tier-10", or an
 *  attestation bucket tree "attest:<issuer>/<bucket>" (the validator's own grammar). DELIBERATE DUPLICATE of
 *  lib/zk/config.ts isPlainTreeName (scripts/unit-prover.mjs V3 runs both over the same names). */
export function isPlainTreeName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  if (name === "valid" || /^tier-(10|[1-9])$/.test(name)) return true;
  const m = /^attest:([a-z0-9]+(?:[.-][a-z0-9]+)*)\/([a-z0-9]+(?:[.-][a-z0-9]+)*)$/.exec(name);
  return !!m && m[1].length <= 48 && m[2].length <= 32;
}
/** PERSONA LAUNCH GO-LIVE: the client's anonymity floor — DELIBERATE DUPLICATE of lib/zk/config.ts ZK_ANON_FLOOR (pinned by
 *  scripts/unit-prover.mjs V3); a value that is not a number is the default, never NaN (NaN compares false: a fail-open) */
export function anonFloorHere(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.ZK_ANON_FLOOR ?? 50);
  return Number.isFinite(n) ? Math.max(1, n) : 50;
}
/** the start of epoch `e` (ms since the epoch), counted from the last check's epoch timing; null when unreadable */
function epochStartMs(snap: unknown, e: number): number | null {
  const s = snap as { fetchedAt?: unknown; epoch?: { epoch?: unknown; epochMs?: unknown; msRemaining?: unknown } | null } | null;
  const ep = s && s.epoch;
  if (!s || !ep || typeof s.fetchedAt !== "number" || typeof ep.epoch !== "number" || typeof ep.epochMs !== "number" || typeof ep.msRemaining !== "number") return null;
  if (![s.fetchedAt, ep.epoch, ep.epochMs, ep.msRemaining, e].every(Number.isFinite) || ep.epochMs <= 0) return null;
  return s.fetchedAt + ep.msRemaining + (e - ep.epoch - 1) * ep.epochMs;
}
const snapEpochOf = (snap: unknown): number | null => {
  const e = (snap as { epoch?: { epoch?: unknown } } | null)?.epoch?.epoch;
  return typeof e === "number" && Number.isFinite(e) ? e : null;
};
const windowHoursOf = (snap: unknown): number => {
  const ms = (snap as { epoch?: { epochMs?: unknown } } | null)?.epoch?.epochMs;
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? Math.round((ms / 3_600_000) * 10) / 10 : NaN;
};
/** the plain tree the VALIDATOR names (its anon config, read on the tick), or null when the tick could not read it */
function servedPlainTree(snap: unknown): string | null {
  const t = (snap as { anonConfig?: { tree?: unknown } | null } | null)?.anonConfig?.tree;
  return typeof t === "string" ? t : null;
}
/** the plain tree's member count in the last check (leafVerdict already proved the list readable) */
function crowdSize(snap: unknown): number {
  const m = (snap as { members?: { members?: unknown } | null } | null)?.members?.members;
  return Array.isArray(m) ? m.length : 0;
}

/** is `commitment` a leaf of the plain anon tree in `snap`? true / false, "unjudged" (another tree or universe, or no
 *  snapshot), or "unreadable" (the plain tree's snapshot, but its member list is not a list of strings) */
function leafVerdict(mode: "fixture" | "live", snap: unknown, commitment: string): boolean | "unjudged" | "unreadable" {
  if (!snap || typeof snap !== "object") return "unjudged";
  const s = snap as { mode?: unknown; tree?: unknown; members?: { members?: unknown } | null };
  if (s.mode !== mode || s.tree !== plainAnonTreeName()) return "unjudged";
  const members = s.members && typeof s.members === "object" ? s.members.members : undefined;
  if (!Array.isArray(members) || !members.every((m) => typeof m === "string")) return "unreadable";
  return (members as string[]).includes(commitment);
}

/**
 * PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE) — a root that is not a leaf: say WHEN it can post, or why it cannot. With a
 * join known (the route registered it): before its first window starts → the join sentence with that window's clock time
 * (code "crowd", availableFrom); the window has started but the last check predates it → "checking" (the route runs a
 * fresh check); a check from that window still does not list it → not in the crowd. A failed join → said. No join known →
 * not in the crowd (the composer's full read joins it).
 */
function notInCrowd(o: { snap?: unknown; join?: AnonJoinState | null; now?: number; timeText?: (startsAt: number, now: number) => string }, tree: string): AnonAvailability {
  const j = o.join;
  const snapEpoch = snapEpochOf(o.snap);
  if (j && j.registered === true && typeof j.activeFromEpoch === "number" && Number.isInteger(j.activeFromEpoch)) {
    const now = typeof o.now === "number" ? o.now : Date.now();
    const startsAt = epochStartMs(o.snap, j.activeFromEpoch);
    if (startsAt === null) return off("now", ANON_JOINED_NEXT_WINDOW, "joined " + tree + " from window " + j.activeFromEpoch + "; the last check's epoch timing could not be read", "crowd");
    if (startsAt > now) {
      const when = (o.timeText ?? joinTimeText)(startsAt, now);
      const sentence = anonJoinSentence({ when, hours: windowHoursOf(o.snap), floor: anonFloorHere(), crowd: crowdSize(o.snap) });
      return { ...off("now", sentence, "joined " + tree + "; a leaf from window " + j.activeFromEpoch + " (the validator batches new members to the next window)", "crowd"), availableFrom: startsAt };
    }
    if (snapEpoch !== null && snapEpoch < j.activeFromEpoch) return off("now", ANON_CHECKING, "joined " + tree + " from window " + j.activeFromEpoch + ", which has started; the last check read window " + snapEpoch, "checking");
    return off("now", ANON_NOT_IN_CROWD, "joined " + tree + " from window " + j.activeFromEpoch + ", but the check of window " + snapEpoch + " does not list this root's commitment (revoked, or refused by the validator)", "crowd");
  }
  if (j && typeof j.error === "string" && j.error) return off("now", ANON_JOIN_FAILED, "joining " + tree + " failed: " + j.error, "crowd");
  return off("now", ANON_NOT_IN_CROWD, "this root's commitment is not a leaf of " + tree + " in the last check, and no join is known in this tab yet", "crowd");
}

/**
 * PUBLIC GO-LIVE — the LIVE twin of notInCrowd: a root that is not a leaf of the live public tree joins it with a verified
 * Sign in with Farcaster (lib/zk/anon/fcJoin.ts → the validator's fid gate), so the sentences say that, and `join` is the
 * fid join this tab knows (registered = the validator took it, activeFromEpoch = the window it becomes a leaf).
 */
function notInLiveCrowd(o: { snap?: unknown; join?: AnonJoinState | null; now?: number; timeText?: (startsAt: number, now: number) => string; signedIn?: boolean }, tree: string): AnonAvailability {
  const j = o.join;
  const snapEpoch = snapEpochOf(o.snap);
  if (j && j.registered === true && typeof j.activeFromEpoch === "number" && Number.isInteger(j.activeFromEpoch)) {
    const now = typeof o.now === "number" ? o.now : Date.now();
    const startsAt = epochStartMs(o.snap, j.activeFromEpoch);
    if (startsAt === null) return off("now", ANON_LIVE_JOINED_NEXT_WINDOW, "joined " + tree + " with Farcaster from window " + j.activeFromEpoch + "; the last check's epoch timing could not be read", "crowd");
    if (startsAt > now) {
      const when = (o.timeText ?? joinTimeText)(startsAt, now);
      const sentence = anonLiveJoinSentence({ when, hours: windowHoursOf(o.snap), floor: anonFloorHere(), crowd: crowdSize(o.snap) });
      return { ...off("now", sentence, "joined " + tree + " with Farcaster; a leaf from window " + j.activeFromEpoch + " (the validator batches new members to the next window)", "crowd"), availableFrom: startsAt };
    }
    if (snapEpoch !== null && snapEpoch < j.activeFromEpoch) return off("now", ANON_CHECKING, "joined " + tree + " with Farcaster from window " + j.activeFromEpoch + ", which has started; the last check read window " + snapEpoch, "checking");
    return off("now", ANON_LIVE_NOT_LISTED, "joined " + tree + " with Farcaster from window " + j.activeFromEpoch + ", but the check of window " + snapEpoch + " does not list this root's commitment", "crowd");
  }
  if (j && typeof j.error === "string" && j.error) return off("now", ANON_LIVE_JOIN_FAILED, "joining " + tree + " with Farcaster failed: " + j.error, "crowd");
  if (o.signedIn === true) return off("now", ANON_LIVE_MAYBE_JOINED, "not a leaf of the live " + tree + ", no Farcaster join is known in this tab, and this identity is signed in with Farcaster (an earlier sign-in may have joined: its outcome is memory only)", "crowd");
  return off("now", ANON_LIVE_SIGN_IN_FIRST, "this root's commitment is not a leaf of the live " + tree + " (one per Farcaster account), and no Farcaster join is known in this tab", "crowd");
}
/** PUBLIC GO-LIVE: did the last tick's LIVE config say the relay is armed? (the snapshot is the live universe's) */
function liveRelayIn(snap: unknown): boolean {
  const s = snap as { mode?: unknown; anonConfig?: { liveRelay?: unknown } | null } | null;
  return !!s && s.mode === "live" && !!s.anonConfig && s.anonConfig.liveRelay === true;
}

export function anonPostingAvailability(o: {
  mode: "fixture" | "live";
  snap?: unknown;
  commitment?: string | null;
  /** PERSONA LAUNCH GO-LIVE: what the composer's route knows about this tab joining the crowd (undefined: nothing yet) */
  join?: AnonJoinState | null;
  /** PERSONA LAUNCH GO-LIVE (tests): the clock and the time formatter */
  now?: number;
  timeText?: (startsAt: number, now: number) => string;
  /** PUBLIC GO-LIVE: the last tick's live config said liveRelay: true (a caller with no `snap` passes it from its own) */
  liveRelay?: boolean;
  /** PUBLIC GO-LIVE (onboard F2): this identity has a Farcaster sign-in that is not disconnected */
  signedIn?: boolean;
}): AnonAvailability {
  try {
    const mode = o?.mode;
    if (mode !== "fixture" && mode !== "live") return off("deployment", ANON_OFF_UNREADABLE, "the proof universe is neither fixture nor live", "unreadable");
    const sw = switchValue();
    if (sw === "off") return off("deployment", ANON_OFF_SWITCH, "the deployment's anonymous-posting switch (ZK_ANON_POST) is off", "switch");
    if (sw === "bad") return off("deployment", ANON_OFF_UNREADABLE, "ZK_ANON_POST has a value that is neither on nor off", "unreadable");

    if (typeof window !== "undefined") {
      // THE BROWSER DEVICE — the rep binding is never asked (the device does not run the server's rep switch)
      // PERSONA LAUNCH GO-LIVE: a garbled tree name (deviceEnv forwards "invalid") is off, said plainly — never a
      // "checking" that no check could ever end
      if (!isPlainTreeName(plainAnonTreeName())) return off("deployment", ANON_OFF_UNREADABLE, "this site's anonymous tree (ZK_ANON_POST_TREE) is not a tree name", "unreadable");
      // PUBLIC GO-LIVE: the ARMED live universe is judged FIRST — on only when the app hinted it (ZK_ANON_UNIVERSE=live) AND
      // the last tick saw the relay armed (liveRelay true). Every other live case falls through to the refusal below, kept
      // byte for byte (unarmed behaviour is today's; scripts/unit-prover.mjs V1 mutates that block by its first lines)
      if (mode === "live" && liveUniverseHinted()) {
        const asked = Object.prototype.hasOwnProperty.call(o, "snap");
        // hinted, no check yet: unknown is "checking", never yes (UXH-2) — the first check says armed or not
        if (asked && (o.snap === undefined || o.snap === null)) return off("now", ANON_CHECKING, "no check has run in this tab yet, so whether the public relay is armed and this browser is in the live crowd isn't known", "checking");
      }
      if (mode === "live" && liveUniverseHinted() && (o.liveRelay === true || liveRelayIn(o.snap))) {
        const asked = Object.prototype.hasOwnProperty.call(o, "snap");
        if (asked) {
          if (typeof o.commitment !== "string" || !o.commitment) return off("now", ANON_CHECKING, "this browser's identity couldn't be read yet, so whether it is in the live crowd isn't known", "checking");
          const served = servedPlainTree(o.snap);
          if (served !== null && served !== plainAnonTreeName()) return off("deployment", ANON_OFF_TREE_MISMATCH, "this site proves " + plainAnonTreeName() + " and its validator accepts " + served + " (ZK_ANON_POST_TREE differs between the two services)", "mismatch");
          const v = leafVerdict(mode, o.snap, o.commitment);
          if (v === "unjudged") return off("now", ANON_CHECKING, "the last check read another tree or universe, so whether this browser is in the live crowd of " + plainAnonTreeName() + " isn't known", "checking");
          if (v === "unreadable") return off("now", ANON_OFF_UNREADABLE, "the last check's member list for the live " + plainAnonTreeName() + " could not be read", "unreadable");
          if (v === false) return notInLiveCrowd(o, plainAnonTreeName());
          const crowd = crowdSize(o.snap);
          const floor = anonFloorHere();
          if (crowd < floor) return off("now", anonLiveFloorSentence(floor, crowd), "the live " + plainAnonTreeName() + " has " + crowd + " members in the last check, under the client's floor " + floor, "crowd");
        }
        return { on: true, previewOnly: false, scope: null, reason: null, detail: "live: proved in this tab, sent over the anonymous channel, relayed to Farcaster by the validator's @anon account at its next slot", code: null };
      }
      if (mode === "live") {
        return off(
          "deployment",
          publicLiveHere() ? ANON_OFF_LIVE_RELAY_OFF : ANON_OFF_BROWSER_LIVE,
          "a browser on this site may post anonymously only in the test universe; posting through @anon to Farcaster from a browser needs the public anonymous account, a later step",
          "browser-live"
        );
      }
      // PUBLIC GO-LIVE: a live product (onboard's PUBLIC_LIVE) posts no test data — the test universe is off in its tabs
      if (publicLiveHere()) return off("deployment", ANON_OFF_LIVE_PRODUCT_TEST, "this site runs as a live product (PUBLIC_LIVE) and its anonymous relay is not live, so the test universe is not offered", "browser-live");
      // UXH-2: the per-root judgement, when the caller asks for it (it passed `snap`, even null) — unknown is off, never on
      if (Object.prototype.hasOwnProperty.call(o, "snap")) {
        if (typeof o.commitment !== "string" || !o.commitment) return off("now", ANON_CHECKING, "this browser's identity couldn't be read yet, so whether it is in the crowd isn't known", "checking");
        if (o.snap === undefined || o.snap === null) return off("now", ANON_CHECKING, "no check has run in this tab yet, so whether this browser is in the crowd of " + plainAnonTreeName() + " isn't known", "checking");
        // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the validator's plain tree must be this tab's (a proof into another
        // tree is refused there); unread this tick = not judged here (the route's own read says so, as it does for K)
        const served = servedPlainTree(o.snap);
        if (served !== null && served !== plainAnonTreeName()) return off("deployment", ANON_OFF_TREE_MISMATCH, "this site proves " + plainAnonTreeName() + " and its validator accepts " + served + " (ZK_ANON_POST_TREE differs between the two services)", "mismatch");
        const v = leafVerdict(mode, o.snap, o.commitment);
        if (v === "unjudged") return off("now", ANON_CHECKING, "the last check read another tree or universe, so whether this browser is in the crowd of " + plainAnonTreeName() + " isn't known", "checking");
        if (v === "unreadable") return off("now", ANON_OFF_UNREADABLE, "the last check's member list for " + plainAnonTreeName() + " could not be read", "unreadable");
        if (v === false) return notInCrowd(o, plainAnonTreeName());
        // PERSONA LAUNCH GO-LIVE: a leaf — and the crowd at or over the client's floor, or the cohort stage would refuse
        const crowd = crowdSize(o.snap);
        const floor = anonFloorHere();
        if (crowd < floor) return off("now", anonFloorSentence(floor, crowd), plainAnonTreeName() + " has " + crowd + " members in the last check, under the client's floor " + floor, "crowd");
      }
      return { on: true, previewOnly: true, scope: null, reason: null, detail: "test universe: an anonymous post made here stays inside this preview and never reaches Farcaster", code: null };
    }

    // A SERVER-SIDE DEVICE
    if (isPublicDeployment()) return off("deployment", ANON_OFF_PUBLIC_SERVER, "a public deployment's server holds no identity; the visitor's browser device does the posting", "public-server");
    if (sw === "on") return { on: true, previewOnly: false, scope: null, reason: null, detail: "switched on for this server (ZK_ANON_POST=on)", code: null };
    const rep = currentRepImpl();
    if (rep !== "zk") return off("deployment", ANON_OFF_SERVER, "the reputation binding is not the proof layer", "server");
    return { on: true, previewOnly: false, scope: null, reason: null, detail: "the reputation binding is the proof layer", code: null };
  } catch (e) {
    // never fail open: whatever could not be read leaves anonymous posting off, and says why
    return off("deployment", ANON_OFF_UNREADABLE, (e as Error)?.message ?? String(e), "unreadable");
  }
}
