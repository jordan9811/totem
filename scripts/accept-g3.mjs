// GATE 3 acceptance — Wave 6 market layer (criteria 10-15).
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;

let failures = 0;
const results = [];
const ok = (n) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n);
};
let infraFailures = 0;
const fail = (n, d) => {
  // An infrastructure failure is not a product failure. Label it so a
  // dying server can never be read as a broken invariant.
  const infra = isInfraError(d);
  if (infra) infraFailures++;
  else failures++;
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
    json = await res.json();
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
async function goto(url, waitMs) {
  // A Next dev server can abort a navigation while it compiles a route
  // (ERR_ABORTED). That is infrastructure noise, not a product signal, and
  // a flaky harness makes the 4x-consecutive requirement meaningless.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(waitMs ?? 600);
      return;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(800);
    }
  }
  throw lastErr;
}
const setMaxLatency = (on) => api("POST", "/api/dev", { action: "maxLatency", on });
const setMode = async (name) => {
  const modes = await retry(() => api("GET", "/api/modes"));
  const mode = modes.json.modes.find((m) => m.name === name);
  if (!mode) throw new Error("mode not found: " + name);
  await retry(() => api("POST", "/api/modes/active", { modeId: mode.id }));
  return mode;
};

console.log("\nGate 3 — Wave 6: Market Layer");
await api("POST", "/api/dev", { action: "forceFail", label: "", count: 0 });
await api("POST", "/api/dev", { action: "resetSeed" });
await page.waitForTimeout(400);

// --- 10. full auction lifecycle → settlement → earnings ---
await check(
  "10. Create intent → scripted bids arrive → pick winner → settlement exists → earnings reflect it",
  async () => {
    const before = await retry(() => api("GET", "/api/earnings"));
    const beforeTotal = before.json.total;

    const created = await retry(() =>
      api("POST", "/api/market/intent", {
        category: "espresso",
        description: "Espresso setup under $600",
        escrowAmount: 5000,
        pitchSlots: 3,
        windowMs: 60000,
      })
    );
    const intentId = created.json.intent.id;

    // Jump the clock so the scripted bids arrive (no wall-clock waiting).
    for (let i = 0; i < 4; i++) {
      await retry(() => api("POST", "/api/market/intent", { intentId, action: "advanceClock", ms: 2000 }));
    }
    // retryContent: settle transient per-item bid drops before asserting (audit line 117)
    const withBids = await retryContent(
      () => api("GET", `/api/market/intent?intentId=${intentId}`),
      (r) => r.status >= 200 && r.status < 300 && (r.json.bids?.length ?? 0) >= 3,
      6
    );
    if (withBids.status < 200 || withBids.status >= 300)
      throw new Error("status " + withBids.status + " " + (withBids.json?.error ?? ""));
    if (withBids.json.bids.length < 3)
      throw new Error("expected 3 scripted bids, got " + withBids.json.bids.length);

    const winner = withBids.json.bids[1];
    const awarded = await retry(() =>
      api("POST", "/api/market/intent", { intentId, action: "award", bidId: winner.id })
    );
    if (awarded.json.intent.status !== "awarded") throw new Error("intent not awarded");
    if (awarded.json.intent.winningBidId !== winner.id) throw new Error("wrong winning bid recorded");

    // retryContent: settle transient per-item event drops before asserting (audit line 128)
    const after = await retryContent(
      () => api("GET", "/api/earnings"),
      (r) => r.status >= 200 && r.status < 300 && r.json.events.some((e) => e.kind === "intent_award"),
      6
    );
    if (after.status < 200 || after.status >= 300)
      throw new Error("status " + after.status + " " + (after.json?.error ?? ""));
    const settlement = after.json.events.find((e) => e.kind === "intent_award");
    if (!settlement) throw new Error("no intent_award settlement event");
    if (after.json.total <= beforeTotal)
      throw new Error(`earnings did not increase (${beforeTotal} → ${after.json.total})`);
  }
);

// --- 11. lapsed window refunds escrow via the alternate path ---
await check("11. Lapsed window refunds escrow and logs the alternate settlement path", async () => {
  const created = await retry(() =>
    api("POST", "/api/market/intent", {
      category: "telescope",
      description: "Beginner dobsonian, delivered",
      escrowAmount: 7500,
      pitchSlots: 2,
      windowMs: 5000,
    })
  );
  const intentId = created.json.intent.id;

  // push past the decision window
  await retry(() => api("POST", "/api/market/intent", { intentId, action: "advanceClock", ms: 9000 }));
  const lapsed = await retry(() => api("POST", "/api/market/intent", { intentId, action: "lapse" }));
  if (lapsed.json.intent.status !== "lapsed") throw new Error("intent did not lapse");
  if (lapsed.json.intent.winningBidId !== null) throw new Error("lapsed intent has a winner");

  // retryContent: settle transient per-item event drops before asserting (audit line 155)
  const earnings = await retryContent(
    () => api("GET", "/api/earnings"),
    (r) => r.status >= 200 && r.status < 300 && r.json.events.some((e) => e.kind === "intent_refund" && e.amount === 7500),
    6
  );
  if (earnings.status < 200 || earnings.status >= 300)
    throw new Error("status " + earnings.status + " " + (earnings.json?.error ?? ""));
  const refund = earnings.json.events.find(
    (e) => e.kind === "intent_refund" && e.amount === 7500
  );
  if (!refund) throw new Error("no intent_refund settlement event for the lapsed window");
});

// --- 12. k-floor enforced in BOTH layers, independently ---
await check("12. Below k-floor: UI submit disabled AND the API rejects a forced call", async () => {
  const narrow = {
    combinator: "AND",
    clauses: [
      { field: "graph.claim", op: "contains", value: "military_history" },
      { field: "author.tier", op: "gte", value: 9 },
    ],
  };

  // layer 1: the API rejects independently of any UI state
  const forced = await api("POST", "/api/market/campaign", {
    name: "Forced narrow campaign",
    budget: 100,
    audience: narrow,
  });
  if (forced.status !== 422)
    throw new Error("API accepted a below-floor campaign (status " + forced.status + ")");
  if (!/floor/i.test(forced.json.error ?? "")) throw new Error("rejection did not cite the floor");

  // layer 2: the UI disables submit and shows the reason
  await goto("/market/advertiser");
  await page.locator("[data-testid='campaign-name']").fill("Narrow test");
  await page.selectOption("[data-testid='audience-claim']", "military_history");
  await page.selectOption("[data-testid='audience-min-tier']", "9");
  // pollUntil: wait for the estimate to settle instead of a fixed 2500ms (audit line 186)
  await pollUntil(
    async () => (await page.locator("[data-testid='audience-estimate']").getAttribute("data-pending")) === "false",
    { tries: 20, delayMs: 500 }
  );
  const estimate = page.locator("[data-testid='audience-estimate']");
  if ((await estimate.getAttribute("data-below-floor")) !== "true")
    throw new Error("UI did not flag the audience as below floor");
  if (!(await page.locator("[data-testid='submit-campaign']").isDisabled()))
    throw new Error("submit button was not disabled below the floor");
  if ((await page.locator("[data-testid='submit-blocked-reason']").count()) === 0)
    throw new Error("no reason shown for the disabled submit");

  // and a healthy audience still works, so the gate isn't just always-off.
  // POLL for the estimate to settle instead of a fixed wait: the estimate
  // takes 200-1500ms per attempt and retries through injected failures, so a
  // fixed 2500ms lost the race whenever the latency rolled high — the test
  // was timing the mock's dice, not the product.
  await page.selectOption("[data-testid='audience-claim']", "espresso");
  await page.selectOption("[data-testid='audience-min-tier']", "1");
  let settled = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    const pending = await page.locator("[data-testid='audience-estimate']").getAttribute("data-pending");
    if (pending === "false") {
      settled = true;
      break;
    }
  }
  if (!settled) throw new Error("estimate never settled within 10s");
  if (await page.locator("[data-testid='submit-campaign']").isDisabled())
    throw new Error("submit stayed disabled for an audience above the floor");
});

// --- 13. audience-size error disables submit (fail closed), no stale count ---
await check("13. Audience-size error disables submit and never shows a stale count", async () => {
  await goto("/market/advertiser");
  await page.locator("[data-testid='campaign-name']").fill("Fail closed test");
  await page.selectOption("[data-testid='audience-claim']", "espresso");
  // pollUntil: wait for the baseline estimate instead of a fixed 2200ms (audit line 221)
  await pollUntil(
    async () => !!(await page.locator("[data-testid='audience-estimate']").getAttribute("data-size")),
    { tries: 20, delayMs: 500 }
  );
  const healthy = await page.locator("[data-testid='audience-estimate']").getAttribute("data-size");
  if (!healthy) throw new Error("no baseline estimate rendered");

  // Deterministic failure: force the next audienceSize calls to fail so the
  // fail-closed path is actually exercised, not merely probable. The budget
  // is generous because each estimate retries 3x and React strict mode
  // double-invokes the effect in dev — under-counting silently lets a
  // request succeed and masks the invariant.
  await page.waitForTimeout(1200); // let in-flight estimates drain first
  await api("POST", "/api/dev", { action: "forceFail", label: "market.audienceSize", count: 40 });
  await page.selectOption("[data-testid='audience-claim']", "telescope");
  // pollUntil: wait for the failing estimate to actually FINISH instead of a fixed 3500ms (audit line 233)
  await pollUntil(
    async () => (await page.locator("[data-testid='audience-estimate']").getAttribute("data-pending")) === "false",
    { tries: 20, delayMs: 500 }
  );

  const size = await page.locator("[data-testid='audience-estimate']").getAttribute("data-size");
  if (size !== "" && size !== null)
    throw new Error(`stale/guessed count shown during failure: "${size}"`);
  if (!(await page.locator("[data-testid='submit-campaign']").isDisabled()))
    throw new Error("submit enabled while audience size was unknown — FAILED OPEN");
  if ((await page.locator("[data-testid='submit-blocked-reason']").count()) === 0)
    throw new Error("no reason shown while size was unknown");

  // Disarm immediately so no budget leaks into later checks or later runs.
  await api("POST", "/api/dev", { action: "forceFail", label: "", count: 0 });

  // and it recovers once estimates work again
  await page.selectOption("[data-testid='audience-claim']", "espresso");
  // pollUntil: wait for the recovery estimate instead of a fixed 2500ms (audit line 248)
  await pollUntil(
    async () => !!(await page.locator("[data-testid='audience-estimate']").getAttribute("data-size")),
    { tries: 20, delayMs: 500 }
  );
  const recovered = await page.locator("[data-testid='audience-estimate']").getAttribute("data-size");
  if (!recovered) throw new Error("estimate did not recover after failures stopped");
});

// --- 14. ads absent in Event Safe Space, present in Default for a match ---
await check(
  "14. Ad cards absent in Event Safe Space, present in Default for a matched user",
  async () => {
    await setMode("Default");
    // retryContent: settle transient per-item ad-card drops before asserting (audit line 260)
    const def = await retryContent(
      () => api("GET", "/api/feed2?surface=discovery"),
      (r) => r.status >= 200 && r.status < 300 && r.json.cards.some((c) => c.kind === "ad"),
      6
    );
    if (def.status < 200 || def.status >= 300)
      throw new Error("status " + def.status + " " + (def.json?.error ?? ""));
    const defAds = def.json.cards.filter((c) => c.kind === "ad");
    if (defAds.length === 0)
      throw new Error("no ad cards in Default mode for a graph-matched viewer");
    for (const ad of defAds) {
      if (!ad.ad?.reasons?.length) throw new Error("ad card missing match reasons");
    }

    await setMode("Event Safe Space");
    const safe = await retry(() => api("GET", "/api/feed2?surface=discovery"));
    const safeAds = safe.json.cards.filter((c) => c.kind === "ad");
    if (safeAds.length > 0)
      throw new Error("ad cards present in Event Safe Space: " + safeAds.length);

    // Unmatched user: clear the graph, ads should stop matching.
    await setMode("Default");
    const graph = await retry(() => api("GET", "/api/graph"));
    for (const c of graph.json.claims.filter((x) => x.active)) {
      await retry(() => api("POST", "/api/graph", { action: "toggle", claimId: c.id, active: false }));
    }

    // VERIFY THE PRECONDITION before asserting on it. If a toggle silently
    // failed, claims are still active and any ads shown are correct —
    // reporting that as "ads shown to an unmatched viewer" would be a false
    // alarm rather than a finding.
    const afterClear = await retry(() => api("GET", "/api/graph"));
    const stillActive = afterClear.json.claims.filter((x) => x.active);
    if (stillActive.length > 0)
      throw new Error(
        "INFRA: could not clear the graph (" + stillActive.length + " claims still active) — ad-matching assertion not exercised"
      );

    const unmatched = await retry(() => api("GET", "/api/feed2?surface=discovery"));
    const unmatchedAds = unmatched.json.cards.filter((c) => c.kind === "ad");
    if (unmatchedAds.length > 0)
      throw new Error("ads shown to a viewer whose graph matches nothing");
  }
);

// --- 15. measurement is aggregates only, no user identifiers ---
await check("15. Measurement payload contains only aggregates, no user identifiers", async () => {
  const r = await retry(() => api("GET", "/api/market/measurement"));
  const payload = JSON.stringify(r.json);

  // shape assertion: only the aggregate keys are allowed
  const allowed = new Set(["name", "campaignId", "impressions", "conversions", "noiseBound"]);
  for (const row of r.json.aggregates) {
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) throw new Error(`unexpected key in measurement payload: ${key}`);
    }
    if (typeof row.impressions !== "number" || typeof row.conversions !== "number")
      throw new Error("aggregate counts are not numbers");
  }

  // and no identifier-shaped values leaked anywhere in the payload
  for (const needle of ["persona_", "root_", "@", "handle", "personaId", "userId", "users"]) {
    if (payload.includes(needle))
      throw new Error(`measurement payload contains "${needle}"`);
  }

  // deterministic noise: two reads must agree exactly
  // retryContent: settle transient per-item drops in the second read before comparing (audit line 320)
  const again = await retryContent(
    () => api("GET", "/api/market/measurement"),
    (r) => r.status >= 200 && r.status < 300 && JSON.stringify(r.json) === payload,
    6
  );
  if (again.status < 200 || again.status >= 300)
    throw new Error("status " + again.status + " " + (again.json?.error ?? ""));
  if (JSON.stringify(again.json) !== payload)
    throw new Error("measurement noise is not deterministic across reads");
});

// --- 16. the IN-FLIGHT window is fail-closed too ---
await check("16. A count is never displayed while its estimate is still in flight", async () => {
  // Regression, found by test 13 failing intermittently. The old code only
  // cleared the count when a request FAILED; while a new one was in flight it
  // kept the previous number on screen with submit still enabled. Mock
  // latency is 200-1500ms and estimates retry 3x, so that window can exceed
  // four seconds — long enough to click submit against a floor nobody
  // verified. Unlike test 13 this needs no forced failure and no timing luck:
  // it reads the state that exists between the change and the answer.
  await goto("/market/advertiser");
  await page.locator("[data-testid='campaign-name']").fill("In-flight test");
  await page.selectOption("[data-testid='audience-claim']", "espresso");
  // pollUntil: wait for the baseline estimate instead of a fixed 2500ms (audit line 336)
  await pollUntil(
    async () => !!(await page.locator("[data-testid='audience-estimate']").getAttribute("data-size")),
    { tries: 20, delayMs: 500 }
  );
  const settled = await page.locator("[data-testid='audience-estimate']").getAttribute("data-size");
  if (!settled) throw new Error("no baseline estimate rendered");

  await page.selectOption("[data-testid='audience-claim']", "telescope");
  // read immediately — this is the in-flight window, by construction
  const during = await page.locator("[data-testid='audience-estimate']").getAttribute("data-size");
  const pending = await page.locator("[data-testid='audience-estimate']").getAttribute("data-pending");
  if (during === settled && during !== "" && during !== null)
    throw new Error(`stale count "${during}" still displayed while re-estimating`);
  if (pending === "true" && !(await page.locator("[data-testid='submit-campaign']").isDisabled()))
    throw new Error("submit enabled while the audience estimate was still in flight — FAILED OPEN");

  // and it recovers: the new count lands and submit comes back
  // pollUntil: wait for the re-estimate to resolve instead of a fixed 3000ms (audit line 350)
  await pollUntil(
    async () => !!(await page.locator("[data-testid='audience-estimate']").getAttribute("data-size")),
    { tries: 20, delayMs: 500 }
  );
  const after = await page.locator("[data-testid='audience-estimate']").getAttribute("data-size");
  if (!after) throw new Error("estimate never resolved after the audience changed");
});

await browser.close();
const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Gate 3 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
if (infraFails.length) {
  console.log("\nInfrastructure (NOT product invariants):");
  for (const r of infraFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
// exit 2 = could not test; exit 1 = a real invariant failed
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
