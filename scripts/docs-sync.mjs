// MEGA PASS 2 Gate 8 — `npm run docs:sync`
//
// Every `{cite: FILE > "Heading"}` in the docs points at a section of a report. This hashes each cited section (the
// heading line through the line before the next heading of the same or a higher level) and compares it with
// docs/.cite-lock.json — the hashes as they were when the page was written or last reviewed.
//
//   npm run docs:sync            report drift: a cited section whose text changed since the lock (exit 1), and cites
//                                that have no lock entry yet (exit 1 — a new cite is reviewed by locking it)
//   npm run docs:sync -- --update   rewrite the lock from the current reports (after a human has re-read the pages)
//
// Drift is not an error in the report — reports are append-mostly — it is a flag that a page may now say something
// its source no longer says. The page owner re-reads, edits if needed, and locks.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { CITE_RE, citeHeading, resolveCiteFile, sectionsOf, walk } from "./docs-check.mjs";

const ROOT = process.cwd();
const LOCK = join(ROOT, "docs", ".cite-lock.json");
const UPDATE = process.argv.includes("--update");

export function collectCites() {
  const cites = new Map(); // key "FILE > heading" → { file, heading, pages: Set }
  for (const page of walk(join(ROOT, "docs"))) {
    const rel = relative(ROOT, page).split(sep).join("/");
    for (const m of readFileSync(page, "utf8").matchAll(CITE_RE)) {
      const key = `${m[1].trim()} > ${citeHeading(m)}`;
      if (!cites.has(key)) cites.set(key, { file: m[1].trim(), heading: citeHeading(m), pages: new Set() });
      cites.get(key).pages.add(rel);
    }
  }
  return cites;
}

export function hashSection(file, heading) {
  const abs = resolveCiteFile(file);
  if (!abs) return null;
  const s = sectionsOf(abs).find((x) => x.heading === heading);
  if (!s) return null;
  return createHash("sha256").update(s.body.replace(/\s+/g, " ").trim(), "utf8").digest("hex").slice(0, 24);
}

export function syncDocs(update = false) {
  let lock = {};
  try { lock = JSON.parse(readFileSync(LOCK, "utf8")); } catch { lock = {}; }
  const cites = collectCites();
  const drift = [];
  const unlocked = [];
  const unresolved = [];
  const next = {};
  for (const [key, c] of [...cites.entries()].sort()) {
    const h = hashSection(c.file, c.heading);
    if (!h) { unresolved.push({ key, pages: [...c.pages] }); continue; }
    next[key] = h;
    if (!(key in lock)) unlocked.push({ key, pages: [...c.pages] });
    else if (lock[key] !== h) drift.push({ key, pages: [...c.pages], was: lock[key], now: h });
  }
  const stale = Object.keys(lock).filter((k) => !(k in next));
  if (update) writeFileSync(LOCK, JSON.stringify(next, null, 2) + "\n");
  return { total: cites.size, drift, unlocked, unresolved, stale, updated: update };
}

if (process.argv[1] && /docs-sync\.mjs$/.test(process.argv[1])) {
  const r = syncDocs(UPDATE);
  for (const d of r.drift) console.log(`  DRIFT     ${d.key}  ←  ${d.pages.join(", ")}`);
  for (const u of r.unlocked) console.log(`  UNLOCKED  ${u.key}  ←  ${u.pages.join(", ")}`);
  for (const u of r.unresolved) console.log(`  MISSING   ${u.key}  ←  ${u.pages.join(", ")}`);
  for (const s of r.stale) console.log(`  stale lock entry (no page cites it any more): ${s}`);
  console.log(`\ndocs:sync — ${r.total} cited sections, ${r.drift.length} drifted, ${r.unlocked.length} unlocked, ${r.unresolved.length} unresolved${r.updated ? " — lock rewritten" : ""}`);
  process.exitCode = r.updated ? (r.unresolved.length ? 1 : 0) : r.drift.length || r.unlocked.length || r.unresolved.length ? 1 : 0;
}
