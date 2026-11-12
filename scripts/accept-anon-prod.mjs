// PERSONA LAUNCH P7 — STRANGERS POST ANONYMOUSLY FROM THE PUBLIC SITE (npm run test:anon-prod once the verify agent adds
// the script). PRODUCTION SHAPE ONLY: run it through scripts/run-prod-shape.sh after --build (the build makes
// public/device/prover.js and copies the pinned proving files when .zk-artifacts holds them). It ABORTS unless /api/dev
// answers 403. It is not in sweep-x.sh.
//
// THE THROWAWAY VALIDATOR. Strangers need a crowd to hide in, and a fresh public validator has none. So this suite spawns
// its OWN production-shaped validator on ANON_PROD_VALIDATOR_PORT (default 4063 — never a pinned port) with a temp
// database (MUST_NOT_SHIP blanked from validator/env-contract.js, NODE_ENV=production, no dev hooks, signatures
// required), and writes the FURNITURE straight into that temp database: 70 decoy registrations over the crowd floor,
// the stranger's own rep, and an epoch-offset bump standing in for the refused /zk/dev/advance-epoch. Nothing is
// written to the pair's validator. The process is killed (its whole tree) and its database removed on exit.
//
// PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE) — THE PUBLIC TREE. The public preview runs ZK_ANON_POST_TREE=valid on the app
// and the validator (scripts/run-prod-shape.sh starts the pair that way; EXPECT_ANON_TREE names it, default valid). This
// suite reads the tree the pair's app hands its tabs (the /home HTML's device env), ABORTS unless it is EXPECT_ANON_TREE,
// runs the throwaway validator on the same tree, and gives the smoke-page tabs the same value (an init script adds it to
// the page's device env — the smoke page sets the rest). The stranger now JOINS the crowd from the composer's read and
// hears when it can post (check 2), its first window opens on a crowd still under the floor (check 2b), and the 70 decoys
// lift it over (check 3): no reputation furniture is needed for "valid" (it is still written, for a tier-N run).
//
//   1  BUNDLES: device.js <= 5,242,880 B and snarkjs-free; prover.js <= 1.5 MiB, served with its GPL-3.0 banner and its
//      LICENSE file (the notice and the GPL text); PERSONA LAUNCH P7 (L1): /home loads prover.js AT BOOT, in every tab,
//      whether or not it will prove (a proof due later makes no request), and nothing from /device/zk/* in the test
//      universe
//   2  A FRESH STRANGER: before any check has run in the tab the memory-only poll says "checking" (UXH-2: unknown is not
//      yes); the composer's read runs the first check at once, JOINS this root to the crowd (PERSONA LAUNCH GO-LIVE: one
//      fixture registration in the throwaway's database, active from the NEXT epoch) and says, in plain words, from what
//      time it can post (and that the crowd is still under the floor); POST is refused 'crowd' with the same sentence;
//      nothing is minted (no wanted entry, no reveal secret, no request to the web route)
//  2b  PERSONA LAUNCH GO-LIVE — THE FIRST WINDOW: one epoch later the stranger is a leaf, in a crowd of one: the composer
//      says how many people the crowd needs and has (never the toggle: the prover's cohort stage would refuse); POST 409
//   3  A STRANGER IN THE CROWD (pair started WITHOUT ADAPTER_REP) posts: proved IN THE WORKER (the device's job log shows
//      fixture-prove answered by a DedicatedWorkerGlobalScope — a proof made on the page's own thread leaves no such
//      entry) with ZERO requests to the app while it proves and sends (L1: the prover was loaded at boot), sent as exactly
//      ONE POST /zk/anon/web carrying no cookie / authorization / x-layers-* / referer and a 4096-byte body, and it
//      appears in the throwaway's fixture /zk/anon-casts with its tree and a 512-hex note
//   4  NO SECRET LEAVES: the device's debug needles (root seed, keys, zk master, secret scalar) appear in no request URL,
//      header or body to any origin, nor in $TEMP/layers-app.log, nor in the throwaway's database or log; and the app
//      server received zero /api/anon or /api/zk requests (the device answered them in the tab)
//   5  /home (validator traffic routed to the throwaway): a FRESH visitor sees the stranger's card with cast-anon-preview
//      — the card is found first — and its composer offers no anonymous toggle, saying the crowd sentence (UXH-2: before
//      this fix it offered one on a guess); then the stranger's OWN identity (kept in this browser, restored on /home)
//      gets the toggle, and the composer's anonymous line says preview-only and DEMO
//   6  THE LIVE UNIVERSE from a browser is refused: off in plain words, POST refused, nothing sent; a live-relabelled
//      envelope sent from the page to /zk/anon/web is refused while the same envelope in the test universe is accepted
//   7  THE DOORS: the web routes refuse cookie / x-layers-device / referer; the strict /zk/anon/submit still refuses a
//      user-agent (both with a control that is accepted)
//   8  PHONE PROVING TIME: real Groth16 proofs from the worker — desktop, then a Playwright Pixel 5 with CDP CPU
//      throttling at 4x and 6x — each verified in node by the validator's OWN verifyLiveProof; a tampered served zkey is
//      refused by the worker; the worker fetches only same-origin /device/zk/*. CDP cannot throttle a dedicated worker
//      ("Operation is only supported for pages, not workers" — measured here with a fixed bench in both threads), so the
//      throttled rows ALSO prove the same prover code on the throttled PAGE thread: that is the phone stand-in, and the
//      JSON says so. Numbers → shots/p7-browser-prover.json (prove / verify / artifact-fetch ms, bytes, commit, date).
//      L1: these devices run the LIVE universe, so each tab loads the proving files AT BOOT (the fetch time recorded is
//      that boot load); a live proof and its verify make ZERO requests to the app; the tampered zkey is served from the
//      first request (the route is installed before the page loads), and the worker refuses it by its pin.
//   9  PUBLIC GO-LIVE (the relay track) — ARMED: a SECOND throwaway validator (ANON_PROD_ARMED_PORT, default 4067) armed on
//      the AGENT path against scripts/lib/neynar-anon-stub.mjs on loopback (FC_ANON_* + ZK_ANON_RELAY_LIVE=on + a lifetime
//      cap; FC_ANON_NEYNAR_BASE_URL / ANON_FID_RPC_URL point at the stub — accepted off a hosting platform only), its fid gate
//      on (a public deployment) for this app's domain. 9a: the validator answers liveRelay true on the agent path; a moderator
//      tab's key is read from Settings > Moderation's route and the validator is restarted with it in ANON_MODERATORS; the
//      stranger's commitment joins the live crowd through POST /zk/anon/fid-join with a SIWF-shaped message signed by a test
//      custody key the stub's IdRegistry resolves (the browser's sign-in relay cannot run offline: this is exactly what
//      lib/zk/anon/fcJoin.ts sends after it), 60 fid-gated decoys and one epoch later the live tab with the app's hint is ON,
//      NOT preview-only, and says the post goes to Farcaster. 9b: the post is proved in the tab, accepted, held PENDING with
//      zero publishes, then leaves EXACTLY ONCE at a relay slot under the agent's signer and key (a second slot sends
//      nothing); the tab asked the app for nothing while it proved and sent, the app's log never names the stub, and every
//      stub call came after the post. 9c: Report from the stranger's tab -> the moderator's signed REMOVE -> hidden at once
//      (gone from /zk/anon-casts, /zk/anon-cast 404, gone from the live tab's home feed, the row KEPT with hidden_at) and ONE
//      DELETE through the agent key by the validator's own delete loop, recorded 'deleted' in the moderator's list.
//      It needs validator/anon.js to let a live envelope through the web door while the public relay is ready (the gpl
//      track's webEnvelopeUniverseOk diff): without it 9b fails naming that door.
import { chromium, devices } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { MUST_NOT_SHIP, VALIDATOR_REFUSES } = require(path.join(ROOT, "validator", "env-contract.js"));
const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const TPORT = Number(process.env.ANON_PROD_VALIDATOR_PORT || 4063);
const T = `http://127.0.0.1:${TPORT}`;
const EPOCH_MS = 6 * 3600 * 1000;
// PERSONA LAUNCH P7 (UXH-11 / UXH-2): lib/zk/anon/availability.ts ANON_NOT_IN_CROWD and ANON_CHECKING, word for word
// (scripts/unit-prover.mjs S5 pins these two literals to the module's own)
// PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): ANON_NOT_IN_CROWD is no longer the dead end a stranger hears; JOIN_RE and
// FLOOR_RE are what it hears instead (anonJoinSentence / anonFloorSentence — S5 runs the module's own output through both)
const NOT_IN_CROWD = "This browser isn't in the anonymous crowd on this preview right now, so it can't post anonymously.";
const CHECKING = "Checking whether you can post anonymously from here…";
const JOIN_RE = /^You've joined the anonymous crowd on this preview, and you can post anonymously from (.+), when new members are let in \(every 6 hours\)\.( Posting here also needs at least (\d+) people in the crowd, and there (?:was 1|were \d+) at the last check\.)?$/;
const JOIN_PREFIX = "You've joined the anonymous crowd on this preview, and you can post anonymously from ";
const FLOOR_RE = /^Anonymous posting on this preview opens once at least (\d+) people are in the anonymous crowd, and there (?:is 1|are \d+) now\.$/;
const LIVE_OFF = "Anonymous posting to Farcaster isn't on this preview yet.";
const PREVIEW_SENTENCE = "Preview only: your anonymous post stays inside this test preview. Nothing is posted to Farcaster.";
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
const infra = (n, d) => { results.push(["INFRA", n, d]); console.log("  INFRA " + n + (d ? " — " + d : "")); };
async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, typeof extra === "string" ? extra : undefined);
  } catch (e) {
    if (e && e.infra) infra(name, e.message);
    else fail(name, e && e.message ? e.message : String(e));
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const infraErr = (m) => Object.assign(new Error(m), { infra: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, init) => { const r = await fetch(url, { cache: "no-store", ...init }); const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString("utf8")); } catch { /* not json */ } return { status: r.status, buf, text: buf.toString("utf8"), json }; };

console.log("\nPersona launch P7 — strangers post anonymously from the public site (app " + BASE + ", throwaway validator " + T + ")");
const devProbe = await get(BASE + "/api/dev").catch(() => ({ status: 0 }));
if (devProbe.status !== 403) {
  console.log("  ABORT: /api/dev answered " + devProbe.status + " — this suite runs against the PRODUCTION shape (scripts/run-prod-shape.sh), never the rig");
  process.exit(2);
}
// PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the tree the pair's app hands its tabs, read from the /home HTML's device
// env (curl-style: no device runs, no root is minted); absent = the tab's default, tier-<ZK_GATE_TIER> = tier-2 here
const EXPECT_TREE = (process.env.EXPECT_ANON_TREE || "valid").trim();
const homeHtml = await get(BASE + "/home").catch(() => ({ status: 0, text: "" }));
const treeMatch = /ZK_ANON_POST_TREE\\*"\s*:\s*\\*"([A-Za-z0-9:./_-]+)/.exec(homeHtml.text || "");
const TREE = treeMatch ? treeMatch[1] : "tier-2";
if (homeHtml.status !== 200) {
  console.log("  ABORT (INFRA): /home answered " + homeHtml.status + " — the pair's device env (the tree it forwards) cannot be read");
  process.exit(2);
}
if (TREE !== EXPECT_TREE) {
  console.log("  ABORT: the pair's app forwards ZK_ANON_POST_TREE=" + TREE + ", but this run expects " + EXPECT_TREE + " — start the pair with scripts/run-prod-shape.sh (the public default, valid) or set EXPECT_ANON_TREE to the pair's tree");
  process.exit(2);
}
console.log("  (the pair's tabs prove the tree " + TREE + "; the throwaway validator runs the same)");
if ((await get(T + "/health").catch(() => ({ status: 0 }))).status !== 0) {
  console.log("  ABORT (INFRA): something already answers on " + T + " — this suite starts its own throwaway validator there and never kills a process it did not start");
  process.exit(2);
}

// ---------------------------------------------------------------- the throwaway validator
const TMP = mkdtempSync(path.join(os.tmpdir(), "layers-anon-prod-"));
const TDB = path.join(TMP, "throwaway.db");
const TLOG = path.join(os.tmpdir(), "layers-anon-prod-validator.log");
const blank = Object.fromEntries([...MUST_NOT_SHIP, ...(VALIDATOR_REFUSES || [])].map((n) => [n, ""]));
const tEnv = {
  ...process.env,
  ...blank,
  NODE_ENV: "production",
  ZK_DEV_HOOKS: "",
  LAYERS_REQUIRE_SIG: "true",
  CUSTODY_FIXTURE_PROVIDER: "",
  LAYERS_MAINTENANCE: "",
  TRUST_PROXY: "",
  DATA_SOURCE: "",
  LAYERS_VALIDATOR_PORT: String(TPORT),
  VALIDATOR_DB: TDB,
  // the local test-pair overrides (IGNORED on a hosting platform — validator/server.js): every browser context here
  // reaches the throwaway from one loopback address
  VALIDATOR_RL_CAPACITY: "3000",
  VALIDATOR_RL_REFILL_PER_SECOND: "50",
  VALIDATOR_NEW_ROOTS_PER_ADDRESS_PER_DAY: "1000",
};
for (const k of ["ZK_ANON_POST_TREE", "ZK_GATE_TIER", "ZK_ANON_FLOOR", "ZK_EPOCH_MS", "ADAPTER_REP"]) delete tEnv[k];
// PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the pair's tree, exactly (a "tier-2" pair leaves it at the default)
if (treeMatch) tEnv.ZK_ANON_POST_TREE = TREE;
let tChild = null;
let tOut = "";
function killThrowaway() {
  if (!tChild || tChild.exitCode !== null) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(tChild.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* fall through to kill() */
  }
  try {
    tChild.kill("SIGKILL");
  } catch {
    /* gone */
  }
}
process.on("exit", () => {
  killThrowaway();
  try {
    writeFileSync(TLOG, tOut);
  } catch {
    /* best effort */
  }
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* the database may still be held for a moment on Windows */
  }
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
tChild = spawn(process.execPath, [path.join(ROOT, "validator", "server.js")], { env: tEnv, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
tChild.stdout.on("data", (b) => (tOut += b));
tChild.stderr.on("data", (b) => (tOut += b));
let tUp = false;
for (let i = 0; i < 80 && !tUp; i++) {
  if (tChild.exitCode !== null) break;
  tUp = (await get(T + "/health").catch(() => ({ status: 0 }))).status === 200;
  if (!tUp) await sleep(500);
}
if (!tUp) {
  console.log("  ABORT (INFRA): the throwaway validator did not come up on " + T + ":\n" + tOut.split("\n").slice(-12).join("\n"));
  process.exit(2);
}
const ep0 = await get(T + "/zk/epoch?mode=fixture");
if (ep0.json && Number.isFinite(ep0.json.msRemaining) && ep0.json.msRemaining < 10 * 60_000) {
  console.log("  ABORT (INFRA): " + Math.round(ep0.json.msRemaining / 60_000) + " min left in the 6-hour epoch — an anonymous post gets no epoch grace; re-run after the boundary");
  process.exit(2);
}
console.log("  (throwaway validator up on " + T + ", temp database " + path.basename(TDB) + ")");

// ---------------------------------------------------------------- helpers
const { DatabaseSync } = await import("node:sqlite");
const { Identity } = require("@semaphore-protocol/identity");
const { Group } = require("@semaphore-protocol/group");
const BD = await import(pathToFileURL(path.join(ROOT, "scripts", "build-device.mjs")).href);
const browser = await chromium.launch();
const allContexts = [];
/** a browser device on the loopback smoke page, pointed at the throwaway (1 s prefetch cadence, 1–3 s send jitter) */
// PUBLIC GO-LIVE (the relay track): `validator` points a tab at another throwaway (check 9's ARMED one) and `env` adds checked
// names to the page's device env the way the app's server would (check 9: ZK_ANON_UNIVERSE=live, the app's live hint)
async function device(label, { query = "", contextOptions = {}, beforeGoto = null, validator = T, env = {} } = {}) {
  const ctx = await browser.newContext(contextOptions);
  allContexts.push(ctx);
  // L1: a route that must shape what the tab loads at BOOT (check 8's tampered zkey) is installed before the page exists
  if (beforeGoto) await beforeGoto(ctx);
  // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the smoke page declares its own device env (no server renders it), so the
  // pair's tree is added to it as the page assigns it — before device.js reads it at import (the /home pages of checks 1
  // and 5 get it from the server: lib/device/deviceEnv.server.ts, the real path)
  await ctx.addInitScript(({ tree, extra }) => {
    let held;
    Object.defineProperty(window, "__LAYERS_DEVICE_ENV", {
      configurable: true,
      get() {
        return held;
      },
      set(v) {
        held = v && typeof v === "object" ? Object.assign(v, { ZK_ANON_POST_TREE: tree }, extra) : v;
      },
    });
  }, { tree: TREE, extra: env });
  const page = await ctx.newPage();
  const requests = [];
  ctx.on("request", (r) => requests.push({ at: Date.now(), method: r.method(), url: r.url(), r }));
  const q = "?validator=" + encodeURIComponent(validator) + "&jmin=1000&jmax=3000" + query;
  await page.goto(BASE + "/device/smoke.html" + q, { waitUntil: "load" });
  const info = await page.evaluate(() => window.__layersDevice.ready);
  const d = { label, ctx, page, requests, info };
  d.api = (method, p, body) =>
    page.evaluate(
      async ({ method, p, body }) => {
        const r = await fetch(p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
        let json = null;
        try {
          json = await r.json();
        } catch {
          /* not json */
        }
        return { status: r.status, json };
      },
      { method, p, body }
    );
  d.waitTick = async (after, ms = 30_000, mode = "fixture") => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const s = await d.api("POST", "/api/zk", { action: "prefetchStatus", mode });
      const ticks = s.json?.ticks ?? [];
      const last = ticks[ticks.length - 1];
      if (last && last.at > after && s.json.snapshot) return s.json;
      await sleep(400);
    }
    throw new Error(label + ": no prefetch tick within " + ms + " ms");
  };
  d.needles = async () => {
    const a = await page.evaluate(() => window.__layersDevice.needles());
    const b = await page.evaluate(() => window.__layersDevice.prover.needles());
    const c = await page.evaluate(() => window.__layersDevice.rootOnly());
    return { all: [...new Set([...a, ...b, ...c])].filter((x) => typeof x === "string" && x.length >= 16), zk: b, root: c };
  };
  return d;
}
/** a tier-membership fixture envelope on the throwaway's "valid" tree (public material only), and its PoW */
let nulSeq = 7_000_001;
const fieldOf = (domain, canonical) => (BigInt("0x" + createHash("sha256").update(`layers-zk-field/1|${domain}|${canonical}`).digest("hex")) >> 8n).toString(10);
const fixtureTag = (canonical, nullifier) => createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
const canonical = (p) => ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge].join("|");
async function validEnvelope(mode = "fixture") {
  const ep = (await get(T + "/zk/epoch?mode=fixture")).json.epoch;
  const members = (await get(T + "/zk/members?mode=fixture&tree=valid")).json;
  const personaId = "p_anonprod";
  const challenge = "epoch-" + ep;
  const scope = fieldOf("scope", `layers/zk-scope/v1|discovery-tier|${ep}|${personaId}`);
  const message = fieldOf("message", [personaId, "foryou", challenge, members.root].join("|"));
  const nullifier = String(nulSeq++);
  const pubF = { mode: "fixture", claimKind: "tier-membership", tree: "valid", epoch: ep, merkleTreeRoot: members.root, scope, message, personaId, gateId: "foryou", challenge };
  const pub = { ...pubF, mode };
  return { v: 1, mode, claimKind: "tier-membership", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonical(pubF), nullifier) } };
}
function padded(envelope) {
  const bare = Buffer.byteLength(JSON.stringify({ envelope, p: "" }));
  return Buffer.from(JSON.stringify({ envelope, p: "x".repeat(Math.max(0, 4096 - bare)) }));
}
const lzb = (buf) => { let n = 0; for (const b of buf) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; } return n; };
function solvePow(body, bits = 16) {
  const bh = createHash("sha256").update(body).digest("hex");
  for (let i = 0; ; i++) if (lzb(createHash("sha256").update(bh + "|" + i.toString(36)).digest()) >= bits) return i.toString(36);
}
const { request: httpRequest } = await import("node:http");
function rawPost(p, body, headers) {
  const u = new URL(T + p);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", agent: false, headers: { ...headers, "content-length": String(body.length) } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")).outcome);
        } catch {
          resolve("unreadable");
        }
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

let S = null; // the stranger
let postText = null;
let castHash = null;
let proverRequestSeen = false;
try {
  // ================================================================ 1. the bundles
  await check("1. BUNDLES: device.js <= 5,242,880 B with no snarkjs marker; prover.js <= 1.5 MiB with its GPL-3.0 banner and LICENSE file served; /home loads prover.js AT BOOT (every tab, proving or not: L1) and no /device/zk/* file in the test universe", async () => {
    const d = await get(BASE + "/device/device.js");
    const p = await get(BASE + "/device/prover.js");
    const l = await get(BASE + "/device/prover.js.LICENSE.txt");
    assert(d.status === 200 && p.status === 200 && l.status === 200, `served: device.js ${d.status}, prover.js ${p.status}, LICENSE ${l.status} (built with --build?)`);
    const v = BD.budgetViolations({ deviceBytes: d.buf.length, deviceText: d.text, proverBytes: p.buf.length });
    assert(v.length === 0, v.join(" | "));
    const head = p.text.slice(0, 1200);
    assert(/snarkjs/.test(head) && /GPL-3\.0/.test(head) && /prover\.js\.LICENSE\.txt/.test(head) && /github\.com\/iden3\/snarkjs/.test(head), "the prover's banner does not name snarkjs, GPL-3.0, its source and its LICENSE file");
    assert(/GNU GENERAL PUBLIC LICENSE/.test(l.text) && /Version 3/.test(l.text) && /snarkjs/.test(l.text), "the LICENSE file does not carry the GPL-3.0 text and the notice");
    const ctx = await browser.newContext();
    allContexts.push(ctx);
    const urls = [];
    ctx.on("request", (r) => urls.push(r.url()));
    const page = await ctx.newPage();
    await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
    await page.evaluate(() => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("no device")), 90_000); const w = () => (window.__layersDevice ? window.__layersDevice.ready.then(() => { clearTimeout(t); res(); }, rej) : setTimeout(w, 100)); w(); }));
    // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): a real /home page's device carries the pair's tree (the server forwards
    // it: lib/device/deviceEnv.server.ts) — the forwarding path itself, not the HTML scrape the suite started from
    const pageTree = await page.evaluate(() => (window.__LAYERS_DEVICE_ENV ? window.__LAYERS_DEVICE_ENV.ZK_ANON_POST_TREE ?? null : undefined));
    assert(pageTree === (treeMatch ? TREE : null), "the /home device env carries ZK_ANON_POST_TREE=" + JSON.stringify(pageTree) + ", expected " + TREE);
    await sleep(6000);
    // PERSONA LAUNCH P7 (L1): the prover is loaded at boot in EVERY tab, so the request that once marked "this tab is
    // about to prove" is now the same for every visitor; the test universe needs no proving files at all
    const proverLoads = urls.filter((u) => new URL(u).pathname === "/device/prover.js");
    const zkFiles = urls.filter((u) => u.includes("/device/zk/"));
    assert(urls.some((u) => u.includes("/device/device.js")), "the /home load was not observed (no device.js request) — the checks below would be vacuous");
    assert(proverLoads.length >= 1, "/home did not load the prover at boot — a proof would then load it at the moment it is due (the timing link L1 closed)");
    assert(zkFiles.length === 0, "/home in the test universe loaded proving files: " + zkFiles.join(", "));
    await ctx.close();
    return `device.js ${d.buf.length} B, prover.js ${p.buf.length} B, loaded at boot ${proverLoads.length}x`;
  });

  // ================================================================ 2. a fresh stranger
  /** PERSONA LAUNCH GO-LIVE: the stranger's fixture registrations in the throwaway's database (read-only, waits on the lock) */
  const registrationsOf = (rootId) => {
    const db = new DatabaseSync(TDB, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 8000");
      return db.prepare("SELECT epoch_registered AS reg, active_from_epoch AS active, revoked_from_epoch AS revoked FROM zk_registrations WHERE mode = 'fixture' AND root_id = ?").all(rootId);
    } finally {
      db.close();
    }
  };
  /** PERSONA LAUNCH GO-LIVE: move the throwaway's fixture clock one epoch on (the refused /zk/dev/advance-epoch's stand-in) */
  const bumpEpoch = () => {
    const db = new DatabaseSync(TDB);
    try {
      db.exec("PRAGMA busy_timeout = 8000");
      const off = db.prepare("SELECT offset_ms FROM zk_epoch_offset WHERE mode = 'fixture'").get();
      db.prepare("INSERT INTO zk_epoch_offset (mode, offset_ms) VALUES ('fixture', ?) ON CONFLICT(mode) DO UPDATE SET offset_ms = excluded.offset_ms").run((off ? off.offset_ms : 0) + EPOCH_MS);
    } finally {
      db.close();
    }
  };

  await check("2. A FRESH STRANGER: before any check the memory-only poll says 'checking' (never yes: UXH-2); the composer's read runs the first check at once, JOINS the crowd (one fixture registration, active from the next epoch) and says from what time it can post, and that the crowd is under the floor; POST refused 'crowd' with the same sentence; nothing minted (no wanted entry, no reveal secret, no request to the web route)", async () => {
    S = await device("stranger");
    // UXH-2: nothing has checked this tab yet — unknown is "checking", off, never yes (memory only: no tick, no request)
    const pre = await S.api("GET", "/api/anon?availability=1");
    assert(pre.status === 200 && pre.json?.on === false && pre.json?.unavailableCode === "checking" && pre.json?.unavailableReason === CHECKING, "before any check: " + JSON.stringify(pre.json));
    // precondition for the join below: the throwaway holds no registration for this root yet
    assert(registrationsOf(S.info.rootId).length === 0, "the stranger was registered before the composer's read (the join below would be vacuous)");
    // the composer's full read runs the first check itself (no waiting for the loop's cadence), judges — "crowd" can only
    // come from a check that read the plain tree — and JOINS (PERSONA LAUNCH GO-LIVE, D-PUBLIC-ANON-TREE)
    const ep = (await get(T + "/zk/epoch?mode=fixture")).json;
    const g = await S.api("GET", "/api/anon");
    assert(g.status === 200, "GET /api/anon " + g.status + " " + JSON.stringify(g.json).slice(0, 200));
    const m = JOIN_RE.exec(g.json.unavailableReason || "");
    assert(g.json.available === false && m && g.json.unavailableCode === "crowd" && g.json.host === "tab", "the line: " + JSON.stringify({ available: g.json.available, reason: g.json.unavailableReason, code: g.json.unavailableCode }));
    assert(m[3] === "50", "the join sentence does not say the crowd is under the floor of 50: " + g.json.unavailableReason);
    assert(g.json.anonDeploymentOff === false, "said as deployment-wide");
    // WHEN: the start of the next epoch, within this epoch's remaining time (the sentence names it as a clock time)
    const expectFrom = Date.now() + ep.msRemaining;
    assert(typeof g.json.availableFrom === "number" && Math.abs(g.json.availableFrom - expectFrom) < 120_000, "availableFrom " + g.json.availableFrom + " is not the next epoch's start (about " + expectFrom + ")");
    const regs = registrationsOf(S.info.rootId);
    assert(regs.length === 1 && regs[0].active === ep.epoch + 1 && regs[0].revoked === null, "the join: " + JSON.stringify(regs) + " (epoch " + ep.epoch + ")");
    const ticks = (await S.api("POST", "/api/zk", { action: "prefetchStatus", mode: "fixture" })).json?.ticks ?? [];
    assert(ticks.length >= 1 && ticks.some((t) => t.ok === true), "the composer's read judged the crowd with no check in the tick log: " + JSON.stringify(ticks).slice(0, 200));
    const p = await S.api("POST", "/api/anon", { text: "a stranger who is not in the crowd" });
    // the same moment (the tab re-reads its snapshot every second here: the start is the same within a few seconds and the
    // sentence names the same minute)
    const pm = JOIN_RE.exec(p.json?.error || "");
    assert(p.status === 409 && p.json?.code === "crowd" && pm && pm[1] === m[1] && Math.abs((p.json?.availableFrom ?? 0) - g.json.availableFrom) < 5000, "POST: " + p.status + " " + JSON.stringify(p.json));
    // the poll says the same, from memory (the join state the tab already holds)
    const poll = await S.api("GET", "/api/anon?availability=1");
    const qm = JOIN_RE.exec(poll.json?.unavailableReason || "");
    assert(qm && qm[1] === m[1] && poll.json?.unavailableCode === "crowd", "the memory-only poll says something else: " + JSON.stringify(poll.json));
    const after = await S.api("GET", "/api/anon");
    assert(Array.isArray(after.json.wanted) && after.json.wanted.length === 0 && Array.isArray(after.json.revealable) && after.json.revealable.length === 0 && after.json.items.length === 0, "something was minted: " + JSON.stringify({ wanted: after.json.wanted, revealable: after.json.revealable, items: after.json.items }));
    assert(registrationsOf(S.info.rootId).length === 1, "reads and the post registered the root more than once");
    assert(!S.requests.some((r) => r.url.startsWith(T + "/zk/anon/web") && r.method === "POST"), "a request reached the web route");
    return "joined from epoch " + regs[0].active + "; the line: " + g.json.unavailableReason.slice(0, 120);
  });

  // ================================================================ 2b. the first window, a crowd of one
  await check("2b. THE FIRST WINDOW: one epoch on, the stranger is a leaf of a crowd of one — the composer says how many people the crowd needs and has (no toggle: the prover would refuse a crowd under the floor); POST refused 'crowd'; nothing sent", async () => {
    assert(S, "no stranger device (check 2 did not run)");
    bumpEpoch();
    const st = await S.waitTick(Date.now());
    assert(st.snapshot.tree === TREE && st.snapshot.members >= 1 && st.snapshot.members < 50, "the snapshot after one epoch: " + JSON.stringify({ tree: st.snapshot.tree, members: st.snapshot.members }));
    const g = await S.api("GET", "/api/anon");
    assert(g.json.available === false && g.json.unavailableCode === "crowd" && FLOOR_RE.test(g.json.unavailableReason || "") && FLOOR_RE.exec(g.json.unavailableReason)[1] === "50", "the line in a crowd of " + st.snapshot.members + ": " + JSON.stringify({ available: g.json.available, reason: g.json.unavailableReason, code: g.json.unavailableCode }));
    const p = await S.api("POST", "/api/anon", { text: "a stranger in a crowd too small" });
    assert(p.status === 409 && p.json?.code === "crowd" && FLOOR_RE.test(p.json?.error || ""), "POST: " + p.status + " " + JSON.stringify(p.json));
    assert(!S.requests.some((r) => r.url.startsWith(T + "/zk/anon/web") && r.method === "POST"), "a request reached the web route");
    return g.json.unavailableReason;
  });

  // ================================================================ 3. a stranger in the crowd posts
  await check("3. A STRANGER IN THE CROWD posts: proved in the WORKER, sent as exactly one POST /zk/anon/web (no cookie / authorization / x-layers-* / referer, 4096 B), relayed in the throwaway's fixture list with its tree and a 512-hex note", async () => {
    assert(S, "no stranger device (check 2 did not run)");
    // PERSONA LAUNCH GO-LIVE: the composer's read already joined this root (check 2) — an explicit registration now finds it
    const reg = await S.api("POST", "/api/zk", { action: "register", mode: "fixture" });
    assert(reg.status === 200 && reg.json?.ok === true && reg.json?.existing === true, "register (expected the join of check 2 to have registered it already): " + reg.status + " " + JSON.stringify(reg.json).slice(0, 200));
    // FURNITURE — the temp database only.
    // PERSONA LAUNCH P7 (verify, harness fix): the throwaway validator is LIVE on this file (the stranger's 1 s prefetch
    // ticks and its own background work), and node:sqlite's default busy timeout is 0, so the first write here that met
    // the validator's write lock died "database is locked" (verify run 2026-10-12 22:01). Same rule as every rig suite
    // that writes a running validator's DB (accept-reach / accept-launch / accept-anon-reveal): wait on the lock, never
    // fail on it. The decoy commitments (Poseidon) are computed BEFORE the write transaction, and the furniture lands in
    // ONE short BEGIN IMMEDIATE transaction, so the validator never sees half of it and is blocked for milliseconds only.
    const decoys = Array.from({ length: 70 }, (_, i) => new Identity("layers-p7-decoy/" + i).commitment.toString(10));
    const db = new DatabaseSync(TDB);
    try {
      db.exec("PRAGMA busy_timeout = 8000");
      db.exec("BEGIN IMMEDIATE");
      try {
        const off = db.prepare("SELECT offset_ms FROM zk_epoch_offset WHERE mode = 'fixture'").get();
        const offset = off ? off.offset_ms : 0;
        const cur = Math.floor((Date.now() + offset) / EPOCH_MS);
        const now = Date.now();
        const insRoot = db.prepare("INSERT OR IGNORE INTO roots (id, fid, signer_uuid, created_at) VALUES (?, ?, ?, ?)");
        const insEvent = db.prepare("INSERT OR IGNORE INTO rep_events (root_id, type, count, source_id, created_at) VALUES (?, ?, ?, ?, ?)");
        const insReg = db.prepare("INSERT OR IGNORE INTO zk_registrations (mode, commitment, root_id, registered_at, epoch_registered, active_from_epoch) VALUES (?, ?, ?, ?, ?, ?)");
        for (let i = 0; i < 70; i++) {
          insRoot.run("root_p7decoy_" + i, 910000000 + i, "p7-decoy-" + i, now);
          insEvent.run("root_p7decoy_" + i, "follow_gained", 1 + i, "p7-decoy:" + i, now);
          insReg.run("fixture", decoys[i], "root_p7decoy_" + i, now, cur, cur + 1);
        }
        insEvent.run(S.info.rootId, "follow_gained", 1000, "p7-stranger-rep", now);
        db.prepare("INSERT INTO zk_epoch_offset (mode, offset_ms) VALUES ('fixture', ?) ON CONFLICT(mode) DO UPDATE SET offset_ms = excluded.offset_ms").run(offset + EPOCH_MS);
        db.exec("COMMIT");
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch { /* the failed statement may have ended it */ }
        throw e;
      }
    } finally {
      db.close();
    }
    const st = await S.waitTick(Date.now());
    assert(st.snapshot.members >= 50, "the crowd after the furniture: " + st.snapshot.members + " members");
    const g = await S.api("GET", "/api/anon");
    assert(g.json.available === true && g.json.previewOnly === true && g.json.previewSentence === PREVIEW_SENTENCE, "the stranger in the crowd: " + JSON.stringify({ available: g.json.available, reason: g.json.unavailableReason, previewOnly: g.json.previewOnly }));
    postText = "a stranger's anonymous preview post " + Date.now().toString(36);
    const from = Date.now();
    const p = await S.api("POST", "/api/anon", { text: postText });
    assert(p.status === 202 && p.json?.previewOnly === true && /^[0-9a-f]{64}$/.test(p.json?.castHash ?? ""), "POST: " + p.status + " " + JSON.stringify(p.json).slice(0, 300));
    castHash = p.json.castHash;
    let s = null;
    for (let i = 0; i < 120; i++) {
      s = await S.api("GET", "/api/anon?castHash=" + castHash);
      if (s.json?.item?.status === "sent" || s.json?.status === "dropped") break;
      await sleep(1000);
    }
    assert(s.json?.item?.status === "sent" && s.json.item.outcome === "accepted", "the post's status: " + JSON.stringify({ status: s.json?.status, item: s.json?.item, outcome: s.json?.outcome }));
    assert(s.json.previewOnly === true && s.json.host === "tab", "the status line's preview facts: " + JSON.stringify({ previewOnly: s.json.previewOnly, host: s.json.host }));
    // proved IN THE WORKER
    const log = await S.page.evaluate(() => window.__layersDevice.prover.log());
    const job = log.find((e) => e.op === "fixture-prove" && e.ok === true && e.at >= from - 1000);
    assert(job && job.where === "DedicatedWorkerGlobalScope", "no fixture-prove answered by a dedicated worker: " + JSON.stringify(log));
    // PERSONA LAUNCH P7 (L1): the prover came from the BOOT-time load (before the post), and from the post until it was
    // accepted the tab asked the app for nothing — the proof's worker started from the boot-loaded blob: URL
    proverRequestSeen = S.requests.some((r) => new URL(r.url).pathname === "/device/prover.js" && r.url.startsWith(BASE) && r.at < from);
    assert(proverRequestSeen, "the stranger's tab did not load /device/prover.js at boot (the zero below would be vacuous)");
    const appDuring = S.requests.filter((r) => r.at >= from && r.url.startsWith(new URL(BASE).origin + "/") && new URL(r.url).pathname !== "/favicon.ico");
    assert(appDuring.length === 0, "the tab asked the app for something while it proved and sent: " + appDuring.map((r) => r.method + " " + r.url).join(", "));
    // exactly one anonymous POST, its shape
    const posts = S.requests.filter((r) => r.at >= from && r.method === "POST" && r.url.startsWith(T + "/zk/anon/web"));
    const anonPosts = [];
    for (const r of posts) {
      const body = r.r.postDataBuffer();
      let kind = null;
      try {
        kind = JSON.parse(body.toString("utf8")).envelope.claimKind;
      } catch {
        kind = null;
      }
      if (kind === "anon-post") anonPosts.push({ r, body });
    }
    assert(anonPosts.length === 1, "anonymous POSTs: " + anonPosts.length + " (of " + posts.length + " web POSTs)");
    const { r, body } = anonPosts[0];
    assert(/\/zk\/anon\/web\?pow=[A-Za-z0-9_-]{1,64}$/.test(r.url), "the URL: " + r.url);
    assert(body.length === 4096, "the body: " + body.length + " bytes");
    const h = await r.r.allHeaders();
    const bad = Object.keys(h).filter((k) => k === "cookie" || k === "authorization" || k === "proxy-authorization" || k === "referer" || k.startsWith("x-layers-"));
    assert(bad.length === 0, "identifying headers: " + bad.join(", "));
    // relayed in the throwaway's fixture list, with its tree and a 512-hex note
    const list = await get(T + "/zk/anon-casts?mode=fixture");
    const row = (list.json?.casts ?? []).find((c) => c.castHash === castHash);
    assert(row && row.text === postText && row.tree === TREE && /^[0-9a-f]{512}$/.test(row.note ?? ""), "the relayed row (tree " + TREE + "): " + JSON.stringify(row).slice(0, 200));
    return `worker job ${job.ms} ms; headers ${Object.keys(h).sort().join(",")}`;
  });

  // ================================================================ 4. no secret leaves
  await check("4. NO SECRET LEAVES: the needles (root seed, keys, zk master, secret scalar) in no request URL / header / body to any origin, nor $TEMP/layers-app.log, nor the throwaway's database or log; the app server got zero /api/anon or /api/zk requests", async () => {
    assert(S && castHash, "the flow of check 3 did not complete");
    const n = await S.needles();
    assert(n.zk.length >= 2 && n.root.length >= 1 && n.all.length >= 5, "the needles are too few to mean anything: " + JSON.stringify({ zk: n.zk.length, root: n.root.length, all: n.all.length }));
    let scanned = 0;
    for (const q of S.requests) {
      const h = JSON.stringify(await q.r.allHeaders().catch(() => ({})));
      const b = (q.r.postDataBuffer() ?? Buffer.alloc(0)).toString("latin1");
      scanned++;
      for (const needle of n.all) if (q.url.includes(needle) || h.includes(needle) || b.includes(needle)) throw new Error("a needle left in a request to " + q.url.split("?")[0]);
    }
    const appApi = S.requests.filter((q) => q.url.startsWith(BASE + "/api/anon") || q.url.startsWith(BASE + "/api/zk"));
    assert(appApi.length === 0, "the app server received " + appApi.length + " /api/anon or /api/zk request(s)");
    const appLog = path.join(process.env.TEMP || os.tmpdir(), "layers-app.log");
    if (!existsSync(appLog)) throw infraErr("no " + appLog + " (start the pair with scripts/run-prod-shape.sh)");
    const logText = readFileSync(appLog, "latin1");
    for (const needle of n.all) assert(!logText.includes(needle), "a needle is in layers-app.log");
    const dbBytes = ["", "-wal", "-shm"].map((x) => (existsSync(TDB + x) ? readFileSync(TDB + x).toString("latin1") : "")).join("");
    assert(dbBytes.length > 0, "the throwaway's database was not readable");
    for (const needle of n.all) assert(!dbBytes.includes(needle) && !tOut.includes(needle), "a needle is in the throwaway's database or log");
    return `${n.all.length} needles over ${scanned} requests, the app log, the throwaway's database (${dbBytes.length} bytes) and log`;
  });

  // ================================================================ 5. /home shows the card
  await check("5. /home (validator traffic routed to the throwaway): a FRESH visitor sees the stranger's anon card WITH cast-anon-preview (the card is found first) and a composer that offers NO anonymous toggle but the crowd sentence (UXH-2/11); the stranger's OWN identity, kept in this browser and restored on /home, gets the toggle, the preview-only line and DEMO", async () => {
    assert(postText && S, "no post from check 3");
    const origins = new Set([VBASE.replace(/\/$/, ""), VBASE.replace(/\/$/, "").replace("localhost", "127.0.0.1"), VBASE.replace(/\/$/, "").replace("127.0.0.1", "localhost")]);
    let routed = 0;
    const routeToThrowaway = async (ctx) => {
      for (const origin of origins) {
        await ctx.route(origin + "/**", (route) => {
          routed++;
          return route.continue({ url: T + route.request().url().slice(origin.length) });
        });
      }
    };
    const deviceReady = (page) =>
      page.evaluate(() => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("no device")), 90_000); const w = () => (window.__layersDevice ? window.__layersDevice.ready.then((info) => { clearTimeout(t); res(info); }, rej) : setTimeout(w, 100)); w(); }));
    // (a) A FRESH VISITOR: the card, and a composer that does not offer what this visitor cannot do
    const ctx = await browser.newContext();
    allContexts.push(ctx);
    await routeToThrowaway(ctx);
    const page = await ctx.newPage();
    await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
    await deviceReady(page);
    const card = page.locator('article[data-testid="cast"]', { hasText: postText }).first();
    await card.waitFor({ state: "visible", timeout: 90_000 }).catch(() => { throw new Error("the stranger's card never appeared on /home (routed " + routed + " validator requests)"); });
    const badge = card.locator('[data-testid="cast-anon"]');
    const preview = card.locator('[data-testid="cast-anon-preview"]');
    assert((await badge.count()) === 1, "the card has no anon badge");
    assert((await preview.count()) === 1 && (await preview.innerText()).includes("Preview only") && (await preview.innerText()).includes("not on Farcaster"), "the card does not say preview-only: " + ((await preview.count()) ? await preview.innerText() : "absent"));
    assert(routed > 0, "no validator request was routed — the card came from somewhere else");
    // UXH-2 (and UXH-11's words): the composer's read checked this visitor's crowd at once — outside it, no toggle on a
    // guess (before the fix the toggle was offered and the words cleared; the post then retried for a day and was lost).
    // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the read JOINED this visitor and the line says from when it can post
    // (the crowd is over the floor now, so the sentence has no floor part)
    await page.waitForFunction((s) => [...document.querySelectorAll('[data-testid="composer-anon-unavailable"]')].some((el) => (el.textContent || "").includes(s)), JOIN_PREFIX, { timeout: 60_000 }).catch(async () => {
      const seen = await page.locator('[data-testid="composer-anon-panel"]').first().innerText().catch(() => "(no anon panel)");
      throw new Error("a fresh visitor's composer does not say when it can post: " + seen.slice(0, 300));
    });
    assert((await page.locator('[data-testid="composer-anon"]').count()) === 0, "the composer offers the anonymous toggle to a visitor outside the crowd");
    // UXH-11: the sentence is said as ONE sentence — not after "…not available here:" and not with a doubled full stop
    const said = await page.locator('[data-testid="composer-anon-unavailable"]').first().innerText();
    assert(!/: You've joined the anonymous crowd/.test(said) && !said.includes("..") && !said.includes("Posting here also needs"), "the join sentence is run on after a colon, ends twice, or names a floor the crowd already clears: " + said.slice(0, 300));
    await ctx.close();
    // (b) THE STRANGER'S OWN IDENTITY on /home: kept in this browser (IndexedDB), the smoke tab closed (one tab per
    // device key), restored by /home's own device — in the crowd, so the toggle is offered and the line says preview-only
    const kept = await S.page.evaluate(async () => {
      await window.__layersDevice.persist();
      return window.__layersDevice.isPersistent();
    });
    assert(kept === true, "the stranger's identity could not be kept in this browser");
    await S.page.close();
    await routeToThrowaway(S.ctx);
    const home = await S.ctx.newPage();
    await home.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
    const info = await deviceReady(home);
    assert(info && info.rootId === S.info.rootId && info.restored === true, "/home did not restore the stranger's identity: " + JSON.stringify(info && { rootId: info.rootId, restored: info.restored }));
    const toggle = home.locator('[data-testid="composer-anon"]').first();
    await toggle.waitFor({ state: "visible", timeout: 60_000 }).catch(async () => {
      const seen = await home.locator('[data-testid="composer-anon-panel"]').first().innerText().catch(() => "(no anon panel)");
      throw new Error("the stranger in the crowd is not offered the anonymous toggle on /home: " + seen.slice(0, 300));
    });
    if (!(await toggle.isChecked())) await toggle.check();
    // PERSONA LAUNCH P7 (verify, harness fix): the composer's audience line — where the preview sentence lives — is shown
    // only once the composer is engaged (focused or holding text: components/Composer.tsx `(focused || text) && !compact`),
    // exactly as every other suite that reads that line types first. Words in the box are not a post: nothing is clicked.
    await home.locator('[data-testid="composer-input"]').first().fill("a draft that is never posted");
    const line = home.locator('[data-testid="composer-anon-preview"]').first();
    await line.waitFor({ state: "visible", timeout: 30_000 });
    assert((await line.innerText()).includes("Preview only"), "the composer's preview line: " + (await line.innerText()));
    const label = home.locator('[data-testid="composer-anon-label"]').first();
    await home.waitForFunction(() => { const el = document.querySelector('[data-testid="composer-anon-label"]'); return el && el.getAttribute("data-state") !== "pending"; }, null, { timeout: 30_000 });
    const lt = await label.innerText();
    assert(lt.startsWith("DEMO"), "the composer's label is not DEMO: " + lt.slice(0, 120));
    await home.close();
    return `${routed} validator request(s) routed to the throwaway`;
  });

  // ================================================================ 6. the live universe from a browser
  // PUBLIC GO-LIVE (the relay track): check 6 is the UNARMED half — the throwaway of checks 1-8 holds no relay credential and
  // its tabs get no live hint, so everything here is today's behaviour byte for byte; the ARMED half is check 9
  await check("6. UNARMED — THE LIVE UNIVERSE from a browser is refused: off in plain words (deployment-wide), POST refused, nothing sent to the web route; a live-relabelled envelope from the page is refused while the same envelope in the test universe is accepted", async () => {
    const L = await device("live-stranger", { query: "&zk=live" });
    const g = await L.api("GET", "/api/anon");
    assert(g.json?.available === false && g.json?.anonDeploymentOff === true && g.json?.unavailableReason === LIVE_OFF, "the live line: " + JSON.stringify({ available: g.json?.available, off: g.json?.anonDeploymentOff, reason: g.json?.unavailableReason }));
    const p = await L.api("POST", "/api/anon", { text: "a live anonymous post from a tab" });
    assert(p.status === 503 && p.json?.code === "unavailable", "POST: " + p.status + " " + JSON.stringify(p.json));
    assert(!L.requests.some((r) => r.method === "POST" && r.url.startsWith(T + "/zk/anon/web")), "a request reached the web route");
    // the raw door, from the page, with the web channel's own request shape (from this check's own tab: the stranger's
    // smoke tab was closed in check 5, when its identity moved to /home)
    const send = async (env) => {
      const body = padded(env);
      const pow = solvePow(body);
      return L.page.evaluate(
        async ({ url, b64 }) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const r = await fetch(url, { method: "POST", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error", mode: "cors", keepalive: false, headers: { "content-type": "text/plain;charset=UTF-8" }, body: bytes });
          return (await r.json()).outcome;
        },
        { url: T + "/zk/anon/web?pow=" + pow, b64: body.toString("base64") }
      );
    };
    const fixture = await validEnvelope("fixture");
    const control = await send(fixture);
    assert(control === "accepted", "the control (the same envelope, test universe) from the page: " + control);
    const live = await validEnvelope("live");
    const refused = await send(live);
    assert(refused === "refused", "a live-relabelled envelope: " + refused);
  });

  // ================================================================ 7. the doors
  await check("7. THE DOORS: the web routes refuse cookie / x-layers-device / referer (a browser's own headers accepted as the control); the strict /zk/anon/submit still refuses a user-agent (clean headers accepted as the control)", async () => {
    const browserHeaders = { "content-type": "text/plain;charset=UTF-8", accept: "*/*", "accept-language": "en-US", origin: BASE, "user-agent": "Mozilla/5.0 (anon-prod)", "sec-fetch-mode": "cors", "sec-fetch-site": "cross-site", "sec-fetch-dest": "empty" };
    for (const extra of [{ cookie: "layers=1" }, { "x-layers-device": "dev_x" }, { referer: BASE + "/home" }]) {
      const body = padded(await validEnvelope());
      const outcome = await rawPost("/zk/anon/web?pow=" + solvePow(body), body, { ...browserHeaders, ...extra });
      assert(outcome === "refused", "the web route took " + Object.keys(extra)[0] + ": " + outcome);
      const ctl = await rawPost("/zk/anon/web?pow=" + solvePow(body), body, browserHeaders);
      assert(ctl === "accepted", "the control without " + Object.keys(extra)[0] + ": " + ctl + " (was the proof consumed by the refusal?)");
    }
    const sb = Buffer.from(JSON.stringify({ envelope: await validEnvelope() }));
    const sp = solvePow(sb);
    const ua = await rawPost("/zk/anon/submit", sb, { "content-type": "application/json", "x-zk-pow": sp, "user-agent": "Mozilla/5.0" });
    assert(ua === "refused", "the strict route took a user-agent: " + ua);
    const clean = await rawPost("/zk/anon/submit", sb, { "content-type": "application/json", "x-zk-pow": sp });
    assert(clean === "accepted", "the strict route's clean control: " + clean);
  });

  // ================================================================ 8. phone proving time
  await check("8. PHONE PROVING TIME: real Groth16 proofs from the worker (desktop; Pixel 5 at 4x and 6x CPU throttle), each verified by the validator's own verifyLiveProof; the throttled page thread proves the same code as the phone stand-in; the proving files are loaded at BOOT and a live proof and its verify make ZERO requests to the app (L1); a tampered served zkey is refused by its pin", async () => {
    const vz = require(path.join(ROOT, "validator", "zk.js"));
    assert(typeof vz.verifyLiveProof === "function", "validator/zk.js exports no verifyLiveProof");
    const manifest = await get(BASE + "/device/zk/manifest.json");
    if (manifest.status !== 200 || manifest.json?.present !== true) throw infraErr("this build shipped no proving files (" + (manifest.json?.note ?? manifest.status) + ") — build with the pinned files in .zk-artifacts (nothing downloads them)");
    const decoys = Array.from({ length: 12 }, (_, i) => new Identity("layers-p7-measure/" + i).commitment.toString(10));
    const rnd = () => (BigInt("0x" + createHash("sha256").update(String(Math.random()) + Date.now()).digest("hex")) >> 16n).toString(10);
    const verifyInNode = async (env) => vz.verifyLiveProof({ merkleTreeDepth: env.proof.merkleTreeDepth, points: env.proof.points }, env.publicInputs, env.nullifier);
    const ownOrigin = new URL(BASE).origin;
    // what a proof may fetch: the prover and its files on THIS site (the page's own favicon is the browser's, not the worker's)
    // L1: a proof may fetch NOTHING from this site — the prover and its files were loaded at boot (the page's own favicon is
    // the browser's, not the proof's); the boot load itself must be done before the proof starts
    const allowedDuringProof = new Set([ownOrigin + "/favicon.ico"]);
    const bootLoaded = async (d) => {
      const until = Date.now() + 60_000;
      while (Date.now() < until) {
        const s = await d.page.evaluate(() => window.__layersDevice.prover.preload());
        if (s && s.proverReady && s.filesReady && !s.filesAbsent) return s;
        await sleep(250);
      }
      throw new Error(d.label + ": the boot-time load of the prover and its files did not finish: " + JSON.stringify(await d.page.evaluate(() => window.__layersDevice.prover.preload())));
    };
    /** one live proof IN THE WORKER on device `d`, verified in node; the requests it made */
    const workerProof = async (d) => {
      const from = Date.now();
      const r = await d.page.evaluate(async (args) => {
        try {
          return { ok: true, v: await window.__layersDevice.prover.liveSample(args) };
        } catch (e) {
          return { ok: false, error: e && e.message ? e.message : String(e) };
        }
      }, { members: decoys, scope: rnd(), message: rnd() });
      assert(r.ok, d.label + ": the worker refused: " + r.error);
      assert(r.v.verified?.ok === true, d.label + ": the device's own verify: " + JSON.stringify(r.v.verified));
      assert((await verifyInNode(r.v.envelope)) === true, d.label + ": the validator's verifyLiveProof refused the worker's proof");
      const outside = d.requests.filter((q) => q.at >= from && !q.url.startsWith(T) && !allowedDuringProof.has(q.url.split("?")[0]) && !q.url.startsWith("blob:"));
      assert(outside.length === 0, d.label + ": the live proof and its verify made requests (L1: everything was loaded at boot): " + outside.map((q) => q.url).join(", "));
      assert(r.v.prove?.where === "DedicatedWorkerGlobalScope", d.label + ": the proof did not come from a dedicated worker: " + JSON.stringify(r.v.prove));
      return r.v.prove.timings ? { ...r.v.prove.timings, verifyJobMs: r.v.verify?.timings?.verifyMs ?? null, where: r.v.prove.where } : null;
    };
    const bench = async (d, where) =>
      where === "worker"
        ? (await d.page.evaluate(() => window.__layersDevice.prover.run("bench", { rounds: 3000 }))).timings.totalMs
        : await d.page.evaluate(async (u) => { const m = await import(u); return (await m.handleJob({ id: 1, op: "bench", rounds: 3000 })).timings.totalMs; }, BASE + "/device/prover.js");
    /** the same prover code on the PAGE thread (the throttle reaches it), a synthetic identity, verified in node */
    const pageThreadProof = async (d) => {
      const id = new Identity("layers-p7-measure-page/" + Date.now());
      const members = [id.commitment.toString(10), ...decoys];
      const root = new Group(members.map((m) => BigInt(m))).root.toString(10);
      const pub = { mode: "live", claimKind: "tier-membership", tree: "tier-2", epoch: 0, merkleTreeRoot: root, scope: rnd(), message: rnd(), personaId: "p_bench", gateId: "bench", challenge: "epoch-0" };
      const a = await d.page.evaluate(async ({ u, job }) => { const m = await import(u); return m.handleJob(job); }, { u: BASE + "/device/prover.js", job: { id: 7, op: "live-prove", claimKind: "tier-membership", publicInputs: pub, members, commitment: id.commitment.toString(10), secret: id.secretScalar.toString(10), depth: 20 } });
      assert(a.ok, d.label + ": the page-thread proof: " + a.error);
      const env = { publicInputs: pub, nullifier: a.result.proof.nullifier, proof: { merkleTreeDepth: a.result.proof.merkleTreeDepth, points: a.result.proof.points } };
      assert((await verifyInNode(env)) === true, d.label + ": the validator refused the page-thread proof");
      return a.timings;
    };
    // the commit the measured code sits on, and whether the working tree differed from it (a measurement before a commit)
    const dirty = (spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout || "").trim().length > 0;
    const out = { commit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim() || "unknown", workingTreeDirty: dirty, date: new Date().toISOString(), base: BASE, artifactBytes: null, desktop: null, pixel5: {}, tamperedZkeyRefused: null, notes: [] };
    // DESKTOP
    // L1: the live universe — each tab loads the proving files at BOOT; the fetch time recorded is that boot load
    const D = await device("desktop", { query: "&zk=live" });
    const boot = await bootLoaded(D);
    const art = await D.page.evaluate(() => window.__layersDevice.prover.run("artifacts"));
    assert(art?.result?.bytes === boot.files?.bytes, "the worker's pin check of the boot-loaded files: " + JSON.stringify({ worker: art?.result, boot: boot.files }));
    out.artifactBytes = boot.files?.bytes ?? null;
    out.desktop = { artifactsFetchMs: boot.files?.ms ?? null, artifactsLoadedAt: "boot", worker: await workerProof(D), benchWorkerMs: await bench(D, "worker"), benchPageMs: await bench(D, "page") };
    // PIXEL 5 at 4x and 6x
    for (const rate of [4, 6]) {
      const P = await device("pixel5-x" + rate, { query: "&zk=live", contextOptions: { ...devices["Pixel 5"] } });
      await bootLoaded(P);
      const cdp = await P.ctx.newCDPSession(P.page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      const benchWorkerMs = await bench(P, "worker");
      const benchPageMs = await bench(P, "page");
      const worker = await workerProof(P);
      const pageThread = await pageThreadProof(P);
      out.pixel5["x" + rate] = { cpuThrottleRate: rate, worker, pageThread, benchWorkerMs, benchPageMs, workerThrottleObserved: +(benchWorkerMs / out.desktop.benchWorkerMs).toFixed(2), pageThrottleObserved: +(benchPageMs / out.desktop.benchPageMs).toFixed(2) };
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }
    out.notes.push("Chromium's CDP CPU throttle (Emulation.setCPUThrottlingRate) applies to the page's main thread only — a dedicated worker answers 'Operation is only supported for pages, not workers' — so the 'worker' rows under throttle run at desktop speed (see workerThrottleObserved). The 'pageThread' rows run the SAME prover code (public/device/prover.js handleJob) on the throttled page thread: they are the phone stand-in. Product proofs always run in the worker.");
    // A TAMPERED served zkey is refused by the worker. L1: the tab loads the files at BOOT, so the tampered copy is served
    // from the first request (the route exists before the page does); the worker pin-checks the bytes it is handed
    const real = await get(BASE + "/device/zk/semaphore-20.zkey");
    const bad = Buffer.from(real.buf);
    bad[100_000] ^= 1;
    let tamperedServed = 0;
    const X = await device("tampered", {
      query: "&zk=live",
      beforeGoto: (ctx) => ctx.route(ownOrigin + "/device/zk/semaphore-20.zkey", (route) => { tamperedServed++; return route.fulfill({ status: 200, contentType: "application/octet-stream", body: bad }); }),
    });
    await bootLoaded(X);
    assert(tamperedServed >= 1, "the tampered zkey was never served to the tab's boot load (the refusal below would be vacuous)");
    const t = await X.page.evaluate(async (args) => { try { await window.__layersDevice.prover.liveSample(args); return null; } catch (e) { return e && e.message ? e.message : String(e); } }, { members: decoys, scope: rnd(), message: rnd() });
    assert(t && /not the pinned one/.test(t), "a tampered zkey was not refused by its pin: " + t);
    out.tamperedZkeyRefused = true;
    mkdirSync(path.join(ROOT, "shots"), { recursive: true });
    writeFileSync(path.join(ROOT, "shots", "p7-browser-prover.json"), JSON.stringify(out, null, 2) + "\n");
    const ms = (x) => (x == null ? "?" : Math.round(x) + " ms");
    return `desktop worker prove ${ms(out.desktop.worker?.proveMs)}; Pixel 5 x4 page-thread prove ${ms(out.pixel5.x4?.pageThread?.proveMs)}, x6 ${ms(out.pixel5.x6?.pageThread?.proveMs)}; artifacts ${out.artifactBytes} B in ${ms(out.desktop.artifactsFetchMs)} → shots/p7-browser-prover.json`;
  });

  // ================================================================ 9. ARMED (PUBLIC GO-LIVE, the relay track)
  // A SECOND throwaway, armed on the AGENT path against the loopback Neynar stub. Its own database and process (killed with
  // its tree on exit); the stub runs in this process. Nothing here reaches any network.
  const APORT = Number(process.env.ANON_PROD_ARMED_PORT || 4067);
  const A = `http://127.0.0.1:${APORT}`;
  const ADB = path.join(TMP, "armed.db");
  const AGENT_UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d";
  const AGENT_FID = 812345;
  const STRANGER_FID = 7001;
  const RELAY_IV_MS = 30_000;
  const apub = require(path.join(ROOT, "validator", "anonpublic.js"));
  const { startNeynarAnonStub } = await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "neynar-anon-stub.mjs")).href);
  const { privateKeyToAccount } = await import("viem/accounts");
  const { createSiweMessage } = await import("viem/siwe");
  const custody = privateKeyToAccount("0x" + createHash("sha256").update("accept-anon-prod armed custody").digest("hex"));
  let stub = null;
  let aChild = null;
  let aOut = "";
  const armed = { S2: null, M: null, castHash: null, postText: null, networkHash: null, acceptedAt: 0 };
  const killArmed = async () => {
    if (!aChild || aChild.exitCode !== null) return;
    const c = aChild;
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* fall through */
    }
    try {
      c.kill("SIGKILL");
    } catch {
      /* gone */
    }
    for (let i = 0; i < 40 && c.exitCode === null && c.signalCode === null; i++) await sleep(100);
  };
  globalThis.__armedCleanup = async () => {
    await killArmed();
    if (stub) await stub.close();
    stub = null;
  };
  process.on("exit", () => {
    if (aChild && aChild.exitCode === null) {
      try {
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(aChild.pid), "/T", "/F"], { stdio: "ignore" });
        else aChild.kill("SIGKILL");
      } catch {
        /* gone */
      }
    }
    try {
      writeFileSync(path.join(os.tmpdir(), "layers-anon-prod-armed-validator.log"), aOut);
    } catch {
      /* best effort */
    }
  });
  /** (re)start the armed throwaway on the same database; extra env on top of the arming */
  async function startArmed(extra = {}) {
    await killArmed();
    const env = {
      ...tEnv,
      LAYERS_VALIDATOR_PORT: String(APORT),
      VALIDATOR_DB: ADB,
      FC_ANON_FID: String(AGENT_FID),
      FC_ANON_SIGNER_UUID: AGENT_UUID,
      FC_ANON_NEYNAR_KEY: stub.key,
      ZK_ANON_RELAY_LIVE: "on",
      ZK_ANON_POST_LIVE_CAP: "3",
      FC_ANON_NEYNAR_BASE_URL: stub.baseUrl,
      ANON_FID_RPC_URL: stub.rpcUrl,
      APP_URL: new URL(BASE).origin,
      ZK_ANON_RELAY_INTERVAL_MS: String(RELAY_IV_MS),
      ZK_ANON_RELAY_SPREAD_MS: "0",
      ANON_MODERATORS: "",
      ...extra,
    };
    for (const k of ["FC_HUB_URL", "ZK_ANON_TRANSPORT", "ZK_ANON_FID_GATE", "ANON_FILTER_SCAM_DOMAINS", "ZK_ANON_POST_DAILY_CAP", "ZK_ANON_POST_SLOTS"]) delete env[k];
    aChild = spawn(process.execPath, [path.join(ROOT, "validator", "server.js")], { env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    aChild.stdout.on("data", (b) => (aOut += b));
    aChild.stderr.on("data", (b) => (aOut += b));
    for (let i = 0; i < 80; i++) {
      if (aChild.exitCode !== null) break;
      if ((await get(A + "/health").catch(() => ({ status: 0 }))).status === 200) return;
      await sleep(500);
    }
    throw infraErr("the armed throwaway did not come up on " + A + ":\n" + aOut.split("\n").slice(-12).join("\n"));
  }
  const armedRow = (hash) => {
    const db = new DatabaseSync(ADB, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 8000");
      const r = db.prepare("SELECT status, fid, network_hash, hidden_at, text FROM zk_anon_casts WHERE mode = 'live' AND cast_hash = ?").get(hash);
      return r ? { ...r } : null;
    } finally {
      db.close();
    }
  };
  const neynarCalls = (op) => stub.calls().filter((c) => c.kind === "neynar" && (!op || c.op === op));
  // PUBLIC GO-LIVE (verify): the HOME TIMELINE's own read — /api/feed2 (lib/feed.ts buildFeed), where relayed @anon casts are
  // merged. /api/feed is the classic feed (lib/data.ts getFeed), which never carries an anonymous post, so polling it could
  // never show one (9c's first run failed exactly so). true / false only on a 200; anything else is null (unknown), so a
  // failed read can never pass as "gone" (never fail open).
  const feedHas = async (D, text) => {
    const f = await D.api("GET", "/api/feed2?surface=discovery");
    if (f.status !== 200 || !Array.isArray(f.json?.cards)) return null;
    return JSON.stringify(f.json.cards).includes(text);
  };

  await check("9a. ARMED: a throwaway armed on the AGENT path (the loopback Neynar stub) answers liveRelay true; the moderator's key from its tab goes into ANON_MODERATORS; the stranger joins the live crowd through the fid gate (a verified sign-in for this site's domain), and with 60 fid-gated decoys and one epoch later its live tab with the app's hint is ON, NOT preview-only, and says the post goes to Farcaster", async () => {
    if ((await get(A + "/health").catch(() => ({ status: 0 }))).status !== 0) throw infraErr("something already answers on " + A + " — this check starts its own armed throwaway there");
    stub = await startNeynarAnonStub({ key: "anonstub-accept-anon-prod-01", signers: { [AGENT_UUID]: { fid: AGENT_FID } }, custody: { [custody.address.toLowerCase()]: STRANGER_FID } });
    await startArmed();
    const cfg = await get(A + "/zk/anon-post/config?mode=live");
    assert(cfg.json?.liveRelay === true && cfg.json?.relayKind === "agent" && cfg.json?.fidGate === true && cfg.json?.tree === TREE, "the armed validator's public config: " + JSON.stringify(cfg.json));
    const ps0 = await get(A + "/zk/anon/public-status?mode=live");
    assert(ps0.json?.relay?.ready === true && ps0.json?.fidGate?.on === true && ps0.json?.fidGate?.domain === new URL(BASE).host && ps0.json?.moderated === false, "public-status before the moderator: " + JSON.stringify(ps0.json));
    // the moderator: a live tab on the armed throwaway; its key, from the route Settings > Moderation reads
    armed.M = await device("armed-moderator", { query: "&zk=live", validator: A, env: { ZK_ANON_UNIVERSE: "live" } });
    const mk = await armed.M.api("GET", "/api/anon/moderation");
    assert(mk.status === 200 && /^[0-9a-f]{64}$/.test(mk.json?.publicKey ?? "") && mk.json.isModerator === false && mk.json.sentence === "You are not a moderator on this site.", "the moderator tab before ANON_MODERATORS: " + JSON.stringify(mk.json));
    await startArmed({ ANON_MODERATORS: mk.json.publicKey });
    const mk2 = await armed.M.api("GET", "/api/anon/moderation");
    assert(mk2.json?.isModerator === true, "the moderator tab after the restart with ANON_MODERATORS: " + JSON.stringify(mk2.json));
    // the stranger, and its join through the fid gate (what lib/zk/anon/fcJoin.ts sends after a verified sign-in)
    armed.S2 = await device("armed-stranger", { query: "&zk=live", validator: A, env: { ZK_ANON_UNIVERSE: "live" } });
    // PUBLIC GO-LIVE (PRIV-LIVE-1): the crowd is joined with the device's CROWD identity (GET /api/anon?crowd=1, memory only),
    // never the root's registered commitment (the probe's) — and the validator holds no registration of it
    const probe = await armed.S2.api("POST", "/api/zk", { action: "probe" });
    const rootCommitment = String(probe.json?.commitment ?? "");
    const crowd = await armed.S2.api("GET", "/api/anon?crowd=1");
    const commitment = String(crowd.json?.commitment ?? "");
    assert(/^\d{10,80}$/.test(commitment) && crowd.json?.host === "tab" && crowd.json?.mode === "live", "the stranger's crowd commitment: " + JSON.stringify(crowd.json));
    assert(commitment !== rootCommitment, "the crowd commitment IS the root's registered commitment (fid -> commitment -> root)");
    {
      const vdb = new DatabaseSync(ADB, { readOnly: true });
      try {
        assert(!vdb.prepare("SELECT 1 FROM zk_registrations WHERE commitment = ?").get(commitment), "the crowd commitment was REGISTERED under a root on the validator");
      } finally {
        vdb.close();
      }
    }
    const salt = createHash("sha256").update("salt|" + Date.now()).digest("hex").slice(0, 32);
    const message = createSiweMessage({ domain: new URL(BASE).host, address: custody.address, statement: "Farcaster Auth", uri: new URL(BASE).origin + "/device", version: "1", chainId: 10, nonce: apub.joinNonceFor(commitment, salt), issuedAt: new Date(), resources: ["farcaster://fid/" + STRANGER_FID] });
    const join = await get(A + "/zk/anon/fid-join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "live", fid: STRANGER_FID, commitment, salt, authMethod: "custody", message, signature: await custody.signMessage({ message }) }) });
    assert(join.status === 201 && join.json?.ok === true, "the fid-gate join: " + join.status + " " + JSON.stringify(join.json));
    // FURNITURE (the armed throwaway's temp database only): 60 fid-gated decoys and the live epoch one on
    const decoys = Array.from({ length: 60 }, (_, i) => new Identity("layers-armed-decoy/" + i).commitment.toString(10));
    const db = new DatabaseSync(ADB);
    try {
      db.exec("PRAGMA busy_timeout = 8000");
      db.exec("BEGIN IMMEDIATE");
      try {
        const off = db.prepare("SELECT offset_ms FROM zk_epoch_offset WHERE mode = 'live'").get();
        const offset = off ? off.offset_ms : 0;
        const cur = Math.floor((Date.now() + offset) / EPOCH_MS);
        const ins = db.prepare("INSERT OR IGNORE INTO zk_anon_fid_members (mode, fid, commitment, joined_epoch) VALUES ('live', ?, ?, ?)");
        for (let i = 0; i < 60; i++) ins.run(930000 + i, decoys[i], cur - 1);
        db.prepare("INSERT INTO zk_epoch_offset (mode, offset_ms) VALUES ('live', ?) ON CONFLICT(mode) DO UPDATE SET offset_ms = excluded.offset_ms").run(offset + EPOCH_MS);
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* the failed statement may have ended it */
        }
        throw e;
      }
    } finally {
      db.close();
    }
    const st = await armed.S2.waitTick(Date.now(), 60_000, "live");
    assert(st.snapshot.members >= 50 && st.snapshot.tree === TREE, "the live crowd after the join and the furniture: " + JSON.stringify(st.snapshot));
    const g = await armed.S2.api("GET", "/api/anon");
    assert(g.json?.available === true && g.json?.previewOnly === false && g.json?.destination === "farcaster" && /Farcaster/.test(g.json?.destinationSentence ?? ""), "the armed live tab: " + JSON.stringify({ available: g.json?.available, previewOnly: g.json?.previewOnly, destination: g.json?.destination, sentence: g.json?.destinationSentence, reason: g.json?.unavailableReason }));
    assert(neynarCalls("publish").length === 0, "something was published before any post");
    return st.snapshot.members + " in the live crowd; " + g.json.destinationSentence;
  });

  await check("9b. ARMED: the post is proved in the tab and accepted, held PENDING with zero publishes, then leaves the validator EXACTLY ONCE at a relay slot under the agent's signer and key (a second slot sends nothing); the tab asked the app for nothing while it proved and sent, the app's log never names the stub, and every Neynar call came after the post", async () => {
    assert(armed.S2, "9a did not complete");
    const S2 = armed.S2;
    armed.postText = "an armed anonymous post " + Date.now().toString(36);
    const from = Date.now();
    const p = await S2.api("POST", "/api/anon", { text: armed.postText });
    assert(p.status === 202 && p.json?.previewOnly !== true && p.json?.destination === "farcaster" && /Farcaster/.test(p.json?.postedSentence ?? "") && /^[0-9a-f]{64}$/.test(p.json?.castHash ?? ""), "POST: " + p.status + " " + JSON.stringify(p.json).slice(0, 300));
    armed.castHash = p.json.castHash;
    let s = null;
    for (let i = 0; i < 240; i++) {
      s = await S2.api("GET", "/api/anon?castHash=" + armed.castHash);
      if (s.json?.item?.status === "sent" || s.json?.status === "dropped") break;
      await sleep(1000);
    }
    if (s.json?.item?.status === "sent" && s.json.item.outcome === "refused") throw new Error("the armed validator REFUSED the live envelope at its web door — validator/anon.js webEnvelopeUniverseOk must let a live envelope through while validator/anonpublic.js liveWebDoorOpen() (the gpl track's diff); outcome log: " + JSON.stringify(s.json?.outcome));
    assert(s.json?.item?.status === "sent" && s.json.item.outcome === "accepted", "the post's status: " + JSON.stringify({ status: s.json?.status, item: s.json?.item, outcome: s.json?.outcome }));
    armed.acceptedAt = Date.now();
    const appDuring = S2.requests.filter((r) => r.at >= from && r.url.startsWith(new URL(BASE).origin + "/") && new URL(r.url).pathname !== "/favicon.ico");
    assert(appDuring.length === 0, "the tab asked the app for something while it proved and sent: " + appDuring.map((r) => r.method + " " + r.url).join(", "));
    const webPosts = S2.requests.filter((r) => r.at >= from && r.method === "POST" && r.url.startsWith(A + "/zk/anon/web"));
    assert(webPosts.length >= 1, "no POST reached the armed throwaway's web door");
    // held until the slot: right after acceptance the row is pending and nothing was published — or, if a slot fell in that
    // instant, the one publish happened AT a slot moment (asserted below)
    const row0 = armedRow(armed.castHash);
    assert(row0 && (row0.status === "pending" || row0.status === "relayed"), "the accepted row: " + JSON.stringify(row0));
    if (row0.status === "pending") assert(neynarCalls("publish").length === 0, "a publish happened while the row was still pending");
    let row = row0;
    for (let i = 0; i < 2 * (RELAY_IV_MS / 1000) + 20 && row.status !== "relayed"; i++) {
      await sleep(1000);
      row = armedRow(armed.castHash);
    }
    assert(row.status === "relayed", "the post was not relayed within two relay slots: " + JSON.stringify(row));
    const pubs = neynarCalls("publish");
    assert(pubs.length === 1, "publishes: " + pubs.length);
    const pub = pubs[0];
    assert(pub.keyOk === true && pub.signerKnown === true && pub.text === armed.postText && pub.hash === row.network_hash && row.fid === AGENT_FID, "the publish: " + JSON.stringify({ keyOk: pub.keyOk, signerKnown: pub.signerKnown, sameText: pub.text === armed.postText, hash: pub.hash, row }));
    assert(pub.at % RELAY_IV_MS <= RELAY_IV_MS / 6 + 2000, "the publish was not at a relay slot (" + (pub.at % RELAY_IV_MS) + " ms past a " + RELAY_IV_MS + " ms boundary): it left at submission time");
    armed.networkHash = row.network_hash;
    await sleep(RELAY_IV_MS + 8000);
    assert(neynarCalls("publish").length === 1, "a second slot published again: " + neynarCalls("publish").length);
    assert(neynarCalls().every((c) => c.at >= from && c.keyOk === true), "a Neynar call came before the post or without the agent key: " + JSON.stringify(neynarCalls().map((c) => ({ at: c.at - from, path: c.path, keyOk: c.keyOk }))));
    const appLog = path.join(process.env.TEMP || os.tmpdir(), "layers-app.log");
    if (!existsSync(appLog)) throw infraErr("no " + appLog + " (start the pair with scripts/run-prod-shape.sh)");
    const lt = readFileSync(appLog, "latin1");
    assert(!lt.includes(":" + stub.port + "/") && !lt.includes(stub.key), "the app server's log names the stub: the app touched Neynar");
    return "relayed at +" + (pub.at - armed.acceptedAt) + " ms after acceptance, " + (pub.at % RELAY_IV_MS) + " ms into a slot; network hash " + row.network_hash;
  });

  await check("9c. ARMED: Report from the stranger's tab -> the moderator's signed REMOVE -> hidden at once (gone from /zk/anon-casts, /zk/anon-cast 404, gone from the live tab's home feed, the row KEPT with hidden_at) and ONE DELETE through the agent key by the validator's own delete loop, 'deleted' in the moderator's list", async () => {
    assert(armed.castHash && armed.networkHash && armed.M && armed.S2, "9b did not complete");
    const { S2, M } = armed;
    let shown = false;
    for (let i = 0; i < 45 && !shown; i++) {
      shown = (await feedHas(S2, armed.postText)) === true;
      if (!shown) await sleep(1000);
    }
    assert(shown, "the relayed post never reached the live tab's home feed (the 'gone' below would be vacuous)");
    const listed0 = await get(A + "/zk/anon-casts?mode=live");
    assert((listed0.json?.casts ?? []).some((c) => c.castHash === armed.castHash), "the relayed post is not in /zk/anon-casts before the takedown");
    const rep = await S2.api("POST", "/api/anon/report", { castHash: armed.castHash, reason: "spam", universe: "live" });
    assert(rep.status === 201 && rep.json?.ok === true, "the report: " + rep.status + " " + JSON.stringify(rep.json));
    const q = await M.api("GET", "/api/anon/moderation?list=1");
    const item = (q.json?.items ?? []).find((x) => x.castHash === armed.castHash);
    assert(q.status === 200 && item && item.reports >= 1, "the moderator's queue: " + q.status + " " + JSON.stringify(q.json).slice(0, 300));
    const deletesBefore = neynarCalls("delete").length;
    const rm = await M.api("POST", "/api/anon/moderation", { action: "decide", castHash: armed.castHash, decision: "remove" });
    assert(rm.status === 200 && rm.json?.hidden === true && rm.json?.deleteState === "pending", "REMOVE: " + rm.status + " " + JSON.stringify(rm.json));
    const one = await get(A + "/zk/anon-cast?mode=live&hash=" + armed.castHash);
    assert(one.status === 404, "the removed post is still readable: " + one.status);
    const listed = await get(A + "/zk/anon-casts?mode=live");
    assert(!(listed.json?.casts ?? []).some((c) => c.castHash === armed.castHash), "the removed post is still listed");
    const kept = armedRow(armed.castHash);
    assert(kept && kept.hidden_at > 0 && kept.text === armed.postText, "the row was not KEPT hidden: " + JSON.stringify(kept));
    let gone = false;
    for (let i = 0; i < 45 && !gone; i++) {
      gone = (await feedHas(S2, armed.postText)) === false;
      if (!gone) await sleep(1000);
    }
    assert(gone, "the removed post is still in the live tab's home feed");
    // the delete loop runs every minute on a deployment (no dev hooks here): wait for its pass
    let dels = [];
    for (let i = 0; i < 90 && dels.length === 0; i++) {
      dels = neynarCalls("delete").slice(deletesBefore);
      if (!dels.length) await sleep(1000);
    }
    assert(dels.length === 1 && dels[0].keyOk === true && dels[0].signerKnown === true && dels[0].target === armed.networkHash, "the DELETE: " + JSON.stringify(dels));
    let state = null;
    for (let i = 0; i < 10 && state !== "deleted"; i++) {
      const l = await M.api("GET", "/api/anon/moderation?list=1");
      state = (l.json?.removed ?? []).find((x) => x.castHash === armed.castHash)?.deleteState ?? null;
      if (state !== "deleted") await sleep(1000);
    }
    assert(state === "deleted", "the moderator's list says " + state);
    await sleep(61_000);
    assert(neynarCalls("delete").slice(deletesBefore).length === 1, "the delete was sent again on the next pass");
    assert(stub.casts().find((c) => c.hash === armed.networkHash)?.deleted === true, "the stub does not hold the cast as deleted");
    return "one DELETE for " + armed.networkHash + "; the moderator reads 'deleted'";
  });
} finally {
  for (const c of allContexts) await c.close().catch(() => {});
  await browser.close().catch(() => {});
  killThrowaway();
  // PUBLIC GO-LIVE: the armed throwaway (check 9) and the loopback stub
  if (typeof globalThis.__armedCleanup === "function") await globalThis.__armedCleanup().catch(() => {});
}

const fails = results.filter((r) => r[0] === "FAIL");
const infras = results.filter((r) => r[0] === "INFRA");
console.log(`\n${results.length - fails.length - infras.length}/${results.length} anon-prod checks passed` + (fails.length ? `, ${fails.length} FAILED` : "") + (infras.length ? `, ${infras.length} infra` : ""));
// snarkjs (validator/zk.js's verifier) keeps a curve alive: the result is printed, so the process ends here
process.exit(fails.length ? 1 : infras.length ? 2 : 0);
