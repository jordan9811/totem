"use strict";
// ZK PASS 1 Gate 1 — anonymous channel unit tests, in-memory DB. The
// OHTTP client side is implemented HERE with @hpke/core + the validator's
// own bhttp codec, so the gateway is exercised end to end with no app.
process.env.ZK_DEV_HOOKS = "true";
process.env.ZK_POW_BITS = "8"; // fast in tests; the mechanism is identical
process.env.ZK_ANON_RESPONSE_MS = "60";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHash, hkdfSync, createDecipheriv } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256, Aes128Gcm } = require("@hpke/core");
const { createApp } = require("../server");
const bhttp = require("../bhttp");
const { BODY_BYTES, outerLength } = require("../anon");

let server;
let base;
let db;
before(async () => {
  const created = createApp(":memory:");
  db = created.db;
  await new Promise((resolve) => {
    server = created.app.listen(0, resolve);
  });
  base = "http://127.0.0.1:" + server.address().port;
});
after(() => server.close());

// ---- helpers (deliberate duplicates of the client side) ----
const leadingZeroBits = (buf) => { let n = 0; for (const b of buf) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; } return n; };
function solvePow(bodyBytes, bits) {
  const bodyHash = createHash("sha256").update(bodyBytes).digest("hex");
  for (let i = 0; ; i++) {
    const nonce = i.toString(36);
    if (leadingZeroBits(createHash("sha256").update(bodyHash + "|" + nonce).digest()) >= bits) return nonce;
  }
}
const fixtureTag = (canonical, nullifier) => createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
const canonicalPublicInputs = (p) => ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge].join("|");
// the claim binding the validator re-derives (deliberate duplicates of lib/zk/hash.ts + scopes.ts)
const fieldOf = (domain, canonical) => (BigInt("0x" + createHash("sha256").update(`layers-zk-field/1|${domain}|${canonical}`).digest("hex")) >> 8n).toString(10);
const scopeString = (feature, epoch, personaId) => `layers/zk-scope/v1|${feature}|${epoch}|${personaId}`;

async function jsonApi(method, p, body) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
// A CLEAN client: node:http with explicit headers and no pooling — the same
// path the real client uses. (undici's fetch silently adds user-agent,
// accept-language and sec-fetch-mode, which the allowlist rightly refuses.)
const { request: httpRequest } = require("node:http");
function rawPost(p, bodyBytes, headers) {
  const t0 = Date.now();
  const u = new URL(base + p);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", agent: false, headers: { ...headers, "content-length": String(bodyBytes.length) } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks), ms: Date.now() - t0, ct: res.headers["content-type"] }));
      }
    );
    req.on("error", reject);
    req.end(bodyBytes);
  });
}

async function freshEnvelope(nullifier, personaId = "p_anon") {
  const ep = (await jsonApi("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const members = (await jsonApi("GET", "/zk/members?mode=fixture&tree=valid")).json;
  const challenge = "epoch-" + ep;
  const scope = fieldOf("scope", scopeString("discovery-tier", ep, personaId));
  const message = fieldOf("message", [personaId, "foryou", challenge, members.root].join("|"));
  const pub = { mode: "fixture", claimKind: "tier-membership", tree: "valid", epoch: ep, merkleTreeRoot: members.root, scope, message, personaId, gateId: "foryou", challenge };
  return { v: 1, mode: "fixture", claimKind: "tier-membership", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(pub), nullifier) } };
}
const bodyFor = (envelope) => Buffer.from(JSON.stringify({ envelope }));
const outcomeOf = (buf) => JSON.parse(buf.toString("utf8")).outcome;

test("direct: accepted once, then replay; both constant-shape (same size, timing floor)", async () => {
  const body = bodyFor(await freshEnvelope("9001"));
  const nonce = solvePow(body, 8);
  const a = await rawPost("/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce });
  assert.equal(a.status, 200);
  assert.equal(a.buf.length, BODY_BYTES);
  assert.equal(outcomeOf(a.buf), "accepted");
  assert.ok(a.ms >= 55, "timing floor");
  const b = await rawPost("/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce });
  assert.equal(b.buf.length, BODY_BYTES);
  assert.equal(outcomeOf(b.buf), "replay");
});

test("identifying headers are REFUSED and the proof is NOT consumed", async () => {
  const body = bodyFor(await freshEnvelope("9002"));
  const nonce = solvePow(body, 8);
  for (const bad of [{ cookie: "a=b" }, { authorization: "Bearer x" }, { "x-layers-device": "dev_1" }, { "x-forwarded-for": "1.2.3.4" }, { "user-agent": "curl" }, { referer: "https://x" }]) {
    const r = await rawPost("/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce, ...bad });
    assert.equal(r.buf.length, BODY_BYTES);
    assert.equal(outcomeOf(r.buf), "refused", JSON.stringify(bad));
  }
  // not consumed: a clean submission is still ACCEPTED
  const ok = await rawPost("/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce });
  assert.equal(outcomeOf(ok.buf), "accepted");
});

test("PoW: missing/invalid refused; a nonce for one body does not work for another; malformed JSON is constant-shape too", async () => {
  const body = bodyFor(await freshEnvelope("9003"));
  const none = await rawPost("/zk/anon/submit", body, { "content-type": "application/json" });
  assert.equal(outcomeOf(none.buf), "refused");
  const wrong = await rawPost("/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": "notanonce" });
  assert.equal(outcomeOf(wrong.buf), "refused");
  const other = bodyFor(await freshEnvelope("9004"));
  const reused = await rawPost("/zk/anon/submit", other, { "content-type": "application/json", "x-zk-pow": solvePow(body, 8) });
  assert.equal(outcomeOf(reused.buf), "refused");
  const junk = Buffer.from("{not json");
  const m = await rawPost("/zk/anon/submit", junk, { "content-type": "application/json", "x-zk-pow": solvePow(junk, 8) });
  assert.equal(m.status, 200);
  assert.equal(m.buf.length, BODY_BYTES);
  assert.equal(outcomeOf(m.buf), "malformed");
});

test("constant shape: 4 outcomes × N — identical body sizes, bounded timing spread", async () => {
  const N = 5;
  const samples = { accepted: [], replay: [], refused: [], malformed: [] };
  const sizes = new Set();
  for (let i = 0; i < N; i++) {
    const env = await freshEnvelope("9100" + i);
    const body = bodyFor(env);
    const nonce = solvePow(body, 8);
    const a = await rawPost("/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce });
    const r = await rawPost("/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce });
    const f = await rawPost("/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce, cookie: "x=y" });
    const junk = Buffer.from("garbage" + i);
    const m = await rawPost("/zk/anon/submit", junk, { "content-type": "application/json", "x-zk-pow": solvePow(junk, 8) });
    for (const [k, v] of [["accepted", a], ["replay", r], ["refused", f], ["malformed", m]]) {
      assert.equal(outcomeOf(v.buf), k);
      sizes.add(v.buf.length);
      samples[k].push(v.ms);
    }
  }
  assert.equal(sizes.size, 1, "all outcomes must have one body size");
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const meds = Object.values(samples).map(median);
  assert.ok(Math.max(...meds) - Math.min(...meds) <= 40, "median timing spread across outcomes: " + JSON.stringify(meds));
});

test("OHTTP gateway: encapsulate (RFC 9458) → relay-shaped POST → decapsulated constant-shape response; dirty outer request yields an unopenable blob of the same size", async () => {
  const cfg = Buffer.from(await (await fetch(base + "/zk/ohttp-keys")).arrayBuffer());
  assert.equal(cfg.readUInt16BE(1), 0x0020);
  const keyId = cfg.readUInt8(0);
  const pub = cfg.subarray(3, 3 + 32);
  const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() });
  const hdr = Buffer.alloc(7);
  hdr.writeUInt8(keyId, 0); hdr.writeUInt16BE(0x0020, 1); hdr.writeUInt16BE(0x0001, 3); hdr.writeUInt16BE(0x0001, 5);
  const info = Buffer.concat([Buffer.from("message/bhttp request"), Buffer.from([0]), hdr]);
  const env = await freshEnvelope("9200");
  const body = bodyFor(env);
  const inner = bhttp.encodeRequest({ method: "POST", scheme: "http", authority: "validator", path: "/zk/anon/submit", headers: { "content-type": "application/json", "x-zk-pow": solvePow(body, 8) }, body });
  const s = await suite.createSenderContext({ recipientPublicKey: await suite.kem.deserializePublicKey(new Uint8Array(pub).buffer), info: new Uint8Array(info).buffer });
  const ct = Buffer.from(await s.seal(new Uint8Array(inner).buffer, new ArrayBuffer(0)));
  const encRequest = Buffer.concat([hdr, Buffer.from(s.enc), ct]);
  const r = await rawPost("/zk/anon/ohttp", encRequest, { "content-type": "message/ohttp-req" });
  assert.equal(r.status, 200);
  assert.equal(r.ct, "message/ohttp-res");
  assert.equal(r.buf.length, outerLength());
  // decapsulate the response
  const secret = Buffer.from(await s.export(new Uint8Array(Buffer.from("message/bhttp response")).buffer, 16));
  const responseNonce = r.buf.subarray(0, 16);
  const salt = Buffer.concat([Buffer.from(s.enc), responseNonce]);
  const key = Buffer.from(hkdfSync("sha256", secret, salt, "key", 16));
  const nonce = Buffer.from(hkdfSync("sha256", secret, salt, "nonce", 12));
  const ctr = r.buf.subarray(16);
  const d = createDecipheriv("aes-128-gcm", key, nonce);
  d.setAuthTag(ctr.subarray(ctr.length - 16));
  const pt = Buffer.concat([d.update(ctr.subarray(0, ctr.length - 16)), d.final()]);
  const res = bhttp.decodeResponse(pt);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, BODY_BYTES);
  assert.equal(JSON.parse(res.body.toString()).outcome, "accepted");
  // dirty outer request (an identifying header the relay should have stripped)
  const dirty = await rawPost("/zk/anon/ohttp", encRequest, { "content-type": "message/ohttp-req", cookie: "a=b" });
  assert.equal(dirty.buf.length, outerLength());
  assert.notDeepEqual(dirty.buf, r.buf);
});

test("bhttp codec round-trips requests and responses", () => {
  const req = { method: "POST", scheme: "https", authority: "example", path: "/p?q=1", headers: { "content-type": "application/json", "x-zk-pow": "abc" }, body: Buffer.from("{}") };
  const d = bhttp.decodeRequest(bhttp.encodeRequest(req));
  assert.deepEqual({ ...d, body: d.body.toString() }, { ...req, body: "{}" });
  const res = { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("x".repeat(300)) };
  const e = bhttp.decodeResponse(bhttp.encodeResponse(res));
  assert.equal(e.status, 200);
  assert.equal(e.body.length, 300);
});

test("operator discipline: anon module logs nothing, stores no IPs/timestamps/order; anon-written tables are WITHOUT ROWID", () => {
  const src = readFileSync(path.join(__dirname, "..", "anon.js"), "utf8");
  for (const bad of [/console\.(log|info|warn|error)\(/, /req\.ip\b/, /req\.socket\.remoteAddress/, /morgan/, /Date\.now\(\)\s*[,)]\s*\)\.run/]) {
    assert.equal(bad.test(src), false, "forbidden pattern in anon.js: " + bad);
  }
  for (const t of ["zk_nullifiers", "zk_eligibility"]) {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t).sql;
    assert.match(sql, /WITHOUT ROWID/);
    assert.equal(/seen_at|created_at|received_at|_at INTEGER/.test(sql), false, t + " must carry no timestamp");
  }
});
