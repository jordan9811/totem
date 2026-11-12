// LAYERS_WORLD — THE EMPTY WORLD (opt-in; the owner service).
//
// Default (LAYERS_WORLD unset): the DEMO world. The seeded/fixture "bank" — seed/data/*.json, lib/fixtures/data.json,
// fixtures/x-dms.json, the static cold-store items and hydrate()'s seeders — renders exactly as it always has. The rig,
// every acceptance suite and the public preview run this, byte for byte.
//
// LAYERS_WORLD=empty: nothing from the bank is shown, and nothing is deleted. Three layers, each an ALLOWLIST of what
// is real rather than a denylist of what is demo:
//
//   1. THE BANK IS NOT LOADED. Every module that reads a bank file takes its empty twin through bank(), so a persona,
//      post, channel, campaign, DM... added to those files later is hidden by construction: it is never read.
//   2. THE DEMO SEEDERS DO NOT RUN. hydrate()'s demo seeders (grant graph, private world, backfilled follows, algo
//      marketplace, curator feeds, issuance draft, refutations, filter pack, destination bindings, InfoFi, stakes) are
//      skipped, and validator/seed.js inserts nothing into an empty database.
//   3. STORED DEMO STATE IS HIDDEN, NEVER DELETED. A database that already holds the demo world (the owner service's
//      does, next to the owner's real root and sealed vault) is PARTITIONED when the store hydrates
//      (partitionNamespace): an entry is visible only when EVERY persona it names is one of this device's real
//      personas — minted by this device's keystore, `p_` + 32 hex. An entry naming any other persona (a seeded
//      `persona_*`, the validator's fixture personas, a stranger's `p_`) is hidden, and an entry naming no persona at
//      all is hidden too unless its namespace holds system facts (PERSONA_FREE_VISIBLE: the preset rules, the product
//      lenses, the like/bookmark hash sets — whose demo members dangle, because the posts they name were never
//      loaded). Hidden entries are kept VERBATIM in a process-global stash and merged back into every write of their
//      namespace (mergeHidden), so a write under the flag rewrites the namespace with the hidden rows still in it —
//      the stored demo world survives byte for byte and comes back the moment the flag is unset. The money/receipt
//      namespaces (WHOLE_NAMESPACES) are never partitioned: a cap that forgot real spend would be a fail-open.
//      A collection OWNED by a real persona (blocks[p_X]...) is split element by element, and a write that names a
//      key the partition hid never replaces the hidden record (mergeHidden's collision rule). Ids are unique across
//      restarts (store.ts nextId), so a new record cannot take an old one's key. The state read is fail-closed here
//      and on the owner service whatever the flag says (lib/world-flag.ts strictStateRead).
//
// The real personas are the KEYSTORE's (realPersonaIds): the session, the switcher, the acting persona, the act-as
// list and the "my personas" allowlists all read them under the flag. With none, the acting persona is "" and the
// pages say so, pointing at Settings → Account & Personas, where a plain "create persona" mints one through
// adapters.identity.createPersona (the fork needs a source persona; a first persona has none).
//
// The browser device never runs the empty world under LAYERS_WORLD (a public deployment refuses the flag at boot,
// instrumentation.ts: it would be a silent no-op there). PUBLIC GO-LIVE: it DOES run it in public live mode
// (lib/platform/publicLive.ts; lib/world-flag.ts isEmptyWorld is true in a tab whose device env says PUBLIC_LIVE=on).
// Then all three layers apply IN THE TAB, with the same allowlist: the personas this device's keystore minted. Layer 3
// matters for a returning visitor whose identity was made in the old preview: its stored rows that name a seeded
// persona (a follow, a like of a seed post) are hidden, kept verbatim and merged back into every write, never deleted.
import { listPersonas, type KeystorePersona } from "@/lib/identity/keystore";
import { createHash } from "@/lib/platform/crypto";

export { WORLD_ENV, isEmptyWorld, isHostedRig, isOwnerService, strictStateRead, strictStateReason, worldMode, worldProblem, bank } from "./world-flag";

/** A persona id this device's keystore derives: `p_` + 32 hex (lib/identity/keystore.ts derivePersonaId). */
export const REAL_PERSONA_RE = /^p_[0-9a-f]{32}$/;

/**
 * THE ALLOWLIST: the personas this device's keystore minted. Never a seeded or fixture persona (a keystore entry
 * adopted from the seed carries a `seeded:` nonce and a non-derived id; neither passes). Creation order.
 */
export function realPersonas(): KeystorePersona[] {
  return listPersonas().filter((p) => REAL_PERSONA_RE.test(p.id) && !String(p.nonce ?? "").startsWith("seeded:"));
}

export function realPersonaIds(): string[] {
  return realPersonas().map((p) => p.id);
}

export function isRealPersona(id: string | null | undefined): boolean {
  return !!id && realPersonaIds().includes(id);
}

// ---------------------------------------------------------------- the stored-state partition (layer 3)

/** Never partitioned: real money and real network receipts. A spend cap or a check-before-retry that could not see
 *  an entry would re-spend or re-publish — so these load whole, demo rows and all (they are ledgers, not content).
 *  xSyncCursor is one of them (review WE-4): the X inbox cursor ("layers-inbox", a key naming no persona) feeds the
 *  spend ledger's idempotency key (lib/x/inbox.ts `inbox:layers-inbox:<cursor>`), so hiding it rewound the cursor to
 *  0, re-used spent idempotency keys (a live read went uncounted) and wrote the rewound value over the stored one.
 *
 *  THE AUDIT (review WE-4, every namespace whose VALUES feed a spend idempotency key or a check-before-retry):
 *    xSpend / xSpendRun   the ledger itself and the per-run cap (lib/x/spend.ts recordSpend: put-by-id)       WHOLE
 *    xPublished           idempotency key -> external ref (guardedPublish: a seen key is never re-posted)     WHOLE
 *    xSyncCursor          the inbox cursor AND the per-persona owned-reads cursors (`sync:<persona:kind>:<n>`) WHOLE
 *    fcWrites             the Farcaster write ledger: daily caps + check-before-retry receipts                  WHOLE
 *    zkQueue              proofs awaiting submission: a hidden item would be re-proved and re-submitted         WHOLE
 *  Checked and left PARTITIONED, with the reason: coldResolved (lib/x/coldstore.ts — the batch key derives from the
 *  persona's own rows, which name that persona and so are visible for a real persona; the bank items are absent
 *  under the flag), xImportedPosts / xImportSessions / xMigrationSource (import idempotency per persona per tweet;
 *  the keys name the persona; no spend), crossposts / fcAttribution (display records — the money receipt is
 *  xPublished / fcWrites), altLinkAttempts (a per-persona daily limiter whose rows name the persona). None of them
 *  can make a real-money or real-network action happen twice when hidden. */
export const WHOLE_NAMESPACES: ReadonlySet<string> = new Set(["fcWrites", "xSpend", "xSpendRun", "xPublished", "zkQueue", "xSyncCursor"]);

/** Namespaces whose PERSONA-FREE entries are system facts, visible under the flag: the preset rules (`__preset__`,
 *  which every real persona's preset modes reference), the product lenses (authored by "layers"), and the
 *  like/bookmark hash sets (a demo member names a post that was never loaded, so it dangles invisibly), and the set of
 *  X handles whose attestation was removed (a handle, never a persona: hiding an unlink would re-show a link the owner
 *  removed). Every other namespace hides an entry that names no persona: the allowlist is "names only your personas". */
export const PERSONA_FREE_VISIBLE: ReadonlySet<string> = new Set(["rules", "lenses", "likes", "bookmarks", "xUnlinkedHandles"]);

/** Namespaces stored as named LISTS of persona ids ({disabled: [...]}, {added: [...], removed: [...]}): partitioned
 *  element by element. */
export const LIST_NAMESPACES: ReadonlySet<string> = new Set(["collapsePrefs", "followDeltas"]);

// Every persona-shaped token: a seeded/validator `persona_*` id or a keystore `p_<32 hex>` id (the two shapes this
// codebase mints — app/api/identity/grant/route.ts reads them the same way).
const PERSONA_TOKEN = /(?<![A-Za-z0-9])(?:p_[0-9a-f]{32}(?![0-9a-f])|persona_[A-Za-z0-9_]*[A-Za-z0-9])/g;

/** Every persona an entry names (its key and its value). */
export function personaRefs(key: string, value: unknown): string[] {
  let text: string;
  try {
    text = key + "\u0000" + JSON.stringify(value);
  } catch {
    text = key;
  }
  return text.match(PERSONA_TOKEN) ?? [];
}

/** Visible under the flag: every persona it names is real, and it names at least one — or, naming none, its
 *  namespace holds system facts. */
export function entryIsVisible(ns: string, key: string, value: unknown, real: ReadonlySet<string>): boolean {
  const refs = personaRefs(key, value);
  if (refs.some((r) => !real.has(r))) return false;
  if (refs.length > 0) return true;
  return PERSONA_FREE_VISIBLE.has(ns);
}

/** What the partition took out of one namespace, kept verbatim for the merge. */
export interface HiddenPart {
  records?: Record<string, unknown>;
  opaque?: Record<string, unknown>;
  lists?: Record<string, unknown[]>;
  count: number;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The KEYS a hidden part holds whole records under (records and opaque-map entries; a split list's key is visible
 *  and keeps its visible elements). Review WE-1: store.ts nextId never hands one of these out as a new record's id —
 *  a new record must not take a hidden record's key, whatever the id format. */
export function hiddenKeys(hidden: HiddenPart | null | undefined): string[] {
  if (!hidden) return [];
  return [...Object.keys(hidden.records ?? {}), ...Object.keys(hidden.opaque ?? {})];
}

/** ONE opaque record ({_: {m, pad}}, store.ts opaqueDump) — its map is partitioned, never the wrapper. */
export function isOpaqueShape(entries: Record<string, unknown>): boolean {
  const keys = Object.keys(entries);
  return keys.length === 1 && keys[0] === "_" && isPlainObject(entries._) && isPlainObject((entries._ as { m?: unknown }).m);
}

/**
 * Split one namespace's stored entries (plaintext, after unsealing, `__seq` already stripped) into what the store
 * loads and what it keeps aside. Pure: reads nothing, writes nothing.
 */
export function partitionNamespace(
  ns: string,
  entries: Record<string, unknown>,
  real: ReadonlySet<string>
): { visible: Record<string, unknown>; hidden: HiddenPart | null } {
  if (WHOLE_NAMESPACES.has(ns)) return { visible: entries, hidden: null };
  if (isOpaqueShape(entries)) {
    const wrapper = entries._ as { m: Record<string, unknown> } & Record<string, unknown>;
    const visibleM: Record<string, unknown> = {};
    const hiddenM: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(wrapper.m)) (entryIsVisible(ns, k, v, real) ? visibleM : hiddenM)[k] = v;
    const count = Object.keys(hiddenM).length;
    return { visible: { _: { ...wrapper, m: visibleM } }, hidden: count ? { opaque: hiddenM, count } : null };
  }
  if (LIST_NAMESPACES.has(ns)) {
    const visible: Record<string, unknown> = {};
    const lists: Record<string, unknown[]> = {};
    let count = 0;
    for (const [k, v] of Object.entries(entries)) {
      if (!Array.isArray(v)) {
        visible[k] = v;
        continue;
      }
      const keep: unknown[] = [];
      const drop: unknown[] = [];
      for (const el of v) (entryIsVisible(ns, "", el, real) ? keep : drop).push(el);
      visible[k] = keep;
      if (drop.length) {
        lists[k] = drop;
        count += drop.length;
      }
    }
    return { visible, hidden: count ? { lists, count } : null };
  }
  const visible: Record<string, unknown> = {};
  const records: Record<string, unknown> = {};
  const lists: Record<string, unknown[]> = {};
  let listed = 0;
  for (const [k, v] of Object.entries(entries)) {
    if (entryIsVisible(ns, k, v, real)) {
      visible[k] = v;
      continue;
    }
    // review WE-3: a COLLECTION owned by a real persona (blocks[p_X], followedFacets[p_X], curatorSubs[p_X] — the key
    // names only real personas) is split ELEMENT BY ELEMENT, like LIST_NAMESPACES: the elements naming only real
    // personas load, the rest are kept aside under the same key and merged back. Hiding the whole record hid the
    // owner's own elements too, and the owner's next write under that key (a fresh Set) replaced the stored list.
    const keyRefs = k.match(PERSONA_TOKEN) ?? [];
    if (Array.isArray(v) && keyRefs.length > 0 && keyRefs.every((r) => real.has(r))) {
      const keep: unknown[] = [];
      const drop: unknown[] = [];
      for (const el of v) (personaRefs("", el).some((r) => !real.has(r)) ? drop : keep).push(el);
      visible[k] = keep;
      if (drop.length) {
        lists[k] = drop;
        listed += drop.length;
      }
      continue;
    }
    records[k] = v;
  }
  const count = Object.keys(records).length + listed;
  if (!count) return { visible, hidden: null };
  const hidden: HiddenPart = { count };
  if (Object.keys(records).length) hidden.records = records;
  if (listed) hidden.lists = lists;
  return { visible, hidden };
}

// ---------------------------------------------------------------- collisions (review WE-3)
//
// A write under the flag can name a key the partition hid: a preset mode regenerated for a real persona whose stored
// copy names a demo persona, a channel's member list rebuilt by a join, a vote record re-created by a vote. The
// write REPLACES the stored namespace, so the merge decides what that key holds:
//   - a COLLECTION (an array, or an object whose values are all arrays): merged ELEMENT-WISE. Every hidden element
//     is kept unless this process's value governs it — the same element is in the visible copy, or it names only
//     real personas and the visible copy holds an element for exactly those personas (a re-join replaces the old
//     membership; a demo member's is kept).
//   - anything else: THE STORED (HIDDEN) RECORD IS KEPT, and the collision is reported (onCollision: a loud log and
//     the /api/dev world report). This process keeps its own value in memory; it is never written over the hidden one.

const refSetKey = (refs: string[]) => [...new Set(refs)].sort().join("|");
const isArrayRecord = (v: unknown): v is Record<string, unknown[]> =>
  isPlainObject(v) && Object.values(v).every((x) => Array.isArray(x));

function mergeArrays(hidden: unknown[], visible: unknown[], real: ReadonlySet<string>, visibleSets: ReadonlySet<string>): unknown[] {
  const seen = new Set(visible.map((x) => JSON.stringify(x)));
  const kept = hidden.filter((el) => {
    if (seen.has(JSON.stringify(el))) return false;
    const refs = personaRefs("", el);
    if (refs.length > 0 && refs.every((r) => real.has(r)) && visibleSets.has(refSetKey(refs))) return false;
    return true;
  });
  return [...kept, ...visible];
}

/** The element-wise merge of one colliding COLLECTION record, or null when the values are not collections. */
export function mergeCollection(hiddenV: unknown, visibleV: unknown, real: ReadonlySet<string>): { merged: unknown } | null {
  const setsOf = (els: unknown[]) => new Set(els.map((el) => personaRefs("", el)).filter((r) => r.length > 0).map(refSetKey));
  if (Array.isArray(hiddenV) && Array.isArray(visibleV)) return { merged: mergeArrays(hiddenV, visibleV, real, setsOf(visibleV)) };
  if (isArrayRecord(hiddenV) && Object.keys(hiddenV).length > 0 && isArrayRecord(visibleV)) {
    // record-level: a persona that appears anywhere in the visible copy governs its elements in every list (a vote
    // moved from "concur" to "dispute" must not leave the old one behind)
    const sets = setsOf(Object.values(visibleV).flat());
    const out: Record<string, unknown[]> = {};
    for (const p of new Set([...Object.keys(hiddenV), ...Object.keys(visibleV)])) {
      out[p] = mergeArrays(hiddenV[p] ?? [], visibleV[p] ?? [], real, sets);
    }
    return { merged: out };
  }
  return null;
}

/** What a hidden record holds that this process does not govern — the part a collision merge keeps, and so the
 *  part the evidence fingerprints. Collections: the elements naming a non-real persona or none (sorted, so a merge
 *  that re-orders them is not a change). Anything else: the record itself. */
export function foreignPart(v: unknown, real: ReadonlySet<string>): unknown {
  const foreign = (els: unknown[]) =>
    els
      .filter((el) => {
        const refs = personaRefs("", el);
        return refs.length === 0 || refs.some((r) => !real.has(r));
      })
      .map((el) => JSON.stringify(el))
      .sort();
  if (Array.isArray(v)) return { "[]": foreign(v) };
  if (isArrayRecord(v) && Object.keys(v).length > 0) {
    const out: Record<string, string[]> = {};
    for (const p of Object.keys(v).sort()) out[p] = foreign(v[p]);
    return { "{[]}": out };
  }
  return v;
}

/**
 * Put the hidden entries back into a namespace's dump before it is written — the write REPLACES the stored
 * namespace, so a dump without them would delete them. A key held by BOTH (this process wrote a key the partition
 * hid) is a COLLISION: a collection merges element-wise, anything else KEEPS THE STORED RECORD and is reported
 * through onCollision (see "collisions" above) — the hidden record is never replaced. `wrapOpaque` re-pads an opaque
 * map exactly as store.ts writes one.
 */
export function mergeHidden(
  dump: Record<string, unknown>,
  hidden: HiddenPart | null | undefined,
  wrapOpaque: (m: Record<string, unknown>) => Record<string, unknown>,
  opts: { real?: ReadonlySet<string>; onCollision?: (key: string) => void } = {}
): Record<string, unknown> {
  if (!hidden) return dump;
  const real = opts.real ?? new Set<string>();
  const collide = (k: string, h: unknown, v: unknown): unknown => {
    const m = mergeCollection(h, v, real);
    if (m) return m.merged;
    if (JSON.stringify(h) !== JSON.stringify(v)) opts.onCollision?.(k);
    return h; // THE STORED RECORD IS KEPT
  };
  const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  let out: Record<string, unknown> = dump;
  if (hidden.opaque) {
    const { _: wrapper, ...rest } = out as { _?: { m?: Record<string, unknown> } } & Record<string, unknown>;
    const visibleM = isPlainObject(wrapper) && isPlainObject(wrapper.m) ? wrapper.m : {};
    const m: Record<string, unknown> = { ...hidden.opaque, ...visibleM };
    for (const [k, h] of Object.entries(hidden.opaque)) if (has(visibleM, k)) m[k] = collide(k, h, visibleM[k]);
    out = { ...rest, ...wrapOpaque(m) };
  }
  if (hidden.records) {
    const m: Record<string, unknown> = { ...hidden.records, ...out };
    for (const [k, h] of Object.entries(hidden.records)) if (has(out, k)) m[k] = collide(k, h, out[k]);
    out = m;
  }
  if (hidden.lists) {
    out = { ...out };
    for (const [k, drop] of Object.entries(hidden.lists)) {
      const cur = Array.isArray(out[k]) ? (out[k] as unknown[]) : [];
      const seen = new Set(cur.map((x) => JSON.stringify(x)));
      out[k] = [...drop.filter((x) => !seen.has(JSON.stringify(x))), ...cur];
    }
  }
  return out;
}

/** One fingerprint per hidden entry (namespace, address, value) — what the empty-world evidence compares, so "the
 *  hidden rows are still stored" is checked entry by entry rather than by a count that a junk write could balance.
 *  A hidden COLLECTION record is fingerprinted by its foreign part (foreignPart): a collision merge may supersede the
 *  elements naming only real personas, and must keep every other one. */
export function hiddenFingerprints(ns: string, hidden: HiddenPart | null | undefined, real: ReadonlySet<string> = new Set()): string[] {
  if (!hidden) return [];
  const out: string[] = [];
  const fp = (addr: string, v: unknown) => createHash("sha256").update(ns + "\u0000" + addr + "\u0000" + JSON.stringify(v)).digest("hex").slice(0, 20);
  for (const [k, v] of Object.entries(hidden.records ?? {})) out.push(fp("r:" + k, foreignPart(v, real)));
  for (const [k, v] of Object.entries(hidden.opaque ?? {})) out.push(fp("o:" + k, foreignPart(v, real)));
  for (const [k, list] of Object.entries(hidden.lists ?? {})) for (const el of list) out.push(fp("l:" + k, el));
  return out;
}
