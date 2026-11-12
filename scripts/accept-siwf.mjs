// PERSONA LAUNCH P1 (SIWF) — SIGN IN WITH FARCASTER + PASSKEY FIRST, ON THE RIG (fixture mode), end to end.
// research/spec-siwf-passkey-first-2026-10-08.txt TESTS B, R1-R9.
//
// WHERE EACH CHECK RUNS, AND WHY: on the rig the app pages are the SERVER's (the (main) layout mounts the browser
// device only on a public deployment), so the visitor's device exists in exactly one place — the /device page, which
// boots the in-tab device with the rig's flags (FC_SIWF "fixture": an in-process relay and chain, no request leaves
// the tab). The rig's SERVER also answers /api/fc/siwf in fixture mode (ZK_DEV_HOOKS=true, no owner secret), with its
// own keystore and vault, which is what the HTTP-only checks drive. The app pages that render the public self (the
// switcher chip, the Account row, the profile badge) exist with a device only on the production shape:
// scripts/accept-siwf-prod.mjs P3 asserts them there.
//   S   (setup) resetSeed: the server holds no public self and no link (siwfProbe 0 / 0 / none)
//   R6  REFUSAL KNOBS (server): the positive control verifies first; after a disconnect, wrongFid, wrongSigner,
//       badNonce, badDomain, expired and unregisteredAuthAddress each end refused with their code, the accountLinks
//       rows unchanged byte for byte and no new persona; a relay hiccup keeps the session open ("still trying");
//       rpcDown → siwf_chain_unavailable (retryable) → the SAME approval verifies once the chain answers
//   R4  ONE MAIN (server): a second sign-in while signed in → siwf_one_main; DISCONNECT needs the typed word; on the
//       tombstone fixture-other is still refused; fixture-main re-arms IN PLACE (same persona)
//   R3  READ-ONLY PUBLIC SELF (server half): with a cookie naming the public self, /api/actions/cast, react, follow
//       and /api/seed-persona, /api/identity/fork answer 403 PUBLIC_SELF_READ_ONLY (positive control first: the same
//       calls for an ordinary persona are not refused)
//   R1  /device: the passkey card first, Sign in with Farcaster second, the fixture social card third (accept-cu2
//       check 9's anchor), the 24 words under a COLLAPSED Advanced; the disclosure is shown before any request
//   R2  start → the QR and "Open in the Farcaster app" (an allowlisted Farcaster link); the status read carries no
//       channel token; the tab answered it (no request for /api/fc/siwf reached the network)
//   R3  (tab half) fixtureApprove → the card says "@fixture-main · that's me"; the device lists the public self;
//       its profile view carries publicSelf facts and no fid; seed-persona, act-as and fork refuse it (403
//       PUBLIC_SELF_READ_ONLY) while an ordinary persona passes the same calls
//   R5  THE STEM RULE in the device: "unrelated_x…" is created; "fixture_main2" → 409 handle_stem
//   R9  THE SAVE MOMENT: no card before the sign-in; after it, the card offers the passkey (virtual authenticator);
//       the save flips the strip to "Saved — 1 way" (the rig's /device stands in for the app's first post, which
//       accept-siwf-prod P13 covers)
//   R10 (review UX-17) the DISCONNECT field is found by role + its accessible name; R2 also asserts the request's status
//       line is a polite live region
//   R11 (review UX-13) the linked-accounts record unreadable from the first load (the validator path aborted): the card
//       shows its error AND "Try again"; a retry while still unreadable keeps the error; once readable it recovers
//   R12 (review UX-16) the ways-in list unreadable: the Save card's passkey button says "paused" and the virtual
//       authenticator holds ZERO passkeys after the tap; readable again, the same button saves exactly one (control).
//       The card's "Already saved? Unlock" goes to /device#unlock (UX-6)
//   R13 (review UX-15) no consumer save sentence (SaveMoment, IdentityNudge, AccountPane, comments stripped) says
//       "24 words" or promises "anywhere" — positive control: the same stripping still finds /device's Advanced text
//   R7  LEAK GREP: the fixture fids, fnames, signer addresses and channel tokens appear in no NEW plaintext of any
//       validator table, no app or validator log line written during this run, no browser console line; each
//       device's accountLinks row exists, is ciphertext and is exactly 1,024 bytes
//   R8  resetSeed purges the fixture-siwf persona and the link (siwfProbe 0 / 0 / none, GET link null); both reset
//       lists (lib/device/boot.ts reloadIdentity, app/api/dev resetSeed) carry resetAccountLinksCache
//
//   bash att-run.sh scripts/accept-siwf.mjs     (npm run test:siwf; rig: app :3001 + validator :4001)
// ABORTS (exit 2) on the wrong shape: GET /api/dev must answer 200 and the server's GET /api/fc/siwf must say
// available in fixture mode (an empty-world rig or the owner service is not this suite's shape).
import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInfraError } from "./lib-health.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { keccak256, toBytes } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || path.join(ROOT, "validator/layers.db");
const LOGS = [path.join(process.env.TEMP || "/tmp", "layers-app.log"), path.join(process.env.TEMP || "/tmp", "layers-validator.log")];
const stamp = Date.now().toString(36).slice(-5);

const results = [];
const ok = (n, extra) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n + (extra ? " — " + extra : ""));
};
const fail = (n, d) => {
  const infra = isInfraError(d);
  results.push([infra ? "INFRA" : "FAIL", n, d]);
  console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : ""));
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
const answers = [];
async function api(method, url, body, cookie) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  answers.push(text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: r.status, json, text };
}
/** retried on a non-2xx (the mock adapters fail 2% of calls by design); `done` is the CONTENT that must be there */
async function retry(fn, done = (r) => r.status >= 200 && r.status < 300, attempts = 5) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fn();
      if (done(r)) return r;
      last = new Error("status " + r.status + " " + (r.json?.code ?? "") + " " + String(r.json?.error ?? "").slice(0, 160));
    } catch (e) {
      last = e;
    }
    await sleep(300 * (i + 1));
  }
  throw last;
}
const siwf = (body) => api("POST", "/api/fc/siwf", body);
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const probe = async () => (await retry(() => dev("siwfProbe"))).json;

// ---------------------------------------------------------------- the needles (what must never be plaintext)
const FIXTURE = { main: { fid: 9200001, fname: "fixture-main" }, other: { fid: 9200002, fname: "fixture-other" } };
// the fixture keys exactly as lib/fc/siwf/flow.ts derives them (public constants by construction)
const custodyOf = (fid) => privateKeyToAccount(keccak256(toBytes("layers-fixture-siwf-custody/" + fid))).address;
const authOf = (fid) => privateKeyToAccount(keccak256(toBytes("layers-fixture-siwf-auth/" + fid))).address;
const NEEDLES = new Set(["fixture-siwf-token-"]);
for (const who of [FIXTURE.main, FIXTURE.other]) {
  NEEDLES.add(String(who.fid));
  NEEDLES.add(who.fname);
  for (const a of [custodyOf(who.fid), authOf(who.fid)]) {
    NEEDLES.add(a);
    NEEDLES.add(a.toLowerCase());
    NEEDLES.add(a.slice(2).toLowerCase());
  }
}

/** every row of every validator table, with long hex runs (ciphertext, nonces, hashes) elided: a 7-digit fid would
 *  otherwise match inside megabytes of hex by chance (the pd2 lesson) */
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
function accountLinksRows() {
  return dbRows()
    .filter((r) => r.t === "adapter_state" && r.row.namespace === "accountLinks")
    .map((r) => ({ anchor: r.row.anchor, key: r.row.key, value: r.row.value }));
}
const rowsKey = (rows) => JSON.stringify(rows.map((r) => [r.anchor, r.key, r.value]).sort());
const ctBytes = (value) => {
  const v = JSON.parse(value);
  if (!v || v.v !== 1 || typeof v.ct !== "string" || v.ns !== "accountLinks") throw new Error("an accountLinks row is not ciphertext-shaped: " + String(value).slice(0, 120));
  return v.ct.length / 2;
};
const logSizes = () => LOGS.map((f) => (existsSync(f) ? statSync(f).size : 0));
function logTail(f, from) {
  if (!existsSync(f)) return "";
  const buf = readFileSync(f);
  return buf.subarray(Math.min(from, buf.length)).toString("latin1");
}

// ---------------------------------------------------------------- preflight: the shape
const devGet = await fetch(BASE + "/api/dev").catch(() => null);
if (!devGet || devGet.status !== 200) {
  console.log("  ABORT: GET /api/dev answered " + (devGet ? devGet.status : "nothing") + " at " + BASE + " — this suite runs on the rig (200)");
  process.exit(2);
}
const shape = await api("GET", "/api/fc/siwf");
if (shape.status !== 200 || shape.json?.available !== true || shape.json?.mode !== "fixture") {
  console.log("  ABORT: the server's GET /api/fc/siwf is not available in fixture mode (" + shape.status + " " + shape.text.slice(0, 160) + ") — an empty-world rig or the owner service is not this suite's shape");
  process.exit(2);
}
console.log("\nSIWF — Sign in with Farcaster + passkey first, on the rig (app " + BASE + ", validator " + VBASE + ")");
const baselineHits = new Set(dbRows().filter((r) => [...NEEDLES].some((n) => r.s.includes(n))).map((r) => r.s));
const logStart = logSizes();
const consoleLines = [];

// ---------------------------------------------------------------- server half: one sign-in, driven over HTTP
/** start → fixtureApprove(knobs) → poll until the session settles; the last view */
async function serverSignIn(knobs = {}, { maxPolls = 12 } = {}) {
  const st = await retry(() => siwf({ action: "start" }), (r) => r.status === 200 || r.status === 409 || r.status === 503);
  if (st.status !== 200) return { start: st, views: [] };
  const id = st.json.session.id;
  await retry(() => siwf({ action: "fixtureApprove", sessionId: id, ...knobs }));
  const views = [];
  for (let i = 0; i < maxPolls; i++) {
    const p = await retry(() => siwf({ action: "poll", sessionId: id }));
    views.push(p.json);
    const stage = p.json.session?.stage;
    if (stage === "verified" || stage === "refused" || stage === "expired") break;
    await sleep(200);
  }
  return { start: st, views, last: views.at(-1) };
}
const linkNow = async () => (await retry(() => api("GET", "/api/fc/siwf"))).json.link;

await check("S  setup: resetSeed — the server holds no public self, no fixture-siwf persona and no link", async () => {
  await retry(() => dev("resetSeed"));
  const p = await probe();
  if (p.publicSelfPersonas !== 0 || p.fixtureSiwfPersonas !== 0 || p.link !== "none") throw new Error("after resetSeed: " + JSON.stringify(p));
});

let serverPersonaId = null;
await check("R6 REFUSAL KNOBS: positive control first; then each knob refused with its code, the accountLinks rows unchanged and no new persona; a relay hiccup keeps the request open; rpcDown is retryable and the same approval verifies", async () => {
  // the positive control: an untouched approval verifies (without it every refusal below is vacuous)
  const okRun = await serverSignIn();
  if (okRun.last?.session?.stage !== "verified" || okRun.last?.link?.fname !== FIXTURE.main.fname) throw new Error("the positive control did not verify: " + JSON.stringify(okRun.last?.session ?? okRun.start.json).slice(0, 200));
  serverPersonaId = okRun.last.link.personaId;
  const d = await retry(() => siwf({ action: "disconnect", confirm: "DISCONNECT" }));
  if (d.json.link?.disconnected !== true) throw new Error("disconnect did not tombstone the link");
  const knobs = [
    ["wrongFid", { wrongFid: true }, "siwf_fid_mismatch"],
    ["wrongSigner", { wrongSigner: true }, "siwf_signature"],
    ["badNonce", { badNonce: true }, "siwf_message"],
    ["badDomain", { badDomain: true }, "siwf_message"],
    ["expired", { expired: true }, "siwf_message"],
    ["unregisteredAuthAddress", { unregisteredAuthAddress: true }, "siwf_fid_mismatch"],
  ];
  const seen = [];
  for (const [label, k, code] of knobs) {
    const rowsBefore = rowsKey(accountLinksRows());
    const pBefore = await probe();
    const r = await serverSignIn(k);
    if (r.start.status !== 200) throw new Error(label + ": start answered " + r.start.status + " " + r.start.text.slice(0, 120));
    if (r.last?.session?.stage !== "refused" || r.last.session.code !== code) throw new Error(`${label}: expected refused ${code}, got ${JSON.stringify(r.last?.session)}`);
    if (rowsKey(accountLinksRows()) !== rowsBefore) throw new Error(label + ": the accountLinks rows changed");
    const pAfter = await probe();
    if (pAfter.publicSelfPersonas !== pBefore.publicSelfPersonas || pAfter.link !== "disconnected") throw new Error(label + ": " + JSON.stringify(pAfter));
    seen.push(label);
  }
  // the auth-address positive control (keyDataOf keyType 2, state 1): it is a sign-in as fixture-main, so it re-arms
  const auth = await serverSignIn({ authAddress: true });
  if (auth.last?.session?.stage !== "verified" || auth.last.link?.authMethod !== "authAddress") throw new Error("the auth-address control: " + JSON.stringify(auth.last?.session));
  await retry(() => siwf({ action: "disconnect", confirm: "DISCONNECT" }));
  // a relay status read that fails is "still trying", not a refusal
  const hic = await serverSignIn({ relayDown: 1 }, { maxPolls: 1 });
  const hv = hic.views[0]?.session;
  if (!hv || hv.stage !== "pending" || hv.code !== "siwf_relay") throw new Error("a relay hiccup: " + JSON.stringify(hv));
  const after = await retry(() => siwf({ action: "poll", sessionId: hv.id }));
  if (after.json.session?.stage !== "verified") throw new Error("the request did not complete after the hiccup: " + JSON.stringify(after.json.session));
  await retry(() => siwf({ action: "disconnect", confirm: "DISCONNECT" }));
  // rpcDown: retryable, then the SAME approval verifies; exactly one new seal
  const sealsBefore = accountLinksRows().length;
  const down = await serverSignIn({ rpcDown: 2 });
  const codes = down.views.map((v) => v.session?.code);
  if (!codes.includes("siwf_chain_unavailable")) throw new Error("rpcDown never said siwf_chain_unavailable: " + JSON.stringify(codes));
  if (down.last?.session?.stage !== "verified") throw new Error("rpcDown did not recover: " + JSON.stringify(down.last?.session));
  if (accountLinksRows().length !== sealsBefore) throw new Error("the accountLinks row count changed (expected one row per device, updated in place)");
  return seen.length + " knobs refused; auth address, relay hiccup and rpcDown recovered";
});

await check("R4 ONE MAIN: a second sign-in while signed in is refused; DISCONNECT needs the typed word; on the tombstone fixture-other is still refused; fixture-main re-arms in place", async () => {
  const live = await linkNow();
  if (!live || live.disconnected || live.fname !== FIXTURE.main.fname) throw new Error("setup: fixture-main is not signed in: " + JSON.stringify(live));
  const second = await siwf({ action: "start" });
  if (second.status !== 409 || second.json?.code !== "siwf_one_main") throw new Error("a second sign-in while signed in: " + second.status + " " + second.json?.code);
  const wrong = await siwf({ action: "disconnect", confirm: "disconnect" });
  if (wrong.status !== 400 || wrong.json?.code !== "confirm_required") throw new Error("an untyped disconnect: " + wrong.status);
  if ((await linkNow()).disconnected) throw new Error("an untyped disconnect disconnected");
  await retry(() => siwf({ action: "disconnect", confirm: "DISCONNECT" }));
  const tomb = await linkNow();
  if (!tomb?.disconnected || tomb.personaId !== live.personaId) throw new Error("not a tombstone of the same persona: " + JSON.stringify(tomb));
  const pk = await probe();
  if (pk.publicSelfPersonas !== 1 || pk.link !== "disconnected") throw new Error("the persona was not kept: " + JSON.stringify(pk));
  const other = await serverSignIn({ fid: FIXTURE.other.fid });
  if (other.last?.session?.stage !== "refused" || other.last.session.code !== "siwf_one_main") throw new Error("fixture-other on the tombstone: " + JSON.stringify(other.last?.session));
  const back = await serverSignIn();
  if (back.last?.session?.stage !== "verified") throw new Error("fixture-main did not re-arm: " + JSON.stringify(back.last?.session));
  const re = await linkNow();
  if (re.disconnected || re.personaId !== live.personaId) throw new Error("re-armed onto another persona: " + JSON.stringify(re));
  if ((await probe()).publicSelfPersonas !== 1) throw new Error("re-arming minted another persona");
  serverPersonaId = re.personaId;
});

await check("R3 READ-ONLY PUBLIC SELF (server): cast, react, follow, seed-persona and fork refuse the public self with 403 PUBLIC_SELF_READ_ONLY; the same calls for an ordinary persona are not refused", async () => {
  if (!serverPersonaId) throw new Error("no public self on the server (R4/R6 did not sign in)");
  const asSelf = "layers_seed_persona=" + serverPersonaId;
  const refused = (r, what) => {
    if (r.status !== 403 || r.json?.code !== "PUBLIC_SELF_READ_ONLY") throw new Error(what + ": expected 403 PUBLIC_SELF_READ_ONLY, got " + r.status + " " + (r.json?.code ?? "") + " " + String(r.json?.error ?? "").slice(0, 100));
  };
  // positive controls: the default (ordinary) persona
  const cast = await retry(() => api("POST", "/api/actions/cast", { text: "siwf r3 control " + stamp }));
  const hash = cast.json?.hash;
  if (!hash) throw new Error("the control cast answered no hash: " + cast.text.slice(0, 160));
  await retry(() => api("POST", "/api/actions/react", { hash, kind: "like", on: true }));
  const fCtl = await api("POST", "/api/actions/follow", { targetFid: 3, follow: true });
  if (fCtl.json?.code === "PUBLIC_SELF_READ_ONLY") throw new Error("the ordinary persona's follow was refused as a public self");
  const sCtl = await retry(() => api("POST", "/api/seed-persona", { personaId: "persona_viewer_main" }));
  if (sCtl.status !== 200) throw new Error("the ordinary persona's switch: " + sCtl.status);
  // the public self
  refused(await api("POST", "/api/actions/cast", { text: "siwf r3 as self " + stamp }, asSelf), "cast");
  refused(await api("POST", "/api/actions/react", { hash, kind: "like", on: true }, asSelf), "react");
  refused(await api("POST", "/api/actions/follow", { targetFid: 3, follow: true }, asSelf), "follow");
  refused(await api("POST", "/api/seed-persona", { personaId: serverPersonaId }), "seed-persona");
  refused(await api("POST", "/api/identity/fork", { fromPersona: serverPersonaId, carry: [], newHandle: "siwf_fork_" + stamp }), "fork");
});

// ---------------------------------------------------------------- the tab half: the /device page's own device
const browser = await chromium.launch();
/** a fresh profile on /device. `beforeGoto(page)` runs before the first load (a route installed there sees the boot's
 *  own requests); the virtual authenticator's id is returned so a check can count the passkeys it holds. */
async function devicePage(label, { beforeGoto } = {}) {
  const ctx = await browser.newContext();
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
  if (beforeGoto) await beforeGoto(page);
  await page.goto(BASE + "/device", { waitUntil: "load" });
  await page.getByTestId("identity-strip").waitFor({ timeout: 60_000 });
  const call = (method, p, body) =>
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
  const tabApi = async (method, p, body) => {
    const r = await call(method, p, body);
    answers.push(r.text);
    return r;
  };
  /** the passkeys the virtual authenticator holds (a registration adds one; a refused save must add none) */
  const passkeys = async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials.length;
  return { ctx, page, network, api: tabApi, cdp, authenticatorId, passkeys };
}
/** PERSONA LAUNCH P1 (review UX-13, UX-16): the validator paths a check makes unreadable, matched by PATH (the
 *  device reads the validator cross-origin through the unpatched fetch; an aborted request is a network failure) */
const validatorPath = (p) => (u) => {
  try {
    return new URL(u).pathname.endsWith(p);
  } catch {
    return false;
  }
};

let T = null;
await check("R1 /device: passkey first, Sign in with Farcaster second, the fixture social card third; the 24 words under a COLLAPSED Advanced; the disclosure is on the card before any request", async () => {
  T = await devicePage("tab");
  const order = await T.page.evaluate(() => [...document.querySelectorAll('[data-testid="save-picker"] > *')].map((e) => e.getAttribute("data-testid")));
  if (JSON.stringify(order) !== JSON.stringify(["save-passkey", "link-farcaster-card", "save-social"])) throw new Error("the picker's order: " + JSON.stringify(order));
  if (!(await T.page.getByTestId("save-passkey").isVisible()) || !(await T.page.getByTestId("save-social").isVisible())) throw new Error("accept-cu2 check 9's anchors are not visible");
  const adv = await T.page.evaluate(() => {
    const d = document.querySelector('[data-testid="advanced"]');
    return d ? { open: d.open, hasPhraseButton: !!d.querySelector("button") } : null;
  });
  if (!adv || adv.open !== false) throw new Error("Advanced is not collapsed: " + JSON.stringify(adv));
  if (await T.page.getByRole("button", { name: /Show my 24 words/ }).isVisible()) throw new Error("the 24 words are visible without opening Advanced");
  await T.page.getByTestId("advanced-toggle").click();
  await T.page.getByRole("button", { name: /Show my 24 words/ }).waitFor({ state: "visible", timeout: 10_000 });
  await T.page.getByTestId("advanced-toggle").click();
  const disclosure = await T.page.getByTestId("siwf-disclosure").innerText({ timeout: 30_000 });
  if (!/sign-in service will see/.test(disclosure) || !/Totem.{1,3}server sees nothing/.test(disclosure)) throw new Error("the disclosure: " + disclosure.slice(0, 160));
  const st = await T.api("GET", "/api/fc/siwf");
  if (st.json?.available !== true || st.json.mode !== "fixture" || st.json.session !== null || st.json.link !== null) throw new Error("a fresh device's status: " + st.text.slice(0, 200));
  if (await T.page.getByTestId("save-moment").count()) throw new Error("the Save moment is shown before anything happened");
});

let tabSession = null;
await check("R2 start → the QR and an allowlisted 'Open in the Farcaster app' link; the status read carries no channel token; the tab answered it (no /api/fc/siwf request reached the network)", async () => {
  if (!T) throw new Error("no device page (R1 failed)");
  const before = T.network.length;
  await T.page.getByTestId("link-farcaster").click();
  await T.page.getByTestId("siwf-qr").waitFor({ timeout: 30_000 });
  const open = T.page.getByTestId("siwf-open-app");
  await open.waitFor({ timeout: 30_000 });
  const href = await open.getAttribute("href");
  const u = new URL(href);
  if (u.protocol !== "https:" || !["farcaster.xyz", "www.farcaster.xyz", "client.farcaster.xyz", "warpcast.com", "www.warpcast.com"].includes(u.hostname)) throw new Error("the phone link: " + href);
  if ((await open.getAttribute("target")) !== "_blank" || !/noreferrer/.test((await open.getAttribute("rel")) ?? "")) throw new Error("the phone link does not open in a new tab without a referrer");
  const st = await T.api("GET", "/api/fc/siwf");
  tabSession = st.json?.session ?? null;
  if (!tabSession || tabSession.stage !== "pending" || !tabSession.approval?.qr?.path) throw new Error("the status: " + st.text.slice(0, 200));
  if (st.text.includes("fixture-siwf-token-") || /channelToken|"token"/.test(st.text)) throw new Error("the status read carries the channel token");
  // PERSONA LAUNCH P1 (review UX-17): the request's status line is announced (a polite live region)
  const live = await T.page.getByTestId("siwf-session").getAttribute("aria-live");
  if (live !== "polite") throw new Error("the session status line is not a polite live region (aria-live=" + live + ")");
  const leaked = T.network.slice(before).filter((x) => new URL(x).pathname === "/api/fc/siwf");
  if (leaked.length) throw new Error(leaked.length + " request(s) for /api/fc/siwf reached the network — the tab did not answer it (regenerate lib/device/routes.generated.ts and rebuild the device bundle)");
  const server = await api("GET", "/api/fc/siwf");
  if (server.json?.session?.id === tabSession.id) throw new Error("the server holds the tab's session: the request fell through to the server");
});

let tabSelf = null;
await check("R3 (tab) fixtureApprove → '@fixture-main · that's me'; the device lists the public self; its profile carries publicSelf facts and no fid; seed-persona, act-as and fork refuse it while an ordinary persona passes", async () => {
  if (!tabSession) throw new Error("no session (R2 failed)");
  await T.api("POST", "/api/fc/siwf", { action: "fixtureApprove", sessionId: tabSession.id });
  await T.page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 30_000 });
  const text = await T.page.getByTestId("siwf-status").innerText();
  if (!/@fixture-main/.test(text) || !/that.s me/.test(text)) throw new Error("the card: " + text);
  const per = (await retry(() => T.api("GET", "/api/personas"))).json.personas;
  tabSelf = per.find((p) => p.publicSelf === true) ?? null;
  const ordinary = per.find((p) => !p.publicSelf && p.handle.startsWith("you_"));
  if (!tabSelf || tabSelf.handle !== "fixture_main") throw new Error("the device does not list the public self: " + JSON.stringify(per.map((p) => [p.handle, !!p.publicSelf])));
  if (!ordinary) throw new Error("no ordinary persona to run the controls with");
  const prof = await retry(() => T.api("GET", "/api/profile?handle=" + tabSelf.handle));
  if (prof.json?.kind !== "seeded" || prof.json?.publicSelf?.fname !== "fixture-main" || prof.json.publicSelf.disconnected !== false) throw new Error("the profile view: " + prof.text.slice(0, 200));
  if (prof.text.includes(String(FIXTURE.main.fid))) throw new Error("the profile view carries the fid");
  const refused = (r, what) => {
    if (r.status !== 403 || r.json?.code !== "PUBLIC_SELF_READ_ONLY") throw new Error(what + ": expected 403 PUBLIC_SELF_READ_ONLY, got " + r.status + " " + (r.json?.code ?? ""));
  };
  // controls first
  const sw = await retry(() => T.api("POST", "/api/seed-persona", { personaId: ordinary.id }));
  if (sw.status !== 200) throw new Error("the ordinary switch: " + sw.status);
  const c = await retry(() => T.api("POST", "/api/actions/cast", { text: "siwf tab control " + stamp }));
  const hash = c.json?.hash;
  if (!hash) throw new Error("the control cast: " + c.text.slice(0, 160));
  await retry(() => T.api("POST", "/api/actions/act-as", { kind: "reply", targetHash: hash, text: "control reply " + stamp, asPersonaId: ordinary.id }));
  await retry(() => T.api("POST", "/api/identity/fork", { fromPersona: ordinary.id, carry: [], newHandle: "siwf_ctl_" + stamp }));
  // the public self
  refused(await T.api("POST", "/api/seed-persona", { personaId: tabSelf.id }), "seed-persona");
  refused(await T.api("POST", "/api/actions/act-as", { kind: "reply", targetHash: hash, text: "as self " + stamp, asPersonaId: tabSelf.id }), "act-as");
  refused(await T.api("POST", "/api/identity/fork", { fromPersona: tabSelf.id, carry: [], newHandle: "siwf_self_" + stamp }), "fork");
});

await check("R5 THE STEM RULE in the device: an unrelated handle is created (control); 'fixture_main2' is refused 409 handle_stem", async () => {
  if (!tabSelf) throw new Error("no public self in the tab (R3 failed)");
  const okH = "unrelated_x" + stamp;
  await retry(() => T.api("POST", "/api/personas", { name: "Unrelated", handle: okH }));
  const bad = await T.api("POST", "/api/personas", { name: "Clash", handle: "fixture_main2" });
  if (bad.status !== 409 || bad.json?.code !== "handle_stem") throw new Error("fixture_main2: " + bad.status + " " + (bad.json?.code ?? "") + " " + String(bad.json?.error ?? "").slice(0, 120));
  const per = (await retry(() => T.api("GET", "/api/personas"))).json.personas.map((p) => p.handle);
  if (!per.includes(okH) || per.includes("fixture_main2")) throw new Error("the roster: " + JSON.stringify(per));
});

await check("R9 THE SAVE MOMENT: after the sign-in the card offers the passkey; the save (virtual authenticator) flips the strip to saved", async () => {
  if (!tabSelf) throw new Error("no sign-in in the tab (R3 failed)");
  const card = T.page.getByTestId("save-moment");
  await card.waitFor({ state: "visible", timeout: 15_000 });
  const btn = T.page.getByTestId("save-moment-passkey");
  if (!(await btn.isVisible())) throw new Error("the moment card offers no passkey button");
  const label = await btn.innerText();
  if (!/Face ID|passkey/.test(label)) throw new Error("the passkey button says " + label);
  await btn.click();
  await T.page.getByText(/Saved — 1 way/).waitFor({ timeout: 45_000 });
  if (await card.isVisible().catch(() => false)) throw new Error("the moment card stayed after the save");
  return "button: " + label;
});

// ---------------------------------------------------------------- R10-R13: the review's UX fixes (PERSONA LAUNCH P1)
await check("R10 ACCESSIBLE NAMES (UX-17): the DISCONNECT confirmation field has an accessible name — found by role and name, and it is the confirm field", async () => {
  if (!tabSelf) throw new Error("no sign-in in the tab (R3 failed)");
  await T.page.getByTestId("siwf-disconnect").click();
  const field = T.page.getByTestId("siwf-disconnect-confirm");
  await field.waitFor({ state: "visible", timeout: 15_000 });
  const byName = T.page.getByRole("textbox", { name: "Type DISCONNECT to confirm", exact: true });
  if ((await byName.count()) !== 1) throw new Error("no single textbox named 'Type DISCONNECT to confirm' (" + (await byName.count()) + ")");
  if ((await byName.getAttribute("data-testid")) !== "siwf-disconnect-confirm") throw new Error("the named textbox is not the confirm field");
  // nothing was submitted: the link is still live (the field was only opened)
  const st = await T.api("GET", "/api/fc/siwf");
  if (st.json?.link?.disconnected !== false) throw new Error("opening the confirmation changed the link: " + st.text.slice(0, 160));
});

await check("R11 STATUS UNREADABLE → TRY AGAIN (UX-13): with the linked-accounts record unreadable the card shows its error AND a 'Try again'; once readable, Try again recovers the card", async () => {
  const unreadable = validatorPath("/state/accountLinks");
  const abort = (route) => route.abort("failed");
  const U = await devicePage("unread", { beforeGoto: (page) => page.route(unreadable, abort) });
  try {
    const err = U.page.locator('[data-testid="siwf-error"][data-code="siwf_links_unreadable"]');
    await err.waitFor({ state: "visible", timeout: 45_000 });
    // the stuck state the fix addresses: no section to act from (every one is gated on a status read)
    if ((await U.page.getByTestId("link-farcaster").count()) || (await U.page.getByTestId("siwf-disclosure").count())) throw new Error("the card shows a section without a status read — the forced failure did not take");
    const retry = U.page.getByTestId("siwf-retry");
    if (!(await retry.isVisible())) throw new Error("the error offers no 'Try again'");
    // still unreadable: pressing it keeps the error (and the button) — never a fake empty card
    await retry.click();
    await U.page.waitForTimeout(300);
    await U.page.locator('[data-testid="siwf-retry"]:not([disabled])').waitFor({ state: "visible", timeout: 30_000 }); // the re-read finished
    if (!(await err.isVisible()) || (await U.page.getByTestId("link-farcaster").count())) throw new Error("a retry against a still-unreadable record did not keep the error");
    await U.page.unroute(unreadable, abort);
    await U.page.getByTestId("siwf-retry").click();
    await U.page.getByTestId("link-farcaster").waitFor({ state: "visible", timeout: 30_000 });
    if (!(await U.page.getByTestId("siwf-disclosure").isVisible())) throw new Error("the recovered card has no disclosure");
    if (await err.count()) throw new Error("the error stayed after the card recovered");
  } finally {
    await U.ctx.close().catch(() => {});
  }
});

await check("R12 THE SAVE GATE (UX-16): while the ways-in list is unreadable, the Save card's passkey button registers NO passkey and says 'paused'; once readable, the same button saves (exactly one passkey)", async () => {
  const methods = validatorPath("/custody/methods");
  const abort = (route) => route.abort("failed");
  const G = await devicePage("gate");
  try {
    if ((await G.passkeys()) !== 0) throw new Error("a fresh profile already holds a passkey");
    await G.page.route(methods, abort);
    await G.page.evaluate(() => window.dispatchEvent(new CustomEvent("layers:moment", { detail: { kind: "persona" } })));
    await G.page.getByTestId("save-moment").waitFor({ state: "visible", timeout: 15_000 });
    // the way back is on the card too (UX-6)
    if ((await G.page.getByTestId("save-moment-unlock").getAttribute("href")) !== "/device#unlock") throw new Error("the card's Unlock link does not go to /device#unlock");
    await G.page.getByTestId("save-moment-passkey").click();
    const err = G.page.getByTestId("save-moment-error");
    await err.waitFor({ state: "visible", timeout: 30_000 });
    const said = await err.innerText();
    if (!/paused/i.test(said)) throw new Error("the refusal says " + said);
    if (/PRF|wrap path|social login|validator|custody/i.test(said)) throw new Error("the refusal is not in plain words: " + said);
    const afterRefusal = await G.passkeys();
    if (afterRefusal !== 0) throw new Error("a refused save registered " + afterRefusal + " passkey(s) — an orphan OS passkey per tap");
    // positive control: the same button, the list readable again → exactly one passkey, the card goes
    await G.page.unroute(methods, abort);
    await G.page.getByTestId("save-moment-passkey").click();
    await G.page.getByTestId("save-moment").waitFor({ state: "detached", timeout: 45_000 });
    const after = await G.passkeys();
    if (after !== 1) throw new Error("the allowed save left " + after + " passkey(s), not 1");
    await G.page.getByText(/Saved — 1 way/).waitFor({ timeout: 45_000 });
    return "refused: 0 passkeys; allowed: 1";
  } finally {
    await G.ctx.close().catch(() => {});
  }
});

/** strip comments (line, block, JSX) so a grep sees only what ships as text or code */
function codeOnly(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}
await check("R13 CONSUMER COPY (UX-15): no consumer save sentence says '24 words' (the strip, the Save card, Settings › Account; /device's note after the save) — while /device's Advanced still does (the grep sees real strings)", async () => {
  const consumer = ["components/device/SaveMoment.tsx", "components/device/IdentityNudge.tsx", "components/settings/AccountPane.tsx"];
  const hits = [];
  for (const f of consumer) {
    const code = codeOnly(readFileSync(path.join(ROOT, f), "utf8"));
    if (/24 words/i.test(code)) hits.push(f);
    if (/reaches it anywhere|reach it anywhere/i.test(code)) hits.push(f + " (anywhere)");
  }
  if (hits.length) throw new Error("a consumer save sentence names the 24 words or promises 'anywhere': " + hits.join(", "));
  // positive control: the same stripping keeps /device's Advanced text, which DOES name the 24 words
  if (!/24 words/.test(codeOnly(readFileSync(path.join(ROOT, "components/device/DeviceApp.tsx"), "utf8")))) throw new Error("the grep's positive control: DeviceApp.tsx's Advanced no longer reads '24 words' after stripping — the stripper hides strings");
  // what the tab actually said after R9's save
  if (T) {
    const notes = await T.page.locator('[role="status"]').allInnerTexts();
    const said = notes.find((t) => /Saved\./.test(t));
    if (!said) throw new Error("no save note on /device after R9: " + JSON.stringify(notes).slice(0, 200));
    if (/24 words/i.test(said)) throw new Error("the save note says: " + said);
  }
});

// ---------------------------------------------------------------- R7, R8
await check("R7 LEAK GREP: no fixture fid, fname, signer address or channel token in any NEW validator plaintext, log line or console line; each device's accountLinks row is ciphertext and exactly 1,024 bytes", async () => {
  // positive control: the needles are the right strings (the device's own status read names the fname)
  const st = T ? await T.api("GET", "/api/fc/siwf") : null;
  if (!st || !st.text.includes(FIXTURE.main.fname)) throw new Error("the needle positive control: the tab's status does not name " + FIXTURE.main.fname);
  const hits = [];
  for (const r of dbRows()) {
    if (baselineHits.has(r.s)) continue;
    for (const n of NEEDLES) if (r.s.includes(n)) hits.push(r.t + " row carries " + n.slice(0, 14));
  }
  LOGS.forEach((f, i) => {
    const tail = logTail(f, logStart[i]);
    for (const n of NEEDLES) if (tail.includes(n)) hits.push(path.basename(f) + " carries " + n.slice(0, 14));
  });
  for (const line of consoleLines) for (const n of NEEDLES) if (line.includes(n)) hits.push("console: " + line.slice(0, 100));
  if (hits.length) throw new Error(hits.length + " leak(s): " + [...new Set(hits)].slice(0, 5).join(" | "));
  const rows = accountLinksRows();
  if (rows.length < 2) throw new Error("expected an accountLinks row for the server and for the tab, found " + rows.length);
  for (const r of rows) {
    if (r.key !== "_") throw new Error("accountLinks is addressed by " + r.key + ", not one opaque key");
    const b = ctBytes(r.value);
    if (b !== 1024) throw new Error("an accountLinks row is " + b + " bytes, not 1,024");
  }
  return `${rows.length} accountLinks rows, all 1,024 bytes; ${consoleLines.length} console lines and the logs since the start scanned`;
});

await check("R8 resetSeed purges the fixture-siwf persona and the link; both reset lists carry resetAccountLinksCache", async () => {
  const before = await probe();
  if (before.fixtureSiwfPersonas < 1 || before.link !== "live") throw new Error("setup: the server is not signed in before the reset: " + JSON.stringify(before));
  await retry(() => dev("resetSeed"));
  const after = await probe();
  if (after.fixtureSiwfPersonas !== 0 || after.publicSelfPersonas !== 0 || after.link !== "none") throw new Error("after resetSeed: " + JSON.stringify(after));
  if ((await linkNow()) !== null) throw new Error("GET /api/fc/siwf still names a link after the reset");
  for (const [file, fn] of [["lib/device/boot.ts", "export async function reloadIdentity"], ["app/api/dev/route.ts", 'body.action === "resetSeed"']]) {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    const at = src.indexOf(fn);
    // the list is the body up to the next branch / function: a call elsewhere in the file is not this list's
    const end = [src.indexOf("} else if (body.action", at + fn.length), src.indexOf("\nexport ", at + fn.length)].filter((i) => i > 0).sort((a, b) => a - b)[0] ?? src.length;
    if (at < 0 || !src.slice(at, end).includes("resetAccountLinksCache()")) throw new Error(file + "'s reset list lacks resetAccountLinksCache");
  }
});

await T?.ctx.close().catch(() => {});
await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} SIWF checks passed${passed === results.length ? "" : ", " + (results.length - passed - infra) + " FAILED" + (infra ? ", " + infra + " INFRA" : "")}`);
process.exit(passed === results.length ? 0 : 1);
