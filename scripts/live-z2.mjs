// ZK PASS 1 — live-z2: the REAL prover end to end. Never in sweeps.
//
// Registers the root in the LIVE universe, proves "my root is in
// zkTier[T]" with stock Semaphore v4 (Groth16 in the worker), self-verifies
// against the build-pinned vkey, submits over the anonymous channel, the
// validator verifies with snarkjs and records eligibility, tierFor (zk)
// returns the proven tier, and the persona appears on another viewer's
// For You. Proving times are logged; screenshots saved to shots/.
//
// A green run proves the gate WORKS. It does not prove the gate is
// PRIVATE — the label (Gate 3) and SECURITY-POSTURE.md say what would.
import { chromium } from "playwright";
import { assertServersUp } from "./lib-health.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_alt"; // the persona with a seeded post (0xvw0001) to appear on discovery with
const ALT_POST = "0xvw0001";
const OTHER_VIEWER = "persona_acc_food_1";
mkdirSync("shots", { recursive: true });

await assertServersUp(BASE);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = JSON.parse(await res.text()); } catch {}
  return { status: res.status(), json };
}
async function vapi(path) { const r = await fetch(VBASE + path); return { status: r.status, json: await r.json().catch(() => null) }; }
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) { try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.json?.reason ?? JSON.stringify(r.json)?.slice(0, 200) ?? "")); } catch (e) { last = e; } }
  throw last;
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "live", ...extra });
const viewAs = (personaId) => retry(() => api("POST", "/api/dev", { action: "viewAs", personaId }));
const log = {};
const step = (k, v) => { log[k] = v; console.log(`  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`); };

console.log("\nlive-z2 — real Semaphore v4 proof, end to end (LIVE universe)");
try {
  await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
  await retry(() => zk("setZkMode", { zkMode: "live" }));
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("setGateFallback", { fallback: "none" }));
  await retry(() => zk("setRelay", { kind: "direct" }));
  const issued = await retry(() => api("POST", "/api/dev", { action: "issueTestDelegation", devicePubKey: "ab".repeat(32), deviceId: "dev_livez2" }));
  await fetch(VBASE + "/device/auth-anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pubkey: issued.json.anchorPubKey }) });

  const reg = await retry(() => zk("register"));
  step("registration", { existing: reg.json.existing === true, activeFromEpoch: reg.json.activeFromEpoch });
  // the client refuses to prove below its anonymity floor, so the live
  // universe gets a decoy cohort (dev hook; the operator-fabricated cohort
  // C1 admits — stated in the report)
  const floor = (await retry(() => api("GET", "/api/zk?mode=live"))).json.status.floor;
  const seeded = await retry(() => zk("seedDecoys", { count: floor + 20 }));
  step("decoys", { requested: floor + 20, inserted: seeded.json.response?.inserted });
  await retry(() => zk("advanceEpoch"));
  const s = (await retry(() => api("GET", "/api/zk?mode=live"))).json.status;
  step("status", { epoch: s.epoch, registered: s.registration?.registered, placementVerified: s.placement?.verified, vkeyPin: s.vkeyPin.ok, artifactsCached: s.artifactsCached });
  const gate = (await retry(() => zk("gateStatus"))).json;
  const TREE = gate.tree;
  const T = Number(TREE.slice(5));
  const members = (await vapi(`/zk/members?mode=live&tree=${TREE}`)).json;
  step("tree", { tree: TREE, size: members.members.length, ours: members.members.includes(s.commitment) });
  if (!members.members.includes(s.commitment)) throw new Error(`our root is not in ${TREE} in the live universe`);

  // BEFORE: not eligible, not on the surface
  await viewAs(OTHER_VIEWER);
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.screenshot({ path: "shots/live-z2-foryou-before.png", fullPage: false });
  const before = (await retry(() => api("GET", "/api/feed2?surface=discovery"))).json.cards.length;
  await viewAs(null);
  const tierBefore = (await retry(() => api("GET", `/api/tier?personaId=${MAIN}`))).json.tier;
  step("before", { discoveryCardsAsOtherViewer: before, tierForMain: tierBefore });

  // PROVE (real Groth16 in the worker), self-verified against the pinned vkey
  const t0 = performance.now();
  const proved = await retry(() => zk("prove", { claimKind: "tier-membership", tree: TREE, personaId: MAIN, gateId: "foryou", mode: "live" }), 2);
  const proveWall = performance.now() - t0;
  const env = proved.json.envelope;
  step("prove", { ok: proved.json.ok, scheme: env.proof.scheme, depth: env.proof.merkleTreeDepth, provingMs: Math.round(proved.json.provingMs ?? -1), wallMs: Math.round(proveWall), nullifier: env.nullifier.slice(0, 12) + "…", cohort: proved.json.cohort ? { size: proved.json.cohort.size, floor: proved.json.cohort.floor, firstSight: proved.json.cohort.continuity?.firstSight } : null });
  // a tampered live proof must fail LOCAL verification (groth16 verify false)
  const v1 = performance.now();
  const tam = (await retry(() => zk("verify", { envelope: { ...env, publicInputs: { ...env.publicInputs, message: "5" } } }))).json;
  step("verifyTampered", { ok: tam.ok, code: tam.code, ms: Math.round(performance.now() - v1) });
  if (tam.ok) throw new Error("a tampered live proof verified locally");
  const v2 = performance.now();
  const okv = (await retry(() => zk("verify", { envelope: env }))).json;
  step("verifyClean", { ok: okv.ok, ms: Math.round(performance.now() - v2) });

  // SUBMIT over the anonymous channel; the validator verifies with snarkjs
  const sub = (await retry(() => zk("anonSubmit", { envelope: env }))).json;
  step("anonSubmit", { outcome: sub.outcome, relay: sub.relay, ms: Math.round(sub.ms), powMs: Math.round(sub.powMs), bytes: sub.bytes });
  if (sub.outcome !== "accepted") throw new Error("live submission not accepted");
  const e = (await retry(() => zk("gateStatus", { personaIds: [MAIN] }))).json.eligibility[MAIN];
  step("eligibility", e);
  const tierAfter = (await retry(() => api("GET", `/api/tier?personaId=${MAIN}`))).json.tier;
  step("tierForMainAfter", tierAfter);
  if (tierAfter !== T) throw new Error(`tierFor = ${tierAfter}, expected ${T}`);

  // AFTER: on the surface for another viewer
  await viewAs(OTHER_VIEWER);
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.screenshot({ path: "shots/live-z2-foryou-after.png", fullPage: false });
  const afterCards = (await retry(() => api("GET", "/api/feed2?surface=discovery"))).json.cards.filter((c) => c.kind === "post");
  await viewAs(null);
  const mine = afterCards.filter((c) => c.cast?.hash === ALT_POST).length;
  step("after", { discoveryCardsAsOtherViewer: afterCards.length, oursOnSurface: mine });
  if (mine < 1) throw new Error("proven persona's post not on the other viewer's For You");

  // replay → replay
  const re = (await retry(() => zk("anonSubmit", { envelope: env }))).json;
  step("replay", re.outcome);
  log.ok = true;
  console.log("\nlive-z2 PASSED — real proof round-tripped; times above");
} catch (e) {
  log.ok = false;
  log.error = e.message;
  console.log("\nlive-z2 FAILED — " + e.message);
} finally {
  await zk("setRelay", { kind: null });
  await zk("setGateFallback", { fallback: null });
  await zk("setRepImpl", { impl: null });
  await zk("setZkMode", { zkMode: null });
  await viewAs(null);
  writeFileSync("shots/live-z2.json", JSON.stringify({ at: new Date().toISOString(), ...log }, null, 2));
  await browser.close();
  process.exitCode = log.ok ? 0 : 1;
}
