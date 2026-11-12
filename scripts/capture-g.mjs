// Screenshots of gated-pass surfaces. Usage: node scripts/capture-g.mjs <iter> [gate]
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const iter = process.argv[2] || "g1";
const gate = process.argv[3] || "1";
const outDir = path.resolve("shots", `iter-${iter}`);
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const spaces = JSON.parse(readFileSync("seed/data/spaces.json", "utf8"));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();

const open = spaces.channels.find((c) => c.policy === "open");
const invite = spaces.channels.find((c) => c.policy === "invite");
const publicFolder = spaces.folders.find((f) => f.isPublic);
const room = spaces.rooms[0];

const shots = {
  1: [
    ["/channels", "channels-index.png"],
    [`/channels/${invite.id}`, "channel-locked.png"],
    [`/channels/${open.id}`, "channel-open.png"],
    ["/folders", "folders-grid.png"],
    [`/folders/${publicFolder.id}`, "folder-detail.png"],
    ["/rooms", "rooms-index.png"],
    [`/rooms/${room.id}`, "room-stage.png"],
    ["/home", "home-with-cards.png"],
  ],
  2: [
    ["/settings/graph", "graph-builder.png"],
    ["/settings/graph/preview", "ads-preview.png"],
    ["/settings/graph/imports", "graph-imports.png"],
    ["/settings/earnings", "earnings.png"],
  ],
  3: [
    ["/market", "market-index.png"],
    ["/market/advertiser", "advertiser-console.png"],
    ["/market/measurement", "measurement.png"],
    ["/home", "home-with-ads.png"],
  ],
};

for (const [url, file] of shots[gate] ?? []) {
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, file), fullPage: false });
  console.log("captured", file);
}

await browser.close();
console.log("done →", outDir);
