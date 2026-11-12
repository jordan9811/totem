"use strict";
// CRYPTO PASS — device-auth chain unit tests, in-memory DB, ARMED
// (LAYERS_REQUIRE_SIG set before the server module loads, which is when
// it captures the flag). Keys are minted with node:crypto's native
// Ed25519 — a deliberate second implementation against the validator's
// verify path: node signs, OpenSSL-SPKI verify checks, and the canonical
// forms are duplicated in-file so a drift in either fails loudly.
process.env.LAYERS_REQUIRE_SIG = "true";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign: cryptoSign, createHash, randomBytes } = require("node:crypto");
const { createApp } = require("../server");

let server;
let base;

before(async () => {
  const { app } = createApp(":memory:");
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = "http://127.0.0.1:" + server.address().port;
});

after(() => server.close());

async function api(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// raw 32-byte pub hex from a node KeyObject (strip the 12-byte SPKI prefix)
function mkKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
}
const signHex = (canonical, privateKey) =>
  cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");

// deliberate duplicates of validator/crypto.js canonical forms
const delegationCanonical = (d) =>
  ["layers-device-delegation/1", d.deviceId, d.devicePubKey, d.scopes.join(","), String(d.issuedAt), String(d.expiresAt ?? "")].join("|");
const envelopeCanonical = (ns, bodyHash, counter) =>
  ["layers-envelope/1", ns, bodyHash, String(counter)].join("|");
const revokeCanonical = (deviceId, issuedAt) =>
  ["layers-device-revoke/1", deviceId, String(issuedAt)].join("|");

const anchor = mkKeys();

function makeDelegation(devicePubKey, deviceId, { expiresAt = null, scopes = ["state-write"] } = {}) {
  const base_ = { v: 1, deviceId, devicePubKey, scopes, issuedAt: Date.now(), expiresAt };
  return { ...base_, signature: signHex(delegationCanonical(base_), anchor.privateKey) };
}

function envelopeHeaders(device, deviceId, ns, entries, counter) {
  const bodyHash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  return {
    "x-layers-device": deviceId,
    "x-layers-counter": String(counter),
    "x-layers-sig": signHex(envelopeCanonical(ns, bodyHash, counter), device.privateKey),
  };
}

test("anchor registration: one anchor per root — idempotent for the same key; a second root's anchor is its own, with its own state", async () => {
  const a = await api("POST", "/device/auth-anchor", { pubkey: anchor.pubHex });
  assert.equal(a.status, 201);
  const same = await api("POST", "/device/auth-anchor", { pubkey: anchor.pubHex });
  assert.equal(same.status, 200);
  assert.equal(same.json.existing, true);
  const other = mkKeys();
  const second = await api("POST", "/device/auth-anchor", { pubkey: other.pubHex });
  assert.equal(second.status, 201); // a stranger's anchor is their own root, never a conflict with ours
  const dev = mkKeys();
  const deviceId = "dev_tenant_" + randomBytes(3).toString("hex");
  const base_ = { v: 1, deviceId, devicePubKey: dev.pubHex, scopes: ["state-write"], issuedAt: Date.now(), expiresAt: null };
  const delegation = { ...base_, signature: signHex(delegationCanonical(base_), other.privateKey) };
  assert.equal((await api("POST", "/device/register", { delegation, anchorPubKey: other.pubHex })).status, 201);
  const entries = { tenant: 2 };
  const counter = Date.now();
  assert.equal((await api("PUT", "/state/tenantNs", { entries }, envelopeHeaders(dev, deviceId, "tenantNs", entries, counter))).status, 200);
  const emptyHash = createHash("sha256").update("").digest("hex");
  const mine = await api("GET", "/state/tenantNs", undefined, {
    "x-layers-device": deviceId,
    "x-layers-counter": String(counter + 1),
    "x-layers-sig": signHex(envelopeCanonical("tenantNs", emptyHash, counter + 1), dev.privateKey),
  });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.json.entries, entries);
  const bare = await api("GET", "/state/tenantNs");
  assert.equal(bare.status, 401); // armed and no dev hooks: unsigned reads are refused
});

test("delegation: valid registers; tampered and expired are refused", async () => {
  const dev = mkKeys();
  const good = makeDelegation(dev.pubHex, "dev_t1");
  assert.equal((await api("POST", "/device/register", { anchorPubKey: anchor.pubHex, delegation: good })).status, 201);

  const tampered = { ...makeDelegation(dev.pubHex, "dev_t2"), scopes: ["state-write", "everything"] };
  assert.equal((await api("POST", "/device/register", { anchorPubKey: anchor.pubHex, delegation: tampered })).status, 403);

  const expired = makeDelegation(dev.pubHex, "dev_t3", { expiresAt: Date.now() - 1000 });
  assert.equal((await api("POST", "/device/register", { anchorPubKey: anchor.pubHex, delegation: expired })).status, 403);
});

test("unsigned state writes are refused when armed", async () => {
  const r = await api("PUT", "/state/probeNs", { entries: { a: 1 } });
  assert.equal(r.status, 401);
});

test("envelope: accepted, then replay/tamper/unknown-device refused", async () => {
  const dev = mkKeys();
  const deviceId = "dev_env_" + randomBytes(3).toString("hex");
  await api("POST", "/device/register", { anchorPubKey: anchor.pubHex, delegation: makeDelegation(dev.pubHex, deviceId) });

  const entries = { rec: { hello: "world" } };
  const counter = Date.now();
  const okPut = await api("PUT", "/state/probeNs", { entries }, envelopeHeaders(dev, deviceId, "probeNs", entries, counter));
  assert.equal(okPut.status, 200);

  // replay: same counter
  const replay = await api("PUT", "/state/probeNs", { entries }, envelopeHeaders(dev, deviceId, "probeNs", entries, counter));
  assert.equal(replay.status, 409);

  // tamper: signature covers different body than sent
  const headers = envelopeHeaders(dev, deviceId, "probeNs", entries, counter + 1);
  const evil = await api("PUT", "/state/probeNs", { entries: { rec: { hello: "attacker" } } }, headers);
  assert.equal(evil.status, 401);

  // unknown device
  const ghost = await api("PUT", "/state/probeNs", { entries }, envelopeHeaders(dev, "dev_ghost", "probeNs", entries, counter + 2));
  assert.equal(ghost.status, 401);
});

test("counters are per-namespace, not global", async () => {
  const dev = mkKeys();
  const deviceId = "dev_ns_" + randomBytes(3).toString("hex");
  await api("POST", "/device/register", { anchorPubKey: anchor.pubHex, delegation: makeDelegation(dev.pubHex, deviceId) });
  const entries = { x: 1 };
  const c = Date.now();
  assert.equal(
    (await api("PUT", "/state/nsA", { entries }, envelopeHeaders(dev, deviceId, "nsA", entries, c))).status,
    200
  );
  // the SAME counter value is fine for a different namespace
  assert.equal(
    (await api("PUT", "/state/nsB", { entries }, envelopeHeaders(dev, deviceId, "nsB", entries, c))).status,
    200
  );
});

test("revocation: forward-looking refusal; revoked id cannot re-register", async () => {
  const dev = mkKeys();
  const deviceId = "dev_rev_" + randomBytes(3).toString("hex");
  const delegation = makeDelegation(dev.pubHex, deviceId);
  await api("POST", "/device/register", { delegation, anchorPubKey: anchor.pubHex });

  const entries = { pre: true };
  assert.equal(
    (await api("PUT", "/state/revNs", { entries }, envelopeHeaders(dev, deviceId, "revNs", entries, Date.now()))).status,
    200
  );

  const issuedAt = Date.now();
  const rev = await api("POST", "/device/revoke", {
    deviceId,
    issuedAt,
    signature: signHex(revokeCanonical(deviceId, issuedAt), anchor.privateKey),
  });
  assert.equal(rev.status, 200);

  const after_ = await api(
    "PUT",
    "/state/revNs",
    { entries },
    envelopeHeaders(dev, deviceId, "revNs", entries, Date.now() + 5)
  );
  assert.equal(after_.status, 403);

  // permanent per id: a fresh delegation for the same id is refused
  const reReg = await api("POST", "/device/register", { anchorPubKey: anchor.pubHex, delegation: makeDelegation(dev.pubHex, deviceId) });
  assert.equal(reReg.status, 403);

  // a forged revocation (wrong key) never sticks
  const dev2 = mkKeys();
  const deviceId2 = "dev_rev2_" + randomBytes(3).toString("hex");
  await api("POST", "/device/register", { anchorPubKey: anchor.pubHex, delegation: makeDelegation(dev2.pubHex, deviceId2) });
  const forged = await api("POST", "/device/revoke", {
    deviceId: deviceId2,
    issuedAt: Date.now(),
    signature: signHex(revokeCanonical(deviceId2, Date.now()), dev2.privateKey), // device key, not anchor
  });
  assert.equal(forged.status, 403);
});

test("DELETE /state requires the envelope when armed", async () => {
  const bare = await api("DELETE", "/state");
  assert.equal(bare.status, 401);
  const dev = mkKeys();
  const deviceId = "dev_del_" + randomBytes(3).toString("hex");
  await api("POST", "/device/register", { anchorPubKey: anchor.pubHex, delegation: makeDelegation(dev.pubHex, deviceId) });
  const bodyHash = createHash("sha256").update("").digest("hex");
  const counter = Date.now();
  const r = await api("DELETE", "/state", undefined, {
    "x-layers-device": deviceId,
    "x-layers-counter": String(counter),
    "x-layers-sig": signHex(envelopeCanonical("*", bodyHash, counter), dev.privateKey),
  });
  assert.equal(r.status, 200);
});
