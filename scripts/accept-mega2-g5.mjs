// MEGA PASS 2 — Gate 5 acceptance (fixture): @totem ON X — the DM-to-bookmark hook.
//   1. LINKED SENDER LANDS: a fixture DM from the linked X handle lands in the persona's "From X DM" folder and in the
//      readwise queue, and drips into the feed as a readwise card attributed to the tweet's author
//   2. UNLINKED SENDER: gets the (recorded, never sent) reply and NOTHING is stored — not the DM, not the handle
//   3. DM CONTENT ABSENT FROM VALIDATOR PLAINTEXT: the tweet text and the DM text appear nowhere in its database;
//      the vault namespace holding them is ciphertext
//   4. FREQUENCY CHANGES CADENCE MEASURABLY: every 3 loads → the DM card on 2 of 6 builds; every 1 → on every build
//   5. IDEMPOTENT + LEDGERED: the next page lands its link and skips the link-less DM; the same page again lands
//      nothing; every poll is one itemized read in the spend ledger
//   6. THE LIVE RECORDER refuses without the Totem account's credentials — no network call
//   7. THE PANE renders mode, handle, folder, replies (recorded, not sent) and the per-mode cadence
// Fixture, pinned ports, no network, no spend.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const HANDLE = "layers_tester";
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
const inbox = async () => (await retry(() => api("GET", "/api/x/inbox"))).json;
const poll = () => api("POST", "/api/x/inbox", { action: "poll" });
const feedCards = async () => ((await retry(() => api("GET", "/api/feed2"))).json.cards ?? []);
const dmCardsIn = (cards) => cards.filter((c) => c.kind === "readwise" && String(c.cast?.hash).startsWith("dm:"));
const dbRows = () => {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const out = [];
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) out.push([t, JSON.stringify(row)]);
    return out;
  } finally { db.close(); }
};

await reset();
// link the seed viewer's X account (fixture OAuth, a chosen handle) — the fixture inbox's $LINKED sender becomes this handle
await retry(() => api("POST", "/api/x/link", { action: "begin" }));
const linked = await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: HANDLE }));
const linkedHandle = linked.json?.attestation?.handle ?? HANDLE;
let firstHash = null;

await check("1. LINKED SENDER LANDS: the DM's link lands in the persona's 'From X DM' folder and the readwise queue, and drips into the feed attributed to the tweet's author", async () => {
  const before = await inbox();
  if (before.linkedHandle !== linkedHandle) throw new Error("the active persona's linked handle is not the one just linked: " + JSON.stringify(before.linkedHandle));
  if (before.mode !== "fixture") throw new Error("inbox is not in fixture mode: " + before.mode);
  const r = await poll();
  if (r.status !== 200) throw new Error("poll failed: " + r.status + " " + JSON.stringify(r.json));
  if (r.json.landed.length !== 1 || r.json.replied.length !== 1) throw new Error("page 0 should land 1 and reply 1: " + JSON.stringify(r.json));
  firstHash = r.json.landed[0].hash;
  // OPAQUE: salted with the device's vault key — the folder and schedule rows the validator holds name a tweet the
  // operator cannot identify (the id would be a reading-interest fingerprint)
  if (!/^dm:[0-9a-f]{16}$/.test(firstHash)) throw new Error("landed hash is not the opaque form: " + firstHash);
  const after = await inbox();
  if (!after.folder || after.folder.name !== "From X DM" || after.folder.count !== 1 || after.folder.isPublic) throw new Error("the DM folder is wrong: " + JSON.stringify(after.folder));
  if (!after.schedules.some((s) => s.postHash === firstHash)) throw new Error("no readwise schedule for the landed link");
  await retry(() => dev("fastForwardReadwise"));
  const cards = await feedCards();
  const card = dmCardsIn(cards)[0];
  if (!card) throw new Error("no DM readwise card in the feed after fast-forward");
  if (!/X DM · @gwei_whisperer/.test(card.readwiseSource ?? "")) throw new Error("the card is not attributed to the tweet's author: " + card.readwiseSource);
  if (!/Restaking yields/.test(card.cast.text)) throw new Error("the card does not carry the tweet's text");
});

await check("2. UNLINKED SENDER: gets the recorded (never sent) reply and nothing is stored — not the DM, not the handle", async () => {
  const info = await inbox();
  const reply = info.replies.find((r) => r.dmId === "dm_1002");
  if (!reply || reply.sent !== false || reply.kind !== "unlinked" || !/^[0-9a-f]{12}$/.test(reply.senderHash)) throw new Error("no recorded reply for the unlinked sender: " + JSON.stringify(info.replies));
  if (!/Link your X account/.test(reply.text)) throw new Error("the reply is not the linking funnel");
  if (info.folder.count !== 1) throw new Error("something of the unlinked sender's landed in the folder");
  for (const [t, s] of dbRows()) if (/randomstranger_88|dm_1002|Basis trades look risk-free/.test(s)) throw new Error(`${t} row stores the unlinked sender's DM or handle`);
});

await check("3. DM CONTENT ABSENT FROM VALIDATOR PLAINTEXT: the tweet and the DM text appear nowhere in its database; the vault namespace is ciphertext", async () => {
  for (const [t, s] of dbRows()) if (/Restaking yields are converging|save this for me|1720000000000000001/.test(s)) throw new Error(`${t} row carries DM content in plaintext`);
  const st = (await vapi("/state")).json?.state ?? {};
  const ns = st.xImportedPrivate ?? {};
  if (!Object.keys(ns).length) throw new Error("the xImportedPrivate namespace is empty on the validator");
  for (const [k, v] of Object.entries(ns)) if (!(v && typeof v === "object" && typeof v.ct === "string")) throw new Error(`xImportedPrivate/${k} is not ciphertext`);
});

await check("4. FREQUENCY CHANGES CADENCE MEASURABLY: every 3 loads → the DM card on exactly 2 of 6 builds; every 1 → on every build", async () => {
  // the cadence counters are per (persona, mode) and per process: start from a clean seed (which also resets them),
  // re-link, re-land page 0, then count builds. The active mode id is read AFTER the reset — the seed re-mints modes.
  await reset();
  await retry(() => api("POST", "/api/x/link", { action: "begin" }));
  await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: HANDLE }));
  await retry(() => poll());
  await retry(() => dev("fastForwardReadwise"));
  const modes = (await retry(() => api("GET", "/api/modes"))).json;
  const active = modes.activeId;
  const set = (every) => retry(() => api("POST", "/api/x/inbox", { action: "setCadence", modeId: active, every, appearance: "chunk" }));
  await set(3);
  let shown = 0;
  for (let i = 0; i < 6; i++) if (dmCardsIn(await feedCards()).length) shown++;
  if (shown !== 2) throw new Error(`every=3 showed the DM card on ${shown} of 6 builds, expected 2`);
  await set(1);
  let every = 0;
  for (let i = 0; i < 3; i++) if (dmCardsIn(await feedCards()).length) every++;
  if (every !== 3) throw new Error(`every=1 showed the DM card on ${every} of 3 builds, expected 3`);
  const cad = (await inbox()).cadence.find((c) => c.modeId === active);
  if (!cad || cad.every !== 1) throw new Error("the cadence setting did not persist on the mode: " + JSON.stringify(cad));
});

await check("5. IDEMPOTENT + LEDGERED: the next page lands its link and skips the link-less DM; the same page again lands nothing; every poll is one itemized read in the spend ledger", async () => {
  const p1 = await retry(() => poll());
  if (p1.json.landed.length !== 1 || p1.json.skipped.length !== 1 || p1.json.replied.length !== 0) throw new Error("page 1 should land 1 and skip 1: " + JSON.stringify(p1.json));
  if (!p1.json.exhausted) throw new Error("the fixture inbox should be exhausted after page 1");
  const p2 = await retry(() => poll());
  if (p2.json.polled !== 0 || p2.json.landed.length !== 0) throw new Error("an exhausted inbox landed something: " + JSON.stringify(p2.json));
  const spend = (await retry(() => api("GET", "/api/x/spend"))).json;
  const entries = (spend.entries ?? []).filter((e) => /@totem inbox poll/.test(e.note ?? ""));
  if (entries.length < 3) throw new Error("the ledger does not itemize every poll: " + entries.length + " entries");
  if (!entries.every((e) => e.kind === "read_sync" && e.amount >= 0 && e.mode === "fixture")) throw new Error("a poll entry is not an itemized fixture read: " + JSON.stringify(entries[0]));
  if ((await inbox()).folder.count !== 2) throw new Error("the folder should hold exactly 2 links after two landing pages");
});

await check("6. THE LIVE RECORDER refuses without the Totem account's credentials — no network call", async () => {
  const env = { ...process.env };
  delete env.X_API_CLIENT_ID;
  delete env.X_LAYERS_INBOX_TOKEN;
  delete env.ENABLE_X_READ;
  const r = spawnSync(process.execPath, ["scripts/live-m2g5.mjs"], { env, encoding: "utf8", timeout: 30000 });
  if (r.status !== 2 || !/REFUSED/.test(r.stdout + r.stderr)) throw new Error("the live recorder did not refuse: status " + r.status + " " + (r.stdout + r.stderr).slice(0, 200));
  if (existsSync("research/live-m2g5.json")) throw new Error("a live artifact exists without a live run");
});

await check("7. THE PANE renders mode, handle, folder, replies (recorded, not sent) and the per-mode cadence", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE + "/settings/dm-hook", { waitUntil: "networkidle" });
    await page.locator("[data-testid='dm-hook-mode']").waitFor({ timeout: 10000 });
    if ((await page.locator("[data-testid='dm-hook-mode']").textContent()) !== "fixture") throw new Error("mode not shown");
    if (!((await page.locator("[data-testid='dm-hook-handle']").textContent()) ?? "").includes(linkedHandle)) throw new Error("handle not shown");
    if (Number(await page.locator("[data-testid='dm-hook-folder']").getAttribute("data-count")) !== 2) throw new Error("folder count not shown");
    const reply = page.locator("[data-testid='dm-hook-reply']").first();
    if (!(await reply.count()) || (await reply.getAttribute("data-sent")) !== "0") throw new Error("replies not shown as recorded-not-sent");
    if (!(await page.locator("[data-testid^='dm-cadence-']").count())) throw new Error("cadence rows missing");
  } finally {
    await browser.close();
  }
});

await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Mega pass 2 Gate 5 (DM-to-bookmark hook) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
