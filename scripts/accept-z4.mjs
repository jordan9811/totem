// ZK PASS 1 — GATE 4: THE OPERATOR-VIEW LINKAGE TEST. SAFETY SET — any
// successful linkage is a pass-halting failure.
//
// A seeded session: TWO personas of ONE root (ours) and N decoy roots (some
// with two personas of their own) act across TWO epochs — post, prove,
// get eligible. Then the test becomes the OPERATOR: it takes ONLY what the
// operator can see — the validator's database rows, the anonymous
// endpoint's (non-existent) logs, request metadata and wire timing — and
// tries to link our two personas with the obvious attacks: nullifier
// equality across scopes, join-epoch correlation, submission-timing
// correlation, proof-history intersection. Each attack yields a CANDIDATE
// SET for the sibling; it must never narrow below the anonymity floor.
//
// Honest scope: the operator's peer-IP view is uninformative here (every
// party is 127.0.0.1) — that is what a real relay must deliver, and why
// the label reads DEMO under `direct`. Timing is analysed from the wire
// tap this test keeps, because the validator itself stores none.
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { Identity } from "@semaphore-protocol/identity";
import { poseidon2 } from "poseidon-lite";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const te = new TextEncoder();
const toHex = (b) => Buffer.from(b).toString("hex");

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
// A bare validator call, retried ONLY on a transport failure (undici's "fetch failed": no HTTP answer at all); any HTTP
// answer is returned as it is, so no status or content check is loosened. Idempotent calls only: the GETs, and the
// anchor registration (201 the first time, 200 after). HELP/DOCS verify sweep 1 lost this whole session, and with it
// checks 1-4, to ONE un-retried "fetch failed" in check 0 with no validator death or restart in the window. Several
// reruns passed; a later rig run, with this retry in place, caught the cause: "read ECONNRESET" on GET /zk/epoch, a
// pooled keep-alive connection to the validator reset under the request (Node's server drops a keep-alive socket after
// 5 s idle; a request written onto it as it goes is reset). An idempotent request may be retried after that (RFC 9110
// section 9.2.2). Each retry is PRINTED with undici's cause, and the summary line counts them (the sweep row shows that
// line), so a recurring transport problem stays visible instead of being absorbed; the last error keeps "fetch failed"
// (INFRA).
let transportRetries = 0;
async function vfetch(url, init, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      const c = e && e.cause;
      last = new Error(`${e && e.message ? e.message : e}${c ? ` (cause: ${c.code || c.name || "?"} ${c.message || ""})` : ""} on ${(init && init.method) || "GET"} ${url.replace(VBASE, "")}`);
      if (i < attempts - 1) {
        transportRetries++;
        console.log(`  [z4] transport retry ${i + 1}/${attempts - 1}: ${last.message}`);
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
  }
  throw last;
}
async function vapi(path) { const r = await vfetch(VBASE + path); return { status: r.status, json: await r.json().catch(() => null) }; }
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) { try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.json?.reason ?? JSON.stringify(r.json)?.slice(0, 160) ?? "")); } catch (e) { last = e; } }
  throw last;
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- deliberate duplicates (fixture scheme, real nullifiers, PoW, clean client) ----
const kdf = (seed, info) => hkdf(sha256, seed, new Uint8Array(0), te.encode("layers/v1/" + info), 32);
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

/** craft a fixture envelope for a decoy (the toy scheme is forgeable; the nullifier is REAL) */
function decoyEnvelope(decoy, personaId, tree, epoch, root) {
  const scope = fieldOf("scope", scopeString("discovery-tier", epoch, personaId)).toString(10);
  const challenge = "epoch-" + epoch;
  const message = fieldOf("message", [personaId, "foryou", challenge, root].join("|")).toString(10);
  const pub = { mode: "fixture", claimKind: "tier-membership", tree, epoch, merkleTreeRoot: root, scope, message, personaId, gateId: "foryou", challenge };
  const nullifier = nullifierFor(BigInt(scope), decoy.secretScalar).toString(10);
  return { v: 1, mode: "fixture", claimKind: "tier-membership", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(pub), nullifier) } };
}

console.log("\nZK Gate 4 — operator-view linkage: two personas of one root among a crowd, two epochs, every obvious attack");

// ---- the session ----
const wire = []; // the operator's wire tap: { persona, at, epoch, kind: "submit"|"post" }
let FLOOR = 50;
let TREE = null;
let epochs = [];
await check("0. SESSION: our two personas + a crowd of decoy roots (some with sibling personas) post, prove and get eligible across two epochs", async () => {
  await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
  await sleep(400);
  await retry(() => zk("resetZk"));
  const issued = await retry(() => api("POST", "/api/dev", { action: "issueTestDelegation", devicePubKey: "dc".repeat(32), deviceId: "dev_z4_probe" }));
  await vfetch(VBASE + "/device/auth-anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pubkey: issued.json.anchorPubKey }) });
  await retry(() => zk("register"));
  const s = (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status;
  FLOOR = s.floor;
  await retry(() => zk("seedDecoys", { count: FLOOR + 40 }));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("setRelay", { kind: "direct" }));
  TREE = (await retry(() => zk("gateStatus"))).json.tree;
  const powBits = s.pow.bits;
  const decoys = Array.from({ length: FLOOR + 40 }, (_, i) => ({ i, id: new Identity("layers-zk-decoy/" + i) }));

  for (let round = 0; round < 2; round++) {
    const epoch = (await vapi("/zk/epoch?mode=fixture")).json.epoch;
    epochs.push(epoch);
    const members = (await vapi(`/zk/members?mode=fixture&tree=${TREE}`)).json;
    const inTree = decoys.filter((d) => members.members.includes(d.id.commitment.toString(10)));
    if (inTree.length < FLOOR) throw new Error(`only ${inTree.length} decoys in ${TREE} (floor ${FLOOR})`);
    // our personas ACT: a post each (attributed fixture cast), then a jittered proof each
    for (const persona of [MAIN, ALT]) {
      const cast = await retry(() => api("POST", "/api/fc/write", { action: "cast", text: `z4 ${persona} epoch ${round} [layers-test fixture]`, personaId: persona }));
      wire.push({ persona, at: Date.now(), epoch, kind: "post", hash: cast.json.hash });
      await retry(() => zk("enqueue", { claimKind: "tier-membership", tree: TREE, personaId: persona, gateId: "foryou", jitterMinMs: 100, jitterMaxMs: 4000 }));
    }
    // the crowd acts, interleaved: decoy submissions at random moments across the same window
    const plan = [];
    for (const d of inTree) {
      const personas = d.i < 20 ? [`p_decoy_${d.i}_a`, `p_decoy_${d.i}_b`] : [`p_decoy_${d.i}`];
      for (const p of personas) plan.push({ d, p, at: Date.now() + Math.floor(Math.random() * 4000) });
    }
    plan.sort((a, b) => a.at - b.at);
    let nextDrain = 0;
    for (const item of plan) {
      const wait = item.at - Date.now();
      if (wait > 0) await sleep(Math.min(wait, 60));
      const env = decoyEnvelope(item.d.id, item.p, TREE, epoch, members.root);
      const body = Buffer.from(JSON.stringify({ envelope: env }));
      const r = await rawPost(VBASE + "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": solvePow(body, powBits) });
      wire.push({ persona: item.p, at: Date.now(), epoch, kind: "submit", outcome: outcomeOf(r.buf) });
      // drain OUR queue the way the product does — one item per call, each
      // persona at ITS OWN jittered time, in the middle of the crowd. (A
      // single flush of both personas at 4.2 s sent them back-to-back: the
      // rig, not the jitter, was the correlation — z4 #4, closing series 4.)
      if (Date.now() >= nextDrain) {
        nextDrain = Date.now() + 250;
        await retry(() => zk("drain", { limit: 1 }));
      }
    }
    // make sure ours went out (their jittered times are within the window)
    for (let i = 0; i < 10; i++) {
      const qs = (await retry(() => zk("queueStatus"))).json;
      if (qs.queued === 0) break;
      await sleep(600);
      await retry(() => zk("drain", { limit: 1 }));
    }
    const qs = (await retry(() => zk("queueStatus"))).json;
    for (const it of qs.items.filter((q) => q.status === "sent" && q.epoch === epoch)) wire.push({ persona: it.personaId, at: it.sentAt, epoch, kind: "submit", outcome: it.outcome });
    await retry(() => zk("advanceEpoch"));
  }
  const accepted = wire.filter((w) => w.kind === "submit" && w.outcome === "accepted").length;
  if (accepted < 2 * (FLOOR + 2)) throw new Error(`too few accepted submissions in the session: ${accepted}`);
});

// ---- the operator's view ----
function operatorView() {
  const db = new DatabaseSync("validator/layers.db", { readOnly: true });
  try {
    return {
      registrations: db.prepare("SELECT commitment, root_id, epoch_registered, active_from_epoch FROM zk_registrations WHERE mode = 'fixture'").all(),
      nullifiers: db.prepare("SELECT nullifier, claim_kind, tree, epoch FROM zk_nullifiers WHERE mode = 'fixture'").all(),
      eligibility: db.prepare("SELECT persona_id, gate_id, tier, epoch, nullifier FROM zk_eligibility WHERE mode = 'fixture'").all(),
      placements: db.prepare("SELECT tree, epoch, commitment, leaf_index FROM zk_placements WHERE mode = 'fixture'").all(),
      history: db.prepare("SELECT tree, epoch, root FROM zk_root_history WHERE mode = 'fixture'").all(),
      vault: db.prepare("SELECT namespace, key, value FROM adapter_state WHERE namespace IN ('zkProofBudget','zkRootAnchor','zkQueue')").all(),
      attribution: db.prepare("SELECT key, value FROM adapter_state WHERE namespace = 'fcAttribution'").all(),
    };
  } finally {
    db.close();
  }
}

let view = null;
await check("1. ATTACK: nullifier equality — no two personas share a nullifier in any scope (our siblings included)", async () => {
  view = operatorView();
  const byNullifier = new Map();
  for (const e of view.eligibility) byNullifier.set(e.nullifier, [...(byNullifier.get(e.nullifier) ?? []), e.persona_id]);
  for (const [n, personas] of byNullifier) if (new Set(personas).size > 1) throw new Error(`LINKED by nullifier ${n.slice(0, 12)}…: ${personas.join(",")}`);
  const ours = view.eligibility.filter((e) => e.persona_id === MAIN || e.persona_id === ALT);
  if (ours.length < 4) throw new Error(`expected ≥4 eligibility rows for our personas, got ${ours.length}`);
  if (new Set(ours.map((e) => e.nullifier)).size !== ours.length) throw new Error("our personas' nullifiers repeat");
});

await check("2. ATTACK: join-epoch correlation — the roots that joined when ours did are at least a floor's worth; persona first-appearance epochs are shared by the whole crowd", async () => {
  const ourReg = view.registrations.find((r) => !r.root_id.startsWith("root_zkdecoy_"));
  if (!ourReg) throw new Error("our registration is not in the operator's view (it should be — that leak is stated)");
  const sameJoin = view.registrations.filter((r) => r.active_from_epoch === ourReg.active_from_epoch);
  if (sameJoin.length < FLOOR) throw new Error(`join-epoch candidate set is ${sameJoin.length} < floor ${FLOOR} — batching did not hide the join`);
  const first = new Map();
  for (const e of view.eligibility) first.set(e.persona_id, Math.min(first.get(e.persona_id) ?? Infinity, e.epoch));
  const cohort = [...first.entries()].filter(([, ep]) => ep === first.get(MAIN)).map(([p]) => p);
  if (cohort.length < FLOOR) throw new Error(`first-appearance cohort for MAIN is ${cohort.length} < floor`);
});

await check("3. ATTACK: proof-history intersection — the candidate roots for each of our personas, intersected over everything they proved, never drop below the floor; and nothing distinguishes the pair", async () => {
  const membersAt = new Map(); // `${tree}:${epoch}` -> Set(commitments)
  for (const p of view.placements) {
    const k = `${p.tree}:${p.epoch}`;
    if (!membersAt.has(k)) membersAt.set(k, new Set());
    membersAt.get(k).add(p.commitment);
  }
  const candidates = (persona) => {
    let set = null;
    for (const e of view.eligibility.filter((x) => x.persona_id === persona)) {
      const n = view.nullifiers.find((x) => x.nullifier === e.nullifier);
      const m = membersAt.get(`${n.tree}:${n.epoch}`) ?? new Set();
      set = set === null ? new Set(m) : new Set([...set].filter((c) => m.has(c)));
    }
    return set ?? new Set();
  };
  const cm = candidates(MAIN), ca = candidates(ALT);
  if (cm.size < FLOOR) throw new Error(`MAIN's candidate roots after intersection: ${cm.size} < floor`);
  if (ca.size < FLOOR) throw new Error(`ALT's candidate roots after intersection: ${ca.size} < floor`);
  const both = new Set([...cm].filter((c) => ca.has(c)));
  if (both.size < FLOOR) throw new Error(`the pair's joint candidate set is ${both.size} < floor — intersection links the siblings`);
  // a decoy persona is indistinguishable from ours by this attack
  const dec = candidates("p_decoy_0_a");
  if (dec.size !== cm.size) throw new Error("our persona's candidate set differs in size from a decoy's — a distinguisher");
});

await check("4. ATTACK: submission-timing correlation — from the wire tap, ALT is not the timing-nearest persona to MAIN's actions; the operator's stored timing is only the epoch", async () => {
  const subs = wire.filter((w) => w.kind === "submit" && w.outcome === "accepted");
  const posts = wire.filter((w) => w.kind === "post");
  let nearestIsAlt = 0, trials = 0;
  for (const m of [...subs.filter((w) => w.persona === MAIN), ...posts.filter((w) => w.persona === MAIN)]) {
    const others = subs.filter((w) => w.persona !== MAIN && w.epoch === m.epoch);
    if (!others.length) continue;
    others.sort((a, b) => Math.abs(a.at - m.at) - Math.abs(b.at - m.at));
    trials++;
    if (others[0].persona === ALT) nearestIsAlt++;
  }
  if (trials === 0) throw new Error("no timing trials");
  if (nearestIsAlt / trials > 0.4) throw new Error(`ALT is the nearest-in-time persona to MAIN's actions in ${nearestIsAlt}/${trials} trials — jitter is not decorrelating`);
  // the operator STORES nothing finer than the epoch: no timestamps in the anon-written rows
  const db = new DatabaseSync("validator/layers.db", { readOnly: true });
  try {
    for (const t of ["zk_nullifiers", "zk_eligibility"]) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      if (cols.some((c) => /_at$|time|stamp/i.test(c))) throw new Error(`${t} stores a timestamp column: ${cols.join(",")}`);
    }
  } finally {
    db.close();
  }
});

await check("5. OPERATOR ARTIFACTS: the validator's process log carries no persona ids, nullifiers or IPs from the session; zk vault namespaces are ciphertext; the attribution index is persona-level only", async () => {
  const logPath = (process.env.TEMP || "/tmp") + "/layers-validator.log";
  if (existsSync(logPath)) {
    const log = readFileSync(logPath, "utf8");
    for (const needle of [MAIN, ALT, "p_decoy_0_a", ...view.eligibility.slice(0, 5).map((e) => e.nullifier)]) if (log.includes(needle)) throw new Error(`validator log contains ${needle.slice(0, 16)}`);
    if (/\b(127\.0\.0\.1|::1)\b/.test(log)) throw new Error("validator log contains a peer address");
  }
  for (const row of view.vault) {
    const v = JSON.parse(row.value);
    if (!(v && v.v === 1 && typeof v.ct === "string")) throw new Error(`${row.namespace}/${row.key} is not ciphertext at rest`);
  }
  for (const row of view.attribution) {
    const v = JSON.parse(row.value);
    if (JSON.stringify(v).includes("root")) throw new Error("attribution index carries root material");
  }
});

await retry(() => zk("setRelay", { kind: null }));
await retry(() => zk("setRepImpl", { impl: null }));
await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(`\n${results.length - fails.length - infra.length}/${results.length} ZK Gate 4 checks passed` + (fails.length ? `, ${fails.length} FAILED` : "") + (infra.length ? `, ${infra.length} infra` : "") + (transportRetries ? ` (${transportRetries} validator transport retr${transportRetries === 1 ? "y" : "ies"})` : ""));
if (fails.length) console.log("\n  *** A SUCCESSFUL LINKAGE IS A PASS-HALTING FAILURE ***");
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
