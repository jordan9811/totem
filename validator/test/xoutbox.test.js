"use strict";
// PERSONA LAUNCH P8 — THE @totem X OUTBOX on the REAL validator (validator/server.js createApp over a temp database,
// listening on an ephemeral port — never a pinned one): x-anon-post envelopes through the dev door (/zk/submit, the same
// verifyAndRecord the anonymous channel calls), the moderation queue, the relay through the FIXTURE transport, the caps,
// the resets. No network: nothing here opens a socket but the loopback test server, and the outbox has no live transport.
//
// Every guard is shown refusing a NEAR MISS of an input it accepts (the near miss is otherwise identical), and every
// refusal that must consume nothing is followed by the honest envelope being ACCEPTED (so "nothing consumed" is proved,
// not assumed).
process.env.ZK_DEV_HOOKS = "true";
process.env.ZK_ANON_POST_TREE = "valid";
for (const k of ["X_OUTBOX_MODERATORS", "X_OUTBOX_DAILY_CAP", "ZK_X_ANON_POST_SLOTS", "X_OUTBOX_RELAY_SPREAD_MS", "X_OUTBOX_RELAY_INTERVAL_MS", "LAYERS_REQUIRE_SIG", "ZK_ANON_REACH_ISSUERS"]) delete process.env[k];

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { generateKeyPairSync, sign: cryptoSign, randomBytes, createHash } = require("node:crypto");
const { createApp } = require("../server");
const zk = require("../zk");
const xo = require("../xoutbox");
const { MIGRATIONS, migrateDown } = require("../migrations");

let dir;
let app;
let db;
let server;
let base;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "layers-xoutbox-test-"));
  ({ app, db } = createApp(path.join(dir, "v.db")));
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = "http://127.0.0.1:" + server.address().port;
  await api("POST", "/zk/dev/seed-decoys", { mode: "fixture", count: 5 });
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
});
after(() => {
  server.close();
  try {
    db.close();
  } catch {
    /* closed */
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

async function api(method, p, body) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const HOUR = 3_600_000;
const hourNow = () => Math.floor(Date.now() / HOUR);
function edKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
}
const signHex = (canonical, k) => cryptoSign(null, Buffer.from(canonical, "utf8"), k.privateKey).toString("hex");
// PERSONA LAUNCH wave 3 (W3-X-MOD-SAME-HOUR): moderate/2 signs a fresh 32-hex nonce into every decision
const moderateBody = (k, id, decision, issuedHour = hourNow(), nonce = randomBytes(16).toString("hex")) => ({ mode: "fixture", id, decision, issuedHour, nonce, pubkey: k.pubHex, sig: signHex(["layers-x-moderate/2", "fixture", id, decision, String(issuedHour), nonce].join("|"), k) });

async function plainTree() {
  const m = await api("GET", "/zk/members?mode=fixture&tree=valid");
  assert.equal(m.status, 200, "members: " + JSON.stringify(m.json));
  return { epoch: m.json.epoch, root: m.json.root };
}
/** an x-anon-post envelope exactly as lib/zk/prove.ts builds it (the scope string written out by hand — the slot refusal
 *  needs a scope the validator's own scopeString would refuse to build) */
function xEnvelope(o) {
  const nonce = o.nonce ?? randomBytes(16).toString("hex");
  const xHash = o.xHash ?? zk.xAnonHash(o.text, nonce);
  const slot = o.slot ?? 0;
  const scopeStr = `layers/zk-scope/v1|x-anon-post/${zk.anonPostWindowOf(o.epoch)}/s${slot}`;
  const scope = zk.fieldOf("scope", scopeStr);
  const challenge = "epoch-" + o.epoch;
  const message = zk.fieldOf("message", ["anon", "x-anon-post", "x:" + xHash, challenge, o.root].join("|"));
  const pub = { mode: o.mode ?? "fixture", claimKind: "x-anon-post", tree: o.tree ?? "valid", epoch: o.epoch, merkleTreeRoot: o.root, scope, message, personaId: "anon", gateId: "x-anon-post", challenge, xHash, slot, ...(o.extraPub || {}) };
  // a person's nullifier at a scope: deterministic per (scope, person) — what the circuit gives (fixture: not checked)
  const nullifier = zk.fieldOf("test-nullifier", scopeStr + "|" + (o.person ?? "person-a"));
  const tag = zk.fixtureTag(zk.canonicalPublicInputs(pub), nullifier);
  return { v: 1, mode: pub.mode, claimKind: "x-anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag }, payload: { text: o.text, nonce, ...(o.extraPayload || {}) } };
}
const submit = (env) => api("POST", "/zk/submit", { envelope: env });
const list = async () => (await api("GET", "/x/outbox?mode=fixture")).json.items;
const transportLog = async () => (await api("GET", "/x/outbox/dev/transport-log?mode=fixture")).json.entries;
const relayNow = () => api("POST", "/x/outbox/dev/relay-now", { mode: "fixture" });
const reset = async () => {
  const r = await api("POST", "/zk/dev/reset", { mode: "fixture" });
  assert.equal(r.status, 200, "reset: " + JSON.stringify(r.json));
  await api("POST", "/zk/dev/seed-decoys", { mode: "fixture", count: 5 });
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
};
let person = 0;
const nextPerson = () => "person-" + ++person;

test("migration 26 'x_anon_outbox': the four tables exist; no persona, root, nullifier, slot, device or cast column anywhere; every time column is an hour (or the hour-grained due slot)", () => {
  const m = MIGRATIONS.find((x) => x.version === 26);
  assert.ok(m && m.name === "x_anon_outbox" && typeof m.down === "function", "migration 26 x_anon_outbox (with a down) is not appended");
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.deepEqual(cols("x_outbox").sort(), ["attempts", "created_hour", "decided_hour", "due_at", "id", "kind", "mode", "posted_hour", "posted_id", "status", "text", "url"]);
  assert.deepEqual(cols("x_outbox_decisions").sort(), ["decided_hour", "decision", "id", "mode", "moderator_pubkey", "signature"]);
  assert.deepEqual(cols("x_outbox_moderators").sort(), ["added_hour", "mode", "pubkey"]);
  assert.deepEqual(cols("x_fixture_posts").sort(), ["mode", "posted_hour", "posted_id", "text"]);
  for (const t of ["x_outbox", "x_outbox_decisions", "x_outbox_moderators", "x_fixture_posts"]) for (const c of cols(t)) assert.ok(!/persona|root|nullifier|slot|device|cast|epoch|anchor/.test(c), `${t}.${c} names something the outbox must never hold`);
});

test("THE FLOW: an X copy lands as 'review' with no text in the public list; relay-now posts NOTHING without a moderator's approval; a registered moderator approves → relay-now → posted through the fixture transport (one log entry, destination fixture, posted id xfix_…); the text is public only then; a posted row can never be decided again", async () => {
  await reset();
  const { epoch, root } = await plainTree();
  const text = "a short thought for the outbox " + randomBytes(3).toString("hex");
  const env = xEnvelope({ text, epoch, root, person: nextPerson() });
  const r = await submit(env);
  assert.equal(r.status, 200, "submit: " + JSON.stringify(r.json));
  const id = env.publicInputs.xHash;
  let row = (await list()).find((x) => x.id === id);
  assert.ok(row, "the copy is not in the public list");
  assert.deepEqual({ ...row, hour: typeof row.hour }, { id, status: "review", hour: "number", postedId: null, text: null });
  assert.equal(row.hour % HOUR, 0, "the listed hour is not hour-grained");
  // no moderator: nothing is ever approved; relay-now twice posts nothing
  for (let i = 0; i < 2; i++) assert.equal((await relayNow()).json.posted, 0, "relay-now posted an unapproved row");
  assert.equal((await transportLog()).length, 0, "the fixture transport logged a post nobody approved");
  const k = edKey();
  const none = await api("POST", "/x/outbox/moderate", moderateBody(k, id, "approve"));
  assert.equal(none.status, 403);
  assert.match(none.json.error, /no moderator is set up/);
  // a registered moderator: the near misses first
  assert.equal((await api("POST", "/x/outbox/dev/moderator", { mode: "fixture", pubkey: k.pubHex })).status, 201);
  const stranger = edKey();
  assert.equal((await api("POST", "/x/outbox/moderate", moderateBody(stranger, id, "approve"))).status, 403, "an unregistered key's decision was taken");
  const forged = moderateBody(k, id, "approve");
  forged.sig = forged.sig.slice(0, -2) + (forged.sig.slice(-2) === "00" ? "01" : "00");
  assert.equal((await api("POST", "/x/outbox/moderate", forged)).status, 403, "a forged signature was taken");
  const otherId = moderateBody(k, "f".repeat(64), "approve");
  assert.equal((await api("POST", "/x/outbox/moderate", { ...otherId, id })).status, 403, "a signature for another id was taken");
  assert.equal((await api("POST", "/x/outbox/moderate", moderateBody(k, id, "approve", hourNow() - 5))).status, 400, "a stale hour was taken");
  assert.equal((await api("POST", "/x/outbox/moderate", { ...moderateBody(k, id, "approve"), mode: "live" })).status, 400, "a live decision was taken");
  row = (await list()).find((x) => x.id === id);
  assert.equal(row.status, "review", "a refused decision moved the row");
  // the honest decision
  const approve = moderateBody(k, id, "approve");
  const ok = await api("POST", "/x/outbox/moderate", approve);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await list()).find((x) => x.id === id).status, "approved");
  // the replay of the very same signed decision (the same bytes) is refused
  assert.equal((await api("POST", "/x/outbox/moderate", approve)).status, 409, "a replayed signed decision was taken");
  const rel = await relayNow();
  // (the outbox's own hourly slot could take it a moment earlier at a top of the hour: the transport log is the record)
  assert.ok(rel.json.posted <= 1, JSON.stringify(rel.json));
  assert.equal(rel.json.destination, "fixture");
  const log = await transportLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].destination, "fixture");
  assert.match(log[0].postedId, /^xfix_[0-9a-f]{24}$/);
  assert.equal(log[0].text, text);
  row = (await list()).find((x) => x.id === id);
  assert.equal(row.status, "posted");
  assert.equal(row.text, text, "the text is not public once posted");
  assert.equal(row.postedId, log[0].postedId);
  // posted is final
  assert.equal((await api("POST", "/x/outbox/moderate", moderateBody(k, id, "reject"))).status, 409, "a posted row was decided again");
  assert.equal((await relayNow()).json.posted, 0, "a posted row went out twice");
});

test("REJECT: a not-approved copy never posts, its row is KEPT (hide, never delete) and its text is never shown but to the moderator; the moderator's signed review read lists it as not approved (UXH-7: it may still be approved), and an unsigned or stranger's read is refused; re-decided in the same hour (W3-X-MOD-SAME-HOUR) approve then reject again both land and the row ends rejected", async () => {
  await reset();
  const { epoch, root } = await plainTree();
  const k = edKey();
  await api("POST", "/x/outbox/dev/moderator", { mode: "fixture", pubkey: k.pubHex });
  const text = "this one will not go out " + randomBytes(3).toString("hex");
  const env = xEnvelope({ text, epoch, root, person: nextPerson() });
  assert.equal((await submit(env)).status, 200);
  const id = env.publicInputs.xHash;
  const reviewQ = (key, h = hourNow()) => `/x/outbox/review?mode=fixture&issuedHour=${h}&pubkey=${key.pubHex}&sig=${signHex(["layers-x-review/1", "fixture", String(h), key.pubHex].join("|"), key)}`;
  const rv = await api("GET", reviewQ(k));
  assert.equal(rv.status, 200, JSON.stringify(rv.json));
  assert.deepEqual(rv.json.items.map((x) => [x.id, x.text]), [[id, text]]);
  assert.equal((await api("GET", reviewQ(edKey()))).status, 403, "a stranger read the review queue");
  assert.equal((await api("GET", "/x/outbox/review?mode=fixture&issuedHour=" + hourNow() + "&pubkey=" + k.pubHex + "&sig=" + "0".repeat(128))).status, 403, "an unsigned review read was answered");
  assert.equal((await api("POST", "/x/outbox/moderate", moderateBody(k, id, "reject"))).status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await relayNow()).json.posted, 0, "a rejected row was posted");
  assert.equal((await transportLog()).length, 0);
  const row = (await list()).find((x) => x.id === id);
  assert.deepEqual({ status: row.status, text: row.text, postedId: row.postedId }, { status: "rejected", text: null, postedId: null });
  const kept = db.prepare("SELECT status, text FROM x_outbox WHERE mode = 'fixture' AND id = ?").get(id);
  assert.equal(kept.status, "rejected", "the rejected row was deleted");
  assert.equal(kept.text, text);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM x_outbox_decisions WHERE id = ?").get(id).n, 1, "the decision was not kept signed");
  // UXH-7: the moderator still sees it — as NOT APPROVED, re-decidable — and nobody else does (the public list: text null)
  const rv2 = await api("GET", reviewQ(k));
  assert.deepEqual(rv2.json.items.map((x) => [x.id, x.status]), [[id, "rejected"]], "the rejected row is not in the moderator's review list as rejected");
  // W3-X-MOD-SAME-HOUR: approve, then not approve again, all inside the same hour — every decision is its own signature
  const ap = await api("POST", "/x/outbox/moderate", moderateBody(k, id, "approve"));
  assert.equal(ap.status, 200, "approving a rejected row in the same hour: " + JSON.stringify(ap.json));
  const rj = await api("POST", "/x/outbox/moderate", moderateBody(k, id, "reject"));
  assert.equal(rj.status, 200, "the corrective reject in the same hour was refused (a replay of the first?): " + JSON.stringify(rj.json));
  assert.equal(db.prepare("SELECT status FROM x_outbox WHERE mode = 'fixture' AND id = ?").get(id).status, "rejected");
  assert.equal(db.prepare("SELECT COUNT(DISTINCT signature) AS n FROM x_outbox_decisions WHERE id = ?").get(id).n, 3, "three decisions, three signatures");
  for (let i = 0; i < 2; i++) assert.equal((await relayNow()).json.posted, 0, "the re-rejected row was posted");
  // a decision with no nonce is refused before its signature is read
  const { nonce: _n, ...bare } = moderateBody(k, id, "approve");
  assert.equal((await api("POST", "/x/outbox/moderate", bare)).status, 400, "a decision without its nonce was taken");
});

test("THE VALIDATOR'S REFUSALS consume nothing: live (503 'not built'), a reach tree, an extra payload key, a tampered text, a slot ≥ K_X, castHash/noteHash/attributionCommitment on an X copy, xHash on an anon post, the text policy (two links, an @mention, > 280, a paragraph break, a bare link) — then the honest envelope with the same nullifier is ACCEPTED", async () => {
  await reset();
  const { epoch, root } = await plainTree();
  const who = nextPerson();
  const good = "the honest copy " + randomBytes(3).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  const cases = [
    ["live", xEnvelope({ text: good, nonce, epoch, root, person: who, mode: "live" }), 400],
    ["reach tree", xEnvelope({ text: good, nonce, epoch, root, person: who, tree: "attest:fc.reach/gte-10k" }), 400],
    ["extra payload key", xEnvelope({ text: good, nonce, epoch, root, person: who, extraPayload: { note: "e".repeat(512) } }), 400],
    ["tampered text", (() => { const e = xEnvelope({ text: good, nonce, epoch, root, person: who }); e.payload.text = good + "!"; return e; })(), 400],
    ["slot 1 (K_X = 1)", xEnvelope({ text: good, nonce, epoch, root, person: who, slot: 1 }), 400],
    ["castHash on an X copy", xEnvelope({ text: good, nonce, epoch, root, person: who, extraPub: { castHash: "a".repeat(64) } }), 400],
    ["noteHash on an X copy", xEnvelope({ text: good, nonce, epoch, root, person: who, extraPub: { noteHash: "a".repeat(64) } }), 400],
    ["attributionCommitment on an X copy", xEnvelope({ text: good, nonce, epoch, root, person: who, extraPub: { attributionCommitment: "a".repeat(64) } }), 400],
    ["two links", xEnvelope({ text: "look https://a.example.org and https://b.example.org", epoch, root, person: who }), 400],
    ["an @mention", xEnvelope({ text: "hey @someone look", epoch, root, person: who }), 400],
    ["over 280", xEnvelope({ text: "y".repeat(281), epoch, root, person: who }), 400],
    ["a paragraph break (a pasted article)", xEnvelope({ text: "first part\n\nsecond part", epoch, root, person: who }), 400],
    ["a bare link", xEnvelope({ text: "see example.org for more", epoch, root, person: who }), 400],
  ];
  for (const [name, env, code] of cases) {
    const r = await submit(env);
    // live is refused 503 BEFORE anything; its envelope's universe is live, so the dev door answers on the binding first
    if (name === "live") assert.ok(r.status === 503 || r.status === 400, `${name}: ${r.status} ${JSON.stringify(r.json)}`);
    else assert.equal(r.status, code, `${name}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  // the live refusal says "not built" and comes before any binding: a live envelope that would otherwise bind is a 503
  const liveEnv = xEnvelope({ text: good, nonce, epoch, root, person: who, mode: "live" });
  const live = await submit(liveEnv);
  assert.equal(live.status, 503, JSON.stringify(live.json));
  assert.match(live.json.error, /not built/);
  // xHash on an ANON post is refused (shape before binding)
  // (a well-formed anon post in every other respect, so the xHash check is the one that answers)
  const aText = "an anon post";
  const aNonce = "e".repeat(32);
  const aNote = "f".repeat(512);
  const castHash = createHash("sha256").update("layers-anon-cast/1|" + aNonce + "|" + aText, "utf8").digest("hex");
  const noteHash = createHash("sha256").update(Buffer.from(aNote, "hex")).digest("hex");
  const anonEnv = { v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: { mode: "fixture", claimKind: "anon-post", tree: "valid", epoch, merkleTreeRoot: root, scope: "1", message: "1", personaId: "anon", gateId: "anon-post", challenge: "epoch-" + epoch, castHash, attributionCommitment: "b".repeat(64), slot: 0, noteHash, xHash: "d".repeat(64) }, nullifier: "5", proof: { scheme: "layers-zk-fixture/1", tag: "x" }, payload: { text: aText, nonce: aNonce, note: aNote } };
  const ax = await submit(anonEnv);
  assert.equal(ax.status, 400);
  assert.match(ax.json.error, /xHash is only valid on an x-anon-post claim/);
  // nothing above consumed the honest envelope's nullifier: it is accepted now
  const honest = await submit(xEnvelope({ text: good, nonce, epoch, root, person: who }));
  assert.equal(honest.status, 200, "the honest envelope was refused after the near misses — something was consumed: " + JSON.stringify(honest.json));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM x_outbox WHERE mode = 'fixture'").get().n, 1, "a refused envelope left a row");
});

test("ONE X SLOT PER PERSON PER WINDOW (K_X = 1): a second copy from the same person in the window re-emits the slot's nullifier — a 409 replay that adds no row; another person's copy goes; the X nullifier differs from the same person's anon-post nullifier at the same (window, slot)", async () => {
  await reset();
  const { epoch, root } = await plainTree();
  const who = nextPerson();
  const a = xEnvelope({ text: "first copy " + randomBytes(3).toString("hex"), epoch, root, person: who });
  assert.equal((await submit(a)).status, 200);
  const b = xEnvelope({ text: "second copy " + randomBytes(3).toString("hex"), epoch, root, person: who });
  const rb = await submit(b);
  assert.equal(rb.status, 409, JSON.stringify(rb.json));
  assert.match(rb.json.error, /replay/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM x_outbox WHERE mode = 'fixture'").get().n, 1, "the replay left a row");
  const c = xEnvelope({ text: "someone else " + randomBytes(3).toString("hex"), epoch, root, person: nextPerson() });
  assert.equal((await submit(c)).status, 200, "another person's copy was refused");
  // the scopes: x-anon-post/w<n>/s0 vs anon-post/w<n>/s0 — two features, two scope values, two nullifiers for one secret
  const xs = zk.fieldOf("scope", zk.scopeString({ feature: "x-anon-post", onePerHuman: true }, epoch, undefined, zk.xSlotQualifier(epoch, 0)));
  const as = zk.fieldOf("scope", zk.scopeString({ feature: "anon-post", onePerHuman: true }, epoch, undefined, zk.anonSlotQualifier(epoch, 0)));
  assert.notEqual(xs, as, "an X slot's scope equals an anon-post slot's");
  assert.equal(xs, a.publicInputs.scope, "the envelope's scope is not the validator's own x-anon-post scope");
});

test("DUPLICATES and THE DAILY CAP: the same words again (another person, another nonce) are a 400 refusal — never a 409, which the anonymous channel reports as a replay that holds the X slot (W3-X-DUP-AS-REPLAY) — and consume nothing; past X_OUTBOX_DAILY_CAP a submission is a 503 that consumes nothing (the same envelope is accepted once the cap is raised); the relay posts at most the cap a day", async () => {
  await reset();
  const { epoch, root } = await plainTree();
  const words = "words worth sending once " + randomBytes(3).toString("hex");
  assert.equal((await submit(xEnvelope({ text: words, epoch, root, person: nextPerson() }))).status, 200);
  const dupPerson = nextPerson();
  const dup = await submit(xEnvelope({ text: "  " + words.toUpperCase() + " ", epoch, root, person: dupPerson }));
  assert.equal(dup.status, 400, JSON.stringify(dup.json));
  assert.match(dup.json.error, /already went to the X outbox/);
  // the duplicate consumed nothing: the same person sends other words in the same slot
  assert.equal((await submit(xEnvelope({ text: "other words " + randomBytes(3).toString("hex"), epoch, root, person: dupPerson }))).status, 200, "the duplicate's refusal consumed its nullifier");
  // the cap: two rows today; a cap of 2 refuses the third
  process.env.X_OUTBOX_DAILY_CAP = "2";
  try {
    const capped = xEnvelope({ text: "past the cap " + randomBytes(3).toString("hex"), epoch, root, person: nextPerson() });
    const rc = await submit(capped);
    assert.equal(rc.status, 503, JSON.stringify(rc.json));
    assert.match(rc.json.error, /today's posts/);
    const cfg = (await api("GET", "/x/outbox/config?mode=fixture")).json;
    assert.deepEqual([cfg.dailyCap, cfg.dailyUsed, cfg.xSlotsPerWindow, cfg.transport, cfg.live, cfg.testData], [2, 2, 1, "fixture", false, true]);
    process.env.X_OUTBOX_DAILY_CAP = "50";
    assert.equal((await submit(capped)).status, 200, "the capped envelope's nullifier was consumed");
    // the relay's cap: approve all three, a cap of 1 posts one
    const k = edKey();
    await api("POST", "/x/outbox/dev/moderator", { mode: "fixture", pubkey: k.pubHex });
    for (const r of await list()) assert.equal((await api("POST", "/x/outbox/moderate", moderateBody(k, r.id, "approve"))).status, 200);
    process.env.X_OUTBOX_DAILY_CAP = "1";
    const rel = await relayNow();
    assert.ok(rel.json.posted <= 1 && rel.json.capped === 2, JSON.stringify(rel.json));
    assert.equal((await transportLog()).length, 1);
  } finally {
    delete process.env.X_OUTBOX_DAILY_CAP;
  }
});

test("RESETS: /zk/dev/reset and the seed reset (DELETE /state) wipe the fixture outbox — rows, decisions, dev moderators, fixture posts; dev routes refuse a live universe", async () => {
  await reset();
  const { epoch, root } = await plainTree();
  const k = edKey();
  await api("POST", "/x/outbox/dev/moderator", { mode: "fixture", pubkey: k.pubHex });
  const env = xEnvelope({ text: "to be wiped " + randomBytes(3).toString("hex"), epoch, root, person: nextPerson() });
  await submit(env);
  await api("POST", "/x/outbox/moderate", moderateBody(k, env.publicInputs.xHash, "approve"));
  await relayNow();
  const count = () => ["x_outbox", "x_outbox_decisions", "x_outbox_moderators", "x_fixture_posts"].map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE mode = 'fixture'`).get().n);
  assert.deepEqual(count(), [1, 1, 1, 1], "setup: the four tables did not fill");
  assert.equal((await api("POST", "/zk/dev/reset", { mode: "fixture" })).status, 200);
  assert.deepEqual(count(), [0, 0, 0, 0], "/zk/dev/reset left X rows");
  // again through the seed reset
  await api("POST", "/zk/dev/seed-decoys", { mode: "fixture", count: 5 });
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  const t2 = await plainTree();
  await api("POST", "/x/outbox/dev/moderator", { mode: "fixture", pubkey: k.pubHex });
  await submit(xEnvelope({ text: "to be wiped again " + randomBytes(3).toString("hex"), epoch: t2.epoch, root: t2.root, person: nextPerson() }));
  assert.ok(count()[0] === 1 && count()[2] === 1, "setup 2");
  assert.equal((await api("DELETE", "/state")).status, 200);
  assert.deepEqual(count(), [0, 0, 0, 0], "the seed reset left X rows");
  for (const p of ["/x/outbox?mode=live", "/x/outbox/config?mode=live", "/x/outbox/dev/transport-log?mode=live"]) assert.equal((await api("GET", p)).status, 400, p + " answered for live");
  assert.equal((await api("POST", "/x/outbox/dev/relay-now", { mode: "live" })).status, 400);
});

test("migration 26 rolls back and re-applies on a copy of this database: down drops exactly its tables (the rest intact), up again is a no-op the second time", () => {
  const { openDb } = require("../db");
  const copy = path.join(dir, "copy.db");
  db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  const c = openDb(copy);
  try {
    const tables = () => c.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name).sort();
    const before = tables();
    for (const t of ["x_outbox", "x_outbox_decisions", "x_outbox_moderators", "x_fixture_posts"]) assert.ok(before.includes(t));
    migrateDown(c, 26);
    const down = tables();
    assert.deepEqual(down, before.filter((t) => !t.startsWith("x_outbox") && t !== "x_fixture_posts"), "down did not drop exactly migration 26's tables");
    // the runner re-applies 26 when its version row is gone, and the second run is a no-op
    c.prepare("DELETE FROM schema_version WHERE version = 26").run();
    const { migrate } = require("../migrations");
    assert.equal(migrate(c).ran, 1);
    assert.deepEqual(tables(), before);
    assert.equal(migrate(c).ran, 0);
    // idempotent up over existing tables (a crash between the up and its version row): no throw, nothing duplicated
    c.prepare("DELETE FROM schema_version WHERE version = 26").run();
    assert.equal(migrate(c).ran, 1);
  } finally {
    c.close();
  }
  assert.ok(createHash("sha256"), "node:crypto present");
});
