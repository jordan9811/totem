import "server-only";
// MEGA PASS 2 Gate 4 — UNIFIED SEARCH: everything this root has ever
// touched — posts, DMs, likes, bookmarks, stakes, relationship events,
// imported archives — from ONE box, unsegmented.
//
// THE BOUNDARY, stated once: the index is built HERE, in the process that
// holds the decrypted vault, from the vault-backed stores, and it never
// leaves. No query over private data and no private index is ever sent to
// the validator — there is no search endpoint on the validator that touches
// vault types (the Gate 4 suite greps it), the index is re-derived from
// the vault on demand (it survives a restart by being rebuilt, and is never
// stored plaintext anywhere), and a search keeps working with the
// validator unreachable once the vault is in memory.
//
// SINGLE-ROOT BY CONSTRUCTION: every record belongs to one of THIS
// device's own personas. Other people's private posts a grant lets this
// viewer read are not "things this user touched" and are not indexed.
//
// AI SEARCH is local-first: the embedding runs in a worker
// (lib/search/embedWorker.ts); if the device cannot run it, the box
// degrades to keyword and SAYS so. The cloud option exists behind an
// explicit PER-QUERY consent that names exactly what would be sent
// ("send these N snippets to <provider>?"), is OFF by default, never
// silent — and in this build the provider is a FIXTURE: nothing leaves the
// process even after consent, and the suite asserts what WOULD have.
import { createHash } from "@/lib/platform/crypto";
import { FullTextIndex, type Hit, type RecordType, type SearchRecord } from "./index";
import { cosine, embed, meaningsOf } from "./embed";
import { embedInWorker, semanticStatus } from "./embedWorker";

export type SearchMode = "keyword" | "semantic" | "cloud";

export interface Consent {
  provider: string;
  snippets: number;
  queryHash: string;
}

export interface UnifiedHit {
  id: string;
  type: RecordType;
  personaId: string;
  /** the ACTING persona's handle — "bookmarked as @fluffypanda69" */
  as: string;
  private: boolean;
  title: string;
  snippet: string;
  at: number;
  href?: string;
  score: number;
  /** why it matched — the terms (keyword) or the shared meanings (semantic): no black box */
  why: string[];
}

export interface UnifiedResult {
  q: string;
  mode: SearchMode;
  /** the mode actually used when a degrade happened, with the reason said out loud */
  degraded?: { from: SearchMode; to: SearchMode; reason: string };
  /** cloud only, before consent: exactly what would be sent */
  needsConsent?: { provider: string; snippets: number; queryHash: string; preview: string[] };
  /** cloud only, after consent: what was handed to the (fixture) provider */
  sent?: { provider: string; snippets: number; queryHash: string; fixture: true };
  groups: { type: RecordType; hits: UnifiedHit[] }[];
  total: number;
  indexed: number;
  types: RecordType[];
  personas: string[];
  rebuiltAt: number;
  /** POST-DEPLOY Gate 2: the scope this answer was computed under. Reported so a
   *  caller can SEE that a single-persona answer is single-persona by scope and
   *  not by coincidence — and so the suite can assert it without reading a DOM. */
  scope: { unified: boolean; compartment: boolean; activePersonaId: string; personaIds: string[] };
}

/** The personas a search may index at all, and why. Resolved from the ONE
 *  chokepoint (lib/identity/chrome.ts) — never recomputed here. */
export interface SearchScope {
  personaIds: string[];
  unified: boolean;
  compartment: boolean;
  activePersonaId: string;
}

export async function currentScope(): Promise<SearchScope> {
  const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
  const { activeSeedPersonaId } = await import("@/lib/activePersona");
  const { viewScope } = await import("@/lib/identity/chrome");
  const own = await ownPersonaIdsAll();
  const active = activeSeedPersonaId();
  // GATE 5 (attack-post-1 F-8): a persona minted into the session ROSTER is not in
  // `ownPersonaIdsAll()` (the seeded + keystore set), so scoping to "the active persona"
  // produced a scope containing a persona the collector then filtered out — an index of
  // NOTHING, reported as an ordinary "single" scope. An empty answer that looks like a
  // correct answer is the worst shape a scope can have.
  const roster = own.includes(active) ? own : [...own, active];
  const sc = await viewScope(active, roster);
  return {
    // DEFAULT OFF: with the cross-persona view off — which is the default, and
    // what compartment mode forces — the index itself holds one persona. Not a
    // filter over a wider index: the other personas are never READ.
    personaIds: sc.unified ? roster : [active],
    unified: sc.unified,
    compartment: sc.compartment,
    activePersonaId: active,
  };
}

export const CLOUD_PROVIDER = "fixture-cloud";
export const CLOUD_SNIPPETS = 5;

interface Cache {
  index: FullTextIndex;
  records: SearchRecord[];
  vectors: Map<string, Float32Array> | null;
  builtAt: number;
  signature: string;
}
interface State {
  /** one cache PER SCOPE. A single cache filtered at query time would mean the
   *  compartment-mode process still held every sibling persona's records in
   *  memory, one bug away from a screen-share leak; keyed by scope, the
   *  compartment index never contains them. */
  caches: Map<string, Cache>;
  cloudSends: { provider: string; snippets: number; queryHash: string; at: number }[];
}
const g = globalThis as unknown as { __layersUnifiedSearch?: State };
const st = (): State => (g.__layersUnifiedSearch ??= { caches: new Map(), cloudSends: [] });
const scopeKey = (s: SearchScope) => (s.unified ? "unified:" : "solo:") + [...s.personaIds].sort().join(",");

const trim = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---------------------------------------------------------------- records

/**
 * Everything this root touched, from the vault-backed stores — own personas only.
 *
 * POST-DEPLOY Gate 2: `scope` decides which of this root's personas are read at
 * all. It is NOT a presentation filter — the records of a persona outside the
 * scope are never collected, so they are never indexed, never embedded, and
 * never in the process memory a screen-share or a stray render could reach.
 * Omitting it collects every own persona, which is what the internal callers
 * that are not a user-facing view (none today) would want; the route always
 * passes one.
 */
export async function collectRecords(scope?: SearchScope): Promise<{ records: SearchRecord[]; personas: string[] }> {
  const { ownPersonaIdsAll, ownStakes } = await import("@/lib/influence/allowance");
  const { state, personaById, postByHash, SEED_POSTS } = await import("@/lib/adapters/mock/store");
  const { isPrivatePersona } = await import("@/lib/identity/personaKind");
  const all = await ownPersonaIdsAll();
  const own = scope ? all.filter((id) => scope.personaIds.includes(id)) : all;
  const ownSet = new Set(own);
  const s = state();
  const out: SearchRecord[] = [];
  const handleOf = (id: string) => personaById.get(id)?.handle ?? id;
  const priv = (id: string) => isPrivatePersona(id);

  // own public casts (the seed's)
  for (const p of SEED_POSTS) {
    if (!ownSet.has(p.authorPersonaId)) continue;
    out.push({ id: "cast:" + p.hash, type: "cast", personaId: p.authorPersonaId, asHandle: handleOf(p.authorPersonaId), private: priv(p.authorPersonaId), title: "@" + handleOf(p.authorPersonaId), text: p.text, at: Date.now() - p.minutesAgo * 60_000, href: `/${handleOf(p.authorPersonaId)}/status/${p.hash}` });
  }
  // private posts (own)
  for (const pp of s.privatePosts.values()) {
    if (!ownSet.has(pp.authorPersonaId)) continue;
    out.push({ id: "private:" + pp.hash, type: "privatePost", personaId: pp.authorPersonaId, asHandle: handleOf(pp.authorPersonaId), private: true, title: "@" + handleOf(pp.authorPersonaId) + " (private)", text: pp.text, at: pp.createdAt });
  }
  // DMs (own side)
  for (const dm of s.dmRequests.values()) {
    if (!ownSet.has(dm.fromPersona) && !ownSet.has(dm.toPersona)) continue;
    const mine = ownSet.has(dm.fromPersona) ? dm.fromPersona : dm.toPersona;
    out.push({ id: "dm:" + dm.id, type: "dm", personaId: mine, asHandle: handleOf(mine), private: true, title: `DM ${ownSet.has(dm.fromPersona) ? "to" : "from"} @${handleOf(ownSet.has(dm.fromPersona) ? dm.toPersona : dm.fromPersona)}`, text: dm.text, at: dm.createdAt, href: "/messages" });
  }
  // likes — ATTRIBUTED to the persona that did them, not lumped onto own[0]:
  // "liked as @x" is the whole point of a cross-persona view, and the old
  // version attributed every like to the first persona in the roster.
  const liked = new Map<string, string>();
  if (own.includes(all[0])) for (const h of s.likes) liked.set(h, all[0]);
  for (const e of s.edgeEvents.values()) if (e.type === "like" && ownSet.has(e.actorPersonaId) && e.triggeringCastId) liked.set(e.triggeringCastId, e.actorPersonaId);
  for (const [h, actor] of liked) {
    const p = postByHash.get(h);
    if (!p) continue;
    out.push({ id: "like:" + h, type: "like", personaId: actor, asHandle: handleOf(actor), private: false, title: "liked @" + handleOf(p.authorPersonaId), text: p.text, at: Date.now() - p.minutesAgo * 60_000, href: `/${handleOf(p.authorPersonaId)}/status/${h}` });
  }
  // bookmarks — the folder's OWNER is the persona that bookmarked it; the
  // seed viewer's loose bookmarks belong to the seeded default persona
  const marked = new Map<string, string>();
  if (own.includes(all[0])) for (const h of s.bookmarks) marked.set(h, all[0]);
  for (const f of s.folders.values()) if (ownSet.has(f.ownerPersonaId)) for (const h of f.postHashes) marked.set(h, f.ownerPersonaId);
  for (const [h, owner] of marked) {
    const p = postByHash.get(h);
    if (!p) continue;
    out.push({ id: "bookmark:" + h, type: "bookmark", personaId: owner, asHandle: handleOf(owner), private: false, title: "bookmarked @" + handleOf(p.authorPersonaId), text: p.text, at: Date.now() - p.minutesAgo * 60_000, href: `/${handleOf(p.authorPersonaId)}/status/${h}` });
  }
  // stakes (own, from the sealed mirror)
  try {
    for (const k of await ownStakes()) {
      if (!ownSet.has(k.personaId)) continue;
      const p = postByHash.get(k.castHash);
      out.push({ id: "stake:" + k.id, type: "stake", personaId: k.personaId, asHandle: handleOf(k.personaId), private: priv(k.personaId), title: `staked ${k.amount} ${k.direction}`, text: p?.text ?? k.castHash, at: k.at, href: "/settings/influence" });
    }
  } catch {
    /* an unreadable stake mirror indexes nothing; the search still answers */
  }
  // relationship events (own log)
  for (const e of s.edgeEvents.values()) {
    if (!ownSet.has(e.actorPersonaId) || e.type === "like") continue;
    out.push({ id: "rel:" + e.id, type: "relationship", personaId: e.actorPersonaId, asHandle: handleOf(e.actorPersonaId), private: priv(e.actorPersonaId), title: `${e.type.replace("_", " ")} @${handleOf(e.targetPersona)}`, text: `${e.type} ${handleOf(e.targetPersona)} ${e.context}`, at: e.timestamp, href: "/history" });
  }
  // imported archives (own). PERSONA LAUNCH P2 (BYX G3): the shelf is a chunked sealed document (lib/x/shelf.ts).
  // PERSONA LAUNCH (final verify, accept-mega2-g7 check 4): search reads the CACHED copy only (shelfSync) and never
  // starts a validator read. Awaiting loadShelf here made the first search after a cold start (or a reset) a signed GET
  // — it takes an envelope counter, so the operator saw a write to envelope_counters at the moment of a search, and
  // linkage v5's "a search lands nowhere" broke. The cache is warmed by the hydrate, the feed and every import/save
  // (lib/adapters/mock/store.ts, lib/feed.ts, lib/x/importer.ts); until then the shelf is skipped here, as shelf.ts
  // documents for its synchronous readers. An unreadable shelf indexes nothing; the search still answers.
  try {
    const { shelfSync } = await import("@/lib/x/shelf");
    const cached = shelfSync(); // undefined: this process has not read the shelf yet — skipped, never fetched here
    if (cached) {
      const { shelf, meta } = cached;
      for (const ip of shelf.posts) {
        if (!ownSet.has(ip.personaId)) continue;
        const handle = meta.byPersona[ip.personaId]?.account.username.toLowerCase() ?? "";
        out.push({ id: "import:" + ip.id, type: "import", personaId: ip.personaId, asHandle: handleOf(ip.personaId), private: false, title: "imported from X (@" + handle + ")", text: ip.text, at: ip.createdAt, href: "/settings/import-x" });
      }
      // the archive's likes moved from xImportedPrivate into the shelf document; still private, still searchable here
      for (const l of shelf.likes) {
        if (!ownSet.has(l.personaId)) continue;
        out.push({ id: "import:like:" + l.tweetId, type: "import", personaId: l.personaId, asHandle: handleOf(l.personaId), private: true, title: "imported X like", text: l.text, at: l.importedAt, href: "/settings/import-x" });
      }
    }
  } catch {
    /* an unreadable shelf indexes nothing; the search still answers */
  }
  for (const ipr of s.xImportedPrivate.values()) {
    if (!ownSet.has(ipr.personaId)) continue;
    out.push({ id: "import:" + ipr.id, type: "import", personaId: ipr.personaId, asHandle: handleOf(ipr.personaId), private: true, title: `imported X ${ipr.kind}`, text: ipr.text, at: ipr.importedAt, href: "/settings/import-x" });
  }
  return { records: out, personas: own };
}

function signatureOf(records: SearchRecord[]): string {
  const h = createHash("sha256");
  for (const r of records) h.update(r.id + "|" + r.at + "|" + r.text.length + "\n");
  return h.digest("hex").slice(0, 16);
}

/** the in-process index, rebuilt from the vault when the record set changed — never persisted */
export async function ensureIndex(scope?: SearchScope): Promise<{ cache: Cache; personas: string[]; scope: SearchScope }> {
  const sc = scope ?? (await currentScope());
  const { records, personas } = await collectRecords(sc);
  const sig = signatureOf(records);
  const s = st();
  const key = scopeKey(sc);
  const have = s.caches.get(key);
  if (!have || have.signature !== sig) {
    s.caches.set(key, { index: new FullTextIndex(records), records, vectors: null, builtAt: Date.now(), signature: sig });
  }
  return { cache: s.caches.get(key)!, personas, scope: sc };
}

/** Drops EVERY scope's index. Leaving a wider scope's index behind after a
 *  compartment switch would keep exactly the records that switch exists to
 *  put out of reach. */
export function resetUnifiedIndex(): void {
  st().caches = new Map();
}

// ------------------------------------------------------------------ search

function toHit(r: SearchRecord, score: number, why: string[]): UnifiedHit {
  return { id: r.id, type: r.type, personaId: r.personaId, as: r.asHandle, private: r.private, title: r.title, snippet: trim(r.text), at: r.at, href: r.href, score, why };
}

function group(hits: UnifiedHit[]): UnifiedResult["groups"] {
  const by = new Map<RecordType, UnifiedHit[]>();
  for (const h of hits) (by.get(h.type) ?? by.set(h.type, []).get(h.type)!).push(h);
  return [...by.entries()].map(([type, list]) => ({ type, hits: list }));
}

export const queryHashOf = (q: string) => createHash("sha256").update("layers-search/1|" + q.trim().toLowerCase(), "utf8").digest("hex").slice(0, 16);

export async function unifiedSearch(q: string, mode: SearchMode = "keyword", consent: Consent | null = null, limit = 40, scope?: SearchScope): Promise<UnifiedResult> {
  const { cache, personas, scope: sc } = await ensureIndex(scope);
  const base = {
    q,
    indexed: cache.records.length,
    types: [...new Set(cache.records.map((r) => r.type))],
    personas,
    rebuiltAt: cache.builtAt,
    scope: { unified: sc.unified, compartment: sc.compartment, activePersonaId: sc.activePersonaId, personaIds: sc.personaIds },
  };
  const keyword = (): UnifiedHit[] => cache.index.search(q, limit).map((h: Hit) => toHit(h.record, h.score, h.terms));

  if (mode === "keyword") {
    const hits = keyword();
    return { ...base, mode, groups: group(hits), total: hits.length };
  }

  if (mode === "semantic") {
    try {
      if (!cache.vectors) {
        const vecs = await embedInWorker(cache.records.map((r) => r.title + " " + r.text));
        cache.vectors = new Map(cache.records.map((r, i) => [r.id, vecs[i]]));
      }
      const [qv] = await embedInWorker([q]);
      const qMeanings = new Set(meaningsOf(q));
      const scored = cache.records
        .map((r) => ({ r, s: cosine(qv, cache.vectors!.get(r.id) ?? embed("")) }))
        .filter((x) => x.s > 0.12)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map((x) => toHit(x.r, x.s, meaningsOf(x.r.title + " " + x.r.text).filter((m) => qMeanings.has(m))));
      return { ...base, mode, groups: group(scored), total: scored.length };
    } catch (e) {
      // the device cannot run the model: keyword, and SAY so
      const hits = keyword();
      return { ...base, mode: "keyword", degraded: { from: "semantic", to: "keyword", reason: (e as Error).message }, groups: group(hits), total: hits.length };
    }
  }

  // cloud: consent names exactly what would be sent; nothing goes anywhere without it — and in this build,
  // nothing goes anywhere WITH it either (the provider is a fixture); the suite asserts both
  const candidates = keyword().slice(0, CLOUD_SNIPPETS);
  const queryHash = queryHashOf(q);
  const wanted = { provider: CLOUD_PROVIDER, snippets: candidates.length, queryHash };
  const matches = !!consent && consent.provider === wanted.provider && consent.snippets === wanted.snippets && consent.queryHash === wanted.queryHash;
  if (!matches) {
    return { ...base, mode, needsConsent: { ...wanted, preview: candidates.map((c) => trim(c.snippet, 60)) }, groups: [], total: 0 };
  }
  st().cloudSends.push({ ...wanted, at: Date.now() });
  // the fixture "provider": reranks the consented snippets by shared meanings with the query — a stand-in, named as one
  const qMeanings = new Set(meaningsOf(q));
  const reranked = candidates
    .map((c) => ({ ...c, score: c.score + meaningsOf(c.snippet).filter((m) => qMeanings.has(m)).length, why: [...c.why, "fixture-cloud rerank"] }))
    .sort((a, b) => b.score - a.score);
  return { ...base, mode, sent: { ...wanted, fixture: true }, groups: group(reranked), total: reranked.length };
}

/**
 * THE CROSS-PERSONA VIEW, without a query: everything this scope can see,
 * newest first, grouped by type — bookmarks, likes, stakes, relationship
 * events, posts, DMs, imports. It is UI over the SAME reads the search uses
 * and obeys the SAME scope, so "the unified view is off" and "the unified
 * search is off" cannot drift apart.
 *
 * READ ONLY, across personas, by construction: there is nothing here to act
 * with. Acting as a persona is a switch or the act-as picker, because signing
 * as a persona is a disclosure act and a convenience toggle is the wrong place
 * to make one.
 */
export async function browseAll(limit = 60, scope?: SearchScope): Promise<UnifiedResult> {
  const { cache, personas, scope: sc } = await ensureIndex(scope);
  const hits = [...cache.records]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((r) => toHit(r, 1, []));
  return {
    q: "",
    mode: "keyword",
    groups: group(hits),
    total: hits.length,
    indexed: cache.records.length,
    types: [...new Set(cache.records.map((r) => r.type))],
    personas,
    rebuiltAt: cache.builtAt,
    scope: { unified: sc.unified, compartment: sc.compartment, activePersonaId: sc.activePersonaId, personaIds: sc.personaIds },
  };
}

/** dev hooks: what the cloud path was handed (nothing, unless consent matched) */
export function cloudSends(): { provider: string; snippets: number; queryHash: string; at: number }[] {
  return [...st().cloudSends];
}
export function resetCloudSends(): void {
  st().cloudSends = [];
}

export { semanticStatus };
