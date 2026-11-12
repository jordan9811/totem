import "server-only";
// UX GATE 3 — selective bookmark / thread resolution. "Don't resolve
// everything, let the user choose sources." Cold sources (an X bookmark
// folder, a DM thread) hold addressable IDs that are NEVER auto-resolved;
// designating a source pays one owned-read per item through the EXISTING
// spend ledger (lib/x/spend.ts), then flows those items into the EXISTING
// readwise chunking + timeline populator — not a parallel card system.
//
// The integration trick: lib/feed.ts's readwiseCards loop resolves a
// schedule's content via `postByHash.get(schedule.postHash)`, same as any
// seeded post. A resolved cold item gets a minimal synthetic SeedPost
// (hash `cold:<itemId>`, authored by the RESOLVING persona — these are
// external X items, not seeded personas, and self-authorship keeps
// personaById lookups trivially valid) injected into that same Map, then
// calls the real scheduleReadwise() adapter method unmodified. The
// existing loop, existing chunker, existing card renderer need zero
// changes.
//
// postByHash is a plain module Map, never itself persisted — a real
// restart rebuilds it from SEED_POSTS only. What IS persisted is
// `coldResolved` (just: which item ids are resolved, and when). Item text
// stays in this file's static fixtures; replayColdResolvedPosts() re-syn-
// thesizes and reinjects on every hydration, mirroring the same
// module-Map-outside-MutableState problem store.ts already solves for
// forked personas in personaById/personaByHandle.
import { createHash } from "@/lib/platform/crypto";
import { state, persistNs, postByHash, SEED_VIEWER, type SeedPost } from "@/lib/adapters/mock/store";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { bank, isEmptyWorld } from "@/lib/world";

export type ColdSourceKind = "bookmarkFolder" | "dmThread";

interface ColdSourceDef {
  id: string;
  personaId: string;
  kind: ColdSourceKind;
  label: string;
}

interface ColdItemDef {
  id: string;
  sourceId: string;
  personaId: string;
  text: string;
  /** the external X author (bookmark) or correspondent (DM) — never a
   * Totem persona; carried for attribution copy only */
  originHandle: string;
  createdAt: number;
}

const NOW = Date.now();
const DAY = 86_400_000;

// Fixture content lives on the seed viewer's primary persona — matches
// every other X-interop fixture (attestations, import sessions) being
// demo'd against one persona rather than fanned across all of them.
// LAYERS_WORLD=empty: no demo sources at all (below) — and never the REAL first persona as their owner, which is what
// SEED_VIEWER.activePersonaId names under the flag
const DEMO_PERSONA = isEmptyWorld() ? "" : SEED_VIEWER.activePersonaId;

const LONGFORM_SEED_TEXT = `Everyone tells you to "read the paper" like the words on the page are the point. They aren't. A paper is the write-up of a decision trail, and most of that trail is missing from the PDF on purpose — cut for length, cut for reviewers, cut because the authors themselves forgot which of the four failed approaches taught them the thing that made approach five work.

So read it backwards. Start with the figure that would embarrass the authors most if it were wrong — usually the main result plot — and ask what would have to be true elsewhere in the paper for that figure to be a lie. Then go find those places. You'll read maybe 40% of the actual text this way, but it'll be the load-bearing 40%.

Second: the related-work section is not a bibliography, it's a map of who the authors were arguing with while they worked. Every citation that gets more than one sentence is a fight the authors picked, and the sentence is their side of it. Read those fights as fights, not as background.

Third, and this is the one nobody tells you: the appendix is where the paper admits what it actually is. Ablations, failure cases, the hyperparameter sweep that didn't make it into the main text because it was inconvenient — that's where you find out if the result is a phenomenon or an artifact of one lucky seed. If a paper has no appendix, that itself is information.

None of this is about reading faster. It's about reading for the decision, not the description. The description is marketing copy for the decision. Once you can see the decision, the rest of the paper reads itself.`;

const COLD_SOURCES: ColdSourceDef[] = bank<ColdSourceDef[]>([
  { id: "cold_bf_longform", personaId: DEMO_PERSONA, kind: "bookmarkFolder", label: "Longform" },
  { id: "cold_bf_everything", personaId: DEMO_PERSONA, kind: "bookmarkFolder", label: "Everything" },
  { id: "cold_dm_rivqueen", personaId: DEMO_PERSONA, kind: "dmThread", label: "DM with @rivqueen" },
  { id: "cold_dm_astro", personaId: DEMO_PERSONA, kind: "dmThread", label: "DM with @astrofan_alt" },
], []);

function placeholderItems(sourceId: string, n: number, handle: string, startAt: number): ColdItemDef[] {
  const items: ColdItemDef[] = [];
  for (let i = 0; i < n; i++) {
    items.push({
      id: `${sourceId}_${i}`,
      sourceId,
      personaId: DEMO_PERSONA,
      text: `Saved item #${i + 1} from @${handle} — a short bookmarked note, cold until you resolve "${sourceId}".`,
      originHandle: handle,
      createdAt: startAt - (n - i) * DAY,
    });
  }
  return items;
}

const COLD_ITEMS: ColdItemDef[] = isEmptyWorld() ? [] : [
  {
    // NOT "cold_bf_longform_0" — placeholderItems below generates that
    // exact id for its own first item (i=0), and two COLD_ITEMS sharing an
    // id collide on the SAME postByHash/readwise key: the second
    // scheduleReadwise call is swallowed by its own idempotency guard, and
    // 40 array entries quietly produce 39 unique schedules. Found via
    // accept-ux3 test 4 ("expected 40, found 39") — a real bug, not flake.
    id: "cold_bf_longform_seed",
    sourceId: "cold_bf_longform",
    personaId: DEMO_PERSONA,
    text: LONGFORM_SEED_TEXT,
    originHandle: "readingnotes",
    createdAt: NOW - 40 * DAY,
  },
  ...placeholderItems("cold_bf_longform", 39, "readingnotes", NOW - 39 * DAY),
  // Deliberately large: resolving this in one shot costs more than the
  // default per-run spend cap ($1 at 3000 * $0.0004) — the fixture that
  // proves "a folder exceeding the spend cap prompts instead of resolving
  // all" without any test-only env override.
  ...placeholderItems("cold_bf_everything", 3000, "various", NOW - 400 * DAY),
  ...placeholderItems("cold_dm_rivqueen", 12, "rivqueen", NOW - 12 * DAY),
  ...placeholderItems("cold_dm_astro", 9, "astrofan_alt", NOW - 9 * DAY),
];

function itemsOf(sourceId: string): ColdItemDef[] {
  return COLD_ITEMS.filter((i) => i.sourceId === sourceId);
}

function resolvedKey(personaId: string, itemId: string): string {
  return `${personaId}:${itemId}`;
}

function isResolved(personaId: string, itemId: string): boolean {
  return state().coldResolved.has(resolvedKey(personaId, itemId));
}

export interface ColdSourceView {
  id: string;
  kind: ColdSourceKind;
  label: string;
  totalCount: number;
  resolvedCount: number;
  coldCount: number;
}

export function coldSourcesFor(personaId: string): ColdSourceView[] {
  return COLD_SOURCES.filter((s) => s.personaId === personaId).map((s) => {
    const items = itemsOf(s.id);
    const resolvedCount = items.filter((i) => isResolved(personaId, i.id)).length;
    return { id: s.id, kind: s.kind, label: s.label, totalCount: items.length, resolvedCount, coldCount: items.length - resolvedCount };
  });
}

export function coldSummaryFor(personaId: string): { totalCold: number; totalResolved: number } {
  const sources = coldSourcesFor(personaId);
  return {
    totalCold: sources.reduce((a, s) => a + s.coldCount, 0),
    totalResolved: sources.reduce((a, s) => a + s.resolvedCount, 0),
  };
}

const syntheticHash = (itemId: string): string => `cold:${itemId}`;

// Hashes this process has injected into postByHash. postByHash lives
// outside MutableState (a plain module Map built once from SEED_POSTS), so
// nothing auto-clears it on reset — track our own so a reset can undo
// exactly what we did, same shape as store.ts's forked-persona purge.
const injectedHashes = new Set<string>();

function injectSyntheticPost(item: ColdItemDef): void {
  const hash = syntheticHash(item.id);
  const post: SeedPost = {
    hash,
    authorAccId: "",
    authorPersonaId: item.personaId,
    text: item.text,
    minutesAgo: Math.max(1, Math.round((NOW - item.createdAt) / 60_000)),
    replyToHash: null,
    quoteOfHash: null,
    storyId: null,
    isUpdate: false,
    truncate: false,
    replies: 0,
    likes: 0,
    recasts: 0,
    views: 0,
  };
  postByHash.set(hash, post);
  injectedHashes.add(hash);
}

/** Restart-survival replay — see the module comment. Idempotent; safe to
 * call on every hydration even when nothing is resolved yet. */
export function replayColdResolvedPosts(): void {
  for (const key of state().coldResolved.keys()) {
    const itemId = key.slice(key.indexOf(":") + 1);
    const item = COLD_ITEMS.find((i) => i.id === itemId);
    if (item) injectSyntheticPost(item);
  }
}

/** Seed reset: undo every synthetic postByHash entry this process made. */
export function purgeColdResolvedPosts(): void {
  for (const hash of injectedHashes) postByHash.delete(hash);
  injectedHashes.clear();
}

/** Attribution copy for a readwise card sourced from cold-store resolution
 * (vs. an ordinary "bookmark this post" readwise schedule). Returns null
 * for any hash that isn't ours — the caller falls back to existing copy. */
export function coldSourceLabelForHash(hash: string): string | null {
  if (!hash.startsWith("cold:")) return null;
  const itemId = hash.slice("cold:".length);
  const item = COLD_ITEMS.find((i) => i.id === itemId);
  const source = item && COLD_SOURCES.find((s) => s.id === item.sourceId);
  if (!source) return null;
  return source.kind === "dmThread" ? `your DM with @${item!.originHandle}` : `your bookmarks · ${source.label}`;
}

export interface ResolveResult {
  resolved: number;
  alreadyResolved: number;
  cost: number;
}

/**
 * Designate a source for resolution. Atomic: the spend-cap gate runs
 * BEFORE any item is marked resolved or scheduled, over the WHOLE pending
 * batch — a cap hit throws SpendCapError with nothing mutated, never a
 * partial resolve. Idempotent: already-resolved items are excluded from
 * the batch up front, so a repeat call with no new items costs nothing and
 * touches the ledger not at all.
 */
export async function resolveSource(personaId: string, sourceId: string): Promise<ResolveResult> {
  const source = COLD_SOURCES.find((s) => s.id === sourceId && s.personaId === personaId);
  if (!source) throw new Error("unknown cold source");
  const items = itemsOf(sourceId);
  const toResolve = items.filter((i) => !isResolved(personaId, i.id));
  if (toResolve.length === 0) {
    return { resolved: 0, alreadyResolved: items.length, cost: 0 };
  }

  const { guardedRead } = await import("@/lib/x/spend");
  // LAYERS_WORLD=empty (review WE-4 audit): the batch key derives from THIS persona's unresolved items, and the
  // `coldResolved` rows it reads (`<persona>:<item>`) name that persona, so for a real persona the partition shows
  // them all — a resolved item cannot read as unresolved under the flag and be paid for twice. (The bank's items are
  // absent under the flag anyway: COLD_ITEMS is empty, so nothing resolves.) The ledger itself is never partitioned.
  const batchKey = createHash("sha256")
    .update(toResolve.map((i) => i.id).sort().join(","))
    .digest("hex")
    .slice(0, 16);
  // Throws SpendCapError before any mutation below if this batch doesn't
  // fit under the per-run/day cap — the caller surfaces that as a refusal.
  const { cost } = await guardedRead({
    idempotencyKey: `coldresolve:${personaId}:${sourceId}:${batchKey}`,
    requests: toResolve.length,
    note: `resolve ${toResolve.length} item(s) from "${source.label}"`,
  });

  const s = state();
  await Promise.all(
    toResolve.map(async (item) => {
      s.coldResolved.set(resolvedKey(personaId, item.id), Date.now());
      injectSyntheticPost(item);
      await retryAdapter(() => adapters.feedHealth.scheduleReadwise(syntheticHash(item.id), personaId, item.text));
    })
  );
  await persistNs("coldResolved");
  return { resolved: toResolve.length, alreadyResolved: items.length - toResolve.length, cost };
}
