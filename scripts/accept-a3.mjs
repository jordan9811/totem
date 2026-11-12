// TIER A GATE 3 — the caught-up banner.
//
// The contract under test: below the banner there is NOTHING algorithmic.
// Not fewer ranked posts — zero. A banner that ranked posts can follow is a
// pause button, and a pause button is not an anti-doomscroll contract.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;

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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
const page = await ctx.newPage();

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
// settle with retryContent: callers pass a completeness predicate so fan-out reads land before asserting
const feedCards = async (complete = () => true) => {
  const r = await retryContent(
    () => api("GET", "/api/feed2?surface=discovery"),
    (x) => x.status >= 200 && x.status < 300 && complete(x.json.cards),
    4
  );
  if (!(r.status >= 200 && r.status < 300)) throw new Error("status " + r.status + " " + (r.json?.error ?? ""));
  return r.json.cards;
};
const split = (cards) => {
  const i = cards.findIndex((c) => c.kind === "caughtup");
  return { i, above: i === -1 ? cards : cards.slice(0, i), below: i === -1 ? [] : cards.slice(i + 1) };
};

console.log("\nTier A Gate 3 — Caught-up banner");

// ---- 1. the banner appears exactly at exhaustion ----
await check("1. Banner appears exactly at exhaustion: everything above is newer than last visit", async () => {
  await reset();
  const before = split(await feedCards());
  if (before.i !== -1) throw new Error("banner present with no last-visit marker — should never fire");

  await retry(() => api("POST", "/api/dev", { action: "setLastVisit", minutesAgo: 60 }));
  // settle: banner and at least one ranked post present before the original assertions run
  const { i, above } = split(
    await feedCards((cards) => {
      const s = split(cards);
      return s.i !== -1 && s.above.some((c) => c.kind === "post" && !c.private);
    })
  );
  if (i === -1) throw new Error("no banner after last visit was set to 60 minutes ago");
  const posts = above.filter((c) => c.kind === "post" && !c.private);
  if (posts.length === 0) throw new Error("nothing above the banner — 60m window should admit posts");
  // Exactness, WITHOUT assuming seed timestamps are wall-clock-relative.
  // Seed post ages are relative to server BOOT, so the test derives its
  // cutoff from the newest post it can see (minutesAgo≈1 → ts≈serverNow-1m)
  // rather than from its own clock — the first version only passed while
  // the server was freshly booted. 2-minute fuzz covers the newest-post
  // offset and boundary posts.
  const newest = Math.max(...posts.map((c) => c.cast.timestamp));
  const definitelyOld = newest - 62 * 60_000;
  for (const c of posts) {
    if (c.cast.timestamp < definitelyOld)
      throw new Error(`post ${c.cast.hash} above the banner is older than the last visit`);
  }
});

// ---- 2. the hard stop: nothing algorithmic below ----
await check("2. Below the banner: readwise and folder cards ONLY — zero ranked posts, zero ads", async () => {
  // Arrange the longform rather than hoping seed schedules are still due:
  // readwise chunk surfacing depends on schedule timing, which drifts with
  // server uptime. The banner's promise is that queued longform appears
  // beneath it — so queue some.
  const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;
  const longform = posts.find((p) => p.truncate && !p.replyToHash);
  await retry(() => api("POST", "/api/feed-health", { postHash: longform.hash }));
  // a schedule surfaces its next chunk only when DUE — fast-forward makes it due now
  await retry(() => api("POST", "/api/dev", { action: "fastForwardReadwise" }));
  // settle: banner and the queued readwise chunk present before the original assertions run
  const { i, below } = split(
    await feedCards((cards) => {
      const s = split(cards);
      return s.i !== -1 && s.below.some((c) => c.kind === "readwise");
    })
  );
  if (i === -1) throw new Error("banner missing");
  if (below.length === 0) throw new Error("nothing below the banner — longform should be queued");
  const illegal = below.filter((c) => !["readwise", "folder"].includes(c.kind));
  if (illegal.length)
    throw new Error(`algorithmic content below the banner: ${illegal.map((c) => c.kind).join(",")}`);
  if (!below.some((c) => c.kind === "readwise"))
    throw new Error("no readwise chunks queued beneath the banner");
});

// ---- 3. force-exhaust: banner at the very top ----
await check("3. Force-exhaust puts the banner first with zero posts above", async () => {
  await retry(() => api("POST", "/api/dev", { action: "forceExhaust" }));
  // settle: banner present before the original assertions run
  const { i, above } = split(await feedCards((cards) => split(cards).i !== -1));
  if (i === -1) throw new Error("no banner after force-exhaust");
  const posts = above.filter((c) => c.kind === "post" && !c.private);
  if (posts.length > 0) throw new Error(`${posts.length} ranked posts above the banner after force-exhaust`);
});

// ---- 4. calibration OFF kills the banner without touching last-visit ----
await check("4. Calibration: off disables the banner; aggressive tightens it measurably", async () => {
  await reset();
  await retry(() => api("POST", "/api/dev", { action: "setLastVisit", minutesAgo: 60 }));

  const modes = await retry(() => api("GET", "/api/modes"));
  const def = modes.json.modes.find((m) => m.name === "Default");
  if (!def) throw new Error("Default mode missing"); // guard the find before deref

  // off
  await retry(() => api("PATCH", "/api/modes", { modeId: def.id, patch: { caughtUp: "off" } }));
  if (split(await feedCards()).i !== -1) throw new Error("banner rendered with calibration off");

  // new (baseline)
  await retry(() => api("PATCH", "/api/modes", { modeId: def.id, patch: { caughtUp: "new" } }));
  // settle: banner present and post-count stable across two consecutive reads before comparing counts
  let prevBase = -1;
  const baseline = split(
    await feedCards((cards) => {
      const s = split(cards);
      if (s.i === -1) return false;
      const n = s.above.filter((c) => c.kind === "post" && !c.private).length;
      const stable = n === prevBase;
      prevBase = n;
      return stable;
    })
  );
  if (baseline.i === -1) throw new Error("banner missing under 'new'");
  const baseCount = baseline.above.filter((c) => c.kind === "post" && !c.private).length;

  // aggressive: saturate the seeded breaking story first, then expect fewer
  await retry(() => api("POST", "/api/feed-health/saturation", { storyId: "story_idverify_breach" }));
  await retry(() => api("PATCH", "/api/modes", { modeId: def.id, patch: { caughtUp: "aggressive" } }));
  // settle: banner present and post-count stable across two consecutive reads before comparing counts
  let prevAgg = -1;
  const agg = split(
    await feedCards((cards) => {
      const s = split(cards);
      if (s.i === -1) return false;
      const n = s.above.filter((c) => c.kind === "post" && !c.private).length;
      const stable = n === prevAgg;
      prevAgg = n;
      return stable;
    })
  );
  if (agg.i === -1) throw new Error("banner missing under 'aggressive'");
  const aggCount = agg.above.filter((c) => c.kind === "post" && !c.private).length;
  if (!(aggCount < baseCount))
    throw new Error(`aggressive (${aggCount} above) not tighter than new (${baseCount} above)`);
});

// ---- 5. Event Safe Space composes: filtering happens BEFORE exhaustion ----
await check("5. Safe Space + caught up: safe-space filtering precedes exhaustion", async () => {
  await reset();
  await retry(() => api("POST", "/api/dev", { action: "setLastVisit", minutesAgo: 60 }));
  const modes = await retry(() => api("GET", "/api/modes"));
  const safe = modes.json.modes.find((m) => m.name === "Event Safe Space");
  if (!safe) throw new Error("Event Safe Space mode missing"); // guard the find before deref
  await retry(() => api("POST", "/api/modes/active", { modeId: safe.id }));

  // settle: banner present before the original assertions run
  const { i, above, below } = split(await feedCards((cards) => split(cards).i !== -1));
  if (i === -1) throw new Error("no banner in Safe Space with last visit set");
  // safe-space rules hide breaking-story posts — none may appear above
  const posts = readFileSync("seed/data/posts.json", "utf8");
  const breaking = new Set(
    JSON.parse(posts).posts.filter((p) => p.storyId).map((p) => p.hash)
  );
  for (const c of above.filter((c) => c.kind === "post" && !c.private)) {
    if (breaking.has(c.cast.hash))
      throw new Error("a breaking-story post survived Safe Space above the banner");
  }
  const illegal = below.filter((c) => !["readwise", "folder"].includes(c.kind));
  if (illegal.length) throw new Error("hard stop violated under Safe Space");
  // restore
  const def = modes.json.modes.find((m) => m.name === "Default");
  if (!def) throw new Error("Default mode missing"); // guard the find before deref
  await retry(() => api("POST", "/api/modes/active", { modeId: def.id }));
});

// ---- 6. the rendered page honours all of it ----
await check("6. PAGE render: banner visible, readwise beneath, no ranked posts after it", async () => {
  await reset();
  await retry(() => api("POST", "/api/dev", { action: "setLastVisit", minutesAgo: 60 }));
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // Poll rather than a flat wait: /home fans out across many mock adapter
  // calls (200-1500ms each, retried), so under full-sweep load a fixed
  // 800ms can land before the server render finishes. One reload midway
  // covers the case where setLastVisit landed after the render started.
  let banner = 0;
  for (let i = 0; i < 20; i++) {
    banner = await page.locator("[data-testid=caughtup-banner]").count();
    if (banner === 1) break;
    if (i === 9) await page.reload({ waitUntil: "networkidle" });
    else await page.waitForTimeout(400);
  }
  if (banner !== 1) throw new Error("banner not rendered on the page");
  // DOM order: nothing with data-testid=cast after the banner unless inside
  // a readwise/folder card
  const orderOk = await page.evaluate(() => {
    const banner = document.querySelector("[data-testid=caughtup-banner]");
    if (!banner) return false;
    let node = banner.parentElement?.nextElementSibling ?? null;
    // Walk the remaining feed items; each must be a readwise or folder card.
    const rest = [];
    let el = banner.closest("[data-feed-item]") ?? banner;
    while ((el = el.nextElementSibling)) rest.push(el);
    return rest.every(
      (e) =>
        e.querySelector("[data-testid=readwise-card]") ||
        e.querySelector("[data-testid=folder-card]") ||
        e.matches("[data-testid=readwise-card],[data-testid=folder-card]") ||
        e.children.length === 0
    );
  });
  if (!orderOk) throw new Error("page renders non-longform content after the banner");
});

await api("POST", "/api/dev", { action: "resetSeed" });
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Tier A Gate 3 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
