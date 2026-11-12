// ZK PASS 1 — GATE 1: the anonymous submission channel. FIXTURE-SAFE.
//
// What this suite proves about the channel, from the outside: an
// identifying header is REFUSED and the proof is not consumed; PoW is
// required and bound to the bytes; every outcome has one body size and
// one timing envelope; the client's submission path is an isolated socket
// with an exact header set; queued submissions are jittered — their
// offsets from the motivating action are random, not a fixed delay; the
// relay adapter switches by config, `direct` is flagged non-private, and
// `tor` refuses rather than downgrading; the validator's anon module logs
// nothing and stores no IPs, timestamps, or arrival order.
//
// SAFETY SET: identifying-header rejection, operator log grep, computed
// (non-)privacy flag for direct.
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { startRelay } from "./lib-ohttp-relay.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";

const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

await assertServersUp(BASE);
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = JSON.parse(await res.text()); } catch {}
  return { status: res.status(), json };
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) { try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.json?.reason ?? JSON.stringify(r.json)?.slice(0, 160) ?? "")); } catch (e) { last = e; } }
  throw last;
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const status = async () => (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- deliberate duplicates: PoW + a CLEAN raw client ----
const leadingZeroBits = (buf) => { let n = 0; for (const b of buf) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; } return n; };
function solvePow(body, bits) {
  const bh = createHash("sha256").update(body).digest("hex");
  for (let i = 0; ; i++) { const nonce = i.toString(36); if (leadingZeroBits(createHash("sha256").update(bh + "|" + nonce).digest()) >= bits) return nonce; }
}
function rawPost(url, body, headers) {
  const t0 = performance.now();
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", agent: false, headers: { ...headers, "content-length": String(body.length) } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks), ms: performance.now() - t0 }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const outcomeOf = (buf) => { try { return JSON.parse(buf.toString("utf8")).outcome; } catch { return "unparseable"; } };
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log("\nZK Gate 1 — anonymous channel: header rejection, PoW, constant shape, isolation, jitter, relay, operator discipline");

// ---- setup: a registered, active root in a clean fixture universe ----
await retry(() => zk("resetZk"));
{
  const issued = await retry(() => api("POST", "/api/dev", { action: "issueTestDelegation", devicePubKey: "ef".repeat(32), deviceId: "dev_z1_probe" }));
  await fetch(VBASE + "/device/auth-anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pubkey: issued.json.anchorPubKey }) });
  await retry(() => zk("register"));
  await retry(() => zk("seedDecoys", { count: 60 })); // the client refuses to prove below its floor
  await retry(() => zk("advanceEpoch"));
}
const s0 = await status();
const POW_BITS = s0.pow.bits;
/** a fresh, valid envelope for `persona` at the CURRENT epoch */
async function freshEnvelope(persona = MAIN) {
  const out = await retry(() => zk("prove", { claimKind: "tier-membership", tree: "valid", personaId: persona, gateId: "foryou" }));
  return out.json.envelope;
}
const bodyFor = (envelope) => Buffer.from(JSON.stringify({ envelope }));

// ---- 1. SAFETY: identifying headers → refused, proof NOT consumed ----
await check("1. SAFETY: a submission carrying ANY identifying header (cookie / authorization / x-layers-device / x-forwarded-for / user-agent / referer) is REFUSED and the proof is not consumed", async () => {
  const body = bodyFor(await freshEnvelope(MAIN));
  const nonce = solvePow(body, POW_BITS);
  for (const bad of [{ cookie: "layers_view_as=x" }, { authorization: "Bearer x" }, { "x-layers-device": "dev_1" }, { "x-forwarded-for": "10.0.0.1" }, { "user-agent": "Mozilla/5.0" }, { referer: `http://localhost:${process.env.LAYERS_APP_PORT || 3001}/home` }]) {
    const r = await rawPost(VBASE + "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce, ...bad });
    if (r.status !== 200 || outcomeOf(r.buf) !== "refused") throw new Error(`${JSON.stringify(bad)} → ${r.status} ${outcomeOf(r.buf)} (expected refused)`);
  }
  const clean = await rawPost(VBASE + "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce });
  if (outcomeOf(clean.buf) !== "accepted") throw new Error("the clean submission after the refused ones was not accepted — a refused submission consumed the nullifier");
});

// ---- 2. PoW ----
await check("2. PoW is required and bound to the exact body bytes (no per-root state)", async () => {
  await retry(() => zk("advanceEpoch"));
  const body = bodyFor(await freshEnvelope(MAIN));
  const none = await rawPost(VBASE + "/zk/anon/submit", body, { "content-type": "application/json" });
  if (outcomeOf(none.buf) !== "refused") throw new Error("missing PoW was not refused");
  const other = bodyFor(await freshEnvelope(ALT));
  const reused = await rawPost(VBASE + "/zk/anon/submit", other, { "content-type": "application/json", "x-zk-pow": solvePow(body, POW_BITS) });
  if (outcomeOf(reused.buf) !== "refused") throw new Error("a PoW solved for another body was accepted");
  const good = await rawPost(VBASE + "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": solvePow(body, POW_BITS) });
  if (outcomeOf(good.buf) !== "accepted") throw new Error("a valid PoW was refused");
});

// ---- 3. constant shape ----
await check("3. Constant shape: accepted / replay / refused / malformed have ONE body size and a bounded timing spread", async () => {
  const N = 6;
  const samples = { accepted: [], replay: [], refused: [], malformed: [] };
  const sizes = new Set();
  for (let i = 0; i < N; i++) {
    await retry(() => zk("advanceEpoch"));
    const body = bodyFor(await freshEnvelope(MAIN));
    const nonce = solvePow(body, POW_BITS);
    const a = await rawPost(VBASE + "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce });
    const r = await rawPost(VBASE + "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce });
    const f = await rawPost(VBASE + "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce, cookie: "a=b" });
    const junk = Buffer.from("{garbage" + i);
    const m = await rawPost(VBASE + "/zk/anon/submit", junk, { "content-type": "application/json", "x-zk-pow": solvePow(junk, POW_BITS) });
    for (const [k, v] of [["accepted", a], ["replay", r], ["refused", f], ["malformed", m]]) {
      if (outcomeOf(v.buf) !== k) throw new Error(`round ${i}: expected ${k}, got ${outcomeOf(v.buf)}`);
      sizes.add(v.buf.length);
      samples[k].push(v.ms);
    }
  }
  if (sizes.size !== 1) throw new Error(`body sizes differ across outcomes: ${[...sizes].join(",")}`);
  const meds = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, Math.round(median(v))]));
  const spread = Math.max(...Object.values(meds)) - Math.min(...Object.values(meds));
  if (spread > 60) throw new Error(`median timing spread across outcomes is ${spread} ms: ${JSON.stringify(meds)}`);
});

// ---- 4. connection isolation ----
await check("4. The client's submission path is an ISOLATED socket (agent:false, never reused) with an exact header set; the anon modules import no shared transport", async () => {
  await retry(() => zk("advanceEpoch"));
  const env = await freshEnvelope(MAIN);
  const sub = (await retry(() => zk("anonSubmit", { envelope: env }))).json;
  if (sub.outcome !== "accepted") throw new Error(`app-side anon submit: ${sub.outcome}`);
  if (sub.bytes !== 4096) throw new Error(`request is not the constant size (${sub.bytes} bytes) — a relay's log could join submissions by length`);
  const last = (await zk("lastAnon")).json.last;
  if (!last || last.agentFalse !== true || last.reusedSocket !== false) throw new Error(`isolation diagnostics wrong: ${JSON.stringify(last)}`);
  const allowed = new Set(["host", "content-type", "content-length", "x-zk-pow", "connection"]);
  for (const h of last.headersSent) if (!allowed.has(h)) throw new Error(`the client sent a header outside the exact set: ${h}`);
  for (const must of ["host", "content-type", "x-zk-pow"]) if (!last.headersSent.includes(must)) throw new Error(`missing header ${must}`);
  for (const f of ["lib/zk/anon/client.ts", "lib/zk/anon/submit.ts", "lib/zk/anon/relay.ts"]) {
    const src = readFileSync(f, "utf8");
    if (/from "@\/lib\/adapters\/mock\/persist"|from "\.\.\/validatorClient"|from "undici"|\bfetch\(/.test(src)) throw new Error(`${f} touches a shared transport (persist / validatorClient / fetch)`);
  }
});

// ---- 5. jitter decorrelation ----
await check("5. Jitter: queued submission times are decorrelated from the motivating action (random offsets, no fixed delay); a real item drains once, never twice", async () => {
  const t0 = Date.now();
  const ats = Array.from({ length: 24 }, (_, i) => t0 - 6000 + i * 250); // a perfectly regular action cadence
  const items = (await retry(() => zk("enqueueSynthetic", { count: 24, motivatedAts: ats, jitterMinMs: 0, jitterMaxMs: 20000 }))).json.items;
  const offsets = items.map((it) => it.notBefore - it.motivatedAt);
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const sd = Math.sqrt(offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length);
  if (sd < 0.15 * 20000) throw new Error(`offsets barely vary (sd=${Math.round(sd)}ms) — a fixed delay in disguise`);
  if (new Set(offsets).size < 20) throw new Error("offsets repeat — not random");
  // no linear relationship between when the action happened and the jitter drawn
  const jit = items.map((it) => it.notBefore - it.createdAt);
  const mx = ats.reduce((a, b) => a + b, 0) / ats.length, my = jit.reduce((a, b) => a + b, 0) / jit.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < ats.length; i++) { sxy += (ats[i] - mx) * (jit[i] - my); sxx += (ats[i] - mx) ** 2; syy += (jit[i] - my) ** 2; }
  const r = sxy / Math.sqrt(sxx * syy);
  if (Math.abs(r) > 0.6) throw new Error(`jitter correlates with action time (r=${r.toFixed(2)})`);
  // THE WINDOW CANNOT BE COLLAPSED FROM THE WIRE (attack-3 F-4): a hostile
  // epoch shape is refused outright, a legitimate clamp keeps the spread
  const hostile = (await zk("jitterProbe", { jitterMinMs: 30000, jitterMaxMs: 900000, epochShape: { epochMs: 0, msRemaining: 0 } })).json;
  if (hostile.ok) throw new Error("a zero-length epoch collapsed the window to a fixed offset instead of being refused");
  const nan = (await zk("jitterProbe", { jitterMinMs: 30000, jitterMaxMs: 900000, epochShape: { epochMs: null, msRemaining: 0 } })).json;
  if (nan.ok) throw new Error("a non-numeric epoch was not refused");
  const clamped = (await zk("jitterProbe", { jitterMinMs: 30000, jitterMaxMs: 900000, epochShape: { epochMs: 6 * 3600_000, msRemaining: 1000 } })).json;
  if (!clamped.ok || clamped.window.hi - clamped.window.lo < clamped.window.minSpread) throw new Error(`a legitimate clamp collapsed the spread: ${JSON.stringify(clamped.window)}`);
  if (!clamped.selfTest?.ok) throw new Error("in-process scheduler self-test fails: " + clamped.selfTest?.detail);
  const synthHostile = await zk("enqueueSynthetic", { count: 3, motivatedAts: [], jitterMinMs: 0, jitterMaxMs: 20000, epochShape: { epochMs: 0, msRemaining: 0 } });
  if (synthHostile.status !== 422) throw new Error("the synthetic scheduler path does not go through the window validation");
  // a REAL item: proven now, sent only when due, exactly once — and the
  // `sent` mark is NOT written to the validator at send time (attack-1 #2)
  await retry(() => zk("advanceEpoch"));
  const q = (await retry(() => zk("enqueue", { claimKind: "tier-membership", tree: "valid", personaId: MAIN, gateId: "foryou", jitterMinMs: 800, jitterMaxMs: 2500 }))).json;
  if (!(q.notBefore - Date.now() >= 300)) throw new Error("real item scheduled too soon");
  const early = (await retry(() => zk("drain"))).json;
  if (early.sent !== 0) throw new Error("an item was sent BEFORE its jittered time");
  await sleep(q.notBefore - Date.now() + 200);
  const due = (await retry(() => zk("drain"))).json;
  // PERSONA LAUNCH wave 3 (verify, harness race — seen once in the wave-3 build sweep: "drain when due: {due:0,sent:0}"):
  // the PRODUCT's own in-process drain loop (lib/zk/anon/queue.ts ensureDrainLoop, every 5 s, started by this very
  // enqueue) may reach the item in the ~200 ms between its moment and this explicit drain, and send it first. That is
  // the product doing its job, not a second send: drainQueue serializes every drain, so an item goes exactly once. When
  // the explicit drain found nothing, the item must therefore already be SENT by that loop — accepted, and never before
  // its jittered moment (sentAt >= notBefore, a bound the old assertion did not check). Anything else still fails.
  if (!(due.sent === 1 && due.outcomes.accepted === 1)) {
    const mine = (await retry(() => zk("queueStatus"))).json.items?.find((it) => it.id === q.id);
    const byLoop = due.sent === 0 && mine && mine.status === "sent" && mine.outcome === "accepted" && typeof mine.sentAt === "number" && mine.sentAt >= q.notBefore;
    if (!byLoop) throw new Error(`drain when due: ${JSON.stringify(due)}; the item: ${JSON.stringify(mine ?? null)}`);
    console.log(`   (the product's 5 s drain loop sent the item ${mine.sentAt - q.notBefore} ms after its moment, before this explicit drain — once, accepted)`);
  }
  const again = (await retry(() => zk("drain"))).json;
  if (again.sent !== 0) throw new Error("a sent item was re-sent");
  const qs = (await retry(() => zk("queueStatus"))).json;
  if (qs.sent < 1) throw new Error("queue status lost the sent item");
  if (qs.persistPending !== true) throw new Error("the sent mark was persisted at send time (an identified write bracketing the anonymous send)");
});

// ---- 6. relay switching ----
let relay = null;
await check("6. Relay adapter switches by config: direct is flagged NOT private; ohttp round-trips through a relay (the gateway never sees the client's request); tor refuses rather than downgrading", async () => {
  await retry(() => zk("setRelay", { kind: "direct" }));
  let s = await status();
  if (s.relay.kind !== "direct" || s.relay.privacyCapable !== false) throw new Error("direct relay not flagged non-private");
  relay = await startRelay({ gateway: VBASE });
  await retry(() => zk("setRelay", { kind: "ohttp", url: relay.url, thirdParty: false }));
  s = await status();
  if (s.relay.kind !== "ohttp" || !s.relay.privacyCapable || s.relay.thirdPartyAttested !== false) throw new Error(`ohttp relay status wrong: ${JSON.stringify(s.relay)}`);
  await retry(() => zk("advanceEpoch"));
  const env = await freshEnvelope(MAIN);
  const sub = (await retry(() => zk("anonSubmit", { envelope: env }))).json;
  if (sub.outcome !== "accepted" || sub.relay !== "ohttp") throw new Error(`ohttp submit: ${JSON.stringify(sub)}`);
  if (relay.stats.forwarded < 1 || relay.stats.keyFetches < 1) throw new Error("the relay did not forward (the client went direct?)");
  // replay through the relay is still a replay
  const re = (await retry(() => zk("anonSubmit", { envelope: env }))).json;
  if (re.outcome !== "replay") throw new Error(`ohttp replay: ${re.outcome}`);
  await retry(() => zk("setRelay", { kind: "tor" }));
  const tor = (await retry(() => zk("anonSubmit", { envelope: env }))).json;
  if (tor.outcome !== "transport-error" || tor.relay !== "tor") throw new Error(`tor stub did not refuse: ${JSON.stringify(tor)}`);
  await retry(() => zk("setRelay", { kind: null }));
});

// ---- 7. SAFETY: operator-side discipline ----
await check("7. SAFETY: the anon module logs nothing and keeps no IPs / fine timestamps / arrival order; anon routes are mounted before the JSON parser", async () => {
  const anon = readFileSync("validator/anon.js", "utf8");
  for (const bad of [/console\.(log|info|warn|error)\(/, /req\.ip\b/, /remoteAddress/, /morgan/]) if (bad.test(anon)) throw new Error("forbidden pattern in validator/anon.js: " + bad);
  const server = readFileSync("validator/server.js", "utf8");
  // PERSONA LAUNCH P2 (verify): the parser now carries an explicit limit (express.json({ limit: STATE_BODY_LIMIT_BYTES }),
  // validator/limits.js), so the literal "app.use(express.json())" vanished and this order check failed. It now finds the
  // FIRST express.json( call in any form, and both anchors must exist (a missing one used to compare -1 and could pass).
  const anonAt = server.indexOf("mountAnon(app, db)");
  const jsonAt = server.search(/express\.json\(/);
  if (anonAt < 0 || jsonAt < 0) throw new Error("cannot find mountAnon(app, db) (" + anonAt + ") or the JSON parser (" + jsonAt + ") in validator/server.js");
  if (anonAt > jsonAt) throw new Error("anon routes are mounted AFTER express.json() — malformed bodies would get a non-constant 400");
  if (/morgan|app\.use\(logger/.test(server)) throw new Error("a request logger is installed on the validator");
  const db = new DatabaseSync("validator/layers.db", { readOnly: true });
  try {
    for (const t of ["zk_nullifiers", "zk_eligibility"]) {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t)?.sql ?? "";
      if (!/WITHOUT ROWID/.test(sql)) throw new Error(`${t} keeps arrival order (no WITHOUT ROWID)`);
      if (/seen_at|created_at|received_at/.test(sql)) throw new Error(`${t} stores a timestamp`);
    }
  } finally {
    db.close();
  }
});

// ---- 8. precompute-only ----
await check("8. Precompute-only: no persona action handler imports the prover or the anonymous channel", async () => {
  const { execSync } = await import("node:child_process");
  const out = execSync('grep -rlE "lib/zk/(prove|anon|transport)" app/api/actions lib/fc app/api/fc 2>/dev/null || true', { encoding: "utf8" }).trim();
  if (out) throw new Error("action-path modules import the zk prover/channel: " + out.replace(/\n/g, ", "));
});

if (relay) await relay.close();
await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(`\n${results.length - fails.length - infra.length}/${results.length} ZK Gate 1 checks passed` + (fails.length ? `, ${fails.length} FAILED` : "") + (infra.length ? `, ${infra.length} infra` : ""));
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
