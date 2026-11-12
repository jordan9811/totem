// Screenshots of the Wave 1-3 surfaces for the visual spot-check.
// Usage: node scripts/capture-waves.mjs <iteration>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const iter = process.argv[2] || "w1";
const outDir = path.resolve("shots", `iter-${iter}`);
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

// Deterministic starting state, and enough feed-health state that the
// timeline shot actually shows the new card types.
async function api(method, url, body) {
  return page.request.fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
}
await api("POST", "/api/dev", { action: "resetSeed" });
const posts = (await (await api("GET", "/api/feed2?surface=discovery")).json()).cards ?? [];
const longform = posts.find((c) => c.cast?.truncate);
if (longform) {
  await api("POST", "/api/feed-health", { postHash: longform.cast.hash });
  await api("POST", "/api/feed-health/readwise", { all: true });
}

const shots = [
  ["/home", "home-seeded.png", null],
  ["/settings", "settings-index.png", null],
  ["/settings/modes", "settings-modes.png", null],
  ["/settings/rules", "settings-rules.png", "[data-testid='rule-preview-count']"],
  ["/settings/feed-health", "settings-feed-health.png", null],
  ["/settings/attestations", "settings-attestations.png", null],
  ["/settings/privacy", "settings-privacy.png", null],
  ["/settings/developer", "settings-developer.png", null],
  ["/basisrisk", "profile-facets.png", "[data-testid='facet-follow']"],
];

for (const [url, file, waitFor] of shots) {
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, file) });
  console.log("captured", file);
}

// Mode menu open — the centerpiece control.
await page.goto(BASE + "/home", { waitUntil: "networkidle" });
await page.waitForSelector("[data-testid='mode-pill']", { timeout: 15000 });
await page.waitForTimeout(600);
await page.locator("[data-testid='mode-pill']").click();
await page.waitForSelector("[data-testid='mode-menu']", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(outDir, "mode-menu-open.png") });
console.log("captured mode-menu-open.png");

await browser.close();
console.log("done →", outDir);
