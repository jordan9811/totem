// MEGA PASS 2 Gate 8 — the money shot: the roadmap page with its status filters, from the SHOW_INTERNAL build served
// on the pinned docs port. Writes shots/mega2-roadmap.png (shots/ is gitignored). No app process involved.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const PORT = Number(process.env.LAYERS_DOCS_PORT || 3011);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync("docs/.vitepress/dist/internal/roadmap.html")) {
  const b = spawnSync("npx", ["vitepress", "build", "docs"], { shell: true, encoding: "utf8", env: { ...process.env, SHOW_INTERNAL: "1" }, windowsHide: true });
  if (b.status !== 0) { console.log("build failed: " + (b.stderr || b.stdout).slice(-300)); process.exit(1); }
}
const srv = spawn("npx", ["vitepress", "preview", "docs", "--port", String(PORT)], { shell: true, windowsHide: true, stdio: "ignore" });
try {
  let up = false;
  // DOCS UNDER APP: the site's base is /docs/ (docs/.vitepress/config.mts), and the preview serves under it
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/docs/`)).status === 200; } catch {} if (!up) await sleep(500); }
  if (!up) throw new Error("preview never came up");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  await page.goto(`http://127.0.0.1:${PORT}/docs/internal/roadmap`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="roadmap-items"] tbody tr');
  await page.click('[data-testid="roadmap-status-filters"] button[data-status="SHIPPED"]');
  await sleep(300);
  mkdirSync("shots", { recursive: true });
  await page.screenshot({ path: "shots/mega2-roadmap.png", fullPage: false });
  const shown = await page.$$eval('[data-testid="roadmap-items"] tbody tr', (rs) => rs.length);
  console.log("shots/mega2-roadmap.png written; SHIPPED toggled off, " + shown + " rows shown");
  await browser.close();
} finally {
  try { spawnSync("taskkill", ["/PID", String(srv.pid), "/T", "/F"], { windowsHide: true }); } catch {}
}
