// PUBLIC PREVIEW Gate 3 (run as BROWSER KEYSTORE PASS Gate 6) — scheduled dumps of the validator's database.
//
// `VACUUM INTO` writes a consistent single-file copy without holding the writer lock for long and works under WAL;
// one dump every VALIDATOR_BACKUP_EVERY_MS (default 6 h) into VALIDATOR_BACKUP_DIR, the newest VALIDATOR_BACKUP_KEEP
// (default 28) kept. Absent VALIDATOR_BACKUP_DIR, nothing runs (the rig). Restore: scripts/validator-restore.mjs.
// The copy holds exactly what the live database holds: ciphertext namespaces, public keys, trees, counters — the
// same "what the server holds" as the running service, so a backup is not a new exposure class.
const fs = require("node:fs");
const path = require("node:path");

function listBackups(dir) {
  return fs
    .readdirSync(dir)
    .filter((n) => /^layers-\d{4}-\d{2}-\d{2}T.*\.db$/.test(n))
    .sort();
}

function backupOnce(db, dir, log = console) {
  fs.mkdirSync(dir, { recursive: true });
  const name = "layers-" + new Date().toISOString().replace(/[:.]/g, "-") + ".db";
  const target = path.join(dir, name);
  db.exec("VACUUM INTO '" + target.replace(/'/g, "''") + "'");
  return { name, target, bytes: fs.statSync(target).size };
}

function prune(dir, keep) {
  const names = listBackups(dir);
  for (const n of names.slice(0, Math.max(0, names.length - keep))) {
    try {
      fs.unlinkSync(path.join(dir, n));
    } catch {
      /* a vanished file is already pruned */
    }
  }
}

/** start the schedule; returns the controller (run now / stop) or null when no directory is configured */
function startBackups(db, opts = {}) {
  const dir = opts.dir ?? process.env.VALIDATOR_BACKUP_DIR;
  if (!dir) return null;
  const log = opts.log ?? console;
  const everyMs = Number(opts.everyMs ?? process.env.VALIDATOR_BACKUP_EVERY_MS ?? 6 * 60 * 60 * 1000);
  const keep = Number(opts.keep ?? process.env.VALIDATOR_BACKUP_KEEP ?? 28);
  const run = () => {
    try {
      const r = backupOnce(db, dir, log);
      prune(dir, keep);
      log.log("[validator] backup written: " + r.name + " (" + r.bytes + " bytes; keeping " + keep + ")");
      return r;
    } catch (e) {
      log.error("[validator] backup FAILED: " + (e && e.message ? e.message : String(e)));
      return null;
    }
  };
  const first = setTimeout(run, Number(opts.firstDelayMs ?? 30_000));
  first.unref();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return { run, stop: () => { clearTimeout(first); clearInterval(timer); }, dir, everyMs, keep };
}

module.exports = { startBackups, backupOnce, listBackups, prune };
