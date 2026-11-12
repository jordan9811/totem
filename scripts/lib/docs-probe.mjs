// DOCS UNDER APP (D-DOCS-UNDER-APP) — the docs the app serves at /docs, measured. Shared by scripts/accept-cu6.mjs
// (the whole contract, production-shaped), scripts/accept-help.mjs (the door leads to a real docs page),
// scripts/accept-prodlive.mjs (the route walk's docs leg) and scripts/smoke-deployed.mjs (check 5, against a
// deployment). Reads only; never writes, never boots a device, never mints a root.
//
// Every check is built so it could fail (memory: a passing assertion that could not have failed is not evidence):
//   * "the docs page" is asserted by content, not by status — the VitePress app root, its /docs/assets/ entry script
//     and a page title of the form "<page> | Totem" that is not the 404 page's — so a 200 from the app's profile
//     route or Next's not-found page cannot pass for it;
//   * the internal pages must answer the DOCS' own 404 page (its title), so a 404 for an unrelated reason (the route
//     missing entirely) would not pass either;
//   * the traversal requests go out over node:http with the path EXACTLY as written (fetch would normalise dot
//     segments client-side and test nothing), and the body is checked for the target file's own text;
//   * the policy's script hashes are recomputed HERE from the served page and must equal the header's set, so a
//     header that merely looks right (or a page whose inline script the policy would block) fails;
//   * the browser leg navigates through the VitePress client router (a window marker must survive each click, so the
//     page's own scripts provably ran under the policy) and fails on any console error, page error, policy violation,
//     same-origin request that failed, or request to /api/ or the device.
import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

export const DOCS_PATH = "/docs";
const PACKAGE_JSON_MARKERS = [/"workspaces"\s*:/, /"build:device"\s*:/];
const NOT_FOUND_TITLE = /<title>404 \| Totem<\/title>/;
const PAGE_TITLE = /<title>([^<]*)<\/title>/;

/** one request with the path sent byte for byte as given; never follows a redirect. A fresh connection every time
 *  (agent: false): Node's default agent keeps sockets alive, and a pooled socket the server already closed after an
 *  idle pause (a scratch build between two requests) failed the next request with a reset — status 0, a false FAIL. */
export function rawGet(base, pathAndQuery, headers = {}) {
  const u = new URL(base);
  const lib = u.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    const req = lib.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: pathAndQuery, method: "GET", agent: false, headers: { "user-agent": "layers-docs-probe", ...headers }, timeout: 60_000 }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const all = (name) => res.rawHeaders.filter((_, i, a) => i % 2 === 1 && a[i - 1].toLowerCase() === name);
        resolve({ status: res.statusCode, headers: res.headers, all, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ status: 0, headers: {}, all: () => [], body: "", error: String(e && e.message ? e.message : e) }));
    req.end();
  });
}

/** sha256 (base64) of every non-empty inline script, as the HTML parser sees it (CRLF -> LF first) */
export function inlineScriptHashes(html) {
  const out = new Set();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\ssrc\s*=/i.test(" " + m[1])) continue;
    const body = m[2].replace(/\r\n?/g, "\n");
    if (body.trim()) out.add(createHash("sha256").update(body, "utf8").digest("base64"));
  }
  return [...out].sort();
}

export const titleOf = (html) => (PAGE_TITLE.exec(html) || [])[1] || "";
/** a response that IS a docs page: 200 HTML, the VitePress app root, its /docs/assets/ entry script, a "<page> | Totem"
 *  (or the home page's "Totem") title, and not the docs' 404 page */
export const isDocsPage = (r) => r.status === 200 && /^text\/html/.test(r.headers["content-type"] || "") && /<div id="app"/.test(r.body) && /src="\/docs\/assets\/app\.[^"]+\.js"/.test(r.body) && / \| Totem$|^Totem$/.test(titleOf(r.body)) && !NOT_FOUND_TITLE.test(r.body);
const locationIs = (r, want) => {
  const loc = r.headers.location || "";
  try {
    return new URL(loc, "http://x").pathname + new URL(loc, "http://x").search === want;
  } catch {
    return false;
  }
};

/** the policy a docs DOCUMENT must carry: one header, every directive the contract names, the page's own hashes */
export function policyProblems(r, label) {
  const problems = [];
  const csp = r.all("content-security-policy");
  if (csp.length !== 1) return [`${label}: ${csp.length} content-security-policy headers (want exactly one)`];
  const p = csp[0];
  const dir = Object.fromEntries(p.split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k.toLowerCase(), v]; }));
  const want = { "default-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"], "img-src": ["'self'", "data:"], "connect-src": ["'self'"], "object-src": ["'none'"], "frame-ancestors": ["'none'"], "base-uri": ["'self'"], "form-action": ["'none'"] };
  for (const [k, v] of Object.entries(want)) if (JSON.stringify(dir[k] ?? null) !== JSON.stringify(v)) problems.push(`${label}: ${k} is ${JSON.stringify(dir[k] ?? null)}, want ${JSON.stringify(v)}`);
  const script = dir["script-src"] ?? [];
  if (script[0] !== "'self'") problems.push(`${label}: script-src does not start with 'self' (${script.join(" ")})`);
  const extra = script.slice(1).filter((t) => !/^'sha256-[A-Za-z0-9+/]+=*'$/.test(t));
  if (extra.length) problems.push(`${label}: script-src allows more than 'self' and hashes: ${extra.join(" ")}`);
  const served = script.slice(1).map((t) => t.slice(8, -1)).sort();
  const page = inlineScriptHashes(r.body);
  if (!page.length) problems.push(`${label}: the page has no inline script at all — the hash comparison would be vacuous`);
  if (JSON.stringify(served) !== JSON.stringify(page)) problems.push(`${label}: script-src hashes ${served.length} != the page's own inline scripts ${page.length} (recomputed here)`);
  const xfo = r.all("x-frame-options");
  if (xfo.length !== 1 || xfo[0] !== "DENY") problems.push(`${label}: x-frame-options ${JSON.stringify(xfo)}`);
  if (r.headers["x-content-type-options"] !== "nosniff") problems.push(`${label}: x-content-type-options ${r.headers["x-content-type-options"]}`);
  if (r.headers["referrer-policy"] !== "no-referrer") problems.push(`${label}: referrer-policy ${r.headers["referrer-policy"]}`);
  return problems;
}

/** THE HTTP CONTRACT. Throws with every problem joined; returns a one-line summary. `light` skips the cache and the
 *  slower variants (the deployed smoke). */
export async function probeDocsHttp(base, { light = false } = {}) {
  base = base.replace(/\/$/, "");
  const problems = [];
  const note = [];

  const bare = await rawGet(base, DOCS_PATH);
  if (bare.status !== 308 || !locationIs(bare, DOCS_PATH + "/")) problems.push(`GET /docs answered ${bare.status} -> ${bare.headers.location || "(no location)"}, want 308 -> /docs/`);

  const home = await rawGet(base, DOCS_PATH + "/");
  if (!isDocsPage(home)) problems.push(`GET /docs/ is not the docs home page (${home.status}, ${home.headers["content-type"] || "?"}, title ${JSON.stringify(titleOf(home.body))}${home.error ? ", " + home.error : ""})`);
  else {
    problems.push(...policyProblems(home, "/docs/"));
    if (home.body.includes("/internal/")) problems.push("/docs/ names /internal/");
  }

  const titles = new Set([titleOf(home.body)]);
  for (const p of ["/docs/privacy/", "/docs/roadmap/", "/docs/start/faq"]) {
    const r = await rawGet(base, p);
    if (!isDocsPage(r)) problems.push(`GET ${p} is not a docs page (${r.status}, title ${JSON.stringify(titleOf(r.body))})`);
    else {
      if (titles.has(titleOf(r.body))) problems.push(`GET ${p} has the same title as another page (${titleOf(r.body)}): it is not its own page`);
      titles.add(titleOf(r.body));
      problems.push(...policyProblems(r, p));
    }
  }
  const slashless = await rawGet(base, "/docs/privacy");
  if (slashless.status !== 308 || !locationIs(slashless, "/docs/privacy/")) problems.push(`GET /docs/privacy answered ${slashless.status} -> ${slashless.headers.location || "-"}, want 308 -> /docs/privacy/`);

  // the internal pages: the docs' OWN 404 page with a 404 status (not merely "not 200")
  for (const p of ["/docs/internal/", "/docs/internal/roadmap", "/docs/internal/open-issues", "/docs/Internal/", "/docs/internal.html"]) {
    const r = await rawGet(base, p);
    if (r.status !== 404 || !NOT_FOUND_TITLE.test(r.body)) problems.push(`GET ${p} answered ${r.status} (title ${JSON.stringify(titleOf(r.body))}), want 404 with the docs' 404 page`);
  }
  const missing = await rawGet(base, "/docs/no-such-page-" + Date.now().toString(36));
  if (missing.status !== 404 || !NOT_FOUND_TITLE.test(missing.body)) problems.push(`an unknown docs page answered ${missing.status}, want 404 with the docs' 404 page`);
  else problems.push(...policyProblems(missing, "the 404 page"));

  // traversal: never the file, always 400/404. Each variant names the repo's package.json one way or another.
  const traversal = [
    "/docs/..%2f..%2fpackage.json",
    "/docs/..%2F..%2Fpackage.json",
    "/docs/..%2fpackage.json",
    "/docs/assets/..%2f..%2f..%2fpackage.json",
    "/docs/%2e%2e%2f%2e%2e%2fpackage.json",
    "/docs/..%5c..%5cpackage.json",
    "/docs/%2e%2e/%2e%2e/package.json",
    "/docs/../../package.json",
    "/docs/..%252f..%252fpackage.json",
    "/docs/.%2e/.%2e/package.json",
    "/docs/assets/%2e%2e%5c%2e%2e%5cpackage.json",
    "/docs/..%00/package.json",
  ];
  let refused = 0;
  for (const p of light ? traversal.slice(0, 4) : traversal) {
    const r = await rawGet(base, p);
    const leaked = PACKAGE_JSON_MARKERS.some((re) => re.test(r.body));
    if (leaked) problems.push(`TRAVERSAL ${p} returned the file's content (${r.status})`);
    else if (r.status !== 404 && r.status !== 400) problems.push(`traversal ${p} answered ${r.status}, want 404 or 400`);
    else refused++;
  }
  note.push(`${refused} traversal attempts refused`);

  // the assets the home page loads: the entry script, the stylesheet, the preloaded chunks — all 200, the right type,
  // immutable; and a diagram from public/
  const assetUrls = [...new Set([...home.body.matchAll(/(?:src|href)="(\/docs\/assets\/[^"]+\.(?:js|css|woff2))"/g)].map((m) => m[1]))];
  if (assetUrls.length < 3) problems.push(`the home page references ${assetUrls.length} asset(s) under /docs/assets/ — expected the entry script, the stylesheet and chunks`);
  let assetsOk = 0;
  for (const a of light ? assetUrls.slice(0, 4) : assetUrls) {
    const r = await rawGet(base, a);
    const want = a.endsWith(".css") ? /^text\/css/ : a.endsWith(".woff2") ? /^font\/woff2/ : /^text\/javascript/;
    if (r.status !== 200 || !want.test(r.headers["content-type"] || "")) problems.push(`asset ${a} answered ${r.status} ${r.headers["content-type"] || ""}`);
    else if (!/immutable/.test(r.headers["cache-control"] || "")) problems.push(`asset ${a} is not immutable (${r.headers["cache-control"]})`);
    else if (r.headers["x-content-type-options"] !== "nosniff") problems.push(`asset ${a} lacks nosniff`);
    else assetsOk++;
  }
  note.push(`${assetsOk} asset(s) 200 + immutable`);
  const svg = await rawGet(base, "/docs/diagrams/ecosystem-map.svg");
  if (svg.status !== 200 || !/^image\/svg\+xml/.test(svg.headers["content-type"] || "") || !/<svg/.test(svg.body)) problems.push(`the ecosystem diagram answered ${svg.status} ${svg.headers["content-type"] || ""}`);
  else if (!/default-src 'none'/.test(svg.headers["content-security-policy"] || "")) problems.push("the diagram, opened as a document, could run script: its policy is " + svg.headers["content-security-policy"]);

  if (!light && home.headers.etag) {
    const again = await rawGet(base, DOCS_PATH + "/", { "if-none-match": home.headers.etag });
    if (again.status !== 304) problems.push(`a conditional GET of /docs/ answered ${again.status}, want 304`);
  }

  if (problems.length) throw new Error(problems.join(" | "));
  return `/docs 308 -> /docs/; ${titles.size} distinct docs pages 200 with one policy each (hashes match the page); internal 404; ${note.join("; ")}`;
}

/** THE LINK WALK: every docs page reachable from /docs/ by following the links the pages themselves print (nav,
 *  sidebar, content, prev/next — each resolved against the page that prints it, exactly as a browser resolves a
 *  relative href) answers as a docs page, and every same-origin file a page links (a diagram) answers 200. A link that
 *  leaves /docs/ for this origin is a broken base and fails; external links are not followed. Throws on any problem. */
export async function crawlDocs(base, { max = 400 } = {}) {
  base = base.replace(/\/$/, "");
  const origin = new URL(base).origin;
  const queue = [DOCS_PATH + "/"];
  const seen = new Set(queue);
  const problems = [];
  let pages = 0;
  let files = 0;
  while (queue.length && pages + files < max) {
    const p = queue.shift();
    const r = await rawGet(base, p);
    const isPage = !/\.[a-z0-9]+$/i.test(p) || p.endsWith(".html");
    if (!isPage) {
      if (r.status !== 200) problems.push(`${p}: ${r.status}`);
      files++;
      continue;
    }
    if (!isDocsPage(r)) {
      problems.push(`${p}: ${r.status} ${JSON.stringify(titleOf(r.body))}`);
      continue;
    }
    pages++;
    for (const m of r.body.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
      const raw = m[1].replace(/&amp;/g, "&");
      if (/^(mailto:|tel:|javascript:)/i.test(raw) || raw.startsWith("#")) continue;
      let u;
      try {
        u = new URL(raw, origin + p);
      } catch {
        problems.push(`${p}: an unparseable href ${raw}`);
        continue;
      }
      if (u.origin !== origin) continue;
      if (!u.pathname.startsWith(DOCS_PATH + "/")) {
        problems.push(`${p}: links ${raw} -> ${u.pathname}, outside ${DOCS_PATH}/ (a broken base)`);
        continue;
      }
      if (!seen.has(u.pathname)) {
        seen.add(u.pathname);
        queue.push(u.pathname);
      }
    }
  }
  if (pages < 20) problems.push(`only ${pages} docs pages were reachable from ${DOCS_PATH}/ — the walk is too small to mean anything`);
  if (problems.length) throw new Error(problems.slice(0, 15).join(" | ") + (problems.length > 15 ? ` (+${problems.length - 15} more)` : ""));
  return `${pages} docs pages and ${files} linked files reachable from ${DOCS_PATH}/, every link inside ${DOCS_PATH}/ and answering`;
}

/** THE BROWSER LEG: a real load of /docs/ and client-side navigation through the nav, the sidebar and a raw HTML card
 *  link, local search, the diagrams. `walk: false` loads /docs/ only (the deployed smoke). */
export async function probeDocsBrowser(browser, base, { walk = true } = {}) {
  base = base.replace(/\/$/, "");
  const origin = new URL(base).origin;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const issues = [];
  const seen = [];
  await ctx.addInitScript(() => {
    window.__docsViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__docsViolations.push(`${e.violatedDirective} ${e.blockedURI || ""}`.trim()));
  });
  ctx.on("console", (m) => { if (m.type() === "error") issues.push("console: " + m.text().slice(0, 200)); });
  ctx.on("weberror", (e) => issues.push("pageerror: " + String(e.error()).slice(0, 200)));
  ctx.on("requestfailed", (r) => { if (r.url().startsWith(origin)) issues.push("request failed: " + r.url().slice(origin.length) + " " + (r.failure()?.errorText || "")); });
  ctx.on("response", (r) => {
    const u = r.url();
    if (!u.startsWith(origin)) return;
    const p = u.slice(origin.length);
    seen.push(p);
    if (r.status() >= 400) issues.push(`HTTP ${r.status()} ${p}`);
  });
  const page = await ctx.newPage();
  const steps = [];
  try {
    await page.goto(base + DOCS_PATH + "/", { waitUntil: "load", timeout: 120_000 });
    await page.waitForFunction(() => !!(document.querySelector("#app") && document.querySelector("#app").__vue_app__), null, { timeout: 30_000 }).catch(() => { throw new Error("the VitePress app never hydrated on /docs/ (its scripts did not run)"); });
    await page.locator(".VPNav").first().waitFor({ timeout: 15_000 });
    steps.push("hydrated /docs/");
    const cssLoaded = await page.evaluate(() => getComputedStyle(document.querySelector(".VPNav")).position);
    if (cssLoaded === "static") issues.push("the theme's stylesheet did not apply (.VPNav is position: static)");

    if (walk) {
      await page.evaluate(() => { window.__docsMarker = "kept"; });
      const soft = async (label, click, wantPath, wantH1) => {
        await click();
        await page.waitForURL((u) => new URL(u).pathname === wantPath, { timeout: 20_000 }).catch(() => { throw new Error(`${label}: the URL never became ${wantPath} (it is ${new URL(page.url()).pathname})`); });
        if (wantH1) await page.locator("h1", { hasText: wantH1 }).first().waitFor({ timeout: 15_000 }).catch(() => { throw new Error(`${label}: ${wantPath} never showed the heading "${wantH1}"`); });
        const kept = await page.evaluate(() => window.__docsMarker === "kept");
        if (!kept) throw new Error(`${label}: the navigation reloaded the document — the client router did not run`);
        steps.push(label);
      };
      await soft("nav: Privacy", () => page.locator(".VPNavBarMenu a", { hasText: /^Privacy$/ }).first().click(), "/docs/privacy/", "What the label means");
      await soft("sidebar: Threat model", () => page.locator(".VPSidebar a", { hasText: /^Threat model$/ }).first().click(), "/docs/privacy/threat-model", null);
      await soft("nav: Start here", () => page.locator(".VPNavBarMenu a", { hasText: /^Start here$/ }).first().click(), "/docs/start/", null);
      // a raw HTML card link, written relative (./first-5-minutes): proves the relative form resolves under the base
      await soft("card link: Your first 5 minutes", () => page.locator(".cards a", { hasText: "Your first 5 minutes" }).first().click(), "/docs/start/first-5-minutes", null);
      await soft("nav: Roadmap", () => page.locator(".VPNavBarMenu a", { hasText: /^Roadmap$/ }).first().click(), "/docs/roadmap/", null);
      // the local search: its index is a lazily imported chunk, so this proves a dynamic import passes the policy
      await page.locator(".VPNavBarSearch button, .DocSearch-Button").first().click();
      const input = page.locator(".VPLocalSearchBox input").first();
      await input.waitFor({ timeout: 15_000 }).catch(() => { throw new Error("the local search box never opened"); });
      await input.fill("persona");
      await page.locator(".VPLocalSearchBox .results li").first().waitFor({ timeout: 20_000 }).catch(() => { throw new Error("the local search returned no result for \"persona\""); });
      const results = await page.locator(".VPLocalSearchBox .results li").count();
      await page.keyboard.press("Escape");
      steps.push(`search: ${results} result(s)`);
      // the diagrams (images from public/, loaded through the base)
      await page.goto(base + DOCS_PATH + "/start/big-picture", { waitUntil: "load", timeout: 120_000 });
      await page.locator("img.eco-img").first().waitFor({ timeout: 15_000 });
      const imgs = await page.$$eval("img.eco-img", (els) => els.map((e) => ({ src: e.getAttribute("src"), w: e.naturalWidth })));
      await page.waitForFunction(() => [...document.querySelectorAll("img.eco-img")].every((i) => i.complete), null, { timeout: 15_000 }).catch(() => {});
      const loaded = await page.$$eval("img.eco-img", (els) => els.filter((e) => e.naturalWidth > 0).length);
      if (imgs.length < 2 || loaded !== imgs.length) issues.push(`big-picture diagrams: ${loaded} of ${imgs.length} loaded (${imgs.map((i) => i.src).join(", ")})`);
      else steps.push(`${loaded} diagrams`);
    }
    const violations = await page.evaluate(() => window.__docsViolations || []);
    for (const v of violations) issues.push("policy violation: " + v);
  } catch (e) {
    issues.unshift(String(e && e.message ? e.message : e));
  } finally {
    await ctx.close();
  }
  const strays = seen.filter((p) => p.startsWith("/api/") || p.startsWith("/device/"));
  if (strays.length) issues.push("the docs called the app: " + [...new Set(strays)].slice(0, 5).join(", "));
  if (!seen.some((p) => p.startsWith("/docs/assets/"))) issues.push("no /docs/assets/ request was seen — the response counter is blind");
  if (issues.length) throw new Error(issues.slice(0, 12).join(" | "));
  return steps.join(" -> ") + `; ${seen.length} same-origin responses, no console error, no policy violation`;
}
