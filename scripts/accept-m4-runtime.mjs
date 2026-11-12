// MEGA GATE 4, runtime half. Boots a SECOND server in neynar mode on its own
// port and checks the three things the spec asks for at runtime:
//
//   - the app boots and renders live content through the existing surfaces
//   - a write attempt fails LOUDLY, not silently
//   - flipping DATA_SOURCE does not touch persona / grant / mode state
//
// A second server rather than restarting the first: the seed-mode server is
// the control, and comparing our-layer state across the two is exactly the
// assertion. Restarting one server in place would compare it to itself.
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { pollUntil } from "./lib-health.mjs";

const SEED_BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const LIVE_PORT = 3100;
const LIVE_BASE = `http://localhost:${LIVE_PORT}`;

const results = [];
const ok = (n) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n);
};
const fail = (n, d) => {
  results.push(["FAIL", n, d]);
  console.log("  FAIL  " + n + (d ? " — " + d : ""));
};
async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e.message);
  }
}

console.log("\nMega Gate 4 — runtime (neynar mode)");

const server = spawn("npx", ["next", "start", "-p", String(LIVE_PORT)], {
  env: { ...process.env, DATA_SOURCE: "neynar", ENABLE_WRITE: "false" },
  shell: true,
  stdio: "ignore",
});

async function waitFor(base, ms = 60000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(base + "/home", { redirect: "manual" });
      if (r.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

let booted = false;
try {
  booted = await waitFor(LIVE_BASE);
  if (!booted) {
    console.log("  INFRA neynar-mode server did not boot — cannot test");
    server.kill();
    process.exit(2);
  }

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1200 } })).newPage();
  const api = async (base, method, url, body) => {
    const res = await page.request.fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json" },
      data: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    let text = "";
    try {
      text = await res.text();
      json = JSON.parse(text);
    } catch {}
    return { status: res.status(), json, text };
  };

  // ---- 1. boots and serves ACTUALLY LIVE content ----
  await check("1. App boots in neynar mode and renders genuinely live content", async () => {
    // The first version of this test only asserted "posts rendered and
    // nothing looks broken". It passed while the page was still serving
    // seeded data, because seeded data also renders and also looks fine. A
    // liveness test has to name something only live data can satisfy.
    await page.goto(LIVE_BASE + "/home", { waitUntil: "networkidle" });
    // poll for casts instead of a fixed sleep — a client-side retry can land after 2.5s under load
    await pollUntil(async () => (await page.locator("[data-testid=cast]").count()) > 0, { tries: 10, delayMs: 500 });
    const casts = await page.locator("[data-testid=cast]").count();
    if (casts === 0) throw new Error("no posts rendered in neynar mode");

    // Scope the assertion to the TIMELINE, not the whole page. The right
    // rail's "who to follow" is our seeded persona layer and is supposed to
    // be there — scanning document.body conflated the two and made this test
    // fail for a reason that was not the one it is about.
    const timeline = (await page.locator("[data-testid=cast]").allInnerTexts()).join(String.fromCharCode(10));
    for (const seeded of ["@aperture_annie", "@brothandbones", "@basisrisk", "@collimationking"]) {
      if (timeline.includes(seeded))
        throw new Error(`seeded persona ${seeded} in the neynar-mode timeline — not live content`);
    }
    if (/Invalid Date|NaN|\[object Object\]/.test(timeline))
      throw new Error(`live data rendered a broken value: ${timeline.match(/Invalid Date|NaN|\[object Object\]/)[0]}`);

    // Farcaster has no impression metric, so a view count on a live timeline
    // means a fabricated number is being rendered.
    const views = await page.locator("[data-testid=action-views]").count();
    if (views > 0)
      throw new Error(`${views} view counts rendered on live casts — Farcaster has no such metric`);
  });

  // ---- 2. writes fail LOUDLY ----
  await check("2. A write attempt fails loudly, and does not silently no-op", async () => {
    const res = await api(LIVE_BASE, "POST", "/api/actions/cast", { text: "this must not post" });
    if (res.status === 200)
      throw new Error("write returned 200 in read-only mode — this is the silent no-op the spec forbids");
    if (res.status < 400) throw new Error(`write returned ${res.status}, expected an error status`);
    if (res.json?.code !== "WRITE_DISABLED")
      throw new Error(`error did not identify itself: ${JSON.stringify(res.json).slice(0, 160)}`);
    // the message has to be actionable, not just "error"
    if (!/ENABLE_WRITE/.test(res.json?.error ?? ""))
      throw new Error("the refusal does not say which switch controls it");
  });

  // ---- 3. the seed-mode server is unaffected ----
  await check("3. Seed mode still writes — the guard is scoped to live mode", async () => {
    const res = await api(SEED_BASE, "POST", "/api/actions/cast", { text: "seed mode still works" });
    if (res.json?.code === "WRITE_DISABLED")
      throw new Error("the live-mode write guard leaked into seed mode");
  });

  // ---- 4. OUR layer is untouched by the content switch ----
  await check("4. Switching DATA_SOURCE does not touch persona, grant or mode state", async () => {
    // Personas, grants and modes live in the keystore, the local store and
    // the validator. Neynar is content and knows about none of them, so the
    // two servers must agree exactly.
    const paths = ["/api/personas", "/api/modes", "/api/identity/grant"];
    for (const p of paths) {
      const seed = await api(SEED_BASE, "GET", p);
      const live = await api(LIVE_BASE, "GET", p);
      if (seed.status !== live.status)
        throw new Error(`${p}: seed ${seed.status} vs live ${live.status}`);
      if (seed.status === 200 && seed.text !== live.text)
        throw new Error(`${p}: our-layer state differs across DATA_SOURCE`);
    }
  });

  // ---- 5. the persona layer renders OVER live content ----
  await check("5. The persona layer composes with live content", async () => {
    await page.goto(LIVE_BASE + "/settings/identity/fork", { waitUntil: "networkidle" });
    // wait for a loaded marker instead of a fixed sleep, so the error scan runs on a settled page
    await pollUntil(async () => /fork|persona/i.test(await page.locator("body").innerText()), { tries: 8, delayMs: 400 });
    const body = await page.locator("body").innerText();
    if (/Couldn|error|failed/i.test(body) && !/does not delete/i.test(body))
      throw new Error("a persona-layer surface broke in neynar mode");
    // and the disclosure surfaces still work against the seeded persona graph
    const g = await api(LIVE_BASE, "GET", "/api/identity?personaId=persona_acc_food_1&viewerPersonaId=persona_viewer_main");
    if (g.status !== 200) throw new Error(`identity resolution failed in neynar mode: ${g.status}`);
    if (!g.json?.identity) throw new Error("no identity returned in neynar mode");
  });

  await browser.close();
} finally {
  server.kill();
  // next start spawns a child; make sure the port is actually free again
  try {
    const { execSync } = await import("node:child_process");
    execSync(
      `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${LIVE_PORT} ^| findstr LISTENING') do taskkill /F /PID %a`,
      { shell: "cmd.exe", stdio: "ignore" }
    );
  } catch {}
}

const fails = results.filter((r) => r[0] === "FAIL");
console.log(
  fails.length === 0
    ? `\n${results.length}/${results.length} Mega Gate 4 runtime checks passed`
    : `\n${results.length - fails.length}/${results.length} passed, ${fails.length} FAILED`
);
if (fails.length) {
  console.log("\nProduct failures:");
  for (const r of fails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(fails.length ? 1 : 0);
