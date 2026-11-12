// ATTESTATION PASS Gate 4 — OPERATOR-VIEW LINKAGE TEST v3. FIXTURE-ONLY.
// SAFETY SET: a successful linkage halts the pass.
//
// Pass 2's session, plus: two roots attest the same claim kind (ours and
// the cohort), one root attests two kinds (ours: all four), one issuance
// expires (holdings, validity 4), one is revoked (our morpho), one root
// binds two wallets (ours: W0 + W1). Our two personas prove two kinds
// each; a crowd of decoy personas proves the same pairs. Then, from the
// OPERATOR'S data only — the validator's database and log — every obvious
// attack must fail to link a persona to a root, a root to a wallet, or a
// persona across two attestation kinds below the floor.
//
//   0. SESSION (six epochs)
//   1. NULLIFIER EQUALITY across every attestation claim
//   2. PERSONA → ROOT by cross-kind intersection of bucket trees: ≥ floor
//   3. PERSONA ACROSS KINDS: the pair of buckets a persona proved is
//      shared by ≥ floor personas — no unique profile
//   4. ROOT → WALLET: no address, no wallet count, no shape difference
//      between the two-wallet root and the crowd
//   5. TIMING: issuance rows are hour-grained and identical across the
//      cohort; proof epochs coincide with the crowd's
//   6. EXPIRY is quantized: the whole cohort leaves eth-gte-1 together
//   7. REVOCATION leaves a root-level row (stated) and no persona-level trace
//   8. LEAKS: sealed vault, clean log, no wallet key anywhere
import { chromium } from "playwright";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { Identity } from "@semaphore-protocol/identity";
import { poseidon2 } from "poseidon-lite";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const PH = "onchain.protocol-history";
const WA = "onchain.wallet-age";
const HO = "onchain.holdings";
const GO = "onchain.governance";
const ISSUERS = [WA, HO, PH, GO];
const TREE = (issuer, b) => `attest:${issuer}/${b}`;
const te = new TextEncoder();
const toHex = (b) => Buffer.from(b).toString("hex");
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
async function vapi(p) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(VBASE + p); return { status: r.status, json: await r.json().catch(() => null) }; } catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw new Error("INFRA: fetch failed for " + p + " (" + (last?.cause?.code ?? last?.message ?? "no cause") + ")");
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) { try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + JSON.stringify(r.json).slice(0, 300)); } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
  throw last;
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const status = async () => (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const epochNow = async () => (await vapi("/zk/epoch?mode=fixture")).json.epoch;
const membersOf = async (tree) => (await vapi(`/zk/members?mode=fixture&tree=${encodeURIComponent(tree)}`)).json;
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

// ---- the crowd's proof rig (the fixture "proof" is a public tag; the NULLIFIER is real) ----
const toBeBytes32 = (x) => { const out = new Uint8Array(32); let v = x; for (let i = 31; i >= 0; i--) { out[i] = Number(v & 255n); v >>= 8n; } return out; };
const semaphoreHash = (x) => BigInt("0x" + toHex(keccak_256(toBeBytes32(x)))) >> 8n;
const fieldOf = (domain, canonical) => BigInt("0x" + toHex(sha256(te.encode(`layers-zk-field/1|${domain}|${canonical}`)))) >> 8n;
const scopeString = (feature, epoch, personaId) => `layers/zk-scope/v1|${feature}|${epoch}|${personaId}`;
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
const outcomeOf = (buf) => { try { return JSON.parse(buf.toString("utf8")).outcome; } catch { return "unparseable"; } };
function decoyAttestEnvelope(decoy, personaId, issuer, bucket, epoch, root) {
  const tree = TREE(issuer, bucket);
  const scope = fieldOf("scope", scopeString(`attestation/${issuer}/${bucket}`, epoch, personaId)).toString(10);
  const challenge = "epoch-" + epoch;
  const message = fieldOf("message", [personaId, tree, tree, challenge, root].join("|")).toString(10);
  const pub = { mode: "fixture", claimKind: "attestation", tree, epoch, merkleTreeRoot: root, scope, message, personaId, gateId: tree, challenge, issuer, bucket };
  const nullifier = nullifierFor(BigInt(scope), decoy.secretScalar).toString(10);
  return { v: 1, mode: "fixture", claimKind: "attestation", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(pub), nullifier) } };
}

console.log("\nAttestation pass Gate 4 — operator-view linkage v3: two roots per kind, one root with four kinds and two wallets, an expiry, a revocation, a crowd that proves the same pairs");

// ---- the session ----
let FLOOR = 50;
const N = 120;
let commitment = null;
let E = {};
let crowd = { a: 0, b: 0, accepted: 0 };
const W0 = wallet(0);
const W1 = wallet(1);
const MAIN_PAIR = [[PH, "morpho"], [WA, "gt2y"]];
const ALT_PAIR = [[HO, "eth-gte-1"], [GO, "votes-gte-1"]];

await check("0. SESSION: fresh universe + 120-decoy cohort; ours issues all four kinds (W0) with the cohort; next epoch MAIN proves morpho+gt2y, ALT proves eth-gte-1+votes-gte-1 while the crowd proves the same pairs; a two-wallet re-issuance (W0+W1); our morpho revoked; holdings expire — six epochs", async () => {
  await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
  await sleep(400);
  await retry(() => zk("resetZk"));
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("setHonoredIssuers", { issuers: ["onchain.*"] }));
  await retry(() => zk("setRelay", { kind: "direct" }));
  await retry(() => zk("seedDecoys", { count: N }));
  await retry(() => zk("register"));
  await advance();
  const s = await status();
  FLOOR = s.floor;
  commitment = s.commitment;
  const powBits = s.pow.bits;
  for (const id of ISSUERS) await retry(() => zk("registerIssuer", { issuerId: id }));
  // E1: ours + the cohort, all four kinds
  E.issue = await epochNow();
  for (const id of ISSUERS) {
    const r = await issueWith(id, [W0], { includeCohort: true });
    if (r.status !== 200 || !(r.response?.cohortAttested >= FLOOR)) throw new Error(id + " issuance: " + JSON.stringify(r).slice(0, 200));
  }
  await advance();
  // E2: proofs — ours through the product path, the crowd through the anonymous channel
  E.prove = await epochNow();
  const decoys = Array.from({ length: N }, (_, i) => ({ i, id: new Identity("layers-zk-decoy/" + i) }));
  const trees = {};
  for (const [issuer, bucket] of [...MAIN_PAIR, ...ALT_PAIR]) {
    const m = await membersOf(TREE(issuer, bucket));
    if (!m?.members || m.members.length < FLOOR) throw new Error(`${issuer}/${bucket} has ${m?.members?.length ?? 0} < floor`);
    trees[TREE(issuer, bucket)] = m;
  }
  for (const [issuer, bucket] of MAIN_PAIR) await proveVia(MAIN, issuer, bucket);
  for (const [issuer, bucket] of ALT_PAIR) await proveVia(ALT, issuer, bucket);
  const plan = [];
  for (const d of decoys) {
    const c = d.id.commitment.toString(10);
    const inAll = (pair) => pair.every(([i, b]) => trees[TREE(i, b)].members.includes(c));
    if (inAll(MAIN_PAIR)) { crowd.a++; for (const [i, b] of MAIN_PAIR) plan.push({ d, p: `p_decoy_${d.i}_a`, i, b, at: Math.random() }); }
    if (inAll(ALT_PAIR)) { crowd.b++; for (const [i, b] of ALT_PAIR) plan.push({ d, p: `p_decoy_${d.i}_b`, i, b, at: Math.random() }); }
  }
  if (crowd.a < FLOOR || crowd.b < FLOOR) throw new Error(`the crowd that shares our pairs is thin: a=${crowd.a} b=${crowd.b} (floor ${FLOOR})`);
  plan.sort((x, y) => x.at - y.at);
  for (const item of plan) {
    const t = trees[TREE(item.i, item.b)];
    const env = decoyAttestEnvelope(item.d.id, item.p, item.i, item.b, E.prove, t.root);
    const body = Buffer.from(JSON.stringify({ envelope: env }));
    const r = await rawPost(VBASE + "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": solvePow(body, powBits) });
    const o = outcomeOf(r.buf);
    if (o === "accepted" || o === "replay") crowd.accepted++;
  }
  if (crowd.accepted < plan.length * 0.9) throw new Error(`the crowd's proofs were mostly refused: ${crowd.accepted}/${plan.length}`);
  for (const [p, i, b] of [[MAIN, PH, "morpho"], [MAIN, WA, "gt2y"], [ALT, HO, "eth-gte-1"], [ALT, GO, "votes-gte-1"]]) {
    const at = (await retry(() => zk("attested", { personaId: p, issuer: i, bucket: b }))).json;
    if (at.attested !== true) throw new Error(`${p} ${i}/${b} not attested: ` + JSON.stringify(at));
  }
  // still E2: the two-wallet re-issuance of protocol history (compound joins), batched to E3
  const two = await issueWith(PH, [W0, W1]);
  if (two.status !== 200 || !two.response.buckets.includes("compound")) throw new Error("two-wallet issuance: " + JSON.stringify(two).slice(0, 200));
  await advance();
  // E3: revoke our morpho
  E.revoke = await epochNow();
  const rv = (await retry(() => zk("revokeAttestation", { issuerId: PH, bucket: "morpho" }))).json;
  if (rv.ok !== true) throw new Error("revoke: " + JSON.stringify(rv));
  await advance();
  E.afterRevoke = await epochNow();
  await advance();
  await advance();
  // E6: holdings (validity 4) issued at E1 expired at E1+5
  E.expired = await epochNow();
  if (E.expired !== E.issue + 5) throw new Error(`epoch arithmetic: expected ${E.issue + 5}, at ${E.expired}`);
});

// ---- the operator's view ----
function operatorView() {
  const db = new DatabaseSync("validator/layers.db", { readOnly: true });
  try {
    return {
      registrations: db.prepare("SELECT commitment, root_id FROM zk_registrations WHERE mode = 'fixture'").all(),
      nullifiers: db.prepare("SELECT nullifier, claim_kind, tree, epoch FROM zk_nullifiers WHERE mode = 'fixture'").all(),
      attestations: db.prepare("SELECT issuer, bucket, commitment, claim_hash, issued_epoch, active_from_epoch, expires_epoch, revoked_from_epoch, created_at FROM zk_attestations WHERE mode = 'fixture'").all(),
      claims: db.prepare("SELECT persona_id, issuer, bucket, epoch, nullifier FROM zk_attestation_claims WHERE mode = 'fixture'").all(),
      placements: db.prepare("SELECT tree, epoch, commitment FROM zk_placements WHERE mode = 'fixture' AND tree LIKE 'attest:%'").all(),
      history: db.prepare("SELECT tree, epoch, root FROM zk_root_history WHERE mode = 'fixture' AND tree LIKE 'attest:%'").all(),
      issuers: db.prepare("SELECT id, pubkey FROM zk_issuers WHERE mode = 'fixture'").all(),
      stateKeys: db.prepare("SELECT namespace, key FROM adapter_state").all(),
      vault: db.prepare("SELECT namespace, key, value FROM adapter_state WHERE namespace = 'zkAttestations'").all(),
      columns: db.prepare("PRAGMA table_info(zk_attestations)").all().map((c) => c.name),
    };
  } finally {
    db.close();
  }
}
let view = null;
const treeAt = (epoch, tree) => (view ? view.placements.filter((p) => p.tree === tree && p.epoch === epoch).map((p) => p.commitment) : []);

await check("1. ATTACK: nullifier equality — no nullifier names two personas across every attestation claim; each of our personas' two claims are two nullifiers; no nullifier repeats across (issuer, bucket)", async () => {
  view = operatorView();
  const byNull = new Map();
  for (const c of view.claims) byNull.set(c.nullifier, [...(byNull.get(c.nullifier) ?? []), c.persona_id]);
  for (const [n, ps] of byNull) if (new Set(ps).size > 1) throw new Error(`nullifier ${n.slice(0, 12)}… names ${[...new Set(ps)].join(",")}`);
  const ours = (p) => view.claims.filter((c) => c.persona_id === p && c.epoch === E.prove);
  for (const p of [MAIN, ALT]) {
    const cs = ours(p);
    if (cs.length < 2) throw new Error(`${p} recorded ${cs.length} claims at the proof epoch`);
    if (new Set(cs.map((c) => c.nullifier)).size !== cs.length) throw new Error(`${p}'s claims share a nullifier`);
  }
  const seen = new Set();
  for (const c of view.claims) { const k = c.nullifier; if (seen.has(k)) throw new Error("a nullifier repeats across rows"); seen.add(k); }
  if (view.nullifiers.filter((n) => n.claim_kind === "attestation").length < crowd.accepted) throw new Error("the nullifier store holds fewer attestation nullifiers than the crowd submitted");
});

await check("2. ATTACK: persona → root by cross-kind intersection — for each of our personas, the commitments in BOTH bucket trees it proved at the proof epoch (from the signed placements) number at least the floor", async () => {
  for (const [p, pair] of [[MAIN, MAIN_PAIR], [ALT, ALT_PAIR]]) {
    let cand = null;
    for (const [i, b] of pair) {
      const members = new Set(treeAt(E.prove, TREE(i, b)));
      cand = cand === null ? members : new Set([...cand].filter((x) => members.has(x)));
    }
    if (!cand.has(commitment)) throw new Error(`${p}: our commitment is not in its own candidate set (the trees changed under us)`);
    if (cand.size < FLOOR) throw new Error(`${p}: intersection of its two buckets is ${cand.size} < floor ${FLOOR}`);
  }
});

await check("3. ATTACK: persona across kinds — the exact pair of buckets each of our personas proved this epoch is shared by at least the floor's worth of OTHER personas (no unique profile)", async () => {
  const profile = new Map();
  for (const c of view.claims.filter((c) => c.epoch === E.prove)) profile.set(c.persona_id, [...(profile.get(c.persona_id) ?? []), `${c.issuer}/${c.bucket}`].sort());
  for (const p of [MAIN, ALT]) {
    const mine = (profile.get(p) ?? []).join(",");
    const same = [...profile.entries()].filter(([q, list]) => q !== p && list.join(",") === mine).length;
    if (same < FLOOR) throw new Error(`${p}'s profile {${mine}} is shared by ${same} < floor ${FLOOR} personas`);
  }
});

await check("4. ATTACK: root → wallet — no address and no wallet count anywhere the operator can read; the two-wallet root's rows have exactly the crowd's columns; the issuer's own retention holds salted hashes only", async () => {
  const needles = [W0.address.toLowerCase(), W0.address.slice(2).toLowerCase(), W1.address.toLowerCase(), W1.address.slice(2).toLowerCase()];
  const db = readFileSync("validator/layers.db");
  const wal = existsSync("validator/layers.db-wal") ? readFileSync("validator/layers.db-wal") : Buffer.alloc(0);
  for (const n of needles) if (db.includes(Buffer.from(n, "utf8")) || wal.includes(Buffer.from(n, "utf8"))) throw new Error("a wallet address is in the validator's database");
  if (view.columns.some((c) => /wallet|address/i.test(c))) throw new Error("zk_attestations has a wallet column: " + view.columns.join(","));
  if (view.stateKeys.some((k) => /wallet|address/i.test(k.namespace) || /^0x[0-9a-f]{40}$/i.test(k.key))) throw new Error("adapter_state keys name a wallet");
  const ours = view.attestations.filter((a) => a.commitment === commitment && a.issuer === PH);
  const theirs = view.attestations.filter((a) => a.commitment !== commitment && a.issuer === PH);
  const shape = (r) => Object.keys(r).sort().join(",");
  if (!ours.length || !theirs.length || shape(ours[0]) !== shape(theirs[0])) throw new Error("the two-wallet root's rows differ in shape from the crowd's");
  const subjects = path.join(process.cwd(), ".keystore", "issuers", "onchain-subjects.json");
  if (existsSync(subjects)) { const sf = readFileSync(subjects, "utf8").toLowerCase(); for (const n of needles) if (sf.includes(n)) throw new Error("the issuer retains an address in the clear"); }
  const log = process.env.TEMP && path.join(process.env.TEMP, "layers-validator.log");
  if (log && existsSync(log)) { const s = readFileSync(log, "utf8").toLowerCase(); for (const n of needles) if (s.includes(n)) throw new Error("the validator log has an address"); }
});

await check("5. ATTACK: timing — every issuance row of the first round carries the same hour-grain created_at and issue epoch as the cohort's; our claims' epoch is the crowd's; nothing orders us against them", async () => {
  const round1 = view.attestations.filter((a) => a.issued_epoch === E.issue);
  const ours = round1.filter((a) => a.commitment === commitment);
  if (!ours.length) throw new Error("our round-1 rows are missing");
  for (const a of round1) if (a.created_at % 3_600_000 !== 0) throw new Error("an issuance row carries a timestamp finer than the hour");
  const hours = new Set(round1.map((a) => a.created_at));
  if (hours.size > 2) throw new Error("round-1 rows span " + hours.size + " hours — an ordering signal");
  const crowdEpochs = new Set(view.claims.filter((c) => /^p_decoy_/.test(c.persona_id)).map((c) => c.epoch));
  for (const c of view.claims.filter((c) => c.persona_id === MAIN || c.persona_id === ALT)) if (!crowdEpochs.has(c.epoch)) throw new Error(`our claim at epoch ${c.epoch} has no crowd claim in that epoch`);
});

await check("6. ATTACK: expiry partition — every eth-gte-1 issuance of the first round expires at ONE epoch (quantized to the issue epoch), and the tree emptied for everyone at once", async () => {
  const hold = view.attestations.filter((a) => a.issuer === HO && a.bucket === "eth-gte-1" && a.issued_epoch === E.issue);
  if (hold.length < FLOOR) throw new Error("holdings cohort too small: " + hold.length);
  const exp = new Set(hold.map((a) => a.expires_epoch));
  if (exp.size !== 1) throw new Error("holdings issuances of one round expire at " + exp.size + " different epochs");
  if ([...exp][0] !== E.issue + 5) throw new Error("expiry is not issued+1+validity(4)");
  const alive = treeAt(E.expired, TREE(HO, "eth-gte-1"));
  if (alive.length !== 0) throw new Error(`eth-gte-1 still has ${alive.length} leaves after the quantized expiry`);
  const before = treeAt(E.expired - 1, TREE(HO, "eth-gte-1"));
  if (before.length < FLOOR) throw new Error("the tree was already thin the epoch before expiry");
});

await check("7. ATTACK: revocation — our morpho leaf left at the revocation epoch while the cohort's stayed; the revoked row is ROOT-level (commitment, issuer, bucket — a stated leak like registration) and no persona-level row references a commitment", async () => {
  const before = treeAt(E.revoke, TREE(PH, "morpho"));
  const after = treeAt(E.afterRevoke, TREE(PH, "morpho"));
  if (!before.includes(commitment) || after.includes(commitment)) throw new Error("our morpho leaf did not leave at the revocation epoch");
  if (after.length !== before.length - 1) throw new Error(`revocation removed ${before.length - after.length} leaves`);
  if (after.length < FLOOR) throw new Error("the morpho bucket fell below the floor after one revocation");
  const row = view.attestations.find((a) => a.commitment === commitment && a.issuer === PH && a.bucket === "morpho");
  if (!row || row.revoked_from_epoch !== E.afterRevoke) throw new Error("revoked row: " + JSON.stringify(row));
  for (const c of view.claims) if (Object.values(c).some((v) => typeof v === "string" && /^(0|[1-9][0-9]{20,76})$/.test(v) && v === commitment)) throw new Error("a claim row references our commitment");
  if (Object.keys(view.claims[0] ?? {}).some((k) => /commitment|root/.test(k))) throw new Error("claim rows carry a commitment/root column");
});

await check("8. LEAKS: the zkAttestations vault namespace is ciphertext under the single address '_'; no adapter_state namespace names a wallet; the validator log carries no claim value, no bucket-per-commitment pairing beyond the tables, and no issuer private key", async () => {
  const v = view.vault;
  if (v.length !== 1 || v[0].key !== "_") throw new Error("zkAttestations is not one sealed record: " + JSON.stringify(v.map((x) => x.key)));
  if (/"bucket"|"issuerId"|gt2y|morpho/.test(String(v[0].value))) throw new Error("the sealed record shows plaintext");
  const keyFile = path.join(process.cwd(), ".keystore", "issuers", "onchain.json");
  const priv = existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, "utf8")).privHex : null;
  if (!priv) throw new Error("no onchain issuer key on disk");
  const db = readFileSync("validator/layers.db");
  if (db.includes(Buffer.from(priv, "utf8"))) throw new Error("the issuer private key is in the validator db");
  const log = process.env.TEMP && path.join(process.env.TEMP, "layers-validator.log");
  if (log && existsSync(log)) { const s = readFileSync(log, "utf8"); if (s.includes(priv)) throw new Error("the issuer private key is in the log"); if (/claimHash|"value"/.test(s)) throw new Error("the log carries claim material"); }
});

await check("9. RESTART SURVIVAL: the issuer registry, every issuance (the revoked one, the two-wallet one, one submitted MID-BATCH just before the kill), the expiries and the claims survive the validator killed with /F and come back byte-identical; the mid-batch issuance still lands next epoch; the issuer's retention file is untouched", async () => {
  const { execSync } = await import("node:child_process");
  // a fresh issuance in THIS epoch: batched, not yet a leaf — the kill lands inside its batch window
  const mid = await issueWith(WA, [W0]);
  if (mid.status !== 200) throw new Error("mid-batch issuance: " + JSON.stringify(mid).slice(0, 200));
  const beforeKill = operatorView();
  const port = process.env.LAYERS_VALIDATOR_PORT || 4001;
  const pid = execSync(`powershell.exe -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess"`, { encoding: "utf8" }).trim().split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) throw new Error("could not find the validator pid on the pinned validator port");
  execSync(`powershell.exe -NoProfile -Command "taskkill /PID ${pid} /F"`, { stdio: "ignore" });
  let back = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { if ((await fetch(VBASE + "/health")).status === 200) { back = true; break; } } catch {}
  }
  if (!back) throw new Error("validator did not come back within 20 s — is it running under npm run validator:supervised?");
  const afterKill = operatorView();
  const same = (k) => JSON.stringify(beforeKill[k]) === JSON.stringify(afterKill[k]);
  for (const k of ["issuers", "attestations", "claims", "placements", "history"]) if (!same(k)) throw new Error(`${k} changed across the restart`);
  if (!afterKill.attestations.some((a) => a.commitment === commitment && a.issuer === PH && a.bucket === "morpho" && a.revoked_from_epoch !== null)) throw new Error("the revoked row did not survive");
  if (!afterKill.attestations.some((a) => a.commitment === commitment && a.issuer === PH && a.bucket === "compound")) throw new Error("the two-wallet issuance did not survive");
  const midRow = afterKill.attestations.find((a) => a.commitment === commitment && a.issuer === WA && a.bucket === "gt1y");
  if (!midRow) throw new Error("the mid-batch issuance did not survive");
  await advance();
  const tree = await membersOf(TREE(WA, "gt1y"));
  if (!tree?.members?.includes(commitment)) throw new Error("the mid-batch issuance did not land after the restart");
  const subjects = path.join(process.cwd(), ".keystore", "issuers", "onchain-subjects.json");
  if (!existsSync(subjects)) throw new Error("the issuer's retention file is gone");
  const list = (await retry(() => zk("issuers"))).json.issuers.filter((i) => ISSUERS.includes(i.id));
  if (list.length !== 4) throw new Error("the registry lost issuers across the restart");
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
console.log(`\n${passed}/${results.length} Attestation Gate 4 (linkage v3) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exit(failed ? 1 : infra ? 2 : 0);
