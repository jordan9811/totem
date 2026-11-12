// LAYERS_WORLD=empty — THE EMPTY WORLD (lib/world.ts), measured on a rig started with the flag.
//
// Run it against a rig-shaped pair whose app runs with LAYERS_WORLD=empty on a COPY of the rig's state (the demo world
// stored in its validator DB, a keystore with no persona of its own yet) — the owner service's shape. The suite runs
// in FIVE PHASES over ONE isolated copy, in this order (the scratch launcher att-run.sh restarts the pair between them;
// WORLD_PHASE selects the phase; the phases hand ids to each other through $WORLD_DIR/world-empty-phases.json):
//
//   WORLD=copy WORLD_FRESH=1  WORLD_PHASE=seed     bash att-run.sh scripts/accept-world-empty.mjs   (the DEMO world
//        writes itself to a fresh copy through the product routes, as an owner using it did — so FRESH measures every
//        absence against a database that holds the demo world, whatever state the rig was left in)
//   WORLD=empty               WORLD_PHASE=fresh    bash att-run.sh scripts/accept-world-empty.mjs   (checks 1-21)
//   WORLD=copy                WORLD_PHASE=stage    bash att-run.sh scripts/accept-world-empty.mjs   (S1-S2: the DEMO
//        world on the same copy stages what the owner did before the flag — a fork of the seeded self that blocked a
//        demo account, customised its preset mode with a demo persona, owns a channel a demo persona joined, and
//        polled the inbox)
//   WORLD=empty               WORLD_PHASE=owner    bash att-run.sh scripts/accept-world-empty.mjs   (O1-O8)
//   WORLD=copy                WORLD_PHASE=rollback bash att-run.sh scripts/accept-world-empty.mjs   (R1-R4: the flag
//        rolled back on an OWNER SERVICE — the suite stops the pair's app and boots its own with OWNER_ACCESS_SECRET
//        and no LAYERS_WORLD, reaching the validator through a proxy it can break)
//
// The suite ABORTS (exit 2) on a pair of the wrong shape: a phase that needs the empty world on a demo-world rig (the
// flag would be unmeasured), a fresh phase on a device that already holds real personas, a later phase without the
// earlier one's hand-over. It never touches the rig's own .keystore/ or validator/layers.db: only $WORLD_DIR.
//
// FRESH (no persona yet, then one):
//   1. THE DEMO WORLD IS STORED AND HIDDEN — the partition holds demo entries back in many namespaces (so every absence
//      below is measured against a database that HAS the demo world), and the stored namespaces hold the same counts.
//   2. NO PERSONA YET IS SAID, NOT FAKED — the roster is empty, /home says "No personas yet" and links to Settings →
//      Account & Personas, the pill says "No persona yet", and no bank needle renders.
//   3. SETTINGS → ACCOUNT OFFERS A PLAIN CREATE and names no fixture fid or root.
//  12. THE CHROME NAMES NOBODY (review WORLD-LEAK-1/F2, WORLD-UX-4/F1) — a real browser, desktop and phone: no fixture
//      name, handle, face, check mark or follower counts in the rail, the header, the drawer or the composer; EVERY
//      persona pill (rail and phone) says "No persona yet".
//  13. EVERY ONE-PERSONA SURFACE SAYS SO (review F6) — the fork page, the influence page, notifications: "No personas
//      yet" with the road to the create form, never "Loading…" forever; a post answers 409 no_persona.
//  14. A FAILED CREATE IS SAID AS JSON AND MINTS NOTHING (review F7) — every mock call failing: 503 JSON, empty roster.
//  15. THE ZK RIG ACTIONS ARE AN ALLOWLIST (review WE-5) — revokeAttestation, rosterExport, nullifierProbe, … 403;
//      the read-only jitterProbe still answers.
//  16. THE INBOX CURSOR IS NEVER HIDDEN (review WE-4) — xSyncCursor is not partitioned; the app reads the stored cursor.
//  17. DEMO STAKES ARE NOT SHOWN (review WORLD-LEAK-5) — epochs the validator holds demo stakes for show no demo row,
//      member or cluster through /api/influence (clusters, cast).
//  18. A SET-BUT-EMPTY LAYERS_WORLD REFUSES TO BOOT (review WORLD-GUARD-6) — validator/seed.js and the app both exit 78.
//   4. THE FORK NEEDS A SOURCE; THE PLAIN CREATE DOES NOT — and mints a keystore persona (p_ + 32 hex).
//   5. THE NEW PERSONA IS LISTED, ACTIVE AND ACTED AS — roster, act-as list, acting persona, a cast authored by it.
//   6. THE SWITCHER (a real browser) LISTS ONLY REAL PERSONAS — and shows them no seeded tier and no check mark
//      (review WORLD-ID-2: they were filed under the seeded self's fixture root and showed its reputation).
//   7. /home, /settings/account, profile, explore, search: content present, no bank needle anywhere in the render.
//   8. A SEEDED PROFILE IS GONE (404) and search finds the real persona but no seeded one.
//   9. FEEDS, CHANNELS, ROOMS, FOLDERS, CURATORS, MARKET: no bank content in the APIs or pages.
//  9b. A FORK OF A REAL PERSONA works under the flag, and the switcher's pick moves the ACTING persona.
//  19. ONE IDENTITY (review WORLD-ID-3) — a switch through /api/seed-persona (Settings › Account) moves the session's
//      persona too, and a post is authored by the persona the pill names.
//  20. THE FORK IS REACHABLE (review F6) — Settings › Account links to /settings/identity/fork once a persona exists.
//  21. RECORDS FOR THE RESTART (review WE-1) — a rule, a folder, a channel and a mode made now, ids handed to OWNER.
//  22. THE X FIXTURE CONVENIENCES ARE THE RIG'S (review W1-R5) — no test link, no fixture archive / raw ingest / chunk
//      tamper (404 before they act), no MigrationPanel under the flag.
//  10. DESTRUCTIVE DEV ACTIONS ARE REFUSED under the flag — refused before they act.
//  11. HIDDEN IS KEPT — after every write above, the namespaces AS STORED still hold exactly the hidden entries
//      (stash == stored), and the validator's own rows did not shrink.
//
// STAGE (demo world, same copy): S1 the owner-like state is staged; S2 its fork shows the seeded self's tier there
// (so OWNER's "no seeded tier" is measured against a fork that HAD one).
//
// OWNER (empty world again, after a restart):
//   O1. the demo world's later writes are hidden too, and nothing hidden is missing after the restart
//   O2. IDS ARE UNIQUE ACROSS RESTARTS (review WE-1) — the FRESH records are intact, new ones never reuse their ids
//   O3. A REAL PERSONA'S MIXED COLLECTION IS SPLIT, NOT REPLACED (review WE-3) — its block of a demo account stays
//       stored (and unshown) when it blocks someone new
//   O4. A REGENERATED PRESET KEEPS THE STORED MODE (review WE-3) — the collision is reported, the hidden mode kept
//   O5. A CHANNEL'S MEMBER LIST KEEPS ITS DEMO MEMBER when a real persona joins (review WE-3)
//   O6. THE INBOX CURSOR CONTINUES from the stored one; a poll never rewinds it (review WE-4)
//   O7. A PRE-FLAG FORK OF THE SEEDED SELF CARRIES NO SEEDED TIER (review WORLD-ID-2)
//   O8. HIDDEN IS KEPT, entry by entry, and no validator row shrank
//
// ROLLBACK (the flag removed on an owner service):
//   R1. A FAILED STATE READ REFUSES EVERY WRITE (review WE-6) — no namespace is replaced on an unread state
//   R2. A FAILED ROSTER READ REFUSES THE ROSTER WRITE (review WE-2) — the sealed roster is not re-sealed
//   R3. THE HIDDEN WORLD COMES BACK, and the owner-phase records are still stored
//   R4. A FAILED ATTESTATION-VAULT READ REFUSES THE VAULT WRITE (review WE-5) — zkAttestations is not re-sealed over;
//       a read answers none (as JSON) while it cannot be read, and answers again once it can (nothing was cached)
//
// Needles are DERIVED from the bank files at run time (seed/data/*.json, lib/fixtures/data.json, the fixture roster),
// so an entry added to the bank later is checked too. The scanner proves it can see a needle before it is trusted to
// report none (9d: a check that could not fail is not evidence).
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const WORLD_DIR = process.env.WORLD_DIR || path.join(process.env.TEMP || "/tmp", "world-empty");
const DB_PATH = path.join(WORLD_DIR, "layers.db");
const PHASE = (process.env.WORLD_PHASE || "fresh").toLowerCase();
const STATE_FILE = path.join(WORLD_DIR, "world-empty-phases.json");
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36).slice(-6);
const abort = (why) => { console.log("  ABORT: " + why); process.exit(2); };
const readState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {});
const writeState = (patch) => writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }, null, 2));

// ------------------------------------------------------------------------------------------------ http + cookies
function client(base) {
  const jar = new Map();
  async function api(method, p, body, { raw = false } = {}) {
    const headers = { "content-type": "application/json" };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => k + "=" + v).join("; ");
    const r = await fetch(base + p, { method, headers, cache: "no-store", redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    const text = await r.text();
    let json = null;
    if (!raw) { try { json = JSON.parse(text); } catch { /* not json */ } }
    return { status: r.status, json, text };
  }
  return { api, jar };
}
const main = client(BASE);
const { api, jar } = main;
/** adapters on the rig fail 2% by design (ops rule 5): every adapter-backed call retries — on CONTENT, not status */
async function retry(fn, accept = (r) => r.status >= 200 && r.status < 300, attempts = 6) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (accept(r)) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.text?.slice(0, 160) ?? "")); }
    catch (e) { last = e; }
    await sleep(300 * (i + 1));
  }
  throw last;
}
const page = (p) => retry(() => api("GET", p, undefined, { raw: true }), (r) => r.status === 200 && r.text.length > 500);
/** act as one persona: both identity cookies (the session prefers the acting one under the flag anyway) */
const actAs = (id) => { jar.set("layers_seed_persona", id); jar.set("layers_active_persona", id); };

// ------------------------------------------------------------------------------------------------ the bank's needles
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const accounts = readJson("seed/data/accounts.json");
const posts = readJson("seed/data/posts.json").posts;
const fixture = readJson("lib/fixtures/data.json");
const spaces = readJson("seed/data/spaces.json");
const graph = readJson("seed/data/graph.json");
const rosterFile = path.join(WORLD_DIR, "keystore", "fixture-roster.json");
const roster = existsSync(rosterFile) ? readJson(rosterFile) : { roots: {}, fids: {} };

const tokenNeedles = new Set(); // matched as whole tokens (handles, ids, hashes)
const textNeedles = new Set(); // matched as substrings (names, titles, post openings)
const addTok = (v) => { if (typeof v === "string" && v.length >= 5) tokenNeedles.add(v); };
const addText = (v) => { if (typeof v === "string" && v.trim().length >= 8) textNeedles.add(v.trim()); };
const opening = (t) => { const s = String(t || "").replace(/\s+/g, " ").slice(0, 32); return /^[A-Za-z0-9 ,.]{24,}$/.test(s) ? s : null; };
for (const p of accounts.personas) { addTok(p.handle); addTok(p.id); if (/\s/.test(p.name)) addText(p.name); }
for (const r of accounts.roots) { addTok(r.id); addTok(r.signerUuid); }
for (const p of posts) { addTok(p.hash); addText(opening(p.text)); }
for (const u of fixture.users) { addTok(u.username); if (/\s/.test(u.displayName || "")) addText(u.displayName); }
addTok(fixture.self.username);
// review WORLD-LEAK-1: the fixture self's display name ("jordan": no space, so the rule above skipped it) and every
// pravatar face (the fixture self's img=12 and the fixture users') are bank — the chrome's fallbacks rendered them
addTok(fixture.self.displayName);
addText("i.pravatar.cc");
addText(fixture.self.bio);
for (const c of fixture.casts) { addTok(c.hash); addText(opening(c.text)); }
for (const c of fixture.selfCasts ?? []) { addTok(c.hash); addText(opening(c.text)); }
for (const t of fixture.trends) addText(t.title);
for (const n of fixture.news) addText(n.title);
for (const l of fixture.liveOnX ?? []) addText(l.title);
for (const c of spaces.channels) { addTok(c.id); addText(c.name); }
for (const r of spaces.rooms) { addTok(r.id); addText(r.title); }
for (const f of spaces.folders) { addTok(f.id); addText(f.name); }
for (const c of graph.campaigns ?? []) { addTok(c.id); addText(c.name ?? c.title); }
for (const [rootId, ids] of Object.entries(roster.roots ?? {})) { addTok(rootId); for (const id of ids) addTok(id); }
const TOKENS = [...tokenNeedles];
const TEXTS = [...textNeedles];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokenRe = new RegExp("(?<![A-Za-z0-9_])(?:" + TOKENS.map(esc).join("|") + ")(?![A-Za-z0-9_])");
/** every bank needle present in a body (names: the needle); the HTML's escaped apostrophes are undone first */
function bankHits(body) {
  const s = String(body).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  const hits = [];
  const m = s.match(tokenRe);
  if (m) hits.push(m[0]);
  for (const t of TEXTS) if (s.includes(t)) { hits.push(t); if (hits.length > 4) break; }
  return hits;
}
function assertNoBank(where, body) {
  const hits = bankHits(body);
  if (hits.length) throw new Error(where + " renders bank content: " + hits.slice(0, 4).map((h) => JSON.stringify(h)).join(", "));
}
const DEMO_TARGET = accounts.personas.find((p) => p.id !== "persona_viewer_main" && p.handle !== fixture.self.username)?.id;

// ------------------------------------------------------------------------------------------------ the validator DB
function db() {
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
  return new DatabaseSync(DB_PATH, { readOnly: true });
}
function dbCounts() {
  const d = db();
  try {
    const n = (sql) => d.prepare(sql).get().n;
    return {
      roots: n("SELECT COUNT(*) AS n FROM roots"),
      personas: n("SELECT COUNT(*) AS n FROM personas"),
      repEvents: n("SELECT COUNT(*) AS n FROM rep_events"),
      stateRows: n("SELECT COUNT(*) AS n FROM adapter_state"),
      namespaces: d.prepare("SELECT DISTINCT namespace FROM adapter_state").all().map((r) => r.namespace).sort(),
    };
  } finally { d.close(); }
}
/** one namespace's stored rows, every anchor: [anchor|key, value] sorted — compared before/after a refused write */
function nsRows(ns) {
  const d = db();
  try {
    return d.prepare("SELECT anchor, key, value FROM adapter_state WHERE namespace = ? ORDER BY anchor, key").all(ns).map((r) => [String(r.anchor) + "|" + String(r.key), String(r.value)]);
  } finally { d.close(); }
}
const rowsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("\nLAYERS_WORLD=empty — phase " + PHASE.toUpperCase() + " (app " + BASE + ", state " + WORLD_DIR + ")");

// ------------------------------------------------------------------------------------------------ shared probes
async function isEmptyWorldApp(c = main) {
  const probe = await c.api("POST", "/api/dev", { action: "worldProbe" });
  return probe.status === 403 && probe.json?.code === "empty_world";
}
async function worldReport() {
  return (await retry(() => api("GET", "/api/dev"), (r) => r.status === 200 && r.json?.world?.mode === "empty")).json.world;
}
function assertStoredKept(stored, label) {
  for (const [ns, d] of Object.entries(stored)) {
    if (d.missing) throw new Error(label + ": " + ns + ": " + d.missing + " hidden entr(y/ies) are no longer stored — a write DROPPED them");
    if (d.extra) throw new Error(label + ": " + ns + ": " + d.extra + " stored entr(y/ies) written under the flag would be HIDDEN on the next boot");
  }
}
async function withBrowser(fn) {
  const browser = await chromium.launch();
  try { return await fn(browser); } finally { await browser.close(); }
}
async function newCtx(browser, viewport) {
  const ctx = await browser.newContext({ viewport });
  const u = new URL(BASE);
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: u.hostname, path: "/" })));
  return ctx;
}
/** the switcher's rows in a real browser: [{handle, tier (null when no badge), verified}] */
async function switcherRows() {
  return withBrowser(async (browser) => {
    const ctx = await newCtx(browser, { width: 1300, height: 900 });
    const pg = await ctx.newPage();
    await pg.goto(BASE + "/home", { waitUntil: "domcontentloaded", timeout: 120000 });
    await pg.getByTestId("account-switcher-button").click({ timeout: 60000 });
    const sw = pg.getByTestId("account-switcher");
    await sw.waitFor({ timeout: 30000 });
    await sw.locator('[data-testid^="persona-row-"]').first().waitFor({ timeout: 30000 });
    const rows = [];
    for (const row of await sw.locator('[data-testid^="persona-row-"]').all()) {
      const handle = (await row.getAttribute("data-testid")).slice("persona-row-".length);
      const badge = row.locator('[data-testid="tier-badge"]');
      rows.push({ handle, tier: (await badge.count()) ? await badge.first().getAttribute("data-tier") : null, verified: (await row.locator('svg[aria-label="Verified account"]').count()) > 0, faces: await row.locator('img[src*="pravatar.cc"]').count() });
    }
    await ctx.close();
    return rows;
  });
}

// ================================================================================================ PHASE: FRESH
async function freshPhase() {
  if (!(await isEmptyWorldApp())) abort("this app is not in the empty world (an unlisted dev action did not answer 403 empty_world) — start it with WORLD=empty");
  {
    const self = bankHits(JSON.stringify(accounts) + JSON.stringify(fixture));
    if (self.length === 0) abort("the needle scanner found nothing in the bank files themselves — it would report every page clean");
    console.log("  (" + TOKENS.length + " token needles, " + TEXTS.length + " text needles; scanner self-test hit " + JSON.stringify(self[0]) + ")");
  }
  const DB0 = (() => { try { return dbCounts(); } catch (e) { abort(e.message); } })();
  const dev0 = await retry(() => api("GET", "/api/dev"), (r) => r.status === 200 && r.json?.world?.mode === "empty");
  const HIDDEN0 = dev0.json.world.hidden;
  const roster0 = await retry(() => api("GET", "/api/personas"));
  if ((roster0.json?.personas ?? []).length > 0)
    abort("this device already holds " + roster0.json.personas.length + " real persona(s) — the 'no persona yet' state cannot be measured; run on a fresh copy (WORLD_FRESH=1)");
  rmSync(STATE_FILE, { force: true });

  await check("1. THE DEMO WORLD IS STORED AND HIDDEN — not absent", async () => {
    const nsHidden = Object.entries(HIDDEN0).filter(([, n]) => n > 0);
    if (nsHidden.length < 5) throw new Error("only " + nsHidden.length + " namespace(s) hold hidden demo entries — this database does not hold the demo world, so every absence below would be vacuous");
    const total = nsHidden.reduce((a, [, n]) => a + n, 0);
    const stored = dev0.json.world.stored;
    for (const [ns, n] of nsHidden) {
      const d = stored[ns];
      if (!d || d.stash !== n || d.stored !== n || d.missing || d.extra) throw new Error(ns + ": stash " + n + " vs stored " + JSON.stringify(d));
    }
    if (DB0.roots < 10 || DB0.personas < 10) throw new Error("the validator holds " + DB0.roots + " roots / " + DB0.personas + " personas — not the seeded world");
    return total + " demo entries hidden across " + nsHidden.length + " namespaces (stash == stored); validator rows: " + DB0.roots + " roots, " + DB0.personas + " personas, " + DB0.repEvents + " rep events";
  });

  await check("2. NO PERSONA YET IS SAID, NOT FAKED — empty roster, /home points at the create path, pill says so", async () => {
    const opts = await retry(() => api("GET", "/api/personas/act-as-options"));
    if ((opts.json?.options ?? []).length) throw new Error("the act-as list offers " + opts.json.options.length + " persona(s) on a device with none");
    const home = await page("/home");
    if (!home.text.includes('data-testid="world-no-persona"')) throw new Error("/home does not say there is no persona yet");
    if (!home.text.includes('href="/settings/account"')) throw new Error("/home does not link to Settings > Account & Personas");
    if (!/data-testid="persona-pill"[^>]*data-state="none"/.test(home.text) && !/data-state="none"[^>]*data-testid="persona-pill"/.test(home.text) && !home.text.includes("No persona yet"))
      throw new Error("the persona pill does not say 'No persona yet'");
    assertNoBank("/home", home.text);
    // every top-level page still RENDERS with no persona (a page that 500s is not an honest empty state)
    const broken = [];
    for (const p of ["/explore", "/notifications", "/search?q=anything", "/settings", "/channels", "/rooms", "/folders", "/market", "/messages", "/curators/desk", "/settings/modes", "/settings/privacy"]) {
      const r = await api("GET", p, undefined, { raw: true });
      if (r.status !== 200) broken.push(p + " " + r.status);
      else assertNoBank(p + " (no persona)", r.text);
    }
    if (broken.length) throw new Error("pages that do not render with no persona: " + broken.join(", "));
    return "act-as list empty; /home says 'No personas yet' with a link to /settings/account; pill 'No persona yet'; 12 more pages render clean";
  });

  await check("3. SETTINGS → ACCOUNT OFFERS A PLAIN CREATE and names no fixture fid or root", async () => {
    const acct = await page("/settings/account");
    if (!acct.text.includes('data-testid="world-no-personas"')) throw new Error("/settings/account does not say there are no personas");
    if (!acct.text.includes('data-testid="world-create-persona"')) throw new Error("/settings/account offers no create form");
    if (acct.text.includes(">" + fixture.self.fid + "<") || acct.text.includes('"' + fixture.self.fid + '"'))
      throw new Error("the account page names the seed self's fid " + fixture.self.fid);
    if (!acct.text.includes("held by this device") || !acct.text.includes("none yet")) throw new Error("the root rows are not the real device's (no 'none yet' fid / keystore root)");
    if (acct.text.includes("Fork this persona")) throw new Error("the page still points at a 'Fork this persona' entry that does not exist");
    assertNoBank("/settings/account", acct.text);
    return "create form present; no fixture fid, root or persona in the render";
  });

  await check("12. THE CHROME NAMES NOBODY — no fixture name, handle, face, check mark or counts; every pill says 'No persona yet'", async () => {
    return withBrowser(async (browser) => {
      const notes = [];
      // ---- desktop: the rail's account button, both pills, the composer
      const ctx = await newCtx(browser, { width: 1300, height: 900 });
      const pg = await ctx.newPage();
      await pg.goto(BASE + "/home", { waitUntil: "domcontentloaded", timeout: 120000 });
      const btn = pg.getByTestId("account-switcher-button");
      await btn.waitFor({ timeout: 60000 });
      let txt = "";
      for (let i = 0; i < 30; i++) { txt = await btn.innerText(); if (txt.includes("No persona yet")) break; await sleep(500); }
      if (!txt.includes("No persona yet")) throw new Error("the rail's account button says " + JSON.stringify(txt) + ", not 'No persona yet'");
      if (/(?<![A-Za-z])jordan(?![A-Za-z])/.test(txt) || txt.includes(fixture.self.username)) throw new Error("the rail's account button names the fixture self: " + JSON.stringify(txt));
      if (await btn.locator('svg[aria-label="Verified account"]').count()) throw new Error("the rail's account button shows a check mark for nobody");
      if (await btn.locator("img").count()) throw new Error("the rail's account button shows a face for nobody");
      const pills = pg.locator('[data-testid="persona-pill"]');
      const n = await pills.count();
      if (n < 2) throw new Error("expected the rail AND the phone pill in the DOM, found " + n);
      for (let i = 0; i < n; i++) {
        const st = await pills.nth(i).getAttribute("data-state");
        if (st !== "none") throw new Error("persona pill #" + (i + 1) + " says data-state=" + JSON.stringify(st) + " (" + JSON.stringify(await pills.nth(i).innerText()) + "), not 'none' — the rail pill read 'Persona unavailable'");
      }
      notes.push(n + " pills say none");
      await pg.getByTestId("nav-post-button").click({ timeout: 30000 });
      await sleep(800);
      const faces = await pg.locator('img[src*="pravatar.cc"]').count();
      if (faces) throw new Error(faces + " fixture face(s) on the page with the composer open");
      assertNoBank("/home (desktop DOM, composer open)", await pg.locator("body").innerText());
      await ctx.close();
      // ---- phone: the header and the drawer
      const mctx = await newCtx(browser, { width: 390, height: 844 });
      const mp = await mctx.newPage();
      await mp.goto(BASE + "/home", { waitUntil: "domcontentloaded", timeout: 120000 });
      const opener = mp.locator('button[aria-label="Account menu"]');
      await opener.waitFor({ timeout: 60000 });
      if (await opener.locator("img").count()) throw new Error("the phone header shows a face for nobody");
      await opener.click();
      const drawer = mp.getByTestId("mobile-drawer");
      await drawer.waitFor({ timeout: 30000 });
      const dt = await drawer.innerText();
      for (const bad of ["jordan", "@" + fixture.self.username, "1,162", "4,242", "Following", "Followers"]) if (dt.includes(bad)) throw new Error("the phone drawer shows " + JSON.stringify(bad) + ": " + JSON.stringify(dt.slice(0, 200)));
      if (!dt.includes("No persona yet")) throw new Error("the phone drawer does not say 'No persona yet': " + JSON.stringify(dt.slice(0, 200)));
      if (await drawer.locator('svg[aria-label="Verified account"]').count()) throw new Error("the phone drawer shows a check mark for nobody");
      if (await mp.locator('img[src*="pravatar.cc"]').count()) throw new Error("the phone page shows a fixture face");
      await mctx.close();
      notes.push("drawer: no name, handle, face, counts or check");
      return notes.join("; ") + "; rail button 'No persona yet' with no face or check; composer shows no fixture face";
    });
  });

  await check("13. EVERY ONE-PERSONA SURFACE SAYS 'NO PERSONAS YET' — fork, influence, notifications; a post answers 409", async () => {
    const out = [];
    for (const p of ["/settings/identity/fork", "/settings/influence", "/notifications"]) {
      const r = await page(p);
      if (!r.text.includes('data-testid="world-no-persona"')) throw new Error(p + " does not say there is no persona yet");
      if (r.text.includes('data-testid="fork-loading"')) throw new Error(p + " waits on 'Loading…' for a persona that is not coming");
      if (r.text.includes("Couldn&#x27;t read your mode") || r.text.includes("Couldn't read your mode")) throw new Error(p + " reports an unreadable mode instead of no persona");
      assertNoBank(p, r.text);
      out.push(p);
    }
    // the browser too: the fork island hydrates into the same answer, never a spinner
    await withBrowser(async (browser) => {
      const ctx = await newCtx(browser, { width: 1300, height: 900 });
      const pg = await ctx.newPage();
      await pg.goto(BASE + "/settings/identity/fork", { waitUntil: "domcontentloaded", timeout: 120000 });
      await pg.getByTestId("world-no-persona").first().waitFor({ timeout: 30000 });
      await sleep(1500);
      if (await pg.getByTestId("fork-loading").count()) throw new Error("the fork page shows 'Loading…' after hydration");
      await ctx.close();
    });
    const cast = await api("POST", "/api/actions/cast", { text: "nobody " + stamp });
    if (cast.status !== 409 || cast.json?.code !== "no_persona" || !/No persona yet/.test(cast.json?.error ?? "")) throw new Error("a post with no persona answered " + cast.status + " " + JSON.stringify(cast.json));
    return out.join(", ") + " say 'No personas yet' (fork page hydrated, no spinner); a post answers 409 no_persona";
  });

  await check("14. A FAILED CREATE IS SAID AS JSON AND MINTS NOTHING (every mock call failing)", async () => {
    const set = await api("POST", "/api/dev", { action: "setLatency", range: null, failureRate: 1 });
    if (set.status !== 200) throw new Error("could not arm the failure rate (setLatency answered " + set.status + ")");
    let r;
    try {
      r = await api("POST", "/api/personas", { name: "Never " + stamp, handle: "never_" + stamp });
    } finally {
      const off = await api("POST", "/api/dev", { action: "setLatency", range: null, failureRate: null });
      if (off.status !== 200) throw new Error("could not disarm the failure rate (" + off.status + ") — later checks are unreliable");
    }
    if (r.status !== 503 || typeof r.json?.error !== "string" || !r.json.error.length) throw new Error("a create whose every attempt failed answered " + r.status + " " + (r.json ? JSON.stringify(r.json) : r.text.slice(0, 120)) + " — not a JSON 503 the form can show");
    const ros = await retry(() => api("GET", "/api/personas"));
    if ((ros.json?.personas ?? []).length) throw new Error("a failed create left " + ros.json.personas.length + " persona(s) behind");
    return "503 " + JSON.stringify(r.json.error.slice(0, 80)) + "; roster still empty";
  });

  await check("15. THE ZK RIG ACTIONS ARE AN ALLOWLIST under the flag — writers, forgers and oracles refused, the pure probe answers", async () => {
    const refused = ["revokeAttestation", "rosterExport", "nullifierProbe", "attestSubmitRaw", "drain", "setRepImpl", "registerIssuer", "budgetProbe", "resetZk", "seedDecoys"];
    for (const action of refused) {
      const r = await api("POST", "/api/zk", { action, issuerId: "onchain.age", bucket: "x", mode: "fixture" });
      if (r.status !== 403 || r.json?.code !== "empty_world") throw new Error(action + " answered " + r.status + " " + JSON.stringify(r.json).slice(0, 140));
    }
    const probe = await api("POST", "/api/zk", { action: "jitterProbe", epochShape: null });
    if (probe.status !== 200 || probe.json?.code === "empty_world") throw new Error("the read-only jitterProbe answered " + probe.status + " " + JSON.stringify(probe.json).slice(0, 140));
    return refused.length + " rig actions 403 empty_world (revokeAttestation included); jitterProbe answers";
  });

  await check("16. THE INBOX CURSOR IS NEVER HIDDEN — xSyncCursor is not partitioned, the app reads the stored cursor", async () => {
    if (HIDDEN0.xSyncCursor) throw new Error("xSyncCursor is partitioned: " + HIDDEN0.xSyncCursor + " entr(y/ies) hidden");
    const rows = nsRows("xSyncCursor");
    const inboxRow = rows.find(([k]) => k.endsWith("|layers-inbox"));
    const r = await retry(() => api("GET", "/api/x/inbox"), (x) => x.status === 200 && typeof x.json?.cursor === "number");
    if (inboxRow) {
      const stored = Number(JSON.parse(inboxRow[1]));
      if (Number.isFinite(stored) && r.json.cursor !== stored) throw new Error("the app reads inbox cursor " + r.json.cursor + ", the validator stores " + stored);
      return "xSyncCursor whole; the app reads the stored inbox cursor (" + r.json.cursor + ")";
    }
    return "xSyncCursor whole; no inbox cursor stored on this copy yet (STAGE stores one; OWNER check O6 measures the continuation)";
  });

  await check("17. DEMO STAKES ARE NOT SHOWN — clusters and cast summaries carry no demo row", async () => {
    const d = db();
    let demo;
    try {
      demo = d.prepare("SELECT epoch, cast_hash AS castHash, persona_id AS personaId FROM stakes WHERE mode = 'fixture' AND persona_id LIKE 'persona_%' ORDER BY epoch DESC LIMIT 1").get();
    } finally { d.close(); }
    if (!demo) throw new Error("the copy's validator holds no demo stake rows — the check would be vacuous");
    const v = await fetch(`${VBASE}/stakes?mode=fixture&epoch=${demo.epoch}`).then((x) => x.json());
    const demoRows = (v.stakes ?? []).filter((s) => String(s.personaId).startsWith("persona_"));
    if (!demoRows.length) throw new Error("the validator does not serve the demo rows it stores (epoch " + demo.epoch + ")");
    const cl = await retry(() => api("GET", "/api/influence?view=clusters&epoch=" + demo.epoch), (x) => x.status === 200 && Array.isArray(x.json?.clusters));
    if (cl.json.rows !== 0) throw new Error("the coordination view counts " + cl.json.rows + " row(s) in epoch " + demo.epoch + ", all of them demo");
    if (cl.json.clusters.length) throw new Error("the coordination view shows " + cl.json.clusters.length + " cluster(s): " + JSON.stringify(cl.json.clusters).slice(0, 160));
    const cast = await retry(() => api("GET", "/api/influence?view=cast&castHash=" + encodeURIComponent(demo.castHash)), (x) => x.status === 200 && Array.isArray(x.json?.rows));
    if (cast.json.rows.length || (cast.json.summary?.total ?? 0) !== 0) throw new Error("a demo cast's stake summary shows " + cast.json.rows.length + " row(s), total " + cast.json.summary?.total);
    // (the cast view echoes the castHash it was ASKED about — the demo hash this check chose — so that one field is not
    // the app rendering bank content; everything else in the answer is scanned)
    const { castHash: _asked, ...castAnswer } = cast.json;
    void _asked;
    assertNoBank("/api/influence", JSON.stringify(cl.json) + JSON.stringify(castAnswer));
    return "epoch " + demo.epoch + ": the validator serves " + demoRows.length + " demo row(s); the app shows 0 rows, 0 clusters, and an empty summary for a demo cast";
  });

  await check("18. A SET-BUT-EMPTY LAYERS_WORLD REFUSES TO BOOT — validator/seed.js and the app exit 78", async () => {
    const guardDb = path.join(WORLD_DIR, "guard-empty-world.db");
    rmSync(guardDb, { force: true });
    const seed = spawnSync(process.execPath, ["validator/seed.js"], { env: { ...process.env, LAYERS_WORLD: "", VALIDATOR_DB: guardDb }, encoding: "utf8", timeout: 60000 });
    if (seed.status !== 78) throw new Error("validator/seed.js with LAYERS_WORLD='' exited " + seed.status + ": " + (seed.stderr || seed.stdout).slice(0, 160));
    if (existsSync(guardDb)) throw new Error("validator/seed.js created a database before refusing");
    const port = 3092;
    const env = { ...process.env, NODE_ENV: "production", ZK_DEV_HOOKS: "true", LAYERS_WORLD: "", LAYERS_APP_PORT: String(port), KEYSTORE_DIR: path.join(WORLD_DIR, "keystore"), VALIDATOR_URL: VBASE };
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (out += b));
    const code = await new Promise((resolve) => {
      const t = setTimeout(() => { try { child.kill(); } catch {} resolve("timeout"); }, 90000);
      child.on("exit", (c) => { clearTimeout(t); resolve(c); });
    });
    if (code !== 78) throw new Error("the app with LAYERS_WORLD='' did not refuse (exit " + code + "): " + out.slice(-240));
    if (!/REFUSING TO START/.test(out) || !/EMPTY/.test(out)) throw new Error("the app's refusal does not say why: " + out.slice(-240));
    return "seed.js exit 78 (no database created); the app exit 78 with 'REFUSING TO START → LAYERS_WORLD is set but EMPTY'";
  });

  let ME = null;
  const HANDLE = "real_" + stamp;
  const NAME = "Real Person " + stamp;
  await check("4. THE FORK NEEDS A SOURCE; THE PLAIN CREATE DOES NOT — and mints a keystore persona", async () => {
    const fork = await api("POST", "/api/identity/fork", { newHandle: "nofrom_" + stamp });
    if (fork.status !== 400 || !/fromPersona required/.test(fork.json?.error ?? "")) throw new Error("a fork with no source answered " + fork.status + " " + JSON.stringify(fork.json));
    const forkStranger = await api("POST", "/api/identity/fork", { fromPersona: accounts.personas[0].id, newHandle: "stranger_" + stamp });
    if (forkStranger.status < 400) throw new Error("a fork FROM a seeded persona succeeded under the flag (" + forkStranger.status + ") — the bank is reachable");
    const made = await retry(
      () => api("POST", "/api/personas", { name: NAME, handle: HANDLE }),
      (r) => (r.status === 200 && r.json?.persona?.id) || r.status === 409
    );
    if (made.status === 409) {
      const ros = await retry(() => api("GET", "/api/personas"));
      ME = (ros.json?.personas ?? []).find((p) => p.handle === HANDLE) ?? null;
      if (!ME) throw new Error("409 on create, and the roster has no @" + HANDLE);
    } else ME = made.json.persona;
    if (!/^p_[0-9a-f]{32}$/.test(ME.id)) throw new Error("the created persona's id is not keystore-derived: " + ME.id);
    if (!jar.get("layers_seed_persona") || jar.get("layers_seed_persona") !== ME.id) throw new Error("the create did not make it the ACTING persona (layers_seed_persona)");
    // review F7: the same name and handle again RESUMES (a half-done create is finished, not refused); a different name
    // with the same handle is still "taken"
    const again = await retry(() => api("POST", "/api/personas", { name: NAME, handle: HANDLE }), (r) => r.status === 200 || r.status === 409);
    if (again.status !== 200 || again.json?.persona?.id !== ME.id) throw new Error("re-submitting the same name and handle answered " + again.status + " " + JSON.stringify(again.json).slice(0, 120) + " — not the same persona");
    const taken = await api("POST", "/api/personas", { name: "Someone Else " + stamp, handle: HANDLE });
    if (taken.status !== 409) throw new Error("the same handle under another name answered " + taken.status + ", not 409");
    return "fork without a source: 400; fork from a seeded persona: " + forkStranger.status + "; created @" + HANDLE + " (" + ME.id.slice(0, 10) + "…); the same create again resumes it, another name on the handle is 409";
  });
  if (!ME) { console.log("  ABORT: no persona was created; the rest cannot be measured"); process.exit(1); }

  await check("5. THE NEW PERSONA IS LISTED, ACTIVE AND ACTED AS", async () => {
    const ros = await retry(() => api("GET", "/api/personas"));
    const ids = (ros.json?.personas ?? []).map((p) => p.id);
    if (ids.length !== 1 || ids[0] !== ME.id) throw new Error("the roster is " + JSON.stringify(ids) + ", not exactly the created persona");
    if (ros.json.activeId !== ME.id) throw new Error("the switcher's active persona is " + ros.json.activeId);
    const opts = await retry(() => api("GET", "/api/personas/act-as-options"), (r) => r.status === 200 && (r.json?.options ?? []).length > 0);
    const optIds = opts.json.options.map((o) => o.id);
    if (optIds.length !== 1 || optIds[0] !== ME.id) throw new Error("act-as options " + JSON.stringify(optIds));
    const chrome = await retry(() => api("GET", "/api/persona/chrome"));
    if (chrome.json?.activePersonaId !== ME.id) throw new Error("the acting persona is " + chrome.json?.activePersonaId);
    const text = "first real post " + stamp;
    await retry(() => api("POST", "/api/actions/cast", { text }));
    const feed = await retry(() => api("GET", "/api/feed?tab=foryou"), (r) => r.status === 200 && (r.json?.casts ?? []).some((c) => (c.text ?? "").includes(text)));
    const mine = feed.json.casts.find((c) => (c.text ?? "").includes(text));
    if (mine.author?.username !== HANDLE) throw new Error("the cast is authored by @" + mine.author?.username + ", not the created persona");
    assertNoBank("/api/feed", JSON.stringify(feed.json));
    const home = await page("/home");
    if (!home.text.includes('data-persona-handle="' + HANDLE + '"')) throw new Error("/home's chrome does not act as @" + HANDLE);
    if (home.text.includes('data-testid="world-no-persona"')) throw new Error("/home still says there is no persona");
    assertNoBank("/home (acting)", home.text);
    return "roster = [@" + HANDLE + "], active and acting; a cast posted as it reads back authored by it";
  });

  await check("6. THE SWITCHER (a real browser) LISTS ONLY REAL PERSONAS — no seeded tier, no check mark, no fixture face", async () => {
    if (!roster.fids?.[String(fixture.self.fid)]) throw new Error("the copy's fixture roster maps no root to the seed self's fid " + fixture.self.fid + " — the 'no seeded tier' half would be vacuous");
    return withBrowser(async (browser) => {
      const ctx = await newCtx(browser, { width: 1300, height: 900 });
      const pg = await ctx.newPage();
      await pg.goto(BASE + "/home", { waitUntil: "domcontentloaded", timeout: 120000 });
      await pg.getByTestId("account-switcher-button").click({ timeout: 60000 });
      const sw = pg.getByTestId("account-switcher");
      await sw.waitFor({ timeout: 30000 });
      // poll for SETTLED content (9b): the row for the real persona, not just the menu
      await pg.getByTestId("persona-row-" + HANDLE).waitFor({ timeout: 30000 });
      const txt = await sw.innerText();
      const rows = await sw.locator('[data-testid^="persona-row-"]').count();
      if (rows !== 1) throw new Error("the switcher lists " + rows + " persona rows, expected exactly the created one");
      if (!txt.includes("@" + HANDLE)) throw new Error("the switcher does not list @" + HANDLE);
      if (!(await pg.getByTestId("create-persona-button").count())) throw new Error("the switcher offers no Create persona");
      const row = pg.getByTestId("persona-row-" + HANDLE);
      const badge = row.locator('[data-testid="tier-badge"]');
      if (await badge.count()) throw new Error("the real persona shows a tier badge (" + (await badge.first().getAttribute("data-tier")) + ") — the seeded self's reputation, read through the fixture root");
      if (await row.locator('svg[aria-label="Verified account"]').count()) throw new Error("the real persona shows a check mark");
      if (await pg.locator('img[src*="pravatar.cc"]').count()) throw new Error("a fixture face is on the page");
      assertNoBank("the switcher", txt);
      const body = await pg.locator("body").innerText();
      assertNoBank("/home (rendered DOM)", body);
      // the account button names the real persona now, still without a check mark
      const btn = await pg.getByTestId("account-switcher-button").innerText();
      if (!btn.includes(NAME)) throw new Error("the account button says " + JSON.stringify(btn) + ", not the real persona");
      if (await pg.getByTestId("account-switcher-button").locator('svg[aria-label="Verified account"]').count()) throw new Error("the account button shows a check mark for a real persona");
      await ctx.close();
      // the phone drawer with a persona: its name and handle, never the fixture's counts
      const mctx = await newCtx(browser, { width: 390, height: 844 });
      const mp = await mctx.newPage();
      await mp.goto(BASE + "/home", { waitUntil: "domcontentloaded", timeout: 120000 });
      await mp.locator('button[aria-label="Account menu"]').click({ timeout: 60000 });
      const drawer = mp.getByTestId("mobile-drawer");
      await drawer.waitFor({ timeout: 30000 });
      const dt = await drawer.innerText();
      if (!dt.includes("@" + HANDLE)) throw new Error("the phone drawer does not name @" + HANDLE + ": " + JSON.stringify(dt.slice(0, 160)));
      for (const bad of ["1,162", "4,242", "Followers"]) if (dt.includes(bad)) throw new Error("the phone drawer shows the fixture's " + JSON.stringify(bad) + " for a real persona");
      await mctx.close();
      return "one row (@" + HANDLE + "): no tier badge, no check mark; Create persona offered; the drawer names it with no fixture counts; no bank content";
    });
  });

  await check("7. PROFILE, EXPLORE AND SEARCH render content and no bank needle", async () => {
    const prof = await page("/" + HANDLE);
    if (!prof.text.includes(NAME)) throw new Error("the real persona's profile does not show its name");
    if (!prof.text.includes("first real post " + stamp)) throw new Error("the real persona's profile does not show its own post");
    if (prof.text.includes("Joined March 2021")) throw new Error("the profile carries the demo world's invented join date");
    assertNoBank("/" + HANDLE, prof.text);
    const ex = await page("/explore");
    if (!/Explore \/ X|placeholder="Search"/.test(ex.text)) throw new Error("/explore did not render its chrome");
    assertNoBank("/explore", ex.text);
    const sp = await page("/search?q=" + encodeURIComponent(HANDLE));
    if (!sp.text.includes(HANDLE)) throw new Error("/search did not render the query");
    assertNoBank("/search", sp.text);
    return "profile shows @" + HANDLE + " and its post; explore and search render, clean";
  });

  await check("8. A SEEDED PROFILE IS GONE, and search finds the real persona but no seeded one", async () => {
    const seededHandles = [fixture.self.username, accounts.personas[0].handle, accounts.personas[10].handle, fixture.users[0].username];
    for (const h of seededHandles) {
      const r = await api("GET", "/" + h, undefined, { raw: true });
      if (r.status !== 404) throw new Error("/" + h + " answered " + r.status + ", not 404");
    }
    const mine = await retry(() => api("GET", "/api/search?q=" + encodeURIComponent(HANDLE)), (r) => r.status === 200 && Array.isArray(r.json?.people));
    if (!mine.json.people.some((p) => (p.handle ?? p.username) === HANDLE)) throw new Error("search for @" + HANDLE + " does not find the real persona: " + JSON.stringify(mine.json.people).slice(0, 200));
    for (const q of [accounts.personas[0].handle, "restaking", fixture.users[0].username, spaces.channels[0].name]) {
      const r = await retry(() => api("GET", "/api/search?q=" + encodeURIComponent(q)), (x) => x.status === 200 && x.json && Array.isArray(x.json.posts));
      const n = (r.json.posts?.length ?? 0) + (r.json.people?.length ?? 0) + (r.json.channels?.length ?? 0);
      if (n) throw new Error("search for " + JSON.stringify(q) + " found " + n + " result(s): " + JSON.stringify(r.json).slice(0, 200));
    }
    return seededHandles.length + " seeded/fixture profiles 404; search finds @" + HANDLE + " and nothing for 4 bank queries";
  });

  await check("9. FEEDS, CHANNELS, ROOMS, FOLDERS, CURATORS, MARKET, NOTIFICATIONS: no bank content", async () => {
    const seen = [];
    for (const p of ["/api/feed2?surface=discovery", "/api/feed2?surface=following", "/api/feed?tab=following", "/api/channels", "/api/rooms", "/api/folders", "/api/notifications"]) {
      const r = await retry(() => api("GET", p), (x) => x.status === 200 && x.json !== null);
      assertNoBank(p, JSON.stringify(r.json));
      seen.push(p.replace("/api/", ""));
    }
    const d = await retry(() => api("GET", "/api/feed2?surface=discovery"), (x) => x.status === 200 && Array.isArray(x.json?.cards));
    const foreign = d.json.cards.filter((c) => c.kind === "post" && c.cast?.personaId && c.cast.personaId !== ME.id);
    if (foreign.length) throw new Error("the discovery feed carries " + foreign.length + " persona post(s) not by a real persona");
    for (const p of ["/channels", "/rooms", "/folders", "/curators/desk", "/market", "/notifications", "/settings/privacy"]) {
      const r = await page(p);
      assertNoBank(p, r.text);
      seen.push(p);
    }
    return seen.length + " APIs/pages clean; discovery carries " + d.json.cards.length + " card(s), none by a non-real persona";
  });

  let FORK = null;
  const FORK_HANDLE = "fork_" + stamp;
  await check("9b. A FORK OF A REAL PERSONA works under the flag, and the switcher's pick moves the ACTING persona", async () => {
    const fork = await retry(
      () => api("POST", "/api/identity/fork", { fromPersona: ME.id, newHandle: FORK_HANDLE, newName: "Fork " + stamp }),
      (r) => r.status === 200 && /^p_[0-9a-f]{32}$/.test(r.json?.newPersona ?? "")
    );
    FORK = fork.json.newPersona;
    const ros = await retry(() => api("GET", "/api/personas"), (r) => r.status === 200 && (r.json?.personas ?? []).length === 2);
    const ids = ros.json.personas.map((p) => p.id).sort();
    if (JSON.stringify(ids) !== JSON.stringify([ME.id, FORK].sort())) throw new Error("the roster after the fork is " + JSON.stringify(ids));
    await retry(() => api("POST", "/api/personas/active", { personaId: FORK }));
    const chrome = await retry(() => api("GET", "/api/persona/chrome"), (r) => r.status === 200 && r.json?.activePersonaId === FORK);
    const refused = await api("POST", "/api/personas/active", { personaId: accounts.personas[0].id });
    if (refused.status !== 400) throw new Error("switching to a seeded persona answered " + refused.status);
    await retry(() => api("POST", "/api/personas/active", { personaId: ME.id }));
    const back = await retry(() => api("GET", "/api/persona/chrome"), (r) => r.status === 200 && r.json?.activePersonaId === ME.id);
    assertNoBank("/api/personas", JSON.stringify(ros.json));
    return "forked @" + HANDLE + " -> @" + FORK_HANDLE + " (" + FORK.slice(0, 10) + "…); switch moved the acting persona there and back (" + (chrome.json.activePersonaId === FORK) + "/" + (back.json.activePersonaId === ME.id) + "); a seeded persona is refused";
  });

  await check("19. ONE IDENTITY — a switch through /api/seed-persona moves the session's persona, and a post is authored by the persona the pill names", async () => {
    if (!FORK) throw new Error("no fork to switch between (9b failed)");
    // the state the review built: both cookies on ME (the last /api/personas/active), then Settings › Account switches
    // to the fork through /api/seed-persona
    await retry(() => api("POST", "/api/personas/active", { personaId: ME.id }));
    await retry(() => api("POST", "/api/seed-persona", { personaId: FORK }));
    if (jar.get("layers_active_persona") !== FORK) throw new Error("/api/seed-persona did not move the switcher's cookie (layers_active_persona is " + jar.get("layers_active_persona") + ")");
    // and even with a STALE switcher cookie the session follows the acting persona
    jar.set("layers_active_persona", ME.id);
    const ros = await retry(() => api("GET", "/api/personas"));
    if (ros.json?.activeId !== FORK) throw new Error("with the acting persona @" + FORK_HANDLE + " and a stale switcher cookie, the session's active persona is " + ros.json?.activeId);
    const home = await page("/home");
    if (!home.text.includes('data-persona-handle="' + FORK_HANDLE + '"')) throw new Error("the pill does not name @" + FORK_HANDLE);
    const text = "pill and author agree " + stamp;
    await retry(() => api("POST", "/api/actions/cast", { text }));
    const feed = await retry(() => api("GET", "/api/feed?tab=foryou"), (r) => r.status === 200 && (r.json?.casts ?? []).some((c) => (c.text ?? "").includes(text)));
    const cast = feed.json.casts.find((c) => (c.text ?? "").includes(text));
    if (cast.author?.username !== FORK_HANDLE) throw new Error("the pill names @" + FORK_HANDLE + " but the post is authored by @" + cast.author?.username);
    await retry(() => api("POST", "/api/personas/active", { personaId: ME.id }));
    return "seed-persona moved both cookies; with a stale switcher cookie the session still follows the acting persona; the post is authored by @" + FORK_HANDLE + ", the persona the pill names";
  });

  await check("20. THE FORK IS REACHABLE — Settings › Account links to /settings/identity/fork once a persona exists", async () => {
    const acct = await page("/settings/account");
    if (!acct.text.includes('data-testid="world-fork-link"') || !acct.text.includes('href="/settings/identity/fork"')) throw new Error("/settings/account has no link to the fork page");
    const fork = await page("/settings/identity/fork");
    if (fork.text.includes('data-testid="world-no-persona"')) throw new Error("the fork page says there is no persona while one is acting");
    return "a next/link to /settings/identity/fork on the account page; the fork page renders for the acting persona";
  });

  await check("21. RECORDS FOR THE RESTART — a rule, a folder, a channel and a mode made by the real persona (ids handed to OWNER)", async () => {
    actAs(ME.id);
    const rule = (await retry(() => api("POST", "/api/rules", { name: "fresh rule " + stamp, action: "hide", root: { combinator: "AND", clauses: [{ field: "post.age", op: "gt", value: 1440 }] } }), (r) => r.status === 200 && r.json?.rule?.id)).json.rule;
    const folder = (await retry(() => api("POST", "/api/folders", { name: "fresh folder " + stamp, isPublic: false, postHashes: [] }), (r) => r.status === 200 && r.json?.folder?.id)).json.folder;
    const channel = (await retry(() => api("POST", "/api/channels", { name: "fresh channel " + stamp, policy: "open" }), (r) => r.status === 200 && r.json?.channel?.id)).json.channel;
    const mode = (await retry(() => api("POST", "/api/modes", { name: "fresh mode " + stamp }), (r) => r.status === 200 && r.json?.mode?.id)).json.mode;
    const records = { rule: [rule.id, rule.name], folder: [folder.id, folder.name], channel: [channel.id, channel.name], mode: [mode.id, mode.name] };
    writeState({ fresh: { me: ME.id, handle: HANDLE, name: NAME, fork: FORK, forkHandle: FORK_HANDLE, records, stamp } });
    return Object.entries(records).map(([k, [id]]) => k + " " + id).join(", ");
  });

  // PERSONA LAUNCH P2 (review W1-R5): lib/x/attestations.ts xRigFixturesAvailable — the rig's X fixture conveniences are
  // not the empty world's. Reads and refused POSTs only: nothing here writes, so check 11 is unaffected.
  await check("22. THE X FIXTURE CONVENIENCES ARE THE RIG'S — no test link, no fixture archive, raw ingest or chunk tamper (404), no MigrationPanel", async () => {
    const link = await retry(() => api("GET", "/api/x/link"));
    if (link.json?.fixtureAvailable !== false) throw new Error("GET /api/x/link fixtureAvailable " + link.json?.fixtureAvailable);
    const made = await api("POST", "/api/x/link", { action: "link", fixtureHandle: "world_probe_" + stamp });
    if (made.status !== 404) throw new Error("a test link answered " + made.status + " " + JSON.stringify(made.json).slice(0, 140));
    const sum = await retry(() => api("GET", "/api/x/import?view=summary"));
    if (sum.json?.fixtureAvailable !== false) throw new Error("the import summary offers the fixture archive");
    for (const body of [{ action: "ingestFixture", sessionId: "ximp_world_probe" }, { action: "ingest", sessionId: "ximp_world_probe", name: "account.js", content: "" }, { action: "devTamperChunk", ns: "xShelf.g0.0" }, { action: "devRestoreChunk", ns: "xShelf.g0.0" }]) {
      const r = await api("POST", "/api/x/import", body);
      if (r.status !== 404) throw new Error(body.action + " answered " + r.status + " " + JSON.stringify(r.json).slice(0, 140));
    }
    const html = (await page("/settings/import-x")).text;
    if (html.includes('data-testid="migration-panel"')) throw new Error("/settings/import-x renders MigrationPanel");
    return "link 404, 4 import hooks 404, no MigrationPanel";
  });

  await check("10. DESTRUCTIVE DEV ACTIONS ARE REFUSED under the flag — before they act", async () => {
    const refusals = [
      ["/api/dev", { action: "resetSeed" }],
      ["/api/dev", { action: "simulateDeviceLoss" }],
      ["/api/dev", { action: "tamperState", ns: "modes" }],
      ["/api/dev", { action: "corruptVaultCiphertext", ns: "grantsV3" }],
      ["/api/zk", { action: "resetZk" }],
      ["/api/zk", { action: "seedDecoys", count: 3 }],
      ["/api/fc/persona", { action: "forget", mode: "fixture" }],
    ];
    for (const [p, b] of refusals) {
      const r = await api("POST", p, b);
      if (r.status !== 403 || r.json?.code !== "empty_world") throw new Error(p + " " + b.action + " answered " + r.status + " " + JSON.stringify(r.json).slice(0, 160));
    }
    // and the allowed half still works (a refusal-of-everything would pass the line above vacuously)
    const lat = await api("POST", "/api/dev", { action: "setLatency", range: null, failureRate: null });
    if (lat.status !== 200) throw new Error("an allowed dev action (setLatency) answered " + lat.status);
    const ros = await retry(() => api("GET", "/api/personas"));
    if (!(ros.json?.personas ?? []).some((p) => p.id === ME.id)) throw new Error("the real persona is gone after the refused actions");
    return refusals.length + " destructive actions refused (403 empty_world); setLatency allowed; the persona is intact";
  });

  await check("11. HIDDEN IS KEPT — every write carried the hidden rows back; no validator row shrank", async () => {
    const w = await worldReport();
    for (const [ns, n] of Object.entries(HIDDEN0)) if (w.hidden[ns] !== n) throw new Error(ns + ": the stash changed from " + n + " to " + w.hidden[ns]);
    assertStoredKept(w.stored, "after the fresh phase");
    const DB1 = dbCounts();
    for (const k of ["roots", "personas", "repEvents"]) if (DB1[k] < DB0[k]) throw new Error("validator " + k + " shrank: " + DB0[k] + " -> " + DB1[k]);
    const lost = DB0.namespaces.filter((ns) => !DB1.namespaces.includes(ns));
    if (lost.length) throw new Error("stored namespaces vanished: " + lost.join(", "));
    writeState({ freshCounts: DB1 });
    return Object.keys(HIDDEN0).length + " namespaces: every hidden entry still stored (0 missing, 0 extra); collisions " + JSON.stringify(w.collisions ?? {}) + "; roots " + DB0.roots + "->" + DB1.roots + ", personas " + DB0.personas + "->" + DB1.personas + ", rep events " + DB0.repEvents + "->" + DB1.repEvents + ", namespaces " + DB0.namespaces.length + "->" + DB1.namespaces.length;
  });
}

// ================================================================================================ PHASE: SEED (demo)
// The copy must HOLD a stored demo world for every absence in FRESH to mean something (check 1). A rig straight after
// a seed reset holds almost none under its own anchor (the seeders live in memory until something writes), so this
// phase writes it the way an owner using the demo world did: as the seeded self, through the product routes. Each
// write persists its WHOLE namespace — the seeders' demo rows included. Nothing here makes a persona of this device.
async function seedPhase() {
  if (await isEmptyWorldApp()) abort("SEED runs on the DEMO world over a fresh copy (WORLD=copy WORLD_FRESH=1) — this app is in the empty world");
  rmSync(STATE_FILE, { force: true });
  const DB0 = dbCounts();
  await check("SEED. THE DEMO WORLD IS WRITTEN TO THE COPY through the product routes (follows, a block, a rule, a folder, a channel, a mode)", async () => {
    const p = accounts.personas.filter((x) => x.id !== "persona_viewer_main");
    await retry(() => api("POST", "/api/follow", { personaId: p[1].id, follow: true }));
    await retry(() => api("POST", "/api/follow", { personaId: p[2].id, follow: true }));
    await retry(() => api("POST", "/api/block-seed", { personaId: p[4].id }), (r) => r.status === 200 && r.json?.ok);
    await retry(() => api("POST", "/api/rules", { name: "seed rule " + stamp, action: "hide", root: { combinator: "AND", clauses: [{ field: "post.age", op: "gt", value: 1440 }] } }), (r) => r.status === 200 && r.json?.rule?.id);
    await retry(() => api("POST", "/api/folders", { name: "seed folder " + stamp, isPublic: false, postHashes: [posts[0].hash] }), (r) => r.status === 200 && r.json?.folder?.id);
    await retry(() => api("POST", "/api/channels", { name: "seed channel " + stamp, policy: "open" }), (r) => r.status === 200 && r.json?.channel?.id);
    await retry(() => api("GET", "/api/modes"), (r) => r.status === 200 && Array.isArray(r.json?.modes));
    await retry(() => api("POST", "/api/modes", { name: "seed mode " + stamp }), (r) => r.status === 200 && r.json?.mode?.id);
    const ros = await retry(() => api("GET", "/api/personas"));
    const real = (ros.json?.personas ?? []).filter((x) => /^p_[0-9a-f]{32}$/.test(x.id));
    if (real.length) throw new Error("the seed made " + real.length + " persona(s) of this device — FRESH could not measure 'no persona yet'");
    const DB1 = dbCounts();
    if (DB1.stateRows <= DB0.stateRows) throw new Error("nothing was stored (" + DB0.stateRows + " -> " + DB1.stateRows + " rows)");
    return "adapter_state rows " + DB0.stateRows + " -> " + DB1.stateRows + "; no persona of this device";
  });
}

// ================================================================================================ PHASE: STAGE (demo)
async function stagePhase() {
  const st = readState();
  if (!st.fresh) abort("no FRESH hand-over in " + STATE_FILE + " — run WORLD_PHASE=fresh first, on this copy");
  if (await isEmptyWorldApp()) abort("STAGE runs on the DEMO world over the same copy (WORLD=copy) — this app is in the empty world");
  const dev = await retry(() => api("GET", "/api/dev"));
  if (dev.json?.world) abort("this app reports an empty-world report — not the demo world");
  if (!DEMO_TARGET) abort("no demo persona to block in seed/data/accounts.json");
  const STAGE_HANDLE = "stagefork_" + stamp;
  let SF = null;

  await check("S1. THE OWNER'S PRE-FLAG STATE IS STAGED in the demo world — a fork of the seeded self that blocked a demo account, pinned its Default mode to the seeded self, owns a channel the seeded self joined, and polled the inbox", async () => {
    // the owner's actual pre-flag move: fork the seeded self (persona_viewer_main, the demo world's acting default)
    const fork = await retry(
      () => api("POST", "/api/identity/fork", { fromPersona: "persona_viewer_main", newHandle: STAGE_HANDLE, newName: "Stage Fork " + stamp }),
      (r) => r.status === 200 && /^p_[0-9a-f]{32}$/.test(r.json?.newPersona ?? "")
    );
    SF = fork.json.newPersona;
    await retry(() => api("POST", "/api/seed-persona", { personaId: SF }));
    jar.set("layers_seed_persona", SF);
    // a block of a demo account (blocks[SF] = [demo])
    const b = await retry(() => api("POST", "/api/block-seed", { personaId: DEMO_TARGET }), (r) => r.status === 200 && r.json?.ok);
    // its Default mode, customised to name the seeded self (a preset whose stored copy names a demo persona)
    await retry(() => api("GET", "/api/modes"), (r) => r.status === 200 && (r.json?.modes ?? []).some((m) => m.id === "mode_default_" + SF));
    await retry(() => api("PATCH", "/api/modes", { modeId: "mode_default_" + SF, patch: { pinnedPersonaId: "persona_viewer_main", name: "Default (staged " + stamp + ")" } }), (r) => r.status === 200 && r.json?.mode?.pinnedPersonaId === "persona_viewer_main");
    // a channel it owns, joined by the seeded self
    const chan = (await retry(() => api("POST", "/api/channels", { name: "Owner channel " + stamp, policy: "open" }), (r) => r.status === 200 && r.json?.channel?.id)).json.channel;
    jar.set("layers_seed_persona", "persona_viewer_main");
    await retry(() => api("POST", "/api/channels/join", { channelId: chan.id }), (r) => r.status === 200 && r.json?.membership);
    jar.set("layers_seed_persona", SF);
    const members = await retry(() => api("GET", "/api/channels?channelId=" + encodeURIComponent(chan.id)), (r) => r.status === 200 && Array.isArray(r.json?.members));
    if (!members.json.members.some((m) => m.personaId === "persona_viewer_main")) throw new Error("the seeded self did not join the staged channel");
    // the inbox cursor (a persona-free key): one poll in the demo world
    const before = (await retry(() => api("GET", "/api/x/inbox"), (r) => r.status === 200 && typeof r.json?.cursor === "number")).json.cursor;
    await retry(() => api("POST", "/api/x/inbox", { action: "poll" }), (r) => r.status === 200 && typeof r.json?.cursor === "number");
    const cursor = (await retry(() => api("GET", "/api/x/inbox"), (r) => r.status === 200 && typeof r.json?.cursor === "number")).json.cursor;
    if (!(cursor > before) || cursor < 1) throw new Error("the inbox cursor did not advance (" + before + " -> " + cursor + ")");
    writeState({ stage: { sf: SF, handle: STAGE_HANDLE, demoBlocked: DEMO_TARGET, channel: chan.id, cursor, blockedAfter: b.json.blockedPersonaIds?.length ?? null } });
    return "fork @" + STAGE_HANDLE + " (" + SF.slice(0, 10) + "…) of the seeded self; blocked a demo account; Default pinned to the seeded self; channel " + chan.id + " joined by the seeded self; inbox cursor " + before + " -> " + cursor;
  });

  await check("S2. IN THE DEMO WORLD THAT FORK SHOWS THE SEEDED SELF'S TIER (so the empty world's 'no seeded tier' is measured against a persona that had one)", async () => {
    if (!SF) throw new Error("nothing staged");
    jar.set("layers_seed_persona", SF);
    const rows = await switcherRows();
    const row = rows.find((r) => r.handle === STAGE_HANDLE);
    if (!row) throw new Error("the demo-world switcher does not list @" + STAGE_HANDLE + ": " + JSON.stringify(rows.map((r) => r.handle)).slice(0, 200));
    if (!row.tier || !/^\d+$/.test(row.tier) || Number(row.tier) < 1) throw new Error("the staged fork shows no numeric tier in the demo world (" + row.tier + ") — the empty-world check would be vacuous");
    writeState({ stageTier: Number(row.tier) });
    return "@" + STAGE_HANDLE + " shows tier " + row.tier + " in the demo world (the fixture root's seeded reputation)";
  });
}

// ================================================================================================ PHASE: OWNER
async function ownerPhase() {
  const st = readState();
  if (!st.fresh || !st.stage) abort("no FRESH and STAGE hand-over in " + STATE_FILE + " — run them first, on this copy");
  if (!(await isEmptyWorldApp())) abort("OWNER runs on the empty world (WORLD=empty) — this app is not");
  const { me: ME, fork: FORK, records } = st.fresh;
  const { sf: SF, handle: SF_HANDLE, demoBlocked, channel: CHAN, cursor: CURSOR } = st.stage;
  const DB0 = dbCounts();
  const w0 = await worldReport();

  await check("O1. AFTER THE RESTART THE THREE REAL PERSONAS ARE THE ROSTER, the demo world's later writes are hidden, and nothing hidden is missing", async () => {
    const ros = await retry(() => api("GET", "/api/personas"), (r) => r.status === 200 && (r.json?.personas ?? []).length >= 3);
    const ids = ros.json.personas.map((p) => p.id).sort();
    if (JSON.stringify(ids) !== JSON.stringify([ME, FORK, SF].sort())) throw new Error("the roster is " + JSON.stringify(ids));
    assertStoredKept(w0.stored, "at boot");
    for (const ns of ["blocks", "modes", "channelMembers"]) if (!(w0.hidden[ns] > 0)) throw new Error(ns + " holds nothing hidden — the staged mixed records are not being measured");
    assertNoBank("/api/personas", JSON.stringify(ros.json));
    return "roster = the fresh persona, its fork and the staged fork; hidden " + JSON.stringify({ blocks: w0.hidden.blocks, modes: w0.hidden.modes, channelMembers: w0.hidden.channelMembers }) + "; 0 missing, 0 extra";
  });

  await check("O2. IDS ARE UNIQUE ACROSS RESTARTS — the fresh phase's records are intact, and new ones never reuse their ids", async () => {
    actAs(ME);
    const earlier = new Map(Object.values(records).map(([id, name]) => [id, name]));
    const made = [];
    for (let i = 0; i < 3; i++) made.push((await retry(() => api("POST", "/api/rules", { name: "owner rule " + i + " " + stamp, action: "hide", root: { combinator: "AND", clauses: [{ field: "post.age", op: "gt", value: 1440 }] } }), (r) => r.status === 200 && r.json?.rule?.id)).json.rule.id);
    for (let i = 0; i < 2; i++) made.push((await retry(() => api("POST", "/api/folders", { name: "owner folder " + i + " " + stamp, isPublic: false, postHashes: [] }), (r) => r.status === 200 && r.json?.folder?.id)).json.folder.id);
    made.push((await retry(() => api("POST", "/api/channels", { name: "owner channel " + stamp, policy: "open" }), (r) => r.status === 200 && r.json?.channel?.id)).json.channel.id);
    made.push((await retry(() => api("POST", "/api/modes", { name: "owner mode " + stamp }), (r) => r.status === 200 && r.json?.mode?.id)).json.mode.id);
    const reused = made.filter((id) => earlier.has(id));
    if (reused.length) throw new Error("a new record reused an earlier id: " + reused.join(", "));
    const rules = (await retry(() => api("GET", "/api/rules"), (r) => r.status === 200 && Array.isArray(r.json?.rules))).json.rules;
    const folders = (await retry(() => api("GET", "/api/folders"), (r) => r.status === 200 && Array.isArray(r.json?.folders))).json.folders;
    const channels = (await retry(() => api("GET", "/api/channels"), (r) => r.status === 200 && Array.isArray(r.json?.channels))).json.channels;
    const modes = (await retry(() => api("GET", "/api/modes"), (r) => r.status === 200 && Array.isArray(r.json?.modes))).json.modes;
    const all = new Map([...rules, ...folders, ...channels, ...modes].map((x) => [x.id, x.name]));
    for (const [id, name] of earlier) if (all.get(id) !== name) throw new Error("the fresh record " + id + " now reads " + JSON.stringify(all.get(id)) + " (was " + JSON.stringify(name) + ") — overwritten or lost across the restart");
    for (const id of made) if (!all.has(id)) throw new Error("the new record " + id + " is not listed");
    writeState({ owner: { made } });
    return earlier.size + " fresh records intact after the restart; " + made.length + " new records, no id reused (e.g. " + [...earlier.keys()][0] + " vs " + made[0] + ")";
  });

  await check("O3. A REAL PERSONA'S MIXED COLLECTION IS SPLIT, NOT REPLACED — its block of a demo account stays stored, unshown, when it blocks someone new", async () => {
    actAs(SF);
    const before = w0.hidden.blocks;
    const r = await retry(() => api("POST", "/api/block-seed", { personaId: FORK }), (x) => x.status === 200 && x.json?.ok && Array.isArray(x.json?.blockedPersonaIds));
    const shown = r.json.blockedPersonaIds;
    if (!shown.includes(FORK)) throw new Error("the new block is not shown: " + JSON.stringify(shown));
    if (shown.includes(demoBlocked)) throw new Error("the demo account the staged fork blocked is SHOWN under the flag");
    const w = await worldReport();
    if (w.hidden.blocks !== before) throw new Error("the stash for blocks changed from " + before + " to " + w.hidden.blocks);
    const d = w.stored.blocks;
    if (!d || d.missing || d.extra) throw new Error("blocks as stored: " + JSON.stringify(d) + " — the demo element was dropped (the old merge let the new list replace the stored one)");
    return "blocked list shows the new block only; the hidden demo element is still stored (blocks: stash " + d.stash + " = stored " + d.stored + ", 0 missing)";
  });

  await check("O4. A REGENERATED PRESET KEEPS THE STORED MODE — the collision is reported, the hidden (customised) Default is kept", async () => {
    actAs(SF);
    const modes = (await retry(() => api("GET", "/api/modes"), (r) => r.status === 200 && Array.isArray(r.json?.modes))).json.modes;
    const def = modes.find((m) => m.id === "mode_default_" + SF);
    if (!def) throw new Error("the staged fork has no Default mode under the flag");
    if (def.pinnedPersonaId === "persona_viewer_main") throw new Error("the hidden Default (pinned to the seeded self) is SHOWN");
    // a write to the namespace — so the merge decides the colliding key
    await retry(() => api("POST", "/api/modes", { name: "owner-sf mode " + stamp }), (r) => r.status === 200 && r.json?.mode?.id);
    const w = await worldReport();
    const d = w.stored.modes;
    if (!d || d.missing || d.extra) throw new Error("modes as stored: " + JSON.stringify(d) + " — the customised Default was replaced by the regenerated preset");
    if (!(w.collisions?.modes >= 1)) throw new Error("the collision was not reported (collisions " + JSON.stringify(w.collisions) + ")");
    return "Default regenerated in memory (not the hidden one); the stored customised Default kept (modes: 0 missing); collisions reported " + JSON.stringify(w.collisions);
  });

  await check("O5. A CHANNEL'S MEMBER LIST KEEPS ITS DEMO MEMBER when a real persona joins", async () => {
    actAs(FORK);
    await retry(() => api("POST", "/api/channels/join", { channelId: CHAN }), (r) => r.status === 200 && r.json?.membership);
    const v = await retry(() => api("GET", "/api/channels?channelId=" + encodeURIComponent(CHAN)), (r) => r.status === 200 && Array.isArray(r.json?.members));
    const ids = v.json.members.map((m) => m.personaId);
    if (!ids.includes(FORK)) throw new Error("the join is not shown: " + JSON.stringify(ids));
    if (ids.some((id) => !/^p_[0-9a-f]{32}$/.test(id))) throw new Error("a non-real member is SHOWN: " + JSON.stringify(ids));
    const w = await worldReport();
    const d = w.stored.channelMembers;
    if (!d || d.missing || d.extra) throw new Error("channelMembers as stored: " + JSON.stringify(d) + " — the demo member was dropped by the join");
    assertNoBank("/api/channels?channelId=", JSON.stringify(v.json));
    return "members shown: " + ids.length + " real; the seeded self's hidden membership still stored (channelMembers: 0 missing)";
  });

  await check("O6. THE INBOX CURSOR CONTINUES from the stored one — a poll never rewinds it", async () => {
    actAs(ME);
    const g1 = await retry(() => api("GET", "/api/x/inbox"), (r) => r.status === 200 && typeof r.json?.cursor === "number");
    if (g1.json.cursor !== CURSOR) throw new Error("the app reads inbox cursor " + g1.json.cursor + "; the demo world stored " + CURSOR + " (hidden → rewound to 0)");
    await retry(() => api("POST", "/api/x/inbox", { action: "poll" }), (r) => r.status === 200 && typeof r.json?.cursor === "number");
    const g2 = await retry(() => api("GET", "/api/x/inbox"), (r) => r.status === 200 && typeof r.json?.cursor === "number");
    if (g2.json.cursor !== CURSOR + 1) throw new Error("after one poll the cursor is " + g2.json.cursor + ", not " + (CURSOR + 1));
    const row = nsRows("xSyncCursor").find(([k]) => k.endsWith("|layers-inbox"));
    const stored = row ? Number(JSON.parse(row[1])) : NaN;
    if (Number.isFinite(stored) && stored !== CURSOR + 1) throw new Error("the validator stores inbox cursor " + stored + ", not " + (CURSOR + 1));
    return "cursor " + CURSOR + " read back, one poll -> " + (CURSOR + 1) + (Number.isFinite(stored) ? " (stored " + stored + ")" : "");
  });

  await check("O7. A PRE-FLAG FORK OF THE SEEDED SELF CARRIES NO SEEDED TIER — nor does any real persona", async () => {
    actAs(ME);
    const rows = await switcherRows();
    const sfRow = rows.find((r) => r.handle === SF_HANDLE);
    if (!sfRow) throw new Error("the switcher does not list the staged fork @" + SF_HANDLE + ": " + JSON.stringify(rows.map((r) => r.handle)));
    const tiered = rows.filter((r) => r.tier !== null);
    if (tiered.length) throw new Error("real personas show tiers " + JSON.stringify(tiered) + " — the demo world showed " + st.stageTier + " for the staged fork (the seeded self's reputation)");
    if (rows.some((r) => r.verified || r.faces)) throw new Error("a real persona shows a check mark or a fixture face: " + JSON.stringify(rows));
    return rows.length + " rows, none with a tier badge (the staged fork showed tier " + st.stageTier + " in the demo world), no check mark, no fixture face";
  });

  await check("O8. HIDDEN IS KEPT, entry by entry, and no validator row shrank", async () => {
    const w = await worldReport();
    assertStoredKept(w.stored, "after the owner phase");
    const DB1 = dbCounts();
    for (const k of ["roots", "personas", "repEvents"]) if (DB1[k] < DB0[k]) throw new Error("validator " + k + " shrank: " + DB0[k] + " -> " + DB1[k]);
    const lost = DB0.namespaces.filter((ns) => !DB1.namespaces.includes(ns));
    if (lost.length) throw new Error("stored namespaces vanished: " + lost.join(", "));
    return Object.keys(w.stored).length + " namespaces: 0 missing, 0 extra; collisions " + JSON.stringify(w.collisions) + "; rows roots " + DB0.roots + "->" + DB1.roots + ", personas " + DB0.personas + "->" + DB1.personas;
  });
}

// ================================================================================================ PHASE: ROLLBACK
function killPort(port) {
  spawnSync("powershell.exe", ["-NoProfile", "-Command", `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`], { stdio: "ignore", timeout: 60000 });
}
function portOwner(port) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8", timeout: 60000 });
  return (r.stdout || "").trim();
}
/** a validator proxy the suite can break: GET /state (the whole-state read), GET /state/rootRoster and
 *  GET /state/zkAttestations answer 503 while their switch is on; everything else is forwarded byte for byte */
function startProxy(port, target) {
  const broken = { state: false, rootRoster: false, zkAttestations: false };
  const refused = { state: 0, rootRoster: 0, zkAttestations: 0 };
  const t = new URL(target);
  const server = http.createServer((req, res) => {
    const p = (req.url || "").split("?")[0];
    if (req.method === "GET" && p === "/state" && broken.state) { refused.state++; res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":"proxy: state read broken"}'); }
    if (req.method === "GET" && p === "/state/rootRoster" && broken.rootRoster) { refused.rootRoster++; res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":"proxy: roster read broken"}'); }
    if (req.method === "GET" && p === "/state/zkAttestations" && broken.zkAttestations) { refused.zkAttestations++; res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":"proxy: attestation vault read broken"}'); }
    const up = http.request({ hostname: t.hostname, port: t.port, path: req.url, method: req.method, headers: { ...req.headers, host: t.host } }, (ur) => { res.writeHead(ur.statusCode || 502, ur.headers); ur.pipe(res); });
    up.on("error", (e) => { res.writeHead(502); res.end(String(e.message)); });
    req.pipe(up);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, broken, refused })));
}

async function rollbackPhase() {
  const st = readState();
  if (!st.fresh || !st.stage) abort("no FRESH and STAGE hand-over in " + STATE_FILE + " — run FRESH, STAGE and OWNER first, on this copy");
  const APP_PORT = 3091;
  const PROXY_PORT = 4091;
  for (const p of [APP_PORT, PROXY_PORT]) if (portOwner(p)) abort("port " + p + " is in use — the rollback app and proxy need it");
  // the pair's own app shares this copy's device identity (and its signed-request counters): stop it, so only the
  // rollback app signs. The validator stays up (the proxy forwards to it).
  killPort(Number(new URL(BASE).port));
  for (let i = 0; i < 30 && portOwner(Number(new URL(BASE).port)); i++) await sleep(1000);
  const secret = randomBytes(24).toString("base64url"); // a test passphrase for this run only, never printed
  const proxy = await startProxy(PROXY_PORT, VBASE);
  proxy.broken.state = true;
  proxy.broken.rootRoster = true;
  // review WE-5: broken from the FIRST request, so no read of the attestation vault can succeed (and be cached by the
  // process) before R4 measures the refusal — a failed read is never cached, a successful one is
  proxy.broken.zkAttestations = true;
  const RB = `http://localhost:${APP_PORT}`;
  const env = { ...process.env };
  delete env.LAYERS_WORLD;
  Object.assign(env, {
    NODE_ENV: "production", ZK_DEV_HOOKS: "true", LAYERS_REQUIRE_SIG: "true", ZK_PREFETCH_MS: "600000", DATA_SOURCE: "",
    OWNER_ACCESS_SECRET: secret, KEYSTORE_DIR: path.join(WORLD_DIR, "keystore"), VALIDATOR_URL: `http://localhost:${PROXY_PORT}`,
    LAYERS_APP_PORT: String(APP_PORT), LAYERS_VALIDATOR_PORT: String(PROXY_PORT), APP_URL: RB,
  });
  const logFile = path.join(WORLD_DIR, "rollback-app.log");
  let log = "";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (b) => (log += b));
  child.stderr.on("data", (b) => (log += b));
  const rb = client(RB);
  const stop = () => { try { child.kill(); } catch {} killPort(APP_PORT); proxy.server.close(); writeFileSync(logFile, log.replace(secret, "<secret>")); };
  try {
    let up = false;
    for (let i = 0; i < 90 && !up; i++) { try { up = (await fetch(RB + "/api/health")).status === 200; } catch {} if (!up) await sleep(2000); }
    if (!up) abort("the rollback app did not come up: " + log.slice(-300).replace(secret, "<secret>"));
    if (!/\[boot\] WORLD: demo/.test(log)) abort("the rollback app did not boot the demo world (no '[boot] WORLD: demo' line)");
    const login = await rb.api("POST", "/api/owner-login", { passphrase: secret });
    if (login.status !== 200 || ![...rb.jar.keys()].some((k) => k.startsWith("__Host-"))) abort("the rollback app refused the owner login (" + login.status + ")");
    const gate = await client(RB).api("GET", "/api/personas");
    if (gate.status !== 401) abort("the rollback app is not behind the owner gate (an anonymous read answered " + gate.status + ") — not the owner service's shape");

    await check("R1. ROLLED BACK ON THE OWNER SERVICE, A FAILED STATE READ REFUSES EVERY WRITE — no namespace is replaced on an unread state", async () => {
      const blocks0 = nsRows("blocks");
      const visits0 = nsRows("lastVisit");
      const viaAdapter = await rb.api("POST", "/api/block-seed", { personaId: DEMO_TARGET });
      if (viaAdapter.status < 500) throw new Error("a block on an unread state answered " + viaAdapter.status + " " + JSON.stringify(viaAdapter.json).slice(0, 140));
      const direct = await rb.api("POST", "/api/dev", { action: "setLastVisit", minutesAgo: 7 });
      if (direct.status < 500) throw new Error("a direct namespace write on an unread state answered " + direct.status);
      if (proxy.refused.state < 1) throw new Error("the app never asked for the state — the refusal was not measured");
      if (!rowsEqual(nsRows("blocks"), blocks0)) throw new Error("the blocks namespace CHANGED on an unread state (" + blocks0.length + " -> " + nsRows("blocks").length + " rows)");
      if (!rowsEqual(nsRows("lastVisit"), visits0)) throw new Error("the lastVisit namespace CHANGED on an unread state");
      // still refused after the read heals, until something READS: no write is built on a state this process never read
      proxy.broken.state = false;
      const stillUnread = await rb.api("POST", "/api/dev", { action: "setLastVisit", minutesAgo: 7 });
      if (stillUnread.status < 500) throw new Error("a direct write before any successful read answered " + stillUnread.status);
      if (!rowsEqual(nsRows("lastVisit"), visits0)) throw new Error("the lastVisit namespace CHANGED before the state was read");
      // the same write once the state HAS been read (an adapter read hydrates): it lands, and every earlier row is still
      // there — the refusal was the read, nothing else
      await retry(() => rb.api("GET", "/api/modes"), (r) => r.status === 200 && Array.isArray(r.json?.modes));
      await retry(() => rb.api("POST", "/api/dev", { action: "setLastVisit", minutesAgo: 7 }), (r) => r.status === 200);
      // (the namespaces are whole-sealed: one ciphertext row each, so "landed" is the row changing, and "kept" is R3's
      // read-back of the owner's records through the app)
      if (rowsEqual(nsRows("lastVisit"), visits0)) throw new Error("the healed write did not land (lastVisit unchanged)");
      return proxy.refused.state + " state read(s) refused; the adapter write answered " + viaAdapter.status + ", the direct write " + direct.status + " (and again after the read healed, before anything had read); blocks and lastVisit byte-identical; once read, the same write landed";
    });

    await check("R2. A FAILED ROSTER READ REFUSES THE ROSTER WRITE — the sealed roster is not re-sealed over", async () => {
      const roster0 = nsRows("rootRoster");
      if (!roster0.length) throw new Error("no rootRoster stored on this copy — the check would be vacuous");
      const before = proxy.refused.rootRoster;
      const fork = await rb.api("POST", "/api/identity/fork", { fromPersona: "persona_viewer_main", newHandle: "rbfork_" + stamp, newName: "Rollback Fork " + stamp });
      if (fork.status < 500) throw new Error("a fork whose roster record could not be read answered " + fork.status + " " + JSON.stringify(fork.json).slice(0, 140));
      if (!/root roster unavailable/.test(fork.json?.error ?? "")) throw new Error("the refusal does not name the roster: " + JSON.stringify(fork.json).slice(0, 200));
      if (proxy.refused.rootRoster <= before) throw new Error("the roster read was never attempted — the refusal was not measured");
      if (!rowsEqual(nsRows("rootRoster"), roster0)) throw new Error("the sealed rootRoster CHANGED although it could not be read");
      return (proxy.refused.rootRoster - before) + " roster read(s) refused; the fork answered " + fork.status + " (" + fork.json.error.slice(0, 60) + "…); rootRoster byte-identical";
    });

    proxy.broken.rootRoster = false;
    await check("R3. THE HIDDEN WORLD COMES BACK with the flag removed — and the owner's records are all still stored", async () => {
      const ros = await retry(() => rb.api("GET", "/api/personas"), (r) => r.status === 200 && (r.json?.personas ?? []).length > 0);
      const handles = ros.json.personas.map((p) => p.handle);
      if (!handles.includes(fixture.self.username)) throw new Error("the demo world's roster does not come back: " + JSON.stringify(handles).slice(0, 200));
      const prof = await rb.api("GET", "/" + fixture.self.username, undefined, { raw: true });
      if (prof.status !== 200) throw new Error("the seeded self's profile answered " + prof.status);
      // the stored namespaces are sealed, so the owner's records are read back THROUGH the rolled-back app: the staged
      // fork's blocks hold the demo block it made before the flag AND the block it made under the flag
      rb.jar.set("layers_seed_persona", st.stage.sf);
      const blocked = await retry(() => rb.api("GET", "/api/blocked"), (r) => r.status === 200 && Array.isArray(r.json?.personaIds));
      const ids = blocked.json.personaIds;
      if (!ids.includes(st.stage.demoBlocked) || !ids.includes(st.fresh.fork)) throw new Error("the staged fork's blocks read back as " + JSON.stringify(ids).slice(0, 200) + " — not the demo block AND the empty world's block");
      const modes = await retry(() => rb.api("GET", "/api/modes"), (r) => r.status === 200 && Array.isArray(r.json?.modes));
      const def = modes.json.modes.find((m) => m.id === "mode_default_" + st.stage.sf);
      if (def?.pinnedPersonaId !== "persona_viewer_main") throw new Error("the staged fork's customised Default did not survive the empty world: " + JSON.stringify(def).slice(0, 160));
      rb.jar.delete("layers_seed_persona");
      return "the seeded roster (" + handles.length + " personas, @" + fixture.self.username + " among them) and profile are back; the staged fork's blocks hold the demo block and the empty-world block; its customised Default (pinned to the seeded self) is the one stored";
    });

    await check("R4. A FAILED ATTESTATION-VAULT READ REFUSES THE VAULT WRITE — zkAttestations is not re-sealed over; a read answers none, then answers again once healed", async () => {
      // the write path that ends in the vault on a rig: resetZk (fixture) → forgetAllIssued → the vault's loadStrict.
      // The product path (requestIssuance → storeIssued) builds on the same read. The proxy has refused every
      // GET /state/zkAttestations since this app booted, so nothing is cached: the refusal measured here is the read's.
      const rows0 = nsRows("zkAttestations");
      const before = proxy.refused.zkAttestations;
      const r = await rb.api("POST", "/api/zk", { action: "resetZk", mode: "fixture" });
      if (r.status < 500) throw new Error("resetZk with an unreadable attestation vault answered " + r.status + " " + (r.json ? JSON.stringify(r.json).slice(0, 140) : r.text.slice(0, 140)));
      if (proxy.refused.zkAttestations <= before) throw new Error("the vault read was never attempted — the refusal was not measured (" + r.status + ")");
      if (!rowsEqual(nsRows("zkAttestations"), rows0)) throw new Error("the zkAttestations namespace CHANGED (" + rows0.length + " -> " + nsRows("zkAttestations").length + " rows) although it could not be read");
      // the read side while it cannot be read: none, as JSON, never a 500 — and never cached
      const mine = await rb.api("POST", "/api/zk", { action: "myAttestations", mode: "fixture" });
      if (mine.status !== 200 || !Array.isArray(mine.json?.attestations) || mine.json.attestations.length) throw new Error("myAttestations on an unreadable vault answered " + mine.status + " " + JSON.stringify(mine.json).slice(0, 140));
      proxy.broken.zkAttestations = false;
      const healed = await retry(() => rb.api("POST", "/api/zk", { action: "myAttestations", mode: "fixture" }), (x) => x.status === 200 && Array.isArray(x.json?.attestations));
      if (!rowsEqual(nsRows("zkAttestations"), rows0)) throw new Error("a READ re-sealed the namespace");
      return (proxy.refused.zkAttestations - before) + " vault read(s) refused; resetZk answered " + r.status + "; zkAttestations byte-identical (" + rows0.length + " stored row(s)); the read answered none while broken and " + healed.json.attestations.length + " once healed";
    });
  } finally {
    stop();
  }
}

// ------------------------------------------------------------------------------------------------ run
if (PHASE === "seed") await seedPhase();
else if (PHASE === "fresh") await freshPhase();
else if (PHASE === "stage") await stagePhase();
else if (PHASE === "owner") await ownerPhase();
else if (PHASE === "rollback") await rollbackPhase();
else abort("WORLD_PHASE must be seed, fresh, stage, owner or rollback");

const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} empty-world checks passed (phase ${PHASE})${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
