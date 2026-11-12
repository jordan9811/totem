// DOCS UNDER APP (D-DOCS-UNDER-APP) — step 3 of `npm run build`: the post-build guard over the docs the app is about
// to serve. Ported from the RUN step railway/Dockerfile.docs carried while the docs had a service of their own, check
// for check, so the app build now fails exactly where that image's build failed:
//   * the build has an index.html and a 404.html, both non-empty;
//   * nothing named internal was emitted: no file or folder called `internal`, `internal_*` or `internal.*` (any
//     case — `find -iname`), which is how an internal page or its page chunk would land;
//   * the text "/internal/" appears in no emitted file (case-sensitive, as `grep -F` was): no link, no search-index
//     entry, no sidebar entry into the internal pages;
//   * no *.up.railway.app host appears anywhere (any case, as `grep -i` was): operator runbooks name the owner
//     service's hosts, and a public page never needs one — the app's own address included.
// Every emitted file is scanned, binary or not, the local-search index included. Two checks are NEW with the move:
//   * the internal roadmap's DATA is not in the build: its items carry a `passTitle` field that nothing public
//     names. It used to ride in every page's theme chunk (the theme registered <Roadmap /> globally, importing
//     docs/internal/roadmap-data.json); the internal page now imports the component itself;
//   * every root-absolute href / src in an emitted page starts with /docs/ — raw HTML in a markdown page is not
//     rewritten by VitePress, so "/start/" there would leave the docs and land on the app's profile route.
//
//   node scripts/docs-guard.mjs [dir]      (default .docs-site, the folder scripts/build-docs.mjs builds)
// Exit 1 on any violation, naming every offending file.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.resolve(process.argv[2] || path.join(ROOT, ".docs-site"));
const BASE = "/docs/";
const rel = (p) => path.relative(DIR, p).split(path.sep).join("/");

function fail(title, lines) {
  console.error("DOCS GUARD: " + title);
  for (const l of lines) console.error("  " + l);
  process.exit(1);
}

if (!existsSync(DIR) || !statSync(DIR).isDirectory()) fail("there is no build at " + DIR, ["run scripts/build-docs.mjs first"]);
for (const f of ["index.html", "404.html"]) {
  const p = path.join(DIR, f);
  if (!existsSync(p) || statSync(p).size === 0) fail("the build has no " + f, [p]);
}

const files = [];
const badNames = [];
const NAME_RE = /^internal($|_|\.)/i;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (NAME_RE.test(name)) badNames.push(rel(p));
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(DIR);
if (badNames.length) fail("internal pages or files were emitted:", badNames);

const internalText = [];
const internalData = [];
const railwayFiles = [];
const railwayHosts = new Set();
const offBase = [];
const RAILWAY_RE = /[a-z0-9-]+\.up\.railway\.app/gi;
// an attribute whose value is root-absolute ("/x", never "//host") and does not start with the base
const ATTR_RE = /\s(?:href|src|srcset|xlink:href|action|formaction|poster|data)\s*=\s*["']\/(?!\/)([^"']*)["']/gi;
let pages = 0;
for (const f of files) {
  const text = readFileSync(f, "latin1");
  if (text.includes("/internal/")) internalText.push(rel(f));
  if (text.includes("passTitle")) internalData.push(rel(f));
  const hosts = text.match(RAILWAY_RE);
  if (hosts) {
    railwayFiles.push(rel(f));
    for (const h of hosts) railwayHosts.add(h.toLowerCase());
  }
  if (f.endsWith(".html")) {
    pages++;
    for (const m of text.matchAll(ATTR_RE)) {
      const value = "/" + m[1];
      if (!value.startsWith(BASE)) offBase.push(rel(f) + ": " + m[0].trim().slice(0, 120));
    }
  }
}
if (internalText.length) fail("the text /internal/ appears in:", internalText);
if (internalData.length) fail("the internal roadmap's data (its passTitle field) was bundled into:", internalData);
if (railwayFiles.length) fail("a *.up.railway.app host appears in:", [...railwayFiles, "hosts: " + [...railwayHosts].sort().join(", ")]);
if (offBase.length) fail(`a page links or loads a root-absolute path outside ${BASE} (raw HTML is not rewritten by VitePress: use a relative href):`, offBase.slice(0, 40));

console.log(`DOCS GUARD: clean: ${pages} pages, ${files.length} files in ${path.relative(ROOT, DIR) || DIR}, nothing internal, no railway host, every root-absolute link under ${BASE}`);
