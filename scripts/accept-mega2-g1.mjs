// MEGA PASS 2 — Gate 1 acceptance (fixture): the reputation UBI.
//   1. NO TRANSFER: the adapter contract, the influence modules and the API carry no transfer/send/move of
//      influence (grep), and the type-level assertion that makes adding one a compile error is present
//   2. ALLOWANCE never overdraws (adversarial): a stake above the remaining balance is refused with the balance
//      untouched; spending to zero works; the next stake is refused; an epoch advance recharges to EXACTLY the
//      allowance — never allowance + leftover, never twice
//   3. STAKES SIGN AND VERIFY: the validator's row verifies under the persona's key; a tampered copy is refused;
//      a row signed by a key that is NOT the persona's is accepted by the validator (it cannot know) but the
//      app's verified read EXCLUDES it
//   4. THE SPECTRUM ROUTES: a `note-worthy` stake counts as a stake-backed endorsement on the community-notes
//      surface; a `wrong` stake lands on the refutation surface (GET /api/refute) and on the correction card
//   5. ACCRUAL THROUGH THE EXISTING REP PATH, PROVEN UNDER ZK: under the zk binding a persona proves its tier,
//      stakes from the resulting allowance, the delayed window settles a `stewardship` rep event on the ROOT
//      (the validator's rep_events), the root's score moves, and the persona then PROVES the new tier
//   6. HISTORY AT THE DISCLOSURE LEVEL, FAIL CLOSED: the owner always sees it; a stranger sees it only when the
//      persona's disclosure level admits them; a failed disclosure read refuses, never serves
//   7. THE COORDINATED CLUSTER is visible in the influence layer (API + settings pane)
//   8. LEAKS: the influence namespace is ciphertext on the validator; no balance or allowance plaintext anywhere
//      in its database; stake rows carry no root
// Fixture, pinned ports, no network, no spend.
import { createHash, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ed25519 } from "@noble/curves/ed25519";
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const MAIN = "persona_viewer_main";
const STRANGER = "persona_acc_crypto_1";
// the validator's root for the seed viewer's ACCOUNT (fid 9152) — a validator-minted id, not the seed's
// internal grouping; resolved from the operator's own table, exactly as the operator would
let ROOT = "";
function resolveRoot() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try { return db.prepare("SELECT id FROM roots WHERE fid = 9152").get()?.id ?? ""; } finally { db.close(); }
}
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

await assertServersUp(BASE);
async function api(method, url, body, headers = {}) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function vapi(p, init) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(VBASE + p, init); return { status: r.status, json: await r.json().catch(() => null) }; }
    catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw new Error("INFRA: fetch failed for " + p + " (" + (last?.cause?.code ?? last?.message ?? "no cause") + ")");
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.json?.reason ?? JSON.stringify(r.json)?.slice(0, 200))); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const reset = () => retry(() => dev("resetSeed"));
const allowance = async () => (await retry(() => api("GET", "/api/influence?view=allowance"))).json.allowance;
const stake = (castHash, stakeAction, extra = {}) => api("POST", "/api/influence", { action: "stake", castHash, stakeAction, ...extra });
const asViewer = (personaId) => ({ cookie: `layers_view_as=${personaId}` });
const canonicalOf = (b) => ["layers-stake/1", b.mode, b.personaId, b.castHash, b.action, b.direction, String(b.amount), String(b.epoch), b.nonce].join("|");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const rootTier = async () => (await vapi(`/rep/root/${ROOT}/tier`)).json?.tier;
function stewardshipRows() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try { return db.prepare("SELECT root_id, type, count, source_id FROM rep_events WHERE type = 'stewardship' ORDER BY id").all(); } finally { db.close(); }
}

await reset();
const E0 = (await allowance()).epoch;
ROOT = resolveRoot();
if (!ROOT) { console.log("  INFRA  setup: the validator holds no root for fid 9152"); process.exit(2); }

await check("1. NO TRANSFER: the adapter contract, the influence modules and the API carry no transfer/send/move of influence; the type-level assertion is present", async () => {
  const types = readFileSync("lib/adapters/types.ts", "utf8");
  const block = types.slice(types.indexOf("export interface InfluenceAdapter"), types.indexOf("}", types.indexOf("export interface InfluenceAdapter")));
  if (!block.includes("allowance(") || !block.includes("stake(")) throw new Error("InfluenceAdapter not found where expected");
  for (const m of ["transfer", "send", "move", "gift", "delegate", "lend", "sell"]) if (new RegExp("\\b" + m + "\\s*\\(", "i").test(block)) throw new Error("InfluenceAdapter carries a " + m + " method");
  const hits = execSync('grep -rniE "(transfer|sendInfluence|moveInfluence|giftInfluence)\\s*\\(" lib/influence app/api/influence lib/adapters/mock/influence.ts validator/stakes.js || true', { encoding: "utf8" }).trim();
  if (hits) throw new Error("a transfer-shaped operation exists: " + hits.slice(0, 200));
  const t = readFileSync("lib/influence/types.ts", "utf8");
  if (!/INFLUENCE_HAS_NO_TRANSFER: \[ForbiddenInfluenceOps\] extends \[never\] \? true : never = true/.test(t)) throw new Error("the type-level no-transfer assertion is missing");
  const aTs = readFileSync("lib/influence/allowance.ts", "utf8");
  if (/transfer|credit\(/.test(aTs.replace(/\/\/[^\n]*/g, ""))) throw new Error("allowance.ts carries a transfer/credit path");
});

await check("2. ALLOWANCE never overdraws: a stake above the balance is refused with the balance untouched; spending to zero works; the next stake is refused; an epoch advance recharges to EXACTLY the allowance", async () => {
  let a = await allowance();
  if (!(a.allowance > 0)) throw new Error("no allowance under the default binding: " + JSON.stringify(a));
  if (a.remaining !== a.allowance) throw new Error("fresh epoch is not fully charged: " + JSON.stringify(a));
  const one = await stake("0xcr0001", "like", { amount: 1 });
  if (one.status !== 200 || !one.json.stake) throw new Error("a 1-point stake failed: " + one.status + " " + JSON.stringify(one.json));
  a = await allowance();
  if (a.remaining !== a.allowance - 1) throw new Error("remaining did not drop by exactly 1: " + JSON.stringify(a));
  const over = await stake("0xcr0001", "like", { amount: a.remaining + 1 });
  if (over.status !== 409 || over.json?.code !== "overdraw") throw new Error("an overdraw was not refused as overdraw: " + over.status + " " + JSON.stringify(over.json));
  if ((await allowance()).remaining !== a.remaining) throw new Error("a refused overdraw changed the balance");
  const max = await stake("0xcr0001", "like", { amount: 50 });
  if (max.status !== 409) throw new Error("a max stake above the balance was not refused");
  const drain = await stake("0xcr0036", "recast", { amount: a.remaining });
  if (drain.status !== 200 || drain.json.remaining !== 0) throw new Error("spending to zero failed: " + JSON.stringify(drain.json));
  const empty = await stake("0xcr0036", "like", { amount: 1 });
  if (empty.status !== 409) throw new Error("a stake from an empty balance was not refused");
  if ((await allowance()).remaining !== 0) throw new Error("balance not zero after draining");
  await retry(() => zk("advanceEpoch"));
  const b = await allowance();
  if (b.epoch !== a.epoch + 1) throw new Error(`epoch did not advance by one (${a.epoch} → ${b.epoch})`);
  if (b.remaining !== b.allowance) throw new Error("recharge is not exactly the allowance: " + JSON.stringify(b));
  if (b.allowance !== a.allowance) throw new Error("allowance changed across an epoch with no rep change: " + JSON.stringify({ a, b }));
  // a second read in the same epoch must not recharge again
  const half = await stake("0xcr0001", "like", { amount: 1 });
  if (half.status !== 200) throw new Error("stake in the new epoch failed");
  if ((await allowance()).remaining !== b.allowance - 1) throw new Error("the balance recharged twice in one epoch");
});

await check("3. STAKES SIGN AND VERIFY: the row verifies under the persona's key; a tampered copy is refused; a row under a foreign key is stored by the validator but EXCLUDED by the app's verified read", async () => {
  const placed = await retry(() => stake("0xas0021", "curate", { amount: 2 }));
  const s = placed.json.stake;
  const rows = (await vapi(`/stakes?mode=fixture&castHash=0xas0021`)).json.stakes;
  const row = rows.find((r) => r.id === s.id);
  if (!row) throw new Error("the stake is not on the validator");
  const canonical = canonicalOf(row);
  if (!ed25519.verify(Buffer.from(row.signature, "hex"), Buffer.from(canonical, "utf8"), Buffer.from(row.pubkey, "hex"))) throw new Error("the row's signature does not verify under its key");
  if (sha(canonical).slice(0, 24) !== row.id) throw new Error("the row id is not the canonical hash");
  if (row.at % 3_600_000 !== 0) throw new Error("created_at is finer than an hour");
  const tampered = await vapi("/stakes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...row, amount: row.amount + 1 }) });
  if (tampered.status !== 400) throw new Error("a tampered stake was accepted: " + tampered.status);
  // a foreign key claiming MAIN
  const priv = randomBytes(32);
  const pub = Buffer.from(ed25519.getPublicKey(priv)).toString("hex");
  const forged = { mode: "fixture", personaId: MAIN, castHash: "0xas0021", action: "like", direction: "good", amount: 7, epoch: row.epoch, nonce: "f".repeat(16) };
  const sig = Buffer.from(ed25519.sign(Buffer.from(canonicalOf(forged), "utf8"), priv)).toString("hex");
  const accepted = await vapi("/stakes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...forged, pubkey: pub, signature: sig }) });
  if (accepted.status !== 201) throw new Error("the validator refused a well-formed foreign-key row (it cannot know whose key it is; the reader decides): " + accepted.status);
  const viaApp = (await retry(() => api("GET", "/api/influence?view=cast&castHash=0xas0021"))).json;
  if (viaApp.rows.some((r) => r.id === accepted.json.stake.id)) throw new Error("the app's verified read admitted a stake signed by a key that is not the persona's");
  if (!viaApp.rows.some((r) => r.id === s.id)) throw new Error("the app's verified read dropped the genuine stake");
  if (viaApp.summary.byDirection["worth-reading"] < 2) throw new Error("the aggregate does not carry the genuine stake: " + JSON.stringify(viaApp.summary));
});

await check("4. THE SPECTRUM ROUTES: a `note-worthy` stake counts as a stake-backed endorsement on the notes surface; a `wrong` stake lands on the refutation surface and the correction card", async () => {
  const nw = await retry(() => stake("0xcr0036", "note", { direction: "note-worthy", amount: 2 }));
  if (!nw.json.stake) throw new Error("note-worthy stake not placed");
  const fh = (await retry(() => api("GET", "/api/feed-health"))).json;
  const r = (fh.reinjections ?? []).find((x) => x.noteId === "note_1");
  if (!r) throw new Error("note_1 (0xcr0036) is not in the reinjection list: " + JSON.stringify(fh.reinjections?.map((x) => x.noteId)));
  if (!r.qualifies || !/stake-backed/.test(r.reason)) throw new Error("the notes surface did not count the stake: " + JSON.stringify(r));
  // a refutation with its default `refute` stake (direction wrong)
  const ref = await retry(() => api("POST", "/api/refute", { fromCastId: "0xcr0001", toCastId: "0xcr0036", type: "refutes" }));
  if (!ref.json.stake?.ok) throw new Error("the refute route did not place its stake: " + JSON.stringify(ref.json.stake));
  const edges = (await retry(() => api("GET", "/api/refute?castId=0xcr0036"))).json;
  if (!edges.stakes || edges.stakes.wrong < 3) throw new Error("the refutation surface does not show the wrong stake: " + JSON.stringify(edges.stakes));
  const feed = (await retry(() => api("GET", "/api/feed2"))).json;
  const card = (feed.cards ?? []).find((c) => c.kind === "correction" && String(c.cast?.hash).startsWith("0xcr0036#note"));
  if (!card) throw new Error("no correction card for 0xcr0036 in the feed");
  if (!(card.stakeWrong >= 3)) throw new Error("the correction card does not carry the wrong stake: " + JSON.stringify({ stakeWrong: card.stakeWrong }));
  const post = (feed.cards ?? []).find((c) => c.kind === "post" && c.cast?.hash === "0xcr0036");
  if (post && !(post.cast.stakes?.total >= 5)) throw new Error("the post card's stake summary is missing: " + JSON.stringify(post.cast.stakes));
});

await check("5. ACCRUAL THROUGH THE EXISTING REP PATH, PROVEN UNDER ZK: a proven persona stakes from its allowance; the delayed window settles `stewardship` on the ROOT; the root's rep moves; the persona proves the new tier", async () => {
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  try {
    await retry(() => zk("resetZk"));
    await retry(() => zk("setHonoredIssuers", { issuers: ["test.mock-issuer"] }));
    await retry(() => zk("seedDecoys", { count: 60 }));
    await retry(() => zk("register"));
    await retry(() => zk("advanceEpoch"));
    const prove = async () => {
      for (let i = 0; i < 8; i++) {
        await retry(() => zk("prefetchNow"));
        await sleep(300);
        await fetch(BASE + "/home").catch(() => {});
        await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
        const t = (await retry(() => api("GET", `/api/tier?personaId=${MAIN}`))).json;
        if (t.proven && t.tier > 0) return t.tier;
        await sleep(400);
      }
      throw new Error("MAIN never proved a tier under zk");
    };
    const t0 = await prove();
    const before = await rootTier();
    const rowsBefore = stewardshipRows().length;
    const a0 = await allowance();
    if (a0.tier !== t0 || a0.allowance !== 10 + 4 * t0) throw new Error(`allowance is not derived from the PROVEN tier: ${JSON.stringify(a0)} vs proven ${t0}`);
    let after = before;
    let posted = 0;
    for (let round = 0; round < 8 && after <= before; round++) {
      const a = await allowance();
      const amt = Math.min(a.remaining, 10);
      if (amt <= 0) throw new Error("no allowance to stake from in round " + round + ": " + JSON.stringify(a));
      const s = await stake("0xfa0016", "refute", { direction: "wrong", amount: amt });
      if (s.status !== 200) throw new Error("stake failed in round " + round + ": " + JSON.stringify(s.json));
      await retry(() => zk("advanceEpoch"));
      await prove();
      const settle = await api("POST", "/api/influence", { action: "settle" });
      if (settle.status !== 200) throw new Error("settle failed: " + JSON.stringify(settle.json));
      if (!settle.json.evaluation.confirmed) throw new Error("the wrong stake on a noted cast was not confirmed: " + JSON.stringify(settle.json.evaluation.items));
      if (settle.json.record.count < 1 || !settle.json.posted) throw new Error("nothing accrued: " + JSON.stringify(settle.json.record));
      posted += settle.json.record.count;
      after = await rootTier();
      if (before >= 10 && stewardshipRows().length > rowsBefore) break; // already top decile: the event landing is the proof
    }
    const rows = stewardshipRows();
    if (rows.length <= rowsBefore || rows.some((r) => r.root_id !== ROOT)) throw new Error("no stewardship rep event landed on the root: " + JSON.stringify(rows));
    if (before < 10 && !(after > before)) throw new Error(`root rep did not move a tier after ${posted} stewardship (tier ${before} → ${after})`);
    // idempotent: settling the same window again posts nothing new
    const again = await api("POST", "/api/influence", { action: "settle", evaluatedEpoch: rows[rows.length - 1].source_id.split(":")[1] });
    if (again.status !== 200 || again.json.posted !== false) throw new Error("re-settling a window posted again: " + JSON.stringify(again.json));
    if (stewardshipRows().length !== rows.length) throw new Error("a duplicate stewardship row landed");
    // the persona PROVES the new tier (next epoch's trees carry the new rep)
    await retry(() => zk("advanceEpoch"));
    const t1 = await prove();
    if (before < 10 && !(t1 > t0)) throw new Error(`the persona did not prove a higher tier (${t0} → ${t1}) after the root moved (${before} → ${after})`);
    const a1 = await allowance();
    if (a1.allowance !== 10 + 4 * t1) throw new Error("the new allowance does not follow the proven tier: " + JSON.stringify(a1));
    // LEAK: nothing on the validator joins the staking persona to the root it accrued on
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const cols = db.prepare("PRAGMA table_info(stakes)").all().map((c) => c.name);
      if (cols.some((c) => /root/i.test(c))) throw new Error("the stakes table has a root column: " + cols.join(","));
      for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) {
        for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) {
          const s = JSON.stringify(row);
          if (s.includes(MAIN) && s.includes(ROOT)) throw new Error(`${t} row joins the persona to its root`);
        }
      }
    } finally { db.close(); }
  } finally {
    await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
  }
});

await check("6. HISTORY AT THE DISCLOSURE LEVEL, FAIL CLOSED: the owner always; a stranger only when admitted; a failed disclosure read refuses, never serves", async () => {
  await reset();
  await retry(() => stake("0xcr0001", "like", { amount: 1 }));
  const own = (await retry(() => api("GET", `/api/influence?view=history&personaId=${MAIN}`))).json;
  if (!own.own || !own.stakes.length) throw new Error("the owner cannot see their own history: " + JSON.stringify(own));
  await retry(() => api("POST", "/api/disclosure", { personaId: MAIN, level: "hidden" }));
  const hidden = await api("GET", `/api/influence?view=history&personaId=${MAIN}`, undefined, asViewer(STRANGER));
  if (hidden.status !== 403) throw new Error("a stranger read a hidden persona's history: " + hidden.status + " " + JSON.stringify(hidden.json).slice(0, 120));
  await retry(() => api("POST", "/api/disclosure", { personaId: MAIN, level: "public" }));
  const pub = await api("GET", `/api/influence?view=history&personaId=${MAIN}`, undefined, asViewer(STRANGER));
  if (pub.status !== 200 || !pub.json.stakes.length || pub.json.own) throw new Error("a public persona's history was not served to a stranger: " + pub.status);
  await retry(() => dev("forceFail", { label: "disclosure.canViewLinkage", count: 6 }));
  const failed = await api("GET", `/api/influence?view=history&personaId=${MAIN}`, undefined, asViewer(STRANGER));
  await retry(() => dev("forceFail", { label: "", count: 0 }));
  if (failed.status === 200) throw new Error("history served while the disclosure check was failing (fail-open)");
  if (![403, 503].includes(failed.status)) throw new Error("unexpected status under a failing disclosure read: " + failed.status);
});

await check("7. THE COORDINATED CLUSTER is visible in the influence layer (API + settings pane)", async () => {
  // the seed lands the cluster in the epoch BEFORE the one current at seed time; check 6's reset re-seeded it
  // against the epoch current THEN (check 5's resetZk moved the clock), so read the epoch now, not at start
  const E = (await allowance()).epoch;
  const c = (await retry(() => api("GET", `/api/influence?view=clusters&epoch=${E - 1}`))).json;
  const cl = (c.clusters ?? []).find((x) => x.members.length === 3 && x.direction === "good");
  if (!cl) throw new Error("no 3-member good cluster in epoch " + (E - 1) + " (E0 was " + E0 + "): " + JSON.stringify(c).slice(0, 300));
  const want = ["persona_acc_crypto_4", "persona_acc_crypto_5", "persona_acc_crypto_6"];
  if (cl.members.join() !== want.join() || cl.casts.length < 3) throw new Error("cluster is not the seeded one: " + JSON.stringify(cl));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE + "/settings/influence", { waitUntil: "networkidle" });
    await page.locator("[data-testid='influence-allowance']").waitFor({ timeout: 10000 });
    const pane = page.locator("[data-testid='influence-clusters']");
    await pane.waitFor({ timeout: 10000 });
    const epochShown = Number(await pane.getAttribute("data-epoch"));
    const count = Number(await pane.getAttribute("data-count"));
    // the pane shows the PREVIOUS epoch by default — where the seed put the cluster
    if (epochShown !== E - 1) throw new Error(`the pane shows epoch ${epochShown}, expected ${E - 1}`);
    if (count < 1) throw new Error("the pane shows no cluster for the seeded epoch");
    if (!(await page.locator("[data-testid='influence-default-like']").count())) throw new Error("the per-action stake settings are not rendered");
  } finally {
    await browser.close();
  }
});

await check("8. LEAKS: the influence namespace is ciphertext on the validator; no balance/allowance plaintext in its database; stake rows carry no root", async () => {
  const st = (await vapi("/state")).json?.state ?? {};
  const ns = st.influence ?? {};
  if (!Object.keys(ns).length) throw new Error("the influence namespace is empty on the validator (nothing was sealed)");
  for (const [k, v] of Object.entries(ns)) if (!(v && typeof v === "object" && typeof v.ct === "string")) throw new Error(`influence/${k} is not ciphertext`);
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found");
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) {
      for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) {
        const s = JSON.stringify(row);
        if (/"remaining"|"allowance"|layers-stake-balance/.test(s)) throw new Error(`${t} row carries allowance plaintext`);
      }
    }
    for (const row of db.prepare("SELECT * FROM stakes").all()) if (Object.keys(row).some((c) => /root/i.test(c)) || JSON.stringify(row).includes(ROOT)) throw new Error("a stake row names a root");
  } finally { db.close(); }
});

await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Mega pass 2 Gate 1 (reputation UBI) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
