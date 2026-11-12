// PUBLIC PREVIEW Gate 2 (run as BROWSER KEYSTORE PASS Gate 6) — `npm run docs:summary`: MERGE pages into
// docs/SUMMARY.md, never regenerate it.
//
// GitBook's table of contents is the owner's document. This script reads it, keeps every existing line verbatim and
// in place, and appends — under one trailing "## Unsorted" heading — a link for every Markdown page under docs/ that
// the summary does not yet reference. It never removes, rewrites or reorders a line. docs/internal/ (the internal
// section), the VitePress directory and *-generated.md partials (pulled into a page with <!--@include: -->, excluded
// from the build) are not GitBook pages and are skipped. Idempotent; prints what it added.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DOCS = path.join(ROOT, "docs");
const SUMMARY = path.join(DOCS, "SUMMARY.md");
const SKIP_DIRS = new Set([".vitepress", "internal", "node_modules"]);
const UNSORTED = "## Unsorted (added by `npm run docs:summary` — move these where they belong)";

function pages(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) pages(p, out);
    } else if (name.endsWith(".md") && name !== "SUMMARY.md" && !name.endsWith("-generated.md")) out.push(p); // a *-generated.md is a partial included into a page, not a page
  }
  return out;
}
const titleOf = (file) => {
  const m = /^#\s+(.+?)\s*$/m.exec(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
  return (m ? m[1] : path.basename(file, ".md")).replace(/[[\]]/g, "");
};

const rel = (f) => path.relative(DOCS, f).split(path.sep).join("/");
const existing = existsSync(SUMMARY) ? readFileSync(SUMMARY, "utf8").replace(/\r\n/g, "\n") : "# Table of contents\n\n* [Totem](index.md)\n";
const linked = new Set([...existing.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1].replace(/^\.\//, "")));
const missing = pages(DOCS)
  .map(rel)
  .filter((r) => !linked.has(r))
  .sort();

if (missing.length === 0) {
  if (!existsSync(SUMMARY)) writeFileSync(SUMMARY, existing);
  console.log("docs:summary — nothing to add (" + linked.size + " pages listed)");
  process.exit(0);
}
let out = existing.endsWith("\n") ? existing : existing + "\n";
if (!out.includes(UNSORTED)) out += "\n" + UNSORTED + "\n\n";
for (const r of missing) out += `* [${titleOf(path.join(DOCS, r))}](${r})\n`;
writeFileSync(SUMMARY, out);
console.log("docs:summary — appended " + missing.length + " page(s) under the Unsorted heading:\n  " + missing.join("\n  "));
