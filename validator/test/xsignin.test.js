"use strict";
// SIGN IN WITH X — the validator's thin stateless relay (validator/xsignin.js), in-process (an express app on an ephemeral
// port) against scripts/lib/x-api-stub.mjs (a loopback X OAuth 2.0 + API that checks PKCE S256, one-shot 30-second codes,
// exact callbacks, public vs confidential clients, and the fields asked of /2/users/me). Nothing here reaches X.
// Covered: dormant without X_CLIENT_ID (names, never values); a public-client exchange answers the six profile fields and
// REVOKES the token; a replayed code is refused by X and said as x_refused; only the armed client id is forwarded; a
// redirect that is not an https Totem callback, a malformed code or verifier is refused without calling X; a wrong
// verifier fails PKCE at X; a confidential client sends HTTP Basic and no client_id; /2/users/me failing still revokes;
// X unreachable is x_unreachable; the per-address cap; the API base rules; nothing logged carries a code, a verifier, a
// token or an account; the env contract keeps the secret off the public app.
//
// XSIGNIN_MODULE (scripts/unit-x-signin.mjs's mutation runs) points this file at a MUTATED COPY of the relay: every check
// below must then be able to fail.
for (const k of ["ZK_DEV_HOOKS", "NODE_ENV", "X_CLIENT_ID", "X_CLIENT_SECRET", "X_SIGNIN", "X_SIGNIN_API_URL", "LAYERS_HOSTED", "RAILWAY_ENVIRONMENT", "TRUST_PROXY"]) delete process.env[k];

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { createHash, randomBytes } = require("node:crypto");
const express = require("express");
const xs = require(process.env.XSIGNIN_MODULE || "../xsignin");
const vc = require("../env-contract");

const CALLBACK = "https://app.example.test/welcome/x";
let stubMod, stub, relay, base, logs, app, mounted;
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const s256 = (v) => b64url(createHash("sha256").update(v, "ascii").digest());

function arm(extra = {}) {
  process.env.X_CLIENT_ID = stubMod.STUB_CLIENT_ID;
  process.env.X_SIGNIN_API_URL = stub.url;
  delete process.env.X_CLIENT_SECRET;
  delete process.env.X_SIGNIN;
  Object.assign(process.env, extra);
}
function disarm() {
  for (const k of ["X_CLIENT_ID", "X_CLIENT_SECRET", "X_SIGNIN", "X_SIGNIN_API_URL", "LAYERS_HOSTED"]) delete process.env[k];
}

/** act as the visitor on X's consent page: a code for (verifier, callback), as X would redirect with it */
async function mintCode({ verifier = b64url(randomBytes(32)), redirectUri = CALLBACK, as = "alice" } = {}) {
  await fetch(stub.url + "/__stub/force", { method: "POST", body: JSON.stringify({ as }) });
  const state = b64url(randomBytes(24));
  const q = new URLSearchParams({ response_type: "code", client_id: stubMod.STUB_CLIENT_ID, redirect_uri: redirectUri, scope: "users.read tweet.read", state, code_challenge: s256(verifier), code_challenge_method: "S256" });
  const page = await (await fetch(stub.url + "/i/oauth2/authorize?" + q)).text();
  const m = /href="(\/i\/oauth2\/authorize\/approve\?req=[^"]+)"/.exec(page);
  assert.ok(m, "the stub's consent page has no Authorize link: " + page.slice(0, 200));
  const r = await fetch(stub.url + m[1], { redirect: "manual" });
  const loc = new URL(r.headers.get("location"));
  assert.equal(loc.searchParams.get("state"), state);
  return { code: loc.searchParams.get("code"), verifier, redirectUri };
}
const exchange = (body) => fetch(base + "/x/signin/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const stubState = () => fetch(stub.url + "/__stub/state").then((r) => r.json());

before(async () => {
  stubMod = await import(pathToFileURL(path.join(__dirname, "..", "..", "scripts", "lib", "x-api-stub.mjs")).href);
  stub = await stubMod.startXApiStub({ port: 0, redirects: [CALLBACK, "http://127.0.0.1:3999/welcome/x"], log: () => {} });
  logs = [];
  app = express();
  app.use(express.json());
  mounted = xs.mountXSignin(app, { log: { log: (...a) => logs.push(a.join(" ")) }, limits: { exchangesPerAddressHour: 1000, exchangesPerHour: 100000 } });
  await new Promise((resolve) => {
    relay = app.listen(0, "127.0.0.1", resolve);
  });
  base = "http://127.0.0.1:" + relay.address().port;
});
after(async () => {
  mounted.stop();
  await new Promise((r) => relay.close(r));
  await stub.close();
  disarm();
});
beforeEach(async () => {
  await fetch(stub.url + "/__stub/reset", { method: "POST" });
  disarm();
});

test("dormant: without X_CLIENT_ID the relay answers 503 not_armed with the missing NAMES and calls nothing", async () => {
  const c = await fetch(base + "/x/signin/config").then((r) => r.json());
  assert.equal(c.ready, false);
  assert.ok(c.problems.some((p) => /^X_CLIENT_ID is unset/.test(p)), JSON.stringify(c.problems));
  const r = await exchange({ code: "a".repeat(20), codeVerifier: "b".repeat(43), redirectUri: CALLBACK, clientId: "whatever-client" });
  assert.equal(r.status, 503);
  assert.equal(r.json.code, "not_armed");
  assert.equal((await stubState()).tokenCalls, 0);
  process.env.X_CLIENT_ID = stubMod.STUB_CLIENT_ID;
  process.env.X_SIGNIN = "off";
  assert.equal((await fetch(base + "/x/signin/config").then((r2) => r2.json())).ready, false, "X_SIGNIN=off is the kill switch");
});

test("a public-client exchange: the six profile fields, the token REVOKED, the minimal fields asked, nothing kept", async () => {
  arm();
  const { code, verifier } = await mintCode();
  const r = await exchange({ code, codeVerifier: verifier, redirectUri: CALLBACK, clientId: stubMod.STUB_CLIENT_ID });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(Object.keys(r.json).sort(), ["revoked", "user"]);
  assert.equal(r.json.revoked, true);
  assert.deepEqual(Object.keys(r.json.user).sort(), ["id", "name", "profile_image_url", "username", "verified", "verified_type"]);
  assert.equal(r.json.user.username, stubMod.STUB_X_USERS.alice.username);
  assert.ok(!JSON.stringify(r.json).includes("xstub-tok-"), "the access token reached the answer");
  const s = await stubState();
  assert.equal(s.tokens.issued, 1);
  assert.equal(s.tokens.revoked, 1, "the token was not revoked");
  assert.equal(s.lastFields, "profile_image_url,verified,verified_type");
  assert.deepEqual(s.violations, []);
});

test("a replayed code: X refuses it (invalid_grant) and the relay says x_refused — never a second token", async () => {
  arm();
  const { code, verifier } = await mintCode();
  const body = { code, codeVerifier: verifier, redirectUri: CALLBACK, clientId: stubMod.STUB_CLIENT_ID };
  assert.equal((await exchange(body)).status, 200);
  const again = await exchange(body);
  assert.equal(again.status, 400);
  assert.equal(again.json.code, "x_refused");
  assert.equal(again.json.xError, "invalid_grant");
  const s = await stubState();
  assert.equal(s.codes.replays, 1);
  assert.equal(s.tokens.issued, 1);
});

test("only the armed client id, an https Totem callback and well-formed code and verifier are forwarded (no X call otherwise)", async () => {
  arm();
  const { code, verifier } = await mintCode();
  const good = { code, codeVerifier: verifier, redirectUri: CALLBACK, clientId: stubMod.STUB_CLIENT_ID };
  const cases = [
    [{ ...good, clientId: "someone-elses-app" }, "wrong_client"],
    [{ ...good, redirectUri: "http://app.example.test/welcome/x" }, "bad_request"],
    [{ ...good, redirectUri: CALLBACK + "?next=/" }, "bad_request"],
    [{ ...good, redirectUri: "https://app.example.test/x/callback" }, "bad_request"],
    [{ ...good, redirectUri: "https://user:pw@app.example.test/welcome/x" }, "bad_request"],
    [{ ...good, codeVerifier: "short" }, "bad_request"],
    [{ ...good, code: "bad code with spaces" }, "bad_request"],
    [{ ...good, code: undefined }, "bad_request"],
  ];
  for (const [body, want] of cases) {
    const r = await exchange(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.code, want, JSON.stringify(body));
  }
  assert.equal((await stubState()).tokenCalls, 0, "a refused request reached X");
  // loopback http is a test callback, allowed only off a hosting platform
  const loop = await mintCode({ redirectUri: "http://127.0.0.1:3999/welcome/x" });
  assert.equal((await exchange({ code: loop.code, codeVerifier: loop.verifier, redirectUri: loop.redirectUri, clientId: stubMod.STUB_CLIENT_ID })).status, 200);
});

test("a wrong verifier fails PKCE at X (x_refused invalid_grant), and the code is spent", async () => {
  arm();
  const { code } = await mintCode();
  const r = await exchange({ code, codeVerifier: b64url(randomBytes(32)), redirectUri: CALLBACK, clientId: stubMod.STUB_CLIENT_ID });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "x_refused");
  assert.equal((await stubState()).codes.pkceFailed, 1);
});

test("a confidential client: HTTP Basic client_id:client_secret and no client_id in the body (X_CLIENT_SECRET, validator only)", async () => {
  arm({ X_CLIENT_SECRET: "stub-secret-0123456789" });
  await fetch(stub.url + "/__stub/force", { method: "POST", body: JSON.stringify({ secret: "stub-secret-0123456789" }) });
  const c = await fetch(base + "/x/signin/config").then((r) => r.json());
  assert.equal(c.confidential, true);
  assert.ok(!JSON.stringify(c).includes("stub-secret"), "the config answer carries the secret");
  const { code, verifier } = await mintCode();
  const r = await exchange({ code, codeVerifier: verifier, redirectUri: CALLBACK, clientId: stubMod.STUB_CLIENT_ID });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.revoked, true);
  // the stub refuses a confidential exchange that sends client_id in the body or no Basic header: a 200 proves both
  delete process.env.X_CLIENT_SECRET;
  const second = await mintCode();
  const pub = await exchange({ code: second.code, codeVerifier: second.verifier, redirectUri: CALLBACK, clientId: stubMod.STUB_CLIENT_ID });
  assert.equal(pub.status, 400, "a public-client exchange passed against a confidential app");
  assert.equal(pub.json.xError, "invalid_client");
});

test("users/me failing still REVOKES the token; X unreachable is x_unreachable", async () => {
  arm();
  await fetch(stub.url + "/__stub/force", { method: "POST", body: JSON.stringify({ usersMeDown: 1 }) });
  const { code, verifier } = await mintCode();
  const r = await exchange({ code, codeVerifier: verifier, redirectUri: CALLBACK, clientId: stubMod.STUB_CLIENT_ID });
  assert.equal(r.status, 502);
  assert.equal(r.json.code, "x_users_me");
  assert.equal(r.json.revoked, true);
  const s = await stubState();
  assert.equal(s.tokens.issued, 1);
  assert.equal(s.tokens.revoked, 1, "a token whose users/me failed was left alive");
  process.env.X_SIGNIN_API_URL = "http://127.0.0.1:9";
  const gone = await exchange({ code: "c".repeat(40), codeVerifier: "v".repeat(43), redirectUri: CALLBACK, clientId: stubMod.STUB_CLIENT_ID });
  assert.equal(gone.status, 502);
  assert.equal(gone.json.code, "x_unreachable");
});

test("the per-address cap: 429 with Retry-After past it", async () => {
  arm();
  const tight = express();
  tight.use(express.json());
  const m = xs.mountXSignin(tight, { log: { log: () => {} }, limits: { exchangesPerAddressHour: 2, exchangesPerHour: 100 } });
  const srv = await new Promise((resolve) => {
    const s = tight.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = "http://127.0.0.1:" + srv.address().port + "/x/signin/exchange";
  const body = JSON.stringify({ code: "c".repeat(40), codeVerifier: "v".repeat(43), redirectUri: CALLBACK, clientId: stubMod.STUB_CLIENT_ID });
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })).status);
  m.stop();
  await new Promise((r) => srv.close(r));
  assert.equal(codes[2], 429, JSON.stringify(codes));
});

test("the API base: https or loopback http off a hosting platform; a path, a query or credentials refused by NAME", () => {
  const ok = (v, extra = {}) => xs.xSigninConfig({ X_CLIENT_ID: stubMod.STUB_CLIENT_ID, X_SIGNIN_API_URL: v, ...extra });
  assert.equal(ok("").api, "https://api.x.com");
  assert.equal(ok("https://api.x.com").ready, true);
  assert.equal(ok("http://127.0.0.1:4338").ready, true);
  assert.equal(ok("http://127.0.0.1:4338", { RAILWAY_ENVIRONMENT: "production" }).ready, false, "a loopback base on a hosting platform");
  for (const bad of ["http://api.example.com", "https://api.x.com/2", "https://api.x.com?x=1", "https://u:p@api.x.com", "not a url"]) {
    const c = ok(bad);
    assert.equal(c.ready, false, bad);
    assert.ok(c.problems.every((p) => !p.includes(bad)), "a problem echoes the value: " + bad);
  }
  assert.equal(xs.xSigninConfig({ X_CLIENT_ID: "bad id!" }).ready, false);
});

test("nothing logged carries a code, a verifier, a token or the account; the only line is a count", async () => {
  arm();
  const { code, verifier } = await mintCode();
  await exchange({ code, codeVerifier: verifier, redirectUri: CALLBACK, clientId: stubMod.STUB_CLIENT_ID });
  const all = logs.join("\n");
  for (const needle of [code, verifier, "xstub-tok-", stubMod.STUB_X_USERS.alice.username, stubMod.STUB_X_USERS.alice.id]) assert.ok(!all.includes(needle), "a log line carries " + needle.slice(0, 12));
  const src = fs.readFileSync(require.resolve(process.env.XSIGNIN_MODULE || "../xsignin"), "utf8");
  const lines = src.split(/\r?\n/).filter((l) => /\blog\.(log|warn|error)\(|console\.(log|warn|error)\(/.test(l));
  assert.equal(lines.length, 1, "the relay logs more than its count line: " + lines.join(" | "));
  assert.ok(/sign-in\(s\) relayed/.test(lines[0]));
});

test("the env contract: the secret is the validator's (accepted here) and refused by the public app; the client id is public", () => {
  const pub = { NODE_ENV: "production", LAYERS_REQUIRE_SIG: "true", X_CLIENT_ID: stubMod.STUB_CLIENT_ID, X_CLIENT_SECRET: "stub-secret-0123456789" };
  assert.deepEqual(vc.contractViolations(pub), [], "the relay's names refused the validator");
  assert.ok(vc.X_SIGNIN_ACCEPTED.includes("X_CLIENT_SECRET") && vc.X_SIGNIN_ACCEPTED.includes("X_CLIENT_ID"));
  assert.ok(!vc.MUST_NOT_SHIP.includes("X_CLIENT_ID") && !vc.MUST_NOT_SHIP.includes("X_CLIENT_SECRET"));
  const ts = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "platform", "env-contract.ts"), "utf8");
  const appOnly = [...((ts.split("APP_ONLY_REFUSES: readonly string[] = [")[1] || "").split("];")[0].matchAll(/"([A-Z_]+)"/g))].map((m) => m[1]);
  assert.ok(appOnly.includes("X_CLIENT_SECRET") && !appOnly.includes("X_CLIENT_ID"), JSON.stringify(appOnly));
  // the rig request log keeps a sign-in's body as key names only
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(server.includes('req.path === "/x/signin/exchange" ? JSON.stringify(Object.keys(req.body))'), "the rig request log would keep a sign-in's code and verifier");
});
