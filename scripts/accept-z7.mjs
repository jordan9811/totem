// ZK PASS 2 — GATE 2: THE VALIDATOR STOPS KNOWING persona → root.
// FIXTURE-ONLY. Requires the servers of scratchpad z2-run.sh (validator
// under `npm run validator:supervised`, ZK_DEV_HOOKS=true) and the pre-006
// roster export at .keystore/fixture-roster.json.
//
// 1. SCHEMA: after migration 006 nothing on disk links a persona to a root
//    (no column, no table, no index); root-level blocks survive only as the
//    rollback's evidence table, which no route reads.
// 2. WIRE: the reads that needed the link are 410, a rootId on creation is
//    400, a persona on the wire carries no rootId.
// 3. DEVICE ROSTER: a signer-registered device lists its own personas from
//    the vault roster; another device does not see them; the validator
//    stores the roster as ciphertext.
// 4. PERSONA-LEVEL BLOCKS: the device fans a block out over ITS OWN
//    personas only; the blocked account's sibling is untouched; the UI copy
//    says so.
// 5. RESTART SURVIVAL on the new schema (killed validator comes back with
//    the same rows and the same roster ciphertext).
// 6. ROLLBACK, END TO END, ON A SNAPSHOT: the device's roster export feeds
//    validator/migrate-down.js; an incomplete roster is refused; quarantine
//    moves the unattributable personas aside; personas.root_id comes back
//    EXACTLY; migrating up again re-applies 006.
// 7. GREPS + DOCS.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent } from "./lib-health.mjs";
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB = "validator/layers.db";

const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) { try { return await fn(); } catch (e) { last = e; await sleep(400 * (i + 1)); } }
  throw last;
}
async function vapi(method, p, body) {
  const r = await fetch(VBASE + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function api(ctx, method, url, body) {
  const r = await ctx.request.fetch(BASE + url, { method, data: body });
  return { status: r.status(), json: await r.json().catch(() => null) };
}
const zk = (action, extra = {}) => fetch(BASE + "/api/zk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, mode: "fixture", ...extra }) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const tables = (db) => db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
const hasTable = (db, t) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const isRootCol = (c) => c === "root_id" || /_root$/.test(c);
const isPersonaCol = (c) => c === "persona_id" || /_persona$/.test(c);

await assertServersUp(BASE, VBASE);
console.log("\nZK Pass 2 Gate 2 — the validator stops knowing persona → root (migration 006)");
const browser = await chromium.launch();
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const stamp = Date.now().toString(36);
const fixture = existsSync(".keystore/fixture-roster.json") ? JSON.parse(readFileSync(".keystore/fixture-roster.json", "utf8")) : null;

// ---- 1. schema ----
await check("1. SCHEMA: personas has no root_id; no table pairs a persona column with a root column; the root-level blocks table is gone (blocks_v2 is persona-level); migration 006 is applied", async () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const v = db.prepare("SELECT MAX(version) v FROM schema_version").get().v;
    if (v < 6) throw new Error("schema_version is " + v + " — migration 006 not applied");
    const pc = cols(db, "personas");
    if (pc.includes("root_id")) throw new Error("personas.root_id still exists");
    if (hasTable(db, "blocks")) throw new Error("the root-level blocks table still exists");
    const b2 = cols(db, "blocks_v2");
    if (!b2.includes("blocker_persona") || !b2.includes("blocked_persona") || b2.some(isRootCol)) throw new Error("blocks_v2 is not persona-level: " + b2.join(","));
    for (const t of tables(db)) {
      const c = cols(db, t.name);
      const hasRoot = c.some(isRootCol);
      const hasPersona = c.some(isPersonaCol) || t.name === "personas";
      if (hasRoot && hasPersona) throw new Error(`table ${t.name} links personas to roots: ${c.join(",")}`);
      if (t.name === "personas" && /REFERENCES\s+roots/i.test(t.sql)) throw new Error("personas still references roots");
    }
    for (const ix of db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()) {
      if (ix.tbl_name === "personas" && /root/i.test(ix.sql)) throw new Error("an index on personas mentions roots: " + ix.sql);
    }
    if (!hasTable(db, "blocks_legacy_export")) throw new Error("blocks_legacy_export (the rollback's evidence) is missing");
    const le = cols(db, "blocks_legacy_export");
    if (le.some(isPersonaCol)) throw new Error("blocks_legacy_export carries persona columns: " + le.join(","));
  } finally { db.close(); }
});

// ---- 2. wire ----
let selfPersona = null;
await check("2. WIRE: /personas/root, /personas/by-fid and /rep/:personaId are 410; POST /personas with a rootId is 400 and creates nothing; a persona on the wire carries no rootId", async () => {
  if (!fixture) throw new Error(".keystore/fixture-roster.json missing — run node validator/export-roster.js on the pre-006 db first");
  const selfRoot = fixture.fids["9152"];
  selfPersona = selfRoot ? (fixture.roots[selfRoot] ?? [])[0] : null;
  if (!selfPersona) throw new Error("the fixture roster has no persona for the seeded self (fid 9152)");
  for (const p of ["/personas/root/" + selfRoot, "/personas/by-fid/9152", "/rep/" + selfPersona]) {
    const r = await vapi("GET", p);
    if (r.status !== 410) throw new Error(`${p} answered ${r.status} (expected 410): ${JSON.stringify(r.json)}`);
    if (!/006/.test(r.json?.error ?? "")) throw new Error(`${p} does not name migration 006: ${JSON.stringify(r.json)}`);
  }
  const before = (await vapi("GET", "/health")).json.personas;
  const bad = await vapi("POST", "/personas", { rootId: selfRoot, name: "X", handle: "zx_" + stamp });
  if (bad.status !== 400) throw new Error("POST /personas with rootId answered " + bad.status);
  const after = (await vapi("GET", "/health")).json.personas;
  if (after !== before) throw new Error("a refused creation still created a persona");
  const p = await vapi("GET", "/personas/" + selfPersona);
  if (p.status !== 200) throw new Error("GET /personas/:id " + p.status);
  if ("rootId" in p.json.persona || /root_/.test(JSON.stringify(p.json))) throw new Error("persona on the wire carries root material: " + JSON.stringify(p.json));
  const tier = await vapi("GET", "/rep/root/" + selfRoot + "/tier");
  if (typeof tier.json?.tier !== "number") throw new Error("tier by root handle broke: " + JSON.stringify(tier));
});

// ---- 3. device roster ----
let a1 = null, a2 = null, b1 = null, b2 = null;
await check("3. DEVICE ROSTER: a signer-registered device lists its personas from the vault roster (no rootId key); a second device does not see them; the validator stores the roster as ciphertext", async () => {
  const sa = await retryContent(() => ctxA.request.post(BASE + "/api/signer", { data: {} }), (r) => r.ok(), 4);
  if (!(await sa.json()).session) throw new Error("signer connect A");
  a1 = (await api(ctxA, "POST", "/api/personas", { name: "Z7 A1", handle: "za1_" + stamp })).json?.persona;
  a2 = (await api(ctxA, "POST", "/api/personas", { name: "Z7 A2", handle: "za2_" + stamp })).json?.persona;
  if (!a1?.id || !a2?.id) throw new Error("persona creation on device A failed: " + JSON.stringify({ a1, a2 }));
  const listA = (await api(ctxA, "GET", "/api/personas")).json;
  const idsA = (listA.personas ?? []).map((p) => p.id);
  if (!idsA.includes(a1.id) || !idsA.includes(a2.id)) throw new Error("device A does not list its own personas: " + JSON.stringify(idsA));
  if (/rootId|root_/.test(JSON.stringify(listA))) throw new Error("the persona list carries root material");
  const sb = await retryContent(() => ctxB.request.post(BASE + "/api/signer", { data: {} }), (r) => r.ok(), 4);
  if (!(await sb.json()).session) throw new Error("signer connect B");
  const idsB = ((await api(ctxB, "GET", "/api/personas")).json.personas ?? []).map((p) => p.id);
  if (idsB.includes(a1.id) || idsB.includes(a2.id)) throw new Error("device B sees device A's personas");
  const stored = (await vapi("GET", "/state/rootRoster")).json?.entries ?? {};
  const text = JSON.stringify(stored);
  if (!Object.keys(stored).length) throw new Error("no rootRoster namespace stored on the validator");
  if (text.includes(a1.id) || text.includes(a2.id) || /root_[0-9a-f]{8,}/.test(text) || /"9152"/.test(text)) throw new Error("the stored roster is readable by the operator (persona ids, root ids or fids in the clear)");
});

// ---- 4. persona-level blocks ----
await check("4. BLOCKS are persona-level: device B blocks A1 as b1 — ONE validator row, no sibling row for b2 (no side-by-side siblings); the device shares the block across its own personas at read time; A2 (the blocked sibling) is untouched; the UI copy names the regression", async () => {
  b1 = (await api(ctxB, "POST", "/api/personas", { name: "Z7 B1", handle: "zb1_" + stamp })).json?.persona;
  b2 = (await api(ctxB, "POST", "/api/personas", { name: "Z7 B2", handle: "zb2_" + stamp })).json?.persona;
  if (!b1?.id || !b2?.id) throw new Error("persona creation on device B failed");
  // creating b2 made it the ACTIVE persona (the persona route sets the cookie); act as b1
  await ctxB.addCookies([{ name: "layers_active_persona", value: b1.id, url: BASE }]);
  const blk = await api(ctxB, "POST", "/api/block", { personaId: a1.id });
  if (blk.status !== 200 || !blk.json.ok) throw new Error("block via the app failed: " + blk.status + " " + JSON.stringify(blk.json));
  if (blk.json.fanout !== "read-time, device-side" || blk.json.sharedAcross !== 2) throw new Error("block response: " + JSON.stringify(blk.json));
  // the validator holds ONE row (the acting persona b1 → a1) and NOTHING for b2:
  // a fan-out write would seat the siblings side by side in operator-visible rows
  const r1 = await vapi("GET", "/blocked/" + b1.id);
  if (r1.json.fanout !== "persona-level only") throw new Error("/blocked lacks the fan-out statement: " + JSON.stringify(r1.json));
  if (!r1.json.personaIds.includes(a1.id)) throw new Error("b1 does not block A1 on the validator");
  if (r1.json.personaIds.includes(a2.id)) throw new Error("b1 blocks A2 — a persona → root link is back");
  const r2 = await vapi("GET", "/blocked/" + b2.id);
  if (r2.json.personaIds.length) throw new Error("a block row was written for the sibling b2 — siblings side by side in validator rows");
  // the DEVICE shares the block across its own personas at read time
  const shared = await api(ctxB, "GET", "/api/block");
  if (shared.status !== 200 || !shared.json.blocked.includes(a1.id) || shared.json.sharedAcross !== 2) throw new Error("the device does not share the block at read time: " + JSON.stringify(shared.json));
  await ctxB.addCookies([{ name: "layers_active_persona", value: b2.id, url: BASE }]);
  const asB2 = await api(ctxB, "GET", "/api/block");
  if (asB2.json.personaId !== b2.id || !asB2.json.blocked.includes(a1.id)) throw new Error("acting as b2 the block is not shared: " + JSON.stringify(asB2.json));
  await ctxB.addCookies([{ name: "layers_active_persona", value: b1.id, url: BASE }]);
  const ra = await vapi("GET", "/blocked/" + a1.id);
  if (ra.json.personaIds.length) throw new Error("the blocked side gained blocks");
  const ui = readFileSync("components/BlockPersonasButton.tsx", "utf8");
  if (!/Block this persona/.test(ui) || !/not auto-blocked/.test(ui) || /Block all their personas/.test(ui)) throw new Error("BlockPersonasButton copy still promises root-level fan-out");
});

// ---- 5. restart survival on the new schema ----
await check("5. RESTART SURVIVAL: the validator killed with /F comes back on the 006 schema with the same personas, blocks and roster ciphertext (no re-migration, nothing recreated)", async () => {
  const snap = async () => {
    const db = new DatabaseSync(DB, { readOnly: true });
    try {
      return {
        v: db.prepare("SELECT 1 FROM schema_version WHERE version = 6").get() ? 6 : 0,
        personas: db.prepare("SELECT COUNT(*) n FROM personas").get().n,
        blocks: db.prepare("SELECT COUNT(*) n FROM blocks_v2").get().n,
        hasBlocks: hasTable(db, "blocks"),
      };
    } finally { db.close(); }
  };
  const before = await snap();
  const rosterBefore = JSON.stringify((await vapi("GET", "/state/rootRoster")).json?.entries ?? {});
  const pid = execSync(`powershell.exe -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort ${process.env.LAYERS_VALIDATOR_PORT || 4001} -ErrorAction SilentlyContinue).OwningProcess"`, { encoding: "utf8" }).trim().split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) throw new Error("could not find the validator pid on the pinned validator port");
  execSync(`powershell.exe -NoProfile -Command "taskkill /PID ${pid} /F"`, { stdio: "ignore" });
  let back = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { if ((await fetch(VBASE + "/health")).status === 200) { back = true; break; } } catch {}
  }
  if (!back) throw new Error("validator did not come back within 20 s — is it running under npm run validator:supervised?");
  const after = await snap();
  if (after.v !== 6 || after.hasBlocks || after.personas !== before.personas || after.blocks !== before.blocks) throw new Error("schema or rows changed across the restart: " + JSON.stringify({ before, after }));
  const rosterAfter = JSON.stringify((await vapi("GET", "/state/rootRoster")).json?.entries ?? {});
  if (rosterAfter !== rosterBefore) throw new Error("the stored roster changed across the restart");
  const r = await vapi("GET", "/blocked/" + b1.id);
  if (!r.json.personaIds.includes(a1.id)) throw new Error("the persona-level block did not survive the restart");
  const idsB = ((await api(ctxB, "GET", "/api/personas")).json.personas ?? []).map((p) => p.id);
  if (!idsB.includes(b1.id) || !idsB.includes(b2.id)) throw new Error("device B lost its roster across the validator restart");
});

// ---- 6. rollback end to end on a snapshot ----
await check("6. ROLLBACK on a snapshot: the device's roster export feeds migrate-down.js; an incomplete roster is refused; quarantine moves the unattributable personas aside; root_id comes back EXACTLY for every attributable persona and the legacy blocks return; migrating up re-applies 006", async () => {
  const tmp = path.join(os.tmpdir(), "layers-z7-" + stamp);
  mkdirSync(tmp, { recursive: true });
  const copy = path.join(tmp, "snapshot.db");
  const rosterFile = path.join(tmp, "roster.json");
  try {
    const exp = await retry(() => zk("rosterExport"));
    if (exp.status !== 200 || !exp.json?.roster) throw new Error("rosterExport dev action: " + exp.status + " " + JSON.stringify(exp.json).slice(0, 200));
    const roster = exp.json.roster;
    for (const p of [a1, a2, b1, b2]) if (!roster[p.id]) throw new Error("the export lacks a persona this device created: " + p.handle);
    if (!roster[selfPersona]) throw new Error("the export lacks the fixture self persona");
    writeFileSync(rosterFile, JSON.stringify(roster));
    {
      const live = new DatabaseSync(DB, { readOnly: true });
      try { live.exec(`VACUUM INTO '${copy.replace(/\\/g, "/").replace(/'/g, "''")}'`); } finally { live.close(); }
    }
    const c0 = new DatabaseSync(copy, { readOnly: true });
    const personas = c0.prepare("SELECT id FROM personas").all().map((r) => r.id);
    const legacyBlocks = c0.prepare("SELECT COUNT(*) n FROM blocks_legacy_export").get().n;
    c0.close();
    const orphans = personas.filter((id) => !roster[id]);
    const run = (args) => { try { return { code: 0, out: execSync(`node validator/migrate-down.js ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };
    if (orphans.length) {
      const refused = run(`"${rosterFile}" "${copy}"`);
      if (refused.code === 0) throw new Error("migrate-down accepted a roster that lacks " + orphans.length + " persona(s)");
      if (!new RegExp("lacks " + orphans.length + " persona").test(refused.out)) throw new Error("the refusal does not name the count: " + refused.out.slice(0, 300));
      const c1 = new DatabaseSync(copy, { readOnly: true });
      try { if (cols(c1, "personas").includes("root_id") || !c1.prepare("SELECT 1 FROM schema_version WHERE version = 6").get()) throw new Error("a refused rollback changed the snapshot"); } finally { c1.close(); }
    }
    const done = run(`"${rosterFile}" "${copy}" --orphans=quarantine`);
    if (done.code !== 0) throw new Error("migrate-down failed: " + done.out.slice(0, 400));
    const c2 = new DatabaseSync(copy, { readOnly: true });
    try {
      if (c2.prepare("SELECT 1 FROM schema_version WHERE version = 6").get()) throw new Error("migration 006 is still recorded as applied after the rollback");
      if (!cols(c2, "personas").includes("root_id")) throw new Error("root_id did not come back");
      const rows = c2.prepare("SELECT id, root_id FROM personas").all();
      const wrong = rows.filter((r) => roster[r.id] !== r.root_id);
      if (wrong.length) throw new Error("restored root_id differs from the export for " + wrong.length + " persona(s), e.g. " + JSON.stringify(wrong[0]));
      if (rows.length !== personas.length - orphans.length) throw new Error("restored persona count " + rows.length + " != " + (personas.length - orphans.length));
      const q = hasTable(c2, "personas_orphaned_on_rollback") ? c2.prepare("SELECT COUNT(*) n FROM personas_orphaned_on_rollback").get().n : 0;
      if (q !== orphans.length) throw new Error("quarantined " + q + " != orphans " + orphans.length);
      if (c2.prepare("SELECT COUNT(*) n FROM blocks").get().n !== legacyBlocks) throw new Error("root-level blocks did not come back in full");
      if (hasTable(c2, "blocks_v2") || hasTable(c2, "blocks_legacy_export")) throw new Error("post-006 tables survived the rollback");
      for (const p of [a1, b1]) if (!rows.find((r) => r.id === p.id)) throw new Error("a device-created persona was not restored: " + p.handle);
      const fixtureOk = rows.find((r) => r.id === selfPersona)?.root_id === fixture.fids["9152"];
      if (!fixtureOk) throw new Error("the fixture self persona did not return to its pre-006 root");
    } finally { c2.close(); }
    execSync(`node -e "require('./validator/db').openDb(process.argv[1]).close()" "${copy}"`, { stdio: "ignore" });
    const c3 = new DatabaseSync(copy, { readOnly: true });
    try {
      if (!c3.prepare("SELECT 1 FROM schema_version WHERE version = 6").get()) throw new Error("migrating up did not re-apply 006");
      if (cols(c3, "personas").includes("root_id") || hasTable(c3, "blocks") || !hasTable(c3, "blocks_v2")) throw new Error("the re-applied 006 left root material");
      if (c3.prepare("SELECT COUNT(*) n FROM blocks_legacy_export").get().n !== legacyBlocks) throw new Error("the re-applied 006 lost legacy block rows");
    } finally { c3.close(); }
    console.log(`        snapshot: ${personas.length} personas, ${orphans.length} unattributable (quarantined), ${legacyBlocks} legacy root-level blocks restored and re-exported`);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

// ---- 7. greps + docs ----
await check("7. GREPS: no route joins personas to roots; blocks_legacy_export is read only by the migration; the app client has no by-fid/by-root/by-persona-tier read; the docs name the cost, the 410s and the rollback", async () => {
  const strip = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
  const server = strip(readFileSync("validator/server.js", "utf8"));
  if (/personas[^\n]*root_id|root_id[^\n]*personas|JOIN roots|p\.root_id|blocks\b(?!_v2|_legacy)/.test(server)) throw new Error("validator/server.js still joins personas to roots or reads the root-level blocks table");
  for (const f of ["validator/zk.js", "validator/anon.js", "validator/server.js", "validator/poller.js"]) {
    if (existsSync(f) && /blocks_legacy_export/.test(strip(readFileSync(f, "utf8")))) throw new Error(f + " reads blocks_legacy_export");
  }
  const client = strip(readFileSync("lib/validator.ts", "utf8"));
  if (/\/personas\/by-fid|\/personas\/root\/|`\/rep\/\$\{personaId\}|"\/rep\/" \+/.test(client)) throw new Error("lib/validator.ts still calls a removed route");
  if (/by-fid/.test(strip(readFileSync("lib/zk/registration.ts", "utf8")))) throw new Error("zk registration still resolves its root by fid on the validator");
  const posture = readFileSync("SECURITY-POSTURE.md", "utf8");
  if (!/What zk cost us: root-level block fan-out/.test(posture)) throw new Error("SECURITY-POSTURE.md lacks the 'What zk cost us: root-level block fan-out' section");
  const api = readFileSync("validator/API.md", "utf8");
  if (!/410/.test(api) || !/migrate-down/.test(api) || !/persona-level only/.test(api)) throw new Error("validator/API.md does not document the 410s, the rollback and the persona-level block");
  const reads = readFileSync("docs/root-reads.md", "utf8");
  if (!/fixture-roster/.test(reads) || !/rootRoster/.test(reads)) throw new Error("docs/root-reads.md does not name the device roster");
});

await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] !== "PASS");
console.log(`\n${passed}/${results.length} ZK Pass 2 Gate 2 checks passed${failed.length ? ", " + failed.length + " FAILED" : ""}`);
process.exit(failed.length ? 1 : 0);
