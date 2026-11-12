// Late Tier A captures: the refutation thread, the relationship history tab
// with 3 strikes, and a curator annotation card with its vote row.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const outDir = path.resolve("shots", "iter-a");
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;
const id = (h) => personas.find((p) => p.handle === h)?.id;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const api = (m, u, b) =>
  page.request.fetch(BASE + u, {
    method: m,
    headers: { "Content-Type": "application/json" },
    data: b === undefined ? undefined : JSON.stringify(b),
  });

await api("POST", "/api/dev", { action: "resetSeed" });
await page.waitForTimeout(600);

// 1. refutation thread: reply-with-refutation on a seeded post
await api("POST", "/api/signer", {});
await api("POST", "/api/personas", { name: "Cap", handle: "cap_" + Date.now().toString(36) });
const gw = personas.find((p) => p.handle === "gwei_whisperer");
const target = posts.find((p) => p.authorPersonaId === gw.id && !p.replyToHash);
await api("POST", "/api/actions/cast", {
  text: "This is the retracted figure — the corrected filing shows 12k, source below.",
  replyToHash: target.hash,
  markRefutation: true,
});
await page.goto(`${BASE}/${gw.handle}/status/${target.hash}`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(outDir, "refutation-thread.png") });
console.log("captured refutation-thread.png");

// 2. relationship history with 3 strikes + auto-mute
await api("POST", "/api/dev", { action: "resetSeed" });
await page.waitForTimeout(600);
await api("POST", "/api/strike", { action: "setting", enabled: true });
const hh = posts.filter((p) => p.authorPersonaId === id("handcuffhannah") && !p.replyToHash).slice(0, 3);
for (const p of hh) {
  await api("POST", "/api/strike", { personaId: id("handcuffhannah"), triggeringCastId: p.hash, context: "cast_menu" });
}
await page.goto(BASE + "/handcuffhannah", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(outDir, "relationship-history.png") });
console.log("captured relationship-history.png");

// 3. curator card with vote row
await api("POST", "/api/dev", { action: "resetSeed" });
await page.waitForTimeout(600);
await api("POST", "/api/curators", { feedId: "curator_recordsdesk", subscribe: true });
await page.goto(BASE + "/home", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const tag = page.locator("[data-testid=curator-tag]").first();
if ((await tag.count()) > 0) {
  await tag.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, "curator-annotation.png") });
  console.log("captured curator-annotation.png");
}

await api("POST", "/api/dev", { action: "resetSeed" });
await browser.close();
console.log("done ->", outDir);
