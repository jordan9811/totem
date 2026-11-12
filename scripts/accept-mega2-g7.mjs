// MEGA PASS 2 Gate 7 — OPERATOR-VIEW LINKAGE TEST v5. FIXTURE-ONLY. SAFETY SET: a successful linkage halts the pass.
//
// The Multi-FID pass's v4 session is unchanged; THIS suite adds what this pass introduced and asks, from the OPERATOR's
// data only (the validator's database, its state namespaces, its log, the wire's shape), whether any of it links two
// personas of one root, or a persona to its root, beyond the floor.
//
//   0. SESSION (zk binding, a 120-decoy cohort): MAIN and a public fork PUB (one root) both prove; MAIN stakes on one
//      cast and PUB on another in the same hour; MAIN switches its mode's lens; the device saves a reading layout; ALT
//      (the private persona) writes a private post and the device searches for it by keyword and by paraphrase; MAIN
//      links an X handle and the @totem inbox lands a DM; PUB links a second handle and MAIN ports the relationship
//   1. STAKE PATTERNS: no row joins MAIN and PUB, none joins either to the root; the accrual names the root only; the
//      co-timing candidate set (personas staking in PUB's hour) is MEASURED and reported, never below 3
//   2. LENS SWITCH: the lens pin is a persona-addressed mode preference naming no sibling and no root; lenses are public
//   3. ZONE CONFIG: one ciphertext record at the KiB step; no layout plaintext anywhere
//   4. SEARCH: the validator's database is byte-identical and its log gains no line across the searches; no query lands
//   5. DM ROUTING: beyond the existing attestation the operator sees a cursor, a private folder holding an OPAQUE hash,
//      and ciphertext — no tweet id, no DM text, no sender beyond MAIN's own handle
//   6. RELATIONSHIP PORT: two attestations (one per persona), ciphertext ports and grants; no row joins MAIN and PUB by
//      id or by handle
//   7. THE FLOOR: MAIN's and PUB's eligibility rows carry distinct nullifiers; the cohort is at least the floor
//   8. LEAKS: the whole DB and the log carry no vault plaintext (allowance, zones, ports, the private canary), no query,
//      and no row joining any of our personas to the root
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const VLOG = process.env.LAYERS_VALIDATOR_LOG || (process.env.TEMP ? process.env.TEMP + "/layers-validator.log" : null);
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const COUNTERPART = "persona_acc_crypto_1";
const N = 120;
const CANARY = "borrowing is cheap right now, the v5 canary refinances the loan";
const PARAPHRASE = "credit is affordable currently";
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

await assertServersUp(BASE);
async function api(method, url, body, headers = {}) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function vapi(p) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(VBASE + p); return { status: r.status, json: await r.json().catch(() => null) }; }
    catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw new Error("INFRA: fetch failed for " + p + " (" + (last?.cause?.code ?? last?.message ?? "no cause") + ")");
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.json?.reason ?? JSON.stringify(r.json)?.slice(0, 200))); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const reset = () => retry(() => dev("resetSeed"));
const asViewer = (id) => ({ cookie: `layers_view_as=${id}` });
const seedAccounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(seedAccounts);
const idOf = (h) => seedList.find((p) => p.handle === h)?.id;
const hourOf = (ms) => Math.floor(ms / 3600_000);

/** THE OPERATOR'S VIEW: every row of every table (per-table hashes so a change is nameable), plus the root's id */
// PERSONA LAUNCH wave 3 (verify, harness race): `order` puts envelope_counters LAST ("env-last") or FIRST ("env-first") in
// the scan. The rig's idle device bumps envelope counters on its own schedule (its prefetch tick's signed reads: rings,
// zk:eligibility — every ~3 s), and a whole-database scan now takes about a second, so a before-scan that read the table
// early and an after-scan that read it late left a window of two scans plus the searches for a tick to land in (check 4
// failed "envelope_counters" in the wave-1 final sweep and twice in a row on 2026-10-13). Reading that table last before
// and first after shrinks its window to the searches alone; every row of every table is still compared.
function operatorView(order) {
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const rows = [];
    const perTable = {};
    let tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    if (order === "env-last") tables = [...tables.filter((t) => t !== "envelope_counters"), ...tables.filter((t) => t === "envelope_counters")];
    if (order === "env-first") tables = [...tables.filter((t) => t === "envelope_counters"), ...tables.filter((t) => t !== "envelope_counters")];
    for (const t of tables) {
      const h = createHash("sha256");
      for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) { const s = JSON.stringify(row); rows.push({ t, s, row }); h.update(s + "\n"); }
      perTable[t] = h.digest("hex");
    }
    const root = db.prepare("SELECT id FROM roots WHERE fid = 9152").get()?.id ?? null;
    return { rows, root, perTable };
  } finally { db.close(); }
}
const logSize = () => (VLOG && existsSync(VLOG) ? statSync(VLOG).size : -1);
/** the log's bytes between `from` and `to` (to = the current end when omitted) */
function logDelta(from, to) {
  if (!VLOG || !existsSync(VLOG) || from < 0) return null;
  const size = to === undefined ? statSync(VLOG).size : to;
  if (size <= from) return "";
  const fd = openSync(VLOG, "r");
  try { const buf = Buffer.alloc(size - from); readSync(fd, buf, 0, buf.length, from); return buf.toString("utf8"); } finally { closeSync(fd); }
}
const isCipher = (v) => v && typeof v === "object" && typeof v.ct === "string" && typeof v.nonce === "string";
const ctBytes = (v) => Buffer.from(v.ct, "hex");

console.log("\nMega pass 2 Gate 7 — operator-view linkage v5: stakes across personas, a lens switch, a zone layout, a search, a DM, a port");

let PUB = null;
let sessionOk = false;
let seedHour = 0;
let stakeHour = 0;
let searchBefore = null;
let searchAfter = null;
let searchLogDelta = null;
const SESSION = "0. SESSION: two proven personas of one root stake, switch a lens, save a layout, search, land a DM and port a relationship";
try {
  await reset();
  await retry(() => zk("resetZk"));
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("setHonoredIssuers", { issuers: ["test.mock-issuer"] }));
  await retry(() => zk("seedDecoys", { count: N }));
  await retry(() => zk("register"));
  await retry(() => zk("advanceEpoch"));
  seedHour = hourOf(Date.now());
  const stamp = Date.now().toString(36).slice(-5);
  const forked = (await retry(() => api("POST", "/api/identity/fork", { fromPersona: idOf("brothandbones"), carry: [], newHandle: "v5pub_" + stamp, newName: "Gate 7 pub" }))).json;
  PUB = forked.newPersona;
  if (!PUB) throw new Error("PUB fork: " + JSON.stringify(forked).slice(0, 200));
  const prove = async (personaId) => {
    for (let i = 0; i < 8; i++) {
      await retry(() => zk("prefetchNow"));
      await sleep(300);
      // a proof is only WANTED once the persona demanded a gated surface — visit the home feed as that persona
      await fetch(BASE + "/home", { headers: personaId === MAIN ? {} : asViewer(personaId) }).catch(() => {});
      await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
      const t = (await retry(() => api("GET", `/api/tier?personaId=${personaId}`))).json;
      if (t.proven && t.tier > 0) return t.tier;
      await sleep(400);
    }
    throw new Error(personaId + " never proved");
  };
  await prove(MAIN);
  await prove(PUB);
  // stakes across the root's personas, same hour, different casts
  await retry(() => api("POST", "/api/influence", { action: "stake", castHash: "0xcr0001", stakeAction: "like", amount: 2, personaId: MAIN }));
  await retry(() => api("POST", "/api/influence", { action: "stake", castHash: "0xcr0036", stakeAction: "like", amount: 2, personaId: PUB }));
  stakeHour = hourOf(Date.now());
  // a lens switch on MAIN's active mode
  await retry(() => api("POST", "/api/lenses", { action: "apply", lensId: "lens_slow_reads" }));
  // a reading layout on this device
  await retry(() => api("POST", "/api/zones", { action: "preset", layout: "reading", viewport: { w: 1280, h: 900 } }));
  // a private post by ALT; the index derives once (the vault is in memory), then the operator's view is snapshotted around the searches
  await retry(() => api("POST", "/api/private/posts", { text: CANARY }, asViewer(ALT)));
  await retry(() => api("GET", "/api/search/unified?q=warmup&mode=keyword"));
  await sleep(300);
  // PERSONA LAUNCH wave 3 (verify, harness race): what the IDLE device writes on its own, measured here and not assumed —
  // the envelope-counter namespaces its background tick moves over 7 s while this suite does nothing (two ticks at the
  // rig's 3 s cadence)
  const envSnap = () => {
    const d = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      return new Map(d.prepare("SELECT device_id, namespace, counter FROM envelope_counters").all().map((r) => [r.device_id + "|" + r.namespace, r.counter]));
    } finally {
      d.close();
    }
  };
  const idle0 = envSnap();
  await sleep(7000);
  const tickNamespaces = new Set([...envSnap()].filter(([k, v]) => idle0.get(k) !== v).map(([k]) => k.split("|").slice(1).join("|")));
  const envRows = (view) => new Map(view.rows.filter((r) => r.t === "envelope_counters").map((r) => [r.row.device_id + "|" + r.row.namespace, r.row.counter]));
  // the snapshot around the searches: envelope_counters read LAST before and FIRST after (operatorView's order), the log
  // measured right around the searches. A bounded RETRY (at most 4 attempts) only when EVERY difference is the idle
  // device's own: envelope rows in a namespace its tick was just seen moving, and log lines that are the ring drop's
  // per-minute line. Any other difference — a table, a namespace or a log line the searches could have caused — ends the
  // loop at once and check 4 fails on it; a search that wrote every time would fail all four attempts.
  let kw = null;
  let sem = null;
  let searchAttempts = 0;
  for (;;) {
    searchAttempts++;
    const view0 = operatorView("env-last");
    const log0 = logSize();
    kw = await api("GET", `/api/search/unified?q=${encodeURIComponent("v5 canary")}&mode=keyword`);
    sem = await api("GET", `/api/search/unified?q=${encodeURIComponent(PARAPHRASE)}&mode=semantic`);
    const log1 = logSize();
    const view1 = operatorView("env-first");
    searchBefore = { view: view0, log: log0 };
    searchAfter = { view: view1, log: log1 };
    searchLogDelta = logDelta(log0, log1);
    const changedNow = Object.keys(view1.perTable).filter((t) => view1.perTable[t] !== view0.perTable[t]);
    const e0 = envRows(view0);
    const e1 = envRows(view1);
    const envMoved = [...new Set([...e0.keys(), ...e1.keys()])].filter((k) => e0.get(k) !== e1.get(k)).map((k) => k.split("|").slice(1).join("|"));
    const logLines = (searchLogDelta ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const onlyIdle =
      (changedNow.length > 0 || logLines.length > 0) &&
      changedNow.every((t) => t === "envelope_counters") &&
      envMoved.every((ns) => tickNamespaces.has(ns)) &&
      logLines.every((l) => /^\[ringdrop\] last minute: /.test(l));
    if (!onlyIdle || searchAttempts >= 4) break;
    console.log(`      (search window ${searchAttempts}: only the idle device's own background writes moved — envelope namespaces [${[...new Set(envMoved)].join(",")}], ${logLines.length} ring-drop log line(s) — measuring again)`);
    await sleep(500);
  }
  if (searchAttempts > 1) console.log(`      (the search window was measured ${searchAttempts} times; idle namespaces seen: [${[...tickNamespaces].join(",")}])`);
  if (kw.status !== 200 || sem.status !== 200) throw new Error("searches: " + kw.status + "/" + sem.status + " " + JSON.stringify(kw.json ?? sem.json).slice(0, 160));
  // the DM hook (MAIN's handle first: the fixture's $LINKED sender is the first attested handle) and the port
  await retry(() => api("POST", "/api/x/link", { action: "begin" }));
  await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: "v5main" }));
  await retry(() => api("POST", "/api/x/inbox", { action: "poll" }));
  await retry(() => api("POST", "/api/x/link", { action: "begin" }, asViewer(PUB)));
  await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: "v5pub" }, asViewer(PUB)));
  // the SAME tweet, DMed by PUB's handle (fixture: $LINKED is the active persona's handle) — two personas, one tweet
  await retry(() => dev("resetInboxCursor"));
  await retry(() => api("POST", "/api/x/inbox", { action: "poll" }, asViewer(PUB)));
  await retry(() => api("POST", "/api/x/altlink", { action: "ackDisclaimer" }));
  await retry(() => api("POST", "/api/x/port", { fromPersona: MAIN, toPersona: PUB, counterpart: { personaId: COUNTERPART }, targetPostId: "1500000000000000009" }));
  await sleep(500);
  sessionOk = true;
  ok(SESSION);
} catch (e) {
  fail(SESSION, e.message);
}

const view = sessionOk ? operatorView() : null;
const state = sessionOk ? ((await vapi("/state")).json?.state ?? {}) : {};
const joins = (a, b) => view.rows.filter((r) => r.s.includes(a) && r.s.includes(b));
const need = () => { if (!sessionOk) throw new Error("session did not complete"); };

await check("1. STAKE PATTERNS: no row joins MAIN and PUB, none joins either to the root; the accrual names the root only; the co-timing candidate set is measured and reported, never below 3", async () => {
  need();
  const j = joins(MAIN, PUB);
  if (j.length) throw new Error("a row joins the two personas: " + j.map((r) => r.t).join(",") + " — " + j[0].s.slice(0, 160));
  if (!view.root) throw new Error("the operator's roots table has no row for the account");
  for (const p of [MAIN, PUB]) if (joins(p, view.root).length) throw new Error(`a row joins ${p} to its root`);
  const stakes = view.rows.filter((r) => r.t === "stakes" && r.row.mode === "fixture").map((r) => r.row);
  const ours = stakes.filter((s) => s.persona_id === MAIN || s.persona_id === PUB);
  if (ours.length < 2) throw new Error("both personas' stakes are not on the validator (" + ours.length + ")");
  const pubHour = stakes.find((s) => s.persona_id === PUB).created_at;
  const coTimed = new Set(stakes.filter((s) => s.created_at === pubHour).map((s) => s.persona_id));
  console.log(`      co-timing candidate set for PUB's hour: ${coTimed.size} personas (the behavioural link A-MEGA2-STAKE-COTIMING — measured, never hidden)`);
  if (coTimed.size < 3) {
    if (seedHour !== stakeHour) throw new Error("INFRA: the hour rolled between the seed and the stakes — the seeded stakers fell into the previous hour; rerun");
    throw new Error("the co-timing candidate set is below 3 — two personas of one root are alone in their hour");
  }
  for (const a of view.rows.filter((r) => r.t === "rep_events" && r.row.type === "stewardship")) {
    if (a.s.includes(MAIN) || a.s.includes(PUB)) throw new Error("an accrual row names a persona");
    if (a.row.created_at % 3_600_000 !== 0) throw new Error("a stewardship rep event carries a finer-than-hour timestamp (attack-mega-1 F1)");
  }
});

await check("2. LENS SWITCH: the lens pin lives in the SEALED modes namespace (a mode's bindings, rules, weights and pin are a habit fingerprint); the lens store is public artifacts", async () => {
  need();
  // attack-mega-2 F1
  const modesNs = state.modes ?? {};
  if (!isCipher(modesNs._)) throw new Error("the modes namespace is not one sealed record: " + JSON.stringify(Object.keys(modesNs)));
  for (const r of view.rows) if (r.t === "adapter_state" && r.row.namespace !== "lenses" && r.s.includes("lens_slow_reads")) throw new Error("the lens pin is plaintext in namespace " + r.row.namespace);
  for (const r of view.rows) if (r.t === "adapter_state" && r.row.namespace === "modes" && /actionButtonSlots|stake-as|calmRanking/.test(r.s)) throw new Error("a mode definition is plaintext on the validator");
  // BROWSER KEYSTORE PASS Gate 1 stage 2: every namespace is one opaque sealed record now, the lens store included —
  // a lens artifact names the mode that pins it, and the operator gets neither.
  const lenses = Object.entries(state.lenses ?? {});
  if (!lenses.length) throw new Error("no lens namespace on the validator");
  for (const [k, v] of lenses) if (!isCipher(v)) throw new Error("the lens store is not sealed: " + k);
  const evaluated = (await retry(() => api("GET", "/api/lenses"))).json;
  if (!(evaluated?.lenses ?? []).some((l) => l.id === "lens_slow_reads")) throw new Error("the app cannot see the lens it pinned");
});

await check("3. ZONE CONFIG: one ciphertext record at the KiB step; no layout plaintext anywhere", async () => {
  need();
  const ns = state.scrollZones ?? {};
  const keys = Object.keys(ns);
  if (keys.length !== 1 || !isCipher(ns[keys[0]])) throw new Error("scrollZones is not one ciphertext record: " + JSON.stringify(keys));
  const ct = ctBytes(ns[keys[0]]);
  const rem = ct.length % 1024;
  // the plaintext is padded so the record lands just under a KiB multiple (the JSON wrapper and the GCM tag sit inside the step)
  if (ct.length < 512 || !(rem <= 16 || rem >= 1024 - 64)) throw new Error("the sealed zone record is not at the KiB step (" + ct.length + " bytes)");
  for (const r of view.rows) if (/reading-center|"longform"|insetPx/.test(r.s)) throw new Error(`${r.t} row carries zone plaintext`);
});

await check("4. SEARCH: the validator's database is byte-identical and its log gains no line across the searches; no query lands anywhere", async () => {
  need();
  const changed = Object.keys(searchAfter.view.perTable).filter((t) => searchAfter.view.perTable[t] !== searchBefore.view.perTable[t]);
  if (changed.length) throw new Error("the validator's database changed during the searches: " + changed.join(","));
  if (searchLogDelta === null) console.log("      (validator log not found at " + VLOG + " — the DB is the evidence)");
  else if (searchLogDelta.trim()) throw new Error("the validator's log grew during the searches: " + searchLogDelta.trim().split("\n").slice(0, 3).join(" | ").slice(0, 200));
  for (const r of view.rows) if (/v5 canary|affordable currently|refinances the loan/.test(r.s)) throw new Error(`${r.t} row carries a query or the private text`);
});

await check("5. DM ROUTING: beyond the existing attestation the operator sees a cursor, a private folder holding an opaque hash, and ciphertext — no tweet id, no DM text, no sender beyond MAIN's own handle", async () => {
  need();
  // BROWSER KEYSTORE PASS Gate 1 stage 2: the attestation, the folder and the readwise schedule are all sealed now —
  // the operator sees a namespace name, a sealed record and a size. The app is asked whether the DM actually landed.
  const info = (await retry(() => api("GET", "/api/x/inbox"))).json;
  if (info?.linkedHandle !== "v5main") throw new Error("the app does not see MAIN's linked handle: " + JSON.stringify(info?.linkedHandle));
  if (!(info?.folder?.count >= 1)) throw new Error("the DM never landed in MAIN's folder: " + JSON.stringify(info?.folder));
  if (!(info?.schedules ?? []).some((s) => /^dm:[0-9a-f]{16}$/.test(s.postHash))) throw new Error("no opaque DM hash in MAIN's readwise schedule: " + JSON.stringify(info?.schedules));
  for (const r of view.rows) if (/1720000000000000001|1720000000000000003|save this for me|for the weekend|randomstranger_88|From X DM|v5main/.test(r.s)) throw new Error(`${r.t} row carries DM routing in plaintext: ` + r.s.slice(0, 120));
  for (const ns of ["xImportedPrivate", "readwise", "xAttestations", "folders"]) {
    const entries = Object.entries(state[ns] ?? {});
    if (!entries.length) throw new Error(ns + " is empty — the DM never landed");
    for (const [k, v] of entries) if (!isCipher(v)) throw new Error(ns + "/" + k + " is not ciphertext");
  }
});

await check("6. RELATIONSHIP PORT: two attestations (one per persona), ciphertext ports and grants; no row joins MAIN and PUB by id or by handle", async () => {
  need();
  // the two attestations exist for the app (each persona sees its own handle) and are sealed from the operator
  const mine = (await retry(() => api("GET", "/api/x/link"))).json;
  const theirs = (await retry(() => api("GET", "/api/x/link", undefined, asViewer(PUB)))).json;
  if (mine?.attestation?.handle !== "v5main" || theirs?.attestation?.handle !== "v5pub") throw new Error("the two attestations are not each on their own persona: " + JSON.stringify([mine?.attestation?.handle, theirs?.attestation?.handle]));
  for (const r of view.rows) if (/v5main|v5pub/.test(r.s)) throw new Error(`${r.t} row carries a linked handle in plaintext`);
  const ports = Object.entries(state.relationshipPorts ?? {});
  if (!ports.length) throw new Error("no port record on the validator — the port did not persist");
  for (const [k, v] of ports) if (!isCipher(v)) throw new Error("relationshipPorts/" + k + " is not ciphertext");
  for (const [k, v] of Object.entries(state.grantsV3 ?? {})) if (!isCipher(v)) throw new Error("grantsV3/" + k + " is not ciphertext");
  if (joins(MAIN, PUB).length) throw new Error("a row joins MAIN and PUB after the port");
  const byHandle = joins("v5main", "v5pub");
  if (byHandle.length) throw new Error("a row joins the two handles: " + byHandle.map((r) => r.t + "/" + (r.row.namespace ?? "")).join(","));
  for (const r of view.rows) if (/1500000000000000009|targetPostId|port_[0-9a-f]{12}/.test(r.s)) throw new Error(`${r.t} row carries the port in plaintext`);
});

await check("7. THE FLOOR: MAIN's and PUB's eligibility rows carry distinct nullifiers at the same epoch; the cohort is at least the floor", async () => {
  need();
  const el = view.rows.filter((r) => r.t === "zk_eligibility" && r.row.mode === "fixture").map((r) => r.row);
  const latest = (id) => el.filter((e) => e.persona_id === id).sort((a, b) => b.epoch - a.epoch)[0];
  const a = latest(MAIN);
  const b = latest(PUB);
  if (!a || !b) throw new Error("both personas' eligibility rows are not present (" + !!a + "/" + !!b + ")");
  if (a.nullifier === b.nullifier) throw new Error("the two personas share a nullifier — a direct link");
  const regs = view.rows.filter((r) => r.t === "zk_registrations" && r.row.mode === "fixture").length;
  console.log(`      cohort: ${regs} registrations; eligibility epochs MAIN=${a.epoch} PUB=${b.epoch}`);
  if (regs < 50) throw new Error("the cohort is below the floor: " + regs);
});

await check("8. LEAKS: the whole DB and the log carry no vault plaintext, no query, and no row joining any of our personas to the root", async () => {
  need();
  const markers = /insetPx|targetPostId|"accruals"|v5 canary|affordable currently|refinances the loan/;
  for (const r of view.rows) {
    if (markers.test(r.s)) throw new Error(`${r.t} row carries vault plaintext: ` + r.s.slice(0, 120));
    if ((r.s.includes(MAIN) || r.s.includes(PUB) || r.s.includes(ALT)) && r.s.includes(view.root)) throw new Error(`${r.t} row joins a persona to the root`);
  }
  if (VLOG && existsSync(VLOG)) {
    const log = readFileSync(VLOG, "utf8");
    if (markers.test(log)) throw new Error("the validator's log carries vault plaintext or a query");
  } else console.log("      (validator log not found at " + VLOG + " — the DB is the evidence)");
});

await check("9. SAME TWEET, TWO PERSONAS: both landed it, their dm: hashes differ, no dm: hash sits under two personas in any plain row, readwise is one opaque record", async () => {
  need();
  // attack-mega-3 F1
  // attack-mega-3 F1, now through the app (the folders are sealed): both personas landed the SAME tweet, and the
  // hashes they landed it under differ — the property the operator could otherwise have joined on.
  const hashOf = async (personaId) => {
    const info = (await retry(() => api("GET", "/api/x/inbox", undefined, personaId === MAIN ? {} : asViewer(personaId)))).json;
    const s = (info?.schedules ?? []).map((x) => x.postHash).filter((h) => /^dm:[0-9a-f]{16}$/.test(h));
    if (!s.length) throw new Error(personaId + " landed no DM bookmark: " + JSON.stringify(info?.schedules));
    return s;
  };
  const mineHashes = await hashOf(MAIN);
  const theirsHashes = await hashOf(PUB);
  const shared = mineHashes.filter((h) => theirsHashes.includes(h));
  if (shared.length) throw new Error("the two personas share a dm: hash for the same tweet — the operator can join them: " + shared[0]);
  for (const r of view.rows) if (/dm:[0-9a-f]{16}/.test(r.s)) throw new Error("a dm: hash is in a plaintext row: " + r.t);
  for (const r of view.rows) if (r.t === "adapter_state" && r.row.namespace === "readwise" && r.row.key !== "_") throw new Error("readwise is not one opaque record: key " + r.row.key);
});

await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Mega pass 2 Gate 7 (linkage v5) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
