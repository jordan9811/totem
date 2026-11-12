import "server-only";
// ZK PASS 1 Gate 1 — the JITTERED, BATCHED submission queue (C6 / F5b).
//
// A proof is never sent when it is made. It is queued with a submission
// time drawn UNIFORMLY at random from [now + JITTER_MIN, now + JITTER_MAX]
// (clamped to the epoch window so it does not land after its root has
// aged out of the grace), and sent by the drain loop when due. The offset
// from the motivating action is therefore a random variable with no fixed
// component — the in-process self-test (jitterSelfTest) and accept-z1
// assert the offsets' spread and that no two are equal.
//
// THE WINDOW IS NEVER NARROWER THAN THE CLIENT ALLOWS (attack-3 F-4): the
// epoch numbers that clamp it come from the validator, so they are
// validated (finite, an epoch at least ZK_EPOCH_MIN_MS long, a remainder
// inside it — anything else is a REFUSAL to schedule) and the clamp can
// never shrink the window below a quarter of its configured width. A
// validator that answers {epochMs: 0} gets no fixed-offset submissions;
// it gets none.
//
// NO IDENTIFIED WRITE AT SEND TIME (attack-1 finding 2): the queue used to
// be flushed to the vault the moment a submission returned — a
// device-signed PUT ~150 ms after every anonymous send, on the same
// validator. The `sent` mark is now persisted on its OWN random delay,
// drawn from the same window. The cost is stated in the module footer.
//
// PERSISTED in the vault (`zkQueue`, as ONE opaque sealed record): a
// restart resumes `queued` items and never re-sends `sent` ones. A crash
// between the wire and the deferred `sent` persist can yield at most ONE
// duplicate attempt, which the validator's nullifier store answers with
// `replay` — recorded, not re-queued.
//
// ANON REVIEW (R1-01, R3-07): the anon REVEAL SECRETS live in this same
// sealed namespace, as records of claimKind "anon-attribution" with no
// envelope (never drained, never counted as submissions). They used to be
// a namespace of their own, flushed with a device-signed PUT the moment
// Post was pressed — the one identified write that joined an anon compose
// to a root in the validator's database. Now they are minted in memory and
// persisted only on the queue's deferred write, like the queued/sent marks.
import { createHash, randomBytes } from "@/lib/platform/crypto";
import { hydrate, persistNs, state } from "@/lib/adapters/mock/store";
import { ZK_EPOCH_MIN_MS, ZK_JITTER_MAX_MS, ZK_JITTER_MIN_MS, type ZkMode } from "../config";
import type { QueuedSubmission } from "../queue";
import type { ProofEnvelope } from "../transport/types";
import { submitAnonymous } from "./submit";
import { fetchEpoch } from "../validatorClient";
import { ZK_ANON_EPOCH_EDGE_MARGIN_MS } from "./epochEdge";

/** uniform integer in [lo, hi] from CSPRNG bytes (no Math.random) */
export function uniformInt(lo: number, hi: number): number {
  const span = hi - lo + 1;
  const r = randomBytes(6).readUIntBE(0, 6) / 2 ** 48; // [0,1)
  return lo + Math.floor(r * span);
}

export interface EpochShape {
  epochMs: number;
  msRemaining: number;
  /** PERSONA LAUNCH P7 (W3-REJITTER-NO-GRACE): when that shape was read (device clock). The epoch ends at fetchedAt +
   *  msRemaining — NOT at enqueue + msRemaining: a tick's snapshot is seconds to minutes old by the time its proof is
   *  queued (the live prover alone may take 180 s), and the old end overstated the epoch by exactly that much. */
  fetchedAt?: number;
}
export interface JitterWindow {
  lo: number;
  hi: number;
  /** true when the epoch remainder shortened the window */
  clampedByEpoch: boolean;
  /** the smallest width the clamp may leave */
  minSpread: number;
}

const MAX_EPOCH_MS = 7 * 24 * 3600 * 1000;

/**
 * The effective window for a submission, PURE. `ep` is what the validator
 * said about the epoch (null = unknown: keep the configured window).
 * Throws on an implausible epoch — a throw is a refusal to schedule.
 */
export function jitterWindow(lo: number, hi: number, ep: EpochShape | null): JitterWindow {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi <= lo) throw new Error("jitter: window must satisfy 0 <= lo < hi");
  const minSpread = Math.max(1000, Math.ceil((hi - lo) * 0.25));
  if (ep === null) return { lo, hi, clampedByEpoch: false, minSpread };
  const { epochMs, msRemaining } = ep;
  if (!Number.isFinite(epochMs) || !Number.isFinite(msRemaining) || epochMs < ZK_EPOCH_MIN_MS || epochMs > MAX_EPOCH_MS || msRemaining < 0 || msRemaining > epochMs) {
    throw new Error(`jitter: validator epoch shape implausible (epochMs=${String(epochMs)}, msRemaining=${String(msRemaining)}) — refusing to schedule`);
  }
  // never schedule past the epoch window (the root would age out of grace),
  // but never let the clamp collapse the spread either
  const cap = msRemaining + Math.floor(epochMs / 2);
  if (cap >= hi) return { lo, hi, clampedByEpoch: false, minSpread };
  return { lo, hi: Math.max(cap, lo + minSpread), clampedByEpoch: true, minSpread };
}

/** PERSONA LAUNCH P7: the epoch an item's jitter was clamped by — its length and the moment it ends (device clock) */
export interface JitterEpoch {
  epochMs: number;
  endsAt: number;
}

/** PERSONA LAUNCH P7 (W3-REJITTER-NO-GRACE, L7): the claim kinds the validator gives NO epoch grace (validator/zk.js — a
 *  window boundary must never admit a second post, launch or X copy). A submission of one of these must ARRIVE inside the
 *  epoch its proof names, or it is refused after the validator has read all of it. */
export const NO_GRACE_KINDS: ReadonlySet<string> = new Set(["anon-post", "x-anon-post", "persona-launch"]);

/**
 * PERSONA LAUNCH P7 (W3-REJITTER-NO-GRACE) — THE SEND MOMENT, PURE. `w` is the item's jitter window. For a NO-GRACE item
 * whose epoch end is known, the moment is also bounded by `endsAt - margin` (the drain's cadence, the channel's latency
 * and clock drift: lib/zk/anon/epochEdge.ts), because jitterWindow's own cap (msRemaining + epochMs/2, at least 3 h with
 * 6-hour epochs) never binds on a 15-minute window — with 6 minutes left it put about 62% of the re-jittered moments
 * past the boundary, where the validator refuses the item after reading its text. Drawn uniformly from
 *   [now + w.lo, min(now + w.hi, bound)]   when the bound leaves room above the window's minimum,
 *   [now, bound]                           when it leaves less (still spread, still inside the epoch),
 *   now                                    inside the margin itself (due at the next drain, before the end);
 * null when the epoch is already over: the caller must expire the item (expireStaleNoGraceItems), never send it.
 */
export function boundedSendMoment(now: number, w: { lo: number; hi: number }, noGrace: boolean, endsAt: number | null | undefined, marginMs: number = ZK_ANON_EPOCH_EDGE_MARGIN_MS, draw: (lo: number, hi: number) => number = uniformInt): number | null {
  if (!noGrace || typeof endsAt !== "number" || !Number.isFinite(endsAt)) return now + draw(w.lo, w.hi);
  if (now >= endsAt) return null;
  const room = endsAt - Math.max(0, marginMs) - now;
  if (room > w.lo) return now + draw(w.lo, Math.min(w.hi, room));
  if (room > 0) return now + draw(0, room);
  return now;
}

export interface EnqueueOptions {
  motivatedAt?: number;
  /** override the window (tests) */
  jitterMinMs?: number;
  jitterMaxMs?: number;
  /** MULTI-FID Gate 5 (attack-fid-2 #3): the tick's snapshot epoch shape — no identified fetch at enqueue time */
  epochShape?: EpochShape | null;
  /** "deferred": persist on the queue's own random delay (the product path); "now": at once (rigs, restart survival) */
  persist?: "now" | "deferred";
}

export async function enqueueSubmission(envelope: ProofEnvelope, opts: EnqueueOptions = {}): Promise<QueuedSubmission> {
  await hydrate();
  const now = Date.now();
  let ep: EpochShape | null = null;
  if (opts.epochShape !== undefined) {
    ep = opts.epochShape;
  } else {
    try {
      const e = await fetchEpoch(envelope.mode);
      ep = { epochMs: e.epochMs, msRemaining: e.msRemaining, fetchedAt: Date.now() };
    } catch {
      ep = null; // epoch unknown: keep the configured window
    }
  }
  const w = jitterWindow(opts.jitterMinMs ?? ZK_JITTER_MIN_MS, opts.jitterMaxMs ?? ZK_JITTER_MAX_MS, ep);
  // PERSONA LAUNCH P7 (the prover's seam, landed by xout): the epoch the jitter was clamped by, as an absolute end — so a
  // reopened browser tab can re-jitter an overdue item inside the SAME epoch shape (drainOnce, below) without a fetch.
  // W3-REJITTER-NO-GRACE: the end is the SNAPSHOT's (read at fetchedAt), never `now + msRemaining`, which overstated it
  // by the snapshot's age.
  const jitterEpoch: JitterEpoch | null = ep ? { epochMs: ep.epochMs, endsAt: (typeof ep.fetchedAt === "number" && Number.isFinite(ep.fetchedAt) && ep.fetchedAt <= now ? ep.fetchedAt : now) + ep.msRemaining } : null;
  // a NO-GRACE item's moment is bounded by its epoch's end too (boundedSendMoment); the tick's epoch-edge deferral
  // (lib/zk/anon/epochEdge.ts) means the bound does not bind on the product path — it is the backstop for a slow prove
  const moment = boundedSendMoment(now, w, NO_GRACE_KINDS.has(envelope.claimKind), jitterEpoch?.endsAt ?? null);
  const item: QueuedSubmission & { jitterEpoch?: JitterEpoch } = {
    id: "zkq_" + randomBytes(8).toString("hex"),
    mode: envelope.mode,
    claimKind: envelope.claimKind,
    personaId: envelope.publicInputs.personaId,
    epoch: envelope.publicInputs.epoch,
    envelope,
    // an epoch already over at enqueue (a prove that outlasted it): due now, and the drain's expiry sweep refuses it
    // locally before anything is sent (expireStaleNoGraceItems) — it never reaches the wire
    notBefore: moment ?? now,
    motivatedAt: opts.motivatedAt ?? now,
    createdAt: now,
    status: "queued",
    sentAt: null,
    outcome: null,
  };
  if (jitterEpoch) item.jitterEpoch = jitterEpoch;
  state().zkQueue.set(item.id, item);
  // The QUEUED state is what a restart resumes. The PRODUCT path persists it on the queue's own random delay
  // (MULTI-FID Gate 5, attack-fid-2 #3: a device-signed PUT at prove time was the "this device just proved"
  // beacon A-PREPARE-BURST said never happens); a crash inside that delay re-proves at the next tick. Rigs and
  // the restart-survival suite ask for "now".
  if (opts.persist === "deferred") schedulePersist();
  else await persistNs("zkQueue");
  return item;
}

/** Is there already a queued/sent submission for this persona in this
 * epoch? (attack-1 finding 3: one proof per persona per epoch, so the
 * submission rate cannot track the render rate.) */
export async function hasSubmissionFor(mode: ZkMode, personaId: string, epoch: number, claimKind?: string, tree?: string): Promise<boolean> {
  await hydrate();
  for (const q of state().zkQueue.values()) {
    if (q.mode !== mode || q.personaId !== personaId || q.epoch !== epoch || !q.envelope) continue;
    // Gate 3: one submission per (persona, epoch, claim kind) — a fork or
    // attestation claim does not collide with the tier claim (bounded: at
    // most one per registered kind). Attestation pass Gate 1: attestation
    // claims are per TREE (issuer/bucket) — the caller passes the tree.
    if (claimKind && q.claimKind !== claimKind) continue;
    if (tree && (q.envelope as { publicInputs?: { tree?: string } }).publicInputs?.tree !== tree) continue;
    if (q.status === "queued") return true;
    if (q.status === "sent" && (q.outcome === "accepted" || q.outcome === "replay")) return true;
  }
  return false;
}

/** Test-only: queue N synthetic items to study the scheduler's offsets
 * without proving. They go through the SAME window computation as real
 * items (with the validator's real epoch shape, or a supplied one) and
 * are marked so drain() never sends them. */
/** PERSONA LAUNCH P3 (D4; replaces MULTI-FID Gate 4's hasAnonPostInWindow): the SLOTS of the window this epoch falls in
 * that this person has spent — every anon post this device queued, WHATEVER persona it was posted as (the budget is the
 * person's, shared across personas). Held = queued, or sent and accepted/replayed (lib/zk/anon/slots.ts slotHeld); a
 * refused or transport-failed one consumed no nullifier. A pre-P3 item (no slot: the retired bare-window scope) holds
 * no index — its nullifier can never collide with an indexed one. */
export async function anonSlotsUsed(mode: ZkMode, epoch: number): Promise<Set<number>> {
  const { anonPostWindowOf } = await import("../config");
  const { usedSlots } = await import("./slots");
  await hydrate();
  // only anon-post SUBMISSIONS hold a slot — never a reveal record, never a pending launch record (PERSONA LAUNCH P6)
  const items = [...state().zkQueue.values()]
    .filter((q) => q.mode === mode && q.claimKind === "anon-post")
    .map((q) => ({ window: anonPostWindowOf(q.epoch), slot: (q.envelope as { publicInputs?: { slot?: number } } | null)?.publicInputs?.slot ?? null, status: q.status, outcome: q.outcome }));
  return usedSlots(items, 0, anonPostWindowOf(epoch)).used;
}

// ---------- ANON REVIEW (R1-01, R3-07): the reveal secrets, as records of this namespace ----------
export const ATTRIBUTION_KIND = "anon-attribution";
const attributionId = (castHash: string) => "zka_" + castHash;

/**
 * What a sealed reveal record HOLDS (attributionRecord's answer). PERSONA LAUNCH wave 3 (L4): it no longer keeps the post's
 * TEXT. A reveal record is never pruned (the launch's batch reveal needs every secret), so 320 characters kept on each one
 * grew the sealed zkQueue with every anonymous post this device ever made — and its padding class with it, a size the
 * operator reads off each device-signed PUT. What the record keeps instead is `words`: a 128-bit hash of the post's words
 * as the replay guard compares them (sameAnonWords) — all the guard needs, a constant 32 hex. The text itself is public on
 * the anonymous list by cast hash once posted, and nothing on this device needs it before.
 */
export interface AttributionRecord {
  mode: ZkMode;
  castHash: string;
  secret: string;
  commitment: string;
  /** anonWordsHash(text) — null on a record written before wave 3 whose text was not folded yet (pruneSettledAnonItems) */
  words: string | null;
  at: number;
  /** PERSONA LAUNCH P3: the persona this anon post was made AS (null on a pre-P3 record). Sealed with the record and
   * kept in memory; it never leaves this device in any other form (lib/zk/queue.ts). */
  personaId: string | null;
  /** PERSONA LAUNCH P3 (PRIV-3): how its submission ended, once that submission was pruned (null while it is held) */
  settled?: { status: string; outcome: string | null; sentAt: number | null } | null;
}
/** what the composer hands putAttributionRecord: the text, hashed here and never stored */
export interface AttributionInput {
  mode: ZkMode;
  castHash: string;
  secret: string;
  commitment: string;
  text: string;
  at: number;
  personaId: string | null;
}
/** the sealed shape of `attribution` (lib/zk/queue.ts declares `text`; wave 3 writes it EMPTY and keeps `words` beside it) */
type SealedAttribution = NonNullable<QueuedSubmission["attribution"]> & { words?: string };

/** PERSONA LAUNCH P3 (PRIV-1): two texts a reader would call the same words — trimmed, runs of whitespace as one space,
 *  case folded — are the same words to the replay guard below */
export function sameAnonWords(a: string): string {
  return String(a).trim().replace(/\s+/g, " ").toLowerCase();
}
/** PERSONA LAUNCH wave 3 (L4): the words as the replay guard compares them, hashed — 32 hex (128 bits), domain-separated */
export function anonWordsHash(text: string): string {
  return createHash("sha256").update("layers-anon-words/1|" + sameAnonWords(text), "utf8").digest("hex").slice(0, 32);
}
/** a sealed record's words hash: its `words`, or (a record written before wave 3, not folded yet) the hash of its text */
function wordsOf(a: SealedAttribution): string | null {
  if (typeof a.words === "string" && /^[0-9a-f]{32}$/.test(a.words)) return a.words;
  return typeof a.text === "string" && a.text ? anonWordsHash(a.text) : null;
}

/** IN MEMORY ONLY: the record is persisted with the queue's own deferred write (enqueueSubmission → schedulePersist),
 * never at compose time — nothing identified leaves at the moment Post is pressed. */
export async function putAttributionRecord(rec: AttributionInput): Promise<void> {
  await hydrate();
  const attribution: SealedAttribution = { secret: rec.secret, commitment: rec.commitment, text: "", words: anonWordsHash(rec.text), ...(rec.personaId ? { personaId: rec.personaId } : {}) };
  const item: QueuedSubmission = {
    id: attributionId(rec.castHash),
    mode: rec.mode,
    claimKind: ATTRIBUTION_KIND,
    // the SUBMISSION field stays the constant: the persona rides only inside `attribution`, below
    personaId: "anon",
    epoch: 0,
    envelope: null, // never drained, never a submission
    notBefore: 0,
    motivatedAt: rec.at,
    createdAt: rec.at,
    status: "sent", // out of the drain's way; queueStatus filters the kind out
    sentAt: null,
    outcome: null,
    attribution,
  };
  state().zkQueue.set(item.id, item);
}

export async function attributionRecord(castHash: string): Promise<AttributionRecord | null> {
  await hydrate();
  const q = state().zkQueue.get(attributionId(castHash));
  if (!q || q.claimKind !== ATTRIBUTION_KIND || !q.attribution) return null;
  const a = q.attribution as SealedAttribution;
  return { mode: q.mode, castHash, secret: a.secret, commitment: a.commitment, words: wordsOf(a), at: q.createdAt, personaId: a.personaId ?? null, settled: a.settled ?? null };
}

/**
 * PERSONA LAUNCH P3 (PRIV-1) — did these words already come back from the validator as a REPLAY? A replay means the slot
 * the post took had its nullifier spent already: by this very post sent twice (it IS posted), or by another of this
 * person's posts — K slots are drawn per device, so two devices of one root can draw the same one
 * (A-ANON-SLOT-COLLISION-ACROSS-DEVICES). Either way the validator now holds (that nullifier, these words): posting the
 * same words again under a fresh slot would publish a post the operator can tie to the earlier one (or post it twice).
 * requestAnonPost refuses such words device-locally, before anything is minted. Reads the replay from the submission
 * while it is held and from its sealed reveal record once the submission was pruned (`settled`, PRIV-3). In memory
 * after hydrate: no I/O beyond what the compose path already does.
 *
 * PERSONA LAUNCH wave 3 (L7): and words whose envelope the validator RECEIVED AND REFUSED ("refused" / "malformed" after
 * a send). The validator read all of it — text, cast hash, ring note, arrival time — so the same words posted again
 * under a fresh slot let it join the published post to the refused submission (and its moment). A submission that never
 * reached it — queued, a transport error, or EXPIRED here before it was sent (expireStaleNoGraceItems) — blocks nothing:
 * nothing about it was seen.
 */
export type AnonWordsSeen = "replay" | "refused";
/** how a submission's answer bears on its words: null = the validator never received it, or took it */
function seenAs(status: string, outcome: string | null): AnonWordsSeen | null {
  if (status !== "sent") return null;
  if (outcome === "replay") return "replay";
  if (outcome === "refused" || outcome === "malformed") return "refused";
  return null;
}
export async function anonWordsSeen(text: string): Promise<AnonWordsSeen | null> {
  await hydrate();
  const want = sameAnonWords(text);
  if (!want) return null;
  const wantHash = anonWordsHash(text);
  const items = [...state().zkQueue.values()];
  const seen = new Map<string, AnonWordsSeen>();
  let found: AnonWordsSeen | null = null;
  // a replay outranks a refusal: its sentence says the words may already be posted
  const note = (how: AnonWordsSeen) => {
    if (found !== "replay") found = how;
  };
  for (const q of items) {
    if (q.claimKind === "anon-post") {
      const how = seenAs(q.status, q.outcome);
      if (!how) continue;
      const env = q.envelope as { publicInputs?: { castHash?: unknown }; payload?: { text?: unknown } } | null;
      if (typeof env?.payload?.text === "string" && sameAnonWords(env.payload.text) === want) note(how);
      if (typeof env?.publicInputs?.castHash === "string") seen.set(env.publicInputs.castHash, how);
    } else if (q.claimKind === ATTRIBUTION_KIND && q.attribution?.settled) {
      const how = seenAs(q.attribution.settled.status, q.attribution.settled.outcome);
      if (how) seen.set(q.id.slice("zka_".length), how);
    }
  }
  for (const q of items) {
    if (q.claimKind !== ATTRIBUTION_KIND || !q.attribution) continue;
    const how = seen.get(q.id.slice("zka_".length));
    if (how && wordsOf(q.attribution as SealedAttribution) === wantHash) note(how);
  }
  return found;
}
/** the PRIV-1 question alone: did these words come back as a REPLAY */
export async function anonWordsReplayed(text: string): Promise<boolean> {
  return (await anonWordsSeen(text)) === "replay";
}

/** PERSONA LAUNCH P3 (UX-2): this device's anon posts of `mode` the validator's counts do not hold yet — queued here, or
 *  sent and accepted after `since` (the moment the counts were read). The caller adds the posts still wanted. */
export async function anonPostsAhead(mode: ZkMode, since: number): Promise<number> {
  await hydrate();
  let n = 0;
  for (const q of state().zkQueue.values()) {
    if (q.mode !== mode || q.claimKind !== "anon-post") continue;
    if (q.status === "queued" || (q.status === "sent" && q.outcome === "accepted" && (q.sentAt ?? 0) > since)) n++;
  }
  return n;
}

/** "w<n>" → n (NaN for anything else) */
const windowNumber = (w: string) => (/^w\d{1,12}$/.test(w) ? Number(w.slice(1)) : Number.NaN);

/**
 * PERSONA LAUNCH P3 (PRIV-3) — PRUNE the anon submissions whose job is done. Each anon post used to leave its whole
 * submission (proof, public inputs, up to 320 characters of text: ~2 KiB) in the sealed zkQueue for good, so the record
 * — padded only to a KiB step — grew by a step or two per post, and its device-signed PUT told the operator each root's
 * anon post count and timing. A submission is dropped here once (a) its window has CLOSED (its slot no longer counts:
 * anonSlotsUsed reads only the current window) and (b) its outcome is FINAL (sent with an answer, or refused after its
 * attempts; a queued one will still be sent and is kept). How it ended is copied onto its sealed reveal record first
 * (`settled`: a few dozen bytes), which stays — the reveal (P6) needs the secret, the status line and the replay guard
 * read the outcome. Never a tier, fork or attestation submission (not this finding's; their counts are other suites'
 * evidence). Called from every prefetch tick with the tick's own snapshot (no fetch of its own); the change is
 * persisted on the queue's own random delay (a window boundary is public: pruning at it says nothing about a post).
 * Coarse padding classes for the record are the store's half (lib/adapters/mock/store.ts SERIALIZERS.zkQueue).
 */
export async function pruneSettledAnonItems(mode: ZkMode, epoch: number): Promise<number> {
  const { anonPostWindowOf } = await import("../config");
  await hydrate();
  const s = state();
  const current = windowNumber(anonPostWindowOf(epoch));
  if (!Number.isFinite(current)) return 0;
  let pruned = 0;
  // PERSONA LAUNCH wave 3 (L4): a reveal record written before wave 3 still carries its post's text — fold it to the
  // words hash here (every tick, from the tick's own snapshot), so the sealed record stops carrying lifetime text; the
  // change rides the queue's own deferred write like the prune below
  let folded = 0;
  for (const q of s.zkQueue.values()) {
    if (q.claimKind !== ATTRIBUTION_KIND || !q.attribution) continue;
    const a = q.attribution as SealedAttribution;
    if (typeof a.text === "string" && a.text) {
      const words = wordsOf(a);
      q.attribution = { ...a, text: "", ...(words ? { words } : {}) } as SealedAttribution;
      folded++;
    }
  }
  if (folded) schedulePersist();
  for (const q of [...s.zkQueue.values()]) {
    // anon-post submissions only: never a reveal record, never a pending launch record (PERSONA LAUNCH P6 — a launch
    // record lives until its launch is done, whatever window it was confirmed in)
    if (q.mode !== mode || q.claimKind !== "anon-post") continue;
    if (q.status !== "sent" && q.status !== "refused") continue; // a queued submission will still be sent
    const w = windowNumber(anonPostWindowOf(q.epoch));
    if (!Number.isFinite(w) || w >= current) continue; // its window is still open (or not yet: a clock that ran back)
    const castHash = (q.envelope as { publicInputs?: { castHash?: unknown } } | null)?.publicInputs?.castHash;
    if (typeof castHash === "string") {
      const rec = s.zkQueue.get(attributionId(castHash));
      if (rec && rec.claimKind === ATTRIBUTION_KIND && rec.attribution) {
        rec.attribution = { ...rec.attribution, settled: { status: q.status, outcome: q.outcome, sentAt: q.sentAt } };
      }
    }
    s.zkQueue.delete(q.id);
    pruned++;
  }
  if (pruned) schedulePersist();
  return pruned;
}

/** PERSONA LAUNCH P3 — the P6 seam (a launch reveals EVERY anon post of one persona at once, D7): the cast hashes this
 * device holds a reveal secret for that were posted AS this persona. Never the secrets; a pre-P3 record (no persona)
 * belongs to none. */
export async function attributionCastHashesFor(personaId: string): Promise<string[]> {
  await hydrate();
  if (typeof personaId !== "string" || !personaId) return [];
  return [...state().zkQueue.values()].filter((q) => q.claimKind === ATTRIBUTION_KIND && q.attribution?.personaId === personaId).map((q) => q.id.slice("zka_".length));
}

/** PERSONA LAUNCH P3: the persona each of these cast hashes was posted as, for THIS device's own status line (GET
 * /api/anon). Device-local; never sent anywhere. */
export async function attributionPersonas(): Promise<Map<string, string | null>> {
  await hydrate();
  const out = new Map<string, string | null>();
  for (const q of state().zkQueue.values()) if (q.claimKind === ATTRIBUTION_KIND && q.attribution) out.set(q.id.slice("zka_".length), q.attribution.personaId ?? null);
  return out;
}

/** a post that will never be sent keeps no secret (the orphan R3-02 named); persisted on the deferred write */
export async function deleteAttributionRecord(castHash: string): Promise<boolean> {
  await hydrate();
  const had = state().zkQueue.delete(attributionId(castHash));
  if (had) schedulePersist();
  return had;
}

/** PERSONA LAUNCH P6 — the batch reveal reads every reveal SECRET of one persona's anon posts (lib/launch/reveal.ts), and
 *  nothing else ever does: in memory, after hydrate; never logged, never in a response. (Wave 3, L4: no text — the record
 *  keeps none; the reveal names posts by cast hash.) */
export async function attributionSecretsFor(personaId: string, mode: ZkMode): Promise<Array<{ castHash: string; secret: string; at: number }>> {
  await hydrate();
  if (typeof personaId !== "string" || !personaId) return [];
  const out: Array<{ castHash: string; secret: string; at: number }> = [];
  for (const q of state().zkQueue.values()) {
    if (q.claimKind !== ATTRIBUTION_KIND || !q.attribution || q.attribution.personaId !== personaId || q.mode !== mode) continue;
    out.push({ castHash: q.id.slice("zka_".length), secret: q.attribution.secret, at: q.createdAt });
  }
  return out;
}

// ---------- PERSONA LAUNCH P6: the PENDING LAUNCH, a record kind of this sealed namespace ----------
//
// A confirmed launch is written NOWHERE at the click: the record below is minted in memory and persisted only on the
// queue's own deferred write (schedulePersist — 30 s to 15 min later), exactly like an anon post's reveal secret. A
// namespace of its own written at confirm time would be the click beacon the launch's random timing exists to hide.
// The record is not a submission: envelope null, status "sent" (out of the drain's way), never counted by
// anonSlotsUsed, never pruned by pruneSettledAnonItems, never listed by queueStatus. lib/launch/tick.ts walks it
// through registration, the batch reveal, the profile and the history — and it STAYS after "done": from registration
// on it is the launched account's one record (PERSONA LAUNCH P6, fix LP-1: lib/fc/personaFid.ts reads the account from
// it; nothing writes personaFids at a launch step, so no device-signed PUT lines up with the public registration).
export const LAUNCH_KIND = "persona-launch-pending";
const launchId = (launchCommit: string) => "zkl_" + launchCommit;

export type LaunchStage = "proving" | "queued" | "submitted" | "waiting" | "registered" | "revealed" | "profiled" | "history" | "done" | "failed";

export interface PendingLaunch {
  mode: ZkMode;
  personaId: string;
  launchCommit: string;
  /** the canonical request (public fields only — sealed here anyway: it names the persona's future account) */
  request: string;
  custody: string;
  recovery: string;
  signerKey: string;
  fname: string;
  profile: { displayName: string; bio: string; pfpUrl: string };
  /** the anon posts (internal cast hashes) chosen in the preview for the launch history's quote-casts, at most 10 */
  quoteOriginals: string[];
  /** the anon window ("w<n>") the launch was confirmed in — one launch per person per window */
  window: string | null;
  /** the click (sealed; never sent anywhere) */
  confirmedAt: number;
  stage: LaunchStage;
  stageAt: number;
  /** the jittered moment the next step may run (lib/launch/tick.ts) */
  nextAt: number;
  fid: number | null;
  registeredHour: number | null;
  batchHash: string | null;
  revealed: number;
  history: { launchCastHash: string | null; quoted: string[] };
  attempts: number;
  /** the last refusal or failure, in words (null when none) */
  reason: string | null;
  log: Array<{ at: number; stage: string; note: string }>;
  /** PERSONA LAUNCH P6 (fix LP-1): the name the simulated name server ACCEPTED for the account (null until then). The
   *  launched account's facts — fid, custody, recovery, signer, name — live HERE, in the sealed queue on its deferred
   *  write, never in an immediate personaFids save: lib/fc/personaFid.ts reads them from this record (its merged view) */
  fnameSet?: string | null;
  /** PERSONA LAUNCH P6 (fix W2-LAUNCH-NO-ADOPTION): rebuilt from the uniform registrations read because this device had
   *  no record of the launch (lost in a restart) — the click, the request and the quote picks are unknown */
  adopted?: boolean;
  /** PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200): the reveal's batch hashes, when it took more than one batch */
  batchHashes?: string[];
  /** PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200): what the reveal left out, and why — never silently */
  leftOut?: { notRelayed: number; refused: number } | null;
}

/**
 * PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200) — how each anon post's SUBMISSION ended, device-local (this queue's
 * submissions, or the `settled` copy on its sealed reveal record once the submission was pruned), so a launch tells
 * "still on the way" from "never posted":
 *   queued    proved and waiting for its random moment — or not proved yet (no submission: still wanted)
 *   accepted  the validator took it (relayed, or about to be)
 *   replay    its slot's nullifier was already spent: posted by an earlier send of itself, or never (the public list
 *             decides which)
 *   refused   the anonymous channel or the validator refused it: it was never posted and never will be
 * In memory after hydrate; nothing is fetched or written.
 */
export type AnonPostOutcome = "queued" | "accepted" | "replay" | "refused";
export async function anonPostOutcomes(castHashes: string[]): Promise<Map<string, AnonPostOutcome>> {
  await hydrate();
  const want = new Set(castHashes);
  const out = new Map<string, AnonPostOutcome>();
  const classify = (status: string, outcome: string | null): AnonPostOutcome =>
    status === "queued" ? "queued" : status === "sent" && outcome === "accepted" ? "accepted" : status === "sent" && outcome === "replay" ? "replay" : "refused";
  for (const q of state().zkQueue.values()) {
    if (q.claimKind !== "anon-post") continue;
    const h = (q.envelope as { publicInputs?: { castHash?: unknown } } | null)?.publicInputs?.castHash;
    if (typeof h === "string" && want.has(h)) out.set(h, classify(q.status, q.outcome));
  }
  for (const h of want) {
    if (out.has(h)) continue;
    const settled = state().zkQueue.get(attributionId(h))?.attribution?.settled;
    out.set(h, settled ? classify(settled.status, settled.outcome) : "queued");
  }
  return out;
}

type LaunchItem = QueuedSubmission & { launch?: PendingLaunch };

/** IN MEMORY; persisted only on the queue's own deferred schedule */
export async function putLaunchRecord(rec: PendingLaunch): Promise<void> {
  await hydrate();
  const item: LaunchItem = {
    id: launchId(rec.launchCommit),
    mode: rec.mode,
    claimKind: LAUNCH_KIND,
    personaId: "anon", // the SUBMISSION field stays the constant: the persona rides only inside `launch`
    epoch: 0,
    envelope: null,
    notBefore: 0,
    motivatedAt: rec.confirmedAt,
    createdAt: rec.confirmedAt,
    status: "sent",
    sentAt: null,
    outcome: null,
    launch: { ...rec },
  };
  state().zkQueue.set(item.id, item);
  schedulePersist();
}

export async function launchRecords(): Promise<PendingLaunch[]> {
  await hydrate();
  const out: PendingLaunch[] = [];
  for (const q of state().zkQueue.values()) {
    const l = (q as LaunchItem).launch;
    if (q.claimKind === LAUNCH_KIND && l) out.push({ ...l, history: { ...l.history, quoted: [...l.history.quoted] }, log: [...l.log] });
  }
  return out;
}

export async function launchRecord(launchCommit: string): Promise<PendingLaunch | null> {
  await hydrate();
  const q = state().zkQueue.get(launchId(launchCommit)) as LaunchItem | undefined;
  return q && q.claimKind === LAUNCH_KIND && q.launch ? { ...q.launch } : null;
}

/** patch a launch record IN MEMORY and schedule the deferred persist (never an immediate write) */
export async function updateLaunchRecord(launchCommit: string, patch: Partial<PendingLaunch>, note?: string): Promise<PendingLaunch | null> {
  await hydrate();
  const q = state().zkQueue.get(launchId(launchCommit)) as LaunchItem | undefined;
  if (!q || q.claimKind !== LAUNCH_KIND || !q.launch) return null;
  const next: PendingLaunch = { ...q.launch, ...patch };
  if (patch.stage && patch.stage !== q.launch.stage) next.stageAt = Date.now();
  if (note) next.log = [...q.launch.log, { at: Date.now(), stage: next.stage, note }].slice(-30);
  q.launch = next;
  state().zkQueue.set(q.id, q);
  schedulePersist();
  return { ...next };
}

// ---------- PERSONA LAUNCH P8: the ANONYMOUS X COPY, a record kind of this sealed namespace ----------
//
// An X copy ("also post to @totem on X") is proved like an anon post (claim kind x-anon-post, its OWN slot) and its
// SUBMISSION is an ordinary queued item of that kind. What only this device may know about it — WHICH persona sent it and
// which Farcaster anon post it copies — rides a sealed record of its own here (no new namespace: unit-namespace-sizes
// requires every Namespace in its table, and a namespace named for X would announce an X copy on the validator's wire).
// Like the reveal secret: minted IN MEMORY at compose, persisted only on the queue's own deferred write. Not a submission
// (envelope null, status "sent"): never drained, never counted by xSlotsUsed or anonSlotsUsed, never listed by
// queueStatus. It keeps no text and no nonce (the public list shows the text once posted; nothing else needs it).
export const X_RECORD_KIND = "x-anon-record";
const xRecordId = (xHash: string) => "zkx_" + xHash;

export interface XRecord {
  mode: ZkMode;
  xHash: string;
  /** the persona this copy was sent AS (device-local; never on the envelope, the wire or a validator row) */
  personaId: string | null;
  /** the Farcaster anon post (its cast hash) this copy repeats, when it is a copy */
  copyOf: string | null;
  at: number;
  /** how its submission ended, once that submission was pruned (null while it is held) */
  settled?: { status: string; outcome: string | null; sentAt: number | null } | null;
}
type XItem = QueuedSubmission & { x?: { personaId?: string; copyOf?: string; settled?: { status: string; outcome: string | null; sentAt: number | null } } };

/** IN MEMORY ONLY: persisted with the queue's deferred write (the X submission's enqueue schedules it) */
export async function putXRecord(rec: XRecord): Promise<void> {
  await hydrate();
  const item: XItem = {
    id: xRecordId(rec.xHash),
    mode: rec.mode,
    claimKind: X_RECORD_KIND,
    personaId: "anon", // the SUBMISSION field stays the constant: the persona rides only inside `x`
    epoch: 0,
    envelope: null,
    notBefore: 0,
    motivatedAt: rec.at,
    createdAt: rec.at,
    status: "sent",
    sentAt: null,
    outcome: null,
    x: { ...(rec.personaId ? { personaId: rec.personaId } : {}), ...(rec.copyOf ? { copyOf: rec.copyOf } : {}) },
  };
  state().zkQueue.set(item.id, item);
}

function xRecordOf(q: XItem): XRecord | null {
  if (q.claimKind !== X_RECORD_KIND || !q.x) return null;
  return { mode: q.mode, xHash: q.id.slice("zkx_".length), personaId: q.x.personaId ?? null, copyOf: q.x.copyOf ?? null, at: q.createdAt, settled: q.x.settled ?? null };
}
export async function xRecord(xHash: string): Promise<XRecord | null> {
  await hydrate();
  const q = state().zkQueue.get(xRecordId(xHash)) as XItem | undefined;
  return q ? xRecordOf(q) : null;
}
/** every X copy this device sent (of one universe when `mode` is given), newest first */
export async function xRecords(mode?: ZkMode): Promise<XRecord[]> {
  await hydrate();
  const out: XRecord[] = [];
  for (const q of state().zkQueue.values()) {
    const r = xRecordOf(q as XItem);
    if (r && (!mode || r.mode === mode)) out.push(r);
  }
  return out.sort((a, b) => b.at - a.at);
}
/** a copy that will never be sent keeps no record; persisted on the deferred write */
export async function deleteXRecord(xHash: string): Promise<boolean> {
  await hydrate();
  const had = state().zkQueue.delete(xRecordId(xHash));
  if (had) schedulePersist();
  return had;
}
/** the X submissions this device holds (status only — the envelope stays here) */
export async function xSubmissionItems(): Promise<Array<{ id: string; xHash: string | null; status: string; outcome: string | null; epoch: number; mode: ZkMode; sentAt: number | null }>> {
  await hydrate();
  return [...state().zkQueue.values()]
    .filter((q) => q.claimKind === "x-anon-post")
    .map((q) => ({ id: q.id, xHash: ((q.envelope as { publicInputs?: { xHash?: string } } | null)?.publicInputs?.xHash ?? null) as string | null, status: q.status, outcome: q.outcome, epoch: q.epoch, mode: q.mode, sentAt: q.sentAt }));
}
/**
 * PERSONA LAUNCH P8 (D-X-SLOTS): the X SLOTS of the window this epoch falls in that this person has spent — every X copy
 * this device queued, whatever persona it was sent as. Only x-anon-post submissions hold one (an anon post never does,
 * and anonSlotsUsed never counts an X copy: the two budgets are apart). Held = queued, or sent and accepted/replayed.
 */
export async function xSlotsUsed(mode: ZkMode, epoch: number): Promise<Set<number>> {
  const { anonPostWindowOf } = await import("../config");
  const { usedSlots } = await import("./slots");
  await hydrate();
  const items = [...state().zkQueue.values()]
    .filter((q) => q.mode === mode && q.claimKind === "x-anon-post")
    .map((q) => ({ window: anonPostWindowOf(q.epoch), slot: (q.envelope as { publicInputs?: { slot?: number } } | null)?.publicInputs?.slot ?? null, status: q.status, outcome: q.outcome }));
  return usedSlots(items, 0, anonPostWindowOf(epoch)).used;
}
/**
 * PERSONA LAUNCH P8 — PRUNE the X submissions whose job is done, as PRIV-3 does for anon posts: a closed window's X
 * submission with a final outcome is dropped (its slot no longer counts), after its outcome is copied onto its sealed X
 * record (`settled`), which stays for the status line. A queued one is kept. Called from every tick with the tick's own
 * snapshot; persisted on the deferred schedule.
 */
export async function pruneSettledXItems(mode: ZkMode, epoch: number): Promise<number> {
  const { anonPostWindowOf } = await import("../config");
  await hydrate();
  const s = state();
  const open = windowNumber(anonPostWindowOf(epoch));
  if (!Number.isFinite(open)) return 0;
  let dropped = 0;
  for (const q of [...s.zkQueue.values()]) {
    if (q.mode !== mode || q.claimKind !== "x-anon-post") continue;
    if (q.status === "queued") continue; // it will still be sent
    const its = windowNumber(anonPostWindowOf(q.epoch));
    if (!(Number.isFinite(its) && its < open)) continue; // only a CLOSED window's
    const xHash = (q.envelope as { publicInputs?: { xHash?: unknown } } | null)?.publicInputs?.xHash;
    if (typeof xHash === "string") {
      const rec = s.zkQueue.get(xRecordId(xHash)) as XItem | undefined;
      if (rec && rec.claimKind === X_RECORD_KIND && rec.x) rec.x = { ...rec.x, settled: { status: q.status, outcome: q.outcome, sentAt: q.sentAt } };
    }
    s.zkQueue.delete(q.id);
    dropped++;
  }
  if (dropped) schedulePersist();
  return dropped;
}

/** the cast hashes THIS device holds a reveal secret for — never the secrets themselves */
export async function attributionCastHashes(): Promise<string[]> {
  await hydrate();
  return [...state().zkQueue.values()].filter((q) => q.claimKind === ATTRIBUTION_KIND && q.attribution).map((q) => q.id.slice("zka_".length));
}

/** MULTI-FID Gate 4: the anon posts this device queued — status only, never the text (the composer's
 * "queued / relayed" line reads this; the relayed cast itself is public on the validator) */
export async function anonPostItems(): Promise<Array<{ id: string; castHash: string | null; status: string; outcome: string | null; epoch: number; notBefore: number; sentAt: number | null; personaId: string | null }>> {
  await hydrate();
  // PERSONA LAUNCH P3: the persona each post was made as, from its sealed attribution record (device-local)
  const personaOf = await attributionPersonas();
  return [...state().zkQueue.values()]
    .filter((q) => q.claimKind === "anon-post")
    .map((q) => {
      const castHash = (q.envelope as { publicInputs?: { castHash?: string } } | null)?.publicInputs?.castHash ?? null;
      return {
        id: q.id,
        castHash,
        status: q.status,
        outcome: q.outcome,
        epoch: q.epoch,
        notBefore: q.notBefore,
        sentAt: q.sentAt,
        personaId: castHash ? personaOf.get(castHash) ?? null : null,
      };
    });
}

export async function enqueueSynthetic(count: number, motivatedAts: number[], window: { lo: number; hi: number }, epochShape?: EpochShape | null): Promise<QueuedSubmission[]> {
  await hydrate();
  let ep: EpochShape | null = null;
  if (epochShape === undefined) {
    try {
      const e = await fetchEpoch("fixture");
      ep = { epochMs: e.epochMs, msRemaining: e.msRemaining };
    } catch {
      ep = null;
    }
  } else {
    ep = epochShape;
  }
  const w = jitterWindow(window.lo, window.hi, ep);
  const out: QueuedSubmission[] = [];
  for (let i = 0; i < count; i++) {
    const now = Date.now();
    const item: QueuedSubmission = {
      id: "zkq_synthetic_" + randomBytes(6).toString("hex"),
      mode: "fixture",
      claimKind: "tier-membership",
      personaId: "synthetic",
      epoch: 0,
      envelope: null,
      notBefore: now + uniformInt(w.lo, w.hi),
      motivatedAt: motivatedAts[i] ?? now,
      createdAt: now,
      status: "refused", // never drained
      sentAt: null,
      outcome: "synthetic",
    };
    state().zkQueue.set(item.id, item);
    out.push(item);
  }
  await persistNs("zkQueue");
  return out;
}

export interface DrainReport {
  due: number;
  sent: number;
  outcomes: Record<string, number>;
}

const g = globalThis as unknown as {
  __layersZkDrainTimer?: NodeJS.Timeout | null;
  __layersZkPersistTimer?: NodeJS.Timeout | null;
  __layersZkDrainInFlight?: Promise<DrainReport> | null;
  /** PERSONA LAUNCH P7: the browser device's boot re-jitter has run (once per device start) */
  __layersZkBootRejittered?: boolean;
  /** PERSONA LAUNCH wave 3 (L7): the last tick's epoch per universe (noteCurrentEpoch) */
  __layersZkCurrentEpoch?: Partial<Record<ZkMode, number>>;
};

/** Persist the queue on its OWN random delay — never at send time. One
 * pending timer covers every send that happens before it fires. */
export function schedulePersist(): void {
  if (g.__layersZkPersistTimer) return;
  const t = setTimeout(() => {
    g.__layersZkPersistTimer = null;
    persistNs("zkQueue").catch(() => schedulePersist());
  }, uniformInt(ZK_JITTER_MIN_MS, ZK_JITTER_MAX_MS));
  t.unref?.();
  g.__layersZkPersistTimer = t;
}

/** Send every due `queued` item. Marks `sent` (with the outcome) or leaves
 * a transport-error item queued for a later drain (max 3 attempts, then
 * `refused`). Never touches `sent` items. */
/**
 * limit — how many due items one drain may send. The in-process loop sends
 * ONE per tick, chosen uniformly at random among the due items: two
 * submissions from this process are then never back-to-back on the wire
 * and their order says nothing about the queue. (Closing series 4, z4 #4:
 * a drain that flushed every due item sent a root's two personas 150–330 ms
 * apart, and the sibling was the nearest-in-time submission to the other's
 * in half the trials — the per-item jitter had been collapsed by the batch.)
 * A rig flush (the dev action) may pass Infinity.
 */
export async function drainQueue(now = Date.now(), limit = 1): Promise<DrainReport> {
  // ONE drain at a time, strictly in order. The in-process loop
  // (ensureDrainLoop, every 5 s) and an explicit drain (the dev action) used
  // to run concurrently: both selected the same due item while the first
  // send was still in flight, so one envelope reached the validator twice —
  // accepted, then "replay" (attestation pass, closing series 2, sweep 2,
  // z2 #3). A later caller runs after the in-flight drain and sends only
  // what is still due; an item is sent exactly once.
  const prev: Promise<unknown> = g.__layersZkDrainInFlight ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => drainOnce(now, limit));
  g.__layersZkDrainInFlight = run;
  try {
    return await run;
  } finally {
    if (g.__layersZkDrainInFlight === run) g.__layersZkDrainInFlight = null;
  }
}

/**
 * PERSONA LAUNCH P7 (the prover's seam, landed by xout) — THE BOOT RE-JITTER, BROWSER DEVICE ONLY. A tab closed while a
 * submission was queued reopens with that submission OVERDUE, and the first drain would send it at once — inside the
 * reopened tab's identified boot burst (the device's signed reads and writes of its first seconds), which pairs the
 * anonymous send with the device that made it. So on the FIRST drain after this device starts, every queued item whose
 * moment has already passed is given a fresh one: now + a CSPRNG draw over the configured window, clamped by the epoch
 * shape the item was queued under (jitterWindow, as at enqueue; an item queued without one, or whose shape is now
 * implausible, keeps the configured window), and the queue is persisted on its own deferred schedule. The node rig's
 * drain is unchanged (device-restart and z5 rely on it): this runs only where `window` exists. Returns how many moved.
 */
export function rejitterOverdueOnBoot(now: number): number {
  const s = state();
  let moved = 0;
  for (const q of s.zkQueue.values()) {
    if (q.status !== "queued" || !q.envelope || q.notBefore > now) continue;
    const je = (q as QueuedSubmission & { jitterEpoch?: JitterEpoch }).jitterEpoch;
    let w: JitterWindow;
    try {
      w = jitterWindow(ZK_JITTER_MIN_MS, ZK_JITTER_MAX_MS, je ? { epochMs: je.epochMs, msRemaining: Math.min(je.epochMs, Math.max(0, je.endsAt - now)) } : null);
    } catch {
      w = jitterWindow(ZK_JITTER_MIN_MS, ZK_JITTER_MAX_MS, null);
    }
    // W3-REJITTER-NO-GRACE: a no-grace item's new moment stays before its epoch's end (boundedSendMoment); an item
    // whose epoch is already over keeps its moment — the expiry sweep that runs first never lets it reach the wire
    const m = boundedSendMoment(now, w, NO_GRACE_KINDS.has(q.claimKind), je?.endsAt ?? null);
    if (m === null) continue;
    q.notBefore = m;
    s.zkQueue.set(q.id, q);
    moved++;
  }
  if (moved) schedulePersist();
  return moved;
}

/**
 * PERSONA LAUNCH wave 3 (L7) — A NO-GRACE SUBMISSION WHOSE EPOCH HAS ENDED IS NEVER PUT ON THE WIRE. The validator gives
 * an anon post, an X copy and a launch request no epoch grace (validator/zk.js), so sending one after its epoch only
 * hands the operator its whole body — text, cast hash, ring note — and its arrival time (on a reopened browser tab, the
 * boot burst's) for a refusal; reposting the same words then lets it join the published post to that stale send. So,
 * before every drain picks anything, a queued no-grace item is EXPIRED HERE when its epoch is over by this device's own
 * knowledge: its jitterEpoch has ended (`now` is the REAL clock — a rig's "drain as if at now + 24 h" never expires
 * anything), or the last tick's snapshot (`currentEpochOf`) already reads a later epoch. Nothing is sent:
 *   anon-post, x-anon-post  status 'refused', outcome 'expired', sentAt null — the status lines say it was never sent
 *                           and may be posted again (the words guard ignores it: nothing about it was seen)
 *   persona-launch          the queue item is dropped; its sealed launch record stays, and lib/launch/tick.ts finds no
 *                           submission and asks for the proof again from that record (the next window's)
 * Returns how many were expired; the change rides the queue's own deferred write.
 */
export function expireStaleNoGraceItems(now: number, currentEpochOf: (mode: ZkMode) => number | null = () => null): number {
  const s = state();
  let expired = 0;
  for (const q of [...s.zkQueue.values()]) {
    if (q.status !== "queued" || !q.envelope || !NO_GRACE_KINDS.has(q.claimKind)) continue;
    const je = (q as QueuedSubmission & { jitterEpoch?: JitterEpoch }).jitterEpoch;
    const cur = currentEpochOf(q.mode);
    const over = (je !== undefined && Number.isFinite(je.endsAt) && now >= je.endsAt) || (typeof cur === "number" && Number.isFinite(cur) && q.epoch < cur);
    if (!over) continue;
    if (q.claimKind === "persona-launch") s.zkQueue.delete(q.id);
    else {
      q.status = "refused";
      q.outcome = "expired";
      q.sentAt = null;
      s.zkQueue.set(q.id, q);
    }
    expired++;
  }
  if (expired) schedulePersist();
  return expired;
}

/**
 * PERSONA LAUNCH wave 3 (W3-DRAIN-NOT-RESUMED) — RESTART THE DRAIN LOOP FOR WHAT A RESTART LEFT QUEUED. The loop used to
 * start only after an enqueue in this process, so a queued anon post, X copy or launch request hydrated after a reload
 * or a restart waited until something NEW was queued — forever, on a device that posts nothing else (and a launch then
 * sat at "queued" for good). Every prefetch tick calls this (lib/zk/gate.ts runWantedProofs, before anything else): when
 * the sealed queue holds a queued item with an envelope, the loop is armed. The loop itself sends one due item per round
 * on its own cadence (and the browser's first drain re-jitters what is overdue), so arming it at a tick adds nothing
 * identifiable to that tick. Returns whether something was waiting.
 */
export async function resumeDrainIfQueued(tick?: { mode: ZkMode; epoch: number }): Promise<boolean> {
  // the tick's epoch first: the drain the loop is about to run expires what that epoch has left behind (L7)
  if (tick) noteCurrentEpoch(tick.mode, tick.epoch);
  await hydrate();
  for (const q of state().zkQueue.values()) {
    if (q.status === "queued" && q.envelope) {
      ensureDrainLoop();
      return true;
    }
  }
  return false;
}

/**
 * PERSONA LAUNCH wave 3 (L7): the epoch the LAST prefetch tick read, per universe — recorded by that tick
 * (lib/zk/gate.ts runWantedProofs → resumeDrainIfQueued), read by the expiry sweep. Kept here, not read from
 * lib/zk/prefetch.ts: this module must not import the tick (every harness that bundles the queue would pull in the whole
 * device). Cleared with the zk runtime (resetCurrentEpochs, lib/zk/gate.ts resetZkRuntimeOverrides): a reset universe
 * may restart at a LOWER epoch, and a stale higher one would expire every new item until the next tick.
 */
export function noteCurrentEpoch(mode: ZkMode, epoch: number): void {
  if (!Number.isInteger(epoch) || epoch < 0) return;
  (g.__layersZkCurrentEpoch ??= {})[mode] = epoch;
}
export function currentEpochOf(mode: ZkMode): number | null {
  return g.__layersZkCurrentEpoch?.[mode] ?? null;
}
export function resetCurrentEpochs(): void {
  g.__layersZkCurrentEpoch = {};
}

async function drainOnce(now: number, limit: number): Promise<DrainReport> {
  await hydrate();
  const s = state();
  // PERSONA LAUNCH wave 3 (L7): expire what can no longer be accepted BEFORE the boot re-jitter and the pick — the real
  // clock and the last tick's epoch (never the caller's `now`, which a rig moves forward to flush the queue)
  expireStaleNoGraceItems(Date.now(), currentEpochOf);
  // PERSONA LAUNCH P7: the first drain after a BROWSER device starts re-jitters what is overdue (never on the node rig)
  if (typeof window !== "undefined" && !g.__layersZkBootRejittered) {
    g.__layersZkBootRejittered = true;
    rejitterOverdueOnBoot(Date.now());
  }
  const due = [...s.zkQueue.values()].filter((q) => q.status === "queued" && q.notBefore <= now && q.envelope);
  const report: DrainReport = { due: due.length, sent: 0, outcomes: {} };
  // a random subset of the due items (all of them when limit covers them):
  // Fisher–Yates on a copy, CSPRNG, then the first `limit`
  const pick = [...due];
  for (let i = pick.length - 1; i > 0; i--) {
    const j = uniformInt(0, i);
    [pick[i], pick[j]] = [pick[j], pick[i]];
  }
  for (const q of pick.slice(0, Math.max(0, Math.min(pick.length, limit)))) {
    const r = await submitAnonymous(q.envelope as ProofEnvelope);
    const attempts = ((q as QueuedSubmission & { attempts?: number }).attempts ?? 0) + 1;
    if (r.outcome === "transport-error" && attempts < 3) {
      (q as QueuedSubmission & { attempts?: number }).attempts = attempts;
      // back off a random slice of the window, not a fixed delay
      q.notBefore = now + uniformInt(1_000, 30_000);
    } else {
      q.status = r.outcome === "transport-error" ? "refused" : "sent";
      q.sentAt = Date.now();
      q.outcome = r.outcome;
      report.sent++;
    }
    report.outcomes[r.outcome] = (report.outcomes[r.outcome] ?? 0) + 1;
    s.zkQueue.set(q.id, q);
  }
  if (due.length) schedulePersist();
  return report;
}

export interface QueueStatus {
  queued: number;
  sent: number;
  refused: number;
  nextDueInMs: number | null;
  persistPending: boolean;
  items: Array<Pick<QueuedSubmission, "id" | "status" | "notBefore" | "motivatedAt" | "sentAt" | "outcome" | "personaId" | "epoch">>;
}

export async function queueStatus(): Promise<QueueStatus> {
  await hydrate();
  // the attribution records are not submissions: never counted, never listed — nor are pending launch records (P6)
  // PERSONA LAUNCH P8: nor are the sealed X records (an X copy's SUBMISSION, claim kind x-anon-post, is listed like any other)
  const items = [...state().zkQueue.values()].filter((q) => q.claimKind !== ATTRIBUTION_KIND && q.claimKind !== LAUNCH_KIND && q.claimKind !== X_RECORD_KIND);
  const queued = items.filter((q) => q.status === "queued");
  const next = queued.length ? Math.min(...queued.map((q) => q.notBefore)) - Date.now() : null;
  return {
    queued: queued.length,
    sent: items.filter((q) => q.status === "sent").length,
    refused: items.filter((q) => q.status === "refused").length,
    nextDueInMs: next,
    persistPending: !!g.__layersZkPersistTimer,
    items: items.map((q) => ({ id: q.id, status: q.status, notBefore: q.notBefore, motivatedAt: q.motivatedAt, sentAt: q.sentAt, outcome: q.outcome, personaId: q.personaId, epoch: q.epoch })),
  };
}

/** The in-process drain loop: started lazily, once, on first use. Idle
 * work only — it is the only thing that ever calls submitAnonymous. */
export function ensureDrainLoop(intervalMs = 5_000): void {
  if (g.__layersZkDrainTimer) return;
  g.__layersZkDrainTimer = setInterval(() => {
    drainQueue().catch(() => {
      /* a failed drain is retried next tick; nothing is lost (persisted) */
    });
  }, intervalMs);
  g.__layersZkDrainTimer.unref?.();
}

/**
 * IN-PROCESS self-test of the scheduler, computed for the privacy label
 * at read time (never a stamp a caller can write): (a) a hostile epoch
 * shape is REFUSED, not collapsed to a fixed offset; (b) a legitimate
 * clamp keeps at least the minimum spread; (c) offsets drawn over the
 * configured window are spread and distinct. It evidences the SCHEDULER,
 * not the wire — SECURITY-POSTURE.md A-DECORRELATION-IS-SCHEDULER-LEVEL.
 */
export function jitterSelfTest(): { ok: boolean; detail: string } {
  const problems: string[] = [];
  for (const hostile of [
    { epochMs: 0, msRemaining: 0 },
    { epochMs: Number.NaN, msRemaining: 0 },
    { epochMs: ZK_EPOCH_MIN_MS - 1, msRemaining: 0 },
    { epochMs: 6 * 3600_000, msRemaining: -1 },
  ]) {
    let threw = false;
    try {
      jitterWindow(ZK_JITTER_MIN_MS, ZK_JITTER_MAX_MS, hostile);
    } catch {
      threw = true;
    }
    if (!threw) problems.push(`hostile epoch shape ${JSON.stringify(hostile)} was not refused`);
  }
  try {
    const w = jitterWindow(ZK_JITTER_MIN_MS, ZK_JITTER_MAX_MS, { epochMs: 6 * 3600_000, msRemaining: 0 });
    if (w.hi - w.lo < w.minSpread) problems.push("epoch clamp collapsed the window below the minimum spread");
  } catch (e) {
    problems.push("legitimate clamp threw: " + (e as Error).message);
  }
  const span = ZK_JITTER_MAX_MS - ZK_JITTER_MIN_MS;
  const draws = Array.from({ length: 64 }, () => uniformInt(ZK_JITTER_MIN_MS, ZK_JITTER_MAX_MS));
  const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
  const sd = Math.sqrt(draws.reduce((a, b) => a + (b - mean) ** 2, 0) / draws.length);
  if (sd < 0.15 * span) problems.push(`offsets barely vary (sd ${Math.round(sd)} ms over a ${span} ms window)`);
  if (new Set(draws).size < 60) problems.push("offsets repeat");
  return problems.length ? { ok: false, detail: problems.join("; ") } : { ok: true, detail: `hostile epoch shapes refused; clamp keeps ≥ ${Math.max(1000, Math.ceil(span * 0.25))} ms spread; 64 draws over ${span} ms: sd ${Math.round(sd)} ms, all distinct` };
}
