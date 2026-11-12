// BROWSER KEYSTORE PASS Gate 6 — the public-preview gates 1, 2, 5 and 6 measured locally, against the
// PRODUCTION-SHAPED pair (att-run-prod; aborts on the rig like cu4). Gates 3 and 4 (the deployments) are measured
// by scripts/smoke-deployed.mjs against the deployed URLs; check 10 runs that same suite against this pair.
//   1. LANDING renders with NO validator: a throwaway production app pointed at a dead validator serves `/` with the
//      app door and the honest status, and — DOCS UNDER APP (D-DOCS-UNDER-APP) — the docs door to /docs with
//      NEXT_PUBLIC_DOCS_URL unset; that same throwaway serves /docs/ itself (the docs need no validator)
//   2. an explicit NEXT_PUBLIC_DOCS_URL still OVERRIDES the door (a future custom docs domain), in a new tab
//   3. the PREVIEW BANNER inside the app names the COMPUTED label (its failing count equals the device's own
//      privacyConditions), hides for the session, and shows again in a fresh profile
//   4. a HAND-AUTHORED docs page and its SUMMARY position survive every docs script
//   5. DOCS UNDER APP: the Next bundle contains nothing from docs/ (the app's code never imports it), the served site
//      is the guarded build (.docs-site/ passes scripts/docs-guard.mjs; a SHOW_INTERNAL build would not), and the
//      HTTP contract holds on the pair: /docs -> /docs/, pages 200 with ONE policy whose hashes match the page,
//      internal 404, traversal refused, assets immutable (scripts/lib/docs-probe.mjs)
//  5b. a REAL BROWSER load of /docs/: hydrates under the policy, nav + sidebar + a relative card link navigate through
//      the client router, local search answers, the diagrams load — no console error, no violation, no /api/ call
//   6. the deploy config excludes docs-only changes from a git-triggered build
//   7. the KILL SWITCH: LAYERS_MAINTENANCE=true puts the app into a static 503 (liveness excepted; the docs at /docs
//      included) and the validator into a 503 on every route but /health — a restart, no rebuild
//   8. ABUSE CAP: new identities per address per day on the validator refuse loudly past the cap; the limiter logs
//      an aggregate line and never an address
//   9. LOG GREP: neither process log carries a persona id, a 64-hex key, or a non-loopback address
//  10. the deployed smoke suite passes against this pair (two profiles → two roots, dev routes refused, health signed)
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { isDocsPage, probeDocsBrowser, probeDocsHttp, rawGet, titleOf } from "./lib/docs-probe.mjs";

const require = createRequire(import.meta.url);
const { MUST_NOT_SHIP } = require("../validator/env-contract.js");
const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, init) => { const r = await fetch(url, { cache: "no-store", ...init }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ } return { status: r.status, text, json, retryAfter: r.headers.get("retry-after") }; };
const stamp = Date.now().toString(36).slice(-5);

console.log("\nGate 6 — landing, banner, docs safety, kill switch, abuse caps, log grep, deployed smoke (app " + BASE + ", validator " + VBASE + ")");
const dev = await get(BASE + "/api/dev").catch(() => ({ status: 0 }));
if (dev.status !== 403) {
  console.log("  ABORT: /api/dev answered " + dev.status + " — this suite runs against the PRODUCTION-SHAPED pair (dev hooks off)");
  process.exit(2);
}

// This suite usually runs straight after `test:cu4`, whose whole point is to empty both rate-limit buckets with
// 260- and 340-request bursts from this one address. A device booting into an empty bucket cannot register its
// anchor, so the page would sit on "computing" forever and the failure would be the previous suite's. Wait for the
// refill before measuring anything.
// One non-429 answer proves one token, and booting a device is a burst of a dozen signed writes — so the preflight
// fires a small burst and requires every answer to be clean, which proves a real reserve.
async function waitForRefill() {
  const started = Date.now();
  const deadline = started + 240_000;
  while (Date.now() < deadline) {
    const burst = await Promise.all([
      ...Array.from({ length: 12 }, () => get(BASE + "/api/feed?tab=following").catch(() => ({ status: 0 }))),
      ...Array.from({ length: 12 }, () => get(VBASE + "/zk/members").catch(() => ({ status: 0 }))),
    ]);
    if (burst.every((r) => r.status !== 429 && r.status !== 0)) return Math.round((Date.now() - started) / 1000);
    await sleep(5000);
  }
  throw new Error("the rate-limit buckets never held a reserve within 240 s");
}
const refillSeconds = await waitForRefill();
console.log("  (rate-limit buckets ready after " + refillSeconds + " s)");

const off = Object.fromEntries(MUST_NOT_SHIP.map((n) => [n, ""]));
const pub = { ...process.env, ...off, NODE_ENV: "production", LAYERS_REQUIRE_SIG: "true", CUSTODY_FIXTURE_PROVIDER: "", ZK_DEV_HOOKS: "" };

/** a throwaway process; resolves once its health path answers or it exits */
async function throwaway(args, env, port, healthPath, { expectUp = true } = {}) {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd() });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (out += b));
  const exited = new Promise((r) => child.on("exit", (code) => r(code)));
  for (let i = 0; i < 80; i++) {
    const code = await Promise.race([exited, sleep(500).then(() => undefined)]);
    if (code !== undefined) return { up: false, code, out: () => out, kill: () => {} };
    try {
      const r = await fetch(`http://127.0.0.1:${port}${healthPath}`, { cache: "no-store" });
      if (r.ok) return { up: true, code: null, out: () => out, kill: () => child.kill("SIGKILL") };
    } catch { /* not yet */ }
  }
  child.kill("SIGKILL");
  return { up: false, code: null, out: () => out, timeout: true, kill: () => {} };
}
const appArgs = (port) => ["node_modules/next/dist/bin/next", "start", "-p", String(port)];

// ---------------------------------------------------------------- 1 + 2. the landing
await check("1. LANDING renders with no validator at all: the app door, the honest status, the docs door to /docs — and the same throwaway serves /docs/", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "layers-cu6-"));
  const s = await throwaway(appArgs(3019), { ...pub, LAYERS_APP_PORT: "3019", VALIDATOR_URL: "http://127.0.0.1:4999", NEXT_PUBLIC_VALIDATOR_URL: "http://127.0.0.1:4999", APP_URL: "http://127.0.0.1:3019", KEYSTORE_DIR: dir, NEXT_PUBLIC_DOCS_URL: "" }, 3019, "/api/health");
  try {
    if (!s.up) throw new Error("the throwaway app did not start: " + s.out().slice(-300));
    const r = await get("http://127.0.0.1:3019/");
    if (r.status !== 200) throw new Error("landing " + r.status);
    if (!/Enter the app/.test(r.text)) throw new Error("no app door");
    // DOCS UNDER APP (D-DOCS-UNDER-APP): with NEXT_PUBLIC_DOCS_URL unset the door is there, and it is /docs
    const door = /<a[^>]*data-testid="door-docs"[^>]*>[^<]*</.exec(r.text)?.[0] ?? "";
    if (!door || !/Read the docs/.test(door)) throw new Error("no docs door with NEXT_PUBLIC_DOCS_URL unset (the app serves the docs itself, so the door is unconditional)");
    if (!/href="\/docs"/.test(door) || !/target="_blank"/.test(door)) throw new Error("the docs door is not /docs in a new tab: " + door.slice(0, 200));
    if (!/DEMO — not yet private/.test(r.text) || !/Nothing here is a guarantee/.test(r.text)) throw new Error("the status section lacks the honest wording");
    if (!/data-cite="docs\/mission\/index.md"/.test(r.text)) throw new Error("the mission paragraph is not cited");
    if (/__layersDevice|device\.js/.test(r.text)) throw new Error("the landing page loads the device");
    const d = await rawGet("http://127.0.0.1:3019", "/docs/");
    if (!isDocsPage(d)) throw new Error(`/docs/ on the validator-less app is not the docs home page (${d.status}, title ${JSON.stringify(titleOf(d.body))})`);
    if (/__layersDevice|device\.js/.test(d.body)) throw new Error("the docs page loads the device");
    return "200, " + r.text.length + " bytes, validator dead; door → /docs; /docs/ 200 (" + d.body.length + " bytes)";
  } finally { s.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* held briefly */ } }
});

await check("2. an explicit NEXT_PUBLIC_DOCS_URL still overrides the docs door, in a new tab", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "layers-cu6-"));
  const s = await throwaway(appArgs(3019), { ...pub, LAYERS_APP_PORT: "3019", VALIDATOR_URL: "http://127.0.0.1:4999", NEXT_PUBLIC_VALIDATOR_URL: "http://127.0.0.1:4999", APP_URL: "http://127.0.0.1:3019", KEYSTORE_DIR: dir, NEXT_PUBLIC_DOCS_URL: "https://docs.example.test/layers" }, 3019, "/api/health");
  try {
    if (!s.up) throw new Error("the throwaway app did not start: " + s.out().slice(-300));
    const r = await get("http://127.0.0.1:3019/");
    if (!/Read the docs/.test(r.text)) throw new Error("no docs door");
    if (!/href="https:\/\/docs\.example\.test\/layers"[^>]*target="_blank"/.test(r.text) && !/target="_blank"[^>]*href="https:\/\/docs\.example\.test\/layers"/.test(r.text)) throw new Error("the docs door does not open the configured url in a new tab");
  } finally { s.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* held briefly */ } }
});

// ---------------------------------------------------------------- 3. the banner
const browser = await chromium.launch();
await check("3. the PREVIEW BANNER names the computed label, hides for the session, and shows again in a fresh profile", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const noise = [];
  page.on("console", (m) => noise.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => noise.push("pageerror: " + String(e).slice(0, 200)));
  await page.goto(BASE + "/home", { waitUntil: "load" });
  await page.getByTestId("preview-banner").waitFor({ timeout: 60000 });
  // the banner reports what the DEVICE computed, so wait for the device first: a machine still busy with the
  // previous suite's eight throwaway servers can take a while to boot one, and "still computing" would otherwise
  // read as a product failure rather than a slow boot
  const booted = await page.evaluate(async () => {
    const w = window;
    // DOCS UNDER APP (verify): the device bundle is injected AFTER hydration (DeviceHostMount), so on a cold pair the
    // banner can render before device.js has evaluated; a single read here failed once with "no device api" and an
    // empty console. Poll for the object (it appears as the bundle evaluates) before judging the boot.
    for (let i = 0; i < 240 && !w.__layersDevice; i++) await new Promise((r) => setTimeout(r, 250));
    if (!w.__layersDevice) return "no device api on the page within 60 s";
    try {
      await Promise.race([w.__layersDevice.ready, new Promise((_, r) => setTimeout(() => r(new Error("ready did not settle in 150 s")), 150000))]);
      return "ok";
    } catch (e) {
      return "device boot failed: " + String(e && e.message ? e.message : e).slice(0, 200);
    }
  });
  if (booted !== "ok") throw new Error(booted + " | console: " + noise.slice(-6).join(" ~ "));
  let state = "computing";
  for (let i = 0; i < 120 && state === "computing"; i++) { state = await page.getByTestId("preview-banner").getAttribute("data-state"); if (state === "computing") await sleep(500); }
  if (!["demo", "private"].includes(state)) throw new Error("banner state " + state + " | console: " + noise.slice(-6).join(" ~ "));
  // PERSONA LAUNCH wave 3 (final verify): the device's verdict moves on its first prefetch tick, which since UXH-2 lands
  // seconds after boot (the composer's first read runs it), and the banner computes the label again on every tick
  // (lib/device/bootState.ts ZK_TICK_EVENT). So the banner and a fresh verdict are compared until they agree, for up to
  // 30 s — a banner that keeps a count the device no longer holds (no recompute) never agrees and still fails here.
  let text = "";
  let verdict = null;
  let failing = 0;
  for (let i = 0; i < 60; i++) {
    state = await page.getByTestId("preview-banner").getAttribute("data-state");
    text = await page.getByTestId("preview-banner").innerText();
    verdict = await page.evaluate(async () => (await fetch("/api/zk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "privacyConditions" }) })).json());
    failing = verdict.conditions.filter((c) => !c.ok).length;
    const m = /(\d+) of (\d+) privacy conditions fail/.exec(text);
    const agrees = state === "private" ? verdict.private === true : state === "demo" && !verdict.private && !!m && Number(m[1]) === failing && Number(m[2]) === verdict.conditions.length;
    if (agrees) break;
    await sleep(500);
  }
  if (state === "demo") {
    if (verdict.private) throw new Error("the device says private but the banner says demo");
    const m = /(\d+) of (\d+) privacy conditions fail/.exec(text);
    if (!m || Number(m[1]) !== failing || Number(m[2]) !== verdict.conditions.length) throw new Error("banner counts " + (m ? m[1] + "/" + m[2] : "none") + " vs computed " + failing + "/" + verdict.conditions.length);
  } else if (!verdict.private) throw new Error("the banner says private but the device computed " + failing + " failing conditions");
  await page.getByRole("button", { name: /Hide the preview banner/ }).click();
  if (await page.getByTestId("preview-banner").count()) throw new Error("the banner did not hide");
  await page.reload({ waitUntil: "load" });
  await sleep(1500);
  if (await page.getByTestId("preview-banner").count()) throw new Error("the banner came back within the session");
  await ctx.close();
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + "/home", { waitUntil: "load" });
  await p2.getByTestId("preview-banner").waitFor({ timeout: 60000 });
  await ctx2.close();
  return "state " + state + ", " + failing + "/" + verdict.conditions.length + " failing";
});
await browser.close();

// ---------------------------------------------------------------- 4. the owner's page survives the docs scripts
await check("4. a hand-authored docs page and its SUMMARY position survive docs:generate, docs:summary and docs:check", async () => {
  const notes = path.join("docs", "notes");
  mkdirSync(notes, { recursive: true });
  const page = path.join(notes, "zz-cu6-" + stamp + ".md");
  const summary = path.join("docs", "SUMMARY.md");
  if (!existsSync(summary)) throw new Error("docs/SUMMARY.md is missing — run docs:summary once");
  const before = readFileSync(summary, "utf8");
  const body = "# Hand-authored note " + stamp + "\n<!-- uncited-ok: page — an owner note written by hand -->\n\nThis page was written by hand. No script may rewrite, reorder or delete it.\n";
  writeFileSync(page, body);
  const lines = before.replace(/\r\n/g, "\n").split("\n");
  const at = Math.min(3, lines.length);
  lines.splice(at, 0, `* [Hand-authored note ${stamp}](notes/zz-cu6-${stamp}.md)`);
  writeFileSync(summary, lines.join("\n"));
  try {
    const gen = spawnSync(process.execPath, ["scripts/docs-generate.mjs"], { encoding: "utf8", timeout: 120_000 });
    const sum = spawnSync(process.execPath, ["scripts/docs-summary.mjs"], { encoding: "utf8", timeout: 60_000 });
    const chk = spawnSync(process.execPath, ["scripts/docs-check.mjs"], { encoding: "utf8", timeout: 180_000 });
    if (readFileSync(page, "utf8") !== body) throw new Error("the page was rewritten");
    // what must hold: every line that was there before is still there, in order, at the same index. New pages may
    // only be APPENDED, so the old content is a prefix of the new (trailing blank lines are not content).
    const trim = (a) => { const b = [...a]; while (b.length && b[b.length - 1] === "") b.pop(); return b; };
    const after = trim(readFileSync(summary, "utf8").replace(/\r\n/g, "\n").split("\n"));
    const beforeLines = trim(lines);
    if (after[at] !== beforeLines[at]) throw new Error("the SUMMARY line moved or changed: " + after[at]);
    for (let i = 0; i < beforeLines.length; i++) if (after[i] !== beforeLines[i]) throw new Error("SUMMARY changed above the appended section at line " + (i + 1) + ": " + JSON.stringify(after[i]) + " was " + JSON.stringify(beforeLines[i]));
    return "generate exit " + gen.status + ", summary exit " + sum.status + ", check exit " + chk.status + " — page and position untouched";
  } finally {
    writeFileSync(summary, before);
    try { unlinkSync(page); } catch { /* already gone */ }
  }
});

// ---------------------------------------------------------------- 5. the docs, under the app
// DOCS UNDER APP (D-DOCS-UNDER-APP, superseding D-CU-6's "the app never builds or serves docs/"): `npm run build` now
// builds the public docs into .docs-site/ and the app serves them at /docs. What still holds from D-CU-6 is that the
// app's CODE never imports docs/ — the Next bundle carries no docs page; the docs are static files beside it.
await check("5. DOCS UNDER APP: no docs source in the Next bundle; the served site is the guarded build (an internal build fails the guard); the HTTP contract holds on this pair", async () => {
  const needle = "GENERATED by scripts/docs-generate.mjs";
  const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { const p = path.join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(js|html|json|txt|css)$/.test(n)) out.push(p); } return out; };
  let scanned = 0;
  for (const dir of [".next/server", ".next/static"]) {
    if (!existsSync(dir)) throw new Error(dir + " is missing — build first");
    for (const f of walk(dir)) { scanned++; if (readFileSync(f, "latin1").includes(needle)) throw new Error("a docs page reached the Next bundle: " + f); }
  }
  const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8").replace(/\/\/.*$/gm, ""));
  if (!(tsconfig.exclude ?? []).some((e) => /docs/.test(e))) throw new Error("tsconfig does not exclude docs/");
  // the build the app serves passes the guard, and the app serves exactly it (byte for byte)
  if (!existsSync(".docs-site/index.html")) throw new Error(".docs-site/index.html is missing — npm run build builds the docs");
  const guard = spawnSync(process.execPath, ["scripts/docs-guard.mjs"], { encoding: "utf8", timeout: 120_000 });
  if (guard.status !== 0) throw new Error("the served build fails its own guard: " + (guard.stdout + guard.stderr).trim().slice(-300));
  const served = await rawGet(BASE, "/docs/");
  if (served.body !== readFileSync(".docs-site/index.html", "utf8")) throw new Error("/docs/ is not .docs-site/index.html byte for byte — the app serves something other than the guarded build");
  // not vacuous: a build WITH the internal pages, into a scratch folder, must FAIL the same guard
  const tmp = mkdtempSync(path.join(tmpdir(), "layers-cu6-docs-"));
  try {
    const vp = path.join(path.dirname(require.resolve("vitepress/package.json")), "bin", "vitepress.js");
    const b = spawnSync(process.execPath, [vp, "build", "docs", "--outDir", tmp], { encoding: "utf8", timeout: 300_000, env: { ...process.env, SHOW_INTERNAL: "1" } });
    if (b.status !== 0) throw new Error("the SHOW_INTERNAL=1 scratch build failed: " + (b.stderr || b.stdout).slice(-300));
    const bad = spawnSync(process.execPath, ["scripts/docs-guard.mjs", tmp], { encoding: "utf8", timeout: 120_000 });
    if (bad.status === 0 || !/internal/i.test(bad.stdout + bad.stderr)) throw new Error("the guard PASSED a build with the internal pages: " + (bad.stdout + bad.stderr).trim().slice(-200));
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* held briefly */ } }
  const http = await probeDocsHttp(BASE);
  return `${scanned} Next build files clean; guard passes the served build and refuses an internal one; ${http}`;
});

await check("5b. a REAL BROWSER load of /docs/: hydrates under the policy; nav, sidebar and a relative card link navigate client-side; search answers; diagrams load; no console error, no violation, no /api/ call", async () => {
  const b = await chromium.launch();
  try {
    return await probeDocsBrowser(b, BASE);
  } finally {
    await b.close();
  }
});

// ---------------------------------------------------------------- 6. deploy config
await check("6. the deploy config excludes docs-only changes from a git-triggered build", async () => {
  const toml = readFileSync("railway.toml", "utf8");
  for (const p of ["!docs/**", "!**/*.md", "!.gitbook/**"]) if (!toml.includes(JSON.stringify(p))) throw new Error("railway.toml watchPatterns lack " + p);
  if (!readFileSync("notes/runbooks/CONNECTING-GITBOOK.md", "utf8").includes("README")) throw new Error("the connection doc lacks the README warning");
  if (!existsSync(".gitbook.yaml")) throw new Error(".gitbook.yaml is missing");
});

// ---------------------------------------------------------------- 7. the kill switch
await check("7. KILL SWITCH: LAYERS_MAINTENANCE=true → a static 503 on the app (liveness excepted; the docs at /docs included) and on every validator route but /health", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "layers-cu6-"));
  const s = await throwaway(appArgs(3019), { ...pub, LAYERS_MAINTENANCE: "true", LAYERS_APP_PORT: "3019", VALIDATOR_URL: VBASE, NEXT_PUBLIC_VALIDATOR_URL: VBASE, APP_URL: "http://127.0.0.1:3019", KEYSTORE_DIR: dir }, 3019, "/api/health");
  const v = await throwaway(["validator/server.js"], { ...pub, LAYERS_MAINTENANCE: "true", LAYERS_VALIDATOR_PORT: "4019", VALIDATOR_DB: path.join(dir, "v.db") }, 4019, "/health");
  try {
    if (!s.up) throw new Error("the app did not start under maintenance: " + s.out().slice(-300));
    if (!v.up) throw new Error("the validator did not start under maintenance: " + v.out().slice(-300));
    const home = await get("http://127.0.0.1:3019/home");
    if (home.status !== 503 || !/maintenance/i.test(home.text) || !home.retryAfter) throw new Error("/home under maintenance answered " + home.status + (home.retryAfter ? "" : " without Retry-After"));
    const api = await get("http://127.0.0.1:3019/api/feed?tab=following");
    if (api.status !== 503) throw new Error("/api/feed under maintenance answered " + api.status);
    const landing = await get("http://127.0.0.1:3019/");
    if (landing.status !== 503) throw new Error("/ under maintenance answered " + landing.status);
    // DOCS UNDER APP: the docs are the app's now, so the kill switch pauses them with everything else
    const docs = await get("http://127.0.0.1:3019/docs/");
    if (docs.status !== 503 || !/maintenance/i.test(docs.text)) throw new Error("/docs/ under maintenance answered " + docs.status);
    const health = await get("http://127.0.0.1:3019/api/health");
    if (health.status !== 200) throw new Error("liveness under maintenance answered " + health.status);
    const vm = await get("http://127.0.0.1:4019/zk/members");
    if (vm.status !== 503) throw new Error("validator route under maintenance answered " + vm.status);
    const vh = await get("http://127.0.0.1:4019/health");
    if (vh.status !== 200) throw new Error("validator liveness under maintenance answered " + vh.status);
  } finally { s.kill(); v.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* held briefly */ } }
});

// ---------------------------------------------------------------- 8. abuse caps
await check("8. ABUSE CAP: new identities per address per day refuse loudly past the cap; the limiter logs an aggregate, never an address", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "layers-cu6-"));
  const v = await throwaway(["validator/server.js"], { ...pub, LAYERS_VALIDATOR_PORT: "4019", VALIDATOR_DB: path.join(dir, "v.db"), VALIDATOR_NEW_ROOTS_PER_ADDRESS_PER_DAY: "5" }, 4019, "/health");
  try {
    if (!v.up) throw new Error("the validator did not start: " + v.out().slice(-300));
    const { randomBytes } = await import("node:crypto");
    const { ed25519 } = await import("@noble/curves/ed25519");
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const pub = Buffer.from(ed25519.getPublicKey(randomBytes(32))).toString("hex");
      const r = await get("http://127.0.0.1:4019/device/auth-anchor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pubkey: pub }) });
      statuses.push(r.status + (r.status === 429 ? ":" + String(r.json?.error ?? "").slice(0, 40) : ""));
      if (i < 5 && r.status !== 201) throw new Error("registration " + (i + 1) + " answered " + r.status);
      if (i >= 5 && r.status !== 429) throw new Error("registration " + (i + 1) + " past the cap answered " + r.status);
      if (i >= 5 && !/cap|daily/i.test(String(r.json?.error ?? ""))) throw new Error("the refusal is not loud: " + JSON.stringify(r.json));
    }
    await sleep(2500); // the aggregate line is scheduled a second after the burst's first refusal
    const out = v.out();
    if (!/\[caps\]/.test(out)) throw new Error("no aggregate cap line in the validator log");
    if (/127\.0\.0\.1|::1|::ffff/.test(out.split("\n").filter((l) => /\[caps\]|\[ratelimit\]/.test(l)).join("\n"))) throw new Error("the cap log line carries an address");
    return statuses.join(" ");
  } finally { v.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* held briefly */ } }
});

// ---------------------------------------------------------------- 9. log grep
await check("9. LOG GREP: no persona id, no 64-hex key, no non-loopback address in either process log", async () => {
  const logs = [process.env.TEMP + "/layers-app.log", process.env.TEMP + "/layers-validator.log"].filter((f) => f && existsSync(f));
  if (!logs.length) throw new Error("no process logs found under TEMP");
  let lines = 0;
  for (const f of logs) {
    const text = readFileSync(f, "latin1");
    lines += text.split("\n").length;
    if (/persona_[0-9a-f]{12,}/.test(text)) throw new Error("a persona id is in " + f);
    if (/\b[0-9a-f]{64}\b/.test(text)) throw new Error("a 64-hex key is in " + f);
    const ips = [...text.matchAll(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g)].map((m) => m[1]).filter((ip) => !/^(127\.|0\.0\.0\.0|10\.|172\.|192\.168\.)/.test(ip) && !/^\d+\.\d+\.\d+$/.test(ip));
    if (ips.length) throw new Error("a non-loopback address is in " + f + ": " + ips[0]);
  }
  return lines + " log lines clean";
});

// ---------------------------------------------------------------- 10. the deployed smoke, locally
await check("10. the deployed smoke suite passes against this pair", async () => {
  // FC-READ (lead): the validator's per-address token bucket (validator/server.js: 300 of burst, 5/s refill) is SHARED
  // by every local suite, because on a laptop every request comes from one loopback address. This suite's own browser
  // checks drain it, and the smoke's fresh profiles (about 49 validator calls per device boot) then met 429s — a
  // harness interference a deployed smoke never has (each visitor is its own bucket). A minute refills the bucket.
  await sleep(65_000);
  const r = spawnSync(process.execPath, ["scripts/smoke-deployed.mjs"], { encoding: "utf8", env: { ...process.env, BASE_URL: BASE, VALIDATOR_URL: VBASE }, timeout: 300_000 });
  const last = (r.stdout || "").trim().split("\n").pop();
  if (r.status !== 0) throw new Error("exit " + r.status + ": " + (r.stdout + r.stderr).split("\n").filter((l) => /FAIL/.test(l)).join(" | ").slice(0, 400));
  return last;
});

const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} Gate 6 checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
