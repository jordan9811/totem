// PERSONA LAUNCH P4 — WHAT THIS DEVICE RECEIVED (member side). MEMORY ONLY, by design.
//
// Every tick re-reads the whole drop and re-opens what is addressed to this device, so nothing here needs to persist —
// and persisting it would be a leak: the owner re-seals hourly, and a member device that wrote its vault "on change"
// would write right after each publish, pairing the two devices for anyone who watches the validator's write times.
// After a restart the next tick rebuilds it.
//
// The rules (DROP §4c, adapted):
//   1. FAILED fetch → nothing is dropped and nothing new is rendered: every record becomes "unknown" (kept, hidden)
//      until a later FULL fetch shows it again — so a validator that withholds the drop for a tick hides merges, never
//      deletes them, and restoring the read restores them with no new publish.
//   2. FULL fetch → each row is trial-opened with every address (hint first); a statement must validate
//      (lib/rings/envelope.ts validateStatement). Per (address, ring) the highest seq wins; a re-served OLDER generation
//      never replaces a newer one (it only keeps the record seen).
//   3. A record of an active address that had NO openable envelope in a FULL fetch is DROPPED (revoked or not renewed:
//      the publisher puts the new generation before deleting the old, so a FULL read never catches a gap).
//   4. Expired records are dropped at the tick and refused at render.
//   5. Ring notes: every anon post's note is trial-opened with every key the records carry — each sealed chain stretch
//      {keyHex, n} expanded to its n one-way steps (lib/rings/note.ts chainKeys); a match also needs the AAD (that
//      post's cast hash) and the ref of the subject the key came from. The result is a map castHash → reveal, read at
//      render with no decrypt and no fetch (lib/rings/merge.ts). A cast already tried under exactly the current set of
//      keys is not tried again (a memo keyed by the key set's fingerprint): chains carry more keys than the first cut's
//      three, and the anon list is re-read every tick.
import { createHash } from "@/lib/platform/crypto";
import { RING_SEND_TTL_MS, openRow, type InboxKey, type RingRoot, type RingSend, type RingStatement, type RingSubject } from "./envelope";
import { HUB_SENDS_EVENT } from "@/lib/fc/hubRead/copy";
import type { DropFetch } from "./fetch";
import { chainKeys, openNoteWith, NOTE_RE } from "./note";

export interface ReceivedRecord {
  key: string;
  addrId: string;
  rid: string;
  seq: number;
  issuedAt: number;
  expiresAt: number;
  label: string;
  root: RingRoot | null;
  subjects: RingSubject[];
  /** SPEC C: the posts the ring's owner sent its members (ids only; shown only where this device already holds them) */
  sends: RingSend[];
  /** the FULL fetch this record was last seen in */
  seenFetch: number;
}

type Mode = "fixture" | "live";
interface ReceivedState {
  records: Map<string, ReceivedRecord>;
  fetchId: number;
  lastFullFetchAt: number | null;
  /** null = this device has not read the drop yet; false = the latest read FAILED */
  lastTickOk: boolean | null;
  lastFetchError: string | null;
  malformed: number;
  reveals: Record<Mode, Map<string, { recordKey: string; ref: string }>>;
  anonListError: Record<Mode, string | null>;
  lastTickAt: number | null;
  /** castHash → the key-set fingerprint it was last tried under, and what that found (null = nothing) */
  tried: Record<Mode, Map<string, { fp: string; hit: { recordKey: string; ref: string } | null }>>;
  /** SPEC C: the sends last announced to the page (announceSends) */
  sendsKey?: string;
}
const g = globalThis as unknown as { __layersRingsReceived?: ReceivedState };
const fresh = (): ReceivedState => ({
  records: new Map(),
  fetchId: 0,
  lastFullFetchAt: null,
  lastTickOk: null,
  lastFetchError: null,
  malformed: 0,
  reveals: { fixture: new Map(), live: new Map() },
  anonListError: { fixture: null, live: null },
  lastTickAt: null,
  tried: { fixture: new Map(), live: new Map() },
});
const st = (): ReceivedState => (g.__layersRingsReceived ??= fresh());

export const recordKeyOf = (addrId: string, rid: string): string => addrId + "|" + rid;

/** apply one drop read (the tick). Pure apart from this module's memory; never fetches, never writes. */
export async function applyFetch(result: DropFetch, keys: InboxKey[], now = Date.now()): Promise<{ full: boolean; opened: number; dropped: number; malformed: number }> {
  const s = st();
  s.lastTickAt = now;
  if (!result.full) {
    s.lastTickOk = false;
    s.lastFetchError = result.error;
    announceSends(now);
    return { full: false, opened: 0, dropped: 0, malformed: 0 };
  }
  let malformed = 0;
  const best = new Map<string, RingStatement>();
  const seen = new Set<string>();
  for (const row of result.rows) {
    for (const k of keys) {
      const st0 = await openRow(row, k, now, () => malformed++);
      if (!st0) continue;
      const key = recordKeyOf(k.addrId, st0.rid);
      seen.add(key);
      const prev = best.get(key);
      if (!prev || st0.seq > prev.seq) best.set(key, st0);
    }
  }
  const fetchId = s.fetchId + 1;
  let opened = 0;
  for (const [key, stmt] of best) {
    opened++;
    const existing = s.records.get(key);
    if (!existing || stmt.seq > existing.seq) {
      s.records.set(key, { key, addrId: stmt.addrId, rid: stmt.rid, seq: stmt.seq, issuedAt: stmt.issuedAt, expiresAt: stmt.expiresAt, label: stmt.label, root: stmt.root, subjects: stmt.subjects, sends: stmt.sends ?? [], seenFetch: fetchId });
    } else {
      existing.seenFetch = fetchId; // equal (a renewal not yet seen) or OLDER (a re-served generation): kept, seen
    }
  }
  const active = new Set(keys.map((k) => k.addrId));
  let dropped = 0;
  for (const [key, rec] of [...s.records]) {
    if (!active.has(rec.addrId) || !seen.has(key) || rec.expiresAt <= now) {
      s.records.delete(key);
      dropped++;
    }
  }
  s.fetchId = fetchId;
  s.lastFullFetchAt = now;
  s.lastTickOk = true;
  s.lastFetchError = null;
  s.malformed += malformed;
  announceSends(now);
  return { full: true, opened, dropped, malformed };
}

/** SPEC C: tell the page (in a browser only, no value carried) when what the rings sent this device changed, so the
 *  Following shows a new send without waiting for its own refresh. Every read of the drop calls it, sent anything or not */
function announceSends(now: number): void {
  const s = st();
  const key = receivedSends(now)
    .map((x) => x.fid + ":" + x.hash + ":" + x.from)
    .join(",");
  if (key === (s.sendsKey ?? "")) return;
  s.sendsKey = key;
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(HUB_SENDS_EVENT));
}

export function renderable(rec: ReceivedRecord | undefined, now = Date.now()): rec is ReceivedRecord {
  const s = st();
  return !!rec && s.lastTickOk === true && rec.seenFetch === s.fetchId && rec.expiresAt > now;
}

/** every note key the records carry — each sealed stretch expanded along its chain — with the subject it opens notes for */
function keyEntries(): { recordKey: string; ref: string; keyHex: string }[] {
  const out: { recordKey: string; ref: string; keyHex: string }[] = [];
  for (const rec of st().records.values()) {
    for (const sub of rec.subjects) for (const k of sub.noteKeys ?? []) for (const keyHex of chainKeys(k.keyHex, k.n)) out.push({ recordKey: rec.key, ref: sub.ref, keyHex });
  }
  return out;
}

/** the anon list was read (the tick): trial-open every note with every key; the map is what render reads */
export function applyAnonList(mode: Mode, casts: { castHash: string; note?: string | null }[] | null, error: string | null = null): { matched: number; tried: number } {
  const s = st();
  if (!casts) {
    s.anonListError[mode] = error ?? "the anon list could not be read";
    return { matched: 0, tried: 0 }; // the previous map stands; the records' own state still gates rendering
  }
  s.anonListError[mode] = null;
  const keys = keyEntries();
  // the key set's fingerprint: which keys, for which (record, subject) — any change re-tries every cast
  const fp = createHash("sha256")
    .update(keys.map((k) => k.recordKey + "|" + k.ref + "|" + k.keyHex).sort().join(","))
    .digest("hex");
  const next = new Map<string, { recordKey: string; ref: string }>();
  let tried = 0;
  const seen = new Set<string>();
  for (const c of casts) {
    if (typeof c.note !== "string" || !NOTE_RE.test(c.note) || !/^[0-9a-f]{64}$/.test(c.castHash)) continue;
    const memoKey = c.castHash + "|" + c.note;
    seen.add(memoKey);
    const memo = s.tried[mode].get(memoKey);
    let hit: { recordKey: string; ref: string } | null = null;
    if (memo && memo.fp === fp) hit = memo.hit;
    else {
      for (const k of keys) {
        tried++;
        const ref = openNoteWith(c.note, c.castHash, k.keyHex);
        if (ref && ref === k.ref) {
          hit = { recordKey: k.recordKey, ref };
          break;
        }
      }
      s.tried[mode].set(memoKey, { fp, hit });
    }
    if (hit) next.set(c.castHash, hit);
  }
  for (const k of [...s.tried[mode].keys()]) if (!seen.has(k)) s.tried[mode].delete(k); // casts no longer listed are forgotten
  s.reveals[mode] = next;
  return { matched: next.size, tried };
}

export interface RingReveal {
  persona: { handle: string; displayName: string; thumb: string | null };
  root: { fname: string | null; displayName: string; thumb: string | null };
  label: string;
}

function rootOf(rec: ReceivedRecord): RingReveal["root"] {
  return rec.root ? { fname: rec.root.fname, displayName: rec.root.displayName ?? rec.root.fname, thumb: rec.root.thumb ?? null } : { fname: null, displayName: rec.label, thumb: null };
}

/** the reveal for one anon post, from memory only — null unless the record behind it is renderable right now */
export function revealFor(mode: Mode, castHash: string, now = Date.now()): RingReveal | null {
  const s = st();
  const hit = s.reveals[mode].get(castHash);
  if (!hit) return null;
  const rec = s.records.get(hit.recordKey);
  if (!renderable(rec, now)) return null;
  const sub = rec.subjects.find((x) => x.ref === hit.ref && x.depth === "posts");
  if (!sub) return null;
  return { persona: { handle: sub.handle, displayName: sub.display, thumb: sub.thumb ?? null }, root: rootOf(rec), label: rec.label };
}

/** the renderable record (and subject) that names this fid, if any */
export function recordForFid(fid: number, now = Date.now()): { rec: ReceivedRecord; subject: RingSubject; root: RingReveal["root"] } | null {
  if (!Number.isSafeInteger(fid) || fid <= 0) return null;
  const recs = [...st().records.values()].filter((r) => renderable(r, now)).sort((a, b) => a.issuedAt - b.issuedAt);
  for (const rec of recs) {
    const subject = rec.subjects.find((x) => x.fid === fid);
    if (subject) return { rec, subject, root: rootOf(rec) };
  }
  return null;
}

/**
 * SPEC C — CLOSE-FRIEND SENDS, the member's side: the Farcaster posts the rings this device is in sent it, from memory
 * only (what the last FULL read of the drop opened: the same read every device makes every tick, sent anything or not),
 * renderable records only, within three days, one per post (the newest send wins), newest first. `from` is the name the
 * ring's owner chose to be shown by (its "share as" name, else its own name, else "a friend"). The hub timeline shows
 * one only while the root acts and only if it already holds that cast (lib/fc/hubRead/extras.ts): nothing here reads.
 */
export function receivedSends(now = Date.now()): { fid: number; hash: string; at: number; from: string }[] {
  const best = new Map<string, { fid: number; hash: string; at: number; from: string }>();
  for (const rec of st().records.values()) {
    if (!renderable(rec, now)) continue;
    for (const x of rec.sends ?? []) {
      if (x.at <= now - RING_SEND_TTL_MS) continue;
      const k = x.fid + ":" + x.hash;
      const prev = best.get(k);
      if (!prev || x.at > prev.at) best.set(k, { fid: x.fid, hash: x.hash, at: x.at, from: rec.label });
    }
  }
  return [...best.values()].sort((a, b) => b.at - a.at || (a.hash < b.hash ? -1 : 1));
}

export interface ReceivedStatus {
  lastTickAt: number | null;
  lastTickOk: boolean | null;
  lastFetchError: string | null;
  malformed: number;
  rings: { label: string; root: string | null; personas: { handle: string; depth: string }[]; expiresAt: number; state: "shown" | "unknown" }[];
}

export function receivedStatus(now = Date.now()): ReceivedStatus {
  const s = st();
  return {
    lastTickAt: s.lastTickAt,
    lastTickOk: s.lastTickOk,
    lastFetchError: s.lastFetchError,
    malformed: s.malformed,
    rings: [...s.records.values()]
      .sort((a, b) => a.issuedAt - b.issuedAt)
      .map((r) => ({ label: r.label, root: r.root ? r.root.fname : null, personas: r.subjects.map((x) => ({ handle: x.handle, depth: x.depth })), expiresAt: r.expiresAt, state: renderable(r, now) ? "shown" : "unknown" })),
  };
}

export function dropReceivedForAddress(addrId: string): void {
  const s = st();
  for (const [k, r] of [...s.records]) if (r.addrId === addrId) s.records.delete(k);
}

/** DEBUG / rig: every note key this device can use right now — each stretch expanded along its chain (the revoke check
 *  captures them before a revoke). No generation numbers: none are sealed (LP-5). */
export function receivedNoteKeysForDebug(): { keyHex: string; handle: string }[] {
  const out: { keyHex: string; handle: string }[] = [];
  for (const rec of st().records.values()) for (const sub of rec.subjects) for (const k of sub.noteKeys ?? []) for (const keyHex of chainKeys(k.keyHex, k.n)) out.push({ keyHex, handle: sub.handle });
  return out;
}

/** counts for the reset probes (arm → reset → read back empty) */
export function receivedCounts(): { records: number; reveals: number; fetched: boolean } {
  const s = st();
  return { records: s.records.size, reveals: s.reveals.fixture.size + s.reveals.live.size, fetched: s.lastTickOk !== null };
}

export function resetReceived(): void {
  g.__layersRingsReceived = fresh();
}
