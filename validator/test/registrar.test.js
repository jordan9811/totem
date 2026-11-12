"use strict";
// PERSONA LAUNCH P6 — THE SIMULATED REGISTRAR AND CHAIN (validator/registrar.js, validator/simchain.js), in-process: an
// in-memory database through the real migrations (25 "launch_registrar" included), the real route mounts on an
// ephemeral port (never a pinned one), and real signatures — EIP-712 by viem on the "device" side, recovered by the
// validator's own hand-rolled EIP-712; Ed25519 by node:crypto for the batch reveal. No network, no spend.
//
// Every guard is shown refusing a NEAR MISS of an input it accepts (the near miss is otherwise identical), so no check
// here passes vacuously: a request with one byte changed, a key one bit off, a clock one minute short.
process.env.ZK_DEV_HOOKS = "true";
delete process.env.FC_TEST_FID;
delete process.env.FC_ANON_FID;
delete process.env.FC_CONNECT_APP_FID;

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign: cryptoSign, createHash, randomBytes } = require("node:crypto");
const express = require("express");
const { openDb } = require("../db");
const { MIGRATIONS } = require("../migrations");
const registrar = require("../registrar");
const simchain = require("../simchain");

const HOUR = 3_600_000;
const DAY = 86_400_000;
let db;
let server;
let base;
let viem;

before(async () => {
  db = openDb(":memory:");
  const app = express();
  app.use(express.json());
  simchain.mountSimChain(app, db);
  registrar.mountRegistrar(app, db, { devHooks: true });
  // the ONE line validator/zk.js carries for the batch form of POST /zk/anon/reveal (reach applies it there)
  app.post("/zk/anon/reveal", (req, res) => {
    const b = req.body || {};
    if (b.batch === true) {
      const r = registrar.revealBatch(db, b);
      return res.status(r.status).json(r.json);
    }
    res.status(400).json({ error: "single reveals are zk.js's" });
  });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = "http://127.0.0.1:" + server.address().port;
  viem = await import("viem/accounts");
});
after(() => server.close());

async function api(method, p, body) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ---- the DEVICE side, as lib/launch/request.ts builds it (typed data duplicated here on purpose: a drift fails)
const ID_GATEWAY_DOMAIN = { name: "Farcaster IdGateway", version: "1", chainId: 10, verifyingContract: "0x00000000fc25870c6ed6b6c7e41fb078b7656f69" };
const KEY_GATEWAY_DOMAIN = { name: "Farcaster KeyGateway", version: "1", chainId: 10, verifyingContract: "0x00000000fc56947c7e7183f8ca4b62398caadf0b" };
const FNAME_DOMAIN = { name: "Farcaster name verification", version: "1", chainId: 1, verifyingContract: "0xe3be01d99baa8db9905b33a3ca391238234b79d1" };
const REGISTER_TYPES = { Register: [{ name: "to", type: "address" }, { name: "recovery", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
const ADD_TYPES = { Add: [{ name: "owner", type: "address" }, { name: "keyType", type: "uint32" }, { name: "key", type: "bytes" }, { name: "metadataType", type: "uint8" }, { name: "metadata", type: "bytes" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
const UNP_TYPES = { UserNameProof: [{ name: "name", type: "string" }, { name: "timestamp", type: "uint256" }, { name: "owner", type: "address" }] };

function edKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
}
async function makePersona() {
  const custodyKey = viem.privateKeyToAccount("0x" + randomBytes(32).toString("hex"));
  const recoveryKey = viem.privateKeyToAccount("0x" + randomBytes(32).toString("hex"));
  return { custodyKey, recoveryKey, custody: custodyKey.address.toLowerCase(), recovery: recoveryKey.address.toLowerCase(), signer: edKey() };
}
async function buildRequest(p, overrides = {}) {
  // PERSONA LAUNCH wave 3 (L8): the client's week-quantized deadline (lib/launch/request.ts deadlineDayFor) — the
  // registrar refuses a deadline that is not a 7-day boundary
  const deadlineDay = overrides.deadlineDay ?? 7 * (Math.floor((Math.floor(registrar.simNow(db, "fixture") / DAY) + 3) / 7) + 1);
  const deadline = BigInt(deadlineDay * 86_400);
  const registerSig = (await (overrides.registerSigner ?? p.custodyKey).signTypedData({ domain: ID_GATEWAY_DOMAIN, types: REGISTER_TYPES, primaryType: "Register", message: { to: p.custody, recovery: p.recovery, nonce: 0n, deadline } })).toLowerCase();
  const addSig = (await p.custodyKey.signTypedData({ domain: KEY_GATEWAY_DOMAIN, types: ADD_TYPES, primaryType: "Add", message: { owner: p.custody, keyType: 1, key: "0x" + p.signer.pubHex, metadataType: 1, metadata: simchain.addMetadataFor(), nonce: 0n, deadline } })).toLowerCase();
  const req = { v: 1, mode: overrides.mode ?? "fixture", custody: p.custody, recovery: p.recovery, signerKey: p.signer.pubHex, fname: overrides.fname ?? "launched-" + randomBytes(3).toString("hex"), profile: { displayName: "A persona", bio: "", pfpUrl: "" }, registerSig, addSig, deadlineDay };
  return registrar.canonicalLaunchRequest(req);
}
const reset = () => registrar.resetFixture(db, "fixture");

test("migration 25 'launch_registrar' is in the list and its tables exist (attributed_batch on zk_anon_casts)", () => {
  const m = MIGRATIONS.find((x) => x.version === 25);
  assert.ok(m && m.name === "launch_registrar", "migration 25 launch_registrar is not appended (validator/migrations.js)");
  for (const t of ["launch_queue", "sim_chain_fids", "sim_chain_keys", "sim_chain_fnames", "registrar_spend", "registrar_clock", "zk_reveal_batches"]) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(t), t + " missing");
  }
  const cols = db.prepare("PRAGMA table_info(zk_anon_casts)").all().map((c) => c.name);
  assert.ok(cols.includes("attributed_batch"), "zk_anon_casts.attributed_batch missing");
  // the launch queue holds only the request's public fields: no persona, device, root or anchor column
  const qcols = db.prepare("PRAGMA table_info(launch_queue)").all().map((c) => c.name).sort();
  assert.deepEqual(qcols, ["batch_id", "due_at", "fid", "id", "launch_commit", "mode", "request", "requested_hour", "status"]);
});

test("the request: canonical round-trip, commit = sha256('layers-launch-request/1|'+request), signatures recovered to the custody — and every near miss refused", async () => {
  reset();
  const p = await makePersona();
  const request = await buildRequest(p);
  assert.equal(registrar.validateLaunchRequest(request), null);
  assert.equal(registrar.launchCommitOf(request), createHash("sha256").update("layers-launch-request/1|" + request).digest("hex"));
  // not canonical: whitespace, reordered keys
  assert.match(registrar.validateLaunchRequest(JSON.stringify(JSON.parse(request), null, 1)), /canonical/);
  const o = JSON.parse(request);
  assert.match(registrar.validateLaunchRequest(JSON.stringify({ mode: o.mode, ...o })), /canonical/);
  // an extra field (a persona id!) is refused
  assert.match(registrar.validateLaunchRequest(JSON.stringify({ ...o, personaId: "p_x" })), /canonical/);
  // a Register signature by another key
  const stranger = viem.privateKeyToAccount("0x" + randomBytes(32).toString("hex"));
  assert.match(registrar.validateLaunchRequest(await buildRequest(p, { registerSigner: stranger })), /Register signature/);
  // the Add signature over a different signer key: swap the key after signing
  const swapped = registrar.canonicalLaunchRequest({ ...o, signerKey: edKey().pubHex });
  assert.match(registrar.validateLaunchRequest(swapped), /Add signature/);
  // live: the registrar has no live mode
  assert.match(registrar.validateLaunchRequest(registrar.canonicalLaunchRequest({ ...o, mode: "live" })), /isn't set up yet/);
  // over 2048 bytes
  assert.match(registrar.validateLaunchRequest(registrar.canonicalLaunchRequest({ ...o, profile: { ...o.profile, bio: "é".repeat(256), pfpUrl: "https://x/" + "a".repeat(240) } }) + " ".repeat(2048)), /longer than 2048|canonical/);
  // the registrar app fid is none of the accounts it must never be
  assert.throws(() => simchain.ensureRegistrarApp(db, "fixture", { FC_TEST_FID: String(simchain.REGISTRAR_APP_FID) }), /must differ from FC_TEST_FID/);
  assert.throws(() => simchain.ensureRegistrarApp(db, "fixture", { FC_CONNECT_APP_FID: String(simchain.REGISTRAR_APP_FID) }), /FC_CONNECT_APP_FID/);
  assert.throws(() => simchain.ensureRegistrarApp(db, "fixture", { FC_ANON_FID: String(simchain.REGISTRAR_APP_FID) }), /FC_ANON_FID/);
  simchain.ensureRegistrarApp(db, "fixture", { FC_TEST_FID: "3348985" });
});

test("enqueue (inside the caller's transaction): live throws, a mismatched commit throws, a good one is due 2 to 47.5 hours after arrival and keeps NO arrival hour; a second launch of the same custody is accepted with NO new row (idempotent)", async () => {
  reset();
  const p = await makePersona();
  const request = await buildRequest(p);
  const commit = registrar.launchCommitOf(request);
  assert.throws(() => registrar.enqueueLaunch(db, "live", request, commit, 1), /no live mode/);
  assert.throws(() => registrar.enqueueLaunch(db, "fixture", request, "0".repeat(64), 1), /does not hash/);
  const arrival = registrar.simNow(db, "fixture");
  const { due } = registrar.enqueueLaunch(db, "fixture", request, commit, 1);
  assert.ok(due >= arrival + 2 * HOUR && due <= arrival + 47.5 * HOUR + 1000, `due ${due - arrival} ms after arrival`);
  const row = db.prepare("SELECT * FROM launch_queue WHERE launch_commit = ?").get(commit);
  assert.equal(row.status, "queued");
  // PERSONA LAUNCH P6 (fix LP-6): the arrival hour is never stored — a snapshot must not join the click hour to the fid
  assert.equal(row.requested_hour, null, "the registrar row keeps the arrival hour beside the future fid");
  // PERSONA LAUNCH P6 (fix W2-LAUNCH-NO-ADOPTION): a SECOND, valid request for the same custody (another name, its own
  // correct commit — a device that lost its record, or re-proved) is ACCEPTED: no new row, the existing due time
  const second = await buildRequest(p, { fname: "another-name" });
  assert.equal(registrar.validateLaunchRequest(second), null, "the near miss must itself be valid");
  const again = registrar.enqueueLaunch(db, "fixture", second, registrar.launchCommitOf(second), 1);
  assert.equal(again.due, due, "the repeat did not answer with the first request's due time");
  assert.equal(again.existing, "queued");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM launch_queue WHERE mode = 'fixture'").get().n, 1, "a repeat for the same custody added a row");
  // the very SAME request again (a re-proof of the record) is accepted the same way, not a UNIQUE-constraint 500
  assert.equal(registrar.enqueueLaunch(db, "fixture", request, commit, 1).due, due);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM launch_queue WHERE mode = 'fixture'").get().n, 1);
  // a DIFFERENT custody still gets its own row (the idempotence is per custody, not a closed door)
  const q = await makePersona();
  const other = await buildRequest(q);
  registrar.enqueueLaunch(db, "fixture", other, registrar.launchCommitOf(other), 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM launch_queue WHERE mode = 'fixture'").get().n, 2, "another custody's launch was swallowed");
  // once registered: a repeat for that custody is accepted with no row (it already owns an account)
  registrar.advanceClock(db, "fixture", 48 * HOUR);
  registrar.runDueBatches(db, "fixture");
  assert.ok(simchain.fidOfCustody(db, "fixture", p.custody));
  const third = await buildRequest(p, { fname: "a-third-name" }); // signed on the advanced sim day (its deadline outlasts 48 h)
  const after = registrar.enqueueLaunch(db, "fixture", third, registrar.launchCommitOf(third), 1);
  assert.equal(after.existing, "registered");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM launch_queue WHERE mode = 'fixture'").get().n, 2);
  // the SAME request after the simulated chain refused it is re-queued IN PLACE (launch_commit is UNIQUE)
  const r = await makePersona();
  const late = await buildRequest(r);
  const lateCommit = registrar.launchCommitOf(late);
  registrar.enqueueLaunch(db, "fixture", late, lateCommit, 1);
  db.prepare("UPDATE launch_queue SET status = 'failed' WHERE launch_commit = ?").run(lateCommit);
  const requeued = registrar.enqueueLaunch(db, "fixture", late, lateCommit, 1);
  assert.ok(requeued.due > 0 && !requeued.existing, "a failed request was not re-queued");
  const lateRow = db.prepare("SELECT status, requested_hour FROM launch_queue WHERE launch_commit = ?").get(lateCommit);
  assert.equal(lateRow.status, "queued");
  assert.equal(lateRow.requested_hour, null);
});

test("THE SIM CLOCK: nothing registers at +1 h 59 m; by +48 h it is registered with the persona's key vouched by the ONE registrar app fid, storage rented, and ONE $0 spend row per batch", async () => {
  reset();
  const p = await makePersona();
  const request = await buildRequest(p);
  const commit = registrar.launchCommitOf(request);
  const t0 = registrar.simNow(db, "fixture");
  registrar.enqueueLaunch(db, "fixture", request, commit, 1);
  registrar.advanceClock(db, "fixture", 2 * HOUR - 60_000);
  let r = registrar.runDueBatches(db, "fixture");
  assert.equal(r.registered, 0, "registered before 2 hours");
  assert.equal(simchain.fidOfCustody(db, "fixture", p.custody), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM registrar_spend").get().n, 0);
  registrar.advanceClock(db, "fixture", 48 * HOUR - (registrar.simNow(db, "fixture") - t0));
  r = registrar.runDueBatches(db, "fixture");
  assert.equal(r.registered, 1);
  const fid = simchain.fidOfCustody(db, "fixture", p.custody);
  assert.ok(fid > simchain.REGISTRAR_APP_FID);
  const keys = simchain.keysOf(db, "fixture", fid);
  assert.deepEqual(keys.map((k) => [k.key, k.keyType, k.requestFid, k.removedAt]), [[p.signer.pubHex, 1, simchain.REGISTRAR_APP_FID, null]]);
  const info = simchain.fidInfo(db, "fixture", fid);
  assert.equal(info.recovery, p.recovery);
  assert.equal(info.storageUnits, 1);
  const spend = db.prepare("SELECT * FROM registrar_spend").all();
  assert.equal(spend.length, 1);
  assert.equal(spend[0].usd_cents, 0);
  assert.equal(spend[0].simulated, 1);
  assert.equal(spend[0].items, 1);
  // the public registrations read: custody → fid, hour-grained, plus (PERSONA LAUNCH P6, fix LP-1) the account's recovery
  // address and ACTIVE signer keys — public chain facts, so the device checks its own key LOCALLY — and nothing else
  const regs = await api("GET", "/registrar/registrations?mode=fixture&sinceHour=0");
  assert.equal(regs.status, 200);
  const hit = regs.json.registrations.find((x) => x.custody === p.custody);
  assert.deepEqual(Object.keys(hit).sort(), ["custody", "fid", "hour", "keys", "recovery"]);
  assert.equal(hit.fid, fid);
  assert.equal(hit.recovery, p.recovery);
  assert.deepEqual(hit.keys, [p.signer.pubHex]);
  // a REMOVED key is not listed (the list carries the active keys only)
  db.prepare("UPDATE sim_chain_keys SET removed_at = 1 WHERE mode = 'fixture' AND fid = ?").run(fid);
  assert.deepEqual((await api("GET", "/registrar/registrations?mode=fixture&sinceHour=0")).json.registrations.find((x) => x.custody === p.custody).keys, []);
  db.prepare("UPDATE sim_chain_keys SET removed_at = NULL WHERE mode = 'fixture' AND fid = ?").run(fid);
  const live = await api("GET", "/registrar/registrations?mode=live");
  assert.equal(live.status, 400, "a live registrations read is refused (no live mode)");
});

test("THE SCHEDULE (pure): over 5,000 CSPRNG draws every due time is a batch moment inside [arrival + 2 h, arrival + 47.5 h]; consecutive batch moments are 12 to 36 hours apart", () => {
  const seed = randomBytes(32).toString("hex");
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 5000; i++) {
    const a = Date.UTC(2026, 0, 1) + Math.floor(Math.random() * 400 * DAY);
    const d = registrar.assignDueAt(seed, a);
    assert.ok(d >= a + 2 * HOUR && d <= a + 47.5 * HOUR, "out of the window: " + (d - a) / HOUR + " h");
    assert.ok(registrar.batchMomentsBetween(seed, d, d).includes(d), "not a batch moment");
    lo = Math.min(lo, d - a);
    hi = Math.max(hi, d - a);
  }
  assert.ok(lo < 6 * HOUR && hi > 36 * HOUR, `the draws do not spread over the window (${lo / HOUR}..${hi / HOUR} h)`);
  const ms = registrar.batchMomentsBetween(seed, Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
  for (let i = 1; i < ms.length; i++) {
    const gap = ms[i] - ms[i - 1];
    assert.ok(gap >= 12 * HOUR && gap <= 36 * HOUR, "gap " + gap / HOUR + " h");
  }
});

test("THE BATCH REVEAL: all or nothing; checked against each row's commitment and against the KeyRegistry; first reveal wins; idempotent", async () => {
  reset();
  // a registered account (through the Bundler path)
  const p = await makePersona();
  const request = await buildRequest(p);
  registrar.enqueueLaunch(db, "fixture", request, registrar.launchCommitOf(request), 1);
  registrar.advanceClock(db, "fixture", 48 * HOUR);
  registrar.runDueBatches(db, "fixture");
  const fid = simchain.fidOfCustody(db, "fixture", p.custody);
  // three relayed anon rows with commitments (two of "ours", one of a sibling's)
  db.prepare("DELETE FROM zk_anon_casts WHERE mode = 'fixture'").run();
  const rows = [0, 1, 2].map((i) => {
    const secret = randomBytes(32).toString("hex");
    const castHash = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, attribution_commitment) VALUES ('fixture', ?, ?, 1, ?, ?, 1, 'relayed', ?)").run(castHash, "post " + i, HOUR, "0xanon" + i, createHash("sha256").update("layers-anon-attribution/1|" + secret).digest("hex"));
    return { castHash, secret };
  });
  const mine = rows.slice(0, 2);
  const sign = (items, key = p.signer, f = fid) => cryptoSign(null, Buffer.from(registrar.revealBatchCanonical("fixture", f, key.pubHex, items.map((x) => x.castHash)), "utf8"), key.privateKey).toString("hex");
  const body = (items, key = p.signer, f = fid, sig = sign(items, key, f)) => ({ batch: true, mode: "fixture", fid: f, signerPubKey: key.pubHex, castHashes: items.map((x) => x.castHash), secrets: items.map((x) => x.secret), signature: sig });
  const attributed = () => db.prepare("SELECT cast_hash, attributed_fid, attributed_batch FROM zk_anon_casts WHERE attributed_fid IS NOT NULL").all();
  // a bad signature: 400, nothing
  const bad = await api("POST", "/zk/anon/reveal", body(mine, p.signer, fid, sign(mine).replace(/^./, (c) => (c === "0" ? "1" : "0"))));
  assert.equal(bad.status, 400);
  assert.equal(attributed().length, 0);
  // a key the KeyRegistry does not list (a valid signature by it): 400, nothing
  const stray = edKey();
  const unreg = await api("POST", "/zk/anon/reveal", body(mine, stray));
  assert.equal(unreg.status, 400);
  assert.match(unreg.json.error, /not a registered signer/);
  assert.equal(attributed().length, 0);
  // one wrong secret among right ones: 400, NOTHING (the right one before it is rolled back)
  const wrong = await api("POST", "/zk/anon/reveal", body([mine[0], { castHash: mine[1].castHash, secret: randomBytes(32).toString("hex") }]));
  assert.equal(wrong.status, 400);
  assert.equal(attributed().length, 0, "a partial batch was recorded");
  // the batch: every one of ours, none of the sibling's
  const ok = await api("POST", "/zk/anon/reveal", body(mine));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.revealed, 2);
  const now = attributed();
  assert.deepEqual(now.map((r) => r.cast_hash).sort(), mine.map((r) => r.castHash).sort());
  assert.ok(now.every((r) => r.attributed_fid === fid && r.attributed_batch === ok.json.batchHash));
  const stored = registrar.revealBatchesFor(db, "fixture", fid);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].castHashes, mine.map((r) => r.castHash).sort());
  // the same batch again: idempotent
  const again = await api("POST", "/zk/anon/reveal", body(mine));
  assert.equal(again.status, 200);
  assert.equal(again.json.alreadyRevealed, true);
  // first reveal wins: another registered account claiming one of these rows is 409, and nothing moves
  const q = await makePersona();
  const r2 = await buildRequest(q);
  registrar.enqueueLaunch(db, "fixture", r2, registrar.launchCommitOf(r2), 1);
  registrar.advanceClock(db, "fixture", 48 * HOUR);
  registrar.runDueBatches(db, "fixture");
  const fid2 = simchain.fidOfCustody(db, "fixture", q.custody);
  const steal = await api("POST", "/zk/anon/reveal", body([mine[0], rows[2]], q.signer, fid2));
  assert.equal(steal.status, 409);
  assert.equal(db.prepare("SELECT attributed_fid FROM zk_anon_casts WHERE cast_hash = ?").get(rows[2].castHash).attributed_fid, null, "the sibling row moved in a refused batch");
  // live: refused (F25)
  const live = await api("POST", "/zk/anon/reveal", { ...body(mine), mode: "live" });
  assert.equal(live.status, 400);
});

test("THE FNAME SERVER: a custody-signed name proof sets the name; another owner, a stale timestamp, a stranger's signature and a taken name are refused", async () => {
  reset();
  const p = await makePersona();
  const request = await buildRequest(p);
  registrar.enqueueLaunch(db, "fixture", request, registrar.launchCommitOf(request), 1);
  registrar.advanceClock(db, "fixture", 48 * HOUR);
  registrar.runDueBatches(db, "fixture");
  const fid = simchain.fidOfCustody(db, "fixture", p.custody);
  const ts = Math.floor(Date.now() / 1000);
  const proof = async (name, signer = p.custodyKey, owner = p.custody, t = ts) => ({ mode: "fixture", name, fid, owner, timestamp: t, signature: (await signer.signTypedData({ domain: FNAME_DOMAIN, types: UNP_TYPES, primaryType: "UserNameProof", message: { name, timestamp: BigInt(t), owner } })).toLowerCase() });
  const stranger = viem.privateKeyToAccount("0x" + randomBytes(32).toString("hex"));
  assert.equal((await api("POST", "/sim-chain/fname", await proof("myname", stranger))).status, 400);
  assert.equal((await api("POST", "/sim-chain/fname", await proof("myname", stranger, stranger.address.toLowerCase()))).status, 403);
  assert.equal((await api("POST", "/sim-chain/fname", await proof("myname", p.custodyKey, p.custody, ts - 7200))).status, 400);
  const ok = await api("POST", "/sim-chain/fname", await proof("myname"));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await api("GET", "/sim-chain/fname/myname")).json.fid, fid);
  assert.equal((await api("GET", "/sim-chain/fid?fid=" + fid)).json.fname, "myname");
  const keys = await api("GET", "/sim-chain/keys?fid=" + fid);
  assert.equal(keys.json.keys[0].key, p.signer.pubHex);
  // taken
  const q = await makePersona();
  const r2 = await buildRequest(q);
  registrar.enqueueLaunch(db, "fixture", r2, registrar.launchCommitOf(r2), 1);
  registrar.advanceClock(db, "fixture", 48 * HOUR);
  registrar.runDueBatches(db, "fixture");
  const fid2 = simchain.fidOfCustody(db, "fixture", q.custody);
  const taken = { ...(await proof("myname", q.custodyKey, q.custody)), fid: fid2 };
  assert.equal((await api("POST", "/sim-chain/fname", taken)).status, 409);
  // live chain reads refused
  assert.equal((await api("GET", "/sim-chain/keys?mode=live&fid=" + fid)).status, 400);
});

// ------------------------------------------------------------------------------------- PERSONA LAUNCH P6 review fixes
function relayedRows(n, opts = {}) {
  // n relayed anon rows (row 0 the OLDEST), each with a commitment to a known secret. Rows are HOUR-GRAINED like the real
  // ones: `hourOf(i)` (default: eleven rows share each hour, so page boundaries fall INSIDE an hour and the cursor's
  // same-hour tie-break is exercised)
  const out = [];
  const hourOf = opts.hourOf ?? ((i) => Math.floor(i / 11));
  const ins = db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, attribution_commitment, attributed_fid, attributed_batch) VALUES ('fixture', ?, ?, 1, ?, ?, 1, ?, ?, ?, ?)");
  for (let i = 0; i < n; i++) {
    const secret = randomBytes(32).toString("hex");
    const castHash = randomBytes(32).toString("hex");
    const status = opts.statusOf ? opts.statusOf(i) : "relayed";
    const at = ((opts.baseHour ?? 1000) + hourOf(i)) * HOUR;
    ins.run(castHash, "row " + i, at, "0xrow" + i, status, createHash("sha256").update("layers-anon-attribution/1|" + secret).digest("hex"), opts.attributedFid ? opts.attributedFid(i) : null, opts.attributedFid && opts.attributedFid(i) ? "ab".repeat(32) : null);
    out.push({ castHash, secret, at, status });
  }
  return out;
}
async function pageAll(q) {
  const seen = [];
  let before = null;
  let pages = 0;
  do {
    const r = await api("GET", "/registrar/anon-casts?mode=fixture" + q + (before ? "&before=" + before : ""));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    seen.push(...r.json.casts);
    before = r.json.next;
    pages++;
  } while (before);
  return { seen, pages };
}

test("fix W2-LAUNCH-REVEAL-200 — THE COMPLETE ANON LIST: 1,130 relayed rows page out in full (newest first, no repeats, none missing — the feed list stops at 200); sinceHour and attributedFid filter; a pending row is never listed; malformed cursors and live are refused", async () => {
  reset();
  db.prepare("DELETE FROM zk_anon_casts WHERE mode = 'fixture'").run();
  const rows = relayedRows(1130, { statusOf: (i) => (i === 7 ? "pending" : "relayed"), attributedFid: (i) => (i % 100 === 3 ? 7_000_123 : null) });
  const relayed = rows.filter((r) => r.status === "relayed");
  const all = await pageAll("");
  assert.equal(all.pages, 3, "1,129 rows did not take three pages of 500");
  assert.equal(all.seen.length, relayed.length, "the complete read lost or repeated rows");
  assert.equal(new Set(all.seen.map((c) => c.castHash)).size, relayed.length);
  assert.ok(all.seen.some((c) => c.castHash === rows[0].castHash), "the OLDEST row is missing — the read is not complete");
  assert.ok(!all.seen.some((c) => c.castHash === rows[7].castHash), "a pending row was listed as relayed");
  for (let i = 1; i < all.seen.length; i++) assert.ok(all.seen[i - 1].at >= all.seen[i].at, "not newest first");
  // the page boundaries fell INSIDE an hour (500 and 1000 are not multiples of 7): the tie-break was exercised
  assert.equal(all.seen[499].at, all.seen[500].at, "the test's first page boundary does not split an hour — the cursor's tie-break is untested");
  // the zk.js row shape, nothing more
  assert.deepEqual(Object.keys(all.seen[0]).sort(), ["at", "attributedAt", "attributedBatch", "attributedFid", "attributedSigner", "castHash", "epoch", "fid", "hash", "text", "tree", "treeSize"]);
  // sinceHour: exactly the rows relayed at or after that hour (hours 1000 + floor(i / 11): hour 1100 starts at row 1100)
  const since = await pageAll("&sinceHour=" + (1000 + 100));
  assert.equal(since.seen.length, 30, "sinceHour did not cut at the hour");
  // attributedFid: every row attributed to the account, however old
  const mine = await pageAll("&attributedFid=7000123");
  assert.equal(mine.seen.length, rows.filter((r, i) => i % 100 === 3 && r.status === "relayed").length);
  assert.ok(mine.seen.every((c) => c.attributedFid === 7_000_123));
  assert.ok(mine.seen.some((c) => c.castHash === rows[3].castHash), "an OLD attributed row is missing");
  assert.equal((await api("GET", "/registrar/anon-casts?mode=fixture&before=nonsense")).status, 400);
  assert.equal((await api("GET", "/registrar/anon-casts?mode=fixture&limit=501")).status, 400);
  assert.equal((await api("GET", "/registrar/anon-casts?mode=fixture&attributedFid=-1")).status, 400);
  assert.equal((await api("GET", "/registrar/anon-casts?mode=live")).status, 400, "a live read is refused (fixture only)");
  db.prepare("DELETE FROM zk_anon_casts WHERE mode = 'fixture'").run();
});

test("fix W2-LAUNCH-NO-ADOPTION — the registrations read is NEWEST FIRST and capped at REGISTRATIONS_MAX: a full window drops its OLDEST rows, never the newest", () => {
  reset();
  const ins = db.prepare("INSERT INTO sim_chain_fids (mode, fid, custody, recovery, registered_at, storage_units, batch_id) VALUES ('fixture', ?, ?, ?, ?, 1, 'b')");
  const n = registrar.REGISTRATIONS_MAX + 25;
  db.exec("BEGIN");
  for (let i = 0; i < n; i++) ins.run(simchain.SIM_FID_BASE + 1 + i, "0x" + (i + 1).toString(16).padStart(40, "0"), "0x" + (i + 1).toString(16).padStart(40, "f"), (2000 + i) * HOUR);
  db.exec("COMMIT");
  const regs = registrar.registrations(db, "fixture", 0);
  assert.equal(regs.length, registrar.REGISTRATIONS_MAX);
  assert.equal(regs[0].fid, simchain.SIM_FID_BASE + n, "the NEWEST registration is not first (a busy window would hide it)");
  assert.ok(!regs.some((r) => r.fid === simchain.SIM_FID_BASE + 1), "the oldest row should be the one dropped");
  reset();
});

test("fix W2-LAUNCH-REVEAL-200 — the batch reveal names EVERY post without a relayed row (still all or nothing); 1,500 posts go in one batch inside the 256 KiB body limit, 1,501 are refused", async () => {
  reset();
  db.prepare("DELETE FROM zk_anon_casts WHERE mode = 'fixture'").run();
  const p = await makePersona();
  const request = await buildRequest(p);
  registrar.enqueueLaunch(db, "fixture", request, registrar.launchCommitOf(request), 1);
  registrar.advanceClock(db, "fixture", 48 * HOUR);
  registrar.runDueBatches(db, "fixture");
  const fid = simchain.fidOfCustody(db, "fixture", p.custody);
  const sign = (hs) => cryptoSign(null, Buffer.from(registrar.revealBatchCanonical("fixture", fid, p.signer.pubHex, hs), "utf8"), p.signer.privateKey).toString("hex");
  const rows = relayedRows(3, { statusOf: (i) => (i === 0 ? "relayed" : "pending") });
  const missing = randomBytes(32).toString("hex");
  const items = [...rows, { castHash: missing, secret: randomBytes(32).toString("hex") }];
  const hs = items.map((x) => x.castHash);
  const r = registrar.revealBatch(db, { batch: true, mode: "fixture", fid, signerPubKey: p.signer.pubHex, castHashes: hs, secrets: items.map((x) => x.secret), signature: sign(hs) });
  assert.equal(r.status, 404);
  assert.deepEqual([...r.json.notRelayed].sort(), [rows[1].castHash, rows[2].castHash, missing].sort(), "the refusal does not name every post without a relayed row");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM zk_anon_casts WHERE attributed_fid IS NOT NULL").get().n, 0, "a refused batch wrote something");
  // the batch-size bound: MAX_BATCH_ITEMS is 1,500 and fits the validator's body limit; one more is refused
  assert.equal(registrar.MAX_BATCH_ITEMS, 1500);
  db.prepare("DELETE FROM zk_anon_casts WHERE mode = 'fixture'").run();
  const big = relayedRows(1501);
  const body = (list) => ({ batch: true, mode: "fixture", fid, signerPubKey: p.signer.pubHex, castHashes: list.map((x) => x.castHash), secrets: list.map((x) => x.secret), signature: sign(list.map((x) => x.castHash)) });
  const over = registrar.revealBatch(db, body(big));
  assert.equal(over.status, 400);
  assert.match(over.json.error, /1 to 1500/);
  const full = body(big.slice(0, 1500));
  const bytes = Buffer.byteLength(JSON.stringify(full));
  assert.ok(bytes < 262144, "1,500 items do not fit the 256 KiB body limit (" + bytes + " bytes)");
  const ok = registrar.revealBatch(db, full);
  assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 200));
  assert.equal(ok.json.revealed, 1500);
  db.prepare("DELETE FROM zk_anon_casts WHERE mode = 'fixture'").run();
  reset();
});

test("dev hooks: refused without ZK_DEV_HOOKS; reset forgets every fixture row", async () => {
  const app = express();
  app.use(express.json());
  registrar.mountRegistrar(app, db, { devHooks: false });
  const s = await new Promise((resolve) => {
    const x = app.listen(0, () => resolve(x));
  });
  try {
    const r = await fetch("http://127.0.0.1:" + s.address().port + "/registrar/dev/advance-clock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ms: 1000 }) });
    assert.equal(r.status, 403);
  } finally {
    s.close();
  }
  const reset1 = await api("POST", "/registrar/dev/reset", { mode: "fixture" });
  assert.equal(reset1.status, 200);
  for (const t of ["launch_queue", "registrar_spend", "zk_reveal_batches", "sim_chain_fids", "sim_chain_keys", "sim_chain_fnames"]) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE mode = 'fixture'`).get().n, 0, t);
  assert.equal((await api("POST", "/registrar/dev/reset", { mode: "live" })).status, 400);
});
