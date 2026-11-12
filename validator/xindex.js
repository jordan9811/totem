"use strict";
// PERSONA LAUNCH P2 (BYX G4) — THE KEYLESS X → FARCASTER INDEX, built by the validator and served whole.
//
// Farcaster publishes which accounts have verified which X account (api.farcaster.xyz/fc/account-verifications,
// unauthenticated, marked beta) and who holds which fname (fnames.farcaster.xyz/transfers). This job mirrors both into
// ONE static file — X id → {fid, fname, X handle, verifiedAt} — that a device downloads WHOLE and matches against the
// follow list it imported. The follow list never leaves the device, and a whole-file download tells this server nothing
// about who matched (A-X-INDEX-FETCH-IS-A-PAGE-VIEW: it learns only that an address opened the import page).
//
//   VALIDATOR_X_INDEX=on       the nightly job runs (first run 60 s after boot, then every VALIDATOR_X_INDEX_EVERY_MS,
//                              default 24 h, ±10% jitter). DEFAULT OFF: GET /x/fc-index answers 503 "index not built" —
//                              never an empty index, which would read as "none of your follows are on Farcaster".
//   VALIDATOR_X_INDEX_DIR      where the file lives (default: an x-index/ folder beside the database)
//   VALIDATOR_X_INDEX_FNAME_PAGES_PER_RUN   fname pages (of 100) mirrored per run, default 1500: the ~14,600-page
//                              backfill completes over ~10 nights, then runs incrementally; rows without an fname carry ""
//   VALIDATOR_X_INDEX_SOURCE_URL / _FNAMES_URL   LOCAL test overrides — IGNORED on a hosted platform, with a warning,
//                              exactly like VALIDATOR_RL_CAPACITY (env-contract.js isHostedPlatform)
//
// THE CRAWL (never fail open): page cursors until `next` is absent or a page is empty; at most 2 requests a second;
// 429 and 5xx retried three times honouring Retry-After; EVERY row schema-checked (a positive fid, a digits-only X id
// kept as a STRING, a handle of X's characters, an integer time); rows deduplicated by fid+X id (the list is
// newest-first and paged by number, so boundaries drift while it runs). ANY failure aborts the run: the previous file
// keeps being served and meta.lastError records the page and the reason; one log line, counts only.
//
// THE FILE: fc-index.v1.json.gz, columnar ({v, builtAt, rows, fnameCoverage, xid, fid, xu, fn, at} with each column
// comma-joined — X handles are [A-Za-z0-9_] and fnames [a-z0-9.-], so a comma never occurs inside a value), written to
// a temporary name and renamed; its SHA-256 is the ETag. Routes (unsigned, per-address rate limit applies): GET
// /x/fc-index (gzip, ETag, 304, Cache-Control), GET /x/fc-index/meta, and on the RIG only POST /x/fc-index/build
// {sourceUrl, fnamesUrl}, which REFUSES any source that is not a loopback address (the suites point it at a local stub).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createHash, randomBytes } = require("node:crypto");

const DEFAULT_SOURCE = "https://api.farcaster.xyz";
const DEFAULT_FNAMES = "https://fnames.farcaster.xyz";
const FILE = "fc-index.v1.json.gz";
const META = "fc-index.v1.meta.json";
const MIN_INTERVAL_MS = 500; // at most 2 requests a second
const MAX_PAGES = 4000; // a sanity bound (398 expected today)
const FNAME_PAGE = 100;
const DAY_MS = 86_400_000;
const USER_AGENT = "layers-validator/x-index";
const X_ID_RE = /^\d{1,25}$/;
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,64}$/;
const FNAME_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** DELIBERATE DUPLICATE of migration 22 (x_index, validator/migrations.js): the module stays usable on a database
 *  built before that migration landed (and in its own tests). Idempotent. */
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS x_fname_current (fid INTEGER PRIMARY KEY, username TEXT NOT NULL, transfer_id INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS x_index_cursor (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
}

/** http(s) to localhost / 127.x / ::1 only — the rig's build route takes nothing else */
function isLoopbackUrl(u) {
  try {
    const url = new URL(String(u));
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const h = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch {
    return false;
  }
}

class BuildError extends Error {
  constructor(reason, page) {
    super(reason);
    this.page = page;
  }
}

function makePacer(minIntervalMs, sleep) {
  let last = 0;
  return async () => {
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}

/** one GET → JSON, paced, retried three times on 429 / 5xx / a dropped connection (Retry-After honoured, capped) */
async function fetchJson(url, deps, label) {
  let lastReason = "no answer";
  for (let attempt = 0; attempt <= 3; attempt++) {
    await deps.pace();
    let res;
    try {
      res = await deps.fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    } catch (e) {
      lastReason = "unreachable (" + (e && e.message ? e.message : String(e)) + ")";
      if (attempt < 3) await deps.sleep(Math.min(deps.maxRetryWaitMs, 1000 * (attempt + 1)));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastReason = "HTTP " + res.status;
      const named = Number(res.headers && res.headers.get ? res.headers.get("retry-after") : NaN);
      const waitMs = Number.isFinite(named) && named >= 0 ? named * 1000 : 1000 * (attempt + 1);
      if (attempt < 3) await deps.sleep(Math.min(deps.maxRetryWaitMs, waitMs));
      continue;
    }
    if (!res.ok) throw new BuildError(label + ": HTTP " + res.status);
    try {
      return await res.json();
    } catch {
      throw new BuildError(label + ": the answer was not JSON");
    }
  }
  throw new BuildError(label + ": " + lastReason + " after 3 retries");
}

/** a verification row, schema-checked — or the reason it is refused */
function checkVerification(row) {
  if (!row || typeof row !== "object") return "a row is not an object";
  const { fid, platform, platformId, platformUsername, verifiedAt } = row;
  if (!Number.isSafeInteger(fid) || fid <= 0 || fid >= 2 ** 32) return "a row's fid is not a positive integer";
  if (platform !== undefined && platform !== "x") return "a row is not an X verification";
  if (typeof platformId !== "string" || !X_ID_RE.test(platformId)) return "a row's X id is not a string of digits";
  if (typeof platformUsername !== "string" || !X_HANDLE_RE.test(platformUsername)) return "a row's X handle is malformed";
  if (!Number.isSafeInteger(verifiedAt) || verifiedAt < 0) return "a row's verifiedAt is not an integer";
  return null;
}

async function crawlVerifications(sourceUrl, deps) {
  const rows = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new BuildError("more than " + MAX_PAGES + " pages: refusing an unbounded crawl", page);
    const url = sourceUrl.replace(/\/+$/, "") + "/fc/account-verifications?platform=x&limit=1000" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    let json;
    try {
      json = await fetchJson(url, deps, "verifications page " + page);
    } catch (e) {
      throw new BuildError(e.message, page);
    }
    const list = json && json.result && json.result.verifications;
    if (!Array.isArray(list)) throw new BuildError("verifications page " + page + ": no verifications list (the source changed shape)", page);
    for (const row of list) {
      const bad = checkVerification(row);
      if (bad) throw new BuildError("verifications page " + page + ": " + bad, page);
      const key = row.fid + ":" + row.platformId;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ fid: row.fid, xid: row.platformId, xu: row.platformUsername, at: row.verifiedAt });
    }
    const next = json.next && json.next.cursor;
    if (list.length === 0 || next === undefined || next === null || next === "") return { rows, pages: page + 1 };
    if (typeof next !== "string" || next.length > 4096) throw new BuildError("verifications page " + page + ": the next cursor is malformed", page);
    cursor = next;
  }
}

function cursorGet(db, key) {
  const r = db.prepare("SELECT value FROM x_index_cursor WHERE key = ?").get(key);
  return r ? r.value : null;
}
function cursorSet(db, key, value) {
  db.prepare("INSERT INTO x_index_cursor (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

/** the fid → fname mirror, from its cursor, pages of 100 applied in id order (a release, to = 0, just frees the name) */
async function mirrorFnames(db, fnamesUrl, deps, pagesPerRun) {
  let fromId = Number(cursorGet(db, "fname_from_id") ?? 0);
  if (!Number.isSafeInteger(fromId) || fromId < 0) fromId = 0;
  let pages = 0;
  let applied = 0;
  let done = cursorGet(db, "fname_backfill_done") === "1";
  const del = db.prepare("DELETE FROM x_fname_current WHERE username = ?");
  const put = db.prepare("INSERT INTO x_fname_current (fid, username, transfer_id) VALUES (?, ?, ?) ON CONFLICT(fid) DO UPDATE SET username = excluded.username, transfer_id = excluded.transfer_id");
  for (; pages < pagesPerRun; pages++) {
    const json = await fetchJson(fnamesUrl.replace(/\/+$/, "") + "/transfers?from_id=" + fromId, deps, "fname page " + pages);
    const list = json && json.transfers;
    if (!Array.isArray(list)) throw new BuildError("fname page " + pages + ": no transfers list (the source changed shape)");
    const sorted = list.slice().sort((a, b) => (a && b ? a.id - b.id : 0));
    for (const t of sorted) {
      if (!t || !Number.isSafeInteger(t.id) || t.id < 0 || typeof t.username !== "string" || !FNAME_RE.test(t.username) || !Number.isSafeInteger(t.to) || t.to < 0)
        throw new BuildError("fname page " + pages + ": a transfer is malformed");
    }
    db.exec("BEGIN");
    try {
      for (const t of sorted) {
        if (t.id <= fromId) continue;
        del.run(t.username);
        if (t.to !== 0) put.run(t.to, t.username, t.id);
        fromId = t.id;
        applied++;
      }
      cursorSet(db, "fname_from_id", fromId);
      if (list.length < FNAME_PAGE) {
        done = true;
        cursorSet(db, "fname_backfill_done", "1");
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    if (list.length < FNAME_PAGE) {
      pages++;
      break;
    }
  }
  return { pages, applied, backfillDone: done };
}

function readMetaFile(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, META), "utf8"));
  } catch {
    return null;
  }
}
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp-" + randomBytes(4).toString("hex");
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/**
 * One build. On success the new file and meta replace the old (tmp + rename) and the in-memory copy follows; on ANY
 * failure the old file stays served and only meta.lastError changes. Returns the meta.
 */
async function buildIndex(db, st, opts) {
  ensureSchema(db);
  const deps = {
    fetchImpl: opts.fetchImpl || globalThis.fetch,
    sleep: opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    maxRetryWaitMs: opts.maxRetryWaitMs ?? 30_000,
  };
  deps.pace = makePacer(opts.minIntervalMs ?? MIN_INTERVAL_MS, deps.sleep);
  const log = opts.log || console;
  const started = Date.now();
  let crawled = null;
  try {
    crawled = await crawlVerifications(opts.sourceUrl || DEFAULT_SOURCE, deps);
    const fn = await mirrorFnames(db, opts.fnamesUrl || DEFAULT_FNAMES, deps, opts.fnamePagesPerRun ?? 1500);
    const lookup = db.prepare("SELECT username FROM x_fname_current WHERE fid = ?");
    const rows = crawled.rows;
    let named = 0;
    const fnames = rows.map((r) => {
      const hit = lookup.get(r.fid);
      if (hit && FNAME_RE.test(hit.username)) {
        named++;
        return hit.username;
      }
      return "";
    });
    const builtAt = new Date().toISOString();
    const fnameCoverage = rows.length ? Math.round((named / rows.length) * 10000) / 10000 : 0;
    const doc = {
      v: 1,
      builtAt,
      rows: rows.length,
      fnameCoverage,
      xid: rows.map((r) => r.xid).join(","),
      fid: rows.map((r) => r.fid).join(","),
      xu: rows.map((r) => r.xu).join(","),
      fn: fnames.join(","),
      at: rows.map((r) => r.at).join(","),
    };
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(doc), "utf8"), { level: 9 });
    const sha256 = createHash("sha256").update(gz).digest("hex");
    writeAtomic(path.join(st.dir, FILE), gz);
    const meta = { v: 1, built: true, builtAt, rows: rows.length, bytes: gz.length, sha256, fnameCoverage, fnameBackfillDone: fn.backfillDone, pages: crawled.pages, fnamePages: fn.pages, lastError: null, lastRunAt: builtAt };
    writeAtomic(path.join(st.dir, META), JSON.stringify(meta));
    st.buf = gz;
    st.meta = meta;
    log.log("[x-index] built: " + rows.length + " rows from " + crawled.pages + " pages, " + gz.length + " bytes gzip, fname coverage " + fnameCoverage + ", " + Math.round((Date.now() - started) / 1000) + " s, rss " + Math.round(process.memoryUsage().rss / 1048576) + " MB");
    return meta;
  } catch (e) {
    const reason = e && e.message ? String(e.message).slice(0, 300) : String(e);
    const lastError = { at: new Date().toISOString(), page: e && Number.isInteger(e.page) ? e.page : null, reason };
    const meta = { ...(st.meta || { v: 1, built: false, builtAt: null, rows: 0, bytes: 0, sha256: null, fnameCoverage: 0, fnameBackfillDone: false }), lastError, lastRunAt: lastError.at };
    try {
      writeAtomic(path.join(st.dir, META), JSON.stringify(meta));
    } catch {
      /* the in-memory meta still says it */
    }
    st.meta = meta;
    log.error("[x-index] build FAILED (previous index kept" + (st.buf ? ", " + (st.meta.rows || 0) + " rows" : ", none built yet") + "; pages crawled " + (crawled ? crawled.pages : "?") + "): " + reason);
    const err = new Error(reason);
    err.meta = meta;
    throw err;
  }
}

/** the file served at boot: present, and its bytes match the meta's hash — else "not built" (never a damaged index) */
function loadFromDisk(st) {
  const meta = readMetaFile(st.dir);
  st.meta = meta;
  st.buf = null;
  if (!meta || !meta.built || !meta.sha256) return;
  try {
    const buf = fs.readFileSync(path.join(st.dir, FILE));
    if (createHash("sha256").update(buf).digest("hex") === meta.sha256) st.buf = buf;
  } catch {
    /* absent */
  }
}

/** sources for the scheduled job: the env overrides are LOCAL ONLY (ignored, with a warning, on a hosted platform) */
function jobSources(env = process.env, log = console) {
  const { isHostedPlatform } = require("./env-contract");
  const pick = (name, dflt) => {
    const raw = String(env[name] || "").trim();
    if (!raw) return dflt;
    if (isHostedPlatform(env)) {
      log.warn("[validator] " + name + " is IGNORED on a hosted platform (local test pair only) — the default source stands");
      return dflt;
    }
    return raw;
  };
  return { sourceUrl: pick("VALIDATOR_X_INDEX_SOURCE_URL", DEFAULT_SOURCE), fnamesUrl: pick("VALIDATOR_X_INDEX_FNAMES_URL", DEFAULT_FNAMES) };
}

function defaultDir(dbPath) {
  if (process.env.VALIDATOR_X_INDEX_DIR) return process.env.VALIDATOR_X_INDEX_DIR;
  if (dbPath && dbPath !== ":memory:") return path.join(path.dirname(dbPath), "x-index");
  return path.join(os.tmpdir(), "layers-x-index-" + process.pid + "-" + randomBytes(4).toString("hex"));
}

/**
 * Mount the routes (always: off means 503, never absent) and, when VALIDATOR_X_INDEX=on, start the nightly job.
 * Returns the controller (tests drive buildIndex through it).
 */
function mountXIndex(app, db, opts = {}) {
  ensureSchema(db);
  const st = { dir: opts.dir || defaultDir(opts.dbPath), buf: null, meta: null, building: null, timer: null };
  loadFromDisk(st);
  const log = opts.log || console;

  app.get("/x/fc-index", (req, res) => {
    if (!st.buf || !st.meta || !st.meta.sha256) return res.status(503).json({ error: "index not built" });
    const etag = '"' + st.meta.sha256 + '"';
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=3600");
    const inm = String(req.headers["if-none-match"] || "");
    if (inm && inm.split(",").map((s) => s.trim()).includes(etag)) return res.status(304).end();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Content-Length", String(st.buf.length));
    res.status(200).end(st.buf);
  });

  app.get("/x/fc-index/meta", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const m = st.meta || {};
    res.json({
      v: 1,
      available: !!st.buf,
      builtAt: st.buf ? m.builtAt : null,
      rows: st.buf ? m.rows : 0,
      bytes: st.buf ? m.bytes : 0,
      sha256: st.buf ? m.sha256 : null,
      fnameCoverage: st.buf ? m.fnameCoverage : 0,
      fnameBackfillDone: !!m.fnameBackfillDone,
      lastError: m.lastError || null,
      job: process.env.VALIDATOR_X_INDEX === "on" ? "on" : "off",
    });
  });

  if (opts.devHooks) {
    // RIG ONLY: build now, from LOOPBACK sources (the suites' stub). Anything else is refused — the rig never crawls
    // the real lists, and this route is the only way a build is started on demand.
    app.post("/x/fc-index/build", async (req, res) => {
      const { sourceUrl, fnamesUrl, fnamePagesPerRun, minIntervalMs } = req.body || {};
      if (!isLoopbackUrl(sourceUrl) || !isLoopbackUrl(fnamesUrl))
        return res.status(400).json({ error: "refused: the rig's build route takes loopback sources only (sourceUrl and fnamesUrl)" });
      if (st.building) return res.status(409).json({ error: "a build is already running" });
      st.building = buildIndex(db, st, {
        sourceUrl,
        fnamesUrl,
        fnamePagesPerRun: Number.isSafeInteger(fnamePagesPerRun) && fnamePagesPerRun > 0 ? fnamePagesPerRun : 1500,
        minIntervalMs: Number.isFinite(minIntervalMs) && minIntervalMs >= 50 ? minIntervalMs : MIN_INTERVAL_MS,
        maxRetryWaitMs: 5000,
        fetchImpl: opts.fetchImpl,
        log,
      });
      try {
        const meta = await st.building;
        res.json({ ok: true, meta });
      } catch (e) {
        res.status(502).json({ ok: false, error: e.message, meta: e.meta || st.meta });
      } finally {
        st.building = null;
      }
    });
    // RIG ONLY: forget the index and the fname mirror (a suite starts from "not built" and leaves the rig as it found
    // it; resetSeed does not touch this — the index is public data, not seed state)
    app.post("/x/fc-index/clear", (req, res) => {
      if (st.building) return res.status(409).json({ error: "a build is running" });
      for (const f of [FILE, META]) {
        try {
          fs.unlinkSync(path.join(st.dir, f));
        } catch {
          /* absent */
        }
      }
      db.exec("DELETE FROM x_fname_current; DELETE FROM x_index_cursor;");
      st.buf = null;
      st.meta = null;
      res.json({ ok: true });
    });
  }

  if (process.env.VALIDATOR_X_INDEX === "on" && opts.startJob !== false) {
    const everyMs = Number(process.env.VALIDATOR_X_INDEX_EVERY_MS) > 60_000 ? Number(process.env.VALIDATOR_X_INDEX_EVERY_MS) : DAY_MS;
    const perRun = Number(process.env.VALIDATOR_X_INDEX_FNAME_PAGES_PER_RUN);
    const run = async () => {
      if (!st.building) {
        st.building = buildIndex(db, st, { ...jobSources(process.env, log), fnamePagesPerRun: Number.isSafeInteger(perRun) && perRun > 0 ? perRun : 1500, fetchImpl: opts.fetchImpl, log }).catch(() => null);
        await st.building;
        st.building = null;
      }
      const jitter = everyMs * (0.9 + Math.random() * 0.2);
      st.timer = setTimeout(run, jitter);
      st.timer.unref();
    };
    st.timer = setTimeout(run, 60_000);
    st.timer.unref();
    log.log("[validator] X index job ON: first build in 60 s, then about every " + Math.round(everyMs / 3_600_000) + " h (" + st.dir + ")");
  }
  return { state: st, build: (o) => buildIndex(db, st, o), stop: () => st.timer && clearTimeout(st.timer) };
}

module.exports = { mountXIndex, buildIndex, crawlVerifications, mirrorFnames, checkVerification, isLoopbackUrl, ensureSchema, jobSources, FILE, META, DEFAULT_SOURCE, DEFAULT_FNAMES };
