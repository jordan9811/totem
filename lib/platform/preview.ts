// PUBLIC PREVIEW Gate 1 (run as BROWSER KEYSTORE PASS Gate 6) — the preview's own configuration, read at REQUEST
// time on the server.
//
// `NEXT_PUBLIC_*` names are textually inlined into the bundles at BUILD time, so a page that read one directly
// would be frozen to whatever the build machine had — and this deployment sets the docs URL as a platform variable
// after the build. The dynamic key defeats that substitution; the plain read is the fallback for a runtime that
// froze the object instead. The value is handed to client components as a prop, never read from them.
//
// DOCS UNDER APP (D-DOCS-UNDER-APP, superseding D-CU-6's "the app never builds or serves docs/"): the docs are served
// by the app itself at /docs (app/docs/[[...slug]]/route.ts), built by `npm run build`, so every deployment HAS docs
// and the door is never hidden. NEXT_PUBLIC_DOCS_URL is now only an override (a future custom docs domain); unset or
// blank, the door is DOCS_PATH on the app's own origin.

/** where the app serves the docs; keep equal to the docs site config's `base` (without its trailing slash). The app's
 *  code names no docs tooling (accept-mega2-g8 check 8), so the config is named here by role, not by path. */
export const DOCS_PATH = "/docs";
/** the folder `npm run build` builds the docs into and the docs route serves (relative to the app's working
 *  directory); keep equal to OUT in scripts/build-docs.mjs. Gitignored and dockerignored: a deployment builds its own. */
export const DOCS_SITE_DIR = ".docs-site";

/** true for /docs and everything under /docs/ (never /docsX): the paths the docs route owns */
export function isDocsPath(pathname: string): boolean {
  return pathname === DOCS_PATH || pathname.startsWith(DOCS_PATH + "/");
}

export function docsUrl(env: Record<string, string | undefined> = process.env): string {
  const key = "NEXT_PUBLIC_" + "DOCS_URL";
  const explicit = String(env[key] ?? env.NEXT_PUBLIC_DOCS_URL ?? "").trim();
  return explicit || DOCS_PATH;
}

/** the docs' privacy section, for "what this means" — the posture doc is what the label's wording comes from.
 *  DOCS UNDER APP: the docs always exist now, so this is always the docs' /privacy/ page ("/docs/privacy/" by
 *  default). HELP's fallback to the in-app Help page's privacy section (/help#privacy) stays for a caller that passes
 *  an empty string. */
export function postureUrl(docs: string): string {
  return docs ? docs.replace(/\/$/, "") + "/privacy/" : "/help#privacy";
}
