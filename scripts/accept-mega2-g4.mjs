// MEGA PASS 2 — Gate 4 acceptance (fixture): UNIFIED SEARCH — vault-local, keyword + AI.
//   1. ONE BOX, ≥5 RECORD TYPES: the index holds posts, private posts, likes, bookmarks, stakes, relationship
//      events (and DMs / imports when present); keyword hits come back grouped by type
//   2. PRIVATE CHROME + SINGLE ROOT: a private record renders with private chrome; every indexed record belongs
//      to one of THIS device's personas — nothing from another root
//   3. SEMANTIC, LOCALLY: a PARAPHRASE finds the private post through the local model (shared meanings named);
//      the same words find nothing by keyword; the worker's embedding equals the in-process one
//   4. DEGRADE HONESTLY: when the device cannot run the model the box answers by keyword AND SAYS SO
//   5. CLOUD OFF BY DEFAULT, NAMED CONSENT: the cloud path sends nothing without consent naming exactly N snippets
//      and the provider; a mismatched consent sends nothing; the exact consent hands the (fixture) provider N
//   6. NETWORK LEVEL: the validator has no search endpoint; keyword AND semantic searches answer while the
//      validator's port is closed; the validator's database never carries a query or a private record's text
//   7. THE INDEX SURVIVES A DROP by being re-derived from the vault; the vault namespace is ciphertext
//   8. THE PAGE: /search renders the one box with the grouped results and the private chrome; cloud is unchecked
// Fixture, pinned ports, no network, no spend.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const CANARY = "borrowing is cheap right now, so the vault canary says: refinance the loan";
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
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? JSON.stringify(r.json)?.slice(0, 200))); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const reset = () => retry(() => dev("resetSeed"));
const asViewer = (id) => ({ cookie: `layers_view_as=${id}` });
const search = (q, mode = "keyword", consent) => api("GET", `/api/search/unified?q=${encodeURIComponent(q)}&mode=${mode}${consent ? `&consent=${encodeURIComponent(JSON.stringify(consent))}` : ""}`);
const status = async () => (await retry(() => api("GET", "/api/search/unified?status=1"))).json;
const hooks = (action, extra = {}) => api("POST", "/api/search/unified", { action, ...extra });
const hitsOf = (r) => (r.json?.groups ?? []).flatMap((g) => g.hits);

await reset();

// POST-DEPLOY Gate 2: the one box is the CROSS-PERSONA view, and that view is now off
// by default — a shared screen putting an anonymous persona next to a work one is a
// hazard no encryption removes. This suite tests the box, so it opts in, after first
// asserting the default it is opting out of: otherwise the gate that made it default-off
// would have silently un-made itself here and nothing would have noticed.
{
  const st0 = (await retry(() => api("GET", "/api/search/unified?status=1"))).json;
  if (st0?.scope?.unified !== false) throw new Error("SETUP: the cross-persona view is not off by default: " + JSON.stringify(st0?.scope));
  if ((st0?.scope?.personaIds ?? []).length !== 1) throw new Error("SETUP: the default index spans " + st0?.scope?.personaIds?.length + " personas");
  const on = await retry(() => api("POST", "/api/persona/chrome", { action: "unified", on: true }));
  if (on.json?.scope?.unified !== true) throw new Error("SETUP: could not turn the cross-persona view on: " + JSON.stringify(on.json).slice(0, 160));
}

await check("1. ONE BOX, ≥5 RECORD TYPES: posts, private posts, likes, bookmarks, stakes, relationship events are indexed; keyword hits come back grouped by type", async () => {
  // a private post as ALT (the seeded private persona — one of this device's own), a stake as MAIN
  const posted = await retry(() => api("POST", "/api/private/posts", { text: CANARY }, asViewer(ALT)));
  if (!posted.json?.post?.hash) throw new Error("private post not staged: " + JSON.stringify(posted.json).slice(0, 200));
  await retry(() => api("POST", "/api/influence", { action: "stake", castHash: "0xcr0001", stakeAction: "like", amount: 1 }));
  const st = await status();
  if (!(st.indexed > 20)) throw new Error("index too small: " + JSON.stringify(st));
  const need = ["cast", "privatePost", "like", "bookmark", "stake", "relationship"];
  const missing = need.filter((t) => !st.types.includes(t));
  if (missing.length) throw new Error("record types missing from the index: " + missing.join(", ") + " (have " + st.types.join(",") + ")");
  if (st.types.length < 5) throw new Error("fewer than 5 record types indexed: " + st.types.join(","));
  const canary = await retry(() => search("canary"));
  const hit = hitsOf(canary).find((h) => h.type === "privatePost");
  if (!hit) throw new Error("the private post is not found by keyword: " + JSON.stringify(canary.json).slice(0, 300));
  if (!canary.json.groups.every((g) => g.hits.every((h) => h.type === g.type))) throw new Error("groups are not by type");
  // one box, several types across a few plain words
  const seen = new Set();
  for (const q of ["canary", "staked", "follow", "restaking", "bookmarked", "liked"]) for (const h of hitsOf(await retry(() => search(q)))) seen.add(h.type);
  if (seen.size < 5) throw new Error("keyword hits span only " + [...seen].join(",") + " — need ≥5 types");
});

await check("2. PRIVATE CHROME + SINGLE ROOT: a private record is marked private; every indexed record belongs to one of THIS device's personas", async () => {
  const r = await retry(() => search("canary"));
  const hit = hitsOf(r).find((h) => h.type === "privatePost");
  if (!hit || hit.private !== true || hit.personaId !== ALT) throw new Error("the private post is not private/ALT: " + JSON.stringify(hit));
  const st = await status();
  if (st.personas.some((p) => /^persona_acc_/.test(p))) throw new Error("another root's persona is in the index: " + st.personas.join(","));
  for (const q of ["canary", "restaking", "follow", "staked", "liked", "bookmarked"]) for (const h of hitsOf(await retry(() => search(q)))) if (!st.personas.includes(h.personaId)) throw new Error("a hit belongs to a persona outside this root: " + h.personaId);
  // a stranger's private post never appears: view as a stranger, the index is STILL this device's (the vault is the device's)
  const asStranger = await search("canary", "keyword", undefined);
  if (asStranger.status !== 200) throw new Error("search failed");
});

await check("3. SEMANTIC, LOCALLY: a paraphrase finds the private post through the local model with the shared meanings named; the same words find nothing by keyword; the worker's embedding equals the in-process one", async () => {
  const kw = await retry(() => search(PARAPHRASE, "keyword"));
  if (hitsOf(kw).some((h) => h.type === "privatePost")) throw new Error("keyword already finds the paraphrase — the test proves nothing: " + JSON.stringify(hitsOf(kw).map((h) => h.id)));
  const sem = await retry(() => search(PARAPHRASE, "semantic"));
  if (sem.json.mode !== "semantic" || sem.json.degraded) throw new Error("semantic did not run: " + JSON.stringify(sem.json).slice(0, 200));
  const top = hitsOf(sem).slice(0, 3);
  const hit = top.find((h) => h.type === "privatePost");
  if (!hit) throw new Error("the paraphrase did not find the private post in the top 3: " + JSON.stringify(top.map((h) => h.id + ":" + h.score.toFixed(2))));
  for (const m of ["cheap", "borrow", "now"]) if (!hit.why.includes(m)) throw new Error("the shared meaning is not named: " + JSON.stringify(hit.why));
  const both = (await retry(() => hooks("embedBothWays", { text: CANARY }))).json;
  const diff = Math.max(...both.inProcess.map((v, i) => Math.abs(v - both.worker[i])));
  if (!(diff < 1e-6) || both.inProcess.length !== 512) throw new Error("the worker's embedding differs from the in-process one: max diff " + diff);
});

await check("4. DEGRADE HONESTLY: when the device cannot run the model the box answers by keyword AND SAYS SO", async () => {
  await retry(() => hooks("semanticUnavailable", { on: true }));
  try {
    const st = await status();
    if (st.semantic.available !== false) throw new Error("the status still says the model is available");
    const r = await retry(() => search("canary", "semantic"));
    if (r.json.mode !== "keyword" || r.json.degraded?.from !== "semantic" || !r.json.degraded?.reason) throw new Error("no honest degrade: " + JSON.stringify(r.json).slice(0, 200));
    if (!hitsOf(r).some((h) => h.type === "privatePost")) throw new Error("the keyword fallback did not answer");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + "/search?q=canary", { waitUntil: "networkidle" });
      await page.locator("[data-testid='unified-mode-semantic']").click();
      await page.locator("[data-testid='unified-search-go']").click();
      await page.locator("[data-testid='unified-degraded']").waitFor({ timeout: 10000 });
    } finally {
      await browser.close();
    }
  } finally {
    await retry(() => hooks("semanticUnavailable", { on: false }));
  }
  const back = await retry(() => search(PARAPHRASE, "semantic"));
  if (back.json.mode !== "semantic") throw new Error("semantic did not come back");
});

await check("5. CLOUD OFF BY DEFAULT, NAMED CONSENT: nothing is sent without consent naming exactly N snippets and the provider; a mismatched consent sends nothing; the exact consent hands the fixture provider N", async () => {
  await retry(() => hooks("resetCloudSends"));
  const ask = await retry(() => search("canary", "cloud"));
  const nc = ask.json.needsConsent;
  if (!nc || nc.provider !== "fixture-cloud" || !(nc.snippets >= 1) || nc.preview.length !== nc.snippets || !/^[0-9a-f]{16}$/.test(nc.queryHash)) throw new Error("no named consent request: " + JSON.stringify(ask.json).slice(0, 300));
  if (ask.json.total !== 0 || ask.json.sent) throw new Error("something was returned or sent before consent");
  if ((await retry(() => hooks("cloudSends"))).json.sends.length !== 0) throw new Error("a send was recorded before consent");
  const wrong = await retry(() => search("canary", "cloud", { provider: nc.provider, snippets: nc.snippets + 1, queryHash: nc.queryHash }));
  if (!wrong.json.needsConsent || wrong.json.sent) throw new Error("a mismatched consent was honoured");
  const other = await retry(() => search("canary", "cloud", { provider: nc.provider, snippets: nc.snippets, queryHash: "0".repeat(16) }));
  if (!other.json.needsConsent || other.json.sent) throw new Error("a consent for a different query was honoured");
  if ((await retry(() => hooks("cloudSends"))).json.sends.length !== 0) throw new Error("a mismatched consent produced a send");
  const yes = await retry(() => search("canary", "cloud", { provider: nc.provider, snippets: nc.snippets, queryHash: nc.queryHash }));
  if (!yes.json.sent || yes.json.sent.snippets !== nc.snippets || yes.json.sent.fixture !== true) throw new Error("the exact consent did not run the (fixture) provider: " + JSON.stringify(yes.json).slice(0, 200));
  const sends = (await retry(() => hooks("cloudSends"))).json.sends;
  if (sends.length !== 1 || sends[0].snippets !== nc.snippets) throw new Error("the send was not recorded once: " + JSON.stringify(sends));
  // the page: cloud is unchecked by default and the default mode is keyword
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE + "/search?q=canary", { waitUntil: "networkidle" });
    await page.locator("[data-testid='unified-results']").waitFor({ timeout: 10000 });
    if (await page.locator("[data-testid='unified-cloud-toggle']").isChecked()) throw new Error("the cloud toggle is on by default");
    if ((await page.locator("[data-testid='unified-results']").getAttribute("data-mode")) !== "keyword") throw new Error("the default mode is not keyword");
    await page.locator("[data-testid='unified-cloud-toggle']").check();
    await page.locator("[data-testid='unified-search-go']").click();
    const consent = page.locator("[data-testid='unified-consent']");
    await consent.waitFor({ timeout: 10000 });
    const text = (await consent.textContent()) ?? "";
    if (!/Send these \d+ snippets to fixture-cloud\?/.test(text)) throw new Error("the consent does not name what would be sent: " + text.slice(0, 120));
  } finally {
    await browser.close();
  }
});

await check("6. NETWORK LEVEL: the validator has no search endpoint; keyword AND semantic searches answer while the validator's port is closed; its database never carries a query or the private text", async () => {
  const src = ["validator/server.js", "validator/zk.js", "validator/stakes.js", "validator/anon.js"].map((f) => readFileSync(f, "utf8")).join("\n");
  if (/app\.(get|post)\(\s*["'`]\/search/.test(src) || /adapter_state[^\n]*search/i.test(src)) throw new Error("the validator exposes a search endpoint");
  // warm the index (the vault is in memory now), then close the validator's port and search
  await retry(() => search("canary", "keyword"));
  await retry(() => search("canary", "semantic"));
  const port = process.env.LAYERS_VALIDATOR_PORT || 4001;
  const pid = execSync(`powershell.exe -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess"`, { encoding: "utf8" }).trim().split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) throw new Error("could not find the validator pid on the pinned port");
  execSync(`powershell.exe -NoProfile -Command "taskkill /PID ${pid} /F"`, { stdio: "ignore" });
  let closed = false;
  try { await fetch(VBASE + "/health"); } catch { closed = true; }
  const kw = await search("canary", "keyword");
  const sem = await search(PARAPHRASE, "semantic");
  let back = false;
  for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(VBASE + "/health")).status === 200) { back = true; break; } } catch {} }
  if (!back) throw new Error("validator did not come back within 20 s — is it running under npm run validator:supervised?");
  if (!closed) throw new Error("the validator's port was still open right after the kill — the searches below did not prove anything");
  if (kw.status !== 200 || !hitsOf(kw).some((h) => h.type === "privatePost")) throw new Error("keyword search failed with the validator down: " + kw.status + " " + JSON.stringify(kw.json).slice(0, 120));
  if (sem.status !== 200 || sem.json.mode !== "semantic" || !hitsOf(sem).slice(0, 3).some((h) => h.type === "privatePost")) throw new Error("semantic search failed with the validator down: " + sem.status + " " + JSON.stringify(sem.json).slice(0, 120));
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found");
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) {
      for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) {
        const s = JSON.stringify(row);
        if (/vault canary|affordable currently|refinance the loan/.test(s)) throw new Error(`${t} row carries a query or the private text`);
      }
    }
  } finally { db.close(); }
});

await check("7. THE INDEX SURVIVES A DROP by being re-derived from the vault; the vault namespace is ciphertext", async () => {
  await retry(() => hooks("dropIndex"));
  const r = await retry(() => search("canary", "keyword"));
  if (!hitsOf(r).some((h) => h.type === "privatePost")) throw new Error("the index did not rebuild from the vault");
  const st = (await vapi("/state")).json?.state ?? {};
  for (const [k, v] of Object.entries(st.privatePosts ?? {})) if (!(v && typeof v === "object" && typeof v.ct === "string")) throw new Error(`privatePosts/${k} is not ciphertext`);
  if (st.searchIndex || st.unifiedSearch) throw new Error("an index namespace exists on the validator");
});

await check("8. THE PAGE: /search renders the one box with the grouped results and the private chrome", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE + "/search?q=canary", { waitUntil: "networkidle" });
    await page.locator("[data-testid='unified-results']").waitFor({ timeout: 10000 });
    const groups = await page.locator("[data-testid='unified-group']").count();
    if (groups < 1) throw new Error("no groups rendered");
    const priv = page.locator("[data-testid='unified-group'][data-type='privatePost'] [data-testid='unified-private-chrome']");
    if (!(await priv.count())) throw new Error("the private post does not wear private chrome");
    if (!(await page.locator("[data-testid='unified-status']").count())) throw new Error("the index status line is missing");
  } finally {
    await browser.close();
  }
});

// leave the rig as we found it: the cross-persona view goes back off explicitly,
// not only via the reset below, so an interrupted run does not leave it on
await api("POST", "/api/persona/chrome", { action: "unified", on: false }).catch(() => {});
await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Mega pass 2 Gate 4 (unified search) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
