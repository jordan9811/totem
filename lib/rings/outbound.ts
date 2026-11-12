// PERSONA LAUNCH P4 — THE OWNER'S SIDE OF RINGS: the rings, their members, the per-persona depth, revoke.
// Runs on every device that holds a root (the rig, the owner service, the visitor's browser device): D8 lets strangers
// publish, device-signed and padded to buckets of 4.
//
// Every action is one mutation of the sealed "rings" document (lib/rings/model.ts mutateRingsDoc: adopted only once the
// vault write lands). Nothing here touches the network except a REVOKE, which deletes the revoked member's rows from
// the drop at once (A-DROP-REVOKE-IS-VISIBLE: the operator sees a delete at the click); everything else is sealed and
// sent by the next publish (lib/rings/publisher.ts, on the tick).
//
// ADMISSIBLE SUBJECTS (model header): this device's own PUBLIC personas only — never a private persona, never the
// read-only public self (that is main, shown as the envelope's root), never a typed persona id or fid. A persona's fid
// rides its subject only when the persona owns it through this vault's own record (personaFidMap) and it is none of
// Totem's own accounts (FC_TEST_FID, the anon account, FC_RESERVED_FIDS — lib/fc/personaFid.ts ownAccountFids); an
// unreadable fid map or an unknown anon account seals NO fid (a missing merge, never a wrong one).
//
// PERSONA LAUNCH GO-LIVE (UXH-9) — HIDE, NEVER DELETE. "Remove" and "Delete ring" used to erase the owner's own records
// from the sealed document. They now set hiddenAt and KEEP the record; Settings › Rings › Recently removed lists them
// and restoreMember / restoreRing bring them back. What a removal DOES to the audience is unchanged: the chains of every
// persona the ring holds at "posts" rotate (future posts), the person's notes on the drop are deleted now, the next
// tick publishes, and a removed person keeps what it already saw (A-RING-REVOKED-KEEP-OLD-KEYS). A RESTORE is a JOIN:
// one chain step per persona at "posts", and the restored people start there — never at a generation from before or
// during their removal — so a restored person never opens what was posted while it was removed. Every action below
// that takes a ring takes a ring IN USE (ringOf refuses a deleted one in plain words); counts are of records in use,
// except the record bounds (lib/rings/model.ts MAX_RING_RECORDS, MAX_MEMBER_RECORDS_PER_RING), which count both.
import {
  DEFAULT_LEASE_HOURS,
  MAX_MEMBERS_PER_RING,
  MAX_MEMBER_RECORDS_PER_RING,
  MAX_RINGS,
  MAX_RING_RECORDS,
  advance,
  isHidden,
  keysForMember,
  loadRingsDoc,
  mutateRingsDoc,
  newId16,
  newKeyHex,
  personaKeys,
  rotate,
  skipSeal,
  visibleMembers,
  visibleRings,
  type Ring,
  type RingMember,
  type RingsDoc,
} from "./model";
import { LABEL_MAX, LINK_PATH, MAX_NOTE_KEYS, MAX_RING_SENDS, NOTE_CHAIN_MAX, RING_SEND_HASH_RE, RING_SEND_TTL_MS, RingStatementTooLarge, encodeStatement, linkInboxKey, parseAddress, plainText, thumbOk, type RingDepth, type RingRoot, type RingSend, type RingStatement, type RingSubject } from "./envelope";

/** UX-R1: how a ring names its owner to members when there is no "share as" name and no main account connected — never
 *  the ring's own label, which the pane promises only the owner sees */
export const NEUTRAL_SHARED_BY = "a friend";

/** PERSONA LAUNCH GO-LIVE (UXH-9): the refusals at the record bounds and around hidden records, in plain words */
export const RING_RECORDS_FULL = `you're out of room for rings: Totem keeps ${MAX_RING_RECORDS}, counting the ones you deleted (they're kept so you can restore them) — restore one from Recently removed, or reuse one of your rings`;
export const memberRecordsFull = (ring: string) =>
  `"${ring}" is out of room: a ring keeps ${MAX_MEMBER_RECORDS_PER_RING} people, counting the ones you removed (they're kept so you can bring them back) — restore someone from Recently removed, or put new people in another ring`;
export const RING_DELETED = "that ring was deleted — restore it from Recently removed first";

export interface AdmissiblePersona {
  personaId: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  fid?: number;
}

/** this device's own public personas, with the fid each owns through this vault (or none) */
export async function admissiblePersonas(): Promise<AdmissiblePersona[]> {
  const { listPersonas } = await import("@/lib/identity/keystore");
  const personas = listPersonas().filter((p) => p.kind === "public" && p.publicSelf !== true);
  let fids: Record<string, { fid: number; fname: string | null }> = {};
  let forbidden: Set<number> | null = null;
  try {
    const pf = await import("@/lib/fc/personaFid");
    fids = await pf.personaFidMap();
    forbidden = pf.ownAccountFids([], await pf.anonAccountFid());
  } catch {
    forbidden = null; // an unreadable map or an unknown anon account: no fid on any subject this time
  }
  return personas.map((p) => {
    const f = fids[p.id]?.fid;
    const fidOk = forbidden !== null && Number.isSafeInteger(f) && (f as number) > 0 && !forbidden.has(f as number);
    return { personaId: p.id, handle: p.handle, name: p.name, avatarUrl: p.avatarUrl ?? null, ...(fidOk ? { fid: f as number } : {}) };
  });
}

// ------------------------------------------------------------------------------------------------ the pane's view

export interface RingsPaneView {
  /** the rings IN USE, with the people in use in each */
  rings: {
    id: string;
    label: string;
    shareAs: string | null;
    createdAt: number;
    personas: { personaId: string; handle: string; name: string; depth: RingDepth }[];
    members: { id: string; kind: "address" | "link"; label: string | null; addedAt: number; ref: string }[];
  }[];
  /** PERSONA LAUNCH GO-LIVE (UXH-9): Settings › Rings › Recently removed, newest first — deleted rings (with how many
   *  people come back with them) and people removed from rings still in use. Same reference rules as `rings`: never a
   *  PSK, never an address, a member by its short reference only */
  recentlyRemoved: {
    rings: { id: string; label: string; hiddenAt: number; people: number }[];
    members: { ringId: string; ringLabel: string; id: string; kind: "address" | "link"; label: string | null; ref: string; hiddenAt: number }[];
  };
  admissible: AdmissiblePersona[];
  limits: { rings: number; membersPerRing: number; ringRecords: number; memberRecordsPerRing: number };
  leaseHours: number;
}

export async function ringsPaneView(): Promise<RingsPaneView> {
  const doc = await loadRingsDoc();
  const admissible = await admissiblePersonas();
  const byId = new Map(admissible.map((p) => [p.personaId, p]));
  const inUse = visibleRings(doc).sort((a, b) => a.createdAt - b.createdAt);
  const deleted = Object.values(doc.rings).filter((r) => isHidden(r));
  return {
    rings: inUse.map((r) => ({
      id: r.id,
      label: r.label,
      shareAs: r.shareAs ?? null,
      createdAt: r.createdAt,
      personas: Object.entries(r.depths)
        .filter(([pid]) => byId.has(pid))
        .map(([pid, depth]) => ({ personaId: pid, handle: byId.get(pid)!.handle, name: byId.get(pid)!.name, depth })),
      // never the PSK, never the address: the member's short reference (first 8 of its address id) and the owner's name for it
      members: visibleMembers(r)
        .sort((a, b) => a.addedAt - b.addedAt)
        .map((m) => ({ id: m.id, kind: m.kind, label: m.label, addedAt: m.addedAt, ref: m.addrId.slice(0, 8) })),
    })),
    recentlyRemoved: {
      rings: deleted
        .sort((a, b) => (b.hiddenAt as number) - (a.hiddenAt as number))
        .map((r) => ({ id: r.id, label: r.label, hiddenAt: r.hiddenAt as number, people: Object.values(r.members).filter((m) => !isHidden(m)).length })),
      members: inUse
        .flatMap((r) => Object.values(r.members).filter((m) => isHidden(m)).map((m) => ({ ringId: r.id, ringLabel: r.label, id: m.id, kind: m.kind, label: m.label, ref: m.addrId.slice(0, 8), hiddenAt: m.hiddenAt as number })))
        .sort((a, b) => b.hiddenAt - a.hiddenAt),
    },
    admissible,
    limits: { rings: MAX_RINGS, membersPerRing: MAX_MEMBERS_PER_RING, ringRecords: MAX_RING_RECORDS, memberRecordsPerRing: MAX_MEMBER_RECORDS_PER_RING },
    leaseHours: DEFAULT_LEASE_HOURS,
  };
}

// ------------------------------------------------------------------------------------------------ actions

function cleanLabel(label: unknown, what: string): string {
  const t = plainText(label, LABEL_MAX);
  if (t === null) throw new Error(`${what} is plain text, 1 to ${LABEL_MAX} characters`);
  return t;
}
/** a ring IN USE (UXH-9: a deleted ring is refused in plain words — it is changed only by restoring it) */
function ringOf(d: RingsDoc, ringId: string): Ring {
  const r = d.rings[ringId];
  if (!r) throw new Error("that ring doesn't exist (it may have been deleted)");
  if (isHidden(r)) throw new Error(RING_DELETED);
  return r;
}
const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function createRing(label: unknown, shareAs?: unknown): Promise<{ id: string }> {
  const l = cleanLabel(label, "a ring's name");
  const sa = shareAs == null || shareAs === "" ? null : cleanLabel(shareAs, "the name members see");
  return mutateRingsDoc((d) => {
    const inUse = visibleRings(d);
    if (inUse.length >= MAX_RINGS) throw new Error(`you already have ${MAX_RINGS} rings — that's the most there can be`);
    // UXH-9: deleted rings are kept, so the record bound is checked too — a NEW ring past it is refused, nothing dropped
    if (Object.keys(d.rings).length >= MAX_RING_RECORDS) throw new Error(RING_RECORDS_FULL);
    // a deleted ring's name is free again (restoring it then asks for one of the two to be renamed first)
    if (inUse.some((r) => sameLabel(r.label, l))) throw new Error("you already have a ring with that name");
    const id = newId16();
    const r: Ring = { id, label: l, createdAt: Date.now(), depths: {}, members: {}, shareAs: sa, hiddenAt: null };
    d.rings[id] = r;
    return { id };
  });
}

export async function renameRing(ringId: string, label: unknown, shareAs?: unknown): Promise<void> {
  const l = cleanLabel(label, "a ring's name");
  await mutateRingsDoc((d) => {
    const r = ringOf(d, ringId);
    if (visibleRings(d).some((x) => x.id !== ringId && sameLabel(x.label, l))) throw new Error("you already have a ring with that name");
    r.label = l;
    if (shareAs !== undefined) r.shareAs = shareAs == null || shareAs === "" ? null : cleanLabel(shareAs, "the name members see");
    if (visibleMembers(r).length) d.publish.dirty = true;
  });
}

/** a new member joins every audience this ring already gives: each persona the ring holds at "posts" ADVANCES one step
 *  along its chain (lib/rings/model.ts advance), and the member's keys start at the new generation — it never opens
 *  what was posted before it joined, and everyone already in the audience steps forward with nothing lost */
function admitMember(d: RingsDoc, r: Ring, m: RingMember): void {
  for (const [pid, depth] of Object.entries(r.depths)) if (depth === "posts") m.since[pid] = advance(d, pid);
  r.members[m.id] = m;
  d.publish.dirty = true;
}

/**
 * PERSONA LAUNCH GO-LIVE (UXH-9) — people COMING BACK (a restored person, or everyone in a restored ring) join every
 * audience the ring gives as ONE join: one chain step per persona at "posts", and they all start at the new generation.
 * Their old `since` was emptied when they were hidden, so nothing from before or during the removal is ever sealed to
 * them again: a restored person sees posts from now on, not the ones made while it was removed. Nobody coming back,
 * nobody joins: no step.
 */
function rejoin(d: RingsDoc, r: Ring, people: RingMember[]): void {
  if (people.length === 0) return;
  for (const [pid, depth] of Object.entries(r.depths)) {
    if (depth !== "posts") continue;
    const gen = advance(d, pid);
    for (const m of people) m.since[pid] = gen;
  }
  d.publish.dirty = true;
}

/**
 * W2-RINGS-ONE-RING-BLOCKS-ALL — REFUSE UP FRONT a ring whose sealed note could not hold what it shows. One member's
 * statement is built at its WORST case — the longest name members could be shown, the longest root, every subject at
 * "posts" carrying the most chain stretches (MAX_NOTE_KEYS, two-digit step counts) — so a ring that passes here keeps
 * fitting however its keys rotate. Thumbnails are not counted: they are the first thing a full note drops. THROWS in
 * plain words. (A persona renamed later can still push a ring over; the publisher then keeps that ring's last notes
 * and names it, and every other ring publishes.)
 */
export function assertRingFits(d: RingsDoc, r: Ring, admissible: AdmissiblePersona[]): void {
  const probe: RingMember = { id: "0".repeat(16), kind: "address", addrId: "0".repeat(32), pkHex: "", pskHex: "", label: null, addedAt: 0, seq: 0, since: {}, hiddenAt: null };
  const worstRoot: RingRoot = { fname: "x".repeat(64), displayName: "x".repeat(48) };
  const s = buildStatement(JSON.parse(JSON.stringify(d)) as RingsDoc, r, probe, worstRoot, admissible, 9_000_000_000_000);
  // SPEC C: sends are not counted — a note that would not fit drops them before refusing (envelope.ts encodeStatement)
  delete s.sends;
  s.label = "x".repeat(LABEL_MAX);
  s.subjects = s.subjects.map((x) => (x.depth === "posts" ? { ...x, noteKeys: Array.from({ length: MAX_NOTE_KEYS }, () => ({ keyHex: "0".repeat(64), n: NOTE_CHAIN_MAX })) } : x));
  try {
    encodeStatement(s);
  } catch (e) {
    if (e instanceof RingStatementTooLarge) {
      throw new Error(`"${r.label}" can't show that much in one sealed note — share fewer personas with it (showing a persona's anonymous posts takes the most room)`);
    }
    throw e;
  }
}

/** the checks before one more person is IN USE in a ring (a new one, or one coming back) */
function assertRoomFor(r: Ring): void {
  if (visibleMembers(r).length >= MAX_MEMBERS_PER_RING) throw new Error(`a ring holds at most ${MAX_MEMBERS_PER_RING} people`);
}
/** UXH-9: a NEW person record (not a restore) past the record bound is refused — nothing is dropped to make room */
function assertNewRecord(r: Ring): void {
  if (Object.keys(r.members).length >= MAX_MEMBER_RECORDS_PER_RING) throw new Error(memberRecordsFull(r.label));
}

/** add a person by their private address. UXH-9: an address you REMOVED from this ring is restored instead (one record
 *  per address, never a second) — from now on, exactly like Restore — and `restored` says so */
export async function addMember(ringId: string, address: unknown, memberLabel?: unknown): Promise<{ memberId: string; restored?: true }> {
  const parsed = parseAddress(String(address ?? ""));
  if (!parsed.ok) throw new Error(parsed.reason);
  const label = memberLabel == null || memberLabel === "" ? null : cleanLabel(memberLabel, "a member's name");
  const admissible = await admissiblePersonas();
  return mutateRingsDoc((d) => {
    const r = ringOf(d, ringId);
    const same = Object.values(r.members).find((m) => m.addrId === parsed.addrId);
    if (same && !isHidden(same)) throw new Error("that address is already in this ring");
    assertRoomFor(r);
    if (!same) assertNewRecord(r);
    assertRingFits(d, r, admissible);
    if (same) {
      same.hiddenAt = null;
      same.since = {};
      if (label !== null) same.label = label;
      rejoin(d, r, [same]);
      return { memberId: same.id, restored: true as const };
    }
    const m: RingMember = { id: newId16(), kind: "address", addrId: parsed.addrId, pkHex: parsed.pkHex, pskHex: parsed.pskHex, label, addedAt: Date.now(), seq: 0, since: {}, hiddenAt: null };
    admitMember(d, r, m);
    return { memberId: m.id };
  });
}

/** a link-friend: the owner draws a key; the link /d#<key> is answered ONCE (the key itself is not kept) */
export async function makeLink(ringId: string, memberLabel?: unknown): Promise<{ memberId: string; link: string }> {
  const label = memberLabel == null || memberLabel === "" ? null : cleanLabel(memberLabel, "a member's name");
  const keyHex = newKeyHex();
  const k = await linkInboxKey(keyHex);
  const admissible = await admissiblePersonas();
  const out = await mutateRingsDoc((d) => {
    const r = ringOf(d, ringId);
    assertRoomFor(r);
    assertNewRecord(r);
    assertRingFits(d, r, admissible);
    const m: RingMember = { id: newId16(), kind: "link", addrId: k.addrId, pkHex: k.pkHex, pskHex: k.pskHex, label, addedAt: Date.now(), seq: 0, since: {}, hiddenAt: null };
    admitMember(d, r, m);
    return { memberId: m.id };
  });
  return { ...out, link: LINK_PATH + keyHex };
}

/** what a ring sees of one persona: "name", "posts", or null (not shared). A ring with members raised to "posts" grows
 *  the persona's audience (a chain step); lowered from "posts" it shrinks it (a fresh chain). Refused up front when the
 *  ring's note could no longer hold what it shows. Only the people IN USE join or leave (UXH-9: a removed person has
 *  no `since` and gets none). */
export async function setDepth(ringId: string, personaId: string, depth: RingDepth | null): Promise<void> {
  if (depth !== null && depth !== "name" && depth !== "posts") throw new Error('depth is "name", "posts" or nothing');
  const admissible = await admissiblePersonas();
  if (depth !== null && !admissible.some((p) => p.personaId === personaId)) {
    throw new Error("only your own public personas can be shared with a ring (not a private persona, not your Farcaster account itself)");
  }
  await mutateRingsDoc((d) => {
    const r = ringOf(d, ringId);
    const before = r.depths[personaId] ?? null;
    if (before === depth) return;
    if (depth === null) delete r.depths[personaId];
    else r.depths[personaId] = depth;
    personaKeys(d, personaId);
    if (depth !== null) assertRingFits(d, r, admissible);
    const people = visibleMembers(r);
    const hasMembers = people.length > 0;
    if (depth === "posts") {
      // raised to posts: the ring's members JOIN the persona's audience — one chain step, and they start there (never
      // the posts made before). No members, nobody joins: no step.
      if (hasMembers) {
        const gen = advance(d, personaId);
        for (const m of people) m.since[personaId] = gen;
      }
    } else if (before === "posts") {
      // lowered: the ring's members LEAVE the audience — a fresh random chain they cannot reach; they keep what they had
      if (hasMembers) rotate(d, personaId);
      for (const m of Object.values(r.members)) delete m.since[personaId];
    }
    d.publish.dirty = true;
  });
}

/** the drop rows a revoke deletes now (published by lib/rings/publisher.ts deleteNow) */
async function deleteRows(tokens: string[]): Promise<string | null> {
  if (!tokens.length) return null;
  const { deleteFromDrop } = await import("./publisher");
  return deleteFromDrop(tokens);
}

/**
 * REVOKE ("Remove"): rotate the keys of every persona this ring shows at "posts" (future posts), HIDE the person, and
 * delete its rows from the drop at once. A delete that fails is retried by every later publish (the row expires anyway).
 *
 * PERSONA LAUNCH GO-LIVE (UXH-9): the person's record is KEPT with hiddenAt (Recently removed; restoreMember brings it
 * back) and only its key bookkeeping (`since`) is emptied, so no path could seal it a key even if it forgot to skip it.
 * The drop rows deleted here are NOT the owner's records: they are the network-side copies of notes this device sealed
 * to that person — the thing a removal must take away — and every one of them is re-made by a publish when the person
 * is restored. A removed person keeps what it already saw (A-RING-REVOKED-KEEP-OLD-KEYS).
 */
export async function revokeMember(ringId: string, memberId: string): Promise<{ deleted: boolean; deleteError: string | null }> {
  return mutateRingsDoc(async (d) => {
    const r = ringOf(d, ringId);
    const m = r.members[memberId];
    if (!m || isHidden(m)) throw new Error("that person isn't in this ring (they may have been removed already)");
    m.hiddenAt = Date.now();
    m.since = {};
    for (const [pid, depth] of Object.entries(r.depths)) if (depth === "posts") rotate(d, pid);
    const owner = ringId + "|" + memberId;
    const mine = d.live.filter((x) => x.owner === owner);
    const err = await deleteRows(mine.map((x) => x.tokenHex));
    if (!err) d.live = d.live.filter((x) => x.owner !== owner);
    d.publish.dirty = true;
    return { deleted: !err, deleteError: err };
  });
}

/** delete a ring: everyone in it leaves (rows deleted now), every persona it showed at "posts" rotated.
 *  PERSONA LAUNCH GO-LIVE (UXH-9): the ring is HIDDEN with everything in it (its name, its people, what it sees) and
 *  restoreRing brings it back; only its people's key bookkeeping is emptied. The drop rows deleted here are the
 *  network-side copies of its notes, not the owner's records (see revokeMember). */
export async function deleteRing(ringId: string): Promise<{ deleteError: string | null }> {
  return mutateRingsDoc(async (d) => {
    const r = ringOf(d, ringId);
    // its members leave every audience it gave (a fresh chain each); a ring with nobody in use in it shrinks nothing
    if (visibleMembers(r).length > 0) for (const [pid, depth] of Object.entries(r.depths)) if (depth === "posts") rotate(d, pid);
    const prefix = ringId + "|";
    const mine = d.live.filter((x) => x.owner !== null && x.owner.startsWith(prefix));
    const err = await deleteRows(mine.map((x) => x.tokenHex));
    if (!err) d.live = d.live.filter((x) => !(x.owner !== null && x.owner.startsWith(prefix)));
    r.hiddenAt = Date.now();
    for (const m of Object.values(r.members)) m.since = {};
    d.publish.dirty = true;
    return { deleteError: err };
  });
}

/**
 * PERSONA LAUNCH GO-LIVE (UXH-9) — RESTORE a person you removed (Settings › Rings › Recently removed). A join (rejoin):
 * they see posts from now on, not the ones made while they were removed. Refused in plain words when the ring is
 * deleted (restore the ring first) or already full. Restoring someone already back changes nothing (`restored: false`).
 */
export async function restoreMember(ringId: string, memberId: string): Promise<{ restored: boolean }> {
  const admissible = await admissiblePersonas();
  return mutateRingsDoc((d) => {
    const r = ringOf(d, ringId);
    const m = r.members[memberId];
    if (!m) throw new Error("that person isn't one you removed from this ring");
    if (!isHidden(m)) skipSeal({ restored: false });
    if (visibleMembers(r).length >= MAX_MEMBERS_PER_RING) throw new Error(`"${r.label}" already holds ${MAX_MEMBERS_PER_RING} people — remove someone first, then restore this person`);
    if (visibleMembers(r).some((x) => x.addrId === m.addrId)) throw new Error("that address is already in this ring");
    assertRingFits(d, r, admissible);
    m.hiddenAt = null;
    m.since = {};
    rejoin(d, r, [m]);
    return { restored: true };
  });
}

/**
 * PERSONA LAUNCH GO-LIVE (UXH-9) — RESTORE a deleted ring: its name, what it sees and the people who were in it when it
 * was deleted (not the ones removed from it before) come back, joining as ONE join (rejoin): they see posts from now on,
 * not the ones made while it was deleted. Refused in plain words when 16 rings are already in use or one of them has
 * its name. Restoring a ring already back changes nothing (`restored: false`).
 */
export async function restoreRing(ringId: string): Promise<{ restored: boolean }> {
  const admissible = await admissiblePersonas();
  return mutateRingsDoc((d) => {
    const r = d.rings[ringId];
    if (!r) throw new Error("that ring isn't one you deleted");
    if (!isHidden(r)) skipSeal({ restored: false });
    const inUse = visibleRings(d);
    if (inUse.length >= MAX_RINGS) throw new Error(`you already have ${MAX_RINGS} rings in use — delete one first, then restore this one`);
    if (inUse.some((x) => sameLabel(x.label, r.label))) throw new Error(`you already have a ring named "${r.label}" — rename that one first, then restore this one`);
    r.hiddenAt = null;
    assertRingFits(d, r, admissible);
    for (const m of Object.values(r.members)) m.since = {};
    rejoin(d, r, visibleMembers(r));
    d.publish.dirty = true;
    return { restored: true };
  });
}

// ------------------------------------------------------------------------------------------------ the statement

/** the root's public face, read ONLY through rootHeadshot() — THROWS on an unreadable record (the publish refuses) */
export async function rootForStatement(): Promise<RingRoot | null> {
  const { rootHeadshot } = await import("@/lib/identity/rootHeadshot");
  const h = await rootHeadshot();
  if (!h) return null;
  const fname = /^[A-Za-z0-9_.-]{1,64}$/.test(h.fname) ? h.fname : null;
  if (!fname) return null;
  const displayName = plainText(h.displayName, 48);
  return { fname, displayName, ...(thumbOk(h.pfpUrl) ? { thumb: h.pfpUrl as string } : {}) };
}

/** one member's statement (the publisher seals it). `admissible` decides which of the ring's personas still count. */
export function buildStatement(d: RingsDoc, r: Ring, m: RingMember, root: RingRoot | null, admissible: AdmissiblePersona[], now: number, leaseHours = DEFAULT_LEASE_HOURS): RingStatement {
  const byId = new Map(admissible.map((p) => [p.personaId, p]));
  const subjects: RingSubject[] = [];
  for (const [pid, depth] of Object.entries(r.depths)) {
    const p = byId.get(pid);
    if (!p) continue; // deleted, made private, or the public self: not a subject any more
    const k = personaKeys(d, pid, now);
    const noteKeys = depth === "posts" ? keysForMember(d, r, m, pid) : [];
    const display = plainText(p.name, 48) ?? p.handle;
    subjects.push({
      ref: k.ref,
      handle: p.handle,
      display,
      ...(p.fid ? { fid: p.fid } : {}),
      kind: "persona",
      depth,
      ...(thumbOk(p.avatarUrl) ? { thumb: p.avatarUrl as string } : {}),
      ...(depth === "posts" ? { noteKeys } : {}),
    });
  }
  // UX-R1: members see the "share as" name, else the root's name, else NEUTRAL_SHARED_BY — never the ring's own label
  const shareAs = r.shareAs ?? null;
  const label = shareAs ?? (root ? root.displayName ?? root.fname : NEUTRAL_SHARED_BY);
  // SPEC C: the posts the owner sent this ring that are still within their three days (every member of the ring is
  // sealed the same ones; none at all = no field, the statement exactly as before)
  const sends = liveSends(r, now);
  return {
    v: 1,
    addrId: m.addrId,
    rid: r.id,
    seq: Math.max(m.seq + 1, now),
    issuedAt: now,
    expiresAt: now + leaseHours * 3_600_000,
    label: plainText(label, LABEL_MAX) ?? NEUTRAL_SHARED_BY,
    root,
    subjects,
    ...(sends.length ? { sends } : {}),
  };
}

// ------------------------------------------------------------------------------------------------ SPEC C: sends

/** the sends a statement built now carries: within RING_SEND_TTL_MS, newest first, at most MAX_RING_SENDS */
export function liveSends(r: Ring, now: number): RingSend[] {
  return (r.sends ?? [])
    .filter((s) => s.at > now - RING_SEND_TTL_MS && s.at <= now + 5 * 60_000)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_RING_SENDS)
    .map((s) => ({ fid: s.fid, hash: s.hash, at: s.at }));
}

/** a send refused before anything is written, with the hub's own code and sentence (the route answers them) */
export class RingSendRefused extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "RingSendRefused";
  }
}

/**
 * SPEC C — CLOSE-FRIEND SENDS: send a Farcaster post (by its protocol id) to everyone IN USE in one of your rings. It
 * rides the next sealed statement to each of them (the tick publishes a ring with people in it at once, as an add does)
 * and is told for three days. ROOT ONLY and never about your personas:
 *   * refused unless the root acts (409 acting_persona): a ring is the root's, and a post a persona saw, sent to the
 *     people who know the root, would tell them what the persona reads. Only the live site has acting as yourself, so
 *     off it (the rig, the owner service) a send is always refused;
 *   * refused for a post by one of your own personas (403 own_persona): sending it to the people who know you would be
 *     you vouching for that persona, a link drawn by your own hand;
 *   * the post's text is never sealed (its id only): the member's browser shows it only if it already holds it.
 * The same post sent again moves to the top (one entry, a fresh time); a fifth pushes the oldest out.
 */
export async function sendToRing(ringId: string, target: unknown): Promise<{ members: number; sends: number }> {
  const t = (target ?? {}) as { fid?: unknown; hash?: unknown };
  const fid = t.fid;
  const hash = typeof t.hash === "string" ? t.hash.toLowerCase() : "";
  if (!Number.isSafeInteger(fid) || (fid as number) <= 0 || (fid as number) >= 2 ** 40 || !RING_SEND_HASH_RE.test(hash)) throw new Error("a send names a Farcaster post by its account number and its hash");
  const sep = await import("@/lib/fc/hubRead/separation");
  const { HUB_READ_SENTENCES } = await import("@/lib/fc/hubRead/copy");
  // the ROOT must be acting: the live site's device with no persona named (off the live site a persona always acts)
  let rootActs = false;
  try {
    rootActs = await sep.rootActs();
  } catch {
    rootActs = false; // unknown: send nothing (fail closed)
  }
  const acting = !rootActs;
  if (acting) throw new RingSendRefused(409, "acting_persona", HUB_READ_SENTENCES.acting_persona);
  let own: Set<number>;
  try {
    own = (await sep.ownPersonaAccounts()).fids;
  } catch {
    throw new RingSendRefused(503, "vault", HUB_READ_SENTENCES.vault);
  }
  if (own.has(fid as number)) throw new RingSendRefused(403, "own_persona", HUB_READ_SENTENCES.own_persona);
  const at = Math.floor(Date.now() / 60_000) * 60_000;
  return mutateRingsDoc((d) => {
    const r = ringOf(d, ringId);
    const rest = (r.sends ?? []).filter((s) => !(s.hash === hash && s.fid === fid));
    r.sends = [{ fid: fid as number, hash, at }, ...rest].filter((s) => s.at > at - RING_SEND_TTL_MS).slice(0, MAX_RING_SENDS);
    const members = visibleMembers(r).length;
    if (members) d.publish.dirty = true;
    return { members, sends: r.sends.length };
  });
}
