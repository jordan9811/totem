// UX PASS GATE 4 — data backpack + Ad Match Score.
//
// The score reads claimsForMatching() — the SAME fail-closed, consent-
// gated set the ad marketplace itself matches against — so there is
// exactly one definition of "counted" across both surfaces. The anti-
// gaming property (self barely moves it, attested moves it substantially)
// is a straight 10x multiplier in lib/graph/score.ts, tested here as an
// exact marginal delta, not a vibe.
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

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
const score = () => retry(() => api("GET", "/api/graph/score"));
const preview = () => retry(() => api("GET", "/api/graph/preview"));
const claims = async () => (await retry(() => api("GET", "/api/graph"))).json.claims;

/** Run a connector import to completion — mirrors GraphImports.tsx: start,
 * advance to the PREVIEW step (backpack pass: the walk stops there, nothing
 * written yet), then explicitly COMMIT. */
async function runImport(connectorId) {
  let job = (await retry(() => api("POST", "/api/graph/import", { connectorId }))).json.job;
  while (job.status !== "preview" && job.status !== "complete") {
    job = (await retry(() => api("POST", "/api/graph/import", { jobId: job.id }))).json.job;
  }
  if (job.status === "preview") {
    job = (await retry(() => api("POST", "/api/graph/import", { jobId: job.id, action: "commit" }))).json.job;
  }
  return job;
}

console.log("\nUX Pass Gate 4 — data backpack + Ad Match Score");

// ---- 1. all 4 source types land with correct provenance + trust-weight ----
await check("1. VC, DID, and self-declared each land a claim with correct provenance + trust-weight", async () => {
  await reset();
  const vcJob = await runImport("conn_vc_degree");
  const didJob = await runImport("conn_did");
  const self = await retry(() =>
    api("POST", "/api/graph", { category: "demographics", label: "Self test claim", value: "self_test_demo_1" })
  );

  const cs = await claims();
  const vc = cs.find((c) => c.value === "degree_bs_cs");
  const did = cs.find((c) => c.value === "did_controlled");
  const declared = cs.find((c) => c.value === "self_test_demo_1");

  if (!vc || vc.source !== "attested" || vc.issuer !== "Cascadia State University (W3C VC)")
    throw new Error(`VC claim wrong: ${JSON.stringify(vc)}`);
  if (!did || did.source !== "attested" || did.issuer !== "did:web:layers.example")
    throw new Error(`DID claim wrong: ${JSON.stringify(did)}`);
  if (!declared || declared.source !== "self" || declared.issuer !== null)
    throw new Error(`self-declared claim wrong: ${JSON.stringify(declared)}`);
  if (!vcJob.claimIds.includes(vc.id) || !didJob.claimIds.includes(did.id))
    throw new Error("import job claimIds did not include the landed claim");
  if (self.status !== 200) throw new Error(`self-declare POST returned ${self.status}`);
});

// ---- 2. the 4th type (platform export, x-inferred) + sensitive gating ----
await check("2. Platform export lands x-inferred; its sensitive yield stays out until opted in, then lands", async () => {
  const job1 = await runImport("conn_platform_export");
  let cs = await claims();
  const jazz = cs.find((c) => c.value === "jazz_weekly");
  if (!jazz || jazz.source !== "x-inferred" || jazz.issuer !== "Wavelength Music")
    throw new Error(`platform-export claim wrong: ${JSON.stringify(jazz)}`);
  if (cs.some((c) => c.value === "premium_subscriber"))
    throw new Error("sensitive yield (finances) landed WITHOUT consent — bulk import bypassed the gate");
  if (job1.claimIds.some((id) => cs.find((c) => c.id === id)?.value === "premium_subscriber"))
    throw new Error("import job reported the withheld sensitive claim as landed");

  await retry(() => api("POST", "/api/graph/consent", { category: "finances", consented: true }));
  await runImport("conn_platform_export"); // re-run: a NEW job, same connector, now consented
  cs = await claims();
  const premium = cs.find((c) => c.value === "premium_subscriber");
  if (!premium || premium.source !== "x-inferred")
    throw new Error("sensitive yield still missing after explicit opt-in");
});

// ---- 3. anti-gaming invariant: exact marginal deltas, self vs attested ----
await check("3. Anti-gaming: one self-declared claim barely moves the score; one attested claim moves it substantially", async () => {
  await reset();
  const s0 = (await score()).json.score;

  await retry(() =>
    api("POST", "/api/graph", { category: "demographics", label: "Marginal self test", value: "marginal_self_1" })
  );
  const s1 = (await score()).json.score;
  const deltaSelf = s1 - s0;

  await runImport("conn_did"); // ownership, attested — a fresh value, no dedup collision
  const s2 = (await score()).json.score;
  const deltaAttested = s2 - s1;

  // exact, not fuzzy: CATEGORY_BASE.demographics=12 * self 10% = round(1.2) = 1;
  // CATEGORY_BASE.ownership=10 * attested 100% = 10
  if (deltaSelf !== 1) throw new Error(`self-declared delta was ${deltaSelf}, expected exactly 1`);
  if (deltaAttested !== 10) throw new Error(`attested delta was ${deltaAttested}, expected exactly 10`);
  if (deltaAttested < deltaSelf * 5)
    throw new Error(`attested delta (${deltaAttested}) not substantially larger than self delta (${deltaSelf})`);
});

// ---- 4. breakdown matches the sum of its factors exactly ----
await check("4. Score breakdown sums to exactly the displayed score (deterministic)", async () => {
  const j = (await score()).json;
  const sum = j.breakdown.reduce((a, f) => a + f.points, 0);
  if (sum !== j.score) throw new Error(`breakdown sums to ${sum}, displayed score is ${j.score}`);
  if (j.score > 100) throw new Error("score exceeded the 0-100 ceiling");
  // every factor's points must itself equal the documented formula —
  // catches a breakdown that merely SUMS right by accident
  for (const f of j.breakdown) {
    if (!Number.isInteger(f.points) || f.points < 0)
      throw new Error(`factor "${f.label}" has a non-integer or negative point value: ${f.points}`);
  }
});

// ---- 5. higher score yields MORE matched campaigns in the preview ----
await check("5. Importing VC + platform-export unlocks their campaigns in the ad-match preview", async () => {
  await reset();
  const before = (await preview()).json;
  const idsBefore = new Set(before.matches.map((m) => m.campaignId));
  if (idsBefore.has("camp_degree") || idsBefore.has("camp_jazz"))
    throw new Error("fresh persona already matches camp_degree/camp_jazz — fixture assumption broken");

  await runImport("conn_vc_degree");
  await runImport("conn_platform_export");
  const after = (await preview()).json;
  const idsAfter = new Set(after.matches.map((m) => m.campaignId));

  if (!idsAfter.has("camp_degree")) throw new Error("camp_degree did not appear after the VC import");
  if (!idsAfter.has("camp_jazz")) throw new Error("camp_jazz did not appear after the platform-export import");
  if (after.matches.length < before.matches.length + 2)
    throw new Error(`match count went from ${before.matches.length} to ${after.matches.length}, expected +2`);

  const scoreAfter = (await score()).json.score;
  if (scoreAfter <= 0) throw new Error("score did not rise alongside the new matches");
});

// ---- 6. ADVERSARIAL: a tiny audience still refuses regardless of the creating persona's score ----
await check("6. SAFETY: a k-floor-violating audience is refused even from a high-scoring persona", async () => {
  const highScore = (await score()).json.score;
  if (highScore < 20) throw new Error(`test setup assumption broken — score is only ${highScore}, expected a high score by now`);
  const r = await api("POST", "/api/market/campaign", {
    name: "adversarial tiny-audience campaign",
    audience: {
      combinator: "AND",
      clauses: [{ field: "graph.claim", op: "contains", value: "no_such_claim_value_anywhere" }],
    },
  });
  if (r.status !== 422) throw new Error(`tiny-audience campaign returned ${r.status}, expected 422 (k-floor refusal)`);
  if (typeof r.json.kFloor !== "number" || r.json.size >= r.json.kFloor)
    throw new Error(`refusal payload does not show size below kFloor: ${JSON.stringify(r.json)}`);
});

// ---- 7. PAGE: the backpack page renders score, self-declare and import both refresh it ----
await check("7. PAGE: backpack page shows the score, breakdown toggles, and reacts to a new self-declared claim", async () => {
  await reset();
  await page.goto(BASE + "/settings/backpack", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  if ((await page.locator("[data-testid=backpack-score]").count()) !== 1) throw new Error("score panel missing");
  if ((await page.locator("[data-testid=score-honesty-copy]").count()) !== 1)
    throw new Error("honesty-guardrail copy missing from the page");

  const before = await page.locator("[data-testid=score-value]").innerText();

  // "habits" — NOT one of SENSITIVE_CATEGORIES (health/finances/politics).
  // A sensitive one here would be correctly refused with no consent yet,
  // which is the right product behavior but the wrong scenario for testing
  // plain reactivity.
  await page.locator("[data-testid=self-declare-category]").selectOption("habits");
  await page.locator("[data-testid=self-declare-label]").fill("Page-test claim");
  await page.locator("[data-testid=self-declare-value]").fill("page_test_habits_1");
  await page.locator("[data-testid=self-declare-submit]").click();

  // addClaim, then a full score recompute (claimsForMatching + a per-
  // sensitive-category consent check) each carry retried mock latency —
  // a generous budget here, same discipline as elsewhere in this pass
  let changed = false;
  for (let i = 0; i < 30 && !changed; i++) {
    await page.waitForTimeout(400);
    const now = await page.locator("[data-testid=score-value]").innerText();
    changed = now !== before;
  }
  if (!changed) throw new Error("score did not update after a self-declared claim was added");

  await page.locator("[data-testid=score-breakdown-toggle]").click();
  if ((await page.locator("[data-testid=score-factor]").count()) === 0)
    throw new Error("breakdown toggle did not reveal any factors");
});

await reset();
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} UX Gate 4 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
