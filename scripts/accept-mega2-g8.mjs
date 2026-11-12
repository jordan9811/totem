// MEGA PASS 2 Gate 8 — THE DOCS SITE. No app process is involved: this gate is the handbook, its tooling and its build.
//
//   1. GENERATED FROM SOURCE: docs:generate rewrites the adapters/scopes/data-model pages and they name every adapter
//      interface, every claim kind, and every sealed namespace the source declares (counts equal, not "some")
//   2. EVERY SECTION EXISTS: the brief's sections and pages are all present; deferred pages carry a visible STATUS: stub
//      banner (source and built HTML)
//   3. HISTORICAL PAGES: one pass page per REPORT-*.md through the pass before the most recent one, each citing its
//      report; the most recent pass and this pass are STUBS only
//   4. docs:check GREEN — and it FAILS on a planted uncited privacy claim (the check is not vacuous)
//   5. docs:sync CLEAN — and it DETECTS a deliberately edited cited section (planted, then restored)
//   6. BUILD, INTERNAL HIDDEN: the site builds; without SHOW_INTERNAL no internal page is emitted and no nav/sidebar link
//      names /internal/ (under any base — DOCS UNDER APP serves the site at /docs/, so a link reads /docs/internal/);
//      with SHOW_INTERNAL=1 the internal pages are emitted
//   7. ROADMAP: served on the pinned docs port (under the base, /docs/), the status filters and area filters work in a
//      real browser and every count on the page equals a fresh recount of the tagged bullets across the pass pages
//   8. APP UNTOUCHED: nothing under app/, lib/, components/ or validator/ imports the docs tooling; dev, start and
//      validator are the strings the previous commit had. DOCS UNDER APP (D-DOCS-UNDER-APP): `build` is the one
//      documented chain — the device bundle, the public docs build, the docs guard, next build — and it never runs
//      docs:generate, docs:check or docs:sync (a citation drift must not block an app deploy)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { chromium } from "playwright";

const DOCS_PORT = Number(process.env.LAYERS_DOCS_PORT || 3011);
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const run = (cmd, args, env = {}) => spawnSync(cmd, args, { shell: true, encoding: "utf8", env: { ...process.env, ...env }, windowsHide: true });
const DIST = join("docs", ".vitepress", "dist");
// DOCS UNDER APP: the site's base (docs/.vitepress/config.mts); the preview server serves under it too
const BASE = "/docs/";
const APP_BUILD = "node scripts/build-device.mjs && node scripts/build-docs.mjs && node scripts/docs-guard.mjs && next build";
const walkFiles = (dir, out = []) => { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walkFiles(p, out); else out.push(p); } return out; };

console.log("\nMega pass 2 Gate 8 — the docs site: generated pages, sections, history, check + sync, build with the internal flag, roadmap filters");

await check("1. GENERATED FROM SOURCE: docs:generate names every adapter interface, claim kind and sealed namespace the source declares", async () => {
  const g = run("node", ["scripts/docs-generate.mjs"]);
  if (g.status !== 0) throw new Error("docs:generate failed: " + (g.stderr || g.stdout).slice(-300));
  const ifaces = [...rd("lib/adapters/types.ts").matchAll(/^export interface (\w+Adapter)\s*\{/gm)].map((m) => m[1]);
  const adaptersPage = rd("docs/technical/adapters.md");
  for (const i of ifaces) if (!adaptersPage.includes("### " + i)) throw new Error("adapters page lacks " + i);
  const claims = [...(/const SCOPE_FOR_CLAIM[^{]*\{([\s\S]*?)\};/.exec(rd("lib/zk/prove.ts"))?.[1] ?? "").matchAll(/"?([\w-]+)"?\s*:\s*"/g)].map((m) => m[1]);
  const scopes = rd("docs/technical/scopes.md");
  if (claims.length < 3) throw new Error("could not read the claim registry from source");
  for (const c of claims) if (!scopes.includes("`" + c + "`")) throw new Error("scopes page lacks claim " + c);
  const sealed = [...(/VAULT_NAMESPACES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(rd("lib/vault/vault.ts"))?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
  const dm = rd("docs/technical/data-model.md");
  if (sealed.length < 10) throw new Error("could not read the sealed namespace list from source");
  if (!dm.includes(`## Sealed namespaces (${sealed.length})`)) throw new Error("data-model page's sealed count is not the source's " + sealed.length);
  for (const n of sealed) if (!dm.includes("- `" + n + "`")) throw new Error("data-model page lacks sealed namespace " + n);
  for (const p of ["docs/technical/adapters.md", "docs/technical/scopes.md", "docs/technical/data-model.md"]) if (!rd(p).startsWith("<!-- GENERATED")) throw new Error(p + " lacks the generated banner");
});

const REQUIRED = [
  "docs/index.md", "docs/mission/index.md", "docs/mission/morpho-not-aave.md",
  ...["root-and-personas", "disclosure-and-grants", "forking", "reputation-and-ubi", "attestations", "lenses"].map((s) => `docs/concepts/${s}.md`),
  ...["index", "modes-and-rules", "algorithms-and-lenses", "feed-health", "social-surfaces", "curators", "relationship-history", "context-graph", "ad-market", "interop", "network-identities", "influence-and-search"].map((s) => `docs/features/${s}.md`),
  ...["threat-model", "what-is-hidden", "operator", "label-semantics", "assumptions", "not-doing"].map((s) => `docs/privacy/${s}.md`),
  ...["architecture", "adapters", "key-hierarchy", "zk-layer", "scopes", "issuers", "data-model", "testing", "running"].map((s) => `docs/technical/${s}.md`),
  ...["index", "roadmap", "open-issues", "assumptions", "needs-a-call", "passes/index"].map((s) => `docs/internal/${s}.md`),
  "notes/runbooks/CONTRIBUTING-DOCS.md",
  // the docs rewrite's three tracks (Start here, How it works underneath, For developers), the new feature pages, the
  // privacy index the app's banner links to, and the public roadmap board: kept as required pages from here on
  ...["index", "first-5-minutes", "personas", "who-sees-what", "farcaster", "bring-your-x", "privacy-in-plain-words", "faq", "glossary"].map((s) => `docs/start/${s}.md`),
  ...["personas", "saving-and-recovery", "search", "anon-posting", "who-sees-what"].map((s) => `docs/features/${s}.md`),
  ...["index", "key-hierarchy", "custody", "zk-membership", "anon-relay", "linkage-and-disclosure", "reputation-and-stakes", "ad-market", "attestations", "read-relay", "trust-assumptions"].map((s) => `docs/mechanism/${s}.md`),
  ...["code-map", "data-flows", "env", "deploy", "tradeoffs"].map((s) => `docs/technical/${s}.md`),
  "docs/privacy/index.md", "docs/roadmap/index.md",
];
await check("2. EVERY SECTION EXISTS: mission, concepts, features, privacy, technical, internal — and every deferred page carries a visible STATUS: stub banner", async () => {
  const missing = REQUIRED.filter((p) => !existsSync(p));
  if (missing.length) throw new Error("missing: " + missing.join(", "));
  const stubs = walkFiles("docs").filter((p) => p.endsWith(".md") && !p.includes(".vitepress") && rd(p).includes("STATUS: stub"));
  if (stubs.length < 2) throw new Error("expected at least the two stub pass pages, found " + stubs.length);
  for (const s of stubs) if (!/::: warning STATUS: stub/.test(rd(s))) throw new Error(s + " has a stub marker that is not a visible banner container");
});

await check("3. HISTORICAL PAGES: one pass page per prior REPORT-*.md, each citing its report; the most recent pass and this pass are stubs", async () => {
  const reports = readdirSync("notes/reports").filter((f) => /^REPORT(-[A-Z0-9]+)?\.md$/.test(f)).sort().map((f) => "notes/reports/" + f);
  const pages = readdirSync("docs/internal/passes").filter((f) => /^\d\d-.*\.md$/.test(f)).map((f) => ({ f, text: rd("docs/internal/passes/" + f) }));
  const byReport = new Map(pages.map((p) => [/^report:\s*(.*)$/m.exec(p.text)?.[1]?.trim(), p]));
  // the rolling convention: full pages through the pass BEFORE the most recent one; the most recent closed pass and
  // the current pass are stubs. Each pass writes up the one that has receded past that pair (the browser-keystore
  // pass wrote 15-multi-fid; notes/reports/REPORT-FID.md left this list then. The post-deploy pass wrote 16-mega-2, and
  // notes/reports/REPORT-MEGA2.md left the list in turn — the pair rolls forward by one every pass, which is the point of it).
  const stubsExpected = ["notes/reports/REPORT-CUSTODY.md", "notes/reports/REPORT-POST.md"];
  for (const r of reports) {
    const p = byReport.get(r);
    if (!p) throw new Error("no pass page names " + r);
    const isStub = p.text.includes("STATUS: stub");
    if (stubsExpected.includes(r) !== isStub) throw new Error(`${r}: stub=${isStub}, expected ${stubsExpected.includes(r)}`);
    const cites = (p.text.match(/\{cite:/g) ?? []).length;
    if (!isStub && cites < 20) throw new Error(`${p.f} cites its report only ${cites} times`);
    if (!p.text.includes("{cite: " + r)) throw new Error(`${p.f} never cites ${r}`);
    for (const h of ["## What shipped", "## What it found", "## Judgment calls", "## Verification result", "## Assumptions and open items"]) if (!isStub && !p.text.includes(h)) throw new Error(`${p.f} lacks section ${h}`);
  }
  if (reports.length < 17) throw new Error("expected 17 reports, found " + reports.length);
});

await check("4. docs:check GREEN — and it FAILS on a planted uncited privacy claim", async () => {
  const r = run("node", ["scripts/docs-check.mjs"]);
  if (r.status !== 0) throw new Error("docs:check is not green: " + r.stdout.split("\n").filter((l) => l.includes("FAIL")).slice(0, 3).join(" | "));
  const plant = "docs/concepts/_plant-g8.md";
  writeFileSync(plant, "# plant\n\nThe validator never learns anything about anyone.\n");
  try {
    const p = run("node", ["scripts/docs-check.mjs"]);
    if (p.status === 0) throw new Error("docs:check accepted an uncited privacy claim");
    if (!p.stdout.includes("_plant-g8.md") || !p.stdout.includes("privacy claim without a citation")) throw new Error("docs:check failed for the wrong reason: " + p.stdout.slice(-200));
  } finally { rmSync(plant, { force: true }); }
});

await check("5. docs:sync CLEAN — and it DETECTS a deliberately edited cited section (planted, then restored)", async () => {
  const r = run("node", ["scripts/docs-sync.mjs"]);
  if (r.status !== 0) throw new Error("docs:sync is not clean: " + r.stdout.split("\n").filter((l) => /DRIFT|UNLOCKED|MISSING/.test(l)).slice(0, 3).join(" | "));
  const file = "ARCHITECTURE.md";
  const original = readFileSync(file);
  const text = original.toString("utf8");
  const at = text.indexOf("## Registry");
  if (at < 0) throw new Error("ARCHITECTURE.md has no Registry section to edit");
  const eol = text.indexOf("\n", at);
  writeFileSync(file, text.slice(0, eol + 1) + "\nA deliberately planted sentence for the docs:sync drift test.\n" + text.slice(eol + 1));
  try {
    const d = run("node", ["scripts/docs-sync.mjs"]);
    if (d.status === 0) throw new Error("docs:sync did not flag the edited section");
    if (!/DRIFT\s+ARCHITECTURE\.md > Registry/.test(d.stdout)) throw new Error("drift was not attributed to ARCHITECTURE.md > Registry: " + d.stdout.slice(-200));
  } finally { writeFileSync(file, original); }
  const back = run("node", ["scripts/docs-sync.mjs"]);
  if (back.status !== 0) throw new Error("docs:sync not clean after the restore");
});

let builtInternal = false;
await check("6. BUILD, INTERNAL HIDDEN: the site builds; without SHOW_INTERNAL no internal page and no /internal/ link is emitted; with SHOW_INTERNAL=1 they are", async () => {
  rmSync(DIST, { recursive: true, force: true });
  const b = run("npx", ["vitepress", "build", "docs"], { SHOW_INTERNAL: "" });
  if (b.status !== 0) throw new Error("build failed: " + (b.stderr || b.stdout).slice(-400));
  if (!existsSync(join(DIST, "index.html"))) throw new Error("no index.html in dist");
  if (existsSync(join(DIST, "internal"))) throw new Error("internal pages were emitted without the flag");
  const html = walkFiles(DIST).filter((p) => p.endsWith(".html"));
  // any href that ends up in internal/, whatever the base in front of it (/internal/ once, /docs/internal/ now)
  for (const p of html) if (/href="[^"]*\/internal\//.test(readFileSync(p, "utf8"))) throw new Error(p + " links into /internal/ without the flag");
  if (!html.some((p) => readFileSync(p, "utf8").includes('href="' + BASE))) throw new Error("no page links under the base " + BASE + " — the internal-link scan would be blind to a base change");
  const stubHtml = html.find((p) => /features[\\/]index\.html$/.test(p));
  if (!stubHtml) throw new Error("features index not built");
  rmSync(DIST, { recursive: true, force: true });
  const b2 = run("npx", ["vitepress", "build", "docs"], { SHOW_INTERNAL: "1" });
  if (b2.status !== 0) throw new Error("internal build failed: " + (b2.stderr || b2.stdout).slice(-400));
  for (const p of ["internal/index.html", "internal/roadmap.html", "internal/open-issues.html", "internal/passes/16-mega-2.html"]) if (!existsSync(join(DIST, p))) throw new Error("internal build lacks " + p);
  // The stub pair ROLLS every pass, so the page this asserts on cannot be a fixed name:
  // 16-mega-2 was the stub when this check was written and is a full page now. Find the
  // pages that actually carry the marker in source and assert the banner survived the build.
  const stubSources = walkFiles(join("docs", "internal", "passes")).filter((p) => p.endsWith(".md") && rd(p).includes("STATUS: stub"));
  if (!stubSources.length) throw new Error("no pass page carries a stub marker at all");
  for (const src of stubSources) {
    const name = basename(src, ".md");
    const built = join(DIST, "internal", "passes", name + ".html");
    if (!existsSync(built)) throw new Error("internal build lacks internal/passes/" + name + ".html");
    if (!readFileSync(built, "utf8").includes("STATUS: stub")) throw new Error("the stub banner is not in the built HTML for " + name);
  }
  builtInternal = true;
});

await check("7. ROADMAP: on the pinned docs port the status and area filters work in a browser and every count equals a fresh recount of the tagged bullets", async () => {
  if (!builtInternal) throw new Error("no internal build to serve");
  const data = JSON.parse(rd("docs/internal/roadmap-data.json"));
  // the independent recount: tagged bullets across the pass pages + the seeded extras
  const vocab = data.statuses;
  const recount = {};
  for (const f of readdirSync("docs/internal/passes").filter((x) => /^\d\d-.*\.md$/.test(x))) for (const m of rd("docs/internal/passes/" + f).matchAll(/^\s*[-*]\s+\*\*\[([A-Z-]+)\]\*\*/gm)) if (vocab.includes(m[1])) recount[m[1]] = (recount[m[1]] ?? 0) + 1;
  for (const e of JSON.parse(rd("docs/internal/roadmap-extra.json"))) recount[e.status] = (recount[e.status] ?? 0) + 1;
  for (const s of vocab) if ((recount[s] ?? 0) !== (data.counts[s] ?? 0)) throw new Error(`roadmap-data ${s}=${data.counts[s] ?? 0} but the pages hold ${recount[s] ?? 0}`);
  const srv = spawn("npx", ["vitepress", "preview", "docs", "--port", String(DOCS_PORT)], { shell: true, windowsHide: true, stdio: "ignore" });
  const killTree = () => { try { spawnSync("taskkill", ["/PID", String(srv.pid), "/T", "/F"], { windowsHide: true }); } catch {} };
  let browser = null;
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(`http://127.0.0.1:${DOCS_PORT}${BASE}`); up = r.status === 200; } catch {} if (!up) await sleep(500); }
    if (!up) throw new Error("docs preview never came up on " + DOCS_PORT);
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${DOCS_PORT}${BASE}internal/roadmap`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="roadmap-items"] tbody tr', { timeout: 20_000 });
    const buttons = await page.$$eval('[data-testid="roadmap-status-filters"] button', (bs) => bs.map((b) => b.textContent.trim()));
    for (const s of vocab) {
      const b = buttons.find((t) => t.startsWith(s + " "));
      if (!b) throw new Error("no filter button for " + s);
      const n = Number(b.split("·").pop().trim());
      if (n !== (recount[s] ?? 0)) throw new Error(`button ${s} shows ${n}, recount ${recount[s] ?? 0}`);
    }
    const total = await page.$$eval('[data-testid="roadmap-items"] tbody tr', (rs) => rs.length);
    if (total !== data.items.length) throw new Error(`rows ${total} != items ${data.items.length}`);
    await page.click('[data-testid="roadmap-status-filters"] button[data-status="KNOWN-BROKEN"]');
    await sleep(200);
    const kb = await page.$$eval('[data-testid="roadmap-items"] tbody tr[data-status="KNOWN-BROKEN"]', (rs) => rs.length);
    if (kb !== 0) throw new Error("KNOWN-BROKEN rows still shown after toggling the status off");
    const afterStatus = await page.$$eval('[data-testid="roadmap-items"] tbody tr', (rs) => rs.length);
    if (afterStatus !== total - (recount["KNOWN-BROKEN"] ?? 0)) throw new Error("status filter removed the wrong number of rows");
    const areas = data.areas;
    await page.click(`[data-testid="roadmap-area-filters"] button[data-area="${areas[0]}"]`);
    await sleep(200);
    const areaRows = await page.$$eval(`[data-testid="roadmap-items"] tbody tr[data-area="${areas[0]}"]`, (rs) => rs.length);
    if (areaRows !== 0) throw new Error("area filter did not hide its rows");
    const distRows = await page.$$eval('[data-testid="roadmap-distance"] tbody tr', (rs) => rs.length);
    if (distRows !== 6) throw new Error("distance-to-end-product view has " + distRows + " concept rows, expected 6");
    if (!(await page.textContent("body")).includes("Distance to end product")) throw new Error("distance view heading missing");
  } finally {
    if (browser) await browser.close();
    killTree();
  }
});

await check("8. APP UNTOUCHED: nothing under app/, lib/, components/ or validator/ imports the docs tooling; dev/start/validator are the previous commit's; build is the documented chain and runs no docs:generate/check/sync", async () => {
  const offenders = [];
  for (const dir of ["app", "lib", "components", "validator"]) for (const p of walkFiles(dir)) if (/\.(ts|tsx|js|mjs)$/.test(p) && /docs-(check|sync|generate)|vitepress/.test(readFileSync(p, "utf8"))) offenders.push(p);
  if (offenders.length) throw new Error("app code references the docs tooling: " + offenders.join(", "));
  const pkg = JSON.parse(rd("package.json"));
  const prev = run("git", ["show", "HEAD:package.json"]);
  if (prev.status === 0) {
    const old = JSON.parse(prev.stdout);
    for (const k of ["dev", "start", "validator"]) if (old.scripts?.[k] && old.scripts[k] !== pkg.scripts[k]) throw new Error(`package.json script ${k} changed by the docs gate`);
  }
  // DOCS UNDER APP: the build is exactly the documented chain (device, public docs, guard, next) — never the citation
  // gates, which stay in the verification routine
  if (pkg.scripts.build !== APP_BUILD) throw new Error("package.json build is " + JSON.stringify(pkg.scripts.build) + ", want " + JSON.stringify(APP_BUILD));
  if (/docs:(generate|check|sync)|docs-(generate|check|sync)\.mjs/.test(pkg.scripts.build)) throw new Error("the app build runs a docs citation gate");
  for (const k of ["docs:generate", "docs:dev", "docs:build", "docs:check", "docs:sync"]) if (!pkg.scripts[k]) throw new Error("package.json lacks " + k);
});

const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${passed}/${results.length} Mega pass 2 Gate 8 (docs site) checks passed${failed ? `, ${failed} FAILED` : ""}`);
process.exitCode = failed ? 1 : 0;
