// TIER B GATE 0 — cleanup. Both tests are safety-set.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent } from "./lib-health.mjs";
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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1200 } })).newPage();

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

console.log("\nTier B Gate 0 — Cleanup");

// ---- 1. ADVERSARIAL: an edge declared from a cast you do not own ----
await check("1. SAFETY: forged-authorship refutation never affects standing", async () => {
  await reset();
  // The viewer (tier 8) declares a refutation FROM gwei_whisperer's cast —
  // a cast they do not author — against a lower-tier claim. Without the
  // authorship check this WOULD take standing (8 >= claim tier). With it,
  // the edge records as unverified testimony and standing holds.
  const stolenFrom = posts.find((p) => p.authorPersonaId === id("gwei_whisperer") && !p.replyToHash);
  const victim = posts
    .filter((p) => {
      const a = personas.find((x) => x.id === p.authorPersonaId);
      return a && a.tier <= 6 && !p.replyToHash && a.handle !== "gwei_whisperer";
    })
    .sort((a, b) => a.minutesAgo - b.minutesAgo)[0];
  if (!victim) throw new Error("no suitable victim claim in seed");

  const decl = await retry(() =>
    api("POST", "/api/refute", { fromCastId: stolenFrom.hash, toCastId: victim.hash, type: "refutes" })
  );
  if (decl.json.edge.verified !== false)
    throw new Error("an edge from someone else's cast was marked VERIFIED — authorship check absent");

  // standing untouched under KOTH
  // settle content first: retry until the KOTH card is present (per-item drops can shorten a 200)
  const cards = (
    await retryContent(
      () => api("GET", "/api/algo"),
      (r) => r.json.cards.some((c) => c.artifact?.name === "King of the Hill"),
      5
    )
  ).json.cards;
  const koth = cards.find((c) => c.artifact?.name === "King of the Hill");
  await retry(() => api("POST", "/api/algo/import", { artifact: koth.artifact, activate: true }));
  const f = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  const victimCard = f.json.cards.find((c) => c.kind === "post" && c.cast?.hash === victim.hash);
  if (victimCard?.standingLost)
    throw new Error("FORGERY SUCCEEDED: unowned-cast refutation took standing");

  // control: authorship the actor really holds DOES verify
  await retry(() => api("POST", "/api/signer", {}));
  await retry(() => api("POST", "/api/personas", { name: "B0", handle: "b0_" + Date.now().toString(36) }));
  await retry(() =>
    api("POST", "/api/actions/cast", {
      text: "counter-source attached",
      replyToHash: victim.hash,
      markRefutation: true,
    })
  );
  // settle content first: retry until the just-created verified edge appears (per-item drops)
  const edges = await retryContent(
    () => api("GET", `/api/refute?castId=${victim.hash}`),
    (r) => r.json.edges.filter((e) => e.verified && e.declaredBy === "author").length === 1,
    5
  );
  const verified = edges.json.edges.filter((e) => e.verified && e.declaredBy === "author");
  if (verified.length !== 1)
    throw new Error(
      `self-authored edge should verify: ${JSON.stringify(edges.json.edges.map((e) => [e.fromCastId, e.verified]))}`
    );
});

// ---- 2. the Tier A starvation scenario, replayed against reservations ----
await check("2. Reservation: 3 community notes + 1 curator annotation all render under cap 3", async () => {
  await reset();
  await retry(() => api("POST", "/api/curators", { feedId: "curator_recordsdesk", subscribe: true }));
  // settle content first: retry until all 3 notes + 1 curator card are present (per-item drops)
  const f = await retryContent(
    () => api("GET", "/api/feed2?surface=discovery"),
    (r) => {
      const cs = r.json.cards.filter((c) => c.kind === "correction");
      return cs.filter((c) => !c.curatorName).length === 3 && cs.filter((c) => c.curatorName).length === 1;
    },
    5
  );
  const corrections = f.json.cards.filter((c) => c.kind === "correction");
  const notes = corrections.filter((c) => !c.curatorName);
  const curator = corrections.filter((c) => c.curatorName);
  if (notes.length !== 3) throw new Error(`expected 3 community notes, got ${notes.length}`);
  if (curator.length !== 1)
    throw new Error(
      `curator annotation starved again: ${curator.length} rendered (cap is 3 — the reservation must carry it)`
    );
});

// ---- 3. the seeded flood is now unverified; standing math unchanged ----
await check("3. Seeded flood edges are unverified; the flood remains impotent", async () => {
  await reset();
  const claim = posts
    .filter((p) => p.authorPersonaId === id("basisrisk") && !p.replyToHash)
    .sort((a, b) => a.minutesAgo - b.minutesAgo)[0];
  // settle content first: retry until all 10 flood edges are present (per-item drops)
  const edges = await retryContent(
    () => api("GET", `/api/refute?castId=${claim.hash}`),
    (r) => r.json.edges.filter((e) => e.assertedBy === id("airdropintern")).length === 10,
    5
  );
  const flood = edges.json.edges.filter((e) => e.assertedBy === id("airdropintern"));
  if (flood.length !== 10) throw new Error(`flood edges: ${flood.length}`);
  if (flood.some((e) => e.verified)) throw new Error("a synthetic flood edge claims verified authorship");
});

await reset();
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Tier B Gate 0 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
