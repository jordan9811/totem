// BACKPACK PASS — data backpack import + Ad Match Score, the gaps the UX
// pass left and the crypto pass's vault created. FIXTURE-SAFE: never posts,
// never spends. Covers what accept-ux4 did NOT: the preview-before-commit
// gate (preview matches what lands exactly), per-claim provenance/method,
// suggestion ranking + consent exclusion, the sum-to-rawTotal cap invariant,
// and backpack claims as ciphertext at rest.
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;

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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1600 } })).newPage();

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
  await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
  await page.waitForTimeout(400);
};
const claims = async () => (await retry(() => api("GET", "/api/graph"))).json.claims;
const score = () => retry(() => api("GET", "/api/graph/score"));

/** Walk an import to its PREVIEW step (does NOT commit). */
async function walkToPreview(connectorId) {
  let job = (await retry(() => api("POST", "/api/graph/import", { connectorId }))).json.job;
  while (job.status !== "preview" && job.status !== "complete") {
    job = (await retry(() => api("POST", "/api/graph/import", { jobId: job.id }))).json.job;
  }
  return job;
}
const commit = (jobId) => retry(() => api("POST", "/api/graph/import", { jobId, action: "commit" }));

console.log("\nBackpack pass — import preview, provenance, score cap, suggestions, vault-at-rest");

// ---- 1. preview-before-commit: nothing lands until confirmed, and the
//         preview matches what lands EXACTLY ----
await check("1. Import previews before committing; nothing is written until commit; preview matches what lands", async () => {
  await reset();
  const before = (await claims()).length;
  const job = await walkToPreview("conn_vc_degree");
  if (job.status !== "preview") throw new Error(`walk did not land on preview: ${job.status}`);
  if (!Array.isArray(job.preview) || job.preview.length === 0) throw new Error("preview is empty");
  // NOTHING written yet
  if ((await claims()).length !== before)
    throw new Error("a claim was written at preview time — the commit gate is bypassed");
  const previewValues = job.preview.filter((p) => !p.withheld).map((p) => p.value).sort();
  // the preview names tier + method + issuer, not a flat list
  const vc = job.preview.find((p) => p.value === "degree_bs_cs");
  if (!vc || vc.source !== "attested" || vc.method !== "w3c-vc" || !vc.issuer.includes("Cascadia"))
    throw new Error(`preview item lacks correct provenance: ${JSON.stringify(vc)}`);

  const done = (await commit(job.id)).json.job;
  if (done.status !== "complete") throw new Error(`commit did not complete: ${done.status}`);
  const cs = await claims();
  const landedValues = done.claimIds.map((id) => cs.find((c) => c.id === id)?.value).sort();
  if (JSON.stringify(landedValues) !== JSON.stringify(previewValues))
    throw new Error(`preview ${JSON.stringify(previewValues)} != landed ${JSON.stringify(landedValues)}`);
});

// ---- 2. SAFETY: a sensitive yield is shown withheld in the preview, NOT
//         written on commit, and appears nowhere until opted in ----
await check("2. SAFETY: a sensitive import yield is withheld until opted in — preview shows it held, commit never writes it", async () => {
  await reset();
  const job = await walkToPreview("conn_platform_export"); // yields interests:jazz + finances:premium (sensitive)
  const premium = job.preview.find((p) => p.value === "premium_subscriber");
  if (!premium) throw new Error("preview omitted the sensitive yield entirely (should show it, held)");
  if (premium.sensitive !== true || premium.withheld !== true)
    throw new Error(`sensitive yield not marked withheld in preview: ${JSON.stringify(premium)}`);

  const done = (await commit(job.id)).json.job;
  let cs = await claims();
  if (cs.some((c) => c.value === "premium_subscriber"))
    throw new Error("ADVERSARIAL: sensitive claim landed WITHOUT consent — import bypassed the gate");
  if (done.claimIds.some((id) => cs.find((c) => c.id === id)?.value === "premium_subscriber"))
    throw new Error("commit reported the withheld sensitive claim as written");
  // it must appear NOWHERE (not in claims, not in the score breakdown)
  const sc = await score();
  if ((sc.json.breakdown ?? []).some((f) => f.label.includes("Premium subscriber")))
    throw new Error("the un-opted sensitive claim surfaced in the score breakdown");

  // opt in → re-import → now it lands
  await retry(() => api("POST", "/api/graph/consent", { category: "finances", consented: true }));
  const job2 = await walkToPreview("conn_platform_export");
  const premium2 = job2.preview.find((p) => p.value === "premium_subscriber");
  if (premium2.withheld !== false) throw new Error("after opt-in, preview still marks the yield withheld");
  await commit(job2.id);
  cs = await claims();
  if (!cs.some((c) => c.value === "premium_subscriber"))
    throw new Error("sensitive yield still missing after explicit opt-in");
});

// ---- 3. per-claim provenance: method + issuer inspectable, tiers distinct ----
await check("3. Per-claim provenance is inspectable — method + issuer per claim, tiers distinct (not a flat list)", async () => {
  await reset();
  await commit((await walkToPreview("conn_vc_degree")).id);
  await commit((await walkToPreview("conn_did")).id);
  await retry(() => api("POST", "/api/graph", { category: "interests", label: "Likes hiking", value: "bp_hiking_1" }));

  const cs = await claims();
  const vc = cs.find((c) => c.value === "degree_bs_cs");
  const did = cs.find((c) => c.value === "did_controlled");
  const self = cs.find((c) => c.value === "bp_hiking_1");
  if (vc?.method !== "w3c-vc") throw new Error(`VC method wrong: ${vc?.method}`);
  if (did?.method !== "did-control") throw new Error(`DID method wrong: ${did?.method}`);
  if (self?.method !== "self-declared") throw new Error(`self method wrong: ${self?.method}`);
  if (vc.source !== "attested" || self.source !== "self")
    throw new Error("trust tiers not distinct across provenance methods");

  // the PAGE renders the provenance inspector with per-claim tier + method
  await page.goto(BASE + "/settings/backpack", { waitUntil: "networkidle" });
  const rendered = await (async () => {
    for (let i = 0; i < 20; i++) {
      const rows = await page.locator("[data-testid=provenance-claim]").count();
      if (rows >= 3) return true;
      await page.waitForTimeout(400);
    }
    return false;
  })();
  if (!rendered) throw new Error("provenance inspector did not render the claims");
  const didRow = page.locator('[data-testid=provenance-claim][data-claim-id="' + did.id + '"]');
  if ((await didRow.getAttribute("data-method")) !== "did-control")
    throw new Error("provenance row missing the DID method");
  if ((await didRow.getAttribute("data-tier")) !== "attested")
    throw new Error("provenance row missing the attested tier");
});

// ---- 4. Ad Match Score anti-gaming with explicit thresholds ----
await check("4. Anti-gaming: a self-declared claim barely moves the score; an equivalent attested claim moves it substantially", async () => {
  await reset();
  const base = (await score()).json.rawTotal;
  await retry(() => api("POST", "/api/graph", { category: "ownership", label: "Owns a bike", value: "bp_bike_self" }));
  const afterSelf = (await score()).json.rawTotal;
  const selfDelta = afterSelf - base;

  await reset();
  const base2 = (await score()).json.rawTotal;
  await commit((await walkToPreview("conn_did")).id); // did_controlled: ownership, attested
  const afterAttested = (await score()).json.rawTotal;
  const attestedDelta = afterAttested - base2;

  // same category (ownership, base 10): self = 10% = 1, attested = 100% = 10.
  if (selfDelta > 2) throw new Error(`self-declared moved the score by ${selfDelta} (threshold: <2)`);
  if (attestedDelta < 8) throw new Error(`attested moved the score by only ${attestedDelta} (threshold: >8)`);
  if (attestedDelta - selfDelta < 6) throw new Error(`self/attested gap too small: ${selfDelta} vs ${attestedDelta}`);
});

// ---- 5. breakdown sums to rawTotal EXACTLY; score caps at 100, disclosed ----
await check("5. Breakdown sums to rawTotal exactly; score = min(100, rawTotal); the cap is real and disclosed", async () => {
  await reset();
  // normal regime: sum == rawTotal == score (all below the cap)
  let sc = (await score()).json;
  let sum = sc.breakdown.reduce((a, f) => a + f.points, 0);
  if (sum !== sc.rawTotal) throw new Error(`breakdown sums to ${sum}, rawTotal is ${sc.rawTotal}`);
  if (sc.score !== Math.min(100, sc.rawTotal)) throw new Error("score is not min(100, rawTotal)");

  // drive rawTotal past 100: opt into sensitive cats + import every connector
  await retry(() => api("POST", "/api/graph/consent", { category: "health", consented: true }));
  await retry(() => api("POST", "/api/graph/consent", { category: "finances", consented: true }));
  for (const c of ["conn_card", "conn_wearable", "conn_watch", "conn_vc_degree", "conn_did", "conn_platform_export"]) {
    await commit((await walkToPreview(c)).id);
  }
  sc = (await score()).json;
  sum = sc.breakdown.reduce((a, f) => a + f.points, 0);
  if (sum !== sc.rawTotal) throw new Error(`above cap: breakdown sums to ${sum}, rawTotal is ${sc.rawTotal}`);
  if (sc.rawTotal <= 100) throw new Error(`could not drive rawTotal above 100 (got ${sc.rawTotal}) — test is vacuous`);
  if (sc.score !== 100) throw new Error(`score should cap at 100, got ${sc.score}`);
  // the UI discloses the cap — inside the breakdown, so open it first
  await page.goto(BASE + "/settings/backpack", { waitUntil: "networkidle" });
  await page.locator("[data-testid=score-value]").waitFor({ timeout: 10000 });
  if ((await page.locator("[data-testid=score-value]").innerText()).replace("/100", "").trim() !== "100")
    throw new Error("the score surface does not show the capped 100 value");
  await page.locator("[data-testid=score-breakdown-toggle]").click();
  const sumRow = await page.locator("[data-testid=score-breakdown-sum]").innerText();
  if (!/capped at 100/i.test(sumRow))
    throw new Error(`the 100 cap is not disclosed in the breakdown sum row: "${sumRow}"`);
});

// ---- 6. suggestions rank by delta and never surface an un-opted sensitive category ----
await check("6. Suggestions rank by delta and never suggest an un-opted sensitive category; opting in grows the delta", async () => {
  await reset();
  let sc = (await score()).json;
  const deltas = sc.suggestions.map((s) => s.delta);
  for (let i = 1; i < deltas.length; i++)
    if (deltas[i] > deltas[i - 1]) throw new Error(`suggestions not sorted by delta desc: ${JSON.stringify(deltas)}`);

  // finances OFF: the platform-export connector's suggested delta must NOT
  // credit the sensitive premium_subscriber yield
  const platformBefore = sc.suggestions.find((s) => s.connectorId === "conn_platform_export");
  // a wholly-sensitive connector (wearable = health) must be absent while un-consented
  if (sc.suggestions.some((s) => s.connectorId === "conn_wearable"))
    throw new Error("a wholly-sensitive connector was suggested while un-consented");

  await retry(() => api("POST", "/api/graph/consent", { category: "finances", consented: true }));
  sc = (await score()).json;
  const platformAfter = sc.suggestions.find((s) => s.connectorId === "conn_platform_export");
  if (!platformBefore || !platformAfter) throw new Error("platform-export connector missing from suggestions");
  if (platformAfter.delta <= platformBefore.delta)
    throw new Error(`opting into finances did not grow the delta: ${platformBefore.delta} -> ${platformAfter.delta}`);
});

// ---- 7. SAFETY: score does not bypass the audience floor ----
await check("7. SAFETY: a high-score profile still cannot bypass the audience k-floor (tiny audience refuses)", async () => {
  await reset();
  // build up the score
  await retry(() => api("POST", "/api/graph/consent", { category: "finances", consented: true }));
  for (const c of ["conn_card", "conn_vc_degree", "conn_did", "conn_platform_export"]) {
    await commit((await walkToPreview(c)).id);
  }
  const sc = (await score()).json;
  if (sc.score < 20) throw new Error(`score too low to make the test meaningful: ${sc.score}`);
  // an impossibly narrow audience must still be refused regardless of score
  const tiny = await api("POST", "/api/market/campaign", {
    name: "Tiny audience probe",
    audience: {
      combinator: "AND",
      clauses: [{ field: "graph.claim", op: "contains", value: "no_such_claim_value_anywhere" }],
    },
  });
  if (tiny.status !== 422)
    throw new Error(`tiny-audience campaign returned ${tiny.status}, expected 422 (k-floor refusal)`);
  if (typeof tiny.json.kFloor !== "number" || tiny.json.size >= tiny.json.kFloor)
    throw new Error(`refusal payload does not show size below kFloor: ${JSON.stringify(tiny.json)}`);
});

// ---- 8. SAFETY: imported backpack claims are CIPHERTEXT at rest ----
await check("8. SAFETY: an imported backpack claim is ciphertext on the validator, never plaintext", async () => {
  await reset();
  await commit((await walkToPreview("conn_did")).id); // writes did_controlled to graphClaims
  const res = await fetch(`${VBASE}/state/graphClaims`, { cache: "no-store" });
  const text = await res.text();
  if (text.includes("Controls a verifiable DID") || text.includes("did:web:layers.example"))
    throw new Error("a backpack claim's label/issuer is PLAINTEXT on the validator");
  const entries = JSON.parse(text).entries ?? {};
  const recs = Object.values(entries);
  if (recs.length === 0) throw new Error("no graphClaims records at rest — nothing to check (import did not flush)");
  if (!recs.every((r) => r && r.v === 1 && typeof r.ct === "string"))
    throw new Error("a graphClaims record is not vault ciphertext");
  // and our client still reads it back decrypted
  if (!(await claims()).some((c) => c.value === "did_controlled"))
    throw new Error("the vaulted backpack claim is not readable by our own client");
});

await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(
  `\n${results.length - fails.length - infra.length}/${results.length} Backpack checks passed` +
    (fails.length ? `, ${fails.length} FAILED` : "") +
    (infra.length ? `, ${infra.length} infra` : "")
);
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
