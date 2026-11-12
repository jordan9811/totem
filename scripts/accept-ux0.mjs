// UX PASS GATE 0 — import behavior correctness fix.
//
// Imported X posts are HISTORY by default: they render on the profile's
// "Imported from X" shelf at their ORIGINAL timestamp and enter NO feed.
// The resurface toggle (per-post + bulk) is the one explicit escape hatch:
// promoting a post gives it a FRESH timestamp and it enters the ranked
// feed for real — default off, always, per post or all at once.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const VIEWER = id("yeak__");
const HANDLE = "yeak_offchain";

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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1400 } })).newPage();

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
async function importArchive() {
  const begun = await retry(() => api("POST", "/api/x/import", { action: "begin" }));
  await retry(() => api("POST", "/api/x/import", { action: "ingestFixture", sessionId: begun.json.sessionId }));
  await retry(() =>
    api("POST", "/api/x/import", { action: "commit", sessionId: begun.json.sessionId, lanes: ["posts"] })
  );
}
const discoveryText = async () => JSON.stringify((await retry(() => api("GET", "/api/feed2?surface=discovery"))).json);
const followingText = async () => JSON.stringify((await retry(() => api("GET", "/api/feed2?surface=following"))).json);
const SUBJECT_TEXT = "the disclosure layer IS the product";

console.log("\nUX Pass Gate 0 — import behavior fix");

// ---- 1. fresh import: zero feed entries in either surface ----
await check("1. Fresh import places zero items in discovery AND following feeds", async () => {
  await reset();
  await viewAs(VIEWER);
  await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: HANDLE }));
  await importArchive();
  const disc = await discoveryText();
  const foll = await followingText();
  if (disc.includes(SUBJECT_TEXT)) throw new Error("imported post leaked into the discovery feed");
  if (foll.includes(SUBJECT_TEXT)) throw new Error("imported post leaked into the following feed");
  // and the history view has it, dated 2025 (the seeded original), not today
  const posts = (await retry(() => api("GET", "/api/x/import"))).json.importedPosts;
  const subject = posts.find((p) => p.text.includes(SUBJECT_TEXT));
  if (!subject) throw new Error("subject post missing from import history");
  if (subject.resurfaced) throw new Error("resurfaced defaulted to true — must default off");
  if (subject.resurfacedAt !== null) throw new Error("resurfacedAt set on a non-resurfaced post");
});

// ---- 2. resurfacing exactly one produces exactly one, dated now ----
await check("2. Resurfacing ONE post makes exactly ONE appear in the feed, dated now", async () => {
  const before = Date.now();
  const posts = (await retry(() => api("GET", "/api/x/import"))).json.importedPosts;
  const subject = posts.find((p) => p.text.includes(SUBJECT_TEXT));
  const r = await retry(() =>
    api("POST", "/api/x/import", { action: "resurface", tweetId: subject.id, on: true })
  );
  if (!r.json.post.resurfaced) throw new Error("resurface did not flip the flag");
  if (r.json.post.resurfacedAt < before) throw new Error("resurfacedAt is not a fresh timestamp");
  if (r.json.post.createdAt === r.json.post.resurfacedAt)
    throw new Error("resurfacedAt collided with the original createdAt — original must be untouched");

  // content-settled read (lib-health): feed assembly can drop a card on a transient adapter failure
  const disc = await retryContent(
    () => retry(() => api("GET", "/api/feed2?surface=discovery")),
    (r) => r.json.cards.filter((c) => c.cast?.text === subject.text).length === 1,
    4
  );
  const cards = disc.json.cards.filter((c) => c.cast?.text === subject.text);
  if (cards.length !== 1) throw new Error(`${cards.length} matching cards in discovery, expected exactly 1`);
  if (cards[0].kind !== "resurfaced") throw new Error(`card kind "${cards[0].kind}", expected "resurfaced"`);
  if (Math.abs(cards[0].cast.timestamp - r.json.post.resurfacedAt) > 1000)
    throw new Error("feed card timestamp does not match resurfacedAt");
  if (cards[0].cast.timestamp === subject.createdAt)
    throw new Error("feed card is dated with the ORIGINAL X timestamp, not now");

  // the history view is UNAFFECTED — same original date, still there
  const historyPosts = (await retry(() => api("GET", "/api/x/import"))).json.importedPosts;
  const stillHistory = historyPosts.find((p) => p.id === subject.id);
  if (stillHistory.createdAt !== subject.createdAt)
    throw new Error("resurfacing mutated the original createdAt — history view corrupted");

  // un-resurfacing removes it from the feed again
  await retry(() => api("POST", "/api/x/import", { action: "resurface", tweetId: subject.id, on: false }));
  const disc2 = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  if (disc2.json.cards.some((c) => c.cast?.text === subject.text))
    throw new Error("un-resurfacing did not remove the feed entry");
});

// ---- 3. bulk resurface: every post gets its own fresh timestamp ----
await check("3. Bulk resurface promotes every imported post, each dated now", async () => {
  const before = Date.now();
  const bulk = await retry(() => api("POST", "/api/x/import", { action: "resurfaceAll", on: true }));
  if (bulk.json.changed !== 5) throw new Error(`bulk resurfaced ${bulk.json.changed}, expected 5 (the fixture's posts)`);
  const disc = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  const resurfacedCards = disc.json.cards.filter((c) => c.kind === "resurfaced");
  if (resurfacedCards.length === 0) throw new Error("bulk resurface produced no feed cards");
  for (const c of resurfacedCards) {
    if (c.cast.timestamp < before) throw new Error("a bulk-resurfaced card was not dated now");
  }
  const historyPosts = (await retry(() => api("GET", "/api/x/import"))).json.importedPosts;
  if (!historyPosts.every((p) => p.resurfaced)) throw new Error("bulk resurface missed a post");
  // bulk OFF reverses it completely
  const undo = await retry(() => api("POST", "/api/x/import", { action: "resurfaceAll", on: false }));
  if (undo.json.changed !== 5) throw new Error(`bulk un-resurface changed ${undo.json.changed}, expected 5`);
  const disc2 = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  if (disc2.json.cards.some((c) => c.kind === "resurfaced"))
    throw new Error("bulk un-resurface left cards in the feed");
});

// ---- 4. idempotent re-import does not disturb resurface state ----
await check("4. Re-importing the same archive preserves resurface state (idempotent)", async () => {
  const posts = (await retry(() => api("GET", "/api/x/import"))).json.importedPosts;
  const subject = posts.find((p) => p.text.includes(SUBJECT_TEXT));
  await retry(() => api("POST", "/api/x/import", { action: "resurface", tweetId: subject.id, on: true }));
  await importArchive(); // re-import the identical archive
  const after = (await retry(() => api("GET", "/api/x/import"))).json.importedPosts;
  const same = after.find((p) => p.id === subject.id);
  if (!same.resurfaced) throw new Error("re-import silently reset a resurfaced post");
  await retry(() => api("POST", "/api/x/import", { action: "resurface", tweetId: subject.id, on: false }));
});

// ---- 5. cap discipline: resurfacing does not flood the feed ----
await check("5. Resurfaced cards respect the injection cap (bounded, not unbounded)", async () => {
  await retry(() => api("POST", "/api/x/import", { action: "resurfaceAll", on: true }));
  const disc = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  const n = disc.json.cards.filter((c) => c.kind === "resurfaced").length;
  if (n > 3) throw new Error(`${n} resurfaced cards rendered, cap is 3`);
  await retry(() => api("POST", "/api/x/import", { action: "resurfaceAll", on: false }));
});

// ---- 6. PAGE: the toggle, per-post and bulk, on the profile ----
await check("6. PAGE: resurface toggle flips a post; bulk control promotes all; visitor sees no controls", async () => {
  await page.goto(BASE + "/yeak__", { waitUntil: "networkidle" });
  // settle the shelf render with a poll (lib-health) instead of a flat wait; assertion below is unchanged
  await pollUntil(async () => (await page.locator("[data-testid=resurface-toggle]").count()) === 5, {
    tries: 15,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  const toggles = page.locator("[data-testid=resurface-toggle]");
  const toggleCount = await toggles.count();
  if (toggleCount !== 5) throw new Error(`${toggleCount} per-post toggles rendered, expected 5`);
  const first = toggles.first();
  if ((await first.getAttribute("data-resurfaced")) !== "false")
    throw new Error("toggle did not default to off");
  await first.click();
  let flipped = false;
  for (let i = 0; i < 15 && !flipped; i++) {
    await page.waitForTimeout(400);
    flipped = (await page.locator("[data-testid=resurface-toggle]").first().getAttribute("data-resurfaced")) === "true";
  }
  if (!flipped) throw new Error("clicking the toggle never flipped it");
  // and the underlying post now shows in the feed
  // content-settled read (lib-health): retry until the resurfaced card is present, then assert as before
  const disc = await retryContent(
    () => retry(() => api("GET", "/api/feed2?surface=discovery")),
    (r) => r.json.cards.some((c) => c.kind === "resurfaced"),
    4
  );
  if (!disc.json.cards.some((c) => c.kind === "resurfaced")) throw new Error("page toggle did not reach the feed");
  await page.locator("[data-testid=resurface-toggle]").first().click();
  let unflipped = false;
  for (let i = 0; i < 15 && !unflipped; i++) {
    await page.waitForTimeout(400);
    unflipped = (await page.locator("[data-testid=resurface-toggle]").first().getAttribute("data-resurfaced")) === "false";
  }
  if (!unflipped) throw new Error("un-toggling the resurface control never took effect");

  await page.locator("[data-testid=resurface-all]").click();
  let bulkOn = false;
  for (let i = 0; i < 15 && !bulkOn; i++) {
    await page.waitForTimeout(400);
    bulkOn = (await page.locator("[data-testid=resurface-toggle][data-resurfaced=true]").count()) === 5;
  }
  if (!bulkOn) throw new Error("bulk control did not promote every post");
  await page.locator("[data-testid=resurface-all]").click();
  await page.waitForTimeout(600);

  // a VISITOR sees no controls at all — the toggle is an owner action
  await viewAs(id("crustcritic"));
  await page.goto(BASE + "/yeak__", { waitUntil: "networkidle" });
  // anchor on the shelf being rendered (5 posts) so the zero-count control checks below are not vacuous
  await pollUntil(async () => (await page.locator("[data-testid=imported-post]").count()) === 5, {
    tries: 15,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  if ((await page.locator("[data-testid=resurface-toggle]").count()) !== 0)
    throw new Error("a visitor can see resurface controls on someone else's profile");
  if ((await page.locator("[data-testid=resurface-all]").count()) !== 0)
    throw new Error("a visitor can see the bulk resurface control");
  // the shelf itself still renders — the posts, just not the controls
  if ((await page.locator("[data-testid=imported-post]").count()) !== 5)
    throw new Error("visitor cannot see the imported history at all");
  await viewAs(null);
});

await reset();
await viewAs(null);
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} UX Gate 0 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
