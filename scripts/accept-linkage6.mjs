// PERSONA LAUNCH P3 — OPERATOR-VIEW LINKAGE TEST v6. FIXTURE-ONLY. SAFETY SET: a successful linkage halts the pass.
//
// v4 (scripts/accept-fid5.mjs) asked whether ONE anon post could be tied to a persona or a root from the operator's
// data. P3 lets one person post K times a window, from any of their personas, each post in its own SLOT. So v6 asks the
// new question: given everything the validator stores, logs and sees on the wire, can it tell that TWO anon posts of
// one window came from the same person — or which persona made either?
//
//   0. SESSION: fresh universe; a persona P2 minted with no account BEFORE the proof layer is on (so no claim of its own
//      names it); the zk binding, a 120-decoy cohort; OUR root posts twice in one window — once as MAIN, once as P2 —
//      through the product path (compose → tick → drain); then every decoy that is a leaf of the gate tree posts once in
//      the same window through the plain door, each in a uniformly drawn slot (a crowd ≥ the floor)
//   1. NULLIFIERS: our two posts carry DIFFERENT nullifiers (and different scopes), distinct from every other nullifier
//      in the store; the nullifier rows hold (mode, nullifier, kind, tree, epoch) and nothing else
//   2. ROW SHAPE: every anon row of the session has the same columns and the same values outside the necessarily-unique
//      ones (text, hashes, commitment, the 256-byte ring note) — tree = the configured tree, a note of exactly 256 bytes
//      on every row, one fid, one hour-grained time, one epoch, one status — so our two rows are two of ≥ floor
//      identical shapes
//   3. ORDER: the rows are stored by cast hash (WITHOUT ROWID, keyed (mode, cast_hash)) and listed by hash inside the
//      hour, so neither the table nor the public list carries submission order; the live relay draws its order and each
//      row's moment from a CSPRNG (source check of validator/zk.js relayPending)
//   4. AT REST: no table has a slot column; no row stores our scopes; no zk table row and no row beside our casts names
//      P2 or MAIN; the validator's log carries neither persona nor our casts
//   5. THE DEVICE'S QUEUE on the validator is ONE sealed record, padded to a KiB step, whose stored bytes show no persona
//      (the personas live only inside it — read back cold to prove they are there)
//   6. THE WIRE: our envelopes fit the constant 4096-byte request, carry the constant 'anon', and name no persona
//   7. THE RESIDUAL, MEASURED AND REPORTED (A-ANON-SLOT-INDEX-VISIBLE): the slot index rides the wire. One person's posts
//      in one window never share a slot, so a pair that shares one is certainly two people; a pair in different slots is
//      K/(K-1) times likelier to be one person than before the slot was seen. Measured over this session's wire, printed,
//      never hidden; the check asserts our pair's slots differ (the structural cause) and the crowd's same-slot rate is
//      the uniform 1/K it should be (a skewed rate would be a second, larger signal)
//   8. THE QUEUE'S SIZE SAYS NOTHING (PRIV-3): one more anon post grows the sealed zkQueue's PLAINTEXT past a KiB step,
//      and the stored ciphertext's length is IDENTICAL before and after — a coarse padding class, never a step per post
//      (the device-signed PUT that carries it would otherwise tell the operator "this root just posted"); once the
//      window closes, the next tick prunes our submissions from the sealed record, and every reveal record stays with
//      how its post ended. NON-VACUOUS by construction: the check first proves the plaintext crossed a 1 KiB padding
//      step (so the old padding WOULD have shown the post) and that the post is in the record.
// Fixture, pinned ports, no network, no spend. Run with the rig up:
//   bash <scratchpad>/att-run.sh scripts/accept-linkage6.mjs      (npm run test:linkage6 once the verify agent adds it)
import { createHash, randomBytes, randomInt } from "node:crypto";
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
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }

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
const reset = () => retry(() => dev("resetSeed"));
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(JSON.parse(readFileSync("seed/data/accounts.json", "utf8")));
const SOURCE = seedList.find((p) => p.handle === "brothandbones")?.id;

// the validator's derivations, DUPLICATED here so the crowd's envelopes are built by the rig, not the product
const toBeBytes32 = (x) => { const out = new Uint8Array(32); let v = x; for (let i = 31; i >= 0; i--) { out[i] = Number(v & 255n); v >>= 8n; } return out; };
const semaphoreHash = (x) => BigInt("0x" + toHex(keccak_256(toBeBytes32(x)))) >> 8n;
const fieldOf = (domain, canonical) => BigInt("0x" + toHex(sha256(te.encode(`layers-zk-field/1|${domain}|${canonical}`)))) >> 8n;
const nullifierFor = (scopeValue, secret) => poseidon2([semaphoreHash(scopeValue), secret]);
// PERSONA LAUNCH P4: the canonical tail binds the ring note's hash after the slot (validator/zk.js canonicalPublicInputs)
const canonicalAnon = (p) => ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge, p.castHash, p.attributionCommitment, String(p.slot), p.noteHash || ""].join("|");
const fixtureTag = (canonical, nullifier) => createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
const castHashOf = (text, nonce) => createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex");
function decoyEnvelope(decoy, tree, epoch, root, windowEpochs, text, slot) {
  const nonce = createHash("sha256").update("decoy6-nonce|" + text).digest("hex").slice(0, 32);
  const castHash = castHashOf(text, nonce);
  const attributionCommitment = createHash("sha256").update("layers-anon-attribution/1|" + createHash("sha256").update("decoy6-secret|" + text).digest("hex")).digest("hex");
  const scope = fieldOf("scope", `layers/zk-scope/v1|anon-post/w${Math.floor(epoch / windowEpochs)}/s${slot}`).toString(10);
  const challenge = "epoch-" + epoch;
  // PERSONA LAUNCH P4 (R8): a 256-byte CSPRNG note on every crowd post (no ring), its hash bound beside attr:
  const note = randomBytes(256).toString("hex");
  const noteHash = createHash("sha256").update(Buffer.from(note, "hex")).digest("hex");
  const message = fieldOf("message", ["anon", "anon-post", "cast:" + castHash, "attr:" + attributionCommitment, "note:" + noteHash, challenge, root].join("|")).toString(10);
  const pub = { mode: "fixture", claimKind: "anon-post", tree, epoch, merkleTreeRoot: root, scope, message, personaId: "anon", gateId: "anon-post", challenge, castHash, attributionCommitment, slot, noteHash };
  const nullifier = nullifierFor(BigInt(scope), decoy.secretScalar).toString(10);
  return { v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalAnon(pub), nullifier) }, payload: { text, nonce, note } };
}
function scanDb(fn) {
  if (!existsSync(DB_PATH)) throw new Error("INFRA: validator DB not found at " + DB_PATH);
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    try { db.exec("PRAGMA busy_timeout = 8000"); } catch { /* read-only */ }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    const rows = [];
    for (const t of tables) for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) rows.push({ t, row: { ...row }, s: JSON.stringify(row) });
    return fn(rows, tables, db);
  } finally {
    db.close();
  }
}

console.log("\nPersona launch P3 — operator-view linkage v6: two anon posts of one person, one window, two personas, two slots, inside a crowd");
const stamp = Date.now().toString(36);
let FLOOR = Math.max(1, Number(process.env.ZK_ANON_FLOOR ?? 50)), TREE = null, EPOCH = null, WINDOW = 1, ROOT = null, K = 4, P2 = null;
const ours = []; // { personaId, text, castHash, envelope, networkHash }
const wire = []; // every anon envelope of the session as the operator received it: { ours, slot }
let crowd = { inTree: 0, accepted: 0 };

await check("0. SESSION: P2 minted with no account before the proof layer is on; the zk binding and a 120-decoy cohort; our root posts twice in one window (as MAIN and as P2) through the product path; ≥ floor decoys post in the same window, each in a uniformly drawn slot", async () => {
  if (!SOURCE) throw new Error("no seeded fork source (brothandbones)");
  await reset();
  await retry(() => zk("resetZk"));
  await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
  try {
    const f = await retry(() => api("POST", "/api/identity/fork", { fromPersona: SOURCE, carry: [], newHandle: `link6_${stamp.slice(-5)}` }));
    P2 = f.json.newPersona;
    if (!P2 || f.json.newFid) throw new Error("P2 was not minted without an account");
  } finally {
    await retry(() => persona("setNetworkMode", { mode: null }));
  }
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
  K = Number(cfg.slotsPerWindow);
  if (!Number.isInteger(K) || K < 2) throw new Error("the validator reports no K: " + K);
  for (const p of [MAIN, P2]) {
    const text = `link6 ${p === MAIN ? "a" : "b"} ${stamp} [layers-test fixture]`;
    const r = await api("POST", "/api/anon", { text, personaId: p });
    if (r.status !== 202) throw new Error("our anon post as " + p + ": " + r.status + " " + JSON.stringify(r.json).slice(0, 200));
    ours.push({ personaId: p, text, castHash: r.json.castHash, envelope: null, networkHash: null });
  }
  await retry(() => zk("prefetchNow"));
  await sleep(500);
  for (const o of ours) {
    const q = (await retry(() => api("GET", `/api/anon?castHash=${o.castHash}&envelope=1`))).json;
    if (q?.outcome?.lastStage === "epoch-edge") throw new Error("INFRA: the rig's epoch ends inside the jitter window — re-run after the boundary");
    if (q.item?.status !== "queued" || !q.envelope) throw new Error("not queued: " + JSON.stringify({ item: q.item, outcome: q.outcome }));
    o.envelope = q.envelope;
    wire.push({ ours: true, slot: q.envelope.publicInputs.slot });
  }
  EPOCH = ours[0].envelope.publicInputs.epoch;
  if (ours[1].envelope.publicInputs.epoch !== EPOCH) throw new Error("our two posts were proved in different epochs (the session straddled a boundary)");
  await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
  for (const o of ours) {
    const st = (await retry(() => api("GET", `/api/anon?castHash=${o.castHash}`))).json;
    if (st.item?.outcome !== "accepted") throw new Error("our anon post was not accepted: " + JSON.stringify(st.item));
  }
  const listed = await (async () => (await vapi("/zk/anon-casts?mode=fixture")).json?.casts ?? [])();
  for (const o of ours) {
    o.networkHash = listed.find((c) => c.castHash === o.castHash)?.hash ?? null;
    if (!o.networkHash) throw new Error("our anon cast is not listed");
  }
  const members = (await vapi(`/zk/members?mode=fixture&tree=${encodeURIComponent(TREE)}`)).json;
  ROOT = members.root;
  const inTree = new Set(members.members);
  const decoys = Array.from({ length: N }, (_, i) => new Identity("layers-zk-decoy/" + i)).filter((id) => inTree.has(id.commitment.toString(10)));
  crowd.inTree = decoys.length;
  let k = 0;
  for (const id of decoys) {
    const slot = randomInt(K); // a person's slot is drawn uniformly over the free ones; a decoy's single post has all K free
    const env = decoyEnvelope(id, TREE, EPOCH, ROOT, WINDOW, `link6 crowd ${stamp}-${k} [layers-test fixture]`, slot);
    const r = (await retry(() => zk("submit", { envelope: env }))).json;
    if (r.status === 200) { crowd.accepted++; wire.push({ ours: false, slot }); }
    else if (k === 0) throw new Error("the first decoy anon post was refused: " + JSON.stringify(r).slice(0, 200));
    k++;
  }
  if (crowd.accepted < FLOOR) throw new Error(`crowd ${crowd.accepted} (of ${crowd.inTree} in ${TREE}) is below the floor ${FLOOR}`);
  return `tree ${TREE}, epoch ${EPOCH}, K ${K}, floor ${FLOOR}, crowd ${crowd.accepted}/${crowd.inTree}, our slots ${ours.map((o) => o.envelope.publicInputs.slot).join(" & ")}`;
});

await check("1. NULLIFIERS: our two posts carry different nullifiers and different scopes, each distinct from every other nullifier in the store; every nullifier row holds exactly (mode, nullifier, claim_kind, tree, epoch)", async () => {
  const [a, b] = ours.map((o) => o.envelope);
  if (String(a.nullifier) === String(b.nullifier)) throw new Error("ONE PERSON'S TWO POSTS SHARE A NULLIFIER — the operator can pair them");
  if (a.publicInputs.scope === b.publicInputs.scope) throw new Error("our two posts share a scope");
  scanDb((rows) => {
    const nulls = rows.filter((r) => r.t === "zk_nullifiers");
    const seen = new Map();
    for (const r of nulls) { const n = String(r.row.nullifier); if (seen.has(n)) throw new Error("nullifier equality across rows: " + n.slice(0, 12)); seen.set(n, true); }
    for (const o of ours) if (!seen.has(String(o.envelope.nullifier))) throw new Error("our nullifier is not in the store (nothing to compare)");
    const anonNulls = nulls.filter((r) => r.row.claim_kind === "anon-post" && r.row.epoch === EPOCH);
    if (anonNulls.length < FLOOR + 2) throw new Error(`anon nullifiers this epoch ${anonNulls.length} < floor + 2`);
    for (const r of anonNulls) if (Object.keys(r.row).sort().join(",") !== "claim_kind,epoch,mode,nullifier,tree") throw new Error("a nullifier row carries more than (mode, nullifier, kind, tree, epoch): " + Object.keys(r.row).join(","));
  });
});

let shapeClass = 0;
await check("2. ROW SHAPE: every anon row of the session has the same columns and the same values outside text / hashes / commitment / the ring note — tree = the configured tree, a 256-byte note on EVERY row, one fid, one hour-grained time, one epoch, one status; our two rows are two of ≥ floor identical shapes", async () => {
  scanDb((rows) => {
    const casts = rows.filter((r) => r.t === "zk_anon_casts" && r.row.mode === "fixture" && r.row.epoch === EPOCH).map((r) => r.row);
    const mine = ours.map((o) => casts.find((c) => c.cast_hash === o.castHash));
    if (mine.some((m) => !m)) throw new Error("our rows are missing");
    for (const m of mine) {
      if (m.tree !== TREE || typeof m.note !== "string" || !/^[0-9a-f]{512}$/.test(m.note)) throw new Error("tree/note on our row: " + JSON.stringify({ tree: m.tree, note: String(m.note).slice(0, 40) }));
      if (m.relayed_at % 3_600_000 !== 0) throw new Error("relayed_at is finer than an hour");
    }
    // PERSONA LAUNCH P4: every row of the session carries a 256-byte note — ours and the crowd's alike
    for (const c of casts) if (typeof c.note !== "string" || !/^[0-9a-f]{512}$/.test(c.note)) throw new Error("an anon row's note is not 256 bytes: " + String(c.note).slice(0, 40));
    const UNIQUE = new Set(["text", "cast_hash", "network_hash", "attribution_commitment", "note"]);
    const shape = (c) => Object.keys(c).sort().join(",") + "|" + Object.entries(c).filter(([k]) => !UNIQUE.has(k)).map(([k, v]) => k + "=" + v).sort().join(",");
    const s0 = shape(mine[0]);
    if (shape(mine[1]) !== s0) throw new Error("our two rows differ in shape: " + s0 + " vs " + shape(mine[1]));
    shapeClass = casts.filter((c) => shape(c) === s0).length;
    const times = new Set(casts.map((c) => c.relayed_at));
    if (shapeClass < FLOOR + 2) {
      if (times.size > 1) throw new Error("INFRA: the session straddled an hour boundary (" + times.size + " relay hours) — re-run");
      throw new Error(`our rows' shape is shared by ${shapeClass} rows (< floor + 2 = ${FLOOR + 2})`);
    }
  });
  return `${shapeClass} rows of one shape`;
});

await check("3. ORDER: zk_anon_casts is WITHOUT ROWID keyed (mode, cast_hash) — stored by hash, not by arrival; the public list orders an hour's casts by hash, so our two posts sit where their hashes put them; the live relay shuffles with a CSPRNG and draws each row's moment over the spread", async () => {
  scanDb((rows, tables, db) => {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'zk_anon_casts'").get().sql;
    if (!/WITHOUT ROWID/i.test(sql) || !/PRIMARY KEY \(mode, cast_hash\)/i.test(sql)) throw new Error("the anon table keeps an arrival order: " + sql.replace(/\s+/g, " ").slice(0, 200));
  });
  const list = (await vapi("/zk/anon-casts?mode=fixture")).json.casts.filter((c) => c.epoch === EPOCH);
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    if (a.at === b.at && a.castHash > b.castHash) throw new Error("the public list is not hash-ordered inside the hour (arrival order would show)");
  }
  const src = readFileSync("validator/zk.js", "utf8");
  if (!/for \(let i = rows\.length - 1; i > 0; i--\) \{ const j = randomInt\(0, i \+ 1\); \[rows\[i\], rows\[j\]\] = \[rows\[j\], rows\[i\]\]; \}/.test(src)) throw new Error("the live relay no longer shuffles its rows with a CSPRNG (validator/zk.js relayPending)");
  if (!/relayDueAt\.set\(r\.cast_hash, now \+ \(spread > 0 \? randomInt\(0, spread \+ 1\) : 0\)\)/.test(src)) throw new Error("the live relay no longer draws each row's moment over the spread");
  const pos = ours.map((o) => list.findIndex((c) => c.castHash === o.castHash));
  return `our posts at positions ${pos.join(" & ")} of ${list.length} (by hash)`;
});

await check("4. AT REST: no table has a slot column; no row stores our scopes or their slot-qualified strings; no zk table row and no row beside our casts names P2 or MAIN; the validator's log names neither persona nor our casts", async () => {
  const scopes = ours.map((o) => String(o.envelope.publicInputs.scope));
  const qualified = ours.map((o) => `anon-post/w${Math.floor(EPOCH / WINDOW)}/s${o.envelope.publicInputs.slot}`);
  const ids = [P2, MAIN];
  const nearOurs = [...ours.map((o) => o.castHash), ...ours.map((o) => o.networkHash), ...ours.map((o) => String(o.envelope.nullifier)), ...ours.map((o) => o.text)];
  scanDb((rows, tables, db) => {
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
      if (cols.some((c) => /slot/i.test(c))) throw new Error(`${t} has a slot column`);
    }
    for (const r of rows) {
      if (scopes.some((s) => r.s.includes(s)) || qualified.some((q) => r.s.includes(q))) throw new Error(`${r.t} stores one of our scopes`);
      if (r.t.startsWith("zk_") && ids.some((id) => r.s.includes(id))) throw new Error(`${r.t} names a persona of the poster: ` + r.s.slice(0, 160));
      if (r.t !== "adapter_state" && nearOurs.some((n) => r.s.includes(n)) && ids.some((id) => r.s.includes(id))) throw new Error(`${r.t} row beside our cast names a persona`);
    }
    // P2 made only anon posts and no claim of its own: it appears in no validator table at all outside the device's sealed state
    for (const r of rows) if (r.t !== "adapter_state" && r.s.includes(P2)) throw new Error(`${r.t} names P2, the persona that only posted anonymously: ` + r.s.slice(0, 160));
  });
  if (VLOG && existsSync(VLOG)) {
    const log = readFileSync(VLOG, "utf8");
    for (const n of [P2, ...ours.map((o) => o.castHash), ...ours.map((o) => String(o.envelope.nullifier))]) if (log.includes(n)) throw new Error("the validator log carries " + n.slice(0, 24));
  } else console.log("   (validator log not found at " + VLOG + " — the DB and the wire are the evidence)");
});

await check("5. THE DEVICE'S QUEUE on the validator is ONE sealed record padded to a KiB step, and its stored bytes show neither persona; read back cold, it holds both posts with their personas (the personas live there and nowhere else)", async () => {
  const rb = (await retry(() => zk("anonQueueReadback", { personaIds: [P2, MAIN] }))).json;
  if (rb.rows?.length !== 1 || rb.rows[0].key !== "_" || !rb.rows[0].ciphertext) throw new Error("the zkQueue namespace is not one opaque ciphertext record: " + JSON.stringify(rb.rows));
  // opaqueDump pads the plaintext {m, pad} to target − 33 bytes (target a multiple of 1024); AES-GCM adds a 16-byte tag
  if ((rb.rows[0].ctBytes + 17) % 1024 !== 0) throw new Error("the sealed record is not padded to a KiB step: " + rb.rows[0].ctBytes + " bytes");
  if ((rb.plaintextHits ?? []).length) throw new Error("the stored queue shows " + rb.plaintextHits.join(","));
  for (const o of ours) if (!rb.records.some((r) => r.castHash === o.castHash && r.personaId === o.personaId)) throw new Error("the sealed record does not hold " + o.personaId + "'s post");
  return `${rb.rows[0].ctBytes} bytes`;
});

await check("6. THE WIRE: each of our envelopes, payload included, fits the constant 4096-byte request; its public signal carries the constant 'anon', and nothing in it names a persona", async () => {
  for (const o of ours) {
    const len = Buffer.byteLength(JSON.stringify({ envelope: o.envelope, p: "" }), "utf8");
    if (len > ZK_SUBMIT_BYTES) throw new Error(`an anon envelope needs ${len} bytes > ${ZK_SUBMIT_BYTES}`);
    if (o.envelope.publicInputs.personaId !== "anon") throw new Error("the signal names " + o.envelope.publicInputs.personaId);
    const s = JSON.stringify(o.envelope);
    if (s.includes(P2) || s.includes(MAIN)) throw new Error("an envelope names a persona");
  }
});

await check("7. THE RESIDUAL, MEASURED (A-ANON-SLOT-INDEX-VISIBLE): our two posts sit in different slots (one person never repeats a slot in a window); over the session's wire, the share of post pairs that share a slot — pairs the slot proves are two people — is the uniform 1/K; reported with the likelihood ratio a different-slot pair gains", async () => {
  const [sa, sb] = ours.map((o) => o.envelope.publicInputs.slot);
  if (sa === sb) throw new Error("our two posts share a slot — the validator would have refused the second as a replay");
  const n = wire.length;
  if (n < FLOOR + 2) throw new Error("too few posts on the wire to measure: " + n);
  const counts = new Array(K).fill(0);
  for (const w of wire) counts[w.slot]++;
  let same = 0, pairs = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { pairs++; if (wire[i].slot === wire[j].slot) same++; }
  const rate = same / pairs;
  // under a uniform draw the same-slot rate concentrates around 1/K (n ≈ 60: within a factor of two by a wide margin)
  if (!(rate > 0.5 / K && rate < 2 / K)) throw new Error(`the same-slot rate ${rate.toFixed(3)} is far from 1/K = ${(1 / K).toFixed(3)} — the slot index is a larger signal than stated: ${JSON.stringify(counts)}`);
  const lr = K / (K - 1);
  console.log(`   A-ANON-SLOT-INDEX-VISIBLE (measured, not hidden): over ${n} anon posts of window w${Math.floor(EPOCH / WINDOW)} (${pairs} pairs), ${same} pairs (${(rate * 100).toFixed(1)}%, expected ${(100 / K).toFixed(1)}%) share a slot and are thereby PROVEN to be two people;`);
  console.log(`   every other pair — ours included (slots ${sa} and ${sb}) — is ${lr.toFixed(3)}× likelier to be one person than before its slots were seen. Slot counts: ${JSON.stringify(counts)}.`);
  return `same-slot ${(rate * 100).toFixed(1)}% of ${pairs} pairs; different-slot LR ${lr.toFixed(2)}`;
});

await check("8. THE QUEUE'S SIZE SAYS NOTHING (PRIV-3): one more anon post (as MAIN, same window) grows the sealed record's PLAINTEXT across a 1 KiB padding step, and the stored ciphertext's length is IDENTICAL before and after; once the window closes the next tick prunes our three submissions from the sealed record, every reveal record staying with how its post ended", async () => {
  if (ours.length !== 2 || !ours.every((o) => o.envelope)) throw new Error("check 0 did not run — no posts to build on");
  const readback = async () => {
    const rb = (await retry(() => zk("anonQueueReadback", { personaIds: [P2, MAIN] }))).json;
    if (rb.rows?.length !== 1 || typeof rb.rows[0].ctBytes !== "number" || typeof rb.plainBytes !== "number" || !Array.isArray(rb.submissions)) throw new Error("the readback has no sizes or submissions: " + JSON.stringify(rb).slice(0, 200));
    return rb;
  };
  const before = await readback();
  const text = `link6 c ${stamp} [layers-test fixture]`;
  const r = await api("POST", "/api/anon", { text, personaId: MAIN });
  if (r.status !== 202) throw new Error("the third anon post: " + r.status + " " + JSON.stringify(r.json).slice(0, 200));
  const third = r.json.castHash;
  await retry(() => zk("prefetchNow"));
  await sleep(500);
  const q = (await retry(() => api("GET", `/api/anon?castHash=${third}`))).json;
  if (q?.outcome?.lastStage === "epoch-edge") throw new Error("INFRA: the rig's epoch ends inside the jitter window — re-run after the boundary");
  if (q.item?.status !== "queued") throw new Error("the third post was not queued: " + JSON.stringify({ item: q.item, outcome: q.outcome }));
  if (q.item.epoch !== EPOCH) throw new Error("INFRA: the session straddled an epoch boundary (the third post is in epoch " + q.item.epoch + ", ours in " + EPOCH + ") — re-run");
  await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
  const after = await readback();
  // NON-VACUITY: the post IS in the sealed record, and the plaintext crossed a 1 KiB step — at the old KiB padding the
  // ciphertext would have grown with it, so "identical" below is the padding class at work, not a post that was missing
  if (!after.records.some((x) => x.castHash === third) || !after.submissions.some((x) => x.castHash === third)) throw new Error("the third post is not in the sealed record (nothing was compared)");
  const kibStep = (n) => Math.ceil((n + 64) / 1024);
  if (kibStep(after.plainBytes) === kibStep(before.plainBytes)) throw new Error(`the post grew the plaintext by only ${after.plainBytes - before.plainBytes} bytes, inside one KiB step — the comparison could not tell a KiB padding from a coarse one`);
  if (after.rows[0].ctBytes !== before.rows[0].ctBytes) throw new Error(`the sealed queue's ciphertext length followed the post: ${before.rows[0].ctBytes} → ${after.rows[0].ctBytes} bytes (plaintext ${before.plainBytes} → ${after.plainBytes}) — its device-signed PUT tells the operator this root just posted`);
  // the window closes (WINDOW epochs on): the next tick prunes the closed window's settled submissions
  for (let i = 0; i < WINDOW; i++) await retry(() => zk("advanceEpoch"));
  await retry(() => zk("prefetchNow"));
  await sleep(500);
  const pruned = await readback();
  const mine = [...ours.map((o) => o.castHash), third];
  const held = pruned.submissions.filter((x) => mine.includes(x.castHash));
  if (held.length) throw new Error("the closed window's submissions are still in the sealed record: " + JSON.stringify(held));
  for (const h of mine) {
    const rec = pruned.records.find((x) => x.castHash === h);
    if (!rec || !rec.hasSecret || rec.settled?.status !== "sent" || rec.settled?.outcome !== "accepted") throw new Error("a reveal record was lost or does not say how its post ended: " + JSON.stringify(rec));
  }
  if (!(pruned.plainBytes < after.plainBytes)) throw new Error(`the plaintext did not shrink after pruning (${after.plainBytes} → ${pruned.plainBytes})`);
  if ((pruned.plaintextHits ?? []).length) throw new Error("the stored queue shows " + pruned.plaintextHits.join(","));
  return `ciphertext ${before.rows[0].ctBytes} bytes before and after one post (plaintext ${before.plainBytes} → ${after.plainBytes}); pruned to ${pruned.plainBytes} plaintext bytes, ${pruned.records.length} reveal records kept`;
});

await check("9. THE QUEUE'S SIZE SAYS NOTHING, CUMULATIVELY (wave 3, L4): seven more windows of K anon posts each (MAIN and P2 in turn — about thirty lifetime posts in all, every window pruned at its close) leave the sealed zkQueue's ciphertext length IDENTICAL after every window's sends and every window's prune — the power-of-two classes stepped with lifetime posts (reveal records are kept for good); NON-VACUOUS: the plaintext grows by kilobytes and the record holds every post's reveal record", async () => {
  if (ours.length !== 2) throw new Error("check 0 did not run — nothing to build on");
  const readback = async () => {
    const rb = (await retry(() => zk("anonQueueReadback", { personaIds: [P2, MAIN] }))).json;
    if (rb.rows?.length !== 1 || typeof rb.rows[0].ctBytes !== "number" || typeof rb.plainBytes !== "number" || !Array.isArray(rb.records)) throw new Error("the readback has no sizes: " + JSON.stringify(rb).slice(0, 200));
    return rb;
  };
  const first = await readback();
  const sizes = new Set([first.rows[0].ctBytes]);
  let plainMax = first.plainBytes;
  const posted = [];
  for (let w = 0; w < 7; w++) {
    for (let i = 0; i < WINDOW; i++) await retry(() => zk("advanceEpoch"));
    await retry(() => zk("prefetchNow"));
    await sleep(400);
    sizes.add((await readback()).rows[0].ctBytes); // the closed window's prune
    for (let i = 0; i < K; i++) {
      const r = await api("POST", "/api/anon", { text: `link6 cumulative ${w}.${i} ${stamp} [layers-test fixture]`, personaId: i % 2 ? P2 : MAIN });
      if (r.status !== 202) throw new Error(`window ${w} post ${i}: ` + r.status + " " + JSON.stringify(r.json).slice(0, 160));
      posted.push(r.json.castHash);
    }
    await retry(() => zk("prefetchNow"));
    await sleep(500);
    const st = (await retry(() => api("GET", `/api/anon?castHash=${posted[posted.length - 1]}`))).json;
    if (st?.outcome?.lastStage === "epoch-edge") throw new Error("INFRA: the rig's epoch ends inside the jitter window — re-run after the boundary");
    await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
    const rb = await readback();
    sizes.add(rb.rows[0].ctBytes);
    plainMax = Math.max(plainMax, rb.plainBytes);
  }
  const last = await readback();
  const held = posted.filter((h) => last.records.some((x) => x.castHash === h)).length;
  if (held !== posted.length) throw new Error(`only ${held} of ${posted.length} reveal records are in the sealed queue (nothing was compared for the rest)`);
  if (!(plainMax - first.plainBytes > 8 * 1024)) throw new Error(`the plaintext grew by only ${plainMax - first.plainBytes} bytes — the comparison could not tell a constant size from a coarse class`);
  if (sizes.size !== 1) throw new Error(`the sealed queue's ciphertext length changed with lifetime posts: ${[...sizes].join(" → ")} bytes — its device-signed PUT tells the operator how many anonymous posts this root made`);
  return `${posted.length + 3} posts over 8 windows: ciphertext ${[...sizes][0]} bytes throughout (plaintext ${first.plainBytes} → up to ${plainMax})`;
});

await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} linkage v6 checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
if (failed) console.log("SAFETY SET: a linkage check failed — HALT THE PASS and read the failure before anything else.");
process.exitCode = failed ? 1 : infra ? 2 : 0;
