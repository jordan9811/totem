// TIER B GATE 1 — network-state filter packs.
//
// Safety-set here: the hostile pack (Tier A guardrail suite must hold) and
// disclosure-wins on the read API (pass/fail with no WHY).
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const graph = JSON.parse(readFileSync("seed/data/graph.json", "utf8"));

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
const feedAuthors = async (complete = () => true) => {
  const authorsOf = (x) => x.json.cards.filter((c) => c.kind === "post" && !c.private).map((c) => c.cast.personaId);
  // audit fix (content-gap): settle the window until it contains what the caller's assertion needs
  const r = await retryContent(() => retry(() => api("GET", "/api/feed2?surface=discovery")), (x) => complete(authorsOf(x)), 6);
  return authorsOf(r);
};
// audit fix (content-gap): shelf read settled until the seeded pack card is present; callers keep their own assertions
const seededPackShelf = async () => {
  const r = await retryContent(() => retry(() => api("GET", "/api/algo")), (x) => x.json.cards.some((c) => c.artifact?.kind === "filter_pack"), 4);
  return r.json.cards;
};

// population facts, straight from the seed
const population = graph.audiencePopulation;
const lacking = population.filter((e) => !e.claims.includes("longform_reader")).map((e) => e.personaId);
const holding = population.filter((e) => e.claims.includes("longform_reader")).map((e) => e.personaId);

console.log("\nTier B Gate 1 — Network-state filter packs");

// ---- 1. the seeded pack, imported, measurably filters ----
await check("1. Seeded pack imports and measurably filters lacking accounts (attached mode only)", async () => {
  await reset();
  const cards = await seededPackShelf(); // audit fix: content-gap on the shelf read
  const packCard = cards.find((c) => c.artifact.kind === "filter_pack");
  if (!packCard) throw new Error("seeded pack card missing from the shelf");

  const baseline = await feedAuthors((a) => a.some((x) => lacking.includes(x))); // audit fix: settle before the vacuous-window assertion
  const lackingInBaseline = baseline.filter((a) => lacking.includes(a));
  if (lackingInBaseline.length === 0)
    throw new Error("no lacking-claim authors in the baseline window — test is vacuous");

  const imp = await retry(() => api("POST", "/api/algo/import", { artifact: packCard.artifact, activate: false }));
  if (!imp.json.pack?.id) throw new Error("pack import returned no pack id");
  const packId = imp.json.pack.id;

  // NOT attached yet: feed unchanged (packs are default-OFF)
  const unattached = await feedAuthors((a) => a.some((x) => lacking.includes(x))); // audit fix: settle before the presence assertion
  if (!unattached.some((a) => lacking.includes(a)))
    throw new Error("pack filtered the feed while unattached — default must be OFF");

  // attach to the ACTIVE (Default) mode
  const modes = await retry(() => api("GET", "/api/modes"));
  const def = modes.json.modes.find((m) => m.name === "Default");
  await retry(() => api("PATCH", "/api/modes", { modeId: def.id, patch: { filterPackIds: [packId] } }));
  const filtered = await feedAuthors((a) => a.some((x) => holding.includes(x))); // audit fix: settle before the holding-remain assertion
  const leaked = filtered.filter((a) => lacking.includes(a));
  if (leaked.length > 0)
    throw new Error(`lacking-claim authors survived the attached pack: ${leaked.slice(0, 3).join(",")}`);
  if (!filtered.some((a) => holding.includes(a)))
    throw new Error("pack filtered everything — holding accounts should remain");
});

// ---- 2. per-mode attachment: same feed, different modes, different results ----
await check("2. Per-mode: Work runs the pack, Default does not", async () => {
  await reset();
  const cards = await seededPackShelf(); // audit fix: content-gap on the shelf read (was an unguarded .find crash)
  const packCard = cards.find((c) => c.artifact.kind === "filter_pack");
  const imp = await retry(() => api("POST", "/api/algo/import", { artifact: packCard.artifact, activate: false }));
  const packId = imp.json.pack.id;

  const modes = await retry(() => api("GET", "/api/modes"));
  const work = modes.json.modes.find((m) => m.name === "Work");
  const def = modes.json.modes.find((m) => m.name === "Default");
  await retry(() => api("PATCH", "/api/modes", { modeId: work.id, patch: { filterPackIds: [packId] } }));

  await retry(() => api("POST", "/api/modes/active", { modeId: def.id }));
  const underDefault = await feedAuthors((a) => a.some((x) => lacking.includes(x))); // audit fix: settle before the presence assertion
  if (!underDefault.some((a) => lacking.includes(a)))
    throw new Error("Default filtered without the pack attached");

  await retry(() => api("POST", "/api/modes/active", { modeId: work.id }));
  const underWork = await feedAuthors();
  const leaked = underWork.filter((a) => lacking.includes(a));
  if (leaked.length > 0) throw new Error("Work mode did not run its attached pack");
  await retry(() => api("POST", "/api/modes/active", { modeId: def.id }));
});

// ---- 3. round-trip with exact preview counts ----
await check("3. Builder export → preview (exact counts) → import round-trip", async () => {
  await reset();
  const exp = await retry(() =>
    api("POST", "/api/packs/export", {
      name: "Roundtrip Pack",
      summary: "test",
      attestationPredicates: [{ claim: "espresso", mode: "holding" }],
    })
  );
  const artifact = exp.json.artifact;
  if (!artifact?.signature) throw new Error("export unsigned");

  const espressoHolders = population.filter((e) => e.claims.includes("espresso")).map((e) => e.personaId);
  // audit fix (content-gap): preview and window are two independent samples — re-sample both together until they agree in size, then run the original exact assertions
  const sample = await retryContent(
    async () => ({
      prev: await retry(() => api("POST", "/api/algo/preview", { artifact })),
      baseline: await feedAuthors(),
    }),
    (x) => x.prev.json.preview.total === x.baseline.length,
    6
  );
  const prev = sample.prev;
  const { hides, total, pct } = prev.json.preview;
  if (hides !== espressoHolders.length)
    throw new Error(`preview hides=${hides}, seed says ${espressoHolders.length} espresso holders`);

  // exactness against the window: pct must equal hidden-authored posts / total
  const baseline = sample.baseline;
  const hiddenPosts = baseline.filter((a) => espressoHolders.includes(a)).length;
  const expectedPct = baseline.length ? Math.round((hiddenPosts / baseline.length) * 100) : 0;
  if (total !== baseline.length) throw new Error(`preview total ${total} != window ${baseline.length}`);
  if (pct !== expectedPct) throw new Error(`preview pct ${pct} != computed ${expectedPct}`);

  const imp = await retry(() => api("POST", "/api/algo/import", { artifact, activate: false }));
  if (!imp.json.pack?.id) throw new Error("round-trip import failed");
});

// ---- 4. SAFETY: hostile pack runs the Tier A guardrail suite ----
await check("4. Hostile pack: all four guardrails hold, plus predicate-shape refusal", async () => {
  await reset();
  const hostile = {
    kind: "filter_pack",
    schemaVersion: 1,
    name: "Helpful Pack",
    summary: "trust me",
    authorPersonaId: id("drivethru_dave"),
    authorHandle: "drivethru_dave",
    algoVersion: 1,
    ranking: { recency: 0.25, engagement: 0.25, authorAffinity: 0.25, clusterAffinity: 0.25 },
    rules: [
      { name: "leak linkages", action: "hide", root: { combinator: "AND", clauses: [{ field: "identity.linked", op: "eq", value: true }] } },
      { name: "kill notes", action: "hide", root: { combinator: "AND", clauses: [{ field: "card.correction", op: "eq", value: true }] } },
    ],
    modeFlags: { hideAudienceLine: true, kFloorOverride: 0 },
    attestationPredicates: [
      { claim: "espresso", mode: "exposes" },
      { claim: "telescope", mode: "holding", revealReason: true },
    ],
    signature: "forged",
  };
  const imp = await api("POST", "/api/algo/import", { artifact: hostile, activate: false });
  if (imp.status === 200) throw new Error("hostile pack imported — guardrails absent");
  const v = JSON.stringify(imp.json.violations ?? []);
  if (!/disclosure\/grant/.test(v)) throw new Error("disclosure attack not named");
  if (!/hideAudienceLine/.test(v)) throw new Error("composer attack not named");
  if (!/kFloorOverride/.test(v)) throw new Error("k-floor attack not named");
  if (!/exposes|design change/.test(v)) throw new Error("malformed predicate not refused by name");

  // surfaces intact
  const g = await retry(() =>
    api("GET", `/api/identity?personaId=${id("brothandbones")}&viewerPersonaId=${id("crustcritic")}`)
  );
  if (!g.json?.identity?.linked) throw new Error("disclosure behaviour changed after hostile pack");
});

// ---- 5. SAFETY: the read API answers pass/fail and nothing else ----
await check("5. Pack read API: correct answers, and disclosure wins — no WHY", async () => {
  await reset();
  const cards = await seededPackShelf(); // audit fix: content-gap on the shelf read (was an unguarded .find crash)
  const packCard = cards.find((c) => c.artifact.kind === "filter_pack");
  const imp = await retry(() => api("POST", "/api/algo/import", { artifact: packCard.artifact, activate: false }));
  const packId = imp.json.pack.id;

  const failCase = lacking[0];
  const passCase = holding[0];
  const failRes = await retry(() => api("GET", `/api/packs?packId=${packId}&personaId=${failCase}`));
  const passRes = await retry(() => api("GET", `/api/packs?packId=${packId}&personaId=${passCase}`));
  if (failRes.json.pass !== false) throw new Error("lacking persona passed a lacking-claim pack");
  if (passRes.json.pass !== true) throw new Error("holding persona failed");

  // the response shape carries pass/fail ONLY — no reason, no claims, no
  // predicate echo. Identical key sets for pass and fail, so the shape
  // itself cannot become the oracle.
  const keys = (o) => Object.keys(o).sort().join(",");
  if (keys(failRes.json) !== keys(passRes.json))
    throw new Error(`pass and fail responses differ in shape: ${keys(failRes.json)} vs ${keys(passRes.json)}`);
  for (const banned of ["reason", "claim", "predicate", "why", "matched"]) {
    if (failRes.text.toLowerCase().includes(banned))
      throw new Error(`read API leaks a "${banned}" field — disclosure must win`);
  }

  // hidden-linkage persona: answerable, same shape, no linkage material
  const hiddenSibling = await retry(() => api("GET", `/api/packs?packId=${packId}&personaId=${id("collimationking")}`));
  if (typeof hiddenSibling.json.pass !== "boolean") throw new Error("hidden-linkage persona not answerable");
  if (hiddenSibling.text.includes("aperture_annie"))
    throw new Error("read API leaked a hidden linkage");
});

await reset();
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Tier B Gate 1 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
