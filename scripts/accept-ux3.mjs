// UX PASS GATE 3 — selective bookmark / thread resolution.
//
// "Don't resolve everything, let the user choose sources." Cold ids sit in
// storage untouched until a source is explicitly designated; resolution is
// atomic and cap-gated through the EXISTING X spend ledger, and lands in
// the EXISTING readwise chunking + timeline populator — see
// lib/x/coldstore.ts for how a resolved item becomes a real readwise
// schedule with zero changes to that pipeline.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent } from "./lib-health.mjs";

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
const coldstore = () => retry(() => api("GET", "/api/x/coldstore"));
const resolve = (sourceId) => api("POST", "/api/x/coldstore", { action: "resolve", sourceId });
const spend = () => retry(() => api("GET", "/api/x/spend"));
const feedHealth = () => retry(() => api("GET", "/api/feed-health"));
const source = (json, id) => json.sources.find((s) => s.id === id);

console.log("\nUX Pass Gate 3 — selective bookmark / thread resolution");

// ---- 1. baseline: cold counts are exact, nothing resolved ----
await check("1. Fresh state: every source cold, counts exact", async () => {
  await reset();
  const j = (await coldstore()).json;
  if (j.sources.length !== 4) throw new Error(`expected 4 cold sources, got ${j.sources.length}`);
  for (const s of j.sources) {
    if (s.resolvedCount !== 0) throw new Error(`${s.id} has ${s.resolvedCount} resolved before any resolve call`);
    if (s.coldCount !== s.totalCount) throw new Error(`${s.id} coldCount !== totalCount before any resolve call`);
  }
  const longform = source(j, "cold_bf_longform");
  if (longform.totalCount !== 40) throw new Error(`Longform totalCount ${longform.totalCount}, expected 40`);
  if (j.summary.totalResolved !== 0) throw new Error("summary.totalResolved !== 0 at baseline");
  if (j.summary.totalCold !== j.sources.reduce((a, s) => a + s.totalCount, 0))
    throw new Error("summary.totalCold does not match the sum of source totals");
});

// ---- 2. designating a folder resolves EXACTLY its ids and no others ----
await check("2. Resolving Longform resolves exactly its 40 ids; every other source untouched", async () => {
  const r = await retry(() => resolve("cold_bf_longform"));
  // flake fix (audit L92): a 503 after resolveSource's pre-await mutation makes retry() re-POST, and the retried attempt reports the 40 as alreadyResolved — accept that split; the coldstore post-state below still requires exactly 40
  const retriedSplit = r.json.alreadyResolved > 0 && r.json.resolved + r.json.alreadyResolved === 40;
  if (r.json.resolved !== 40 && !retriedSplit) throw new Error(`resolved ${r.json.resolved}, expected 40`);
  if (r.json.alreadyResolved !== 0 && !retriedSplit) throw new Error(`alreadyResolved ${r.json.alreadyResolved}, expected 0`);
  if (Math.abs(r.json.cost - r.json.resolved * 0.0004) > 0.0005) throw new Error(`cost ${r.json.cost}, expected ~0.016`);

  const j = (await retryContent(coldstore, (x) => source(x.json, "cold_bf_longform").resolvedCount === 40)).json;
  const longform = source(j, "cold_bf_longform");
  if (longform.coldCount !== 0 || longform.resolvedCount !== 40)
    throw new Error(`Longform after resolve: cold=${longform.coldCount} resolved=${longform.resolvedCount}`);
  for (const id of ["cold_bf_everything", "cold_dm_rivqueen", "cold_dm_astro"]) {
    const s = source(j, id);
    if (s.resolvedCount !== 0) throw new Error(`resolving Longform also resolved ${s.resolvedCount} item(s) in ${id}`);
  }
});

// ---- 3. cold count stays exact after a partial resolve ----
await check("3. Cold count is exact after resolving one of four sources", async () => {
  const j = (await coldstore()).json;
  const expectedTotal = j.sources.reduce((a, s) => a + s.totalCount, 0);
  if (j.summary.totalResolved !== 40) throw new Error(`summary.totalResolved ${j.summary.totalResolved}, expected 40`);
  if (j.summary.totalCold !== expectedTotal - 40)
    throw new Error(`summary.totalCold ${j.summary.totalCold}, expected ${expectedTotal - 40}`);
});

// ---- 4. resolved items actually enter the EXISTING readwise populator ----
await check("4. Resolved items flow into the existing readwise chunking, not a parallel system", async () => {
  const fh = (await feedHealth()).json;
  const longformSchedules = fh.schedules.filter((s) => s.postHash.startsWith("cold:cold_bf_longform_"));
  if (longformSchedules.length !== 40)
    throw new Error(`expected 40 readwise schedules for Longform, found ${longformSchedules.length}`);
  // the hand-written long piece — proves the real chunker (not a stub) ran
  // on real content, since every other item is a one-liner
  const long = fh.schedules.find((s) => s.postHash === "cold:cold_bf_longform_seed");
  if (!long) throw new Error("no schedule for the longform seed item");
  if (long.chunks.length < 2) throw new Error(`longform item produced ${long.chunks.length} chunk(s), expected >1`);
  if (long.nextChunkIndex !== 0) throw new Error("a freshly scheduled item had chunks already surfaced");
});

// ---- 5. a folder exceeding the spend cap PROMPTS, resolves nothing ----
await check("5. Everything (3000 ids) exceeds the per-run cap: refused, nothing resolved, nothing charged", async () => {
  const before = (await spend()).json;
  const r = await resolve("cold_bf_everything");
  if (r.status !== 402) throw new Error(`status ${r.status}, expected 402`);
  if (r.json.cap !== "per_run") throw new Error(`cap "${r.json.cap}", expected "per_run"`);

  const j = (await coldstore()).json;
  const everything = source(j, "cold_bf_everything");
  if (everything.resolvedCount !== 0)
    throw new Error(`refused resolve still resolved ${everything.resolvedCount} item(s)`);
  if (everything.coldCount !== 3000) throw new Error(`coldCount ${everything.coldCount}, expected 3000 (untouched)`);

  const fh = (await feedHealth()).json;
  if (fh.schedules.some((s) => s.postHash.startsWith("cold:cold_bf_everything_")))
    throw new Error("a refused resolve still created a readwise schedule");

  const after = (await spend()).json;
  if (after.entries.length !== before.entries.length)
    throw new Error("a refused resolve still wrote a spend ledger entry");
  if (after.totals.thisRun !== before.totals.thisRun)
    throw new Error("a refused resolve still moved the run spend total");
});

// ---- 6. re-resolving is idempotent: no duplicate reads, no duplicate charges ----
await check("6. Re-resolving an already-fully-resolved source charges nothing and duplicates nothing", async () => {
  const before = (await spend()).json;
  const fhBefore = (await feedHealth()).json;
  const scheduleCountBefore = fhBefore.schedules.length;

  const r = await retry(() => resolve("cold_bf_longform"));
  if (r.json.resolved !== 0) throw new Error(`resolved ${r.json.resolved} on a repeat call, expected 0`);
  if (r.json.alreadyResolved !== 40) throw new Error(`alreadyResolved ${r.json.alreadyResolved}, expected 40`);
  if (r.json.cost !== 0) throw new Error(`cost ${r.json.cost} on a no-op re-resolve, expected 0`);

  const after = (await spend()).json;
  if (after.entries.length !== before.entries.length)
    throw new Error("re-resolving wrote a new spend ledger entry");
  if (after.totals.thisRun !== before.totals.thisRun)
    throw new Error("re-resolving moved the run spend total");

  const fhAfter = (await feedHealth()).json;
  if (fhAfter.schedules.length !== scheduleCountBefore)
    throw new Error(`schedule count changed on re-resolve: ${scheduleCountBefore} -> ${fhAfter.schedules.length}`);
});

// ---- 7. the OTHER source kind (DM thread) resolves and renders with its own attribution ----
// Isolated behind its own reset: the readwise TYPE cap is 4 cards per feed
// build (lib/injection.ts, deliberate — "prevents a user with 40 bookmarked
// chunks from seeing nothing but their own reading queue"), and Longform's
// 40 schedules would starve rivqueen's 12 out of every slot if both were
// live in the same feed build. That's the cap working as designed, not a
// bug — so each kind gets checked in a feed with nothing else competing.
await check("7. A DM-thread source resolves and renders with its own attribution", async () => {
  await reset();
  const r = await retry(() => resolve("cold_dm_rivqueen"));
  // flake fix (audit L185): tolerate a retried POST reporting the ids as alreadyResolved; the settled coldstore post-state must still be exactly 12
  if (r.json.resolved !== 12 && !(r.json.alreadyResolved > 0 && r.json.resolved + r.json.alreadyResolved === 12))
    throw new Error(`resolved ${r.json.resolved}, expected 12`);
  const cs = (await retryContent(coldstore, (x) => source(x.json, "cold_dm_rivqueen").resolvedCount === 12)).json;
  if (source(cs, "cold_dm_rivqueen").resolvedCount !== 12)
    throw new Error(`resolved ${source(cs, "cold_dm_rivqueen").resolvedCount}, expected 12`);
  await retry(() => api("POST", "/api/dev", { action: "fastForwardReadwise" }));
  const feed = (await retry(() => api("GET", "/api/feed2?surface=discovery"))).json;
  const dmCard = feed.cards.find((c) => c.cast.hash.startsWith("cold:cold_dm_rivqueen_"));
  if (!dmCard) throw new Error("no rendered card for the resolved DM-thread item after fast-forward");
  if (!/DM with @rivqueen/.test(dmCard.readwiseSource ?? ""))
    throw new Error(`DM card attribution: "${dmCard.readwiseSource}"`);
});

// ---- 8. the bookmark-folder kind renders with its OWN distinct attribution ----
await check("8. A bookmark-folder source renders with attribution distinct from a DM thread", async () => {
  await reset();
  const r = await retry(() => resolve("cold_bf_longform"));
  // flake fix (audit L198): tolerate a retried POST reporting the ids as alreadyResolved; the settled coldstore post-state must still be exactly 40
  if (r.json.resolved !== 40 && !(r.json.alreadyResolved > 0 && r.json.resolved + r.json.alreadyResolved === 40))
    throw new Error(`resolved ${r.json.resolved}, expected 40`);
  const cs = (await retryContent(coldstore, (x) => source(x.json, "cold_bf_longform").resolvedCount === 40)).json;
  if (source(cs, "cold_bf_longform").resolvedCount !== 40)
    throw new Error(`resolved ${source(cs, "cold_bf_longform").resolvedCount}, expected 40`);
  await retry(() => api("POST", "/api/dev", { action: "fastForwardReadwise" }));
  const feed = (await retry(() => api("GET", "/api/feed2?surface=discovery"))).json;
  const bfCard = feed.cards.find((c) => c.cast.hash.startsWith("cold:cold_bf_longform_"));
  if (!bfCard) throw new Error("no rendered card for the resolved bookmark-folder item after fast-forward");
  if (!/bookmarks · Longform/.test(bfCard.readwiseSource ?? ""))
    throw new Error(`bookmark-folder card attribution: "${bfCard.readwiseSource}"`);
});

// ---- 9. PAGE: the settings panel resolves a source and reflects the cap prompt ----
await check("9. PAGE: cold-storage panel resolves astro DMs and shows the cap prompt for Everything", async () => {
  await reset();
  await page.goto(BASE + "/settings/import-x", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  if ((await page.locator("[data-testid=coldstore-panel]").count()) !== 1) throw new Error("cold-storage panel missing");

  await page.locator("[data-testid=coldsource-resolve-cold_dm_astro]").click();
  let done = false;
  for (let i = 0; i < 15 && !done; i++) {
    await page.waitForTimeout(400);
    done = (await page.locator("[data-testid=coldsource-result-cold_dm_astro]").count()) > 0;
  }
  if (!done) throw new Error("resolve button never produced a result message");
  // the result message and the count come from TWO separate state updates
  // (resolve()'s finally block calls refresh() fire-and-forget, unawaited)
  // — the message can render a tick before the count's own re-fetch lands,
  // so poll for the count itself rather than assuming the message implies it
  let resolvedCount = "";
  for (let i = 0; i < 15; i++) {
    resolvedCount = (await page.locator("[data-testid=coldsource-resolved-cold_dm_astro]").innerText()).trim();
    if (resolvedCount === "9") break;
    await page.waitForTimeout(300);
  }
  if (resolvedCount !== "9") throw new Error(`UI resolved count "${resolvedCount}", expected 9`);

  await page.locator("[data-testid=coldsource-resolve-cold_bf_everything]").click();
  let prompted = false;
  for (let i = 0; i < 15 && !prompted; i++) {
    await page.waitForTimeout(400);
    prompted = (await page.locator("[data-testid=coldsource-cap-prompt-cold_bf_everything]").count()) > 0;
  }
  if (!prompted) throw new Error("cap-exceeded resolve never showed the prompt message in the UI");
  const cold = await page.locator("[data-testid=coldsource-cold-cold_bf_everything]").innerText();
  if (cold.trim() !== "3,000") throw new Error(`Everything cold count after refused resolve: "${cold}", expected 3,000`);
});

await reset();
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} UX Gate 3 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
