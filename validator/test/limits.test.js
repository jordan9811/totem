"use strict";
// PERSONA LAUNCH P2 (BYX G1) — the state body limit is deliberate, and its refusal is JSON that names it.
//   - a 300 KB PUT /state/x is refused 413 with {error:"body too large", limit:262144, namespace:"x"} (JSON, not
//     express's HTML page — the old client could only drop that answer without a word);
//   - a 200 KB PUT is accepted (200);
//   - MUTATION (non-vacuity of the 200 KB case): the SAME 200 KB body against express's DEFAULT parser (100 KB) is
//     refused — so the 200 KB acceptance above can only pass because the limit was raised on purpose;
//   - the app's persist client carries the same constant (lib/adapters/mock/persist.ts), asserted equal here by text.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { createApp } = require("../server");
const { STATE_BODY_LIMIT_BYTES, bodyLimitErrorHandler } = require("../limits");

let server;
let base;
before(async () => {
  const { app } = createApp(":memory:");
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = "http://127.0.0.1:" + server.address().port;
});
after(() => server.close());

const bodyOf = (bytes) => {
  // {"entries":{"k":"xxxx…"}} sized to `bytes` on the wire
  const shell = JSON.stringify({ entries: { k: "" } }).length;
  return JSON.stringify({ entries: { k: "x".repeat(bytes - shell) } });
};

test("the limit is 256 KiB, and the app's copy says the same", () => {
  assert.equal(STATE_BODY_LIMIT_BYTES, 262144);
  const persist = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "adapters", "mock", "persist.ts"), "utf8");
  const m = /export const STATE_BODY_LIMIT_BYTES = (\d+);/.exec(persist);
  assert.ok(m, "persist.ts exports STATE_BODY_LIMIT_BYTES");
  assert.equal(Number(m[1]), STATE_BODY_LIMIT_BYTES);
});

test("a 300 KB PUT is refused 413 in JSON naming the limit and the namespace", async () => {
  const body = bodyOf(300 * 1024);
  assert.ok(body.length > STATE_BODY_LIMIT_BYTES);
  const res = await fetch(base + "/state/x", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
  assert.equal(res.status, 413);
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  const j = await res.json();
  assert.deepEqual(j, { error: "body too large", limit: 262144, namespace: "x" });
});

test("a 200 KB PUT is accepted and stored", async () => {
  const body = bodyOf(200 * 1024);
  const res = await fetch(base + "/state/xok", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
  assert.equal(res.status, 200);
  const back = await (await fetch(base + "/state/xok")).json();
  assert.equal(back.entries.k.length, JSON.parse(body).entries.k.length);
});

test("MUTATION: express's default parser refuses the same 200 KB body (the 200 KB case is not vacuous)", async () => {
  const app = express();
  app.use(express.json()); // the default, 100 KB — what server.js had before
  app.use(bodyLimitErrorHandler);
  app.put("/state/:ns", (req, res) => res.json({ ok: true }));
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const res = await fetch("http://127.0.0.1:" + srv.address().port + "/state/x", { method: "PUT", headers: { "Content-Type": "application/json" }, body: bodyOf(200 * 1024) });
    assert.equal(res.status, 413, "the default parser must refuse 200 KB, or the acceptance above proves nothing");
  } finally {
    srv.close();
  }
});

test("a non-state route's oversized body is refused the same way (namespace null), never as an HTML page", async () => {
  const res = await fetch(base + "/personas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "x".repeat(300 * 1024), handle: "h" }) });
  assert.equal(res.status, 413);
  const j = await res.json();
  assert.equal(j.error, "body too large");
  assert.equal(j.namespace, null);
});
