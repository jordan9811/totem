// ZK PASS 2 — GATE 4: THE OPERATOR-VIEW LINKAGE TEST, v2. SAFETY SET — any
// successful linkage is a pass-halting failure.
//
// v2 = the Pass 1 session (scripts/accept-z4.mjs) re-run against the
// migrated validator (006/007) PLUS, inside the recorded session: a FORK
// (ALT → NEW under zk: the continuity proof), an ATTESTATION that expires
// (mock issuer, the whole cohort attested, proofs at the active epoch,
// refused after expiry), a REVOCATION + RE-ISSUANCE of our root's
// commitment mid-session, and a BLOCK by the session's persona. Then the
// operator, with the same materials (DB rows, logs, wire timing, request
// metadata), must fail to link the siblings below the floor AND fail to
// link the forked persona to its predecessor from server data.
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
async function vapi(path) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(VBASE + path); return { status: r.status, json: await r.json().catch(() => null) }; }
    catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw new Error("INFRA: fetch failed for " + path + " (" + (last?.cause?.code ?? last?.message ?? "no cause") + ")");
}
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

/** craft a fixture ATTESTATION envelope for a decoy (Gate 3 claim kind) */
function decoyAttestEnvelope(decoy, personaId, issuer, epoch, root) {
  const tree = "attest:" + issuer + "/any";
  // the attestation scope is qualified by issuer AND bucket (attack-z2-3 #6; Attestation pass Gate 1): feature "attestation/<issuer>/<bucket>"
  const scope = fieldOf("scope", scopeString("attestation/" + issuer + "/any", epoch, personaId)).toString(10);
  const challenge = "epoch-" + epoch;
  const gateId = tree; // the gate id of an attestation claim IS its tree name
  const message = fieldOf("message", [personaId, gateId, tree, challenge, root].join("|")).toString(10);
  const pub = { mode: "fixture", claimKind: "attestation", tree, epoch, merkleTreeRoot: root, scope, message, personaId, gateId, challenge, issuer, bucket: "any" };
  const nullifier = nullifierFor(BigInt(scope), decoy.secretScalar).toString(10);
  return { v: 1, mode: "fixture", claimKind: "attestation", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(pub), nullifier) } };
}

console.log("\nZK Pass 2 Gate 4 — operator-view linkage v2: siblings + a fork + a revocation + an attestation expiry + a block, four epochs, every obvious attack");

// ---- the session ----
const wire = []; // the operator's wire tap: { persona, at, epoch, kind: "submit"|"post" }
let FLOOR = 50;
let TREE = null;
let epochs = [];
let NEW = null, forkCommit = null, forkAt = 0, forkEpoch = null, attestEpoch = null, revokeEpoch = null, oldCommitment = null, newCommitment = null, blockEpoch = null, selfPersona = null, blockTarget = null, blockAt = 0, blockedFrom = null;
const fixtureRoster = existsSync(".keystore/fixture-roster.json") ? JSON.parse(readFileSync(".keystore/fixture-roster.json", "utf8")) : null;
await check("0. SESSION: our two personas + a crowd of decoy roots post, prove and get eligible across FOUR epochs; in the middle: a fork (continuity proof), an attestation of the whole cohort that expires, a revocation + re-issuance of our commitment, and a block", async () => {
  await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
  await sleep(400);
  await retry(() => zk("resetZk"));
  const issued = await retry(() => api("POST", "/api/dev", { action: "issueTestDelegation", devicePubKey: "dc".repeat(32), deviceId: "dev_z4_probe" }));
  for (let i = 0; i < 4; i++) { try { await fetch(VBASE + "/device/auth-anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pubkey: issued.json.anchorPubKey }) }); break; } catch (e) { if (i === 3) throw new Error("INFRA: auth-anchor registration: " + (e?.cause?.code ?? e.message)); await sleep(500); } }
  await retry(() => zk("register"));
  const s = (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status;
  FLOOR = s.floor;
  await retry(() => zk("seedDecoys", { count: FLOOR + 40 }));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("setRepImpl", { impl: "zk" }));
// Attestation pass Gate 1: the mock issuer is honoured only when the rig says so
await retry(() => zk("setHonoredIssuers", { issuers: ["test.mock-issuer"] }));
  await retry(() => zk("setRelay", { kind: "direct" }));
  TREE = (await retry(() => zk("gateStatus"))).json.tree;
  const powBits = s.pow.bits;
  const decoys = Array.from({ length: FLOOR + 40 }, (_, i) => ({ i, id: new Identity("layers-zk-decoy/" + i) }));

  for (let round = 0; round < 4; round++) {
    const epoch = (await vapi("/zk/epoch?mode=fixture")).json.epoch;
    epochs.push(epoch);
    const members = (await vapi(`/zk/members?mode=fixture&tree=${TREE}`)).json;
    const inTree = decoys.filter((d) => members.members.includes(d.id.commitment.toString(10)));
    if (inTree.length < FLOOR) throw new Error(`only ${inTree.length} decoys in ${TREE} (floor ${FLOOR})`);
    // round 2: THE FORK — ALT → NEW under zk; the continuity proof is queued by the tick
    if (round === 2) {
      forkAt = Date.now();
      const fr = await retry(() => api("POST", "/api/identity/fork", { fromPersona: ALT, carry: [], newName: "Z9 Continued", newHandle: "z9c_" + Date.now().toString(36) }));
      NEW = fr.json.newPersona;
      forkCommit = fr.json.continuity?.forkCommit;
      forkEpoch = epoch;
      if (!NEW || !forkCommit || fr.json.continuity?.proofRequested !== true) throw new Error("fork did not request the continuity proof: " + JSON.stringify(fr.json).slice(0, 200));
      // the product path would prove this at the next tick and queue it in the
      // CONFIGURED jitter window (30 s – 15 min); the session compresses that
      // window like every other proof it makes (100 ms – 4 s) so the wire tap
      // records it inside the round — the same compression z4 applies to ours
      const fq = await retry(() => zk("enqueue", { claimKind: "fork-continuity", tree: TREE, personaId: NEW, gateId: "foryou", forkCommit, motivatedAt: forkAt, jitterMinMs: 100, jitterMaxMs: 4000 }));
      if (!fq.json?.ok) throw new Error("fork-continuity enqueue: " + JSON.stringify(fq.json).slice(0, 200));
      // MAIN also proves the (now active) attestation this round
      const aq = await retry(() => zk("enqueue", { claimKind: "attestation", tree: "attest:test.mock-issuer/any", personaId: MAIN, gateId: "attest:test.mock-issuer/any", issuer: "test.mock-issuer", bucket: "any", jitterMinMs: 100, jitterMaxMs: 4000 }));
      if (!aq.json?.ok) throw new Error("attestation enqueue: " + JSON.stringify(aq.json).slice(0, 200));
    }
    // our personas ACT: a post each (attributed fixture cast), then a jittered proof each
    for (const persona of [MAIN, ALT]) {
      const cast = await retry(() => api("POST", "/api/fc/write", { action: "cast", text: `z9 ${persona} epoch ${round} [layers-test fixture]`, personaId: persona }));
      wire.push({ persona, at: Date.now(), epoch, kind: "post", hash: cast.json.hash });
      await retry(() => zk("enqueue", { claimKind: "tier-membership", tree: TREE, personaId: persona, gateId: "foryou", jitterMinMs: 100, jitterMaxMs: 4000 }));
    }
    // the forked persona proves too (round 2's proof IS the fork-continuity claim queued above);
    // it does not post through the fixture writer, which only writes as the seeded viewer personas
    if (round === 3 && NEW) await retry(() => zk("enqueue", { claimKind: "tier-membership", tree: TREE, personaId: NEW, gateId: "foryou", jitterMinMs: 100, jitterMaxMs: 4000 }));
    // round 3: the expired attestation is refused CLIENT-SIDE (no submission leaves)
    if (round === 3) {
      const refused = (await zk("prove", { claimKind: "attestation", tree: "attest:test.mock-issuer/any", personaId: MAIN, gateId: "attest:test.mock-issuer/any", issuer: "test.mock-issuer", bucket: "any" })).json;
      if (refused.ok !== false || !["cohort", "membership"].includes(refused.stage)) throw new Error("an expired attestation did not fail at cohort/membership: " + JSON.stringify(refused).slice(0, 160));
      // and THE BLOCK: the session's persona blocks a fixture persona — one row
      if (fixtureRoster) {
        const selfRoot = fixtureRoster.fids["9152"];
        selfPersona = selfRoot ? (fixtureRoster.roots[selfRoot] ?? [])[0] : null;
        const others = Object.entries(fixtureRoster.roots).filter(([r]) => r !== selfRoot).map(([, ids]) => ids[0]).filter(Boolean);
        // a target this persona has never blocked (a pre-existing pair keeps its row — ON CONFLICT DO NOTHING — and its old timestamp)
        {
          const dbc = new DatabaseSync("validator/layers.db", { readOnly: true });
          try {
            const blockedBefore = new Set(dbc.prepare("SELECT blocked_persona FROM blocks_v2 WHERE blocker_persona = ?").all(selfPersona).map((r) => r.blocked_persona));
            const fresh = others.filter((id) => !blockedBefore.has(id));
            blockTarget = fresh[Math.floor(Math.random() * Math.min(fresh.length, 50))] ?? null;
          } finally { dbc.close(); }
        }
        if (!blockTarget) throw new Error("INFRA: no fixture persona left to block for the first time");
        blockAt = Date.now();
        blockEpoch = epoch;
        const b = await api("POST", "/api/block", { personaId: blockTarget });
        if (!b.json?.ok) throw new Error("block failed: " + JSON.stringify(b.json));
      }
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
    for (const it of qs.items.filter((q) => q.status === "sent" && q.epoch === epoch)) wire.push({ persona: it.personaId, at: it.sentAt, epoch, kind: "submit", outcome: it.outcome, claimKind: it.claimKind });
    // round 1 (end): the mock issuer attests OUR commitment and the whole decoy cohort, ttl 1 → active next epoch only
    if (round === 1) {
      const a = (await retry(() => zk("attest", { issuer: "test.mock-issuer", includeDecoys: true }))).json.response;
      if (a?.ok !== true || !(a.decoysAttested >= FLOOR)) throw new Error("attest: " + JSON.stringify(a));
      attestEpoch = epoch + 1;
    }
    // round 2 (end): the crowd proves its attestations too; then REVOKE + RE-ISSUE our commitment
    if (round === 2) {
      const at = (await vapi(`/zk/members?mode=fixture&tree=${encodeURIComponent("attest:test.mock-issuer/any")}`)).json;
      const attested = decoys.filter((d) => at.members.includes(d.id.commitment.toString(10)));
      if (attested.length < FLOOR) throw new Error(`only ${attested.length} decoys in attest:test.mock-issuer/any (floor ${FLOOR})`);
      for (const d of attested) {
        const env = decoyAttestEnvelope(d.id, d.i < 20 ? `p_decoy_${d.i}_a` : `p_decoy_${d.i}`, "test.mock-issuer", epoch, at.root);
        const body = Buffer.from(JSON.stringify({ envelope: env }));
        const r = await rawPost(VBASE + "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": solvePow(body, powBits) });
        wire.push({ persona: env.publicInputs.personaId, at: Date.now(), epoch, kind: "submit", outcome: outcomeOf(r.buf), claimKind: "attestation" });
      }
      oldCommitment = (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status.commitment;
      const re = (await retry(() => zk("reissue"))).json;
      if (re.index !== 1 || re.registration?.ok !== true) throw new Error("reissue: " + JSON.stringify(re).slice(0, 200));
      newCommitment = re.commitment;
      revokeEpoch = epoch;
    }
    await retry(() => zk("advanceEpoch"));
    await retry(() => zk("prefetchNow"));
  }
  const accepted = wire.filter((w) => w.kind === "submit" && w.outcome === "accepted").length;
  if (accepted < 4 * (FLOOR + 2)) throw new Error(`too few accepted submissions in the session: ${accepted}`);
  // The scheduled tick ALSO proves the fork claim (the fork route marks it wanted) and, near an
  // epoch boundary, its jitter window clamps to the epoch's remaining time so ITS copy lands first;
  // the session's own copy is then a legitimate "replay". Either way the validator must hold the claim.
  if (!wire.some((w) => w.persona === NEW && w.kind === "submit" && (w.outcome === "accepted" || w.outcome === "replay"))) throw new Error("NEW's fork-continuity submission was neither accepted nor a replay of an accepted copy");
  const fcRow = (await retry(() => zk("forkClaim", { personaId: NEW, forkCommit }))).json;
  if (fcRow.verified !== true) throw new Error("the validator holds no fork claim for NEW: " + JSON.stringify(fcRow));
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
      // Pass 2
      forkClaims: db.prepare("SELECT persona_id, fork_commit, tree, tier, epoch, nullifier FROM zk_fork_claims WHERE mode = 'fixture'").all(),
      attestations: db.prepare("SELECT issuer, bucket, commitment, issued_epoch, expires_epoch FROM zk_attestations WHERE mode = 'fixture'").all(),
      attestationClaims: db.prepare("SELECT persona_id, issuer, epoch, nullifier FROM zk_attestation_claims WHERE mode = 'fixture'").all(),
      registrationsFull: db.prepare("SELECT commitment, root_id, epoch_registered, active_from_epoch, revoked_from_epoch FROM zk_registrations WHERE mode = 'fixture'").all(),
      blocks: db.prepare("SELECT rowid AS rid, blocker_persona, blocked_persona, created_at FROM blocks_v2").all(),
      forksState: db.prepare("SELECT key, value FROM adapter_state WHERE namespace = 'forks'").all(),
      stateKeys: db.prepare("SELECT namespace, key FROM adapter_state").all(),
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
  const ours = view.eligibility.filter((e) => e.persona_id === MAIN || e.persona_id === ALT || e.persona_id === NEW);
  if (ours.length < 4) throw new Error(`expected ≥4 eligibility rows for our personas, got ${ours.length}`);
  if (new Set(ours.map((e) => e.nullifier)).size !== ours.length) throw new Error("our personas' nullifiers repeat");
  // v2: across ALL claim kinds — tier, fork, attestation — no nullifier names two personas
  const all = new Map();
  for (const r of [...view.eligibility, ...view.forkClaims, ...view.attestationClaims]) all.set(r.nullifier, [...(all.get(r.nullifier) ?? []), r.persona_id]);
  for (const [n, personas] of all) if (new Set(personas).size > 1) throw new Error(`LINKED across claim kinds by nullifier ${n.slice(0, 12)}…: ${personas.join(",")}`);
  const kinds = new Set(view.nullifiers.map((n) => n.claim_kind));
  for (const k of ["tier-membership", "fork-continuity", "attestation"]) if (!kinds.has(k)) throw new Error("the session recorded no " + k + " nullifier");
});

await check("2. ATTACK: join-epoch correlation — the roots that joined when ours did are at least a floor's worth; persona first-appearance epochs are shared by the whole crowd", async () => {
  const ourReg = view.registrationsFull.filter((r) => !r.root_id.startsWith("root_zkdecoy_")).sort((a, b) => a.active_from_epoch - b.active_from_epoch)[0];
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
    const claims = [...view.eligibility.filter((x) => x.persona_id === persona), ...view.attestationClaims.filter((x) => x.persona_id === persona)];
    for (const e of claims) {
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
  // a decoy persona is indistinguishable from ours by this attack (the decoy
  // p_decoy_0_a proved the attestation too, as MAIN did)
  const dec = candidates("p_decoy_0_a");
  if (Math.abs(dec.size - cm.size) > 1) throw new Error(`our persona's candidate set (${cm.size}) differs from a decoy's (${dec.size}) — a distinguisher`);
  // the FORKED persona: its candidate roots (fork claim ∩ later tier claims) never drop below the floor
  const cn = candidates(NEW);
  if (cn.size < FLOOR) throw new Error(`NEW's candidate roots after intersection: ${cn.size} < floor`);
  const pair = new Set([...cn].filter((c) => ca.has(c)));
  if (pair.size < FLOOR) throw new Error(`NEW ∩ ALT joint candidate set is ${pair.size} < floor — the fork links predecessor and successor`);
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

await check("6. FORK: from server data the operator cannot pair NEW with ALT — no row anywhere holds both ids; the fork record holds a 64-hex commitment and nothing else about the predecessor; the vault-sealed fork record is ciphertext; NEW's submission timing is jittered off the fork action", async () => {
  const rows = [];
  for (const [k, v] of Object.entries(view)) for (const r of v) rows.push(k + ":" + JSON.stringify(r));
  const both = rows.filter((r) => r.includes(NEW) && r.includes(ALT));
  if (both.length) throw new Error("operator rows pairing NEW with ALT: " + both[0].slice(0, 160));
  // fork claims are pruned like eligibility (the epoch + its grace): by the end of a
  // four-epoch session the row may be gone; if present it holds the commitment only
  const fc = view.forkClaims.filter((r) => r.persona_id === NEW);
  if (fc.length > 1) throw new Error("more than one fork claim for NEW: " + JSON.stringify(fc));
  if (fc.length === 1 && (fc[0].fork_commit !== forkCommit || !/^[0-9a-f]{64}$/.test(fc[0].fork_commit))) throw new Error("fork claim row is not (NEW, commitment): " + JSON.stringify(fc));
  if (fc.length === 1 && JSON.stringify(fc[0]).includes(ALT)) throw new Error("the fork claim names the predecessor");
  // the sealed namespaces have ONE opaque address each — no persona id, no root hash, as a KEY (attack-z2-1 #3 / -2 #2 / -3 #1)
  for (const k of view.stateKeys) {
    if (["identityRoster", "forks", "sessionHandles", "rootRoster", "zkQueue"].includes(k.namespace) && k.key !== "_") throw new Error("a sealed namespace still has a plaintext address: " + k.namespace + "/" + String(k.key).slice(0, 24));
    if (k.key === NEW || k.key === ALT) throw new Error("a persona id is a plaintext state address: " + k.namespace + "/" + k.key);
  }
  for (const row of view.forksState) {
    const v = JSON.parse(row.value);
    if (!(v && v.v === 1 && typeof v.ct === "string")) throw new Error("the fork record is not ciphertext at rest");
    if (row.value.includes(ALT) || row.value.includes(NEW)) throw new Error("the fork record names a persona in the clear");
  }
  const sub = wire.find((w) => w.persona === NEW && w.kind === "submit" && (w.outcome === "accepted" || w.outcome === "replay"));
  if (!sub) throw new Error("no accepted (or tick-duplicated) submission for NEW on the wire");
  if (sub.at - forkAt < 100) throw new Error("NEW's continuity submission left at the moment of the fork (no jitter)");
  const logPath = (process.env.TEMP || "/tmp") + "/layers-validator.log";
  if (existsSync(logPath)) {
    const log = readFileSync(logPath, "utf8");
    if (log.includes(NEW) || log.includes(forkCommit)) throw new Error("the validator log names the forked persona or the commitment");
  }
});

await check("7. REVOCATION: the re-issued root's personas keep proving under fresh nullifiers; nothing but the ROOT-LEVEL registration rows (a stated leak) ties the old commitment to the new; no persona row references either commitment; the candidate sets after re-issuance still clear the floor", async () => {
  const regs = view.registrationsFull.filter((r) => !r.root_id.startsWith("root_zkdecoy_"));
  const old = regs.find((r) => r.commitment === oldCommitment), neu = regs.find((r) => r.commitment === newCommitment);
  if (!old || old.revoked_from_epoch !== revokeEpoch + 1) throw new Error("old commitment is not recorded revoked from the next epoch: " + JSON.stringify(old));
  if (!neu || neu.revoked_from_epoch !== null || neu.active_from_epoch !== revokeEpoch + 1) throw new Error("new commitment is not active from the next epoch: " + JSON.stringify(neu));
  const after = view.eligibility.filter((e) => e.epoch > revokeEpoch && [MAIN, ALT, NEW].includes(e.persona_id));
  if (after.length < 3) throw new Error("our personas did not prove after the re-issuance: " + after.length);
  const before = view.eligibility.filter((e) => e.epoch <= revokeEpoch && [MAIN, ALT].includes(e.persona_id));
  const bn = new Set(before.map((e) => e.nullifier));
  if (after.some((e) => bn.has(e.nullifier))) throw new Error("a post-re-issuance nullifier repeats a pre-revocation one");
  for (const t of ["eligibility", "nullifiers", "forkClaims", "attestationClaims", "blocks"]) {
    for (const r of view[t]) { const j = JSON.stringify(r); if (j.includes(oldCommitment) || j.includes(newCommitment)) throw new Error(`${t} row references a commitment: ${j.slice(0, 120)}`); }
  }
  // the crowd that re-registered when we did: the operator sees ONE new registration that epoch (ours) — root-level, and stated (A-Z3-REISSUE-JOIN)
});

await check("8. ATTESTATION + BLOCK: the attested cohort at the active epoch clears the floor (MAIN is one of many); after expiry no attestation claim was recorded for the expired epoch; the block wrote ONE row for the acting persona with no sibling row within its second", async () => {
  const claimsAtActive = view.attestationClaims.filter((c) => c.issuer === "test.mock-issuer" && c.epoch === attestEpoch);
  if (claimsAtActive.length < FLOOR) throw new Error(`attested cohort at the active epoch is ${claimsAtActive.length} < floor`);
  if (!claimsAtActive.some((c) => c.persona_id === MAIN)) throw new Error("MAIN's attestation claim is missing at the active epoch");
  if (view.attestationClaims.some((c) => c.epoch > attestEpoch)) throw new Error("an attestation claim was recorded after expiry");
  const expiredTree = view.history.filter((h) => h.tree === "attest:test.mock-issuer/any" && h.epoch > attestEpoch);
  if (expiredTree.some((h) => h.root !== "0")) throw new Error("the attest tree still had leaves after expiry");
  if (selfPersona && blockTarget) {
    // block rows carry HOUR-grain timestamps (attack-z2-1 #2): the session's block is one row by the acting persona, with no adjacent row for the same target (a fan-out signature)
    const mine = view.blocks.filter((b) => b.blocked_persona === blockTarget && b.blocker_persona === selfPersona);
    if (mine.length !== 1) throw new Error("the block did not write exactly one row for the acting persona: " + JSON.stringify(mine));
    if (mine[0].created_at % 3_600_000 !== 0) throw new Error("the block row carries a timestamp finer than the hour: " + mine[0].created_at);
    const neighbours = view.blocks.filter((b) => b.rid !== mine[0].rid && b.blocked_persona === blockTarget && Math.abs(b.rid - mine[0].rid) <= 1);
    if (neighbours.length) throw new Error("adjacent rows for the same target (a fan-out signature): " + JSON.stringify(neighbours).slice(0, 200));
  }
});

await retry(() => zk("setRelay", { kind: null }));
await retry(() => zk("setRepImpl", { impl: null }));
await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(`\n${results.length - fails.length - infra.length}/${results.length} ZK Pass 2 Gate 4 (linkage v2) checks passed` + (fails.length ? `, ${fails.length} FAILED` : "") + (infra.length ? `, ${infra.length} infra` : ""));
if (fails.length) console.log("\n  *** A SUCCESSFUL LINKAGE IS A PASS-HALTING FAILURE ***");
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
