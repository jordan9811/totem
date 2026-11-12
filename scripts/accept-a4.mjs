// TIER A GATE 4 — curator subscriptions.
//
// Safety-set test: the sub-threshold annotation. A 1-of-3 multisig
// annotation is an UNISSUED statement — it renders nowhere, no matter what
// the viewer subscribed to. Rendering it would let one compromised key
// speak for a desk of three.
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
const feed = async () => (await retry(() => api("GET", "/api/feed2?surface=discovery"))).json;

const FOOTNOTE = "curator_footnote";
const RECORDS = "curator_recordsdesk";

console.log("\nTier A Gate 4 — Curator subscriptions");

// ---- 1. valid multisig annotation reaches the existing debunk surface ----
await check("1. Valid 2-of-3 annotation lights the debunk indicator with curator attribution", async () => {
  await reset();
  const before = await feed();
  if (before.debunk && Object.values(before.debunk).includes("Footnote Desk"))
    throw new Error("curator debunk present before subscribing");

  await retry(() => api("POST", "/api/curators", { feedId: FOOTNOTE, subscribe: true }));
  // Settle content (per-item adapter drops make incomplete 200s), then assert.
  const after = await retryContent(feed, (j) => Object.values(j.debunk ?? {}).includes("Footnote Desk"), 4);
  const curated = Object.entries(after.debunk ?? {}).filter(([, v]) => v === "Footnote Desk");
  if (curated.length === 0) throw new Error("subscribed curator's annotation did not join the debunk map");

  // and the rendered indicator carries the attribution
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // Poll rather than a flat wait — /home's many retried mock adapter calls
  // can outlast a fixed 800ms under full-sweep load. One reload midway
  // covers a subscription that landed after the render began.
  const attributed = await pollUntil(
    async () =>
      (await page.locator("[data-testid=debunk-source]").allInnerTexts()).some((t) => t.includes("Footnote Desk")),
    { tries: 20, delayMs: 400, midway: () => page.reload({ waitUntil: "networkidle" }) }
  );
  if (!attributed) throw new Error("debunk indicator rendered without curator attribution");
});

// ---- 2. SAFETY: sub-threshold renders NOWHERE ----
await check("2. A 1-of-3 annotation renders nowhere — feed, debunk, corrections, API", async () => {
  await reset();
  await retry(() => api("POST", "/api/curators", { feedId: RECORDS, subscribe: true }));
  const NEEDLE = "UNISSUED";

  const f = await feed();
  if (JSON.stringify(f).includes(NEEDLE)) throw new Error("FAIL-OPEN: sub-threshold annotation in the feed payload");

  const curators = await retry(() => api("GET", "/api/curators"));
  if (curators.text.includes(NEEDLE))
    throw new Error("FAIL-OPEN: sub-threshold annotation listed by the curators API");

  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // Wait for annotation rendering to actually happen (the desk's valid annotations tag cards) so the absence check below cannot pass vacuously; a timeout here just falls through to the same assert.
  await pollUntil(async () => (await page.locator("[data-testid=curator-tag]").count()) > 0, {
    tries: 15,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  const body = await page.locator("body").innerText();
  if (body.includes(NEEDLE)) throw new Error("FAIL-OPEN: sub-threshold annotation rendered on the page");
});

// ---- 3. tampering: a forged signature does not count toward threshold ----
await check("3. Signature verification is real: the invalid annotation fails because signing is checked", async () => {
  // The seeded invalid annotation has ONE genuine signer of three. If the
  // implementation counted listed signers instead of VERIFIED signers, the
  // valid flagging annotation (2 real signatures) and this one (1 real)
  // would be indistinguishable by list length alone. Assert the curators
  // API reports only verified-signer annotations, with correct counts.
  // Settle content (a per-annotation adapter drop can shrink a valid 200), then assert.
  const curators = await retryContent(
    () => retry(() => api("GET", "/api/curators")),
    (r) => r.json.feeds.find((f) => f.id === RECORDS).annotations.length === 2,
    4
  );
  const records = curators.json.feeds.find((f) => f.id === RECORDS);
  if (!records) throw new Error("records desk feed missing");
  if (records.annotations.length !== 2)
    throw new Error(`expected exactly 2 VALID annotations from the desk, got ${records.annotations.length}`);
  for (const a of records.annotations) {
    if (a.signerCount < records.threshold)
      throw new Error("an annotation with fewer signers than threshold was listed as valid");
  }
});

// ---- 4. reinjection: annotation on an engaged post, existing surface ----
await check("4. Curator annotation on an engaged post rides the correction surface, tagged", async () => {
  await reset();
  await retry(() => api("POST", "/api/curators", { feedId: RECORDS, subscribe: true }));
  // Settle content (per-item adapter drops make incomplete 200s), then assert.
  const f = await retryContent(
    feed,
    (j) => j.cards.some((c) => c.kind === "correction" && c.curatorName === "Records Desk (2-of-3)"),
    4
  );
  const card = f.cards.find((c) => c.kind === "correction" && c.curatorName === "Records Desk (2-of-3)");
  if (!card) throw new Error("curator annotation did not reach the correction surface");
  if (!card.cast.hash.startsWith("0xas0377")) throw new Error("annotation attached to the wrong post");
  if (!card.evidenceLink) throw new Error("evidence link lost");

  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // Poll for the tag rather than a flat 800ms — the exact trap test 1's comment documents.
  await pollUntil(
    async () => (await page.locator("[data-testid=curator-tag]").allInnerTexts()).some((t) => t.includes("Records Desk")),
    { tries: 20, delayMs: 400, midway: () => page.reload({ waitUntil: "networkidle" }) }
  );
  const tags = await page.locator("[data-testid=curator-tag]").allInnerTexts();
  if (!tags.some((t) => t.includes("Records Desk")))
    throw new Error("curator tag not rendered on the correction card");
});

// ---- 5. actions: badge only (default) does not block; auto-block fans out ----
await check("5. Auto-block hides the flagged author AND their resolvable sibling; badge does not", async () => {
  await reset();
  // badge (default): flagged author still present
  await retry(() => api("POST", "/api/curators", { feedId: RECORDS, subscribe: true }));
  // Settle the presence read (a per-item drop of the author's post mimics a badge-hide), then assert.
  let f = await retryContent(
    feed,
    (j) => j.cards.some((c) => c.kind === "post" && c.cast?.personaId === id("basisrisk")),
    4
  );
  const hasAuthor = (feedJson, personaId) =>
    feedJson.cards.some((c) => c.kind === "post" && c.cast?.personaId === personaId);
  if (!hasAuthor(f, id("basisrisk")))
    throw new Error("badge-only subscription hid the flagged author — default must be least invasive");

  // auto-block: author AND public-linked sibling disappear
  await retry(() => api("POST", "/api/curators", { feedId: RECORDS, subscribe: true, action: "autoblock" }));
  f = await feed();
  if (hasAuthor(f, id("basisrisk"))) throw new Error("auto-block left the flagged author in the feed");
  if (hasAuthor(f, id("duskorbiter")))
    throw new Error("auto-block did not fan out to the PUBLIC-linked sibling — cross-persona composition broken");
});

// ---- 6. demote: visible but sunk ----
await check("6. Demote keeps the flagged author visible but beneath undemoted posts", async () => {
  await retry(() => api("POST", "/api/curators", { feedId: RECORDS, subscribe: true, action: "demote" }));
  // Settle the presence read (a per-item drop mimics demote-as-block), then assert.
  const f = await retryContent(
    feed,
    (j) => j.cards.some((c) => c.kind === "post" && !c.private && c.cast?.personaId === id("basisrisk")),
    4
  );
  const posts = f.cards.filter((c) => c.kind === "post" && !c.private);
  const flagged = (c) => c.cast?.personaId === id("basisrisk");
  const firstFlagged = posts.findIndex(flagged);
  if (firstFlagged === -1) throw new Error("demote removed the author entirely — that is block, not demote");
  // The band sort guarantees every undemoted ranked post precedes every
  // demoted one. Assert exactly that.
  const lastUndemoted = posts.map((c) => !flagged(c)).lastIndexOf(true);
  if (firstFlagged < lastUndemoted)
    throw new Error(
      `demoted author at ${firstFlagged} appears before undemoted content ending at ${lastUndemoted}`
    );
});

// ---- 7. unsubscribe fully reverses everything on next render ----
await check("7. Unsubscribe reverses debunk, corrections and blocks on the next render", async () => {
  await reset();
  await retry(() => api("POST", "/api/curators", { feedId: RECORDS, subscribe: true, action: "autoblock" }));
  await retry(() => api("POST", "/api/curators", { feedId: FOOTNOTE, subscribe: true }));
  let f = await feed();
  if (f.cards.some((c) => c.kind === "post" && c.cast?.personaId === id("basisrisk")))
    throw new Error("setup failed: auto-block not in effect");

  await retry(() => api("POST", "/api/curators", { feedId: RECORDS, subscribe: false }));
  await retry(() => api("POST", "/api/curators", { feedId: FOOTNOTE, subscribe: false }));
  // Settle the presence read (a per-item drop mimics "still hidden"), then assert.
  f = await retryContent(
    feed,
    (j) => j.cards.some((c) => c.kind === "post" && c.cast?.personaId === id("basisrisk")),
    4
  );
  if (!f.cards.some((c) => c.kind === "post" && c.cast?.personaId === id("basisrisk")))
    throw new Error("flagged author still hidden after unsubscribe");
  if (f.cards.some((c) => c.kind === "correction" && c.curatorName))
    throw new Error("curator correction card survived unsubscribe");
  if (Object.values(f.debunk ?? {}).some((v) => v !== "Community note"))
    throw new Error("curator debunk attribution survived unsubscribe");
});

// ---- 8. settings management renders ----
await check("8. Settings page lists feeds, subscribes, and offers the three actions", async () => {
  await reset();
  await page.goto(BASE + "/settings/curators", { waitUntil: "networkidle" });
  // Poll for the list rather than a flat 700ms — adapter latency can outlast it.
  await pollUntil(async () => (await page.locator("[data-testid=curator-feed]").count()) === 2, {
    tries: 15,
    delayMs: 400,
  });
  if ((await page.locator("[data-testid=curator-feed]").count()) !== 2)
    throw new Error("settings page does not list both seeded feeds");
  await page.locator(`[data-testid=curator-sub-${RECORDS}]`).click();
  // Poll for the post-subscribe re-render rather than a flat 600ms — one adapter call can outlast it.
  await pollUntil(
    async () =>
      (await page.locator("[data-testid=curator-action-autoblock]").count()) === 1 &&
      (await page.locator(`[data-testid=curator-sub-${RECORDS}]`).getAttribute("data-subscribed")) === "true",
    { tries: 15, delayMs: 400 }
  );
  if ((await page.locator("[data-testid=curator-action-autoblock]").count()) !== 1)
    throw new Error("per-subscription action controls missing after subscribing");
  const sub = await page.locator(`[data-testid=curator-sub-${RECORDS}]`).getAttribute("data-subscribed");
  if (sub !== "true") throw new Error("subscribe click did not take");
});

await api("POST", "/api/dev", { action: "resetSeed" });
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Tier A Gate 4 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
