// Gate 2's picture: the same timeline, one second after the same fork, seen
// by the person who was brought along and the person who was not.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const outDir = path.resolve("shots", "iter-m2");
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h).id;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 820 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const api = (method, url, body) =>
  page.request.fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });

await api("POST", "/api/dev", { action: "resetSeed" });
await page.waitForTimeout(800);

// The wizard, mid-decision — the suspect already unchecked.
await api("POST", "/api/dev", { action: "viewAs", personaId: id("brothandbones") });
await page.goto(`${BASE}/settings/identity/fork`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(outDir, "fork-wizard.png") });
console.log("captured fork-wizard.png");

// Perform the fork: carry @yeak__, drop @crustcritic.
const res = await api("POST", "/api/identity/fork", {
  fromPersona: id("brothandbones"),
  carry: [id("yeak__")],
  newName: "Broth and Bones",
  newHandle: "brothandbones_new",
});
const fork = await res.json();
console.log("forked ->", fork.newHandle, "carried", fork.carried.length, "dropped", fork.dropped.length);

async function feedAs(handle) {
  await api("POST", "/api/dev", { action: "viewAs", personaId: id(handle) });
  await page.waitForTimeout(300);
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1100);
  return page.screenshot();
}

const carried = await feedAs("yeak__");
const droppedShot = await feedAs("crustcritic");

const composite = await ctx.newPage();
await composite.setViewportSize({ width: 1860, height: 940 });
await composite.setContent(`
<style>
  body { margin:0; background:#eef1f4; font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .row { display:flex; gap:20px; padding:20px; }
  .col { flex:1; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 1px 4px rgba(16,23,32,.14); }
  .cap { padding:10px 14px; font-size:13px; font-weight:700; letter-spacing:.02em; }
  .keep .cap { background:#e1efe8; color:#2e6b52; }
  .drop .cap { background:#f6e7e7; color:#8a3b3b; }
  img { display:block; width:100%; }
  h1 { margin:0; padding:18px 20px 0; font-size:17px; color:#101720; }
  p.sub { margin:4px 20px 0; font-size:13px; color:#5a6673; }
</style>
<h1>@brothandbones just forked. Two timelines, one second later.</h1>
<p class="sub">The forward pointer is a grant-gated claim. It was issued to one of the two whitelist holders.</p>
<div class="row">
  <div class="col keep">
    <div class="cap">CARRIED — @yeak__ is told where they went</div>
    <img src="data:image/png;base64,${carried.toString("base64")}">
  </div>
  <div class="col drop">
    <div class="cap">DROPPED — @crustcritic gets no card, and cannot force one</div>
    <img src="data:image/png;base64,${droppedShot.toString("base64")}">
  </div>
</div>
`);
await composite.waitForTimeout(600);
await composite.screenshot({ path: path.join(outDir, "fork-carried-vs-dropped.png"), fullPage: true });
console.log("captured fork-carried-vs-dropped.png");

await api("POST", "/api/dev", { action: "viewAs", personaId: null });
await api("POST", "/api/dev", { action: "resetSeed" });
await browser.close();
console.log("done ->", outDir);
