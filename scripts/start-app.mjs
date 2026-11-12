// ATTESTATION PASS Gate 0 — `npm run start` / `npm run dev` on the PINNED
// port. npm scripts cannot read an environment variable portably (cmd.exe
// has no ${VAR:-default}), so this launcher does: LAYERS_APP_PORT, default
// 3001 (lib/ports.ts is the source of truth; this is its shell-side
// duplicate). Spawns next's own bin directly — no shell, so a repo path
// with spaces is not a problem.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const mode = process.argv[2] === "dev" ? "dev" : "start";
// BROWSER KEYSTORE PASS Gate 6: a host assigns the port at runtime through PORT. The pinned LAYERS_APP_PORT still
// wins where it is set (every rig and suite sets it), so local behaviour is unchanged; PORT is the deployment's.
const raw = Number(process.env.LAYERS_APP_PORT ?? process.env.PORT);
const port = Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : 3001;
// MULTI-FID Gate 0 — BOOT CHECK. Next reads .env.local itself, so a stale
// VALIDATOR_URL there silently points the app at a dead port while the
// validator listens on the pinned one (the attestation pass's MORNING item:
// :4000 vs :4001). Refuse to start when a LOCAL validator URL names a port
// other than LAYERS_VALIDATOR_PORT. A remote validator's port is its own.
function envFileValues(file) {
  const out = {};
  if (!file || !existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const fileVals = envFileValues(process.env.LAYERS_ENV_FILE || path.join(process.cwd(), ".env.local"));
const pinnedRaw = Number(process.env.LAYERS_VALIDATOR_PORT ?? fileVals.LAYERS_VALIDATOR_PORT);
const pinnedPort = Number.isInteger(pinnedRaw) && pinnedRaw > 0 && pinnedRaw < 65536 ? pinnedRaw : 4001;
for (const name of ["VALIDATOR_URL", "NEXT_PUBLIC_VALIDATOR_URL"]) {
  const value = process.env[name] ?? fileVals[name];
  if (!value) continue;
  let u;
  try {
    u = new URL(value);
  } catch {
    console.error(`layers: refusing to start — ${name} is not a URL (${value})`);
    process.exit(2);
  }
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname)) continue;
  const p = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (p !== pinnedPort) {
    console.error(
      `layers: refusing to start — ${name} points the app at a validator on port ${p}, but LAYERS_VALIDATOR_PORT pins ${pinnedPort}. ` +
        `Fix ${name} in .env.local (or unset it) so the app and the validator agree.`
    );
    process.exit(2);
  }
}
if (process.env.LAYERS_BOOT_CHECK_ONLY === "1") {
  console.log(`layers: boot check ok (validator port ${pinnedPort})`);
  process.exit(0);
}
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, mode, "-p", String(port)], { stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGINT", "SIGTERM"]) {
  try {
    process.on(sig, () => child.kill(sig));
  } catch {
    /* platform without the signal */
  }
}
