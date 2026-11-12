// DOCS UNDER APP (D-DOCS-UNDER-APP) — step 2 of `npm run build`: the PUBLIC docs site, built from the committed
// source into .docs-site/, which app/docs/[[...slug]]/route.ts serves at /docs. scripts/docs-guard.mjs runs next and
// fails the build on anything internal in the output; then `next build`.
//
// What this step guarantees, by construction (the same contract railway/Dockerfile.docs kept while the docs had a
// service of their own):
//   * the output folder is DELETED first, so the app never serves a stale or a hand-made build. The folder belongs
//     to this script alone: `npm run docs:build`, `docs:dev`, the Gate 8 suite and the roadmap capture all build into
//     docs/.vitepress/dist (some of them WITH the internal pages), and none of them can reach what the app serves.
//     .gitignore and .dockerignore keep .docs-site/ out of a commit and out of a deploy's upload, so a deployment
//     always builds its own;
//   * SHOW_INTERNAL is REMOVED from the build's environment — every spelling of the name, because Windows looks up
//     environment variables case-insensitively — whatever the calling shell or the platform holds;
//   * docs:generate, docs:check and docs:sync do NOT run here. They stay in the verification routine
//     (notes/runbooks/CONTRIBUTING-DOCS.md): a citation that drifted must not block an app deploy, and the generated pages are
//     committed, so the build renders exactly what the repository holds.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** the served folder: keep equal to DOCS_SITE_DIR in lib/platform/preview.ts and the default of scripts/docs-guard.mjs */
const OUT = path.join(ROOT, ".docs-site");
const require = createRequire(import.meta.url);
const VITEPRESS = path.join(path.dirname(require.resolve("vitepress/package.json")), "bin", "vitepress.js");

const env = { ...process.env };
let removed = 0;
for (const k of Object.keys(env)) {
  if (k.toUpperCase() === "SHOW_INTERNAL") {
    delete env[k];
    removed++;
  }
}

rmSync(OUT, { recursive: true, force: true });
console.log(`[docs] building the public docs into ${path.relative(ROOT, OUT)}/ (base /docs/; SHOW_INTERNAL ${removed ? "removed from the environment" : "not set"})`);
const r = spawnSync(process.execPath, [VITEPRESS, "build", "docs", "--outDir", OUT], { cwd: ROOT, env, stdio: "inherit" });
if (r.status !== 0) {
  console.error(`[docs] vitepress build failed (exit ${r.status ?? r.signal}); the app build stops here`);
  process.exit(r.status || 1);
}
