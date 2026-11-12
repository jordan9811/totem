// MULTI-FID PASS — Gate 2 LIVE RECORDER (run once, by hand, never in a sweep).
//
// Preconditions, all checked before any network call:
//   - the app is up with ZK_DEV_HOOKS=true and ENABLE_FC_WRITE=true (LAYERS_REQUIRE_SIG as usual)
//   - at least TWO live persona records exist (the user ran scripts/fid-acquire.mjs)
//   - DATA_SOURCE live content is reachable (NEYNAR_API_KEY)
// What it does, itemized in research/live-fid2.json (hashes, URLs, fids, fnames — never a key):
//   A. one labeled test cast from each persona, through the write ledger with check-before-retry
//   B. THE MONEY SHOT, three-way: (a) the persona's PUBLIC farcaster.xyz URL — a normal separate account;
//      (b) OUR client as a NON-granted viewer — the bare persona; (c) OUR client as a GRANTED viewer — the
//      merged identity (split avatar, "name / linked"). Screenshots in shots/fid-live-*.png
//   C. persona B follows persona A, likes A's cast; an act-as reply as B to A's cast from the timeline
//      path (signed by B's signer); then the test casts are deleted (advisory — hubs may retain)
// Exit 1 with a named reason when a precondition fails. No spend: posting is not billed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const STRANGER = "persona_acc_crypto_1";
const GRANTED = "persona_acc_food_2"; // @crustcritic
const runId = Math.random().toString(36).slice(2, 8);
// MULTI-FID Gate 5 (attack-fid-1 #6): NO shared marker — a marker family clusters the accounts on hubs; the run id stays in the record only
const MARK = "";
void runId;
const results = [];
const ok = (n, extra = "") => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : ""); } catch (e) { fail(name, e.message); } }
async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.json?.reason ?? JSON.stringify(r.json)?.slice(0, 200))); }
    catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  throw last;
}
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const write = (body) => api("POST", "/api/fc/write", body);
const viewAs = (personaId) => retry(() => dev("viewAs", { personaId }));
function envLocal(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(".env.local")) return "";
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === key) return line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return "";
}

// ---- preconditions (no network beyond the local app) ----
if (envLocal("ENABLE_FC_WRITE") !== "true") {
  console.error("REFUSED: ENABLE_FC_WRITE is not \"true\" — the live recorder writes to the real network and runs only when explicitly armed.");
  process.exit(1);
}
const view = await fetch(BASE + "/api/fc/persona").then((r) => r.json()).catch(() => null);
if (!view) { console.error(`REFUSED: the app is not answering at ${BASE}.`); process.exit(1); }
const live = (view.records ?? []).filter((r) => r.mode === "live" && r.origin === "layers-fid-pass");
if (live.length < 2) {
  console.error(`REFUSED: no live persona records (found ${live.length}, need 2) — run scripts/fid-acquire.mjs first.`);
  process.exit(1);
}
if (view.networkMode !== "per-persona-fid") { console.error("REFUSED: PERSONA_NETWORK_MODE must be per-persona-fid."); process.exit(1); }
const [A, B] = live;
mkdirSync("shots", { recursive: true });
mkdirSync("research", { recursive: true });
const record = { runId, at: new Date().toISOString(), personas: live.map((r) => ({ personaId: r.personaId, fid: r.fid, fname: r.fname })), casts: [], screenshots: [], actions: [] };
const save = () => writeFileSync("research/live-fid2.json", JSON.stringify(record, null, 2) + "\n");

await retry(() => dev("setDataSource", { source: "neynar" }));
const browser = await chromium.launch();

await check("A. one labeled test cast from each persona, through the write ledger, under its OWN fid", async () => {
  for (const p of [A, B]) {
    const r = (await retry(() => write({ action: "cast", personaId: p.personaId, text: `${p.fname} says hello from its own account ${MARK}` }))).json;
    if (r.mode !== "live" || r.fid !== p.fid) throw new Error(`${p.personaId}: ${JSON.stringify(r)}`);
    record.casts.push({ personaId: p.personaId, fid: p.fid, fname: p.fname, hash: r.hash, url: `https://farcaster.xyz/${p.fname}/${r.hash.slice(0, 10)}` });
    save();
  }
  return record.casts.map((c) => c.url).join(" , ");
});

await check("B(a). THE PUBLIC VIEW: each cast on its persona's farcaster.xyz URL — a normal separate account (screenshots)", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  for (const c of record.casts) {
    await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const shot = `shots/fid-live-public-${c.fname}-${runId}.png`;
    await page.screenshot({ path: shot });
    record.screenshots.push({ kind: "public", persona: c.personaId, url: c.url, file: shot });
  }
  await page.close();
  save();
});

async function shotOurClient(viewer, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (viewer) await ctx.addCookies([{ name: "layers_view_as", value: viewer, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(BASE + "/home?feed=classic", { waitUntil: "networkidle" });
  const card = page.locator("[data-testid='cast']", { hasText: MARK }).first();
  await card.waitFor({ timeout: 20000 });
  const merged = await card.locator("[data-testid='cast-merged-identity']").count();
  const split = await card.locator("[data-testid='cast-split-avatar']").count();
  const shot = `shots/fid-live-ours-${label}-${runId}.png`;
  await page.screenshot({ path: shot });
  record.screenshots.push({ kind: "ours", viewer: viewer ?? "self", label, merged, split, file: shot });
  await ctx.close();
  save();
  return { merged, split };
}

await check("B(b). OUR CLIENT, NON-granted viewer: the bare persona — no merge, no split avatar (screenshot)", async () => {
  await viewAs(STRANGER);
  const r = await shotOurClient(STRANGER, "stranger");
  await viewAs(null);
  if (r.merged !== 0 || r.split !== 0) throw new Error(`stranger saw merged=${r.merged} split=${r.split}`);
});

await check("B(c). OUR CLIENT, GRANTED viewer: the merged identity — split avatar and \"name / linked\" (screenshot). Needs a whitelist grant from one live persona to @crustcritic naming the other; issue it if absent", async () => {
  await retry(() => api("POST", "/api/identity/grant", { fromPersona: B.personaId, toPersona: A.personaId, tier: "whitelist", audienceMember: GRANTED })).catch(() => null);
  await viewAs(GRANTED);
  const r = await shotOurClient(GRANTED, "granted");
  await viewAs(null);
  if (r.merged !== 1 || r.split !== 1) throw new Error(`granted viewer saw merged=${r.merged} split=${r.split}`);
});

await check("C1. persona B follows persona A from B's own account (ledgered follow)", async () => {
  const r = (await retry(() => write({ action: "follow", targetFid: A.fid, personaId: B.personaId }))).json;
  if (r.mode !== "live" || r.fid !== B.fid) throw new Error(JSON.stringify(r));
  record.actions.push({ kind: "follow", by: B.fid, target: A.fid });
  save();
});

await check("C2. persona B likes A's cast", async () => {
  const a = record.casts.find((c) => c.personaId === A.personaId);
  const r = (await retry(() => write({ action: "like", targetHash: a.hash, personaId: B.personaId }))).json;
  if (r.mode !== "live" || r.fid !== B.fid) throw new Error(JSON.stringify(r));
  record.actions.push({ kind: "like", by: B.fid, target: a.hash });
  save();
});

await check("C3. ACT-AS from the timeline: a reply as persona B to A's cast lands under B's fid, signed by B's signer", async () => {
  const a = record.casts.find((c) => c.personaId === A.personaId);
  const r = (await retry(() => api("POST", "/api/actions/act-as", { kind: "reply", targetHash: a.hash, text: `replying from the other account ${MARK}`, asPersonaId: B.personaId }))).json;
  if (r.network !== true || r.fid !== B.fid || !r.hash) throw new Error(JSON.stringify(r));
  record.casts.push({ personaId: B.personaId, fid: B.fid, fname: B.fname, hash: r.hash, url: `https://farcaster.xyz/${B.fname}/${r.hash.slice(0, 10)}`, replyTo: a.hash });
  record.actions.push({ kind: "act-as-reply", by: B.fid, target: a.hash, hash: r.hash });
  save();
  return r.hash;
});

await check("C4. the test casts are deleted afterwards (advisory — hubs and indexers may retain)", async () => {
  for (const c of [...record.casts].reverse()) {
    const r = (await retry(() => write({ action: "delete", hash: c.hash, personaId: c.personaId }))).json;
    if (r.mode !== "live") throw new Error(JSON.stringify(r));
    record.actions.push({ kind: "delete", by: c.fid, hash: c.hash });
  }
  save();
});

await browser.close();
await retry(() => dev("setDataSource", { source: null })).catch(() => null);
save();
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} live checks passed — research/live-fid2.json, shots/fid-live-*.png`);
process.exitCode = results.some((r) => r[0] === "FAIL") ? 1 : 0;
