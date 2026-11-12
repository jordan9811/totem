import "server-only";
// PERSONA LAUNCH P2 (BYX G5-lite) — "N of the K people you follow on X are on Farcaster", computed on the device.
//
// rematch(personaId): the persona's imported follow list (lib/x/follows.ts) intersected with the keyless index
// (lib/x/indexClient.ts). Own accounts first: a match whose fid is one of this root's own accounts (a persona's fid,
// the anon account, the shared test account, the connected main, the configured main) is state "own" — counted,
// never actionable (the write door would refuse it anyway: FC_SELF_LINK). An unreadable vault THROWS (the route
// answers 503): an own-account set read as empty would offer the person their own accounts as strangers.
// Earlier states are kept by fid (the follow queue that sets them is a later wave; this wave only shows the list).
import { loadFollows, updateFollows, followIdsOf, matchesOf, type FollowsDoc, type MatchItem } from "./follows";
import { fetchIndex, indexMeta, cachedIndex, type XIndex } from "./indexClient";

export interface MatchCounts {
  follows: number;
  /** followed X accounts that are on Farcaster (own accounts included) */
  matched: number;
  own: number;
  unmatched: number;
}

export type IndexStatus =
  | { available: true; builtAt: string; rows: number; fnameCoverage: number; ageHours: number | null }
  | { available: false; reason: string };

export interface MatchAnswer {
  index: IndexStatus;
  counts: MatchCounts;
  items: MatchItem[];
  lastMatchedAt: number | null;
  /** the G5 actions — none in this wave */
  can: { keep: false; queue: false; followNow: false };
}

/** every fid that is this root's own (THROWS when the vault cannot be read) */
export async function ownFids(): Promise<Set<number>> {
  const { allPersonaFids, ownAccountFidsWithAnon, connectedRecords } = await import("@/lib/fc/personaFid");
  const records = await allPersonaFids();
  const own = await ownAccountFidsWithAnon(records);
  for (const r of await connectedRecords()) own.add(r.fid);
  const { configuredMainFid } = await import("@/lib/fc/writes");
  const main = configuredMainFid();
  if (main) own.add(main);
  return own;
}

const ageHours = (builtAt: string): number | null => {
  const t = Date.parse(builtAt);
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 3_600_000)) : null;
};

/** the pure intersection (unit-tested): follow ids × index → items, own fids marked, earlier states kept by fid */
export function intersect(ids: string[], index: XIndex, own: Set<number>, previous: MatchItem[] = []): { items: MatchItem[]; counts: MatchCounts } {
  const prevState = new Map(previous.map((m) => [m.fid, m.state]));
  const items: MatchItem[] = [];
  let matched = 0;
  let ownCount = 0;
  for (const id of new Set(ids)) {
    const rows = index.byXid.get(id);
    if (!rows || rows.length === 0) continue;
    matched++;
    let anyOwn = false;
    for (const i of rows) {
      const fid = index.fid[i];
      const isOwn = own.has(fid);
      if (isOwn) anyOwn = true;
      const kept = prevState.get(fid);
      items.push({
        fid,
        fname: index.fn[i] ?? "",
        xHandle: index.xu[i] ?? "",
        xId: id,
        verifiedAt: Math.round(index.at[i] * 1000),
        state: isOwn ? "own" : kept && kept !== "own" ? kept : "new",
      });
    }
    if (anyOwn) ownCount++;
  }
  items.sort((a, b) => b.verifiedAt - a.verifiedAt || a.fid - b.fid);
  const follows = new Set(ids).size;
  return { items, counts: { follows, matched, own: ownCount, unmatched: follows - matched } };
}

function statusOf(index: XIndex): IndexStatus {
  return { available: true, builtAt: index.builtAt, rows: index.rows, fnameCoverage: index.fnameCoverage, ageHours: ageHours(index.builtAt) };
}

function answerFrom(doc: FollowsDoc, personaId: string, index: IndexStatus): MatchAnswer {
  const ids = followIdsOf(doc, personaId);
  const m = matchesOf(doc, personaId);
  const items = m?.items ?? [];
  const matched = new Set(items.map((i) => i.xId)).size;
  const own = new Set(items.filter((i) => i.state === "own").map((i) => i.xId)).size;
  return {
    index,
    counts: { follows: ids.length, matched, own, unmatched: ids.length - matched },
    items,
    lastMatchedAt: m?.at ?? null,
    can: { keep: false, queue: false, followNow: false },
  };
}

/** GET: the stored matches and the index's status — nothing is downloaded (the small meta is read) */
export async function matchStatus(personaId: string): Promise<MatchAnswer> {
  const doc = await loadFollows();
  const held = cachedIndex();
  let index: IndexStatus;
  if (held) index = statusOf(held);
  else {
    const meta = await indexMeta();
    index = meta.available ? { available: true, builtAt: meta.builtAt, rows: meta.rows, fnameCoverage: meta.fnameCoverage, ageHours: ageHours(meta.builtAt) } : meta;
  }
  return answerFrom(doc, personaId, index);
}

/**
 * POST rematch ("Check again"): download the index (If-None-Match; forced when asked), intersect, and save the matches.
 * An index that is not available changes nothing and says so.
 */
export async function rematch(personaId: string, opts: { force?: boolean } = {}): Promise<MatchAnswer> {
  const doc = await loadFollows();
  // the slow parts OUTSIDE the document's lock: the vault read and the index download
  const own = await ownFids(); // THROWS on an unreadable vault: never strangers in place of own accounts
  const answer = await fetchIndex({ force: opts.force });
  if (!answer.available) return answerFrom(doc, personaId, { available: false, reason: answer.reason });
  const index = answer.index;
  const at = Date.now();
  // PERSONA LAUNCH P2 (review W1-R1): only THIS persona's matches are set, inside the lock, on the follow document as
  // stored at that moment — an import or another persona's rematch that landed during the download is kept, and the
  // intersection (pure, a set lookup per id) is taken against the list as stored now, not the one read before the wait
  const next = await updateFollows((cur) => {
    const ids = followIdsOf(cur, personaId);
    const previous = matchesOf(cur, personaId)?.items ?? [];
    const { items } = intersect(ids, index, own, previous);
    return { ...cur, matches: { ...cur.matches, [personaId]: { indexVersion: index.etag ?? index.builtAt, at, items } } };
  });
  return answerFrom(next, personaId, statusOf(index));
}
