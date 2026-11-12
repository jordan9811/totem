// PUBLIC GO-LIVE — THE NATIVE ANON PAGE (/anon) AND THE FARCASTER MINI APP ON THE PRODUCTION SHAPE (npm run
// test:anon-page-prod once the verify agent adds the script). Run it through scripts/run-prod-shape.sh after --build, with
// the sign-in stub:
//
//   PRODLIVE_SIWF=stub bash scripts/run-prod-shape.sh scripts/accept-anon-page-prod.mjs
//
// PUBLIC GO-LIVE (anonpage fixes) — and AGAIN on the LIVE production shape (the public site in PUBLIC_LIVE mode):
//
//   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub bash scripts/run-prod-shape.sh scripts/accept-anon-page-prod.mjs
//
// The launcher hands the suite EXPECT_PUBLIC_LIVE; the suite checks the page's own device env agrees (ABORT otherwise).
// On the live shape the test universe is off for posting in a tab (a live product posts no test data), so P4-P8 (the
// test-universe post, its report, share and click-through) are SKIPPED there, said by name; every other check runs on
// both shapes, and P13/P14 assert the shape-specific answer (live: a test post's share page is a 404, the old address
// is redirected; preview: unchanged).
//
// It ABORTS (exit 2) unless /api/dev answers 403 (the production shape) and SIWF_STUB_URL answers /__stub/state. Not in
// sweep-x.sh. Nothing reaches Farcaster, Neynar, Optimism or any other host: the sign-in relay and chain are the loopback
// SIWF stub (scripts/lib/siwf-stub.mjs), the relay's Neynar and the fid gate's chain are relay's loopback stub
// (scripts/lib/neynar-anon-stub.mjs), and the "Farcaster web client" that frames the page in P3 is a page this suite serves
// through Playwright's router (no request leaves the machine). P10 fails on any request a tab makes to another host.
//
// THE THROWAWAY VALIDATOR, twice (the accept-anon-prod recipe: a production-shaped validator.js on ANON_PAGE_VALIDATOR_PORT,
// default 4057, a temp database, MUST_NOT_SHIP blanked; the tabs' validator traffic is ROUTED to it, so nothing is written
// to the pair's validator). Section A runs it UNARMED (the test universe: today's public preview); section B restarts it
// ARMED against relay's Neynar stub (FC_ANON_FID / FC_ANON_SIGNER_UUID / FC_ANON_NEYNAR_KEY / ZK_ANON_RELAY_LIVE=on, the
// stub as its Neynar base and as the fid gate's chain, a 2 s relay slot with no spread) and a LIVE tab (the app's
// ZK_ANON_UNIVERSE=live hint, added to the page's device env by an init script, as accept-anon-prod adds the tree).
// The tabs' device env also gets a 1 s check cadence and a 1-3 s send jitter (the smoke page's knobs) the same way.
// ONE EXCEPTION to "nothing is written to the pair's validator": P13 plants two relayed rows (one test-universe, one live,
// random hashes) in the PAIR's validator database (validator/layers.db, or VALIDATOR_DB), because the share page reads the
// pair's validator from the app SERVER, which no browser route can redirect. Both rows are REMOVED afterwards, exactly
// those two (final verify: the pair's database is the rig's, every reset keeps LIVE rows, so a merely hidden planted live
// row stayed for good and broke a later suite that reads the whole table; see P13's finally).
//
//   P1  THE PAGE: /anon is 200 with the fc:miniapp (launch_miniapp) and fc:frame (launch_frame) embeds — every embed rule of
//       the spec but https (a loopback pair is http); its content security policy names ONLY the Farcaster web origins in
//       frame-ancestors and no outside script / style / font host, images from EXACTLY this origin and the app's media
//       hosts (F14: lib/miniapp/manifest.ts anonImageSources), with NO X-Frame-Options; /anon/p/<unknown hash> is a 404
//       under the same policy; /home and /welcome stay unframeable (frame-ancestors 'none' + DENY)
//   P2  THE MANIFEST: /.well-known/farcaster.json is JSON with the spec's fields (lib/miniapp/manifest.ts validateManifest),
//       homeUrl on THIS deployment's host, unsigned here (the pair sets no association) — the only problems are the https /
//       localhost rules a loopback pair cannot meet
//   P3  FRAMING IN A BROWSER: a page on https://farcaster.xyz (served by this suite) frames /anon and the page draws (and,
//       with no host answering, says it is not inside a Mini App); a page on another origin is refused by frame-ancestors;
//       /home is refused even to farcaster.xyz
//   P4  DESKTOP SIGN-IN: the disclosure and the QR; the stub approves as @stubalice; the page says signed in; the composer
//       says when this browser can post (the composer's read JOINED the test crowd: one registration); F4: only then does
//       the signed-in line say "in the crowd"; F3: the identity still lives only in this tab, so Save / keep is offered
//       at once (JOIN_KEEP_NOTE), before any post
//   P5  DESKTOP POST: in the crowd (70 decoys, one epoch on) Post is offered; the post is proved in the WORKER
//       (proverStatus: browser-worker, a fixture-prove after the press), sent as exactly ONE web POST, relayed exactly ONCE
//       in the throwaway's list, the 202's sentence is relay's (lib/zk/anon/universe.ts POSTED_LAYERS_PREVIEW), and the feed
//       shows the post
//   P6  REPORT: on the feed card, a reason -> "reached the moderators"; the throwaway holds one report row for that cast
//       with that reason, and the reports table has no column that could name a reporter
//   P7  SHARE: asks first (the cost sentence), then links the documented composer intent with this post's /anon/p/<hash>
//   P8  CLICK-THROUGH: "Open Totem" is a SOFT navigation to /welcome?from=anon (a window marker survives), the SAME root,
//       the public self still @stubalice, and the onboarding resumes at the step after Farcaster ("profile": This is you); F14: in that same
//       document (still under /anon's policy) an image on an allowlisted media host loads with no policy violation, and a
//       control image on another host is refused by the policy (both answered locally by Playwright: nothing leaves)
//   P9  PHONE (Pixel 5): no sideways scroll; the phone note; pressing Sign in keeps the identity in this browser BEFORE the
//       request (persistent once the request exists, not before) and offers "Open in the Farcaster app"
//   P10 ZERO THIRD-PARTY REQUESTS from every /anon tab of this run (desktop until it left for /welcome, phone, live): only
//       this site, its validator (routed to the throwaway) and the sign-in stub
//   P11 INERT OUTSIDE FARCASTER: a top-level /anon says outside (data-miniapp) and signs in through the relay, never the SDK
//   P12 PRIV-LIVE-5, INSIDE THE FARCASTER APP: a tab with a stubbed Farcaster host (a React Native WebView bridge that answers
//       the bundled SDK's own comlink calls, in this browser) settles on "inside", signs in through the SDK, and BEFORE the
//       sign-in and above the composer says the host runs the page and knows the account; "Open in browser" asks the host
//       to open this site's /anon (the host saw one openUrl with exactly that address); ready() reached the host once
//   P13 ASM-2, THE SHARE PAGE'S UNIVERSE: one relayed test-universe row and one relayed live row are planted in the pair's
//       validator (see above) and confirmed through the pair's own validator read; then /anon/p/<live> renders (data-mode
//       live) on both shapes, and /anon/p/<test> is a 404 on the LIVE shape and the labelled test post on the preview
//       (the same planted row, so the live 404 is the flag's doing, not a missing row)
//   P14 F6, ONE PUBLIC ADDRESS: a page requested with another Host (the platform's old address) is 308'd to the same path and
//       query on APP_URL on the LIVE shape, while /api/health on that host and /anon on the pair's own host answer 200; the
//       preview redirects nothing
//   B1  LIVE, ARMED: a live tab signs in as @stubbob and the fid gate JOINS it (one zk_anon_fid_members row); in a live
//       crowd (70 decoy accounts, one epoch on) it posts from /anon: relay's destination sentence before the click, a REAL
//       proof in the worker, relayed EXACTLY ONCE through the stub under the agent's signer and key, and the page links it
//       on Farcaster (https://farcaster.xyz/~/conversations/0x…); the app server saw no /api/anon request
//       (needs the pinned proving files in the build: /device/zk/manifest.json present:true; INFRA otherwise).
//       F3: before the click the page says it keeps the identity first and the disclosure names the live join (never
//       "Totem's server sees nothing"); the identity is kept (isPersistent) BEFORE any join request exists; F4: "in the
//       crowd" once the join is recorded
//   B2  F4, SIGNED IN BUT NOT JOINED: a second live tab signs in as @stubalice while its join is refused (the fid-join
//       request answered 403 in this tab only) — the signed-in line says nothing about the crowd and "Sign in again with
//       Farcaster to join the anonymous crowd" is offered; with the refusal lifted, that button signs in again, the fid
//       gate joins @stubalice (one zk_anon_fid_members row) and the line says "in the crowd"
import { chromium, devices } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STUB_ACCOUNTS, signForChannel } from "./lib/siwf-stub.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { MUST_NOT_SHIP, VALIDATOR_REFUSES } = require(path.join(ROOT, "validator", "env-contract.js"));
const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const VBASE = (process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
const STUB = (process.env.SIWF_STUB_URL || "").replace(/\/$/, "");
const TPORT = Number(process.env.ANON_PAGE_VALIDATOR_PORT || 4057);
const T = `http://127.0.0.1:${TPORT}`;
/** PUBLIC GO-LIVE: the launcher's shape (PRODLIVE_PUBLIC_LIVE=true -> EXPECT_PUBLIC_LIVE=true), checked against the page below */
const LIVE_SHAPE = process.env.EXPECT_PUBLIC_LIVE === "true";
/** P13: the PAIR's validator database (the launcher sets no VALIDATOR_DB: validator/server.js then uses validator/layers.db) */
const PAIR_DB = process.env.VALIDATOR_DB ? path.resolve(ROOT, process.env.VALIDATOR_DB) : path.join(ROOT, "validator", "layers.db");
/** a 1x1 PNG (P8's media probe, answered locally) */
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const EPOCH_MS = 6 * 3600 * 1000;
const results = [];
const ok = (n, extra) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n + (extra ? " — " + extra : ""));
};
const fail = (n, d) => {
  results.push(["FAIL", n, d]);
  console.log("  FAIL  " + n + (d ? " — " + d : ""));
};
const infra = (n, d) => {
  results.push(["INFRA", n, d]);
  console.log("  INFRA " + n + (d ? " — " + d : ""));
};
async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, typeof extra === "string" ? extra : undefined);
  } catch (e) {
    if (e && e.infra) infra(name, e.message);
    else fail(name, e && e.message ? e.message : String(e));
  }
}
/** PUBLIC GO-LIVE: a check of the TEST universe (posting in a tab): skipped, by name, on the live shape (a live product posts
 *  no test data there); never counted as a pass */
async function checkPreview(name, fn) {
  if (LIVE_SHAPE) {
    results.push(["SKIP", name]);
    console.log("  SKIP  " + name.split(":")[0] + " — the live shape: the test universe is off for posting (the preview run covers it)");
    return;
  }
  return check(name, fn);
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const infraErr = (m) => Object.assign(new Error(m), { infra: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, init) => {
  const r = await fetch(url, { cache: "no-store", redirect: "manual", ...init });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, headers: r.headers, text, json };
};

console.log("\nPublic go-live — the native anon page and the Farcaster Mini App (app " + BASE + ", throwaway validator " + T + ")");
const devProbe = await get(BASE + "/api/dev").catch(() => ({ status: 0 }));
if (devProbe.status !== 403) {
  console.log("  ABORT: /api/dev answered " + devProbe.status + " — this suite runs against the PRODUCTION shape (scripts/run-prod-shape.sh), never the rig");
  process.exit(2);
}
if (!STUB || (await get(STUB + "/__stub/state").catch(() => ({ status: 0 }))).status !== 200) {
  console.log("  ABORT (INFRA): SIWF_STUB_URL does not answer — start the pair with PRODLIVE_SIWF=stub bash scripts/run-prod-shape.sh scripts/accept-anon-page-prod.mjs");
  process.exit(2);
}
const anonHtml = await get(BASE + "/anon").catch(() => ({ status: 0, text: "" }));
if (anonHtml.status !== 200) {
  console.log("  ABORT (INFRA): /anon answered " + anonHtml.status + " (built with --build?)");
  process.exit(2);
}
const treeMatch = /ZK_ANON_POST_TREE\\*"\s*:\s*\\*"([A-Za-z0-9:./_-]+)/.exec(anonHtml.text || "");
const TREE = treeMatch ? treeMatch[1] : "tier-2";
// PUBLIC GO-LIVE: the shape the launcher says, against the shape the page's own device env says (PUBLIC_LIVE=on is forwarded
// only while the server is live) — a run that measured the wrong shape would pass for the wrong reason
const pageLive = /PUBLIC_LIVE\\*"\s*:\s*\\*"on\\*"/.test(anonHtml.text || "");
if (pageLive !== LIVE_SHAPE) {
  console.log("  ABORT (INFRA): EXPECT_PUBLIC_LIVE=" + LIVE_SHAPE + " but the page's device env says the site is " + (pageLive ? "LIVE" : "NOT live") + " — start the pair with the matching PRODLIVE_PUBLIC_LIVE");
  process.exit(2);
}
console.log("  shape: " + (LIVE_SHAPE ? "LIVE (PUBLIC_LIVE=true): P4-P8 skip, P13/P14 expect the live answers" : "preview (PUBLIC_LIVE off)"));
if ((await get(T + "/health").catch(() => ({ status: 0 }))).status !== 0) {
  console.log("  ABORT (INFRA): something already answers on " + T + " — this suite starts its own throwaway validator there and never kills a process it did not start");
  process.exit(2);
}

// ---------------------------------------------------------------- the pure modules (the same rules the app uses)
const { build } = require("esbuild");
const TMP = mkdtempSync(path.join(os.tmpdir(), "layers-anon-page-prod-"));
writeFileSync(path.join(TMP, "entry.ts"), 'export * as man from "@/lib/miniapp/manifest";\nexport * as uni from "@/lib/zk/anon/universe";\n');
await build({ absWorkingDir: ROOT, entryPoints: [path.join(TMP, "entry.ts")], outfile: path.join(TMP, "pure.mjs"), bundle: true, format: "esm", platform: "node", target: ["node20"], tsconfig: path.join(ROOT, "tsconfig.json"), logLevel: "error" });
const { man: M, uni: U } = await import(pathToFileURL(path.join(TMP, "pure.mjs")).href);

// ---------------------------------------------------------------- the throwaway validator (stopped and restarted for B)
const TDB = path.join(TMP, "throwaway.db");
const TLOG = path.join(os.tmpdir(), "layers-anon-page-validator.log");
const blank = Object.fromEntries([...MUST_NOT_SHIP, ...(VALIDATOR_REFUSES || [])].map((n) => [n, ""]));
let tChild = null;
let tOut = "";
function throwawayEnv(extra = {}) {
  const e = {
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
    VALIDATOR_RL_CAPACITY: "3000",
    VALIDATOR_RL_REFILL_PER_SECOND: "50",
    VALIDATOR_NEW_ROOTS_PER_ADDRESS_PER_DAY: "1000",
    APP_URL: BASE,
    ...extra,
  };
  for (const k of ["ZK_ANON_POST_TREE", "ZK_GATE_TIER", "ZK_ANON_FLOOR", "ZK_EPOCH_MS", "ADAPTER_REP"]) delete e[k];
  if (treeMatch) e.ZK_ANON_POST_TREE = TREE;
  return e;
}
function killThrowaway() {
  if (!tChild || tChild.exitCode !== null) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(tChild.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* fall through */
  }
  try {
    tChild.kill("SIGKILL");
  } catch {
    /* gone */
  }
}
async function startThrowaway(extra) {
  killThrowaway();
  for (let i = 0; i < 40 && (await get(T + "/health").catch(() => ({ status: 0 }))).status !== 0; i++) await sleep(250);
  tChild = spawn(process.execPath, [path.join(ROOT, "validator", "server.js")], { env: throwawayEnv(extra), cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  tChild.stdout.on("data", (b) => (tOut += b));
  tChild.stderr.on("data", (b) => (tOut += b));
  for (let i = 0; i < 80; i++) {
    if (tChild.exitCode !== null) break;
    if ((await get(T + "/health").catch(() => ({ status: 0 }))).status === 200) return true;
    await sleep(500);
  }
  return false;
}
let neynarStub = null;
const allContexts = [];
let browser = null;
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

if (!(await startThrowaway({}))) {
  console.log("  ABORT (INFRA): the throwaway validator did not come up on " + T + ":\n" + tOut.split("\n").slice(-12).join("\n"));
  process.exit(2);
}
const ep0 = await get(T + "/zk/epoch?mode=fixture");
if (ep0.json && Number.isFinite(ep0.json.msRemaining) && ep0.json.msRemaining < 15 * 60_000) {
  console.log("  ABORT (INFRA): " + Math.round(ep0.json.msRemaining / 60_000) + " min left in the 6-hour epoch — an anonymous post gets no epoch grace; re-run after the boundary");
  process.exit(2);
}

// ---------------------------------------------------------------- helpers
const { DatabaseSync } = await import("node:sqlite");
const { Identity } = require("@semaphore-protocol/identity");
const withDb = (fn, { readOnly = false } = {}) => {
  const db = new DatabaseSync(TDB, { readOnly });
  try {
    db.exec("PRAGMA busy_timeout = 8000");
    return fn(db);
  } finally {
    db.close();
  }
};
const stub = {
  state: async () => (await get(STUB + "/__stub/state")).json,
  /** act as the Farcaster app on the newest channel */
  async approve(who) {
    const st = await stub.state();
    const ch = st.channels[0];
    if (!ch) throw new Error("the sign-in stub has no channel to approve");
    const { message, signature } = await signForChannel(ch, who, { fid: who.fid });
    const r = await get(STUB + "/v1/channel/authenticate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channelToken: ch.token, message, signature, fid: who.fid, username: who.username, displayName: who.displayName, pfpUrl: who.pfpUrl, bio: "stub account", authMethod: "custody" }) });
    if (r.status !== 200) throw new Error("the sign-in stub refused the approval: " + r.status);
  },
};
const VORIGINS = [...new Set([VBASE, VBASE.replace("localhost", "127.0.0.1"), VBASE.replace("127.0.0.1", "localhost")].map((u) => new URL(u).origin))];
const ALLOWED_ORIGINS = new Set([ORIGIN, ...VORIGINS, new URL(T).origin, new URL(STUB).origin]);
/** a tab on /anon: its validator traffic routed to the throwaway, its device env given the suite's knobs */
async function anonTab(label, { contextOptions = {}, live = false, extraInit = null } = {}) {
  const ctx = await browser.newContext(contextOptions);
  allContexts.push(ctx);
  // P12: an init script of the caller's (the stubbed Farcaster host), before any page script
  if (extraInit) await ctx.addInitScript(extraInit.fn, extraInit.arg);
  let routed = 0;
  for (const origin of VORIGINS) {
    await ctx.route(origin + "/**", (route) => {
      routed++;
      return route.continue({ url: T + route.request().url().slice(origin.length) });
    });
  }
  const knobs = { ZK_ANON_POST_TREE: TREE, ZK_PREFETCH_MS: "0", ZK_JITTER_MIN_MS: "1000", ZK_JITTER_MAX_MS: "3000", ...(live ? { ZK_ANON_UNIVERSE: "live", ZK_MODE: "live" } : {}) };
  await ctx.addInitScript((k) => {
    let held;
    Object.defineProperty(window, "__LAYERS_DEVICE_ENV", {
      configurable: true,
      get() {
        return held;
      },
      set(v) {
        held = v && typeof v === "object" ? Object.assign(v, k) : v;
      },
    });
  }, knobs);
  const page = await ctx.newPage();
  const requests = [];
  ctx.on("request", (r) => requests.push({ at: Date.now(), method: r.method(), url: r.url(), r }));
  await page.goto(BASE + "/anon", { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector('[data-testid="anon-app"][data-boot="ready"]', { timeout: 120_000 }).catch(async () => {
    const boot = await page.locator('[data-testid="anon-app"]').getAttribute("data-boot").catch(() => "(no anon-app)");
    throw new Error(label + ": the device did not start on /anon (data-boot " + boot + ")");
  });
  const info = await page.evaluate(() => window.__layersDevice.info);
  const api = (method, p, body) =>
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
  // leftAt: when the tab left /anon (P8 navigates the desktop tab into the app); P10 judges only what /anon itself asked for
  return { label, ctx, page, requests, info, api, routed: () => routed, leftAt: Infinity };
}
const thirdParty = (requests) => requests.filter((q) => /^https?:/.test(q.url) && !ALLOWED_ORIGINS.has(new URL(q.url).origin)).map((q) => q.method + " " + q.url.split("?")[0]);
/** P14: a GET with a Host header of our choosing (fetch may not set Host; node:http does), never following a redirect;
 *  `edge` adds what Railway's edge adds to every request it forwards (x-forwarded-proto https, x-forwarded-host) */
function rawGet(p, host, edge = false) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + p);
    const headers = { host, accept: "text/html", ...(edge ? { "x-forwarded-proto": "https", "x-forwarded-host": host } : {}) };
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "GET", headers }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location ?? null, xfo: res.headers["x-frame-options"] ?? null, cache: res.headers["cache-control"] ?? null });
    });
    req.on("error", reject);
    req.setTimeout(120_000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}
/**
 * P12: a STUBBED FARCASTER HOST for one context, in the browser only: window.ReactNativeWebView is the bridge the bundled
 * @farcaster/miniapp-sdk 0.3.0 talks to (its endpoint.js webViewEndpoint: postMessage(JSON) out, "FarcasterFrameCallback"
 * events on document in), speaking comlink 4's wire format ({id, type: "GET" | "APPLY", path, argumentList} -> {id, type:
 * "RAW", value}). It answers the context call with a host user (so isInMiniApp says inside) and every other call with
 * nothing, and records each call in window.__hostCalls.
 */
function farcasterHostStub(user) {
  const calls = [];
  Object.defineProperty(window, "__hostCalls", { value: calls, configurable: true });
  window.ReactNativeWebView = {
    postMessage(json) {
      let m = null;
      try {
        m = JSON.parse(json);
      } catch {
        return;
      }
      if (!m || !m.id) return;
      const p = (m.path || []).join(".");
      calls.push({ type: m.type, path: p, args: (m.argumentList || []).map((a) => (a && a.type === "RAW" ? a.value : null)) });
      const value = m.type === "GET" && p === "context" ? { user, client: { clientFid: 9152, added: false } } : undefined;
      setTimeout(() => document.dispatchEvent(new MessageEvent("FarcasterFrameCallback", { data: { id: m.id, type: "RAW", value } })), 0);
    },
  };
}
const policyOf = (h) => Object.fromEntries((h.get("content-security-policy") ?? "").split(";").map((d) => d.trim()).filter(Boolean).map((d) => d.split(/\s+/)).map(([k, ...v]) => [k, v]));
const tabs = [];

try {
  // PUBLIC GO-LIVE (verify): P3 frames this LOOPBACK pair from a page the suite serves as https://farcaster.xyz. Chromium's
  // Local Network Access checks (Playwright 1.62's Chromium) block a public origin from loading localhost outright
  // (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS) before the page's own frame-ancestors policy is ever consulted —
  // a property of the loopback test, not of a deployment (the real /anon is public too). Off for this browser only, so P3
  // measures the policy; the refusals P3 asserts (another origin, /home) are still the browser's CSP refusals.
  browser = await chromium.launch({ args: ["--disable-features=LocalNetworkAccessChecks"] });

  // ================================================================ P1 the page and its headers
  await check("P1. THE PAGE: /anon 200 with fc:miniapp + fc:frame embeds (the spec's rules but https), a policy that lets ONLY the Farcaster web origins frame it and loads nothing from outside, no X-Frame-Options; /anon/p/<unknown> 404 under the same policy; /home and /welcome unframeable", async () => {
    const r = await get(BASE + "/anon");
    assert(r.status === 200, "/anon " + r.status);
    const pol = policyOf(r.headers);
    assert(JSON.stringify(pol["frame-ancestors"]) === JSON.stringify(M.FRAME_ANCESTORS), "frame-ancestors: " + JSON.stringify(pol["frame-ancestors"]));
    assert(r.headers.get("x-frame-options") === null, "X-Frame-Options on /anon: " + r.headers.get("x-frame-options"));
    for (const k of ["script-src", "style-src", "font-src"]) assert(pol[k] && pol[k].every((v) => !/^https?:/.test(v)), k + " names an outside host: " + JSON.stringify(pol[k]));
    // PUBLIC GO-LIVE (F14): images from EXACTLY this origin and the app's media hosts (the Totem session after "Open
    // Totem" runs in this document) — the pinned list, each https, nothing else
    assert(M.anonImageSources().length > 0 && M.anonImageSources().every((s) => /^https:\/\/(\*\.)?[a-z0-9.-]+$/.test(s)), "the media sources: " + JSON.stringify(M.anonImageSources()));
    assert(JSON.stringify(pol["img-src"]) === JSON.stringify(["'self'", "data:", "blob:", ...M.anonImageSources()]), "img-src is not exactly 'self' data: blob: + the media hosts: " + JSON.stringify(pol["img-src"]));
    assert(pol["connect-src"] && pol["connect-src"].every((v) => !/^https?:/.test(v) || [...ALLOWED_ORIGINS, "https://relay.farcaster.xyz", "https://mainnet.optimism.io"].includes(v)), "connect-src names an unexpected host: " + JSON.stringify(pol["connect-src"]));
    const metas = {};
    for (const m of r.text.matchAll(/<meta\s+name="(fc:miniapp|fc:frame)"\s+content="([^"]*)"/g)) metas[m[1]] = JSON.parse(m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'"));
    assert(metas["fc:miniapp"] && metas["fc:frame"], "the embed meta tags are missing");
    const notHttps = (p) => p.filter((x) => !/https address|localhost|IP address/.test(x));
    assert(notHttps(M.validateEmbed(metas["fc:miniapp"])).length === 0, "fc:miniapp: " + M.validateEmbed(metas["fc:miniapp"]).join(" | "));
    assert(notHttps(M.validateEmbed(metas["fc:frame"], { legacy: true })).length === 0, "fc:frame: " + M.validateEmbed(metas["fc:frame"], { legacy: true }).join(" | "));
    assert(metas["fc:miniapp"].button.action.url === ORIGIN + "/anon", "the embed opens " + metas["fc:miniapp"].button.action.url);
    const p404 = await get(BASE + "/anon/p/" + "0".repeat(64));
    assert(p404.status === 404 && JSON.stringify(policyOf(p404.headers)["frame-ancestors"]) === JSON.stringify(M.FRAME_ANCESTORS), "/anon/p/<unknown>: " + p404.status + " " + p404.headers.get("content-security-policy"));
    for (const p of ["/home", "/welcome"]) {
      const h = await get(BASE + p);
      assert(h.headers.get("content-security-policy") === "frame-ancestors 'none'" && h.headers.get("x-frame-options") === "DENY", p + ": " + h.headers.get("content-security-policy") + " / " + h.headers.get("x-frame-options"));
    }
    return "frame-ancestors " + pol["frame-ancestors"].join(" ");
  });

  // ================================================================ P2 the manifest
  await check("P2. THE MANIFEST: /.well-known/farcaster.json is JSON with the spec's fields, homeUrl on this host, unsigned here; the only problems are https/localhost (a loopback pair)", async () => {
    const r = await get(BASE + "/.well-known/farcaster.json");
    assert(r.status === 200 && (r.headers.get("content-type") ?? "").includes("application/json") && r.json, "manifest: " + r.status + " " + r.headers.get("content-type"));
    const host = new URL(BASE).hostname;
    const problems = M.validateManifest(r.json, host).filter((x) => !/https address|localhost|IP address/.test(x));
    assert(problems.length === 0, problems.join(" | "));
    assert(new URL(r.json.miniapp.homeUrl).origin === ORIGIN && r.json.miniapp.homeUrl.endsWith("/anon"), "homeUrl " + r.json.miniapp.homeUrl);
    assert(!r.json.accountAssociation, "the pair serves an association it was never given");
    assert(r.headers.get("access-control-allow-origin") === "*" && r.headers.get("content-security-policy") === null, "headers: " + JSON.stringify([...r.headers]));
    const slash = await get(BASE + "/.well-known/farcaster.json/");
    assert(slash.status === 308 && /\/\.well-known\/farcaster\.json$/.test(slash.headers.get("location") ?? ""), "the trailing-slash form: " + slash.status);
    for (const k of ["icon", "splash", "embed"]) {
      const img = await fetch(BASE + M.MINIAPP_IMAGES[k].path);
      const facts = M.pngFacts(new Uint8Array(await img.arrayBuffer()));
      assert(img.status === 200 && M.imageProblems(k, facts).length === 0, k + ": " + img.status + " " + M.imageProblems(k, facts).join(" | "));
    }
    return "homeUrl " + r.json.miniapp.homeUrl;
  });

  // ================================================================ P3 framing in a real browser
  await check("P3. FRAMING IN A BROWSER: a page on https://farcaster.xyz (served by this suite) frames /anon and it draws (outside a Mini App: no host answers); another origin is refused; /home is refused even to farcaster.xyz", async () => {
    const ctx = await browser.newContext();
    for (const origin of VORIGINS) await ctx.route(origin + "/**", (route) => route.continue({ url: T + route.request().url().slice(origin.length) }));
    const framer = (src) => `<!doctype html><html><body><iframe id="f" src="${src}" width="424" height="695"></iframe></body></html>`;
    await ctx.route("https://farcaster.xyz/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: framer(new URL(r.request().url()).searchParams.get("src")) }));
    await ctx.route("https://framer.invalid/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: framer(BASE + "/anon") }));
    const console_ = [];
    const page = await ctx.newPage();
    page.on("console", (m) => console_.push(m.text()));
    await page.goto("https://farcaster.xyz/miniapp?src=" + encodeURIComponent(BASE + "/anon"), { waitUntil: "load" });
    const frame = () => page.frames().find((f) => f.url().startsWith(BASE + "/anon"));
    for (let i = 0; i < 60 && !frame(); i++) await sleep(250);
    assert(frame(), "the /anon frame never loaded under https://farcaster.xyz");
    await frame().waitForSelector('[data-testid="anon-app"]', { timeout: 90_000 });
    await frame().waitForSelector('[data-testid="anon-app"][data-miniapp="outside"]', { timeout: 15_000 }).catch(async () => {
      throw new Error("framed with no host answering, the page did not settle on 'outside' (data-miniapp " + (await frame().locator('[data-testid="anon-app"]').getAttribute("data-miniapp")) + ")");
    });
    const blocked = async (url, what) => {
      const p = await ctx.newPage();
      const msgs = [];
      p.on("console", (m) => msgs.push(m.text()));
      await p.goto(url, { waitUntil: "load" });
      await sleep(4000);
      let drew = false;
      const childUrls = [];
      for (const f of p.frames()) {
        if (f === p.mainFrame()) continue;
        childUrls.push(f.url());
        drew = drew || (await f.locator('[data-testid="anon-app"], main, nav').count().catch(() => 0)) > 0;
      }
      assert(!drew, what + " drew inside the frame");
      // the refusal itself, not just an empty frame: the browser's frame-ancestors message, or the frame left on the
      // browser's error page (the positive control above drew the same harness under farcaster.xyz)
      const refused = msgs.some((t) => /frame-ancestors|Refused to (frame|display)/i.test(t)) || childUrls.some((u) => u.startsWith("chrome-error:"));
      assert(refused, what + ": no sign the browser refused the frame (console: " + msgs.slice(-3).join(" | ") + "; frames: " + childUrls.join(", ") + ")");
      await p.close();
    };
    await blocked("https://framer.invalid/x", "/anon under https://framer.invalid");
    await blocked("https://farcaster.xyz/miniapp?src=" + encodeURIComponent(BASE + "/home"), "/home under https://farcaster.xyz");
    await ctx.close();
    return "framed by farcaster.xyz: drew; framer.invalid and /home: refused";
  });

  // ================================================================ P13 the share page's universe (ASM-2)
  await check("P13. ASM-2, THE SHARE PAGE'S UNIVERSE: a planted live post's /anon/p/<hash> renders on both shapes; a planted test-universe post's is a 404 on the LIVE shape and the labelled test post on the preview", async () => {
    if (!existsSync(PAIR_DB)) throw infraErr("the pair's validator database is not at " + PAIR_DB + " (set VALIDATOR_DB to the database the pair's validator uses)");
    const nonce = randomBytes(16).toString("hex");
    const hashOf = (s) => createHash("sha256").update(s, "utf8").digest("hex");
    const fx = { hash: hashOf("accept-anon-page-prod/fixture/" + nonce), text: "planted test universe post " + nonce.slice(0, 8) };
    const lv = { hash: hashOf("accept-anon-page-prod/live/" + nonce), text: "planted live post " + nonce.slice(0, 8), network: "0x" + randomBytes(20).toString("hex") };
    const pairDb = (fn) => {
      const db = new DatabaseSync(PAIR_DB);
      try {
        db.exec("PRAGMA busy_timeout = 8000");
        return fn(db);
      } finally {
        db.close();
      }
    };
    const at = Date.now();
    pairDb((db) => {
      const ins = db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES (?, ?, ?, 0, ?, ?, ?, 'relayed')");
      ins.run("fixture", fx.hash, fx.text, at, "0x" + "0".repeat(40), 0);
      ins.run("live", lv.hash, lv.text, at, lv.network, 812399);
    });
    try {
      // the pair's own validator must show the rows this suite wrote — otherwise this is the wrong database (INFRA, never a pass)
      const dl = await get(VBASE + "/zk/anon-cast?mode=live&hash=" + lv.hash);
      const df = await get(VBASE + "/zk/anon-cast?mode=fixture&hash=" + fx.hash);
      if (dl.status !== 200) throw infraErr("the pair's validator does not show the live row planted in " + PAIR_DB + " (answered " + dl.status + "): set VALIDATOR_DB to the pair's database");
      // a validator that hides the test universe itself on a live site (relay's door, ASM-2B/2C) is fine on the LIVE shape;
      // on the preview it must still serve its own test post (the flag-off behaviour unchanged)
      if (df.status !== 200 && !(LIVE_SHAPE && df.status === 404 && df.json)) throw infraErr("the pair's validator does not show the test-universe row planted in " + PAIR_DB + " (answered " + df.status + ")");
      const live = await get(BASE + "/anon/p/" + lv.hash);
      assert(live.status === 200 && live.text.includes('data-mode="live"') && live.text.includes(lv.text), "the live post's share page: " + live.status + " " + (live.text.includes(lv.text) ? "" : "(its text is missing)"));
      const test = await get(BASE + "/anon/p/" + fx.hash);
      if (LIVE_SHAPE) {
        assert(test.status === 404 && !test.text.includes(fx.text) && !test.text.includes('data-testid="anon-share-cast"'), "on the LIVE site a test-universe post's share page answered " + test.status + (test.text.includes(fx.text) ? " WITH the forgeable test post on it" : ""));
        return df.status === 200
          ? "live 200, test-universe 404 (the validator still serves that row: the app's own refusal)"
          : "live 200, test-universe 404 (NOTE: the validator hides the test universe here too, so the app's own refusal is measured by unit-miniapp SPL)";
      }
      assert(test.status === 200 && test.text.includes('data-mode="fixture"') && test.text.includes(fx.text) && test.text.includes("Preview only"), "the preview no longer shows its own test post, labelled (the flag-off behaviour changed): " + test.status);
      return "live 200, test-universe 200 labelled (preview)";
    } finally {
      // PUBLIC GO-LIVE (final verify): the two rows this suite INSERTED by raw SQL are removed again, exactly those two (by
      // hash and planted text). They are this suite's furniture in the rig's own test database, not anyone's post: "hide,
      // never delete" is the product's rule for its data paths. Hiding them was not enough: the pair's database IS the rig's
      // (validator/layers.db), every reset preserves LIVE rows by design (real receipts), so a hidden planted live row stayed
      // for good, and a later suite that reads the whole table met it (accept-fid5 check 2: "anon casts carry more than one
      // fid: 0,812399", in every rig sweep after an anon-page run).
      try {
        const gone = pairDb((db) => {
          const del = db.prepare("DELETE FROM zk_anon_casts WHERE mode = ? AND cast_hash = ? AND text = ?");
          return del.run("fixture", fx.hash, fx.text).changes + del.run("live", lv.hash, lv.text).changes;
        });
        if (gone !== 2) console.log("  NOTE  P13 removed " + gone + " of its 2 planted rows (a reset may have taken the test-universe one first)");
      } catch (e) {
        console.log("  NOTE  P13 could not remove its planted rows (" + e.message + ")");
      }
    }
  });

  // ================================================================ P14 one public address (F6)
  await check("P14. F6, ONE PUBLIC ADDRESS: on the LIVE shape a page on another Host is 308'd to the same path and query on APP_URL (no-store, unframeable); /api/health there and /anon on the pair's own host answer 200; the preview redirects nothing", async () => {
    const OLD = "layers-old-address.up.railway.app";
    // PUBLIC GO-LIVE (final verify): the old-address requests carry Railway's edge headers, as every deployed request does.
    // Next relativizes a middleware redirect whose origin equals ITS OWN request origin (resolve-routes' initUrl: the
    // scheme from x-forwarded-proto, then localhost and the port), and this loopback pair's APP_URL IS that origin without
    // the header, so the right redirect (to APP_URL) and a wrong one built from the request's own URL both came back as the
    // bare "/anon?..." here. With x-forwarded-proto https, as on Railway, Next's origin is https://localhost:<port>: a
    // redirect built from the request's URL is still relativized (and fails below), and only the APP_URL one stays absolute.
    const page = await rawGet("/anon?from=cast&x=1", OLD, true);
    const health = await rawGet("/api/health", OLD, true);
    const own = await rawGet("/anon", new URL(BASE).host);
    assert(health.status === 200 && !health.location, "/api/health on the old address: " + health.status + " " + health.location);
    assert(own.status === 200 && !own.location, "/anon on the pair's own host: " + own.status + " " + own.location);
    if (LIVE_SHAPE) {
      assert(page.status === 308 && page.location === ORIGIN + "/anon?from=cast&x=1", "the old address on the LIVE site: " + page.status + " -> " + page.location);
      assert(page.cache === "no-store" && page.xfo === "DENY", "the redirect's headers: cache-control " + page.cache + ", X-Frame-Options " + page.xfo);
      return OLD + " -> " + page.location;
    }
    assert(page.status === 200 && !page.location, "the PREVIEW redirected the old address (that is the live site's rule only): " + page.status + " -> " + page.location);
    return "preview: no redirect";
  });

  // ================================================================ P4 desktop sign-in
  let D = null;
  const registrationsOf = (rootId, mode = "fixture") => withDb((db) => db.prepare("SELECT active_from_epoch AS active FROM zk_registrations WHERE mode = ? AND root_id = ?").all(mode, rootId), { readOnly: true });
  await checkPreview("P4. DESKTOP SIGN-IN: the disclosure and the QR; the stub approves as @stubalice; signed in; the composer says when this browser can post (the composer's read joined the test crowd once)", async () => {
    D = await anonTab("desktop");
    tabs.push(D);
    await D.page.waitForSelector('[data-testid="anon-signin"][data-state="signed-out"]', { timeout: 60_000 });
    assert((await D.page.locator('[data-testid="anon-siwf-disclosure"]').innerText()).includes("Totem's server sees nothing"), "the disclosure before the first request");
    assert((await D.page.locator('[data-testid="anon-siwf-start"]').getAttribute("data-mode")) === "relay", "a top-level page signs in through the relay");
    await D.page.click('[data-testid="anon-siwf-start"]');
    await D.page.waitForSelector('[data-testid="anon-siwf-qr"]', { timeout: 30_000 });
    await stub.approve(STUB_ACCOUNTS.alice);
    await D.page.waitForSelector('[data-testid="anon-signed-in"]', { timeout: 60_000 });
    const said = await D.page.locator('[data-testid="anon-signed-in"]').innerText();
    assert(said.includes("@stubalice"), "signed in as: " + said);
    await D.page.waitForSelector('[data-testid="anon-composer"]', { timeout: 30_000 });
    await D.page.waitForSelector('[data-testid="anon-unavailable"][data-code="crowd"]', { timeout: 90_000 }).catch(async () => {
      throw new Error("the composer does not say this browser joined the crowd: " + (await D.page.locator('[data-testid="anon-composer"]').innerText()).slice(0, 300));
    });
    const line = await D.page.locator('[data-testid="anon-unavailable"]').innerText();
    assert(/can post anonymously from .+/.test(line), "the join sentence: " + line);
    assert(registrationsOf(D.info.rootId).length === 1, "registrations of this root: " + JSON.stringify(registrationsOf(D.info.rootId)));
    assert((await D.page.locator('[data-testid="anon-post"]').isDisabled()) === true, "Post is offered to a browser outside the crowd");
    // PUBLIC GO-LIVE (F4): "in the crowd" now that the route shows a recorded join (a window to post from)
    await D.page.waitForSelector('[data-testid="anon-signed-in"][data-joined="yes"]', { timeout: 30_000 }).catch(async () => {
      throw new Error("the join is recorded but the signed-in line does not say so: " + (await D.page.locator('[data-testid="anon-signed-in"]').innerText()));
    });
    assert((await D.page.locator('[data-testid="anon-signed-in"]').innerText()).includes("in the crowd"), "the joined words");
    // PUBLIC GO-LIVE (F3, at minimum): the identity still lives only in this tab, so Save / keep is offered at once, before
    // any post (a closed tab would lose the place, and joining again waits for the next window)
    assert((await D.page.evaluate(() => window.__layersDevice.isPersistent())) === false, "the desktop tab was already kept (the offer below would be vacuous)");
    await D.page.waitForSelector('[data-testid="anon-join-keep"]', { timeout: 15_000 }).catch(() => {
      throw new Error("no Save / keep offer although the join is recorded and the identity lives only in this tab");
    });
    const offer = await D.page.locator('[data-testid="anon-join-keep"]').innerText();
    assert(offer.includes("lives only in this tab") && (await D.page.locator('[data-testid="anon-join-save"]').count()) === 1 && (await D.page.locator('[data-testid="anon-join-keep-browser"]').count()) === 1, "the keep offer: " + offer);
    return line.slice(0, 90) + " · keep offered";
  });

  // ================================================================ P5 the post
  let castHash = null;
  let postText = null;
  await checkPreview("P5. DESKTOP POST: in the crowd, Post is offered; proved in the WORKER; exactly ONE web POST; relayed exactly ONCE; relay's posted sentence; the feed shows it", async () => {
    assert(D, "no desktop tab (P4 did not run)");
    const decoys = Array.from({ length: 70 }, (_, i) => new Identity("layers-anonpage-decoy/" + i).commitment.toString(10));
    withDb((db) => {
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
          insRoot.run("root_apdecoy_" + i, 911000000 + i, "ap-decoy-" + i, now);
          insEvent.run("root_apdecoy_" + i, "follow_gained", 1 + i, "ap-decoy:" + i, now);
          insReg.run("fixture", decoys[i], "root_apdecoy_" + i, now, cur, cur + 1);
        }
        insEvent.run(D.info.rootId, "follow_gained", 1000, "ap-desktop-rep", now);
        db.prepare("INSERT INTO zk_epoch_offset (mode, offset_ms) VALUES ('fixture', ?) ON CONFLICT(mode) DO UPDATE SET offset_ms = excluded.offset_ms").run(offset + EPOCH_MS);
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ended already */
        }
        throw e;
      }
    });
    await D.page.waitForSelector('[data-testid="anon-composer"][data-offered="yes"]', { timeout: 120_000 }).catch(async () => {
      throw new Error("Post is not offered in the crowd: " + (await D.page.locator('[data-testid="anon-composer"]').innerText()).slice(0, 300));
    });
    const dest = await D.page.locator('[data-testid="anon-destination"]').innerText();
    assert(dest === U.DESTINATION_LAYERS_PREVIEW, "the destination sentence is not relay's: " + dest);
    postText = "a post from the anon page " + Date.now().toString(36);
    await D.page.fill('[data-testid="anon-input"]', postText);
    const from = Date.now();
    await D.page.click('[data-testid="anon-post"]');
    await D.page.waitForSelector('[data-testid="anon-posted"]', { timeout: 60_000 }).catch(async () => {
      throw new Error("no posted line: " + ((await D.page.locator('[data-testid="anon-error"]').innerText().catch(() => "")) || "(no error shown)"));
    });
    castHash = await D.page.locator('[data-testid="anon-posted"]').getAttribute("data-cast-hash");
    assert(/^[0-9a-f]{64}$/.test(castHash ?? ""), "the cast hash: " + castHash);
    const sentence = await D.page.locator('[data-testid="anon-posted-sentence"]').innerText();
    assert(sentence === U.POSTED_LAYERS_PREVIEW, "the posted sentence is not relay's: " + sentence);
    let row = null;
    for (let i = 0; i < 120 && !row; i++) {
      row = withDb((db) => db.prepare("SELECT cast_hash, status FROM zk_anon_casts WHERE mode = 'fixture' AND text = ?").all(postText), { readOnly: true });
      if (!row.length) row = null;
      else break;
      await sleep(1000);
    }
    assert(row && row.length === 1 && row[0].cast_hash === castHash && row[0].status === "relayed", "the relayed rows for the text: " + JSON.stringify(row));
    const prover = await D.api("POST", "/api/zk", { action: "proverStatus" });
    assert(prover.json?.where === "browser-worker" && prover.json?.lastProve && prover.json.lastProve.at >= from - 1000 && /prove/.test(prover.json.lastProve.op), "not proved in the worker after the press: " + JSON.stringify(prover.json));
    const posts = [];
    // PUBLIC GO-LIVE (verify): the context's "request" event carries the URL the TAB asked for — the pair's validator
    // origin (VORIGINS), which anonTab's route then continues to the throwaway T — so the web POST is matched on every
    // validator origin, T included (the first run counted 0 because it looked for T only)
    for (const q of D.requests.filter((r) => r.at >= from && r.method === "POST" && [T, ...VORIGINS].some((o) => r.url.startsWith(o + "/zk/anon/web")))) {
      try {
        if (JSON.parse(q.r.postDataBuffer().toString("utf8")).envelope.claimKind === "anon-post") posts.push(q);
      } catch {
        /* not an envelope */
      }
    }
    assert(posts.length === 1, "anonymous web POSTs: " + posts.length);
    await D.page.waitForSelector(`[data-testid="anon-feed-item"][data-cast-hash="${castHash}"]`, { timeout: 90_000 }).catch(() => {
      throw new Error("the feed never showed the post");
    });
    assert((await D.page.locator(`[data-testid="anon-feed-item"][data-cast-hash="${castHash}"] [data-testid="anon-feed-text"]`).innerText()) === postText, "the feed's text");
    return "worker " + prover.json.lastProve.op + " " + prover.json.lastProve.ms + " ms; one web POST; one relayed row";
  });

  // ================================================================ P6 report
  await checkPreview("P6. REPORT: on the feed card, a reason -> reached the moderators; one report row for the cast with that reason; no column that could name a reporter", async () => {
    assert(D && castHash, "no post from P5");
    const card = D.page.locator(`[data-testid="anon-feed-item"][data-cast-hash="${castHash}"]`);
    await card.locator('[data-testid="anon-report-open"]').click();
    await card.locator('[data-testid="anon-report-reason"][data-reason="spam"]').click();
    await card.locator('[data-testid="anon-report-done"]').waitFor({ timeout: 30_000 });
    const rows = withDb((db) => db.prepare("SELECT * FROM zk_anon_reports WHERE cast_hash = ?").all(castHash), { readOnly: true });
    assert(rows.length === 1 && rows[0].reason === "spam", "report rows: " + JSON.stringify(rows));
    const cols = Object.keys(rows[0]);
    assert(!cols.some((c) => /root|anchor|reporter|ip|addr|fid|persona|device/i.test(c)), "a column that could name the reporter: " + cols.join(","));
    return "columns " + cols.join(",");
  });

  // ================================================================ P7 share
  await checkPreview("P7. SHARE: asks first (the cost), then links the documented composer intent with this post's /anon/p/<hash>; nothing opens", async () => {
    assert(D && castHash, "no post from P5");
    const card = D.page.locator(`[data-testid="anon-feed-item"][data-cast-hash="${castHash}"]`);
    const before = D.ctx.pages().length;
    await card.locator('[data-testid="anon-share"]').click();
    assert((await card.locator('[data-testid="anon-share-cost"]').innerText()).includes("may guess"), "the cost sentence");
    const href = await card.locator('[data-testid="anon-share-confirm"]').getAttribute("href");
    assert(href === M.farcasterComposeUrl(ORIGIN + "/anon/p/" + castHash), "the composer link: " + href);
    assert(D.ctx.pages().length === before, "a tab opened before Share anyway");
    await card.locator('[data-testid="anon-share-cancel"]').click();
    return href.slice(0, 90) + "…";
  });

  // ================================================================ P8 the click-through
  await checkPreview("P8. CLICK-THROUGH: Open Totem is a SOFT navigation to /welcome?from=anon — the same document, the same root, the public self still @stubalice, and the onboarding resumes after Farcaster (This is you)", async () => {
    assert(D, "no desktop tab (P4 did not run)");
    await D.page.evaluate(() => {
      window.__anonPageMarker = "kept";
    });
    assert((await D.page.locator('[data-testid="anon-open-layers"]').getAttribute("data-mode")) === "soft", "not the soft link");
    D.leftAt = Date.now();
    await D.page.click('[data-testid="anon-open-layers"]');
    await D.page.waitForURL((u) => u.pathname === "/welcome" && u.searchParams.get("from") === "anon", { timeout: 30_000 });
    assert((await D.page.evaluate(() => window.__anonPageMarker)) === "kept", "the document was reloaded (a full load would start a fresh identity)");
    const info = await D.page.evaluate(() => window.__layersDevice.info);
    assert(info.rootId === D.info.rootId, "another root after the click-through: " + info.rootId + " vs " + D.info.rootId);
    const s = await D.api("GET", "/api/fc/siwf");
    assert(s.json?.link?.fname === "stubalice" && s.json.link.disconnected === false, "the public self after the click-through: " + JSON.stringify(s.json?.link));
    await D.page.waitForSelector('[data-testid="onboarding"][data-step="profile"]', { timeout: 60_000 }).catch(async () => {
      const step = await D.page.locator('[data-testid="onboarding"]').getAttribute("data-step").catch(() => "(no onboarding)");
      throw new Error("the onboarding did not resume after Farcaster: data-step " + step);
    });
    // PUBLIC GO-LIVE (F14): this document still carries /anon's policy; the Totem app's media hosts must load in it. Both
    // image hosts are answered HERE by Playwright (nothing leaves the machine); a request the policy refuses never reaches it.
    let imgur = 0;
    let control = 0;
    await D.ctx.route("https://i.imgur.com/**", (r) => {
      imgur++;
      return r.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 });
    });
    await D.ctx.route("https://media-probe.invalid/**", (r) => {
      control++;
      return r.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 });
    });
    const probe = await D.page.evaluate(async () => {
      const violations = [];
      const on = (e) => violations.push(String(e.blockedURI) + " " + String(e.effectiveDirective || e.violatedDirective));
      document.addEventListener("securitypolicyviolation", on);
      const load = (src) =>
        new Promise((res) => {
          const i = new Image();
          i.onload = () => res(i.naturalWidth);
          i.onerror = () => res(-1);
          i.src = src;
        });
      const allowed = await load("https://i.imgur.com/layers-csp-probe.png?" + Date.now());
      const refused = await load("https://media-probe.invalid/layers-csp-control.png?" + Date.now());
      await new Promise((r) => setTimeout(r, 500));
      document.removeEventListener("securitypolicyviolation", on);
      return { allowed, refused, violations };
    });
    assert(probe.refused === -1 && control === 0 && probe.violations.some((v) => v.includes("media-probe.invalid") && v.includes("img-src")), "the control image was not refused by /anon's policy (is this document still under it?): " + JSON.stringify(probe) + " control requests " + control);
    assert(probe.allowed > 0 && imgur === 1 && !probe.violations.some((v) => v.includes("imgur")), "an allowlisted media image did not load after Open Totem: " + JSON.stringify(probe) + " imgur requests " + imgur);
    return "root " + info.rootId.slice(0, 12) + "…, step save; media image loads, control refused";
  });

  // ================================================================ P9 phone
  await check("P9. PHONE (Pixel 5): no sideways scroll; the phone note; Sign in keeps the identity in this browser BEFORE the request, and offers 'Open in the Farcaster app'", async () => {
    const P = await anonTab("phone", { contextOptions: { ...devices["Pixel 5"] } });
    tabs.push(P);
    await P.page.waitForSelector('[data-testid="anon-signin"][data-state="signed-out"]', { timeout: 60_000 });
    const wide = await P.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert(wide.sw <= wide.iw + 1, "the page scrolls sideways at " + wide.iw + " px (" + wide.sw + ")");
    assert((await P.page.locator('[data-testid="anon-phone-note"]').innerText()).includes("keeps your identity in this browser first"), "the phone note");
    // PUBLIC GO-LIVE (PRIV-LIVE-4): "Who sees what" names the internet-address residual, and nothing on the page claims that
    // nobody (Totem included) can match a post to its sender
    await P.page.tap('[data-testid="anon-who-sees"]');
    const residual = await P.page.locator('[data-testid="anon-address-residual"]').innerText();
    assert(residual.includes("from your internet address") && residual.includes("different network"), "the address residual: " + residual);
    const whole = await P.page.locator('[data-testid="anon-app"]').innerText();
    for (const claim of [/not even Totem/i, /Totem included/i, /no one can match a post/i, /can.t tell which person/i, /Nobody learns/i, /launched accounts/i]) assert(!claim.test(whole), "the page still claims " + claim + ": " + (whole.match(claim) ?? [""])[0]);
    assert((await P.page.evaluate(() => window.__layersDevice.isPersistent())) === false, "a fresh phone tab was already kept (the check below would be vacuous)");
    await P.page.tap('[data-testid="anon-siwf-start"]');
    await P.page.waitForSelector('[data-testid="anon-siwf-session"]', { timeout: 30_000 });
    assert((await P.page.evaluate(() => window.__layersDevice.isPersistent())) === true, "the identity was not kept in this browser before leaving for the Farcaster app");
    await P.page.waitForSelector('[data-testid="anon-siwf-open-app"]', { timeout: 30_000 });
    const href = await P.page.locator('[data-testid="anon-siwf-open-app"]').getAttribute("href");
    assert(/^(https:\/\/(www\.|client\.)?(farcaster\.xyz|warpcast\.com)\/|farcaster:)/.test(href ?? ""), "the app link: " + href);
    await P.page.tap('[data-testid="anon-siwf-cancel"]');
    return "kept before the request; app link on " + new URL(href.replace(/^farcaster:/, "https://farcaster/")).hostname;
  });

  // ================================================================ P12 inside the Farcaster app (PRIV-LIVE-5)
  await check("P12. PRIV-LIVE-5, INSIDE THE FARCASTER APP (a stubbed host): before the sign-in and above the composer the page says the host runs it and knows the account; 'Open in browser' asks the host to open this site's /anon", async () => {
    const MA = await anonTab("miniapp", { extraInit: { fn: farcasterHostStub, arg: { fid: 990779, username: "stubhost", displayName: "Stub Host", pfpUrl: null } } });
    tabs.push(MA);
    await MA.page.waitForSelector('[data-testid="anon-app"][data-miniapp="inside"]', { timeout: 30_000 }).catch(async () => {
      throw new Error("the stubbed host was not detected (data-miniapp " + (await MA.page.locator('[data-testid="anon-app"]').getAttribute("data-miniapp")) + "; host calls " + JSON.stringify(await MA.page.evaluate(() => window.__hostCalls ?? null)) + ")");
    });
    await MA.page.waitForSelector('[data-testid="anon-signin"][data-state="signed-out"]', { timeout: 60_000 });
    const note = await MA.page.locator('[data-testid="anon-miniapp-host-note"]').innerText();
    assert(note.includes("runs this page and knows your account") && note.includes("open this page in a browser"), "the host sentence: " + note);
    // before the sign-in (and so above the composer, which follows the sign-in card)
    const before = await MA.page.evaluate(() => {
      const n = document.querySelector('[data-testid="anon-miniapp-host-note"]');
      const s = document.querySelector('[data-testid="anon-signin"]');
      return !!(n && s && n.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert(before, "the host sentence is not before the sign-in");
    assert((await MA.page.locator('[data-testid="anon-siwf-start"]').getAttribute("data-mode")) === "miniapp", "inside the app the sign-in is not the SDK's");
    await MA.page.click('[data-testid="anon-open-browser"]');
    let opened = [];
    for (let i = 0; i < 40 && !opened.length; i++) {
      opened = (await MA.page.evaluate(() => window.__hostCalls)).filter((c) => c.type === "APPLY" && c.path === "openUrl");
      if (!opened.length) await sleep(250);
    }
    assert(opened.length === 1 && opened[0].args[0] === ORIGIN + "/anon", "the host's openUrl calls: " + JSON.stringify(opened));
    const calls = await MA.page.evaluate(() => window.__hostCalls);
    assert(calls.filter((c) => c.type === "APPLY" && c.path === "ready").length === 1, "ready() reached the host " + calls.filter((c) => c.path === "ready").length + " times");
    // and the outside-only words are not shown inside (no phone app switch inside the app)
    assert((await MA.page.locator('[data-testid="anon-phone-note"]').count()) === 0, "the phone note is shown inside the Farcaster app");
    return "openUrl " + opened[0].args[0];
  });

  // ================================================================ P11 inert outside Farcaster
  await check("P11. INERT OUTSIDE FARCASTER: a top-level /anon says outside and signs in through the relay, never the SDK", async () => {
    assert(tabs.length >= 1, "no tab ran");
    const t = tabs.find((x) => x.label === "phone") ?? tabs[0];
    if (t.page.url().includes("/anon")) assert((await t.page.locator('[data-testid="anon-app"]').getAttribute("data-miniapp")) === "outside", "data-miniapp is not outside");
    assert(!tabs.some((x) => x.requests.some((q) => /miniapp-sdk|esm\.sh|unpkg|jsdelivr/.test(q.url))), "a tab fetched an SDK from somewhere");
  });

  // ================================================================ B1 live, armed
  await check("B1. LIVE, ARMED: a live tab signs in (the fid gate joins it), posts from /anon in a live crowd: relay's destination, a REAL proof in the worker, relayed EXACTLY ONCE through the stub under the agent's signer and key, the Farcaster link on the page; no /api/anon request reached the app", async () => {
    const manifest = await get(BASE + "/device/zk/manifest.json");
    if (!(manifest.json && manifest.json.present === true)) throw infraErr("the build has no pinned proving files (/device/zk/manifest.json present:" + JSON.stringify(manifest.json?.present) + "): a live proof needs them (build with .zk-artifacts, or REQUIRE_ZK_ARTIFACTS=1)");
    let startStub;
    try {
      ({ startNeynarAnonStub: startStub } = await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "neynar-anon-stub.mjs")).href));
    } catch (e) {
      throw infraErr("scripts/lib/neynar-anon-stub.mjs could not be loaded: " + e.message);
    }
    const KEY = "anonstub-anonpage-suite-key-0001";
    const SIGNER = "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4e";
    const AGENT_FID = 812399;
    // @stubalice's custody too: B2 joins her live with a second sign-in
    neynarStub = await startStub({ key: KEY, signers: { [SIGNER]: { fid: AGENT_FID } }, custody: { [STUB_ACCOUNTS.bob.address.toLowerCase()]: STUB_ACCOUNTS.bob.fid, [STUB_ACCOUNTS.alice.address.toLowerCase()]: STUB_ACCOUNTS.alice.fid } });
    const up = await startThrowaway({ FC_ANON_FID: String(AGENT_FID), FC_ANON_SIGNER_UUID: SIGNER, FC_ANON_NEYNAR_KEY: KEY, ZK_ANON_RELAY_LIVE: "on", FC_ANON_NEYNAR_BASE_URL: neynarStub.baseUrl, ANON_FID_RPC_URL: neynarStub.rpcUrl, ZK_ANON_RELAY_INTERVAL_MS: "2000", ZK_ANON_RELAY_SPREAD_MS: "0", ZK_ANON_POST_LIVE_CAP: "5" });
    assert(up, "the ARMED throwaway validator refused to start: " + tOut.split("\n").slice(-6).join(" | "));
    const cfg = await get(T + "/zk/anon-post/config?mode=live");
    assert(cfg.json?.liveRelay === true, "the armed throwaway does not report a live relay: " + JSON.stringify(cfg.json).slice(0, 200));
    const L = await anonTab("live", { live: true });
    tabs.push(L);
    await L.page.waitForSelector('[data-testid="anon-signin"][data-state="signed-out"]', { timeout: 60_000 });
    // PUBLIC GO-LIVE (F3 + PRIV-LIVE-1/4): before the click, the page says it keeps the identity first, and the disclosure
    // names the live join instead of "Totem's server sees nothing"
    const keepNote = await L.page.locator('[data-testid="anon-keep-note"]').innerText().catch(() => "(no keep note)");
    assert(keepNote.includes("first keeps it on this device"), "no keep sentence before a sign-in that joins the live crowd: " + keepNote);
    const disc = await L.page.locator('[data-testid="anon-siwf-disclosure"]').innerText();
    assert(disc.includes("records that your Farcaster account joined the crowd") && !disc.includes("Totem's server sees nothing"), "the live disclosure: " + disc);
    await L.page.click('[data-testid="anon-who-sees"]');
    const signinResidual = await L.page.locator('[data-testid="anon-signin-residual"]').innerText();
    assert(signinResidual.includes("Totem records which Farcaster account joined"), "the live sign-in residual in 'Who sees what': " + signinResidual);
    assert((await L.page.evaluate(() => window.__layersDevice.isPersistent())) === false, "a fresh desktop tab was already kept (the keep check below would be vacuous)");
    await L.page.click('[data-testid="anon-siwf-start"]');
    await L.page.waitForSelector('[data-testid="anon-siwf-qr"]', { timeout: 30_000 });
    // F3: kept BEFORE the join request exists (the join is sent only after the approval below)
    assert((await L.page.evaluate(() => window.__layersDevice.isPersistent())) === true, "the desktop identity was not kept before a sign-in that joins the live crowd");
    assert(!L.requests.some((q) => q.url.includes("/zk/anon/fid-join")), "a join request went out before the approval");
    await stub.approve(STUB_ACCOUNTS.bob);
    await L.page.waitForSelector('[data-testid="anon-signed-in"]', { timeout: 60_000 });
    let member = [];
    for (let i = 0; i < 60 && !member.length; i++) {
      member = withDb((db) => db.prepare("SELECT fid, joined_epoch FROM zk_anon_fid_members WHERE mode = 'live' AND fid = ?").all(STUB_ACCOUNTS.bob.fid), { readOnly: true });
      if (!member.length) await sleep(500);
    }
    assert(member.length === 1, "the fid gate did not join @stubbob (" + STUB_ACCOUNTS.bob.fid + ")");
    // F4: "in the crowd" once the join is recorded (the page reads the answer again after the join's retries)
    await L.page.waitForSelector('[data-testid="anon-signed-in"][data-joined="yes"]', { timeout: 90_000 }).catch(async () => {
      throw new Error("joined, but the signed-in line does not say so: " + (await L.page.locator('[data-testid="anon-signed-in"]').innerText()));
    });
    const decoys = Array.from({ length: 70 }, (_, i) => new Identity("layers-anonpage-live-decoy/" + i).commitment.toString(10));
    withDb((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const off = db.prepare("SELECT offset_ms FROM zk_epoch_offset WHERE mode = 'live'").get();
        const offset = off ? off.offset_ms : 0;
        const cur = Math.floor((Date.now() + offset) / EPOCH_MS);
        const ins = db.prepare("INSERT OR IGNORE INTO zk_anon_fid_members (mode, fid, commitment, joined_epoch) VALUES ('live', ?, ?, ?)");
        for (let i = 0; i < 70; i++) ins.run(931000000 + i, decoys[i], cur - 1);
        db.prepare("INSERT INTO zk_epoch_offset (mode, offset_ms) VALUES ('live', ?) ON CONFLICT(mode) DO UPDATE SET offset_ms = excluded.offset_ms").run(offset + EPOCH_MS);
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ended */
        }
        throw e;
      }
    });
    await L.page.waitForSelector('[data-testid="anon-composer"][data-offered="yes"]', { timeout: 180_000 }).catch(async () => {
      throw new Error("Post is not offered in the live crowd: " + (await L.page.locator('[data-testid="anon-composer"]').innerText().catch(() => "(no composer)")).slice(0, 300));
    });
    const dest = await L.page.locator('[data-testid="anon-destination"]').innerText();
    assert(dest === U.DESTINATION_FARCASTER && (await L.page.locator('[data-testid="anon-destination"]').getAttribute("data-destination")) === "farcaster", "the live destination: " + dest);
    const text = "a live post from the anon page " + Date.now().toString(36);
    await L.page.fill('[data-testid="anon-input"]', text);
    const from = Date.now();
    await L.page.click('[data-testid="anon-post"]');
    await L.page.waitForSelector('[data-testid="anon-posted"]', { timeout: 60_000 });
    assert((await L.page.locator('[data-testid="anon-posted-sentence"]').innerText()).startsWith("Sent to @anon."), "the live posted sentence");
    let publishes = [];
    for (let i = 0; i < 180; i++) {
      publishes = neynarStub.calls().filter((c) => c.op === "publish" && c.text === text);
      if (publishes.length) break;
      await sleep(1000);
    }
    await sleep(5000); // a second publish of the same post would land within two more slots
    publishes = neynarStub.calls().filter((c) => c.op === "publish" && c.text === text);
    assert(publishes.length === 1 && publishes[0].keyOk === true && publishes[0].signerKnown === true, "publishes of the text through the stub: " + JSON.stringify(publishes));
    const prover = await L.api("POST", "/api/zk", { action: "proverStatus" });
    assert(prover.json?.where === "browser-worker" && prover.json?.lastProve?.op === "live-prove" && prover.json.lastProve.at >= from - 1000, "not a real proof in the worker: " + JSON.stringify(prover.json?.lastProve));
    await L.page.waitForSelector('[data-testid="anon-cast-link"]', { timeout: 120_000 });
    const link = await L.page.locator('[data-testid="anon-cast-link"]').getAttribute("href");
    assert(link === "https://farcaster.xyz/~/conversations/" + publishes[0].hash, "the Farcaster link: " + link + " (stub hash " + publishes[0].hash + ")");
    assert(!L.requests.some((q) => q.url.startsWith(BASE + "/api/anon")), "the app server got an /api/anon request");
    return "one publish (" + publishes[0].hash + "), real proof " + prover.json.lastProve.ms + " ms";
  });

  // ================================================================ B2 signed in but not joined (F4)
  await check("B2. F4, SIGNED IN BUT NOT JOINED: with the join refused, the signed-in line says nothing about the crowd and 'Sign in again with Farcaster to join the anonymous crowd' is offered; with the refusal lifted it signs in again, the fid gate joins, and the line says 'in the crowd'", async () => {
    assert(neynarStub, "B1 did not arm the throwaway (no Neynar stub): this check needs the armed live validator");
    const cfg = await get(T + "/zk/anon-post/config?mode=live");
    if (cfg.json?.liveRelay !== true) throw infraErr("the throwaway is not armed live (B1 did not get that far): " + JSON.stringify(cfg.json).slice(0, 160));
    const aliceMembers = () => withDb((db) => db.prepare("SELECT fid FROM zk_anon_fid_members WHERE mode = 'live' AND fid = ?").all(STUB_ACCOUNTS.alice.fid), { readOnly: true });
    assert(aliceMembers().length === 0, "@stubalice is already in the live crowd (the refusal below would be vacuous)");
    const N = await anonTab("live-rejoin", { live: true });
    tabs.push(N);
    // the refusal, in THIS tab only: its join request is answered 403 here (registered after anonTab's validator route, so it
    // runs first); lifted, the request falls back to that route and reaches the throwaway
    let refuse = true;
    let joinPosts = 0;
    await N.ctx.route("**/zk/anon/fid-join", (route) => {
      joinPosts++;
      if (refuse) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "refused by the suite (B2)", code: "fid-join-suite" }) });
      return route.fallback();
    });
    await N.page.waitForSelector('[data-testid="anon-signin"][data-state="signed-out"]', { timeout: 60_000 });
    await N.page.click('[data-testid="anon-siwf-start"]');
    await N.page.waitForSelector('[data-testid="anon-siwf-qr"]', { timeout: 30_000 });
    await stub.approve(STUB_ACCOUNTS.alice);
    await N.page.waitForSelector('[data-testid="anon-signed-in"]', { timeout: 60_000 });
    for (let i = 0; i < 60 && joinPosts === 0; i++) await sleep(500);
    assert(joinPosts >= 1, "the page never asked to join (no fid-join request)");
    await N.page.waitForSelector('[data-testid="anon-rejoin"]', { timeout: 90_000 }).catch(async () => {
      throw new Error("signed in with no join, but no 'Sign in again' offer: " + (await N.page.locator('[data-testid="anon-signin"]').innerText()).slice(0, 300));
    });
    const said = await N.page.locator('[data-testid="anon-signed-in"]').innerText();
    assert(said.includes("@stubalice") && (await N.page.locator('[data-testid="anon-signed-in"]').getAttribute("data-joined")) === "no" && !/crowd|joined/i.test(said), "the signed-in line claims a join that was refused: " + said);
    const label = await N.page.locator('[data-testid="anon-rejoin"]').innerText();
    assert(label.includes("Sign in again with Farcaster to join"), "the offer's words: " + label);
    assert(aliceMembers().length === 0, "a refused join left a member row");
    // the way back: the same button signs in again, and this time the join reaches the validator
    refuse = false;
    await N.page.click('[data-testid="anon-rejoin"]');
    await N.page.waitForSelector('[data-testid="anon-siwf-qr"]', { timeout: 30_000 });
    await stub.approve(STUB_ACCOUNTS.alice);
    let members = [];
    for (let i = 0; i < 90 && !members.length; i++) {
      members = aliceMembers();
      if (!members.length) await sleep(500);
    }
    assert(members.length === 1, "the second sign-in did not join @stubalice (" + STUB_ACCOUNTS.alice.fid + ")");
    await N.page.waitForSelector('[data-testid="anon-signed-in"][data-joined="yes"]', { timeout: 90_000 }).catch(async () => {
      throw new Error("joined on the second sign-in, but the line does not say so: " + (await N.page.locator('[data-testid="anon-signed-in"]').innerText()));
    });
    assert((await N.page.locator('[data-testid="anon-rejoin"]').count()) === 0, "the 'Sign in again' offer is still shown after the join");
    return "refused -> offer; second sign-in -> joined (" + joinPosts + " join requests)";
  });

  // ================================================================ P10 zero third-party
  await check("P10. ZERO THIRD-PARTY REQUESTS from every /anon tab: only this site, its validator (routed to the throwaway) and the sign-in stub", async () => {
    assert(tabs.length >= 2, "fewer than two /anon tabs ran (the check would be vacuous): " + tabs.map((t) => t.label).join(","));
    const onAnon = (t) => t.requests.filter((q) => q.at < t.leftAt);
    const total = tabs.reduce((n, t) => n + onAnon(t).length, 0);
    assert(total > 20 && tabs.every((t) => t.requests.some((q) => q.url.startsWith(BASE + "/device/device.js"))), "too few requests observed to mean anything (" + total + ")");
    const bad = tabs.flatMap((t) => thirdParty(onAnon(t)).map((x) => t.label + ": " + x));
    assert(bad.length === 0, "third-party requests: " + [...new Set(bad)].slice(0, 8).join(" | "));
    return total + " requests over " + tabs.map((t) => t.label).join(", ");
  });
} finally {
  for (const c of allContexts) await c.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (neynarStub) await neynarStub.close().catch(() => {});
}

const pass = results.filter((r) => r[0] === "PASS").length;
const failN = results.filter((r) => r[0] === "FAIL").length;
const infraN = results.filter((r) => r[0] === "INFRA").length;
const skipN = results.filter((r) => r[0] === "SKIP").length;
console.log(`\naccept-anon-page-prod: ${pass} passed, ${failN} failed, ${infraN} infra — ${LIVE_SHAPE ? "LIVE shape" : "preview shape"}${skipN ? `, ${skipN} skipped (the test universe on a live site)` : ""}`);
process.exit(failN ? 1 : infraN ? 2 : 0);
