// POST-DEPLOY PASS Gate 4 — READWISE: THE KNOBS AND THE DWELL MECHANIC.
//
//   1. THE CADENCE SLIDER CHANGES HOW MANY CHUNKS ARRIVE — measured on the seeded corpus, both directions.
//   2. THE CHUNK-LENGTH SLIDER CHANGES THE CUT — narrower means more chunks AND fewer words in each.
//   3. THE LIMITS ARE CLAMPED, NOT TRUSTED — a slider is a preference, not an instruction to the ranker.
//   4. A PRIORITY FOLDER'S CHUNKS ARRIVE FIRST — with the cadence at one, the one that fits is that folder's.
//   5. DWELL IS SCALED TO LENGTH — a skim does not count, reading does, and the threshold is the length formula
//      recomputed independently here. A read chunk stops surfacing; a skimmed one comes back. Asserted on the
//      FEED, because "the record says read" and "it stopped arriving" are different claims.
//   6. DISMISSAL BURIES AND THE BIN RESTORES — with the text intact, because a bin without the content is a delete.
//   7. DWELL REACHES NO ADAPTER PAYLOAD — asserted against the adapter INTERFACE and the validator's rows, not by
//      watching traffic. Plus: lib/readwise/ contains none of the vocabulary of a retention model, which is the
//      scope line this gate exists to hold.
//   8. PROGRESS IS ROOT-SCOPED: a paragraph read as one persona is read as all of them.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36).slice(-5);

async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? "")); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const jar = new Map();
async function api(method, path, body) {
  const headers = { "content-type": "application/json" };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => k + "=" + v).join("; ");
  const r = await fetch(BASE + path, { method, headers, cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  let json = null;
  try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}
function dbRows() {
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
  const d = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const out = [];
    for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) {
      for (const row of d.prepare(`SELECT * FROM "${t}"`).all()) out.push([t, JSON.stringify(row)]);
    }
    return out;
  } finally { d.close(); }
}

// THE THRESHOLD FORMULA, recomputed here on purpose. A suite that asks the
// implementation what the threshold is only proves the implementation agrees
// with itself; this is the arithmetic the gate actually promises.
const wordsOf = (t) => t.trim().split(/\s+/).filter(Boolean).length;
const expectedThreshold = (text) => Math.max(1500, Math.round((wordsOf(text) / 240) * 60000 * 0.5));

const feed = async () => (await retry(() => api("GET", "/api/feed2?surface=discovery"))).json;
const rwCards = (f) => (f.cards ?? []).filter((c) => c.kind === "readwise");
const rwState = async () => (await retry(() => api("GET", "/api/readwise"))).json;
const knobs = (patch) => api("POST", "/api/readwise", { action: "knobs", ...patch });

// The longest seeded posts — readwise is about long-form, and a 20-word post would make
// every chunk-width assertion below meaningless.
//
// THE TRAP THIS LIST WALKS AROUND: lib/injection.ts pre-loads its `seen` set with every
// ranked card's hash and drops any queued item whose sourceHash is already there, and a
// readwise item's sourceHash is its BASE POST. So a chunk whose source post happens to be
// on the ranked page is deduped away — bookmarking the five longest posts surfaced chunks
// from only ONE of them, and check 4 then had nothing to compare. The setup below picks
// longform posts that are NOT on the page, and aborts loudly rather than measuring one.
// Derived from the seed corpus at run time rather than hardcoded: the first version listed
// hashes by hand and three of them did not exist, so the suite aborted on "unknown post"
// before making a single claim. The corpus is the source of truth about the corpus.
const LONG_CANDIDATES = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts
  .slice()
  .sort((a, b) => b.text.length - a.text.length)
  .slice(0, 24)
  .map((p) => p.hash);

console.log("\nPost-deploy Gate 4 — readwise knobs + the dwell mechanic (app " + BASE + ")");

// ---------------------------------------------------------------- setup ----
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
const onPage = new Set(((await feed()).cards ?? []).filter((c) => c.kind === "post").map((c) => c.cast.hash));
// FOUR, not twenty-four. The readwise namespace is ONE sealed document, and at the narrow
// end of the chunk slider a two-dozen-post queue cuts into hundreds of chunks whose text all
// lands in that one record — the validator refused the flush with a 413 and the suite died in
// setup. Four longform posts is what the checks below actually need, and keeping the queue
// small is also the honest shape: nobody has two dozen unread essays in flight.
const LONG = LONG_CANDIDATES.filter((h) => !onPage.has(h)).slice(0, 4);
if (LONG.length < 3) { console.log("  ABORT: fewer than three longform posts are off the ranked page, so the injector would dedupe the chunks away"); process.exit(2); }
for (const h of LONG) await retry(() => api("POST", "/api/feed-health", { postHash: h }));
// surface several chunks of each, so there is something to measure
for (let i = 0; i < 4; i++) await retry(() => api("POST", "/api/feed-health/readwise", { all: true }));
const setup = await rwState();
if (!setup?.progress?.length) { console.log("  ABORT: nothing was scheduled, so no readwise claim can be measured"); process.exit(2); }
{
  // The cadence cap is per BUILD and chunks are emitted schedule by schedule, so at the
  // DEFAULT cadence of four every card on the page can come from the first schedule — which
  // is what made the priority-weight check read as "only one post has chunks". Probe at the
  // top of the range, then hand the knob back.
  const before = (await rwState()).knobs;
  await retry(() => knobs({ perBuild: 8 }));
  const sources = new Set(rwCards(await feed()).map((c) => c.cast.hash.split("#")[0]));
  await retry(() => knobs({ perBuild: before.perBuild }));
  if (sources.size < 2) { console.log("  ABORT: only " + sources.size + " post(s) surfaced chunks even at the highest cadence — the priority-weight check cannot be made non-vacuous"); process.exit(2); }
}
const MODE_ID = setup.mode.id;
const DEFAULTS = { ...setup.knobs };
async function restoreKnobs() {
  await api("POST", "/api/readwise", { action: "knobs", modeId: MODE_ID, perBuild: DEFAULTS.perBuild, chunkWords: DEFAULTS.chunkWords, rechunk: true });
}

await check("1. THE CADENCE SLIDER CHANGES HOW MANY CHUNKS ARRIVE", async () => {
  try {
    await retry(() => knobs({ perBuild: 8 }));
    const high = rwCards(await feed()).length;
    await retry(() => knobs({ perBuild: 1 }));
    const low = rwCards(await feed()).length;
    if (high === 0) throw new Error("no readwise cards arrive at ALL, so the slider cannot be measured — the corpus or the schedule setup is wrong");
    if (!(low < high)) throw new Error("the slider did not change the cadence: 8 -> " + high + " cards, 1 -> " + low + " cards");
    if (low > 1) throw new Error("the low setting let " + low + " chunks through when it allows 1");
    return "perBuild 8 -> " + high + " chunks, perBuild 1 -> " + low;
  } finally {
    await restoreKnobs();
  }
});

await check("2. THE CHUNK-LENGTH SLIDER CHANGES THE CUT", async () => {
  try {
    const wide = await retry(() => knobs({ chunkWords: 600, rechunk: true }));
    if (!(wide.json?.rechunked > 0)) throw new Error("nothing was re-cut at the wide setting: " + JSON.stringify(wide.json).slice(0, 140));
    const wideState = await rwState();
    const wideChunks = wideState.progress.reduce((n, p) => n + p.total, 0);
    await retry(() => knobs({ perBuild: 8 }));
    const wideWords = rwCards(await feed()).map((c) => wordsOf(c.cast.text));
    const narrow = await retry(() => knobs({ chunkWords: 80, rechunk: true }));
    if (!(narrow.json?.rechunked > 0)) throw new Error("nothing was re-cut at the narrow setting");
    const narrowState = await rwState();
    const narrowChunks = narrowState.progress.reduce((n, p) => n + p.total, 0);
    const narrowWords = rwCards(await feed()).map((c) => wordsOf(c.cast.text));
    if (!wideWords.length || !narrowWords.length) throw new Error("no chunks rendered at one of the two widths, so the means prove nothing");
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    if (!(narrowChunks > wideChunks)) throw new Error("a narrower cut did not make more chunks: " + wideChunks + " -> " + narrowChunks);
    if (!(mean(narrowWords) < mean(wideWords))) throw new Error("a narrower cut did not make smaller chunks: " + mean(wideWords).toFixed(0) + "w -> " + mean(narrowWords).toFixed(0) + "w");
    return wideChunks + " chunks at 600w (mean " + mean(wideWords).toFixed(0) + ") -> " + narrowChunks + " at 80w (mean " + mean(narrowWords).toFixed(0) + ")";
  } finally {
    await restoreKnobs();
  }
});

await check("3. THE LIMITS ARE CLAMPED, NOT TRUSTED", async () => {
  try {
    const lim = (await rwState()).limits;
    const hi = await retry(() => knobs({ perBuild: 999 }));
    if (hi.json?.knobs?.perBuild !== lim.perBuild[1]) throw new Error("perBuild 999 stored as " + hi.json?.knobs?.perBuild + ", not clamped to " + lim.perBuild[1]);
    const lo = await retry(() => knobs({ chunkWords: 5 }));
    if (lo.json?.knobs?.chunkWords !== lim.chunkWords[0]) throw new Error("chunkWords 5 stored as " + lo.json?.knobs?.chunkWords + ", not clamped to " + lim.chunkWords[0]);
    return "perBuild clamped to " + lim.perBuild[1] + ", chunkWords to " + lim.chunkWords[0];
  } finally {
    await restoreKnobs();
  }
});

let FOLDER = null;
await check("4. A PRIORITY FOLDER'S CHUNKS ARRIVE FIRST", async () => {
  await retry(() => knobs({ perBuild: 8 }));
  const before = rwCards(await feed());
  const sources = new Set(before.map((c) => c.cast.hash.split("#")[0]));
  if (sources.size < 2) throw new Error("only " + sources.size + " post(s) have surfaced chunks — with one source the check would pass whatever the weight does");
  const target = [...sources][sources.size - 1]; // deliberately NOT the one already first
  const made = await retry(() => api("POST", "/api/folders", { name: "pd4-priority-" + stamp, postHashes: [target] }));
  FOLDER = made.json?.folder;
  if (!FOLDER) throw new Error("could not create a folder: " + JSON.stringify(made.json).slice(0, 140));
  try {
    const on = await retry(() => api("POST", "/api/readwise", { action: "priorityFolder", folderId: FOLDER.id, on: true }));
    if (!on.json?.priorityFolders?.includes(FOLDER.id)) throw new Error("the folder was not marked priority");
    await retry(() => knobs({ perBuild: 1 }));
    const cards = rwCards(await feed());
    if (cards.length !== 1) throw new Error("expected exactly one chunk at cadence 1, got " + cards.length);
    if (cards[0].cast.hash.split("#")[0] !== target) throw new Error("the single slot went to " + cards[0].cast.hash + ", not the priority folder's post " + target);
    if (!cards[0].readwisePriority) throw new Error("the chunk does not carry the priority marker");
    // and a folder that is NOT the viewer's cannot be marked
    const notMine = await api("POST", "/api/readwise", { action: "priorityFolder", folderId: "folder_not_mine_" + stamp, on: true });
    if (notMine.status !== 403) throw new Error("a folder this viewer does not own was accepted: " + notMine.status);
    // turning it off releases the slot
    await retry(() => api("POST", "/api/readwise", { action: "priorityFolder", folderId: FOLDER.id, on: false }));
    const after = rwCards(await feed());
    if (after.length === 1 && after[0].readwisePriority) throw new Error("the priority marker survived the folder being un-marked");
    return "cadence 1 gave the slot to the priority folder's post; un-marking released it";
  } finally {
    if (FOLDER) await api("POST", "/api/readwise", { action: "priorityFolder", folderId: FOLDER.id, on: false });
    await restoreKnobs();
  }
});

let SHORT_CHUNK = null;
let LONG_CHUNK = null;
await check("5. DWELL IS SCALED TO LENGTH: a skim does not count, reading does, and a read chunk stops arriving", async () => {
  await retry(() => knobs({ perBuild: 8 }));
  const cards = rwCards(await feed());
  if (cards.length < 2) throw new Error("fewer than two chunks on the page, so a short/long comparison is impossible");
  const sorted = [...cards].sort((a, b) => wordsOf(a.cast.text) - wordsOf(b.cast.text));
  SHORT_CHUNK = sorted[0];
  LONG_CHUNK = sorted[sorted.length - 1];
  const shortWords = wordsOf(SHORT_CHUNK.cast.text);
  const longWords = wordsOf(LONG_CHUNK.cast.text);
  if (shortWords === longWords) throw new Error("every chunk is the same length, so a length-scaled threshold cannot be distinguished from a constant");

  // the threshold, recomputed here
  const probeShort = await retry(() => api("POST", "/api/readwise", { action: "dwell", chunkId: SHORT_CHUNK.cast.hash, ms: 1 }));
  const probeLong = await retry(() => api("POST", "/api/readwise", { action: "dwell", chunkId: LONG_CHUNK.cast.hash, ms: 1 }));
  if (probeShort.json.thresholdMs !== expectedThreshold(SHORT_CHUNK.cast.text)) throw new Error("the short chunk threshold is " + probeShort.json.thresholdMs + ", the formula says " + expectedThreshold(SHORT_CHUNK.cast.text));
  if (probeLong.json.thresholdMs !== expectedThreshold(LONG_CHUNK.cast.text)) throw new Error("the long chunk threshold is " + probeLong.json.thresholdMs + ", the formula says " + expectedThreshold(LONG_CHUNK.cast.text));
  if (probeShort.json.thresholdMs === probeLong.json.thresholdMs) throw new Error("a " + shortWords + "-word chunk and a " + longWords + "-word chunk need the same dwell — that is a constant, not a scale");

  // A FAST SCROLL: three passes at 400ms, which is what going past at speed looks like.
  let skim = probeLong;
  for (let i = 0; i < 3; i++) skim = await retry(() => api("POST", "/api/readwise", { action: "dwell", chunkId: LONG_CHUNK.cast.hash, ms: 400 }));
  if (skim.json.read) throw new Error("scrolling past a " + longWords + "-word chunk three times marked it read at " + skim.json.dwellMs + "ms of " + skim.json.thresholdMs);
  if (!(skim.json.requeues >= 3)) throw new Error("a skimmed chunk did not requeue: " + skim.json.requeues);

  // READING: enough to cross the threshold
  const read = await retry(() => api("POST", "/api/readwise", { action: "dwell", chunkId: SHORT_CHUNK.cast.hash, ms: probeShort.json.thresholdMs + 500 }));
  if (!read.json.read) throw new Error("dwelling past the threshold did not mark the chunk read: " + read.json.dwellMs + " of " + read.json.thresholdMs);

  // THE FEED IS THE CLAIM: the read one is gone, the skimmed one is back
  const after = rwCards(await feed()).map((c) => c.cast.hash);
  if (after.includes(SHORT_CHUNK.cast.hash)) throw new Error("a chunk marked read is still being surfaced");
  if (!after.includes(LONG_CHUNK.cast.hash)) throw new Error("a chunk that was scrolled past did not come back");
  const unknown = await api("POST", "/api/readwise", { action: "dwell", chunkId: "0xnope#chunk9", ms: 100 });
  if (unknown.status !== 404) throw new Error("dwell was accepted for a chunk no schedule holds: " + unknown.status);
  return shortWords + "w needs " + probeShort.json.thresholdMs + "ms, " + longWords + "w needs " + probeLong.json.thresholdMs + "ms; skim requeued " + skim.json.requeues + "x and is back, read one is gone";
});

await check("6. DISMISSAL BURIES, AND THE BIN RESTORES", async () => {
  const cards = rwCards(await feed());
  const victim = cards.find((c) => c.cast.hash !== SHORT_CHUNK?.cast.hash);
  if (!victim) throw new Error("no chunk left to dismiss, so the bin cannot be tested");
  const id = victim.cast.hash;
  try {
    const b = await retry(() => api("POST", "/api/readwise", { action: "bury", chunkId: id }));
    if (!b.json?.buried) throw new Error("bury returned nothing");
    const gone = rwCards(await feed()).map((c) => c.cast.hash);
    if (gone.includes(id)) throw new Error("a buried chunk is still in the feed");
    const bin = (await rwState()).bin ?? [];
    const row = bin.find((x) => x.chunkId === id);
    if (!row) throw new Error("the buried chunk is not in the bin");
    if (!row.text || row.text.length < 10) throw new Error("the bin holds no text — a bin without the content is a delete wearing a different label");
    const bad = await api("POST", "/api/readwise", { action: "restore", chunkId: "0xnope#chunk9" });
    if (bad.status !== 404) throw new Error("restoring something that was never buried answered " + bad.status);
    await retry(() => api("POST", "/api/readwise", { action: "restore", chunkId: id }));
    const back = rwCards(await feed()).map((c) => c.cast.hash);
    if (!back.includes(id)) throw new Error("a restored chunk did not come back to the feed");
    return "buried, absent from the feed, present in the bin with its text, restored";
  } finally {
    await api("POST", "/api/readwise", { action: "restore", chunkId: id });
    await restoreKnobs();
  }
});

await check("7. DWELL REACHES NO ADAPTER PAYLOAD, AND THIS IS NOT A RETENTION MODEL", async () => {
  const types = readFileSync("lib/adapters/types.ts", "utf8");
  if (/dwell/i.test(types)) throw new Error("the adapter interface mentions dwell — then an adapter payload can carry it");
  const walk = (dir, out = []) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = dir + "/" + e.name; if (e.isDirectory()) walk(p, out); else if (/\.tsx?$/.test(e.name)) out.push(p); } return out; };
  // Comments out first, and CRLF normalised before that — pd3's stripper does not cross a
  // \r, so on this checkout it left every line comment standing and reported a comment as a
  // leak. Then one legitimate survivor is allowed: lib/adapters/mock/eventLog.ts names dwell
  // in a FORBIDDEN denylist, which is the opposite of carrying it. Anything else fails.
  const strip = (src) => src.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const offenders = [];
  for (const f of walk("lib/adapters")) {
    const code = strip(readFileSync(f, "utf8"));
    for (const line of code.split("\n")) {
      if (!/dwell/i.test(line)) continue;
      if (/FORBIDDEN\s*=/.test(line)) continue; // a denylist that REFUSES dwell
      offenders.push(f + ": " + line.trim().slice(0, 80));
    }
  }
  if (offenders.length) throw new Error("an adapter file carries dwell: " + offenders[0]);
  const state = readFileSync("lib/readwise/state.ts", "utf8");
  if (/adapters\/registry/.test(state)) throw new Error("the readwise state module imports the adapter registry — dwell must not be able to reach one");
  // the scope line: this gate is explicitly NOT a retention or spaced-repetition model
  for (const f of walk("lib/readwise")) {
    // comments stripped for the same reason: lib/readwise/state.ts opens by SAYING there is
    // no spaced repetition and no forgetting curve here, and a grep that fails on the
    // sentence stating the rule is a grep that punishes writing the rule down
    const src = strip(readFileSync(f, "utf8"));
    for (const word of ["spaced repetition", "forgetting", "sm-2", "sm2", "ease factor", "review interval", "retention curve"]) {
      if (new RegExp("\\b" + word.replace(/[-]/g, "[-]?") + "\\b", "i").test(src)) throw new Error(f + " contains the vocabulary of a retention model (" + word + ") — this gate is the knob, not the model");
    }
  }
  // and on the wire: the sealed record is ciphertext under one opaque key
  const rows = dbRows();
  const mine = rows.filter(([t, s]) => t === "adapter_state" && s.includes("readwiseState"));
  if (!mine.length) throw new Error("the readwiseState namespace never reached the validator state");
  for (const [t, s] of mine) {
    const o = JSON.parse(s);
    const val = o.value ?? o.data ?? s;
    const parsed = typeof val === "string" ? (() => { try { return JSON.parse(val); } catch { return null; } })() : val;
    if (!parsed || typeof parsed !== "object" || !("ct" in parsed)) throw new Error("a readwiseState row is not ciphertext: " + t + " " + s.slice(0, 140));
    if (o.key && !["_", "__whole"].includes(o.key)) throw new Error("readwiseState is addressed by " + o.key + ", not one opaque key");
  }
  if (SHORT_CHUNK) {
    const needle = SHORT_CHUNK.cast.text.trim().split(/\s+/).slice(0, 6).join(" ");
    const leaked = rows.filter(([t, s]) => t === "adapter_state" && s.includes("readwiseState") && s.includes(needle));
    if (leaked.length) throw new Error("the text of a dwelt-on chunk is in a readwiseState row in the clear");
  }
  return "no dwell in the adapter interface or any adapter file; " + mine.length + " sealed row(s); no retention-model vocabulary in lib/readwise/";
});

await check("8. PROGRESS IS ROOT-SCOPED: a paragraph read as one persona is read as all of them", async () => {
  const roster = (await api("GET", "/api/personas/act-as-options")).json?.options ?? [];
  if (roster.length < 2) throw new Error("this device holds fewer than two personas, so the claim cannot be tested");
  const A = roster[0];
  const B = roster[1];
  try {
    await retry(() => api("POST", "/api/seed-persona", { personaId: A.id }));
    const target = LONG[0];
    await retry(() => api("POST", "/api/feed-health", { postHash: target }));
    for (let i = 0; i < 3; i++) await retry(() => api("POST", "/api/feed-health/readwise", { all: true }));
    const cards = rwCards(await feed()).filter((c) => c.cast.hash.startsWith(target + "#"));
    if (!cards.length) throw new Error("no chunk of the target post surfaced for persona A");
    const chunk = cards[0];
    const th = expectedThreshold(chunk.cast.text);
    await retry(() => api("POST", "/api/readwise", { action: "dwell", chunkId: chunk.cast.hash, ms: th + 500 }));
    const aProgress = ((await rwState()).progress ?? []).find((p) => p.postHash === target);
    if (!aProgress || aProgress.read < 1) throw new Error("persona A shows no read chunk for the target post");

    // persona B: same post, same device, NEVER dwelt on anything
    await retry(() => api("POST", "/api/seed-persona", { personaId: B.id }));
    await retry(() => api("POST", "/api/feed-health", { postHash: target }));
    for (let i = 0; i < 3; i++) await retry(() => api("POST", "/api/feed-health/readwise", { all: true }));
    const bProgress = ((await rwState()).progress ?? []).find((p) => p.postHash === target);
    if (!bProgress) throw new Error("persona B has no progress row for the target post, so nothing was compared");
    if (bProgress.read !== aProgress.read)
      throw new Error("progress did not carry: @" + A.handle + " read " + aProgress.read + ", @" + B.handle + " sees " + bProgress.read);
    return "@" + A.handle + " read " + aProgress.read + " chunk(s); @" + B.handle + " sees the same " + bProgress.read + " without dwelling on anything";
  } finally {
    await api("POST", "/api/seed-persona", { personaId: A.id });
  }
});

await restoreKnobs();
await api("POST", "/api/dev", { action: "resetSeed" });
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} Gate 4 checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
