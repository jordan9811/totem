"use strict";
// PERSONA LAUNCH wave 3 (verify) — THE RIG'S SEED RESET CLEARS PERSONA-LEVEL BLOCKS (validator/server.js DELETE /state).
//
// Why: blocks_v2 rows survived every seed reset, so the rig drifted across sweeps — accept-z9 blocks a NEW fixture persona
// as the seeded self on every run, and by the wave-3 build sweep the seeded self had blocked the authors of all 15 fixture
// casts (its feed pages came back empty, the timeline paged forever, every networkidle page load timed out). The seed
// baseline has no blocks, so the reset clears them — ONLY under ZK_DEV_HOOKS (the rig). Without dev hooks (a public
// deployment, the owner service) DELETE /state wipes the caller's adapter state and nothing else: a block stays.
//
// Real validator (createApp over a temp database, an ephemeral loopback port — never a pinned one); no network.
process.env.ZK_DEV_HOOKS = "true";
delete process.env.LAYERS_REQUIRE_SIG;

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createApp } = require("../server");

let dir;
let db;
let server;
let base;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "layers-seedreset-test-"));
  let app;
  ({ app, db } = createApp(path.join(dir, "v.db")));
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = "http://127.0.0.1:" + server.address().port;
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
function persona(id) {
  db.prepare("INSERT OR IGNORE INTO personas (id, name, handle, avatar_url, bio, created_at) VALUES (?, ?, ?, NULL, '', ?)").run(id, id, "h_" + id, Date.now());
}

test("the rig's seed reset (DELETE /state under ZK_DEV_HOOKS) clears every persona-level block — and only after the block is shown to exist", async () => {
  persona("p_seedreset_self");
  persona("p_seedreset_other");
  for (const target of ["p_seedreset_author_1", "p_seedreset_author_2"]) {
    const b = await api("POST", "/block", { blockerPersona: "p_seedreset_self", blockedPersona: target });
    assert.equal(b.status, 201, "block: " + JSON.stringify(b.json));
  }
  assert.equal((await api("POST", "/block", { blockerPersona: "p_seedreset_other", blockedPersona: "p_seedreset_self" })).status, 201);
  // the control: the blocks are there before the reset (a reset of nothing would pass the check below vacuously)
  const before = await api("GET", "/blocked/p_seedreset_self");
  assert.deepEqual(before.json.personaIds.sort(), ["p_seedreset_author_1", "p_seedreset_author_2"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM blocks_v2").get().n, 3);
  assert.equal((await api("DELETE", "/state")).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM blocks_v2").get().n, 0, "the seed reset left blocks behind");
  assert.deepEqual((await api("GET", "/blocked/p_seedreset_self")).json.personaIds, []);
  assert.deepEqual((await api("GET", "/blocked/p_seedreset_other")).json.personaIds, []);
  // the personas themselves are not seed rows of this reset: they stay (the reset clears blocks, not who exists)
  assert.equal((await api("GET", "/blocked/p_seedreset_self")).status, 200);
  // and blocking works again afterwards (the table is emptied, not dropped)
  assert.equal((await api("POST", "/block", { blockerPersona: "p_seedreset_self", blockedPersona: "p_seedreset_author_1" })).status, 201);
  assert.deepEqual((await api("GET", "/blocked/p_seedreset_self")).json.personaIds, ["p_seedreset_author_1"]);
});

test("WITHOUT dev hooks (a public deployment, the owner service) DELETE /state leaves every block where it was", () => {
  // a separate process: ZK_DEV_HOOKS is read once, when validator/server.js loads
  const db2 = path.join(dir, "nohooks.db");
  const script = `
    const { createApp } = require(${JSON.stringify(path.join(__dirname, "..", "server.js"))});
    const { app, db } = createApp(${JSON.stringify(db2)});
    db.prepare("INSERT INTO personas (id, name, handle, avatar_url, bio, created_at) VALUES ('p_nh_self', 'x', 'h_nh', NULL, '', 0)").run();
    db.prepare("INSERT INTO blocks_v2 (blocker_persona, blocked_persona, created_at) VALUES ('p_nh_self', 'p_nh_author', 0)").run();
    const s = app.listen(0, "127.0.0.1", async () => {
      const r = await fetch("http://127.0.0.1:" + s.address().port + "/state", { method: "DELETE" });
      const n = db.prepare("SELECT COUNT(*) AS n FROM blocks_v2").get().n;
      process.stdout.write(JSON.stringify({ status: r.status, blocks: n }));
      s.close(); db.close(); process.exit(0);
    });`;
  const env = { ...process.env };
  delete env.ZK_DEV_HOOKS;
  delete env.LAYERS_REQUIRE_SIG;
  const out = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8", timeout: 60_000 });
  const line = (out.stdout || "").trim().split("\n").pop();
  let got = null;
  try {
    got = JSON.parse(line);
  } catch {
    assert.fail("the no-hooks validator did not answer: " + (out.stderr || "").slice(-400));
  }
  assert.equal(got.status, 200, "DELETE /state without dev hooks");
  assert.equal(got.blocks, 1, "a block was wiped without dev hooks");
});

// PERSONA LAUNCH wave 3 (W3-BLOCKS-WIPE-OWNER): the OWNER service's validator runs with ZK_DEV_HOOKS=true AND
// LAYERS_WORLD=empty (railway/Dockerfile.owner-validator). Dev hooks alone used to make DELETE /state the rig's seed reset
// there too — an unscoped DELETE FROM blocks_v2 (and the fixture rows) on the owner's real data, guarded only by the APP's
// refusal. The validator now keeps the seed-reset branch to an UNSET LAYERS_WORLD (the rig's). Same shape as the no-hooks
// test above (a separate process: the env is read when validator/server.js loads), plus its MUTATION: the same flow
// against a copy of server.js with the world guard removed must wipe the block — so this test cannot pass vacuously.
function ownerShapeRun(mutate) {
  const db3 = path.join(dir, (mutate ? "owner-mut-" : "owner-") + process.pid + ".db");
  const serverFile = path.join(__dirname, "..", "server.js");
  const script = `
    const fs = require("node:fs");
    const Module = require("node:module");
    const file = ${JSON.stringify(serverFile)};
    let src = fs.readFileSync(file, "utf8").split(String.fromCharCode(13)).join("");
    const guard = 'if (process.env.LAYERS_WORLD !== undefined) return res.json({ ok: true });';
    if (${mutate ? "true" : "false"}) {
      if (!src.includes(guard)) { process.stdout.write("RESULT " + JSON.stringify({ error: "guard anchor not found" })); process.exit(0); }
      src = src.split(guard).join("");
    }
    const m = new Module(file, null);
    m.filename = file;
    m.paths = Module._nodeModulePaths(require("node:path").dirname(file));
    m._compile(src, file);
    const { app, db } = m.exports.createApp(${JSON.stringify(db3)});
    db.prepare("INSERT INTO personas (id, name, handle, avatar_url, bio, created_at) VALUES ('p_own_self', 'x', 'h_own', NULL, '', 0)").run();
    db.prepare("INSERT INTO blocks_v2 (blocker_persona, blocked_persona, created_at) VALUES ('p_own_self', 'p_own_author', 0)").run();
    const s = app.listen(0, "127.0.0.1", async () => {
      const r = await fetch("http://127.0.0.1:" + s.address().port + "/state", { method: "DELETE" });
      const n = db.prepare("SELECT COUNT(*) AS n FROM blocks_v2").get().n;
      process.stdout.write("RESULT " + JSON.stringify({ status: r.status, blocks: n }));
      s.close(); db.close(); process.exit(0);
    });`;
  const env = { ...process.env, ZK_DEV_HOOKS: "true", LAYERS_WORLD: "empty" };
  delete env.LAYERS_REQUIRE_SIG;
  const out = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8", timeout: 60_000 });
  const line = (out.stdout || "").split("RESULT ").pop();
  try {
    return JSON.parse(line);
  } catch {
    return { error: "no answer: " + (out.stderr || "").slice(-400) };
  }
}

test("THE OWNER SHAPE (ZK_DEV_HOOKS=true with LAYERS_WORLD=empty): DELETE /state leaves every persona block where it was; MUTATION: without the validator's world guard the same flow wipes it", () => {
  const got = ownerShapeRun(false);
  assert.ok(!got.error, got.error);
  assert.equal(got.status, 200, "DELETE /state on the owner shape");
  assert.equal(got.blocks, 1, "the owner's block was wiped by a DELETE /state under dev hooks");
  const mut = ownerShapeRun(true);
  assert.ok(!mut.error, mut.error);
  assert.equal(mut.blocks, 0, "the mutated copy (no world guard) kept the block — the check above would pass without the guard");
});
