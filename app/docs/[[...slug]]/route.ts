// DOCS UNDER APP (D-DOCS-UNDER-APP, SECURITY-POSTURE.md §16, superseding D-CU-6's "the app never builds or serves
// docs/") — the public docs, served by the app itself at /docs. The owner's decision (2026-10-10): "it should just be
// project / docs", not a separate service. `npm run build` builds the site into .docs-site/ (scripts/build-docs.mjs,
// SHOW_INTERNAL removed) and fails on anything internal in it (scripts/docs-guard.mjs) before `next build`; this
// handler serves exactly those files and nothing else.
//
// THE ACCEPTED RISK, stated where the code is: the docs' own client scripts now run on the APP's origin, where every
// visitor's browser keeps its non-extractable wrapping key in IndexedDB, and any script on an origin can use what
// that origin holds (A-CU-5-THE-PAGE-IS-THE-DEVICE). The mitigations: every docs page is authored in this repository
// (no user content, no third-party script), the site is built from the committed source with SHOW_INTERNAL removed,
// and every docs document carries the policy below, which lets it run only its own scripts (and only the inline ones
// whose hashes it names), load only from this origin, and connect nowhere but 'self'.
//
// Mapping (VitePress cleanUrls, base /docs/):
//   /docs                 -> 308 /docs/                (the client router resolves relative links from the slash)
//   /docs/ , /docs/a/b/   -> index.html, a/b/index.html
//   /docs/a/b             -> a/b (a file: assets, diagrams) or a/b.html; a/b/index.html -> 308 /docs/a/b/
//   /docs/a/b/ (no index) -> 308 /docs/a/b when a/b.html exists
//   anything else         -> the site's own 404.html with status 404; a malformed escape -> 400
// Every path segment is percent-decoded ONCE and refused (404) when it is empty, "." or "..", starts with a dot,
// ends with a dot or space, or holds "/", "\", ":" or a control character; the joined path must still lie inside the
// site folder, and so must its real path (no symlink out). The first segment "internal" is refused outright, whatever
// the build holds (the guard already fails a build that emits one). GET only; Next answers HEAD from GET.
//
// Headers: hashed assets under /docs/assets/ are immutable for a year; every other file is "no-cache" with a weak
// ETag (a 304 on If-None-Match). The middleware leaves /docs responses to this handler (its own frame-ancestors-only
// policy would be APPENDED by Next as a second header, not replaced), so everything a document needs is set here,
// once. On the owner service the middleware's owner gate runs first, as for every path; under LAYERS_MAINTENANCE the
// middleware answers its 503 before this runs. No device, no identity, no validator call: the public site's visitor
// reads the docs without booting anything.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DOCS_PATH, DOCS_SITE_DIR } from "@/lib/platform/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".webmanifest": "application/manifest+json",
};

/** the policy on a docs DOCUMENT. VitePress puts three inline scripts in every page (the dark-mode check, the macOS
 *  check, and the page-hash map with the site data); their sha256 hashes are computed from the very file being served,
 *  so a rebuilt site needs no edit here and no 'unsafe-inline' is ever needed for scripts. A script the page injects at
 *  run time matches no hash and is refused. Styles keep 'unsafe-inline' (style attributes in the pages' inline SVG
 *  and in Vue's bindings); images are the site's own or data: URIs (the theme's icons are CSS data: masks). */
function documentPolicy(scriptHashes: string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self'" + scriptHashes.map((h) => ` 'sha256-${h}'`).join(""),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}
/** on everything else (scripts, styles, fonts, the diagrams): nothing may run if one is opened as a document — a
 *  diagram SVG opened in its own tab is exactly that */
const ASSET_POLICY = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const COMMON: ReadonlyArray<readonly [string, string]> = [
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "no-referrer"],
  ["x-frame-options", "DENY"],
  ["cross-origin-opener-policy", "same-origin"],
  ["permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
];

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
/** sha256 (base64) of every non-empty inline script, over its text exactly as the HTML parser sees it (the parser
 *  turns CRLF and lone CR into LF before anything else, so the hash is taken after the same step) */
function inlineScriptHashes(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(INLINE_SCRIPT)) {
    if (/\ssrc\s*=/i.test(" " + m[1])) continue;
    const body = m[2].replace(/\r\n?/g, "\n");
    if (!body.trim()) continue;
    out.add(createHash("sha256").update(body, "utf8").digest("base64"));
  }
  return [...out].sort();
}

/** per served file: the policy computed from its own bytes, kept while its ETag holds */
const POLICY_CACHE = new Map<string, { etag: string; policy: string }>();

type Found = { kind: "file"; file: string; size: number; mtimeMs: number } | { kind: "redirect"; location: string } | { kind: "missing" } | { kind: "malformed" };

async function fileStat(p: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const s = await fs.stat(p);
    return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null;
  } catch {
    return null;
  }
}

/** the decoded segments after /docs, or "malformed" (a bad escape) / "refused" (a segment that is never a site path) */
function segmentsOf(rest: string): string[] | "malformed" | "refused" {
  if (rest === "" || rest === "/") return [];
  const parts = rest.slice(1).split("/");
  if (parts[parts.length - 1] === "") parts.pop(); // one trailing slash: a directory index
  const out: string[] = [];
  for (const raw of parts) {
    let s: string;
    try {
      s = decodeURIComponent(raw);
    } catch {
      return "malformed";
    }
    if (!s || s === "." || s === ".." || s.startsWith(".") || /[. ]$/.test(s) || /[\/\\:\x00-\x1f\x7f]/.test(s)) return "refused";
    out.push(s);
  }
  return out;
}

function inside(root: string, p: string): boolean {
  const r = path.relative(root, p);
  return r !== "" && !r.startsWith("..") && !path.isAbsolute(r);
}

async function resolveDocsPath(root: string, pathname: string, search: string): Promise<Found> {
  if (pathname === DOCS_PATH) return { kind: "redirect", location: DOCS_PATH + "/" + search };
  const segs = segmentsOf(pathname.slice(DOCS_PATH.length));
  if (segs === "malformed") return { kind: "malformed" };
  if (segs === "refused") return { kind: "missing" };
  if (segs.length && segs[0].toLowerCase() === "internal") return { kind: "missing" };
  const base = path.join(root, ...segs);
  if (segs.length && !inside(root, base)) return { kind: "missing" };
  const found = async (file: string): Promise<Found> => {
    const st = await fileStat(file);
    if (!st) return { kind: "missing" };
    // the real path too: a link inside the site folder must not lead out of it
    try {
      const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
      if (!inside(realRoot, realFile)) return { kind: "missing" };
    } catch {
      return { kind: "missing" };
    }
    return { kind: "file", file, ...st };
  };
  if (pathname.endsWith("/")) {
    const index = await found(path.join(base, "index.html"));
    if (index.kind === "file") return index;
    if (segs.length && (await fileStat(base + ".html"))) return { kind: "redirect", location: pathname.replace(/\/+$/, "") + search };
    return { kind: "missing" };
  }
  const exact = await found(base);
  if (exact.kind === "file") return exact;
  const html = await found(base + ".html");
  if (html.kind === "file") return html;
  if (await fileStat(path.join(base, "index.html"))) return { kind: "redirect", location: pathname + "/" + search };
  return { kind: "missing" };
}

function headersFor(file: string, etag: string, policy: string, immutable: boolean): Headers {
  const h = new Headers();
  for (const [k, v] of COMMON) h.set(k, v);
  h.set("content-type", TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  h.set("content-security-policy", policy);
  h.set("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
  h.set("etag", etag);
  return h;
}

async function serveFile(req: Request, file: string, size: number, mtimeMs: number, status: number, immutable: boolean): Promise<Response> {
  const etag = `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
  const isHtml = path.extname(file).toLowerCase() === ".html";
  let body: Buffer | null = null;
  let policy = ASSET_POLICY;
  if (isHtml) {
    const cached = POLICY_CACHE.get(file);
    if (cached && cached.etag === etag) policy = cached.policy;
    else {
      body = await fs.readFile(file);
      policy = documentPolicy(inlineScriptHashes(body.toString("utf8")));
      POLICY_CACHE.set(file, { etag, policy });
    }
  }
  const headers = headersFor(file, etag, policy, immutable);
  if (status === 200 && (req.headers.get("if-none-match") ?? "").split(",").some((t) => t.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }
  body = body ?? (await fs.readFile(file));
  return new Response(new Uint8Array(body), { status, headers });
}

function plain(status: number, text: string): Response {
  const h = new Headers();
  for (const [k, v] of COMMON) h.set(k, v);
  h.set("content-type", "text/plain; charset=utf-8");
  h.set("content-security-policy", ASSET_POLICY);
  h.set("cache-control", "no-store");
  return new Response(text, { status, headers: h });
}

export async function GET(req: Request): Promise<Response> {
  const root = path.resolve(process.cwd(), DOCS_SITE_DIR);
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return plain(400, "Bad request.");
  }
  // a server whose build did not produce the docs (a `next build` run on its own, or `next dev` before any
  // `npm run build`) says so, instead of a bare 404 that reads like a missing page
  const notFoundPage = path.join(root, "404.html");
  const [indexStat, notFoundStat] = await Promise.all([fileStat(path.join(root, "index.html")), fileStat(notFoundPage)]);
  if (!indexStat || !notFoundStat) return plain(503, "The docs are not built on this server. `npm run build` builds them (scripts/build-docs.mjs).");

  const hit = await resolveDocsPath(root, url.pathname, url.search);
  if (hit.kind === "redirect") {
    // relative to this origin: behind the platform's proxy the request URL names the internal listener
    const h = new Headers();
    for (const [k, v] of COMMON) h.set(k, v);
    h.set("location", hit.location);
    h.set("cache-control", "no-cache");
    h.set("content-security-policy", ASSET_POLICY);
    return new Response(null, { status: 308, headers: h });
  }
  if (hit.kind === "malformed") return plain(400, "Bad request: the path is not valid percent-encoding.");
  if (hit.kind === "file") {
    const rel = path.relative(root, hit.file).split(path.sep).join("/");
    return serveFile(req, hit.file, hit.size, hit.mtimeMs, 200, rel.startsWith("assets/"));
  }
  return serveFile(req, notFoundPage, notFoundStat.size, notFoundStat.mtimeMs, 404, false);
}
