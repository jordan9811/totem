// MULTI-FID PASS Gate 5 — OPERATOR-VIEW LINKAGE TEST v4. FIXTURE-ONLY.
// SAFETY SET: a successful linkage halts the pass.
//
// The attestation pass's v3 session is unchanged; THIS suite adds what the Multi-FID pass introduced
// and asks, from the OPERATOR's data only (the validator's database, its log, the shape of the wire),
// whether any of it links a persona to its root or to a sibling, a fork's old account to its new one,
// or an anonymous cast to anyone.
//
//   0. SESSION: fresh universe under the zk binding + a 120-decoy cohort; MAIN acquires a fid; a seeded
//      persona forks to PUB (fid minted, MAIN carried); PUB forks to NEW (fid minted; continuity proved
//      at the tick); MAIN casts on the network and PUB replies as itself; ours posts anonymously and a
//      crowd of ≥ floor decoys posts anonymously in the same window
//   1. ANON → PERSONA / ROOT by nullifier: no anon nullifier equals any other nullifier in the store;
//      no column of the anon rows names a persona, a root, a device or an eligibility row; the crowd ≥ floor
//   2. ANON → SUBMITTER by row shape: every anon cast row has the same fid, the same hour-grained time
//      and the same columns — ours is not distinguishable from the crowd's by any column
//   3. FID MAP → ROOT: the plain map holds fid + fname only; no custody address, signer or registrant
//      anywhere in the DB; the record namespace is ciphertext
//   4. OLD ↔ NEW (fork): no row holds both PUB's and NEW's ids or fids; the fork-claim row names NEW and
//      a commitment only; the sealed fid namespace is one opaque row before and after the fork
//   5. ACT-AS ACROSS PERSONAS: the network sees two accounts and the attribution index names them (public
//      by design); nothing joins them to a root; the reply latency is measured and reported as the
//      behavioural link it is (A-FID-BEHAVIOURAL-LINK), never hidden
//   6. THE WIRE: the anon envelope, payload included, fits the constant request size — it is sent padded
//      or not at all
//   7. LEAKS: the validator's log and its whole DB carry no persona id, root id, custody address, signer
//      reference or vault plaintext beside the casts; sealed namespaces are ciphertext
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { Identity } from "@semaphore-protocol/identity";
import { poseidon2 } from "poseidon-lite";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const VLOG = process.env.LAYERS_VALIDATOR_LOG || (process.env.TEMP ? process.env.TEMP + "/layers-validator.log" : null);
const MAIN = "persona_viewer_main";
const N = 120;
const ZK_SUBMIT_BYTES = 4096;
const te = new TextEncoder();
const toHex = (b) => Buffer.from(b).toString("hex");
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

await assertServersUp(BASE);
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
const persona = (action, extra = {}) => api("POST", "/api/fc/persona", { action, ...extra });
const write = (body) => api("POST", "/api/fc/write", body);
const reset = () => retry(() => dev("resetSeed"));
const fork = (fromPersona, carry, newHandle) => retry(() => api("POST", "/api/identity/fork", { fromPersona, carry, newHandle, newName: "Gate 5 " + newHandle }));
const view = async () => (await retry(() => api("GET", "/api/fc/persona"))).json;
const anonCasts = async () => (await vapi("/zk/anon-casts?mode=fixture")).json?.casts ?? [];
const seedAccounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(seedAccounts);
const idOf = (h) => seedList.find((p) => p.handle === h)?.id;

// the validator's derivations, DUPLICATED here so the crowd's envelopes are built by the rig, not the product
const toBeBytes32 = (x) => { const out = new Uint8Array(32); let v = x; for (let i = 31; i >= 0; i--) { out[i] = Number(v & 255n); v >>= 8n; } return out; };
const semaphoreHash = (x) => BigInt("0x" + toHex(keccak_256(toBeBytes32(x)))) >> 8n;
const fieldOf = (domain, canonical) => BigInt("0x" + toHex(sha256(te.encode(`layers-zk-field/1|${domain}|${canonical}`)))) >> 8n;
const nullifierFor = (scopeValue, secret) => poseidon2([semaphoreHash(scopeValue), secret]);
// PERSONA LAUNCH P3: the canonical form binds the SLOT too (validator/zk.js canonicalPublicInputs); PERSONA LAUNCH P4: and
// the ring note's hash after it
const canonicalAnon = (p) => ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge, p.castHash, p.attributionCommitment, p.slot === undefined || p.slot === null ? "" : String(p.slot), p.noteHash || ""].join("|");
const fixtureTag = (canonical, nullifier) => createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
const castHashOf = (text, nonce) => createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex");
function decoyAnonEnvelope(decoy, tree, epoch, root, windowEpochs, text, slot) {
  const nonce = createHash("sha256").update("decoy-nonce|" + text).digest("hex").slice(0, 32);
  const castHash = castHashOf(text, nonce);
  // the anoncast reveal pattern (MULTI-FID PASS): every anon post carries a commitment, even the
  // crowd's — a decoy that never reveals leaves it forever undistinguishable from ours (check 2)
  const attributionCommitment = createHash("sha256").update("layers-anon-attribution/1|" + createHash("sha256").update("decoy-secret|" + text).digest("hex")).digest("hex");
  // MULTI-FID Gate 5: the window REPLACES the epoch in the anon scope. PERSONA LAUNCH P3: qualified by the SLOT too —
  // one nullifier per (root, window, slot); each decoy posts in one of the K slots, like a person would
  const scope = fieldOf("scope", `layers/zk-scope/v1|anon-post/w${Math.floor(epoch / windowEpochs)}/s${slot}`).toString(10);
  const challenge = "epoch-" + epoch;
  // PERSONA LAUNCH P4 (R8): the crowd's posts carry a 256-byte note like ours (CSPRNG bytes: no ring) — the same size,
  // its hash bound in the message beside attr:, so the note column cannot single ours out either
  const note = randomBytes(256).toString("hex");
  const noteHash = createHash("sha256").update(Buffer.from(note, "hex")).digest("hex");
  const message = fieldOf("message", ["anon", "anon-post", "cast:" + castHash, "attr:" + attributionCommitment, "note:" + noteHash, challenge, root].join("|")).toString(10);
  const pub = { mode: "fixture", claimKind: "anon-post", tree, epoch, merkleTreeRoot: root, scope, message, personaId: "anon", gateId: "anon-post", challenge, castHash, attributionCommitment, slot, noteHash };
  const nullifier = nullifierFor(BigInt(scope), decoy.secretScalar).toString(10);
  return { v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalAnon(pub), nullifier) }, payload: { text, nonce, note } };
}
function scanDb(fn) {
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    const rows = [];
    for (const t of tables) for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) rows.push({ t, row, s: JSON.stringify(row) });
    return fn(rows, tables);
  } finally {
    db.close();
  }
}

console.log("\nMulti-FID pass Gate 5 — operator-view linkage v4: two persona fids, a fork to a new fid, an act-as reply, an anon post inside a crowd");

const stamp = Date.now().toString(36);
let FLOOR = Math.max(1, Number(process.env.ZK_ANON_FLOOR ?? 50)), TREE = null, EPOCH = null, WINDOW = 1, ROOT = null, K = 4;
let PUB = null, NEW = null, recMain = null, recPub = null, recNew = null, pubRowBefore = null;
let mainCast = null, pubReply = null, ourAnon = { text: null, castHash: null, envelope: null, networkHash: null }, crowd = { inTree: 0, accepted: 0 };
const ourText = `anon says ${stamp} [layers-test fixture]`;

await check("0. SESSION: fresh universe under zk + 120-decoy cohort; MAIN acquires a fid; a seeded persona forks to PUB (fid minted) and PUB to NEW (fid minted, continuity proved); MAIN casts and PUB replies as itself; ours posts anonymously, then ≥ floor decoys post anonymously in the same window", async () => {
  await reset();
  await retry(() => zk("resetZk"));
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("setHonoredIssuers", { issuers: ["test.mock-issuer"] }));
  await retry(() => zk("seedDecoys", { count: N }));
  await retry(() => zk("register"));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("prefetchNow"));
  await sleep(300);
  const gs = (await retry(() => zk("gateStatus"))).json;
  TREE = gs.tree;
  FLOOR = Number(gs.floor ?? gs.anonFloor ?? FLOOR) || FLOOR;
  const cfg = (await vapi("/zk/anon-post/config?mode=fixture")).json;
  if (cfg?.tree !== TREE) throw new Error("the validator's anon tree " + cfg?.tree + " is not the gate tree " + TREE);
  WINDOW = Number(cfg.windowEpochs) || 1;
  // PERSONA LAUNCH P3: the validator's K (public) — the crowd's slots are drawn from it
  K = Number(cfg.slotsPerWindow);
  if (!Number.isInteger(K) || K < 1) throw new Error("the validator reports no slotsPerWindow: " + JSON.stringify(cfg));
  // fids: MAIN acquires; the forks mint
  recMain = (await retry(() => persona("acquire", { personaId: MAIN }))).json.record;
  const src = idOf("brothandbones");
  const pubRes = (await fork(src, [MAIN], `fid5_pub_${stamp}`)).json;
  PUB = pubRes.newPersona;
  if (!PUB || !pubRes.newFid?.fid) throw new Error("PUB fork: " + JSON.stringify(pubRes).slice(0, 200));
  pubRowBefore = JSON.stringify(Object.keys((await vapi("/state")).json?.state?.personaFids ?? {}));
  const newRes = (await fork(PUB, [MAIN], `fid5_new_${stamp}`)).json;
  NEW = newRes.newPersona;
  if (!NEW || !newRes.newFid?.fid || newRes.continuity?.proofRequested !== true) throw new Error("NEW fork: " + JSON.stringify(newRes).slice(0, 200));
  const v = await view();
  recPub = v.records.find((r) => r.personaId === PUB);
  recNew = v.records.find((r) => r.personaId === NEW);
  if (!recPub || !recNew) throw new Error("records missing");
  // the network: MAIN casts, PUB replies as itself through the write door
  mainCast = (await retry(() => write({ action: "cast", personaId: MAIN, text: `main on the network ${stamp} [layers-test fixture]` }))).json;
  pubReply = (await retry(() => api("POST", "/api/actions/act-as", { kind: "reply", targetHash: mainCast.hash, text: `pub replies ${stamp} [layers-test fixture]`, asPersonaId: PUB }))).json;
  if (!pubReply.ok || !pubReply.hash) throw new Error("act-as reply: " + JSON.stringify(pubReply).slice(0, 200));
  // ours, anonymously: queued → proved at the tick (the continuity claim proves on the same tick) → sent by the drain
  const q = await api("POST", "/api/anon", { text: ourText });
  if (q.status !== 202) throw new Error("anon queue: " + q.status + " " + JSON.stringify(q.json).slice(0, 200));
  ourAnon.text = ourText;
  ourAnon.castHash = q.json.castHash;
  await retry(() => zk("prefetchNow"));
  await sleep(500);
  const queued = (await retry(() => api("GET", `/api/anon?castHash=${ourAnon.castHash}&envelope=1`))).json;
  ourAnon.envelope = queued.envelope ?? null;
  EPOCH = queued.item?.epoch ?? null;
  if (!ourAnon.envelope || EPOCH === null) throw new Error("anon envelope not queued: " + JSON.stringify(queued.item));
  const d = (await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }))).json;
  const st = (await retry(() => api("GET", `/api/anon?castHash=${ourAnon.castHash}`))).json;
  if (st.item?.status !== "sent" || st.item?.outcome !== "accepted") throw new Error("our anon post not accepted: " + JSON.stringify(st.item) + " drain=" + JSON.stringify(d).slice(0, 160));
  ourAnon.networkHash = (await anonCasts()).find((c) => c.castHash === ourAnon.castHash)?.hash ?? null;
  if (!ourAnon.networkHash) throw new Error("our anon cast is not listed");
  // the crowd: every decoy that is a leaf of the gate tree posts anonymously in the same window, through the plain door
  const members = (await vapi(`/zk/members?mode=fixture&tree=${encodeURIComponent(TREE)}`)).json;
  ROOT = members.root;
  const inTree = new Set(members.members);
  const decoys = Array.from({ length: N }, (_, i) => new Identity("layers-zk-decoy/" + i)).filter((id) => inTree.has(id.commitment.toString(10)));
  crowd.inTree = decoys.length;
  let k = 0;
  for (const id of decoys) {
    const env = decoyAnonEnvelope(id, TREE, EPOCH, ROOT, WINDOW, `anon says ${stamp}-${k} [layers-test fixture]`, k % K);
    k++;
    const r = (await retry(() => zk("submit", { envelope: env }))).json;
    if (r.status === 200) crowd.accepted++;
    else if (crowd.accepted === 0 && k === 1) throw new Error("the first decoy anon post was refused: " + JSON.stringify(r).slice(0, 200));
  }
  if (crowd.accepted < FLOOR) throw new Error(`anon crowd ${crowd.accepted} (of ${crowd.inTree} decoys in ${TREE}) is below the floor ${FLOOR}`);
  console.log(`   session: tree ${TREE}, epoch ${EPOCH}, window ${WINDOW}, floor ${FLOOR}, crowd ${crowd.accepted}/${crowd.inTree}, fids MAIN ${recMain.fid} PUB ${recPub.fid} NEW ${recNew.fid}`);
});

const ownIds = () => [MAIN, PUB, NEW].filter(Boolean);
const rootLike = (s) => /root_[A-Za-z0-9]/.test(s) || /"rootId"/.test(s);

await check("1. ANON → PERSONA / ROOT by nullifier: every anon-post nullifier is distinct from every other nullifier in the store; the anon rows have no column naming a persona, a root, a device or an eligibility row; the crowd this window ≥ floor", async () => {
  scanDb((rows) => {
    const nulls = rows.filter((r) => r.t === "zk_nullifiers");
    const anonNulls = nulls.filter((r) => r.row.claim_kind === "anon-post" && r.row.epoch === EPOCH);
    if (anonNulls.length < FLOOR) throw new Error(`anon nullifiers this epoch ${anonNulls.length} < floor ${FLOOR}`);
    const seen = new Map();
    for (const r of nulls) { const n = String(r.row.nullifier); if (seen.has(n)) throw new Error("nullifier equality across rows: " + n.slice(0, 12)); seen.set(n, r.row.claim_kind); }
    const anonCols = Object.keys(anonNulls[0].row).sort().join(",");
    if (anonCols !== "claim_kind,epoch,mode,nullifier,tree") throw new Error("the anon nullifier row carries more than (mode, nullifier, kind, tree, epoch): " + anonCols);
    for (const r of anonNulls) if (ownIds().some((id) => r.s.includes(id)) || rootLike(r.s)) throw new Error("an anon nullifier row names a persona or root");
    const casts = rows.filter((r) => r.t === "zk_anon_casts");
    for (const r of casts) if (ownIds().some((id) => r.s.includes(id)) || rootLike(r.s) || /nullifier|device|persona/i.test(Object.keys(r.row).join(","))) throw new Error("an anon cast row names a persona, a root, a device or a nullifier");
  });
});

await check("2. ANON → SUBMITTER by row shape: every anon cast row has the same fid, the same hour-grained time and the same column set, and ours is one of ≥ floor identical shapes — no column singles it out", async () => {
  scanDb((rows) => {
    const casts = rows.filter((r) => r.t === "zk_anon_casts").map((r) => r.row);
    if (casts.length < FLOOR + 1) throw new Error("anon cast rows " + casts.length);
    const ours = casts.find((c) => c.cast_hash === ourAnon.castHash);
    if (!ours) throw new Error("our anon cast row is missing");
    const fids = new Set(casts.map((c) => c.fid)), times = new Set(casts.map((c) => c.relayed_at)), epochs = new Set(casts.map((c) => c.epoch));
    if (fids.size !== 1) throw new Error("anon casts carry more than one fid: " + [...fids].join(","));
    if (times.size !== 1) throw new Error("anon casts carry more than one hour-grained time this session: " + [...times].join(","));
    if (ours.relayed_at % 3_600_000 !== 0) throw new Error("relayed_at is finer than an hour");
    if (epochs.size !== 1) throw new Error("anon casts span epochs: " + [...epochs].join(","));
    // attribution_commitment is unique per post by construction (it is a hash of a per-post secret) —
    // excluded from the shape comparison exactly like the other necessarily-unique columns. PERSONA LAUNCH P4: so is the
    // ring note (256 bytes, real or random) — and EVERY row's note is exactly 256 bytes, ours included (a note-less or
    // odd-sized row would be a shape of its own)
    for (const c of casts) if (typeof c.note !== "string" || !/^[0-9a-f]{512}$/.test(c.note)) throw new Error("an anon row's note is not 256 bytes: " + String(c.note).slice(0, 40));
    const shape = (c) => Object.keys(c).sort().join(",") + "|" + Object.entries(c).filter(([k]) => k !== "text" && k !== "cast_hash" && k !== "network_hash" && k !== "attribution_commitment" && k !== "note").map(([k, v]) => k + "=" + v).sort().join(",");
    const ourShape = shape(ours);
    const same = casts.filter((c) => shape(c) === ourShape).length;
    if (same < FLOOR) throw new Error(`our anon row's shape is shared by ${same - 1} others (< floor ${FLOOR})`);
  });
});

await check("3. FID MAP → ROOT: no plain persona → fid map exists on the validator (D-FID-5-MAP-SEALED); no custody address, signer reference, registrant or funder anywhere in its DB or state; the record namespace, the forks and the grants are ciphertext", async () => {
  const state = (await vapi("/state")).json?.state ?? {};
  // MULTI-FID Gate 5 (D-FID-5-MAP-SEALED): no plain persona → fid map on the validator at all
  if (state.personaFidMap && Object.keys(state.personaFidMap).length) throw new Error("a plain persona→fid map exists on the validator: " + JSON.stringify(state.personaFidMap).slice(0, 200));
  for (const ns of ["personaFids", "forks", "grantsV3"]) for (const [k, v] of Object.entries(state[ns] ?? {})) if (!(v && typeof v === "object" && typeof v.ct === "string")) throw new Error(`${ns}/${k} is not ciphertext`);
  const needles = [recMain.custodyAddress, recPub.custodyAddress, recNew.custodyAddress].map((a) => a.toLowerCase()).concat(["sim-signer-", "neynar-sponsor", "derivedpubhex", "signeruuid", "custodyaddress"]);
  const whole = (JSON.stringify(state) + scanDb((rows) => rows.map((r) => r.s).join("\n"))).toLowerCase();
  for (const n of needles) if (whole.includes(n)) throw new Error("the validator holds the record in the clear: " + n);
});

await check("4. OLD ↔ NEW (fork): no row in the DB or the state holds both PUB's and NEW's ids or fids; the fork-claim row names NEW and a commitment only; the sealed fid namespace is one opaque row before and after the fork", async () => {
  const state = (await vapi("/state")).json?.state ?? {};
  // the sealed record namespace is ONE opaque row before and after the fork — a fork adds no row an operator could count
  const pubRowAfter = JSON.stringify(Object.keys(state.personaFids ?? {}));
  if (pubRowAfter !== pubRowBefore) throw new Error("the sealed fid namespace's row set changed at the fork: " + pubRowBefore + " → " + pubRowAfter);
  const both = (s) => (s.includes(PUB) && s.includes(NEW)) || (s.includes(String(recPub.fid)) && s.includes(String(recNew.fid)));
  for (const [ns, rowsNs] of Object.entries(state)) for (const [k, v] of Object.entries(rowsNs)) { if (v && typeof v === "object" && typeof v.ct === "string") continue; if (both(JSON.stringify(v))) throw new Error(`state ${ns}/${k} relates PUB and NEW`); }
  scanDb((rows) => {
    for (const r of rows) if (r.t !== "adapter_state" && both(r.s)) throw new Error(`${r.t} row relates PUB and NEW: ` + r.s.slice(0, 160));
    const claims = rows.filter((r) => r.t === "zk_fork_claims" && r.row.persona_id === NEW);
    if (claims.length !== 1) throw new Error("fork claim rows for NEW: " + claims.length);
    const cols = Object.keys(claims[0].row).sort().join(",");
    if (cols !== "epoch,fork_commit,mode,nullifier,persona_id,tier,tree") throw new Error("fork claim columns: " + cols);
    if (claims[0].s.includes(PUB) || claims[0].s.includes(String(recPub.fid))) throw new Error("the fork claim names the old persona or its fid");
  });
});

await check("5. ACT-AS ACROSS PERSONAS: the sim network holds MAIN's cast under MAIN's fid and PUB's reply under PUB's; the attribution index names each persona as the account it is; nothing in the DB joins either to a root; the reply latency is measured and reported (A-FID-BEHAVIOURAL-LINK)", async () => {
  const sim = (await retry(() => dev("fcSimNetwork"))).json.casts;
  const a = sim.find((c) => c.hash === mainCast.hash), b = sim.find((c) => c.hash === pubReply.hash);
  if (!a || !b || a.fid !== recMain.fid || b.fid !== recPub.fid) throw new Error("network: " + JSON.stringify({ a: a && a.fid, b: b && b.fid, main: recMain.fid, pub: recPub.fid }));
  const att = (await retry(() => api("GET", "/api/fc/attribution?hashes=" + [mainCast.hash, pubReply.hash].map(encodeURIComponent).join(",")))).json.attributions;
  if (att[mainCast.hash]?.id !== MAIN || att[pubReply.hash]?.id !== PUB) throw new Error("attribution: " + JSON.stringify(att).slice(0, 200));
  scanDb((rows) => { for (const r of rows) if ((r.s.includes(mainCast.hash) || r.s.includes(pubReply.hash)) && rootLike(r.s)) throw new Error(`${r.t} row joins a cast to a root`); });
  const latencyMs = Math.max(0, (b.at ?? 0) - (a.at ?? 0));
  console.log(`   act-as reply latency on the network: ${latencyMs} ms (one device, two accounts — the behavioural link is real and stated, A-FID-BEHAVIOURAL-LINK)`);
});

await check("6. THE WIRE: the anon envelope with its payload fits the constant 4096-byte request body (it is sent padded to exactly that size or not at all); its public signal carries the constant 'anon' and the cast hash, nothing about a persona or a root", async () => {
  const bare = JSON.stringify({ envelope: ourAnon.envelope, p: "" });
  const len = Buffer.byteLength(bare, "utf8");
  if (len > ZK_SUBMIT_BYTES) throw new Error(`the anon envelope needs ${len} bytes > ${ZK_SUBMIT_BYTES}`);
  const p = ourAnon.envelope.publicInputs;
  if (p.personaId !== "anon" || p.castHash !== ourAnon.castHash) throw new Error("public signal: " + JSON.stringify(p).slice(0, 200));
  const s = JSON.stringify(ourAnon.envelope);
  if (ownIds().some((id) => s.includes(id)) || rootLike(s)) throw new Error("the envelope names a persona or root");
  console.log(`   anon request: ${len} bytes before padding, sent as ${ZK_SUBMIT_BYTES}`);
});

await check("7. LEAKS: the validator's log and its whole DB carry no persona id of ours, no root id, no custody address, no signer reference and no vault plaintext beside any cast of this session; the validator logs nothing about requests by discipline", async () => {
  const hashes = [ourAnon.castHash, ourAnon.networkHash, mainCast.hash, pubReply.hash];
  scanDb((rows) => {
    for (const r of rows) {
      if (!hashes.some((h) => r.s.includes(h))) continue;
      if (r.t === "adapter_state") continue; // the device's own plaintext furniture rows (attribution index) — persona-keyed by design (C5), root-free
      if (ownIds().some((id) => r.s.includes(id)) || rootLike(r.s)) throw new Error(`${r.t} row beside a cast names a persona or root: ` + r.s.slice(0, 160));
    }
  });
  if (VLOG && existsSync(VLOG)) {
    const log = readFileSync(VLOG, "utf8");
    for (const n of [...hashes, ...ownIds(), recMain.custodyAddress, recPub.custodyAddress, recNew.custodyAddress]) if (n && log.includes(n)) throw new Error("the validator log carries " + n.slice(0, 24));
  } else {
    console.log("   (validator log not found at " + VLOG + " — the DB and the wire are the evidence)");
  }
});

await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Multi-FID Gate 5 linkage v4 checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
