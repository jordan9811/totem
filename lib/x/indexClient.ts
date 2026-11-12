import "server-only";
// PERSONA LAUNCH P2 (BYX G5-lite) — THE DEVICE'S COPY OF THE KEYLESS X INDEX (validator/xindex.js builds it).
//
// The device (the rig's app process, or the visitor's browser tab) downloads the WHOLE file and matches locally: the
// follow list never leaves the device, and a whole-file download tells the validator nothing about who matched. Only
// the import page and the identity read trigger a download (A-X-INDEX-FETCH-IS-A-PAGE-VIEW), at most once a day
// (X_INDEX_MAX_AGE_MS) unless the person presses "Check again"; a re-check sends If-None-Match and a 304 costs nothing.
//
// NEVER FAIL OPEN: 503 "index not built" is {available:false} — the panel says the list is not available on this
// site, never "0 matches". A download that fails, is cut short, or does not add up (every column must have exactly
// `rows` values, every fid a positive integer, every X id digits) is an ERROR: no match is computed from it and the
// previous copy (and the previous matches) stand. X ids stay strings; fids are 32-bit (Uint32Array).
import { validatorUrl } from "@/lib/ports";

export interface XIndex {
  etag: string | null;
  builtAt: string;
  rows: number;
  fnameCoverage: number;
  xid: string[];
  fid: Uint32Array;
  xu: string[];
  fn: string[];
  /** verifiedAt, unix SECONDS as Farcaster gives it */
  at: Float64Array;
  /** X id → row indexes (one X account can be verified by more than one fid) */
  byXid: Map<string, number[]>;
  /** fid → row indexes */
  byFid: Map<number, number[]>;
  fetchedAt: number;
}

export type IndexAnswer = { available: true; index: XIndex } | { available: false; reason: string };

const g = globalThis as unknown as { __layersXIndex?: XIndex | null; __layersXIndexInflight?: Promise<IndexAnswer> | null };

export function xIndexMaxAgeMs(): number {
  const v = Number((process.env.X_INDEX_MAX_AGE_MS ?? "").trim());
  return Number.isFinite(v) && v >= 60_000 ? v : 86_400_000;
}

/** forget the copy (tests; a validator switch) */
export function resetXIndexCache(): void {
  g.__layersXIndex = null;
  g.__layersXIndexInflight = null;
}

/** the copy this process holds, without fetching (null when none) */
export function cachedIndex(): XIndex | null {
  return g.__layersXIndex ?? null;
}

/** parse the columnar document — THROWS on anything that does not add up (a partial download never matches) */
export function parseIndex(doc: unknown, etag: string | null): XIndex {
  const d = doc as { v?: unknown; builtAt?: unknown; rows?: unknown; fnameCoverage?: unknown; xid?: unknown; fid?: unknown; xu?: unknown; fn?: unknown; at?: unknown };
  if (!d || d.v !== 1) throw new Error("the X index is not a version this device reads");
  const rows = d.rows;
  if (!Number.isSafeInteger(rows) || (rows as number) < 0) throw new Error("the X index does not say how many rows it has");
  const n = rows as number;
  const col = (v: unknown, name: string): string[] => {
    if (typeof v !== "string") throw new Error(`the X index has no ${name} column`);
    const parts = n === 0 ? (v === "" ? [] : ["?"]) : v.split(",");
    if (parts.length !== n) throw new Error(`the X index's ${name} column has ${parts.length} values for ${n} rows (incomplete download)`);
    return parts;
  };
  const xid = col(d.xid, "X id");
  const fidS = col(d.fid, "fid");
  const xu = col(d.xu, "X handle");
  const fn = col(d.fn, "fname");
  const atS = col(d.at, "verified-at");
  const fid = new Uint32Array(n);
  const at = new Float64Array(n);
  const byXid = new Map<string, number[]>();
  const byFid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!/^\d{1,25}$/.test(xid[i])) throw new Error("the X index carries a malformed X id");
    const f = Number(fidS[i]);
    if (!Number.isSafeInteger(f) || f <= 0 || f >= 2 ** 32) throw new Error("the X index carries a malformed fid");
    fid[i] = f;
    const t = Number(atS[i]);
    at[i] = Number.isFinite(t) && t >= 0 ? t : 0;
    const a = byXid.get(xid[i]);
    if (a) a.push(i);
    else byXid.set(xid[i], [i]);
    const b = byFid.get(f);
    if (b) b.push(i);
    else byFid.set(f, [i]);
  }
  return {
    etag,
    builtAt: typeof d.builtAt === "string" ? d.builtAt : "",
    rows: n,
    fnameCoverage: typeof d.fnameCoverage === "number" ? d.fnameCoverage : 0,
    xid,
    fid,
    xu,
    fn,
    at,
    byXid,
    byFid,
    fetchedAt: Date.now(),
  };
}

async function download(prev: XIndex | null): Promise<IndexAnswer> {
  const headers: Record<string, string> = {};
  if (prev?.etag) headers["If-None-Match"] = prev.etag;
  let res: Response;
  try {
    res = await fetch(validatorUrl() + "/x/fc-index", { cache: "no-store", headers });
  } catch (e) {
    throw new Error(`the X index could not be downloaded (${(e as Error).message})`);
  }
  if (res.status === 304 && prev) {
    prev.fetchedAt = Date.now();
    return { available: true, index: prev };
  }
  if (res.status === 503) {
    const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return { available: false, reason: typeof j?.error === "string" ? j.error : "index not built" };
  }
  if (!res.ok) throw new Error(`the X index could not be downloaded (HTTP ${res.status})`);
  let doc: unknown;
  try {
    doc = JSON.parse(await res.text());
  } catch {
    throw new Error("the X index download was cut short or damaged");
  }
  const index = parseIndex(doc, res.headers.get("etag"));
  g.__layersXIndex = index;
  return { available: true, index };
}

/**
 * The index: the copy held here when it is younger than X_INDEX_MAX_AGE_MS (and `force` is not set), else a download.
 * {available:false} when the site has no index; THROWS when a download fails (callers answer 503 and keep the old
 * matches). Concurrent callers share one download.
 */
export async function fetchIndex(opts: { force?: boolean } = {}): Promise<IndexAnswer> {
  const have = g.__layersXIndex ?? null;
  if (have && !opts.force && Date.now() - have.fetchedAt < xIndexMaxAgeMs()) return { available: true, index: have };
  if (g.__layersXIndexInflight) return g.__layersXIndexInflight;
  const p = download(have).finally(() => {
    if (g.__layersXIndexInflight === p) g.__layersXIndexInflight = null;
  });
  g.__layersXIndexInflight = p;
  return p;
}

/** the index's own small status (GET /x/fc-index/meta) — what the panel shows before anything is downloaded */
export async function indexMeta(): Promise<{ available: true; builtAt: string; rows: number; fnameCoverage: number } | { available: false; reason: string }> {
  let res: Response;
  try {
    res = await fetch(validatorUrl() + "/x/fc-index/meta", { cache: "no-store" });
  } catch (e) {
    throw new Error(`the X index status could not be read (${(e as Error).message})`);
  }
  if (!res.ok) throw new Error(`the X index status could not be read (HTTP ${res.status})`);
  const j = (await res.json().catch(() => null)) as { available?: unknown; builtAt?: unknown; rows?: unknown; fnameCoverage?: unknown } | null;
  if (!j || typeof j.available !== "boolean") throw new Error("the X index status was not readable");
  if (!j.available) return { available: false, reason: "index not built" };
  return { available: true, builtAt: String(j.builtAt ?? ""), rows: Number(j.rows) || 0, fnameCoverage: Number(j.fnameCoverage) || 0 };
}
