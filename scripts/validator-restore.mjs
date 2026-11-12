// PUBLIC PREVIEW Gate 3 (run as BROWSER KEYSTORE PASS Gate 6) — restore the validator's database from a backup.
//   node scripts/validator-restore.mjs <backup.db> [target.db]     (target defaults to VALIDATOR_DB or validator/layers.db)
// STOP THE VALIDATOR FIRST (the restore replaces the file the running process has open). The backup is checked
// (`PRAGMA integrity_check`) before anything is touched; the current database is kept beside the target as
// <target>.pre-restore-<stamp> so the restore itself is reversible; stale -wal/-shm files are removed.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

const [backup, targetArg] = process.argv.slice(2);
if (!backup) {
  console.log("usage: node scripts/validator-restore.mjs <backup.db> [target.db]");
  process.exit(2);
}
const target = targetArg || process.env.VALIDATOR_DB || path.join(process.cwd(), "validator", "layers.db");
if (!existsSync(backup)) { console.error("no such backup: " + backup); process.exit(1); }

const check = new DatabaseSync(backup, { readOnly: true });
const integrity = check.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]).join(",");
const tables = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
check.close();
if (integrity !== "ok") { console.error("backup failed integrity_check: " + integrity); process.exit(1); }

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
if (existsSync(target)) renameSync(target, target + ".pre-restore-" + stamp);
for (const suffix of ["-wal", "-shm"]) if (existsSync(target + suffix)) rmSync(target + suffix);
copyFileSync(backup, target);
console.log("restored " + backup + " → " + target + " (" + tables + " tables; the previous database is at " + target + ".pre-restore-" + stamp + ")");
