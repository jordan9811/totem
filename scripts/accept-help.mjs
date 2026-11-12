// HELP — the in-app Help page ("How Totem works", app/help/page.tsx), measured in a real browser. It runs on BOTH
// shapes, once each, and reads which one it is facing from GET /api/dev (403: the production-shaped pair, where the
// browser device answers /api/*; 200: the rig, where the server does):
//
//   rig:         BASE_URL=http://localhost:3001 node scripts/accept-help.mjs     (the rig launcher, att-run.sh)
//   prod shape:  bash scripts/run-prod-shape.sh scripts/accept-help.mjs         (docs/internal/prodlive-testing.md)
//
// ABORTS (exit 2) on anything else, e.g. the owner service, whose gate answers 401: this suite drives pages as a
// visitor and has no passphrase. DOCS UNDER APP (D-DOCS-UNDER-APP): the app serves the docs itself at /docs, so the
// docs door is ALWAYS there and goes to /docs unless the deployment's NEXT_PUBLIC_DOCS_URL overrides it.
// EXPECT_DOCS_URL pins that override (set it to the value the deployment carries); unset or empty, the door must be
// "/docs" exactly, and /docs must answer the docs on this app.
//
//   1. STATUS FILE: lib/status/features.ts's three JSON blocks parse; ids are unique; every status is a legend value;
//      no pitch row is "designed" (every unbuilt part of the pitch is "Coming soon"); no "off" row whose note says the
//      site does not offer it (that is "na", Not offered here); no em dash in the entries
//   2. /help IS THE HELP PAGE: 200, data-testid=help-page (never app/(main)/[handle]'s profile page), its data-surface
//      is this shape's ("public" on the pair, "owner" on the rig), and the HTML carries no device bundle
//   3. EVERY STATUS ROW COMES FROM THE FILE: the rows on /help are exactly the file's features (no extra, none
//      missing, file order inside each group), each row's status, name, note and other-site status are the file's,
//      the groups follow the legend's order, every chip's words are its legend label, and the picture's chips agree
//   4. CITES: every data-cite on /help and on the landing names a file that exists and, for "FILE > heading", a
//      heading that exists in it verbatim; and the landing's status sentences appear word for word on /help
//   5. LANDING + DOCS DOOR (DOCS UNDER APP): the landing carries landing-help (href /help, never "Read the docs") and
//      ALWAYS the docs door: door-docs, "Read the docs", href /docs (or the pinned override), a new tab; /help agrees
//      (help-docs to the same href in a new tab, and no "not published yet" line); and the door LEADS somewhere real:
//      /docs answers 308 to /docs/, which is the docs home page served by this app (docs-probe isDocsPage)
//   6. NO MINT, NO NAG: a fresh visitor who opens /help directly, and one who follows landing-help from "/", gets the
//      page with no device bundle loaded, no device object, no new root on the validator, no unsaved-identity nudge,
//      no preview banner and no device status (the rig: no nudge, no banner)
//   7. REACHABLE BY SOFT NAVIGATION from /home, on ONE identity: the rail's nav-help, the More menu's more-help, the
//      settings index's settings-link-help, the right rail's rail-footer-help, and the phone drawer's drawer-help
//      (at 390 px). Each arrival keeps the document (a window marker survives) and, on the pair, the device's root;
//      /help shows no nudge or banner; then help-back returns to /home softly with the same root and a persona named
//   8. THE BANNER'S "what this means" (the pair) points at the docs' privacy page, /docs/privacy/ (the override's
//      /privacy/ when one is pinned), which answers the docs' privacy page; and /help has #privacy
//   9. /help has no inline error sentence and names no fixture identity (it reads none)
//  10. ROOT BUDGET (the pair): the whole run minted at most 1 new root, and none outside the main context
//  11. PERSONA LAUNCH (P0): the wave's questions are on /help (Farcaster sign-in, post mode, 4 anon posts, two personas,
//      X), each carries a cite or a status line, every data-status-from line is the status file's note word for word,
//      every UI sentence Help quotes is on /help AND in the component that shows it (so Help can never quote a sentence
//      the app no longer says), and Settings lists Import from X. PERSONA LAUNCH wave 3: also q-anon-public and
//      q-x-outbox, the x-anon-outbox status line, and the DM inbox sentence quoted from lib/x/inbox.ts
//  12. PERSONA LAUNCH wave 3 (P7): the Help picture's "Post anonymously" arrow (6) on the PUBLIC site shows "soon" while
//      the anon-account row's public status is "fixture" — an anonymous post made there stays inside the preview, so
//      the arrow to Farcaster is not reached even on test data (components/help/EcosystemMapCompact.tsx publicCap); on
//      the rig it shows the row's owner status exactly. Non-vacuous: the check first requires the row's public status
//      to DIFFER from the cap, and without publicCap (or its surface guard) the arrow shows the row's "fixture" → red.
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_IDENTITY_NEEDLES, FIXTURE_SELF_NEEDLES, describeHits, inlineErrors, scanNeedles, waitForDevice } from "./lib/page-health.mjs";
import { DOCS_PATH, isDocsPage, rawGet, titleOf } from "./lib/docs-probe.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
// DOCS UNDER APP: the door's href this run expects — the pinned override, else the app's own /docs
const DOCS_WANT = (process.env.EXPECT_DOCS_URL || "").trim() || DOCS_PATH;
const DOCS_ON_APP = DOCS_WANT.startsWith("/");
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const ROOT_BUDGET = 1;

const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e && e.message ? e.message : String(e)); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, init) => { const r = await fetch(url, { cache: "no-store", redirect: "manual", ...init }); const text = await r.text(); return { status: r.status, text }; };

// ---------------------------------------------------------------- preflight: which shape is this?
const dev = await get(BASE + "/api/dev").catch(() => ({ status: 0 }));
const SHAPE = dev.status === 403 ? "prod" : dev.status === 200 ? "rig" : null;
if (!SHAPE) {
  console.log("  ABORT: GET /api/dev answered " + dev.status + " at " + BASE + " — run against the rig (200) or the production-shaped pair (403); an owner-gated service answers 401");
  process.exit(2);
}
const SURFACE = SHAPE === "prod" ? "public" : "owner";
console.log("\nHELP — the Help page, its entry points and its status rows (" + (SHAPE === "prod" ? "production-shaped pair" : "rig") + ", app " + BASE + ")");

if (SHAPE === "prod") {
  // a device boot is a burst of validator calls; wait until a small burst is answered cleanly (accept-prodlive's lesson)
  const started = Date.now();
  let ready = false;
  while (Date.now() - started < 240_000) {
    const burst = await Promise.all(Array.from({ length: 8 }, () => get(VBASE + "/zk/members").catch(() => ({ status: 0 }))));
    if (burst.every((r) => r.status !== 429 && r.status !== 0)) { ready = true; break; }
    await sleep(5000);
  }
  if (!ready) {
    console.log("  ABORT: the validator at " + VBASE + " did not answer a small burst cleanly within 240 s");
    process.exit(2);
  }
}

// ---------------------------------------------------------------- the status file, read as the docs read it
function statusBlocks() {
  const src = readFileSync(path.join(ROOT, "lib/status/features.ts"), "utf8").replace(/\r\n/g, "\n");
  const block = (k) => {
    const m = new RegExp("/\\* @status-json:" + k + ":begin \\*/([\\s\\S]*?)/\\* @status-json:" + k + ":end \\*/").exec(src);
    if (!m) throw new Error("lib/status/features.ts has no @status-json:" + k + " block");
    try {
      return JSON.parse(m[1]);
    } catch (e) {
      throw new Error("the @status-json:" + k + " block is not strict JSON: " + e.message);
    }
  };
  return { legend: block("legend"), surfaces: block("surfaces"), features: block("features") };
}
let STATUS = null;

await check("1. STATUS FILE: the three JSON blocks parse; ids unique; statuses from the legend; no pitch row is 'designed'; no em dash", async () => {
  STATUS = statusBlocks();
  const { legend, surfaces, features } = STATUS;
  const problems = [];
  const legendIds = legend.map((l) => l.id);
  for (const want of ["live", "fixture", "designed", "off", "soon", "na"]) if (!legendIds.includes(want)) problems.push("the legend lacks " + want);
  if (JSON.stringify(surfaces.map((s) => s.id).sort()) !== JSON.stringify(["owner", "public"])) problems.push("surfaces are " + JSON.stringify(surfaces.map((s) => s.id)));
  const ids = features.map((f) => f.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate feature ids");
  for (const f of features) {
    for (const k of ["id", "name", "description", "missing"]) if (typeof f[k] !== "string" || !f[k].trim()) problems.push(f.id + ": empty " + k);
    for (const s of ["public", "owner"]) {
      const st = f.status?.[s];
      const note = f.notes?.[s];
      if (!legendIds.includes(st)) problems.push(f.id + ": " + s + " status " + JSON.stringify(st) + " is not a legend value");
      if (typeof note !== "string" || !note.trim()) problems.push(f.id + ": " + s + " has no note");
      if (f.pitch === true && st === "designed") problems.push(f.id + " is part of the pitch, so unbuilt it is 'soon', never 'designed' (" + s + ")");
      // "off" promises the owner may switch it on; a site that does not offer it by design is "na"
      if (st === "off" && /^(Not offered|Refused)\b/.test(note ?? "")) problems.push(f.id + ": " + s + " is 'off' but its note says it is not offered there; that is 'na'");
    }
  }
  if (/\u2014/.test(JSON.stringify(STATUS))) problems.push("an em dash in the entries (the voice rules forbid it)");
  if (problems.length) throw new Error(problems.join(" | "));
  return `${legend.length} legend values, ${features.length} features`;
});

// ---------------------------------------------------------------- 2. /help is the Help page
let helpHtml = "";
await check("2. /help IS THE HELP PAGE: 200, help-page (not a profile), this shape's surface, no device bundle in the HTML", async () => {
  const r = await get(BASE + "/help");
  helpHtml = r.text;
  if (r.status !== 200) throw new Error("GET /help answered " + r.status);
  if (!/data-testid="help-page"/.test(r.text)) throw new Error("/help did not render the Help page — app/(main)/[handle] is shadowing it, or the route is missing");
  const m = /data-testid="help-page"[^>]*data-surface="(\w+)"/.exec(r.text) || /data-surface="(\w+)"[^>]*data-testid="help-page"/.exec(r.text);
  if (!m) throw new Error("the help page carries no data-surface");
  if (m[1] !== SURFACE) throw new Error(`the help page says it is on "${m[1]}", this shape is "${SURFACE}"`);
  if (/device\.js/.test(r.text)) throw new Error("/help's HTML loads the device bundle (device.js)");
  return `200, surface ${m[1]}, ${r.text.length} bytes`;
});

// ---------------------------------------------------------------- 11's sources (pure: read before the browser starts)
// PERSONA LAUNCH P0: the UI sentences Help quotes, each with the component that shows it. The component source is
// normalised the way it renders: HTML entities to ASCII, every JSX/template expression to one placeholder (§), runs
// of whitespace to one space. A Help sentence that names the default chain node is compared with that host as §.
const QUOTED_UI = [
  { where: "components/device/FarcasterSignIn.tsx", text: "This shows which Farcaster account is yours. It does not save your identity: save with a passkey first." },
  { where: "components/device/FarcasterSignIn.tsx", text: "Farcaster's sign-in service will see that you signed in to Totem, and your internet address." },
  { where: "components/device/FarcasterSignIn.tsx", text: "Your browser then checks the account on the Optimism blockchain through mainnet.optimism.io, which sees your internet address too.", host: "mainnet.optimism.io" },
  { where: "components/device/FarcasterSignIn.tsx", text: "Totem's server sees nothing." },
  // NEYNAR AS A SWITCH (§42): the retired "Show my Farcaster posts here" button's disclosure is now the profile's network line
  { where: "components/profile/ProfileIsland.tsx", text: "Your Farcaster posts are read from Farcaster's network on your Farcaster profile (open it from Following), never through Neynar: that read would hand your account to Totem's server." },
  { where: "lib/identity/handleStem.ts", text: "Persona actions never act as your Farcaster account. To act as yourself, choose You in the account menu: then the Post box and the Like, Recast and Reply on Farcaster's posts act as your account, once you allow Totem to post as you. To do this as a persona, switch to one of your personas." },
  // POST AS YOU: Help quotes the connect panel's disclosure and the root composer's line (lib/fc/rootSigner/copy.ts)
  { where: "lib/fc/rootSigner/copy.ts", text: "Totem's server signs the request and passes your posts on to Farcaster, so it sees them (they're public anyway) and your internet address." },
  { where: "components/settings/XImportWizard.tsx", text: "The archive file never leaves this browser." },
  // PERSONA LAUNCH wave 3 (P8): Help q-x-outbox quotes the DM inbox sentence verbatim
  { where: "lib/x/inbox.ts", text: "DM a tweet to @totem to save it (test data: no DM is read from X yet)." },
];
function normaliseSource(src) {
  return src
    .replace(/&rsquo;|&lsquo;|&apos;|&#39;|&#x27;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\$?\{[^{}]*\}/g, "§")
    .replace(/\s+/g, " ");
}
const WAVE_QUESTIONS = ["q-siwf", "q-post-mode", "q-anon-limit", "q-anon-link", "q-x", "q-who-sees", "q-ring-outside", "q-ring-proof", "q-reach", "q-launch", "q-anon-public", "q-x-outbox"];

// ---------------------------------------------------------------- the browser
const browser = await chromium.launch();
const newTally = () => ({ anchorsCreated: 0, deviceBundle: 0 });
const main = newTally();
function watch(context, tally) {
  context.on("request", (req) => {
    let p = "";
    try { p = new URL(req.url()).pathname; } catch { /* data: etc */ }
    if (/\/device\/device\.js$/.test(p)) tally.deviceBundle++;
  });
  context.on("response", (res) => {
    let p = "";
    try { p = new URL(res.url()).pathname; } catch { /* data: etc */ }
    // a NEW root is a 201 from the anchor registration (re-registering answers 200)
    if (res.request().method() === "POST" && /\/device\/auth-anchor$/.test(p) && res.status() === 201) tally.anchorsCreated++;
  });
}
const sideTallies = [];

/** read the status rows (and everything they are checked against) off a rendered /help */
async function readHelp(page) {
  return page.evaluate(() => {
    const txt = (el) => (el ? (el.innerText || "").trim().replace(/\s+/g, " ") : null);
    const root = document.querySelector('[data-testid="help-page"]');
    return {
      surface: root ? root.getAttribute("data-surface") : null,
      rows: [...document.querySelectorAll('[data-testid="status-row"]')].map((el) => ({
        id: el.getAttribute("data-feature"),
        surface: el.getAttribute("data-surface"),
        status: el.getAttribute("data-status"),
        group: el.closest('[data-testid="status-group"]')?.getAttribute("data-status") ?? null,
        name: txt(el.querySelector('[data-testid="status-name"]')),
        note: txt(el.querySelector('[data-testid="status-note"]')),
        chip: el.querySelector('[data-testid="status-chip"]')?.getAttribute("data-status") ?? null,
        other: el.querySelector('[data-testid="status-chip-other"]')?.getAttribute("data-status") ?? null,
      })),
      groups: [...document.querySelectorAll('[data-testid="status-group"]')].map((g) => g.getAttribute("data-status")),
      chips: [...document.querySelectorAll('[data-testid="status-chip"], [data-testid="status-chip-other"], [data-testid="legend-chip"], [data-testid="group-chip"], [data-testid="picture-chip"]')].map((c) => ({
        status: c.getAttribute("data-status"),
        text: txt(c),
      })),
      panels: [...document.querySelectorAll('[data-testid="help-panel"]')].map((p) => ({
        feature: p.getAttribute("data-feature"),
        status: p.querySelector('[data-testid="picture-chip"]')?.getAttribute("data-status") ?? null,
      })),
      cites: [...document.querySelectorAll("[data-cite]")].map((e) => e.getAttribute("data-cite")),
      privacyText: txt(document.querySelector('[data-testid="help-privacy"]')),
      hasPrivacyAnchor: !!document.getElementById("privacy"),
      docsLink: (() => {
        const a = document.querySelector('[data-testid="help-docs"]');
        return a ? { href: a.getAttribute("href"), target: a.getAttribute("target") } : null;
      })(),
      docsUnpublished: !!document.querySelector('[data-testid="help-docs-unpublished"]'),
      readTheDocs: /Read the docs/.test(document.body.innerText),
      nag: {
        nudge: !!document.querySelector('[data-testid="identity-unsaved"]'),
        banner: !!document.querySelector('[data-testid="preview-banner"]'),
        deviceStatus: !!document.querySelector('[data-testid="device-status"]'),
      },
    };
  });
}

/** a fresh visitor context on this shape: its own tally, watched */
async function freshContext(viewport = DESKTOP) {
  const tally = newTally();
  sideTallies.push(tally);
  const c = await browser.newContext({ viewport });
  watch(c, tally);
  return { c, tally };
}

// ---------------------------------------------------------------- 3 + 4 + 9 on a directly loaded /help (also 6a)
let direct = null;
await check("6a. NO MINT, NO NAG: a fresh visitor opening /help directly gets the page with no device, no new root, no nudge, no banner", async () => {
  const { c, tally } = await freshContext();
  try {
    const p = await c.newPage();
    const r = await p.goto(BASE + "/help", { waitUntil: "load", timeout: 120_000 });
    await p.getByTestId("help-page").first().waitFor({ timeout: 30_000 });
    await p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await sleep(3000); // anything that would boot a device has had its chance
    direct = await readHelp(p);
    direct.inline = await inlineErrors(p);
    direct.text = await p.evaluate(() => document.body.innerText);
    const booted = await p.evaluate(() => !!window.__layersDevice);
    const problems = [];
    if (!r || r.status() !== 200) problems.push("HTTP " + (r ? r.status() : "?"));
    if (tally.deviceBundle) problems.push("the device bundle was requested " + tally.deviceBundle + " time(s)");
    if (booted) problems.push("window.__layersDevice exists: a device started");
    if (tally.anchorsCreated) problems.push(tally.anchorsCreated + " new root(s) registered on the validator");
    if (direct.nag.nudge) problems.push("the unsaved-identity nudge is shown");
    if (direct.nag.banner) problems.push("the preview banner is shown");
    if (direct.nag.deviceStatus) problems.push("a device status strip is shown");
    if (problems.length) throw new Error(problems.join("; "));
    return "help-page rendered; no device, no root, no nudge, no banner";
  } finally {
    await c.close();
  }
});

await check("3. EVERY STATUS ROW COMES FROM lib/status/features.ts: same set, same order, same status/name/note, legend-ordered groups, legend chip words", async () => {
  if (!STATUS) throw new Error("skipped — check 1 could not read the status file");
  if (!direct) throw new Error("skipped — check 6a could not read /help");
  const { legend, features } = STATUS;
  const problems = [];
  if (direct.surface !== SURFACE) problems.push(`help-page data-surface is ${direct.surface}, expected ${SURFACE}`);
  const want = features.map((f) => f.id);
  const got = direct.rows.map((r) => r.id);
  const missing = want.filter((id) => !got.includes(id));
  const extra = got.filter((id) => !want.includes(id));
  if (missing.length) problems.push("rows missing from /help: " + missing.join(", "));
  if (extra.length) problems.push("rows on /help that the file does not have: " + extra.join(", "));
  if (new Set(got).size !== got.length) problems.push("a feature renders more than once");
  const other = SURFACE === "public" ? "owner" : "public";
  const norm = (s) => (s ?? "").trim().replace(/\s+/g, " ");
  for (const row of direct.rows) {
    const f = features.find((x) => x.id === row.id);
    if (!f) continue;
    const mine = { status: f.status[SURFACE], note: f.notes[SURFACE] };
    if (row.surface !== SURFACE) problems.push(`${row.id}: row surface ${row.surface}`);
    if (row.status !== mine.status) problems.push(`${row.id}: row says ${row.status}, the file says ${mine.status}`);
    if (row.chip !== mine.status) problems.push(`${row.id}: chip says ${row.chip}, the file says ${mine.status}`);
    if (row.group !== mine.status) problems.push(`${row.id}: sits in the ${row.group} group, not ${mine.status}`);
    if (row.other !== f.status[other]) problems.push(`${row.id}: the ${other} chip says ${row.other}, the file says ${f.status[other]}`);
    if (norm(row.name) !== norm(f.name)) problems.push(`${row.id}: name "${row.name}" is not the file's "${f.name}"`);
    if (norm(row.note) !== norm(mine.note)) problems.push(`${row.id}: note differs from the file's`);
  }
  // groups: the legend's order, only the statuses present, and inside each group the file's order
  const expectedGroups = legend.map((l) => l.id).filter((id) => features.some((f) => f.status[SURFACE] === id));
  if (JSON.stringify(direct.groups) !== JSON.stringify(expectedGroups)) problems.push(`groups ${JSON.stringify(direct.groups)}, expected ${JSON.stringify(expectedGroups)}`);
  for (const g of expectedGroups) {
    const order = direct.rows.filter((r) => r.group === g).map((r) => r.id);
    const fileOrder = features.filter((f) => f.status[SURFACE] === g).map((f) => f.id);
    if (JSON.stringify(order) !== JSON.stringify(fileOrder)) problems.push(`group ${g} order ${JSON.stringify(order)}, the file's is ${JSON.stringify(fileOrder)}`);
  }
  // every chip anywhere on the page speaks the legend's words for its status
  for (const c of direct.chips) {
    const l = legend.find((x) => x.id === c.status);
    if (!l) problems.push(`a chip with unknown status ${c.status}`);
    else if (norm(c.text) !== norm(l.label)) problems.push(`a ${c.status} chip reads "${c.text}", the legend says "${l.label}"`);
  }
  // the picture's chips are the file's status for their feature
  if (!direct.panels.length) problems.push("the three-panel picture rendered no panels");
  for (const p of direct.panels) {
    const f = features.find((x) => x.id === p.feature);
    if (!f) problems.push(`a picture panel names unknown feature ${p.feature}`);
    else if (p.status !== f.status[SURFACE]) problems.push(`the picture's ${p.feature} chip says ${p.status}, the file says ${f.status[SURFACE]}`);
  }
  if (problems.length) throw new Error(problems.slice(0, 12).join(" | ") + (problems.length > 12 ? ` | … ${problems.length - 12} more` : ""));
  return `${direct.rows.length} rows in ${direct.groups.length} groups (${direct.groups.join(", ")}), ${direct.chips.length} chips, ${direct.panels.length} picture panels`;
});

let landingHtml = "";
let landingCites = [];
await check("4. CITES: every data-cite on /help and the landing names a real file and a verbatim heading; the landing's status sentences appear word for word on /help", async () => {
  if (!direct) throw new Error("skipped — check 6a could not read /help");
  const problems = [];
  const r = await get(BASE + "/");
  landingHtml = r.text;
  landingCites = [...r.text.matchAll(/data-cite="([^"]*)"/g)].map((m) => m[1].replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  const cites = [...new Set([...direct.cites, ...landingCites])];
  if (!direct.cites.length) problems.push("/help carries no data-cite at all");
  const headingsOf = new Map();
  for (const cite of cites) {
    const m = /^(.+?)\s*>\s*(?:"(.+)"|'(.+)')\s*$/.exec(cite);
    const file = (m ? m[1] : cite).trim();
    const heading = m ? m[2] ?? m[3] : null;
    const abs = path.join(ROOT, file);
    if (!existsSync(abs)) { problems.push(`"${cite}": no file ${file}`); continue; }
    if (!heading) continue;
    if (!headingsOf.has(file)) {
      headingsOf.set(file, new Set(readFileSync(abs, "utf8").replace(/\r\n/g, "\n").split("\n").filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.replace(/^#{1,6}\s+/, "").trim())));
    }
    if (!headingsOf.get(file).has(heading.trim())) problems.push(`"${cite}": ${file} has no heading "${heading}"`);
  }
  // the landing's status list, sentence for sentence, is on /help's privacy section (shared constants, so it must be)
  const p = await browser.newPage({ viewport: DESKTOP });
  try {
    await p.goto(BASE + "/", { waitUntil: "load", timeout: 60_000 });
    const items = await p.$$eval('[data-testid="landing-status"] li', (els) => els.map((e) => (e.innerText || "").trim().replace(/\s+/g, " ")));
    if (items.length < 4) problems.push("the landing's status list has " + items.length + " item(s)");
    const privacy = direct.privacyText ?? "";
    for (const item of items) {
      for (const sentence of item.split(/(?<=\.)\s+(?=[A-Z])/)) {
        if (sentence.length > 20 && !privacy.includes(sentence)) problems.push(`the landing says "${sentence.slice(0, 70)}…", /help#privacy does not`);
      }
    }
  } finally {
    await p.close();
  }
  if (problems.length) throw new Error(problems.slice(0, 10).join(" | "));
  return `${cites.length} distinct cite(s), every file and heading found; the landing's sentences are on /help`;
});

await check("5. LANDING + DOCS DOOR: landing-help → /help always; the docs door ALWAYS, to /docs (or the pinned override), in a new tab; /help agrees; /docs is the docs, on this app", async () => {
  if (!direct) throw new Error("skipped — check 6a could not read /help");
  const html = landingHtml || (await get(BASE + "/")).text;
  const problems = [];
  const helpLink = /<a[^>]*data-testid="landing-help"[^>]*>/.exec(html)?.[0] ?? "";
  if (!helpLink) problems.push("the landing has no data-testid=landing-help");
  else if (!/href="\/help"/.test(helpLink)) problems.push("landing-help does not point at /help: " + helpLink.slice(0, 160));
  if (/<a[^>]*data-testid="landing-help"[^>]*>[^<]*Read the docs/.test(html)) problems.push("landing-help says 'Read the docs'");
  // DOCS UNDER APP: the door is unconditional now — its absence is a failure, whatever the environment says
  const doorTag = /<a[^>]*data-testid="door-docs"[^>]*>([^<]*)</.exec(html);
  const door = doorTag?.[0] ?? "";
  const doorHref = /href="([^"]*)"/.exec(door)?.[1]?.replace(/&amp;/g, "&") ?? null;
  if (!door) problems.push("the landing has no docs door (data-testid=door-docs)");
  else {
    if (!/Read the docs/.test(doorTag[1])) problems.push(`the docs door says ${JSON.stringify(doorTag[1].trim())}, not "Read the docs"`);
    if (doorHref !== DOCS_WANT) problems.push(`the docs door goes to ${doorHref}, want ${DOCS_WANT}`);
    if (!/target="_blank"/.test(door)) problems.push("the docs door does not open a new tab");
  }
  if (!direct.docsLink) problems.push("/help has no help-docs link");
  else {
    if (direct.docsLink.href !== DOCS_WANT) problems.push(`help-docs goes to ${direct.docsLink.href}, want ${DOCS_WANT}`);
    if (direct.docsLink.target !== "_blank") problems.push("help-docs does not open a new tab");
  }
  if (direct.docsUnpublished) problems.push("/help still says the docs are unpublished");
  // the door leads somewhere real: on this app, /docs -> /docs/, the docs home page (by content, not by status)
  let lead = "an override, not on this app";
  if (DOCS_ON_APP) {
    const bare = await rawGet(BASE, DOCS_WANT);
    const loc = bare.headers.location || "";
    if (bare.status !== 308 || new URL(loc, BASE).pathname !== DOCS_WANT.replace(/\/?$/, "/")) problems.push(`GET ${DOCS_WANT} answered ${bare.status} -> ${loc || "(no location)"}, want 308 -> ${DOCS_WANT}/`);
    const home = await rawGet(BASE, DOCS_WANT.replace(/\/?$/, "/"));
    if (!isDocsPage(home)) problems.push(`GET ${DOCS_WANT}/ is not the docs home page (${home.status}, title ${JSON.stringify(titleOf(home.body))})`);
    else lead = `${DOCS_WANT} → 308 → the docs home page (${home.body.length} bytes)`;
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return `landing-help → /help; door + help-docs → ${DOCS_WANT} in a new tab; ${lead}`;
});

await check("6b. NO MINT, NO NAG from the landing: following landing-help from / is a soft navigation to /help that starts no device", async () => {
  const { c, tally } = await freshContext();
  try {
    const p = await c.newPage();
    await p.goto(BASE + "/", { waitUntil: "load", timeout: 60_000 });
    await p.evaluate(() => { window.__helpMarker = "landing"; });
    await p.getByTestId("landing-help").first().click();
    await p.waitForURL((u) => new URL(u).pathname === "/help", { timeout: 30_000 });
    await p.getByTestId("help-page").first().waitFor({ timeout: 30_000 });
    await p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await sleep(2000);
    const st = await p.evaluate(() => ({
      soft: window.__helpMarker === "landing",
      device: !!window.__layersDevice,
      nudge: !!document.querySelector('[data-testid="identity-unsaved"]'),
      banner: !!document.querySelector('[data-testid="preview-banner"]'),
    }));
    const problems = [];
    if (!st.soft) problems.push("following landing-help was a full document load (it must be a next/link)");
    if (st.device || tally.deviceBundle) problems.push("a device started");
    if (tally.anchorsCreated) problems.push(tally.anchorsCreated + " new root(s)");
    if (st.nudge) problems.push("the unsaved-identity nudge is shown");
    if (st.banner) problems.push("the preview banner is shown");
    if (problems.length) throw new Error(problems.join("; "));
    return "soft, no device, no root, no nag";
  } finally {
    await c.close();
  }
});

await check("9. /help has no inline error sentence and names no fixture identity (it reads none)", async () => {
  if (!direct) throw new Error("skipped — check 6a could not read /help");
  const problems = [...direct.inline];
  const hits = scanNeedles(direct.text, [...FIXTURE_IDENTITY_NEEDLES, ...FIXTURE_SELF_NEEDLES]);
  if (hits.length) problems.push("fixture identity on /help: " + describeHits(hits));
  if (problems.length) throw new Error(problems.join("; "));
  return direct.text.length + " characters scanned";
});

await check("11. PERSONA LAUNCH: /help answers the wave's questions, each status line is the file's note word for word, every quoted UI sentence is the app's own, and Settings lists Import from X", async () => {
  if (!STATUS) throw new Error("skipped — check 1 could not read the status file");
  const problems = [];
  // the quoted sentences are in their components (read first: a quote the app no longer says fails even before /help)
  const srcCache = new Map();
  for (const q of QUOTED_UI) {
    // PERSONA LAUNCH wave 3 (final verify): a plain .ts module keeps its sentence inside an object literal
    // (lib/x/inbox.ts `{ mode, testData: true, sentence: "…" }`), which the JSX normaliser's brace rule swallows whole;
    // a .ts source is matched as it is written (whitespace collapsed), a component through the normaliser
    const raw = readFileSync(path.join(ROOT, q.where), "utf8");
    if (!srcCache.has(q.where)) srcCache.set(q.where, q.where.endsWith(".tsx") ? normaliseSource(raw) : raw.replace(/\s+/g, " "));
    const want = q.host ? q.text.split(q.host).join("§") : q.text;
    if (!srcCache.get(q.where).includes(want)) problems.push(`${q.where} no longer says "${q.text.slice(0, 60)}…" (Help quotes it)`);
  }
  const { c } = await freshContext();
  try {
    const p = await c.newPage();
    await p.goto(BASE + "/help", { waitUntil: "load", timeout: 120_000 });
    await p.getByTestId("help-page").first().waitFor({ timeout: 30_000 });
    const got = await p.evaluate((ids) => {
      const norm = (t) => (t || "").trim().replace(/\s+/g, " ");
      return {
        body: norm(document.body.innerText),
        questions: ids.map((id) => {
          const el = document.getElementById(id);
          return { id, present: !!el && el.getAttribute("data-testid") === "help-question", cites: el ? el.querySelectorAll("[data-cite]").length : 0, statusLines: el ? el.querySelectorAll("[data-status-from]").length : 0 };
        }),
        statusFrom: [...document.querySelectorAll("[data-status-from]")].map((e) => ({ id: e.getAttribute("data-status-from"), site: e.getAttribute("data-status-site"), text: norm(e.innerText) })),
        importX: [...document.querySelectorAll('[data-testid="help-settings-link"]')].some((a) => a.getAttribute("href") === "/settings/import-x"),
      };
    }, WAVE_QUESTIONS);
    for (const q of got.questions) {
      if (!q.present) problems.push(`no help-question #${q.id}`);
      else if (q.cites + q.statusLines === 0) problems.push(`#${q.id} carries neither a data-cite nor a data-status-from line`);
    }
    // every status line quotes the file: this surface's note (or, for the sign-in question, the public site's, which
    // is the site it describes). PERSONA LAUNCH (final verify): a line that DECLARES the site it describes
    // (data-status-site, e.g. Help's "On the owner's private service: …" lines, shown on both sites since before this
    // wave) must quote exactly THAT site's note — no fallback, and a declared site must be a real one
    const norm = (t) => (t || "").trim().replace(/\s+/g, " ");
    const fromIds = new Set(got.statusFrom.map((x) => x.id));
    for (const id of ["sign-in-farcaster", "anon-account", "x-archive", "x-find-people", "rings", "who-sees-what", "reach-tier", "persona-launch", "x-anon-outbox"]) if (!fromIds.has(id)) problems.push(`no data-status-from="${id}" line on /help`);
    for (const line of got.statusFrom) {
      const f = STATUS.features.find((x) => x.id === line.id);
      if (!f) { problems.push(`data-status-from names unknown feature ${line.id}`); continue; }
      if (line.site !== null && line.site !== "owner" && line.site !== "public") { problems.push(`the ${line.id} line declares an unknown site "${line.site}"`); continue; }
      // an empty note would match any text ("".includes): only non-empty notes count, and a line with none fails
      const notes = (line.site ? [f.notes[line.site]] : [f.notes[SURFACE], f.notes.public]).map(norm).filter((n) => n.length > 0);
      if (!notes.length) problems.push(`the ${line.id} line quotes a site whose note is empty in the file`);
      else if (!notes.some((n) => line.text.includes(n))) problems.push(`the ${line.id} line on /help is not the file's note for this site`);
    }
    for (const q of QUOTED_UI) if (!got.body.includes(q.text)) problems.push(`/help does not say "${q.text.slice(0, 60)}…"`);
    if (!got.importX) problems.push("Help's settings list has no Import from X (/settings/import-x)");
    if (problems.length) throw new Error(problems.slice(0, 10).join(" | "));
    return `${WAVE_QUESTIONS.length} questions, ${got.statusFrom.length} status lines from the file, ${QUOTED_UI.length} quoted UI sentences found in both places`;
  } finally {
    await c.close();
  }
});

await check("12. PERSONA LAUNCH wave 3: the Help picture's 'Post anonymously' arrow is capped to 'soon' on the public site (its posts stay inside the preview) and is the row's own status on the rig", async () => {
  if (!STATUS) throw new Error("skipped — check 1 could not read the status file");
  const row = STATUS.features.find((f) => f.id === "anon-account");
  if (!row) throw new Error("the status file has no anon-account row");
  const { c } = await freshContext();
  try {
    const p = await c.newPage();
    await p.goto(BASE + "/help", { waitUntil: "load", timeout: 120_000 });
    await p.getByTestId("help-page").first().waitFor({ timeout: 30_000 });
    const arrow = p.locator('[data-testid="eco-map"] [data-testid="eco-arrow"][data-arrow="6"]').first();
    await arrow.waitFor({ timeout: 30_000 }).catch(() => { throw new Error("no eco-arrow 6 in the Help picture"); });
    const got = { status: await arrow.getAttribute("data-status"), feature: await arrow.getAttribute("data-feature"), surface: await p.locator('[data-testid="eco-map"]').first().getAttribute("data-surface") };
    if (got.feature !== "anon-account") throw new Error("arrow 6 reads its status from " + got.feature + ", not anon-account");
    if (got.surface !== SURFACE) throw new Error("the picture's surface is " + got.surface + ", this shape's is " + SURFACE);
    if (SHAPE === "prod") {
      // NOT VACUOUS: the cap can only be seen while the row says more than the cap does
      if (row.status.public !== "fixture") throw new Error("the anon-account row's public status is " + row.status.public + " (this check measures the cap against 'fixture': revisit it with the deploy that changes the row)");
      if (got.status !== "soon") throw new Error("arrow 6 shows " + got.status + " on the public site; an anonymous post made there never reaches Farcaster, so it must be capped to soon");
      return "public: arrow 6 soon while the row is fixture";
    }
    if (got.status !== row.status.owner) throw new Error("arrow 6 shows " + got.status + " on the rig; the row's owner status is " + row.status.owner);
    return "owner: arrow 6 " + got.status + " = the row's owner status";
  } finally {
    await c.close();
  }
});

// ---------------------------------------------------------------- 7. the entry points, all on ONE identity
const ctx = await browser.newContext({ viewport: DESKTOP });
watch(ctx, main);
const page = await ctx.newPage();
let rootId = null;
let homeReady = false;

/**
 * A FULL load of /home. The first one boots the run's one identity (the pair) and keeps it in this browser
 * (persist()), so that if a trip below fails half-way the next one can start again from a full load that RESTORES the
 * same root instead of minting another. The soft-navigation checks do not lean on that: they watch a window marker,
 * which only a full document load can lose.
 */
async function openHome() {
  await page.setViewportSize(DESKTOP);
  const r = await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  if (!r || r.status() >= 400) throw new Error("GET /home answered " + (r ? r.status() : "nothing"));
  if (SHAPE === "prod") {
    const info = await waitForDevice(page, 120_000);
    if (rootId && info.rootId !== rootId) throw new Error(`a full reload of /home came back with a different root (${rootId} → ${info.rootId})`);
    rootId = info.rootId;
    if (!info.persistent) {
      const err = await page.evaluate(() => window.__layersDevice.persist().then(() => null, (e) => String(e && e.message ? e.message : e)));
      if (err) throw new Error("persist() failed: " + err);
    }
  }
  await page.getByTestId("nav-help").first().waitFor({ state: "visible", timeout: 60_000 });
  homeReady = true;
}

/** start a trip from /home: already there, back from /help softly, or (after a failed trip) a full load */
async function ensureHome() {
  if (!homeReady) return openHome();
  const at = new URL(page.url()).pathname;
  if (at === "/home" && (await page.getByTestId("nav-help").first().isVisible().catch(() => false))) return;
  if (at === "/help" && (await page.getByTestId("help-back").count())) {
    await page.setViewportSize(DESKTOP);
    await page.getByTestId("help-back").first().click();
    await page.waitForURL((u) => new URL(u).pathname === "/home", { timeout: 30_000 }).catch(() => {});
    if (await page.getByTestId("nav-help").first().isVisible({ timeout: 30_000 }).catch(() => false)) return;
  }
  return openHome();
}

/** the device's root id right now (the pair), or null (the rig) */
const currentRoot = () => (SHAPE === "prod" ? page.evaluate(() => window.__layersDevice?.info?.rootId ?? null) : Promise.resolve(null));

/** after a click that should land on /help softly: the marker, the page, the root, no nag */
async function arriveAtHelp(marker, via) {
  await page.waitForURL((u) => new URL(u).pathname === "/help", { timeout: 30_000 }).catch(() => { throw new Error(via + " did not reach /help (at " + page.url() + ")"); });
  await page.getByTestId("help-page").first().waitFor({ timeout: 30_000 });
  const st = await page.evaluate((m) => ({
    soft: window.__helpMarker === m,
    nudge: !!document.querySelector('[data-testid="identity-unsaved"]'),
    banner: !!document.querySelector('[data-testid="preview-banner"]'),
    status: [...document.querySelectorAll('[data-testid="status-row"]')].length,
  }), marker);
  const problems = [];
  if (!st.soft) problems.push(via + " was a FULL document load: an unsaved visitor's identity would have been wiped");
  if (st.nudge) problems.push("/help shows the unsaved-identity nudge");
  if (st.banner) problems.push("/help shows the preview banner");
  if (!st.status) problems.push("/help rendered no status rows");
  if (SHAPE === "prod") {
    const now = await currentRoot();
    if (now !== rootId) problems.push(`the device's root changed on the way to /help (${rootId} → ${now})`);
  }
  if (problems.length) throw new Error(problems.join("; "));
}

/** help-back: soft, back on /home, the same root, a persona named in the chrome */
async function backToApp(marker) {
  await page.getByTestId("help-back").first().click();
  await page.waitForURL((u) => new URL(u).pathname === "/home", { timeout: 30_000 });
  const soft = await page.evaluate((m) => window.__helpMarker === m, marker);
  if (!soft) throw new Error("help-back was a full document load");
  if (SHAPE === "prod") {
    const now = await currentRoot();
    if (now !== rootId) throw new Error(`the device's root changed on the way back (${rootId} → ${now})`);
  }
  // the app group re-mounted: its rail is back
  await page.getByTestId("nav-help").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => { throw new Error("back on /home, the app's rail did not render"); });
  // the pair: it re-mounted around the SAME identity, so the rail's account button names one of the device's personas
  // again (a booted device always has two). The rig is not asked: its server names the persona, and a rig started with
  // LAYERS_WORLD=empty legitimately has none yet.
  if (SHAPE !== "prod") return;
  const deadline = Date.now() + 45_000;
  let named = false;
  while (Date.now() < deadline) {
    named = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="account-switcher-button"]');
      return !!b && /@\w/.test(b.innerText || "");
    });
    if (named) break;
    await sleep(500);
  }
  if (!named && (await page.viewportSize())?.width >= 640) throw new Error("back on /home, the rail's account button never named a persona: the identity did not come back with the app");
}

async function softTrip(label, open, opts = {}) {
  await check("7. SOFT NAV via " + label + ": /home → /help keeps the document" + (SHAPE === "prod" ? " and the device's root" : "") + ", no nag on /help, help-back returns softly", async () => {
    await ensureHome();
    const marker = label + ":" + Date.now();
    await page.evaluate((m) => { window.__helpMarker = m; }, marker);
    await open();
    await arriveAtHelp(marker, label);
    if (opts.mobile) await page.setViewportSize(DESKTOP);
    await backToApp(marker);
    return "soft both ways" + (SHAPE === "prod" ? ", root " + rootId : "");
  });
}

await softTrip("the rail's nav-help", async () => {
  await page.getByTestId("nav-help").first().click();
});

await softTrip("the More menu's more-help", async () => {
  await page.getByTestId("nav-more").first().click();
  await page.getByTestId("more-menu").first().waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("more-help").first().click();
});

await softTrip("the settings index's settings-link-help", async () => {
  await page.getByTestId("nav-settings").first().click();
  await page.waitForURL((u) => new URL(u).pathname === "/settings", { timeout: 30_000 });
  const row = page.getByTestId("settings-link-help");
  await row.first().waitFor({ timeout: 30_000 }).catch(() => { throw new Error("/settings has no data-testid=settings-link-help row"); });
  await row.first().click();
});

await softTrip("the right rail's rail-footer-help", async () => {
  const link = page.getByTestId("rail-footer-help");
  await link.first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => { throw new Error("no visible data-testid=rail-footer-help at " + DESKTOP.width + " px"); });
  const docs = await page.getByTestId("rail-footer-docs").first().getAttribute("href").catch(() => null);
  if (docs !== "/help#docs") throw new Error("rail-footer-docs points at " + docs + ", not /help#docs");
  await link.first().click();
});

await softTrip(
  "the phone drawer's drawer-help (390 px)",
  async () => {
    await page.setViewportSize(MOBILE);
    await sleep(300);
    let opener = null;
    for (const s of ['[data-testid="drawer-open"]', '[data-testid="mobile-drawer-open"]', 'button[aria-label="Account menu"]']) {
      for (const l of await page.locator(s).all()) if (await l.isVisible().catch(() => false)) { opener = l; break; }
      if (opener) break;
    }
    if (!opener) throw new Error("at 390 px nothing visible opens the drawer");
    await opener.click();
    const dh = page.getByTestId("drawer-help");
    await dh.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => { throw new Error("the mobile drawer has no visible data-testid=drawer-help"); });
    await dh.first().click();
  },
  { mobile: true }
);

// ---------------------------------------------------------------- 8. the banner's "what this means"
await check("8. THE BANNER's 'what this means' points at the docs' privacy page (/docs/privacy/, or the override's /privacy/), which is that page; /help has #privacy", async () => {
  if (!direct) throw new Error("skipped — check 6a could not read /help");
  if (!direct.hasPrivacyAnchor) throw new Error("/help has no element with id=privacy");
  if (SHAPE !== "prod") return "the rig shows no banner; /help has #privacy";
  await ensureHome();
  const banner = page.getByTestId("preview-banner");
  await banner.first().waitFor({ timeout: 30_000 }).catch(() => { throw new Error("no preview banner on /home"); });
  const href = await page.locator('[data-testid="preview-banner"] a[target="_blank"]').first().getAttribute("href");
  // DOCS UNDER APP: the docs always exist, so the banner never falls back to /help#privacy any more
  const want = DOCS_WANT.replace(/\/$/, "") + "/privacy/";
  if (href !== want) throw new Error("the banner links " + href + ", want " + want);
  if (!DOCS_ON_APP) return "banner → " + href + " (an override, not on this app)";
  const r = await rawGet(BASE, want);
  if (!isDocsPage(r) || !/What the label means/.test(titleOf(r.body))) throw new Error(`${want} is not the docs' privacy page (${r.status}, title ${JSON.stringify(titleOf(r.body))})`);
  return "banner → " + href + " → " + titleOf(r.body);
});

// ---------------------------------------------------------------- 10. the root budget
await check(`10. ROOT BUDGET: at most ${ROOT_BUDGET} new root on the validator, none outside the main context`, async () => {
  if (SHAPE !== "prod") return "the rig mints no browser roots";
  const side = sideTallies.reduce((n, t) => n + t.anchorsCreated, 0);
  if (side) throw new Error(side + " new root(s) from the fresh-visitor contexts (they only opened /help and the landing)");
  if (main.anchorsCreated > ROOT_BUDGET) throw new Error(main.anchorsCreated + " new roots in the main context");
  // not blind: the main context is a fresh browser profile, so its first /home MUST have registered a new root; a zero
  // here means the counter cannot see registrations, and then the side contexts' zero proves nothing either
  if (homeReady && rootId && main.anchorsCreated === 0) throw new Error("the counter saw no anchor registration (201 on /device/auth-anchor) although a fresh identity booted: it is blind, so 6a/6b's 'no new root' is unmeasured");
  return main.anchorsCreated + " new root(s) in the main context, 0 elsewhere";
});

await ctx.close();
await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} help checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
