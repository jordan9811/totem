import "server-only";
// PERSONA LAUNCH P2 (BYX G3 + G5-lite) — WHO YOU FOLLOW ON X, and who of them is on Farcaster: one chunked sealed
// document per root, `xFollows` (lib/vault/chunkedDoc.ts).
//
//   byPersona  {ids, importedAt}            the followed X account ids the archive listed, per receiving persona
//   matches    {indexVersion, at, items}    the last local match against the keyless index (lib/x/match.ts)
//   queue      []                           RESERVED for the follow queue (BYX G5, a later wave): never added to here,
//                                           but carried as stored through every save (review W1-R6)
//
// D-X-IDS-SEALED-NOT-HASHED: the ids are stored RAW inside the seal. The old per-id hash protected a plaintext
// namespace that no longer exists; whole-document sealing hides names and values alike, and matching is then a set
// lookup instead of ~400k keyed hashes on a phone. The at-rest check stands: no raw X id appears in the validator's
// plaintext (scripts/accept-x5.mjs R5).
import { readDoc, cachedDoc, updateDoc, UNCHANGED } from "@/lib/vault/chunkedDoc";
import { isEmptyWorld, realPersonaIds } from "@/lib/world";

export const FOLLOWS_DOC = "xFollows" as const;

export type MatchState = "new" | "kept" | "queued" | "followed" | "refused" | "failed" | "unconfirmed" | "own";

export interface MatchItem {
  fid: number;
  fname: string;
  /** the X handle the Farcaster verification names */
  xHandle: string;
  /** the followed X account's id (string, never a number) */
  xId: string;
  /** when the X account was verified on Farcaster (ms) */
  verifiedAt: number;
  state: MatchState;
  note?: string;
}

export interface FollowsDoc {
  v: 1;
  byPersona: Record<string, { ids: string[]; importedAt: number }>;
  matches: Record<string, { indexVersion: string; at: number; items: MatchItem[] }>;
  /**
   * BYX G5 (a later wave): the follow queue. This wave never ADDS to it and never acts on it — but it CARRIES whatever is
   * stored there through every load and save (review W1-R6: emptying it on each save meant a rollback from the G5 wave
   * deleted its queue on the first import or "Check again"; hidden is never deleted). Opaque here on purpose.
   */
  queue: unknown[];
}

export const emptyFollows = (): FollowsDoc => ({ v: 1, byPersona: {}, matches: {}, queue: [] });

function validFollows(d: unknown): d is FollowsDoc {
  const x = d as FollowsDoc;
  return !!x && x.v === 1 && !!x.byPersona && typeof x.byPersona === "object" && !!x.matches && typeof x.matches === "object";
}

/** the stored queue, as stored (a later wave's shape; never interpreted here) */
const storedQueue = (d: { queue?: unknown }): unknown[] => (Array.isArray(d.queue) ? d.queue : []);

/** THROWS when unreadable (never an empty list in place of an unreadable one) */
export async function loadFollows(): Promise<FollowsDoc> {
  const r = await readDoc<FollowsDoc>(FOLLOWS_DOC);
  if (r.doc === null) return emptyFollows();
  if (!validFollows(r.doc)) throw new Error("your X data could not be read (the follow list is malformed) - nothing was changed");
  return { ...r.doc, queue: storedQueue(r.doc) };
}

/**
 * PERSONA LAUNCH P2 (review W1-R1) — CHANGE the follow document: `mutate` gets a private copy of it AS STORED when the
 * lock is taken, and what it returns is saved — except the queue, which is always the stored one (this wave never
 * writes it). UNCHANGED saves nothing. Pure and synchronous (it may run twice). THROWS when unreadable or malformed.
 */
export async function updateFollows(mutate: (doc: FollowsDoc) => FollowsDoc | typeof UNCHANGED): Promise<FollowsDoc> {
  const r = await updateDoc<FollowsDoc>(FOLLOWS_DOC, (cur) => {
    if (cur !== null && !validFollows(cur)) throw new Error("your X data could not be read (the follow list is malformed) - nothing was changed");
    const base: FollowsDoc = cur === null ? emptyFollows() : { ...cur, queue: storedQueue(cur) };
    const next = mutate(base);
    return next === UNCHANGED ? UNCHANGED : { ...next, queue: base.queue };
  });
  return r.doc && validFollows(r.doc) ? { ...r.doc, queue: storedQueue(r.doc) } : emptyFollows();
}

/**
 * PUT the given personas' follow lists and matches: each replaces that persona's stored entry, every other persona's is
 * kept, the queue is never touched. Nothing in the product calls it (commits and rematches are updateFollows); it is the
 * harnesses' seeding door, with the same no-lost-update rule as every other write.
 */
export async function saveFollows(doc: FollowsDoc): Promise<void> {
  await updateFollows((cur) => ({ ...cur, byPersona: { ...cur.byPersona, ...doc.byPersona }, matches: { ...cur.matches, ...doc.matches } }));
}

/** LAYERS_WORLD=empty: only this device's real personas are readable */
function readable(personaId: string): boolean {
  return !isEmptyWorld() || realPersonaIds().includes(personaId);
}

export function followIdsOf(doc: FollowsDoc, personaId: string): string[] {
  return readable(personaId) ? doc.byPersona[personaId]?.ids ?? [] : [];
}

export function matchesOf(doc: FollowsDoc, personaId: string): FollowsDoc["matches"][string] | null {
  return readable(personaId) ? doc.matches[personaId] ?? null : null;
}

/**
 * Synchronous, from this process's cached copy only (lib/crosspost/destinations.ts viewerOverlaps): does this
 * persona's imported X follow list include that X account id? false when the document has not been read here yet —
 * the overlap check then falls back to what it knew before (a missing copy never invents an overlap).
 */
export function followsIncludeSync(personaId: string, xId: string): boolean {
  const c = cachedDoc<FollowsDoc>(FOLLOWS_DOC);
  if (!c || !c.doc || !validFollows(c.doc) || !readable(personaId)) return false;
  return (c.doc.byPersona[personaId]?.ids ?? []).includes(xId);
}
