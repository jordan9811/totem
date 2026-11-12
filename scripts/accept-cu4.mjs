// BROWSER KEYSTORE PASS Gate 4 — the readiness audit re-run, rate limits, the production environment contract.
// Run against the PRODUCTION-SHAPED pair (att-run-prod: NODE_ENV=production, no ZK_DEV_HOOKS, LAYERS_REQUIRE_SIG=true).
//   1. the two contract lists (TypeScript for the app, CJS for the validator) are identical
//   2. .env.production.example carries names only
//   3. the readiness audit, driven through the page, flips every finding on this pair (its JSON output is asserted)
//   4. the secrets audit is clean
//   5. RATE LIMIT (app): a burst of 260 API requests meets 429s with Retry-After; liveness is never throttled; a
//      request after the refill window succeeds
//   6. RATE LIMIT (validator): a burst of 340 meets 429s; /health is never throttled — on a THROWAWAY validator with the
//      shipped defaults (300 burst, 5/s): the pair's own bucket is raised for local runs (scripts/run-prod-shape.sh)
//   7. BOOT CHECK (app): a public deployment with a must-not-ship variable set refuses to start, naming the
//      variable and not its value; one without LAYERS_REQUIRE_SIG=true refuses too (the must-be-set half of the
//      contract, attack-custody-1 #5); a clean environment starts
//   8. BOOT CHECK (validator): the same
//   9. RATE LIMIT is keyed by the socket address: bursts carrying distinct X-Forwarded-For / X-Real-IP values are
//      still limited on both processes, because neither trusts those headers unless TRUST_PROXY=true
//      (attack-custody-1 #6, attack-custody-2 #7, attack-custody-3 #6)
//
// FC-READ (the public live-read relay, lib/fc/readRelay.server.ts) — the contract's new edges, each with its
// precondition asserted first so none can pass by accident (the design's list of vacuous tests is binding):
//  10. BOOT CHECK (validator): NEYNAR_READ_API_KEY is REFUSED on a public validator (validator/env-contract.js
//      VALIDATOR_REFUSES), named, its value never printed — after the same environment without it boots clean
//  11. BOOT CHECK (app): NEYNAR_VIEWER_FID is refused on a public app (the owner's real fid there would hand every
//      visitor their graph), named, value unprinted; and the app boots WITH a (fake) read key AND its relay ARMS on
//      it and reaches a loopback stub — "it boots" alone is trivially true under a denylist
//  12. THE RELAY STAYS UNARMED, and the process stays UP (misconfiguration disarms, it never exits): with
//      NEYNAR_READ_BASE_URL on a hosted-looking environment (bad_base_url, and the stub it names is never called),
//      with it pointing at a non-loopback host (bad_base_url), and with a malformed key (bad_key)
//  13. the public boot baseline (`pub` below) blanks every name either contract refuses, the new ones included
// PERSONA LAUNCH GO-LIVE:
//  14. NEAR MISSES for the eight owner-service-only live names (X_LAYERS_API_KEY, X_LAYERS_API_SECRET,
//      X_LAYERS_ACCESS_TOKEN, X_LAYERS_ACCESS_SECRET, X_LIVE, X_LIVE_REPLIES, REGISTRAR_LIVE, REGISTRAR_WINDOW): each one SET
//      refuses a public validator and a public app (named, its value never printed); each one at an OFF value ("",
//      false, 0, off, no — rotated) boots the validator, and the app boots with all eight at OFF values. The precondition
//      is asserted first: the same environment with the name unset boots (so a refusal is the name's and nothing else's).
// PUBLIC GO-LIVE (the relay track):
//  15. THE ONE RELAY CREDENTIAL, BOTH WAYS. The public VALIDATOR accepts the anon agent's account (FC_ANON_FID,
//      FC_ANON_SIGNER_UUID, FC_ANON_NEYNAR_KEY) and the switch ZK_ANON_RELAY_LIVE: with all four SET (fake, well-formed) it
//      boots, and its public status names the AGENT relay path (so the values reached it — "it boots" alone would be
//      trivially true for names no list mentions), its output never printing the key or the signer. The public APP refuses
//      the signer and the key (lib/platform/env-contract.ts APP_ONLY_REFUSES) — each SET alone refuses it, named, value
//      unprinted; at OFF values the app boots. The precondition first: the app environment with both blank boots. The
//      validator beside the relay credential still refuses NEYNAR_API_KEY (the second write credential), named.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { RELAY, startNeynarStub, stubDiscoveryFids } from "./lib/neynar-stub.mjs";

const BASE = process.env.BASE_URL || `http://127.0.0.1:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => { const r = await fetch(url, { cache: "no-store" }); return { status: r.status, retryAfter: r.headers.get("retry-after"), json: await r.json().catch(() => null) }; };

console.log("\nGate 4 — readiness audit, rate limits, environment contract (app " + BASE + ", validator " + VBASE + ")");
const dev = await get(BASE + "/api/dev").catch(() => ({ status: 0 }));
if (dev.status !== 403) {
  console.log("  ABORT: /api/dev answered " + dev.status + " — this suite runs against the PRODUCTION-SHAPED pair (dev hooks off)");
  process.exit(2);
}

await check("1. the app's and the validator's must-not-ship lists are identical", async () => {
  const ts = readFileSync("lib/platform/env-contract.ts", "utf8");
  const js = readFileSync("validator/env-contract.js", "utf8");
  const pick = (s) => [...s.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).filter((n) => /^[A-Z][A-Z_]+$/.test(n) && n !== "NODE_ENV" && n !== "ZK_DEV_HOOKS" && n !== "DATA_SOURCE");
  const a = new Set(pick(ts.split("MUST_NOT_SHIP")[1].split("];")[0])), b = new Set(pick(js.split("MUST_NOT_SHIP")[1].split("];")[0]));
  if (a.size < 8) throw new Error("the list is suspiciously short: " + a.size);
  for (const n of a) if (!b.has(n)) throw new Error("validator list lacks " + n);
  for (const n of b) if (!a.has(n)) throw new Error("app list lacks " + n);
  return a.size + " names";
});

await check("2. .env.production.example carries names only", async () => {
  if (!existsSync(".env.production.example")) throw new Error("missing");
  const lines = readFileSync(".env.production.example", "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): + "valid", the public default for ZK_ANON_POST_TREE — a tree NAME, not a
  // secret; every other value stays refused exactly as before
  const ALLOWED_VALUES = new Set(["", "production", "fixture", "true", "3001", "4001", "valid"]);
  const values = new Map();
  for (const l of lines) {
    const i = l.indexOf("=");
    if (i < 0) throw new Error("not NAME=: " + l);
    const v = l.slice(i + 1).trim();
    if (!ALLOWED_VALUES.has(v)) throw new Error("a value is present for " + l.slice(0, i));
    values.set(l.slice(0, i).trim(), v);
  }
  // PERSONA LAUNCH GO-LIVE: and every must-not-ship name is LISTED with an empty value (the template an operator copies
  // must show each one as off — the eight owner-service live names included), and "valid" appears only as the tree
  const require = createRequire(import.meta.url);
  const notListed = require("../validator/env-contract.js").MUST_NOT_SHIP.filter((n) => values.get(n) !== "");
  if (notListed.length) throw new Error("must-not-ship names missing (or not empty) under 'required to be OFF': " + notListed.join(", "));
  for (const [k, v] of values) if (v === "valid" && k !== "ZK_ANON_POST_TREE") throw new Error(k + " carries the value 'valid'");
  if (values.get("ZK_ANON_POST_TREE") !== "valid") throw new Error("ZK_ANON_POST_TREE=valid (the public default, D-PUBLIC-ANON-TREE) is not in the template");
  return lines.length + " names";
});

await check("3. the readiness audit, driven through the page, flips every finding on this pair", async () => {
  const label = "cu4-" + Date.now().toString(36).slice(-5);
  const r = spawnSync(process.execPath, ["scripts/audit-preview-g0.mjs", "--label", label, "--device"], { encoding: "utf8", env: { ...process.env, BASE_URL: BASE, VALIDATOR_URL: VBASE }, timeout: 420_000 });
  const file = path.join("shots", "audit-preview-g0-" + label + ".json");
  if (!existsSync(file)) throw new Error("the audit wrote no output (exit " + r.status + "): " + (r.stderr || r.stdout).slice(-400));
  const f = JSON.parse(readFileSync(file, "utf8")).findings;
  const expect = (k, pred, what) => { if (!(k in f)) throw new Error("audit lacks: " + k); if (!pred(f[k])) throw new Error(k + " → " + JSON.stringify(f[k]).slice(0, 120) + " (expected " + what + ")"); };
  expect("SAME persona roster and active persona for two strangers", (v) => v === false, "false");
  expect("SAME root commitment for A and B", (v) => v === false, "false");
  expect("registry (/api/dev GET) readable by a stranger", (v) => v.status === 403, "403");
  expect("B's feed contains A's cast", (v) => v.contains === false, "not contained");
  expect("B's rendered home page contains A's cast", (v) => v === false, "false");
  expect("B, with a guessable cookie, reads the owner's PRIVATE posts", (v) => v.count === 0, "0 posts");
  expect("B, with that cookie, AUTHORS a private post as the owner", (v) => v.status === 403, "403");
  expect("B via /api/dev viewAs (never refused) then reads private posts", (v) => v.viewAs === 403 && v.count === 0, "403 and 0");
  expect("B forceFail(feed) → status; A's next feed read", (v) => v.accepted === 403, "403");
  expect("dev action statuses from an unauthenticated stranger", (v) => Object.values(v).every((s) => s === 403), "all 403");
  expect("zk rig action (advanceEpoch) from a stranger", (v) => v.status === 403, "403");
  expect("search dev hook (dropIndex) from a stranger", (v) => v.status === 403, "403");
  expect("B resetSeed → status; A's cast still in A's feed afterwards", (v) => v.accepted === 403 && v.aStillSeesOwnCast === true, "403, cast kept");
  expect("GET /state", (v) => v.status === 401, "401");
  expect("POST /events for the owner's root, no envelope (rep inflation)", (v) => v.status === 401, "401");
  expect("DELETE /state without an envelope", (v) => v.status === 401, "401");
  expect("POST /zk/dev/reset from a stranger", (v) => v.status === 403, "403");
  expect("Farcaster write (ENABLE_FC_WRITE)", (v) => v.mode === "fixture", "fixture");
  // Gate 6 tightened this from "inert without a key" to "refused outright on a public deployment"; a rig still answers
  expect("/api/dev/live diagnostic (attempts a Neynar read when a key exists)", (v) => v.status === 403 || v.hasKey === false, "403, or no key");
  return file;
});

// FC-READ: the audit now exits 2 ("COULD NOT RUN") when NEYNAR_READ_API_KEY has no value in .env.local or
// public/device/device.js is missing — it cannot look for a value it does not have, and that is not a pass
await check("4. the secrets audit is clean — and could run (the read key's value is known locally; device.js is scanned)", async () => {
  const r = spawnSync(process.execPath, ["scripts/audit-secrets.mjs"], { encoding: "utf8", timeout: 300_000 });
  if (r.status === 2) throw new Error("the audit COULD NOT RUN: " + ((r.stdout.match(/COULD NOT RUN:[^\n]*/) || [""])[0] || (r.stdout + r.stderr).slice(-300)));
  if (r.status !== 0) throw new Error("exit " + r.status + ": " + (r.stdout + r.stderr).slice(-300));
  return (r.stdout.match(/\d+ leak/)?.[0] ?? "clean");
});

// the public deployment's baseline: every must-not-ship name OFF and the must-be-set half SET (the suite's own runner
// carries neither, so a "clean" boot would otherwise refuse on the contract's second half).
// FC-READ: the new names too — NEYNAR_VIEWER_FID (refused on public), the validator-only NEYNAR_READ_API_KEY, and the
// relay's test override and rig switch — blanked (a set-but-empty variable also beats .env.local in `next start`, so
// an owner's read key there can never arm a probe below); check 13 holds this list to both contracts.
// FC-READ (no channels): the discovery author list (FC_READ_FIDS) blanked too — check 11 names the stub's own.
// FC-READ (house): and the second discovery source, FC_READ_HOUSE_FID. Exactly one source may be set, so an owner's
// house fid in .env.local would otherwise ride into check 11's probe beside the stub's FC_READ_FIDS and disarm it
// (bad_config) — blank, not absent, because a set-but-empty variable beats .env.local in `next start`.
// CONNECT MAIN: the connector account's custody key and fid (FC_CONNECT_APP_*) joined both contracts — blanked here too
// PERSONA LAUNCH P2 (BYX G0, verify): X_API_CLIENT_ID / X_API_CLIENT_SECRET (a paid X developer app's credentials) joined
// both contracts' MUST_NOT_SHIP — blanked here too, so check 13 holds the baseline to the contract it caught drifting
const pub = { ...process.env, NODE_ENV: "production", ZK_DEV_HOOKS: "", ENABLE_WRITE: "", ENABLE_FC_WRITE: "", ENABLE_X_WRITE: "", ENABLE_X_READ: "", DATA_SOURCE: "", NEYNAR_API_KEY: "", NEYNAR_SIGNER_UUID: "", NEYNAR_WALLET_ID: "", FC_TEST_CUSTODY_PRIVATE_KEY: "", FC_TEST_SIGNER_UUID: "", X_LAYERS_INBOX_TOKEN: "", FC_CONNECT_APP_CUSTODY_KEY: "", FC_CONNECT_APP_FID: "", FID_ACQUIRE_ENABLED: "", LAYERS_REQUIRE_SIG: "true", CUSTODY_FIXTURE_PROVIDER: "", NEYNAR_VIEWER_FID: "", NEYNAR_READ_API_KEY: "", NEYNAR_READ_BASE_URL: "", FC_READ_RIG: "", FC_READ_DENY: "", FC_READ_FIDS: "", FC_READ_HOUSE_FID: "", LAYERS_HOSTED: "", OWNER_ACCESS_SECRET: "", X_API_CLIENT_ID: "", X_API_CLIENT_SECRET: "", LAYERS_REGISTRAR_PRIVATE_KEY: "", X_LAYERS_API_KEY: "", X_LAYERS_API_SECRET: "", X_LAYERS_ACCESS_TOKEN: "", X_LAYERS_ACCESS_SECRET: "", X_LIVE: "", X_LIVE_REPLIES: "", REGISTRAR_LIVE: "", REGISTRAR_WINDOW: "", FC_ANON_FID: "", FC_ANON_SIGNER_UUID: "", FC_ANON_NEYNAR_KEY: "", ZK_ANON_RELAY_LIVE: "", ZK_ANON_UNIVERSE: "", FC_ANON_NEYNAR_BASE_URL: "" };
// PUBLIC GO-LIVE (the relay track): the public relay's names (FC_ANON_*, ZK_ANON_RELAY_LIVE, the app's universe hint and the
// relay's test-only base override) blanked too — an operator's values in .env.local must never reach a probe; check 15
// sets them one at a time, check 13 holds the baseline to the app-only list as well
// PERSONA LAUNCH GO-LIVE: the eight owner-service-only live names (X_LAYERS_API_KEY … REGISTRAR_WINDOW) joined both
// contracts' MUST_NOT_SHIP — blanked here too (check 13 holds the baseline to the contract; check 14 sets each one alone).
// PERSONA LAUNCH P6 (verify): LAYERS_REGISTRAR_PRIVATE_KEY joined MUST_NOT_SHIP on both halves (the live registrar's
// wallet; nothing reads it this wave), so the baseline blanks it like every other refused name (check 13).
// FC-READ: a hosting platform's own variables would make every probe below "hosted" (the relay then refuses a base-URL
// override) — the probes decide hosting explicitly, with LAYERS_HOSTED
for (const k of Object.keys(pub)) if (k.startsWith("RAILWAY_")) delete pub[k];
// the probe ports (never the pair's): checks 6-12 start throwaway processes here, one at a time
const PROBE_APP = 3009;
const PROBE_VAL = 4009;

await check("5. RATE LIMIT (app): a burst meets 429s with Retry-After; liveness is never throttled; the refill window restores", async () => {
  const statuses = await Promise.all(Array.from({ length: 260 }, () => get(BASE + "/api/feed?tab=following").catch(() => ({ status: 0 }))));
  const limited = statuses.filter((s) => s.status === 429);
  if (!limited.length) throw new Error("no 429 in a burst of 260: " + JSON.stringify(statuses.map((s) => s.status).reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {})));
  if (!limited.every((s) => s.retryAfter)) throw new Error("a 429 lacks Retry-After");
  const health = await Promise.all(Array.from({ length: 30 }, () => get(BASE + "/api/health")));
  if (health.some((s) => s.status === 429)) throw new Error("liveness was throttled");
  await sleep(4000);
  const after = await get(BASE + "/api/feed?tab=following");
  if (after.status === 429) throw new Error("still limited after the refill window");
  return limited.length + " of 260 limited";
});

// FC-READ (lead fix): the VALIDATOR's limiter is measured on a THROWAWAY validator that runs the shipped defaults, not
// on the pair's. scripts/run-prod-shape.sh raises the pair's bucket (VALIDATOR_RL_CAPACITY / _REFILL_PER_SECOND, a
// local-only override the validator ignores on a hosting platform) because every local suite shares one loopback
// address; a 340-request burst against that bucket would prove nothing about the deployment's 300 / 5 per second. The
// throwaway is production-shaped (`pub`: NODE_ENV=production, no dev hooks, signatures required), carries NEITHER
// override name and no TRUST_PROXY, and must say so in its own boot log — so what 6 and 9 measure is the default a
// deployment runs. (It also leaves the pair's bucket alone, which the suites after this one used to wait out.)
async function defaultLimiterValidator() {
  const dir = mkdtempSync(path.join(tmpdir(), "layers-cu4-rl-"));
  const env = { ...pub, LAYERS_VALIDATOR_PORT: String(PROBE_VAL), VALIDATOR_DB: path.join(dir, "v.db"), LAYERS_REQUIRE_SIG: "true", TRUST_PROXY: "", VALIDATOR_RL_CAPACITY: "", VALIDATOR_RL_REFILL_PER_SECOND: "" };
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* held briefly on Windows */ } };
  const v = await bootAlive(["validator/server.js"], env, PROBE_VAL, "/health");
  if (!v.up) {
    cleanup();
    throw new Error("precondition: the throwaway validator (production-shaped, shipped limiter defaults) did not start: " + v.out().slice(-300));
  }
  if (/rate-limit override/i.test(v.out()) || !/production environment contract: clean/.test(v.out())) {
    await v.stop();
    cleanup();
    throw new Error("precondition: the throwaway validator is not the public shape with the default limiter: " + v.out().slice(-300));
  }
  return { base: "http://127.0.0.1:" + PROBE_VAL, stop: async () => { await v.stop(); cleanup(); } };
}

await check("6. RATE LIMIT (validator): a burst meets 429s; /health is never throttled (the shipped defaults, on a throwaway validator)", async () => {
  const tv = await defaultLimiterValidator();
  try {
    const statuses = await Promise.all(Array.from({ length: 340 }, () => get(tv.base + "/zk/members").catch(() => ({ status: 0 }))));
    const limited = statuses.filter((s) => s.status === 429);
    // precondition: the validator SERVED part of the burst (a dead socket is not a limiter). Served = answered past the
    // limiter with anything but 429 — on a fresh database /zk/members answers 404 (no group yet), and that answer still
    // came from behind the bucket (the limiter is mounted before every route)
    const answered = statuses.filter((s) => s.status !== 429 && s.status !== 0).length;
    if (answered === 0) throw new Error("precondition: the throwaway validator served none of the burst: " + JSON.stringify(statuses.map((s) => s.status).reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {})));
    if (!limited.length) throw new Error("no 429 in a burst of 340");
    if (!limited.every((s) => s.retryAfter)) throw new Error("a validator 429 lacks Retry-After");
    const health = await Promise.all(Array.from({ length: 30 }, () => get(tv.base + "/health")));
    if (health.some((s) => s.status === 429)) throw new Error("validator liveness was throttled");
    return limited.length + " of 340 limited (" + answered + " served)";
  } finally {
    await tv.stop();
  }
});

async function bootProbe(cmd, args, env, port, healthPath) {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd() });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (out += b));
  const exited = new Promise((r) => child.on("exit", (code) => r(code)));
  for (let i = 0; i < 60; i++) {
    const code = await Promise.race([exited, sleep(500).then(() => undefined)]);
    if (code !== undefined) return { exited: true, code, out };
    try {
      const r = await fetch(`http://127.0.0.1:${port}${healthPath}`, { cache: "no-store" });
      if (r.ok) {
        child.kill("SIGKILL");
        return { exited: false, code: null, out };
      }
    } catch { /* not yet */ }
  }
  child.kill("SIGKILL");
  return { exited: false, code: null, out, timeout: true };
}

await check("7. BOOT CHECK (app): a poisoned public deployment refuses to start naming the variable, not the value; a clean one starts", async () => {
  const secret = "not-a-real-key-" + Date.now().toString(36);
  const poisoned = await bootProbe("next", ["node_modules/next/dist/bin/next", "start", "-p", "3009"], { ...pub, NEYNAR_API_KEY: secret, LAYERS_APP_PORT: "3009", VALIDATOR_URL: VBASE, APP_URL: "http://127.0.0.1:3009" }, 3009, "/api/health");
  if (!poisoned.exited || poisoned.code === 0) throw new Error("a poisoned deployment started (exited " + poisoned.exited + ", code " + poisoned.code + ")");
  if (!poisoned.out.includes("NEYNAR_API_KEY")) throw new Error("the refusal does not name the variable: " + poisoned.out.slice(-300));
  if (poisoned.out.includes(secret)) throw new Error("the refusal printed the VALUE");
  const flag = await bootProbe("next", ["node_modules/next/dist/bin/next", "start", "-p", "3009"], { ...pub, ENABLE_FC_WRITE: "true", LAYERS_APP_PORT: "3009", VALIDATOR_URL: VBASE, APP_URL: "http://127.0.0.1:3009" }, 3009, "/api/health");
  if (!flag.exited || flag.code === 0 || !flag.out.includes("ENABLE_FC_WRITE")) throw new Error("a live-write switch did not refuse the start");
  const unsigned = await bootProbe("next", ["node_modules/next/dist/bin/next", "start", "-p", "3009"], { ...pub, LAYERS_REQUIRE_SIG: "", LAYERS_APP_PORT: "3009", VALIDATOR_URL: VBASE, APP_URL: "http://127.0.0.1:3009" }, 3009, "/api/health");
  if (!unsigned.exited || unsigned.code === 0 || !unsigned.out.includes("LAYERS_REQUIRE_SIG")) throw new Error("a public deployment without LAYERS_REQUIRE_SIG=true did not refuse the start: " + unsigned.out.slice(-200));
  const fixture = await bootProbe("next", ["node_modules/next/dist/bin/next", "start", "-p", "3009"], { ...pub, CUSTODY_FIXTURE_PROVIDER: "allow", LAYERS_APP_PORT: "3009", VALIDATOR_URL: VBASE, APP_URL: "http://127.0.0.1:3009" }, 3009, "/api/health");
  if (!fixture.exited || fixture.code === 0 || !fixture.out.includes("CUSTODY_FIXTURE_PROVIDER")) throw new Error("a public deployment allowing the fixture provider did not refuse the start: " + fixture.out.slice(-200));
  const clean = await bootProbe("next", ["node_modules/next/dist/bin/next", "start", "-p", "3009"], { ...pub, LAYERS_APP_PORT: "3009", VALIDATOR_URL: VBASE, APP_URL: "http://127.0.0.1:3009", KEYSTORE_DIR: mkdtempSync(path.join(tmpdir(), "layers-cu4-")) }, 3009, "/api/health");
  if (clean.exited) throw new Error("a clean deployment did not start: " + clean.out.slice(-300));
  return "poisoned exit " + poisoned.code + ", unsigned exit " + unsigned.code + ", clean started";
});

await check("8. BOOT CHECK (validator): the same refusal, the same clean start", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "layers-cu4-v-"));
  const env = { ...pub, LAYERS_VALIDATOR_PORT: "4009", VALIDATOR_DB: path.join(dir, "v.db"), LAYERS_REQUIRE_SIG: "true" };
  const poisoned = await bootProbe("validator", ["validator/server.js"], { ...env, NEYNAR_API_KEY: "not-a-real-key" }, 4009, "/health");
  if (!poisoned.exited || poisoned.code === 0 || !poisoned.out.includes("NEYNAR_API_KEY")) throw new Error("a poisoned validator started or did not name the variable: " + poisoned.out.slice(-200));
  const unsigned = await bootProbe("validator", ["validator/server.js"], { ...env, LAYERS_REQUIRE_SIG: "" }, 4009, "/health");
  if (!unsigned.exited || unsigned.code === 0 || !unsigned.out.includes("LAYERS_REQUIRE_SIG")) throw new Error("a validator without LAYERS_REQUIRE_SIG=true started on a public deployment: " + unsigned.out.slice(-200));
  const clean = await bootProbe("validator", ["validator/server.js"], env, 4009, "/health");
  if (clean.exited) throw new Error("a clean validator did not start: " + clean.out.slice(-300));
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* held briefly on Windows */ }
  return "poisoned exit " + poisoned.code + ", unsigned exit " + unsigned.code + ", clean started";
});

await check("9. RATE LIMIT is keyed by the socket, not a spoofable header: bursts with distinct X-Forwarded-For values are still limited (app and validator)", async () => {
  const addr = (i) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
  const spoofed = (url, i) => fetch(url, { cache: "no-store", headers: { "x-forwarded-for": addr(i), "x-real-ip": addr(i) } }).then((r) => r.status).catch(() => 0);
  const app = await Promise.all(Array.from({ length: 260 }, (_, i) => spoofed(BASE + "/api/feed?tab=following", i)));
  if (!app.some((s) => s === 429)) throw new Error("the app limiter honoured a spoofed X-Forwarded-For (no 429 in 260)");
  // FC-READ (lead fix): the validator half on a fresh throwaway with the shipped defaults (see check 6)
  const tv = await defaultLimiterValidator();
  let val;
  try {
    val = await Promise.all(Array.from({ length: 340 }, (_, i) => spoofed(tv.base + "/zk/members", i)));
  } finally {
    await tv.stop();
  }
  if (!val.some((s) => s !== 429 && s !== 0)) throw new Error("precondition: the throwaway validator served none of the spoofed burst");
  if (!val.some((s) => s === 429)) throw new Error("the validator limiter honoured a spoofed X-Forwarded-For (no 429 in 340)");
  return app.filter((s) => s === 429).length + " app, " + val.filter((s) => s === 429).length + " validator limited";
});

// ---------------------------------------------------------------------------------------------- FC-READ (10-13)
const nextStart = ["node_modules/next/dist/bin/next", "start", "-p", String(PROBE_APP)];
const appProbeEnv = (extra) => ({ ...pub, LAYERS_APP_PORT: String(PROBE_APP), VALIDATOR_URL: VBASE, APP_URL: "http://127.0.0.1:" + PROBE_APP, KEYSTORE_DIR: mkdtempSync(path.join(tmpdir(), "layers-cu4-fc-")), ...extra });

/** true once nothing accepts on the port — a probe must never be answered by the previous probe's process */
async function waitPortFree(port, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const open = await new Promise((r) => {
      const s = net.connect({ host: "127.0.0.1", port });
      s.once("connect", () => { s.destroy(); r(true); });
      s.once("error", () => r(false));
    });
    if (!open) return true;
    await sleep(500);
  }
  throw new Error("port " + port + " is still held " + Math.round(ms / 1000) + " s later — a probe from before would answer this one");
}

/** a probe that stays UP while the check talks to it (bootProbe kills the child the moment it is healthy) */
async function bootAlive(args, env, port, healthPath) {
  await waitPortFree(port);
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd() });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (out += b));
  const exited = new Promise((r) => child.on("exit", (code) => r(code)));
  const stop = async () => {
    child.kill("SIGKILL");
    await Promise.race([exited, sleep(10_000)]);
    await waitPortFree(port).catch(() => {});
  };
  for (let i = 0; i < 120; i++) {
    const code = await Promise.race([exited, sleep(500).then(() => undefined)]);
    if (code !== undefined) return { up: false, code, out: () => out, stop: async () => {} };
    try {
      const r = await fetch(`http://127.0.0.1:${port}${healthPath}`, { cache: "no-store" });
      if (r.ok) return { up: true, out: () => out, stop };
    } catch { /* not yet */ }
  }
  await stop();
  return { up: false, timeout: true, out: () => out, stop: async () => {} };
}

/** one relay request, as the device sends it (the relay contract: POST JSON {op, arg?} + x-layers-relay: 1) */
async function relayAt(port, body) {
  const r = await fetch(`http://127.0.0.1:${port}${RELAY.path}`, { method: "POST", headers: { "content-type": "application/json", [RELAY.header]: "1" }, body: JSON.stringify(body), cache: "no-store" });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const randomHash = () => "0x" + randomBytes(20).toString("hex");

await check("10. BOOT CHECK (validator): NEYNAR_READ_API_KEY is refused on a public validator — named, its value never printed", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "layers-cu4-v-fc-"));
  const env = { ...pub, LAYERS_VALIDATOR_PORT: String(PROBE_VAL), VALIDATOR_DB: path.join(dir, "v.db"), LAYERS_REQUIRE_SIG: "true" };
  try {
    // precondition: this exact environment WITHOUT the key boots — so the refusal below is the key's and nothing else's
    await waitPortFree(PROBE_VAL);
    const clean = await bootProbe("validator", ["validator/server.js"], env, PROBE_VAL, "/health");
    if (clean.exited || clean.timeout) throw new Error("precondition: the same validator environment without the key did not start: " + clean.out.slice(-300));
    await waitPortFree(PROBE_VAL);
    const secret = "fcread-cu4-" + randomBytes(10).toString("hex");
    const poisoned = await bootProbe("validator", ["validator/server.js"], { ...env, NEYNAR_READ_API_KEY: secret }, PROBE_VAL, "/health");
    if (!poisoned.exited || poisoned.code === 0) throw new Error("a public validator holding NEYNAR_READ_API_KEY started (exited " + poisoned.exited + ", code " + poisoned.code + ")");
    if (!poisoned.out.includes("NEYNAR_READ_API_KEY")) throw new Error("the refusal does not name NEYNAR_READ_API_KEY: " + poisoned.out.slice(-300));
    if (poisoned.out.includes(secret)) throw new Error("the refusal printed the key's VALUE");
    return "clean started; with the key: exit " + poisoned.code + ", named, value unprinted";
  } finally {
    await waitPortFree(PROBE_VAL).catch(() => {});
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* held briefly on Windows */ }
  }
});

// one loopback stub for 11 and 12: the relay's upstream, so "armed" is proven by a request arriving and "unarmed" by none
let cu4Stub = null;
try {
  cu4Stub = await startNeynarStub({ port: 0, log: (s) => console.log("   [neynar-stub] " + s) });
} catch (e) {
  console.log("   (the loopback Neynar stub did not start: " + e.message + " — checks 11 and 12 will say so)");
}

await check("11. BOOT CHECK (app): NEYNAR_VIEWER_FID is refused on a public app (named, value unprinted); the app boots WITH a read key and its relay ARMS and reaches the upstream it names", async () => {
  if (!cu4Stub) throw new Error("no loopback Neynar stub — the arming half cannot be measured");
  const fid = String(31337000 + (randomBytes(2).readUInt16BE(0) % 999));
  await waitPortFree(PROBE_APP);
  const viewer = await bootProbe("next", nextStart, appProbeEnv({ NEYNAR_VIEWER_FID: fid }), PROBE_APP, "/api/health");
  if (!viewer.exited || viewer.code === 0) throw new Error("a public app with NEYNAR_VIEWER_FID set started (exited " + viewer.exited + ", code " + viewer.code + ")");
  if (!viewer.out.includes("NEYNAR_VIEWER_FID")) throw new Error("the refusal does not name NEYNAR_VIEWER_FID: " + viewer.out.slice(-300));
  if (viewer.out.includes(fid)) throw new Error("the refusal printed the fid's VALUE");
  // the read key is ALLOWED on the app — and "it boots" is not the claim (a denylist boots anything it does not list):
  // the relay must ARM on it and actually call the upstream with it. FC-READ (no channels): the relay has no default
  // discovery author list (FC_READ_FIDS unset → bad_config), so the probe names the stub's own authors
  await cu4Stub.reset();
  const app = await bootAlive(nextStart, appProbeEnv({ NEYNAR_READ_API_KEY: cu4Stub.key, NEYNAR_READ_BASE_URL: cu4Stub.baseUrl, FC_READ_RIG: "stub", FC_READ_FIDS: stubDiscoveryFids().join(",") }), PROBE_APP, "/api/health");
  if (!app.up) throw new Error("a public app with a well-formed NEYNAR_READ_API_KEY did not start (code " + app.code + "): " + app.out().slice(-300));
  try {
    const status = await relayAt(PROBE_APP, { op: "status" });
    if (status.status !== 200 || status.json?.armed !== true || status.json?.reason !== "armed") throw new Error("the relay did not arm on the key: " + status.status + " " + JSON.stringify(status.json).slice(0, 160));
    const hash = randomHash();
    const miss = await relayAt(PROBE_APP, { op: "thread", arg: hash });
    const st = await cu4Stub.state();
    const seen = st.requests.find((r) => r.route === "/cast/conversation" && r.params.identifier === hash);
    if (!seen) throw new Error("armed, but the thread read never reached the upstream it names (relay answered " + miss.status + ", stub saw " + st.hits.total + " request(s))");
    if (!seen.keyOk) throw new Error("the upstream call did not carry the configured key");
    if (miss.status !== 404 || miss.json?.code !== "not_found") throw new Error("an unknown hash answered " + miss.status + " " + JSON.stringify(miss.json).slice(0, 120) + " (expected 404 not_found)");
    if (app.out().includes(cu4Stub.key)) throw new Error("the app's own output printed the read key");
    return `NEYNAR_VIEWER_FID refused (exit ${viewer.code}); with the read key: armed, the upstream saw the thread read with the key, 404 not_found`;
  } finally {
    await app.stop();
  }
});

await check("12. MISCONFIGURATION DISARMS, NEVER EXITS: NEYNAR_READ_BASE_URL on a hosted-looking env or at a non-loopback host → bad_base_url (the stub it names is never called); a malformed key → bad_key", async () => {
  if (!cu4Stub) throw new Error("no loopback Neynar stub — 'never called' cannot be measured");
  const cases = [
    // the worst copy-paste: the test override and the rig switch carried onto a hosting platform
    { label: "hosted + loopback override", extra: { NEYNAR_READ_API_KEY: cu4Stub.key, NEYNAR_READ_BASE_URL: cu4Stub.baseUrl, FC_READ_RIG: "stub", LAYERS_HOSTED: "true" }, reason: "bad_base_url" },
    { label: "non-loopback override", extra: { NEYNAR_READ_API_KEY: cu4Stub.key, NEYNAR_READ_BASE_URL: "http://neynar-override.invalid/v2/farcaster" }, reason: "bad_base_url" },
    { label: "malformed key", extra: { NEYNAR_READ_API_KEY: "short key!", NEYNAR_READ_BASE_URL: cu4Stub.baseUrl, FC_READ_RIG: "stub" }, reason: "bad_key" },
  ];
  const notes = [];
  for (const c of cases) {
    await cu4Stub.reset();
    const app = await bootAlive(nextStart, appProbeEnv(c.extra), PROBE_APP, "/api/health");
    // the relay's misconfiguration must never take the process down (the public app has no healthcheck path: a
    // refused boot is an outage, not a failed rollout)
    if (!app.up) throw new Error(`${c.label}: the app did not stay up (code ${app.code}${app.timeout ? ", timed out" : ""}): ` + app.out().slice(-240));
    try {
      const status = await relayAt(PROBE_APP, { op: "status" });
      if (status.status !== 200) throw new Error(`${c.label}: the status op answered ${status.status}`);
      if (status.json?.armed !== false || status.json?.reason !== c.reason) throw new Error(`${c.label}: status ${JSON.stringify(status.json).slice(0, 160)} (expected unarmed, ${c.reason})`);
      const read = await relayAt(PROBE_APP, { op: "thread", arg: randomHash() });
      if (read.status !== 503 || read.json?.code !== "fc_read_unarmed") throw new Error(`${c.label}: a read answered ${read.status} ${JSON.stringify(read.json).slice(0, 120)} (expected 503 fc_read_unarmed)`);
      const st = await cu4Stub.state();
      if (st.hits.total !== 0) throw new Error(`${c.label}: the unarmed relay still called the stub ${st.hits.total} time(s)`);
      if (c.extra.NEYNAR_READ_API_KEY && app.out().includes(c.extra.NEYNAR_READ_API_KEY)) throw new Error(`${c.label}: the app's output printed the key`);
      notes.push(`${c.label}: up, ${c.reason}, 0 upstream calls`);
    } finally {
      await app.stop();
    }
  }
  return notes.join("; ");
});
if (cu4Stub) await cu4Stub.close().catch(() => {});

await check("13. the public boot baseline blanks every name either contract refuses (the FC-READ names included)", async () => {
  const require = createRequire(import.meta.url);
  const vc = require("../validator/env-contract.js");
  // PUBLIC GO-LIVE: and the APP-ONLY list (lib/platform/env-contract.ts APP_ONLY_REFUSES — the relay credential), read from the
  // TypeScript source (the names between its brackets)
  const appOnly = [...((readFileSync("lib/platform/env-contract.ts", "utf8").split("APP_ONLY_REFUSES: readonly string[] = [")[1] ?? "").split("];")[0].matchAll(/"([A-Z_]+)"/g))].map((m) => m[1]);
  if (!appOnly.includes("FC_ANON_SIGNER_UUID") || !appOnly.includes("FC_ANON_NEYNAR_KEY")) throw new Error("lib/platform/env-contract.ts APP_ONLY_REFUSES lacks the relay credential: " + JSON.stringify(appOnly));
  const refused = [...(vc.MUST_NOT_SHIP ?? []), ...(vc.VALIDATOR_REFUSES ?? []), ...appOnly];
  if (!refused.includes("NEYNAR_VIEWER_FID")) throw new Error("validator/env-contract.js MUST_NOT_SHIP lacks NEYNAR_VIEWER_FID");
  if (!(vc.VALIDATOR_REFUSES ?? []).includes("NEYNAR_READ_API_KEY")) throw new Error("validator/env-contract.js exports no VALIDATOR_REFUSES carrying NEYNAR_READ_API_KEY");
  // FC-READ (house): both discovery sources too — a source the owner keeps in .env.local must never reach a probe
  const missing = [...refused, "NEYNAR_READ_BASE_URL", "FC_READ_RIG", ...RELAY.sourceEnvs].filter((n) => pub[n] !== "");
  if (missing.length) throw new Error("the baseline does not blank: " + missing.join(", "));
  return refused.length + " refused names + the relay's test switches + both discovery sources (" + RELAY.sourceEnvs.join(", ") + "), all blank";
});

// PERSONA LAUNCH GO-LIVE — the eight owner-service-only live names, each a near miss on both processes
const GO_LIVE_NAMES = ["X_LAYERS_API_KEY", "X_LAYERS_API_SECRET", "X_LAYERS_ACCESS_TOKEN", "X_LAYERS_ACCESS_SECRET", "X_LIVE", "X_LIVE_REPLIES", "REGISTRAR_LIVE", "REGISTRAR_WINDOW"];
const OFF_SPELLINGS = ["", "false", "0", "off", "no"];
await check("14. GO-LIVE NEAR MISSES: each owner-service live name (X_LAYERS_*, X_LIVE, X_LIVE_REPLIES, REGISTRAR_LIVE, REGISTRAR_WINDOW) SET refuses a public validator and a public app — named, value unprinted; at an OFF value it boots the validator; the app boots with all eight off", async () => {
  const require = createRequire(import.meta.url);
  const vc = require("../validator/env-contract.js");
  const missing = GO_LIVE_NAMES.filter((n) => !vc.MUST_NOT_SHIP.includes(n));
  if (missing.length) throw new Error("validator/env-contract.js MUST_NOT_SHIP lacks " + missing.join(", ") + " (check 1 holds the app's list to it)");
  const notBlank = GO_LIVE_NAMES.filter((n) => pub[n] !== "");
  if (notBlank.length) throw new Error("precondition: the baseline does not blank " + notBlank.join(", "));
  const dir = mkdtempSync(path.join(tmpdir(), "layers-cu4-golive-"));
  const venv = { ...pub, LAYERS_VALIDATOR_PORT: String(PROBE_VAL), VALIDATOR_DB: path.join(dir, "v.db"), LAYERS_REQUIRE_SIG: "true" };
  const notes = [];
  try {
    // precondition: this exact validator environment with every one of them blank boots
    await waitPortFree(PROBE_VAL);
    const clean = await bootProbe("validator", ["validator/server.js"], venv, PROBE_VAL, "/health");
    if (clean.exited || clean.timeout) throw new Error("precondition: the validator environment without the names did not start: " + clean.out.slice(-300));
    for (let i = 0; i < GO_LIVE_NAMES.length; i++) {
      const n = GO_LIVE_NAMES[i];
      const secret = "cu4-golive-" + randomBytes(8).toString("hex");
      await waitPortFree(PROBE_VAL);
      const set = await bootProbe("validator", ["validator/server.js"], { ...venv, [n]: secret }, PROBE_VAL, "/health");
      if (!set.exited || set.code === 0) throw new Error(`a public validator with ${n} set started (exited ${set.exited}, code ${set.code})`);
      if (!set.out.includes(n)) throw new Error(`the validator's refusal does not name ${n}: ` + set.out.slice(-200));
      if (set.out.includes(secret)) throw new Error(`the validator's refusal printed ${n}'s VALUE`);
      const offValue = OFF_SPELLINGS[i % OFF_SPELLINGS.length];
      await waitPortFree(PROBE_VAL);
      const off = await bootProbe("validator", ["validator/server.js"], { ...venv, [n]: offValue }, PROBE_VAL, "/health");
      if (off.exited || off.timeout) throw new Error(`a public validator with ${n}=${JSON.stringify(offValue)} (off) did not start: ` + off.out.slice(-200));
    }
    notes.push(`validator: ${GO_LIVE_NAMES.length} refused when set, ${GO_LIVE_NAMES.length} booted at an off value`);
    for (const n of GO_LIVE_NAMES) {
      const secret = "cu4-golive-" + randomBytes(8).toString("hex");
      await waitPortFree(PROBE_APP);
      const set = await bootProbe("next", nextStart, appProbeEnv({ [n]: secret }), PROBE_APP, "/api/health");
      if (!set.exited || set.code === 0) throw new Error(`a public app with ${n} set started (exited ${set.exited}, code ${set.code})`);
      if (!set.out.includes(n)) throw new Error(`the app's refusal does not name ${n}: ` + set.out.slice(-200));
      if (set.out.includes(secret)) throw new Error(`the app's refusal printed ${n}'s VALUE`);
    }
    await waitPortFree(PROBE_APP);
    const allOff = Object.fromEntries(GO_LIVE_NAMES.map((n, i) => [n, OFF_SPELLINGS[(i + 1) % OFF_SPELLINGS.length]]));
    const app = await bootProbe("next", nextStart, appProbeEnv(allOff), PROBE_APP, "/api/health");
    if (app.exited || app.timeout) throw new Error("a public app with all eight at off values did not start: " + app.out.slice(-300));
    notes.push(`app: ${GO_LIVE_NAMES.length} refused when set, booted with all eight off`);
    return notes.join("; ");
  } finally {
    await waitPortFree(PROBE_VAL).catch(() => {});
    await waitPortFree(PROBE_APP).catch(() => {});
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* held briefly on Windows */ }
  }
});

// PUBLIC GO-LIVE (the relay track) — the one relay credential, both ways (the validator accepts it, the app refuses it)
const RELAY_FAKE = { FC_ANON_FID: "812345", FC_ANON_SIGNER_UUID: "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d", FC_ANON_NEYNAR_KEY: "cu4-relay-" + randomBytes(10).toString("hex"), ZK_ANON_RELAY_LIVE: "on", ZK_ANON_POST_LIVE_CAP: "3" };
await check("15. THE ONE RELAY CREDENTIAL: a public validator WITH the agent's fid, signer, key and switch boots and names the agent relay path (values never printed); beside them NEYNAR_API_KEY still refuses it; a public app with FC_ANON_SIGNER_UUID or FC_ANON_NEYNAR_KEY refuses to boot (named, unprinted) and boots with both at off values", async () => {
  const require = createRequire(import.meta.url);
  const vc = require("../validator/env-contract.js");
  const accepted = vc.RELAY_ACCEPTED ?? [];
  for (const n of ["FC_ANON_FID", "FC_ANON_SIGNER_UUID", "FC_ANON_NEYNAR_KEY", "ZK_ANON_RELAY_LIVE"]) {
    if (!accepted.includes(n)) throw new Error("validator/env-contract.js RELAY_ACCEPTED lacks " + n);
    if (vc.MUST_NOT_SHIP.includes(n) || vc.VALIDATOR_REFUSES.includes(n)) throw new Error(n + " is on a validator refusal list — the public validator could never hold the relay credential");
  }
  const notBlank = Object.keys(RELAY_FAKE).filter((n) => n !== "ZK_ANON_POST_LIVE_CAP" && pub[n] !== "");
  if (notBlank.length) throw new Error("precondition: the baseline does not blank " + notBlank.join(", "));
  const dir = mkdtempSync(path.join(tmpdir(), "layers-cu4-relay-"));
  const venv = { ...pub, LAYERS_VALIDATOR_PORT: String(PROBE_VAL), VALIDATOR_DB: path.join(dir, "v.db"), LAYERS_REQUIRE_SIG: "true", ...RELAY_FAKE };
  const notes = [];
  try {
    // THE VALIDATOR ACCEPTS IT — and the values reached it: the public status names the agent path, ready on this shape
    const v = await bootAlive(["validator/server.js"], venv, PROBE_VAL, "/health");
    if (!v.up) throw new Error("a public validator holding the relay credential did not start (code " + v.code + "): " + v.out().slice(-300));
    try {
      const st = await get("http://127.0.0.1:" + PROBE_VAL + "/zk/anon/public-status?mode=live");
      if (st.status !== 200 || st.json?.relay?.kind !== "agent" || st.json?.relay?.ready !== true || st.json?.fidGate?.on !== true) throw new Error("the validator does not report the agent relay ready with the fid gate on: " + st.status + " " + JSON.stringify(st.json?.relay ?? null) + " " + JSON.stringify(st.json?.fidGate ?? null));
      if (v.out().includes(RELAY_FAKE.FC_ANON_NEYNAR_KEY) || v.out().includes(RELAY_FAKE.FC_ANON_SIGNER_UUID)) throw new Error("the validator's output printed the relay key or signer");
      if (JSON.stringify(st.json).includes(RELAY_FAKE.FC_ANON_NEYNAR_KEY) || JSON.stringify(st.json).includes(RELAY_FAKE.FC_ANON_SIGNER_UUID)) throw new Error("the public status carries the relay key or signer");
    } finally {
      await v.stop();
    }
    notes.push("validator: booted with the credential, agent path ready, fid gate on");
    // beside it, the SECOND write credential still refuses the validator
    await waitPortFree(PROBE_VAL);
    const second = "cu4-write-" + randomBytes(8).toString("hex");
    const two = await bootProbe("validator", ["validator/server.js"], { ...venv, NEYNAR_API_KEY: second }, PROBE_VAL, "/health");
    if (!two.exited || two.code === 0 || !two.out.includes("NEYNAR_API_KEY")) throw new Error("a public validator holding the relay credential AND NEYNAR_API_KEY started (or did not name it): " + two.out.slice(-200));
    if (two.out.includes(second)) throw new Error("the refusal printed NEYNAR_API_KEY's value");
    notes.push("validator + NEYNAR_API_KEY: refused, named");
    // THE APP REFUSES IT — precondition first: the same app environment with both blank boots
    await waitPortFree(PROBE_APP);
    const cleanApp = await bootProbe("next", nextStart, appProbeEnv({}), PROBE_APP, "/api/health");
    if (cleanApp.exited || cleanApp.timeout) throw new Error("precondition: the app environment without the relay names did not start: " + cleanApp.out.slice(-300));
    for (const n of ["FC_ANON_SIGNER_UUID", "FC_ANON_NEYNAR_KEY"]) {
      const value = n === "FC_ANON_SIGNER_UUID" ? RELAY_FAKE.FC_ANON_SIGNER_UUID : RELAY_FAKE.FC_ANON_NEYNAR_KEY;
      await waitPortFree(PROBE_APP);
      const set = await bootProbe("next", nextStart, appProbeEnv({ [n]: value }), PROBE_APP, "/api/health");
      if (!set.exited || set.code === 0) throw new Error(`a public app with ${n} set started (exited ${set.exited}, code ${set.code})`);
      if (!set.out.includes(n)) throw new Error(`the app's refusal does not name ${n}: ` + set.out.slice(-200));
      if (set.out.includes(value)) throw new Error(`the app's refusal printed ${n}'s VALUE`);
    }
    await waitPortFree(PROBE_APP);
    const offApp = await bootProbe("next", nextStart, appProbeEnv({ FC_ANON_SIGNER_UUID: "off", FC_ANON_NEYNAR_KEY: "false", FC_ANON_FID: RELAY_FAKE.FC_ANON_FID }), PROBE_APP, "/api/health");
    if (offApp.exited || offApp.timeout) throw new Error("a public app with the signer and the key at off values (and a public fid) did not start: " + offApp.out.slice(-300));
    notes.push("app: both refused when set, booted at off values");
    return notes.join("; ");
  } finally {
    await waitPortFree(PROBE_VAL).catch(() => {});
    await waitPortFree(PROBE_APP).catch(() => {});
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* held briefly on Windows */ }
  }
});

const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} Gate 4 checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
