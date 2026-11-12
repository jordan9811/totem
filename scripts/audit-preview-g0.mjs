// PUBLIC PREVIEW Gate 0 — the readiness audit, run against a running app + validator as two strangers would.
//
//   node scripts/audit-preview-g0.mjs --label hooks-on      (the harness config: ZK_DEV_HOOKS=true on both processes)
//   node scripts/audit-preview-g0.mjs --label production    (NODE_ENV=production, hooks unset, write flags unset)
//
// Two empty browser contexts, A and B. Nothing is asserted; everything is MEASURED and printed, and the verdicts are
// written in notes/runbooks/PREVIEW-READINESS.md by a human reading this output. It leaves the seed reset when dev hooks are on.
import { chromium } from "playwright";
import { existsSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const BASE = process.env.BASE_URL || `http://127.0.0.1:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const label = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1] : "unlabeled";
const stamp = "audit-g0-" + Date.now().toString(36);
const out = { label, at: new Date().toISOString(), findings: {} };
const say = (k, v) => { out.findings[k] = v; console.log("  " + k + ": " + (typeof v === "string" ? v : JSON.stringify(v)).slice(0, 400)); };

// BROWSER KEYSTORE PASS Gate 1 stage 4: --device drives every app request through THE PAGE'S OWN FETCH, which is
// what a browser does and what the browser-hosted device answers (docs/custody-model.md D-CU-0-3). Without it the
// requests go to the Next server, which in production holds no identity — a measurement of the wrong thing.
const DEVICE = process.argv.includes("--device");
const DEVICE_PAGE = "/device/smoke.html?validator=" + encodeURIComponent(VBASE);

const browser = await chromium.launch();
const A = await browser.newContext();
const B = await browser.newContext();
const devicePage = new Map();
async function pageFor(ctx) {
  if (devicePage.has(ctx)) return devicePage.get(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE + DEVICE_PAGE, { waitUntil: "load" });
  await page.evaluate(() => window.__layersDevice.ready);
  devicePage.set(ctx, page);
  return page;
}
const callThroughPage = async (ctx, method, path, body, headers = {}) => {
  const page = await pageFor(ctx);
  return page.evaluate(async ({ method, path, body, headers }) => {
    const r = await fetch(path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  }, { method, path, body, headers });
};
const callThroughServer = async (ctx, method, path, body, headers = {}) => {
  const r = await ctx.request.fetch(BASE + path, { method, headers: { "content-type": "application/json", ...headers }, data: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status(), json, text };
};
const call = (ctx, method, path, body, headers) =>
  (DEVICE ? callThroughPage : callThroughServer)(ctx, method, path, body, headers);
const vcall = async (method, path, body) => {
  const r = await fetch(VBASE + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const cookieNames = async (ctx) => (await ctx.cookies()).map((c) => c.name).sort();

console.log(`\nPUBLIC PREVIEW Gate 0 audit — ${label} — app ${BASE}, validator ${VBASE}\n`);

// ---------------------------------------------------------------- 1. multi-tenancy: does a fresh browser get its own root?
console.log("1. MULTI-TENANCY");
const pa = DEVICE ? await pageFor(A) : await A.newPage();
const pb = DEVICE ? await pageFor(B) : await B.newPage();
if (!DEVICE) {
  await pa.goto(BASE + "/home", { waitUntil: "domcontentloaded" }).catch(() => {});
  await pb.goto(BASE + "/home", { waitUntil: "domcontentloaded" }).catch(() => {});
} else {
  const ia = await pa.evaluate(() => window.__layersDevice.info);
  const ib = await pb.evaluate(() => window.__layersDevice.info);
  say("device roots (A, B)", { a: ia?.rootId, b: ib?.rootId, same: ia?.rootId === ib?.rootId });
  say("device anchors differ", ia?.anchor !== ib?.anchor);
}
say("cookies set on first visit (A)", await cookieNames(A));
say("cookies set on first visit (B)", await cookieNames(B));
const perA = await call(A, "GET", "/api/personas");
const perB = await call(B, "GET", "/api/personas");
const idsA = (perA.json?.personas ?? []).map((p) => p.id).sort();
const idsB = (perB.json?.personas ?? []).map((p) => p.id).sort();
say("A personas", { activeId: perA.json?.activeId, count: idsA.length, first: idsA.slice(0, 3) });
say("B personas", { activeId: perB.json?.activeId, count: idsB.length, first: idsB.slice(0, 3) });
say("SAME persona roster and active persona for two strangers", JSON.stringify(idsA) === JSON.stringify(idsB) && perA.json?.activeId === perB.json?.activeId);
const zkA = await call(A, "GET", "/api/zk?mode=fixture");
const zkB = await call(B, "GET", "/api/zk?mode=fixture");
const cOf = (r) => r.json?.status?.commitment ?? (JSON.stringify(r.json ?? {}).match(/"commitment":"([0-9a-fx]+)"/) || [])[1];
const cA = cOf(zkA), cB = cOf(zkB);
say("zk identity commitment visible to a stranger", { status: zkA.status, present: !!cA });
say("SAME root commitment for A and B", !!cA && cA === cB);
say("registry (/api/dev GET) readable by a stranger", { status: (await call(B, "GET", "/api/dev")).status });

// ---------------------------------------------------------------- 2. seeded state: shared, per-visitor, or cross-mutating?
console.log("2. SEEDED STATE");
const castA = await call(A, "POST", "/api/actions/cast", { text: stamp + " (A posted this)" });
say("A posts a cast", { status: castA.status, hash: castA.json?.hash ?? castA.json?.cast?.hash ?? null });
const feedB = await call(B, "GET", "/api/feed");
say("B's feed contains A's cast", { status: feedB.status, contains: feedB.text.includes(stamp) });
const homeB = await (await B.newPage()).goto(BASE + "/home", { waitUntil: "domcontentloaded" }).then((r) => r?.text()).catch(() => "");
say("B's rendered home page contains A's cast", homeB.includes(stamp));
// the private persona is one of the ONE seeded viewer's personas: a plain cookie selects it, no secret needed
await B.addCookies([{ name: "layers_seed_persona", value: "persona_viewer_alt", url: BASE }]);
const privB = await call(B, "GET", "/api/private/posts");
say("B, with a guessable cookie, reads the owner's PRIVATE posts", { status: privB.status, count: privB.json?.posts?.length ?? null });
const privPost = await call(B, "POST", "/api/private/posts", { text: stamp + " (B wrote a private post as the owner's private persona)" });
say("B, with that cookie, AUTHORS a private post as the owner", { status: privPost.status });
await B.clearCookies();
// the viewAs dev action is NOT in the production-refused set
const viewAs = await call(B, "POST", "/api/dev", { action: "viewAs", personaId: "persona_viewer_alt" });
const privB2 = await call(B, "GET", "/api/private/posts");
say("B via /api/dev viewAs (never refused) then reads private posts", { viewAs: viewAs.status, read: privB2.status, count: privB2.json?.posts?.length ?? null });
await call(B, "POST", "/api/dev", { action: "viewAs", personaId: null });
await B.clearCookies();

// ---------------------------------------------------------------- 3. dev surfaces: can an unauthenticated request mutate another visitor's state?
console.log("3. DEV SURFACES (B mutates, A observes)");
const devTry = async (body) => (await call(B, "POST", "/api/dev", body)).status;
const dev = {};
dev.forceFail = await devTry({ action: "forceFail", label: "feed", count: 1 });
const feedAfterFail = await call(A, "GET", "/api/feed");
say("B forceFail(feed) → status; A's next feed read", { accepted: dev.forceFail, aFeedStatus: feedAfterFail.status });
dev.setLatency = await devTry({ action: "setLatency", range: [1500, 1600], failureRate: 0 });
const t0 = Date.now(); await call(A, "GET", "/api/feed"); const ms = Date.now() - t0;
say("B setLatency(1500ms) → status; A's feed latency after", { accepted: dev.setLatency, aFeedMs: ms });
await devTry({ action: "setLatency", range: null, failureRate: null });
dev.maxLatency = await devTry({ action: "maxLatency", on: false });
dev.forgeEvent = await devTry({ action: "forgeEvent", type: "impression" });
dev.forceExhaust = await devTry({ action: "forceExhaust" });
dev.fastForwardReadwise = await devTry({ action: "fastForwardReadwise" });
dev.resetInboxCursor = await devTry({ action: "resetInboxCursor" });
dev.cryptoProbe = await devTry({ action: "cryptoProbe" });
dev.vaultReadback = await devTry({ action: "vaultReadback" });
dev.tamperState = await devTry({ action: "tamperState", namespace: "audit", key: "k", value: "v" });
dev.issueTestDelegation = await devTry({ action: "issueTestDelegation", devicePubKey: "ab".repeat(32), deviceId: "dev_audit" });
dev.setDataSource = await devTry({ action: "setDataSource", source: "seed" });
say("dev action statuses from an unauthenticated stranger", dev);
const zkRig = await call(B, "POST", "/api/zk", { action: "advanceEpoch", mode: "fixture" });
say("zk rig action (advanceEpoch) from a stranger", { status: zkRig.status, error: zkRig.json?.error ?? null });
const searchHook = await call(B, "POST", "/api/search/unified", { action: "dropIndex" });
say("search dev hook (dropIndex) from a stranger", { status: searchHook.status });
const reset = await call(B, "POST", "/api/dev", { action: "resetSeed" });
const feedAfterReset = await call(A, "GET", "/api/feed");
say("B resetSeed → status; A's cast still in A's feed afterwards", { accepted: reset.status, aStillSeesOwnCast: feedAfterReset.text.includes(stamp) });

// ---------------------------------------------------------------- 4. the validator's public surface
console.log("4. VALIDATOR PUBLIC SURFACE (no envelope, no cookie)");
const st = await vcall("GET", "/state");
const nsNames = Object.keys(st.json?.state ?? {});
const plain = nsNames.filter((n) => { const v = st.json.state[n]; const first = v && Object.values(v)[0]; return first && !(typeof first === "object" && typeof first.ct === "string"); });
say("GET /state", { status: st.status, namespaces: nsNames.length, plaintextNamespaces: plain.slice(0, 40) });
let rootId = null;
try { const db = new DatabaseSync(DB_PATH, { readOnly: true }); rootId = db.prepare("SELECT id FROM roots WHERE fid = 9152").get()?.id ?? null; db.close(); } catch {}
const ev = await vcall("POST", "/events", { rootId, type: "follow_gained", count: 1, sourceId: null });
say("POST /events for the owner's root, no envelope (rep inflation)", { status: ev.status, body: ev.json });
const put = await vcall("PUT", "/state/audit-probe-ns", { probe: { audit: stamp } });
say("PUT /state/<ns> without an envelope", { status: put.status, error: put.json?.error ?? null });
const del = await vcall("DELETE", "/state");
say("DELETE /state without an envelope", { status: del.status, error: del.json?.error ?? null });
const anchor = await vcall("POST", "/device/auth-anchor", { pubkey: "cd".repeat(32) });
say("POST /device/auth-anchor with a stranger's key", { status: anchor.status, error: anchor.json?.error ?? null });
const vreset = await vcall("POST", "/zk/dev/reset", { mode: "fixture" });
say("POST /zk/dev/reset from a stranger", { status: vreset.status, error: vreset.json?.error ?? null });
const members = await vcall("GET", "/zk/members?mode=fixture&tree=valid");
say("GET /zk/members (public by design)", { status: members.status, count: members.json?.members?.length ?? null });
const health = await vcall("GET", "/health");
say("validator /health", { status: health.status, keys: Object.keys(health.json ?? {}).slice(0, 12) });

// ---------------------------------------------------------------- 5. what production must have OFF
console.log("5. PRODUCTION-OFF PATHS (as configured on this instance)");
const fcw = await call(B, "POST", "/api/fc/write", { action: "cast", text: stamp + " fc write probe" });
say("Farcaster write (ENABLE_FC_WRITE)", { status: fcw.status, mode: fcw.json?.mode ?? null, error: fcw.json?.error ?? null });
const xw = await call(B, "POST", "/api/crosspost", { castHash: "0x" + stamp, text: stamp, destinationIds: ["x"] });
say("X live write (ENABLE_X_WRITE)", { status: xw.status, error: xw.json?.error ?? (xw.json?.refused ?? null), published: xw.json?.published?.length ?? null });
const inbox = await call(B, "GET", "/api/x/inbox");
say("X inbox mode (ENABLE_X_READ + creds)", { status: inbox.status, mode: inbox.json?.mode ?? null });
const spend = await call(B, "GET", "/api/x/spend");
say("spend ledger", { status: spend.status, mode: spend.json?.mode ?? null, entries: spend.json?.entries?.length ?? null, liveTotal: spend.json?.liveTotal ?? spend.json?.totals ?? null });
const prove = await call(B, "POST", "/api/zk", { action: "prove", mode: "fixture", claimKind: "tier-membership", tree: "valid", personaId: "persona_viewer_main", gateId: "foryou" });
say("zk prove from a stranger (rig action)", { status: prove.status, error: prove.json?.error ?? null });
const live = await call(B, "GET", "/api/dev/live");
say("/api/dev/live diagnostic (attempts a Neynar read when a key exists)", { status: live.status, dataSource: live.json?.dataSource, hasKey: live.json?.hasKey, liveFetch: live.json?.liveFetch, count: live.json?.count ?? null });
const fcp = await call(B, "GET", "/api/fc/persona");
say("fid records readable by a stranger", { status: fcp.status, records: fcp.json?.records?.length ?? null });

// ---------------------------------------------------------------- cleanup (only where the rig allows it)
if (reset.status === 200) { await call(B, "POST", "/api/dev", { action: "resetSeed" }); console.log("  (seed reset at the end)"); }
await browser.close();
const outPath = (process.env.AUDIT_OUT || "shots") + `/audit-preview-g0-${label}.json`;
try { writeFileSync(outPath, JSON.stringify(out, null, 2)); console.log("\nwritten: " + outPath); } catch {}
