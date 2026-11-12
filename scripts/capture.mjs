// Playwright screenshot capture for the visual-parity loop.
// Usage: node scripts/capture.mjs <iteration-number>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const iter = process.argv[2] || "1";
const outDir = path.resolve("shots", `iter-${iter}`);
mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;

async function settle(page, extra = 1200) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(extra);
}

async function shoot(page, url, file, actions) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await settle(page);
  if (actions) await actions(page);
  await page.screenshot({ path: path.join(outDir, file) });
  console.log("captured", file);
}

const browser = await chromium.launch();

// Desktop 1280x900
const desktop = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});
const dp = await desktop.newPage();
await shoot(dp, "/home", "home-desktop.png", async (page) => {
  // Demonstrate a hover affordance in the static shot (nav hover pill).
  await page.hover("header nav a[href='/explore']").catch(() => {});
  await page.waitForTimeout(250);
});
await shoot(dp, "/yeak__", "profile-desktop.png");
await shoot(dp, "/0xdanwu/status/0xa1b2c301", "permalink-desktop.png");
await shoot(dp, "/notifications", "notifications-desktop.png");
await shoot(dp, "/home", "compose-desktop.png", async (page) => {
  await page.getByTestId("nav-post-button").click();
  await page.waitForSelector("[data-testid='compose-modal']");
  await page.waitForTimeout(400);
});
await desktop.close();

// Mobile 390x844
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});
const mp = await mobile.newPage();
await shoot(mp, "/home", "home-mobile.png");
await shoot(mp, "/yeak__", "profile-mobile.png");
await mobile.close();

await browser.close();
console.log("done →", outDir);
