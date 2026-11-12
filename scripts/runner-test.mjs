// ATTESTATION PASS Gate 0 — THE RUNNER'S OWN REGRESSION SUITE (`npm run
// test:runner`). The sweep runner is the instrument every closing bar is
// read from, and ZK Pass 2 found it lying twice: a foreign server on the
// port read as alive, and any suite exit code outside {0,1,2,124} was
// recorded as `ok` with an empty summary. This suite pins both fixes:
//
//   1. a stub HTTP server answering 200 with any non-Totem body on the app
//      port reads DOWN — the runner REFUSES to launch and runs nothing
//   2. the right shape with an invalid signature reads DOWN; a Totem-app
//      payload where the validator should be reads DOWN
//   3. the live app and validator answer the signed contract (commit,
//      uptime, signature under the served validator key)
//   4. exit-code classification: 137 with no summary → INFRA "no verdict"
//      (the 065ef3b bug), 3 → INFRA, 1 with a FAIL line → FAIL and the
//      detail file receives exactly that line, 0 → ok; TOTAL counts only
//      PASS lines; the sweep exits 1
//   5. port pinning: no default 3000/4000 literal survives in app/, lib/,
//      validator/, scripts/; npm start/dev go through the pinned launcher;
//      the validator listens on LAYERS_VALIDATOR_PORT
//   6. the runner's source keeps the "never silently green" branch
//
// Runs against the live servers (BASE_URL / VALIDATOR_URL, defaults from
// the pinned ports) plus throwaway stub servers on ephemeral ports.
import { spawn } from "node:child_process";
import http from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const ROOT = process.cwd();

let n = 0;
let passed = 0;
let failed = 0;
async function check(name, fn) {
  n++;
  try {
    await fn();
    passed++;
    console.log(`  PASS ${n}. ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${n}. ${name} — ${(e && e.message) || e}`);
  }
}

function runRunner(env, run = "9") {
  return new Promise((resolve) => {
    const child = spawn("bash", ["scripts/sweep-x.sh", run], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c.toString("utf8")));
    child.stderr.on("data", (c) => (out += c.toString("utf8")));
    child.on("close", (code) => resolve({ code, out }));
  });
}

function runNode(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c.toString("utf8")));
    child.stderr.on("data", (c) => (out += c.toString("utf8")));
    child.on("close", (code) => resolve({ code, out: out.trim() }));
  });
}

function stub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const body = handler(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

const ZERO_PUB = "0".repeat(64);
const ZERO_SIG = "0".repeat(128);

console.log("\nAttestation pass Gate 0 — the sweep runner's liveness contract and exit-code classification");

// ---- 1. a foreign server is DOWN and the runner refuses to launch ----
await check("1. STUB: a server answering 200 with a non-Totem body reads DOWN — the runner REFUSES to launch and runs no suite", async () => {
  const s = await stub(() => ({ ok: true, registry: {} }));
  try {
    const r = await runRunner({ BASE_URL: s.url, VALIDATOR_URL: s.url, SUITES_OVERRIDE: "probe:pass" });
    if (r.code !== 2) throw new Error(`runner exit ${r.code}, expected 2:\n${r.out}`);
    if (!/REFUSED: app on /.test(r.out)) throw new Error("no REFUSED line:\n" + r.out);
    if (/probe:pass\s+ok/.test(r.out) || /2\/2 probe checks/.test(r.out)) throw new Error("a suite ran against the foreign server:\n" + r.out);
    if (!/TOTAL: 0 passing checks, 0 failed suites, 1 infra/.test(r.out)) throw new Error("no refusal TOTAL line:\n" + r.out);
  } finally {
    await s.close();
  }
});

// ---- 2. shape without a valid signature is DOWN; wrong app name is DOWN ----
await check("2. STUB: the right shape with an invalid signature reads DOWN; a Totem-APP payload where the validator should be reads DOWN", async () => {
  const shaped = { ok: true, app: "layers", commit: "0".repeat(40), buildId: null, startedAt: Date.now(), uptime: 5, port: 1, pid: 1, peer: "http://localhost:1", pubkey: ZERO_PUB, sig: ZERO_SIG };
  const s = await stub(() => shaped);
  try {
    const r1 = await runNode(["scripts/lib/health-probe.mjs", s.url, "layers"]);
    if (r1.code !== 1 || !/DOWN: signature/.test(r1.out)) throw new Error(`bad-signature probe: exit ${r1.code} ${r1.out}`);
    // the live app's payload, but expected where the validator should be
    const live = await (await fetch(BASE + "/api/health")).json();
    const s2 = await stub(() => live);
    try {
      const r2 = await runNode(["scripts/lib/health-probe.mjs", s2.url, "layers-validator"]);
      if (r2.code !== 1 || !/DOWN: payload names app "layers"/.test(r2.out)) throw new Error(`wrong-app probe: exit ${r2.code} ${r2.out}`);
      // the runner refuses before any suite runs — on the app side (its peer is
      // the real validator, not this stub) or on the validator side; either way
      // nothing runs against a validator that is not one
      const r3 = await runRunner({ BASE_URL: BASE, VALIDATOR_URL: s2.url, SUITES_OVERRIDE: "probe:pass" });
      if (r3.code !== 2 || !/REFUSED: (app|validator) on /.test(r3.out) || /probe:pass\s+ok/.test(r3.out)) throw new Error(`runner did not refuse with a non-validator under test: exit ${r3.code}\n${r3.out}`);
    } finally {
      await s2.close();
    }
  } finally {
    await s.close();
  }
});

// ---- 3. the live processes answer the contract ----
await check("3. LIVE: the running app and validator answer the signed contract — commit, uptime, a signature that verifies (the validator's under its served key)", async () => {
  const a = await runNode(["scripts/lib/health-probe.mjs", BASE, "layers"]);
  if (a.code !== 0 || !/^commit=[0-9a-f]{7} uptime=\d+s port=\d+ pid=\d+/.test(a.out)) throw new Error(`app probe: exit ${a.code} ${a.out}`);
  const v = await runNode(["scripts/lib/health-probe.mjs", VBASE, "layers-validator"]);
  if (v.code !== 0 || !/^commit=[0-9a-f]{7} uptime=\d+s port=\d+ pid=\d+/.test(v.out)) throw new Error(`validator probe: exit ${v.code} ${v.out}`);
  const payload = await (await fetch(BASE + "/api/health")).json();
  if (!/^[0-9a-f]{40}$/.test(payload.commit) && payload.commit !== "unknown") throw new Error("app commit is not a git hash: " + payload.commit);
  const head = readFileSync(path.join(ROOT, ".git", "HEAD"), "utf8").trim();
  const ref = head.startsWith("ref: ") ? head.slice(5).trim() : null;
  const headHash = ref && existsSync(path.join(ROOT, ".git", ref)) ? readFileSync(path.join(ROOT, ".git", ref), "utf8").trim() : head;
  console.log(`       app ${a.out}${payload.commit === headHash ? " (= HEAD)" : " (HEAD is " + headHash.slice(0, 7) + " — the server predates it)"}; validator ${v.out}`);
});

// ---- 4. exit-code classification ----
await check("4. CLASSIFICATION: exit 137 with no summary → INFRA 'no verdict' (the 065ef3b bug); exit 3 → INFRA; exit 1 + FAIL line → FAIL, detail file receives exactly that line; exit 0 → ok; TOTAL counts PASS lines only; sweep exits 1", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runner-test-"));
  const detail = path.join(dir, "detail.txt");
  const r = await runRunner({ BASE_URL: BASE, VALIDATOR_URL: VBASE, SUITES_OVERRIDE: "probe:exit137 probe:pass probe:fail probe:exit3", DETAIL: detail });
  const line = (name) => r.out.split(/\r?\n/).find((l) => new RegExp(`^  run9 ${name.replace(":", "\\:")}\\s`).test(l)) || "";
  const l137 = line("probe:exit137");
  if (!/\sINFRA\s+suite exited 137 with no verdict/.test(l137)) throw new Error(`exit 137 line: "${l137}"\n${r.out}`);
  const l3 = line("probe:exit3");
  if (!/\sINFRA\s+suite exited 3 with no verdict/.test(l3)) throw new Error(`exit 3 line: "${l3}"`);
  const lp = line("probe:pass");
  if (!/\sok\s+2\/2 probe checks passed/.test(lp)) throw new Error(`pass line: "${lp}"`);
  const lf = line("probe:fail");
  if (!/\sFAIL\s+1\/2 probe checks passed, 1 FAILED, 0 infra/.test(lf)) throw new Error(`fail line: "${lf}"`);
  // PASS lines are counted from EVERY suite (the 383-check baseline was built
  // that way); the VERDICT is per suite — 1 + 2 + 1 + 0 = 4 passing checks here
  if (!/TOTAL: 4 passing checks, 1 failed suites, 2 infra/.test(r.out)) throw new Error("TOTAL line wrong:\n" + r.out);
  if (r.code !== 1) throw new Error(`sweep exit ${r.code}, expected 1 (a failed suite outranks infra)`);
  const d = existsSync(detail) ? readFileSync(detail, "utf8") : "";
  const dl = d.split(/\r?\n/).filter(Boolean);
  if (dl.length !== 1 || !/^    run9 probe:fail   FAIL 2\. probe: deliberate failure/.test(dl[0])) throw new Error(`detail file should hold exactly the FAIL line, got: ${JSON.stringify(dl)}`);
});

// ---- 5. port pinning honored everywhere ----
await check("5. PINNING: no default-port literal (localhost:3000/4000, -p 3000, VALIDATOR_PORT || 4000) survives in app/, lib/, validator/, scripts/, package.json; start/dev use the pinned launcher; the validator reads LAYERS_VALIDATOR_PORT", async () => {
  const bad = [];
  // every spelling a port literal has been found in: URLs, npm flags, shell vars, PowerShell port lookups (z5/z7 slipped through the first pattern)
  const re = /localhost:(3000|4000)\b|VALIDATOR_PORT \|\| 4000|-p 3000\b|PORT=3000\b|next (start|dev) -p \d+|LocalPort (3000|4000)\b|findstr :(3000|4000)\b|pid on :(3000|4000)\b/;
  const walk = (d) => {
    for (const ent of readdirSync(d)) {
      const p = path.join(d, ent);
      if (ent === "node_modules" || ent === ".next" || ent.startsWith(".")) continue;
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs|cjs|sh|json)$/.test(ent)) {
        const src = readFileSync(p, "utf8");
        src.split(/\r?\n/).forEach((l, i) => {
          if (re.test(l) && !/runner-test\.mjs/.test(p)) bad.push(`${path.relative(ROOT, p)}:${i + 1}: ${l.trim().slice(0, 90)}`);
        });
      }
    }
  };
  for (const d of ["app", "lib", "validator", "scripts", "components"]) if (existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  if (re.test(pkg.scripts.start) || re.test(pkg.scripts.dev)) bad.push("package.json start/dev: " + pkg.scripts.start + " / " + pkg.scripts.dev);
  if (!/start-app\.mjs/.test(pkg.scripts.start) || !/start-app\.mjs/.test(pkg.scripts.dev)) bad.push("package.json start/dev do not go through scripts/start-app.mjs");
  const vs = readFileSync(path.join(ROOT, "validator", "server.js"), "utf8");
  if (!/LAYERS_VALIDATOR_PORT/.test(vs)) bad.push("validator/server.js does not read LAYERS_VALIDATOR_PORT");
  const ports = readFileSync(path.join(ROOT, "lib", "ports.ts"), "utf8");
  if (!/DEFAULT_APP_PORT = 3001/.test(ports) || !/DEFAULT_VALIDATOR_PORT = 4001/.test(ports)) bad.push("lib/ports.ts defaults are not 3001/4001");
  if (bad.length) throw new Error("port literals survive:\n" + bad.join("\n"));
});

// ---- 6. the runner's source keeps the never-silently-green branch ----
await check("6. RUNNER SOURCE: the classifier has no path from a non-zero exit to 'ok' (the 'no verdict' INFRA branch is present) and the launch refusal is wired to the probe", async () => {
  const src = readFileSync(path.join(ROOT, "scripts", "sweep-x.sh"), "utf8");
  if (!/elif \[ "\$code" -ne 0 \]; then/.test(src) || !/with no verdict/.test(src)) throw new Error("the non-zero → INFRA branch is missing");
  if (!/health-probe\.mjs/.test(src) || !/REFUSED: app on/.test(src) || !/REFUSED: validator on/.test(src)) throw new Error("the launch refusal is not wired to the signed probe");
  if (/curl -s[f]? -o \/dev\/null --max-time 15 "\$BASE\/api\/dev"/.test(src)) throw new Error("the old any-HTTP-status liveness probe is still present");
});

// ---- 7. the peer check: a misconfigured app is a runner refusal ----
await check("7. PEER: the app's payload names the validator it talks to; a validator under test at another endpoint (a stale VALIDATOR_URL) makes the runner REFUSE to launch", async () => {
  // a proxy on an ephemeral port that IS a valid validator (it relays the
  // real one's signed health + key) — but not the endpoint the app names
  const proxy = await new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const up = await fetch(VBASE + req.url);
        res.writeHead(up.status, { "content-type": "application/json" });
        res.end(await up.text());
      } catch (e) {
        res.writeHead(502);
        res.end(String(e));
      }
    });
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(() => r())) }));
  });
  try {
    const v = await runNode(["scripts/lib/health-probe.mjs", proxy.url, "layers-validator"]);
    if (v.code !== 0) throw new Error("the proxy should read as a valid validator: " + v.out);
    const a = await runNode(["scripts/lib/health-probe.mjs", BASE, "layers", "--peer=" + proxy.url]);
    if (a.code !== 1 || !/DOWN: app is configured to talk to a validator at /.test(a.out)) throw new Error(`peer mismatch not detected: exit ${a.code} ${a.out}`);
    const r = await runRunner({ BASE_URL: BASE, VALIDATOR_URL: proxy.url, SUITES_OVERRIDE: "probe:pass" });
    if (r.code !== 2 || !/REFUSED: app on /.test(r.out) || /probe:pass\s+ok/.test(r.out)) throw new Error(`runner did not refuse on the peer mismatch: exit ${r.code}\n${r.out}`);
    const good = await runNode(["scripts/lib/health-probe.mjs", BASE, "layers", "--peer=" + VBASE]);
    if (good.code !== 0) throw new Error("the matching peer should pass: " + good.out);
  } finally {
    await proxy.close();
  }
});

console.log(`\n${passed}/${n} runner checks passed${failed ? `, ${failed} FAILED, 0 infra` : ""}`);
process.exit(failed ? 1 : 0);
