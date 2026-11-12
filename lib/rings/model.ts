// PERSONA LAUNCH P4 — RINGS: THE MODEL, written down (plan §2.4, R8, D8; spec research/spec-friend-whitelist-2026-10-08.txt
// adapted from one-owner-service "friends" to every device's "rings").
//
//   * A ROOT keeps up to 16 named RINGS ("Inner", "Close", ...). A ring's MEMBERS are other people's private addresses
//     ("LR1." + base64url(addrId | X25519 pk | PSK), handed over Signal or in person) or link-friends (a /d#<key> link
//     for someone without Totem). A member is a RECIPIENT, never an identity: the owner's device learns an address,
//     not who holds it.
//   * Per (ring, persona) a DEPTH:
//       "name"  — the ring's members learn that @persona is this root: the half-and-half avatar (root left, persona
//                 right) on that persona's own cards and profile;
//       "posts" — also WHICH @anon posts the persona wrote (ring notes, lib/rings/note.ts).
//   * NOTE KEYS ARE PER (persona, generation), shared by every ring that holds the persona at "posts" — one 256-byte
//     note per post, never one per ring, so a post's note says nothing about how many rings see it. Each generation
//     has a fixed audience, and the generations form ONE-WAY CHAINS (W2-RINGS-KEEP3-HISTORY-LOSS):
//       - the audience GROWS (a member added to a ring that holds the persona at "posts", a ring with members raised to
//         "posts"): `advance` — the next generation is one HKDF step along the current chain. Everyone already in the
//         audience steps forward from the key it holds; the newcomer is sealed the new key and cannot step back, so it
//         never opens a post made before it joined, and the others lose NOTHING (the first cut drew a fresh random key
//         per add and kept three, so three routine adds erased every member's history);
//       - the audience SHRINKS (a member revoked, a ring lowered or deleted): `rotate` — a fresh RANDOM chain head that
//         no one outside the remaining audience can reach. A revoked member keeps the keys it already had
//         (A-RING-REVOKED-KEEP-OLD-KEYS) and opens nothing posted after the revoke;
//       - a chain holds at most NOTE_SEGMENT_MAX_GENS generations (then `advance` starts a fresh one), and the owner
//         keeps the newest KEEP_NOTE_SEGMENTS chains. A member is sealed, per chain that overlaps its time in the
//         audience, the key of its first generation and a step count rounded up to 4 — never a generation number
//         (LP-5). So history survives every add; it is bounded only by two revokes/lowerings (or ~64 adds) since the
//         member joined, which the fixed 4096-byte envelope cannot carry beyond.
//   * ADMISSIBLE SUBJECTS: this device's own PUBLIC personas, and the main account read ONLY through rootHeadshot()
//     (lib/identity/rootHeadshot.ts) as the envelope's `root`. Refused: private personas, the read-only public self
//     (it is main), and — as an fid on a subject — the anon account's fid, FC_TEST_FID, FC_RESERVED_FIDS; nothing here
//     ever accepts a typed fid.
//   * ONE SEALED NAMESPACE, "rings", holds the owner side (rings, members, note chains, the rows this device keeps on
//     the drop) AND the member side's addresses (inbox nonces), padded to 8 KiB steps. EVERY device writes it on its
//     first tick, rings or not, so its existence and size class say nothing; afterwards it is written only on a user
//     action, a publish, and the inbox's deferred upkeep (lib/rings/inbox.ts — LP-3). What a member RECEIVES is
//     memory-only (lib/rings/received.ts): written on change it would make the member's vault writes follow the owner's
//     hourly re-seals and pair them.
//   * SEVERAL DEVICES, ONE DOCUMENT (LP-2). A root's devices (a linked device, a second browser unlocked with the same
//     passkey) share this namespace under one anchor, and the validator's PUT /state replaces it whole with no revision
//     check. So the document carries a monotonic `rev` and a per-seal random `sealId`, and:
//       - EVERY tick of EVERY device re-reads it (refreshRingsDoc — the same signed read whether or not the device holds
//         a ring) and adopts a newer one;
//       - every change re-reads it first, and the seal re-reads it again just before writing and REFUSES (RingsChanged,
//         nothing written, the newer copy adopted) when another device sealed in between — a stale device can no longer
//         re-seal to a member another device revoked, nor overwrite that revoke;
//       - the composer refuses a REAL note from a document not re-checked within RINGS_NOTE_MAX_AGE_MS (a device that
//         slept through a revoke on another device must not post under the key the revoked member holds). No read on the
//         composer path: that read would be the beacon the prefetch schedule exists to avoid.
//     Residual (A-RINGS-LAST-WRITE-RACE): two seals whose pre-write reads both land before either write — a window of
//     one request — still end with the last write winning; the loser's next refresh adopts it. Closing it needs a
//     compare-and-swap on the validator's PUT /state.
//   * NEVER FAIL OPEN: an unread document THROWS (the composer refuses to post without its note; the panes say they
//     could not read your rings), and a document this device has sealed before that comes back empty is refused like
//     every other sealed namespace (lib/vault/sealedPins.ts).
//   * PERSONA LAUNCH GO-LIVE (UXH-9) — HIDE, NEVER DELETE. Removing a person from a ring or deleting a ring used to
//     erase the owner's own record from this document. Now it sets `hiddenAt` and KEEPS the record (Settings › Rings ›
//     Recently removed brings it back, lib/rings/outbound.ts restoreMember / restoreRing). A hidden record is out of
//     EVERY path that reaches a member or the composer: the publisher seals it no envelope, keysForMember sends it no
//     key, seenAtPosts / ringsSeeingPosts / noteKeyForPost do not count a hidden ring, and MAX_RINGS /
//     MAX_MEMBERS_PER_RING count only what is in use. Hidden records are bounded the way MAX_ADDRESS_RECORDS bounds
//     forgotten addresses: MAX_RING_RECORDS and MAX_MEMBER_RECORDS_PER_RING count in-use AND hidden records, a NEW
//     ring or person past them is refused in plain words, and a removal is never refused (it moves a record from in
//     use to hidden, never adds one). The document's version went to 2 with this: a device still running the version
//     1 code would read a hidden person as a member and re-seal them a note, so version 1 code refuses a version 2
//     document ("none readable by this device") and a stale tab across a deploy fails closed instead.
//
// This file holds the document, its sealed store and the in-memory accessors other modules read without a fetch
// (noteKeyForPost, ringsSeeingPosts). The owner's actions are lib/rings/outbound.ts, the publisher
// lib/rings/publisher.ts, the member side lib/rings/{inbox,received,fetch,merge}.ts, the tick lib/rings/tick.ts.
import { randomBytes } from "@/lib/platform/crypto";
import { fetchState, flushVault, hydratedNamespace, hydratedNamespaceAt } from "@/lib/adapters/mock/persist";
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { markEverSealed, wasEverSealed } from "@/lib/vault/sealedPins";
import { ZK_PREFETCH_MS } from "@/lib/zk/config";
import { chainKeyAt, chainKeys } from "./note";
import { MAX_NOTE_KEYS, MAX_RING_SENDS, NOTE_CHAIN_MAX, RING_SEND_HASH_RE, type RingDepth, type RingNoteKey, type RingSend } from "./envelope";

export const RINGS_NS = "rings";
/** PERSONA LAUNCH GO-LIVE (UXH-9): the document version this code writes; it reads 1 (every record visible) and 2 */
export const RINGS_DOC_V = 2;
/** rings IN USE (a deleted ring, hidden in Recently removed, does not count) */
export const MAX_RINGS = 16;
/** people IN USE in one ring (a removed person, hidden in Recently removed, does not count) */
export const MAX_MEMBERS_PER_RING = 32;
/**
 * PERSONA LAUNCH GO-LIVE (UXH-9) — every ring record, deleted ones included (hide, never delete): 16 in use and room
 * for 16 deleted. At the bound a NEW ring is refused in plain words (restore a deleted one, or reuse one of yours);
 * deleting is never refused, because it moves a ring from in use to deleted and adds no record. Nothing is dropped to
 * make room. The state body limit (lib/adapters/mock/persist.ts STATE_BODY_LIMIT_BYTES) can be reached before either
 * bound by a document full of people; that seal is refused loudly ("vault flush of "rings" is over the body limit"),
 * nothing written.
 */
export const MAX_RING_RECORDS = 32;
/** PERSONA LAUNCH GO-LIVE (UXH-9) — every person record in one ring, removed ones included: 32 in it and room for 32
 *  removed. At the bound adding a NEW person is refused in plain words (restore someone, or use another ring); adding
 *  back someone you removed restores their record, and removing is never refused */
export const MAX_MEMBER_RECORDS_PER_RING = 64;
/** addresses in use at once: handed out plus the spares made ahead (lib/rings/inbox.ts) */
export const MAX_ADDRESSES = 32;
/** every address record, forgotten ones included (hide, never delete — UX-R4): bounds the document */
export const MAX_ADDRESS_RECORDS = 64;
/** LP-3: addresses made AHEAD, on writes that happen anyway, so making one never writes at the handover */
export const SPARE_ADDRESSES = 3;
/** the chains of a persona's note keys the owner keeps — the most a member is ever sent (MAX_NOTE_KEYS) */
export const KEEP_NOTE_SEGMENTS = MAX_NOTE_KEYS;
/** the longest chain; the next add starts a fresh one (bounds a member's derivation and trial work) */
export const NOTE_SEGMENT_MAX_GENS = NOTE_CHAIN_MAX;
/** a member's step count is rounded up to this (LP-5: it learns roughly, never exactly, how many joined) */
export const NOTE_SPAN_BUCKET = 4;
export const DOC_STEP_BYTES = 8192;
export const DEFAULT_LEASE_HOURS = 72;
/** hourly re-seal (±25% jitter); RINGS_PUBLISH_MS for a rig, never below a minute */
export const RINGS_PUBLISH_MS = Math.max(60_000, Number(process.env.RINGS_PUBLISH_MS ?? 3_600_000) || 3_600_000);
/** LP-2: the oldest document the composer seals a REAL note from — two and a half ticks, never under five minutes.
 *  PERSONA LAUNCH GO-LIVE (L6, A-RING-REVOKE-SIBLING-WINDOW, kept): this is also how long a sibling device can seal
 *  under a chain another device just rotated. It stays above one tick ON PURPOSE: the document is re-read once per
 *  tick and the composer may not read (that read would be the beacon), so a bound under one tick refuses real notes for
 *  (1 − bound/tick) of EVERY tick by construction — "rings are stale" would be routine, not rare. Closing the window
 *  needs the note sealed at send time on the tick's fresh copy (lib/zk/gate.ts + prove.ts), not a tighter number. */
export const RINGS_NOTE_MAX_AGE_MS = Math.max(5 * 60_000, Math.round(2.5 * ZK_PREFETCH_MS));

export interface RingMember {
  id: string;
  kind: "address" | "link";
  addrId: string;
  pkHex: string;
  pskHex: string;
  /** what the OWNER calls this member on their own pane (never sealed into anything a member sees) */
  label: string | null;
  addedAt: number;
  /** the last seq sealed to this member (seq = max(prev + 1, now): monotonic across restarts and failed saves) */
  seq: number;
  /** per persona the ring holds at "posts": the first note-key generation this member may be sent (emptied when the
   *  member is removed or its ring deleted, set again — to a NEW generation — when it is restored) */
  since: Record<string, number>;
  /** PERSONA LAUNCH GO-LIVE (UXH-9): when the owner removed this person (kept, hidden, restorable); null = in the ring.
   *  A person inside a DELETED ring keeps null: the ring's own hiddenAt hides them, and restoring the ring brings back
   *  exactly the people who were in it, not the ones removed before */
  hiddenAt: number | null;
}

export interface Ring {
  id: string;
  /** the owner's own name for the ring ("Inner") — shown on the owner's panes and the composer line, NEVER sealed to a
   *  member (UX-R1: members see `shareAs`, else the root's name, else "a friend") */
  label: string;
  /** how the ring's members see the owner named ("shared with you by <shareAs>"); null = the root's name, else "a friend" */
  shareAs?: string | null;
  createdAt: number;
  /** personaId → depth; absent = this ring does not see that persona (kept while the ring is deleted, so a restore
   *  brings back what it saw) */
  depths: Record<string, RingDepth>;
  members: Record<string, RingMember>;
  /** PERSONA LAUNCH GO-LIVE (UXH-9): when the owner deleted this ring (kept, hidden, restorable); null = in use */
  hiddenAt: number | null;
  /** SPEC C — CLOSE-FRIEND SENDS: the Farcaster posts the owner sent this ring, newest first, at most MAX_RING_SENDS,
   *  each told to the ring's members for RING_SEND_TTL_MS (lib/rings/outbound.ts sendToRing; sealed with the rest) */
  sends?: RingSend[];
}

/** one note-key chain: generation g (start <= g) is chainKeyAt(headHex, g - start) */
export interface NoteSegment {
  start: number;
  headHex: string;
  at: number;
}

export interface PersonaNoteKeys {
  /** the opaque token a note's plaintext names (never the persona id) */
  ref: string;
  /** the current generation — internal bookkeeping, never sealed to a member (LP-5) */
  gen: number;
  /** oldest first; the last one is the current chain */
  segments: NoteSegment[];
}

export interface InboxEntry {
  nonce: string;
  label: string | null;
  createdAt: number;
  /** LP-3: made ahead and not handed out yet (trial-opened like any address; listed once claimed) */
  spare?: boolean;
  /** UX-R4: forgotten by the user — hidden and no longer trial-opened, never deleted ("Use it again" clears it) */
  forgottenAt?: number | null;
}

/** a row this device keeps on the drop: real (owner = ringId|memberId) or a dummy (owner = null) */
export interface LiveRow {
  rowId: string;
  tokenHex: string;
  gen: number;
  owner: string | null;
  expiresHour: number;
}

export interface PublishState {
  gen: number;
  lastPublishAt: number | null;
  nextDueAt: number | null;
  /** a change that has not been sealed yet: the next tick publishes */
  dirty: boolean;
  lastError: string | null;
  lastRows: number;
}

export interface RingsDoc {
  /** PERSONA LAUNCH GO-LIVE (UXH-9): 2 = may hold hidden records (version 1 code refuses it — see the header) */
  v: 2;
  /** LP-2: bumped by every seal (monotonic) */
  rev: number;
  /** LP-2: drawn at every seal — two devices that sealed the same rev from one base differ here */
  sealId: string;
  rings: Record<string, Ring>;
  personas: Record<string, PersonaNoteKeys>;
  inbox: Record<string, InboxEntry>;
  live: LiveRow[];
  publish: PublishState;
  createdAt: number;
}

export const emptyRingsDoc = (now = Date.now()): RingsDoc => ({
  v: RINGS_DOC_V,
  rev: 0,
  sealId: "",
  rings: {},
  personas: {},
  inbox: {},
  live: [],
  publish: { gen: 0, lastPublishAt: null, nextDueAt: null, dirty: false, lastError: null, lastRows: 0 },
  createdAt: now,
});

/** the document is unread on this device (cold cache, no hydrate read): callers refuse rather than assume "no rings" */
export class RingsUnread extends Error {
  constructor(message = "your rings haven't been read on this device yet — they are read in the background within a few minutes") {
    super(message);
    this.name = "RingsUnread";
  }
}

/** LP-2: another device of this root sealed the document after this change began — nothing was written here */
export class RingsChanged extends Error {
  constructor() {
    super("your rings were just changed on another of your devices, so nothing was saved here — this page now has the latest version; try again");
    this.name = "RingsChanged";
  }
}

/** LP-2: the document in memory has not been re-checked recently enough to seal a real ring note from it */
export class RingsStale extends Error {
  constructor(ageMs: number | null) {
    super(
      (ageMs === null ? "your rings haven't been re-checked on this device yet" : `your rings were last re-checked on this device ${Math.round(ageMs / 60_000)} minutes ago`) +
        " — the background check refreshes them every few minutes, so try again in a minute (this post's note must match who can see it now)"
    );
    this.name = "RingsStale";
  }
}

// ------------------------------------------------------------------------------------------------ the in-memory state

interface StoreState {
  doc: RingsDoc | null;
  /** true when `doc` is the fresh empty document of a namespace that has never been sealed: the first tick writes it */
  unsealed: boolean;
  /** bumped by every reset: a load or a mutation that straddles a reset never writes the old root's document back */
  epoch: number;
  chain: Promise<unknown>;
  /** LP-2: when `doc` was last confirmed against the validator (a read, or this device's own seal) */
  freshAt: number | null;
  /** LP-3: address claims made since the last seal — memory only, carried by the next seal of any kind */
  pendingClaims: Record<string, { label: string | null; claimedAt: number }>;
  /** LP-3: when the inbox's deferred write is due (memory only; drawn at random when one is needed) */
  upkeepDueAt: number | null;
  /** LP-2: the base of the mutation running now (assertRingsDocCurrent compares the stored copy to it) */
  mutationBase: SealBase | null;
}
const g = globalThis as unknown as { __layersRings?: StoreState };
const st = (): StoreState => {
  const s = (g.__layersRings ??= { doc: null, unsealed: false, epoch: 0, chain: Promise.resolve(), freshAt: null, pendingClaims: {}, upkeepDueAt: null, mutationBase: null });
  s.pendingClaims ??= {};
  if (s.freshAt === undefined) s.freshAt = null;
  if (s.upkeepDueAt === undefined) s.upkeepDueAt = null;
  if (s.mutationBase === undefined) s.mutationBase = null;
  return s;
};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const HEX64 = /^[0-9a-f]{64}$/;

/** a persona's chains as stored — and the first cut's independent keys ({gen, keyHex}), each its own one-step chain */
function personasFrom(raw: unknown): Record<string, PersonaNoteKeys> {
  const out: Record<string, PersonaNoteKeys> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [pid, v] of Object.entries(raw as Record<string, unknown>)) {
    const k = v as { ref?: unknown; gen?: unknown; segments?: unknown; keys?: unknown } | null;
    if (!k || typeof k !== "object" || typeof k.ref !== "string" || !Number.isSafeInteger(k.gen)) continue;
    let segs: NoteSegment[] = [];
    if (Array.isArray(k.segments)) {
      segs = (k.segments as NoteSegment[]).filter((x) => x && Number.isSafeInteger(x.start) && typeof x.headHex === "string" && HEX64.test(x.headHex)).map((x) => ({ start: x.start, headHex: x.headHex, at: Number(x.at) || 0 }));
    } else if (Array.isArray(k.keys)) {
      segs = (k.keys as { gen: number; keyHex: string; at: number }[]).filter((x) => x && Number.isSafeInteger(x.gen) && typeof x.keyHex === "string" && HEX64.test(x.keyHex)).map((x) => ({ start: x.gen, headHex: x.keyHex, at: Number(x.at) || 0 }));
    }
    segs.sort((a, b) => a.start - b.start);
    out[pid] = { ref: k.ref, gen: k.gen as number, segments: segs.filter((x) => x.start <= (k.gen as number)).slice(-KEEP_NOTE_SEGMENTS) };
  }
  return out;
}

/** PERSONA LAUNCH GO-LIVE (UXH-9): a record's "removed" mark as stored. Absent or null (every version 1 record) =
 *  in use; a positive whole number = hidden since then; ANYTHING ELSE THROWS — a mark this device cannot read is never
 *  taken as "in use", which would put a removed person back in the audience */
function hiddenAtFrom(v: unknown, what: string): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return v;
  throw new Error(`vault: "${RINGS_NS}" holds ${what} whose "removed" mark can't be read — refusing rather than treating something you removed as still there`);
}

/** PERSONA LAUNCH GO-LIVE (UXH-9): the rings as stored, every record given its hiddenAt (an old document reads as
 *  nothing hidden). A ring or a person that is not an object is corruption and THROWS (never skipped: a skipped record
 *  would be a silent delete, and a ring read without its people would publish to nobody without saying so). */
function ringsFrom(raw: unknown): Record<string, Ring> {
  const out: Record<string, Ring> = {};
  if (raw === undefined || raw === null) return out;
  const bad = (what: string) => new Error(`vault: "${RINGS_NS}" holds ${what} that can't be read — refusing rather than leaving it out`);
  if (typeof raw !== "object" || Array.isArray(raw)) throw bad("a list of rings");
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = v as Partial<Ring> | null;
    if (!r || typeof r !== "object" || Array.isArray(r)) throw bad("a ring");
    if (!r.members || typeof r.members !== "object" || Array.isArray(r.members)) throw bad("a ring's people");
    if (!r.depths || typeof r.depths !== "object" || Array.isArray(r.depths)) throw bad("what a ring sees");
    const members: Record<string, RingMember> = {};
    for (const [mid, mv] of Object.entries(r.members as Record<string, unknown>)) {
      const m = mv as Partial<RingMember> | null;
      if (!m || typeof m !== "object" || Array.isArray(m)) throw bad("a person in a ring");
      members[mid] = { ...(m as RingMember), since: m.since && typeof m.since === "object" ? m.since : {}, hiddenAt: hiddenAtFrom(m.hiddenAt, "a person in a ring") };
    }
    const { sends: rawSends, ...rest } = r as Ring;
    const sends = sendsFrom(rawSends);
    out[id] = { ...rest, members, hiddenAt: hiddenAtFrom(r.hiddenAt, "a ring"), ...(sends.length ? { sends } : {}) };
  }
  return out;
}

/** SPEC C: a ring's sends as stored — only well-formed ones, newest first, at most MAX_RING_SENDS (a send is a pointer
 *  the owner can make again, never a record anyone relies on: a malformed one is left out, never sealed) */
function sendsFrom(v: unknown): RingSend[] {
  if (!Array.isArray(v)) return [];
  return (v as Partial<RingSend>[])
    .filter((x): x is RingSend => !!x && Number.isSafeInteger(x.fid) && (x.fid as number) > 0 && typeof x.hash === "string" && RING_SEND_HASH_RE.test(x.hash) && Number.isSafeInteger(x.at) && (x.at as number) > 0)
    .map((x) => ({ fid: x.fid, hash: x.hash, at: x.at }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_RING_SENDS);
}

function docFrom(plain: Record<string, unknown>, recordCount: number): RingsDoc {
  const rec = plain["_"] as { m?: Omit<RingsDoc, "v"> & { v: unknown } } | undefined;
  // PERSONA LAUNCH GO-LIVE (UXH-9): version 1 (every record in use) and 2 are read; anything else is refused
  if (!rec || !rec.m || typeof rec.m !== "object" || (rec.m.v !== 1 && rec.m.v !== RINGS_DOC_V)) {
    throw new Error(`vault: "${RINGS_NS}" holds ${recordCount} record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one`);
  }
  const m = rec.m;
  return {
    v: RINGS_DOC_V,
    rev: Number.isSafeInteger(m.rev) && m.rev >= 0 ? m.rev : 0,
    sealId: typeof m.sealId === "string" ? m.sealId : "",
    rings: ringsFrom(m.rings),
    personas: personasFrom(m.personas),
    inbox: m.inbox && typeof m.inbox === "object" ? m.inbox : {},
    live: Array.isArray(m.live) ? m.live : [],
    publish: { ...emptyRingsDoc().publish, ...(m.publish ?? {}) },
    createdAt: Number.isSafeInteger(m.createdAt) ? m.createdAt : Date.now(),
  };
}

/** entries as stored → the document (null entries or {} = never written; THROWS if this device sealed it before).
 *  Synchronous: the vault key is in memory, so the composer path can use the hydrate's copy without a request. */
function fromStored(entries: Record<string, unknown> | null): { doc: RingsDoc; unsealed: boolean } {
  if (!entries || Object.keys(entries).length === 0) {
    if (wasEverSealed(RINGS_NS)) throw new Error(`vault: "${RINGS_NS}" is EMPTY on the validator but this device has sealed it before — refusing rather than treating a deleted namespace as a fresh one`);
    return { doc: emptyRingsDoc(), unsealed: true };
  }
  return { doc: docFrom(decryptNamespace(RINGS_NS, entries), Object.keys(entries).length), unsealed: false };
}

/** a signed read of the namespace (three tries). THROWS RingsUnread with the reason — never "no rings" on a failure. */
async function readStored(): Promise<{ doc: RingsDoc; unsealed: boolean }> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(RINGS_NS);
      if (res.status === 404) return fromStored(null);
      if (!res.ok) throw new Error("the validator answered " + res.status);
      return fromStored(((await res.json()) as { entries?: Record<string, unknown> })?.entries ?? null);
    } catch (e) {
      last = e;
      if (String((e as Error).message).startsWith("vault:")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new RingsUnread("couldn't read your rings (" + ((last as Error)?.message ?? "the validator could not be reached") + ")");
}

function adopt(got: { doc: RingsDoc; unsealed: boolean }, freshAt: number | null): RingsDoc {
  const s = st();
  if (!s.doc) {
    s.doc = got.doc;
    s.unsealed = got.unsealed;
    s.freshAt = freshAt;
  }
  return s.doc;
}

/** is `stored` a document this process must take over its own? (a later seal, or the same rev sealed elsewhere) */
function newerThan(stored: { doc: RingsDoc; unsealed: boolean }, mine: { rev: number; sealId: string; unsealed: boolean }): boolean {
  if (stored.unsealed) return false;
  if (mine.unsealed) return true;
  return stored.doc.rev > mine.rev || (stored.doc.rev === mine.rev && stored.doc.sealId !== mine.sealId);
}

/** LP-2: take the stored copy when it is newer; an OLDER stored copy (a rollback, a writer that raced this one) never
 *  replaces memory — the next seal writes this device's newer copy back over it */
function adoptIfNewer(got: { doc: RingsDoc; unsealed: boolean }): boolean {
  const s = st();
  if (!s.doc) {
    s.doc = got.doc;
    s.unsealed = got.unsealed;
    return true;
  }
  if (!newerThan(got, { rev: s.doc.rev, sealId: s.doc.sealId, unsealed: s.unsealed })) return false;
  s.doc = got.doc;
  s.unsealed = false;
  return true;
}

/**
 * THE DOCUMENT, as this process holds it. Order: the in-memory copy; the copy the whole-state hydrate read already
 * carried (lib/adapters/mock/persist.ts hydratedNamespace — no extra request); a signed read of the namespace (three
 * tries). THROWS when none can be read. Freshness is the tick's job (refreshRingsDoc), not this accessor's.
 */
export async function loadRingsDoc(): Promise<RingsDoc> {
  const s = st();
  if (s.doc) return s.doc;
  const epoch = s.epoch;
  const stash = hydratedNamespace(RINGS_NS);
  let got: { doc: RingsDoc; unsealed: boolean };
  let at: number | null;
  if (stash !== undefined) {
    got = fromStored(stash);
    at = hydratedNamespaceAt(RINGS_NS) ?? null;
  } else {
    got = await readStored();
    at = Date.now();
  }
  if (s.epoch !== epoch) throw new RingsUnread("your rings were reset while they were being read — try again");
  return adopt(got, at);
}

/**
 * LP-2 — THE UNIFORM RE-READ: every tick of every device (rings or none, linked or not) makes this one signed read and
 * adopts a newer copy another device of this root sealed. Also the first step of every change. THROWS when unreadable.
 * QUEUED behind the changes in flight (the same chain): a signed read and a signed write of the namespace share one
 * envelope counter, and a read signed after a write but landing before it would get the write refused as stale.
 */
export function refreshRingsDoc(): Promise<{ doc: RingsDoc; adopted: boolean }> {
  const s = st();
  const run = s.chain.catch(() => undefined).then(() => refreshNow());
  s.chain = run.catch(() => undefined);
  return run;
}

async function refreshNow(): Promise<{ doc: RingsDoc; adopted: boolean }> {
  const s = st();
  const epoch = s.epoch;
  const got = await readStored();
  if (s.epoch !== epoch) throw new RingsUnread("your rings were reset while they were being read — try again");
  const adopted = adoptIfNewer(got);
  s.freshAt = Date.now();
  return { doc: s.doc as RingsDoc, adopted };
}

/** LP-2, INSIDE a mutation about to act on the network (a publish's PUTs): THROWS RingsChanged (adopting the newer
 *  copy, nothing sent) when the stored document is no longer the base this mutation's draft was cloned from */
export async function assertRingsDocCurrent(): Promise<void> {
  const base = st().mutationBase;
  if (!base) throw new Error("internal: assertRingsDocCurrent outside a change to your rings");
  const got = await readStored();
  if (newerThan(got, base)) {
    adoptIfNewer(got);
    st().freshAt = Date.now();
    throw new RingsChanged();
  }
}

/** the document WITHOUT a fetch: memory, or the whole-state hydrate's copy (decrypted here); THROWS RingsUnread
 *  otherwise. For the composer path (lib/rings/note.ts, the GET /api/anon audience line). */
export function ringsDocSync(): RingsDoc {
  const s = st();
  if (s.doc) return s.doc;
  const stash = hydratedNamespace(RINGS_NS);
  if (stash === undefined) throw new RingsUnread();
  return adopt(fromStored(stash), hydratedNamespaceAt(RINGS_NS) ?? null);
}

/** whether the document is in memory right now (the panes say "not read yet" without throwing) */
export function ringsDocLoaded(): boolean {
  return st().doc !== null;
}

/** LP-2: how long ago the document in memory was confirmed against the validator (null = never) */
export function ringsDocAgeMs(now = Date.now()): number | null {
  const at = st().freshAt;
  return at === null ? null : Math.max(0, now - at);
}

function pad(m: RingsDoc): Record<string, unknown> {
  const inner = JSON.stringify(m);
  const target = DOC_STEP_BYTES * Math.ceil((inner.length + 64) / DOC_STEP_BYTES);
  return { _: { m, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } };
}

/** LP-3: claims made since the last seal ride this one (a claim of an address another device already claimed is moot) */
function applyPendingClaims(next: RingsDoc): string[] {
  const s = st();
  const seen: string[] = [];
  for (const [addrId, c] of Object.entries(s.pendingClaims)) {
    const e = next.inbox[addrId];
    if (!e) continue;
    seen.push(addrId);
    if (e.spare) {
      e.spare = false;
      e.label = c.label;
      e.createdAt = c.claimedAt;
    }
  }
  return seen;
}

interface SealBase {
  rev: number;
  sealId: string;
  unsealed: boolean;
}

async function seal(next: RingsDoc, epoch: number, base: SealBase): Promise<void> {
  const s = st();
  if (s.epoch !== epoch) throw new Error("your rings were reset while this change was in flight — nothing was saved");
  // LP-2: what the validator holds must still be the base this change started from — re-read just before the write
  const stored = await readStored();
  if (s.epoch !== epoch) throw new Error("your rings were reset while this change was in flight — nothing was saved");
  if (newerThan(stored, base)) {
    adoptIfNewer(stored);
    s.freshAt = Date.now();
    throw new RingsChanged();
  }
  const claimed = applyPendingClaims(next);
  next.rev = Math.max(base.rev, stored.unsealed ? 0 : stored.doc.rev) + 1;
  next.sealId = newId16();
  const nsName = RINGS_NS as Parameters<typeof flushVault>[0];
  await flushVault(nsName, encryptNamespace(RINGS_NS, pad(next)));
  if (s.epoch !== epoch) throw new Error("your rings were reset while this change was in flight");
  markEverSealed(RINGS_NS);
  for (const id of claimed) delete s.pendingClaims[id];
  s.doc = next;
  s.unsealed = false;
  s.freshAt = Date.now();
}

/** thrown inside a mutation to finish it WITHOUT a write (the value is the mutation's result) */
class SkipSeal {
  constructor(readonly value: unknown) {}
}
export function skipSeal(value: unknown = undefined): never {
  throw new SkipSeal(value);
}

/**
 * ONE MUTATION AT A TIME, adopted only once sealed. The document is RE-READ first (LP-2: a change never starts from a
 * copy another device has replaced); `fn` gets a deep copy; if it returns without throwing the copy is sealed
 * (flushVault, loud — and refused if another device sealed meanwhile) and only then becomes the document: a failed
 * write leaves no ghost. Mutations queue behind each other (a user action and a tick's publish never interleave).
 */
export function mutateRingsDoc<T>(fn: (draft: RingsDoc) => T | Promise<T>): Promise<T> {
  const s = st();
  const run = s.chain.catch(() => undefined).then(async () => {
    const epoch = st().epoch;
    const { doc: current } = await refreshNow();
    if (st().epoch !== epoch) throw new Error("your rings were reset while this change was in flight — nothing was saved");
    const base: SealBase = { rev: current.rev, sealId: current.sealId, unsealed: st().unsealed };
    const draft = clone(current);
    st().mutationBase = base;
    try {
      let out: T;
      try {
        out = await fn(draft);
      } catch (e) {
        if (e instanceof SkipSeal) return e.value as T;
        throw e;
      }
      await seal(draft, epoch, base);
      return out;
    } finally {
      st().mutationBase = null;
    }
  });
  s.chain = run.catch(() => undefined);
  return run;
}

/** the first tick of EVERY device: a namespace that has never been sealed is written (empty but for this device's
 *  spare addresses — `prepare`, lib/rings/inbox.ts mintSparesInto — padded) so its existence and size say nothing.
 *  Afterwards (or when another device wrote it first) a no-op. */
export async function ensureRingsDocWritten(prepare?: (draft: RingsDoc) => unknown | Promise<unknown>): Promise<boolean> {
  await loadRingsDoc();
  if (!st().unsealed) return false;
  return mutateRingsDoc(async (d) => {
    if (!st().unsealed) skipSeal(false); // the re-read found another device's copy: nothing to write
    if (prepare) await prepare(d);
    return true;
  });
}

/** whether this device holds the never-sealed empty document (its first write is still to come) */
export function ringsDocUnsealed(): boolean {
  return st().doc !== null && st().unsealed;
}

/**
 * The reset contract (resetSeed, reloadIdentity): forget the document, the pending claims and the upkeep schedule.
 * `knownEmpty` is for a seed reset, which has just wiped the validator's copy: the document IS the empty one (to be
 * written by the next tick), so the composer keeps working without waiting for a tick.
 */
export function resetRingsDocCache(opts: { knownEmpty?: boolean } = {}): void {
  const s = st();
  s.epoch++;
  s.doc = opts.knownEmpty ? emptyRingsDoc() : null;
  s.unsealed = !!opts.knownEmpty;
  s.chain = Promise.resolve();
  s.freshAt = opts.knownEmpty ? Date.now() : null;
  s.pendingClaims = {};
  s.upkeepDueAt = null;
}

// ------------------------------------------------------------------------------------------------ LP-3 claims, upkeep

/** the claims not sealed yet (lib/rings/inbox.ts overlays them on the document) */
export function pendingClaims(): Record<string, { label: string | null; claimedAt: number }> {
  return { ...st().pendingClaims };
}
export function addPendingClaim(addrId: string, label: string | null, claimedAt: number): void {
  st().pendingClaims[addrId] = { label, claimedAt };
}
export function upkeepDueAt(): number | null {
  return st().upkeepDueAt;
}
export function setUpkeepDueAt(at: number | null): void {
  st().upkeepDueAt = at;
}

// ------------------------------------------------------------------------------------------------ pure helpers

export const newId16 = (): string => randomBytes(8).toString("hex");
export const newKeyHex = (): string => randomBytes(32).toString("hex");

// PERSONA LAUNCH GO-LIVE (UXH-9): the ONE definition of "in use". Every path that reaches a member, the composer or a
// count goes through these (grep: no other `Object.values(d.rings)` / `r.members` iteration decides an audience). A
// non-null hiddenAt of any value hides — the parser has already refused one it could not read.
export const isHidden = (x: { hiddenAt?: number | null }): boolean => x.hiddenAt !== null && x.hiddenAt !== undefined;
/** the rings in use (not deleted) */
export const visibleRings = (doc: RingsDoc): Ring[] => Object.values(doc.rings).filter((r) => !isHidden(r));
/** the people in use in a ring (not removed). A deleted ring has none: its people are hidden with it */
export const visibleMembers = (ring: Ring): RingMember[] => (isHidden(ring) ? [] : Object.values(ring.members).filter((m) => !isHidden(m)));

/** a persona's note-key record, created on first need (a record whose chains were lost gets a fresh one) */
export function personaKeys(doc: RingsDoc, personaId: string, now = Date.now()): PersonaNoteKeys {
  let k = doc.personas[personaId];
  if (!k) {
    k = { ref: newId16(), gen: 0, segments: [{ start: 0, headHex: newKeyHex(), at: now }] };
    doc.personas[personaId] = k;
  } else if (!Array.isArray(k.segments) || k.segments.length === 0) {
    k.gen += 1;
    k.segments = [{ start: k.gen, headHex: newKeyHex(), at: now }];
  }
  return k;
}

/** the last generation of chain `i` (the current generation for the newest) */
function segmentEnd(k: PersonaNoteKeys, i: number): number {
  return i + 1 < k.segments.length ? k.segments[i + 1].start - 1 : k.gen;
}

/**
 * The persona's audience GREW: the next generation is one step along the current chain — everyone already in the
 * audience steps to it from what it holds, a newcomer starts there and cannot step back. A full chain starts a fresh
 * random one instead (`rotate`). Returns the new generation (a newcomer's `since`).
 *
 * PERSONA LAUNCH GO-LIVE (L5, A-RING-NOTE-INDEX-COUNTS-JOINS, KEPT NAMED): one step per join is what lets a member count
 * joins between two notes it opens. Stepping on a fixed schedule instead (no step at a join) is a lib/rings-only change,
 * but every form of it breaks a guarantee this model makes today, so it is the owner's call, not a code fix: a newcomer
 * given the current step opens the posts made earlier in that step (before it joined); one given the NEXT step sees
 * nothing for up to a step (a 6-hour step = up to 6 hours after "Added"); the 32-step chain then runs out on the clock
 * (32 × 6 h ≈ 8 days a chain, 3 chains kept), so history is bounded by time instead of by revokes; and a member trying
 * notes against a time step needs each post's COMPOSE time, which the public anon list does not carry (it shows the
 * relay time, hours later). Hiding that a revoke happened needs dummy rotations, each one costing every member a chain
 * of history (KEEP_NOTE_SEGMENTS). SECURITY-POSTURE.md §24 states it.
 */
export function advance(doc: RingsDoc, personaId: string, now = Date.now()): number {
  const k = personaKeys(doc, personaId, now);
  const cur = k.segments[k.segments.length - 1];
  if (k.gen + 1 - cur.start >= NOTE_SEGMENT_MAX_GENS) return rotate(doc, personaId, now);
  k.gen += 1;
  doc.publish.dirty = true;
  return k.gen;
}

/** The persona's audience SHRANK (a revoke, a lowering, a deleted ring): a fresh RANDOM chain nobody outside the
 *  remaining audience can reach; the newest KEEP_NOTE_SEGMENTS chains are kept. Returns the new generation. */
export function rotate(doc: RingsDoc, personaId: string, now = Date.now()): number {
  const k = personaKeys(doc, personaId, now);
  k.gen += 1;
  k.segments.push({ start: k.gen, headHex: newKeyHex(), at: now });
  k.segments = k.segments.slice(-KEEP_NOTE_SEGMENTS);
  doc.publish.dirty = true;
  return k.gen;
}

/** the key of the persona's current generation (THROWS when its chain is missing) */
export function currentNoteKey(k: PersonaNoteKeys): string {
  const cur = k.segments[k.segments.length - 1];
  if (!cur || k.gen < cur.start) throw new Error("this persona's ring key is missing — refusing rather than posting without the note its rings expect");
  return chainKeyAt(cur.headHex, k.gen - cur.start);
}

/** does any ring IN USE hold this persona at "posts"? (UXH-9: a deleted ring sees nothing — its depths are kept only
 *  so a restore brings them back) */
export function seenAtPosts(doc: RingsDoc, personaId: string): boolean {
  return visibleRings(doc).some((r) => r.depths[personaId] === "posts");
}

function shuffled<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const r = new Uint32Array(1);
    globalThis.crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** what a member of a ring may be sent for one persona: per kept chain that overlaps its time in the audience, the key
 *  of the first generation it may open and a step count rounded up to NOTE_SPAN_BUCKET — the newest MAX_NOTE_KEYS
 *  stretches, in a random order, no generation number (LP-5) */
export function keysForMember(doc: RingsDoc, ring: Ring, member: RingMember, personaId: string): RingNoteKey[] {
  // UXH-9: a removed person, or anyone in a deleted ring, is sent no key — whatever `since` says (defense in depth: the
  // publisher already skips them and a removal empties `since`)
  if (isHidden(ring) || isHidden(member)) return [];
  if (ring.depths[personaId] !== "posts") return [];
  const since = member.since[personaId];
  const k = doc.personas[personaId];
  if (since === undefined || !k || !Array.isArray(k.segments)) return [];
  const out: RingNoteKey[] = [];
  for (let i = 0; i < k.segments.length; i++) {
    const s = k.segments[i];
    const end = segmentEnd(k, i);
    const from = Math.max(since, s.start);
    if (from > end) continue;
    const span = end - from + 1;
    const n = Math.min(NOTE_SEGMENT_MAX_GENS, NOTE_SPAN_BUCKET * Math.ceil(span / NOTE_SPAN_BUCKET));
    out.push({ keyHex: chainKeyAt(s.headHex, from - s.start), n });
  }
  return shuffled(out.slice(-MAX_NOTE_KEYS));
}

// ------------------------------------------------------------------------------------------------ in-memory accessors

/**
 * The note key for an anon post made as `personaId` (lib/rings/note.ts noteForPost): the current generation when ANY
 * ring holds the persona at "posts", else null. No fetch, no write. THROWS when the document is unread — and (LP-2)
 * when a real note would come from a document not re-checked within RINGS_NOTE_MAX_AGE_MS.
 */
export function noteKeyForPost(personaId: string, now = Date.now()): { ref: string; gen: number; keyHex: string } | null {
  const doc = ringsDocSync();
  if (!seenAtPosts(doc, personaId)) return null;
  const age = ringsDocAgeMs(now);
  if (age === null || age > RINGS_NOTE_MAX_AGE_MS) throw new RingsStale(age);
  const k = doc.personas[personaId];
  if (!k) throw new Error("this persona's ring key is missing — refusing rather than posting without the note its rings expect");
  return { ref: k.ref, gen: k.gen, keyHex: currentNoteKey(k) };
}

/** the labels of the rings that will see which anon posts this persona wrote (the composer's line). THROWS unread.
 *  UXH-9: rings in use with someone in use in them — a deleted ring, or one whose people were all removed, is not named */
export async function ringsSeeingPosts(personaId: string): Promise<string[]> {
  const doc = ringsDocSync();
  return visibleRings(doc)
    .filter((r) => r.depths[personaId] === "posts" && visibleMembers(r).length > 0)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => r.label);
}

/** DEBUG / leak tests: every secret the document holds (member PSKs, every note key of every kept chain, drop tokens,
 *  inbox nonces) — hidden rings and removed people INCLUDED (UXH-9: their records, PSKs and labels are still sealed in
 *  this document, so the leak greps must look for them too) */
export function ringsDocSecretsForLeakTest(doc: RingsDoc | null = st().doc): { pskHex: string[]; noteKeys: string[]; tokens: string[]; nonces: string[]; addrIds: string[]; labels: string[]; refs: string[] } {
  const out = { pskHex: [] as string[], noteKeys: [] as string[], tokens: [] as string[], nonces: [] as string[], addrIds: [] as string[], labels: [] as string[], refs: [] as string[] };
  if (!doc) return out;
  for (const r of Object.values(doc.rings)) {
    out.labels.push(r.label);
    for (const m of Object.values(r.members)) {
      out.pskHex.push(m.pskHex);
      out.addrIds.push(m.addrId);
      if (m.label) out.labels.push(m.label);
    }
  }
  for (const k of Object.values(doc.personas)) {
    out.refs.push(k.ref);
    k.segments.forEach((s, i) => {
      out.noteKeys.push(...chainKeys(s.headHex, Math.min(NOTE_SEGMENT_MAX_GENS, segmentEnd(k, i) - s.start + 1)));
    });
  }
  for (const row of doc.live) out.tokens.push(row.tokenHex);
  for (const [addrId, e] of Object.entries(doc.inbox)) {
    out.nonces.push(e.nonce);
    out.addrIds.push(addrId);
    if (e.label) out.labels.push(e.label);
  }
  return out;
}
