import "server-only";
// PERSONA LAUNCH P2 (BYX G2) — CHUNKED SEALED DOCUMENTS: one module-owned document bigger than one PUT.
//
// A namespace PUT carries at most 256 KiB (validator/limits.js; the persist client refuses more before sending), and a
// sealed body is hex ciphertext, so one namespace holds ~128 KiB of plaintext. An X archive does not fit: 20,000 posts
// are ~6 MB. This module stores such a document as numbered sealed PIECES plus a sealed MANIFEST written LAST:
//
//   `${name}.g${slot}.${i}`  piece i of the document's JSON, sealWhole-sealed under its own name (the AAD binds the
//                            piece to its address: a piece moved to another index or another document fails to open),
//                            carrying {gen, i, n} so a piece left from another save is caught by name, not by luck
//   `${name}.m`              {v:1, gen, n, bytes, sha256, updatedAt, prev}: the generation the pieces belong to, their
//                            count, and the SHA-256 of the whole JSON — the pieces must add up to exactly this
//
// THE TORN-WRITE RULE: a save writes every piece of generation gen+1 first, then the manifest. A save that dies part
// way leaves the OLD manifest pointing at the OLD pieces, which nothing touched — the reader sees the last complete
// save. Only after the new manifest lands is the previous generation emptied (best effort: a failed clean-up leaves
// unreferenced ciphertext, retried on the next save; the manifest's `prev` tells a later process what to clean).
//
// SLOTS, NOT GENERATIONS, IN THE NAMES (a deliberate change from "g<gen>"): generation gen lives in slot gen % 2. Two
// slots are enough for the torn-write rule (a save never writes into the slot the live manifest points at), and they
// keep the set of names BOUNDED — the device's envelope counters (.keystore/envelope-counters.json, rewritten on every
// signed request), its sealed-name list and the validator's envelope_counters table all hold one row per name forever,
// so a name per generation would grow all three with every save. The generation number itself is in the manifest and
// in every piece.
//
// NEVER FAIL OPEN (the lib/fc/personaFid.ts rule): a manifest that is absent is an EMPTY document ({doc:null}); a
// manifest or piece that cannot be read, is missing, is not sealed, is from another save, was sealed under another key,
// or does not add up to the manifest's hash THROWS — "your X data could not be read (chunk 3 of 7 missing) - nothing
// was changed" — and the module refuses to write until a read has succeeded, so an unreadable document is never
// sealed over with a guess.
//
// ONE WRITER AT A TIME, ON WHAT IS STORED NOW (PERSONA LAUNCH P2, review W1-R1/W1-R3): a save is a MUTATION applied
// inside the per-document lock to the document as it is AT LOCK TIME (updateDoc), never a whole copy built from a read
// made before the lock — two requests that each read, changed one entry and wrote the whole document back used to
// overwrite each other (a resurface toggle lost to another, an import that erased a toggle). And "as it is now" means
// the VALIDATOR's now, not this process's cache: before writing, the save reads the live manifest; when another tab or
// device of the root saved since this process read the document, the cache is dropped, the document re-read, and the
// mutation applied to that (writeDoc, a whole-document replace, refuses instead). The re-read also keeps the slot rule
// honest: the target slot is never the slot the live manifest names, so a stale writer can no longer tear the live
// generation's pieces (which, sharing its generation number, would have failed the hash check on every read).
//
// NAMES ARE PER ROOT, NEVER PER PERSONA: the validator sees every name under an anchor, and a name per persona would
// hand it this root's sibling count. One document per root holds every persona's entries; under LAYERS_WORLD=empty the
// READERS filter by realPersonaIds() (the hydrate partition does not see these documents) and the writers keep every
// entry they did not change — hidden is never deleted.
import { createHash } from "@/lib/platform/crypto";
import { fetchState, flushVault, markSealedName, sealedNamespaces, type ChunkNamespace } from "@/lib/adapters/mock/persist";
import { sealWhole, unsealAny, WHOLE_RECORD_ID } from "@/lib/vault/vault";

/** the plaintext a piece may carry, measured as the bytes it occupies once JSON-escaped and UTF-8 encoded */
export const CHUNK_PLAINTEXT_BYTES = 98304;
/** a sanity bound on a manifest's piece count (20,000 posts are ~66 pieces) */
const MAX_CHUNKS = 4096;
/** pieces written or read at once */
const PARALLEL = 4;

export type ChunkDocName = `x${string}`;

export interface ChunkManifest {
  v: 1;
  gen: number;
  n: number;
  /** UTF-8 bytes of the whole JSON */
  bytes: number;
  sha256: string;
  updatedAt: number;
  /** the generation this save superseded: its slot and piece count, emptied after the manifest landed */
  prev: { slot: number; n: number } | null;
}

interface CacheEntry {
  doc: unknown | null;
  loaded: true;
  gen: number;
  /** pieces each slot may still hold (the live slot's count, and whatever a failed clean-up left in the other) */
  occupied: [number, number];
}

const g = globalThis as unknown as {
  __layersXDocs?: Map<string, CacheEntry>;
  /** per document: the highest generation this process has seen since the last reset (an older copy is refused) */
  __layersXDocGens?: Map<string, number>;
  /** per document: the save in flight, so two writers in one process queue instead of interleaving pieces */
  __layersXDocLocks?: Map<string, Promise<unknown>>;
  /** reads that went to the validator (not the cache) since the last reset — a test can tell a cold read happened */
  __layersXDocColdReads?: number;
  /** per document: the cold read in flight, so concurrent readers share ONE read (two signed GETs of the same name
   *  race their envelope counters, and the loser is refused as stale) */
  __layersXDocInflight?: Map<string, Promise<CacheEntry>>;
  /** bumped by resetXDocsCache: a read or save that began under the previous root never fills the new root's cache */
  __layersXDocEpoch?: number;
};
const cache = (): Map<string, CacheEntry> => (g.__layersXDocs ??= new Map<string, CacheEntry>());
const gens = (): Map<string, number> => (g.__layersXDocGens ??= new Map<string, number>());
const locks = (): Map<string, Promise<unknown>> => (g.__layersXDocLocks ??= new Map<string, Promise<unknown>>());
const inflight = (): Map<string, Promise<CacheEntry>> => (g.__layersXDocInflight ??= new Map<string, Promise<CacheEntry>>());
const epoch = (): number => g.__layersXDocEpoch ?? 0;

/**
 * Forget every cached X document. Called wherever a root's sealed caches are dropped: the store's resetState, the rig's
 * resetSeed and dropSealedCaches (app/api/dev), and the device's reloadIdentity (lib/device/boot.ts) — an unlock or a
 * restore of a different root must never see the previous root's cached shelf.
 */
export function resetXDocsCache(): void {
  cache().clear();
  gens().clear();
  inflight().clear();
  g.__layersXDocEpoch = epoch() + 1;
  g.__layersXDocColdReads = 0;
}

/** how many reads went to the validator since the last reset (diagnostics; the rig's suites read it) */
export function xDocColdReads(): number {
  return g.__layersXDocColdReads ?? 0;
}

export function manifestName(name: ChunkDocName): ChunkNamespace {
  return `${name}.m` as ChunkNamespace;
}
export function chunkName(name: ChunkDocName, gen: number, i: number): ChunkNamespace {
  return `${name}.g${gen % 2}.${i}` as ChunkNamespace;
}
function slotName(name: ChunkDocName, slot: number, i: number): ChunkNamespace {
  return `${name}.g${slot}.${i}` as ChunkNamespace;
}

/** THE sentence a reader throws: what could not be read, and that nothing was changed */
export class ChunkReadError extends Error {
  readonly doc: string;
  constructor(doc: string, what: string) {
    super(`your X data could not be read (${what}) - nothing was changed`);
    this.name = "ChunkReadError";
    this.doc = doc;
  }
}

/**
 * PERSONA LAUNCH P2 (review W1-R3): a whole-document REPLACE (writeDoc) refused because another tab or device of this
 * root saved the document after this process read it. Nothing was written; the cache was dropped, so trying again
 * starts from what is stored now. (A mutation, updateDoc, never meets this: it re-reads and applies itself again.)
 */
export class ChunkStaleError extends Error {
  readonly doc: string;
  constructor(doc: string) {
    super("your X data was changed in another tab or on another device since this page read it - nothing was changed; try again");
    this.name = "ChunkStaleError";
    this.doc = doc;
  }
}

/** what updateDoc's mutation returns to say "nothing to change": no pieces, no manifest, no write at all */
export const UNCHANGED: unique symbol = Symbol("chunkedDoc.unchanged");

/**
 * Split a JSON string into pieces of at most `max` bytes each, measured as JSON-escaped UTF-8 (a quote or backslash is
 * 2, a control character 2 or 6, a lone surrogate 6, then 1/2/3/4 by code point). Measured this way, not by string
 * length, because a piece of CJK text or emoji is up to 3x its length in bytes and its quotes double when the piece is
 * itself JSON-encoded inside the sealed record — a length-based split could produce a PUT over the limit. A surrogate
 * pair is never cut in two.
 */
export function splitForChunks(json: string, max = CHUNK_PLAINTEXT_BYTES): string[] {
  const out: string[] = [];
  let start = 0;
  let cost = 0;
  for (let i = 0; i < json.length; ) {
    const c = json.charCodeAt(i);
    let w: number;
    let len = 1;
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < json.length && (json.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      w = 4;
      len = 2;
    } else if (c >= 0xd800 && c <= 0xdfff) w = 6;
    else if (c === 0x22 || c === 0x5c) w = 2;
    else if (c < 0x20) w = c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6;
    else if (c < 0x80) w = 1;
    else if (c < 0x800) w = 2;
    else w = 3;
    if (cost + w > max && i > start) {
      out.push(json.slice(start, i));
      start = i;
      cost = 0;
    }
    cost += w;
    i += len;
  }
  out.push(json.slice(start));
  return out;
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

function isSealedShape(name: string, entries: Record<string, unknown>): boolean {
  const keys = Object.keys(entries);
  if (keys.length !== 1 || keys[0] !== WHOLE_RECORD_ID) return false;
  const w = entries[WHOLE_RECORD_ID] as { v?: unknown; ct?: unknown; nonce?: unknown; ns?: unknown; id?: unknown } | null;
  return !!w && typeof w === "object" && w.v === 1 && typeof w.ct === "string" && typeof w.nonce === "string" && w.ns === name && w.id === WHOLE_RECORD_ID;
}

/** one read of one piece-or-manifest name: entries, or null when the name holds nothing. Transient failures retried. */
async function readEntries(doc: string, name: string, what: string): Promise<Record<string, unknown> | null> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 200 * attempt));
    const res = await fetchState(name);
    if (res.status === 404) return null;
    if (res.ok) {
      let body: { entries?: Record<string, unknown> } | null = null;
      try {
        body = await res.json();
      } catch {
        throw new ChunkReadError(doc, `${what} came back unreadable`);
      }
      const entries = body?.entries;
      if (!entries || typeof entries !== "object") throw new ChunkReadError(doc, `${what} came back without its contents`);
      return Object.keys(entries).length ? entries : null;
    }
    lastStatus = res.status;
    // PERSONA LAUNCH P2 (review W1-R4): a signed read takes an envelope counter in the same (device, name) sequence
    // as a write, so a read that loses a race to a concurrent request on the same name is refused as a STALE COUNTER
    // — transient: the next attempt is re-signed with a fresh counter. Any other refusal is final.
    if (res.status === 409 && (await staleCounter(res))) continue;
    if (res.status > 0 && res.status < 500) break; // a refusal is not transient
  }
  throw new ChunkReadError(doc, `the validator did not answer for ${what}${lastStatus ? ` (HTTP ${lastStatus})` : ""}`);
}

async function staleCounter(res: { json: () => Promise<any> }): Promise<boolean> {
  try {
    const j = await res.json();
    return typeof j?.error === "string" && /^stale counter/.test(j.error);
  } catch {
    return false;
  }
}

function openSealed<T>(doc: string, name: string, entries: Record<string, unknown>, what: string): T {
  if (!isSealedShape(name, entries)) {
    // Gate 5's rule for namespaces, applied to the pieces: this device sealed it, so a plaintext (or foreign) shape
    // is a hostile or corrupt store, never something to load
    const sealedHere = sealedNamespaces().has(name);
    throw new ChunkReadError(doc, `${what} is not sealed${sealedHere ? " although this device sealed it" : ""}`);
  }
  let inner: Record<string, unknown>;
  try {
    inner = unsealAny(name, entries);
  } catch {
    throw new ChunkReadError(doc, `${what} could not be opened with this identity's key`);
  }
  if (!inner || typeof inner !== "object" || !("_" in inner)) throw new ChunkReadError(doc, `${what} could not be opened with this identity's key`);
  return inner as T;
}

function validManifest(m: unknown): m is ChunkManifest {
  const x = m as ChunkManifest;
  return (
    !!x &&
    typeof x === "object" &&
    x.v === 1 &&
    Number.isSafeInteger(x.gen) &&
    x.gen >= 1 &&
    Number.isSafeInteger(x.n) &&
    x.n >= 1 &&
    x.n <= MAX_CHUNKS &&
    Number.isSafeInteger(x.bytes) &&
    x.bytes >= 0 &&
    typeof x.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(x.sha256)
  );
}

async function inBatches<T>(count: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = new Array(count);
  for (let base = 0; base < count; base += PARALLEL) {
    const idx = Array.from({ length: Math.min(PARALLEL, count - base) }, (_, k) => base + k);
    const got = await Promise.all(idx.map((i) => fn(i)));
    idx.forEach((i, k) => (out[i] = got[k]));
  }
  return out;
}

/** the live manifest as the validator holds it now: null when absent; THROWS when it cannot be read or is malformed */
async function readManifest(name: ChunkDocName): Promise<ChunkManifest | null> {
  const mName = manifestName(name);
  const mEntries = await readEntries(name, mName, "the index of its pieces");
  if (!mEntries) return null;
  const mInner = openSealed<{ _: unknown }>(name, mName, mEntries, "the index of its pieces");
  const m = mInner._;
  if (!validManifest(m)) throw new ChunkReadError(name, "the index of its pieces is malformed");
  return m;
}

/** a cold read: the manifest, then every piece, verified piece by piece and as a whole */
async function readCold(name: ChunkDocName): Promise<CacheEntry> {
  g.__layersXDocColdReads = (g.__layersXDocColdReads ?? 0) + 1;
  const m = await readManifest(name);
  const seen = gens().get(name) ?? 0;
  // the anti-rollback rule covers a VANISHED index too (review W1-R3): this process saw save `seen`, so an absent
  // manifest is a store that lost or dropped it — never an empty document a save would then seal over as generation 1
  if (!m && seen > 0) throw new ChunkReadError(name, `the index of its pieces is gone after save ${seen}`);
  if (!m) return { doc: null, loaded: true, gen: 0, occupied: [0, 0] };
  if (m.gen < seen) throw new ChunkReadError(name, `an older copy (save ${m.gen}) was served after save ${seen}`);
  const pieces = await inBatches(m.n, async (i) => {
    const label = `chunk ${i + 1} of ${m.n}`;
    const cName = chunkName(name, m.gen, i);
    const entries = await readEntries(name, cName, label);
    if (!entries) throw new ChunkReadError(name, `${label} missing`);
    const inner = openSealed<{ _: unknown; gen?: unknown; i?: unknown; n?: unknown }>(name, cName, entries, label);
    if (inner.gen !== m.gen || inner.i !== i || inner.n !== m.n || typeof inner._ !== "string")
      throw new ChunkReadError(name, `${label} is from another save`);
    return inner._ as string;
  });
  const json = pieces.join("");
  if (utf8Bytes(json) !== m.bytes || sha256Hex(json) !== m.sha256) throw new ChunkReadError(name, `its ${m.n} pieces do not add up to what was saved`);
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new ChunkReadError(name, "its contents are not readable");
  }
  gens().set(name, m.gen);
  const occupied: [number, number] = [0, 0];
  occupied[m.gen % 2] = m.n;
  if (m.prev && (m.prev.slot === 0 || m.prev.slot === 1) && m.prev.slot !== m.gen % 2) occupied[m.prev.slot] = Math.max(0, Math.min(MAX_CHUNKS, m.prev.n | 0));
  return { doc, loaded: true, gen: m.gen, occupied };
}

/**
 * Read a document: the cached copy when this process holds one, else a cold read from the validator. Absent = {doc:
 * null}. Anything unreadable THROWS a ChunkReadError (and nothing is cached, so the next call tries again).
 */
export async function readDoc<T>(name: ChunkDocName): Promise<{ doc: T | null; loaded: true; gen: number }> {
  const hit = cache().get(name);
  if (hit) return { doc: hit.doc as T | null, loaded: true, gen: hit.gen };
  const entry = await coldOnce(name);
  return { doc: entry.doc as T | null, loaded: true, gen: entry.gen };
}

/** ONE cold read per document at a time (concurrent readers share it); the result fills the cache unless a newer save
 *  landed meanwhile or the root was reset under it */
function coldOnce(name: ChunkDocName): Promise<CacheEntry> {
  const pending = inflight().get(name);
  if (pending) return pending;
  const at = epoch();
  const run = readCold(name).then((entry) => {
    if (epoch() !== at) return entry; // the root changed under this read: answer the caller, cache nothing
    // a save that finished while this read was in flight wins (its entry is newer)
    const raced = cache().get(name);
    if (raced && raced.gen >= entry.gen) return raced;
    cache().set(name, entry);
    return entry;
  });
  inflight().set(name, run);
  const clear = () => {
    if (inflight().get(name) === run) inflight().delete(name);
  };
  run.then(clear, clear);
  return run;
}

/** the cached copy, or undefined when this process has not read the document yet (sync readers skip it until then) */
export function cachedDoc<T>(name: ChunkDocName): { doc: T | null; gen: number } | undefined {
  const hit = cache().get(name);
  return hit ? { doc: hit.doc as T | null, gen: hit.gen } : undefined;
}

/** run `task` inside the document's lock: two writers in one process queue instead of interleaving pieces */
function locked<R>(name: ChunkDocName, task: () => Promise<R>): Promise<R> {
  const prior = locks().get(name) ?? Promise.resolve();
  const run = prior.catch(() => undefined).then(task);
  locks().set(name, run);
  const clear = () => {
    if (locks().get(name) === run) locks().delete(name);
  };
  run.then(clear, clear);
  return run;
}

export interface WriteResult<T> {
  /** the document as stored after the call (the cached copy: never mutate it) */
  doc: T | null;
  gen: number;
  /** false when the mutation answered UNCHANGED (nothing was written) */
  wrote: boolean;
  n: number;
  bytes: number;
}

/**
 * PERSONA LAUNCH P2 (review W1-R1) — CHANGE a document: `mutate` runs INSIDE the lock, on a private copy of the document
 * as stored at that moment (absent = null), and what it returns is saved; UNCHANGED saves nothing. It must be pure and
 * synchronous: it may run twice (again on the re-read copy when another tab or device saved since this process read
 * the document), and anything slow (a download, a vault read) belongs before the call. Throwing from it aborts the save
 * with nothing written. THROWS when the document cannot be read (a save never seals over what it could not see).
 */
export function updateDoc<T>(name: ChunkDocName, mutate: (cur: T | null) => T | typeof UNCHANGED): Promise<WriteResult<T>> {
  return locked(name, () => writeLocked<T>(name, mutate, "update"));
}

/**
 * REPLACE a document wholesale: every piece of the next generation, then the manifest, then the previous generation
 * emptied. The cache changes only after the manifest landed, so memory never claims a save the validator does not
 * hold. Refuses (throws) when the document cannot be read first, and (ChunkStaleError) when another tab or device saved
 * it since this process read it — a whole copy built from an older read must not silently replace that save. Product
 * code changes documents through updateDoc; this is for a caller that truly means "exactly this, nothing else".
 */
export async function writeDoc<T>(name: ChunkDocName, doc: T): Promise<{ gen: number; n: number; bytes: number }> {
  const r = await locked(name, () => writeLocked<T>(name, () => doc, "replace"));
  return { gen: r.gen, n: r.n, bytes: r.bytes };
}

/** a private copy for a mutation: the cached document is shared with every synchronous reader */
const copyOf = <T>(doc: unknown): T | null => (doc === null || doc === undefined ? null : (structuredClone(doc) as T));

/**
 * The validator's live generation against this process's cached one (review W1-R3). Equal: the cache is current.
 * Different: the cache is dropped — older on the validator is a rollback (refused, as a cold read refuses it); newer is
 * another tab's or device's save, which a REPLACE refuses and a MUTATION re-reads and applies itself to.
 */
async function reconcileWithLive(name: ChunkDocName, cur: CacheEntry, mode: "update" | "replace"): Promise<CacheEntry> {
  const live = await readManifest(name); // THROWS when unreadable: never a save over a manifest it could not read
  const liveGen = live ? live.gen : 0;
  if (liveGen === cur.gen) return cur;
  cache().delete(name);
  if (liveGen < cur.gen) throw new ChunkReadError(name, `an older copy (save ${liveGen}) was served after save ${cur.gen}`);
  if (mode === "replace") throw new ChunkStaleError(name);
  const at = epoch();
  const fresh = await readCold(name);
  if (epoch() === at) cache().set(name, fresh);
  return fresh;
}

async function writeLocked<T>(name: ChunkDocName, mutate: (cur: T | null) => T | typeof UNCHANGED, mode: "update" | "replace"): Promise<WriteResult<T>> {
  const at = epoch();
  let fresh = false;
  if (!cache().get(name)) {
    await readDoc(name); // throws when unreadable: no save over an unread document
    fresh = true;
  }
  let cur = cache().get(name);
  if (!cur) throw new ChunkReadError(name, "it was forgotten while this save was waiting (the identity changed)");
  // a document this call has just read cold IS the validator's now; a cached one is checked against the live manifest
  if (!fresh) cur = await reconcileWithLive(name, cur, mode);
  const next = mutate(copyOf<T>(cur.doc));
  if (next === UNCHANGED) return { doc: cur.doc as T | null, gen: cur.gen, wrote: false, n: cur.occupied[cur.gen % 2], bytes: 0 };
  const json = JSON.stringify(next ?? null);
  const pieces = splitForChunks(json);
  const n = pieces.length;
  if (n > MAX_CHUNKS) throw new Error(`your X data is too large to save (${n} pieces; the limit is ${MAX_CHUNKS}) - nothing was changed`);
  const gen = cur.gen + 1;
  const slot = gen % 2;
  const other = 1 - slot;
  // THE SLOT RULE, asserted: never the slot the live manifest names (cur.gen is the live generation by now)
  if (cur.gen > 0 && slot === cur.gen % 2) throw new Error(`[x-docs] ${name}: refusing to write over the live generation's slot`);
  try {
    await inBatches(n, async (i) => {
      const cName = chunkName(name, gen, i);
      markSealedName(cName);
      await flushVault(cName, sealWhole(cName, { _: pieces[i], gen, i, n }));
    });
  } catch (e) {
    // a TORN save: the live manifest still names the previous generation, whose pieces nothing touched. Some of this
    // save's pieces may have landed in the other slot — remembered, so the next save empties what it does not reuse.
    cur.occupied[slot] = Math.max(cur.occupied[slot], n);
    throw e;
  }
  const manifest: ChunkManifest = {
    v: 1,
    gen,
    n,
    bytes: utf8Bytes(json),
    sha256: sha256Hex(json),
    updatedAt: Date.now(),
    prev: cur.gen > 0 ? { slot: other, n: cur.occupied[other] } : null,
  };
  const mName = manifestName(name);
  markSealedName(mName);
  await flushVault(mName, sealWhole(mName, { _: manifest }));
  // the save is DONE: memory may say so now (unless the root was reset under it)
  const occupied: [number, number] = [0, 0];
  occupied[slot] = Math.max(n, cur.occupied[slot]);
  occupied[other] = cur.occupied[other];
  const entry: CacheEntry = { doc: JSON.parse(json), loaded: true, gen, occupied };
  if (epoch() === at) {
    cache().set(name, entry);
    gens().set(name, gen);
  }
  // clean-up, best effort: the superseded generation's pieces, and any leftovers past n in this slot
  const stale: ChunkNamespace[] = [];
  for (let i = 0; i < cur.occupied[other]; i++) stale.push(slotName(name, other, i));
  for (let i = n; i < cur.occupied[slot]; i++) stale.push(slotName(name, slot, i));
  let cleaned = true;
  await inBatches(stale.length, async (k) => {
    try {
      await flushVault(stale[k], {});
    } catch {
      cleaned = false;
    }
  });
  if (cleaned) {
    entry.occupied[other] = 0;
    entry.occupied[slot] = n;
  } else {
    console.warn(`[x-docs] ${name}: the previous save's pieces were not all emptied (unreferenced ciphertext; retried on the next save)`);
  }
  return { doc: entry.doc as T | null, gen, wrote: true, n, bytes: manifest.bytes };
}

// ------------------------------------------------------------------------------------------------ rig-only test hooks

const tampered = new Map<string, Record<string, unknown>>();

/**
 * RIG-ONLY (app/api/x/import devTamperChunk, refused off the rig there): flip one hex digit of one stored piece on the
 * validator — through the device's own signed write, the adversary's edit as the reader will meet it — WITHOUT touching
 * this process's cache. The original is kept here for restoreChunk. Proves, with /api/dev dropSealedCaches, that the
 * next read is a cold one and that a damaged piece is refused (scripts/accept-x5.mjs R7).
 */
export async function tamperChunk(ns: string): Promise<{ ok: true; ns: string }> {
  if (!/^x[A-Za-z]+\.(m|g[01]\.\d+)$/.test(ns)) throw new Error("not an X document piece: " + ns);
  const res = await fetchState(ns);
  const entries = (res.ok ? ((await res.json()) as { entries?: Record<string, unknown> }).entries : null) ?? {};
  const whole = entries[WHOLE_RECORD_ID] as { ct?: string } | undefined;
  if (!whole || typeof whole.ct !== "string") throw new Error("no sealed piece stored under " + ns);
  tampered.set(ns, entries);
  const flipped = { ...whole, ct: (whole.ct[0] === "0" ? "1" : "0") + whole.ct.slice(1) };
  await flushVault(ns as ChunkNamespace, { [WHOLE_RECORD_ID]: flipped });
  return { ok: true, ns };
}

/** RIG-ONLY: put back what tamperChunk changed */
export async function restoreChunk(ns: string): Promise<{ ok: boolean; ns: string }> {
  const original = tampered.get(ns);
  if (!original) return { ok: false, ns };
  await flushVault(ns as ChunkNamespace, original);
  tampered.delete(ns);
  return { ok: true, ns };
}
