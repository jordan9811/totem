import "server-only";
// POST-DEPLOY Gate 4 — READWISE: THE KNOBS AND THE DWELL MECHANIC.
//
// WHAT THIS IS NOT, stated first because the temptation is the whole problem:
// there is no retention model here, no spaced repetition, no forgetting curve,
// no difficulty estimate. The owner asked for the KNOBS. A model would decide
// FOR them how often and how much, which is the opposite of a knob, and a
// previous pass overbuilt exactly this. The long-term idea lives on the ideas
// page and nowhere else. What is here is: two sliders, a folder weight, a
// dwell threshold that is arithmetic on word count, and a bin you can get
// things back out of.
//
// DWELL IS BEHAVIOURAL DATA ABOUT THE OWNER — how long they looked at a
// paragraph. It is the most intimate thing readwise produces, so it is written
// DIRECTLY to a sealed vault record and never through an adapter: no adapter
// method takes it, so no adapter payload can carry it, and the Gate 4 suite
// greps for exactly that.
//
// A THRESHOLD SCALED TO LENGTH, not a constant. A fixed threshold makes a
// forty-word chunk always-read and a four-hundred-word chunk never-read, which
// turns the whole mechanic into a measurement of chunk size. Words divided by
// a reading rate, with a floor so a two-word chunk is not read by a blink.
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";

export const VAULT_NS = "readwiseState";

/** words per minute a person reads a timeline chunk at — skimming, not studying */
export const READ_WPM = 240;
/** how much of a chunk counts as having read it: half of it, at that rate */
export const READ_FRACTION = 0.5;
/** the floor, so a two-word chunk cannot be read by a blink */
export const DWELL_FLOOR_MS = 1500;

export const DEFAULTS = { perBuild: 4, chunkWords: 280 };
export const LIMITS = { perBuild: [1, 8], chunkWords: [80, 600] } as const;

export interface ReadwiseKnobs {
  /** how many readwise chunks may be spliced into ONE feed build — the cadence slider */
  perBuild: number;
  /** the target words per chunk — the "how short-form is the breakdown" slider */
  chunkWords: number;
}

export interface DwellRecord {
  /** accumulated milliseconds on this chunk, across every time it surfaced */
  ms: number;
  /** crossed the length-scaled threshold */
  read: boolean;
  /** how many times it came back after being surfaced and not read */
  requeues: number;
  at: number;
}

export interface BinEntry {
  chunkId: string;
  postHash: string;
  index: number;
  text: string;
  buriedAt: number;
}

interface Doc {
  /** per MODE, because "how often" is a property of the reading context, like every other mode knob */
  knobs: Record<string, ReadwiseKnobs>;
  /** bookmark folders whose chunks weigh more in the queue. A plain weight, not a model. */
  priorityFolders: string[];
  /** chunkId ("<postHash>#chunk<N>") → dwell. NOT keyed by persona: see crossPersona() */
  dwell: Record<string, DwellRecord>;
  /** the recycle bin. X-ing out a chunk BURIES it; if dismissal were a void,
   *  people would stop dismissing and the mechanic would stall. */
  bin: Record<string, BinEntry>;
  loaded: boolean;
}

const EMPTY: Doc = { knobs: {}, priorityFolders: [], dwell: {}, bin: {}, loaded: false };
const g = globalThis as unknown as { __layersReadwiseState?: Doc };

async function load(): Promise<Doc> {
  if (g.__layersReadwiseState) return g.__layersReadwiseState;
  let doc: Doc = { ...EMPTY, knobs: {}, priorityFolders: [], dwell: {}, bin: {} };
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(VAULT_NS);
      if (res.status === 404) {
        doc.loaded = true;
        break;
      }
      if (!res.ok) throw new Error("validator answered " + res.status);
      const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
      if (entries && Object.keys(entries).length) {
        const plain = decryptNamespace(VAULT_NS, entries);
        const rec = plain["_"] as { m?: Partial<Doc> } | undefined;
        // GATE 5 (attack-post-3 F-1): records present but none readable is a CORRUPTED
        // namespace, not an empty one. Treating it as empty emptied the recycle bin and
        // un-read everything, then sealed that over the real record.
        if (!rec)
          throw new Error(
            "vault: readwiseState holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one"
          );
        const m = (rec?.m ?? {}) as Partial<Doc>;
        doc = {
          knobs: (m.knobs as Record<string, ReadwiseKnobs>) ?? {},
          priorityFolders: Array.isArray(m.priorityFolders) ? m.priorityFolders : [],
          dwell: (m.dwell as Record<string, DwellRecord>) ?? {},
          bin: (m.bin as Record<string, BinEntry>) ?? {},
          loaded: true,
        };
      } else {
        // GATE 5 (attack-post-3 F-1, path 1): see lib/vault/sealedPins.ts — a deleted
        // namespace and one that was never written look identical on the wire.
        const { wasEverSealed } = await import("@/lib/vault/sealedPins");
        if (wasEverSealed(VAULT_NS))
          throw new Error(
            "vault: readwiseState is EMPTY on the validator but this device has sealed it before — refusing rather than treating a deleted namespace as a fresh one"
          );
        doc.loaded = true;
      }
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (String((e as Error).message).includes("vault")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  // Never fail open: an unreadable record read as "nothing is buried, nothing
  // is read" would resurface everything the owner dismissed, which is the one
  // failure mode that makes a reading queue unusable.
  if (!doc.loaded)
    throw new Error(
      "readwise state unavailable (" +
        ((lastErr as Error)?.message ?? "validator unreachable") +
        ") — refusing rather than treating the vault as empty"
    );
  g.__layersReadwiseState = doc;
  return doc;
}

async function save(doc: Doc): Promise<void> {
  if (!doc.loaded) throw new Error("readwise state was never loaded from the validator — refusing to seal over it");
  // GATE 5 (attack-post-3 F-5): adopt the cache only once the flush succeeds, and refuse a
  // caller that hands back the cached object — a rollback to an already-mutated reference is
  // not a rollback.
  const previous = g.__layersReadwiseState;
  if (previous === doc) throw new Error("internal: save() was handed the cached document — build a new one, or a failed flush cannot be rolled back");
  const m = { knobs: doc.knobs, priorityFolders: doc.priorityFolders, dwell: doc.dwell, bin: doc.bin };
  const inner = JSON.stringify(m);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const sealed = encryptNamespace(VAULT_NS, { _: { m, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
  try {
    await flushVault(VAULT_NS, sealed);
  } catch (e) {
    g.__layersReadwiseState = previous;
    throw e;
  }
  const { markEverSealed } = await import("@/lib/vault/sealedPins");
  markEverSealed(VAULT_NS);
  g.__layersReadwiseState = doc;
}

export function resetReadwiseStateCache(): void {
  g.__layersReadwiseState = undefined;
}

// ------------------------------------------------------------------- knobs

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Math.round(v)));

export async function knobsFor(modeId: string): Promise<ReadwiseKnobs> {
  const doc = await load();
  return doc.knobs[modeId] ?? { ...DEFAULTS };
}

export async function setKnobs(modeId: string, patch: Partial<ReadwiseKnobs>): Promise<ReadwiseKnobs> {
  const doc = await load();
  const now = doc.knobs[modeId] ?? { ...DEFAULTS };
  const next: ReadwiseKnobs = {
    perBuild: patch.perBuild === undefined ? now.perBuild : clamp(Number(patch.perBuild), LIMITS.perBuild),
    chunkWords: patch.chunkWords === undefined ? now.chunkWords : clamp(Number(patch.chunkWords), LIMITS.chunkWords),
  };
  await save({ ...doc, knobs: { ...doc.knobs, [modeId]: next } });
  return next;
}

// --------------------------------------------------------- priority folders

export async function priorityFolders(): Promise<string[]> {
  return [...(await load()).priorityFolders];
}

export async function setPriorityFolder(folderId: string, on: boolean): Promise<string[]> {
  const doc = await load();
  const set = new Set(doc.priorityFolders);
  if (on) set.add(folderId);
  else set.delete(folderId);
  const folders = [...set];
  await save({ ...doc, priorityFolders: folders });
  return folders;
}

// -------------------------------------------------------------------- dwell

/** words x rate, with a floor. The whole "model". */
export function dwellThresholdMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const ms = (words / READ_WPM) * 60_000 * READ_FRACTION;
  return Math.max(DWELL_FLOOR_MS, Math.round(ms));
}

export const chunkIdOf = (postHash: string, index1: number) => postHash + "#chunk" + index1;

export interface DwellResult {
  chunkId: string;
  dwellMs: number;
  thresholdMs: number;
  read: boolean;
  requeues: number;
}

/** Accumulate time on a chunk. Crossing the length-scaled threshold marks it READ. */
export async function recordDwell(chunkId: string, ms: number, text: string): Promise<DwellResult> {
  const doc = await load();
  const prev = doc.dwell[chunkId] ?? { ms: 0, read: false, requeues: 0, at: 0 };
  const add = Number.isFinite(ms) && ms > 0 ? Math.min(ms, 10 * 60_000) : 0;
  const total = prev.ms + add;
  const threshold = dwellThresholdMs(text);
  const read = prev.read || total >= threshold;
  // A chunk that surfaced and was NOT read requeues — it comes back. The count
  // is kept so the UI can say "you have skipped this three times" rather than
  // silently looping it forever.
  const requeues = prev.read || read ? prev.requeues : prev.requeues + 1;
  await save({ ...doc, dwell: { ...doc.dwell, [chunkId]: { ms: total, read, requeues, at: Date.now() } } });
  return { chunkId, dwellMs: total, thresholdMs: threshold, read, requeues };
}

export async function dwellMap(): Promise<Record<string, DwellRecord>> {
  return { ...(await load()).dwell };
}

// ---------------------------------------------------------------- the bin

export async function bury(chunkId: string, postHash: string, index: number, text: string): Promise<BinEntry> {
  const doc = await load();
  const entry: BinEntry = { chunkId, postHash, index, text, buriedAt: Date.now() };
  await save({ ...doc, bin: { ...doc.bin, [chunkId]: entry } });
  return entry;
}

export async function restore(chunkId: string): Promise<boolean> {
  const doc = await load();
  if (!doc.bin[chunkId]) return false;
  const next = { ...doc.bin };
  delete next[chunkId];
  await save({ ...doc, bin: next });
  return true;
}

export async function binEntries(): Promise<BinEntry[]> {
  const doc = await load();
  return Object.values(doc.bin).sort((a, b) => b.buriedAt - a.buriedAt);
}

export async function buriedIds(): Promise<Set<string>> {
  return new Set(Object.keys((await load()).bin));
}

// --------------------------------------------------------- cross-persona

export interface Progress {
  postHash: string;
  read: number;
  total: number;
  buried: number;
}

/**
 * Reading progress, ROOT-SCOPED BY CONSTRUCTION.
 *
 * The dwell map is keyed by chunk, not by (persona, chunk): this device holds
 * one vault, one person is reading, and a paragraph read as one persona has
 * been read. That is why progress carries across personas without anything
 * being copied — there was never a per-persona copy to reconcile. The suite
 * asserts it by reading this as two different personas and comparing.
 */
export async function progressFor(schedules: { postHash: string; chunks: string[] }[]): Promise<Progress[]> {
  const doc = await load();
  return schedules.map((s) => {
    let read = 0;
    let buried = 0;
    for (let i = 1; i <= s.chunks.length; i++) {
      const id = chunkIdOf(s.postHash, i);
      if (doc.dwell[id]?.read) read++;
      if (doc.bin[id]) buried++;
    }
    return { postHash: s.postHash, read, total: s.chunks.length, buried };
  });
}
