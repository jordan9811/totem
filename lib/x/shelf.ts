import "server-only";
// PERSONA LAUNCH P2 (BYX G3) — THE X SHELF: what an archive import keeps, as two chunked sealed documents.
//
//   xShelf    {v:1, posts: ShelfPost[], likes: ShelfLike[]}  every imported post (original dates, retweets marked) and
//             the capped likes lane — megabytes for a big account, so a CHUNKED document (lib/vault/chunkedDoc.ts)
//   xArchive  {v:1, byPersona: {account, importedAt, lanes, resurfaced}}  per receiving persona: the archive's four
//             account facts (never its email or phone), when, which lanes, and the posts its owner chose to show as new
//
// The resurface choices live in xArchive, NOT on the posts: flipping one post must not rewrite a 66-piece shelf (that
// is 133 signed writes a click, and a busy hour of clicks would hit the validator's per-device write cap).
//
// Both are ONE document per root (never per persona: names are visible to the validator per anchor). Under
// LAYERS_WORLD=empty the readers filter by realPersonaIds(); writers change only their own entries, through a mutation
// applied to the document as stored at lock time (updateShelf / updateArchiveMeta, review W1-R1), so an entry no
// reader shows — or another request just wrote — is still kept: hidden, never deleted, never overwritten by a copy.
//
// LEGACY: posts imported before this change sit in the store namespace `xImportedPosts` (never written again). They
// are read here and carried into the shelf on its next save, with their resurface state; the namespace is not touched.
import { readDoc, writeDoc, cachedDoc, updateDoc, UNCHANGED } from "@/lib/vault/chunkedDoc";
import { state } from "@/lib/adapters/mock/store";
import { isEmptyWorld, realPersonaIds } from "@/lib/world";
import type { ArchiveAccount } from "./archiveParse";

export const SHELF_DOC = "xShelf" as const;
export const ARCHIVE_DOC = "xArchive" as const;

export interface ShelfPost {
  personaId: string;
  /** the X tweet id — a string, always */
  id: string;
  text: string;
  /** the ORIGINAL X date (ms); resurfacing never touches it */
  createdAt: number;
  replyToId: string | null;
  isRetweet: boolean;
  links: string[];
  favoriteCount: number;
  retweetCount: number;
  importedAt: number;
}

export interface ShelfLike {
  personaId: string;
  tweetId: string;
  text: string;
  importedAt: number;
}

export interface ShelfDoc {
  v: 1;
  posts: ShelfPost[];
  likes: ShelfLike[];
}

export interface ArchivePersonaMeta {
  account: ArchiveAccount;
  importedAt: number;
  lanes: string[];
  /** tweet id → the FRESH time it entered feeds (resurfaced); absent = history only */
  resurfaced: Record<string, number>;
}

export interface ArchiveMetaDoc {
  v: 1;
  byPersona: Record<string, ArchivePersonaMeta>;
}

const emptyShelf = (): ShelfDoc => ({ v: 1, posts: [], likes: [] });
const emptyMeta = (): ArchiveMetaDoc => ({ v: 1, byPersona: {} });

function validShelf(d: unknown): d is ShelfDoc {
  const x = d as ShelfDoc;
  return !!x && x.v === 1 && Array.isArray(x.posts) && Array.isArray(x.likes);
}
function validMeta(d: unknown): d is ArchiveMetaDoc {
  const x = d as ArchiveMetaDoc;
  return !!x && x.v === 1 && !!x.byPersona && typeof x.byPersona === "object";
}

/** the legacy store namespace's posts that the shelf does not hold yet, as shelf posts (+ their resurface state) */
function legacyPosts(have: Set<string>): { posts: ShelfPost[]; resurfaced: Map<string, Map<string, number>>; handles: Map<string, { handle: string; at: number }> } {
  const posts: ShelfPost[] = [];
  const resurfaced = new Map<string, Map<string, number>>();
  const handles = new Map<string, { handle: string; at: number }>();
  let legacy: Map<string, import("./importer").ImportedPost>;
  try {
    legacy = state().xImportedPosts;
  } catch {
    return { posts, resurfaced, handles };
  }
  for (const p of legacy.values()) {
    if (!p || typeof p.id !== "string" || typeof p.personaId !== "string") continue;
    // the persona's archive handle and resurface choices come from EVERY legacy post (a post already carried into the
    // shelf still says which archive it came from); the post itself only when the shelf does not hold it yet
    if (p.resurfaced && p.resurfacedAt) {
      const m = resurfaced.get(p.personaId) ?? new Map<string, number>();
      m.set(p.id, p.resurfacedAt);
      resurfaced.set(p.personaId, m);
    }
    if (p.archiveHandle && !handles.has(p.personaId)) handles.set(p.personaId, { handle: p.archiveHandle, at: Number(p.importedAt) || 0 });
    const key = p.personaId + ":" + p.id;
    if (have.has(key)) continue;
    have.add(key);
    posts.push({
      personaId: p.personaId,
      id: p.id,
      text: String(p.text ?? ""),
      createdAt: Number(p.createdAt) || 0,
      replyToId: p.replyToId ?? null,
      isRetweet: /^RT @/.test(String(p.text ?? "")),
      links: Array.isArray(p.links) ? p.links : [],
      favoriteCount: Number(p.favoriteCount) || 0,
      retweetCount: Number(p.retweetCount) || 0,
      importedAt: Number(p.importedAt) || 0,
    });
  }
  return { posts, resurfaced, handles };
}

/**
 * The shelf and the archive facts, read (cold once per process, then cached). THROWS when either cannot be read —
 * never an empty shelf in place of an unreadable one. Legacy posts are folded into the returned copies.
 */
export async function loadShelf(): Promise<{ shelf: ShelfDoc; meta: ArchiveMetaDoc }> {
  const [s, m] = await Promise.all([readDoc<ShelfDoc>(SHELF_DOC), readDoc<ArchiveMetaDoc>(ARCHIVE_DOC)]);
  if (s.doc !== null && !validShelf(s.doc)) throw new Error("your X data could not be read (the shelf is malformed) - nothing was changed");
  if (m.doc !== null && !validMeta(m.doc)) throw new Error("your X data could not be read (the archive record is malformed) - nothing was changed");
  return withLegacy(s.doc ?? emptyShelf(), m.doc ?? emptyMeta());
}

function withLegacy(shelf: ShelfDoc, meta: ArchiveMetaDoc): { shelf: ShelfDoc; meta: ArchiveMetaDoc } {
  const have = new Set(shelf.posts.map((p) => p.personaId + ":" + p.id));
  const legacy = legacyPosts(have);
  // a persona that has an archive record already is described by it (its resurface choices included — a legacy flag
  // must not undo an un-resurface made since); one that has none yet gets one from its legacy posts
  const needMeta = [...legacy.handles.keys()].filter((pid) => !meta.byPersona[pid]);
  if (!legacy.posts.length && needMeta.length === 0) return { shelf, meta };
  const s2: ShelfDoc = legacy.posts.length ? { ...shelf, posts: shelf.posts.concat(legacy.posts) } : shelf;
  const m2: ArchiveMetaDoc = { v: 1, byPersona: { ...meta.byPersona } };
  for (const pid of needMeta) {
    const h = legacy.handles.get(pid)!;
    m2.byPersona[pid] = {
      account: { username: h.handle, accountId: "", displayName: h.handle, createdAt: null },
      importedAt: h.at,
      lanes: ["posts"],
      resurfaced: Object.fromEntries(legacy.resurfaced.get(pid) ?? new Map<string, number>()),
    };
  }
  return { shelf: s2, meta: m2 };
}

/**
 * The cached shelf and archive facts — synchronous, for the readers that cannot wait (the feed's resurfaced cards,
 * search). undefined when this process has not read them yet: those readers skip the shelf until it loads.
 */
export function shelfSync(): { shelf: ShelfDoc; meta: ArchiveMetaDoc } | undefined {
  const s = cachedDoc<ShelfDoc>(SHELF_DOC);
  const m = cachedDoc<ArchiveMetaDoc>(ARCHIVE_DOC);
  if (!s || !m) return undefined;
  const shelf = s.doc && validShelf(s.doc) ? s.doc : emptyShelf();
  const meta = m.doc && validMeta(m.doc) ? m.doc : emptyMeta();
  return withLegacy(shelf, meta);
}

/**
 * PERSONA LAUNCH P2 (review W1-R1) — CHANGE the shelf: `mutate` gets a private copy of the shelf AS STORED when the
 * per-document lock is taken (legacy posts folded in, so a save carries them over), and what it returns is saved;
 * UNCHANGED saves nothing. Pure and synchronous (it may run twice, chunkedDoc.ts updateDoc). THROWS when unreadable or
 * malformed: an unreadable shelf is never written over. Answers the shelf as saved.
 */
export async function updateShelf(mutate: (shelf: ShelfDoc) => ShelfDoc | typeof UNCHANGED): Promise<ShelfDoc> {
  const r = await updateDoc<ShelfDoc>(SHELF_DOC, (cur) => {
    if (cur !== null && !validShelf(cur)) throw new Error("your X data could not be read (the shelf is malformed) - nothing was changed");
    return mutate(withLegacy(cur ?? emptyShelf(), emptyMeta()).shelf);
  });
  return r.doc && validShelf(r.doc) ? r.doc : emptyShelf();
}

/** the same, for the per-persona archive facts and resurface choices (xArchive) */
export async function updateArchiveMeta(mutate: (meta: ArchiveMetaDoc) => ArchiveMetaDoc | typeof UNCHANGED): Promise<ArchiveMetaDoc> {
  const r = await updateDoc<ArchiveMetaDoc>(ARCHIVE_DOC, (cur) => {
    if (cur !== null && !validMeta(cur)) throw new Error("your X data could not be read (the archive record is malformed) - nothing was changed");
    return mutate(withLegacy(emptyShelf(), cur ?? emptyMeta()).meta);
  });
  return r.doc && validMeta(r.doc) ? r.doc : emptyMeta();
}

/** REPLACE the whole shelf (chunkedDoc.ts writeDoc: refused when another tab or device saved it since this process read
 *  it). Nothing in the product calls it — every product write is an updateShelf — it is the harnesses' seeding door. */
export async function saveShelf(doc: ShelfDoc): Promise<void> {
  await writeDoc(SHELF_DOC, doc);
}

/** PUT the given personas' archive records (each replaces that persona's stored record; every other persona's record is
 *  kept — a whole-map save that dropped the personas it did not name would delete them, and hidden is never deleted) */
export async function saveArchiveMeta(doc: ArchiveMetaDoc): Promise<void> {
  await updateArchiveMeta((meta) => ({ v: 1, byPersona: { ...meta.byPersona, ...doc.byPersona } }));
}

/** LAYERS_WORLD=empty: only this device's real personas are readable; elsewhere every persona */
export function readablePersona(personaId: string): boolean {
  return !isEmptyWorld() || realPersonaIds().includes(personaId);
}

/** a persona's posts on a shelf copy, newest first */
export function postsOf(shelf: ShelfDoc, personaId: string): ShelfPost[] {
  if (!readablePersona(personaId)) return [];
  return shelf.posts.filter((p) => p.personaId === personaId).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
}
