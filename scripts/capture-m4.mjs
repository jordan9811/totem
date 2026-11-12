// Live Farcaster data rendering through the X-parity UI.
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const PORT = 3101;
const BASE = `http://localhost:${PORT}`;
const outDir = path.resolve("shots", "iter-m4");
mkdirSync(outDir, { recursive: true });

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  env: { ...process.env, DATA_SOURCE: "neynar", ENABLE_WRITE: "false" },
  shell: true,
  stdio: "ignore",
});
const until = Date.now() + 60000;
let up = false;
while (Date.now() < until) {
  try { const r = await fetch(BASE + "/home", { redirect: "manual" }); if (r.status < 500) { up = true; break; } } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
if (!up) { console.log("server did not boot"); server.kill(); process.exit(2); }

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 })).newPage();
await page.goto(BASE + "/home", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(outDir, "live-timeline.png") });
console.log("captured live-timeline.png");

const txt = await page.locator("body").innerText();
console.log("broken values present:", /Invalid Date|NaN|\[object Object\]/.test(txt));
await browser.close();
server.kill();
try {
  const { execSync } = await import("node:child_process");
  execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /PID %a`, { shell: "cmd.exe", stdio: "ignore" });
} catch {}
console.log("done ->", outDir);
