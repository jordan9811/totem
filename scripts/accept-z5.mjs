// ZK PASS 2 — GATE 0: the cheap residuals from Pass 1's rebuttal, closed.
// FIXTURE-SAFE (never proves live; the local validator; a fixture relay).
//
//   • FIXED-SCHEDULE PREFETCH: the render path makes NO validator request
//     for epoch/leaves/history/key; a persona is only marked wanted and is
//     proved on the next scheduled tick; the tick cadence does not change
//     with proof activity (A-PREPARE-BURST retired)
//   • THE SECOND VIEWPOINT: the history head fetched over the anonymous
//     path (through the relay when configured) must equal the identified
//     one; a validator that forks the anonymous view is REFUSED
//   • THE SUPERVISOR: a validator killed with /F comes back on its own and
//     the death is recorded with exit code and the last log lines
//
// The harness starts the app with ZK_PREFETCH_MS=3000 (production default
// 10 min) and the validator under `npm run validator:supervised`.
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
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
async function vapi(path) { const r = await fetch(VBASE + path); return { status: r.status, json: await r.json().catch(() => null) }; }
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) { try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.json?.reason ?? JSON.stringify(r.json)?.slice(0, 160) ?? "")); } catch (e) { last = e; } }
  throw last;
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const viewAs = (personaId) => retry(() => api("POST", "/api/dev", { action: "viewAs", personaId }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const counts = async (reset = false) => (await vapi(`/zk/dev/request-count${reset ? "?reset=1" : ""}`)).json?.counts ?? {};
const PREP = ["/epoch", "/members", "/history", "/validator-key"];
const prepSum = (c) => PREP.reduce((a, p) => a + (c[p] ?? 0), 0);

console.log("\nZK Pass 2 Gate 0 — prefetch schedule, second viewpoint, supervisor");

// ---- setup ----
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
await sleep(400);
await retry(() => zk("resetZk"));
{
  const issued = await retry(() => api("POST", "/api/dev", { action: "issueTestDelegation", devicePubKey: "de".repeat(32), deviceId: "dev_z5_probe" }));
  await fetch(VBASE + "/device/auth-anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pubkey: issued.json.anchorPubKey }) });
  await retry(() => zk("register"));
  await retry(() => zk("seedDecoys", { count: 80 }));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("setRelay", { kind: "direct" }));
  await retry(() => zk("prefetchNow"));
}
const cadence = (await retry(() => zk("prefetchStatus"))).json.cadenceMs;
if (!(cadence <= 10_000)) throw new Error(`harness must start the app with a short ZK_PREFETCH_MS (got ${cadence} ms)`);

// ---- 1. the render path makes no validator request; the proof runs on the tick ----
await check("1. RENDER PATH: three For You renders under the zk binding add NO epoch/leaves/history/key requests beyond the scheduled tick; the persona is only marked WANTED; the next tick proves and queues it", async () => {
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("prefetchNow")); // a fresh snapshot for the new epoch
  await counts(true);
  const before = await counts();
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  const after = await counts();
  const window = Date.now() - t0;
  const delta = prepSum(after) - prepSum(before);
  // at most ONE scheduled tick can land inside the render window
  const ticksPossible = Math.ceil(window / (cadence * 0.75));
  if (delta > ticksPossible * PREP.length) throw new Error(`renders added ${delta} preparation requests in ${window} ms (a tick is ${PREP.length}; ${ticksPossible} tick(s) possible): ${JSON.stringify(after)}`);
  const st = (await retry(() => zk("gateStatus"))).json;
  const wanted = st.attempts.filter((a) => a.stage === "wanted");
  if (wanted.length === 0) throw new Error("no 'wanted' attempt was recorded by the render");
  const proved = st.attempts.filter((a) => a.queuedId);
  // the proof happens on a tick, not at render: force one and look again
  const tick = (await retry(() => zk("prefetchNow"))).json;
  if (!tick.tick?.ok) throw new Error("tick failed: " + tick.tick?.error);
  const st2 = (await retry(() => zk("gateStatus"))).json;
  const provedNow = st2.attempts.filter((a) => a.queuedId || a.skipped);
  if (provedNow.length <= proved.length && !st2.attempts.some((a) => a.skipped)) throw new Error("the tick did not prove the wanted persona: " + JSON.stringify(st2.attempts.slice(-3)));
});

// ---- 2. cadence independent of proof activity ----
await check("2. CADENCE: prefetch ticks arrive on the jittered schedule whether the app is idle or hammered with eligibility requests — the fetch cadence carries no information about proof activity", async () => {
  const ticksAt = async () => (await retry(() => zk("prefetchStatus"))).json.ticks.map((t) => t.at);
  const last = (xs) => (xs.length ? xs[xs.length - 1] : 0);
  // SETTLE before each window, so the two windows share a phase and neither
  // inherits the cost of the tick that preceded it. Check 1 marks a persona
  // WANTED; the first tick after that PROVES and queues it, which stretches
  // that one period. Opening the idle window on top of it measured the cost
  // of proving, not the fetch cadence — and the busy window, whose personas
  // are already satisfied for the epoch, skipped that work. (Ring buffer:
  // compare the newest timestamp, never the array length, which caps at 50.)
  const settle = async (label) => {
    const before = last(await ticksAt());
    const deadline = Date.now() + cadence * 3;
    while (Date.now() < deadline) {
      await sleep(200);
      if (last(await ticksAt()) > before) return;
    }
    throw new Error(`${label}: no tick landed within ${cadence * 3} ms — the prefetch loop is not running`);
  };
  // Six periods, not three: the comparison below is a MEAN over 5+ gaps
  // rather than a count over ~3, because a count is phase-sensitive (one
  // tick either side of a window boundary moves it) and a mean is not.
  const WINDOW = cadence * 6.2;
  await settle("idle");
  const idle0 = await ticksAt();
  await sleep(WINDOW);
  const idleNew = (await ticksAt()).filter((t) => !idle0.includes(t));
  // hammer: many renders + explicit requests in the same span
  await settle("busy");
  const busy0 = await ticksAt();
  const t0 = Date.now();
  while (Date.now() - t0 < WINDOW) {
    await retry(() => zk("requestEligibility", { personaId: MAIN }));
    await retry(() => zk("requestEligibility", { personaId: ALT }));
    await sleep(150);
  }
  const busyNew = (await ticksAt()).filter((t) => !busy0.includes(t));
  const gaps = (xs) => xs.slice(1).map((t, i) => t - xs[i]);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const spacing = {};
  for (const [label, xs] of [["idle", idleNew], ["busy", busyNew]]) {
    if (xs.length < 4) throw new Error(`${label}: only ${xs.length} ticks in ${Math.round(WINDOW)} ms — the schedule is not running at the cadence`);
    // UNCHANGED, and still the real detector: a tick injected by activity
    // lands between two scheduled ones, i.e. as a gap BELOW the jitter band.
    for (const gap of gaps(xs)) if (gap < cadence * 0.6 || gap > cadence * 1.6) throw new Error(`${label}: a tick gap of ${gap} ms is outside the jitter band around ${cadence} ms`);
    spacing[label] = mean(gaps(xs));
  }
  if (Math.abs(spacing.busy - spacing.idle) > cadence * 0.5) throw new Error(`activity changed the tick spacing: idle mean ${Math.round(spacing.idle)} ms vs busy mean ${Math.round(spacing.busy)} ms (cadence ${cadence} ms)`);
});

// ---- 3. the second viewpoint: a forked anonymous view is refused ----
await check("3. SECOND VIEWPOINT: when the validator serves a different history head to the anonymous path than to the identified one, the client REFUSES to prove and the label fails naming the split view; when the views agree it proves", async () => {
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("splitView", { tree: "tier-2", on: true }));
  const snap = (await retry(() => zk("prefetchNow"))).json;
  if (!snap.snapshot?.anonHead) throw new Error("no anonymous head in the snapshot: " + snap.snapshot?.anonHeadError);
  const out = await zk("prove", { claimKind: "tier-membership", tree: "tier-2", personaId: MAIN, gateId: "foryou" });
  if (out.status !== 422 || out.json.stage !== "root" || !/SPLIT VIEW/.test(out.json.reason)) throw new Error(`forked anonymous view was not refused: ${out.status} ${JSON.stringify(out.json).slice(0, 200)}`);
  const v = (await retry(() => zk("privacyConditions"))).json;
  const floor = v.conditions.find((c) => c.key === "floor");
  if (floor.ok || !/SPLIT VIEW/.test(floor.detail)) throw new Error("label's floor condition did not fail on the split view: " + floor.detail);
  await retry(() => zk("splitView", { tree: "tier-2", on: false }));
  await retry(() => zk("prefetchNow"));
  const ok2 = await zk("prove", { claimKind: "tier-membership", tree: "tier-2", personaId: MAIN, gateId: "foryou" });
  if (!ok2.json.ok) throw new Error(`with agreeing views the proof was refused at ${ok2.json.stage}: ${ok2.json.reason}`);
  const v2 = (await retry(() => zk("privacyConditions"))).json;
  if (!/second viewpoint agrees/.test(v2.conditions.find((c) => c.key === "floor").detail)) throw new Error("label does not state that the second viewpoint agrees");
});

// ---- 4. the second viewpoint through the relay ----
let relay = null;
await check("4. Through an OHTTP relay the anonymous head is fetched via the gateway (the relay forwards it; the gateway routes the inner GET) and the snapshot carries it", async () => {
  relay = await startRelay({ gateway: VBASE });
  await retry(() => zk("setRelay", { kind: "ohttp", url: relay.url, thirdParty: false }));
  const before = relay.stats.forwarded;
  const snap = (await retry(() => zk("prefetchNow"))).json;
  if (!snap.snapshot?.anonHead) throw new Error("no anonymous head through the relay: " + snap.snapshot?.anonHeadError);
  if (!(relay.stats.forwarded > before)) throw new Error("the relay did not forward the head fetch (the client went direct?)");
  await retry(() => zk("setRelay", { kind: null }));
  await retry(() => zk("prefetchNow"));
});

// ---- 5. the supervisor ----
await check("5. SUPERVISOR: the validator killed with /F comes back on its own within 20 s and validator/deaths.log records the death with its exit code and the last log lines", async () => {
  const pid = execSync(`powershell.exe -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort ${process.env.LAYERS_VALIDATOR_PORT || 4001} -ErrorAction SilentlyContinue).OwningProcess"`, { encoding: "utf8" }).trim().split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) throw new Error("could not find the validator pid on the pinned validator port");
  const logPath = "validator/deaths.log";
  const linesBefore = existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n").length : 0;
  execSync(`powershell.exe -NoProfile -Command "taskkill /PID ${pid} /F"`, { stdio: "ignore" });
  let back = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const r = await fetch(VBASE + "/zk/validator-key");
      if (r.status === 200) { back = true; break; }
    } catch {}
  }
  if (!back) throw new Error("validator did not come back within 20 s — is it running under npm run validator:supervised?");
  const pid2 = execSync(`powershell.exe -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort ${process.env.LAYERS_VALIDATOR_PORT || 4001} -ErrorAction SilentlyContinue).OwningProcess"`, { encoding: "utf8" }).trim().split(/\s+/)[0];
  if (pid2 === pid) throw new Error("the same pid answered — the kill did not happen?");
  const log = readFileSync(logPath, "utf8");
  const entries = log.split("\n").filter((l) => /EXITED code=/.test(l));
  if (log.split("\n").length <= linesBefore || entries.length === 0) throw new Error("no death record was written");
  const last = entries[entries.length - 1];
  if (!/code=\d+ \(0x[0-9a-f]+\)/.test(last)) throw new Error("death record lacks the exit code: " + last);
  if (!/  \| /.test(log.slice(log.lastIndexOf(last)))) throw new Error("death record lacks the last log lines");
  // the app's next tick sees the validator again
  await retry(() => zk("prefetchNow"));
});

// ---- 6. structural ----
await check("6. STRUCTURAL: the product trigger (requestEligibility) performs no fetch; the label reads only the prefetch snapshot; the anonymous head endpoint is mounted before the JSON parser with the header allowlist", async () => {
  const gate = readFileSync("lib/zk/gate.ts", "utf8");
  const trigger = gate.slice(gate.indexOf("export function requestEligibility"), gate.indexOf("export async function runWantedProofs"));
  // network fetches only (`ensurePrefetchLoop(` is the schedule, not a fetch)
  if (/(^|[^A-Za-z])fetch\w*\(|prepareAndProve|validatorClient/.test(trigger)) throw new Error("requestEligibility still fetches or proves at render time");
  const privacy = readFileSync("lib/zk/privacy.ts", "utf8");
  if (/fetchEpoch|fetchMembers|fetchHistory|verifyRootAgainstHistory\(/.test(privacy)) throw new Error("the label fetches at render time");
  const anon = readFileSync("validator/anon.js", "utf8");
  if (!/app\.get\("\/zk\/anon\/head"/.test(anon) || !/hasOnlyAllowedHeaders\(req\.headers\)/.test(anon.slice(anon.indexOf('"/zk/anon/head"')))) throw new Error("anonymous head endpoint missing or not allowlisted");
  const server = readFileSync("validator/server.js", "utf8");
  // PERSONA LAUNCH P2 (verify): the parser now carries an explicit limit (express.json({ limit: STATE_BODY_LIMIT_BYTES }),
  // validator/limits.js), so the literal "app.use(express.json())" vanished and this order check failed. It now finds the
  // FIRST express.json( call in any form, and both anchors must exist (a missing one used to compare -1 and could pass).
  const anonAt = server.indexOf("mountAnon(app, db)");
  const jsonAt = server.search(/express\.json\(/);
  if (anonAt < 0 || jsonAt < 0) throw new Error("cannot find mountAnon(app, db) (" + anonAt + ") or the JSON parser (" + jsonAt + ") in validator/server.js");
  if (anonAt > jsonAt) throw new Error("anon routes mounted after the JSON parser");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (!pkg.scripts["validator:supervised"]) throw new Error("npm run validator:supervised is missing");
});

await retry(() => zk("setRelay", { kind: null }));
await retry(() => zk("setRepImpl", { impl: null }));
await viewAs(null);
if (relay) await relay.close();
await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(`\n${results.length - fails.length - infra.length}/${results.length} ZK Pass 2 Gate 0 checks passed` + (fails.length ? `, ${fails.length} FAILED` : "") + (infra.length ? `, ${infra.length} infra` : ""));
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
