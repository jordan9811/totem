// Mega-pass screenshots, including THE side-by-side: the same profile as a
// granted viewer and as a non-granted one. That pair is the whole product in
// one image, so it is captured as a real composite rather than two files.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const iter = process.argv[2] || "m1";
const outDir = path.resolve("shots", `iter-${iter}`);
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 780 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

async function api(method, url, body) {
  return page.request.fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
}

await api("POST", "/api/dev", { action: "resetSeed" });
await page.waitForTimeout(800);

// Put the viewer on the whitelist so "granted" is a real grant, not a mock.
async function setViewer(handle) {
  // viewAs, not personas/active: the latter only accepts the viewer's OWN
  // personas and silently fell back to the default viewer — who happens to
  // be whitelisted, which made both panels look identical.
  await api("POST", "/api/dev", { action: "viewAs", personaId: handle ? id(handle) : null });
  await page.waitForTimeout(300);
}

const TARGET = "brothandbones"; // whitelist-linked to linescoreluke

// ---- granted viewer ----
await setViewer("crustcritic");
await page.goto(`${BASE}/${TARGET}`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
const granted = await page.screenshot({ path: path.join(outDir, "profile-granted.png") });

// ---- non-granted viewer ----
await setViewer("drivethru_dave");
await page.goto(`${BASE}/${TARGET}`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
const bare = await page.screenshot({ path: path.join(outDir, "profile-bare.png") });

// ---- the composite ----
// Built in the page so it needs no image library: two data URIs side by side
// with labels, then screenshot the result.
const composite = await ctx.newPage();
await composite.setViewportSize({ width: 1860, height: 880 });
await composite.setContent(`
<style>
  body { margin:0; background:#eef1f4; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .row { display:flex; gap:20px; padding:20px; }
  .col { flex:1; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 1px 4px rgba(16,23,32,.14); }
  .cap { padding:10px 14px; font-size:13px; font-weight:700; letter-spacing:.02em; }
  .granted .cap { background:#e1efe8; color:#2e6b52; }
  .bare .cap { background:#f2f4f6; color:#5a6673; }
  img { display:block; width:100%; }
  h1 { margin:0; padding:18px 20px 0; font-size:17px; color:#101720; }
  p.sub { margin:4px 20px 0; font-size:13px; color:#5a6673; }
</style>
<h1>The same profile, two viewers</h1>
<p class="sub">@${TARGET} is whitelist-linked to a second identity. Only the granted viewer is told.</p>
<div class="row">
  <div class="col granted">
    <div class="cap">GRANTED VIEWER — @crustcritic is on the whitelist</div>
    <img src="data:image/png;base64,${granted.toString("base64")}">
  </div>
  <div class="col bare">
    <div class="cap">NON-GRANTED VIEWER — @drivethru_dave sees the bare persona</div>
    <img src="data:image/png;base64,${bare.toString("base64")}">
  </div>
</div>
`);
await composite.waitForTimeout(600);
await composite.screenshot({ path: path.join(outDir, "side-by-side-granted-vs-bare.png"), fullPage: true });
console.log("captured side-by-side-granted-vs-bare.png");

// ---- supporting surfaces ----
await setViewer("crustcritic");
for (const [url, file] of [
  ["/basisrisk", "profile-public-link.png"],
  ["/aperture_annie", "profile-hidden-link.png"],
]) {
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, file) });
  console.log("captured", file);
}

await browser.close();
console.log("done →", outDir);
