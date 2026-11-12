// TIER A GATE 2 — portable algorithms.
//
// Test 3 is the safety test: a deliberately hostile artifact attempting all
// four guardrailed surfaces. Per the pass's plateau rule it is part of the
// safety set — three consecutive failures halt the pass.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
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
  let text = "";
  try {
    text = await res.text();
    json = JSON.parse(text);
  } catch {}
  return { status: res.status(), json, text };
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
const feedHashes = async () => {
  const r = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  return r.json.cards.filter((c) => c.kind === "post" && !c.private).map((c) => c.cast.hash);
};
// settled read: feed2 fans out per-card, so a 200 can be missing items — accept only two consecutive identical reads
const settledFeedHashes = () => {
  let prev;
  return retryContent(
    feedHashes,
    (hs) => {
      const cur = JSON.stringify(hs);
      const same = prev === cur;
      prev = cur;
      return same;
    },
    6
  );
};

console.log("\nTier A Gate 2 — Portable algorithms");

// ---- 1. export -> import round-trip preserves behaviour exactly ----
await check("1. Export→import round-trip: identical feed under original and imported copy", async () => {
  await reset();
  // export the Curate preset (rules + flags, a real algorithm)
  const modes = await retry(() => api("GET", "/api/modes"));
  const curate = modes.json.modes.find((m) => m.name === "Curate");
  if (!curate) throw new Error("Curate preset missing");
  await retry(() => api("POST", "/api/modes/active", { modeId: curate.id }));
  const original = await settledFeedHashes(); // settled: guard against per-item drops before the exact comparison

  const exp = await retry(() => api("POST", "/api/algo/export", { modeId: curate.id }));
  const artifact = exp.json.artifact;
  if (!artifact?.signature) throw new Error("export produced no signed artifact");

  const imp = await retry(() => api("POST", "/api/algo/import", { artifact, activate: true }));
  if (!imp.json.mode?.id) throw new Error("import created no mode");
  if (imp.json.mode.importedFrom?.modifiedLocally !== false)
    throw new Error("fresh import already marked modified");

  const roundTrip = await settledFeedHashes(); // settled: guard against per-item drops before the exact comparison
  if (JSON.stringify(original) !== JSON.stringify(roundTrip))
    throw new Error(
      `round-trip feed differs: ${original.length} vs ${roundTrip.length} posts, first diff at ${original.findIndex((h, i) => roundTrip[i] !== h)}`
    );
});

// ---- 2. preview counts match post-activation reality exactly ----
await check("2. Preview counts equal post-activation reality exactly", async () => {
  await reset();
  const card = (await retry(() => api("GET", "/api/algo"))).json.cards.find(
    (c) => c.artifact.name === "Calm Signal"
  );
  if (!card) throw new Error("seeded Calm Signal card missing");

  const before = await settledFeedHashes(); // settled: exact-count comparison needs a complete read
  const prev = await retry(() => api("POST", "/api/algo/preview", { artifact: card.artifact }));
  const { hides, total, samples } = prev.json.preview;
  if (total !== before.length)
    throw new Error(`preview total ${total} != current feed ${before.length}`);

  await retry(() => api("POST", "/api/algo/import", { artifact: card.artifact, activate: true }));
  const after = new Set(await settledFeedHashes()); // settled: exact-count comparison needs a complete read
  const actuallyHidden = before.filter((h) => !after.has(h));
  if (actuallyHidden.length !== hides)
    throw new Error(`preview said hides=${hides}, activation hid ${actuallyHidden.length}`);
  for (const s of samples) {
    if (after.has(s.hash)) throw new Error(`sample ${s.hash} was previewed as hidden but still renders`);
  }
});

// ---- 3. THE HOSTILE ARTIFACT — all four guardrails, one import ----
await check("3. Hostile artifact: all four guardrails hold and the refusal is named", async () => {
  await reset();
  const hostile = {
    schemaVersion: 1,
    name: "Totally Normal Algo",
    summary: "nothing to see here",
    authorPersonaId: id("drivethru_dave"),
    authorHandle: "drivethru_dave",
    algoVersion: 1,
    ranking: { recency: 0.25, engagement: 0.25, authorAffinity: 0.25, clusterAffinity: 0.25 },
    rules: [
      // (3) reach into the disclosure/grant layer
      { name: "leak linkages", action: "hide", root: { combinator: "AND", clauses: [{ field: "identity.linked", op: "eq", value: true }] } },
      // (2) suppress correction cards
      { name: "no corrections", action: "hide", root: { combinator: "AND", clauses: [{ field: "card.correction", op: "eq", value: true }] } },
    ],
    modeFlags: {
      // (1) disable the composer destination indicator
      hideAudienceLine: true,
      // (4) touch the k-floor
      kFloorOverride: 0,
      calmRanking: true,
    },
    signature: "forged",
  };

  const imp = await api("POST", "/api/algo/import", { artifact: hostile, activate: true });
  if (imp.status === 200) throw new Error("hostile artifact imported successfully — guardrails absent");
  const v = JSON.stringify(imp.json.violations ?? []);
  if (!/disclosure\/grant/.test(v)) throw new Error("disclosure attack not named in refusal");
  if (!/correction/.test(v)) throw new Error("correction attack not named in refusal");
  if (!/hideAudienceLine/.test(v)) throw new Error("composer attack not named in refusal");
  if (!/kFloorOverride/.test(v)) throw new Error("k-floor attack not named in refusal");

  // The four surfaces still function after the attack:
  // (1) composer destination indicator still renders for a private persona
  await api("POST", "/api/dev", { action: "viewAs", personaId: id("backyard_scope") });
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // poll instead of a flat wait: the indicator can render after a retried/slow client fetch
  await pollUntil(async () => (await page.locator("[data-testid=composer-audience]").count()) > 0, { tries: 20, delayMs: 400 });
  if ((await page.locator("[data-testid=composer-audience]").count()) === 0)
    throw new Error("composer destination indicator missing after hostile import");
  await api("POST", "/api/dev", { action: "viewAs", personaId: null });

  // (2) correction cards still reach the feed data path
  // settle for content: a per-item drop can return a valid 200 missing the correction card
  const feed = await retryContent(
    () => retry(() => api("GET", "/api/feed2?surface=discovery")),
    (r) => r.json.cards.some((c) => c.kind === "correction"),
    4
  );
  if (!feed.json.cards.some((c) => c.kind === "correction"))
    throw new Error("correction cards absent after hostile import");

  // (3) disclosure unchanged: granted viewer still resolves the linkage
  const g = await retry(() =>
    api("GET", `/api/identity?personaId=${id("brothandbones")}&viewerPersonaId=${id("crustcritic")}`)
  );
  if (!g.json?.identity?.linked) throw new Error("disclosure behaviour changed after hostile import");

  // (4) k-floor unchanged: a below-floor audience is still refused
  const est = await retry(() =>
    api("GET", "/api/market/campaign?audience=" + encodeURIComponent(JSON.stringify({
      combinator: "AND",
      clauses: [{ field: "graph.claim", op: "eq", value: "espresso" }, { field: "author.tier", op: "gte", value: 10 }],
    })))
  );
  if (typeof est.json.kFloor !== "number" || est.json.kFloor < 1)
    throw new Error("k-floor vanished after hostile import");
});

// ---- 4. tampered artifact: signature refused ----
await check("4. A tampered artifact fails signature verification", async () => {
  await reset();
  const card = (await retry(() => api("GET", "/api/algo"))).json.cards[0];
  const tampered = JSON.parse(JSON.stringify(card.artifact));
  tampered.rules[0].root.clauses[0].value = 1; // loosen the filter, keep the signature
  const imp = await api("POST", "/api/algo/import", { artifact: tampered, activate: true });
  if (imp.status === 200) throw new Error("tampered artifact imported — signature not verified");
  if (!/signature/.test(JSON.stringify(imp.json.violations ?? [])))
    throw new Error("refusal does not name the signature");
});

// ---- 5. provenance: edits fork ----
await check("5. Editing an imported algo forks provenance: 'modified from @author's algo vN'", async () => {
  await reset();
  const card = (await retry(() => api("GET", "/api/algo"))).json.cards.find(
    (c) => c.artifact.name === "Calm Signal"
  );
  if (!card) throw new Error("Calm Signal card missing"); // guard: clear failure instead of an opaque TypeError
  const imp = await retry(() => api("POST", "/api/algo/import", { artifact: card.artifact, activate: false }));
  const modeId = imp.json.mode.id;
  if (imp.json.mode.importedFrom.authorHandle !== "quietvalidator")
    throw new Error("provenance author lost on import");

  await retry(() => api("PATCH", "/api/modes", { modeId, patch: { calmRanking: false } }));
  const modes = await retry(() => api("GET", "/api/modes"));
  const edited = modes.json.modes.find((m) => m.id === modeId);
  if (!edited) throw new Error("mode " + modeId + " missing from /api/modes"); // guard: clear failure instead of an opaque TypeError
  if (!edited.importedFrom?.modifiedLocally)
    throw new Error("edited import not marked modified — provenance chain broken");
  if (edited.importedFrom.algoVersion !== 3) throw new Error("provenance version lost");
});

// ---- 6. marketplace-lite: the seeded shelf renders every card ----
await check("6. Curator's public folder holds 3 algo cards + the seeded pack and renders them", async () => {
  // Assertion history: "exactly 2" until Call Option A added King of the
  // Hill (caught in Tier A's final 4-run verification); "exactly 3" until
  // Tier B Gate 1 filed the seeded FILTER PACK card on the same shelf
  // (caught identically in the Tier B final sweeps). Both times: a
  // deterministic stale expectation, not a flake and not a product defect.
  // The pack card is now asserted by name so the count carries meaning.
  await reset();
  const cards = (await retry(() => api("GET", "/api/algo"))).json.cards;
  const curated = cards.filter((c) => c.artifact.authorHandle === "quietvalidator");
  if (curated.length !== 3) throw new Error(`expected 3 curator algos, found ${curated.length}`);

  await page.goto(BASE + "/folders/folder_algoshelf", { waitUntil: "networkidle" });
  // poll instead of a flat wait: cards can still be rendering under adapter latency (shelf is server-seeded, reload safe)
  await pollUntil(async () => (await page.locator("[data-testid=algo-card]").count()) === 4, {
    tries: 20,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  const rendered = await page.locator("[data-testid=algo-card]").count();
  if (rendered !== 4)
    throw new Error(`folder page renders ${rendered} algo cards, expected 4 (3 algos + seeded pack)`);
  const body = await page.locator("body").innerText();
  if (!body.includes("Calm Signal")) throw new Error("algo name not rendered");
  if (!body.includes("@quietvalidator")) throw new Error("algo author not rendered");
  if (!body.includes("Longform Standard")) throw new Error("seeded pack card not rendered on the shelf");
});

// ---- 7. the preview page is mandatory and exact on the rendered surface ----
await check("7. The preview page renders exact numbers and the activate control", async () => {
  await reset();
  const card = (await retry(() => api("GET", "/api/algo"))).json.cards.find(
    (c) => c.artifact.name === "Longform Only"
  );
  if (!card) throw new Error("Longform Only card missing"); // guard: clear failure instead of an opaque TypeError
  await page.goto(BASE + "/algo/" + card.id, { waitUntil: "networkidle" });
  // poll instead of a flat wait: the preview computes over the feed behind adapter latency
  await pollUntil(
    async () => (await page.locator("[data-testid=preview-hides]").getAttribute("data-hides")) !== null,
    { tries: 20, delayMs: 400 }
  );
  const hides = await page.locator("[data-testid=preview-hides]").getAttribute("data-hides");
  const total = await page.locator("[data-testid=preview-hides]").getAttribute("data-total");
  if (hides === null || total === null) throw new Error("preview numbers not rendered");
  if (Number(total) < 1) throw new Error("preview ran against an empty feed — vacuous");
  if ((await page.locator("[data-testid=algo-activate]").count()) !== 1)
    throw new Error("activate control missing from the preview page");
  // samples render when there are hides
  if (Number(hides) > 0 && (await page.locator("[data-testid=preview-sample]").count()) === 0)
    throw new Error("hides > 0 but no sample posts rendered");
});

await reset();
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Tier A Gate 2 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
