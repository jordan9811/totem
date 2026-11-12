// Gate 0 orchestrator: write state → HARD-restart both servers → verify.
// Uses a real process kill (not a graceful shutdown) so the test proves
// durability rather than a flush-on-exit hook.
import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const NEXT_PORT = Number(process.env.LAYERS_APP_PORT || 3001);
const VALIDATOR_PORT = Number(process.env.LAYERS_VALIDATOR_PORT || process.env.VALIDATOR_PORT || 4001);

function pidsOnPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8", shell: "cmd.exe" });
    const pids = new Set();
    for (const line of out.split("\n")) {
      const m = line.trim().match(/LISTENING\s+(\d+)/);
      if (m) pids.add(m[1]);
    }
    return [...pids];
  } catch {
    return [];
  }
}

function kill(pid) {
  try {
    execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore", shell: "cmd.exe" });
  } catch {
    /* already gone */
  }
}

// Next dev cold start + first route compile on this machine (OneDrive-backed
// working dir) regularly exceeds 90s. Give it real headroom rather than
// reporting a false "servers did not come back up".
async function waitFor(url, timeoutMs = 300_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(700);
  }
  return false;
}

function run(cmd, args, name) {
  const p = spawn(cmd, args, {
    stdio: "ignore",
    detached: false,
    shell: true,
    env: { ...process.env },
  });
  p.on("error", (e) => console.log(`[gate0] ${name} spawn error: ${e.message}`));
  return p;
}

const step = (s) => console.log(`\n[gate0] ${s}`);

step("phase 1 — writing state (mode, rule, block, readwise schedule)");
execSync("node scripts/restart-survival.mjs write", { stdio: "inherit" });

step("phase 2 — hard-killing both servers");
const victims = [...pidsOnPort(NEXT_PORT), ...pidsOnPort(VALIDATOR_PORT)];
console.log("  killing pids:", victims.join(", ") || "(none found)");
victims.forEach(kill);
await sleep(2000);

step("phase 3 — restarting both servers");
run("node", ["validator/server.js"], "validator");
await sleep(1500);
// `next start`, not `next dev`. Every other suite runs against the
// production build, so restarting into a dev server would be testing a
// different artifact — and a cold dev compile on this filesystem regularly
// outran the wait, which presented as "servers did not come back up".
run("npx", ["next", "start", "-p", String(NEXT_PORT)], "next");

const vOk = await waitFor(`http://localhost:${VALIDATOR_PORT}/health`);
console.log(`  validator up: ${vOk}`);
const nOk = await waitFor(`http://localhost:${NEXT_PORT}/home`);
console.log(`  next up: ${nOk}`);
if (!vOk || !nOk) {
  console.log("\n[gate0] servers did not come back up");
  process.exit(1);
}
// Give Next a beat to finish compiling the API routes on first hit.
await sleep(3000);

step("phase 4 — verifying state survived");
try {
  execSync("node scripts/restart-survival.mjs verify", { stdio: "inherit" });
} catch {
  process.exit(1);
}
