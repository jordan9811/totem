// ZK PASS 1 — GATE 2: the tier-threshold membership gate on For You.
// FIXTURE-SAFE (fixture transport; the anonymous channel; the local
// validator). The full lifecycle: prove at idle → queue → drain over the
// anonymous channel → the validator verifies against the CURRENT signed
// root (one-epoch grace) → records the nullifier → marks the persona
// eligible → the persona appears as a discovery candidate for OTHER
// viewers. Plus every refusal: tampered proof, replay, wrong epoch past
// the grace, proof-history budget exceeded (client-side), and the rule
// that tierFor under zk never performs a root-side lookup.
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const OTHER_VIEWER = "persona_acc_food_1"; // a seeded persona of ANOTHER root

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
const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;
const seedPostBy = (persona) => posts.find((p) => p.authorPersonaId === persona && !p.replyToHash);
const OUR_HASHES = new Set(posts.filter((p) => p.authorPersonaId === MAIN || p.authorPersonaId === ALT).map((p) => p.hash));
const ALT_POST = seedPostBy(ALT)?.hash;
const accOf = new Map(posts.map((p) => [p.authorPersonaId, p.authorAccId]));

/** discovery cards as another viewer: hashes on the surface. A viewer
 * always sees its OWN root's posts (its personas and their siblings) —
 * the gate is about OTHER viewers — so own-root posts are excluded from
 * the candidate count here. */
async function discoveryAs(viewer) {
  await viewAs(viewer);
  const r = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  await viewAs(null);
  // only "post" cards are discovery CANDIDATES (readwise / sent / folder /
  // highlight / ad / caught-up cards come from the viewer's own schedules
  // and follows, and the gate does not apply to them)
  const viewerAcc = accOf.get(viewer);
  const cards = (r.json.cards ?? []).filter((c) => c.kind === "post" && c.cast?.hash);
  const notOwn = cards.filter((c) => accOf.get(c.cast.personaId ?? c.cast.author?.username) !== viewerAcc);
  const hashes = notOwn.map((c) => c.cast.hash);
  return { hashes, count: hashes.length, ownCount: cards.length - notOwn.length, hasAltPost: hashes.includes(ALT_POST), foreign: hashes.filter((h) => !OUR_HASHES.has(h)) };
}

console.log("\nZK Gate 2 — the tier-threshold gate on For You: proof-mediated eligibility, every refusal, tierFor never root-side");

// ---- setup ----
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
await sleep(400);
await retry(() => zk("resetZk"));
{
  const issued = await retry(() => api("POST", "/api/dev", { action: "issueTestDelegation", devicePubKey: "cd".repeat(32), deviceId: "dev_z2_probe" }));
  await fetch(VBASE + "/device/auth-anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pubkey: issued.json.anchorPubKey }) });
  await retry(() => zk("register"));
  await retry(() => zk("seedDecoys", { count: 80 }));
  await retry(() => zk("advanceEpoch"));
}
const eligibilityOf = async (persona) => (await retry(() => zk("gateStatus", { personaIds: [persona] }))).json.eligibility[persona];
const gate0 = (await retry(() => zk("gateStatus"))).json;
const TREE = gate0.tree;
const T = Number(TREE.slice(5));
const commitment = (await retry(() => zk("probe"))).json.commitment;
{
  const m = (await vapi(`/zk/members?mode=fixture&tree=${TREE}`)).json;
  if (!m.members.includes(commitment)) throw new Error(`setup: our root is not in ${TREE} (root tier below the gate threshold ${T}) — cannot test the gate`);
}
if (!ALT_POST) throw new Error("setup: persona_viewer_alt has no seeded top-level post (0xvw0001) to appear on discovery with — regenerate the seed");

// ---- 1. tierFor under zk is proof-mediated, never root-side ----
await check("1. Under ADAPTER_REP=zk, tierFor returns what the persona PROVED (0 before any proof, whatever its root's rep) — and the adapter has no root-side lookup (grep)", async () => {
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  const reg = (await retry(() => api("GET", "/api/dev"))).json.registry;
  if (reg.rep !== "zk") throw new Error(`registry reports rep=${reg.rep}`);
  const t = (await retry(() => api("GET", `/api/tier?personaId=${ALT}`))).json;
  if (t.tier !== 0) throw new Error(`unproven persona has tier ${t.tier} under zk — a root-side lookup leaked through`);
  // code only — the file's header comment names the forbidden lookups precisely so a reader knows they are absent
  const code = readFileSync("lib/adapters/zk/rep.ts", "utf8").split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
  if (/rootId|\/rep\/|tierForRoot|personasForRoot|personasByFid/.test(code)) throw new Error("lib/adapters/zk/rep.ts references a root-side lookup");
});

// ---- 2. the surface before any proof, under both fallbacks ----
await check("2. Discovery BEFORE any proof: fallback=none hides every unproven author (ours included); fallback=policy is the explicit, disclosed legacy path", async () => {
  await retry(() => zk("setGateFallback", { fallback: "none" }));
  const none = await discoveryAs(OTHER_VIEWER);
  if (none.hasAltPost) throw new Error("our unproven persona's post appears on another viewer's For You under fallback=none");
  if (none.count !== 0) throw new Error(`unproven seeded authors appear under fallback=none (${none.count} cards: ${none.hashes.slice(0, 3).join(",")})`);
  await retry(() => zk("setGateFallback", { fallback: "policy" }));
  const policy = await discoveryAs(OTHER_VIEWER);
  if (policy.count === 0) throw new Error("fallback=policy did not restore the legacy discovery feed");
  await retry(() => zk("setGateFallback", { fallback: "none" }));
});

// ---- 3. the full lifecycle: prove at idle → queue → drain → eligible → appears ----
await check("3. LIFECYCLE: prove → jittered queue → anonymous submission → validator verifies + records → tierFor == proven tier → our persona's post APPEARS on another viewer's For You", async () => {
  const q = await retry(() => zk("enqueue", { claimKind: "tier-membership", tree: TREE, personaId: ALT, gateId: "foryou", jitterMinMs: 200, jitterMaxMs: 900 }));
  await sleep(q.json.notBefore - Date.now() + 150);
  // Drain, then judge the ITEM's terminal state — not this call's report:
  // the in-process loop (every 5 s) may legitimately have sent it first.
  // The lifecycle under test is enqueue → ONE anonymous submission →
  // accepted; "exactly one" is asserted too (drains are serialized).
  await retry(() => zk("drain"));
  let it = null;
  for (let i = 0; i < 12; i++) {
    const qs = (await retry(() => zk("queueStatus"))).json;
    it = qs.items.find((x) => x.id === q.json.id) ?? null;
    if (it && it.status !== "queued") {
      const sentForAlt = qs.items.filter((x) => x.personaId === ALT && x.epoch === it.epoch && x.status === "sent");
      if (sentForAlt.length !== 1) throw new Error(`ALT has ${sentForAlt.length} sent submissions this epoch — one is one`);
      break;
    }
    await sleep(500);
  }
  if (!it || it.status !== "sent" || it.outcome !== "accepted") throw new Error(`queued item after drain: ${JSON.stringify(it)}`);
  const e = await eligibilityOf(ALT);
  if (!e || e.tier < T) throw new Error(`validator eligibility: ${JSON.stringify(e)}`);
  // the eligibility store is NOT a public feed: an unsigned read is refused (armed deployment)
  const raw = await vapi(`/zk/eligibility?mode=fixture&gateId=foryou&personaId=${ALT}`);
  if (raw.status !== 401) throw new Error(`an unsigned eligibility read returned ${raw.status} — the who-proved-what map is a public arrival oracle`);
  const t = (await retry(() => api("GET", `/api/tier?personaId=${ALT}`))).json;
  if (t.tier !== T) throw new Error(`tierFor after proof = ${t.tier}, expected the proven ${T}`);
  const after = await discoveryAs(OTHER_VIEWER);
  if (!after.hasAltPost) throw new Error("our PROVEN persona's post does not appear on another viewer's For You");
  if (after.foreign.length) throw new Error(`unproven authors appear under fallback=none: ${after.foreign.slice(0, 3).join(",")}`);
});

// ---- 4. tamper → refused; replay → replay ----
await check("4. A tampered proof is REFUSED by the channel (no eligibility); the clean one is accepted once; the same one again is a replay", async () => {
  const out = await retry(() => zk("prove", { claimKind: "tier-membership", tree: TREE, personaId: MAIN, gateId: "foryou" }));
  const env = out.json.envelope;
  const tampered = { ...env, publicInputs: { ...env.publicInputs, message: "7" } };
  const r1 = (await retry(() => zk("anonSubmit", { envelope: tampered }))).json;
  if (r1.outcome !== "refused") throw new Error(`tampered: ${r1.outcome}`);
  const e0 = await eligibilityOf(MAIN);
  if (e0) throw new Error("a tampered proof granted eligibility");
  // THE CLAIM BINDING (attack-2 #1): the same proof re-labelled to the
  // sibling persona grants the sibling nothing
  const relabelled = { ...env, publicInputs: { ...env.publicInputs, personaId: ALT } };
  const rl = (await retry(() => zk("anonSubmit", { envelope: relabelled }))).json;
  if (rl.outcome !== "refused") throw new Error(`re-labelled proof: ${rl.outcome}`);
  const r2 = (await retry(() => zk("anonSubmit", { envelope: env }))).json;
  if (r2.outcome !== "accepted") throw new Error(`clean: ${r2.outcome}`);
  const r3 = (await retry(() => zk("anonSubmit", { envelope: env }))).json;
  if (r3.outcome !== "replay") throw new Error(`replay: ${r3.outcome}`);
  const e1 = await eligibilityOf(MAIN);
  if (!e1 || e1.tier < T) throw new Error("clean proof did not grant eligibility");
});

// ---- 5. wrong epoch: refused past the one-epoch grace, accepted within it ----
await check("5. Epoch discipline: a proof is accepted within the one-epoch grace and REFUSED past it", async () => {
  await retry(() => zk("advanceEpoch"));
  const stale = (await retry(() => zk("prove", { claimKind: "tier-membership", tree: TREE, personaId: ALT, gateId: "foryou" }))).json.envelope;
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("advanceEpoch"));
  const past = (await retry(() => zk("anonSubmit", { envelope: stale }))).json;
  if (past.outcome !== "refused") throw new Error(`two epochs later: ${past.outcome}, expected refused`);
  const fresh = (await retry(() => zk("prove", { claimKind: "tier-membership", tree: TREE, personaId: MAIN, gateId: "foryou" }))).json.envelope;
  await retry(() => zk("advanceEpoch"));
  const grace = (await retry(() => zk("anonSubmit", { envelope: fresh }))).json;
  if (grace.outcome !== "accepted") throw new Error(`one epoch later (grace): ${grace.outcome}, expected accepted`);
});

// ---- 6. budget exceeded → refused CLIENT-SIDE, on REAL partitions ----
await check("6. Proof-history budget: two REAL partitions (valid, tier-1) proven this epoch → a third (the gate's tier tree) is REFUSED client-side (no proof is generated, nothing is sent)", async () => {
  await retry(() => zk("advanceEpoch"));
  for (const tree of ["valid", "tier-1"]) {
    const p = await zk("prove", { claimKind: "tier-membership", tree, personaId: ALT, gateId: "foryou" });
    if (!p.json.ok) throw new Error(`prove ${tree} refused at ${p.json.stage}: ${p.json.reason}`);
  }
  const out = await zk("prove", { claimKind: "tier-membership", tree: TREE, personaId: ALT, gateId: "foryou" });
  if (out.status !== 422 || out.json.stage !== "budget") throw new Error(`expected a budget refusal, got ${out.status} ${JSON.stringify(out.json).slice(0, 120)}`);
  // and re-proving an already-counted partition is not a new intersection
  const again = await zk("prove", { claimKind: "tier-membership", tree: "valid", personaId: ALT, gateId: "foryou" });
  if (!again.json.ok) throw new Error(`re-proving a counted partition was refused: ${again.json.reason}`);
});

// ---- 7. the product trigger: requestEligibility at idle ----
await check("7. The product trigger (requestEligibility) only marks the persona WANTED; the next SCHEDULED prefetch tick proves and queues it — no proof, no fetch on the request path — and it drains to eligibility", async () => {
  await retry(() => zk("advanceEpoch"));
  const cadence = (await retry(() => zk("prefetchStatus"))).json.cadenceMs;
  // THE FIXED-SCHEDULE SNAPSHOT'S OWN STRADDLE WINDOW (closing sweep 4, found by the pass's own instruments): a
  // tick's snapshot fetches identified history and the anonymous head as TWO SEPARATE round trips
  // (lib/zk/prefetch.ts prefetchOnce: history is part of the Promise.all batch, anonHead is awaited AFTER it
  // resolves). This suite alone makes SIX advanceEpoch calls (checks 5, 6 and this one) in well under a minute
  // of wall-clock time; if an in-flight tick's two fetches straddle exactly one of those, the two viewpoints
  // legitimately disagree for that ONE tick and the client correctly refuses (SPLIT VIEW BY IDENTITY) — the same
  // refusal a real forking validator would earn. Nothing was proved or queued on a refused attempt (the once-
  // per-epoch budget is only spent by a QUEUED submission), so re-marking the persona wanted and waiting for the
  // NEXT tick is safe and asserts exactly what this check is about: the trigger→schedule→prove→drain pipeline
  // eventually succeeds. Bounded to 3 outer attempts — a genuine product refusal (any OTHER stage) still fails
  // on the first attempt below.
  let attempt = null;
  for (let outer = 0; outer < 3 && !attempt; outer++) {
    const r = await retry(() => zk("requestEligibility", { personaId: MAIN }));
    if (!r.json.scheduled) throw new Error("not scheduled");
    const st0 = (await retry(() => zk("gateStatus"))).json;
    const wantedAttempt = st0.attempts.find((a) => a.personaId === MAIN && a.stage === "wanted" && a.at > Date.now() - 10_000);
    if (!wantedAttempt) throw new Error("the trigger did not record a 'wanted' attempt");
    // the proof happens on the tick, not now: wait for the schedule (never force it here)
    let candidate = null;
    const deadline = Date.now() + cadence * 3 + 5_000;
    while (Date.now() < deadline && !candidate) {
      await sleep(400);
      const st = (await retry(() => zk("gateStatus"))).json;
      candidate = st.attempts.find((a) => a.personaId === MAIN && a.at > wantedAttempt.at && a.stage !== "wanted");
    }
    if (!candidate) throw new Error(`no tick proved the wanted persona within ${Math.round(cadence * 3 / 1000) + 5} s`);
    if (!candidate.ok && candidate.stage === "root" && /SPLIT VIEW/.test(candidate.reason ?? "")) {
      console.log(`   (retry ${outer + 1}/3: a tick's snapshot straddled one of this check's own epoch advances — ${candidate.reason})`);
      continue; // re-trigger: the persona was dropped from `wanted` on the refused attempt, never retried automatically
    }
    attempt = candidate;
  }
  if (!attempt) throw new Error("three ticks in a row straddled an epoch advance — the retry budget above is not enough");
  if (!attempt.ok) throw new Error(`gate attempt refused at ${attempt.stage}: ${attempt.reason}`);
  if (attempt.skipped) throw new Error("the first trigger of the epoch was skipped");
  const d = (await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }))).json;
  if (d.sent < 1 || !d.outcomes.accepted) throw new Error(`drain: ${JSON.stringify(d)}`);
  const e = await eligibilityOf(MAIN);
  if (!e) throw new Error("no eligibility after the product trigger");
  // ONCE PER EPOCH (attack-1 #3): a second render in the same epoch does
  // not prove again — the submission rate cannot track the render rate
  const markAt = Date.now();
  await retry(() => zk("requestEligibility", { personaId: MAIN }));
  let second = null;
  const deadline2 = Date.now() + cadence * 3 + 5_000;
  while (Date.now() < deadline2 && !second) {
    await sleep(400);
    const st = (await retry(() => zk("gateStatus"))).json;
    second = st.attempts.find((a) => a.personaId === MAIN && a.at > markAt && a.stage !== "wanted");
  }
  if (!second || second.skipped !== true) throw new Error(`a second trigger in the same epoch was not skipped: ${JSON.stringify(second)}`);
});

await retry(() => zk("setGateFallback", { fallback: null }));
await retry(() => zk("setRepImpl", { impl: null }));
await viewAs(null);
await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(`\n${results.length - fails.length - infra.length}/${results.length} ZK Gate 2 checks passed` + (fails.length ? `, ${fails.length} FAILED` : "") + (infra.length ? `, ${infra.length} infra` : ""));
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
