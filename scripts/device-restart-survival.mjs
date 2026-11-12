// BROWSER KEYSTORE PASS Gate 1 stage 4 — RESTART SURVIVAL WITH BROWSER-HELD STATE.
//
// The custody split says the browser holds the keys and the validator holds ciphertext. This proves it survives a
// hard kill of BOTH server processes: a device keeps an identity on this device (IndexedDB, wrapped under a
// non-extractable key), writes a private post, then both servers are killed with SIGKILL and started again from the
// same build and the same database — and the same browser tab re-opens its vault and reads its post back.
//
// Run with the servers already up (the harness's ports); it restarts them itself and leaves them running.
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import path from "node:path";

const APP_PORT = Number(process.env.LAYERS_APP_PORT || 3001);
const VAL_PORT = Number(process.env.LAYERS_VALIDATOR_PORT || 4001);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const VBASE = `http://127.0.0.1:${VAL_PORT}`;
const ROOT = process.cwd();
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36).slice(-5);

function pidsOnPort(port) {
  try {
    return [...new Set(
      execSync(`netstat -ano -p tcp | findstr LISTENING | findstr :${port}`, { encoding: "utf8" })
        .split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop()).filter((p) => /^\d+$/.test(p) && p !== "0")
    )];
  } catch { return []; }
}
function killPort(port) {
  for (const pid of pidsOnPort(port)) {
    try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" }); } catch { /* already gone */ }
  }
}
async function waitUp(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url, { cache: "no-store" })).ok) return true; } catch { /* not yet */ }
    await sleep(500);
  }
  return false;
}
const SRV_ENV = {
  ...process.env,
  NODE_ENV: "production",
  ZK_DEV_HOOKS: "true",
  LAYERS_REQUIRE_SIG: "true",
  // BROWSER KEYSTORE PASS Gate 6: this suite KILLS and restarts both servers, so the pair it leaves behind is the
  // one every later suite in a sweep runs against. Without the harness's short prefetch cadence the next sweep's zk
  // suites read the product default (ten minutes) and fail on a rig condition this suite created.
  ZK_PREFETCH_MS: process.env.ZK_PREFETCH_MS || "3000",
  LAYERS_APP_PORT: String(APP_PORT),
  LAYERS_VALIDATOR_PORT: String(VAL_PORT),
  VALIDATOR_URL: VBASE,
  APP_URL: BASE,
};
function startServers() {
  // the rig runs its validator under a supervisor that respawns it — start only what is not already listening
  if (pidsOnPort(VAL_PORT).length === 0) {
    const v = spawn(process.execPath, [path.join(ROOT, "validator", "server.js")], { env: SRV_ENV, stdio: "ignore", detached: true });
    v.unref();
  }
  if (pidsOnPort(APP_PORT).length === 0) {
    const a = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)], { env: SRV_ENV, stdio: "ignore", detached: true, cwd: ROOT });
    a.unref();
  }
}

console.log("\nDevice restart survival: browser-held keys, validator-held ciphertext, both servers killed");
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("   [pageerror] " + String(e).slice(0, 200)));
const api = (method, p, body) =>
  page.evaluate(async ({ method, p, body }) => {
    const r = await fetch(p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, json };
  }, { method, p, body });
const load = async () => {
  await page.goto(BASE + "/device/smoke.html?validator=" + encodeURIComponent(VBASE), { waitUntil: "load" });
  return page.evaluate(() => window.__layersDevice.ready);
};

const privateText = "restart survival " + stamp + " canary";
let before = null;
try {
  before = await load();
  await page.evaluate(() => window.__layersDevice.persist());
  const priv = before.personaIds[1];
  const sw = await api("POST", "/api/seed-persona", { personaId: priv });
  if (sw.status !== 200) throw new Error("persona switch: " + sw.status);
  const w = await api("POST", "/api/private/posts", { text: privateText });
  if (![200, 201].includes(w.status)) throw new Error("private post: " + w.status + " " + JSON.stringify(w.json).slice(0, 140));
  ok("1. a device kept on this device wrote a private post", "root " + before.rootId);
} catch (e) {
  fail("1. a device kept on this device wrote a private post", e.message);
}

// ---- the hard kill ----
// The assertion is that the PROCESSES THAT SERVED THE WRITE are gone. The rig's validator runs under a supervisor
// which respawns it with a NEW pid; that is a genuine restart, so a fresh pid on the port is not a failed kill.
const appBefore = pidsOnPort(APP_PORT);
const valBefore = pidsOnPort(VAL_PORT);
killPort(APP_PORT);
killPort(VAL_PORT);
await sleep(2000);
const survivors = [...pidsOnPort(APP_PORT).filter((p) => appBefore.includes(p)), ...pidsOnPort(VAL_PORT).filter((p) => valBefore.includes(p))];
if (survivors.length === 0) ok("2. both servers killed (SIGKILL, whole process tree)", appBefore.length + valBefore.length + " original pid(s) gone");
else fail("2. both servers killed (SIGKILL, whole process tree)", survivors.length + " original pid(s) still listening");

startServers();
const up = (await waitUp(VBASE + "/health")) && (await waitUp(BASE + "/api/health"));
if (up) ok("3. both servers restarted from the same build and database");
else fail("3. both servers restarted from the same build and database", "they did not come back up");

try {
  const after = await load();
  if (!after.restored) throw new Error("the device did not restore from IndexedDB");
  if (after.rootId !== before.rootId || after.anchor !== before.anchor) throw new Error("a different root came back: " + after.rootId);
  ok("4. the same tab re-opened the same root after the kill", after.rootId);
  const sw = await api("POST", "/api/seed-persona", { personaId: after.personaIds[1] });
  if (sw.status !== 200) throw new Error("persona switch: " + sw.status);
  const r = await api("GET", "/api/private/posts");
  if (!JSON.stringify(r.json).includes(privateText)) throw new Error("the private post did not come back: status " + r.status + ", " + (r.json?.posts?.length ?? "?") + " posts");
  ok("5. the vault re-decrypted: the private post is readable again");
} catch (e) {
  fail("4/5. the device restored and re-decrypted its vault", e.message);
}

await page.evaluate(() => window.__layersDevice.wipe()).catch(() => {});
await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} device restart-survival checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
