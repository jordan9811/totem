// Gate 3's pictures: the private composer, and the same timeline as someone
// on the audience versus someone who is not.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const outDir = path.resolve("shots", "iter-m3");
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h).id;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 820 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const api = (m, u, b) =>
  page.request.fetch(BASE + u, {
    method: m,
    headers: { "Content-Type": "application/json" },
    data: b === undefined ? undefined : JSON.stringify(b),
  });

await api("POST", "/api/dev", { action: "resetSeed" });
await page.waitForTimeout(800);

async function as(handle) {
  await api("POST", "/api/dev", { action: "viewAs", personaId: id(handle) });
  await page.waitForTimeout(250);
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
}

// The composer, acting as the private persona.
await as("backyard_scope");
await page.locator("[data-testid=composer-input]").click();
await page.locator("[data-testid=composer-input]").fill("finally a clear night");
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(outDir, "composer-private.png"), clip: { x: 0, y: 0, width: 900, height: 420 } });
console.log("captured composer-private.png");

const granted = await (async () => {
  await as("aperture_annie");
  return page.screenshot();
})();
const outsider = await (async () => {
  await as("drivethru_dave");
  return page.screenshot();
})();

const composite = await ctx.newPage();
await composite.setViewportSize({ width: 1860, height: 960 });
await composite.setContent(`
<style>
  body { margin:0; background:#eef1f4; font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .row { display:flex; gap:20px; padding:20px; }
  .col { flex:1; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 1px 4px rgba(16,23,32,.14); }
  .cap { padding:10px 14px; font-size:13px; font-weight:700; letter-spacing:.02em; }
  .in .cap { background:#e1efe8; color:#2e6b52; }
  .out .cap { background:#f2f4f6; color:#5a6673; }
  img { display:block; width:100%; }
  h1 { margin:0; padding:18px 20px 0; font-size:17px; color:#101720; }
  p.sub { margin:4px 20px 0; font-size:13px; color:#5a6673; }
</style>
<h1>@backyard_scope is a private persona inside a normal account</h1>
<p class="sub">Its posts sit inline in the timeline of the two people on its audience. For everyone else the data path never carries them &mdash; no gap, no placeholder.</p>
<div class="row">
  <div class="col in"><div class="cap">ON THE AUDIENCE &mdash; @aperture_annie</div><img src="data:image/png;base64,${granted.toString("base64")}"></div>
  <div class="col out"><div class="cap">NOT ON IT &mdash; @drivethru_dave</div><img src="data:image/png;base64,${outsider.toString("base64")}"></div>
</div>
`);
await composite.waitForTimeout(600);
await composite.screenshot({ path: path.join(outDir, "private-inline-vs-absent.png"), fullPage: true });
console.log("captured private-inline-vs-absent.png");

await api("POST", "/api/dev", { action: "viewAs", personaId: null });
await api("POST", "/api/dev", { action: "resetSeed" });
await browser.close();
console.log("done ->", outDir);
