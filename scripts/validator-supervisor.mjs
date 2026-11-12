// ZK PASS 2 Gate 0 — THE VALIDATOR SUPERVISOR (`npm run validator:supervised`).
//
// Pass 1's closing sweeps lost a validator process with an EMPTY stderr:
// no stack, no Windows fault event, nothing after "listening". A death
// like that must be impossible to repeat SILENTLY. This process spawns
// the validator, keeps the last 50 lines it printed in a ring buffer,
// and on ANY exit appends a record — timestamp, exit code (hex too, for
// Windows NTSTATUS crashes), signal, uptime, the last 50 lines — to
// `validator/deaths.log` (runtime state, gitignored via *.log), then
// restarts it with a short backoff. The exit code is observed by the
// PARENT, which catches even an external termination the child could
// not log itself.
//
// Env passes straight through (ZK_DEV_HOOKS, LAYERS_REQUIRE_SIG,
// VALIDATOR_PORT, VALIDATOR_DB, ZK_* …). Ctrl-C / SIGTERM to the
// supervisor stops the child and exits without a death record.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const serverJs = path.join(repo, "validator", "server.js");
const deathsLog = process.env.VALIDATOR_DEATHS_LOG || path.join(repo, "validator", "deaths.log");
const RING = 50;
const BACKOFF_MS = [1000, 2000, 5000, 10000];

let stopping = false;
let restarts = 0;

function record(line) {
  mkdirSync(path.dirname(deathsLog), { recursive: true });
  appendFileSync(deathsLog, line);
}

function start() {
  const startedAt = Date.now();
  const ring = [];
  // windowsHide: the child gets NO console of its own. Without it the
  // restart inherits this process's console, and once the console that
  // launched the supervisor is gone (the harness call that started it has
  // returned) every restart dies at process init with 0xC0000142
  // (STATUS_DLL_INIT_FAILED) before a line of JS runs — closing sweep 1 of
  // the attestation pass: 36 restarts in a row, the validator never came back.
  const child = spawn(process.execPath, ["--trace-uncaught", serverJs], {
    cwd: repo,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const tee = (stream, sink) => {
    let buf = "";
    stream.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      sink.write(text);
      buf += text;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        ring.push(buf.slice(0, i));
        if (ring.length > RING) ring.shift();
        buf = buf.slice(i + 1);
      }
    });
  };
  tee(child.stdout, process.stdout);
  tee(child.stderr, process.stderr);
  process.stdout.write(`[supervisor] ${new Date().toISOString()} started validator pid ${child.pid} (restart #${restarts})\n`);
  child.on("exit", (code, signal) => {
    if (stopping) return;
    const uptimeS = Math.round((Date.now() - startedAt) / 1000);
    const hex = code !== null && code !== undefined && code >= 0 ? "0x" + code.toString(16) : "n/a";
    const entry = [
      `=== ${new Date().toISOString()} validator pid ${child.pid} EXITED code=${code} (${hex}) signal=${signal} uptime=${uptimeS}s restart#=${restarts}`,
      ...ring.map((l) => "  | " + l),
      "",
    ].join("\n");
    record(entry);
    process.stderr.write(`[supervisor] validator died: code=${code} signal=${signal} uptime=${uptimeS}s — recorded in ${deathsLog}\n`);
    // PROD-LIVE: exit 78 (EX_CONFIG) is the env contract REFUSING to boot. Restarting it every few seconds forever
    // hides the refusal behind a healthy-looking supervisor; exit with the same code so the platform fails the deploy.
    if (code === 78) {
      process.stderr.write("[supervisor] the validator refused its configuration (exit 78) — not restarting\n");
      process.exit(78);
    }
    const delay = BACKOFF_MS[Math.min(restarts, BACKOFF_MS.length - 1)];
    restarts++;
    setTimeout(start, delay);
  });
  const stop = () => {
    stopping = true;
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    setTimeout(() => process.exit(0), 200);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

start();
