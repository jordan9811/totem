// PERSONA LAUNCH P1 (SIWF) — SIGN IN WITH FARCASTER ON THE PRODUCTION SHAPE, against the loopback stub.
// research/spec-siwf-passkey-first-2026-10-08.txt TESTS C, P1-P12 (+ P13, the Save moment's app half).
//
// The production-shaped pair (NODE_ENV=production, no dev hooks: every app page runs the visitor's in-browser device)
// started by scripts/run-prod-shape.sh under PRODLIVE_SIWF=stub, which starts scripts/lib/siwf-stub.mjs on loopback
// and hands the APP (only) FC_SIWF_RELAY_URL / FC_SIWF_RPC_URL = the stub: the device then runs the LIVE code path —
// relay channel, Bearer status polls, eth_call — against the stub, from the browser, cross-origin (the stub answers
// CORS like the real relay must). Nothing reaches Farcaster or Optimism.
//   P1  the pair is public (/api/dev 403); a booted device reports available, live, with the stub as relay and RPC
//   P2  a direct POST /api/fc/siwf to the SERVER answers 404 device_only and the app log gains no line
//   P3  profile A: the card → the stub's newest channel → the suite signs as the wallet (custody of fid 990777) →
//       the device verifies and seals; the profile shows "that's me" (picture held: an off-allowlist host is never
//       fetched), the switcher row carries "Farcaster · read-only" and opens the profile instead of switching, and
//       Settings › Account says "@stubalice · that's me"
//   P4  the stub saw, for A's sign-in: one channel POST (expirationTime present, at most 10 min), Bearer status
//       reads, one eth_chainId, one idOf, zero keyDataOf — and ZERO violations
//   P5  the auth-address variant (profile C): verified with one keyDataOf and zero idOf
//   P6  profile D: a wrong-fid signature is refused and D's accountLinks row is unchanged byte for byte; with the RPC
//       forced down the check is "could not check" and the SAME approval verifies once it answers
//   P7  no fid, fname, signer address or stub token in any NEW plaintext of any validator table; A's accountLinks row
//       is 1,024 bytes, and so is B's (B never signed in): uniform presence, measured
//   P8  profile B sees no link, no badge and no Farcaster row in its switcher
//   P9  persistence: A saves a passkey (virtual authenticator, PRF) and reloads → the link survives; A's 24 words
//       restored in a fresh profile → the link and the public self come back
//   P10 a page script that sets FC_SIWF_RELAY_URL to https://example.invalid before boot → available:false bad_config,
//       and neither the stub nor example.invalid sees a request
//   P11 NEYNAR AS A SWITCH (§42): "Show my Farcaster posts here" is RETIRED (a relay lookup of the visitor's own fname
//       names them to Totem's server): no button, the profile's network line instead, live=1 answers 409 names_you, and
//       with the Neynar stub on (PRODLIVE_FC_READ=stub, any PRODLIVE_FC_SOURCES) zero lookups of the fname reach it
//   P12 the app and validator logs written during this run carry no fid, fname, signer address or token
//   P13 the Save moment in the app (profile F, tab-only): no card before; creating a persona brings the card; its
//       passkey save (virtual authenticator) hides the unsaved strip and Settings › Account says kept
//   PERSONA LAUNCH P1 — the review's UX fixes:
//   P3b (UX-8) Settings › Account lists A's public self as a read-only row (a link to /stubalice with the chip), never a
//       persona-switch button (control: the ordinary personas are), and never fetches its off-allowlist picture
//   P14 (UX-6) at 375 px the unsaved strip shows "Unlock" (a soft link to /device#unlock) beside Save — the same probe
//       sees "More options" hidden there (non-vacuous: it can see `hidden`); tapping it keeps the tab's identity and
//       lands on /device with the unlock card in view
//   P15 (UX-15, UX-16) the strip's keep note says "beyond this browser" (no "anywhere", no 24 words); its Save while
//       the ways-in list is unreadable says "paused" and the virtual authenticator gains NO passkey; readable again,
//       the same button saves exactly one and the strip goes
//   P16 (UX-7) the landing's sentence is on this pair (FC_SIWF on) and ABSENT on a throwaway app (:3023, dead
//       validator) started with FC_SIWF=off, whose landing otherwise renders
//
//   PRODLIVE_SIWF=stub bash scripts/run-prod-shape.sh scripts/accept-siwf-prod.mjs   (npm run test:siwf-prod)
//   add PRODLIVE_FC_READ=stub for P11's press half
// ABORTS (exit 2): GET /api/dev must answer 403 (the production shape) and SIWF_STUB_URL must answer /__stub/state.
import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STUB_ACCOUNTS, signForChannel } from "./lib/siwf-stub.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
const STUB = (process.env.SIWF_STUB_URL || "").replace(/\/$/, "");
const NEYNAR_STUB = (process.env.NEYNAR_STUB_URL || "").replace(/\/$/, "");
const DB_PATH = process.env.LAYERS_DB || path.join(ROOT, "validator/layers.db");
const LOGS = [path.join(process.env.TEMP || "/tmp", "layers-app.log"), path.join(process.env.TEMP || "/tmp", "layers-validator.log")];
const stamp = Date.now().toString(36).slice(-5);

const results = [];
const ok = (n, extra) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n + (extra ? " — " + extra : ""));
};
const fail = (n, d) => {
  results.push(["FAIL", n, d]);
  console.log("  FAIL  " + n + (d ? " — " + d : ""));
};
async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, typeof extra === "string" ? extra : undefined);
  } catch (e) {
    fail(name, e && e.message ? e.message : String(e));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url, init) => {
  const r = await fetch(url, { cache: "no-store", ...init });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: r.status, text, json };
};
const stub = {
  state: async () => (await getJson(STUB + "/__stub/state")).json,
  reset: () => getJson(STUB + "/__stub/reset", { method: "POST" }),
  force: (f) => getJson(STUB + "/__stub/force", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) }),
  /** act as the wallet on the newest channel */
  async approve(who, { fid = who.fid, authMethod = "custody", as = STUB_ACCOUNTS.alice } = {}) {
    const st = await stub.state();
    const ch = st.channels[0];
    if (!ch) throw new Error("the stub has no channel to approve");
    const { message, signature } = await signForChannel(ch, who, { fid });
    const r = await getJson(STUB + "/v1/channel/authenticate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelToken: ch.token, message, signature, fid, username: as.username, displayName: as.displayName, pfpUrl: as.pfpUrl, bio: "stub account", authMethod }),
    });
    if (r.status !== 200) throw new Error("the stub refused the approval: " + r.status);
    return ch;
  },
};

// ---------------------------------------------------------------- needles
const NEEDLES = new Set(["siwf-stub-token-", "990777", "990778", "stubalice", "stubbob"]);
for (const a of Object.values(STUB_ACCOUNTS)) {
  NEEDLES.add(a.address);
  NEEDLES.add(a.address.toLowerCase());
  NEEDLES.add(a.address.slice(2).toLowerCase());
}
function dbRows() {
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
  const d = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const out = [];
    for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name))
      for (const row of d.prepare(`SELECT * FROM "${t}"`).all()) out.push({ t, row, s: JSON.stringify(row).replace(/[0-9a-fA-F]{40,}/g, "<hex>") });
    return out;
  } finally {
    d.close();
  }
}
const linksRowOf = (anchor) => dbRows().find((r) => r.t === "adapter_state" && r.row.namespace === "accountLinks" && r.row.anchor === anchor)?.row ?? null;
const ctBytes = (value) => {
  const v = JSON.parse(value);
  if (!v || v.v !== 1 || typeof v.ct !== "string" || v.ns !== "accountLinks") throw new Error("an accountLinks row is not ciphertext-shaped");
  return v.ct.length / 2;
};
const logSizes = () => LOGS.map((f) => (existsSync(f) ? statSync(f).size : 0));
const logSince = (i, from) => (existsSync(LOGS[i]) ? readFileSync(LOGS[i]).subarray(from).toString("latin1") : "");

// ---------------------------------------------------------------- preflight: the shape
const dev = await getJson(BASE + "/api/dev").catch(() => null);
if (!dev || dev.status !== 403) {
  console.log("  ABORT: GET /api/dev answered " + (dev ? dev.status : "nothing") + " — this suite runs on the production-shaped pair (403): PRODLIVE_SIWF=stub bash scripts/run-prod-shape.sh scripts/accept-siwf-prod.mjs");
  process.exit(2);
}
const stubState = STUB ? await stub.state().catch(() => null) : null;
if (!stubState || stubState.ok !== true) {
  console.log("  ABORT: SIWF_STUB_URL " + (STUB || "(unset)") + " does not answer /__stub/state — start the pair with PRODLIVE_SIWF=stub");
  process.exit(2);
}
await stub.reset();
const STUB_HOST = new URL(STUB).host;
console.log("\nSIWF PROD — Sign in with Farcaster on the production shape (app " + BASE + ", stub " + STUB + (NEYNAR_STUB ? ", neynar stub " + NEYNAR_STUB : "") + ")");
const baselineHits = new Set(dbRows().filter((r) => [...NEEDLES].some((n) => r.s.includes(n))).map((r) => r.s));
const logStart = logSizes();

const browser = await chromium.launch();
const consoleLines = [];
async function device(label, { initScript, viewport } = {}) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  if (initScript) await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   [" + label + " pageerror] " + String(e).slice(0, 160)));
  page.on("console", (m) => consoleLines.push("[" + label + "] " + m.text()));
  const network = [];
  page.on("request", (r) => network.push(r.url()));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
  });
  const d = { label, ctx, page, network, info: null };
  /** PERSONA LAUNCH P1 (review UX-16): the passkeys the virtual authenticator holds */
  d.passkeys = async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials.length;
  d.load = async (p = "/home") => {
    await page.goto(BASE + p, { waitUntil: "load", timeout: 120_000 });
    d.info = await page.evaluate(
      () =>
        new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error("the device did not boot within 90 s")), 90_000);
          const wait = () => (window.__layersDevice ? window.__layersDevice.ready.then((i) => (clearTimeout(t), res(i)), rej) : setTimeout(wait, 100));
          wait();
        })
    );
    return d.info;
  };
  d.api = (method, p, body) =>
    page.evaluate(
      async ({ method, p, body }) => {
        const r = await fetch(p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await r.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        return { status: r.status, json, text };
      },
      { method, p, body }
    );
  d.call = (expr, arg) => page.evaluate(expr, arg);
  /** the /device card: start, act as the wallet, wait for the card to settle */
  d.signIn = async (who, opts = {}) => {
    await page.getByTestId("link-farcaster").click();
    await page.getByTestId("siwf-qr").waitFor({ timeout: 30_000 });
    await stub.approve(who, opts);
  };
  d.close = () => ctx.close().catch(() => {});
  return d;
}

// ---------------------------------------------------------------- P2 first (before any browser activity on the app)
await check("P2 a direct POST /api/fc/siwf to the SERVER answers 404 device_only, and the app log gains no line", async () => {
  await sleep(1000);
  const before = logSizes()[0];
  const r = await getJson(BASE + "/api/fc/siwf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) });
  if (r.status !== 404 || r.json?.code !== "device_only") throw new Error("the server answered " + r.status + " " + r.text.slice(0, 160));
  const g = await getJson(BASE + "/api/fc/siwf");
  if (g.status !== 404 || g.json?.code !== "device_only") throw new Error("GET on the server answered " + g.status);
  await sleep(1000);
  const grew = logSince(0, before);
  if (grew.trim()) throw new Error("the app log gained: " + grew.trim().split("\n").slice(0, 2).join(" | ").slice(0, 200));
  const st = await stub.state();
  if (st.requests.length) throw new Error("the stub saw " + st.requests.length + " request(s) from a server-side refusal");
});

let A = null;
await check("P1 the pair is public (/api/dev 403); a booted device reports Sign in with Farcaster available, live, with the stub as relay and RPC", async () => {
  A = await device("A");
  await A.load("/home");
  await A.call(() => window.__layersDevice.persist()); // kept in this browser: full loads below restore the same identity
  const st = await A.api("GET", "/api/fc/siwf");
  if (st.json?.available !== true || st.json.mode !== "live" || st.json.relayHost !== STUB_HOST || st.json.rpcHost !== STUB_HOST) throw new Error("status: " + st.text.slice(0, 200));
  if (st.json.link !== null || st.json.session !== null) throw new Error("a fresh device already has a sign-in");
  return "relay + rpc = " + STUB_HOST;
});

let countsA = null;
let selfHandle = null;
await check("P3 profile A: the stub's channel, signed as the wallet → verified; the profile says that's me (picture held), the switcher row is 'Farcaster · read-only' and opens the profile, Settings › Account says '@stubalice · that's me'", async () => {
  if (!A) throw new Error("no profile A");
  await A.load("/device");
  await A.signIn(STUB_ACCOUNTS.alice);
  await A.page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 45_000 });
  countsA = (await stub.state()).counts;
  const card = await A.page.getByTestId("siwf-status").innerText();
  if (!/@stubalice/.test(card) || !/that.s me/.test(card)) throw new Error("the card: " + card);
  const link = (await A.api("GET", "/api/fc/siwf")).json?.link;
  selfHandle = link?.handle;
  if (selfHandle !== "stubalice") throw new Error("the public self's handle: " + selfHandle);
  // the profile: the badge, read-only, the picture held (its host is off the allowlist and must not be fetched)
  const netBefore = A.network.length;
  await A.load("/" + selfHandle);
  await A.page.getByTestId("thats-me-badge").first().waitFor({ timeout: 45_000 });
  const badge = await A.page.getByTestId("thats-me-badge").first().innerText();
  if (!/that.s me/.test(badge)) throw new Error("the badge says " + badge);
  const open = await A.page.getByTestId("open-on-farcaster").getAttribute("href");
  if (open !== "https://farcaster.xyz/stubalice") throw new Error("Open on farcaster.xyz → " + open);
  if (await A.page.getByTestId("edit-profile").count()) throw new Error("the public self's profile offers Edit profile");
  if (!(await A.page.getByTestId("media-click-to-load").count())) throw new Error("the off-allowlist picture is not held back");
  if (A.network.slice(netBefore).some((u) => u.includes("pfp.example.invalid"))) throw new Error("the held picture was fetched");
  // the switcher: the chip, and a click opens the profile without switching the acting persona
  await A.load("/home");
  const actingBefore = (await A.api("GET", "/api/persona/chrome")).json?.activePersonaId;
  await A.page.getByTestId("account-switcher-button").first().click();
  const row = A.page.locator('[data-testid="persona-row-stubalice"][data-public-self="true"]');
  await row.waitFor({ timeout: 20_000 });
  const chip = await row.getByTestId("public-self-chip").innerText();
  if (!/Farcaster · read-only/.test(chip)) throw new Error("the chip says " + chip);
  await row.click();
  await A.page.waitForURL((u) => new URL(u).pathname === "/stubalice", { timeout: 20_000 });
  const actingAfter = (await A.api("GET", "/api/persona/chrome")).json?.activePersonaId;
  if (!actingBefore || actingAfter !== actingBefore) throw new Error("clicking the public self switched the acting persona");
  // Settings › Account
  await A.load("/settings/account");
  const rowFc = A.page.locator('[data-testid="account-farcaster"][data-state="signed-in"]');
  await rowFc.waitFor({ timeout: 45_000 });
  const t = await rowFc.innerText();
  if (!/@stubalice · that.s me/.test(t)) throw new Error("the Account row says " + t);
});

await check("P3b Settings › Account (review UX-8): the public self is a read-only row — a link to its profile with 'Farcaster · read-only' — never a persona-switch button; the ordinary personas still are; its off-allowlist picture is never fetched", async () => {
  if (!A || !selfHandle) throw new Error("no public self (P3 failed)");
  const netBefore = A.network.length;
  await A.load("/settings/account");
  const row = A.page.getByTestId("account-public-self-" + selfHandle);
  await row.waitFor({ timeout: 45_000 });
  const chip = await row.getByTestId("public-self-chip").innerText();
  if (!/Farcaster · read-only/.test(chip)) throw new Error("the chip says " + chip);
  if ((await row.getAttribute("href")) !== "/" + selfHandle) throw new Error("the row opens " + (await row.getAttribute("href")));
  // control first: the list rendered, and an ordinary persona IS a switch button (else the absence below is vacuous)
  const switches = await A.page.locator('[data-testid^="persona-switch-"]').count();
  if (switches < 1) throw new Error("no persona-switch button at all — the list did not render");
  if (await A.page.getByTestId("persona-switch-" + selfHandle).count()) throw new Error("the public self is still a persona-switch button (its click is refused PUBLIC_SELF_READ_ONLY)");
  // the held-media rule: no request for the off-allowlist picture, no <img> pointing at it
  await sleep(1500);
  if (A.network.slice(netBefore).some((u) => u.includes("pfp.example.invalid"))) throw new Error("Settings › Account fetched the off-allowlist picture");
  if (await A.page.locator('img[src*="pfp.example.invalid"]').count()) throw new Error("an <img> points at the off-allowlist picture");
  return switches + " switch button(s); the public self is a read-only row";
});

await check("P4 the stub saw, for A's sign-in: one channel POST (expiration ≤ 10 min), Bearer status reads, one eth_chainId, one idOf, zero keyDataOf — and zero violations", async () => {
  if (!countsA) throw new Error("no sign-in counts (P3 failed)");
  const c = countsA;
  if (c.channelPosts !== 1 || c.statusGets < 1 || c.chainId !== 1 || c.idOf !== 1 || c.keyDataOf !== 0 || c.otherCalls !== 0) throw new Error("counts: " + JSON.stringify(c));
  const st = await stub.state();
  if (st.violations.length) throw new Error(st.violations.length + " violation(s): " + st.violations.slice(0, 3).map((v) => v.kind + " " + v.path).join(" | "));
  return JSON.stringify(c);
});

await check("P5 the auth-address variant (profile C): verified with one keyDataOf and zero idOf", async () => {
  const C = await device("C");
  try {
    await C.load("/device");
    const before = (await stub.state()).counts;
    await C.signIn(STUB_ACCOUNTS.aliceAuth, { authMethod: "authAddress" });
    await C.page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 45_000 });
    const after = (await stub.state()).counts;
    const kd = after.keyDataOf - before.keyDataOf;
    const io = after.idOf - before.idOf;
    if (kd !== 1 || io !== 0) throw new Error(`keyDataOf ${kd}, idOf ${io}`);
    const link = (await C.api("GET", "/api/fc/siwf")).json?.link;
    if (link?.authMethod !== "authAddress") throw new Error("the link: " + JSON.stringify(link));
  } finally {
    await C.close();
  }
});

await check("P6 profile D: a wrong-fid signature is refused and D's accountLinks row is unchanged byte for byte; with the RPC down the check is retryable and the SAME approval verifies once it answers", async () => {
  const D = await device("D");
  try {
    await D.load("/device");
    const anchor = D.info.anchor;
    const rowBefore = linksRowOf(anchor);
    if (!rowBefore) throw new Error("D has no accountLinks row before signing in (uniform presence)");
    await D.signIn(STUB_ACCOUNTS.bob, { fid: 990777 });
    await D.page.locator('[data-testid="siwf-error"][data-code="siwf_fid_mismatch"]').waitFor({ timeout: 45_000 });
    const rowAfter = linksRowOf(anchor);
    if (!rowAfter || rowAfter.value !== rowBefore.value) throw new Error("a refused sign-in changed D's accountLinks row");
    if ((await D.api("GET", "/api/fc/siwf")).json?.link !== null) throw new Error("a refused sign-in left a link");
    // the RPC down: the device's own two attempts both fail once, the next poll succeeds
    const before = (await stub.state()).requests.length;
    await D.page.getByTestId("link-farcaster").click();
    await D.page.getByTestId("siwf-qr").waitFor({ timeout: 30_000 });
    await stub.force({ rpcDown: 2 });
    await stub.approve(STUB_ACCOUNTS.alice);
    await D.page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
    const st = await stub.state();
    const rpc = st.requests.slice(before).filter((r) => r.kind === "rpc");
    if (rpc.length < 3) throw new Error("the forced-down RPC was not exercised (" + rpc.length + " rpc requests)");
    const rowSealed = linksRowOf(anchor);
    if (!rowSealed || rowSealed.value === rowBefore.value) throw new Error("the recovered sign-in did not seal D's row");
    if (ctBytes(rowSealed.value) !== 1024) throw new Error("D's sealed row is not 1,024 bytes");
  } finally {
    await D.close();
  }
});

let B = null;
await check("P7 no fid, fname, signer address or stub token in any NEW validator plaintext; A's accountLinks row and B's (never signed in) are both exactly 1,024 bytes", async () => {
  B = await device("B");
  await B.load("/home");
  await sleep(1500);
  const hits = [];
  for (const r of dbRows()) {
    if (baselineHits.has(r.s)) continue;
    for (const n of NEEDLES) if (r.s.includes(n)) hits.push(r.t + " carries " + n.slice(0, 12));
  }
  if (hits.length) throw new Error([...new Set(hits)].slice(0, 5).join(" | "));
  const ra = A ? linksRowOf(A.info.anchor) : null;
  const rb = linksRowOf(B.info.anchor);
  if (!ra || !rb) throw new Error("missing accountLinks row: A " + !!ra + ", B " + !!rb);
  const a = ctBytes(ra.value);
  const b = ctBytes(rb.value);
  if (a !== 1024 || b !== 1024) throw new Error(`A ${a} bytes, B ${b} bytes`);
  return "A 1024 = B 1024";
});

await check("P8 profile B sees no link, no badge and no Farcaster row in its switcher", async () => {
  if (!B) throw new Error("no profile B");
  const st = (await B.api("GET", "/api/fc/siwf")).json;
  if (st?.available !== true || st.link !== null) throw new Error("B's status: " + JSON.stringify(st).slice(0, 160));
  const per = (await B.api("GET", "/api/personas")).json?.personas ?? [];
  if (!per.length || per.some((p) => p.publicSelf)) throw new Error("B's roster: " + JSON.stringify(per.map((p) => [p.handle, !!p.publicSelf])));
  await B.page.getByTestId("account-switcher-button").first().click();
  await B.page.getByTestId("account-switcher").waitFor({ timeout: 20_000 });
  await B.page.locator('[data-testid^="persona-row-"]').first().waitFor({ timeout: 20_000 });
  if (await B.page.locator('[data-testid="account-switcher"] [data-public-self="true"]').count()) throw new Error("B's switcher has a Farcaster row");
  if (await B.page.getByTestId("thats-me-badge").count()) throw new Error("B sees a badge");
});

await check("P9 persistence: A's passkey (PRF) save, then a reload → the link survives; A's 24 words in a fresh profile → the link and the public self come back", async () => {
  if (!A) throw new Error("no profile A");
  await A.load("/home");
  const saved = await A.call(async () => {
    try {
      return { ok: true, v: await window.__layersDevice.custody.savePasskey() };
    } catch (e) {
      return { ok: false, e: String(e && e.message) };
    }
  });
  if (!saved.ok) throw new Error("the passkey save: " + saved.e);
  await A.load("/home");
  if ((await A.api("GET", "/api/fc/siwf")).json?.link?.fname !== "stubalice") throw new Error("the link did not survive the reload");
  const words = await A.call(() => window.__layersDevice.custody.exportPhrase());
  if (typeof words !== "string" || words.trim().split(/\s+/).length !== 24) throw new Error("no 24 words");
  const E = await device("E");
  try {
    await E.load("/device");
    const r = await E.call(async (w) => {
      try {
        await window.__layersDevice.custody.importPhrase(w);
        return { ok: true };
      } catch (e) {
        return { ok: false, e: String(e && e.message) };
      }
    }, words);
    if (!r.ok) throw new Error("the restore: " + r.e);
    const link = (await E.api("GET", "/api/fc/siwf")).json?.link;
    if (link?.fname !== "stubalice" || link.disconnected) throw new Error("the restored link: " + JSON.stringify(link));
    const per = (await E.api("GET", "/api/personas")).json?.personas ?? [];
    if (!per.some((p) => p.publicSelf === true && p.handle === "stubalice")) throw new Error("the public self did not come back: " + JSON.stringify(per.map((p) => p.handle)));
  } finally {
    await E.close();
  }
});

await check("P10 a page script that points FC_SIWF_RELAY_URL at https://example.invalid before boot → available:false bad_config, and neither the stub nor example.invalid sees a request", async () => {
  const before = (await stub.state()).requests.length;
  const S = await device("P10", {
    initScript: () => {
      let v;
      Object.defineProperty(window, "__LAYERS_DEVICE_ENV", {
        configurable: true,
        get: () => v,
        set: (x) => {
          v = { ...(x || {}), FC_SIWF_RELAY_URL: "https://example.invalid" };
        },
      });
    },
  });
  try {
    await S.load("/home");
    const st = await S.api("GET", "/api/fc/siwf");
    if (st.json?.available !== false || st.json.code !== "bad_config") throw new Error("status: " + st.text.slice(0, 200));
    const s = await S.api("POST", "/api/fc/siwf", { action: "start" });
    if (s.status !== 503 || s.json?.code !== "bad_config") throw new Error("start: " + s.status + " " + s.text.slice(0, 120));
    await sleep(1000);
    if (S.network.some((u) => u.includes("example.invalid"))) throw new Error("a request went to example.invalid");
    const after = (await stub.state()).requests.length;
    if (after !== before) throw new Error((after - before) + " request(s) reached the stub");
  } finally {
    await S.close();
  }
});

// NEYNAR AS A SWITCH (SECURITY-POSTURE.md §42), THE HARD RULE: "Show my Farcaster posts here" was a relay lookup of the
// visitor's OWN fname (naming their account to Totem's server). It is retired: no button on any shape, live=1 answers 409
// names_you, and the relay never sees the fname, even with the relay armed and every switch asking for Neynar.
await check("P11 the retired 'Show my Farcaster posts here': no button, the network line instead, live=1 → 409 names_you, and ZERO by_username lookups of the fname", async () => {
  if (!A || !selfHandle) throw new Error("no public self (P3 failed)");
  await A.load("/" + selfHandle);
  await A.page.getByTestId("thats-me-badge").first().waitFor({ timeout: 45_000 });
  await A.page.getByTestId("own-posts-network").first().waitFor({ timeout: 30_000 });
  if ((await A.page.getByTestId("show-my-posts").count()) > 0) throw new Error("the retired button is shown");
  const relayOn = await A.call(() => (window.__LAYERS_DEVICE_ENV || {}).FC_READ_RELAY === "on");
  if (relayOn && !NEYNAR_STUB) throw new Error("the read relay is on but NEYNAR_STUB_URL is not set — run under PRODLIVE_FC_READ=stub");
  const lookups = async () => (NEYNAR_STUB ? ((await getJson(NEYNAR_STUB + "/__stub/state")).json?.requests ?? []).filter((r) => /by_username|user\/search|feed\/user\/casts/.test(r.route ?? r.path ?? "") && /stubalice/.test(r.query ?? "")).length : 0);
  const before = await lookups();
  const live = await A.api("GET", "/api/profile?handle=" + encodeURIComponent(selfHandle) + "&live=1");
  if (live.status !== 409 || live.json?.code !== "names_you") throw new Error("live=1 answered " + live.status + " " + JSON.stringify(live.json).slice(0, 160) + " (expected 409 names_you)");
  await sleep(2000);
  const after = await lookups();
  if (after !== 0 || before !== 0) throw new Error((after || before) + " relay lookup(s) of the visitor's own fname");
  return `relay ${relayOn ? "armed on the stub" : "off"}: no button, the network line, live=1 409 names_you, 0 lookups of the fname`;
});

await check("P12 the app and validator logs written during this run carry no fid, fname, signer address or stub token; nor does any console line", async () => {
  const hits = [];
  LOGS.forEach((f, i) => {
    const t = logSince(i, logStart[i]);
    for (const n of NEEDLES) if (t.includes(n)) hits.push(path.basename(f) + " carries " + n.slice(0, 12));
  });
  for (const l of consoleLines) for (const n of NEEDLES) if (l.includes(n)) hits.push("console: " + l.slice(0, 80));
  if (hits.length) throw new Error([...new Set(hits)].slice(0, 5).join(" | "));
});

await check("P13 the Save moment in the app (profile F, tab-only): no card before; a new persona brings the card; its passkey save hides the unsaved strip and Settings › Account says kept", async () => {
  const F = await device("F");
  try {
    await F.load("/home");
    await F.page.getByTestId("identity-unsaved").waitFor({ timeout: 30_000 });
    if (await F.page.getByTestId("save-moment").count()) throw new Error("the card is shown before any moment");
    await F.page.getByTestId("account-switcher-button").first().click();
    await F.page.getByTestId("create-persona-button").first().click();
    await F.page.getByTestId("persona-name-input").first().fill("Moment " + stamp);
    await F.page.getByTestId("persona-handle-input").first().fill("moment_" + stamp);
    await F.page.getByTestId("persona-create-submit").first().click();
    await F.page.getByTestId("save-moment").waitFor({ state: "visible", timeout: 30_000 });
    await F.page.getByTestId("save-moment-passkey").click();
    await F.page.getByTestId("identity-unsaved").waitFor({ state: "detached", timeout: 45_000 });
    if (await F.page.getByTestId("save-moment").count()) throw new Error("the card stayed after the save");
    await F.load("/settings/account");
    const saved = F.page.getByTestId("account-device-saved");
    await saved.waitFor({ timeout: 45_000 });
    for (let i = 0; i < 40 && !/kept on this device/.test(await saved.innerText()); i++) await sleep(500);
    if (!/kept on this device/.test(await saved.innerText())) throw new Error("the Account row says " + (await saved.innerText()));
  } finally {
    await F.close();
  }
});

// ---------------------------------------------------------------- P14-P16: the review's UX fixes (PERSONA LAUNCH P1)
/** what the page lays out for a test id: display, size, right edge and classes (null = not in the DOM) */
const layoutOf = (d, testid) =>
  d.page.evaluate((t) => {
    const el = document.querySelector(`[data-testid="${t}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { display: cs.display, visibility: cs.visibility, w: r.width, h: r.height, right: r.right, cls: String(el.className) };
  }, testid);

await check("P14 phone width, 375 px (review UX-6): the unsaved strip shows 'Unlock' — a soft link to /device#unlock — beside Save; the same probe sees 'More options' hidden (non-vacuous); tapping Unlock keeps this tab's identity and lands on the unlock card, in view", async () => {
  const Ph = await device("phone", { viewport: { width: 375, height: 812 } });
  try {
    await Ph.load("/home");
    await Ph.page.getByTestId("identity-unsaved").waitFor({ timeout: 30_000 });
    // the case the finding is about: Save is offered (the passkey label exists), so 'More options' is hidden below sm
    await Ph.page.getByTestId("identity-save-passkey").waitFor({ state: "visible", timeout: 30_000 });
    const unlock = await layoutOf(Ph, "identity-unlock");
    const more = await layoutOf(Ph, "identity-more-options");
    if (!unlock || unlock.display === "none" || unlock.visibility === "hidden" || unlock.w <= 0 || unlock.h <= 0) throw new Error("Unlock is not visible at 375 px: " + JSON.stringify(unlock));
    if (/(^|\s)hidden(\s|$)/.test(unlock.cls)) throw new Error("Unlock carries the `hidden` class: " + unlock.cls);
    if (!more || more.display !== "none") throw new Error("the probe's control: 'More options' is not hidden at 375 px (" + JSON.stringify(more) + ") — the probe is not shown to see `hidden`");
    if (unlock.right > 375.5) throw new Error("Unlock runs off the right edge (" + unlock.right + " px)");
    if (!(await Ph.page.getByTestId("identity-unlock").isVisible())) throw new Error("Playwright does not see Unlock as visible");
    const href = await Ph.page.getByTestId("identity-unlock").getAttribute("href");
    if (href !== "/device#unlock") throw new Error("Unlock goes to " + href);
    // the tap: a SOFT navigation — the identity in this tab survives — to the unlock card, brought into view
    const anchorBefore = await Ph.call(() => window.__layersDevice.info.anchor);
    await Ph.page.getByTestId("identity-unlock").click();
    await Ph.page.waitForURL((u) => new URL(u).pathname === "/device", { timeout: 30_000 });
    await Ph.page.getByTestId("unlock").waitFor({ state: "visible", timeout: 60_000 });
    const anchorAfter = await Ph.call(() => window.__layersDevice?.info?.anchor ?? null);
    if (!anchorBefore || anchorAfter !== anchorBefore) throw new Error("the tap replaced this tab's identity (a full load?)");
    if (new URL(Ph.page.url()).hash !== "#unlock") throw new Error("landed on " + Ph.page.url());
    let box = null;
    for (let i = 0; i < 20; i++) {
      box = await Ph.page.evaluate(() => {
        const r = document.getElementById("unlock")?.getBoundingClientRect();
        return r ? { top: r.top, vh: window.innerHeight, sy: window.scrollY } : null;
      });
      if (box && box.top >= -1 && box.top < box.vh) break;
      await sleep(250);
    }
    if (!box || box.top < -1 || box.top >= box.vh) throw new Error("the unlock card is not in view: " + JSON.stringify(box));
    return `Unlock ${Math.round(unlock.w)}×${Math.round(unlock.h)} px; More options hidden; the card at ${Math.round(box.top)} px (scrollY ${Math.round(box.sy)})`;
  } finally {
    await Ph.close();
  }
});

await check("P15 the strip's words and its Save gate (review UX-15, UX-16): the keep note says 'beyond this browser'; Save while the ways-in list is unreadable says 'paused' and adds NO passkey; readable again, the same button saves exactly one and the strip goes", async () => {
  const Gt = await device("gate");
  const methods = (u) => {
    try {
      return new URL(u).pathname.endsWith("/custody/methods");
    } catch {
      return false;
    }
  };
  const abort = (route) => route.abort("failed");
  try {
    await Gt.load("/home");
    await Gt.page.getByTestId("identity-unsaved").waitFor({ timeout: 30_000 });
    const note = (await Gt.page.getByTestId("identity-keep").getAttribute("title")) ?? "";
    if (!/beyond this browser/.test(note) || /anywhere|24 words/i.test(note)) throw new Error("the keep note says: " + note);
    const before = await Gt.passkeys();
    await Gt.page.route(methods, abort);
    await Gt.page.getByTestId("identity-save-passkey").click();
    const err = Gt.page.getByTestId("identity-keep-error");
    await err.waitFor({ state: "visible", timeout: 30_000 });
    const said = await err.innerText();
    if (!/paused/i.test(said)) throw new Error("the refusal says " + said);
    if (/PRF|wrap path|social login|validator|custody/i.test(said)) throw new Error("the refusal is not in plain words: " + said);
    const afterRefusal = await Gt.passkeys();
    if (afterRefusal !== before) throw new Error("a refused save registered " + (afterRefusal - before) + " passkey(s) — an orphan OS passkey per tap");
    // positive control: readable again, the same button saves exactly one passkey and the strip goes
    await Gt.page.unroute(methods, abort);
    await Gt.page.getByTestId("identity-save-passkey").click();
    await Gt.page.getByTestId("identity-unsaved").waitFor({ state: "detached", timeout: 45_000 });
    const after = await Gt.passkeys();
    if (after !== before + 1) throw new Error("the allowed save left " + after + " passkey(s), expected " + (before + 1));
    return "refused: +0 passkeys; allowed: +1";
  } finally {
    await Gt.close();
  }
});

await check("P16 the landing's Sign in with Farcaster sentence (review UX-7): on this pair (FC_SIWF on) it is there; on a throwaway app started with FC_SIWF=off it is ABSENT while the landing otherwise renders", async () => {
  const here = await getJson(BASE + "/");
  if (here.status !== 200 || !/data-testid="landing-siwf"/.test(here.text)) throw new Error("the control: this pair's landing (" + here.status + ") lacks the sentence");
  const require = createRequire(import.meta.url);
  const { MUST_NOT_SHIP } = require("../validator/env-contract.js");
  const off = Object.fromEntries(MUST_NOT_SHIP.map((n) => [n, ""]));
  const dir = mkdtempSync(path.join(tmpdir(), "layers-siwf-landing-"));
  const PORT = 3023;
  const env = {
    ...process.env,
    ...off,
    NODE_ENV: "production",
    LAYERS_REQUIRE_SIG: "true",
    CUSTODY_FIXTURE_PROVIDER: "",
    ZK_DEV_HOOKS: "",
    LAYERS_MAINTENANCE: "",
    LAYERS_APP_PORT: String(PORT),
    VALIDATOR_URL: "http://127.0.0.1:4999",
    NEXT_PUBLIC_VALIDATOR_URL: "http://127.0.0.1:4999",
    APP_URL: "http://127.0.0.1:" + PORT,
    KEYSTORE_DIR: dir,
    FC_SIWF: "off",
    FC_SIWF_RELAY_URL: "",
    FC_SIWF_RPC_URL: "",
  };
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (out += b));
  let exited = null;
  child.on("exit", (code) => (exited = code));
  try {
    let up = false;
    for (let i = 0; i < 120 && exited === null; i++) {
      await sleep(500);
      const h = await getJson(`http://127.0.0.1:${PORT}/api/health`).catch(() => null);
      if (h && h.status === 200) {
        up = true;
        break;
      }
    }
    if (!up) throw new Error("the throwaway app did not start (exit " + exited + "): " + out.slice(-300));
    const r = await getJson(`http://127.0.0.1:${PORT}/`);
    if (r.status !== 200 || !/data-testid="door-app"/.test(r.text)) throw new Error("the throwaway's landing did not render (" + r.status + ")");
    if (/data-testid="landing-siwf"/.test(r.text)) throw new Error("with FC_SIWF=off the landing still promises Sign in with Farcaster");
    return "on here; absent under FC_SIWF=off (:" + PORT + ")";
  } finally {
    child.kill("SIGKILL");
    await sleep(500);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* held briefly */
    }
  }
});

// the stub is the only witness of what the devices sent it: any violation at all fails the run
const finalStub = await stub.state();
if (finalStub.violations.length) fail("STUB the stub recorded violations", finalStub.violations.slice(0, 5).map((v) => v.kind + " " + v.path).join(" | "));
await A?.close();
await B?.close();
await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} SIWF prod checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
