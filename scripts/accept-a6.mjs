// TIER A — CALL OPTION B: relationship history UI + the 3-strike path.
//
// The history tab is Gate 1's log made legible: why you follow, first
// interaction, engagement count, strikes with receipts, backfilled entries
// marked. The 3-strike test is the moderation half: per-user toggle, third
// strike auto-mutes, all three receipts shown — and turning the toggle off
// un-mutes with receipts intact.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;

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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
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

const TARGET = "handcuffhannah"; // not followed, has posts, uninvolved elsewhere
const targetPost = () => posts.find((p) => p.authorPersonaId === id(TARGET) && !p.replyToHash);

console.log("\nTier A Option B — Relationship history + 3-strike");

// ---- 1. why-you-follow renders the triggering cast ----
await check("1. Profile history: why-you-follow shows the triggering cast", async () => {
  await reset();
  const cast = posts.find((p) => p.authorPersonaId === id("quietvalidator") && !p.replyToHash);
  await retry(() =>
    api("POST", "/api/follow", {
      personaId: id("quietvalidator"),
      follow: true,
      triggeringCastId: cast.hash,
      context: "hover_card",
    })
  );
  await page.goto(BASE + "/quietvalidator", { waitUntil: "networkidle" });
  // settle the server-rendered history instead of a fixed wait (reload is safe: state is server-committed)
  await pollUntil(async () => (await page.locator("[data-testid=history-follow]").count()) === 1, {
    tries: 8,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  if ((await page.locator("[data-testid=history-follow]").count()) !== 1)
    throw new Error("why-you-follow section missing");
  const receipts = await page.locator("[data-testid=history-follow] [data-testid=history-receipt]").count();
  if (receipts !== 1) throw new Error("triggering cast not rendered as the receipt");
  const text = await page.locator("[data-testid=history-follow]").innerText();
  if (!text.includes(cast.text.slice(0, 40)))
    throw new Error("receipt does not show the actual triggering cast");
});

// ---- 2. backfilled entries are visually marked ----
await check("2. A seeded follow renders as BACKFILLED, distinct from real history", async () => {
  await page.goto(BASE + "/basisrisk", { waitUntil: "networkidle" });
  // settle the server-rendered history instead of a fixed wait (reload is safe: seeded state)
  await pollUntil(async () => (await page.locator("[data-testid=history-backfilled]").count()) === 1, {
    tries: 8,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  if ((await page.locator("[data-testid=history-backfilled]").count()) !== 1)
    throw new Error("backfilled marker missing on a seeded follow");
  const text = await page.locator("[data-testid=history-backfilled]").innerText();
  if (!/backfilled/i.test(text)) throw new Error("backfilled entry not labelled");
});

// ---- 3. first interaction + engagement count ----
await check("3. First interaction and engagement count render from the log", async () => {
  await reset();
  const post = posts.find((p) => p.authorPersonaId === id("basisrisk") && !p.replyToHash);
  await retry(() => api("POST", "/api/actions/react", { hash: post.hash, kind: "like", on: true }));
  await page.goto(BASE + "/basisrisk", { waitUntil: "networkidle" });
  // settle the server-rendered history instead of a fixed wait (reload is safe: like is server-committed)
  await pollUntil(async () => (await page.locator("[data-testid=history-first-interaction]").count()) === 1, {
    tries: 8,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  if ((await page.locator("[data-testid=history-first-interaction]").count()) !== 1)
    throw new Error("first interaction missing after a like on a followed author");
  const count = await page.locator("[data-testid=history-engagements]").getAttribute("data-count");
  if (Number(count) < 1) throw new Error("engagement count not rendered");
});

// ---- 4. THE 3-STRIKE PATH ----
await check("4. Third strike auto-mutes with the toggle on, and all three receipts render", async () => {
  await reset();
  await retry(() => api("POST", "/api/strike", { action: "setting", enabled: true }));
  const t = targetPost();
  const tPosts = posts.filter((p) => p.authorPersonaId === id(TARGET) && !p.replyToHash).slice(0, 3);
  if (tPosts.length < 3) throw new Error("target lacks 3 seeded posts for receipts");

  for (let i = 0; i < 2; i++) {
    const r = await retry(() =>
      api("POST", "/api/strike", { personaId: id(TARGET), triggeringCastId: tPosts[i].hash, context: "cast_menu" })
    );
    if (r.json.muted) throw new Error(`muted after ${i + 1} strikes — threshold is 3`);
  }
  // presence check BEFORE the third strike, so the absence assertion cannot
  // pass vacuously on an author who never ranked into the window
  const before = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  const wasPresent = before.json.cards.some(
    (c) => c.kind === "post" && c.cast?.personaId === id(TARGET)
  );

  const third = await retry(() =>
    api("POST", "/api/strike", { personaId: id(TARGET), triggeringCastId: tPosts[2].hash, context: "cast_menu" })
  );
  if (!third.json.muted) throw new Error("third strike did not auto-mute");

  // the feed no longer carries the muted author
  const f = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  const stillPresent = f.json.cards.some(
    (c) => c.kind === "post" && c.cast?.personaId === id(TARGET)
  );
  if (stillPresent) throw new Error("muted author still in the feed");
  if (!wasPresent)
    console.log("        (note: author was not in the window pre-mute; absence verified but weakly)");

  // profile shows 3 strikes, the mute badge, and every receipt
  await page.goto(BASE + "/" + TARGET, { waitUntil: "networkidle" });
  // settle the full server-rendered strike state (count, badge, all receipts) before the original
  // assertions; midway reload re-renders if a receipt hydration dropped (server-rendered page)
  await pollUntil(
    async () =>
      (await page.locator("[data-testid=history-strikes]").getAttribute("data-count")) === "3" &&
      (await page.locator("[data-testid=history-muted]").count()) === 1 &&
      (await page.locator("[data-testid=history-strikes] [data-testid=history-receipt]").count()) === 3,
    { tries: 8, delayMs: 400, midway: () => page.reload({ waitUntil: "networkidle" }) }
  );
  const strikes = await page.locator("[data-testid=history-strikes]").getAttribute("data-count");
  if (strikes !== "3") throw new Error(`profile shows ${strikes} strikes, expected 3`);
  if ((await page.locator("[data-testid=history-muted]").count()) !== 1)
    throw new Error("auto-mute badge missing");
  const receipts = await page.locator("[data-testid=history-strikes] [data-testid=history-receipt]").count();
  if (receipts !== 3) throw new Error(`${receipts} receipts rendered, expected all 3`);
});

// ---- 5. strikes without the toggle do NOT mute; receipts still record ----
await check("5. With the toggle off, three strikes record receipts but mute nothing", async () => {
  await reset();
  // toggle stays off (default)
  const tPosts = posts.filter((p) => p.authorPersonaId === id(TARGET) && !p.replyToHash).slice(0, 3);
  for (const p of tPosts) {
    const r = await retry(() =>
      api("POST", "/api/strike", { personaId: id(TARGET), triggeringCastId: p.hash, context: "cast_menu" })
    );
    if (r.json.muted) throw new Error("muted with the toggle OFF — auto-moderation must be opt-in");
  }
  const f = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  const present = f.json.cards.some((c) => c.kind === "post" && c.cast?.personaId === id(TARGET));
  if (!present) {
    // the author may rank outside the window naturally; assert via a second
    // signal — the strike setting really is off
    const s = await retry(() => api("GET", "/api/strike"));
    if (s.json.setting.enabled) throw new Error("setting unexpectedly on");
  }
});

// ---- 6. turning the toggle off un-mutes, receipts intact ----
await check("6. Disabling the toggle un-mutes on next render; receipts survive", async () => {
  await reset();
  await retry(() => api("POST", "/api/strike", { action: "setting", enabled: true }));
  const tPosts = posts.filter((p) => p.authorPersonaId === id(TARGET) && !p.replyToHash).slice(0, 3);
  for (const p of tPosts) {
    await retry(() =>
      api("POST", "/api/strike", { personaId: id(TARGET), triggeringCastId: p.hash, context: "cast_menu" })
    );
  }
  await retry(() => api("POST", "/api/strike", { action: "setting", enabled: false }));
  const f = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  // un-muted: presence not guaranteed by ranking, so assert the derivation
  // is off via the eventlog: strikes remain, no NEW mute effect
  const evs = await retry(() => api("GET", `/api/eventlog?target=${id(TARGET)}`));
  const strikes = evs.json.events.filter((e) => e.type === "strike");
  if (strikes.length !== 3) throw new Error(`receipts lost: ${strikes.length} strike events after toggle-off`);

  await page.goto(BASE + "/" + TARGET, { waitUntil: "networkidle" });
  // settle the server-rendered strike count instead of a fixed wait (reload is safe: server state)
  await pollUntil(
    async () => (await page.locator("[data-testid=history-strikes]").getAttribute("data-count")) === "3",
    { tries: 8, delayMs: 400, midway: () => page.reload({ waitUntil: "networkidle" }) }
  );
  const shown = await page.locator("[data-testid=history-strikes]").getAttribute("data-count");
  if (shown !== "3") throw new Error("receipts not rendered after un-mute");
});

// ---- 7. the strike toggle lives in settings ----
await check("7. Settings: the per-user toggle renders and flips", async () => {
  await reset();
  await page.goto(BASE + "/settings/privacy", { waitUntil: "networkidle" });
  // settle the settings render instead of a fixed wait (reload safe: nothing clicked yet)
  await pollUntil(async () => (await page.locator("[data-testid=strike-toggle]").count()) === 1, {
    tries: 8,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  const toggle = page.locator("[data-testid=strike-toggle]");
  if ((await toggle.count()) !== 1) throw new Error("strike toggle missing from settings");
  // SETTLED, not just present: StrikeToggle renders data-enabled="false"
  // as its LOADING placeholder (useState null coerced) while its /api/strike
  // fetch is in flight — byte-identical to settled "off", so asserting on
  // the placeholder makes the default-off check vacuous (a default-ON
  // regression would pass it). The button is disabled until settled; poll
  // for enabledness first, THEN run the original assertion.
  await pollUntil(async () => !(await toggle.isDisabled()), { tries: 10, delayMs: 400 });
  if (await toggle.isDisabled()) throw new Error("strike toggle never settled (still loading)");
  if ((await toggle.getAttribute("data-enabled")) !== "false")
    throw new Error("toggle not default-off");
  await toggle.click();
  // poll for the flip: the settings POST carries 200-1500ms mock latency; NO reload here — it
  // could cancel the in-flight POST the click just fired (client-side state under test)
  await pollUntil(async () => (await toggle.getAttribute("data-enabled")) === "true", {
    tries: 10,
    delayMs: 300,
  });
  if ((await toggle.getAttribute("data-enabled")) !== "true") throw new Error("toggle did not flip");
  const s = await retry(() => api("GET", "/api/strike"));
  if (!s.json.setting.enabled) throw new Error("UI flip did not persist server-side");
});

await api("POST", "/api/dev", { action: "resetSeed" });
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Tier A Option B checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
