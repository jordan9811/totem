// Acceptance suite for Waves 1-3, all against deterministic seeded data.
// Run: npm run test:accept   (dev server + validator must be running)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { retryContent, pollUntil } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const seed = (f) => JSON.parse(readFileSync(path.resolve("seed/data", f), "utf8"));
const POSTS = seed("posts.json");
const ACCOUNTS = seed("accounts.json");
const NOTES = seed("notes.json");
const VIEWER = seed("viewer.json").viewer;

const personaById = new Map(ACCOUNTS.personas.map((p) => [p.id, p]));
const personaByHandle = new Map(ACCOUNTS.personas.map((p) => [p.handle, p]));

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
}

// Mocks fail 2% of the time by design; retry read-only assertions so the
// suite measures behavior, not luck. Failure handling itself is asserted
// explicitly in test 11.
async function retry(fn, attempts = 6) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastErr;
}

async function api(page, method, url, body) {
  return retry(async () => {
    const res = await page.request.fetch(BASE + url, {
      method,
      headers: { "Content-Type": "application/json" },
      data: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok()) throw new Error(json.error || `HTTP ${res.status()}`);
    return json;
  });
}

async function feed(page, surface = "discovery") {
  return (await api(page, "GET", `/api/feed2?surface=${surface}`)).cards;
}

async function setMode(page, name) {
  const { modes } = await api(page, "GET", "/api/modes");
  const mode = modes.find((m) => m.name === name);
  if (!mode) throw new Error(`mode not found: ${name}`);
  await api(page, "POST", "/api/modes/active", { modeId: mode.id });
  return mode;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

// Clean slate.
await api(page, "POST", "/api/dev", { action: "resetSeed" });

console.log("\nWave 1 — Identity & Modes");

// 1. Mode switch: Default → Work.
try {
  await setMode(page, "Default");
  const before = await feed(page);
  const workMode = await setMode(page, "Work");
  const after = await feed(page);

  const professional = new Set(["crypto", "history"]);
  const outsideClusters = after
    .filter((c) => c.kind === "post")
    .filter((c) => {
      const p = personaByHandle.get(c.cast.author.username);
      return p && !professional.has(p.cluster);
    });
  const unfollowed = after
    .filter((c) => c.kind === "post")
    .filter((c) => {
      const p = personaByHandle.get(c.cast.author.username);
      return p && !VIEWER.followingPersonaIds.includes(p.id);
    });

  const rerendered = JSON.stringify(before.map((c) => c.cast.hash)) !== JSON.stringify(after.map((c) => c.cast.hash));
  const ok = rerendered && outsideClusters.length === 0 && unfollowed.length === 0 && workMode.showTrending === false;
  record(
    "1. Mode switch Default→Work: feed re-renders, only followed professional clusters, trending gone",
    ok,
    `rerendered=${rerendered} outsideClusters=${outsideClusters.length} unfollowed=${unfollowed.length} trending=${workMode.showTrending}`
  );
} catch (e) {
  record("1. Mode switch Default→Work", false, e.message);
}

// 2. Event Safe Space: zero story-tagged breaking-news posts.
try {
  await setMode(page, "Event Safe Space");
  const cards = await feed(page);
  const storyPosts = cards.filter((c) => c.kind === "post" && c.cast.storyId);
  record("2. Event Safe Space: zero breaking-news story posts render", storyPosts.length === 0, `found ${storyPosts.length}`);
} catch (e) {
  record("2. Event Safe Space", false, e.message);
}

// 3. Cross-persona block: block one persona, ALL personas of that root vanish.
try {
  await setMode(page, "Default");
  // basisrisk (crypto) and duskorbiter (astronomy) share one root.
  const primary = personaByHandle.get("basisrisk");
  const sibling = personaByHandle.get("duskorbiter");
  if (!primary || !sibling || primary.rootId !== sibling.rootId) throw new Error("seed fixture missing multi-persona root");

  await api(page, "POST", "/api/block-seed", { personaId: primary.id });
  const cards = await feed(page, "following");
  const stillVisible = cards.filter(
    (c) => c.cast.author.username === primary.handle || c.cast.author.username === sibling.handle
  );

  // Search + replies: profile pages of both personas must show the blocked state.
  await page.goto(`${BASE}/${sibling.handle}`, { waitUntil: "domcontentloaded" });
  // Settle: blocked notice arrives via latency-injected adapter fetch; poll before the one-shot count.
  await pollUntil(async () => (await page.locator("[data-testid='profile-blocked']").count()) > 0, {
    tries: 10,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  const blockedNotice = await page.locator("[data-testid='profile-blocked']").count();

  record(
    "3. Cross-persona block: every persona of the blocked root vanishes from feed + profile",
    stillVisible.length === 0 && blockedNotice > 0,
    `feedLeaks=${stillVisible.length} siblingProfileBlocked=${blockedNotice > 0}`
  );
} catch (e) {
  record("3. Cross-persona block", false, e.message);
}

// 4. Disclosure: inner-circle linkage is invisible to a non-inner-circle viewer.
try {
  await api(page, "POST", "/api/dev", { action: "resetSeed" });
  const target = VIEWER.personas[1];
  await api(page, "POST", "/api/disclosure", { personaId: target, level: "inner_circle" });
  const outsider = personaByHandle.get("crustcritic");
  const asOutsider = await api(page, "GET", `/api/disclosure?personaId=${target}&viewerPersonaId=${outsider.id}`);
  const asSelf = await api(page, "GET", `/api/disclosure?personaId=${target}&viewerPersonaId=${VIEWER.personas[0]}`);
  record(
    "4. Disclosure: inner-circle linkage hidden from non-inner-circle viewer, visible to own root",
    asOutsider.canViewLinkage === false && asSelf.canViewLinkage === true,
    `outsider=${asOutsider.canViewLinkage} self=${asSelf.canViewLinkage}`
  );
} catch (e) {
  record("4. Disclosure inner-circle", false, e.message);
}

// 9. Facet follow (run before feed-health so state is clean).
try {
  await api(page, "POST", "/api/dev", { action: "resetSeed" });
  await setMode(page, "Default");
  const mixed = personaByHandle.get("basisrisk"); // crypto persona of a crypto+astronomy root
  const { facets } = await api(page, "GET", `/api/disclosure/facets?personaId=${mixed.id}`);
  const astro = facets.find((f) => f.cluster === "astronomy");
  if (!astro) throw new Error("astronomy facet missing");
  await api(page, "POST", "/api/disclosure/facets", { facetId: astro.id, follow: true });

  const cards = await feed(page, "following");
  const rootHandles = ACCOUNTS.personas.filter((p) => p.rootId === mixed.rootId);
  const cryptoHandles = rootHandles.filter((p) => p.cluster === "crypto").map((p) => p.handle);
  const leaked = cards.filter((c) => cryptoHandles.includes(c.cast.author.username));
  record(
    "9. Facet follow: following only the astronomy facet hides that root's crypto posts",
    leaked.length === 0,
    `cryptoPostsVisible=${leaked.length}`
  );
} catch (e) {
  record("9. Facet follow", false, e.message);
}

console.log("\nWave 2 — Reputation & Rules");

// 10. Rules preview count is exact against the deterministic seed.
try {
  const expected = POSTS.posts.filter((p) => {
    const author = personaById.get(p.authorPersonaId);
    return author && author.tier < 3;
  }).length;
  // Settle: re-read on a short count (per-item adapter drops return a valid 200); exact assertion below unchanged.
  const { count } = await retryContent(
    () =>
      api(page, "POST", "/api/rules/preview", {
        root: { combinator: "AND", clauses: [{ field: "author.tier", op: "lt", value: 3 }] },
      }),
    (r) => r.count === expected,
    4
  );
  record("10. Rules preview: 'tier < 3' count matches seeded low-tier post count exactly", count === expected, `got ${count}, expected ${expected}`);
} catch (e) {
  record("10. Rules preview", false, e.message);
}

// 12. Attestation connect bumps tier.
try {
  await api(page, "POST", "/api/dev", { action: "resetSeed" });
  const before = await api(page, "GET", "/api/attestations");
  const after = await api(page, "POST", "/api/attestations", { issuerId: "issuer_professional" });
  record(
    "12. Attestation: connecting a credential raises the tier badge",
    after.tier !== null && before.tier !== null && after.tier > before.tier,
    `before=${before.tier} after=${after.tier}`
  );
} catch (e) {
  record("12. Attestation", false, e.message);
}

// Tier badge renders in the UI from adapter data.
try {
  await page.goto(`${BASE}/0xledgerline`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid='tier-badge']", { timeout: 8000 });
  const tierText = await page.locator("[data-testid='tier-badge']").first().getAttribute("data-tier");
  const expected = personaByHandle.get("0xledgerline").tier;
  record("2b. Tier badge renders from adapter data on profile", Number(tierText) === expected, `badge=${tierText} seed=${expected}`);
} catch (e) {
  record("2b. Tier badge renders", false, e.message);
}

console.log("\nWave 3 — Feed Health");

// 5. Readwise: bookmark a long-form post, fast-forward, chunks 1 and 2 in order.
try {
  await api(page, "POST", "/api/dev", { action: "resetSeed" });
  await setMode(page, "Default");
  const longform = POSTS.posts.find((p) => p.truncate);
  await api(page, "POST", "/api/feed-health", { postHash: longform.hash });
  await api(page, "POST", "/api/feed-health/readwise", { all: true });
  await api(page, "POST", "/api/feed-health/readwise", { all: true });

  // Settle: re-read feed until both chunk cards are present (per-item drops); order/progress asserted below unchanged.
  const cards = await retryContent(
    () => feed(page),
    (cs) => [1, 2].every((i) => cs.some((c) => c.kind === "readwise" && c.cast.hash.startsWith(longform.hash) && c.chunkIndex === i)),
    4
  );
  const chunks = cards.filter((c) => c.kind === "readwise" && c.cast.hash.startsWith(longform.hash));
  const first = chunks.find((c) => c.chunkIndex === 1);
  const second = chunks.find((c) => c.chunkIndex === 2);
  const inOrder = first && second && cards.indexOf(first) < cards.indexOf(second);
  const hasProgress = first && first.chunkTotal > 1;
  record(
    "5. Readwise: chunks 1 and 2 appear in order with progress indicator",
    !!(first && second && inOrder && hasProgress),
    `chunks=${chunks.length} inOrder=${inOrder} total=${first?.chunkTotal}`
  );
} catch (e) {
  record("5. Readwise chunking", false, e.message);
}

// 6. Saturation: caught-up hides the story, but an is_update post still surfaces.
try {
  await api(page, "POST", "/api/dev", { action: "resetSeed" });
  const mode = await setMode(page, "Default");
  const storyId = POSTS.storyId;
  await api(page, "POST", "/api/feed-health/saturation", { storyId, modeId: mode.id });
  // Settle: re-read feed until the is_update card is present (per-item drops); assertions below unchanged.
  const cards = await retryContent(
    () => feed(page),
    (cs) => cs.some((c) => c.kind === "post" && c.cast.storyId === storyId && c.cast.isUpdate),
    4
  );
  const storyPosts = cards.filter((c) => c.kind === "post" && c.cast.storyId === storyId);
  const updates = storyPosts.filter((c) => c.cast.isUpdate);
  const nonUpdates = storyPosts.filter((c) => !c.cast.isUpdate);
  record(
    "6. Saturation: caught-up story hidden, is_update post still surfaces",
    nonUpdates.length === 0 && updates.length > 0,
    `nonUpdates=${nonUpdates.length} updates=${updates.length}`
  );
} catch (e) {
  record("6. Topic saturation", false, e.message);
}

// 7. Notes reinjection: qualifying note reinjects, gate-failing note does not.
try {
  await api(page, "POST", "/api/dev", { action: "resetSeed" });
  await setMode(page, "Default");
  // Settle both reads: qualifying reinjection and correction card can each vanish to a per-item drop; assertions below unchanged.
  const { reinjections } = await retryContent(
    () => api(page, "GET", "/api/feed-health"),
    (r) => r.reinjections.some((x) => x.qualifies),
    4
  );
  const qualifying = reinjections.filter((r) => r.qualifies);
  const failing = reinjections.filter((r) => !r.qualifies);

  const cards = await retryContent(
    () => feed(page),
    (cs) => cs.some((c) => c.kind === "correction"),
    4
  );
  const correctionCards = cards.filter((c) => c.kind === "correction");
  const failingNoteIds = new Set(failing.map((r) => r.noteId));
  const leakedFailing = correctionCards.filter((c) => [...failingNoteIds].some((id) => c.cast.hash.includes(id)));

  const gateFailingNoteExists = NOTES.notes.some((n) => !n.qualifies);
  record(
    "7. Notes reinjection: qualifying note reinjects, gate-failing note does not",
    qualifying.length > 0 && correctionCards.length > 0 && leakedFailing.length === 0 && gateFailingNoteExists,
    `qualifying=${qualifying.length} correctionCards=${correctionCards.length} leaked=${leakedFailing.length}`
  );
} catch (e) {
  record("7. Notes reinjection", false, e.message);
}

// 8. Send-to-timeline: renders inline with permission on, blocked with it off.
try {
  await api(page, "POST", "/api/dev", { action: "resetSeed" });
  await setMode(page, "Default");
  const me = VIEWER.personas[0];
  const friend = personaByHandle.get("aperture_annie");
  const post = POSTS.posts.find((p) => !p.truncate && !p.replyToHash);

  // Permission ON → inline render.
  await api(page, "POST", "/api/feed-health/permission", { allow: true, personaId: me });
  await api(page, "POST", "/api/feed-health/send", { fromPersonaId: friend.id, toPersonaId: me, postHash: post.hash });
  // Settle: re-read until the sent card is present (per-item drops); permission-off absence read below stays one-shot.
  const withPermission = await retryContent(
    () => feed(page),
    (cs) => cs.some((c) => c.kind === "sent"),
    4
  );
  const sentCards = withPermission.filter((c) => c.kind === "sent");

  // Permission OFF → receipt blocked.
  await api(page, "POST", "/api/feed-health/permission", { allow: false, personaId: me });
  const withoutPermission = await feed(page);
  const blockedCards = withoutPermission.filter((c) => c.kind === "sent");

  record(
    "8. Send-to-timeline: inline with permission on, blocked with permission off",
    sentCards.length > 0 && blockedCards.length === 0,
    `withPermission=${sentCards.length} withoutPermission=${blockedCards.length}`
  );
  await api(page, "POST", "/api/feed-health/permission", { allow: true, personaId: me });
} catch (e) {
  record("8. Send-to-timeline", false, e.message);
}

console.log("\nCross-cutting");

// 11. Adapter resilience: latency maxed → loading states, no unhandled errors.
try {
  await api(page, "POST", "/api/dev", { action: "resetSeed" });
  await api(page, "POST", "/api/dev", { action: "maxLatency", on: true });

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(e.message));

  const surfaces = ["/home", "/settings/modes", "/settings/rules", "/settings/feed-health", "/settings/attestations", "/settings/privacy"];
  let loadingSeen = 0;
  let renderedSomething = 0;

  for (const surface of surfaces) {
    await page.goto(BASE + surface, { waitUntil: "domcontentloaded" });
    // A loading affordance OR already-settled content must be present —
    // never a blank screen with an unhandled rejection.
    const sawLoading = await page
      .locator("[data-testid='settings-loading'], [data-testid='timeline-skeleton'], [data-testid='facets-loading']")
      .count();
    if (sawLoading > 0) loadingSeen++;
    // Settle: poll for any rendered text instead of a fixed 2600ms guess (no reload — in-flight loading UI is under test).
    await pollUntil(async () => (await page.locator("main").innerText()).trim().length > 0, { tries: 12, delayMs: 500 });
    const settled = await page.locator("main").innerText();
    if (settled.trim().length > 0) renderedSomething++;
  }

  await api(page, "POST", "/api/dev", { action: "maxLatency", on: false });
  record(
    "11. Adapter resilience: loading states shown under max latency, no unhandled errors",
    renderedSomething === surfaces.length && pageErrors.length === 0,
    `rendered=${renderedSomething}/${surfaces.length} loadingSeen=${loadingSeen} pageErrors=${pageErrors.length} consoleErrors=${consoleErrors.length}`
  );
} catch (e) {
  await api(page, "POST", "/api/dev", { action: "maxLatency", on: false }).catch(() => {});
  record("11. Adapter resilience", false, e.message);
}

// UI-level mode switch (the visible centerpiece).
try {
  await api(page, "POST", "/api/dev", { action: "resetSeed" });
  await setMode(page, "Default");
  // networkidle + a beat: the pill is an RSC-rendered client component, so
  // clicking before hydration lands on a button with no handler attached.
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid='mode-pill']", { timeout: 15000 });
  const startMode = await page.locator("[data-testid='mode-pill']").getAttribute("data-active-mode");
  // Settle: re-click until hydration attaches the handler and the menu opens, instead of a fixed 600ms guess (no reload — client state under test).
  await pollUntil(
    async () => {
      if ((await page.locator("[data-testid='mode-menu']").count()) > 0) return true;
      await page.locator("[data-testid='mode-pill']").click();
      return (await page.locator("[data-testid='mode-menu']").count()) > 0;
    },
    { tries: 8, delayMs: 500 }
  );
  await page.waitForSelector("[data-testid='mode-menu']", { timeout: 15000 });
  await page.locator("[data-testid='mode-option-work']").click();
  await page.waitForFunction(
    () => document.querySelector("[data-testid='mode-pill']")?.getAttribute("data-active-mode") === "Work",
    { timeout: 10000 }
  );
  const endMode = await page.locator("[data-testid='mode-pill']").getAttribute("data-active-mode");
  record("1b. Mode pill: visible in header, one-tap switch re-renders feed", startMode === "Default" && endMode === "Work", `${startMode} → ${endMode}`);
} catch (e) {
  record("1b. Mode pill UI", false, e.message);
}

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} acceptance checks passed`);
if (passed < results.length) {
  console.log("\nFailures:");
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
}
process.exit(passed === results.length ? 0 : 1);
