// ZK PASS 1 — GATE 3: the COMPUTED privacy label + the posture document.
// FIXTURE-SAFE: nothing here proves live. The money shot runs in the LIVE
// universe of the LOCAL validator (a device-signed registration + a decoy
// cohort through the dev hook — no network, no spend, no proof).
//
// The label may claim privacy only when EIGHT conditions hold, every one
// COMPUTED by the app process at read time — never a stamp a caller can
// write (attack-2 finding 4 / attack-3 F-6 retired `recordCheck`). This
// suite (1) asserts the label is DEMO by default and names what fails,
// (2) asserts the conditions are computed, not settable, and runs its
// own independent scope-collision check on real nullifiers, (3) drives
// every condition true — live universe, floor-clearing cohort rebuilt to
// the signed root, attested ohttp relay, fallback none — and asserts the
// exact narrow claim, (4) flips each condition false and back, (5) checks
// the legacy binding carries no label, (6) checks SECURITY-POSTURE.md.
// SAFETY SET: computed label correctness.
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync } from "node:fs";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { Identity } from "@semaphore-protocol/identity";
import { poseidon2 } from "poseidon-lite";
import { startRelay } from "./lib-ohttp-relay.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const PRIVATE_LABEL = "your persona's root is hidden from this server at the proof layer";
const te = new TextEncoder();
const toHex = (b) => Buffer.from(b).toString("hex");

const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

await assertServersUp(BASE);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
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
const zkLive = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "live", ...extra });
const verdict = async (mode = "fixture") => (await retry(() => api("POST", "/api/zk", { action: "privacyConditions", mode }))).json;
const cond = (v, key) => v.conditions.find((c) => c.key === key);
const viewAs = (personaId) => retry(() => api("POST", "/api/dev", { action: "viewAs", personaId }));
async function labelOnHome() {
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  const el = page.locator("[data-testid=zk-privacy-label]");
  if ((await el.count()) === 0) return null;
  return { state: await el.getAttribute("data-state"), text: await el.innerText(), failing: await page.locator("[data-testid=zk-privacy-failing] li").allInnerTexts(), hasDismiss: (await el.locator("button").count()) > 0 };
}

// deliberate duplicates for the in-suite machine check
const kdf = (seed, info) => hkdf(sha256, seed, new Uint8Array(0), te.encode("layers/v1/" + info), 32);
const toBeBytes32 = (x) => { const out = new Uint8Array(32); let v = x; for (let i = 31; i >= 0; i--) { out[i] = Number(v & 255n); v >>= 8n; } return out; };
const semaphoreHash = (x) => BigInt("0x" + toHex(keccak_256(toBeBytes32(x)))) >> 8n;
const fieldOf = (domain, canonical) => BigInt("0x" + toHex(sha256(te.encode(`layers-zk-field/1|${domain}|${canonical}`)))) >> 8n;
const scopeString = (feature, epoch, personaId) => (personaId === undefined ? `layers/zk-scope/v1|${feature}|${epoch}` : `layers/zk-scope/v1|${feature}|${epoch}|${personaId}`);
const nullifierFor = (scopeValue, secret) => poseidon2([semaphoreHash(scopeValue), secret]);

console.log("\nZK Gate 3 — the computed privacy label: DEMO until every condition holds, then the narrow claim");

// ---- setup: zk binding, a registered fixture root, direct relay ----
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
await new Promise((r) => setTimeout(r, 400));
await retry(() => zk("resetZk"));
{
  const issued = await retry(() => api("POST", "/api/dev", { action: "issueTestDelegation", devicePubKey: "ba".repeat(32), deviceId: "dev_z3_probe" }));
  await fetch(VBASE + "/device/auth-anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pubkey: issued.json.anchorPubKey }) });
  await retry(() => zk("register"));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("setRelay", { kind: "direct" }));
  await retry(() => zk("setGateFallback", { fallback: "none" }));
  await retry(() => zk("setZkMode", { zkMode: "fixture" }));
  await retry(() => zk("prefetchNow")); // the label reads the prefetch snapshot, never the wire
}

// ---- 1. DEMO by default, non-dismissable, names every failing condition ----
await check("1. Default (direct relay, thin cohort, fixture universe): the surface shows the non-dismissable DEMO label naming relay, floor and universe as failing — while the in-process conditions (jitter, scopes, ceremony, budget, fallback) already hold on their own", async () => {
  const v = await verdict("fixture");
  if (v.private) throw new Error("claimed private with a direct relay, a thin cohort and the fixture universe");
  if (v.conditions.length !== 8) throw new Error(`expected 8 conditions, got ${v.conditions.length}`);
  for (const k of ["relay", "floor", "universe"]) if (!v.failing.some((f) => f.startsWith(k + ":"))) throw new Error(`failing list does not name ${k}: ${JSON.stringify(v.failing)}`);
  for (const k of ["jitter", "scopes", "ceremony", "budget", "fallback"]) if (cond(v, k)?.ok !== true) throw new Error(`in-process condition ${k} does not hold on its own: ${cond(v, k)?.detail}`);
  const l = await labelOnHome();
  if (!l) throw new Error("no label rendered on the discovery surface");
  if (l.state !== "demo" || !/DEMO — not yet private/.test(l.text)) throw new Error(`label state ${l.state}: ${l.text.slice(0, 80)}`);
  if (l.hasDismiss) throw new Error("the DEMO label has a dismiss control");
  if (l.failing.length < 3) throw new Error(`label lists ${l.failing.length} failing conditions`);
});

// ---- 2. the conditions are COMPUTED, not settable; the suite's own check agrees ----
await check("2. The conditions are computed in-process and cannot be written by a caller (no recordCheck; a hostile epoch shape is refused; the budget counts real partitions) — and the suite's own scope-collision check on REAL nullifiers agrees with the app", async () => {
  const rc = await api("POST", "/api/zk", { action: "recordCheck", mode: "fixture", name: "scopeCollision", passed: true });
  if (rc.status !== 400) throw new Error(`a caller can still write a check result (recordCheck → ${rc.status})`);
  const v = await verdict("fixture");
  if (!/computed now/.test(cond(v, "scopes").detail)) throw new Error("scope condition is not described as computed now: " + cond(v, "scopes").detail);
  if (!/refused/.test(cond(v, "jitter").detail) || !/scheduler-level/.test(cond(v, "jitter").detail)) throw new Error("jitter condition does not evidence hostile-shape refusal / state its scope: " + cond(v, "jitter").detail);
  if (!/partitions/.test(cond(v, "budget").detail) || !/NOT bounded/.test(cond(v, "budget").detail)) throw new Error("budget condition does not count partitions / state its residual: " + cond(v, "budget").detail);
  if (!/key both verifiers use/.test(cond(v, "ceremony").detail)) throw new Error("ceremony condition does not assert the key the verifiers USE: " + cond(v, "ceremony").detail);
  const hostile = (await zk("jitterProbe", { epochShape: { epochMs: 0, msRemaining: 0 } })).json;
  if (hostile.ok) throw new Error("a zero-length epoch collapsed the jitter window instead of being refused");
  // the suite's OWN scope-collision check, on real nullifiers, cross-checked with the app's derivation
  const ks = JSON.parse(readFileSync(".keystore/root.json", "utf8"));
  const id = new Identity(kdf(new Uint8Array(Buffer.from(ks.rootSecretHex, "hex")), "zk-identity/1"));
  const reg = (await retry(() => zk("nullifierProbe", { items: [] }))).json.registry;
  for (const e of reg) {
    if (e.onePerHuman) continue;
    const a = nullifierFor(fieldOf("scope", scopeString(e.feature, 99, MAIN)), id.secretScalar);
    const b = nullifierFor(fieldOf("scope", scopeString(e.feature, 99, ALT)), id.secretScalar);
    if (a === b) throw new Error(`${e.id}: two personas of one root share a nullifier`);
    const app = (await retry(() => zk("nullifierProbe", { items: [{ entryId: e.id, epoch: 99, personaId: MAIN }] }))).json.nullifiers[0];
    if (app.nullifier !== a.toString(10)) throw new Error(`${e.id}: app nullifier != suite nullifier`);
  }
});

// ---- 3. MONEY SHOT: live universe + floor-clearing cohort + attested relay + fallback none → PRIVATE ----
let relay = null;
await check("3. MONEY SHOT: live universe, a floor-clearing cohort the client rebuilds to the signed root, an attested ohttp relay, fallback none → all eight conditions hold → the label flips to the exact narrow claim (never 'anonymous', never 'untraceable')", async () => {
  await retry(() => zkLive("setZkMode", { zkMode: "live" }));
  await retry(() => zkLive("register"));
  const floor = (await retry(() => api("GET", "/api/zk?mode=live"))).json.status.floor;
  await retry(() => zkLive("seedDecoys", { count: floor + 40 }));
  await retry(() => zkLive("advanceEpoch"));
  await retry(() => zkLive("prefetchNow"));
  relay = await startRelay({ gateway: VBASE });
  await retry(() => zk("setRelay", { kind: "ohttp", url: relay.url, thirdParty: true }));
  const v = await verdict("live");
  if (!v.private) throw new Error(`still DEMO: ${JSON.stringify(v.failing)}`);
  if (v.label !== PRIVATE_LABEL) throw new Error(`private label text is not the exact narrow claim: "${v.label}"`);
  if (!/leaves rebuild to the signed root/.test(cond(v, "floor").detail) || !/client's floor/.test(cond(v, "floor").detail)) throw new Error("floor condition is not computed from the leaves against the client's floor: " + cond(v, "floor").detail);
  if (!/second viewpoint agrees/.test(cond(v, "floor").detail)) throw new Error("floor condition does not carry the second viewpoint: " + cond(v, "floor").detail);
  const l = await labelOnHome();
  if (!l || l.state !== "private") throw new Error(`surface label state: ${l?.state} ${l?.failing?.join("; ")}`);
  if (!l.text.includes(PRIVATE_LABEL)) throw new Error("surface does not show the narrow claim");
  if (/anonymous|untraceable/i.test(l.text)) throw new Error("the private label overclaims");
});

// ---- 4. each condition, driven false, flips it back to DEMO ----
await check("4. Any single condition failing flips the label back to DEMO: direct relay; unattested relay; fallback=policy; the fixture universe; a cohort below the floor — and back", async () => {
  await retry(() => zk("setRelay", { kind: "direct" }));
  let v = await verdict("live");
  if (v.private || !v.failing.some((f) => f.startsWith("relay:"))) throw new Error("direct relay did not fail the relay condition");
  await retry(() => zk("setRelay", { kind: "ohttp", url: relay.url, thirdParty: false }));
  v = await verdict("live");
  if (v.private || !v.failing.some((f) => /relay:.*NOT attested/.test(f))) throw new Error("unattested relay did not fail the relay condition");
  await retry(() => zk("setRelay", { kind: "ohttp", url: relay.url, thirdParty: true }));
  await retry(() => zk("setGateFallback", { fallback: "policy" }));
  v = await verdict("live");
  if (v.private || !v.failing.some((f) => f.startsWith("fallback:"))) throw new Error("fallback=policy did not fail the fallback condition");
  await retry(() => zk("setGateFallback", { fallback: "none" }));
  v = await verdict("fixture");
  if (v.private || !v.failing.some((f) => f.startsWith("universe:"))) throw new Error("the fixture universe did not fail the universe condition");
  // a thin cohort in the SAME universe: the fixture tier tree holds our root alone
  if (!v.failing.some((f) => /floor:.*below the client's anonymity floor/.test(f))) throw new Error("a thin cohort did not fail the floor condition: " + JSON.stringify(v.failing));
  v = await verdict("live");
  if (!v.private) throw new Error(`did not return to private: ${JSON.stringify(v.failing)}`);
  const l = await labelOnHome();
  if (l?.state !== "private") throw new Error(`surface did not return to private — state ${l?.state}, failing: ${JSON.stringify(l?.failing)}; API verdict now: ${JSON.stringify((await verdict("live")).failing)}`);
});

// ---- 5. the legacy binding shows no zk label at all ----
await check("5. Under the legacy rep binding the discovery surface carries no zk label (the gate is not active, so it claims nothing)", async () => {
  await retry(() => zk("setRepImpl", { impl: null }));
  const l = await labelOnHome();
  if (l) throw new Error("a zk label rendered while the gate is not active");
  await retry(() => zk("setRepImpl", { impl: "zk" }));
});

// ---- 6. SECURITY-POSTURE.md ----
await check("6. SECURITY-POSTURE.md exists with the required sections, the eight conditions, the exact label semantics, and the assumptions the adversarial reviews forced", async () => {
  const doc = readFileSync("SECURITY-POSTURE.md", "utf8");
  for (const h of ["What is now mathematically hidden", "What the operator can still do", "What is ASSUMED", "What \"private\" means", "GPL-3", "Mobile proving", "Topology"]) if (!doc.includes(h)) throw new Error(`missing section: ${h}`);
  if (!doc.includes(PRIVATE_LABEL)) throw new Error("the posture doc does not state the exact private label text");
  if (!/DEMO — not yet private/.test(doc)) throw new Error("the posture doc does not state the DEMO label");
  for (const id of ["F1", "F2", "F3", "F4", "F5", "F8", "F9", "F10"]) if (!doc.includes(id)) throw new Error(`posture doc does not list VERIFY-YOURSELF ${id}`);
  for (const a of ["A-COHORT-ROTATION", "A-TOPOLOGY", "A-PREPARE-BURST", "A-DEV-SURFACE", "A-VERIFIER-MONOCULTURE", "A-PRESENCE-LOG", "A-RELAY-PASSIVE-JOIN"]) if (!doc.includes(a)) throw new Error(`posture doc lacks assumption ${a}`);
  for (const w of ["universe is LIVE", "fallback is `none`"]) if (!doc.includes(w)) throw new Error(`posture doc does not state label condition: ${w}`);
});

await retry(() => zk("setRelay", { kind: null }));
await retry(() => zk("setGateFallback", { fallback: null }));
await retry(() => zk("setRepImpl", { impl: null }));
await retry(() => zk("setZkMode", { zkMode: null }));
await viewAs(null);
if (relay) await relay.close();
await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(`\n${results.length - fails.length - infra.length}/${results.length} ZK Gate 3 checks passed` + (fails.length ? `, ${fails.length} FAILED` : "") + (infra.length ? `, ${infra.length} infra` : ""));
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
