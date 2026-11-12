// PUBLIC PREVIEW Gate 0 — the secrets audit. Reads every value in .env.local and asks, for each, whether it appears in
// the built client bundle (.next/static), the server bundle (.next/server), the two process logs, or any tracked file.
// Prints NAMES and COUNTS only — never a value. Exit 1 if any secret value reaches the client bundle or a tracked file.
//
// FC-READ (the public live-read relay): two additions.
//   * The DEVICE bundle (public/device/device.js) is a target and counts like the client bundle: it is served to every
//     visitor, it is gitignored (so `git ls-files` never covered it), and it is exactly where a relay mistake would
//     ship the read key — the device reads through POST /api/fc/read and must never hold the key.
//   * NEYNAR_READ_API_KEY is the one secret this audit is REQUIRED to learn. The audit can only find a value it read
//     from .env.local, so with that key absent there the leak check for it finds 0 hits by construction — a vacuous
//     pass. The audit then says COULD NOT RUN and exits 2 (not 0, not 1): put the read key in .env.local (the
//     production-shaped launcher blanks it for the app, so it cannot arm a local run) and run it again. Its value
//     found in the app log counts as a leak too: the relay never logs the key (lib/fc/readRelay.server.ts).
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TEMP = process.env.TEMP || process.env.TMP || "";
const walk = (dir, out = []) => { if (!existsSync(dir)) return out; for (const e of readdirSync(dir)) { const p = join(dir, e); const s = statSync(p); if (s.isDirectory()) walk(p, out); else if (s.size < 50 * 1024 * 1024) out.push(p); } return out; };

const envPath = join(ROOT, ".env.local");
const pairs = existsSync(envPath)
  ? readFileSync(envPath, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
  : [];
// PUBLIC by design (NEXT_PUBLIC_*) and non-secret config are reported but never counted as leaks
const PUBLIC_OK = (k) => k.startsWith("NEXT_PUBLIC_") || /^(VALIDATOR_URL|FC_TEST_FID|FC_TEST_FNAME|FC_TEST_ORIGIN|LAYERS_APP_PORT|LAYERS_VALIDATOR_PORT)$/.test(k);
const SECRET_LIKE = (k) => /KEY|SECRET|TOKEN|PRIVATE|UUID|WALLET|PASSWORD/i.test(k);

// FC-READ: the secrets this audit must be able to look for; without a local value the audit cannot run for them
const REQUIRED_SECRETS = ["NEYNAR_READ_API_KEY"];
// FC-READ (lead): a required secret may also come from this process's environment (a launcher that injected it)
for (const n of REQUIRED_SECRETS) {
  const v = (process.env[n] || "").trim();
  if (v.length >= 6 && !pairs.some(([k]) => k === n)) pairs.push([n, v]);
}
const deviceBundle = join(ROOT, "public", "device", "device.js");

const targets = {
  "client bundle (.next/static)": walk(join(ROOT, ".next", "static")),
  // FC-READ: served to every visitor and gitignored — `git ls-files` never saw it
  "device bundle (public/device/device.js)": existsSync(deviceBundle) ? [deviceBundle] : [],
  "server bundle (.next/server)": walk(join(ROOT, ".next", "server")),
  "app log": TEMP && existsSync(join(TEMP, "layers-app.log")) ? [join(TEMP, "layers-app.log")] : [],
  "validator log": TEMP && existsSync(join(TEMP, "layers-validator.log")) ? [join(TEMP, "layers-validator.log")] : [],
};
let tracked = [];
try { tracked = execSync("git ls-files", { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).map((f) => join(ROOT, f)).filter((f) => existsSync(f) && statSync(f).isFile() && statSync(f).size < 5 * 1024 * 1024); } catch {}
targets["tracked files (git ls-files)"] = tracked;

const contents = {};
for (const [label, files] of Object.entries(targets)) contents[label] = files.map((f) => { try { return readFileSync(f, "latin1"); } catch { return ""; } });

let leaks = 0;
const rows = [];
for (const [name, value] of pairs) {
  const row = { name, kind: PUBLIC_OK(name) ? "public-by-design" : SECRET_LIKE(name) ? "SECRET" : "config", length: value.length, hits: {} };
  for (const [label, texts] of Object.entries(targets)) {
    let n = 0;
    if (value.length >= 6) for (const t of contents[label]) { let i = -1; while ((i = t.indexOf(value, i + 1)) !== -1) n++; }
    let nameHits = 0;
    for (const t of contents[label]) { let i = -1; while ((i = t.indexOf(name, i + 1)) !== -1) nameHits++; }
    row.hits[label] = { value: n, name: nameHits };
    if (n > 0 && row.kind !== "public-by-design" && /client bundle|device bundle|tracked files/.test(label)) leaks++;
    // FC-READ: the relay maps every failure to a fixed code and never logs a message, so the read key in a log is a leak
    if (n > 0 && REQUIRED_SECRETS.includes(name) && /app log|validator log/.test(label)) leaks++;
  }
  rows.push(row);
}
console.log("\nSECRETS AUDIT — .env.local values against the build output, the logs and every tracked file (names and counts only)\n");
for (const r of rows) {
  const parts = Object.entries(r.hits).map(([l, h]) => `${l.split(" (")[0]}: value×${h.value} name×${h.name}`).join(" | ");
  console.log(`  ${r.kind.padEnd(16)} ${r.name.padEnd(30)} len=${String(r.length).padEnd(4)} ${parts}`);
}
// the keystore and the zk artifacts: ignored by git? present?
for (const p of [".env.local", ".keystore", "validator/layers.db", ".zk-artifacts", "research/live-fid1.json"]) {
  let ignored = false;
  try { execSync(`git check-ignore -q "${p}"`); ignored = true; } catch {}
  console.log(`  ${ignored ? "ignored " : "TRACKED?"} ${p}${existsSync(join(ROOT, p)) ? "" : " (absent)"}`);
}
// keystore material shape: the root seed / device key never appears in the bundles or logs
try {
  const ks = JSON.parse(readFileSync(join(ROOT, ".keystore", "root.json"), "utf8"));
  const blobs = Object.values(ks).flatMap((v) => (typeof v === "string" && v.length >= 32 ? [v] : typeof v === "object" && v ? Object.values(v).filter((x) => typeof x === "string" && x.length >= 32) : []));
  let ksHits = 0;
  for (const [label, texts] of Object.entries(targets)) for (const t of texts) for (const b of blobs) if (t.includes(b)) { ksHits++; console.log("  KEYSTORE MATERIAL FOUND in " + label); }
  console.log(`  keystore: ${blobs.length} long value(s) checked against every target — ${ksHits} hit(s)`);
  if (ksHits) leaks++;
} catch (e) { console.log("  keystore: not readable here (" + e.message.slice(0, 60) + ")"); }
// FC-READ: the targets that decide a leak must exist, or "0 hits" is a statement about nothing
if (!targets["device bundle (public/device/device.js)"].length) console.log("  device bundle: public/device/device.js is absent (build it: npm run build) — it was not audited");
if (!targets["client bundle (.next/static)"].length) console.log("  client bundle: .next/static is absent — it was not audited");
// FC-READ (lead): a required secret may also be learned from this process's environment (a launcher that injected it).
// With no value anywhere, the audit is only vacuous if some LOCAL process could have held the key: the relay logs
// "[fc-read] armed" the first time it arms, so an app log without that line means no local process ever held one and
// there is nothing local for it to leak into. That case is reported as NOT AUDITED, loudly, and is not a failure.
const appLogPath = TEMP ? join(TEMP, "layers-app.log") : "";
const relayArmedLocally = !!appLogPath && existsSync(appLogPath) && /\[fc-read\] armed/.test(readFileSync(appLogPath, "utf8"));
const unlearnedAll = REQUIRED_SECRETS.filter((n) => !pairs.some(([k, v]) => k === n && v.length >= 6));
for (const n of unlearnedAll) if (!relayArmedLocally) console.log(`  NOT AUDITED: ${n} has no local value and the app log shows the relay never armed here, so no local process held it`);
const unlearned = relayArmedLocally ? unlearnedAll : [];
console.log(`\n${leaks === 0 ? "CLEAN" : "LEAK"}: ${leaks} secret value(s) in the client bundle, the device bundle or a tracked file (or the read key in a log)`);
if (leaks) process.exitCode = 1;
else if (unlearned.length || !targets["device bundle (public/device/device.js)"].length) {
  // FC-READ: not a pass. With no local value there is nothing to grep for, and with no device bundle nothing to grep in.
  const why = [
    ...unlearned.map((n) => `${n} has no value in .env.local, so its leak check would find 0 hits by construction`),
    ...(!targets["device bundle (public/device/device.js)"].length ? ["public/device/device.js does not exist"] : []),
  ];
  console.log(`COULD NOT RUN: ${why.join("; ")}. Exit 2 — this is not a pass.`);
  process.exitCode = 2;
} else process.exitCode = 0;
