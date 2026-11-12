// ATTESTATION PASS Gate 2 — the onchain-facts reference issuer, on the
// FIXTURE chain-facts adapter (recorded facts for seeded wallets; sweeps
// never touch the network). ZK_DEV_HOOKS=true on both processes.
//
//   1. REGISTRY: four onchain.* issuers with different schemas and
//      buckets under ONE shared key, listed beside the mock issuer
//   2. CHALLENGE + ISSUE: a fixture wallet signs the issuer's challenge;
//      all four kinds issue the buckets the recorded facts support;
//      a bad signature, no wallet, and a foreign challenge are refused
//   3. COHORT + BATCH: the crowd's synthetic facts populate the buckets
//      next epoch; two buckets are deliberately THIN
//   4. PROVE each kind → eligibility ("attested") per persona and bucket
//   5. SUB-FLOOR BUCKETS are refused client-side before any proof
//   6. EXACT VALUES AND THE ADDRESS never appear anywhere
//   7. MULTI-WALLET aggregation at the root; the validator never sees the
//      wallet set or its size
//   8. REVOCATION of one issuance removes exactly that leaf
//   9. live-att1 is wired and the sweeps run on the fixture source
//  10. DOCS: bucket boundaries + floor arithmetic in the posture doc
import { chromium } from "playwright";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const ISSUERS = ["onchain.wallet-age", "onchain.holdings", "onchain.protocol-history", "onchain.governance"];
const TREE = (issuer, b) => `attest:${issuer}/${b}`;
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
async function vapi(p) { const r = await fetch(VBASE + p); return { status: r.status, json: await r.json().catch(() => null) }; }
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) { try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + JSON.stringify(r.json).slice(0, 300)); } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
  throw last;
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const status = async () => (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const census = async () => (await vapi(`/zk/attest/buckets?mode=fixture`)).json.buckets;
const sizeOf = async (issuer, b) => (await census()).find((x) => x.issuer === issuer && x.bucket === b)?.size ?? 0;
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
  if (typeof ch.challenge !== "string") throw new Error("attestChallenge: " + JSON.stringify(ch));
  const signed = [];
  for (const w of wallets) signed.push({ address: w.address, challengeSig: await w.signMessage({ message: ch.challenge }) });
  return (await zk("requestIssuance", { issuerId, wallets: signed, challenge: ch.challenge, ...extra })).json;
}

console.log("\nAttestation pass Gate 2 — the onchain-facts reference issuer (fixture chain facts)");

// ---- setup ----
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
await retry(() => zk("resetZk"));
await retry(() => zk("setRepImpl", { impl: "zk" }));
await retry(() => zk("setHonoredIssuers", { issuers: ["onchain.*"] }));
// 120, not 80: the RUNNING INTERSECTION (Gate 4) holds a persona's proven buckets to the floor, and at 80 the by-index spread's morpho ∩ gt2y is 46
await retry(() => zk("seedDecoys", { count: 120 }));
await retry(() => zk("register"));
await advance();
const FLOOR = (await status()).floor;
const W0 = wallet(0);
const W1 = wallet(1);

// ---- 1. registry ----
await check("1. REGISTRY: the four onchain.* issuers register with DIFFERENT schemas and bucket sets under ONE shared key; the list shows them beside the mock issuer (two unrelated issuers behind one interface)", async () => {
  for (const id of ISSUERS) { const r = (await retry(() => zk("registerIssuer", { issuerId: id }))).json; if (!r.ok) throw new Error(id + ": " + JSON.stringify(r).slice(0, 200)); }
  await retry(() => zk("registerIssuer", { issuerId: "test.mock-issuer" }));
  const list = (await retry(() => zk("issuers"))).json;
  const mine = list.issuers.filter((i) => ISSUERS.includes(i.id));
  if (mine.length !== 4) throw new Error("expected 4 onchain issuers, got " + mine.map((i) => i.id).join(","));
  const keys = new Set(mine.map((i) => i.pubkey));
  if (keys.size !== 1) throw new Error("the onchain family should share ONE key in phase 1");
  const titles = new Set(mine.map((i) => i.claimSchema?.title));
  if (titles.size !== 4) throw new Error("schemas are not distinct: " + [...titles].join(","));
  const ph = mine.find((i) => i.id === "onchain.protocol-history");
  if (ph.buckets.includes("aerodrome") || ph.buckets.join(",") !== "aave,morpho,compound,uniswap") throw new Error("protocol set: " + ph.buckets.join(","));
  if (!mine.every((i) => i.honored === true)) throw new Error("onchain.* is not honoured by default");
  const mock = list.issuers.find((i) => i.id === "test.mock-issuer");
  if (!mock || mock.honored !== false || mock.pubkey === ph.pubkey) throw new Error("the mock issuer should be listed, un-honoured, under its own key");
  // Gate 4: honour is by KEY. The default pin (this process's onchain key) honours the family; a pin to another key does not; a pinned pattern never matches without the registry's key
  await retry(() => zk("setHonoredIssuers", { issuers: null }));
  const byDefault = (await retry(() => zk("issuers"))).json;
  if (!byDefault.honoredPatterns?.[0]?.startsWith("onchain.*@") || !byDefault.issuers.filter((i) => ISSUERS.includes(i.id)).every((i) => i.honored === true)) throw new Error("the default pin does not honour the co-hosted onchain family: " + JSON.stringify(byDefault.honoredPatterns));
  await retry(() => zk("setHonoredIssuers", { issuers: ["onchain.*@" + "0".repeat(64)] }));
  const wrongPin = (await retry(() => zk("issuers"))).json;
  if (wrongPin.issuers.filter((i) => ISSUERS.includes(i.id)).some((i) => i.honored === true)) throw new Error("an onchain issuer is honoured under a pin to another key");
  const sched = (await zk("requestAttestation", { personaId: MAIN, issuer: "onchain.protocol-history", bucket: "morpho" })).json;
  if (sched.scheduled !== false) throw new Error("a proof was scheduled for an issuer pinned to another key");
  await retry(() => zk("setHonoredIssuers", { issuers: ["onchain.*"] }));
});

// ---- 2. challenge + issue ----
let issued0 = null;
await check("2. CHALLENGE + ISSUE: fixture wallet 0 signs the issuer's challenge; each kind issues exactly the buckets the recorded facts support (nested buckets all fire); a wrong signature, no wallet, and a foreign challenge are refused", async () => {
  const E = (await status()).epoch;
  const expect = { "onchain.wallet-age": ["gt1y", "gt2y", "gt4y"], "onchain.holdings": ["eth-gte-0.1", "eth-gte-1"], "onchain.protocol-history": ["aave", "morpho", "uniswap"], "onchain.governance": ["votes-gte-1", "votes-gte-5"] };
  issued0 = {};
  for (const id of ISSUERS) {
    const r = await issueWith(id, [W0]);
    const resp = r.response;
    if (r.status !== 200 || resp?.ok !== true || resp.activeFromEpoch !== E + 1 || resp.accepted !== expect[id].length) throw new Error(id + ": " + JSON.stringify(r).slice(0, 300));
    if ([...resp.buckets].sort().join(",") !== [...expect[id]].sort().join(",")) throw new Error(id + " buckets " + resp.buckets.join(",") + " ≠ " + expect[id].join(","));
    issued0[id] = resp;
  }
  // refusals
  const ch = (await retry(() => zk("attestChallenge", { issuerId: "onchain.wallet-age" }))).json.challenge;
  const goodSig = await W0.signMessage({ message: ch });
  // tamper a byte in the MIDDLE of the signature (the last byte is the recovery id, which verifiers normalise — 0 ≡ 27)
  const tampered = goodSig.slice(0, 20) + (goodSig[20] === "0" ? "1" : "0") + goodSig.slice(21);
  const bad = (await zk("requestIssuance", { issuerId: "onchain.wallet-age", wallets: [{ address: W0.address, challengeSig: tampered }], challenge: ch })).json;
  if (bad.status !== 400 || !/signature|control/.test(bad.response?.reason ?? "")) throw new Error("bad signature accepted: " + JSON.stringify(bad).slice(0, 200));
  const none = (await zk("requestIssuance", { issuerId: "onchain.wallet-age" })).json;
  if (none.status !== 400 || !/wallet/.test(none.response?.reason ?? "")) throw new Error("no-wallet issuance accepted: " + JSON.stringify(none).slice(0, 200));
  const foreign = (await zk("requestIssuance", { issuerId: "onchain.wallet-age", wallets: [{ address: W0.address, challengeSig: await W0.signMessage({ message: "not a challenge" }) }], challenge: "not a challenge" })).json;
  if (foreign.status !== 400 || !/challenge/.test(foreign.response?.reason ?? "")) throw new Error("foreign challenge accepted: " + JSON.stringify(foreign).slice(0, 200));
});

// ---- 3. cohort + batch ----
await check("3. COHORT + BATCH: the crowd's synthetic facts populate the buckets NEXT epoch (nothing this epoch); broad buckets clear the floor, compound and gt4y are deliberately THIN", async () => {
  // our own issuance rides a signed challenge (a renewal); the DECOYS need no wallet — the cohort loop flags them
  for (const id of ISSUERS) {
    const r = await issueWith(id, [W0], { includeCohort: true });
    if (r.status !== 200 || !(r.response?.cohortAttested >= FLOOR)) throw new Error(id + " cohort: " + JSON.stringify(r).slice(0, 200));
  }
  if ((await sizeOf("onchain.protocol-history", "morpho")) > 0) throw new Error("buckets have leaves in the issuing epoch (not batched)");
  await advance();
  const broad = [["onchain.protocol-history", "aave"], ["onchain.protocol-history", "morpho"], ["onchain.protocol-history", "uniswap"], ["onchain.wallet-age", "gt1y"], ["onchain.wallet-age", "gt2y"], ["onchain.holdings", "eth-gte-0.1"], ["onchain.governance", "votes-gte-1"]];
  for (const [i, b] of broad) { const n = await sizeOf(i, b); if (n < FLOOR) throw new Error(`${i}/${b} = ${n} < floor ${FLOOR}`); }
  for (const [i, b] of [["onchain.protocol-history", "compound"], ["onchain.wallet-age", "gt4y"]]) { const n = await sizeOf(i, b); if (n === 0 || n >= FLOOR) throw new Error(`${i}/${b} = ${n} should be thin (0 < n < ${FLOOR})`); }
});

// ---- 4. prove each kind ----
await check("4. PROVE: MAIN proves protocol-history/morpho and wallet-age/gt2y; ALT proves holdings/eth-gte-1 and governance/votes-gte-1 — each read back as attested with the bucket named; the map lists both personas", async () => {
  await proveVia(MAIN, "onchain.protocol-history", "morpho");
  await proveVia(MAIN, "onchain.wallet-age", "gt2y");
  await proveVia(ALT, "onchain.holdings", "eth-gte-1");
  await proveVia(ALT, "onchain.governance", "votes-gte-1");
  for (const [p, i, b] of [[MAIN, "onchain.protocol-history", "morpho"], [MAIN, "onchain.wallet-age", "gt2y"], [ALT, "onchain.holdings", "eth-gte-1"], [ALT, "onchain.governance", "votes-gte-1"]]) {
    const at = (await retry(() => zk("attested", { personaId: p, issuer: i, bucket: b }))).json;
    if (at.attested !== true || !at.buckets?.includes(b)) throw new Error(`${p} ${i}/${b}: ` + JSON.stringify(at));
  }
  const map = (await retry(() => zk("attestedMap"))).json;
  if (!map.claims?.[MAIN]?.includes("onchain.protocol-history/morpho") || !map.claims?.[ALT]?.includes("onchain.holdings/eth-gte-1")) throw new Error("attested map: " + JSON.stringify(map).slice(0, 300));
});

// ---- 5. sub-floor refused ----
await check("5. SUB-FLOOR: a thin bucket (compound, gt4y) is refused CLIENT-SIDE at the cohort stage — no proof is built, no submission leaves, nothing is honoured anywhere", async () => {
  for (const [i, b] of [["onchain.protocol-history", "compound"], ["onchain.wallet-age", "gt4y"]]) {
    const r = (await zk("prove", { claimKind: "attestation", tree: TREE(i, b), personaId: MAIN, gateId: TREE(i, b), issuer: i, bucket: b })).json;
    if (r.ok !== false || r.stage !== "cohort" || !/floor/.test(r.reason ?? "")) throw new Error(`${i}/${b} not refused at the floor: ` + JSON.stringify(r).slice(0, 200));
  }
  const at = (await retry(() => zk("attested", { personaId: MAIN, issuer: "onchain.protocol-history", bucket: "compound" }))).json;
  if (at.attested !== false) throw new Error("a thin bucket reads attested");
});

// ---- 6. leaks ----
await check("6. EXACT VALUES NEVER APPEAR: wallet 0's address, exact balance and first-tx timestamp are nowhere in the validator's database, WAL, log, or responses; our vault holds buckets only (no address, no wei); the issuer's retention file holds a salted hash, never the address; the issuer key is nowhere", async () => {
  const needles = [W0.address.toLowerCase(), W0.address.slice(2).toLowerCase(), "2500000000000000000", "1546300800000"];
  const vdir = path.join(process.cwd(), "validator");
  for (const f of ["layers.db", "layers.db-wal"]) {
    const p = path.join(vdir, f);
    if (!existsSync(p)) continue;
    const bytes = readFileSync(p);
    for (const n of needles) if (bytes.includes(Buffer.from(n, "utf8"))) throw new Error(`${f} contains ${n.slice(0, 12)}…`);
  }
  for (const p of [process.env.TEMP && path.join(process.env.TEMP, "layers-validator.log"), path.join(vdir, "deaths.log")].filter((x) => x && existsSync(x))) {
    const s = readFileSync(p, "utf8").toLowerCase();
    for (const n of needles) if (s.includes(n)) throw new Error(`${path.basename(p)} contains a needle`);
  }
  const commitment = (await status()).commitment;
  for (const p of [`/zk/issuers?mode=fixture`, `/zk/attest/buckets?mode=fixture`, `/zk/attestations?mode=fixture&commitment=${encodeURIComponent(commitment)}`, `/state/zkAttestations`]) {
    const body = JSON.stringify((await vapi(p)).json).toLowerCase();
    for (const n of needles) if (body.includes(n)) throw new Error(`${p} leaks a needle`);
  }
  const mine = (await retry(() => zk("myAttestations"))).json.attestations.filter((a) => a.issuerId.startsWith("onchain."));
  if (mine.length < 8) throw new Error("vault holds " + mine.length + " onchain issuances, expected ≥ 8");
  for (const a of mine) {
    const v = JSON.stringify(a.claim.value).toLowerCase();
    for (const n of needles) if (v.includes(n)) throw new Error("a claim value carries an exact value or the address");
    if (!a.claim.value.bucket || a.claim.value.kind === undefined) throw new Error("a claim value lacks its bucket/kind");
  }
  const subjects = path.join(process.cwd(), ".keystore", "issuers", "onchain-subjects.json");
  if (!existsSync(subjects)) throw new Error("the issuer kept no retention record");
  const sf = readFileSync(subjects, "utf8").toLowerCase();
  for (const n of needles) if (sf.includes(n)) throw new Error("the issuer's retention file holds the address or a value in the clear");
  if (!/[0-9a-f]{64}/.test(sf)) throw new Error("the retention file holds no hash");
  const key = JSON.parse(readFileSync(path.join(process.cwd(), ".keystore", "issuers", "onchain.json"), "utf8")).privHex;
  const db = readFileSync(path.join(vdir, "layers.db"));
  if (db.includes(Buffer.from(key, "utf8"))) throw new Error("the issuer private key is in the validator db");
});

// ---- 7. multi-wallet ----
await check("7. MULTI-WALLET: wallets 0 + 1 bound in one issuance aggregate at the root — max age (gt4y), summed holdings (3.0 ETH → eth-gte-1, not gte-10), the union of protocols (compound joins), summed votes; the validator's rows and responses never carry a wallet set or its size", async () => {
  const E = (await status()).epoch;
  const ph = await issueWith("onchain.protocol-history", [W0, W1]);
  if (ph.status !== 200 || [...ph.response.buckets].sort().join(",") !== "aave,compound,morpho,uniswap") throw new Error("protocol union: " + JSON.stringify(ph).slice(0, 200));
  const age = await issueWith("onchain.wallet-age", [W0, W1]);
  if (age.status !== 200 || !age.response.buckets.includes("gt4y")) throw new Error("max age: " + JSON.stringify(age).slice(0, 200));
  const hold = await issueWith("onchain.holdings", [W0, W1]);
  if (hold.status !== 200 || !hold.response.buckets.includes("eth-gte-1") || hold.response.buckets.includes("eth-gte-10")) throw new Error("summed holdings: " + JSON.stringify(hold).slice(0, 200));
  const gov = await issueWith("onchain.governance", [W0, W1]);
  if (gov.status !== 200 || !gov.response.buckets.includes("votes-gte-5") || gov.response.buckets.includes("votes-gte-20")) throw new Error("summed votes: " + JSON.stringify(gov).slice(0, 200));
  // the per-commitment read is GATED since Gate 4 (a device-signed read): through the app
  const rows = (await retry(() => zk("attestations"))).json;
  // no wallet SET, no wallet COUNT, no address — keys and values, not the issuer id's spelling ("onchain.wallet-age" is a name)
  const text = JSON.stringify(rows);
  if (/"wallets?"|"addresses?"|"walletCount"|0x[0-9a-fA-F]{40}/.test(text)) throw new Error("the validator's attestation rows carry a wallet set, a count or an address");
  if (JSON.stringify((await vapi(`/zk/issuers?mode=fixture`)).json).includes(W0.address.slice(2).toLowerCase())) throw new Error("the registry leaks an address");
  const compound = rows.attestations.find((a) => a.issuer === "onchain.protocol-history" && a.bucket === "compound");
  if (!compound || compound.activeFromEpoch !== E + 1) throw new Error("compound issuance not batched to next epoch: " + JSON.stringify(compound));
  const morpho = rows.attestations.find((a) => a.issuer === "onchain.protocol-history" && a.bucket === "morpho");
  if (!morpho || morpho.activeFromEpoch > E) throw new Error("a renewal of an active issuance moved its activation epoch: " + JSON.stringify(morpho));
});

// ---- 8. revocation ----
await check("8. REVOCATION: the issuer revokes OUR morpho issuance; next epoch the morpho bucket lost exactly our leaf and the cohort's remain", async () => {
  await advance();
  const commitment = (await status()).commitment;
  const before = (await vapi(`/zk/members?mode=fixture&tree=${encodeURIComponent(TREE("onchain.protocol-history", "morpho"))}`)).json;
  if (!before.members.includes(commitment)) throw new Error("our leaf is not in morpho before revocation");
  const rv = (await retry(() => zk("revokeAttestation", { issuerId: "onchain.protocol-history", bucket: "morpho" }))).json;
  if (rv.ok !== true) throw new Error("revoke: " + JSON.stringify(rv));
  await advance();
  const after = (await vapi(`/zk/members?mode=fixture&tree=${encodeURIComponent(TREE("onchain.protocol-history", "morpho"))}`)).json;
  if (after.members.includes(commitment)) throw new Error("our leaf survived the revocation");
  if (after.members.length !== before.members.length - 1) throw new Error(`revocation removed ${before.members.length - after.members.length} leaves, expected exactly 1`);
});

// ---- 9. live wiring ----
await check("9. LIVE WIRING: scripts/live-att1.mjs exists and is an npm script; the chain source is FIXTURE during sweeps; the live override is a test-rig action", async () => {
  if (!existsSync("scripts/live-att1.mjs")) throw new Error("scripts/live-att1.mjs missing");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (!/live-att1/.test(pkg.scripts["live:att1"] ?? "")) throw new Error("package.json lacks live:att1");
  const src = (await retry(() => zk("chainSource"))).json;
  if (src.source !== "fixture") throw new Error("sweeps must run on the fixture chain source, got " + JSON.stringify(src));
  const s = readFileSync("app/api/zk/route.ts", "utf8");
  if (!/"setChainSource"/.test(s.slice(0, s.indexOf("export async function GET")))) throw new Error("setChainSource is not a DEV action");
});

// ---- 10. docs ----
await check("10. DOCS: SECURITY-POSTURE.md states the bucket boundaries and the floor arithmetic for onchain attestations", async () => {
  const s = readFileSync("SECURITY-POSTURE.md", "utf8");
  for (const n of ["gt1y", "gt2y", "gt4y", "eth-gte-0.1", "eth-gte-1", "eth-gte-10", "votes-gte-1", "votes-gte-5", "votes-gte-20", "aave", "morpho", "compound", "uniswap", "ZK_ANON_FLOOR"]) if (!s.includes(n)) throw new Error("posture doc lacks: " + n);
  if (/aerodrome/i.test(s.slice(s.indexOf("## 13")))) throw new Error("Aerodrome is in the issuers section");
});

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
console.log(`\n${passed}/${results.length} Attestation Gate 2 checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exit(failed ? 1 : infra ? 2 : 0);
