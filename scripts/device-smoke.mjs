// BROWSER KEYSTORE PASS Gate 1 stage 3 — THE DEVICE SMOKE. Two independent browser contexts each boot the browser
// device (public/device/smoke.html) against a validator, through the page's own fetch, with a production-shaped
// environment (no dev hooks). Asks the questions the readiness audit asked, of the browser-hosted device:
//   1. two contexts boot two devices: distinct anchors, distinct roots
//   2. two persona rosters with nothing in common; two distinct active personas
//   3. two distinct zk identity commitments
//   4. a cast by A is in A's feed and not in B's
//   5. a private post by A is readable by A and invisible to B
//   6. the validator gained two anchors and holds ONLY ciphertext under them — no cast text, no private text, no
//      persona id of either device in any plain row
//   7. a dev action from the device is refused (no dev hooks in the device environment)
//   8. a server-only route (/api/health) falls through the patch to the Next server
//   9. "keep on this device" survives a reload (IndexedDB, wrapped); the unsaved device does not
import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://127.0.0.1:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }
const stamp = Date.now().toString(36).slice(-5);

function dbRows() {
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const anchors = db.prepare("SELECT pubkey FROM device_auth").all().map((r) => r.pubkey);
    const state = db.prepare("SELECT anchor, namespace, key, value FROM adapter_state").all();
    const everything = [];
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) {
      for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) everything.push({ t, s: JSON.stringify(row) });
    }
    return { anchors, state, everything };
  } finally { db.close(); }
}

console.log("\nDevice smoke: two browser contexts, two devices, one validator (" + VBASE + ")");
const before = dbRows();
const browser = await chromium.launch();
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();

async function boot(ctx, label) {
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("   [" + label + " console] " + m.text().slice(0, 200)); });
  page.on("pageerror", (e) => console.log("   [" + label + " pageerror] " + String(e).slice(0, 200)));
  await page.goto(BASE + "/device/smoke.html?validator=" + encodeURIComponent(VBASE), { waitUntil: "load" });
  const info = await page.evaluate(() => window.__layersDevice.ready);
  return { page, info };
}
const api = (page, method, path, body, headers) =>
  page.evaluate(async ({ method, path, body, headers }) => {
    const r = await fetch(path, { method, headers: { "content-type": "application/json", ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, json };
  }, { method, path, body, headers });

let A = null, B = null;
await check("1. two contexts boot two devices: distinct anchors, distinct roots", async () => {
  A = await boot(ctxA, "A");
  B = await boot(ctxB, "B");
  for (const [l, d] of [["A", A], ["B", B]]) {
    if (!d.info || !/^root_/.test(d.info.rootId || "")) throw new Error(l + " did not boot: " + JSON.stringify(d.info).slice(0, 200));
    if (!/^[0-9a-f]{64}$/.test(d.info.anchor || "")) throw new Error(l + " has no anchor");
  }
  if (A.info.anchor === B.info.anchor) throw new Error("the two devices share an anchor");
  if (A.info.rootId === B.info.rootId) throw new Error("the two devices share a root");
  console.log("        A root " + A.info.rootId + " (fid " + A.info.fid + "), B root " + B.info.rootId + " (fid " + B.info.fid + ")");
});

await check("2. two persona rosters with nothing in common; two distinct active personas", async () => {
  const a = await api(A.page, "GET", "/api/personas");
  const b = await api(B.page, "GET", "/api/personas");
  if (a.status !== 200 || b.status !== 200) throw new Error("personas: " + a.status + "/" + b.status);
  const ia = (a.json.personas || []).map((p) => p.id), ib = (b.json.personas || []).map((p) => p.id);
  if (!ia.length || !ib.length) throw new Error("an empty roster: " + JSON.stringify([ia, ib]));
  if (ia.some((id) => ib.includes(id))) throw new Error("a persona id appears in both rosters");
  if (!a.json.activeId || a.json.activeId === b.json.activeId) throw new Error("active personas not distinct: " + a.json.activeId + " / " + b.json.activeId);
  if (ia.includes("persona_viewer_main") || ib.includes("persona_viewer_main")) throw new Error("a device carries the rig's seeded viewer");
});

await check("3. two distinct zk identity commitments", async () => {
  const a = await api(A.page, "GET", "/api/zk?mode=fixture");
  const b = await api(B.page, "GET", "/api/zk?mode=fixture");
  if (a.status !== 200 || b.status !== 200) throw new Error("zk status: " + a.status + "/" + b.status + " " + JSON.stringify(a.json).slice(0, 160));
  const find = (o) => { const s = JSON.stringify(o); const m = s.match(/"commitment":"([0-9a-fx]+)"/); return m ? m[1] : null; };
  const ca = find(a.json), cb = find(b.json);
  if (!ca || !cb) throw new Error("no commitment in the zk status: " + JSON.stringify(a.json).slice(0, 200));
  if (ca === cb) throw new Error("the two devices share a commitment");
});

const castText = "device smoke cast " + stamp + " from A";
await check("4. a cast by A is in A's feed and not in B's", async () => {
  const r = await api(A.page, "POST", "/api/actions/cast", { text: castText });
  if (![200, 201].includes(r.status)) throw new Error("cast: " + r.status + " " + JSON.stringify(r.json).slice(0, 160));
  const fa = await api(A.page, "GET", "/api/feed?tab=following");
  const fb = await api(B.page, "GET", "/api/feed?tab=following");
  const fa2 = await api(A.page, "GET", "/api/feed");
  const fb2 = await api(B.page, "GET", "/api/feed");
  const inA = JSON.stringify(fa.json).includes(castText) || JSON.stringify(fa2.json).includes(castText);
  const inB = JSON.stringify(fb.json).includes(castText) || JSON.stringify(fb2.json).includes(castText);
  if (!inA) throw new Error("A's own cast is not in A's feed (" + fa.status + "/" + fa2.status + ")");
  if (inB) throw new Error("A's cast is in B's feed");
});

const privateText = "device smoke private " + stamp + " canary";
/** the device mints a public and a private persona; private posts are authored as the private one */
const asPrivate = async (d) => {
  const priv = d.info.personaIds[1];
  const r = await api(d.page, "POST", "/api/seed-persona", { personaId: priv });
  if (r.status !== 200) throw new Error("switch to the private persona: " + r.status + " " + JSON.stringify(r.json).slice(0, 120));
  return priv;
};
await check("5. a private post by A is readable by A and invisible to B", async () => {
  await asPrivate(A);
  const r = await api(A.page, "POST", "/api/private/posts", { text: privateText });
  if (![200, 201].includes(r.status)) throw new Error("private post: " + r.status + " " + JSON.stringify(r.json).slice(0, 160));
  const a = await api(A.page, "GET", "/api/private/posts");
  await asPrivate(B);
  const b = await api(B.page, "GET", "/api/private/posts");
  if (!JSON.stringify(a.json).includes(privateText)) throw new Error("A cannot read its own private post (" + a.status + ")");
  if (JSON.stringify(b.json).includes(privateText)) throw new Error("B can read A's private post");
});

await check("6. the validator gained two anchors and holds only ciphertext under them", async () => {
  const after = dbRows();
  const fresh = after.anchors.filter((a) => !before.anchors.includes(a));
  if (!fresh.includes(A.info.anchor) || !fresh.includes(B.info.anchor)) throw new Error("the devices' anchors are not new rows: " + fresh.length + " new");
  const mine = after.state.filter((r) => r.anchor === A.info.anchor || r.anchor === B.info.anchor);
  if (!mine.length) throw new Error("no state under the device anchors");
  for (const r of mine) {
    let v; try { v = JSON.parse(r.value); } catch { throw new Error("unparseable state row " + r.namespace + "/" + r.key); }
    if (!(v && typeof v.ct === "string" && typeof v.nonce === "string")) throw new Error("plaintext state row " + r.namespace + "/" + r.key);
  }
  // values are ciphertext everywhere; addresses are either the whole-record marker or an opaque id (the shape the
  // crypto and zk passes reviewed: A-CU-3-VAULT-ADDRESSES-STAY-OPAQUE-IDS) — never a persona id, never content
  // no row anywhere names what the devices wrote or who wrote it: the texts, the persona ids, the handles
  const handles = [...(await api(A.page, "GET", "/api/personas")).json.personas, ...(await api(B.page, "GET", "/api/personas")).json.personas].map((x) => x.handle).filter(Boolean);
  const needles = [castText, privateText, ...A.info.personaIds, ...B.info.personaIds, ...handles];
  for (const row of after.everything) for (const n of needles) if (row.s.includes(n)) throw new Error(row.t + " row carries " + String(n).slice(0, 24) + "…");
  // and every ADDRESS is the whole-record marker or an opaque id — never content, a handle or a persona id
  for (const r of mine) {
    if (r.key === "__whole" || r.key === "_") continue;
    if (!/^(0x[a-z0-9]{6,}|[a-z]+_[a-z0-9_]{6,})$/i.test(r.key)) throw new Error("a non-opaque address under a device anchor: " + r.namespace + "/" + r.key);
  }
  console.log("        " + mine.length + " sealed rows under the two device anchors: " + [...new Set(mine.map((r) => r.namespace))].join(", "));
});

await check("7. a dev action from the device is refused (no dev hooks in the device environment)", async () => {
  const r = await api(A.page, "POST", "/api/dev", { action: "viewAs", personaId: B.info.activePersonaId });
  if (r.status !== 403 && r.status !== 404) throw new Error("viewAs answered " + r.status);
  const g = await api(A.page, "GET", "/api/dev");
  if (g.status !== 403 && g.status !== 404) throw new Error("dev registry answered " + g.status);
});

await check("8. a server-only route falls through the patch to the Next server", async () => {
  const r = await api(A.page, "GET", "/api/health");
  if (r.status !== 200 || !r.json || typeof r.json.commit !== "string") throw new Error("/api/health: " + r.status + " " + JSON.stringify(r.json).slice(0, 120));
});

await check("9. keep-on-this-device survives a reload; the unsaved device does not", async () => {
  await A.page.evaluate(() => window.__layersDevice.persist());
  const pathsA = await A.page.evaluate(() => window.__layersDevice.paths());
  if (!pathsA.some((p) => p.endsWith("root.json"))) throw new Error("A holds no root.json in storage: " + JSON.stringify(pathsA));
  await A.page.reload({ waitUntil: "load" });
  const a2 = await A.page.evaluate(() => window.__layersDevice.ready);
  if (!a2.restored || a2.rootId !== A.info.rootId || a2.anchor !== A.info.anchor) throw new Error("A did not come back: " + JSON.stringify(a2).slice(0, 200));
  if (JSON.stringify(a2.personaIds) !== JSON.stringify(A.info.personaIds)) throw new Error("A's personas changed across the reload: " + JSON.stringify(a2.personaIds));
  await asPrivate({ page: A.page, info: a2 }); // the jar is memory: the reload forgot which persona was active
  const pa = await api(A.page, "GET", "/api/private/posts");
  if (!JSON.stringify(pa.json).includes(privateText)) {
    const rows = dbRows().state.filter((r) => r.anchor === a2.anchor && r.namespace === "privatePosts");
    throw new Error("A's private post did not survive the reload (the vault did not re-decrypt): status " + pa.status + ", " + (pa.json?.posts?.length ?? "?") + " posts visible, " + rows.length + " privatePosts rows on the validator under A's anchor; body " + JSON.stringify(pa.json).slice(0, 200));
  }
  await B.page.reload({ waitUntil: "load" });
  const b2 = await B.page.evaluate(() => window.__layersDevice.ready);
  if (b2.restored || b2.rootId === B.info.rootId) throw new Error("B (unsaved) came back as the same root: " + JSON.stringify(b2).slice(0, 160));
  await A.page.evaluate(() => window.__layersDevice.wipe());
});

await check("10. LEAKS: no key material of either device appears on the server side", async () => {
  const needlesA = await A.page.evaluate(() => window.__layersDevice.needles());
  const needlesB = await B.page.evaluate(() => window.__layersDevice.needles());
  const all = [...new Set([...needlesA, ...needlesB])];
  if (all.length < 4) throw new Error("the devices reported only " + all.length + " needles — the grep would be vacuous");
  const haystacks = [];
  const { readFileSync: rf, existsSync: ex } = await import("node:fs");
  for (const f of [DB_PATH, process.env.TEMP + "/layers-validator.log", process.env.TEMP + "/layers-app.log"]) {
    if (f && ex(f)) haystacks.push([f, rf(f, "latin1")]);
  }
  if (haystacks.length < 2) throw new Error("only " + haystacks.length + " haystack(s) available — the grep would be weak");
  let i = 0;
  for (const n of all) {
    i++;
    for (const [name, hay] of haystacks) if (hay.includes(n)) throw new Error("needle #" + i + " (" + n.length + " chars) appears in " + name);
  }
  console.log("        " + all.length + " needles (seed, vault key, device-auth, persona and device keys) absent from " + haystacks.length + " server-side haystacks");
});

await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} device smoke checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
