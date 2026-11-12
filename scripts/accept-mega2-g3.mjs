// MEGA PASS 2 — Gate 3 acceptance (fixture): SCROLL ZONES + CONFIGURABLE ACTION BUTTONS.
//   1. PARITY: under the Default mode the per-cast action row is IDENTICAL in structure to the pre-Gate-3 baseline
//      (scripts/fixtures/action-row-baseline.html — tags, attributes, inline SVG paths) — bindable, unchanged
//   2. BINDINGS PERSIST PER MODE: a rebinding lands on the mode and renders; another mode keeps its own row (the
//      seeded Curate row differs); back on Default the X row is exactly what it was; duplicate / unknown refused
//   3. LONG-PRESS opens the binding picker on that slot; picking rebinds the slot through the mode
//   4. CALIBRATION saves and reloads per device: a preset, then a DRAWN change (drag a handle) — both come back;
//      the hit-test overlay says what a point scrolls
//   5. EDGE-BAND overlap is refused with the edge named (API and pane); a zero inset admits it
//   6. READING LAYOUT: a wheel in the center band scrolls the article in place while the timeline stays; a wheel in
//      the outer band scrolls the timeline while the article stays; a synthetic touch drag does the same
//   7. ZONES ARE VAULT DATA: the namespace is ciphertext on the validator; no zone plaintext in its database
//   8. NO ZONES, NO ROUTER: under the default layout the shell attaches nothing and a wheel scrolls the timeline
// Mobile behaviour is UNMEASURED (Playwright's synthetic wheel/touch); real-device tuning is required.
// Fixture, pinned ports, no network, no spend.
import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const X_ROW = ["reply", "recast", "like", "views", "bookmark", "share"];
const VIEWPORT = { width: 1280, height: 900 };
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

await assertServersUp(BASE);
async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? JSON.stringify(r.json)?.slice(0, 200))); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const reset = () => retry(() => dev("resetSeed"));
const modes = async () => (await retry(() => api("GET", "/api/modes"))).json;
const patchMode = (modeId, patch) => api("PATCH", "/api/modes", { modeId, patch });
const activate = (modeId) => retry(() => api("POST", "/api/modes/active", { modeId }));
const zones = async () => (await retry(() => api("GET", "/api/zones"))).json;
const savePreset = (layout) => retry(() => api("POST", "/api/zones", { action: "preset", layout, viewport: { w: VIEWPORT.width, h: VIEWPORT.height } }));
const normalize = (html) => html.replace(/<span hidden data-testid="cast-stake"[^>]*><\/span>/g, "").replace(/>[^<]+</g, "><").replace(/\s+/g, " ").trim();
const rowOf = async (page) => page.locator("[data-testid='cast']").first().locator("[data-testid^='action-']").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("action-", "")).filter((a) => a !== "notice" && a !== "binding-picker"));
const firstRowHtml = async (page) => page.locator("[data-testid='cast']").first().locator("[data-testid='action-reply']").first().evaluate((el) => el.parentElement.outerHTML);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
const home = async () => { await page.goto(BASE + "/home", { waitUntil: "networkidle" }); await page.locator("[data-testid='cast']").first().waitFor({ timeout: 15000 }); };

await reset();
let DEFAULT_ID = null;
let CURATE_ID = null;
let baseline = null;

try {
  await check("1. PARITY: under Default the per-cast action row is identical in structure to the pre-Gate-3 baseline", async () => {
    const fixture = "scripts/fixtures/action-row-baseline.html";
    if (!existsSync(fixture)) throw new Error("no baseline fixture — run scripts/capture-action-row.mjs against the pre-Gate-3 build");
    baseline = readFileSync(fixture, "utf8").trim();
    const m = await modes();
    DEFAULT_ID = m.modes.find((x) => x.name === "Default")?.id;
    CURATE_ID = m.modes.find((x) => x.name === "Curate")?.id;
    if (!DEFAULT_ID || !CURATE_ID) throw new Error("presets missing: " + JSON.stringify(m.modes.map((x) => x.name)));
    if (m.activeId !== DEFAULT_ID) await activate(DEFAULT_ID);
    await home();
    const row = await rowOf(page);
    if (row.join() !== X_ROW.join()) throw new Error("Default row is not X's: " + row.join());
    const html = normalize(await firstRowHtml(page));
    if (html !== baseline) throw new Error(`the Default row's structure differs from the baseline (${html.length} vs ${baseline.length} chars)`);
    if (await page.locator("[data-testid='action-binding-picker']").count()) throw new Error("a binding picker is open with nothing pressed");
  });

  await check("2. BINDINGS PERSIST PER MODE: a rebinding renders; Curate keeps its own seeded row; back on Default the X row is exactly what it was; duplicate / unknown refused", async () => {
    const slotsOf = async (id) => (await modes()).modes.find((x) => x.id === id).actionButtonSlots;
    const cur = await slotsOf(CURATE_ID);
    if (!Array.isArray(cur.cast) || !cur.cast.includes("stake-as")) throw new Error("Curate's seeded cast row is missing: " + JSON.stringify(cur));
    const def = await slotsOf(DEFAULT_ID);
    const custom = ["reply", "recast", "like", "views", "bookmark-to-folder", "share"];
    const r = await patchMode(DEFAULT_ID, { actionButtonSlots: { ...def, cast: custom } });
    if (r.status !== 200) throw new Error("rebinding refused: " + JSON.stringify(r.json));
    if ((await slotsOf(DEFAULT_ID)).cast.join() !== custom.join()) throw new Error("the rebinding did not persist on the mode");
    await home();
    if ((await rowOf(page)).join() !== custom.join()) throw new Error("the card does not render the bound row: " + (await rowOf(page)).join());
    await activate(CURATE_ID);
    await home();
    const curRow = await rowOf(page);
    if (!curRow.includes("stake-as") || !curRow.includes("bookmark-to-folder")) throw new Error("Curate's row did not render: " + curRow.join());
    await activate(DEFAULT_ID);
    await home();
    if ((await rowOf(page)).join() !== custom.join()) throw new Error("Default's binding did not survive the mode switch");
    const dup = await patchMode(DEFAULT_ID, { actionButtonSlots: { ...def, cast: ["like", "like", "reply"] } });
    if (dup.status !== 400 || !/already bound/.test(dup.json?.error ?? "")) throw new Error("a duplicate binding was not refused by name: " + JSON.stringify(dup.json));
    const unk = await patchMode(DEFAULT_ID, { actionButtonSlots: { ...def, cast: ["reply", "teleport"] } });
    if (unk.status !== 400 || !/unknown action/.test(unk.json?.error ?? "")) throw new Error("an unknown action was not refused by name: " + JSON.stringify(unk.json));
    // back to X's row: the baseline holds again
    await retry(() => patchMode(DEFAULT_ID, { actionButtonSlots: { ...def, cast: X_ROW } }));
    await home();
    if (normalize(await firstRowHtml(page)) !== baseline) throw new Error("after restoring X's row the structure differs from the baseline");
  });

  await check("3. LONG-PRESS opens the binding picker on that slot; picking rebinds the slot through the mode", async () => {
    await home();
    const like = page.locator("[data-testid='cast']").first().locator("[data-testid='action-like']");
    const box = await like.boundingBox();
    await page.mouse.move(box.x + 12, box.y + box.height / 2);
    await page.mouse.down();
    await sleep(750);
    await page.mouse.up();
    const picker = page.locator("[data-testid='action-binding-picker']");
    await picker.waitFor({ timeout: 5000 });
    if ((await picker.getAttribute("data-slot")) !== "2") throw new Error("the picker opened on slot " + (await picker.getAttribute("data-slot")) + ", expected 2");
    await picker.locator("[data-testid='bind-stake-as']").click();
    let row = [];
    for (let i = 0; i < 20; i++) { row = (await modes()).modes.find((x) => x.id === DEFAULT_ID).actionButtonSlots.cast ?? []; if (row[2] === "stake-as") break; await sleep(300); }
    if (row[2] !== "stake-as") throw new Error("the picker's choice did not land on the mode: " + row.join());
    await home();
    if ((await rowOf(page))[2] !== "stake-as") throw new Error("the rebound slot does not render: " + (await rowOf(page)).join());
    const def = (await modes()).modes.find((x) => x.id === DEFAULT_ID).actionButtonSlots;
    await retry(() => patchMode(DEFAULT_ID, { actionButtonSlots: { ...def, cast: X_ROW } }));
  });

  await check("4. CALIBRATION saves and reloads per device: a preset, then a drawn change (drag a handle); the hit-test overlay says what a point scrolls", async () => {
    const before = await zones();
    if (before.saved) throw new Error("a fresh device already has a saved layout");
    const p = await savePreset("reading");
    if (p.json.config.layout !== "reading" || p.json.config.zones.length !== 1) throw new Error("preset did not save: " + JSON.stringify(p.json));
    const after = await zones();
    if (!after.saved || after.config.layout !== "reading" || !/^[0-9a-f]{8}$/.test(after.device)) throw new Error("the saved layout did not reload for this device: " + JSON.stringify(after).slice(0, 200));
    await page.goto(BASE + "/settings/zones", { waitUntil: "networkidle" });
    const state = page.locator("[data-testid='zones-state']");
    await state.waitFor({ timeout: 10000 });
    if ((await state.getAttribute("data-saved")) !== "1" || (await state.getAttribute("data-layout")) !== "reading") throw new Error("the pane does not show the saved layout");
    const zone = page.locator("[data-testid='zone-reading-center']");
    const w0 = Number(await zone.getAttribute("data-w"));
    const preview = await page.locator("[data-testid='zones-preview']").boundingBox();
    // the overlay: the center reads the article, the left margin scrolls the timeline
    await page.mouse.move(preview.x + preview.width / 2, preview.y + preview.height / 2);
    await page.locator("[data-testid='zones-hit']").waitFor({ timeout: 5000 });
    if ((await page.locator("[data-testid='zones-hit']").getAttribute("data-target")) !== "longform") throw new Error("the overlay does not say the center reads the article");
    await page.mouse.move(preview.x + 6, preview.y + preview.height / 2);
    await sleep(100);
    if ((await page.locator("[data-testid='zones-hit']").getAttribute("data-target")) !== "timeline") throw new Error("the overlay does not say the margin scrolls the timeline");
    // DRAW: drag the south-east handle 30 px right and down
    const se = await page.locator("[data-testid='zone-reading-center-se']").boundingBox();
    await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
    await page.mouse.down();
    await page.mouse.move(se.x + se.width / 2 + 30, se.y + se.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    const w1 = Number(await zone.getAttribute("data-w"));
    if (!(w1 > w0)) throw new Error(`dragging the handle did not resize the zone (${w0} → ${w1})`);
    await page.locator("[data-testid='zones-save']").click();
    await page.locator("[data-testid='zones-notice']").waitFor({ timeout: 8000 });
    const saved = await zones();
    if (saved.config.layout !== "custom" || !(saved.config.zones[0].rect.w > w0)) throw new Error("the drawn zone did not save: " + JSON.stringify(saved.config));
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("[data-testid='zones-state']").waitFor({ timeout: 10000 });
    if (Number(await page.locator("[data-testid='zone-reading-center']").getAttribute("data-w")) !== saved.config.zones[0].rect.w) throw new Error("the drawn zone did not reload");
  });

  await check("5. EDGE-BAND overlap is refused with the edge named (API and pane); a zero inset admits it", async () => {
    const bad = { layout: "custom", insetPx: 20, viewport: { w: 1280, h: 900 }, zones: [{ id: "reading-center", target: "longform", rect: { x: 0, y: 15, w: 60, h: 70 } }], savedAt: 0 };
    const r = await api("POST", "/api/zones", { action: "save", config: bad });
    if (r.status !== 422 || r.json?.code !== "edge") throw new Error("an edge overlap was not refused as edge: " + r.status + " " + JSON.stringify(r.json));
    if (!r.json.violations?.some((v) => v.edge === "left") || !/edge-gesture/.test(r.json.error)) throw new Error("the refusal does not name the edge: " + JSON.stringify(r.json));
    const still = await zones();
    if (still.config.zones[0].rect.x === 0) throw new Error("the refused config landed anyway");
    const zero = await api("POST", "/api/zones", { action: "save", config: { ...bad, insetPx: 0 } });
    if (zero.status !== 200) throw new Error("a zero inset did not admit the same zone: " + JSON.stringify(zero.json));
    await savePreset("reading");
    // the pane: drag the zone to the left edge → live warning → save → refusal names the edge
    await page.goto(BASE + "/settings/zones", { waitUntil: "networkidle" });
    const zone = page.locator("[data-testid='zone-reading-center']");
    await zone.waitFor({ timeout: 10000 });
    const zb = await zone.boundingBox();
    await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2);
    await page.mouse.down();
    await page.mouse.move(zb.x + zb.width / 2 - 400, zb.y + zb.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.locator("[data-testid='zones-live-warning']").waitFor({ timeout: 5000 });
    await page.locator("[data-testid='zones-save']").click();
    const refusal = page.locator("[data-testid='zones-refusal']");
    await refusal.waitFor({ timeout: 8000 });
    if (!/left/.test((await refusal.textContent()) ?? "")) throw new Error("the pane's refusal does not name the edge: " + (await refusal.textContent()));
    if ((await zones()).config.zones[0].rect.x < 10) throw new Error("the refused drag landed");
  });

  await check("6. READING LAYOUT: a wheel in the center band scrolls the article in place (timeline still); a wheel in the outer band scrolls the timeline (article still); a synthetic touch drag does the same", async () => {
    await savePreset("reading");
    // the Default window holds no long-form post (the seed's articles are old); a reading session is a
    // long-form-weighted mode — Curate ranks all ten articles into the window
    await activate(CURATE_ID);
    await home();
    const shell = page.locator("[data-testid='scroll-zone-shell']");
    if ((await shell.getAttribute("data-layout")) !== "reading" || (await shell.getAttribute("data-zones")) !== "1") throw new Error("the shell does not carry the reading layout: " + (await shell.getAttribute("data-layout")));
    const body = page.locator("[data-testid='longform-body']").first();
    if (!(await body.count())) throw new Error("no long-form article in the feed window to read");
    await body.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(200);
    const read = () => body.evaluate((el) => ({ top: el.scrollTop, y: window.scrollY, max: el.scrollHeight - el.clientHeight }));
    const s0 = await read();
    if (!(s0.max > 0)) throw new Error("the article body is not scrollable (" + JSON.stringify(s0) + ")");
    const cx = VIEWPORT.width / 2, cy = VIEWPORT.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, 200);
    await sleep(250);
    const s1 = await read();
    if (!(s1.top > s0.top)) throw new Error(`the article did not scroll in the center band (${s0.top} → ${s1.top})`);
    if (s1.y !== s0.y) throw new Error(`the timeline moved while reading in the center band (${s0.y} → ${s1.y})`);
    // the outer band: the timeline scrolls, the article stays
    await page.mouse.move(VIEWPORT.width * 0.05, cy);
    await page.mouse.wheel(0, 200);
    await sleep(250);
    const s2 = await read();
    if (!(s2.y > s1.y)) throw new Error(`the timeline did not scroll from the outer band (${s1.y} → ${s2.y})`);
    if (s2.top !== s1.top) throw new Error("the article moved from the outer band");
    // synthetic touch: a drag up in the center scrolls the article, not the page
    await body.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(150);
    const t0 = await read();
    const moved = await page.evaluate(({ cx, cy }) => {
      const target = document.elementFromPoint(cx, cy);
      const mk = (type, y) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: [new Touch({ identifier: 1, target, clientX: cx, clientY: y, pageX: cx, pageY: y })] });
      target.dispatchEvent(mk("touchstart", cy));
      target.dispatchEvent(mk("touchmove", cy - 80));
      target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [] }));
      return true;
    }, { cx, cy });
    if (!moved) throw new Error("touch dispatch failed");
    await sleep(150);
    const t1 = await read();
    if (!(t1.top > t0.top)) throw new Error(`a touch drag did not scroll the article (${t0.top} → ${t1.top})`);
    if (t1.y !== t0.y) throw new Error("a touch drag in the center moved the timeline");
  });

  await check("7. ZONES ARE VAULT DATA: the namespace is ciphertext on the validator; no zone plaintext in its database", async () => {
    const st = (await vapi("/state")).json?.state ?? {};
    const ns = st.scrollZones ?? {};
    if (!Object.keys(ns).length) throw new Error("the scrollZones namespace is empty on the validator");
    for (const [k, v] of Object.entries(ns)) if (!(v && typeof v === "object" && typeof v.ct === "string")) throw new Error(`scrollZones/${k} is not ciphertext`);
    if (!existsSync(DB_PATH)) throw new Error("validator DB not found");
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) {
        for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) {
          const s = JSON.stringify(row);
          if (/reading-center|"longform"|insetPx/.test(s)) throw new Error(`${t} row carries zone plaintext`);
        }
      }
    } finally { db.close(); }
  });

  await check("8. NO ZONES, NO ROUTER: under the default layout the shell attaches nothing and a wheel scrolls the timeline; the article is clamped with Show more, as ever", async () => {
    await savePreset("default");
    await activate(CURATE_ID); // the articles are in the window — and under the default layout they are clamped, not scroll-owning
    await home();
    const shell = page.locator("[data-testid='scroll-zone-shell']");
    if ((await shell.getAttribute("data-zones")) !== "0") throw new Error("the shell reports zones under the default layout");
    if (await page.locator("[data-testid='longform-body']").count()) throw new Error("a long-form body owns its scroll under the default layout");
    if (!(await page.locator("[data-testid='cast'] button", { hasText: "Show more" }).count())) throw new Error("the articles are not clamped with Show more under the default layout");
    const y0 = await page.evaluate(() => window.scrollY);
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await page.mouse.wheel(0, 300);
    await sleep(250);
    const y1 = await page.evaluate(() => window.scrollY);
    if (!(y1 > y0)) throw new Error("a wheel at the center did not scroll the timeline under the default layout");
  });
} finally {
  await browser.close();
}

await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Mega pass 2 Gate 3 (scroll zones + action buttons) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
