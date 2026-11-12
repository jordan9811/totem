// FC PASS GATE 2 — live reads as a first-class source (fixture-safe checks).
//
// What this suite proves WITHOUT depending on live rendering determinism:
// the runtime source switch, its isolation from persona/grant/mode state,
// the forced-429 degrade-to-cache path (deterministic — the knob consumes
// BEFORE any network call), the stale flag reaching feed2 and the page,
// and the reset contract. The subjective live-rendering checks (real
// content on every surface, screenshots) live in the separate live
// verification script, not in sweeps.
//
// One real Neynar read fills the cache for the stale-shelf test. It is a
// READ (never a write, never a spend); if the network is absent the suite
// reports INFRA (exit 2), never a fake product failure.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;

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
const setSource = (source) => retry(() => api("POST", "/api/dev", { action: "setDataSource", source }));
const arm429 = (count) => retry(() => api("POST", "/api/dev", { action: "forceNeynar429", count }));
const registry = async () => (await retry(() => api("GET", "/api/dev"))).json.registry;
const liveProbe = () => retry(() => api("GET", "/api/dev/live"));

console.log("\nFC Gate 2 — live reads as a first-class source");

// ---- 1. seed is the default; the runtime switch flips and flips back ----
await check("1. Source defaults to seed; runtime switch flips to neynar and back without a restart", async () => {
  await reset();
  let r = await registry();
  if (r.dataSource !== "seed") throw new Error(`default dataSource ${r.dataSource}, expected seed`);
  await setSource("neynar");
  r = await registry();
  if (r.dataSource !== "neynar") throw new Error("switch to neynar did not take");
  await setSource("seed");
  r = await registry();
  if (r.dataSource !== "seed") throw new Error("switch back to seed did not take");
});

// ---- 2. SAFETY: flipping the source never touches persona/grant/mode state ----
await check("2. SAFETY: switching DATA_SOURCE never touches persona, grant, or mode state", async () => {
  await reset();
  const snap = async () => {
    const [personas, modes, grants] = await Promise.all([
      retry(() => api("GET", "/api/personas/act-as-options")),
      retry(() => api("GET", "/api/modes")),
      retry(() => api("GET", "/api/identity/grant")),
    ]);
    return JSON.stringify({
      personas: personas.json.options?.map((o) => o.id).sort(),
      activeMode: modes.json.activeId,
      modeIds: modes.json.modes?.map((m) => m.id).sort(),
      grants: grants.json.grants?.map((g) => g.id).sort(),
    });
  };
  const before = await snap();
  await setSource("neynar");
  await setSource("seed");
  const after = await snap();
  if (before !== after)
    throw new Error("persona/grant/mode state changed across a source flip — the switch is not isolated");
});

// ---- 3. forced 429s with an EMPTY cache: loud failure, never a silent blank ----
await check("3. Rate-limited with nothing cached: the live probe reports the failure loudly", async () => {
  await reset(); // clears the live cache + disarms knobs
  await setSource("neynar");
  await arm429(3); // exactly the backoff budget — consumed before any network call
  const probe = await liveProbe();
  if (probe.json.liveFetch !== "threw")
    throw new Error(`empty-cache rate limit: liveFetch=${probe.json.liveFetch}, expected threw`);
  if (!/rate limit/i.test(probe.json.error ?? ""))
    throw new Error(`error does not name the rate limit: "${probe.json.error}"`);
  await setSource("seed");
});

// ---- 4. degrade to cache: a warmed cache serves STALE, flagged, never blank ----
await check("4. Rate-limited with a warm cache: serves stale content, flagged stale, never blank", async () => {
  await setSource("neynar");
  // warm: ONE real read (network-classified as INFRA if absent)
  const warm = await retryContent(liveProbe, (r) => r.json.liveFetch === "ok", 3);
  if (warm.json.liveFetch !== "ok")
    throw new Error("INFRA: could not warm the live cache — " + (warm.json.error ?? "network unavailable"));
  if (warm.json.stale) throw new Error("fresh warm read reported stale");
  const count = warm.json.count;

  // age the cache past the fresh TTL (keeping the shelf stocked) — a warm
  // read followed immediately by a 429 just hits the fresh window and the
  // knob is never consulted (found on this suite's own first run)
  await retry(() => api("POST", "/api/dev", { action: "expireNeynarCache" }));
  await arm429(3);
  const stale = await liveProbe();
  if (stale.json.liveFetch !== "ok") throw new Error("warm-cache rate limit still threw — degrade path missing");
  if (!stale.json.stale) throw new Error("stale serve not FLAGGED stale — staleness laundered as fresh");
  if (stale.json.count !== count) throw new Error("stale serve returned different content than the cache");
  await setSource("seed");
});

// ---- 5. the stale flag reaches feed2 and the rendered page ----
await check("5. PAGE: stale live feed shows cards + the stale banner — degraded, visibly, never blank", async () => {
  await setSource("neynar");
  // warm the exact path feed2 uses (limit differs from the probe's, so warm via feed2 itself)
  const warmFeed = await retryContent(
    () => retry(() => api("GET", "/api/feed2?surface=discovery")),
    (r) => (r.json.cards ?? []).length > 0 && r.json.contentStale === false,
    3
  );
  if (warmFeed.json.contentStale !== false)
    throw new Error("INFRA: could not warm the live feed cache");

  await retry(() => api("POST", "/api/dev", { action: "expireNeynarCache" })); // same TTL reality as test 4
  await arm429(6); // cover the feed2 read's backoff budget with margin
  const staleFeed = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  if (!(staleFeed.json.cards ?? []).length) throw new Error("rate-limited feed came back BLANK");
  if (staleFeed.json.contentStale !== true) throw new Error("rate-limited feed not flagged contentStale");

  await retry(() => api("POST", "/api/dev", { action: "expireNeynarCache" }));
  await arm429(6);
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  const bannered = await pollUntil(
    async () => (await page.locator("[data-testid=stale-content-banner]").count()) > 0,
    { tries: 15, delayMs: 400 }
  );
  if (!bannered) throw new Error("stale-content banner absent from the rendered page");
  const cards = await page.locator("[data-testid=cast]").count();
  if (cards === 0) throw new Error("rendered page shows zero casts while degraded — blank feed");
  await setSource("seed");
});

// ---- 6. reset contract: resetSeed clears the override and the knobs ----
await check("6. resetSeed clears the source override and the 429 knob (knobs are knobs)", async () => {
  await setSource("neynar");
  await arm429(50);
  await reset();
  const r = await registry();
  if (r.dataSource !== "seed") throw new Error(`post-reset dataSource ${r.dataSource}, expected seed (env default)`);
  // the knob must be disarmed: a live probe now must NOT see synthetic 429s.
  // (source is seed post-reset, so the probe's failure would only come from
  // an armed knob — it fetches live regardless of the source switch.)
  const probe = await liveProbe();
  if (/forced/i.test(probe.json.error ?? ""))
    throw new Error("forced-429 knob survived resetSeed");
});

// ---- 7. writes stay dead: ENABLE_FC_WRITE unset means writeEnabled false ----
await check("7. SAFETY: writeEnabled is false in this environment (ENABLE_FC_WRITE unset — sweeps never write)", async () => {
  const probe = await liveProbe();
  if (probe.json.writeEnabled !== false)
    throw new Error("writeEnabled is not false — sweeps must never run with writes armed");
});

await reset();
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} FC Gate 2 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
