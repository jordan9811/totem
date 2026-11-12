// CALL OPTION A — X alt linking. Experimental, disclaimed, fixture-only.
//
// Modeled as ONE persona's regular attested X handle plus a separately
// linked "alt handle" (a second account the same person also controls) —
// not two Totem personas, since the viewer's fixture roster has exactly
// one public persona and the other is correctly barred from any external
// attestation (a private persona linking to a public X handle is the
// exact linkage leak that rule exists to prevent elsewhere in this app).
//
// The real disclosure is the in-app grant (issued through the SAME
// adapters.identity.issueGrant every other disclosure feature uses); the
// synchronized like is a soft, deniable secondary signal on X, scheduled
// with a randomized non-zero delay specifically so identical timing never
// reads as coordinated/inauthentic to X's own systems.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const MAIN = id("yeak__"); // public, SEED_VIEWER's active persona — the only one eligible
const OTHER = id("gwei_whisperer"); // an audience member to disclose to

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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1500 } })).newPage();

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
const switchTo = (pid) => retry(() => api("POST", "/api/seed-persona", { personaId: pid }));
const link = (fixtureHandle) => retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle }));
const altlink = () => retry(() => api("GET", "/api/x/altlink"));
const linkAlt = (handle) => api("POST", "/api/x/altlink", { action: "linkAlt", handle });
const run = (body) => api("POST", "/api/x/altlink", { action: "run", ...body });

console.log("\nCall Option A — X alt linking");

// ---- setup: MAIN links its primary X handle ----
await check("SETUP: the viewer's persona links its primary X handle", async () => {
  await reset();
  await switchTo(MAIN);
  await link("main_primary_handle");
  const j = (await altlink()).json;
  if (!j.status || j.status.primaryHandle !== "main_primary_handle")
    throw new Error(`status after primary link: ${JSON.stringify(j.status)}`);
});

// ---- 1. an alt handle must be linked before it can be used ----
await check("1. Refuses a run against an alt handle that was never linked", async () => {
  const r = await run({ altHandle: "never_linked_handle", targetPostId: "post_1", audienceMember: "gwei_whisperer" });
  if (r.status !== 403) throw new Error(`unlinked alt-handle run returned ${r.status}, expected 403`);
  if (r.json.reason !== "no_alt_handle") throw new Error(`refusal reason "${r.json.reason}", expected "no_alt_handle"`);
});

// ---- 2. link an alt handle; can't relink the primary as its own alt ----
await check("2. Links a real alt handle; refuses linking the persona's own primary handle as an 'alt'", async () => {
  const dupe = await linkAlt("main_primary_handle");
  if (dupe.status >= 200 && dupe.status < 300)
    throw new Error("linking the primary handle as its own alt was accepted");

  // settle transient adapter failures before asserting (success-path call was unretried)
  const good = await retryContent(() => linkAlt("main_side_handle"), (x) => x.status === 200, 4);
  if (good.status !== 200) throw new Error(`linking a real alt handle returned ${good.status}`);
  if (!good.json.altHandles.includes("main_side_handle"))
    throw new Error(`altHandles after link: ${JSON.stringify(good.json.altHandles)}`);
});

// ---- 3. disclaimer required before first use ----
await check("3. Disclaimer required before first use: a run is refused (412) until acknowledged", async () => {
  const before = (await altlink()).json;
  if (before.disclaimerAcked) throw new Error("fresh persona already shows disclaimerAcked=true");

  const blocked = await run({ altHandle: "main_side_handle", targetPostId: "post_1", audienceMember: "gwei_whisperer" });
  if (blocked.status !== 412) throw new Error(`unacknowledged run returned ${blocked.status}, expected 412`);
  if (blocked.json.reason !== "disclaimer_required")
    throw new Error(`refusal reason "${blocked.json.reason}", expected "disclaimer_required"`);

  await retry(() => api("POST", "/api/x/altlink", { action: "ackDisclaimer" }));
  const after = (await altlink()).json;
  if (!after.disclaimerAcked) throw new Error("ackDisclaimer did not persist");
});

// ---- 4. success: real in-app grant issued + two likes scheduled with a randomized non-zero delay ----
await check("4. A successful run issues the real disclosure grant and schedules two likes, delay in [3000,12000) and never 0", async () => {
  const r = await retry(() =>
    run({ altHandle: "main_side_handle", targetPostId: "post_target_1", audienceMember: "gwei_whisperer" })
  );
  const { attempt, grant } = r.json;
  if (!grant?.id) throw new Error("no grant in the response — the real disclosure did not land");
  if (attempt.delayMs < 3000 || attempt.delayMs >= 12000)
    throw new Error(`delayMs ${attempt.delayMs} out of the 3-12s range`);
  if (attempt.delayMs === 0) throw new Error("delay was exactly 0 — indistinguishable from a simultaneous like");
  const actualGap = attempt.likedAt[1] - attempt.likedAt[0];
  if (actualGap !== attempt.delayMs) throw new Error(`recorded like gap (${actualGap}) != delayMs (${attempt.delayMs})`);
  if (attempt.handleA !== "main_primary_handle" || attempt.handleB !== "main_side_handle")
    throw new Error(`attempt handles wrong: ${attempt.handleA} / ${attempt.handleB}`);

  // the grant is REAL, not just echoed back — read it from the identity
  // surface every other disclosure feature in this app already uses
  // settle until the just-issued grant is visible before asserting (per-item drop tolerance)
  const grants = (await retryContent(() => api("GET", `/api/identity/grant?personaId=${MAIN}`), (r) => r.json.grants.some((g) => g.id === grant.id), 4)).json.grants;
  const landed = grants.find((g) => g.id === grant.id);
  if (!landed) throw new Error("grant does not appear in the persona's own grant list");
  if (landed.fromPersona !== MAIN || landed.toPersona !== MAIN || landed.audienceMember !== OTHER)
    throw new Error(`grant shape wrong: ${JSON.stringify(landed)}`);
});

// ---- 5. rate limit: refuses over-frequency, atomically (no partial grant/attempt on refusal) ----
await check("5. SAFETY: the daily cap refuses an over-frequency attempt; refusal issues nothing", async () => {
  // one run already landed in test 4 — two more should still succeed
  await retry(() => run({ altHandle: "main_side_handle", targetPostId: "post_target_2", audienceMember: "gwei_whisperer" }));
  await retry(() => run({ altHandle: "main_side_handle", targetPostId: "post_target_3", audienceMember: "gwei_whisperer" }));
  // settle multi-item reads before the exact-count assertion (per-item drop tolerance)
  const before = (await retryContent(() => api("GET", "/api/x/altlink"), (r) => r.json.recentAttempts.length === 3, 4)).json;
  if (before.recentAttempts.length !== 3) throw new Error(`expected 3 attempts today, found ${before.recentAttempts.length}`);
  const grantIdsBefore = new Set((await retryContent(() => api("GET", `/api/identity/grant?personaId=${MAIN}`), (r) => Array.isArray(r.json.grants), 4)).json.grants.map((g) => g.id));

  const refused = await run({ altHandle: "main_side_handle", targetPostId: "post_target_4", audienceMember: "gwei_whisperer" });
  if (refused.status !== 429) throw new Error(`4th run returned ${refused.status}, expected 429`);
  if (refused.json.reason !== "rate_limited") throw new Error(`refusal reason "${refused.json.reason}", expected "rate_limited"`);

  const after = (await retryContent(() => api("GET", "/api/x/altlink"), (r) => r.json.recentAttempts.length === 3, 4)).json;
  if (after.recentAttempts.length !== 3) throw new Error("a refused run still recorded a new attempt");
  // settle until the after-read contains every before-grant id, then compare sets, not raw lengths of two flaky reads
  const grantsAfter = (await retryContent(() => api("GET", `/api/identity/grant?personaId=${MAIN}`), (r) => [...grantIdsBefore].every((gid) => r.json.grants.some((g) => g.id === gid)), 4)).json.grants;
  if (grantsAfter.length !== grantIdsBefore.size) throw new Error("a refused run still issued a grant");
});

// ---- 6. never a batch: a non-scalar altHandle doesn't fan out into multiple attempts ----
await check("6. Never a batch: a non-scalar altHandle is refused, not silently expanded", async () => {
  const r = await run({ altHandle: ["main_side_handle", "x"], targetPostId: "post_batch", audienceMember: "gwei_whisperer" });
  if (r.status >= 200 && r.status < 300) throw new Error("an array altHandle was accepted instead of refused");
});

// ---- 7. fixture mode never touches real X ----
await check("7. Fixture mode: no real X credentials configured, so nothing here can hit real X", async () => {
  if (process.env.X_API_CLIENT_ID) throw new Error("X_API_CLIENT_ID is set — this run is not fixture-mode-only");
});

// ---- 8. PAGE: the disclaimer is a true modal (one button, no dismiss) before first use; flow completes ----
await check("8. PAGE: non-dismissable disclaimer (single button, no close control) blocks the flow until acknowledged", async () => {
  await reset();
  await switchTo(MAIN);
  await link("page_test_primary");
  await retry(() => linkAlt("page_test_alt"));

  await page.goto(BASE + "/settings/experimental", { waitUntil: "networkidle" });
  // poll for the modal instead of a fixed wait; no reload — the modal renders client-side post-hydration
  const modal = page.locator("[data-testid=alt-link-disclaimer]");
  await pollUntil(async () => (await modal.count()) === 1, { tries: 15, delayMs: 400 });
  if ((await modal.count()) !== 1) throw new Error("disclaimer modal did not appear for a fresh persona");
  const buttons = await modal.locator("button").count();
  if (buttons !== 1) throw new Error(`disclaimer modal has ${buttons} buttons, expected exactly 1 (no dismiss)`);

  await page.locator("[data-testid=alt-link-disclaimer-ack]").click();
  // poll for modal close instead of a fixed wait; no reload — client-side modal state is what's under test
  await pollUntil(async () => (await page.locator("[data-testid=alt-link-disclaimer]").count()) === 0, { tries: 15, delayMs: 400 });
  if ((await page.locator("[data-testid=alt-link-disclaimer]").count()) !== 0)
    throw new Error("disclaimer still showing after acknowledgment");

  await page.selectOption("[data-testid=alt-link-alt-handle]", "page_test_alt");
  await page.locator("[data-testid=alt-link-target]").fill("page_post_1");
  await page.locator("[data-testid=alt-link-audience]").fill("gwei_whisperer");
  await page.locator("[data-testid=alt-link-run]").click();

  let done = false;
  for (let i = 0; i < 15 && !done; i++) {
    await page.waitForTimeout(400);
    done = (await page.locator("[data-testid=alt-link-result]").count()) > 0;
  }
  if (!done) throw new Error("alt-link run never completed via the page");
});

await reset();
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Call Option A checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
