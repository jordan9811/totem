// MEGA PASS 2 Gate 3 — capture the PARITY BASELINE of the per-cast action row from the pre-Gate-3 build:
// the first seeded card's action row, normalized to STRUCTURE (tags, attributes, inline SVG paths) with
// text (counts) removed, so the Gate 3 suite can assert the Default row is identical after the row became
// bindable. Run once against a server built from the Gate 2 tree; the result is committed as a fixture.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.locator("[data-testid='cast']").first().waitFor({ timeout: 15000 });
  const html = await page.locator("[data-testid='cast']").first().locator("[data-testid='action-reply']").first().evaluate((el) => el.parentElement.outerHTML);
  const normalized = html
    .replace(/<span hidden data-testid="cast-stake"[^>]*><\/span>/g, "")
    .replace(/>[^<]+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
  mkdirSync("scripts/fixtures", { recursive: true });
  writeFileSync("scripts/fixtures/action-row-baseline.html", normalized + "\n");
  console.log("baseline captured:", normalized.length, "chars;", (normalized.match(/data-testid="action-/g) || []).length, "actions");
  console.log(normalized.slice(0, 300));
} finally {
  await browser.close();
}
