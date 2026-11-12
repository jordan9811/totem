// POST-DEPLOY PASS Gate 1 — PERSONA CLONING.
//
//   1. START FROM: a clone inherits the source's settings — its modes, its rules, its folders — and the response
//      reports what was copied rather than promising it.
//   2. INDEPENDENT, NOT SHARED: editing the clone's mode does not touch the source's. The copy is of artifacts, so
//      two personas that start identical can diverge; a reference would have made "start from" a shared setting.
//   3. THE CLONE JOINS THE ROSTER: it is one of yours — listed, and therefore pickable. A persona the session
//      cannot see did not really get created, which is what the fork route used to do.
//   4. FOLLOWS ARE THE ROOT'S: the clone reports the follow count it SHARES rather than a count it copied, because
//      in this codebase a follow is the device's and every persona reads the same set.
//   5. OWNER-SIDE ONLY: nothing about the clone reaches the validator in the clear — not the relation, not the
//      pair, not the source's name.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const stamp = Date.now().toString(36).slice(-5);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the rig injects synthetic adapter failures on purpose (2% per call), so every WRITE this suite depends on is
// retried — a 503 from the injector is not a product failure and must not read as one
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
function dbText() {
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

console.log("\nPost-deploy Gate 1 — persona cloning (app " + BASE + ")");

const roster0 = (await api("GET", "/api/personas")).json?.personas ?? [];
if (!roster0.length) { console.log("  ABORT: the viewer holds no persona"); process.exit(2); }
const SOURCE = roster0[0];

// give the source something worth inheriting
let sourceMode = null;
await check("0. SETUP: the source persona has a mode and a rule of its own to inherit", async () => {
  // act AS the source first: with no cookie the write routes fall back to the seeded active persona, which on this
  // rig is a different persona that happens to share the handle
  const sw0 = await api("POST", "/api/seed-persona", { personaId: SOURCE.id });
  if (sw0.status !== 200) throw new Error("could not act as the source: " + sw0.status + " " + JSON.stringify(sw0.json).slice(0, 120));
  const made = await retry(() => api("POST", "/api/modes", { name: "pd1-source-" + stamp, ranking: { recency: 0.7, affinity: 0.2, quality: 0.1 }, notificationPolicy: "mentions_only" }));
  if (made.status !== 200 || !made.json?.mode) throw new Error("could not create a mode: " + made.status + " " + JSON.stringify(made.json).slice(0, 140));
  sourceMode = made.json.mode;
  // POST-DEPLOY Gate 2 found this the hard way: the mode was being created for the SEEDED DEFAULT persona on a
  // cold process, not for the one this suite had just switched to, and the failure only surfaced two checks later
  // as "the clone copied zero modes". Assert the attribution AT THE MOMENT OF THE WRITE — a write that lands on a
  // different persona than the caller asked for is the Gate 1 bug, and it should fail where it happens.
  if (sourceMode.personaId && sourceMode.personaId !== SOURCE.id)
    throw new Error("the mode was created for " + sourceMode.personaId + ", not the persona we switched to (" + SOURCE.id + ")");
  const rule = await retry(() => api("POST", "/api/rules", { name: "pd1-rule-" + stamp, action: "hide", root: { op: "and", conditions: [{ field: "text", cmp: "contains", value: "pd1" + stamp }] } }));
  if (rule.status !== 200) throw new Error("could not create a rule: " + rule.status);
  return "mode " + sourceMode.name + ", one rule";
});

let clone = null;
await check("1. START FROM: cloning copies the source's settings and reports exactly what it copied", async () => {
  const r = await api("POST", "/api/identity/fork", {
    fromPersona: SOURCE.id, // by ID: the handle can resolve to a different persona that happens to share it
    carry: [],
    newHandle: "pd1_" + stamp,
    newName: "PD1 " + stamp,
    startFrom: true,
    copy: { settings: true, folders: true },
  });
  if (![200, 201].includes(r.status) || !r.json?.newPersona) throw new Error("clone refused: " + r.status + " " + JSON.stringify(r.json).slice(0, 160));
  clone = r.json;
  if (!clone.clone) throw new Error("the response carries no clone report");
  if (clone.clone.error) throw new Error("the copy failed: " + clone.clone.error);
  if (!(clone.clone.modes >= 1)) throw new Error("no mode was copied: " + JSON.stringify(clone.clone));
  if (!(clone.clone.rules >= 1)) throw new Error("no rule was copied: " + JSON.stringify(clone.clone));
  return "modes " + clone.clone.modes + ", rules " + clone.clone.rules + ", folders " + clone.clone.folders;
});

await check("2. INDEPENDENT, NOT SHARED: the copied mode is a NEW artifact — renaming the clone's leaves the source's untouched", async () => {
  const sw = await api("POST", "/api/seed-persona", { personaId: clone.newPersona });
  if (sw.status !== 200) throw new Error("could not act as the clone: " + sw.status + " " + JSON.stringify(sw.json).slice(0, 120));
  const mine = (await api("GET", "/api/modes")).json?.modes ?? [];
  const copied = mine.find((m) => m.name === sourceMode.name && m.id !== sourceMode.id);
  if (!copied) throw new Error("the clone holds no copy of the source's mode: " + JSON.stringify(mine.map((m) => m.name)));
  if (copied.id === sourceMode.id) throw new Error("the clone REFERENCES the source's mode rather than copying it");
  const renamed = await retry(() => api("PATCH", "/api/modes", { modeId: copied.id, patch: { name: "pd1-renamed-" + stamp } }));
  if (renamed.status !== 200) throw new Error("could not edit the clone's mode: " + renamed.status);
  const back = await api("POST", "/api/seed-persona", { personaId: SOURCE.id });
  if (back.status !== 200) throw new Error("could not switch back to the source: " + back.status);
  const sourceModes = (await api("GET", "/api/modes")).json?.modes ?? [];
  const still = sourceModes.find((m) => m.id === sourceMode.id);
  if (!still) throw new Error("the source's mode disappeared");
  if (still.name !== sourceMode.name) throw new Error("editing the clone's mode changed the source's: " + still.name);
  return "clone's copy renamed, source still " + still.name;
});

await check("3. THE CLONE JOINS THE ROSTER: it is listed as one of this root's personas", async () => {
  const after = (await api("GET", "/api/personas")).json?.personas ?? [];
  if (!after.some((p) => p.id === clone.newPersona)) throw new Error("the clone is not in the roster: " + JSON.stringify(after.map((p) => p.handle)));
  if (after.length <= roster0.length) throw new Error("the roster did not grow: " + roster0.length + " → " + after.length);
  return roster0.length + " → " + after.length + " personas";
});

await check("4. FOLLOWS ARE THE ROOT'S: the report names a SHARED follow count, never a copied one", async () => {
  if (typeof clone.clone.followsShared !== "number") throw new Error("no shared-follow count in the report: " + JSON.stringify(clone.clone));
  if ("follows" in clone.clone) throw new Error("the report claims to have copied follows, which this codebase cannot do per persona");
  return clone.clone.followsShared + " follows shared by every persona of this root";
});

await check("5. OWNER-SIDE ONLY: no validator row pairs the clone with its source, by id or by handle", async () => {
  const rows = dbText();
  const pair = rows.filter(([, s]) => s.includes(clone.newPersona) && (s.includes(SOURCE.id) || s.includes(SOURCE.handle)));
  if (pair.length) throw new Error("a validator row pairs the clone with its source: " + pair[0][0] + " " + pair[0][1].slice(0, 120));
  const named = rows.filter(([, s]) => s.includes(clone.newHandle));
  if (named.length) throw new Error("the clone's handle is in a validator row in the clear: " + named[0][0]);
  return rows.length + " rows scanned";
});

const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} Gate 1 checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
