// UX PASS GATE 2 — timeline refresh undo.
//
// X's actual failure mode: you see a post, the feed refreshes, it's gone
// forever. Refreshing here pushes the PRIOR feed (cards + scroll position)
// onto a per-(persona,mode) undo stack, session-scoped (sessionStorage —
// never persisted, never in restart-survival), depth-capped (default 3).
import { chromium } from "playwright";
import { assertServersUp, isInfraError, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const MAIN = id("yeak__");

const results = [];
const ok = (n) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n);
};
const fail = (n, d) => {
  const infra = isInfraError(d);
  results.push([infra ? "INFRA" : "FAIL", n, d]);
  console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : ""));
};
async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e.message);
  }
}

await assertServersUp(BASE);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1200 } })).newPage();

async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = JSON.parse(await res.text());
  } catch {}
  return { status: res.status(), json };
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fn();
      if (r.status >= 200 && r.status < 300) return r;
      last = new Error("status " + r.status + " " + (r.json?.error ?? ""));
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
const reset = async () => {
  await api("POST", "/api/dev", { action: "resetSeed" });
  await page.waitForTimeout(400);
};
const viewAs = async (pid) => {
  await api("POST", "/api/dev", { action: "viewAs", personaId: pid });
  await page.waitForTimeout(100);
};

// Stack-size polling — Playwright auto-waits for actionability on click(),
// but the fetch-and-swap after a click still needs a confirmed outcome
// before the next action, same discipline as every other suite here.
async function refreshAndWaitForSize(expected) {
  await page.locator("[data-testid=timeline-refresh]").click();
  // Generous budget: /api/feed2 fans out six adapter calls in parallel
  // (each up to 1500ms mock latency, up to 3 retries), and the very FIRST
  // request in a freshly-launched chromium instance carries its own
  // cold-start cost on top of that — 40 × 400ms comfortably covers both.
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(400);
    const btn = page.locator("[data-testid=timeline-undo]");
    const size = (await btn.count()) ? Number(await btn.getAttribute("data-stack-size")) : 0;
    if (size === expected) return size;
  }
  const btn = page.locator("[data-testid=timeline-undo]");
  return (await btn.count()) ? Number(await btn.getAttribute("data-stack-size")) : 0;
}
const clearUndoState = () => page.evaluate(() => sessionStorage.clear());

console.log("\nUX Pass Gate 2 — timeline refresh undo");

// Warm-up: this suite launches its own fresh chromium instance, and the
// very first page load in a cold browser carries its own startup cost on
// top of the mocks' normal 200-1500ms latency — the standing sweep
// convention (warm before run 1) applies here for the same reason.
await page.goto(BASE + "/home", { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(500);

// ---- 1. refresh pushes prior state; undo restores cards + scroll EXACTLY ----
await check("1. Refresh then undo restores the exact prior feed and scroll position", async () => {
  await reset();
  await viewAs(MAIN);
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await clearUndoState();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // compare the stable hash, not rendered innerText — a relative-time
  // string ("·3m" → "·4m") can tick over a minute boundary across a slow
  // test run even though the underlying cast is byte-identical
  const firstCardBefore = await page.locator("[data-testid=cast]").first().getAttribute("data-hash");
  await page.evaluate(() => window.scrollTo(0, 1200));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  if (scrollBefore < 1000) throw new Error("test setup: scroll did not take");

  const size = await refreshAndWaitForSize(1);
  if (size !== 1) throw new Error(`undo stack size ${size} after one refresh, expected 1`);
  const scrollAfterRefresh = await page.evaluate(() => window.scrollY);
  if (scrollAfterRefresh !== 0) throw new Error("refresh did not scroll to top");

  await page.locator("[data-testid=timeline-undo]").click();
  let scrollAfterUndo = -1;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(200);
    scrollAfterUndo = await page.evaluate(() => window.scrollY);
    if (scrollAfterUndo === 1200) break;
  }
  if ((await page.locator("[data-testid=timeline-undo]").count()) !== 0)
    throw new Error("undo button still present after popping the only stack entry");
  if (scrollAfterUndo !== 1200) throw new Error(`scroll after undo: ${scrollAfterUndo}, expected exactly 1200`);
  const firstCardAfter = await page.locator("[data-testid=cast]").first().getAttribute("data-hash");
  if (firstCardAfter !== firstCardBefore)
    throw new Error(`restored feed content does not match the prior state (${firstCardAfter} vs ${firstCardBefore})`);
});

// ---- 2. depth respected: a 4th refresh drops the oldest, stays capped ----
await check("2. Depth respected: the 4th refresh drops the oldest entry, stack stays at 3", async () => {
  await clearUndoState();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  let size = await refreshAndWaitForSize(1);
  if (size !== 1) throw new Error(`after refresh 1: size ${size}`);
  size = await refreshAndWaitForSize(2);
  if (size !== 2) throw new Error(`after refresh 2: size ${size}`);
  size = await refreshAndWaitForSize(3);
  if (size !== 3) throw new Error(`after refresh 3: size ${size}`);
  size = await refreshAndWaitForSize(3); // the 4th refresh — must STAY at 3, not grow to 4
  if (size !== 3) throw new Error(`after refresh 4 (depth=3 default): size ${size}, expected capped at 3`);

  const stackLen = await page.evaluate(() => {
    const raw = sessionStorage.getItem("layers:undo:mode_default_persona_viewer_main");
    return raw ? JSON.parse(raw).length : 0;
  });
  if (stackLen !== 3) throw new Error(`sessionStorage stack length ${stackLen}, expected exactly 3 (oldest dropped)`);
});

// ---- 3. per-(persona,mode) isolation: a different mode's stack is untouched ----
await check("3. Per-feed isolation: restoring one mode's stack never touches another's", async () => {
  const modes = (await retry(() => api("GET", "/api/modes"))).json.modes;
  const work = modes.find((m) => m.name === "Work");
  // Work's stack starts empty and stays that way while we act on Default
  const workStackBefore = await page.evaluate(
    (id) => sessionStorage.getItem(`layers:undo:${id}`),
    work.id
  );
  if (workStackBefore !== null) throw new Error("test setup: Work already had undo state");

  // switch to Work, do a refresh there too — its OWN stack grows independently
  await retry(() => api("POST", "/api/modes/active", { modeId: work.id }));
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const workSize = await refreshAndWaitForSize(1);
  if (workSize !== 1) throw new Error(`Work's own stack: ${workSize}, expected 1`);

  // Default's stack (from check 2) is UNCHANGED by anything that just
  // happened in Work
  const defaultStackLen = await page.evaluate(() => {
    const raw = sessionStorage.getItem("layers:undo:mode_default_persona_viewer_main");
    return raw ? JSON.parse(raw).length : 0;
  });
  if (defaultStackLen !== 3) throw new Error(`Default's stack changed to ${defaultStackLen} — isolation broken`);

  // and undoing in Work doesn't touch Default's cards at all — switch back
  await page.locator("[data-testid=timeline-undo]").click();
  await page.waitForTimeout(500);
  const modesNow = (await retry(() => api("GET", "/api/modes"))).json;
  const dflt = modesNow.modes.find((m) => m.name === "Default");
  await retry(() => api("POST", "/api/modes/active", { modeId: dflt.id }));
});

// ---- 4. the "N new posts" banner appears only for genuinely new content ----
await check("4. New-posts banner: appears with an accurate count for real new content, absent otherwise", async () => {
  await reset();
  await viewAs(MAIN);
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await clearUndoState();

  // no genuinely new content yet (same seed data) — refreshing shows no banner
  await refreshAndWaitForSize(1);
  if ((await page.locator("[data-testid=new-posts-banner]").count()) !== 0)
    throw new Error("banner appeared with zero genuinely new posts");

  // genuinely NEW content: resurface an X import (Gate 0) — a real card
  // enters the ranked feed with a fresh timestamp that was not there a
  // moment ago. Composer casts do NOT work for this: buildFeed never reads
  // local casts as feed posts (confirmed in Gate 0) — resurfacing is the
  // one mechanism that actually inserts a new card between two feed reads.
  await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: "yeak_offchain" }));
  const begun = await retry(() => api("POST", "/api/x/import", { action: "begin" }));
  await retry(() => api("POST", "/api/x/import", { action: "ingestFixture", sessionId: begun.json.sessionId }));
  await retry(() => api("POST", "/api/x/import", { action: "commit", sessionId: begun.json.sessionId, lanes: ["posts"] }));
  const posts = (await retry(() => api("GET", "/api/x/import"))).json.importedPosts;
  await retry(() => api("POST", "/api/x/import", { action: "resurface", tweetId: posts[0].id, on: true }));

  await refreshAndWaitForSize(2);
  const banner = page.locator("[data-testid=new-posts-banner]");
  if ((await banner.count()) !== 1) throw new Error("banner did not appear after real new content landed");
  const count = Number(await banner.getAttribute("data-count"));
  if (count < 1) throw new Error(`banner count ${count}, expected at least 1`);

  // "Keep" dismisses without touching the stack
  await page.locator("[data-testid=new-posts-keep]").click();
  // settle the dismissal (no reload — banner is client-side state), then assert as before
  await pollUntil(async () => (await page.locator("[data-testid=new-posts-banner]").count()) === 0, { tries: 10, delayMs: 200 });
  if ((await page.locator("[data-testid=new-posts-banner]").count()) !== 0)
    throw new Error("Keep did not dismiss the banner");
  if ((await page.locator("[data-testid=timeline-undo]").getAttribute("data-stack-size")) !== "2")
    throw new Error("Keep altered the undo stack — it should only dismiss the banner");
});

// ---- 5. scrolling away dismisses the banner implicitly ----
await check("5. Scrolling past the threshold dismisses the new-posts banner", async () => {
  const posts = (await retry(() => api("GET", "/api/x/import"))).json.importedPosts;
  await retry(() => api("POST", "/api/x/import", { action: "resurface", tweetId: posts[1].id, on: true }));
  await refreshAndWaitForSize(3);
  if ((await page.locator("[data-testid=new-posts-banner]").count()) !== 1)
    throw new Error("banner did not appear before the scroll-dismiss check");
  await page.evaluate(() => window.scrollTo(0, 400));
  // settle the scroll-dismiss (no reload — scroll/banner are client-side state), then assert as before
  await pollUntil(async () => (await page.locator("[data-testid=new-posts-banner]").count()) === 0, { tries: 10, delayMs: 200 });
  if ((await page.locator("[data-testid=new-posts-banner]").count()) !== 0)
    throw new Error("scrolling did not dismiss the banner");
});

// ---- 6. Ctrl-Z performs undo ----
await check("6. Ctrl-Z restores the prior state, same as the button", async () => {
  const sizeBefore = Number(await page.locator("[data-testid=timeline-undo]").getAttribute("data-stack-size"));
  await page.keyboard.press("Control+z");
  // settle the undo (no reload — sessionStorage undo stack is under test), then assert as before
  await pollUntil(async () => {
    const b = page.locator("[data-testid=timeline-undo]");
    const s = (await b.count()) ? Number(await b.getAttribute("data-stack-size")) : 0;
    return s === sizeBefore - 1;
  }, { tries: 20, delayMs: 400 });
  const undoBtn = page.locator("[data-testid=timeline-undo]");
  const sizeAfter = (await undoBtn.count()) ? Number(await undoBtn.getAttribute("data-stack-size")) : 0;
  if (sizeAfter !== sizeBefore - 1) throw new Error(`stack size ${sizeAfter} after Ctrl-Z, expected ${sizeBefore - 1}`);
});

// ---- 7. undo depth is configurable via settings, and respected live ----
await check("7. PAGE: undo depth is configurable and a new depth is respected on the next refresh cycle", async () => {
  await reset();
  await viewAs(MAIN);
  await retry(() => api("POST", "/api/personas/bindings", { action: "setUndoDepth", personaId: MAIN, depth: 2 }));
  const saved = (await retry(() => api("GET", "/api/personas/bindings"))).json;
  if (saved.personas.find((p) => p.id === MAIN).timelineUndoDepth !== 2)
    throw new Error("depth setting did not persist");

  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await clearUndoState();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  await refreshAndWaitForSize(1);
  await refreshAndWaitForSize(2);
  const size = await refreshAndWaitForSize(2); // 3rd refresh at depth=2 must STAY at 2
  if (size !== 2) throw new Error(`with depth=2, stack after 3 refreshes is ${size}, expected capped at 2`);

  // and the settings page itself round-trips the value
  await page.goto(BASE + "/settings/persona-mode", { waitUntil: "networkidle" });
  // settle the server-derived input value (midway reload is safe here), then assert as before
  const input = page.locator("[data-testid=undo-depth-yeak__]");
  await pollUntil(async () => (await input.count()) === 1 && (await input.inputValue()) === "2", {
    tries: 15,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  if ((await input.inputValue()) !== "2") throw new Error("settings page does not reflect the saved depth");
  await retry(() => api("POST", "/api/personas/bindings", { action: "setUndoDepth", personaId: MAIN, depth: 3 }));
});

// ---- 8. SAFETY: undo state does NOT survive a hard server restart ----
await check("8. SAFETY: the undo stack is session-scoped — absent for a fresh browser context (never restart-survival)", async () => {
  await reset();
  await viewAs(MAIN);
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await clearUndoState();
  await refreshAndWaitForSize(1);

  // a FRESH browser context is the closest in-suite proxy for "a new
  // session" (restart-survival.mjs itself launches a genuinely separate
  // chromium process per phase, which is why this state structurally
  // cannot appear there — sessionStorage never leaves the tab that wrote it)
  const freshContext = await browser.newContext();
  const freshPage = await freshContext.newPage();
  await freshPage.request.fetch(BASE + "/api/dev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ action: "viewAs", personaId: MAIN }),
  });
  await freshPage.goto(BASE + "/home", { waitUntil: "networkidle" });
  await freshPage.waitForTimeout(600);
  if ((await freshPage.locator("[data-testid=timeline-undo]").count()) !== 0)
    throw new Error("a fresh browser context somehow inherited undo state — it must be session-local");
  await freshContext.close();
});

await reset();
await viewAs(null);
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} UX Gate 2 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
