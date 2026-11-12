// PERSONA LAUNCH P5 — acceptance (fixture rig): REACH TIERS AND THE FOR YOU BOOST, end to end through the product path.
//   0. SESSION: fresh universe under the zk binding; 300 decoys + this root, leaves of `valid` (wave 3, L3: enough that
//      every tier leaves the floor of 50 in the band below it, judged on SIZES against the plain anon tree — tier-2 on
//      the rig, which leaves out the decoys seeded at tier 1 — so about 270 roots in it against gte-1k's 181, 60 holding
//      only gte-1k, 71 gte-10k but not gte-100k: lib/attest/fid/fixture.ts cohortFollowers); this root signs in with
//      its fixture Farcaster account (fixture-main, fid 9200001) — the ONLY account fc.reach will read
//   1. THE SCORE ENTRY: with the main account's Neynar score at 0.6, fc.reach issues nothing (409, plain words) and the
//      root holds no tier
//   2. 49 IN THE 100k+ TIER, NOT OURS: the main account at 50k followers is issued gte-1k + gte-10k with the decoy cohort
//      (the fixture spread: EXACTLY 49 decoys in gte-100k). Next epoch GET /api/reach and GET /api/anon offer gte-10k
//      and gte-1k only, the default is gte-10k, and gte-100k is offered by NEITHER
//   3. THE POSITIVE CONTROL — 50: the main account at 150k followers is issued all three; next epoch the 100k+ tier has 50
//      (49 decoys + this root): it is offered, it is the default, and an anonymous post boosted with it is proved,
//      accepted and recorded with tree = gte-100k and tree_size = 50
//   4. HOLDING ALL THREE AT 49: the issuer revokes one decoy's gte-100k; next epoch this root still holds all three, the
//      tier has 49: GET /api/reach and GET /api/anon do not offer it, default gte-10k, with "Not enough accounts are in
//      the 100k+ tier yet, so your posts are boosted as 10k+."; the COMPOSER's picker shows 10k+ / 1k+ / no boost and
//      never 100k+; POST /api/anon with tree gte-100k is refused 409 'reach' BEFORE anything is minted or written; the
//      prover's own cohort stage refuses the same tree (dev prove → 422 'cohort')
//   5. K POSTS OVER DIFFERENT TREES (gte-10k, gte-1k, the plain tree, gte-10k) in one window: K distinct slots, K
//      distinct nullifiers, all accepted, each row recording its tree and the frozen tree's size; the (K+1)th is refused
//      409 'window'; FORCED past the client (dev hooks) under ANOTHER tree it re-uses a spent slot and the validator
//      answers REPLAY — the tree is not in the scope — and nothing more is relayed
//   6. THE LABEL, by the rule: every anon card on For You carries "posted by an account with <tier> followers" exactly
//      when its tree is an honoured reach tree, its recorded size is at least 50 and (for this epoch) agrees with the
//      client's census — three rows FORGED straight into the validator's database show it: tree_size 49 → no label;
//      tree_size 60 against a census of 121 → no label; tree_size 50 from an older epoch → labelled (the control)
//   7. THE BOOST: the anon cards of For You come in exactly the order (recorded time + the tier's head start, then cast
//      hash) — the forged 49 row gets no head start; on the Following surface the same cards are in plain time order;
//      two For You builds give the identical order
// Fixture, pinned ports, no network, no spend. Every `setRepImpl zk` ends with `setRepImpl null` in a finally. Run with
// the rig up (the harness's ports):
//   bash <scratchpad>/att-run.sh scripts/accept-reach.mjs        (npm run test:reach once the verify agent adds it)
// ABORTS (exit 2) on the wrong shape: GET /api/dev must answer 200 and the server's Sign in with Farcaster must be
// available in fixture mode (an empty-world rig or the owner service is not this suite's shape).
import { existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const MAIN_FID = 9_200_001;
const TEN = "attest:fc.reach/gte-10k";
const HUNDRED = "attest:fc.reach/gte-100k";
const ONE = "attest:fc.reach/gte-1k";
const HOUR = 3_600_000;
const BOOST = { "gte-1k": 1 * HOUR, "gte-10k": 2 * HOUR, "gte-100k": 4 * HOUR }; // lib/reach/boost.ts REACH_BOOST_MS
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function vapi(p) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(VBASE + p); return { status: r.status, json: await r.json().catch(() => null) }; }
    catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw new Error("INFRA: fetch failed for " + p + " (" + (last?.cause?.code ?? last?.message ?? "no cause") + ")");
}
/** retried on a non-2xx (the mock adapters fail 2% of calls by design) AND until `done` holds for the content */
async function retry(fn, done = (r) => r.status >= 200 && r.status < 300, attempts = 5) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (done(r)) return r; last = new Error("status " + r.status + " " + (r.json?.code ?? "") + " " + String(r.json?.error ?? r.json?.reason ?? JSON.stringify(r.json)?.slice(0, 200))); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const reachPost = (action, extra = {}) => api("POST", "/api/reach", { action, mode: "fixture", ...extra });
const reachGet = async () => (await retry(() => api("GET", "/api/reach?mode=fixture"))).json;
const anonGet = async () => (await retry(() => api("GET", "/api/anon"), (r) => (r.status === 200 || r.status === 503) && !!r.json?.reach)).json;
const anonStatus = async (castHash, envelope = false) => (await retry(() => api("GET", `/api/anon?castHash=${castHash}${envelope ? "&envelope=1" : ""}`))).json;
const anonCasts = async () => (await vapi("/zk/anon-casts?mode=fixture")).json?.casts ?? [];
const epochNow = async () => (await vapi("/zk/epoch?mode=fixture")).json.epoch;
const advance = async () => { await retry(() => zk("advanceEpoch")); await retry(() => zk("prefetchNow")); await sleep(300); };
/** prove what is wanted NOW (one tick); an epoch-edge deferral is the rig's condition, said as INFRA */
async function tick(castHashes) {
  await retry(() => zk("prefetchNow"));
  await sleep(400);
  for (const h of castHashes) {
    const s = await anonStatus(h);
    if (s?.outcome?.lastStage === "epoch-edge" && s.status === "wanted") throw new Error("INFRA: the rig's epoch ends inside the jitter window — the post is deferred to the next epoch; re-run after the boundary");
  }
}
const drain = () => retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
const stateRows = () => {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    try { db.exec("PRAGMA busy_timeout = 8000"); } catch { /* read-only handle */ }
    const m = new Map();
    for (const r of db.prepare("SELECT anchor, namespace, key, value FROM adapter_state").all()) m.set(`${r.anchor}|${r.namespace}|${r.key}`, r.value);
    return m;
  } finally { db.close(); }
};
const changedNamespaces = (before, after) => {
  const ns = new Set();
  for (const [k, v] of after) if (!before.has(k) || before.get(k) !== v) ns.add(k.split("|")[1]);
  for (const k of before.keys()) if (!after.has(k)) ns.add(k.split("|")[1]);
  return [...ns];
};
const offeredTrees = (r) => (r.offered ?? []).map((o) => o.tree);
const feedCards = async (surface) => (await retry(() => api("GET", "/api/feed2?surface=" + surface), (r) => r.status === 200 && Array.isArray(r.json?.cards))).json.cards;
const anonCardsOf = (cards) => cards.map((c) => c.cast).filter((c) => c && c.anon === true);

await assertServersUp(BASE);
const devGet = await api("GET", "/api/dev").catch(() => null);
if (!devGet || devGet.status !== 200) {
  console.log("  ABORT: GET /api/dev answered " + (devGet ? devGet.status : "nothing") + " at " + BASE + " — this suite runs on the rig (200)");
  process.exit(2);
}
console.log("\nPersona launch P5 — reach tiers and the For You boost (app " + BASE + ", validator " + VBASE + ")");
if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
const stamp = Date.now().toString(36);
let K = 4;
let ownCommitment = null;

await retry(() => dev("resetSeed"));
await retry(() => zk("resetZk"));
try {
  const shape = await api("GET", "/api/fc/siwf");
  if (shape.status !== 200 || shape.json?.available !== true || shape.json?.mode !== "fixture") {
    console.log("  ABORT: the server's Sign in with Farcaster is not available in fixture mode (" + shape.status + ") — not this suite's shape");
    process.exitCode = 2;
    throw new Error("ABORT");
  }
  // ---------------------------------------------------------------- 0. the session
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("seedDecoys", { count: 300 }));
  await retry(() => zk("register"));
  await advance();
  ownCommitment = (await retry(() => zk("probe"))).json.commitment;
  const valid = (await vapi("/zk/members?mode=fixture&tree=valid")).json;
  if (!valid.members?.includes(ownCommitment) || valid.members.length < 301) throw new Error("setup: valid holds " + valid.members?.length + " leaves, ours " + (valid.members?.includes(ownCommitment) ? "in" : "missing"));
  // this root's own main account: the fixture sign-in (start → fixtureApprove → poll until verified)
  const st = await retry(() => api("POST", "/api/fc/siwf", { action: "start" }));
  await retry(() => api("POST", "/api/fc/siwf", { action: "fixtureApprove", sessionId: st.json.session.id }));
  let link = null;
  for (let i = 0; i < 20 && !link; i++) {
    const p = await retry(() => api("POST", "/api/fc/siwf", { action: "poll", sessionId: st.json.session.id }));
    if (p.json?.session?.stage === "verified") link = p.json.link;
    else if (p.json?.session?.stage === "refused" || p.json?.session?.stage === "expired") throw new Error("setup: the fixture sign-in ended " + p.json.session.stage);
    else await sleep(250);
  }
  if (!link || link.fid !== MAIN_FID || link.disconnected) throw new Error("setup: the root is not signed in as fixture-main: " + JSON.stringify(link));
  K = Number((await vapi("/zk/anon-post/config?mode=fixture")).json?.slotsPerWindow);
  if (!Number.isInteger(K) || K < 2) throw new Error("the validator reports no K: " + K);

  await check("1. THE SCORE ENTRY: with the main account's Neynar score at 0.6, fc.reach issues nothing — 409 in plain words — and this root holds no reach tier", async () => {
    await retry(() => reachPost("setFixtureFacts", { fid: MAIN_FID, score: 0.6 }));
    const r = await reachPost("issue", { issuer: "fc.reach" });
    if (r.status !== 409 || !/score is below 0\.7/.test(r.json?.error ?? "")) throw new Error("a 0.6 score was not refused: " + r.status + " " + JSON.stringify(r.json));
    if (/9200001/.test(r.json.error)) throw new Error("the refusal names the fid");
    const g = await reachGet();
    if (g.held.length !== 0 || g.offered.length !== 0) throw new Error("held/offered after a refusal: " + JSON.stringify(g));
  });

  await check("2. 49 IN THE 100k+ TIER, NOT OURS: a 50k main account is issued gte-1k + gte-10k with the decoy cohort (exactly 49 decoys in gte-100k); next epoch GET /api/reach and GET /api/anon offer gte-10k and gte-1k only, default gte-10k — gte-100k is offered by neither", async () => {
    await retry(() => reachPost("setFixtureFacts", { fid: MAIN_FID, followers: 50_000 }));
    const r = await retry(() => reachPost("issue", { issuer: "fc.reach", includeCohort: true }));
    if (JSON.stringify(r.json.buckets) !== JSON.stringify(["gte-1k", "gte-10k"]) || !(r.json.cohortAttested > 100)) throw new Error("issuance: " + JSON.stringify(r.json).slice(0, 300));
    await advance();
    const census = (await vapi("/zk/attest/buckets?mode=fixture")).json.buckets.filter((b) => b.issuer === "fc.reach");
    const size = (b) => census.find((c) => c.bucket === b)?.size;
    if (size("gte-100k") !== 49 || !(size("gte-10k") >= 50) || !(size("gte-1k") >= 50)) throw new Error("census: " + JSON.stringify(census.map((c) => [c.bucket, c.size])));
    const g = await reachGet();
    // the reference client honours fc.reach BY KEY by default (lib/attest/subscriber.ts); a rig whose env overrides the
    // honour list would offer nothing — said plainly rather than failing later for an unclear reason
    if (!g.issuers.find((i) => i.id === "fc.reach")?.honoured || !g.issuers.find((i) => i.id === "fc.reach")?.accepted) throw new Error("fc.reach is not honoured by key and accepted by the validator on this rig: " + JSON.stringify(g.issuers));
    if (JSON.stringify(g.held.sort()) !== JSON.stringify([ONE, TEN].sort())) throw new Error("held: " + JSON.stringify(g.held));
    if (JSON.stringify(offeredTrees(g)) !== JSON.stringify([TEN, ONE]) || g.defaultTree !== TEN) throw new Error("GET /api/reach: " + JSON.stringify({ offered: offeredTrees(g), def: g.defaultTree }));
    const a = await anonGet();
    if (JSON.stringify(offeredTrees(a.reach)) !== JSON.stringify([TEN, ONE]) || a.reach.defaultTree !== TEN || offeredTrees(a.reach).includes(HUNDRED)) throw new Error("GET /api/anon reach: " + JSON.stringify(a.reach));
    return `census 1k ${size("gte-1k")}, 10k ${size("gte-10k")}, 100k ${size("gte-100k")}`;
  });

  let boosted100 = null;
  await check("3. THE POSITIVE CONTROL — 50: a 150k main account is issued all three; next epoch the 100k+ tier has 50 (49 decoys + this root): offered, the default, and an anonymous post boosted with it is proved, accepted and recorded with tree gte-100k and tree_size 50", async () => {
    await retry(() => reachPost("setFixtureFacts", { fid: MAIN_FID, followers: 150_000 }));
    const r = await retry(() => reachPost("issue", { issuer: "fc.reach" }));
    if (JSON.stringify(r.json.buckets) !== JSON.stringify(["gte-1k", "gte-10k", "gte-100k"])) throw new Error("issuance: " + JSON.stringify(r.json));
    await advance();
    const members = (await vapi("/zk/members?mode=fixture&tree=" + encodeURIComponent(HUNDRED))).json.members;
    if (members.length !== 50 || !members.includes(ownCommitment)) throw new Error("the 100k+ tree: " + members.length + " leaves, ours " + members.includes(ownCommitment));
    const g = await reachGet();
    if (JSON.stringify(offeredTrees(g)) !== JSON.stringify([HUNDRED, TEN, ONE]) || g.defaultTree !== HUNDRED || g.reason !== null) throw new Error("GET /api/reach at 50: " + JSON.stringify({ offered: offeredTrees(g), def: g.defaultTree, reason: g.reason }));
    const p = await api("POST", "/api/anon", { text: `boosted as 100k+ ${stamp} [layers-test fixture]`, tree: HUNDRED });
    if (p.status !== 202 || p.json?.tree !== HUNDRED) throw new Error("the post: " + p.status + " " + JSON.stringify(p.json));
    await tick([p.json.castHash]);
    const q = await anonStatus(p.json.castHash, true);
    if (q.item?.status !== "queued" || q.envelope?.publicInputs?.tree !== HUNDRED) throw new Error("not queued under gte-100k: " + JSON.stringify({ item: q.item, outcome: q.outcome }));
    await drain();
    const s = await anonStatus(p.json.castHash);
    if (s.item?.outcome !== "accepted") throw new Error("not accepted: " + JSON.stringify(s.item));
    const row = (await anonCasts()).find((c) => c.castHash === p.json.castHash);
    if (!row || row.tree !== HUNDRED || row.treeSize !== 50) throw new Error("the row: " + JSON.stringify(row && { tree: row.tree, treeSize: row.treeSize }));
    boosted100 = p.json.castHash;
  });

  await check("4. HOLDING ALL THREE AT 49: one decoy's gte-100k revoked; next epoch GET /api/reach and GET /api/anon do not offer gte-100k (default gte-10k, the plain-words reason); the composer's picker shows 10k+ / 1k+ / no boost and never 100k+; POST /api/anon into gte-100k is refused 409 'reach' before any mint or write; the prover's cohort stage refuses it too", async () => {
    const members = (await vapi("/zk/members?mode=fixture&tree=" + encodeURIComponent(HUNDRED))).json.members;
    const victim = members.find((m) => m !== ownCommitment);
    const rv = await retry(() => zk("revokeAttestation", { issuerId: "fc.reach", bucket: "gte-100k", commitment: victim }));
    if (rv.json?.ok !== true) throw new Error("revocation: " + JSON.stringify(rv.json));
    await advance();
    const after = (await vapi("/zk/members?mode=fixture&tree=" + encodeURIComponent(HUNDRED))).json.members;
    if (after.length !== 49 || !after.includes(ownCommitment)) throw new Error("the 100k+ tree after the revocation: " + after.length);
    const g = await reachGet();
    if (!g.held.includes(HUNDRED)) throw new Error("this root stopped holding gte-100k: " + JSON.stringify(g.held));
    const reason = "Not enough accounts are in the 100k+ tier yet, so your posts are boosted as 10k+.";
    if (JSON.stringify(offeredTrees(g)) !== JSON.stringify([TEN, ONE]) || g.defaultTree !== TEN || g.reason !== reason) throw new Error("GET /api/reach at 49: " + JSON.stringify({ offered: offeredTrees(g), def: g.defaultTree, reason: g.reason }));
    const a = await anonGet();
    if (offeredTrees(a.reach).includes(HUNDRED) || a.reach.defaultTree !== TEN || a.reach.reason !== reason) throw new Error("GET /api/anon reach at 49: " + JSON.stringify(a.reach));
    // the composer
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + "/home", { waitUntil: "networkidle" });
      await page.locator("[data-testid='composer-input']").first().click();
      const picker = page.locator("[data-testid='composer-reach']").first();
      await picker.waitFor({ timeout: 15000 });
      const opts = await picker.locator("[role='radio']").evaluateAll((els) => els.map((e) => ({ testid: e.getAttribute("data-testid"), tree: e.getAttribute("data-tree"), checked: e.getAttribute("aria-checked") })));
      const ids = opts.map((o) => o.testid);
      if (JSON.stringify(ids) !== JSON.stringify(["reach-option-gte-10k", "reach-option-gte-1k", "reach-option-none"])) throw new Error("picker options: " + JSON.stringify(ids));
      if ((await page.locator("[data-testid='reach-option-gte-100k']").count()) !== 0) throw new Error("the picker rendered the 49-member tier");
      if (opts.find((o) => o.checked === "true")?.tree !== TEN) throw new Error("the picker's default is not 10k+: " + JSON.stringify(opts));
      const why = (await page.locator("[data-testid='composer-reach-reason']").first().textContent()) ?? "";
      if (why.trim() !== reason) throw new Error("the picker's reason: " + why);
      // PERSONA LAUNCH wave 3 (UXH-12, final verify): the default (the highest offered tier, the smallest crowd) says how
      // many accounts are in it — the census size GET /api/anon offered it with, never a guessed number
      const tenSize = (a.reach.offered ?? []).find((o) => o.tree === TEN)?.size;
      if (!Number.isInteger(tenSize) || tenSize < 50) throw new Error("setup: GET /api/anon offered 10k+ without a census size: " + JSON.stringify(a.reach.offered));
      const crowd = page.locator("[data-testid='composer-reach-crowd']").first();
      await crowd.waitFor({ timeout: 15000 }).catch(() => { throw new Error("UXH-12: the picker does not say how many accounts are in the default tier"); });
      const crowdText = ((await crowd.textContent()) ?? "").trim();
      if ((await crowd.getAttribute("data-size")) !== String(tenSize) || !crowdText.startsWith(tenSize.toLocaleString("en-US") + " accounts are in the ") || !crowdText.includes("anyone can tell this post came from one of them, never which one.")) throw new Error("UXH-12: the default tier's crowd line: " + JSON.stringify({ tenSize, crowdText }));
    } finally {
      await browser.close();
    }
    // the compose gate: refused before anything is minted or written
    const g0 = await anonGet();
    const pendingBefore = (await retry(() => zk("queueStatus"))).json?.persistPending === true;
    const before = stateRows();
    const r = await api("POST", "/api/anon", { text: `not at 49 ${stamp} [layers-test fixture]`, tree: HUNDRED });
    const after2 = stateRows();
    const pendingAfter = (await retry(() => zk("queueStatus"))).json?.persistPending === true;
    if (r.status !== 409 || r.json?.code !== "reach" || !/Not enough accounts are in the 100k\+ tier/.test(r.json.error ?? "")) throw new Error("the 49-member tree was not refused 409 reach: " + r.status + " " + JSON.stringify(r.json));
    const g1 = await anonGet();
    if (g1.revealable.length !== g0.revealable.length || g1.wanted.length !== g0.wanted.length) throw new Error("the refused post minted a secret or a wanted entry");
    const changed = changedNamespaces(before, after2);
    if (changed.length && !(pendingBefore && !pendingAfter && changed.every((ns) => ns === "zkQueue"))) throw new Error("a device-signed write landed at the refused compose: " + changed.join(","));
    // the prover's own cohort stage (the dev door: no wanted set in between)
    const hex = (n) => randomBytes(n).toString("hex");
    const pr = await api("POST", "/api/zk", { action: "prove", mode: "fixture", claimKind: "anon-post", personaId: "anon", gateId: "anon-post", tree: HUNDRED, slot: 0, castHash: hex(32), attributionCommitment: hex(32), noteHash: hex(32) });
    if (pr.status !== 422 || pr.json?.stage !== "cohort") throw new Error("the prover did not refuse the 49-member tree at 'cohort': " + pr.status + " " + JSON.stringify(pr.json).slice(0, 200));
    // CONTROL for the dev door: the same call into gte-10k proves
    const pr10 = await api("POST", "/api/zk", { action: "prove", mode: "fixture", claimKind: "anon-post", personaId: "anon", gateId: "anon-post", tree: TEN, slot: 0, castHash: hex(32), attributionCommitment: hex(32), noteHash: hex(32) });
    if (pr10.status !== 200 || pr10.json?.ok !== true) throw new Error("the control (gte-10k) did not prove: " + pr10.status + " " + JSON.stringify(pr10.json).slice(0, 200));
  });

  const spread = [];
  await check("5. K POSTS OVER DIFFERENT TREES in one window: K distinct slots and nullifiers, all accepted, each row with its tree and the frozen size; the (K+1)th refused 409 'window'; FORCED under another tree it re-uses a spent slot and the validator answers REPLAY (the tree is not in the scope); nothing more relayed", async () => {
    await advance(); // a fresh window
    const trees = [TEN, ONE, null, TEN, ONE, null, TEN, ONE].slice(0, K);
    for (const [i, tree] of trees.entries()) {
      const r = await api("POST", "/api/anon", { text: `spread ${i} ${stamp} [layers-test fixture]`, ...(tree ? { tree } : {}) });
      if (r.status !== 202) throw new Error(`post ${i + 1} (${tree ?? "plain"}): ` + r.status + " " + JSON.stringify(r.json).slice(0, 200));
      spread.push({ castHash: r.json.castHash, tree: r.json.tree });
    }
    const extra = await api("POST", "/api/anon", { text: `one too many ${stamp} [layers-test fixture]`, tree: ONE });
    if (extra.status !== 409 || extra.json?.code !== "window") throw new Error("the (K+1)th was not refused 409 window: " + extra.status + " " + JSON.stringify(extra.json));
    await tick(spread.map((s) => s.castHash));
    const envs = [];
    for (const s of spread) {
      const q = await anonStatus(s.castHash, true);
      if (q.item?.status !== "queued" || !q.envelope) throw new Error("not queued: " + JSON.stringify({ item: q.item, outcome: q.outcome }));
      if (q.envelope.publicInputs.tree !== s.tree) throw new Error("an envelope proves another tree than chosen");
      envs.push(q.envelope);
    }
    const slots = envs.map((e) => e.publicInputs.slot);
    if (new Set(slots).size !== K || new Set(envs.map((e) => String(e.nullifier))).size !== K) throw new Error("not K distinct slots/nullifiers: " + JSON.stringify(slots));
    await drain();
    const rows = await anonCasts();
    const census = Object.fromEntries((await vapi("/zk/attest/buckets?mode=fixture")).json.buckets.map((b) => [b.tree, b.size]));
    const plainSize = (await vapi("/zk/members?mode=fixture&tree=" + encodeURIComponent(spread.find((s) => !s.tree.startsWith("attest:")).tree))).json.members.length;
    for (const s of spread) {
      const st = await anonStatus(s.castHash);
      if (st.item?.outcome !== "accepted") throw new Error("not accepted: " + JSON.stringify(st.item));
      const row = rows.find((c) => c.castHash === s.castHash);
      const want = s.tree.startsWith("attest:") ? census[s.tree] : plainSize;
      if (!row || row.tree !== s.tree || row.treeSize !== want) throw new Error("row of " + s.tree + ": " + JSON.stringify(row && { tree: row.tree, treeSize: row.treeSize, want }));
    }
    // forced past the client under gte-1k: the tick re-uses a spent slot (drawn uniformly), and the validator answers
    // REPLAY. Repeated (fresh words each time) until the re-used slot was spent under ANOTHER tree — the case that shows
    // the tree is not in the scope; every attempt must be a replay, and nothing may be relayed
    const relayedBefore = (await anonCasts()).length;
    let crossTree = null;
    for (let attempt = 0; attempt < 8 && !crossTree; attempt++) {
      const f = await api("POST", "/api/anon", { text: `forced under another tree ${attempt} ${stamp} [layers-test fixture]`, tree: ONE, force: true });
      if (f.status !== 202) throw new Error("the forced post was not queued: " + f.status + " " + JSON.stringify(f.json));
      await tick([f.json.castHash]);
      const fq = await anonStatus(f.json.castHash, true);
      const reused = envs.find((e) => e.publicInputs.slot === fq.envelope?.publicInputs?.slot);
      if (fq.item?.status !== "queued" || !reused) throw new Error("the forced post did not re-use a spent slot: " + JSON.stringify({ item: fq.item, slot: fq.envelope?.publicInputs?.slot, spent: slots }));
      await drain();
      const fs = await anonStatus(f.json.castHash);
      if (fs.item?.outcome !== "replay") throw new Error("the validator did not answer replay for slot " + reused.publicInputs.slot + " re-used under gte-1k (spent under " + reused.publicInputs.tree + "): " + JSON.stringify(fs.item));
      if (reused.publicInputs.tree !== ONE) crossTree = reused;
    }
    if (!crossTree) throw new Error("eight forced posts all re-used the gte-1k post's own slot — the cross-tree replay was never exercised");
    if ((await anonCasts()).length !== relayedBefore) throw new Error("a forced post was relayed");
    return `slots ${JSON.stringify(slots)}; slot ${crossTree.publicInputs.slot} spent under ${crossTree.publicInputs.tree} re-used under gte-1k → replay`;
  });

  // ---------------------------------------------------------------- 6–7. the label and the boost
  const forged = [];
  await check("6. THE LABEL by the rule: on For You every anon card carries 'posted by an account with <tier> followers' exactly when its tree is an honoured reach tree with a recorded size ≥ 50 that agrees with this epoch's census — forged rows: tree_size 49 → none; 60 against a census of 121 → none; 50 from an older epoch → labelled (control); a plain-tree card → none", async () => {
    await retry(() => zk("prefetchNow"));
    const ep = await epochNow();
    const census = Object.fromEntries((await vapi("/zk/attest/buckets?mode=fixture")).json.buckets.map((b) => [b.tree, b.size]));
    const ours = await anonCasts();
    const at = ours[0]?.at;
    const fid = ours[0]?.fid ?? 0;
    if (!Number.isInteger(at)) throw new Error("no relayed anon cast to take the hour from");
    const db = new DatabaseSync(DB_PATH);
    try {
      try { db.exec("PRAGMA busy_timeout = 8000"); } catch { /* fine */ }
      const ins = db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, attribution_commitment, tree, note, tree_size) VALUES ('fixture', ?, ?, ?, ?, ?, ?, 'relayed', ?, ?, ?, ?)");
      for (const [label, tree, epoch, size] of [["forged-49", TEN, ep - 2, 49], ["forged-disagrees", TEN, ep, census[TEN] === 60 ? 61 : 60], ["forged-50-control", TEN, ep - 2, 50]]) {
        const castHash = randomBytes(32).toString("hex");
        ins.run(castHash, `${label} ${stamp} [layers-test fixture]`, epoch, at, "0xanon" + randomBytes(16).toString("hex"), fid, randomBytes(32).toString("hex"), tree, randomBytes(256).toString("hex"), size);
        forged.push({ label, castHash, tree, epoch, size });
      }
    } finally { db.close(); }
    const cards = anonCardsOf(await feedCards("discovery"));
    const byHash = new Map(cards.map((c) => [c.castHash, c]));
    for (const f of forged) if (!byHash.has(f.castHash)) throw new Error("a forged row is not on For You: " + f.label);
    const expectLabel = (row) => {
      if (!row.tree || !row.tree.startsWith("attest:fc.reach/")) return null;
      if (!(row.treeSize >= 50)) return null;
      if (row.epoch === ep && census[row.tree] !== undefined && census[row.tree] !== row.treeSize) return null;
      const b = row.tree.slice(row.tree.indexOf("/") + 1);
      return `posted by an account with ${b === "gte-1k" ? "1k+" : b === "gte-10k" ? "10k+" : "100k+"} followers`;
    };
    const rows = await anonCasts();
    let labelled = 0;
    for (const row of rows) {
      const card = byHash.get(row.castHash);
      if (!card) throw new Error("an anon row is not on For You: " + row.castHash.slice(0, 10));
      const want = expectLabel(row);
      const got = card.reach?.label ?? null;
      if (want !== got) throw new Error(`label of ${forged.find((f) => f.castHash === row.castHash)?.label ?? row.tree}: expected ${want}, got ${got}`);
      if (got) labelled++;
    }
    if (byHash.get(forged[0].castHash).reach || byHash.get(forged[1].castHash).reach) throw new Error("a forged row carries a label");
    if (!byHash.get(forged[2].castHash).reach) throw new Error("the 50-member control lost its label");
    if (!byHash.get(boosted100)?.reach || byHash.get(boosted100).reach.bucket !== "gte-100k") throw new Error("the 100k+ post (size 50, an older epoch) is not labelled 100k+");
    if (cards.some((c) => c.reach && /9200001|fixture-main/.test(JSON.stringify(c.reach)))) throw new Error("a label names the account");
    return `${labelled} labelled of ${rows.length}`;
  });

  await check("7. THE BOOST: For You's anon cards come in exactly the order (recorded time + the tier's head start, then cast hash) — the forged 49 row gets no head start; on Following the same cards are in plain time order; two For You builds give the identical order", async () => {
    // the expected order, computed HERE from the cards' own fields: (recorded time + the head start of the tier the
    // label names, on For You only), newest first, then the cast hash
    const eff = (c, boosted) => c.timestamp + (boosted ? (c.reach ? BOOST[c.reach.bucket] ?? 0 : 0) : 0);
    const order = (cards, boosted) =>
      [...cards].sort((a, b) => eff(b, boosted) - eff(a, boosted) || (a.castHash < b.castHash ? -1 : a.castHash > b.castHash ? 1 : 0)).map((c) => c.castHash);
    let a = null;
    let b = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      a = (await feedCards("discovery")).map((c) => c.cast?.hash ?? c.kind);
      b = (await feedCards("discovery")).map((c) => c.cast?.hash ?? c.kind);
      if (JSON.stringify(a) === JSON.stringify(b)) break;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("two For You builds differ in order");
    const disc = anonCardsOf(await feedCards("discovery"));
    const got = disc.map((c) => c.castHash);
    const want = order(disc, true);
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error("For You's anon order is not (time + head start, then hash): got " + got.map((h) => h.slice(0, 6)).join(",") + " want " + want.map((h) => h.slice(0, 6)).join(","));
    // the forged 49 row: no head start — every labelled card with the same recorded time is above it
    const f49 = forged[0].castHash;
    const sameTime = disc.filter((c) => c.timestamp === disc.find((x) => x.castHash === f49).timestamp);
    for (const c of sameTime) if (c.reach && got.indexOf(c.castHash) > got.indexOf(f49)) throw new Error("a labelled card sits below the forged 49 row");
    if (!sameTime.some((c) => c.reach)) throw new Error("no labelled card shares the forged row's hour — the boost check would be vacuous");
    const fol = anonCardsOf(await feedCards("following"));
    if (fol.length) {
      const fgot = fol.map((c) => c.castHash);
      const fwant = order(fol, false);
      if (JSON.stringify(fgot) !== JSON.stringify(fwant)) throw new Error("the Following surface moved a labelled card: got " + fgot.map((h) => h.slice(0, 6)).join(",") + " want " + fwant.map((h) => h.slice(0, 6)).join(","));
    }
    return `${disc.length} anon cards on For You, ${disc.filter((c) => c.reach).length} boosted; Following ${fol.length ? "in time order" : "shows no anon cards"}`;
  });
} catch (e) {
  if (e.message !== "ABORT") fail("setup", e.message);
} finally {
  await reachPost("clearFixtureFacts").catch(() => {});
  await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
}

await retry(() => dev("resetSeed")).catch(() => {});
await retry(() => zk("resetZk")).catch(() => {});
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Persona launch P5 (reach tiers) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
// VERIFY (wave 2): an INFRA result exits 2, the sweep runner's "could not test" code (scripts/sweep-x.sh), not 3 (which the
// runner reports as "suite exited 3 with no verdict")
if (process.exitCode !== 2) process.exitCode = failed ? 1 : infra ? 2 : 0;
