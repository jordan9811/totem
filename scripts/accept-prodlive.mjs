// PROD-LIVE (D-CU-0-4, "a production server renders public state only") — the acceptance suite that would have
// caught the broken public preview. On a PUBLIC deployment (NODE_ENV=production, ZK_DEV_HOOKS unset) the server
// holds no identity: the visitor's identity is the in-browser device, which answers /api/* in the page. Every page
// under app/(main) must therefore render a shell plus client islands that fetch from the device — and the previous
// shape (server components reading identity on the server) printed "Couldn't load … refusing to mint a device key"
// inside an HTTP 200 on most pages, 404'd every detail page, and handed the rig's fixture persona to client panes.
// The deployed smoke passed 8/8 through all of it because it never looked at a rendered page. This suite does.
//
//   BASE_URL=http://localhost:3001 VALIDATOR_URL=http://127.0.0.1:4001 node scripts/accept-prodlive.mjs
//   (defaults: the local production-shaped pair from scripts/run-prod-shape.sh; docs/internal/prodlive-testing.md)
//
// ABORTS (exit 2) unless GET /api/dev answers 403 — i.e. it refuses to run against the rig, where the server holds
// the seeded keystore and every one of these checks would be measuring the wrong thing.
//
// THE ROOT BUDGET. Every full page load of an UNSAVED visitor mints a new root on the validator, and the validator
// caps new roots per address per day (validator/caps.js, default 100). Against Railway that cap is the OWNER's too:
// a careless run locks their own address out for a day. So this suite boots ONE identity (landing → door-app), calls
// window.__layersDevice.persist() so every later full load RESTORES it, verifies each load restored the same root,
// refuses any further full load the moment one did not, and fails if the run minted more than ROOT_BUDGET roots.
// The boot-failure check (8) runs in a second context whose device never boots, so it mints nothing.
//
//   1. landing → door-app → /home: the device boots, the fetch host is installed, the timeline renders cards
//   2. SETTINGS REACHABLE BY CLICKING: nav-settings (desktop), the mobile drawer's drawer-settings, the More menu
//   3. ROUTE WALK: every page under app/(main) (globbed at runtime) plus one of each dynamic detail page, discovered
//      from the list pages' links: status < 400, no inline load error, a non-trivial <main>; one check per page and
//      one aggregate naming every failing page
//  3d. THE DOCS (DOCS UNDER APP, D-DOCS-UNDER-APP): every docs page reachable from /docs/ by its own links answers as
//      a docs page and no link leaves /docs/ (scripts/lib/docs-probe.mjs crawlDocs)
//  3e. the docs in a real browser: hydrated under their policy, client-side nav/sidebar/card link/search, no console
//      error, no violation, no /api/ or device request (probeDocsBrowser; its own context, so no root)
//   4. NO FIXTURE IDENTITY in the chrome on /home and /settings/account (and the mobile drawer)
//   5. ROSTER: the account switcher lists the device's personas; one created in the UI appears without a reload
//  5b. that persona is still there after a full reload of the saved identity
//   6. A WRITE SHOWS UP WITHOUT A RELOAD: a ModePill switch re-renders the timeline in the new mode
//   7. PERSONA-SCOPED PANES (/settings/influence, /settings/identity/fork, /messages) never send persona_viewer_main
//  7b. no page in the route walk sends persona_viewer_main (profile/thread pages exempt: their subject may be seeded)
//   8. BOOT FAILURE IS VISIBLE: device.js unreachable → device-status data-state=failed + device-retry within 30 s
//   9. SOFT NAV: a next/link from /home to /settings keeps the document and the fetch host; a pane loads data
//  10. PERSISTENCE: after persist(), a full reload restores the same root and personas
//  11. ROOT BUDGET: at most ROOT_BUDGET new roots, and the counter is not blind
//  12. RELAYED READS (FC-READ): with the public live-read relay armed, every live thread or profile the walk opens is
//      a visitor-chosen cache MISS against the deployment's Neynar credits (lib/fc/readRelay.server.ts). The walk
//      prefers seed casts and seed authors for its detail pages, keeps at most MAX_LIVE_DISCOVERED live casts as
//      candidates, and this check fails if the run sent more than MAX_RELAYED_THREAD_READS relayed thread reads (or as
//      many profile reads). With the relay unarmed it counts zero and says so.
import { chromium } from "playwright";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIXTURE_DRAWER_NEEDLES,
  FIXTURE_IDENTITY_NEEDLES,
  FIXTURE_SELF_NEEDLES,
  describeHits,
  inlineErrors,
  mainTextLength,
  scanNeedles,
  waitForDevice,
  waitForTimelineCards,
} from "./lib/page-health.mjs";
import { crawlDocs, probeDocsBrowser } from "./lib/docs-probe.mjs";

const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
const ROOT_BUDGET = 3;
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const MIN_MAIN_TEXT = 40;
const LEAK = /persona_viewer_main/;
// FC-READ: the relay's detail reads a run may spend (the design's cap: "no more than 5 relayed thread reads per run")
const MAX_RELAYED_THREAD_READS = 5;
const MAX_LIVE_DISCOVERED = 5;

const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e && e.message ? e.message : String(e)); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, init) => { const r = await fetch(url, { cache: "no-store", ...init }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ } return { status: r.status, text, json }; };
const stamp = Date.now().toString(36).slice(-5);
const short = (u) => { try { const x = new URL(u, BASE); return (x.origin === new URL(BASE).origin ? "" : x.host) + x.pathname + x.search; } catch { return String(u); } };

console.log("\nPROD-LIVE — the public deployment renders the VISITOR, never the server's fixture (app " + BASE + ", validator " + VBASE + ")");

// ---------------------------------------------------------------- preflight: the shape, the validator, the bucket
const dev = await get(BASE + "/api/dev").catch(() => ({ status: 0 }));
if (dev.status !== 403) {
  console.log("  ABORT: /api/dev answered " + dev.status + " — this suite runs against a PUBLIC deployment (dev hooks off), never the rig");
  process.exit(2);
}
const vh = await get(VBASE + "/health").catch(() => ({ status: 0 }));
if (vh.status !== 200) {
  console.log("  ABORT: the validator's /health answered " + vh.status + " at " + VBASE);
  process.exit(2);
}
// A device boot is a burst of a dozen-plus validator calls, and the validator's per-address bucket (300, +5/s) may
// have been emptied by a suite that ran just before. Wait until a small burst is answered cleanly (cu6's lesson: one
// non-429 answer proves one token, not a reserve).
{
  const started = Date.now();
  let ready = false;
  while (Date.now() - started < 240_000) {
    const burst = await Promise.all(Array.from({ length: 8 }, () => get(VBASE + "/zk/members").catch(() => ({ status: 0 }))));
    if (burst.every((r) => r.status !== 429 && r.status !== 0)) { ready = true; break; }
    await sleep(5000);
  }
  if (!ready) {
    console.log("  ABORT: the validator's rate-limit bucket never held a reserve within 240 s");
    process.exit(2);
  }
  console.log("  (validator bucket ready after " + Math.round((Date.now() - started) / 1000) + " s)");
}

// ---------------------------------------------------------------- the browser, and what it spends
const browser = await chromium.launch();

// Every window.fetch call the page makes, recorded at the OUTERMOST layer. On a public deployment the /api/* calls
// never reach the network — the device answers them in the page — so page.on("request") cannot see what persona a
// pane asked about. This init script re-wraps whatever gets assigned to window.fetch (the early bootstrap's queue,
// then the device host), so queued and device-answered calls are recorded too. It records and forwards; it changes
// nothing about the call.
function fetchRecorder() {
  if (window.__prodliveFetchLog) return;
  const log = (window.__prodliveFetchLog = []);
  const wrap = (fn) => {
    if (typeof fn !== "function" || fn.__prodliveWrapped) return fn;
    const wrapped = function (input, init) {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
        const method = (init && init.method) || (input && typeof input === "object" && typeof input.method === "string" ? input.method : "GET");
        let body = init && init.body;
        body = body == null ? "" : typeof body === "string" ? body : body instanceof URLSearchParams ? body.toString() : "[" + Object.prototype.toString.call(body) + "]";
        log.push({ url: String(url), method: String(method).toUpperCase(), body: body.slice(0, 8000), at: Date.now() });
        if (log.length > 4000) log.splice(0, 1000);
      } catch {
        /* recording must never break the page */
      }
      return fn.call(window, input, init);
    };
    wrapped.__prodliveWrapped = true;
    return wrapped;
  };
  let current = wrap(window.fetch);
  try {
    Object.defineProperty(window, "fetch", { configurable: true, enumerable: true, get: () => current, set: (v) => { current = wrap(v); } });
  } catch {
    /* a window whose fetch cannot be redefined is left alone (the leak checks then say they saw no calls) */
  }
}

const loopback = (h) => (["localhost", "127.0.0.1", "[::1]", "::1"].includes(h) ? "loopback" : h);
const serverKey = (u) => { try { const x = new URL(u); return loopback(x.hostname) + ":" + (x.port || (x.protocol === "https:" ? "443" : "80")); } catch { return ""; } };
const validatorServers = new Set([serverKey(VBASE)]);
const newTally = () => ({ anchorsCreated: 0, validatorCalls: 0, rateLimited: 0 });
const main = newTally();
const side = newTally();
function watch(context, tally) {
  context.on("request", (req) => {
    const u = req.url();
    let p = "";
    try { p = new URL(u).pathname; } catch { /* data: etc */ }
    if (/\/device\/auth-anchor$/.test(p)) validatorServers.add(serverKey(u)); // learn the origin the device really uses
    if (validatorServers.has(serverKey(u))) tally.validatorCalls++;
  });
  context.on("response", (res) => {
    let p = "";
    try { p = new URL(res.url()).pathname; } catch { /* data: etc */ }
    // a NEW root is a 201 from the anchor registration (validator/server.js; re-registering answers 200)
    if (res.request().method() === "POST" && /\/device\/auth-anchor$/.test(p) && res.status() === 201) tally.anchorsCreated++;
    if (res.status() === 429) tally.rateLimited++;
  });
}

const ctx = await browser.newContext({ viewport: DESKTOP });
await ctx.addInitScript(fetchRecorder);
watch(ctx, main);
// FC-READ: every relay request this browser sent, by op (POST /api/fc/read is server-only, so it reaches the network
// and page.on/context.on("request") sees its JSON body; the device answers every other /api/* in the page)
const relayed = { total: 0, byOp: {} };
ctx.on("request", (req) => {
  let p = "";
  try { p = new URL(req.url()).pathname; } catch { /* data: etc */ }
  if (p !== "/api/fc/read" || req.method() !== "POST") return;
  let op = "?";
  try { op = String(JSON.parse(req.postData() || "{}").op ?? "?"); } catch { /* not json */ }
  relayed.total++;
  relayed.byOp[op] = (relayed.byOp[op] ?? 0) + 1;
});
const relayedDetail = () => ({ thread: relayed.byOp.thread ?? 0, user: relayed.byOp.user ?? 0 });
const page = await ctx.newPage();
let netLog = [];
let pageErrors = [];
page.on("request", (r) => netLog.push({ url: r.url(), method: r.method(), body: r.postData() || "" }));
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
// PERSONA LAUNCH wave 3 (final verify, diagnostics only — no assertion changed): since UXH-3 a tab that holds an anonymous
// post asks before it unloads (lib/device/entry.ts beforeunload), and Playwright DISMISSES that dialog, which cancels the
// navigation — every later page.goto then times out without committing. One wave-3 run of this suite timed out that way
// from /explore on and never again in three reruns; say which it was if it comes back (a dialog, or a renderer that no
// longer answers), so the failure names its cause instead of a bare goto timeout.
const dialogsSeen = [];
page.on("dialog", (d) => {
  dialogsSeen.push(d.type() + " at " + page.url());
  console.log("   (note) a " + d.type() + " dialog appeared at " + page.url() + " — Playwright dismisses it");
});

// A model of the validator's per-address token bucket (300 of burst, +5/s), fed by the calls this browser actually
// made. Before each full load, wait until the model holds a reserve for one more boot: a walk of sixty-odd pages
// otherwise drains the bucket and the failures it produces would be this suite's, not the product's.
const bucket = { tokens: 150, at: Date.now(), seen: 0 };
let lastLoadCost = 40;
let pacedSeconds = 0;
function syncBucket() {
  const now = Date.now();
  bucket.tokens = Math.min(300, bucket.tokens + ((now - bucket.at) / 1000) * 5);
  bucket.at = now;
  bucket.tokens -= main.validatorCalls - bucket.seen;
  bucket.seen = main.validatorCalls;
}
async function pace() {
  syncBucket();
  const need = Math.max(80, Math.ceil(lastLoadCost * 1.5));
  if (bucket.tokens < need) {
    const wait = Math.min(90, (need - bucket.tokens) / 5);
    pacedSeconds += wait;
    await sleep(wait * 1000);
    syncBucket();
  }
}

let identity = null; // { rootId, anchor, personaIds } of the ONE identity this run boots
let fullLoadsBlocked = null; // the reason further full loads would spend roots, once one did not restore

/** wait until no skeleton / aria-busy is visible in <main>; false when one is still there after maxMs */
async function settle(maxMs = 20_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const busy = await page
      .evaluate(() => {
        const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return [...document.querySelectorAll('main [data-testid*="skeleton"], main [aria-busy="true"]')].some(vis);
      })
      .catch(() => false);
    if (!busy) return true;
    await sleep(500);
  }
  return false;
}

/**
 * A FULL document load of `p` on the persisted identity: pace the validator bucket, load, wait for the device, then
 * network idle + 1.5 s + skeletons cleared. Refuses (throws) once any earlier load failed to restore the identity,
 * and blocks every later one the moment this load does not restore it — each unrestored load is a new root.
 */
async function load(p) {
  if (fullLoadsBlocked) throw new Error("skipped to protect the root budget — " + fullLoadsBlocked);
  if (main.anchorsCreated > 1) {
    fullLoadsBlocked = main.anchorsCreated + " roots already minted by this run (expected 1)";
    throw new Error("skipped to protect the root budget — " + fullLoadsBlocked);
  }
  await pace();
  const before = main.validatorCalls;
  netLog = [];
  pageErrors = [];
  const t0 = Date.now();
  const resp = await page.goto(BASE + p, { waitUntil: "load", timeout: 120_000 });
  const status = resp ? resp.status() : 0;
  const info = await waitForDevice(page, 120_000);
  if (identity && (info.restored !== true || info.rootId !== identity.rootId)) {
    fullLoadsBlocked = `the full load of ${p} did not restore the saved identity (restored=${info.restored}, root ${info.rootId === identity.rootId ? "same" : "DIFFERENT"}) — every further full load would mint a new root against the per-address daily cap`;
    throw new Error(fullLoadsBlocked);
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await sleep(1500);
  const settled = await settle();
  lastLoadCost = Math.max(20, main.validatorCalls - before);
  return { status, info, settled, ms: Date.now() - t0 };
}

/** a same-origin request from inside the page — answered by the device on a public deployment */
const apiInPage = (method, p, body) =>
  page.evaluate(
    async ({ method, p, body }) => {
      const r = await fetch(p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null;
      try { json = await r.json(); } catch { /* not json */ }
      return { status: r.status, json };
    },
    { method, p, body }
  );

/** the device's own personas, as the device answers them: ids (from the device info) and handles (from /api/personas) */
async function own() {
  const ids = await page.evaluate(() => (window.__layersDevice && window.__layersDevice.info ? [...window.__layersDevice.info.personaIds] : []));
  const r = await apiInPage("GET", "/api/personas");
  const personas = Array.isArray(r.json?.personas) ? r.json.personas : [];
  const activeId = typeof r.json?.activeId === "string" ? r.json.activeId : null;
  return { ids, personas, handles: personas.map((x) => x.handle), activeId };
}

async function firstVisible(selectors) {
  for (const s of selectors) {
    for (const l of await page.locator(s).all()) if (await l.isVisible().catch(() => false)) return l;
  }
  return null;
}

const isAppApi = (u) => { try { const x = new URL(u, BASE); return x.origin === new URL(BASE).origin && x.pathname.startsWith("/api/"); } catch { return false; } };
const fetchLog = () => page.evaluate(() => window.__prodliveFetchLog || []).catch(() => []);
function leaksIn(entries) {
  return entries.filter((e) => LEAK.test(e.url) || LEAK.test(e.body || ""));
}

// ---------------------------------------------------------------- 1. landing → door-app → /home
await check("1. landing → door-app → /home: the device boots, the fetch host is installed, the timeline renders cards with no feed-error", async () => {
  await pace();
  const r = await page.goto(BASE + "/", { waitUntil: "load", timeout: 120_000 });
  if (!r || r.status() >= 400) throw new Error("the landing answered " + (r ? r.status() : "nothing"));
  const door = page.getByTestId("door-app");
  await door.first().waitFor({ timeout: 30_000 });
  await door.first().click();
  await page.waitForURL((u) => new URL(u).pathname === "/home", { timeout: 60_000 });
  const info = await waitForDevice(page, 120_000);
  if (!info || !info.rootId || !info.anchor || !Array.isArray(info.personaIds) || info.personaIds.length === 0) throw new Error("the device answered no identity: " + JSON.stringify(info).slice(0, 200));
  const live = await page.evaluate(() => ({
    info: !!(window.__layersDevice && window.__layersDevice.info),
    orig: typeof window.__layersOrigFetch,
    installed: window.__layersDeviceInstalled === true,
    unsaved: !!document.querySelector('[data-testid="identity-unsaved"]'),
  }));
  if (!live.info) throw new Error("window.__layersDevice.info is null after ready");
  if (live.orig !== "function") throw new Error("window.__layersOrigFetch is " + live.orig + " — the early bootstrap never ran");
  if (!live.installed) throw new Error("the device host is not installed (window.__layersDeviceInstalled)");
  identity = { rootId: info.rootId, anchor: info.anchor, personaIds: [...info.personaIds].sort() };
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const cards = await waitForTimelineCards(page, 60_000);
  const errs = await inlineErrors(page);
  if (errs.length) throw new Error("/home: " + errs.join("; "));
  return `root ${info.rootId}, ${info.personaIds.length} persona(s), ${cards} card(s), unsaved notice ${live.unsaved ? "shown" : "not found"}`;
});

// keep this identity on this browser profile: from here on a full load RESTORES it instead of minting a new root
let persistError = null;
if (identity) {
  try {
    await page.evaluate(() => window.__layersDevice.persist());
  } catch (e) {
    persistError = String(e && e.message ? e.message : e).slice(0, 240);
    fullLoadsBlocked = "window.__layersDevice.persist() failed (" + persistError + ")";
  }
} else {
  fullLoadsBlocked = "the device never booted in check 1";
}

// ---------------------------------------------------------------- 10. persistence (run early: it gates every full load)
await check("10. PERSISTENCE: after persist(), a full reload restores the same root and personas (info.restored)", async () => {
  if (persistError) throw new Error("persist() failed: " + persistError);
  if (!identity) throw new Error("skipped — no device identity from check 1");
  const before = main.anchorsCreated;
  const { info } = await load("/home");
  if (info.restored !== true) throw new Error("info.restored is " + info.restored);
  if (info.rootId !== identity.rootId || info.anchor !== identity.anchor) throw new Error("a different root came back");
  const ids = [...info.personaIds].sort();
  if (JSON.stringify(ids) !== JSON.stringify(identity.personaIds)) throw new Error("the personas differ: " + JSON.stringify(ids) + " vs " + JSON.stringify(identity.personaIds));
  if (main.anchorsCreated !== before) throw new Error("the reload registered a NEW anchor");
  if (info.persistent !== true) throw new Error("restored, but not persistent (writes would not be kept)");
  return "restored root " + info.rootId + ", " + ids.length + " persona(s), no new anchor";
});

// ---------------------------------------------------------------- 2. settings reachable by clicking
await check("2. SETTINGS REACHABLE BY CLICKING: nav-settings (desktop) → /settings; the More menu; the mobile drawer's drawer-settings", async () => {
  await load("/home");
  const nav = page.getByTestId("nav-settings");
  if (!(await nav.count())) throw new Error("no data-testid=nav-settings in the chrome");
  await nav.first().click();
  await page.waitForURL((u) => new URL(u).pathname === "/settings", { timeout: 30_000 });
  await page.locator('[data-testid^="settings-link-"]').first().waitFor({ timeout: 30_000 });
  const sections = await page.locator('[data-testid^="settings-link-"]').count();
  if (sections < 5) throw new Error("the settings index rendered " + sections + " section link(s)");
  const errs = await inlineErrors(page);
  if (errs.length) throw new Error("/settings: " + errs.join("; "));

  await load("/home");
  const more = page.getByTestId("nav-more");
  if (!(await more.count())) throw new Error("no data-testid=nav-more (the More button) in the chrome");
  await more.first().click();
  const menu = page.getByTestId("more-menu");
  await menu.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => { throw new Error("nav-more did not open data-testid=more-menu"); });
  for (const id of ["more-settings", "more-device"]) if (!(await page.getByTestId(id).count())) throw new Error("the More menu has no data-testid=" + id);
  await page.mouse.click(4, 450); // outside the menu: close it without navigating

  await page.setViewportSize(MOBILE);
  let drawerDevice = false;
  try {
    await sleep(300);
    const opener = await firstVisible(['[data-testid="drawer-open"]', '[data-testid="mobile-drawer-open"]', 'button[aria-label="Account menu"]']);
    if (!opener) throw new Error("at 390 px nothing visible opens the drawer (button[aria-label=\"Account menu\"])");
    await opener.click();
    const ds = page.getByTestId("drawer-settings");
    await ds.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => { throw new Error("the mobile drawer has no visible data-testid=drawer-settings"); });
    drawerDevice = (await page.getByTestId("drawer-device").count()) > 0;
    await ds.first().click();
    await page.waitForURL((u) => new URL(u).pathname === "/settings", { timeout: 30_000 });
  } finally {
    await page.setViewportSize(DESKTOP);
  }
  return `${sections} settings sections; More → more-settings + more-device; drawer → /settings${drawerDevice ? " (+ drawer-device)" : " (no drawer-device)"}`;
});

// ---------------------------------------------------------------- 9. soft navigation
await check("9. SOFT NAV: a next/link from /home to /settings keeps the document and the fetch host; /settings/account then loads the visitor's personas", async () => {
  await load("/home");
  const mine = await own();
  if (!mine.handles.length) throw new Error("the device's /api/personas named no persona");
  await page.evaluate(() => {
    window.__prodliveMarker = "soft";
    window.__prodliveOrigAtStart = window.__layersOrigFetch;
    window.__prodliveNavAt = Date.now();
  });
  const nav = page.getByTestId("nav-settings");
  if (!(await nav.count())) throw new Error("no data-testid=nav-settings to soft-navigate with");
  await nav.first().click();
  await page.waitForURL((u) => new URL(u).pathname === "/settings", { timeout: 30_000 });
  const link = page.getByTestId("settings-link-account");
  await link.first().waitFor({ timeout: 30_000 });
  await link.first().click();
  await page.waitForURL((u) => new URL(u).pathname === "/settings/account", { timeout: 30_000 });
  const deadline = Date.now() + 30_000;
  let shown = null;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => (document.querySelector("main") ? document.querySelector("main").innerText : ""));
    shown = mine.handles.find((h) => text.includes(h)) ?? null;
    if (shown) break;
    await sleep(500);
  }
  const st = await page.evaluate(() => ({
    marker: window.__prodliveMarker,
    same: typeof window.__layersOrigFetch === "function" && window.__prodliveOrigAtStart === window.__layersOrigFetch,
    installed: window.__layersDeviceInstalled === true,
    api: (window.__prodliveFetchLog || []).filter((e) => e.at >= window.__prodliveNavAt && /\/api\//.test(e.url)).map((e) => e.method + " " + e.url),
  }));
  if (st.marker !== "soft") throw new Error("the navigation was a FULL document load (the window marker is gone) — an unsaved visitor's identity would have been wiped");
  if (!st.same) throw new Error("window.__layersOrigFetch did not stay installed across the soft navigation");
  if (!st.installed) throw new Error("the device host is no longer installed after the soft navigation");
  const errs = await inlineErrors(page);
  if (errs.length) throw new Error("/settings/account: " + errs.join("; "));
  if (!st.api.length) throw new Error("no /api call after the soft navigation — the settings pane loaded nothing from the device");
  if (!shown) throw new Error("/settings/account never showed any of the visitor's handles (" + mine.handles.join(", ") + ") within 30 s");
  return `soft navigation kept the document; ${st.api.length} device call(s); /settings/account shows @${shown}`;
});

// ---------------------------------------------------------------- 4. no fixture identity in the chrome
await check("4. NO FIXTURE IDENTITY: the chrome on /home and /settings/account (and the mobile drawer) names the visitor, never yeak__ / persona_viewer_main / root_viewer / 9152", async () => {
  const problems = [];
  const chromeNeedles = [...FIXTURE_IDENTITY_NEEDLES, ...FIXTURE_SELF_NEEDLES];
  for (const p of ["/home", "/settings/account"]) {
    await load(p);
    const mine = await own();
    // wait for the chrome to name the visitor (the roster is the device's answer, read after boot)
    const deadline = Date.now() + 30_000;
    let tintId = null;
    let switcherText = "";
    while (Date.now() < deadline) {
      tintId = await page.locator('[data-testid="persona-tint-root"]').first().getAttribute("data-persona-id", { timeout: 1000 }).catch(() => null);
      switcherText = await page.locator('[data-testid="account-switcher-button"]').first().innerText({ timeout: 1000 }).catch(() => "");
      if (tintId && mine.ids.includes(tintId) && mine.handles.some((h) => switcherText.includes(h))) break;
      await sleep(500);
    }
    if (!tintId || !mine.ids.includes(tintId)) problems.push(`${p}: persona-tint-root data-persona-id=${JSON.stringify(tintId)} is not one of the device's personas ${JSON.stringify(mine.ids)}`);
    if (!mine.handles.some((h) => switcherText.includes(h))) problems.push(`${p}: the account switcher button never named the visitor (it shows ${JSON.stringify(switcherText.replace(/\s+/g, " ").trim().slice(0, 80))})`);
    const chrome = await page.evaluate(() => {
      const parts = [];
      const root = document.querySelector('[data-testid="persona-tint-root"]');
      // the tint root WRAPS the page, so only its own attributes are chrome — its content includes seeded posts
      if (root) parts.push(["persona-tint-root attributes", [...root.attributes].map((a) => a.name + "=" + a.value).join(" ")]);
      document.querySelectorAll('[data-chrome="rail-left"]').forEach((el) => parts.push(["LeftRail", el.outerHTML]));
      document.querySelectorAll('[data-testid="persona-pill"]').forEach((el) => parts.push(["persona-pill", el.outerHTML]));
      document.querySelectorAll('button[aria-label="Account menu"]').forEach((el) => parts.push(["mobile header", (el.parentElement || el).outerHTML]));
      document.querySelectorAll('[data-testid="mobile-header"]').forEach((el) => parts.push(["mobile header", el.outerHTML]));
      document.querySelectorAll('[data-testid="header-active-persona"]').forEach((el) => parts.push(["header-active-persona", el.outerHTML]));
      return {
        parts,
        handleAttr: root ? root.getAttribute("data-persona-handle") : null,
        headerIds: [...document.querySelectorAll('[data-testid="header-active-persona"]')].map((e) => e.getAttribute("data-persona-id")),
        profileHref: document.querySelector('[data-testid="nav-item"][data-slot="profile"]')?.getAttribute("href") ?? null,
        main: document.querySelector("main") ? document.querySelector("main").innerText : "",
      };
    });
    if (!chrome.parts.some((x) => x[0] === "LeftRail")) problems.push(`${p}: no LeftRail ([data-chrome="rail-left"]) to inspect`);
    for (const [where, html] of chrome.parts) {
      const hits = scanNeedles(html, chromeNeedles);
      if (hits.length) problems.push(`${p} ${where}: ${describeHits(hits)}`);
    }
    if (chrome.handleAttr && !mine.handles.includes(chrome.handleAttr)) problems.push(`${p}: persona-tint-root data-persona-handle=${JSON.stringify(chrome.handleAttr)} is not one of the visitor's handles`);
    for (const id of chrome.headerIds) if (!mine.ids.includes(id)) problems.push(`${p}: header-active-persona names ${JSON.stringify(id)}, not one of the device's personas`);
    if (chrome.profileHref && !mine.handles.some((h) => chrome.profileHref === "/" + h)) problems.push(`${p}: the Profile nav item links to ${chrome.profileHref}, not the visitor's own profile`);
    if (p === "/settings/account") {
      // the account page IS the identity surface: its content, not only its chrome, must be the visitor's
      const hits = scanNeedles(chrome.main, chromeNeedles);
      if (hits.length) problems.push(`${p} <main>: ${describeHits(hits)}`);
    }
  }
  // the mobile drawer (390 px on /home): the persona card at its top is chrome too
  await load("/home");
  await page.setViewportSize(MOBILE);
  try {
    await sleep(300);
    const opener = await firstVisible(['[data-testid="drawer-open"]', '[data-testid="mobile-drawer-open"]', 'button[aria-label="Account menu"]']);
    if (!opener) problems.push("/home at 390 px: nothing visible opens the mobile drawer");
    else {
      await opener.click();
      await sleep(500);
      const drawer = await page.evaluate(() => {
        const inner = document.querySelector('[data-testid="drawer-settings"]') || document.querySelector('[data-testid="mobile-drawer"]');
        const box = inner ? inner.closest('[data-testid="mobile-drawer"]') || inner.closest(".fixed") : document.querySelector(".fixed.inset-0");
        return box ? box.outerHTML : null;
      });
      if (!drawer) problems.push("/home at 390 px: the drawer did not open");
      else {
        const hits = scanNeedles(drawer, [...chromeNeedles, ...FIXTURE_DRAWER_NEEDLES]);
        if (hits.length) problems.push(`mobile drawer: ${describeHits(hits)}`);
      }
      await page.keyboard.press("Escape").catch(() => {});
    }
  } finally {
    await page.setViewportSize(DESKTOP);
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return "tint root, rail, pills, mobile header and drawer all name the visitor";
});

// ---------------------------------------------------------------- 5. the roster
async function openSwitcherRows() {
  const sw = page.getByTestId("account-switcher");
  if (!(await sw.first().isVisible().catch(() => false))) {
    const btn = page.getByTestId("account-switcher-button");
    if (!(await btn.count())) throw new Error("no data-testid=account-switcher-button in the chrome");
    await btn.first().click();
    await sw.first().waitFor({ state: "visible", timeout: 10_000 });
  }
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="account-switcher"] [data-testid^="persona-row-"]')].map((el) => ({
      handle: el.getAttribute("data-testid").slice("persona-row-".length),
      text: (el.innerText || "").replace(/\s+/g, " ").trim(),
    }))
  );
}
const closeSwitcher = () => page.mouse.click(4, 450); // a mousedown outside closes it; x=4 is page margin at 1440 px
let createdHandle = null;

await check("5. ROSTER: the account switcher lists the device's personas (You, You, privately); a persona created in the UI appears without a reload", async () => {
  await load("/home");
  const mine = await own();
  const names = mine.personas.map((x) => x.name);
  if (mine.personas.length !== identity.personaIds.length) throw new Error(`/api/personas lists ${mine.personas.length} persona(s), the device holds ${identity.personaIds.length}`);
  if (!names.includes("You") || !names.includes("You, privately")) throw new Error("a fresh identity's roster should be \"You\" + \"You, privately\"; the device answers " + JSON.stringify(names));
  let rows = await openSwitcherRows();
  const missing = mine.handles.filter((h) => !rows.some((r) => r.handle === h));
  if (missing.length) throw new Error("the account switcher lacks the device's persona(s) " + missing.join(", ") + " (rows: " + JSON.stringify(rows.map((r) => r.handle)) + ")");
  if (rows.length !== mine.handles.length) throw new Error(`the account switcher lists ${rows.length} row(s) for ${mine.handles.length} persona(s): ${JSON.stringify(rows.map((r) => r.handle))}`);
  for (const n of ["You", "You, privately"]) if (!rows.some((r) => r.text.includes(n))) throw new Error("no switcher row shows the name " + JSON.stringify(n));

  const handle = "pl_" + stamp;
  const name = "Prodlive " + stamp;
  let via = "the account switcher's Create persona";
  await page.evaluate(() => { window.__prodliveMarker = "roster"; });
  if ((await page.getByTestId("create-persona-button").count()) && (await page.getByTestId("create-persona-button").first().isVisible().catch(() => false))) {
    await page.getByTestId("create-persona-button").first().click();
    await page.getByTestId("persona-name-input").first().fill(name);
    await page.getByTestId("persona-handle-input").first().fill(handle);
    await page.getByTestId("persona-create-submit").first().click();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const errText = await page.locator('[data-testid="account-switcher"]').getByText(/could not create/i).first().innerText({ timeout: 500 }).catch(() => "");
      if (errText) throw new Error("the switcher refused to create the persona: " + errText);
      if (!(await page.getByTestId("account-switcher").first().isVisible().catch(() => false))) break;
      await sleep(300);
    }
  } else {
    // the UI's create path is not where it was: create through the page's own fetch (the device answers it)
    via = "POST /api/personas from the page (no create-persona-button in the switcher)";
    await closeSwitcher();
    const r = await apiInPage("POST", "/api/personas", { name, handle });
    if (r.status >= 400) throw new Error("POST /api/personas answered " + r.status + " " + JSON.stringify(r.json).slice(0, 160));
  }
  // WITHOUT a reload: Providers.refresh() refetches the roster from the device
  const deadline = Date.now() + 30_000;
  let appeared = false;
  while (Date.now() < deadline) {
    rows = await openSwitcherRows().catch(() => []);
    if (rows.some((r) => r.handle === handle)) { appeared = true; break; }
    await closeSwitcher();
    await sleep(1000);
  }
  await closeSwitcher();
  const marker = await page.evaluate(() => window.__prodliveMarker);
  if (!appeared) throw new Error(`@${handle} (created via ${via}) is not in the switcher 30 s later, without a reload`);
  if (marker !== "roster") throw new Error("the roster only updated through a full document load");
  createdHandle = handle;
  return `${mine.handles.length} persona(s) listed; @${handle} created via ${via} and shown without a reload`;
});

// a persona the visitor made on a SAVED identity is theirs across reloads — losing it would be silent data loss
await check("5b. the persona created in check 5 is still in the switcher after a full reload of the saved identity", async () => {
  if (!createdHandle) throw new Error("skipped — check 5 created no persona");
  await load("/home");
  const deadline = Date.now() + 15_000;
  let rows = [];
  while (Date.now() < deadline) {
    rows = await openSwitcherRows().catch(() => []);
    await closeSwitcher();
    if (rows.some((r) => r.handle === createdHandle)) return `@${createdHandle} restored with ${rows.length} persona(s)`;
    await sleep(1000);
  }
  throw new Error(`@${createdHandle} is gone after a full reload (rows: ${JSON.stringify(rows.map((r) => r.handle))})`);
});

// ---------------------------------------------------------------- 6. a write shows up without a reload
await check("6. A WRITE SHOWS UP WITHOUT A RELOAD: a ModePill switch re-renders the timeline in the new mode (router.refresh → the island refetches)", async () => {
  await load("/home");
  await waitForTimelineCards(page, 60_000);
  const tl = page.getByTestId("seeded-timeline");
  await tl.first().waitFor({ timeout: 30_000 });
  const read = async () => ({
    id: await tl.first().getAttribute("data-mode-id", { timeout: 1000 }).catch(() => null),
    name: await tl.first().getAttribute("data-mode", { timeout: 1000 }).catch(() => null),
  });
  const before = await read();
  if (!before.id) throw new Error("the timeline names no mode (data-mode-id)");
  const slug = (s) => "mode-option-" + String(s).toLowerCase().replace(/\s+/g, "-");
  const pick = async (optionId) => {
    await page.getByTestId("mode-pill").first().click();
    const menu = page.getByTestId("mode-menu");
    await menu.first().waitFor({ state: "visible", timeout: 10_000 });
    const options = await menu.first().locator('[data-testid^="mode-option-"]').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-testid"), text: e.innerText })));
    const target = optionId ? options.find((o) => o.id === optionId) : options.find((o) => o.id !== slug(before.name) && !/switches persona/i.test(o.text));
    if (!target) throw new Error("the mode menu offers no other mode of this persona: " + JSON.stringify(options.map((o) => o.id)));
    await menu.first().getByTestId(target.id).click();
    return target;
  };
  await page.evaluate(() => { window.__prodliveMarker = "mode"; });
  const target = await pick(null);
  const deadline = Date.now() + 30_000;
  let after = before;
  while (Date.now() < deadline) {
    after = await read();
    if (after.id && after.id !== before.id && slug(after.name) === target.id) break;
    await sleep(500);
  }
  if (!(after.id && after.id !== before.id && slug(after.name) === target.id)) {
    throw new Error(`30 s after switching to ${target.id} the timeline still renders ${JSON.stringify(after)} (was ${JSON.stringify(before)}) — the island did not refetch after router.refresh()`);
  }
  const marker = await page.evaluate(() => window.__prodliveMarker);
  if (marker !== "mode") throw new Error("the new mode only showed through a full document load");
  const errs = await inlineErrors(page);
  if (errs.length) throw new Error("/home after the switch: " + errs.join("; "));
  // put the mode back so the walk below renders the default (best effort; the check has already passed or failed)
  await pick(slug(before.name)).catch(() => {});
  await sleep(1500);
  return `${before.name} → ${after.name} with no reload`;
});

// ---------------------------------------------------------------- 7. persona-scoped panes
await check("7. PERSONA-SCOPED PANES act on the visitor: /settings/influence, /settings/identity/fork and /messages never send persona_viewer_main", async () => {
  const problems = [];
  const notes = [];
  for (const p of ["/settings/influence", "/settings/identity/fork", "/messages"]) {
    let res;
    try {
      res = await load(p);
    } catch (e) {
      problems.push(`${p}: ${e.message}`);
      continue;
    }
    const mine = await own();
    const inPage = await fetchLog();
    // every call the page made: device-answered ones (the recorder) and network ones (page.on("request"))
    const all = [...inPage.map((e) => ({ src: "fetch", ...e })), ...netLog.map((e) => ({ src: "network", ...e }))];
    const leaks = leaksIn(all);
    // the pane's OWN calls: every /api call minus ONE of each the chrome makes on any page (Providers' roster and
    // acting persona, the preview banner's label) — so a pane that also reads /api/personas still counts
    const chromeOnce = new Set(["GET /api/personas", "GET /api/persona/chrome", "POST /api/zk"]);
    const api = inPage.filter((e) => {
      if (!isAppApi(e.url)) return false;
      const sig = e.method + " " + new URL(e.url, BASE).pathname;
      if (chromeOnce.has(sig)) { chromeOnce.delete(sig); return false; }
      return true;
    });
    const namedOwn = api.filter((e) => mine.ids.some((id) => e.url.includes(id) || (e.body || "").includes(id))).length;
    if (res.status >= 400) problems.push(`${p}: HTTP ${res.status}`);
    if (leaks.length) problems.push(`${p} sent persona_viewer_main: ` + leaks.slice(0, 3).map((e) => `${e.src} ${e.method} ${short(e.url)}${LEAK.test(e.body || "") ? " (in the body)" : ""}`).join(", "));
    if (!api.length) problems.push(`${p}: the pane made no /api call of its own (beyond the chrome's roster) — it loaded nothing from the device, so "no leak" would be vacuous`);
    const errs = await inlineErrors(page);
    if (errs.length) problems.push(`${p}: ${errs.join("; ")}`);
    notes.push(`${p}: ${api.length} pane call(s), ${namedOwn} naming the visitor's persona`);
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return notes.join("; ");
});

// ---------------------------------------------------------------- 3. the route walk
function staticRoutes() {
  const root = fileURLToPath(new URL("../app/(main)/", import.meta.url));
  const out = [];
  const walkDir = (dir, segs) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walkDir(p, [...segs, e]);
      else if (/^page\.(tsx|ts|jsx|js)$/.test(e)) {
        if (segs.some((s) => s.startsWith("[") || s.startsWith("@") || s.startsWith("_"))) continue; // dynamic: discovered below
        out.push("/" + segs.filter((s) => !/^\(.*\)$/.test(s)).join("/"));
      }
    }
  };
  walkDir(root, []);
  return [...new Set(out)].sort((a, b) => (a === "/home" ? -1 : b === "/home" ? 1 : a.localeCompare(b)));
}

const routes = staticRoutes();
const topLevel = new Set(routes.map((r) => r.split("/")[1]).filter(Boolean));
const pageFailures = [];
const leakPages = [];
let walked = 0;
const found = { channel: null, folders: [], room: null, intent: null, algo: null, algoVia: null, casts: [] };

function discover(hrefs, casts) {
  for (const h of hrefs) {
    if (!h || !h.startsWith("/")) continue;
    const clean = h.split(/[?#]/)[0];
    if (!found.channel && /^\/channels\/[^/]+$/.test(clean)) found.channel = clean;
    if (/^\/folders\/[^/]+$/.test(clean) && !found.folders.includes(clean) && found.folders.length < 3) found.folders.push(clean);
    if (!found.room && /^\/rooms\/[^/]+$/.test(clean)) found.room = clean;
    if (!found.intent && /^\/market\/(?!advertiser$|measurement$|reads$)[^/]+$/.test(clean)) found.intent = clean;
    if (!found.algo && /^\/algo\/[^/]+$/.test(clean)) { found.algo = clean; found.algoVia = "a folder page's link"; }
  }
  // FC-READ: live (relayed) casts are kept only up to MAX_LIVE_DISCOVERED — each one the walk opens is a relayed miss
  for (const c of casts) {
    if (!c.hash || !c.authors.length || found.casts.length >= 40) continue;
    if (c.live && found.casts.filter((x) => x.live).length >= MAX_LIVE_DISCOVERED) continue;
    if (!found.casts.some((x) => x.hash === c.hash)) found.casts.push(c);
  }
}

async function walkOne(route, { label = "", exemptLeak = false } = {}) {
  walked++;
  await check("3. route " + route + (label ? " (" + label + ")" : ""), async () => {
    const rl0 = main.rateLimited;
    try {
      const res = await load(route);
      const problems = [];
      if (!(res.status > 0 && res.status < 400)) problems.push("HTTP " + res.status);
      if (!res.settled) problems.push("still loading 20 s after network idle (a skeleton or aria-busy never cleared)");
      problems.push(...(await inlineErrors(page)));
      const len = await mainTextLength(page);
      if (len < MIN_MAIN_TEXT) problems.push(`<main> has only ${len} character(s) of text`);
      const seen = await page.evaluate(() => ({
        hrefs: [...document.querySelectorAll("main a[href]")].map((a) => a.getAttribute("href")),
        casts: [...document.querySelectorAll('main article[data-testid="cast"]')].map((a) => ({
          hash: a.getAttribute("data-hash"),
          // FC-READ: a network cast read through the public relay (CastCard data-live) — opening it costs a relayed read
          live: a.hasAttribute("data-live") && a.getAttribute("data-live") !== "false",
          authors: [...a.querySelectorAll("a[href]")].map((x) => x.getAttribute("href")).filter((h) => /^\/[A-Za-z0-9_.-]+$/.test(h || "")),
        })),
      }));
      discover(seen.hrefs, seen.casts.map((c) => ({ ...c, authors: c.authors.filter((h) => !topLevel.has(h.slice(1))) })));
      const leaks = leaksIn([...(await fetchLog()), ...netLog]);
      if (leaks.length && exemptLeak) console.log("   (note) " + route + " named persona_viewer_main — exempt: this page's subject may be a seeded persona");
      if (leaks.length && !exemptLeak) leakPages.push(route + ": " + leaks.slice(0, 2).map((e) => (e.method || "") + " " + short(e.url)).join(", "));
      if (problems.length) {
        const rl = main.rateLimited - rl0;
        if (pageErrors.length) problems.push("pageerror: " + pageErrors.slice(0, 2).join(" ~ "));
        throw new Error(problems.join("; ") + (rl ? ` [${rl} rate-limited (429) answer(s) during this page — possibly the bucket, not the product]` : ""));
      }
      return `${res.status}, ${len} chars, ${(res.ms / 1000).toFixed(1)} s`;
    } catch (e) {
      // final verify (diagnostics only): a goto that never committed — was it a dismissed dialog or a hung renderer?
      if (/page\.goto: Timeout/.test(e.message)) {
        const alive = await Promise.race([page.evaluate(() => document.readyState + " " + location.pathname).catch((x) => "evaluate failed: " + x.message.split("\n")[0]), sleep(5000).then(() => "the renderer did not answer within 5 s")]);
        e.message += ` [diagnosis: page ${alive}; dialogs so far: ${dialogsSeen.length ? dialogsSeen.slice(-3).join(", ") : "none"}]`;
      }
      pageFailures.push(route + (label ? " (" + label + ")" : "") + ": " + e.message);
      throw e;
    }
  });
}
function notDiscovered(kind, where) {
  walked++;
  const msg = `no ${kind} link was found on ${where} — the list page rendered none, so its detail page could not be walked`;
  pageFailures.push(kind + ": " + msg);
  fail("3. route " + kind + " (not discovered)", msg);
}

for (const r of routes) await walkOne(r);

// the dynamic detail pages, discovered from what the list pages rendered
if (found.channel) await walkOne(found.channel, { label: "a channel" }); else notDiscovered("/channels/<id>", "/channels");
if (found.folders.length) {
  await walkOne(found.folders[0], { label: "a folder" });
  // an algo card lives in a folder; look in up to two more folders before asking the device for one
  for (const f of found.folders.slice(1)) {
    if (found.algo) break;
    await walkOne(f, { label: "another folder, looking for an algo card" });
  }
} else notDiscovered("/folders/<id>", "/folders");
if (!found.algo && !fullLoadsBlocked) {
  const r = await apiInPage("GET", "/api/algo").catch(() => null);
  const id = r?.json?.cards?.[0]?.id;
  if (id) { found.algo = "/algo/" + id; found.algoVia = "the device's GET /api/algo (no folder linked one)"; }
}
if (found.algo) await walkOne(found.algo, { label: "an algo card, via " + found.algoVia }); else notDiscovered("/algo/<id>", "the walked folder pages or GET /api/algo");
if (found.room) await walkOne(found.room, { label: "a room" }); else notDiscovered("/rooms/<id>", "/rooms");
if (found.intent) await walkOne(found.intent, { label: "a market intent" });
{
  let mine = null;
  try { mine = fullLoadsBlocked ? null : await own(); } catch { mine = null; }
  const ownHandle = mine ? (mine.personas.find((x) => x.id === mine.activeId) ?? mine.personas[0])?.handle : null;
  if (ownHandle) await walkOne("/" + ownHandle, { label: "the visitor's own profile" });
  else notDiscovered("/<own handle>", "the device's GET /api/personas");
  const ownHandles = new Set(mine ? mine.handles : []);
  // FC-READ: seed casts and seed authors first — a live one is walked only when the timelines showed nothing else, and
  // only while the run is under the relayed-read cap (each is a visitor-chosen miss against the deployment's credits)
  const ordered = [...found.casts.filter((c) => !c.live), ...found.casts.filter((c) => c.live)];
  const authors = ordered.flatMap((c) => c.authors.map((a) => ({ handle: a.slice(1), live: !!c.live })));
  const seededAuthor = authors.find((a) => !ownHandles.has(a.handle) && a.handle !== "yeak__") ?? authors.find((a) => !ownHandles.has(a.handle)) ?? null;
  const underCap = (kind) => relayedDetail()[kind] < MAX_RELAYED_THREAD_READS;
  if (seededAuthor && (!seededAuthor.live || underCap("user"))) await walkOne("/" + seededAuthor.handle, { label: seededAuthor.live ? "a live profile (no seed author was shown)" : "a seeded profile", exemptLeak: true });
  else notDiscovered("/<seeded handle>", "the walked timelines' cast author links" + (seededAuthor ? " (only live authors, and the relayed-read cap is spent)" : ""));
  const cast = ordered.find((c) => c.authors.length && c.hash && (!c.live || underCap("thread")));
  if (cast) await walkOne(`${cast.authors[0]}/status/${cast.hash}`, { label: cast.live ? "a live cast thread (no seed cast was shown)" : "a cast thread", exemptLeak: true });
  else notDiscovered("/<handle>/status/<hash>", "the walked timelines");
}

await check(`3. ROUTE WALK: every page under app/(main) renders without an inline load error (${walked} pages)`, async () => {
  // one line (the sweep tooling greps "^  FAIL "), every failing page named — never only the first
  if (pageFailures.length) throw new Error(pageFailures.length + " page(s) failing: " + pageFailures.join(" | "));
  return walked + " pages clean";
});
await check("7b. no page in the route walk sent persona_viewer_main (the seeded-profile and thread pages are exempt)", async () => {
  if (leakPages.length) throw new Error(leakPages.join(" | "));
  return walked + " pages scanned";
});

// ---------------------------------------------------------------- 3d. the route walk's docs leg (DOCS UNDER APP)
// D-DOCS-UNDER-APP: the public deployment now serves the docs itself at /docs (app/docs/[[...slug]]/route.ts), outside
// app/(main), so the glob above never sees them. They get their own walk: every page reachable from /docs/ by the
// links the pages print (resolved as a browser resolves them, so a relative raw-HTML link is checked under the base)
// answers as a docs page and no link leaves /docs/; then a real browser walks the nav, the sidebar, a card link and
// the search through the client router with no console error and no policy violation. Each leg runs in a context of
// its own (scripts/lib/docs-probe.mjs): the docs boot no device, so they cost no root — the leg asserts no request
// reached /api/ or /device/ at all.
await check("3d. ROUTE WALK, the docs at /docs: every page reachable from /docs/ answers as a docs page, no link leaves /docs/", async () => crawlDocs(BASE));
await check("3e. ROUTE WALK, the docs in a real browser: /docs/ hydrates under its policy; nav, sidebar, a card link and search work client-side; no console error, no violation, no /api/ or device request", async () => probeDocsBrowser(browser, BASE));

// ---------------------------------------------------------------- 8. boot failure is visible (a second context: it mints nothing)
await check("8. BOOT FAILURE IS VISIBLE: with /device/device.js unreachable, /home shows device-status data-state=failed and device-retry within 30 s", async () => {
  const ctx2 = await browser.newContext({ viewport: DESKTOP });
  watch(ctx2, side);
  let aborted = 0;
  await ctx2.route(/\/device\/device\.js(\?|$)/, (route) => {
    aborted++;
    return route.abort();
  });
  try {
    const p2 = await ctx2.newPage();
    const r = await p2.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
    const t0 = Date.now();
    const failed = p2.locator('[data-testid="device-status"][data-state="failed"]');
    try {
      await failed.first().waitFor({ state: "visible", timeout: 30_000 });
    } catch {
      const st = await p2.locator('[data-testid="device-status"]').first().getAttribute("data-state", { timeout: 1000 }).catch(() => null);
      throw new Error(`device-status never showed data-state="failed" within 30 s (it is ${st === null ? "absent" : JSON.stringify(st)}) — a visitor would watch a spinner forever`);
    }
    const retry = p2.getByTestId("device-retry");
    await retry.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => { throw new Error("device-status failed, but there is no visible data-testid=device-retry"); });
    if (!aborted) throw new Error("no request for /device/device.js was seen — the failure shown is not the one this check injected");
    const booted = await p2.evaluate(() => !!(window.__layersDevice && window.__layersDevice.info));
    if (booted) throw new Error("a device booted anyway");
    return `HTTP ${r ? r.status() : "?"}, failed state after ${((Date.now() - t0) / 1000).toFixed(1)} s, retry offered`;
  } finally {
    await ctx2.close();
  }
});

// ---------------------------------------------------------------- 11. the root budget
await check(`11. ROOT BUDGET: the run minted at most ${ROOT_BUDGET} new roots on the validator (its per-address daily cap is the owner's too)`, async () => {
  const total = main.anchorsCreated + side.anchorsCreated;
  if (identity && main.anchorsCreated === 0) throw new Error("the counter saw no anchor creation (201 on /device/auth-anchor) although a fresh identity booted — it is blind, so the budget is unmeasured");
  if (total > ROOT_BUDGET) throw new Error(`${total} new roots (main ${main.anchorsCreated}, boot-failure context ${side.anchorsCreated})`);
  return `${total} new root(s); ${main.validatorCalls} validator call(s), ${main.rateLimited} rate-limited answer(s), ${Math.round(pacedSeconds)} s paced`;
});

// ---------------------------------------------------------------- 12. relayed reads (FC-READ)
await check(`12. RELAYED READS: the walk sent at most ${MAX_RELAYED_THREAD_READS} relayed thread reads and ${MAX_RELAYED_THREAD_READS} relayed profile reads (each is a miss against the deployment's Neynar credits)`, async () => {
  const hint = await page.evaluate(() => (window.__LAYERS_DEVICE_ENV ? window.__LAYERS_DEVICE_ENV.FC_READ_RELAY ?? "" : null)).catch(() => null);
  const d = relayedDetail();
  const ops = Object.entries(relayed.byOp).map(([k, v]) => k + "×" + v).join(", ") || "none";
  if (d.thread > MAX_RELAYED_THREAD_READS) throw new Error(`${d.thread} relayed thread reads (${ops})`);
  if (d.user > MAX_RELAYED_THREAD_READS) throw new Error(`${d.user} relayed profile reads (${ops})`);
  // not blind: an armed relay means the timelines themselves read through it, so the counter must have seen them
  if (hint === null) return `${relayed.total} relay request(s) (${ops}); the page's device env was not readable, so arming is unknown`;
  if (hint === "on" && relayed.total === 0) throw new Error("the device env says the relay is armed, but no POST /api/fc/read was seen — the counter is blind");
  if (hint !== "on" && relayed.total > 0) throw new Error(`the device env does not arm the relay, yet the page sent ${relayed.total} relay request(s) (${ops})`);
  return hint === "on" ? `relay armed: ${relayed.total} relay request(s) (${ops})` : "relay not armed on this deployment: 0 relayed reads";
});

// ---------------------------------------------------------------- 13. no channel tabs (D-FCREAD-NO-CHANNELS-IN-V1)
// The owner's decision: channels are not an emphasis in v1. On a public deployment the home tab bar carries For You
// and Following only, and a channel-shaped ?tab= falls back to For You — so no live discovery ever shows under a
// channel's label. Runs on the persisted identity (check 10), so these full loads restore rather than mint a root.
await check("13. NO CHANNEL TABS: the public /home shows only For You and Following, and ?tab=<channel> falls back to For You", async () => {
  const problems = [];
  const seen = [];
  for (const q of ["/home", "/home?tab=crypto", "/home?tab=art"]) {
    await page.goto(BASE + q, { waitUntil: "load", timeout: 120_000 });
    await waitForDevice(page, 120_000);
    await page.locator('a[data-testid="tab-foryou"]').first().waitFor({ timeout: 30_000 }).catch(() => {});
    const tabs = await page.$$eval('a[data-testid^="tab-"]', (els) => els.map((e) => ({ id: e.getAttribute("data-testid"), active: !!e.querySelector(".bg-x-blue") })));
    // precondition: the tab bar rendered at all — an absent bar would pass "no channel tab" by construction
    if (!tabs.some((t) => t.id === "tab-foryou") || !tabs.some((t) => t.id === "tab-following")) {
      problems.push(`${q}: the home tab bar did not render For You and Following (${JSON.stringify(tabs.map((t) => t.id))})`);
      continue;
    }
    const extra = tabs.filter((t) => t.id !== "tab-foryou" && t.id !== "tab-following").map((t) => t.id);
    if (extra.length) problems.push(`${q}: channel tab(s) on a public deployment: ${extra.join(", ")}`);
    const active = tabs.filter((t) => t.active).map((t) => t.id);
    if (active.length !== 1 || active[0] !== "tab-foryou") problems.push(`${q}: the active tab is ${JSON.stringify(active)}, not For You`);
    seen.push(q);
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return `${seen.length} load(s): only For You + Following, For You active`;
});

await ctx.close();
await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} prod-live checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
