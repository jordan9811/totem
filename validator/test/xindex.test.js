"use strict";
// PERSONA LAUNCH P2 (BYX G4) — the keyless X index job and its routes, against the LOCAL stub only.
// globalThis.fetch is wrapped for the whole file: a request to any host that is not loopback FAILS the test (the job's
// real sources are never reached; the stub answers in-process or on an ephemeral 127.0.0.1 port).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createHash } = require("node:crypto");
const express = require("express");
const { openDb } = require("../db");
const { mountXIndex, buildIndex, isLoopbackUrl, jobSources, checkVerification, FILE, META } = require("../xindex");

const realFetch = globalThis.fetch;
const offHost = [];
globalThis.fetch = async (u, init) => {
  const host = new URL(String(u)).hostname;
  if (!(host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]")) {
    offHost.push(String(u));
    throw new Error("TEST GUARD: a request left the machine: " + u);
  }
  return realFetch(u, init);
};

let synth;
let stubMod;
const dirs = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "layers-xindex-test-"));
  dirs.push(d);
  return d;
};
const quiet = { log() {}, warn() {}, error() {} };

before(async () => {
  synth = await import("../../scripts/lib/x-archive-synth.mjs");
  stubMod = await import("../../scripts/lib/x-index-stub.mjs");
});
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  globalThis.fetch = realFetch;
  assert.deepEqual(offHost, [], "no request may leave the machine");
});

/** an express app with ONLY the index mounted (devHooks as asked), on an ephemeral loopback port */
async function serve(opts) {
  const db = openDb(":memory:");
  const app = express();
  app.use(express.json({ limit: 262144 }));
  const ctl = mountXIndex(app, db, { log: quiet, ...opts });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return { db, ctl, base: "http://127.0.0.1:" + server.address().port, close: () => new Promise((r) => server.close(r)) };
}

const ROWS = () => synth.synthIndexRows({ noise: 2400 }); // 7 planted + 2,400 noise = 2,407 rows → 3 pages of 1,000

test("off by default: GET /x/fc-index is 503 'index not built' (never an empty index); meta says unavailable; no job timer", async () => {
  const prev = process.env.VALIDATOR_X_INDEX;
  delete process.env.VALIDATOR_X_INDEX;
  const s = await serve({ dir: tmpDir() });
  try {
    const r = await fetch(s.base + "/x/fc-index");
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: "index not built" });
    const m = await (await fetch(s.base + "/x/fc-index/meta")).json();
    assert.equal(m.available, false);
    assert.equal(m.rows, 0);
    assert.equal(m.job, "off");
    assert.equal(s.ctl.state.timer, null);
  } finally {
    if (prev !== undefined) process.env.VALIDATOR_X_INDEX = prev;
    await s.close();
  }
});

test("U6 build: 3 pages by cursor, the 429 honoured, rows deduplicated, fname mirror + release applied, coverage computed; served gzip with ETag and 304", async () => {
  const dir = tmpDir();
  const s = await serve({ dir });
  const rows = ROWS();
  // a duplicate row (same fid + X id) must not be counted twice; a released fname must not be served
  const stub = stubMod.createIndexStub({ rows: [...rows, { ...rows[3] }], extraTransfers: [{ username: "planted-three", to: 0 }] });
  const base = "http://stub.test";
  const sleeps = [];
  try {
    const meta = await buildIndex(s.db, s.ctl.state, { sourceUrl: base, fnamesUrl: base, fetchImpl: stub.fetchFor(base), sleep: async (ms) => sleeps.push(ms), minIntervalMs: 0, log: quiet });
    assert.equal(meta.rows, 2407, "every distinct fid+X id once");
    assert.equal(meta.pages, 3);
    const verifCalls = stub.state.calls.filter((c) => c.path === "/fc/account-verifications");
    assert.equal(verifCalls.length, 4, "3 pages + the one 429 retried");
    assert.ok(sleeps.includes(1000), "the Retry-After of 1 s was honoured: " + JSON.stringify(sleeps.slice(0, 8)));
    assert.equal(meta.lastError, null);
    assert.ok(meta.fnameCoverage > 0.5 && meta.fnameCoverage < 1, "coverage computed: " + meta.fnameCoverage);
    // the file on disk is what the route serves, and its hash is the ETag
    const gz = fs.readFileSync(path.join(dir, FILE));
    assert.equal(createHash("sha256").update(gz).digest("hex"), meta.sha256);
    const doc = JSON.parse(zlib.gunzipSync(gz).toString("utf8"));
    assert.equal(doc.rows, 2407);
    const xid = doc.xid.split(","), fn = doc.fn.split(","), fid = doc.fid.split(",");
    assert.equal(xid.length, 2407);
    assert.ok(xid.includes("9615352") && xid.includes("21711443") && xid.includes("11813582"), "the three real ids, as strings");
    assert.equal(fn[xid.indexOf("1600000000000000003")], "", "the released fname is not served");
    assert.equal(fn[xid.indexOf("1600000000000000001")], "planted-one");
    assert.equal(fid[xid.indexOf("9615352")], "3");
    const r = await fetch(s.base + "/x/fc-index");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("etag"), '"' + meta.sha256 + '"');
    assert.match(r.headers.get("cache-control") || "", /max-age=3600/);
    const served = await r.json(); // fetch undoes the gzip
    assert.equal(served.rows, 2407);
    const again = await fetch(s.base + "/x/fc-index", { headers: { "If-None-Match": '"' + meta.sha256 + '"' } });
    assert.equal(again.status, 304);
    const m = await (await fetch(s.base + "/x/fc-index/meta")).json();
    assert.equal(m.available, true);
    assert.equal(m.rows, 2407);
  } finally {
    await s.close();
  }
});

test("U6 abort: a schema break (a NUMBER X id) aborts the run; the previous file keeps being served; meta.lastError names the page", async () => {
  const dir = tmpDir();
  const s = await serve({ dir });
  const base = "http://stub.test";
  try {
    const good = stubMod.createIndexStub({ rows: ROWS(), throttleOnce: false });
    const first = await buildIndex(s.db, s.ctl.state, { sourceUrl: base, fnamesUrl: base, fetchImpl: good.fetchFor(base), sleep: async () => {}, minIntervalMs: 0, log: quiet });
    const broken = stubMod.createIndexStub({ rows: ROWS(), throttleOnce: false, breakPage: 2 });
    await assert.rejects(
      buildIndex(s.db, s.ctl.state, { sourceUrl: base, fnamesUrl: base, fetchImpl: broken.fetchFor(base), sleep: async () => {}, minIntervalMs: 0, log: quiet }),
      /X id is not a string of digits/
    );
    const r = await fetch(s.base + "/x/fc-index");
    assert.equal(r.status, 200, "the previous index is still served");
    assert.equal(r.headers.get("etag"), '"' + first.sha256 + '"');
    const m = await (await fetch(s.base + "/x/fc-index/meta")).json();
    assert.equal(m.rows, first.rows);
    assert.equal(m.lastError.page, 2);
    assert.match(m.lastError.reason, /page 2/);
    // a malformed row never becomes part of an index: the checker refuses each shape
    assert.ok(checkVerification({ fid: 3, platformId: 9615352, platformUsername: "dwr", verifiedAt: 1 }));
    assert.ok(checkVerification({ fid: -1, platformId: "1", platformUsername: "a", verifiedAt: 1 }));
    assert.ok(checkVerification({ fid: 3, platformId: "1", platformUsername: "a,b", verifiedAt: 1 }));
    assert.equal(checkVerification({ fid: 3, platform: "x", platformId: "9615352", platformUsername: "dwr", verifiedAt: 1741629060 }), null);
  } finally {
    await s.close();
  }
});

test("the rig's build route refuses any non-loopback source and builds from a loopback stub over real HTTP", async () => {
  const s = await serve({ dir: tmpDir(), devHooks: true });
  const live = await stubMod.startIndexStub({ rows: ROWS() });
  try {
    assert.ok(!stubMod.FORBIDDEN_PORTS.has(live.port));
    for (const [sourceUrl, fnamesUrl] of [
      ["https://api.farcaster.xyz", "https://fnames.farcaster.xyz"],
      [live.url, "https://fnames.farcaster.xyz"],
      ["http://10.0.0.5:9", live.url],
      ["file:///etc/passwd", live.url],
    ]) {
      const r = await fetch(s.base + "/x/fc-index/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl, fnamesUrl }) });
      assert.equal(r.status, 400, "refused: " + sourceUrl + " / " + fnamesUrl);
    }
    const ok = await fetch(s.base + "/x/fc-index/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl: live.url, fnamesUrl: live.url, minIntervalMs: 50 }) });
    const j = await ok.json();
    assert.equal(ok.status, 200, JSON.stringify(j));
    assert.equal(j.meta.rows, 2407);
    assert.equal((await fetch(s.base + "/x/fc-index")).status, 200);
    const cl = await fetch(s.base + "/x/fc-index/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(cl.status, 200);
    assert.equal((await fetch(s.base + "/x/fc-index")).status, 503, "cleared means not built");
  } finally {
    await live.close();
    await s.close();
  }
  // a validator without dev hooks has no build route at all
  const pub = await serve({ dir: tmpDir(), devHooks: false });
  try {
    const r = await fetch(pub.base + "/x/fc-index/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(r.status, 404);
    const c = await fetch(pub.base + "/x/fc-index/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(c.status, 404, "no clear route without dev hooks");
  } finally {
    await pub.close();
  }
});

test("the job's source overrides are LOCAL ONLY: ignored on a hosted platform", () => {
  const warned = [];
  const log = { warn: (m) => warned.push(m), log() {}, error() {} };
  const local = jobSources({ VALIDATOR_X_INDEX_SOURCE_URL: "http://127.0.0.1:5555" }, log);
  assert.equal(local.sourceUrl, "http://127.0.0.1:5555");
  const hosted = jobSources({ RAILWAY_ENVIRONMENT: "production", VALIDATOR_X_INDEX_SOURCE_URL: "http://127.0.0.1:5555", VALIDATOR_X_INDEX_FNAMES_URL: "http://127.0.0.1:5556" }, log);
  assert.equal(hosted.sourceUrl, "https://api.farcaster.xyz");
  assert.equal(hosted.fnamesUrl, "https://fnames.farcaster.xyz");
  assert.equal(warned.length, 2);
  assert.equal(isLoopbackUrl("http://127.0.0.1:1/x"), true);
  assert.equal(isLoopbackUrl("http://localhost:1"), true);
  assert.equal(isLoopbackUrl("https://api.farcaster.xyz"), false);
  assert.equal(isLoopbackUrl("http://127.0.0.1.evil.example/"), false);
});

test("a damaged file on disk is never served (its hash must match the meta)", async () => {
  const dir = tmpDir();
  const s = await serve({ dir });
  const base = "http://stub.test";
  try {
    const stub = stubMod.createIndexStub({ rows: ROWS(), throttleOnce: false });
    await buildIndex(s.db, s.ctl.state, { sourceUrl: base, fnamesUrl: base, fetchImpl: stub.fetchFor(base), sleep: async () => {}, minIntervalMs: 0, log: quiet });
  } finally {
    await s.close();
  }
  const gz = fs.readFileSync(path.join(dir, FILE));
  fs.writeFileSync(path.join(dir, FILE), gz.subarray(0, gz.length - 10)); // truncated
  const s2 = await serve({ dir });
  try {
    assert.equal((await fetch(s2.base + "/x/fc-index")).status, 503);
    assert.ok(fs.existsSync(path.join(dir, META)));
  } finally {
    await s2.close();
  }
});
