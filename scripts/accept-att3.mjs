// ATTESTATION PASS Gate 3 — attestation-gated surfaces + the label.
// FIXTURE-ONLY (ZK_DEV_HOOKS=true on both processes).
//
//   1. RULES: `attest.holds` is an evaluable, buildable field; proof-mediated by construction
//   2. MODE GATE (the money shot): a mode gated on "proved Morpho" shows the
//      persona that PROVED it and hides the sibling that did not; off the
//      zk binding the predicate matches nothing (fail closed)
//   3. FILTER PACK: the pack primitive resolves attest:<issuer>/<bucket> the same way
//   4. AUDIENCE: an attestation audience is held to the zk floor — the
//      builder reports it, the API refuses the campaign; graph-claim
//      audiences keep the market's k-floor
//   5. LABEL: the ninth condition flips DEMO ↔ claim on the bucket's floor
//   6. SCORE: attested onchain claims move the Ad Match Score at the attested weight; breakdown sums exactly
//   7. DOCS
import { chromium } from "playwright";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { Identity } from "@semaphore-protocol/identity";
import { poseidon2 } from "poseidon-lite";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const PH = "onchain.protocol-history";
const MORPHO = `${PH}/morpho`;
const wallet = (i) => privateKeyToAccount(keccak256(toBytes(`layers-chain-wallet/${i}`)));

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
  for (let i = 0; i < attempts; i++) { try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + JSON.stringify(r.json).slice(0, 300)); } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
  throw last;
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const status = async () => (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const viewAs = (personaId) => retry(() => api("POST", "/api/dev", { action: "viewAs", personaId }));
const advance = async () => { await retry(() => zk("advanceEpoch")); await retry(() => zk("prefetchNow")); await sleep(200); };
const proveVia = async (personaId, issuer, bucket) => {
  const s = (await zk("requestAttestation", { personaId, issuer, bucket })).json;
  if (s.scheduled !== true) throw new Error(`requestAttestation ${issuer}/${bucket}: ` + JSON.stringify(s));
  await retry(() => zk("prefetchNow"));
  await sleep(400);
  return (await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }))).json;
};
async function issueWith(issuerId, wallets, extra = {}) {
  const ch = (await retry(() => zk("attestChallenge", { issuerId }))).json;
  const signed = [];
  for (const w of wallets) signed.push({ address: w.address, challengeSig: await w.signMessage({ message: ch.challenge }) });
  return (await zk("requestIssuance", { issuerId, wallets: signed, challenge: ch.challenge, ...extra })).json;
}
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
let prevModeId = null;
/** the FOLLOWING surface as `viewer`: the tier gate applies only to discovery, mode rules apply everywhere */
async function feedCards(viewer) {
  await viewAs(viewer);
  const r = await retry(() => api("GET", "/api/feed2?surface=following"));
  await viewAs(null);
  return (r.json.cards ?? []).filter((c) => c.kind === "post" && c.cast?.hash);
}
const hashesOf = (cards) => new Set(cards.map((c) => c.cast.hash));

// ---- the crowd rig: a fixture attestation proof for ANY persona id under a decoy root that is a leaf of the bucket tree ----
const te = new TextEncoder();
const toHex = (b) => Buffer.from(b).toString("hex");
const toBeBytes32 = (x) => { const out = new Uint8Array(32); let v = x; for (let i = 31; i >= 0; i--) { out[i] = Number(v & 255n); v >>= 8n; } return out; };
const semaphoreHash = (x) => BigInt("0x" + toHex(keccak_256(toBeBytes32(x)))) >> 8n;
const fieldOf = (domain, canonical) => BigInt("0x" + toHex(sha256(te.encode(`layers-zk-field/1|${domain}|${canonical}`)))) >> 8n;
const nullifierFor = (scopeValue, secret) => poseidon2([semaphoreHash(scopeValue), secret]);
const canonicalPublicInputs = (p) => ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge].join("|");
const fixtureTag = (canonical, nullifier) => createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
const leadingZeroBits = (buf) => { let n = 0; for (const b of buf) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; } return n; };
function solvePow(body, bits) { const bh = createHash("sha256").update(body).digest("hex"); for (let i = 0; ; i++) { const nonce = i.toString(36); if (leadingZeroBits(createHash("sha256").update(bh + "|" + nonce).digest()) >= bits) return nonce; } }
function rawPost(url, body, headers) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", agent: false, headers: { ...headers, "content-length": String(body.length) } }, (res) => { const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) })); });
    req.on("error", reject);
    req.end(body);
  });
}
/** prove `issuer/bucket` FOR persona `personaId` this epoch, as some decoy root that is a leaf of that bucket (the fixture proof is a tag; the nullifier is real) */
async function crowdProve(personaId, issuer, bucket) {
  const tree = `attest:${issuer}/${bucket}`;
  const m = (await (await fetch(VBASE + `/zk/members?mode=fixture&tree=${encodeURIComponent(tree)}`)).json());
  const epoch = m.epoch;
  let decoy = null;
  for (let i = 0; i < 200 && !decoy; i++) { const id = new Identity("layers-zk-decoy/" + i); if (m.members.includes(id.commitment.toString(10))) decoy = id; }
  if (!decoy) throw new Error("no decoy root is a leaf of " + tree);
  const scope = fieldOf("scope", `layers/zk-scope/v1|attestation/${issuer}/${bucket}|${epoch}|${personaId}`).toString(10);
  const challenge = "epoch-" + epoch;
  const message = fieldOf("message", [personaId, tree, tree, challenge, m.root].join("|")).toString(10);
  const pub = { mode: "fixture", claimKind: "attestation", tree, epoch, merkleTreeRoot: m.root, scope, message, personaId, gateId: tree, challenge, issuer, bucket };
  const nullifier = nullifierFor(BigInt(scope), decoy.secretScalar).toString(10);
  const env = { v: 1, mode: "fixture", claimKind: "attestation", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(pub), nullifier) } };
  const body = Buffer.from(JSON.stringify({ envelope: env }));
  const bits = (await status()).pow.bits;
  const r = await rawPost(VBASE + "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": solvePow(body, bits) });
  let outcome = "unparseable"; try { outcome = JSON.parse(r.buf.toString("utf8")).outcome; } catch {}
  if (outcome !== "accepted" && outcome !== "replay") throw new Error(`crowd proof for ${personaId} ${tree}: ${outcome}`);
}
const MORPHO_RULE = { combinator: "AND", negate: true, clauses: [{ field: "attest.holds", op: "eq", value: MORPHO }] };

console.log("\nAttestation pass Gate 3 — attestation-gated surfaces and the label");

// ---- setup: a fresh universe, onchain issuance for us + the cohort, MAIN proves morpho ----
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
await retry(() => zk("resetZk"));
await retry(() => zk("setRepImpl", { impl: "zk" }));
await retry(() => zk("setHonoredIssuers", { issuers: ["onchain.*"] }));
await retry(() => zk("seedDecoys", { count: 80 }));
await retry(() => zk("register"));
await advance();
const FLOOR = (await status()).floor;
const W0 = wallet(0);
for (const id of [PH, "onchain.wallet-age"]) await retry(() => zk("registerIssuer", { issuerId: id }));
const iss = await issueWith(PH, [W0], { includeCohort: true });
if (iss.status !== 200) throw new Error("setup issuance: " + JSON.stringify(iss).slice(0, 200));
await advance();
await proveVia(ALT, PH, "morpho");

// ---- 1. rules ----
await check("1. RULES: `attest.holds` is an evaluable, buildable rule field (evaluator allowlist, label, builder), and the evaluator's branch is proof-mediated by construction", async () => {
  const ev = readFileSync("lib/rules/evaluate.ts", "utf8");
  if (!/"attest\.holds",/.test(ev) || !/cond\.field === "attest\.holds"/.test(ev) || !/PROVED this epoch/.test(ev)) throw new Error("evaluate.ts lacks the attest.holds branch");
  const rb = readFileSync("components/settings/RuleBuilder.tsx", "utf8");
  if (!/value: "attest\.holds"/.test(rb)) throw new Error("RuleBuilder lacks the field");
  const rule = (await retry(() => api("POST", "/api/rules", { name: "att3 probe", action: "hide", root: MORPHO_RULE }))).json.rule;
  if (!rule?.id || rule.root?.clauses?.[0]?.field !== "attest.holds") throw new Error("rule not stored: " + JSON.stringify(rule).slice(0, 200));
});

// ---- 2. the mode gate ----
let modeId = null;
let X = null; // a followed author who PROVES morpho (through the crowd rig)
let Y = null; // a followed author who does not
await check("2. MODE GATE (the money shot): on the following feed, a mode that hides authors who did NOT prove onchain.protocol-history/morpho shows author X's post (X proved) and hides author Y's (Y did not); once Y proves, both show; under the non-zk binding the predicate matches nothing and BOTH are hidden (proof-mediated, fail closed); off the mode both return", async () => {
  const before = await feedCards(MAIN);
  const authors = [...new Set(before.map((c) => c.cast.personaId).filter((p) => p && p !== MAIN && p !== ALT))];
  if (authors.length < 2) throw new Error("the following feed shows fewer than two other authors: " + authors.length);
  [X, Y] = authors;
  const hx = before.find((c) => c.cast.personaId === X).cast.hash;
  const hy = before.find((c) => c.cast.personaId === Y).cast.hash;
  await crowdProve(X, PH, "morpho");
  await viewAs(MAIN);
  const modes = (await retry(() => api("GET", "/api/modes"))).json;
  prevModeId = modes.active?.id ?? modes.activeMode?.id ?? (modes.modes ?? []).find((m) => m.isPreset)?.id ?? null;
  const rule = (await retry(() => api("POST", "/api/rules", { name: "Morpho users only", action: "hide", root: MORPHO_RULE }))).json.rule;
  const mode = (await retry(() => api("POST", "/api/modes", { name: "Morpho users", ranking: { recency: 1, engagement: 1, authorAffinity: 1, clusterAffinity: 1 }, ruleIds: [rule.id], notificationPolicy: "all", actionButtonSlots: { composer: [], nav: [] }, showTrending: true, calmRanking: false, isPreset: false }))).json.mode;
  modeId = mode.id;
  await retry(() => api("POST", "/api/modes/active", { modeId }));
  await viewAs(null);
  const gated = hashesOf(await feedCards(MAIN));
  if (!gated.has(hx)) throw new Error("X proved morpho but its post is hidden under the mode");
  if (gated.has(hy)) throw new Error("Y did not prove morpho but its post is shown under the mode");
  // Y proves too → appears on the next build
  await crowdProve(Y, PH, "morpho");
  const both = hashesOf(await feedCards(MAIN));
  if (!both.has(hy)) throw new Error("Y proved morpho but its post stays hidden");
  // off the zk binding the map is EMPTY: the predicate matches nobody → everything the rule guards is hidden
  await retry(() => zk("setRepImpl", { impl: "mock" }));
  const dark = hashesOf(await feedCards(MAIN));
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  if (dark.has(hx) || dark.has(hy)) throw new Error("under the mock binding an attestation predicate matched — the surface is not proof-mediated");
  if (prevModeId) {
    await viewAs(MAIN);
    await retry(() => api("POST", "/api/modes/active", { modeId: prevModeId }));
    await viewAs(null);
    const after = hashesOf(await feedCards(MAIN));
    if (!after.has(hx) || !after.has(hy)) throw new Error("posts did not return after leaving the mode");
  }
});

// ---- 3. filter packs ----
await check("3. FILTER PACK: the pack primitive resolves attest:onchain.protocol-history/morpho for a persona that PROVED it (ALT) and not for one that did not; a held-but-unproven bucket (our root HOLDS aave; ALT never proved it) is false", async () => {
  const a = (await retry(() => zk("attestPredicateProbe", { personaId: ALT, claim: "attest:" + MORPHO }))).json;
  if (a.holds !== true) throw new Error("ALT proved morpho but the pack primitive says no: " + JSON.stringify(a).slice(0, 200));
  const b = (await retry(() => zk("attestPredicateProbe", { personaId: "persona_seed_nobody", claim: "attest:" + MORPHO }))).json;
  if (b.holds !== false) throw new Error("a stranger holds morpho");
  const c = (await retry(() => zk("attestPredicateProbe", { personaId: ALT, claim: `attest:${PH}/aave` }))).json;
  if (c.holds !== false) throw new Error("ALT's root HOLDS an aave issuance it never proved — the pack primitive read the tree, not the proof");
});

// ---- 4. the audience builder ----
await check("4. AUDIENCE: an attestation audience is held to the zk floor (the builder reports kFloor = max(k, ZK_ANON_FLOOR) and belowFloor); the API refuses the campaign; a graph-claim audience keeps the market's k-floor", async () => {
  const audience = { combinator: "AND", clauses: [{ field: "attest.holds", op: "eq", value: MORPHO }] };
  const est = (await retry(() => api("GET", `/api/market/campaign?audience=${encodeURIComponent(JSON.stringify(audience))}`))).json;
  if (est.kFloor < FLOOR || est.belowFloor !== true || est.size >= FLOOR) throw new Error("estimate: " + JSON.stringify(est));
  const post = await api("POST", "/api/market/campaign", { name: "morpho users", audience, budget: 10 });
  if (post.status !== 422 || !/floor/.test(post.json?.error ?? "")) throw new Error("sub-floor attestation audience was not refused: " + post.status + " " + JSON.stringify(post.json).slice(0, 200));
  const plain = { combinator: "AND", clauses: [{ field: "author.tier", op: "gte", value: 1 }] };
  const est2 = (await retry(() => api("GET", `/api/market/campaign?audience=${encodeURIComponent(JSON.stringify(plain))}`))).json;
  if (est2.kFloor !== 8) throw new Error("a graph/tier audience should keep the market's k-floor 8, got " + JSON.stringify(est2));
});

// ---- 5. the label ----
await check("5. LABEL: with an attestation-gated surface the verdict carries a NINTH condition — ok when the gated bucket clears the floor on the tick's census (morpho), failing and NAMED when it does not (compound); without a gated surface there are eight", async () => {
  await retry(() => zk("prefetchNow"));
  const plain = (await retry(() => zk("privacyConditions"))).json;
  if (plain.conditions.length !== 8) throw new Error("expected 8 conditions, got " + plain.conditions.length);
  const good = (await retry(() => zk("privacyConditions", { attestation: { issuer: PH, bucket: "morpho" } }))).json;
  const c9 = good.conditions.find((c) => c.id === 9);
  if (!c9 || c9.key !== "attestation" || c9.ok !== true || !/vs the client's floor/.test(c9.detail)) throw new Error("condition 9 for morpho: " + JSON.stringify(c9));
  const thin = (await retry(() => zk("privacyConditions", { attestation: { issuer: PH, bucket: "compound" } }))).json;
  const t9 = thin.conditions.find((c) => c.id === 9);
  if (!t9 || t9.ok !== false || !/below the client's floor/.test(t9.detail) || !thin.failing.some((f) => f.startsWith("attestation:"))) throw new Error("condition 9 for compound: " + JSON.stringify(t9));
  if (thin.private !== false || !thin.label.startsWith("DEMO")) throw new Error("a failing bucket condition did not read DEMO");
  const unhonoured = (await retry(() => zk("privacyConditions", { attestation: { issuer: "test.mock-issuer", bucket: "any" } }))).json;
  if (unhonoured.conditions.find((c) => c.id === 9)?.ok !== false) throw new Error("an un-honoured issuer's bucket passed the label");
});

// ---- 6. the score ----
await check("6. SCORE: MAIN's Ad Match Score counts the root's honoured onchain attestations at the ATTESTED weight (10x a self-declared claim of the same category); the breakdown sums to rawTotal exactly; un-honouring the issuer removes them", async () => {
  await viewAs(MAIN);
  const withAtt = (await retry(() => api("GET", "/api/graph/score"))).json;
  const att = withAtt.breakdown.filter((f) => f.source === "attested" && /onchain/.test(f.label));
  if (att.length < 3) throw new Error("expected ≥3 attested onchain factors (aave, morpho, uniswap), got " + att.length + ": " + JSON.stringify(withAtt.breakdown).slice(0, 300));
  const sum = withAtt.breakdown.reduce((a, f) => a + f.points, 0);
  if (sum !== withAtt.rawTotal) throw new Error(`breakdown sums to ${sum}, rawTotal ${withAtt.rawTotal}`);
  const habitsAttested = att.find((f) => f.category === "habits");
  if (!habitsAttested || habitsAttested.points !== 10) throw new Error("attested habits claim should be worth 10 (100% of base 10): " + JSON.stringify(habitsAttested));
  await retry(() => zk("setHonoredIssuers", { issuers: ["test.*"] }));
  const without = (await retry(() => api("GET", "/api/graph/score"))).json;
  await retry(() => zk("setHonoredIssuers", { issuers: ["onchain.*"] }));
  await viewAs(null);
  if (without.breakdown.some((f) => /onchain/.test(f.label))) throw new Error("un-honoured issuer's claims still counted");
  if (!(without.rawTotal < withAtt.rawTotal)) throw new Error("attestations did not move the score");
});

// ---- 7. docs ----
await check("7. DOCS: SECURITY-POSTURE.md §13 states the surfaces evaluate against what a persona PROVED, the one-floor rule, and the ninth label condition", async () => {
  const s = readFileSync("SECURITY-POSTURE.md", "utf8");
  for (const n of ["attest.holds", "PROVED this", "ninth label condition", "lib/zk/floor.ts"]) if (!s.includes(n)) throw new Error("posture doc lacks: " + n);
});

// best-effort: leave the mode we made (resetSeed at the next suite resets modes anyway)
if (prevModeId && modeId) { try { await viewAs(MAIN); await api("POST", "/api/modes/active", { modeId: prevModeId }); await viewAs(null); } catch {} }
await retry(() => zk("setHonoredIssuers", { issuers: null }));
// leave the app on its DEFAULT rep binding (the z8/z9 idiom): under the zk
// binding a persona created by the next suite is never proven within its
// wait — closing series 2 sweep 2 and series 3 sweep 2 both lost
// functional's tier-badge check to the binding this suite had left behind
await retry(() => zk("setRepImpl", { impl: null }));
await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Attestation Gate 3 checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exit(failed ? 1 : infra ? 2 : 0);
