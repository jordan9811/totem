// Tier A money shots: the caught-up banner sitting above readwise chunks,
// and the algo import preview.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const outDir = path.resolve("shots", "iter-a");
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const api = (m, u, b) =>
  page.request.fetch(BASE + u, {
    method: m,
    headers: { "Content-Type": "application/json" },
    data: b === undefined ? undefined : JSON.stringify(b),
  });

await api("POST", "/api/dev", { action: "resetSeed" });
await page.waitForTimeout(600);

// ---- 1. the caught-up banner over readwise chunks ----
const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;
const longform = posts.find((p) => p.truncate && !p.replyToHash);
await api("POST", "/api/feed-health", { postHash: longform.hash });
await api("POST", "/api/dev", { action: "fastForwardReadwise" });
await api("POST", "/api/dev", { action: "setLastVisit", minutesAgo: 30 });
await page.goto(BASE + "/home", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const banner = page.locator("[data-testid=caughtup-banner]");
if ((await banner.count()) === 1) {
  await banner.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, "caughtup-banner.png") });
  console.log("captured caughtup-banner.png");
} else {
  console.log("BANNER NOT RENDERED — no screenshot");
}

// ---- 2. the algo import preview ----
const cards = await (await api("GET", "/api/algo")).json();
const card = cards.cards.find((c) => c.artifact.name === "Calm Signal");
await page.goto(BASE + "/algo/" + card.id, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(outDir, "algo-preview.png"), fullPage: true });
console.log("captured algo-preview.png");

// ---- 3. the algo shelf ----
await page.goto(BASE + "/folders/folder_algoshelf", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(outDir, "algo-shelf.png") });
console.log("captured algo-shelf.png");

await api("POST", "/api/dev", { action: "resetSeed" });
await browser.close();
console.log("done ->", outDir);
