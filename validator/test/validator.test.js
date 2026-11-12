"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server");

let server;
let base;
let db;

before(async () => {
  const { app, db: d } = createApp(":memory:");
  db = d;
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = "http://127.0.0.1:" + server.address().port;
});

after(() => server.close());

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function makeRoot(fid) {
  const r = await api("POST", "/roots", { fid, signerUuid: "signer-" + fid });
  assert.equal(r.status, 201);
  return r.json.rootId;
}

// ZK PASS 2 Gate 2: creation takes NO rootId (the validator does not hold
// persona → root); the test keeps its own grouping — as a device would.
const rootsOf = new Map();
async function makePersona(rootId, name, handle) {
  const r = await api("POST", "/personas", { name, handle });
  assert.equal(r.status, 201);
  rootsOf.set(r.json.persona.id, rootId);
  assert.equal("rootId" in r.json.persona, false);
  return r.json.persona;
}

test("root registration is idempotent on signerUuid", async () => {
  const a = await api("POST", "/roots", { fid: 11, signerUuid: "sig-11" });
  assert.equal(a.status, 201);
  const b = await api("POST", "/roots", { fid: 11, signerUuid: "sig-11" });
  assert.equal(b.status, 200);
  assert.equal(a.json.rootId, b.json.rootId);
});

test("rep accrual math: weighted sum, sourceId dedupe", async () => {
  const rootId = await makeRoot(21);
  // cast=1, reply=2, like=2, recast=3, follow=5
  await api("POST", "/events", { rootId, type: "cast_created", count: 3, sourceId: "c1" });
  await api("POST", "/events", { rootId, type: "like_received", count: 5, sourceId: "l1" });
  await api("POST", "/events", { rootId, type: "recast_received", count: 2, sourceId: "r1" });
  await api("POST", "/events", { rootId, type: "reply_received", count: 4, sourceId: "p1" });
  const last = await api("POST", "/events", { rootId, type: "follow_gained", count: 2, sourceId: "f1" });
  // 3*1 + 5*2 + 2*3 + 4*2 + 2*5 = 3 + 10 + 6 + 8 + 10 = 37
  assert.equal(last.json.score, 37);
  // duplicate sourceId is a no-op
  const dup = await api("POST", "/events", { rootId, type: "follow_gained", count: 2, sourceId: "f1" });
  assert.equal(dup.json.score, 37);
  // null sourceId events always append
  const extra = await api("POST", "/events", { rootId, type: "cast_created", count: 1 });
  assert.equal(extra.json.score, 38);
});

test("percentile tier assignment across deciles, ties resolve upward", async () => {
  // Fresh app so population is exactly what we create here.
  const { app } = createApp(":memory:");
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const b = "http://127.0.0.1:" + srv.address().port;
  const call = async (method, path, body) => {
    const res = await fetch(b + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  const roots = [];
  for (let i = 0; i < 10; i++) {
    const r = await call("POST", "/roots", { fid: 100 + i, signerUuid: "tier-" + i });
    roots.push(r.json.rootId);
    // score = (i+1) * 2 via like_received count i+1 (weight 2): strictly increasing
    await call("POST", "/events", { rootId: r.json.rootId, type: "like_received", count: i + 1, sourceId: "s" + i });
  }
  for (let i = 0; i < 10; i++) {
    const t = await call("GET", "/rep/root/" + roots[i] + "/tier");
    assert.equal(t.json.tier, i + 1, "root " + i + " should be tier " + (i + 1));
  }
  // Tie at the top: an 11th root matching the max score joins tier 10 and
  // pulls the previous max up with it (ties resolve upward).
  const r11 = await call("POST", "/roots", { fid: 200, signerUuid: "tier-11" });
  await call("POST", "/events", { rootId: r11.json.rootId, type: "like_received", count: 10, sourceId: "s11" });
  const t11 = await call("GET", "/rep/root/" + r11.json.rootId + "/tier");
  const t10 = await call("GET", "/rep/root/" + roots[9] + "/tier");
  assert.equal(t11.json.tier, 10);
  assert.equal(t10.json.tier, 10);
  srv.close();
});

test("tier by persona is GONE (006): /rep/:personaId is 410; tier is asked by root handle; nothing in the schema links a persona to a root", async () => {
  const rootId = await makeRoot(31);
  const p1 = await makePersona(rootId, "Main", "main31");
  await makePersona(rootId, "Alt", "alt31");
  assert.equal((await api("GET", "/rep/" + p1.id)).status, 410);
  const tr = await api("GET", "/rep/root/" + rootId + "/tier");
  assert.equal(typeof tr.json.tier, "number");
  const cols = db.prepare("PRAGMA table_info(personas)").all().map((c) => c.name);
  assert.equal(cols.includes("root_id"), false);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blocks'").get(), undefined);
  assert.equal((await api("GET", "/personas/root/" + rootId)).status, 410);
  assert.equal((await api("GET", "/personas/by-fid/31")).status, 410);
  assert.equal((await api("POST", "/personas", { rootId, name: "X", handle: "x31" })).status, 400);
  assert.equal((await api("GET", "/personas/" + p1.id)).json.persona.rootId, undefined);
});

test("blocks are PERSONA-LEVEL (006): no root fan-out on either end, idempotent, named on the wire", async () => {
  const rootA = await makeRoot(41);
  const rootB = await makeRoot(42);
  const a1 = await makePersona(rootA, "A One", "a1_41");
  const a2 = await makePersona(rootA, "A Two", "a2_41");
  const b1 = await makePersona(rootB, "B One", "b1_42");
  const b2 = await makePersona(rootB, "B Two", "b2_42");

  const blk = await api("POST", "/block", { blockerPersona: a1.id, blockedPersona: b1.id });
  assert.equal(blk.status, 201);
  assert.equal(blk.json.fanout, "persona-level only");
  // only a1 blocked, and only b1
  assert.deepEqual((await api("GET", "/blocked/" + a1.id)).json.personaIds, [b1.id]);
  assert.deepEqual((await api("GET", "/blocked/" + a2.id)).json.personaIds, []);
  // b2 — a sibling the validator cannot know about — is untouched; a
  // persona created after the block is not covered either
  const b3 = await makePersona(rootB, "B Three", "b3_42");
  const ids = (await api("GET", "/blocked/" + a1.id)).json.personaIds;
  assert.equal(ids.includes(b2.id), false);
  assert.equal(ids.includes(b3.id), false);
  // idempotent
  assert.equal((await api("POST", "/block", { blockerPersona: a1.id, blockedPersona: b1.id })).status, 201);
  assert.equal((await api("GET", "/blocked/" + a1.id)).json.personaIds.length, 1);
  // MULTI-FID Gate 3 (D-FID-3-BLOCK-TARGET-OPAQUE): the BLOCKER must be a persona the validator holds;
  // the TARGET is an opaque id — a persona this client minted registers nowhere here — so an unknown
  // target is accepted as a read-time filter entry, a malformed one refused, an unknown blocker refused
  assert.equal((await api("POST", "/block", { blockerPersona: a1.id, blockedPersona: "persona_nope" })).status, 201);
  assert.equal((await api("GET", "/blocked/" + a1.id)).json.personaIds.includes("persona_nope"), true);
  assert.equal((await api("POST", "/block", { blockerPersona: a1.id, blockedPersona: "not a persona id!" })).status, 400);
  assert.equal((await api("POST", "/block", { blockerPersona: "persona_nope", blockedPersona: b1.id })).status, 404);
});

test("validation: duplicate handle 409, bad handle 400, unknown ids 404", async () => {
  const rootId = await makeRoot(51);
  await makePersona(rootId, "Taken", "taken51");
  const dup = await api("POST", "/personas", { name: "Other", handle: "taken51" });
  assert.equal(dup.status, 409);
  const bad = await api("POST", "/personas", { name: "Bad", handle: "way too long and spacey" });
  assert.equal(bad.status, 400);
  const rep410 = await api("GET", "/rep/persona_nope");
  assert.equal(rep410.status, 410);
  const blocked404 = await api("GET", "/blocked/persona_nope");
  assert.equal(blocked404.status, 404);
  const block404 = await api("POST", "/block", { blockerPersona: "persona_nope", blockedPersona: "persona_nope2" });
  assert.equal(block404.status, 404);
});
