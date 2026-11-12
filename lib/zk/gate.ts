import "server-only";
import { attestTreeName, validBucket, validIssuer } from "@/lib/attest/ids";
import { isHonoredIssuer } from "@/lib/attest/subscriber";
import { clearProvenAttestations, refreshProvenAttestations } from "@/lib/attest/proven";
import { clearsOnboarding } from "@/lib/attest/onboarding";
// ZK PASS 1 Gate 2 — THE FIRST FEATURE: the tier-threshold membership gate
// on ONE discovery surface (For You candidate eligibility).
//
// A persona appears as a candidate on other viewers' For You only if it is
// ELIGIBLE. Under ADAPTER_REP=zk, eligibility is proof-mediated: the
// persona (at idle, off any action path) proved "my root is in
// zkTier[T]" over the anonymous channel, the validator verified it and
// marked the persona eligible for this epoch. The feed reads that mark —
// never a root-side tier lookup.
//
// THE FALLBACK IS EXPLICIT CONFIG, NEVER AN AUTO-DOWNGRADE:
//   ZK_GATE_FALLBACK=none    → unproven personas are NOT eligible (proof-only)
//   ZK_GATE_FALLBACK=policy  → unproven personas fall back to the legacy
//                              tier policy (seed/validator tier ≥ 2)
// The README and the label say what `policy` costs: the effective
// anonymity set is partitioned to "personas that took the ZK path this
// epoch" — a non-prover is identifiable as one by its absence.
import { currentRepImpl } from "@/lib/adapters/registry";
import { ZK_ANON_POST_MAX_CHARS, ZK_ANON_POST_SLOTS, ZK_ANON_POST_TREE, ZK_ANON_POST_WINDOW_EPOCHS, ZK_GATE_TIER, ZK_JITTER_MAX_MS, ZK_REACH_FLOOR, ZK_X_ANON_POST_SLOTS, setZkModeOverride, zkMode } from "./config";
import { heldReachTrees } from "@/lib/reach/held";
import { csprngIndex, pickFreeSlot, pickFreeXSlot, relayCapReason, windowFull, windowFullSentence, xWindowFull, xWindowFullSentence } from "./anon/slots";
import { createHash, randomBytes } from "@/lib/platform/crypto";
import { fetchEligibilityMap } from "./validatorClient";
import type { ClaimKind } from "./transport/types";
import { anonEpochEdge } from "./anon/epochEdge";
import { noteAnonOutcome, noteXOutcome } from "./anon/outcomes";
import { relayAccountVerdict, relayJoinRefusesPosting } from "./anon/relayAccount";
import { anonFilterRefusal, checkAnonText } from "./anon/textCheck";

export const GATE_ID = "foryou";
export const gateTree = () => `tier-${ZK_GATE_TIER}`;

export type GateFallback = "none" | "policy";
const envFallback: GateFallback = process.env.ZK_GATE_FALLBACK === "policy" ? "policy" : "none";
const g = globalThis as unknown as { __layersGateFallbackOverride?: GateFallback | null; __layersGateAttempts?: GateAttempt[] };
export function setGateFallbackOverride(v: GateFallback | null): void {
  g.__layersGateFallbackOverride = v;
}
export function gateFallback(): GateFallback {
  return g.__layersGateFallbackOverride ?? envFallback;
}

export interface DiscoveryGate {
  active: true;
  epochTiers: Record<string, number>;
  fallback: GateFallback;
  /** eligible to appear as a discovery candidate for OTHER viewers */
  isEligible(authorPersonaId: string, legacyTier: number): boolean;
  provenTier(authorPersonaId: string): number;
  /** Attestation pass Gate 3: "<issuer>/<bucket>" this author PROVED this epoch */
  provenAttestations(authorPersonaId: string): string[];
}

/**
 * One fetch per feed build. Returns null when the rep binding is not zk —
 * the legacy path is then byte-for-byte what it was. Fails CLOSED when the
 * validator is unreachable: no eligibility is known, so under `none`
 * nothing unproven shows (and under `policy`, the legacy policy applies).
 */
export async function discoveryEligibility(): Promise<DiscoveryGate | null> {
  if (currentRepImpl() !== "zk") {
    clearProvenAttestations(); // no proofs under any other binding: an attestation predicate matches nothing
    return null;
  }
  let epochTiers: Record<string, number> = {};
  try {
    epochTiers = await fetchEligibilityMap(zkMode(), GATE_ID);
  } catch {
    epochTiers = {};
  }
  // Attestation pass Gate 3: the proven-attestation map, one gated read per build (fail-closed: empty on error)
  const proven = await refreshProvenAttestations(zkMode());
  const fallback = gateFallback();
  return {
    active: true,
    epochTiers,
    fallback,
    provenTier: (author) => epochTiers[author] ?? 0,
    provenAttestations: (author) => proven[author] ?? [],
    isEligible(author, legacyTier) {
      if ((epochTiers[author] ?? 0) >= ZK_GATE_TIER) return true;
      // MULTI-FID Gate 0: OR-gate onboarding — one PROVEN strong signal clears the gate below the tier
      if (clearsOnboarding(proven[author] ?? []).clears) return true;
      if (fallback === "policy") return legacyTier >= 2; // the legacy rule: tier-1 is filtered
      return false;
    },
  };
}

// ---------- precompute at idle ----------
export interface GateAttempt {
  personaId: string;
  at: number;
  ok: boolean;
  /** Gate 3: which claim this attempt proved (tier-membership when absent) */
  claimKind?: ClaimKind;
  stage?: string;
  reason?: string;
  queuedId?: string;
  epoch?: number;
  /** true when nothing was done because this persona already has a
   * queued or accepted submission for the current epoch */
  skipped?: boolean;
}

/** personas whose eligibility the product WANTS this epoch — proved on
 * the next prefetch tick, never at render time (Pass 2 Gate 0). Gate 3:
 * each entry names the CLAIM to prove (tier-membership by default; a fork
 * continuity claim or an attestation claim otherwise). */
interface WantedClaim {
  motivatedAt: number;
  claimKind: ClaimKind;
  tree: string;
  gateId: string;
  forkCommit?: string;
  issuer?: string;
  bucket?: string;
  /** MULTI-FID Gate 4: anon-post — the bound cast hash and the text the envelope carries */
  castHash?: string;
  text?: string;
  /** the per-post salt the payload carries (MULTI-FID Gate 5) */
  nonce?: string;
  /** the reveal-later commitment this post's message binds (MULTI-FID PASS — anon attribution) */
  attributionCommitment?: string;
  /** PERSONA LAUNCH P4 (R8): the 256-byte ring note (512 hex) the payload carries, and sha256 over its raw bytes, which
   * the message binds. Real (sealed for the rings that see this persona) or random — the same size either way. */
  note?: string;
  noteHash?: string;
  /** PERSONA LAUNCH P6: a launch request — the commitment the message binds and the request the payload carries */
  launchCommit?: string;
  request?: string;
  /** PERSONA LAUNCH P8: an X copy — its hash (the message binds x:<xHash>), the persona it is sent AS and the Farcaster
   * anon post it repeats (both device-local: they ride only the sealed X record, never the envelope) */
  xHash?: string;
  xPersonaId?: string;
  copyOf?: string;
  /** dev hooks only: a rig bypasses the client's once-per-window refusal to watch the VALIDATOR refuse */
  force?: boolean;
  /** ANON REVIEW (A2-2): proof attempts so far — an anon post stays wanted through retryable refusals */
  attempts?: number;
}
const wanted = new Map<string, WantedClaim>();
/** ANON REVIEW (A2-2): how many ticks an anon post stays wanted through retryable refusals before it is dropped
 * (the default spans a day of 10-minute ticks — longer than any epoch wait; a redeploy forgets it anyway) */
export const ZK_ANON_WANTED_MAX_TICKS = Math.max(1, Math.min(10_000, Number(process.env.ZK_ANON_WANTED_MAX_TICKS ?? 150) || 150));
/** the prove stages after which retrying is pointless: malformed inputs, a persona that is not ours */
const ANON_TERMINAL_STAGES = new Set(["persona", "scope"]);
/** PERSONA LAUNCH P5: "bad-tree" — not a tree an anon post may prove at all (400); "reach" — a reach tier this person
 * may not boost with right now (not held, not honoured or not accepted here, or under the crowd floor; 409) */
export type AnonRefusalCode = "unavailable" | "bad-text" | "window" | "relay" | "full" | "persona" | "post-mode" | "replayed" | "relay-cap" | "bad-tree" | "reach" | "launch" | "filter";
/** PERSONA LAUNCH P3 (PRIV-1): the refusal for words that already came back as a replay — plain, and why */
export const REPLAYED_WORDS_SENTENCE =
  "You already sent these exact words anonymously, and the validator answered that their slot was already used, so they may be posted already. Sending the same words again could post them twice or let the validator link your posts, so this one wasn't sent. Write it differently to post again.";
/** PERSONA LAUNCH wave 3 (L7): the refusal for words the validator already received and refused — plain, and why */
export const REFUSED_WORDS_SENTENCE =
  "You already sent these exact words anonymously and the validator refused them, so it has seen them. Sending the same words again would let it link the two, so this one wasn't sent. Write it differently to post again.";
/**
 * PERSONA LAUNCH P6 (UX-L1) — A POST MADE WHILE ITS PERSONA'S LAUNCH IS UNDER WAY IS REVEALED WITH THE REST. The launch's
 * batch reveal (lib/launch/tick.ts, the "registered" step) reads EVERY reveal secret of the persona at that moment
 * (lib/zk/anon/queue.ts attributionSecretsFor filters by persona and mode, not by when the post was made), and posting is
 * deliberately not paused during a launch (lib/identity/postMode.ts). So from the confirm until that batch lands — the
 * stages lib/launch/confirm.ts launchUnderWay calls "under way" — an anon post by the persona is NOT "attributed to no
 * one": it becomes public as the persona's. These are the words for that, said the same way by the composer's line
 * (GET /api/anon postAs.launchNotice), the 202's note and the refusal below.
 */
export function launchRevealSentence(handle: string | null): string {
  const who = "@" + (handle ?? "this persona");
  return `${who} is being launched, so this post will become public as ${who}'s, with every other anonymous post ${who} made, shortly after its account appears.`;
}
/** UX-L1: the line the owner saw no longer holds — said in plain words; nothing was minted or sent */
export function launchChangedSentence(handle: string | null, pendingNow: boolean): string {
  const who = "@" + (handle ?? "this persona");
  return pendingNow
    ? `${launchRevealSentence(handle)} Nothing was sent. Post again if that is what you want.`
    : `${who} isn't waiting for a launch to reveal its posts any more, so this post would stay anonymous. Nothing was sent. Post again to send it.`;
}
/** MULTI-FID Gate 4 */
export const ANON_GATE_ID = "anon-post";
export const anonPostTree = () => ZK_ANON_POST_TREE;
/** MULTI-FID Gate 5 (attack-fid-2 #7): salted with a per-post nonce — two identical texts are two posts, on the row and on the wire */
export function anonCastHash(text: string, nonce: string): string {
  return createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex");
}
export interface AnonPostRequestResult {
  ok: boolean;
  castHash?: string;
  reason?: string;
  /** ANON REVIEW: which refusal, so the route maps it to a status and the composer to plain words */
  code?: AnonRefusalCode;
  window?: string;
  tree?: string;
  /** the public commitment this post can later be revealed against (MULTI-FID PASS — anon attribution) */
  attributionCommitment?: string;
  /** compose-time warnings about the text (R1-06): other people's @mentions, links */
  warnings?: string[];
  /** PERSONA LAUNCH P6 (UX-L1): the persona's launch is under way — this post will be revealed with its other anon posts */
  launchPending?: boolean;
}

/** every handle and Farcaster fname this device knows as its own: the keystore personas and the persona↔fid map
 * (the map is a vault record every profile render already reads, so reading it here carries no anon signal);
 * a map that cannot be read is a refusal to post, never a silent pass (R1-06) */
async function ownAccountNames(): Promise<string[]> {
  const names: string[] = [];
  const { listPersonas } = await import("@/lib/identity/keystore");
  for (const p of listPersonas()) if (p.handle) names.push(p.handle);
  const { personaFidMap } = await import("@/lib/fc/personaFid");
  for (const v of Object.values(await personaFidMap())) if (v.fname) names.push(v.fname);
  return names;
}

/** MULTI-FID Gate 4: the anon composer's trigger — NO request and NO proof leave here. The text is
 * held in the wanted set; the next prefetch tick proves the ROOT's membership in the anon gate tree
 * under a message that binds sha256(text), and the drain sends it over the anonymous channel at a
 * jittered time. PERSONA LAUNCH P3 (D4): K anon posts per PERSON per window, shared across the person's personas
 * (one nullifier per (window, slot); the slot is assigned at the tick): the (K+1)th is refused HERE, before any proof
 * (the validator's nullifier store refuses a re-used slot too). The post is made AS a persona (opts.personaId), which
 * only the sealed reveal record keeps.
 *
 * ANON REVIEW — the order of the refusals is the fix (R1-01 / R3-07): every refusal runs BEFORE the reveal secret is
 * minted, and the mint is in memory only (lib/zk/anonAttribution.ts) — no write of any kind leaves at compose time. */
/** PERSONA LAUNCH P5 — the inputs of the reach offer, from the LAST TICK's snapshot and the held cache only (no read of
 * any kind): the census sizes (never clearsFloor), the trees this root holds an active issuance for, the client's reach
 * floor, and the issuers that are both honoured BY KEY here (the registry key read on that tick) and accepted for anon
 * posts by the validator (its served reachIssuers — a validator that serves none accepts none: nothing is offered).
 * The composer route, the reach route and the compose gate all judge from this one function. */
export function reachOfferInputFor(mode: "fixture" | "live", snap: import("./prefetch").PrefetchSnapshot | null): import("@/lib/reach/trees").OfferInput & { plainSize: number | null } {
  const census = snap && !snap.bucketsError ? snap.buckets.map((b) => ({ tree: b.tree, size: b.size })) : null;
  const served = snap?.anonConfig?.reachIssuers;
  const keyOf = new Map((snap?.issuers ?? []).map((i) => [i.id, i.pubkey]));
  const issuers = (Array.isArray(served) ? served : []).filter((id) => typeof id === "string" && isHonoredIssuer(id, keyOf.get(id) ?? null));
  // PERSONA LAUNCH wave 3 (L3): the plain anon tree's size ON THE SAME TICK as the census (lib/zk/prefetch.ts stamps it) —
  // the BAND rule's bottom rung: a reach tier is offered only while the posts it leaves below it (in the next tier down,
  // and in the plain tree) still come from at least the floor. Not read on that tick (or another epoch's) = null, and the
  // offer then offers nothing (fail toward less)
  const p = snap?.plainSize ?? null;
  const plainSize = p && snap && p.tree === anonPostTree() && p.epoch === snap.epoch?.epoch && Number.isInteger(p.size) && p.size >= 0 ? p.size : null;
  const input: import("@/lib/reach/trees").OfferInput & { plainSize: number | null } = { census, held: heldReachTrees(mode, snap?.epoch?.epoch), floor: ZK_REACH_FLOOR, plainTree: anonPostTree(), issuers, plainSize };
  return input;
}

export async function requestAnonPost(text: string, opts: { force?: boolean; motivatedAt?: number; personaId: string | null; tree?: string; launchPending?: boolean; postAs?: "root" }): Promise<AnonPostRequestResult> {
  // PERSONA LAUNCH P7 (the prover's seam, landed by xout): availability no longer depends on ADAPTER_REP=zk for the whole
  // site — lib/zk/anon/availability.ts decides (no snapshot, no membership at this call: the tick refuses a non-leaf)
  // PUBLIC GO-LIVE: and, for the live universe in a tab, whether the LAST TICK saw the public relay armed (liveRelay from the
  // snapshot this device already holds — nothing is fetched here)
  {
    const { anonPostingAvailability } = await import("./anon/availability");
    const { cachedSnapshot: lastSnap } = await import("./prefetch");
    const av = anonPostingAvailability({ mode: zkMode(), liveRelay: lastSnap(zkMode())?.anonConfig?.liveRelay === true });
    if (!av.on) return { ok: false, code: "unavailable", reason: av.reason ?? "anonymous posting is off here — refusing (fail closed)" };
  }
  // PUBLIC GO-LIVE — A ROOT-LEVEL POST (the /anon page, postAs "root"): made by this root with no persona at all. It skips
  // the persona and launch checks (there is no persona to check or launch); everything else below is the same, and its
  // reveal secret is kept with personaId null (lib/zk/anon/queue.ts AttributionRecord), so it can still be revealed later.
  const rootPost = opts.postAs === "root";
  if (rootPost && opts.personaId !== null && opts.personaId !== undefined) return { ok: false, code: "persona", reason: "A post made as yourself names no persona." };
  // PERSONA LAUNCH P3: the post is made AS one of this root's personas (it stays anonymous: the persona rides only the
  // sealed reveal record, lib/zk/anonAttribution.ts). Refused — before any secret is minted, before any write — when the
  // persona is not this device's own, is the read-only public self, is private, or is set to post in Totem only.
  const personaId = typeof opts.personaId === "string" ? opts.personaId : "";
  if (!rootPost) {
    const { anonPersonaRefusal } = await import("@/lib/identity/postMode");
    let refusal: Awaited<ReturnType<typeof anonPersonaRefusal>>;
    try {
      refusal = await anonPersonaRefusal(personaId);
    } catch (e) {
      return { ok: false, code: "unavailable", reason: "couldn't check this persona (" + (e as Error).message + ") — refusing rather than posting unchecked" };
    }
    if (refusal) return { ok: false, code: refusal.code, reason: refusal.message };
  }
  // PERSONA LAUNCH P6 (UX-L1) — THE LINE IS BOUND TO THE CLICK (the PUB-1 pattern). `opts.launchPending` is what the
  // composer's line SAID about a launch of this persona (absent = it said nothing: "attributed to no one"). A launch under
  // way NOW reveals this post with the rest (launchRevealSentence), so the two must agree, or nothing is minted and the
  // owner is told in plain words what the post would really do — a launch confirmed in another tab after this composer
  // read its line is exactly the case. Unreadable launch state is a refusal, never "no launch" (never fail open).
  // `force` (a rig) does not bypass it.
  let launchPending = false;
  // PUBLIC GO-LIVE: a root-level post has no persona to launch — and saying a launch is pending for it is refused
  if (rootPost && opts.launchPending === true) return { ok: false, code: "launch", reason: "A post made as yourself is never part of a persona's launch." };
  if (!rootPost) {
    const { launchUnderWay } = await import("@/lib/launch/confirm");
    const { handleOfPersona } = await import("@/lib/identity/postMode");
    try {
      launchPending = (await launchUnderWay(personaId)) === true;
    } catch (e) {
      return { ok: false, code: "unavailable", reason: "couldn't check whether this persona is being launched (" + (e as Error).message + ") — refusing rather than posting unchecked" };
    }
    if (launchPending !== (opts.launchPending === true)) return { ok: false, code: "launch", reason: launchChangedSentence(handleOfPersona(personaId), launchPending) };
  }
  const mode = zkMode();
  // MULTI-FID Gate 5 (attack-fid-3 #5): on the LIVE universe a relay is a real write — armed like every other
  // PUBLIC GO-LIVE: on a SERVER-SIDE device (the owner service, the rig). In the visitor's tab the relay is the validator's
  // write, not the tab's: it is armed there (ZK_ANON_RELAY_LIVE + the agent account), and availability above already
  // required the app's hint AND the last tick's liveRelay: true before anything reached this line.
  if (mode === "live" && typeof window === "undefined") {
    const { writeEnabled } = await import("@/lib/adapters/neynar/mode");
    if (!writeEnabled()) return { ok: false, code: "unavailable", reason: "anon posting on the live universe needs ENABLE_FC_WRITE=true — a real relay is a real write" };
  }
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return { ok: false, code: "bad-text", reason: "text required" };
  if (t.length > ZK_ANON_POST_MAX_CHARS) return { ok: false, code: "bad-text", reason: `anon posts are at most ${ZK_ANON_POST_MAX_CHARS} characters` };
  // R1-06: a mention of one of your own accounts is a public edge from the anonymous account — refused; other
  // mentions and links are warned about (the composer status line shows the warnings)
  let names: string[];
  try {
    names = await ownAccountNames();
  } catch (e) {
    return { ok: false, code: "unavailable", reason: "cannot check the text against your own account names (" + (e as Error).message + ") — refusing rather than posting unchecked" };
  }
  const tc = checkAnonText(t, names);
  if (!tc.ok) return { ok: false, code: "bad-text", reason: tc.reason };
  // PUBLIC GO-LIVE — THE AUTOMATIC TEXT FILTER, in this tab, before anything is minted (lib/zk/anon/textCheck.ts, the
  // DELIBERATE DUPLICATE of validator/anon-filter.js, which runs its own copy before it stores anything): slurs, phone
  // numbers, email and street addresses, scam links — refused in plain words, the words left in the box
  {
    const refusedBy = anonFilterRefusal(t);
    if (refusedBy) return { ok: false, code: "filter", reason: refusedBy.sentence };
  }
  // PERSONA LAUNCH P3 (PRIV-1): words that already came back as a REPLAY are never sent again — the validator holds them
  // under the earlier post's nullifier, so a fresh slot would publish a post it can tie to that one (or post it twice).
  // Device-local (the sealed queue in memory), BEFORE the budget check, the mint and any write; `force` (a rig) too.
  // PERSONA LAUNCH wave 3 (L7): and words the validator already RECEIVED AND REFUSED — it read them, so the same words
  // posted again would let it join the new post to that refused send (and its moment). A post that expired on this device
  // before it was sent, or never reached the channel, blocks nothing (lib/zk/anon/queue.ts anonWordsSeen).
  {
    const { anonWordsSeen } = await import("./anon/queue");
    let seen: Awaited<ReturnType<typeof anonWordsSeen>>;
    try {
      seen = await anonWordsSeen(t);
    } catch (e) {
      return { ok: false, code: "unavailable", reason: "couldn't check these words against your earlier anonymous posts (" + (e as Error).message + ") — refusing rather than posting unchecked" };
    }
    if (seen === "replay") return { ok: false, code: "replayed", reason: REPLAYED_WORDS_SENTENCE };
    if (seen === "refused") return { ok: false, code: "replayed", reason: REFUSED_WORDS_SENTENCE };
  }
  const { cachedSnapshot } = await import("./prefetch");
  const snap = cachedSnapshot(mode);
  // A2-6 (fail closed on the live universe): the relay account must be a key and a fid distinct from this app's —
  // judged from the LAST TICK's snapshot (nothing is fetched at compose time); a known join is refused here, an
  // unknown one (no snapshot yet) is left to the tick, which refuses it there
  if (mode === "live" && snap?.anonConfig) {
    const { ownIdentityFacts } = await import("./privacy");
    const v = relayAccountVerdict({ mode, liveRelay: snap.anonConfig.liveRelay, fid: snap.anonConfig.fid, relayKeyFingerprint: snap.anonConfig.relayKeyFingerprint ?? null }, await ownIdentityFacts());
    if (relayJoinRefusesPosting(v)) return { ok: false, code: "relay", reason: "the anon relay account is not distinct from this app (" + v.detail + ") — refusing to post through it" };
  }
  // PERSONA LAUNCH P3: the validator's K must be THIS client's K. The client never adopts a served K for its slot choice
  // (a validator serving one client a different K could tag that client's posts by their slot range); a mismatch makes
  // anon posting unavailable until the two agree. Judged from the last tick's snapshot (nothing fetched at compose time).
  const servedK = snap?.anonConfig?.slotsPerWindow;
  if (typeof servedK === "number" && servedK !== ZK_ANON_POST_SLOTS) {
    return { ok: false, code: "unavailable", reason: `anonymous posting is paused: the validator allows ${servedK} posts per window and this app allows ${ZK_ANON_POST_SLOTS} — they must agree` };
  }
  // PERSONA LAUNCH P5 (R6): THE TREE. None named = the plain anon tree (no boost). A reach tree is accepted only if the
  // picker would offer it right now — a known reach tree, honoured by key and accepted by the validator, held by this
  // root, and at or above the crowd floor in the LAST TICK's census — judged from the snapshot and the held cache, so
  // nothing is fetched here; refused BEFORE the secret is minted and before any write. `force` (a rig) does not bypass it.
  const tree = opts.tree === undefined || opts.tree === anonPostTree() ? anonPostTree() : opts.tree;
  {
    const { reachRefusal } = await import("@/lib/reach/trees");
    const bad = typeof tree === "string" ? reachRefusal(tree, reachOfferInputFor(mode, snap)) : { code: "bad-tree" as const, reason: "That isn't a reach tier an anonymous post can be boosted with." };
    if (bad) return { ok: false, code: bad.code, reason: bad.reason };
  }
  if (!opts.force) {
    // PERSONA LAUNCH P3 (D4): K posts per PERSON per window, shared across the person's personas — the slots already
    // spent this window (queued or accepted, any persona) plus the posts still waiting for their proof (a slot each,
    // assigned at the tick). The (K+1)th is refused HERE, before the secret is minted and before any write.
    let waiting = 0;
    for (const [k] of wanted) if (k.startsWith(ANON_PERSONA_KEY + "|")) waiting++;
    const { anonSlotsUsed, anonPostsAhead } = await import("./anon/queue");
    const used = snap ? (await anonSlotsUsed(snap.mode, snap.epoch.epoch)).size : 0;
    if (windowFull(used + waiting, ZK_ANON_POST_SLOTS)) return { ok: false, code: "window", reason: windowFullSentence(ZK_ANON_POST_SLOTS, anonWindowHours(snap)) };
    // PERSONA LAUNCH P3 (UX-2): the RELAY's own budget — the anonymous account's lifetime live cap (the owner service:
    // 1 until its first live cast was checked) and the global daily cap — judged from the LAST TICK's signed config (no
    // fetch at compose time) plus this device's posts the validator has not counted yet. Reached: refused HERE, with
    // the words still in the box, instead of a 202 that clears them and a validator refusal minutes later.
    if (snap?.anonConfig) {
      const ahead = waiting + (await anonPostsAhead(snap.mode, snap.fetchedAt));
      const capReason = relayCapReason(mode, snap.anonConfig, ahead);
      if (capReason) return { ok: false, code: "relay-cap", reason: capReason.charAt(0).toUpperCase() + capReason.slice(1) + "." };
    }
  }
  if (wanted.size >= 50) return { ok: false, code: "full", reason: "the wanted set is full — try again next tick" };
  const nonce = (await import("node:crypto")).randomBytes(16).toString("hex");
  const castHash = anonCastHash(t, nonce);
  const key = ANON_PERSONA_KEY + "|" + castHash;
  // PERSONA LAUNCH P4 (R8) — THE RING NOTE, read BEFORE the mint (every refusal stays before it, R1-01): 256 bytes, a
  // note sealed for the rings that see this persona at depth posts, or 256 random bytes — the same size either way, so
  // the operator cannot tell which posts have an audience. Device-local (lib/rings/note.ts): no fetch, no write. Its hash
  // is bound into the proof's message beside attr:, so nobody can swap one post's note for another's.
  let note: string;
  try {
    // PUBLIC GO-LIVE: a root-level post belongs to no ring (no persona): a random note of the same size, after a throwaway
    // seal (the work noteForPost does for a persona with no ring), so its timing and size say nothing either
    if (rootPost) {
      const rn = await import("@/lib/rings/note");
      rn.sealNote(randomBytes(32).toString("hex"), "0000000000000000", castHash);
      note = rn.randomNote();
    } else note = await (await import("@/lib/rings/note")).noteForPost(mode, personaId, castHash);
  } catch (e) {
    return { ok: false, code: "unavailable", reason: "couldn't read your rings (" + (e as Error).message + ") — refusing rather than posting without checking who may see it" };
  }
  if (typeof note !== "string" || !/^[0-9a-f]{512}$/.test(note)) {
    return { ok: false, code: "unavailable", reason: "the ring note for this post is not 256 bytes — refusing rather than posting a note of the wrong size" };
  }
  const noteHash = createHash("sha256").update(note, "hex").digest("hex");
  // the anoncast reveal pattern: mint this post's OWN secret now — in memory — before anything about the post leaves
  // this process; its commitment rides the proof's message, so it is bound to THIS cast forever and cannot be swapped
  // for a different one later, by the validator or anyone else. Persisted only with the queue's deferred write.
  // PERSONA LAUNCH P3: the record also keeps WHICH persona posted it — sealed, never on the envelope
  // PUBLIC GO-LIVE: a root-level post keeps its secret too, with personaId null (the record supports it; sealSecretForPost
  // requires a persona, so the two calls it makes are made here: the mint, then the in-memory record)
  let attributionCommitment: string;
  if (rootPost) {
    const { mintAttributionSecret } = await import("./anonAttribution");
    const { putAttributionRecord } = await import("./anon/queue");
    const minted = mintAttributionSecret();
    await putAttributionRecord({ mode, castHash, secret: minted.secret, commitment: minted.commitment, text: t, at: Date.now(), personaId: null });
    attributionCommitment = minted.commitment;
  } else {
    const { sealSecretForPost } = await import("./anonAttribution");
    attributionCommitment = (await sealSecretForPost(mode, castHash, t, personaId)).commitment;
  }
  // PERSONA LAUNCH P5: WantedClaim.tree is the CHOSEN tree; the tick proves from that tree's snapshot (extra[tree])
  wanted.set(key, { motivatedAt: opts.motivatedAt ?? Date.now(), claimKind: "anon-post", tree, gateId: ANON_GATE_ID, castHash, text: t, nonce, attributionCommitment, note, noteHash, force: !!opts.force, attempts: 0 });
  noteAnonOutcome(castHash, mode, { stage: "wanted", reason: null, lastStage: "wanted", warnings: tc.warnings });
  recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: true, claimKind: "anon-post", stage: "wanted", reason: "anon post marked for the next prefetch tick — nothing leaves at composer time" });
  void import("./prefetch").then(({ ensurePrefetchLoop }) => ensurePrefetchLoop());
  return { ok: true, castHash, tree, attributionCommitment, warnings: tc.warnings, launchPending };
}

/** ANON REVIEW (A2-2): what the tick does with an anon post it could not prove this time */
async function anonRefused(key: string, w: WantedClaim, mode: "fixture" | "live", stage: string, reason: string, terminal: boolean): Promise<void> {
  const castHash = w.castHash as string;
  const attempts = (w.attempts ?? 0) + 1;
  // PERSONA LAUNCH P7 (UXH-2, the prover's line): in a TAB a root outside the crowd does not become a leaf by retrying for
  // a day; the composer's route already refuses such a post up front (availability "crowd"/"checking"), so a tick that
  // still meets stage "membership" ends it now, in plain words, with the words handed back (memory only). A server-side
  // device keeps retrying: there registration joins the crowd from the next window.
  if (stage === "membership" && typeof window !== "undefined") {
    const { anonDroppedInTabSentence } = await import("./anon/availability");
    terminal = true;
    reason = anonDroppedInTabSentence(typeof w.text === "string" ? w.text : null);
  }
  if (!terminal && attempts < ZK_ANON_WANTED_MAX_TICKS) {
    wanted.set(key, { ...w, attempts }); // stays wanted: proved again from the next tick's snapshot
    noteAnonOutcome(castHash, mode, { stage: "retrying", lastStage: stage, reason, attempts });
    return;
  }
  // a post that will never be sent keeps no reveal secret (the orphan R3-02 named)
  const { deleteAttributionRecord } = await import("./anon/queue");
  await deleteAttributionRecord(castHash).catch(() => undefined);
  noteAnonOutcome(castHash, mode, { stage: "dropped", lastStage: stage, reason: terminal ? reason : `gave up after ${attempts} ticks — last refusal: ${reason}`, attempts });
}
const ANON_PERSONA_KEY = "anon";
const FORK_COMMIT_RE = /^[0-9a-f]{64}$/;
/** PERSONA LAUNCH P3: how long the anon window is, in hours, for the plain-words sentences (the snapshot's epoch length
 *  times the window's epochs; 6 when no snapshot has been read yet — the validator's default epoch) */
export function anonWindowHours(snap: { epoch: { epochMs: number } } | null | undefined): number {
  const ms = snap && Number.isFinite(snap.epoch?.epochMs) && snap.epoch.epochMs > 0 ? snap.epoch.epochMs : 6 * 3_600_000;
  return (ms * ZK_ANON_POST_WINDOW_EPOCHS) / 3_600_000;
}

function recordAttempt(a: GateAttempt): void {
  (g.__layersGateAttempts ??= []).push(a);
  if (g.__layersGateAttempts.length > 50) g.__layersGateAttempts.shift();
}

/**
 * The product trigger. It performs NO network request and NO proof: it
 * marks the persona wanted and makes sure the prefetch loop is running.
 * The next tick proves wanted personas from its own snapshot and queues
 * them with jitter — so every identified fetch and write lands on the
 * fixed schedule, never at the moment of the motivating render. Once per
 * (persona, epoch) is enforced at the tick (attack-1 finding 3).
 */
export function requestEligibility(personaId: string, motivatedAt = Date.now()): void {
  if (!/^[A-Za-z0-9_]{1,80}$/.test(personaId)) return;
  if (!wanted.has(personaId) && wanted.size >= 50) return;
  // a pending fork/attestation claim for this persona is not downgraded to a plain tier claim
  const existing = wanted.get(personaId);
  if (existing && existing.claimKind !== "tier-membership") return;
  wanted.set(personaId, { motivatedAt, claimKind: "tier-membership", tree: gateTree(), gateId: GATE_ID });
  recordAttempt({ personaId, at: Date.now(), ok: true, stage: "wanted", reason: "marked for the next prefetch tick — no request leaves at render time" });
  void import("./prefetch").then(({ ensurePrefetchLoop }) => ensurePrefetchLoop());
}

/** Gate 3: the fork route's trigger — prove, at the next tick, that the
 * NEW persona's root is in the gate's tier tree under the fork commitment.
 * The tier carries to the new persona through this proof (it doubles as
 * the epoch's eligibility proof for the gate). No request leaves here. */
export function requestForkContinuity(newPersonaId: string, forkCommit: string, motivatedAt = Date.now()): boolean {
  if (!/^[A-Za-z0-9_]{1,80}$/.test(newPersonaId) || !FORK_COMMIT_RE.test(forkCommit)) return false;
  if (!wanted.has(newPersonaId) && wanted.size >= 50) return false;
  wanted.set(newPersonaId, { motivatedAt, claimKind: "fork-continuity", tree: gateTree(), gateId: GATE_ID, forkCommit });
  recordAttempt({ personaId: newPersonaId, at: Date.now(), ok: true, claimKind: "fork-continuity", stage: "wanted", reason: "fork continuity marked for the next prefetch tick" });
  void import("./prefetch").then(({ ensurePrefetchLoop }) => ensurePrefetchLoop());
  return true;
}

/** ATTESTATION PASS Gate 1: prove, at the next tick, membership in an
 * issuer's BUCKET tree for this persona. Refuses (loudly, in the attempt
 * log) an issuer this client does not honour: an un-honoured issuer's
 * attestation proves nothing here, whatever the validator holds. */
function cachedSnapshotKeyOf(issuer: string): string | null {
  const g2 = globalThis as unknown as { __layersZkPrefetch?: { snapshots: Partial<Record<string, { issuers?: { id: string; pubkey: string }[] }>> } };
  for (const snap of Object.values(g2.__layersZkPrefetch?.snapshots ?? {})) {
    const hit = snap?.issuers?.find((i) => i.id === issuer);
    if (hit) return hit.pubkey;
  }
  return null;
}

export function requestAttestationProof(personaId: string, issuer: string, bucket: string, motivatedAt = Date.now()): { ok: boolean; reason?: string } {
  if (!/^[A-Za-z0-9_]{1,80}$/.test(personaId) || !validIssuer(issuer) || !validBucket(bucket)) {
    return { ok: false, reason: "personaId, issuer and bucket are required (issuer/bucket: lowercase namespaced names)" };
  }
  // honour by KEY (Gate 4): the issuer's registered key comes from the last tick's registry snapshot — no snapshot, no proof
  const snapKey = cachedSnapshotKeyOf(issuer);
  if (!isHonoredIssuer(issuer, snapKey)) {
    recordAttempt({ personaId, at: Date.now(), ok: false, claimKind: "attestation", stage: "honour", reason: `issuer ${issuer} is not honoured by this client${snapKey ? "" : " (its registered key is not in the tick's registry snapshot yet)"} — its attestation proves nothing here (lib/attest/subscriber.ts)` });
    return { ok: false, reason: `issuer ${issuer} is not honoured by this client` };
  }
  const tree = attestTreeName(issuer, bucket);
  const key = personaId + "|" + tree;
  if (!wanted.has(key) && wanted.size >= 50) return { ok: false, reason: "too many wanted claims this tick" };
  // the gate id of an attestation claim IS its tree name (both sides accept [A-Za-z0-9_.:/-])
  wanted.set(key, { motivatedAt, claimKind: "attestation", tree, gateId: tree, issuer, bucket });
  recordAttempt({ personaId, at: Date.now(), ok: true, claimKind: "attestation", stage: "wanted", reason: "attestation proof marked for the next prefetch tick" });
  void import("./prefetch").then(({ ensurePrefetchLoop }) => ensurePrefetchLoop());
  return { ok: true };
}

/** Called by the prefetch tick with ITS snapshot: prove every wanted
 * persona from it. Returns the number of proofs queued. */
/** the trees the wanted claims name — the tick snapshots each of them */
export function wantedTrees(): string[] {
  return [...new Set([...wanted.values()].map((w) => w.tree))];
}

export async function runWantedProofs(snap: import("./prefetch").PrefetchSnapshot, extra: Record<string, import("./prefetch").PrefetchSnapshot> = {}): Promise<number> {
  // PERSONA LAUNCH wave 3 (W3-DRAIN-NOT-RESUMED): every tick — whether or not anything is wanted — arms the drain loop
  // when the sealed queue holds a queued submission (one a reload or restart hydrated). Before, the loop started only
  // after an enqueue in this process, so a hydrated anon post, X copy or launch request was never sent. Never fails the
  // tick; a store that cannot be read is retried next tick (nothing is sent without the loop).
  try {
    const { resumeDrainIfQueued } = await import("./anon/queue");
    // (L7: and the tick's epoch is recorded for the drain's expiry sweep — an item of an earlier epoch is never sent)
    await resumeDrainIfQueued({ mode: snap.mode, epoch: snap.epoch.epoch });
  } catch {
    /* the next tick tries again */
  }
  // PERSONA LAUNCH P3 (PRIV-3): every tick, from ITS snapshot, the anon submissions of closed windows with a final
  // outcome are pruned (lib/zk/anon/queue.ts) — the sealed queue stops growing a step per anon post. Never fails the tick.
  try {
    const { pruneSettledAnonItems } = await import("./anon/queue");
    await pruneSettledAnonItems(snap.mode, snap.epoch.epoch);
  } catch {
    /* the next tick prunes; nothing here is lost or sent */
  }
  // PERSONA LAUNCH P8: the closed windows' settled X copies too (their outcome stays on the sealed X record)
  try {
    const { pruneSettledXItems } = await import("./anon/queue");
    await pruneSettledXItems(snap.mode, snap.epoch.epoch);
  } catch {
    /* the next tick prunes */
  }
  if (wanted.size === 0) return 0;
  const { prepareAndProve } = await import("./prove");
  const { enqueueSubmission, ensureDrainLoop, hasSubmissionFor, anonSlotsUsed } = await import("./anon/queue");
  let queued = 0;
  for (const [key, w] of [...wanted.entries()]) {
    wanted.delete(key);
    // PERSONA LAUNCH P6: a launch request is keyed "launch|<commit>" and proves as the constant "anon"
    const personaId = w.claimKind === "persona-launch" ? ANON_PERSONA_KEY : key.split("|")[0];
    if (w.claimKind === "persona-launch") {
      try {
        if (await proveLaunchRequest(key, w, snap, extra)) queued++;
      } catch (e) {
        recordAttempt({ personaId, at: Date.now(), ok: false, claimKind: w.claimKind, stage: "error", reason: (e as Error).message });
        await launchRefused(key, w, "error", (e as Error).message, false).catch(() => undefined);
      }
      continue;
    }
    // PERSONA LAUNCH P8: an X copy is keyed "x|<xHash>" and proves as the constant "anon" (proveXAnonPost, below)
    if (w.claimKind === "x-anon-post") {
      try {
        if (await proveXAnonPost(key, w, snap, extra)) queued++;
      } catch (e) {
        recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: false, claimKind: w.claimKind, stage: "error", reason: (e as Error).message });
        await xRefused(key, w, snap.mode, "error", (e as Error).message, false).catch(() => undefined);
      }
      continue;
    }
    /** PERSONA LAUNCH P3: the slot this anon post spends, assigned below from THIS tick's snapshot */
    let anonSlot: number | undefined;
    try {
      // Attestation pass Gate 1: an attestation submission is per TREE (bucket) — two buckets are two claims
      if (w.claimKind !== "anon-post" && (await hasSubmissionFor(snap.mode, personaId, snap.epoch.epoch, w.claimKind, w.claimKind === "attestation" ? w.tree : undefined))) {
        recordAttempt({ personaId, at: Date.now(), ok: true, claimKind: w.claimKind, skipped: true, epoch: snap.epoch.epoch, stage: "once", reason: "a submission for this persona, epoch and claim kind is already queued or accepted" });
        continue;
      }
      if (w.claimKind === "anon-post") {
        const useSnapA = w.tree === snap.tree ? snap : extra[w.tree];
        // PERSONA LAUNCH P3: a validator whose K differs from this client's is not proved for (retryable: the two may
        // agree again after a redeploy); the client never takes the served K as its own
        const servedK = (useSnapA ?? snap).anonConfig?.slotsPerWindow;
        if (typeof servedK === "number" && servedK !== ZK_ANON_POST_SLOTS) {
          const reason = `the validator allows ${servedK} anonymous posts per window and this app allows ${ZK_ANON_POST_SLOTS} — not proved until they agree`;
          recordAttempt({ personaId, at: Date.now(), ok: false, claimKind: w.claimKind, epoch: snap.epoch.epoch, stage: "slots", reason });
          await anonRefused(key, w, snap.mode, "slots", reason, false);
          continue;
        }
        // A2-6, judged at the tick from ITS snapshot: a relay account joined to this app is a terminal refusal
        if (snap.mode === "live" && useSnapA?.anonConfig) {
          const { ownIdentityFacts } = await import("./privacy");
          const v = relayAccountVerdict({ mode: "live", liveRelay: useSnapA.anonConfig.liveRelay, fid: useSnapA.anonConfig.fid, relayKeyFingerprint: useSnapA.anonConfig.relayKeyFingerprint ?? null }, await ownIdentityFacts());
          if (relayJoinRefusesPosting(v)) {
            recordAttempt({ personaId, at: Date.now(), ok: false, claimKind: w.claimKind, epoch: snap.epoch.epoch, stage: "relay", reason: v.detail });
            await anonRefused(key, w, snap.mode, "relay", "the anon relay account is not distinct from this app: " + v.detail, true);
            continue;
          }
        }
        // R1-04: no epoch grace for an anon post — too close to the boundary for the jitter window, prove next tick
        if (useSnapA) {
          const edge = anonEpochEdge({ msRemaining: useSnapA.epoch.msRemaining, fetchedAt: useSnapA.fetchedAt }, Date.now(), ZK_JITTER_MAX_MS);
          if (edge.defer) {
            const reason = `${Math.round(edge.remainingMs / 60_000)} min left in epoch ${useSnapA.epoch.epoch}, less than the ${Math.round(edge.neededMs / 60_000)} min the jitter window needs — proved from the next epoch's snapshot (no grace for an anon post)`;
            recordAttempt({ personaId, at: Date.now(), ok: true, claimKind: w.claimKind, skipped: true, epoch: snap.epoch.epoch, stage: "epoch-edge", reason });
            wanted.set(key, w); // a deferral is not an attempt
            noteAnonOutcome(w.castHash as string, snap.mode, { stage: "deferred", lastStage: "epoch-edge", reason });
            continue;
          }
          // PERSONA LAUNCH P3 (D4): THE SLOT, from the snapshot the proof will be made from (its epoch fixes the window).
          // The used set is re-read per post, so two posts proved on one tick never share a slot (the first is queued
          // before the second is assigned). Uniform over the free slots (lib/zk/anon/slots.ts), with the client's OWN K.
          // None free: a terminal 'window' refusal (its reveal secret is deleted with it). A FORCED rig entry re-uses a
          // spent slot instead, so the VALIDATOR is the one that refuses it — by nullifier, as a replay.
          const used = await anonSlotsUsed(useSnapA.mode, useSnapA.epoch.epoch);
          const free = pickFreeSlot(used, ZK_ANON_POST_SLOTS);
          if (free !== null) anonSlot = free;
          else if (w.force && used.size > 0) {
            const spent = [...used];
            anonSlot = spent[csprngIndex(spent.length)];
          }
          if (anonSlot === undefined) {
            const reason = windowFullSentence(ZK_ANON_POST_SLOTS, anonWindowHours(useSnapA));
            recordAttempt({ personaId, at: Date.now(), ok: true, claimKind: w.claimKind, skipped: true, epoch: useSnapA.epoch.epoch, stage: "once", reason });
            await anonRefused(key, w, snap.mode, "window", reason, true);
            continue;
          }
        }
      }
      // Gate 4 (attack-z2-3 #7): a fork-continuity claim IS the epoch's tier
      // proof for the gate — a second, plain tier claim would spend the
      // budget partition twice for one tree
      if (w.claimKind === "tier-membership" && (await hasSubmissionFor(snap.mode, personaId, snap.epoch.epoch, "fork-continuity"))) {
        recordAttempt({ personaId, at: Date.now(), ok: true, claimKind: w.claimKind, skipped: true, epoch: snap.epoch.epoch, stage: "once", reason: "the fork-continuity claim already carries this epoch's tier" });
        continue;
      }
      // Gate 4 (attack-z2-3 #3): only ever from a fixed-schedule snapshot of the claim's tree
      const useSnap = w.tree === snap.tree ? snap : extra[w.tree];
      if (!useSnap) {
        const reason = "no fixed-schedule snapshot for tree " + w.tree + " on this tick — refused, never fetched at prove time";
        recordAttempt({ personaId, at: Date.now(), ok: false, claimKind: w.claimKind, stage: "snapshot", reason });
        if (w.claimKind === "anon-post") await anonRefused(key, w, snap.mode, "snapshot", reason, false);
        continue;
      }
      // PERSONA LAUNCH P6 (fix LP-4, the proof layer's half): a launch later joins every anon post of a persona publicly,
      // so each post narrows its TRUE persona to the members of the tree it proves. Keep the DEVICE-LOCAL running
      // intersection under "anon-post|<persona>" (lib/launch/preview.ts ANON_CROWD_KEY_PREFIX reads it; never sent) and
      // refuse a REACH proof that would take it under ZK_REACH_FLOOR — mirrors Gate 4's attestation intersection in
      // lib/zk/prove.ts. The plain tree is never refused here (it is the "no boost" choice the refusal points to), and a
      // reach proof is refused only when IT narrows the crowd (to under the floor): a crowd a plain post already took
      // under the floor is not made smaller by a boost whose tree holds all of it, so that boost reveals nothing more —
      // the launch preview says the crowd is under the floor and asks for the acknowledgement either way.
      // TERMINAL, in plain words: within an epoch the snapshot cannot change, and "Not proved yet" for up to 150 ticks
      // would hide a refusal the user can act on now (post again with a lower boost or none). The record lookup throws
      // on an unreadable store → the catch below → retried, never proved without the check (fail closed).
      let crowdKey: string | null = null;
      let crowdNext: string[] | null = null;
      // PERSONA LAUNCH wave 3 (L3): false when this post's band could not be worked out — the narrowed crowd is still
      // recorded (an over-count) but the post is NOT marked covered, so the launch preview calls the crowd unknown and asks
      // for the acknowledgement (fail closed), never an exact number it cannot stand behind
      let bandKnown = true;
      if (w.claimKind === "anon-post" && w.castHash) {
        const { attributionRecord } = await import("./anon/queue");
        const sealed = await attributionRecord(w.castHash);
        if (sealed?.personaId) {
          const { intersectionFor } = await import("./localPins");
          const { parseReachTree } = await import("@/lib/reach/trees");
          crowdKey = "anon-post|" + sealed.personaId;
          const prev = intersectionFor(snap.mode, crowdKey);
          const cur = new Set(useSnap.members.members);
          // PERSONA LAUNCH wave 3 (L3) — THE BAND. The default is the HIGHEST tier offered, so a post made at the tree
          // that WAS this root's default comes, to anyone who knows the census, from the BAND under the next tier up: the
          // members of its tree who hold no offered tier above it (for the plain tree: no offered reach tier at all) —
          // otherwise their default would have been higher. After a launch that inference is EXACT for this persona (it
          // posted at its default, so it holds nothing offered above), so its crowd narrows to the band, not the whole
          // tree. Above = every tree the population-level offer (the same rule, held = every census tree) ranks before
          // this one; their members come from this tick's uniform snapshots. A post made BELOW its default (a chosen
          // lower boost or none) is from a member of its tree but not of the band — the observer's inference is wrong
          // for it, and its crowd stays the whole tree.
          try {
            const { offeredAnonTrees } = await import("@/lib/reach/trees");
            const offerIn = reachOfferInputFor(snap.mode, snap);
            if (offeredAnonTrees(offerIn).defaultTree === w.tree) {
              const population = offeredAnonTrees({ ...offerIn, held: (offerIn.census ?? []).map((c) => c.tree) }).offered.map((o) => o.tree);
              const at = population.indexOf(w.tree);
              const above = at < 0 ? population : population.slice(0, at);
              for (const t of above) {
                const s = t === snap.tree ? snap : extra[t];
                if (!s) {
                  bandKnown = false;
                  continue;
                }
                for (const m of s.members.members) cur.delete(m);
              }
            }
          } catch {
            bandKnown = false;
          }
          crowdNext = prev === null ? [...cur] : prev.filter((m) => cur.has(m));
          if (parseReachTree(w.tree) && crowdNext.length < ZK_REACH_FLOOR && (prev === null || crowdNext.length < prev.length)) {
            const reason = `boosting it would leave only ${crowdNext.length} accounts that could have written all of this persona's anonymous posts (fewer than ${ZK_REACH_FLOOR}). Post it again with a lower boost or no boost`;
            recordAttempt({ personaId, at: Date.now(), ok: false, claimKind: w.claimKind, stage: "cohort", reason });
            await anonRefused(key, w, snap.mode, "cohort", reason, true);
            continue;
          }
        }
      }
      const out = await prepareAndProve({ claimKind: w.claimKind, tree: w.tree, personaId, gateId: w.gateId, forkCommit: w.forkCommit, issuer: w.issuer, bucket: w.bucket, castHash: w.castHash, attributionCommitment: w.attributionCommitment, mode: snap.mode, ...(w.claimKind === "anon-post" ? { slot: anonSlot, noteHash: w.noteHash } : {}) }, useSnap);
      const attempt: GateAttempt = { personaId, at: Date.now(), ok: out.ok, claimKind: w.claimKind };
      if (out.ok) {
        // MULTI-FID Gate 4: the anon envelope carries the text the validator relays (bound by castHash). PERSONA LAUNCH
        // P4: and the ring note (bound by noteHash) — exactly these three keys; the validator refuses any other shape
        if (w.claimKind === "anon-post" && w.text !== undefined && w.nonce && w.note) out.envelope.payload = { text: w.text, nonce: w.nonce, note: w.note };
        // fix LP-4: the narrowed crowd is recorded BEFORE the post is queued — a write that fails refuses (retried next
        // tick, nothing queued); one that lands before a failed queue only over-counts the narrowing (fail closed)
        // … and WHICH posts that count covers ("anon-post-covered|<persona>": their cast hashes): a post proved on another
        // device of this root, or before this device kept the count, is not in it, and the launch preview then calls the
        // crowd unknown instead of exact (lib/launch/preview.ts anonPostCrowdOf)
        if (crowdKey && crowdNext) {
          const pins = await import("./localPins");
          pins.setIntersection(snap.mode, crowdKey, crowdNext);
          const coveredKey = "anon-post-covered|" + crowdKey.slice("anon-post|".length);
          // L3: a post whose band could not be worked out is never marked covered (the preview then says "unknown")
          if (bandKnown) pins.setIntersection(snap.mode, coveredKey, [...new Set([...(pins.intersectionFor(snap.mode, coveredKey) ?? []), w.castHash as string])]);
        }
        // MULTI-FID Gate 5 (attack-fid-2 #3): the product path queues from the tick's OWN snapshot (no identified epoch
        // fetch) and persists the queued state on a random delay like the sent mark — no device-signed write at prove time
        const item = await enqueueSubmission(out.envelope, { motivatedAt: w.motivatedAt, epochShape: { epochMs: snap.epoch.epochMs, msRemaining: snap.epoch.msRemaining, fetchedAt: snap.fetchedAt }, persist: "deferred" });
        ensureDrainLoop();
        attempt.queuedId = item.id;
        attempt.epoch = out.epoch;
        queued++;
        if (w.claimKind === "anon-post") noteAnonOutcome(w.castHash as string, snap.mode, { stage: "queued", lastStage: "queued", reason: null, queuedId: item.id, epoch: out.epoch, attempts: (w.attempts ?? 0) + 1 });
      } else {
        attempt.stage = out.stage;
        attempt.reason = out.reason;
        // A2-2 / R3-02: an anon post refused at a retryable stage (not yet a leaf, cohort, snapshot, epoch, the
        // prover, the artifacts) STAYS WANTED for the next tick instead of vanishing after a toast that promised a post
        if (w.claimKind === "anon-post") await anonRefused(key, w, snap.mode, out.stage, out.reason, ANON_TERMINAL_STAGES.has(out.stage));
      }
      recordAttempt(attempt);
    } catch (e) {
      recordAttempt({ personaId, at: Date.now(), ok: false, stage: "error", reason: (e as Error).message });
      if (w.claimKind === "anon-post") await anonRefused(key, w, snap.mode, "error", (e as Error).message, false).catch(() => undefined);
    }
  }
  return queued;
}

// ---------------------------------------------------------------- PERSONA LAUNCH P6: the anonymous launch request
//
// The launch track's seam (lib/launch/*), landed here because this file owns the wanted set. A launch REQUEST (the new
// account's custody address and profile, built and committed to by lib/launch/request.ts) is proved like an anon post:
// at the next tick, from that tick's snapshot, membership in the PLAIN anon tree under a message that binds
// launch:<commit>, scope persona-launch/w<n> (one per person per window, whichever persona it launches), and sent over
// the anonymous channel on the queue's jittered, deferred schedule. Nothing here fetches, proves or writes at request
// time. (Placed after runWantedProofs on purpose: accept-z5 check 6 scans the requestEligibility..runWantedProofs text
// for fetches and proofs.)

const LAUNCH_KEY_PREFIX = "launch|";
const LAUNCH_REQUEST_MAX_BYTES = 2048;

/** the launch track's outcome log (lib/launch/confirm.ts) — a missing or failing logger never fails the tick */
async function noteLaunch(launchCommit: string, o: { stage: string; reason: string | null; queuedId?: string }): Promise<void> {
  try {
    (await import("@/lib/launch/confirm")).noteLaunchOutcome(launchCommit, o);
  } catch {
    /* the outcome is in the gate's attempt log either way */
  }
}

/** has a launch request already been queued, or sent and accepted (or replayed), in THIS window — any epoch of it? */
async function launchSubmittedThisWindow(mode: "fixture" | "live", epoch: number): Promise<boolean> {
  const { hasSubmissionFor } = await import("./anon/queue");
  const start = Math.floor(epoch / ZK_ANON_POST_WINDOW_EPOCHS) * ZK_ANON_POST_WINDOW_EPOCHS;
  for (let e = start; e <= epoch; e++) if (await hasSubmissionFor(mode, ANON_PERSONA_KEY, e, "persona-launch")) return true;
  return false;
}

/** a launch request the tick could not prove this time: retryable stages keep it wanted (bounded like an anon post) */
async function launchRefused(key: string, w: WantedClaim, stage: string, reason: string, terminal: boolean): Promise<void> {
  const attempts = (w.attempts ?? 0) + 1;
  if (!terminal && attempts < ZK_ANON_WANTED_MAX_TICKS) {
    wanted.set(key, { ...w, attempts });
    await noteLaunch(w.launchCommit as string, { stage: "retrying", reason: `${stage}: ${reason}` });
    return;
  }
  await noteLaunch(w.launchCommit as string, { stage: "dropped", reason: terminal ? `${stage}: ${reason}` : `gave up after ${attempts} ticks — last refusal: ${stage}: ${reason}` });
}

/** prove one wanted launch request from this tick's snapshot; true when it was queued */
async function proveLaunchRequest(key: string, w: WantedClaim, snap: import("./prefetch").PrefetchSnapshot, extra: Record<string, import("./prefetch").PrefetchSnapshot>): Promise<boolean> {
  const commit = w.launchCommit as string;
  // ONE PER PERSON PER WINDOW (the scope's semantic): another launch already went this window — this one waits for the
  // next window, kept wanted (a deferral, not an attempt); the validator would refuse it as a replay anyway
  if (await launchSubmittedThisWindow(snap.mode, snap.epoch.epoch)) {
    const reason = "one launch request per window — a launch was already requested in this window; this one is asked for in the next";
    recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: true, claimKind: "persona-launch", skipped: true, epoch: snap.epoch.epoch, stage: "once", reason });
    wanted.set(key, w);
    await noteLaunch(commit, { stage: "once", reason });
    return false;
  }
  const useSnap = w.tree === snap.tree ? snap : extra[w.tree];
  if (!useSnap) {
    const reason = "no fixed-schedule snapshot for tree " + w.tree + " on this tick — refused, never fetched at prove time";
    recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: false, claimKind: "persona-launch", stage: "snapshot", reason });
    await launchRefused(key, w, "snapshot", reason, false);
    return false;
  }
  // the same epoch-edge rule as an anon post: the validator gives a launch request no epoch grace
  const edge = anonEpochEdge({ msRemaining: useSnap.epoch.msRemaining, fetchedAt: useSnap.fetchedAt }, Date.now(), ZK_JITTER_MAX_MS);
  if (edge.defer) {
    const reason = `${Math.round(edge.remainingMs / 60_000)} min left in epoch ${useSnap.epoch.epoch}, less than the ${Math.round(edge.neededMs / 60_000)} min the jitter window needs — proved from the next epoch's snapshot`;
    recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: true, claimKind: "persona-launch", skipped: true, epoch: snap.epoch.epoch, stage: "epoch-edge", reason });
    wanted.set(key, w);
    await noteLaunch(commit, { stage: "deferred", reason });
    return false;
  }
  const { prepareAndProve } = await import("./prove");
  const out = await prepareAndProve({ claimKind: "persona-launch", tree: w.tree, personaId: ANON_PERSONA_KEY, gateId: w.gateId, launchCommit: commit, mode: snap.mode }, useSnap);
  if (!out.ok) {
    recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: false, claimKind: "persona-launch", stage: out.stage, reason: out.reason });
    await launchRefused(key, w, out.stage, out.reason, ANON_TERMINAL_STAGES.has(out.stage));
    return false;
  }
  // the envelope carries exactly { request } (bound by launchCommit); queued on the deferred schedule like an anon post
  out.envelope.payload = { request: w.request as string };
  const { enqueueSubmission, ensureDrainLoop } = await import("./anon/queue");
  const item = await enqueueSubmission(out.envelope, { motivatedAt: w.motivatedAt, epochShape: { epochMs: snap.epoch.epochMs, msRemaining: snap.epoch.msRemaining, fetchedAt: snap.fetchedAt }, persist: "deferred" });
  ensureDrainLoop();
  recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: true, claimKind: "persona-launch", stage: "queued", queuedId: item.id, epoch: out.epoch });
  await noteLaunch(commit, { stage: "queued", reason: null, queuedId: item.id });
  return true;
}

/** PERSONA LAUNCH P6: the launch confirm's trigger — NO request and NO proof leave here. The request (≤ 2048 bytes) and
 * its 64-hex commitment wait in the wanted set; the next prefetch tick proves the launch claim and queues it. */
export function requestLaunchProof(launchCommit: string, request: string, motivatedAt = Date.now()): { ok: boolean; reason?: string } {
  if (typeof launchCommit !== "string" || !FORK_COMMIT_RE.test(launchCommit)) return { ok: false, reason: "the launch commitment must be 64 lowercase hex" };
  if (typeof request !== "string" || !request) return { ok: false, reason: "the launch request is empty" };
  if (new TextEncoder().encode(request).length > LAUNCH_REQUEST_MAX_BYTES) return { ok: false, reason: `the launch request is larger than ${LAUNCH_REQUEST_MAX_BYTES} bytes` };
  const key = LAUNCH_KEY_PREFIX + launchCommit;
  if (!wanted.has(key) && wanted.size >= 50) return { ok: false, reason: "the wanted set is full — try again next tick" };
  wanted.set(key, { motivatedAt, claimKind: "persona-launch", tree: anonPostTree(), gateId: "persona-launch", launchCommit, request, attempts: 0 });
  recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: true, claimKind: "persona-launch", stage: "wanted", reason: "launch request marked for the next prefetch tick — nothing leaves at confirm time" });
  void import("./prefetch").then(({ ensurePrefetchLoop }) => ensurePrefetchLoop());
  return { ok: true };
}

/** PERSONA LAUNCH P6: the launch requests still waiting for their proof (commitments only — never the request) */
export function wantedLaunchRequests(): string[] {
  return [...wanted.values()].filter((w) => w.claimKind === "persona-launch" && w.launchCommit).map((w) => w.launchCommit as string);
}

// ---------------------------------------------------------------- PERSONA LAUNCH P8: the anonymous X copy
//
// "Also post to @totem on X" (plan §2.6, P8). The X seam, landed here because this file owns the wanted set, and placed
// after runWantedProofs on purpose like the launch seam (accept-z5 check 6 scans requestEligibility..runWantedProofs for
// fetches and proofs). requestXAnonPost refuses BEFORE any mint or write — availability, the fixture universe, the
// browser device (D-X-PUBLIC-OFF), the persona, the outbox's text policy, the device's own account names, the X slots of
// this window (K_X, the client's OWN number, compared with the served one, never adopting it), the outbox's daily cap from
// the LAST tick's read — then holds the copy in the wanted set under "x|<xHash>". The tick's proveXAnonPost proves the
// PLAIN anon tree (an X copy carries no boost) under scope x-anon-post/w<n>/s<i> with a uniform free X slot, from that
// tick's snapshot, and queues it on the deferred schedule with its OWN jitter (never batched with its Farcaster sibling:
// two wanted entries, two queue items, two independent moments). Nothing about which persona sent it, or which anon post
// it copies, leaves this device: both ride the sealed X record (lib/zk/anon/queue.ts) and nowhere else.
//
// What a copy costs, said at the toggle (components/XOutboxToggle.tsx): it has the SAME WORDS as its Farcaster sibling,
// so anyone can pair the two by their text, and a launch that reveals the sibling makes the copy read as the persona's
// (A-X-COPY-LINKED-BY-WORDS) — which is why a copy's proof is folded into the persona's crowd count below. A launch never
// reveals an X copy itself (D-X-COPY-UNATTRIBUTED).

const X_KEY_PREFIX = "x|";
export const X_GATE_ID = "x-anon-post";
export type XRefusalCode = "unavailable" | "bad-text" | "window" | "persona" | "post-mode" | "relay-cap" | "full" | "copy";
export interface XPostRequestResult {
  ok: boolean;
  xHash?: string;
  reason?: string;
  code?: XRefusalCode;
}
/** the words for "nothing goes to X from here", in one place */
export const X_PREVIEW_OFF_SENTENCE = "Posting a copy to @totem on X isn't on this preview.";
export const X_NOT_BUILT_SENTENCE = "Posting to @totem on X runs on test data only: nothing reaches X, and it is not on for real posts yet.";
/** PERSONA LAUNCH wave 3 (UXH-6): the outbox has no moderator — a copy would wait for review forever (nothing goes out
 *  unapproved), so none is offered or taken */
export const X_NO_MODERATOR_SENTENCE = "No moderator is set up for @totem on X yet, so a copy would never go out.";
/** …and the last check could not say whether it has one (never a guess) */
export const X_MODERATION_UNREAD_SENTENCE = "Couldn't read whether @totem on X has a moderator on the last check, so a copy isn't offered right now. Try again in a few minutes.";

/** this device's X copies the outbox has not counted yet: queued here, or sent and accepted after `since` */
async function xPostsAhead(mode: "fixture" | "live", since: number): Promise<number> {
  const { xSubmissionItems } = await import("./anon/queue");
  return (await xSubmissionItems()).filter((q) => q.mode === mode && (q.status === "queued" || (q.status === "sent" && q.outcome === "accepted" && (q.sentAt ?? 0) > since))).length;
}

export async function requestXAnonPost(text: string, opts: { personaId: string; copyOf?: string | null; motivatedAt?: number; force?: boolean }): Promise<XPostRequestResult> {
  // the same availability decision as an anon post (lib/zk/anon/availability.ts): an X copy is an anon post's twin
  const { anonPostingAvailability } = await import("./anon/availability");
  const avail = anonPostingAvailability({ mode: zkMode() });
  if (!avail.on) return { ok: false, code: "unavailable", reason: avail.reason ?? "anonymous posting is off here, so nothing goes to @totem on X either" };
  // D-X-PUBLIC-OFF: not in the public browser device (nor anywhere the anon post is a labelled preview) this wave
  if (typeof window !== "undefined" || avail.previewOnly) return { ok: false, code: "unavailable", reason: X_PREVIEW_OFF_SENTENCE };
  const mode = zkMode();
  // the live universe is refused everywhere: there is no X transport but the fixture (O4)
  if (mode !== "fixture") return { ok: false, code: "unavailable", reason: X_NOT_BUILT_SENTENCE };
  const personaId = typeof opts.personaId === "string" ? opts.personaId : "";
  {
    const { anonPersonaRefusal } = await import("@/lib/identity/postMode");
    let refusal: Awaited<ReturnType<typeof anonPersonaRefusal>>;
    try {
      refusal = await anonPersonaRefusal(personaId);
    } catch (e) {
      return { ok: false, code: "unavailable", reason: "couldn't check this persona (" + (e as Error).message + ") — nothing was sent to X" };
    }
    if (refusal) return { ok: false, code: refusal.code === "post-mode" ? "post-mode" : "persona", reason: refusal.message };
  }
  // a COPY names one of this persona's own anonymous posts (its sealed reveal record, device-local): the copy's crowd
  // fold below is that persona's, so a copy of a post this persona did not write is refused, never folded elsewhere
  const copyOf = opts.copyOf === undefined || opts.copyOf === null ? null : opts.copyOf;
  if (copyOf !== null) {
    if (typeof copyOf !== "string" || !FORK_COMMIT_RE.test(copyOf)) return { ok: false, code: "copy", reason: "that isn't one of your anonymous posts" };
    const { attributionRecord } = await import("./anon/queue");
    let sibling: Awaited<ReturnType<typeof attributionRecord>>;
    try {
      sibling = await attributionRecord(copyOf);
    } catch (e) {
      return { ok: false, code: "unavailable", reason: "couldn't read your anonymous posts (" + (e as Error).message + ") — nothing was sent to X" };
    }
    if (!sibling || sibling.personaId !== personaId) return { ok: false, code: "copy", reason: "that isn't one of this persona's anonymous posts" };
  }
  // the outbox's text policy (DELIBERATE DUPLICATE of the validator's): one https link with a short quote, no @mention,
  // at most two hashtags, one paragraph, at most 280 weighted characters
  const { xPostShape, xHashOf } = await import("@/lib/x/outbox/policy");
  const shape = xPostShape(text);
  if (!shape.ok) return { ok: false, code: "bad-text", reason: shape.reason };
  const t = shape.text;
  // the device's own account names (a name of yours on the anonymous account is a public edge, forever)
  let names: string[];
  try {
    names = await ownAccountNames();
  } catch (e) {
    return { ok: false, code: "unavailable", reason: "cannot check the text against your own account names (" + (e as Error).message + ") — nothing was sent to X" };
  }
  const own = checkAnonText(t, names);
  if (!own.ok) return { ok: false, code: "bad-text", reason: own.reason };
  // the last tick's reads: the zk snapshot (the window) and the outbox's config (K_X, the daily cap). Nothing is fetched
  // here; an outbox that was not read on the last tick is a refusal, never a pass (never fail open)
  const { cachedSnapshot, cachedXOutbox } = await import("./prefetch");
  const snap = cachedSnapshot(mode);
  const xSnap = cachedXOutbox(mode);
  if (!xSnap || !xSnap.config) return { ok: false, code: "unavailable", reason: "The @totem X outbox couldn't be read on the last check, so this copy wasn't sent. Try again in a few minutes." };
  // PERSONA LAUNCH wave 3 (UXH-6): no moderator = a copy that would wait for review forever, its X slot spent — refused
  // here as the toggle refuses to offer it (lib/x/outbox/request.ts xOffered); a config that does not say is not a yes
  if (xSnap.config.moderated !== true) return { ok: false, code: "unavailable", reason: typeof xSnap.config.moderated === "boolean" ? X_NO_MODERATOR_SENTENCE : X_MODERATION_UNREAD_SENTENCE };
  const servedXSlots = xSnap.config.xSlotsPerWindow;
  if (typeof servedXSlots === "number" && servedXSlots !== ZK_X_ANON_POST_SLOTS) {
    return { ok: false, code: "unavailable", reason: `posting to @totem on X is paused: the validator allows ${servedXSlots} per window and this app allows ${ZK_X_ANON_POST_SLOTS} — they must agree` };
  }
  let waiting = 0;
  for (const [k] of wanted) if (k.startsWith(X_KEY_PREFIX)) waiting++;
  if (!opts.force) {
    const { xSlotsUsed } = await import("./anon/queue");
    const used = snap ? (await xSlotsUsed(snap.mode, snap.epoch.epoch)).size : 0;
    if (xWindowFull(used + waiting, ZK_X_ANON_POST_SLOTS)) return { ok: false, code: "window", reason: xWindowFullSentence(ZK_X_ANON_POST_SLOTS, anonWindowHours(snap)) };
    const ahead = waiting + (await xPostsAhead(mode, xSnap.fetchedAt));
    if (xSnap.config.dailyUsed + ahead >= xSnap.config.dailyCap) return { ok: false, code: "relay-cap", reason: "Today's posts to @totem on X are used up. It opens again tomorrow." };
  }
  if (wanted.size >= 50) return { ok: false, code: "full", reason: "the wanted set is full — try again next tick" };
  const nonce = randomBytes(16).toString("hex");
  const xHash = xHashOf(t, nonce);
  // in memory only, persisted with the queue's deferred write: WHICH persona sent it, which anon post it copies
  const { putXRecord } = await import("./anon/queue");
  await putXRecord({ mode, xHash, personaId: personaId || null, copyOf, at: Date.now() });
  wanted.set(X_KEY_PREFIX + xHash, { motivatedAt: opts.motivatedAt ?? Date.now(), claimKind: "x-anon-post", tree: anonPostTree(), gateId: X_GATE_ID, xHash, text: t, nonce, xPersonaId: personaId || undefined, copyOf: copyOf ?? undefined, force: !!opts.force, attempts: 0 });
  noteXOutcome(xHash, mode, { stage: "wanted", reason: null, lastStage: "wanted", warnings: own.warnings, personaId: personaId || null });
  recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: true, claimKind: "x-anon-post", stage: "wanted", reason: "X copy marked for the next prefetch tick — nothing leaves at compose time" });
  void import("./prefetch").then(({ ensurePrefetchLoop }) => ensurePrefetchLoop());
  return { ok: true, xHash };
}

/** an X copy the tick could not prove this time: retryable stages keep it wanted (bounded like an anon post) */
async function xRefused(key: string, w: WantedClaim, mode: "fixture" | "live", stage: string, reason: string, terminal: boolean): Promise<void> {
  const xHash = w.xHash as string;
  const attempts = (w.attempts ?? 0) + 1;
  if (!terminal && attempts < ZK_ANON_WANTED_MAX_TICKS) {
    wanted.set(key, { ...w, attempts });
    noteXOutcome(xHash, mode, { stage: "retrying", lastStage: stage, reason, attempts });
    return;
  }
  // a copy that will never be sent keeps no record
  const { deleteXRecord } = await import("./anon/queue");
  await deleteXRecord(xHash).catch(() => undefined);
  noteXOutcome(xHash, mode, { stage: "dropped", lastStage: stage, reason: terminal ? reason : `gave up after ${attempts} ticks — last refusal: ${reason}`, attempts });
}

/** prove one wanted X copy from this tick's snapshot; true when it was queued */
async function proveXAnonPost(key: string, w: WantedClaim, snap: import("./prefetch").PrefetchSnapshot, extra: Record<string, import("./prefetch").PrefetchSnapshot>): Promise<boolean> {
  const xHash = w.xHash as string;
  const xs = w.tree === snap.tree ? snap : extra[w.tree];
  if (!xs) {
    const reason = "no fixed-schedule snapshot for tree " + w.tree + " on this tick — refused, never fetched at prove time";
    recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: false, claimKind: "x-anon-post", stage: "snapshot", reason });
    await xRefused(key, w, snap.mode, "snapshot", reason, false);
    return false;
  }
  // the validator's K_X must be this client's (never adopted for the slot choice — compared, retried until they agree)
  const { cachedXOutbox } = await import("./prefetch");
  const xSnap = cachedXOutbox(snap.mode);
  const servedXSlots = xSnap?.config?.xSlotsPerWindow;
  if (typeof servedXSlots === "number" && servedXSlots !== ZK_X_ANON_POST_SLOTS) {
    const reason = `the validator allows ${servedXSlots} posts to X per window and this app allows ${ZK_X_ANON_POST_SLOTS} — not proved until they agree`;
    recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: false, claimKind: "x-anon-post", stage: "slots", reason });
    await xRefused(key, w, snap.mode, "slots", reason, false);
    return false;
  }
  // the epoch-edge rule: the validator gives an X copy no epoch grace (its X slot is the window's)
  const xEdge = anonEpochEdge({ msRemaining: xs.epoch.msRemaining, fetchedAt: xs.fetchedAt }, Date.now(), ZK_JITTER_MAX_MS);
  if (xEdge.defer) {
    const reason = `${Math.round(xEdge.remainingMs / 60_000)} min left in epoch ${xs.epoch.epoch}, less than the ${Math.round(xEdge.neededMs / 60_000)} min the jitter window needs — proved from the next epoch's snapshot`;
    recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: true, claimKind: "x-anon-post", skipped: true, epoch: snap.epoch.epoch, stage: "epoch-edge", reason });
    wanted.set(key, w); // a deferral is not an attempt
    noteXOutcome(xHash, snap.mode, { stage: "deferred", lastStage: "epoch-edge", reason });
    return false;
  }
  // THE X SLOT: uniform over the free ones of THIS window, with the client's own K_X; X slots are not anon-post slots
  const { xSlotsUsed, enqueueSubmission, ensureDrainLoop } = await import("./anon/queue");
  const xUsed = await xSlotsUsed(xs.mode, xs.epoch.epoch);
  let xSlot = pickFreeXSlot(xUsed, ZK_X_ANON_POST_SLOTS);
  // a FORCED rig entry re-uses a spent X slot, so the VALIDATOR refuses it by nullifier (a replay)
  if (xSlot === null && w.force && xUsed.size > 0) {
    const spent = [...xUsed];
    xSlot = spent[csprngIndex(spent.length)];
  }
  if (xSlot === null) {
    const reason = xWindowFullSentence(ZK_X_ANON_POST_SLOTS, anonWindowHours(xs));
    recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: true, claimKind: "x-anon-post", skipped: true, epoch: xs.epoch.epoch, stage: "once", reason });
    await xRefused(key, w, snap.mode, "window", reason, true);
    return false;
  }
  // A COPY JOINS ITS PERSONA'S CROWD BY ITS WORDS (A-X-COPY-LINKED-BY-WORDS): a launch that reveals the Farcaster sibling
  // makes this copy read as the persona's too, so its tree narrows the persona's crowd like an anon post's does (the
  // device-local "anon-post|<persona>" intersection lib/launch/preview.ts reads). The plain tree is never refused for it
  // (the wave-2 rule); the narrowing is recorded BEFORE the queue (a failed write refuses — fail closed). A standalone X
  // post (no copyOf) is tied to nothing a launch reveals and is not folded.
  let xCrowdKey: string | null = null;
  let xCrowdNext: string[] | null = null;
  if (w.copyOf && w.xPersonaId) {
    const { intersectionFor } = await import("./localPins");
    xCrowdKey = "anon-post|" + w.xPersonaId;
    const before = intersectionFor(snap.mode, xCrowdKey);
    const members = new Set(xs.members.members);
    xCrowdNext = before === null ? [...members] : before.filter((m) => members.has(m));
  }
  const { prepareAndProve } = await import("./prove");
  const out = await prepareAndProve({ claimKind: "x-anon-post", tree: w.tree, personaId: ANON_PERSONA_KEY, gateId: X_GATE_ID, xHash, slot: xSlot, mode: snap.mode }, xs);
  if (!out.ok) {
    recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: false, claimKind: "x-anon-post", stage: out.stage, reason: out.reason });
    await xRefused(key, w, snap.mode, out.stage, out.reason, ANON_TERMINAL_STAGES.has(out.stage));
    return false;
  }
  // the envelope carries EXACTLY { text, nonce } (bound by xHash) — the validator refuses any other shape
  out.envelope.payload = { text: w.text as string, nonce: w.nonce as string };
  if (xCrowdKey && xCrowdNext) (await import("./localPins")).setIntersection(snap.mode, xCrowdKey, xCrowdNext);
  const item = await enqueueSubmission(out.envelope, { motivatedAt: w.motivatedAt, epochShape: { epochMs: snap.epoch.epochMs, msRemaining: snap.epoch.msRemaining, fetchedAt: snap.fetchedAt }, persist: "deferred" });
  ensureDrainLoop();
  recordAttempt({ personaId: ANON_PERSONA_KEY, at: Date.now(), ok: true, claimKind: "x-anon-post", stage: "queued", queuedId: item.id, epoch: out.epoch });
  noteXOutcome(xHash, snap.mode, { stage: "queued", lastStage: "queued", reason: null, queuedId: item.id, epoch: out.epoch, attempts: (w.attempts ?? 0) + 1 });
  return true;
}

/** PERSONA LAUNCH P8: the X copies still waiting for their proof (hashes and attempt counts only — never the text) */
export function wantedXPosts(): Array<{ xHash: string; attempts: number; motivatedAt: number; personaId: string | null }> {
  // PERSONA LAUNCH wave 3 (UXH-1): with the persona it was sent as (device-local), so the X view can scope it
  return [...wanted.values()].filter((w) => w.claimKind === "x-anon-post" && w.xHash).map((w) => ({ xHash: w.xHash as string, attempts: w.attempts ?? 0, motivatedAt: w.motivatedAt, personaId: w.xPersonaId ?? null }));
}

/** ANON REVIEW: the wanted anon posts (cast hashes and attempt counts only — never the text) */
export function wantedAnonPosts(): Array<{ castHash: string; attempts: number; motivatedAt: number }> {
  return [...wanted.values()].filter((w) => w.claimKind === "anon-post" && w.castHash).map((w) => ({ castHash: w.castHash as string, attempts: w.attempts ?? 0, motivatedAt: w.motivatedAt }));
}

export function wantedPersonas(): string[] {
  return [...wanted.keys()].map((k) => k.split("|")[0]);
}

export function gateAttempts(): GateAttempt[] {
  return [...(g.__layersGateAttempts ?? [])];
}

/** resetSeed clears every zk runtime knob (the ops lesson: a knob left on
 * by one suite silently changes the next). */
export async function resetZkRuntimeOverrides(): Promise<void> {
  setGateFallbackOverride(null);
  setZkModeOverride(null);
  const { setRepImplOverride } = await import("@/lib/adapters/registry");
  setRepImplOverride(null);
  const { setRelayOverride } = await import("./anon/relay");
  setRelayOverride(null);
  (await import("./anon/availability")).setAnonPostingOverride(null);
  g.__layersGateAttempts = [];
  wanted.clear();
  const { resetPrefetch } = await import("./prefetch");
  resetPrefetch();
  const { resetAnonOutcomes } = await import("./anon/outcomes");
  resetAnonOutcomes();
  // PERSONA LAUNCH wave 3 (L7): the drain's record of the last tick's epoch (a reset universe may restart lower)
  (await import("./anon/queue")).resetCurrentEpochs();
}
