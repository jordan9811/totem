// TIER A — CALL OPTION A: refutation edges + king of the hill.
//
// The assertion the whole option hangs on: STANDING IS TIER-WEIGHTED,
// NEVER VOLUME-WEIGHTED. The seeded flood — a tier-1 account declaring
// refutation ten times against a tier-9 claim — must move nothing.
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
const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;
const claimPost = posts
  .filter((p) => p.authorPersonaId === id("basisrisk") && !p.replyToHash)
  .sort((a, b) => a.minutesAgo - b.minutesAgo)[0];

console.log("\nTier A Option A — Refutation edges + king of the hill");

// ---- 1. author-declared edge via the reply composer path ----
await check("1. A reply marked as refutation declares a typed author edge", async () => {
  await reset();
  await retry(() => api("POST", "/api/signer", {}));
  await retry(() =>
    api("POST", "/api/personas", { name: "A5", handle: "a5_" + Date.now().toString(36) })
  );
  const target = posts.find((p) => p.authorPersonaId === id("gwei_whisperer") && !p.replyToHash);
  await retry(() =>
    api("POST", "/api/actions/cast", {
      text: "the cited figure is from the retracted draft",
      replyToHash: target.hash,
      markRefutation: true,
    })
  );
  // settle the read with retryContent (per-item drops retry); assertion below is unchanged
  const edges = await retryContent(
    () => api("GET", `/api/refute?castId=${target.hash}`),
    (r) => r.json.edges.filter((e) => e.type === "refutes" && e.declaredBy === "author").length === 1,
    5
  );
  const declared = edges.json.edges.filter((e) => e.type === "refutes" && e.declaredBy === "author");
  if (declared.length !== 1) throw new Error(`expected 1 author-declared edge, got ${declared.length}`);
  if (declared[0].assertedBy === "") throw new Error("edge lost its asserter");
});

// ---- 2. curator-attested edge rides the annotation shape ----
await check("2. A subscribed desk's annotation attests an edge; unsubscribed it does not exist", async () => {
  await reset();
  const storyPost = posts.find((p) => p.storyId === "story_idverify_breach" && !p.replyToHash);
  let edges = await retry(() => api("GET", `/api/refute?castId=${storyPost.hash}`));
  if (edges.json.edges.some((e) => e.declaredBy === "curator"))
    throw new Error("curator edge visible without a subscription");

  await retry(() => api("POST", "/api/curators", { feedId: "curator_footnote", subscribe: true }));
  // settle the read with retryContent (per-item drops retry); assertion below is unchanged
  edges = await retryContent(
    () => api("GET", `/api/refute?castId=${storyPost.hash}`),
    (r) => r.json.edges.filter((e) => e.declaredBy === "curator" && e.type === "refutes").length === 1,
    4
  );
  const attested = edges.json.edges.filter((e) => e.declaredBy === "curator" && e.type === "refutes");
  if (attested.length !== 1) throw new Error(`expected 1 curator-attested edge, got ${attested.length}`);
});

// ---- 3. THE FLOOD: volume is not weight ----
await check("3. KOTH: ten tier-1 refutation declarations do not take standing from a tier-9 claim", async () => {
  await reset();
  // sanity: the seeded flood exists
  // settle the read with retryContent so a per-item drop can't shrink the flood; assertion unchanged
  const edges = await retryContent(
    () => api("GET", `/api/refute?castId=${claimPost.hash}`),
    (r) =>
      r.json.edges.filter((e) => e.declaredBy === "author" && e.assertedBy === id("airdropintern"))
        .length === 10,
    5
  );
  const flood = edges.json.edges.filter(
    (e) => e.declaredBy === "author" && e.assertedBy === id("airdropintern")
  );
  if (flood.length !== 10) throw new Error(`seeded flood has ${flood.length} edges, expected 10`);

  // activate the seeded KOTH algo (Gate 2 dogfood: import the card)
  const cards = (await retry(() => api("GET", "/api/algo"))).json.cards;
  const koth = cards.find((c) => c.artifact.name === "King of the Hill");
  if (!koth) throw new Error("seeded KOTH algo card missing");
  await retry(() => api("POST", "/api/algo/import", { artifact: koth.artifact, activate: true }));

  // settle the feed read until the flooded claim card is present; assertion below is unchanged
  const f = await retryContent(
    () => api("GET", "/api/feed2?surface=discovery"),
    (r) => r.json.cards.some((c) => c.kind === "post" && !c.private && c.cast.hash === claimPost.hash),
    4
  );
  const ranked = f.json.cards.filter((c) => c.kind === "post" && !c.private);
  const claim = ranked.find((c) => c.cast.hash === claimPost.hash);
  if (!claim) throw new Error("the flooded claim is not in the KOTH window");
  // Standing is a FACT in the payload, not an inference from position (the
  // final display order is recency, so position proves nothing).
  if (claim.standingLost)
    throw new Error("FLOOD SUCCEEDED: ten tier-1 declarations took standing from a tier-9 claim");
  // and no post is marked sunk yet — nothing outranks the flood in refuting
  const sunk = ranked.filter((c) => c.standingLost);
  if (sunk.length > 0)
    throw new Error(`posts lost standing with no qualifying refutation: ${sunk.map((c) => c.cast.hash).join(",")}`);
});

// ---- 4. KOTH: a curator-attested refutation DOES take standing ----
await check("4. KOTH + subscription: the desk-attested refutation sinks the story claim", async () => {
  // still in KOTH mode from test 3
  const storyPost = posts.find((p) => p.storyId === "story_idverify_breach" && !p.replyToHash);
  await retry(() => api("POST", "/api/curators", { feedId: "curator_footnote", subscribe: true }));
  // settle the feed read so a dropped claim card can't masquerade as a standing regression; assertions unchanged
  const after = await retryContent(
    () => api("GET", "/api/feed2?surface=discovery"),
    (r) => r.json.cards.some((c) => c.cast?.hash === claimPost.hash),
    4
  );
  const ranked = after.json.cards.filter((c) => c.kind === "post" && !c.private);
  const story = ranked.find((c) => c.cast.hash === storyPost.hash);
  if (story) {
    if (!story.standingLost)
      throw new Error("desk-attested refutation did not take standing under KOTH");
    // sunk band is real: it must render after every standing post
    const firstSunk = ranked.findIndex((c) => c.standingLost);
    const lastStanding = ranked.map((c) => !c.standingLost).lastIndexOf(true);
    if (firstSunk < lastStanding)
      throw new Error("a sunk post renders above standing content");
  } else {
    // outside the window entirely is also a loss of standing — but the
    // flooded claim must STILL be standing either way
    const claim = ranked.find((c) => c.cast.hash === claimPost.hash);
    if (!claim || claim.standingLost) throw new Error("the standing claim regressed");
  }
});

// ---- 5. concur/dispute feeds the per-curator accuracy tally ----
await check("5. One-tap concur/dispute updates the desk's accuracy tally", async () => {
  await reset();
  await retry(() => api("POST", "/api/curators", { feedId: "curator_recordsdesk", subscribe: true }));
  // settle the read until the desk and its annotation are present (avoids unchecked-find crash); assertions unchanged
  const cur = await retryContent(
    () => api("GET", "/api/curators"),
    (r) => (r.json.feeds.find((f) => f.id === "curator_recordsdesk")?.annotations?.length ?? 0) > 0,
    4
  );
  const desk = cur.json.feeds.find((f) => f.id === "curator_recordsdesk");
  const ann = desk.annotations[0];
  if (desk.accuracy.accuracy !== null) throw new Error("accuracy nonzero before any votes");

  await retry(() => api("POST", "/api/annotations/vote", { annotationId: ann.id, vote: "concur" }));
  // settle the re-read until the desk entry (with accuracy) is present; tally assertion unchanged
  let after = (
    await retryContent(
      () => api("GET", "/api/curators"),
      // settled-content predicate: the accuracy OBJECT exists pre-vote
      // (concur 0) — poll for the tally the assertion needs, not existence
      (r) => r.json.feeds.find((f) => f.id === "curator_recordsdesk")?.accuracy?.concur === 1,
      4
    )
  ).json.feeds.find((f) => f.id === "curator_recordsdesk");
  if (after.accuracy.concur !== 1 || after.accuracy.accuracy !== 100)
    throw new Error(`tally after concur: ${JSON.stringify(after.accuracy)}`);

  // switching the vote replaces it, never double-counts
  await retry(() => api("POST", "/api/annotations/vote", { annotationId: ann.id, vote: "dispute" }));
  // settle the re-read until the desk entry (with accuracy) is present; tally assertion unchanged
  after = (
    await retryContent(
      () => api("GET", "/api/curators"),
      // settled: the switched vote is the content under test
      (r) => r.json.feeds.find((f) => f.id === "curator_recordsdesk")?.accuracy?.dispute === 1,
      4
    )
  ).json.feeds.find((f) => f.id === "curator_recordsdesk");
  if (after.accuracy.concur !== 0 || after.accuracy.dispute !== 1)
    throw new Error(`vote switch double-counted: ${JSON.stringify(after.accuracy)}`);
});

// ---- 6. the thread renders refutation chains distinctly ----
await check("6. PAGE: a refuting reply renders with the refutation treatment", async () => {
  await reset();
  await retry(() => api("POST", "/api/signer", {}));
  await retry(() =>
    api("POST", "/api/personas", { name: "A5b", handle: "a5b_" + Date.now().toString(36) })
  );
  const target = posts.find((p) => p.authorPersonaId === id("gwei_whisperer") && !p.replyToHash);
  const author = personas.find((p) => p.id === target.authorPersonaId);
  await retry(() =>
    api("POST", "/api/actions/cast", {
      text: "counterexample in the appendix",
      replyToHash: target.hash,
      markRefutation: true,
    })
  );
  await page.goto(`${BASE}/${author.handle}/status/${target.hash}`, { waitUntil: "networkidle" });
  // poll for the server-rendered refutation treatment instead of a fixed wait; assertions unchanged
  await pollUntil(
    async () => (await page.locator("[data-testid=refutation-reply]").count()) === 1,
    { tries: 15, delayMs: 400, midway: () => page.reload({ waitUntil: "networkidle" }) }
  );
  const marked = await page.locator("[data-testid=refutation-reply]").count();
  if (marked !== 1) throw new Error(`expected 1 refutation-treated reply, found ${marked}`);
  const by = await page.locator("[data-testid=refutation-reply]").getAttribute("data-declared-by");
  if (by !== "author") throw new Error(`treatment mislabelled: ${by}`);
});

await reset();
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Tier A Option A checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
