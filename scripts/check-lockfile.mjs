// LOCK-FILE SYNC — `npm run test:lockfile`. No server, no browser; it needs the npm registry (npx fetches the pinned npm,
// and a lock that is out of sync makes npm fetch the manifests it is missing).
//
// WHY: on 2026-10-20 1ae1a41 added @farcaster/miniapp-sdk, which pulled rpc-websockets into the production tree. Its
// optionalDependencies (bufferutil, utf-8-validate) never reached package-lock.json, and Dockerfile.validator's
// `npm ci --omit=dev --ignore-scripts` on node:24-slim refused the lock ("Missing: bufferutil@4.1.0 from lock file").
// Nothing local ran `npm ci`, so the Railway build was the first to notice. 0e25657 regenerated the lock with
// `npx -y npm@11.19.1 install --package-lock-only --ignore-scripts`.
//
// It copies package.json, package-lock.json and validator/package.json (exactly what Dockerfile.validator copies before
// its install) into a temp dir and dry-runs there
//   validator  npm ci --omit=dev --ignore-scripts   (Dockerfile.validator)
//   app        npm ci                               (the app's Railpack build)
// each with the local npm and with `npx -y npm@NODE24_SLIM_NPM`. `npm ci --dry-run` still checks the lock against
// package.json before it would install anything, and writes nothing. A "Missing:" line or EUSAGE is a FAIL (exit 1);
// any other non-zero exit, after one retry, is INFRA (exit 2: could not test, e.g. the registry was unreachable).
// The temp dir gets an empty user and global npmrc, as a fresh container has: a local setting (legacy-peer-deps,
// omit=optional) must not hide what the image would see.
// CANARY: with each npm, the validator dry run against a copy of the lock with one dependency deleted must FAIL with
// "Missing:". Otherwise an npm whose --dry-run skipped the check would turn this green over nothing.
//
//   node scripts/check-lockfile.mjs [root]   (default: this repo; any folder holding the three files)
//
// The fix for a FAIL: npx -y npm@<version> install --package-lock-only --ignore-scripts, then commit the lock.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The npm inside node:24-slim, Dockerfile.validator's base (the app's build reads .node-version, also 24).
// BUMP THIS when that image moves: docker run --rm node:24-slim npm --version
const NODE24_SLIM_NPM = "11.19.1";

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const FILES = ["package.json", "package-lock.json", path.join("validator", "package.json")];
const INSTALLS = [
  { label: "validator", args: ["ci", "--omit=dev", "--ignore-scripts"] },
  { label: "app", args: ["ci"] },
];
const NPMS = [
  { label: "local npm", cmd: "npm", pre: [] },
  { label: `npm@${NODE24_SLIM_NPM}`, cmd: "npx", pre: ["-y", `npm@${NODE24_SLIM_NPM}`], want: NODE24_SLIM_NPM },
];
const FIX = `npx -y npm@${NODE24_SLIM_NPM} install --package-lock-only --ignore-scripts, then commit package-lock.json`;

for (const f of FILES) {
  if (!existsSync(path.join(ROOT, f))) {
    console.log(`  INFRA lockfile — ${path.join(ROOT, f)} not found`);
    console.log(`\n0/0 lockfile checks passed, 1 infra`);
    process.exit(2);
  }
}

const TMP = mkdtempSync(path.join(os.tmpdir(), "layers-lockfile-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));
// npm refuses to load one file as both the user and the global config
const USER_NPMRC = path.join(TMP, "user-npmrc");
const GLOBAL_NPMRC = path.join(TMP, "global-npmrc");
writeFileSync(USER_NPMRC, "");
writeFileSync(GLOBAL_NPMRC, "");

function stage(dir, lock) {
  mkdirSync(path.join(dir, "validator"), { recursive: true });
  for (const f of FILES) copyFileSync(path.join(ROOT, f), path.join(dir, f));
  if (lock) writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
}

// the real project
const PROJECT = path.join(TMP, "project");
stage(PROJECT);
// the canary: the same project, its lock missing the first production dependency
const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
const deps = Object.keys(JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).dependencies || {});
const dropped = deps.find((d) => lock.packages && lock.packages[`node_modules/${d}`]);
const CANARY = path.join(TMP, "canary");
if (dropped) {
  delete lock.packages[`node_modules/${dropped}`];
  stage(CANARY, lock);
}

// npm's own config from the parent (`npm run` exports npm_config_*, npm_package_*, npm_lifecycle_*) stays out
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)));
Object.assign(env, {
  npm_config_userconfig: USER_NPMRC,
  npm_config_globalconfig: GLOBAL_NPMRC,
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
});

function run(npm, args, cwd) {
  // Windows runs npm.cmd / npx.cmd, which Node only spawns through a shell; every argument here is free of spaces
  const r = spawnSync(npm.cmd, [...npm.pre, ...args], {
    cwd,
    env,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (/Missing:|EUSAGE/.test(out)) {
    const lines = [...new Set(out.split(/\r?\n/).filter((l) => /Missing:|Invalid:|EUSAGE/.test(l)).map((l) => l.trim()))];
    return { kind: "refused", lines };
  }
  if (r.status === 0 && !r.error) return { kind: "ok", out };
  const last = out.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" | ");
  return { kind: "infra", why: r.error ? r.error.message : `exit ${r.status}${last ? ": " + last : ""}` };
}

// a refusal is deterministic; anything else unexplained gets one more attempt before it is reported as INFRA
function runRetried(npm, args, cwd) {
  const first = run(npm, args, cwd);
  return first.kind === "infra" ? run(npm, args, cwd) : first;
}

let passed = 0;
let failed = 0;
let infra = 0;
const failures = [];
const pass = (name, extra) => {
  passed++;
  console.log(`  PASS  ${name}${extra ? " — " + extra : ""}`);
};
const fail = (name, why, lines = []) => {
  failed++;
  failures.push(name);
  console.log(`  FAIL  ${name} — ${why}`);
  for (const l of lines.slice(0, 8)) console.log(`          ${l}`);
};
const infraOut = (name, why) => {
  infra++;
  console.log(`  INFRA ${name} — ${why}`);
};

for (const npm of NPMS) {
  // which npm actually runs: also fetches the pinned one before the timed runs
  const v = runRetried(npm, ["--version"], PROJECT);
  const version = v.kind === "ok" ? v.out.trim().split(/\r?\n/).pop() : null;
  if (!version || (npm.want && version !== npm.want)) {
    for (const i of INSTALLS) infraOut(`${npm.label} ${i.label}`, version ? `npm --version said ${version}` : `npm did not start (${v.why})`);
    if (dropped) infraOut(`${npm.label} canary`, "skipped with the runs above");
    continue;
  }
  for (const i of INSTALLS) {
    const name = `${npm.label} ${i.label}`;
    const cmd = `npm ci${i.args.slice(1).map((a) => " " + a).join("")} --dry-run`;
    const r = runRetried(npm, [...i.args, "--dry-run"], PROJECT);
    if (r.kind === "ok") pass(name, `${cmd} (npm ${version})`);
    else if (r.kind === "refused") fail(name, `${cmd} (npm ${version}) refused the lock; fix: ${FIX}`, r.lines);
    else infraOut(name, `${cmd} (npm ${version}): ${r.why}`);
  }
  const name = `${npm.label} canary`;
  if (!dropped) {
    infraOut(name, "no production dependency of package.json has a lock entry to delete");
    continue;
  }
  const r = runRetried(npm, [...INSTALLS[0].args, "--dry-run"], CANARY);
  if (r.kind === "refused" && r.lines.some((l) => l.includes(`Missing: ${dropped}@`))) {
    pass(name, `a lock without ${dropped} is refused (npm ${version})`);
  } else if (r.kind === "infra") {
    infraOut(name, `npm ${version}: ${r.why}`);
  } else {
    // the dry run accepted a lock it should refuse, or refused it for another reason: the runs above prove nothing
    infraOut(name, `npm ${version} did not report "Missing: ${dropped}@…" for a lock without it${r.kind === "refused" ? " (said: " + r.lines.slice(0, 2).join(" | ") + ")" : ""}: this check cannot vouch for that npm`);
  }
}

const total = passed + failed + infra;
console.log(`\n${passed}/${total} lockfile checks passed` + (failed ? `, ${failed} FAILED: ${failures.join(" | ")}` : "") + (infra ? `, ${infra} infra` : ""));
process.exit(failed ? 1 : infra ? 2 : 0);
