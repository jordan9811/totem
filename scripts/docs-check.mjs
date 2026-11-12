// MEGA PASS 2 Gate 8 — `npm run docs:check`
//
// The docs may not claim more than the reports do. This walks every page under docs/ and fails when:
//   1. a paragraph makes a PRIVACY CLAIM (a strong-claim keyword — never / cannot / impossible / unlinkable /
//      guarantee / zero-knowledge / fail-closed / "does not learn" …) without a `{cite: FILE > "Heading"}` token in
//      that paragraph and without an `<!-- uncited-ok -->` marker (a page-level `<!-- uncited-ok: page -->` covers a page
//      whose content is generated from source or is plainly not a claim — the mission page, the index)
//   2. a cite token does not resolve: the file is not in the repo root or research/, or the heading is not there verbatim
//   3. a pass page's frontmatter is missing a field, or its status is outside the vocabulary
//   4. a status tag outside the vocabulary appears (**[TAG]**)
//   5. a page in docs/internal is linked from a public page (the internal flag must hide it cleanly)
// Exit 1 on any failure. `--verbose` lists every paragraph it accepted.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const DOCS = join(ROOT, "docs");
const VERBOSE = process.argv.includes("--verbose");
export const STATUS_VOCAB = ["SHIPPED", "SHIPPED-FIXTURE", "SPECCED", "IDEA", "KNOWN-BROKEN", "UNCLEAR"];
export const CLAIM_RE = /\b(never|cannot|can't|impossible|unlinkable|unlinkability|no one can|nobody can|does not (learn|see|know|store)|doesn't (learn|see|know|store)|never (sees|learns|stored|stores|leaves)|not at rest|fail[- ]closed|mathematically|guarantee[sd]?|zero[- ]knowledge)\b/i;
// {cite: FILE > "Heading"} — single quotes are allowed when the heading itself contains double quotes
export const CITE_RE = /\{cite:\s*([^>{}]+?)\s*>\s*(?:"([^"]+)"|'([^']+)')\s*\}/g;
export const citeHeading = (m) => m[2] ?? m[3];

export function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === ".vitepress" || e === "node_modules") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith(".md")) out.push(p);
  }
  return out;
}

/** headings of a report, verbatim (without the #s), plus the section body under each */
export function sectionsOf(file) {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const out = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (m) out.push({ level: m[1].length, heading: m[2].trim(), start: i });
  }
  for (let k = 0; k < out.length; k++) {
    const next = out.slice(k + 1).find((h) => h.level <= out[k].level);
    out[k].end = next ? next.start : lines.length;
    out[k].body = lines.slice(out[k].start, out[k].end).join("\n");
  }
  return out;
}

export function resolveCiteFile(name) {
  const candidates = [join(ROOT, name), join(ROOT, "research", name), join(ROOT, "docs", name)];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** paragraphs: blank-line-separated blocks; every list item is its own paragraph; fences and frontmatter skipped */
export function paragraphsOf(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const paras = [];
  let cur = [];
  let inFence = false;
  let i = 0;
  if (lines[0] === "---") { i = 1; while (i < lines.length && lines[i] !== "---") i++; i++; }
  const flush = (at) => { if (cur.length) { paras.push({ text: cur.join("\n"), line: at - cur.length + 1 }); cur = []; } };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { inFence = !inFence; flush(i); continue; }
    if (inFence) continue;
    if (!l.trim()) { flush(i); continue; }
    if (/^\s*([-*+]|\d+\.)\s+/.test(l)) { flush(i); cur.push(l); continue; }
    cur.push(l);
  }
  flush(lines.length);
  return paras;
}

export function checkDocs() {
  const problems = [];
  const pages = walk(DOCS);
  let claims = 0;
  let cites = 0;
  const sectionCache = new Map();
  for (const page of pages) {
    const rel = relative(ROOT, page).split(sep).join("/");
    const text = readFileSync(page, "utf8");
    const pageOk = /<!--\s*uncited-ok:\s*page\b[^>]*-->/.test(text);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (rel.startsWith("docs/internal/passes/") && !rel.endsWith("index.md")) {
      const need = ["title", "pass", "report", "date", "status"];
      const have = Object.fromEntries((fm?.[1] ?? "").split(/\r?\n/).map((l) => l.split(/:\s*/, 2)).filter((p) => p.length === 2));
      for (const k of need) if (!have[k]) problems.push(`${rel}: frontmatter lacks ${k}`);
      if (have.status && !STATUS_VOCAB.includes(have.status.trim())) problems.push(`${rel}: status "${have.status}" is not in the vocabulary`);
    }
    for (const m of text.matchAll(/\*\*\[([A-Z-]+)\]\*\*/g)) if (!STATUS_VOCAB.includes(m[1])) problems.push(`${rel}: unknown status tag [${m[1]}]`);
    if (!rel.startsWith("docs/internal/")) {
      for (const m of text.matchAll(/\]\(([^)]+)\)/g)) if (/(^|\/)internal\//.test(m[1])) problems.push(`${rel}: public page links into internal/ (${m[1]})`);
    }
    for (const para of paragraphsOf(text)) {
      const paraCites = [...para.text.matchAll(CITE_RE)];
      for (const c of paraCites) {
        cites++;
        const file = resolveCiteFile(c[1].trim());
        if (!file) { problems.push(`${rel}:${para.line}: cite names a file that does not exist: ${c[1].trim()}`); continue; }
        if (!sectionCache.has(file)) sectionCache.set(file, sectionsOf(file));
        if (!sectionCache.get(file).some((s) => s.heading === citeHeading(c))) problems.push(`${rel}:${para.line}: cite heading not found verbatim in ${c[1].trim()}: "${citeHeading(c)}"`);
      }
      const bare = para.text.replace(CITE_RE, "").replace(/<!--[\s\S]*?-->/g, "");
      if (CLAIM_RE.test(bare)) {
        claims++;
        const excused = paraCites.length > 0 || /<!--\s*uncited-ok\b[^>]*-->/.test(para.text) || pageOk;
        if (!excused) problems.push(`${rel}:${para.line}: privacy claim without a citation — ${bare.trim().slice(0, 110).replace(/\n/g, " ")}`);
        else if (VERBOSE) console.log(`  ok  ${rel}:${para.line} (${paraCites.length ? "cited" : "uncited-ok"})`);
      }
    }
  }
  return { pages: pages.length, claims, cites, problems };
}

if (process.argv[1] && /docs-check\.mjs$/.test(process.argv[1])) {
  const r = checkDocs();
  for (const p of r.problems) console.log("  FAIL  " + p);
  console.log(`\ndocs:check — ${r.pages} pages, ${r.claims} claim paragraphs, ${r.cites} citations, ${r.problems.length} problem(s)`);
  process.exitCode = r.problems.length ? 1 : 0;
}
