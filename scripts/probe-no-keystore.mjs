// BROWSER KEYSTORE PASS Gate 1 stage 4 — "no production code path reads .keystore/", as a measurement.
//
// Starts the app's production build in a PRODUCTION-shaped environment (no ZK_DEV_HOOKS) pointed at an EMPTY,
// throwaway KEYSTORE_DIR, asks it for the pages and the API routes a stranger would hit, and asserts:
//   1. the directory is still empty afterwards — the server minted no seed, no device key, no counters;
//   2. every route that would need a key refuses LOUDLY (the keystore door, not a silent empty answer);
//   3. the public surface the preview needs still answers (the server renders public state — D-CU-0-4).
// The rig is untouched: it runs its production build WITH the hooks and keeps its own keystore.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.PROBE_PORT || 3009);
const BASE = `http://127.0.0.1:${PORT}`;
const VBASE = process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const dir = mkdtempSync(path.join(tmpdir(), "layers-empty-keystore-"));
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gate 5: production-shaped means every must-not-ship name OFF and the must-be-set half SET — taken from the one
// contract list, so this probe cannot drift from the contract the server it starts is checked against
const { MUST_NOT_SHIP } = (await import("../validator/env-contract.js")).default;
const off = Object.fromEntries(MUST_NOT_SHIP.map((n) => [n, ""]));

console.log("\nProduction server + empty KEYSTORE_DIR: " + dir);
const srv = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
  env: {
    ...process.env,
    ...off,
    LAYERS_REQUIRE_SIG: "true",
    CUSTODY_FIXTURE_PROVIDER: "",
    NODE_ENV: "production",
    KEYSTORE_DIR: dir,
    VALIDATOR_URL: VBASE,
    APP_URL: BASE,
    LAYERS_APP_PORT: String(PORT),
    ZK_DEV_HOOKS: "",
    ENABLE_WRITE: "",
    ENABLE_FC_WRITE: "",
    ENABLE_X_WRITE: "",
    ENABLE_X_READ: "",
    DATA_SOURCE: "",
    NEYNAR_API_KEY: "",
    FID_ACQUIRE_ENABLED: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
srv.stdout.on("data", (b) => (log += b));
srv.stderr.on("data", (b) => (log += b));

async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + "/api/health", { cache: "no-store" });
      if (r.ok) return true;
    } catch { /* not yet */ }
    await sleep(500);
  }
  return false;
}
const get = async (p) => {
  try {
    const r = await fetch(BASE + p, { cache: "no-store" });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: String(e) };
  }
};

try {
  if (!(await waitUp())) throw new Error("the production server never came up on " + PORT + "\n" + log.slice(-600));

  // the routes a stranger reaches first; each one would need a key on the old topology
  const keyed = ["/api/personas", "/api/identity", "/api/private/posts", "/api/device", "/api/zk?mode=fixture"];
  const answers = {};
  for (const p of keyed) answers[p] = await get(p);

  // what the server still owns: its own liveness. The rendered PAGE is measured, not asserted — server-side
  // public-only rendering (D-CU-0-4) is the part of stage 3 that is not built, and a page whose SSR still reaches
  // for a key is expected to fail here until it is. Measuring it keeps the gap visible instead of hiding it.
  const publicSurface = { "/api/health": await get("/api/health"), "/home": await get("/home") };

  await sleep(400);
  const left = existsSync(dir) ? readdirSync(dir) : [];

  await (async () => {
    if (left.length) throw new Error("the server wrote into KEYSTORE_DIR: " + left.join(", "));
  })().then(() => ok("1. the production server left the keystore directory EMPTY", "0 files"), (e) => fail("1. the production server left the keystore directory EMPTY", e.message));

  // What matters is not that every route errors — a keyless server may still answer PUBLIC things (D-CU-0-4) —
  // but that it hands out nobody's private data and that the routes needing a key refuse at the keystore door.
  const problems = [];
  const priv = answers["/api/private/posts"];
  if ((priv.json?.posts ?? []).length > 0) problems.push("/api/private/posts returned " + priv.json.posts.length + " private post(s)");
  const bodies = Object.entries(answers).map(([p, a]) => [p, JSON.stringify(a.json ?? a.text ?? "")]);
  for (const [p, body] of bodies) {
    if (/"(text|body)":"[^"]{8,}/.test(body) && p.includes("private")) problems.push(p + " carries post text");
  }
  const keyedRoutes = ["/api/device", "/api/zk?mode=fixture"];
  for (const r of keyedRoutes) if (answers[r].status < 400) problems.push(r + " answered " + answers[r].status + " without a key");
  const loud = bodies.filter(([, body]) => /keystore: refusing|no seed|device is the browser/i.test(body));
  if (!loud.length) problems.push("no route named the keystore door — the refusal may not be on this build");
  if (problems.length === 0) {
    ok("2. a keyless production server hands out nothing private and refuses the keyed routes",
      Object.entries(answers).map(([p, a]) => p.replace("/api/", "") + "→" + a.status).join(", "));
  } else {
    fail("2. a keyless production server hands out nothing private and refuses the keyed routes", problems.join("; "));
  }

  if (publicSurface["/api/health"].status === 200) {
    ok("3. the server still answers its own liveness", "/home renders " + publicSurface["/home"].status + " (measured: public-only SSR is not built)");
  } else {
    fail("3. the server still answers its own liveness", "health " + publicSurface["/api/health"].status);
  }
} catch (e) {
  fail("probe", e.message);
} finally {
  srv.kill("SIGKILL");
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* the temp dir may be held briefly on Windows */ }
}

const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} no-keystore probe checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
