"use strict";
// PERSONA LAUNCH P7 — the BROWSER anonymous channel (validator/anon.js POST /zk/anon/web, GET /zk/anon/web/head).
// In-memory DB, listen(0), node:http with EXPLICIT header sets (the same discipline as anon.test.js: undici's fetch
// would add its own headers and blur what each case sends). What is pinned here, each with a control that would fail
// if the guard were gone:
//   - the allow matrix: every header a browser's fetch() adds is tolerated; the strict /zk/anon/submit still refuses them
//   - the refuse matrix: cookie / authorization / proxy-authorization / any x-layers-* / referer / an unknown header,
//     each refused WITHOUT consuming the proof (the clean request after it is accepted)
//   - proxy hop headers only behind a declared proxy (TRUST_PROXY=true)
//   - the PoW is read from the QUERY and bound to the body bytes (a header nonce, a missing nonce, another body's nonce)
//   - the body is exactly 4096 bytes (shorter and longer are "malformed")
//   - one 256-byte answer for every outcome, held to the same timing floor as /zk/anon/submit
//   - a LIVE-universe envelope is refused BEFORE verification: a spy in place of verifyAndRecord accepts it on the strict
//     route (so the refusal on the web route is the web route's own universe gate, not a failed proof)
//   - PUBLIC GO-LIVE (ASM-2B): a forged TEST envelope is refused at the door of an ARMED public relay or a LIVE product
//     (PUBLIC_LIVE on a public deployment; a misspelt value counts as live), before verification and with no row stored; the
//     same bytes are accepted on the rig (the control); a throw in the universe rules is a refusal; four in-file mutations
process.env.ZK_DEV_HOOKS = "true";
process.env.ZK_POW_BITS = "8"; // fast in tests; the mechanism is identical
process.env.ZK_ANON_RESPONSE_MS = "60";
delete process.env.TRUST_PROXY;

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { request: httpRequest } = require("node:http");

// THE SPY — installed on the zk module BEFORE validator/anon.js is loaded (server.js requires it inside createApp, and
// anon.js destructures verifyAndRecord at load): it records every envelope that reaches verification, and ACCEPTS a
// live-universe envelope marked by this test (so the strict route's acceptance proves the envelope would pass there)
const zk = require("../zk");
const realVerify = zk.verifyAndRecord;
const verified = [];
zk.verifyAndRecord = async (db, env) => {
  verified.push(env && env.mode);
  if (env && env.mode === "live" && env.__anonwebTestAccept === true) return { status: 200, json: { ok: true } };
  // PUBLIC GO-LIVE (ASM-2B): a TEST envelope so marked is accepted without the real check, so a door-passing case on the PUBLIC
  // shape never runs real verification there (the fid gate would recompute the shared "valid" tree under another shape)
  if (env && env.mode === "fixture" && env.__anonwebTestAcceptFixture === true) return { status: 200, json: { ok: true } };
  return realVerify(db, env);
};
const { createApp } = require("../server");
const anon = require("../anon");
const { BODY_BYTES, WEB_BODY_BYTES, webHeaderAllowed } = anon;

let server;
let base;
let vdb; // PUBLIC GO-LIVE (ASM-2B): the server's own database, for "stores no row"
before(async () => {
  const created = createApp(":memory:");
  vdb = created.db;
  await new Promise((resolve) => {
    server = created.app.listen(0, "127.0.0.1", resolve);
  });
  base = "http://127.0.0.1:" + server.address().port;
});
after(() => server.close());

// ---- helpers (deliberate duplicates of the client side, as in anon.test.js) ----
const leadingZeroBits = (buf) => { let n = 0; for (const b of buf) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; } return n; };
function solvePow(bodyBytes, bits = 8) {
  const bodyHash = createHash("sha256").update(bodyBytes).digest("hex");
  for (let i = 0; ; i++) {
    const nonce = i.toString(36);
    if (leadingZeroBits(createHash("sha256").update(bodyHash + "|" + nonce).digest()) >= bits) return nonce;
  }
}
const fixtureTag = (canonical, nullifier) => createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
const canonicalPublicInputs = (p) => ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge].join("|");
const fieldOf = (domain, canonical) => (BigInt("0x" + createHash("sha256").update(`layers-zk-field/1|${domain}|${canonical}`).digest("hex")) >> 8n).toString(10);
const scopeString = (feature, epoch, personaId) => `layers/zk-scope/v1|${feature}|${epoch}|${personaId}`;

function raw(method, p, bodyBytes, headers) {
  const t0 = Date.now();
  const u = new URL(base + p);
  return new Promise((resolve, reject) => {
    const h = {};
    for (const [k, v] of Object.entries(headers)) if (v !== undefined) h[k] = v;
    if (bodyBytes) h["content-length"] = String(bodyBytes.length);
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: false, headers: h }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks), ms: Date.now() - t0, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(bodyBytes);
  });
}
async function getJson(p) {
  const r = await raw("GET", p, null, {});
  return JSON.parse(r.buf.toString("utf8"));
}

let nullifierSeq = 70000;
async function freshEnvelope(mode = "fixture") {
  const ep = (await getJson("/zk/epoch?mode=fixture")).epoch;
  const members = await getJson("/zk/members?mode=fixture&tree=valid");
  const personaId = "p_web";
  const challenge = "epoch-" + ep;
  const scope = fieldOf("scope", scopeString("discovery-tier", ep, personaId));
  const message = fieldOf("message", [personaId, "foryou", challenge, members.root].join("|"));
  const nullifier = String(nullifierSeq++);
  const pub = { mode, claimKind: "tier-membership", tree: "valid", epoch: ep, merkleTreeRoot: members.root, scope, message, personaId, gateId: "foryou", challenge };
  return { v: 1, mode, claimKind: "tier-membership", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(pub), nullifier) } };
}
/** the browser's body: exactly WEB_BODY_BYTES, padded the way lib/zk/anon/submit.ts pads */
function padded(envelope, size = WEB_BODY_BYTES) {
  const bare = Buffer.byteLength(JSON.stringify({ envelope, p: "" }));
  const out = Buffer.from(JSON.stringify({ envelope, p: "x".repeat(Math.max(0, size - bare)) }));
  assert.equal(out.length, size, "the test's padding");
  return out;
}
const outcomeOf = (r) => JSON.parse(r.buf.toString("utf8")).outcome;

/** what Chromium's fetch() actually sends for a credentials:"omit", referrerPolicy:"no-referrer", cache:"no-store",
 *  text/plain POST from a page on another origin (the headers a page script cannot remove) */
const BROWSER = Object.freeze({
  "content-type": "text/plain;charset=UTF-8",
  accept: "*/*",
  "accept-encoding": "gzip, deflate, br, zstd",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  connection: "keep-alive",
  dnt: "1",
  origin: "http://localhost:3001",
  pragma: "no-cache",
  priority: "u=1, i",
  "sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "cross-site",
  "sec-gpc": "1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
});
const webPost = (body, nonce, headers = BROWSER) => raw("POST", "/zk/anon/web" + (nonce === null ? "" : "?pow=" + encodeURIComponent(nonce)), body, headers);

test("ALLOW: a browser's own headers are tolerated on /zk/anon/web — accepted once, then replay; the answer is the constant 256-byte shape with CORS open", async () => {
  const body = padded(await freshEnvelope());
  const nonce = solvePow(body);
  const a = await webPost(body, nonce);
  assert.equal(a.status, 200);
  assert.equal(a.buf.length, BODY_BYTES);
  assert.equal(outcomeOf(a), "accepted");
  assert.equal(a.headers["access-control-allow-origin"], "*", "a browser could not read the answer cross-origin");
  const b = await webPost(body, nonce);
  assert.equal(b.buf.length, BODY_BYTES);
  assert.equal(outcomeOf(b), "replay");
});

test("CONTROL: the strict /zk/anon/submit still REFUSES a browser's headers (user-agent alone, and the whole set), and accepts the same body without them", async () => {
  const body = padded(await freshEnvelope());
  const nonce = solvePow(body);
  const ua = await raw("POST", "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce, "user-agent": BROWSER["user-agent"] });
  assert.equal(outcomeOf(ua), "refused", "the strict route took a user-agent");
  const all = await raw("POST", "/zk/anon/submit", body, { ...BROWSER, "x-zk-pow": nonce });
  assert.equal(outcomeOf(all), "refused", "the strict route took a browser's header set");
  const clean = await raw("POST", "/zk/anon/submit", body, { "content-type": "application/json", "x-zk-pow": nonce });
  assert.equal(outcomeOf(clean), "accepted", "the strict route's own clean request (the proof was consumed by a refusal?)");
});

test("REFUSE: cookie / authorization / proxy-authorization / x-layers-* / referer / an unknown header each refuse, and none consumes the proof", async () => {
  const body = padded(await freshEnvelope());
  const nonce = solvePow(body);
  const bad = [
    { cookie: "layers_session=abc" },
    { authorization: "Bearer x" },
    { "proxy-authorization": "Basic eA==" },
    { "x-layers-device": "dev_1" },
    { "x-layers-sig": "00" },
    { "x-layers-anything-new": "1" },
    { referer: "http://localhost:3001/home" },
    { "x-unknown": "1" },
  ];
  for (const extra of bad) {
    const r = await webPost(body, nonce, { ...BROWSER, ...extra });
    assert.equal(r.buf.length, BODY_BYTES, JSON.stringify(extra));
    assert.equal(outcomeOf(r), "refused", "not refused: " + JSON.stringify(extra));
  }
  for (const k of ["cookie", "authorization", "proxy-authorization", "referer", "x-layers-device"]) assert.equal(webHeaderAllowed(k), false, k);
  const ok = await webPost(body, nonce);
  assert.equal(outcomeOf(ok), "accepted", "a refusal consumed the proof");
});

test("PROXY: hop headers are refused unless the operator declared the proxy (TRUST_PROXY=true); the person-naming headers stay refused behind it", async () => {
  const hops = { "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https", "x-forwarded-host": "validator.example", "x-real-ip": "203.0.113.9", forwarded: "for=203.0.113.9", via: "1.1 edge", "x-request-id": "abc", "x-request-start": "t=1" };
  const body = padded(await freshEnvelope());
  const nonce = solvePow(body);
  delete process.env.TRUST_PROXY;
  for (const [k, v] of Object.entries(hops)) {
    const r = await webPost(body, nonce, { ...BROWSER, [k]: v });
    assert.equal(outcomeOf(r), "refused", "without TRUST_PROXY, " + k + " was tolerated");
  }
  process.env.TRUST_PROXY = "true";
  try {
    const behind = await webPost(body, nonce, { ...BROWSER, cookie: "a=b", ...hops });
    assert.equal(outcomeOf(behind), "refused", "a cookie passed behind a declared proxy");
    const r = await webPost(body, nonce, { ...BROWSER, ...hops });
    assert.equal(outcomeOf(r), "accepted", "behind a declared proxy the hop headers were still refused");
  } finally {
    delete process.env.TRUST_PROXY;
  }
});

test("POW: read from the QUERY and bound to the body bytes — missing, malformed, another body's, or only in a header: refused", async () => {
  const body = padded(await freshEnvelope());
  const other = padded(await freshEnvelope());
  assert.equal(outcomeOf(await webPost(body, null)), "refused", "no nonce");
  assert.equal(outcomeOf(await webPost(body, "not a nonce!")), "refused", "a malformed nonce");
  assert.equal(outcomeOf(await webPost(other, solvePow(body))), "refused", "another body's nonce");
  assert.equal(outcomeOf(await webPost(body, null, { ...BROWSER, "x-zk-pow": solvePow(body) })), "refused", "a nonce in a header (the web route reads the query)");
  assert.equal(outcomeOf(await webPost(body, solvePow(body))), "accepted", "the right nonce in the query (control)");
});

test("SIZE: the body is exactly 4096 bytes — shorter and longer are malformed (constant shape too)", async () => {
  const env = await freshEnvelope();
  for (const size of [WEB_BODY_BYTES - 1, WEB_BODY_BYTES + 1, 2048]) {
    const body = padded(env, size);
    const r = await webPost(body, solvePow(body));
    assert.equal(r.buf.length, BODY_BYTES);
    assert.equal(outcomeOf(r), "malformed", "size " + size);
  }
  const junk = Buffer.alloc(WEB_BODY_BYTES, 0x7b);
  const m = await webPost(junk, solvePow(junk));
  assert.equal(outcomeOf(m), "malformed", "4096 bytes of non-JSON");
});

test("UNIVERSE: a live-universe envelope is refused on the web route BEFORE verification — the same envelope is accepted by the strict route (the spy accepts it), so the refusal is the web route's own gate", async () => {
  const env = { ...(await freshEnvelope("live")), __anonwebTestAccept: true };
  const body = padded(env);
  const nonce = solvePow(body);
  const before = verified.length;
  const w = await webPost(body, nonce);
  assert.equal(outcomeOf(w), "refused");
  assert.equal(w.buf.length, BODY_BYTES);
  assert.equal(verified.slice(before).filter((m) => m === "live").length, 0, "the web route handed a live envelope to verification");
  // the control: the strict route verifies it (the spy accepts the marked live envelope)
  const strictBody = Buffer.from(JSON.stringify({ envelope: env }));
  const s = await raw("POST", "/zk/anon/submit", strictBody, { "content-type": "application/json", "x-zk-pow": solvePow(strictBody) });
  assert.equal(outcomeOf(s), "accepted", "the control did not reach the spy");
  assert.ok(verified.slice(before).includes("live"), "the strict route did not verify the live envelope");
  // a fixture envelope that claims live inputs (mode mixed) is refused at the door too
  const mixed = await freshEnvelope();
  mixed.publicInputs = { ...mixed.publicInputs, mode: "live" };
  const mb = padded(mixed);
  assert.equal(outcomeOf(await webPost(mb, solvePow(mb))), "refused");
});

// ================================================================ PUBLIC GO-LIVE (ASM-2B): the TEST universe on a live product
// A test-universe envelope's "proof" is a public hash (fixtureTag above is a duplicate anyone can write), so at the web door it
// proves nothing about its sender. A tab refuses test posts in a live product, but an attacker skips the tab: the DOOR must
// refuse a forged test envelope — before verification, nothing consumed, no row — once the validator is the live product
// (PUBLIC_LIVE on a public deployment; a misspelt value counts as live) or its PUBLIC relay is armed. The rig, the owner
// service and the unarmed preview are unchanged. Each env below is set only around the one request, then restored.
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const NodeModule = require("node:module");
const anonpublic = require("../anonpublic");
/** the PUBLIC relay armed on the agent path (validator/anonpublic.js relayAccount: an agent key, fid, signer uuid, the switch
 *  and an explicit cap; no second credential) — the same shape scripts/unit-prover.mjs A5b uses */
const ARMED_RELAY = Object.freeze({ FC_ANON_FID: "812345", FC_ANON_SIGNER_UUID: "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d", FC_ANON_NEYNAR_KEY: "anonstub-anonweb-test-0001", ZK_ANON_RELAY_LIVE: "on", ZK_ANON_POST_LIVE_CAP: "5", NEYNAR_API_KEY: undefined, NEYNAR_SIGNER_UUID: undefined, FC_ANON_NEYNAR_BASE_URL: undefined, ZK_ANON_TRANSPORT: undefined, PUBLIC_LIVE: undefined });
const UNARMED = Object.freeze({ FC_ANON_FID: undefined, FC_ANON_SIGNER_UUID: undefined, FC_ANON_NEYNAR_KEY: undefined, ZK_ANON_RELAY_LIVE: undefined, ZK_ANON_POST_LIVE_CAP: undefined, NEYNAR_API_KEY: undefined, NEYNAR_SIGNER_UUID: undefined, ENABLE_FC_WRITE: undefined });
/** a public deployment's shape (env-contract isPublicDeployment): production, no dev hooks */
const PUBLIC_SHAPE = Object.freeze({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined });
const LIVE_PRODUCT = Object.freeze({ ...UNARMED, ...PUBLIC_SHAPE, PUBLIC_LIVE: "true" });
const LIVE_PRODUCT_TYPO = Object.freeze({ ...UNARMED, ...PUBLIC_SHAPE, PUBLIC_LIVE: "True" });
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const nullifierRows = (n) => vdb.prepare("SELECT COUNT(*) AS n FROM zk_nullifiers WHERE mode = 'fixture' AND nullifier = ?").get(n).n;
/** THE ATTACK: a REAL test-universe envelope (built on the rig; the controls show verification accepts it) sent to the web door
 *  through `post` while `envVars` hold. It must be refused before verification and leave no nullifier row. `mark`: the spy
 *  accepts the envelope without the real check (for a MUTANT on the public shape, whose door lets it through) */
async function doorRefusesForged(post, envVars, label, mark = false) {
  const envl = mark ? { ...(await freshEnvelope()), __anonwebTestAcceptFixture: true } : await freshEnvelope();
  const body = padded(envl);
  const nonce = solvePow(body);
  const before = verified.length;
  const r = await withEnv(envVars, () => post(body, nonce));
  assert.equal(r.buf.length, BODY_BYTES, label + ": the answer's shape");
  assert.equal(outcomeOf(r), "refused", label + ": a forged test envelope was " + outcomeOf(r));
  assert.equal(verified.length, before, label + ": the door handed a test envelope to verification");
  assert.equal(nullifierRows(envl.nullifier), 0, label + ": a nullifier row was stored");
  return { envl, body, nonce };
}

test("ASM-2B: the publicLiveValidator reading — on only on a public deployment, and a misspelt PUBLIC_LIVE counts as LIVE (fail closed); off on the rig and the owner service whatever the value", () => {
  const P = { NODE_ENV: "production" };
  for (const v of ["true", "True", "TRUE", "yes", "on", "1", " true", " "]) assert.equal(anon.publicLiveValidator({ ...P, PUBLIC_LIVE: v }), true, "public, PUBLIC_LIVE=" + JSON.stringify(v));
  for (const v of [undefined, "", "false"]) assert.equal(anon.publicLiveValidator({ ...P, PUBLIC_LIVE: v }), false, "public, PUBLIC_LIVE=" + JSON.stringify(v));
  for (const v of ["true", "True", "yes"]) {
    assert.equal(anon.publicLiveValidator({ ...P, ZK_DEV_HOOKS: "true", PUBLIC_LIVE: v }), false, "a rig-shaped process (dev hooks), PUBLIC_LIVE=" + v);
    assert.equal(anon.publicLiveValidator({ PUBLIC_LIVE: v }), false, "not production, PUBLIC_LIVE=" + v);
  }
});

test("ASM-2B: a forged TEST envelope at the web door of an ARMED public relay, of a LIVE product (PUBLIC_LIVE=true on a public deployment) and of one with a misspelt PUBLIC_LIVE is refused BEFORE verification and stores no row; CONTROLS: the same bytes on the rig are accepted by real verification (row stored), and an unarmed public preview (PUBLIC_LIVE=false) still passes a test envelope through the door", async () => {
  // preconditions: each env reads as it claims (else a refusal below could be some other door's)
  assert.equal(await withEnv(ARMED_RELAY, () => anonpublic.liveWebDoorOpen()), true, "precondition: the armed env does not open the public relay's door");
  assert.equal(await withEnv(ARMED_RELAY, () => anon.publicLiveValidator()), false, "precondition: the armed env (rig-shaped) reads as a live product");
  assert.equal(await withEnv(LIVE_PRODUCT, () => anon.publicLiveValidator() && !anonpublic.liveWebDoorOpen()), true, "precondition: the live-product env is not live-and-unarmed");
  assert.equal(await withEnv({ ...UNARMED, PUBLIC_LIVE: "true" }, () => anon.publicLiveValidator() || anonpublic.liveWebDoorOpen()), false, "precondition: the rig control env closes the door");
  await getJson("/zk/members?mode=fixture&tree=valid"); // the fixture tree has a signed head this epoch
  const refused = [];
  refused.push(await doorRefusesForged(webPost, ARMED_RELAY, "armed public relay"));
  refused.push(await doorRefusesForged(webPost, LIVE_PRODUCT, "PUBLIC_LIVE=true on a public deployment"));
  refused.push(await doorRefusesForged(webPost, LIVE_PRODUCT_TYPO, "PUBLIC_LIVE=True (misspelt) on a public deployment"));
  // CONTROL (non-vacuous): the very bytes refused above, on the rig (PUBLIC_LIVE is ignored on a rig-shaped process, the relay
  // unarmed), are ACCEPTED by real verification — only then is the row stored. So each refusal was the door's own, and none
  // consumed the proof.
  for (const x of refused) {
    const ok = await withEnv({ ...UNARMED, PUBLIC_LIVE: "true" }, () => webPost(x.body, x.nonce));
    assert.equal(outcomeOf(ok), "accepted", "the control: the forged envelope on the rig was " + outcomeOf(ok));
    assert.equal(nullifierRows(x.envl.nullifier), 1, "the control stored no row");
  }
  // CONTROL: the unarmed public PREVIEW (PUBLIC_LIVE=false, and unset) keeps the test universe: the door hands a test envelope
  // on to verification (a marked one the spy accepts, so the real check never runs on the public shape)
  for (const off of ["false", undefined]) {
    const pv = padded({ ...(await freshEnvelope()), __anonwebTestAcceptFixture: true });
    const before = verified.length;
    const r = await withEnv({ ...UNARMED, ...PUBLIC_SHAPE, PUBLIC_LIVE: off }, () => webPost(pv, solvePow(pv)));
    assert.equal(outcomeOf(r), "accepted", "the unarmed public preview (PUBLIC_LIVE=" + off + ") refused a test envelope at its door");
    assert.equal(verified.slice(before).filter((m) => m === "fixture").length, 1, "the unarmed public preview (PUBLIC_LIVE=" + off + ") did not verify the test envelope");
  }
});

test("ASM-2B: a throw inside the universe rules is a REFUSAL at the door, never the parse's 'ok' (it was fail-open: the rules ran inside the JSON.parse try)", async () => {
  const realOpen = anonpublic.liveWebDoorOpen;
  anonpublic.liveWebDoorOpen = () => {
    throw new Error("the relay account could not be read");
  };
  try {
    const envl = await freshEnvelope();
    const body = padded(envl);
    const before = verified.length;
    const r = await webPost(body, solvePow(body));
    assert.equal(outcomeOf(r), "refused", "a throw in the universe rules answered " + outcomeOf(r));
    assert.equal(verified.length, before, "a throw in the universe rules reached verification");
    assert.equal(nullifierRows(envl.nullifier), 0, "a throw in the universe rules stored a row");
  } finally {
    anonpublic.liveWebDoorOpen = realOpen;
  }
});

// MUTATIONS: validator/anon.js compiled in memory with one rule broken, mounted on THIS server's database; the attack above must
// FAIL against each mutant (a mutant whose anchor is gone fails the test outright, never passes it)
const ANON_FILE = nodePath.join(__dirname, "..", "anon.js");
let mutantSeq = 0;
function compileAnonMutant(edit) {
  const src = nodeFs.readFileSync(ANON_FILE, "utf8").replace(/\r\n/g, "\n");
  const out = edit(src);
  assert.notEqual(out, src, "the mutation did not apply (its anchor is gone from validator/anon.js)");
  const file = nodePath.join(__dirname, "..", "anon.asm2b-mutant-" + ++mutantSeq + ".js");
  const m = new NodeModule(file, module);
  m.filename = file;
  m.paths = NodeModule._nodeModulePaths(nodePath.dirname(file));
  m._compile(out, file); // binds verifyAndRecord from the cached ../zk — the spy
  return m.exports;
}
const replaceOnce = (from, to) => (src) => (src.includes(from) ? src.split(from).join(to) : src);
async function withMutant(edit, fn) {
  const A = compileAnonMutant(edit);
  const app = require("express")();
  A.mountAnon(app, vdb);
  const s = await new Promise((resolve) => {
    const x = app.listen(0, "127.0.0.1", () => resolve(x));
  });
  const post = (body, nonce) =>
    new Promise((resolve, reject) => {
      const h = { ...BROWSER, "content-length": String(body.length) };
      const req = httpRequest({ hostname: "127.0.0.1", port: s.address().port, path: "/zk/anon/web?pow=" + encodeURIComponent(nonce), method: "POST", agent: false, headers: h }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end(body);
    });
  try {
    return await fn(post, A);
  } finally {
    await new Promise((r) => s.close(r));
  }
}
const FIXTURE_RULE = 'if (env.mode === "fixture") return !(require("./anonpublic").liveWebDoorOpen() || publicLiveValidator());';

test("ASM-2B MUTATIONS: the door's fixture rule restored to `return true`, the live-product reading dropped, the misspelling no longer fail-closed, and the universe rules back inside the parse's try — each lets the attack through", async () => {
  await getJson("/zk/members?mode=fixture&tree=valid");
  // M0 (the harness itself): an UNMUTATED compile refuses the attack — a mutant's failure below is the mutation's doing
  await withMutant((src) => src + "\n", (post) => doorRefusesForged(post, ARMED_RELAY, "the unmutated compile"));
  // M1: the old line — the test universe passes the door unconditionally
  await withMutant(replaceOnce(FIXTURE_RULE, 'if (env.mode === "fixture") return true;'), async (post) => {
    await assert.rejects(doorRefusesForged(post, ARMED_RELAY, "M1 armed"), /a forged test envelope was accepted/, "M1 (fixture rule `return true`): the armed-relay attack was still refused — the test is vacuous");
  });
  // M2: the live-product reading not consulted — only the armed relay closes the door
  await withMutant(replaceOnce(FIXTURE_RULE, 'if (env.mode === "fixture") return !require("./anonpublic").liveWebDoorOpen();'), async (post) => {
    await assert.rejects(doorRefusesForged(post, LIVE_PRODUCT, "M2 live product", true), /a forged test envelope was accepted/, "M2 (PUBLIC_LIVE not consulted): the live-product attack was still refused — the test is vacuous");
  });
  // M3: the reading is seed.js's exact "true" — a misspelt PUBLIC_LIVE leaves the test door open
  await withMutant(replaceOnce('return !(v === undefined || v === "" || v === "false");', 'return v === "true";'), async (post) => {
    await assert.rejects(doorRefusesForged(post, LIVE_PRODUCT_TYPO, "M3 typo", true), /a forged test envelope was accepted/, "M3 (misspelling not fail-closed): the misspelt-PUBLIC_LIVE attack was still refused — the test is vacuous");
    // and M3 does keep the exact "true" closed (so its failure above is the misspelling's, not a broken door)
    await doorRefusesForged(post, LIVE_PRODUCT, "M3 exact true", true);
  });
  // M4: the universe rules back inside the parse's try (the shape before this fix): a throw in them answers "ok"
  const OLD_TRY = (src) => {
    const start = src.indexOf("function webEnvelopeUniverseOk(bodyBytes) {");
    const end = src.indexOf("\n}\n", start);
    if (start < 0 || end < 0) return src;
    const old = [
      "function webEnvelopeUniverseOk(bodyBytes) {",
      "  try {",
      '    const parsed = JSON.parse(bodyBytes.toString("utf8"));',
      "    const env = parsed && parsed.envelope;",
      "    if (!env || !env.publicInputs || env.mode !== env.publicInputs.mode) return false;",
      "    " + FIXTURE_RULE,
      '    return env.mode === "live" && require("./anonpublic").liveWebDoorOpen();',
      "  } catch {",
      "    return true;",
      "  }",
      "}",
    ].join("\n");
    return src.slice(0, start) + old + src.slice(end + 2);
  };
  const realOpen = anonpublic.liveWebDoorOpen;
  await withMutant(OLD_TRY, async (post) => {
    anonpublic.liveWebDoorOpen = () => {
      throw new Error("the relay account could not be read");
    };
    try {
      await assert.rejects(doorRefusesForged(post, {}, "M4 throw"), /a forged test envelope was accepted/, "M4 (rules inside the parse's try): a throw was still a refusal — the test is vacuous");
    } finally {
      anonpublic.liveWebDoorOpen = realOpen;
    }
  });
});

test("SHAPE + TIMING: accepted / replay / refused / malformed on the web route are one size and as slow as on /zk/anon/submit", async () => {
  const N = 4;
  const web = { accepted: [], replay: [], refused: [], malformed: [] };
  const strict = { accepted: [], replay: [], refused: [], malformed: [] };
  const sizes = new Set();
  for (let i = 0; i < N; i++) {
    const body = padded(await freshEnvelope());
    const nonce = solvePow(body);
    const a = await webPost(body, nonce);
    const r = await webPost(body, nonce);
    const f = await webPost(body, nonce, { ...BROWSER, cookie: "x=y" });
    const junk = Buffer.alloc(WEB_BODY_BYTES, 0x20 + i);
    const m = await webPost(junk, solvePow(junk));
    for (const [k, v] of [["accepted", a], ["replay", r], ["refused", f], ["malformed", m]]) {
      assert.equal(outcomeOf(v), k);
      sizes.add(v.buf.length);
      web[k].push(v.ms);
    }
    const sb = Buffer.from(JSON.stringify({ envelope: await freshEnvelope() }));
    const sn = solvePow(sb);
    const sa = await raw("POST", "/zk/anon/submit", sb, { "content-type": "application/json", "x-zk-pow": sn });
    const sr = await raw("POST", "/zk/anon/submit", sb, { "content-type": "application/json", "x-zk-pow": sn });
    const sf = await raw("POST", "/zk/anon/submit", sb, { "content-type": "application/json", "x-zk-pow": sn, cookie: "x=y" });
    const sj = Buffer.from("garbage" + i);
    const sm = await raw("POST", "/zk/anon/submit", sj, { "content-type": "application/json", "x-zk-pow": solvePow(sj) });
    for (const [k, v] of [["accepted", sa], ["replay", sr], ["refused", sf], ["malformed", sm]]) {
      assert.equal(outcomeOf(v), k, "strict " + k);
      sizes.add(v.buf.length);
      strict[k].push(v.ms);
    }
  }
  assert.deepEqual([...sizes], [BODY_BYTES], "one body size across both routes and every outcome");
  const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const all = [...Object.values(web), ...Object.values(strict)].map(median);
  assert.ok(Math.min(...all) >= 55, "the timing floor: " + JSON.stringify(all));
  assert.ok(Math.max(...all) - Math.min(...all) <= 45, "median timing spread across routes and outcomes: " + JSON.stringify(all));
});

test("HEAD: /zk/anon/web/head answers a browser the same public head as /zk/anon/head; a cookie is refused; the strict head still refuses a user-agent", async () => {
  // make sure the fixture 'valid' tree has a history entry this epoch
  await getJson("/zk/members?mode=fixture&tree=valid");
  const strict = await raw("GET", "/zk/anon/head?mode=fixture&tree=valid", null, {});
  assert.equal(strict.status, 200);
  const w = await raw("GET", "/zk/anon/web/head?mode=fixture&tree=valid", null, { ...BROWSER, "content-type": undefined });
  assert.equal(w.status, 200);
  assert.deepEqual(JSON.parse(w.buf.toString("utf8")), JSON.parse(strict.buf.toString("utf8")), "the web head differs from the strict head");
  const c = await raw("GET", "/zk/anon/web/head?mode=fixture&tree=valid", null, { "user-agent": BROWSER["user-agent"], cookie: "a=b" });
  assert.deepEqual(JSON.parse(c.buf.toString("utf8")), { error: "refused" });
  const sua = await raw("GET", "/zk/anon/head?mode=fixture&tree=valid", null, { "user-agent": BROWSER["user-agent"] });
  assert.deepEqual(JSON.parse(sua.buf.toString("utf8")), { error: "refused" }, "the strict head took a user-agent");
});

// ================================================================ PERSONA LAUNCH GO-LIVE (A-WEB-PROXY-HOP-HEADERS)
// The public validator sits behind Railway's edge, which adds its own headers to every request. The web routes must
// tolerate exactly the edge's documented set — and only behind a declared proxy (TRUST_PROXY=true) — or every stranger's
// submission is refused. validator/test/fixtures/railway-hop-headers.json is that set AS DOCUMENTED (not recorded: no
// test touches the network); scripts/smoke-deployed.mjs check 10 re-checks the real edge on every deploy.
const RAILWAY = require("./fixtures/railway-hop-headers.json");
const RAILWAY_SET = Object.freeze({ ...RAILWAY.documented, "x-forwarded-for": RAILWAY.observed_not_documented["x-forwarded-for"] });

test("RAILWAY: the edge's documented header set, replayed — refused without TRUST_PROXY, accepted behind it on POST /zk/anon/web and GET /zk/anon/web/head; a cookie beside it is still refused; MUTATION: the x-railway- prefix dropped from the allowlist → refused; an undocumented cf-* header → refused; a client's x-railway-debug → refused", async () => {
  // preconditions: the fixture is the documented set (not an empty or stale file that would make every case vacuous)
  assert.ok(Object.keys(RAILWAY.documented).length >= 6, "the fixture lists too few documented headers");
  assert.ok(Object.keys(RAILWAY_SET).filter((k) => k.startsWith("x-railway-")).length >= 2, "the fixture carries no x-railway-* header: the prefix rule would be untested");
  assert.match(RAILWAY.source, /^https:\/\/docs\.railway\.com\//, "the fixture names no Railway documentation page");
  const body = padded(await freshEnvelope());
  const nonce = solvePow(body);
  const head = (h) => raw("GET", "/zk/anon/web/head?mode=fixture&tree=valid", null, h);
  const HEAD_BROWSER = { ...BROWSER, "content-type": undefined };
  await getJson("/zk/members?mode=fixture&tree=valid"); // the tree has a signed head this epoch
  delete process.env.TRUST_PROXY;
  try {
    assert.equal(outcomeOf(await webPost(body, nonce, { ...BROWSER, ...RAILWAY_SET })), "refused", "without TRUST_PROXY the edge's headers were tolerated");
    assert.deepEqual(JSON.parse((await head({ ...HEAD_BROWSER, ...RAILWAY_SET })).buf.toString("utf8")), { error: "refused" }, "without TRUST_PROXY the head took the edge's headers");
    process.env.TRUST_PROXY = "true";
    // the head behind a declared proxy: the public head, exactly as without the edge's headers
    const h = await head({ ...HEAD_BROWSER, ...RAILWAY_SET });
    assert.equal(h.status, 200, "behind TRUST_PROXY the head refused the edge's headers: " + h.buf.toString("utf8").slice(0, 120));
    const plain = await head(HEAD_BROWSER);
    assert.deepEqual(JSON.parse(h.buf.toString("utf8")), JSON.parse(plain.buf.toString("utf8")), "the head answered differently with the edge's headers");
    // a person-naming header beside the edge's set is still refused
    assert.equal(outcomeOf(await webPost(body, nonce, { ...BROWSER, ...RAILWAY_SET, cookie: "layers=1" })), "refused", "a cookie passed beside the edge's headers");
    // an UNDOCUMENTED edge header refuses everything (fail closed): Railway documents no cf-* header. PUBLIC GO-LIVE: and
    // x-railway-debug, the one x-railway-* name a CLIENT sends, is refused although the hop prefix covers its spelling
    assert.ok(RAILWAY.not_added_by_railway.names.includes("x-railway-debug"), "precondition: the fixture no longer names x-railway-debug");
    for (const k of RAILWAY.not_added_by_railway.names) {
      assert.equal(outcomeOf(await webPost(body, nonce, { ...BROWSER, ...RAILWAY_SET, [k]: "x" })), "refused", k + " was tolerated");
    }
    assert.deepEqual(JSON.parse((await head({ ...HEAD_BROWSER, ...RAILWAY_SET, "x-railway-debug": "1" })).buf.toString("utf8")), { error: "refused" }, "the head took a client's x-railway-debug");
    // MUTATION: without the x-railway- prefix the documented set refuses every submission (the rule is what lets it in)
    const i = anon.WEB_PROXY_PREFIXES.indexOf("x-railway-");
    assert.ok(i >= 0, "validator/anon.js has no x-railway- prefix");
    anon.WEB_PROXY_PREFIXES.splice(i, 1);
    try {
      assert.equal(outcomeOf(await webPost(body, nonce, { ...BROWSER, ...RAILWAY_SET })), "refused", "the mutation (no x-railway- prefix) still accepted the edge's headers: the replay would be vacuous");
    } finally {
      anon.WEB_PROXY_PREFIXES.splice(i, 0, "x-railway-");
    }
    // and with the rule in place: accepted — so none of the refusals above consumed the proof
    assert.equal(outcomeOf(await webPost(body, nonce, { ...BROWSER, ...RAILWAY_SET })), "accepted", "behind TRUST_PROXY the edge's documented headers were refused");
  } finally {
    delete process.env.TRUST_PROXY;
  }
});

// THE RATE-LIMIT KEY behind the edge, on a REAL loopback validator (a child process: the limiter is off in this
// process, which runs with dev hooks). The child carries TRUST_PROXY=true, a 5-request bucket that barely refills, no
// dev hooks, a temp database, no live key, and scripts/lib/net-guard.cjs preloaded (any non-loopback connection is
// recorded and refused; the log must stay empty).
const { spawn } = require("node:child_process");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
function childGet(port, p, headers) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path: p, method: "GET", agent: false, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

test("RATE KEY: behind TRUST_PROXY=true a client-forged LEFT-most X-Forwarded-For cannot choose its own bucket — the edge's hop (X-Real-IP, else the RIGHT-most entry) keys the limiter; varying the right-most hop does get fresh buckets (control); the replayed Railway set keys on its X-Real-IP", async () => {
  const REPO = path.join(__dirname, "..", "..");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "layers-anonweb-rl-"));
  const guardLog = path.join(tmp, "net-guard.jsonl");
  const port = await freePort();
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(RAILWAY_|NEYNAR_|FC_|X_|ENABLE_|LAYERS_HOSTED$|LAYERS_REQUIRE_SIG$|LAYERS_MAINTENANCE$|ZK_RELAY|DATA_SOURCE$)/.test(k)) delete env[k];
  Object.assign(env, {
    NODE_ENV: "",
    ZK_DEV_HOOKS: "",
    TRUST_PROXY: "true",
    LAYERS_VALIDATOR_PORT: String(port),
    VALIDATOR_DB: path.join(tmp, "v.db"),
    VALIDATOR_RL_CAPACITY: "5",
    VALIDATOR_RL_REFILL_PER_SECOND: "0.001",
    // relative to the child's cwd (the repo), exactly as accept-x-outbox preloads it (the repo path carries a space)
    NODE_OPTIONS: "--require ./scripts/lib/net-guard.cjs",
    NET_GUARD_LOG: guardLog,
  });
  const child = spawn(process.execPath, [path.join(REPO, "validator", "server.js")], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (out += b));
  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      if (child.exitCode !== null) break;
      up = await childGet(port, "/health", {}).then((s) => s === 200, () => false);
      if (!up) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(up, "the child validator did not come up: " + out.slice(-400));
    assert.match(out, /LOCAL rate-limit override: 5 burst/, "precondition: the child does not run the 5-request bucket (the counts below would mean nothing): " + out.slice(-300));
    const P = "/zk/epoch?mode=fixture";
    const burst = async (headersFor, n = 6) => {
      const s = [];
      for (let i = 0; i < n; i++) s.push(await childGet(port, P, headersFor(i)));
      return s;
    };
    // 1. THE ATTACK: the client writes a new left-most address every time; the edge's appended hop is constant
    const forged = await burst((i) => ({ "x-forwarded-for": "198.51.100." + (i + 1) + ", 203.0.113.50" }));
    assert.deepEqual(forged.slice(0, 5), [200, 200, 200, 200, 200], "precondition: the first five requests were not served: " + forged.join(","));
    assert.equal(forged[5], 429, "a forged left-most X-Forwarded-For chose its own bucket (the 6th request was served): " + forged.join(","));
    // 2. THE CONTROL: a different right-most hop each time IS a different client to the edge — never limited, so the 429
    // above is the key's doing, not a global limit
    const control = await burst((i) => ({ "x-forwarded-for": "198.51.100.1, 203.0.113." + (100 + i) }));
    assert.ok(control.every((s) => s === 200), "distinct edge hops were limited together: " + control.join(","));
    // 3. X-Real-IP (Railway documents it as the client's address) wins over any X-Forwarded-For the client varies
    const realIp = await burst((i) => ({ "x-real-ip": "203.0.113.77", "x-forwarded-for": "198.51.100." + (50 + i) + ", 198.51.101." + (50 + i) }));
    assert.equal(realIp[5], 429, "a varying X-Forwarded-For escaped a constant X-Real-IP: " + realIp.join(","));
    // 4. the replayed Railway set, with a client-forged left-most entry prepended each time: one bucket (its X-Real-IP)
    const rw = await burst((i) => ({ ...RAILWAY_SET, "x-real-ip": "203.0.113.9", "x-forwarded-for": "192.0.2." + (i + 1) + ", 203.0.113.9" }));
    assert.equal(rw[5], 429, "the replayed Railway set with a forged left-most entry got fresh buckets: " + rw.join(","));
    // nothing left the machine
    const guard = fs.existsSync(guardLog) ? fs.readFileSync(guardLog, "utf8").trim() : "";
    assert.equal(guard, "", "the child validator tried a non-loopback connection: " + guard.slice(0, 300));
  } finally {
    child.kill();
    await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* the database may be held for a moment on Windows */
    }
  }
});
