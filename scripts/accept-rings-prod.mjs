// PERSONA LAUNCH P4 — RINGS ON THE PRODUCTION SHAPE (npm run test:rings-prod once the verify agent adds the script; run
// it through scripts/run-prod-shape.sh, which starts the public-shaped pair: NODE_ENV=production, ZK_DEV_HOOKS empty,
// LAYERS_REQUIRE_SIG=true). ABORTS unless /api/dev answers 403. Browser devices boot on /device/smoke.html (loopback
// only; a 1 s prefetch cadence) and talk to the production-shaped validator exactly as a visitor's device would.
//
//   1  A FRESH DEVICE WITH NO RINGS, on its first tick: GET /rings/drop and GET /zk/anon-casts, both unsigned, and ONE
//      signed write of its padded "rings" namespace (every device holds one, so its existence says nothing); nothing
//      is ever written to the drop by a device with no ring
//   2  A STRANGER'S RING PUBLISHES DEVICE-SIGNED (D8): a browser device makes a ring with another device's address; its
//      own tick publishes — a PUT /rings/drop/batch carrying the device envelope, rows a multiple of 4, no write token
//      of any kind; the member's tick opens it; an unsigned write is refused by the validator. LP-3: once the member's
//      first write is done, handing out its address sends nothing (no PUT /state/rings at the handover)
//   3  THE /d CARD renders the note in a browser with no device: no root minted (the validator's roots count stands)
//   4  NO WRITE TOKEN ANYWHERE: the env contract names no ring-drop token, the page's device environment carries no
//      token, and the server itself does not answer /api/rings (it holds no keystore)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error(m); };
const get = async (url, init) => { const r = await fetch(url, { cache: "no-store", ...init }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ } return { status: r.status, text, json }; };

console.log("\nPersona launch P4 — rings on the production shape (app " + BASE + ", validator " + VBASE + ")");
const devProbe = await get(BASE + "/api/dev").catch(() => ({ status: 0 }));
if (devProbe.status !== 403) {
  console.log("  ABORT: /api/dev answered " + devProbe.status + " — this suite runs against the PRODUCTION shape (dev hooks off), never the rig");
  process.exit(2);
}
const dropProbe = await get(VBASE + "/rings/drop").catch(() => ({ status: 0 }));
if (dropProbe.status !== 200 || !Array.isArray(dropProbe.json?.rows)) {
  console.log("  ABORT (INFRA): the validator does not serve GET /rings/drop: " + dropProbe.status);
  process.exit(2);
}

const browser = await chromium.launch();
async function device(label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const requests = [];
  page.on("request", (r) => requests.push({ at: Date.now(), method: r.method(), url: r.url(), headers: r.headers() }));
  const d = { label, ctx, page, requests };
  await page.goto(BASE + "/device/smoke.html?validator=" + encodeURIComponent(VBASE), { waitUntil: "load" });
  d.info = await page.evaluate(() => window.__layersDevice.ready);
  d.api = (method, p, body) => page.evaluate(async ({ method, p, body }) => {
    const r = await fetch(p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, json };
  }, { method, p, body });
  d.rings = (fn, ...args) => page.evaluate(async ({ fn, args }) => {
    try { return { ok: true, value: await window.__layersDevice.rings[fn](...args) }; } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  }, { fn, args });
  d.startLoop = () => d.api("POST", "/api/zk", { action: "prefetchStatus", mode: "fixture" });
  d.waitFor = async (pred, ms, what) => {
    const until = Date.now() + ms;
    while (Date.now() < until) { if (await pred()) return; await sleep(250); }
    throw new Error(label + ": " + what + " within " + ms + " ms");
  };
  return d;
}

let A = null, B = null, F = null;
try {
  await check("1. A FRESH DEVICE WITH NO RINGS, on its first tick: GET /rings/drop and GET /zk/anon-casts (unsigned), ONE signed write of its padded 'rings' namespace, and no write to the drop", async () => {
    F = await device("fresh");
    const from = Date.now();
    const s = await F.startLoop();
    assert(s.status === 200, "the device's prefetch status: " + s.status);
    await F.waitFor(async () => F.requests.some((r) => r.at >= from && r.method === "GET" && r.url === VBASE + "/rings/drop") && F.requests.some((r) => r.at >= from && r.method === "GET" && r.url.startsWith(VBASE + "/zk/anon-casts")), 20000, "no drop read and anon-list read on the first tick");
    const drop = F.requests.find((r) => r.at >= from && r.method === "GET" && r.url === VBASE + "/rings/drop");
    assert(!drop.headers["x-layers-device"] && !drop.headers["x-layers-sig"], "the drop read is signed");
    await F.waitFor(async () => F.requests.some((r) => r.method === "PUT" && r.url === VBASE + "/state/rings"), 20000, "the first tick did not write the 'rings' namespace");
    const puts = F.requests.filter((r) => r.method === "PUT" && r.url === VBASE + "/state/rings");
    assert(puts.length === 1 && puts[0].headers["x-layers-sig"], "the namespace write: " + puts.length + " PUTs");
    await sleep(3000);
    assert(F.requests.filter((r) => r.method === "PUT" && r.url === VBASE + "/state/rings").length === 1, "later ticks wrote the namespace again");
    assert(!F.requests.some((r) => r.url.includes("/rings/drop/batch")), "a device with no ring wrote to the drop");
    const st = await F.rings("status");
    assert(st.ok && st.value.lastTickOk === true && st.value.rings.length === 0, "status: " + JSON.stringify(st).slice(0, 200));
  });

  await check("2. A STRANGER'S RING PUBLISHES DEVICE-SIGNED: a browser device rings another's address; its OWN tick publishes one PUT /rings/drop/batch with the device envelope and no token, rows a multiple of 4; the member's tick opens it; an unsigned write is refused", async () => {
    A = await device("owner");
    B = await device("member");
    // PERSONA LAUNCH P4 (LP-3): once the member's device has made its first write (its first tick, spares included),
    // handing out an address sends NOTHING — no PUT /state/rings at the click or in the seconds after
    await B.startLoop();
    await B.waitFor(async () => B.requests.some((r) => r.method === "PUT" && r.url === VBASE + "/state/rings"), 20000, "the member's first tick did not write its 'rings' document");
    const claimFrom = Date.now();
    const addr = await B.rings("createAddress", null);
    assert(addr.ok && /^LR1\./.test(addr.value.address), "address: " + JSON.stringify(addr).slice(0, 200));
    await sleep(3000);
    const atClaim = B.requests.filter((r) => r.at >= claimFrom && r.method === "PUT" && r.url === VBASE + "/state/rings").length;
    assert(atClaim === 0, "handing out an address wrote the member's 'rings' document at the handover (" + atClaim + " PUTs)");
    const pane = await A.api("GET", "/api/rings");
    assert(pane.status === 200, "the owner's pane: " + pane.status + " " + JSON.stringify(pane.json).slice(0, 200));
    const persona = pane.json.admissible[0];
    assert(persona, "the browser device has no public persona to share");
    const ring = await A.api("POST", "/api/rings", { action: "createRing", label: "Close" });
    assert(ring.status === 200, "createRing: " + JSON.stringify(ring.json));
    assert((await A.api("POST", "/api/rings", { action: "addMember", ringId: ring.json.id, address: addr.value.address })).status === 200, "addMember");
    assert((await A.api("POST", "/api/rings", { action: "setDepth", ringId: ring.json.id, personaId: persona.personaId, depth: "posts" })).status === 200, "setDepth");
    const dev = await A.api("POST", "/api/rings", { action: "publishNow" });
    assert(dev.status === 403 || dev.status === 400, "a dev action answered on the production shape: " + dev.status);
    const from = Date.now();
    await A.startLoop();
    await A.waitFor(async () => A.requests.some((r) => r.at >= from && r.method === "PUT" && r.url === VBASE + "/rings/drop/batch"), 30000, "the owner device's tick did not publish");
    const put = A.requests.find((r) => r.at >= from && r.method === "PUT" && r.url === VBASE + "/rings/drop/batch");
    assert(put.headers["x-layers-device"] && put.headers["x-layers-sig"] && put.headers["x-layers-counter"], "the publish carries no device envelope");
    assert(!Object.keys(put.headers).some((h) => /token/i.test(h)), "the publish carries a token header");
    await A.waitFor(async () => (await A.api("GET", "/api/rings")).json?.publish?.lastPublishAt != null, 15000, "the publish was not recorded");
    const g = await get(VBASE + "/rings/drop");
    assert(g.json.count % 4 === 0 && g.json.count >= 4, "the drop holds " + g.json.count);
    assert(g.json.rows.every((r) => Object.keys(r).sort().join() === "ct,enc,expiresHour,hint,id"), "a served row has other fields");
    await B.startLoop();
    await B.waitFor(async () => { const st = await B.rings("status"); return st.ok && st.value.rings.length === 1; }, 20000, "the member did not open the envelope");
    const st = await B.rings("status");
    assert(st.value.rings[0].personas.some((p) => p.handle === persona.handle && p.depth === "posts"), "the member's record: " + JSON.stringify(st.value.rings[0]));
    const unsigned = await fetch(VBASE + "/rings/drop/batch", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: [], deletes: ["ab".repeat(32)] }) });
    assert(unsigned.status === 401, "an unsigned write: " + unsigned.status);
  });

  await check("3. THE /d CARD renders the note in a browser with no device, and mints no root", async () => {
    const ringId = (await A.api("GET", "/api/rings")).json.rings[0].id;
    const made = await A.api("POST", "/api/rings", { action: "makeLink", ringId });
    assert(made.status === 200 && /^\/d#[0-9a-f]{64}$/.test(made.json.link), "makeLink: " + JSON.stringify(made.json));
    const from = Date.now();
    await A.waitFor(async () => A.requests.some((r) => r.at >= from && r.method === "PUT" && r.url === VBASE + "/rings/drop/batch"), 30000, "the link-friend's envelope was not published");
    await A.waitFor(async () => { const p = (await A.api("GET", "/api/rings")).json?.publish; return p && p.lastPublishAt >= from && !p.dirty; }, 15000, "the publish did not settle");
    const roots0 = (await get(VBASE + "/health")).json?.roots;
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const urls = [];
      page.on("request", (r) => urls.push(r.url()));
      await page.goto(BASE + made.json.link, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector("[data-testid='drop-card']")?.getAttribute("data-state") !== "checking", null, { timeout: 30000 });
      const state = await page.getAttribute("[data-testid='drop-card']", "data-state");
      assert(state === "shown", "the card says " + state);
      assert(await page.evaluate(() => typeof window.__layersDevice === "undefined"), "a device booted on /d");
      assert(!urls.some((u) => u.includes(made.json.link.slice(3))), "the key reached a request");
    } finally {
      await ctx.close();
    }
    assert((await get(VBASE + "/health")).json?.roots === roots0, "opening /d minted a root");
  });

  await check("4. NO WRITE TOKEN ANYWHERE: the env contract names no ring-drop token; the public page's device environment carries no token; the server itself answers /api/rings with no rings (it holds no keystore)", async () => {
    const require = createRequire(import.meta.url);
    const contract = require("../validator/env-contract.js");
    const names = [...(contract.MUST_NOT_SHIP ?? [])];
    assert(names.length > 5, "could not read MUST_NOT_SHIP from validator/env-contract.js");
    assert(!names.some((n) => /RING|DROP/.test(n)), "the contract names a ring-drop secret (D8 has none): " + names.filter((n) => /RING|DROP/.test(n)).join(", "));
    const page = await (await browser.newContext()).newPage();
    await page.goto(BASE + "/home", { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__LAYERS_DEVICE_ENV, null, { timeout: 30000 }).catch(() => {});
    const env = await page.evaluate(() => window.__LAYERS_DEVICE_ENV ?? null);
    assert(env && typeof env === "object", "the public page set no device environment");
    assert(!Object.keys(env).some((k) => /TOKEN|SECRET|KEY$/.test(k)), "the device environment carries a secret-looking name: " + Object.keys(env).join(","));
    const server = await get(BASE + "/api/rings");
    assert(server.status !== 200 || !Array.isArray(server.json?.rings) || server.json.rings.length === 0, "the SERVER answered /api/rings with rings: " + server.status);
    void readFileSync;
  });
} finally {
  for (const d of [A, B, F]) await d?.ctx.close().catch(() => {});
  await browser.close();
}
const fails = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} rings production-shape checks passed` + (fails.length ? `, ${fails.length} FAILED` : ""));
process.exitCode = fails.length ? 1 : 0;
