// X INTEROP GATE 3 — live X destination + SPEND CONTROLS (safety set).
//
// FIXTURE-VERIFIED throughout: no credentials, ENABLE_X_WRITE unset. The
// ledger mechanics are identical in fixture mode — caps enforce on the
// estimated cost, entries record with mode "fixture", and real spend
// (mode "live") is $0.00. Check 8 reports the live-write skip EXPLICITLY.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const VIEWER = id("yeak__");
const AUTHOR = id("gwei_whisperer");
const OUTSIDE = id("drivethru_dave");
const LINK_TEXT = "read the full breakdown https://example.org/x3/costs and tell me where it breaks";

// the most recent seeded root post by the author — the real-overlap subject
const gweiPost = JSON.parse(readFileSync("seed/data/posts.json", "utf8"))
  .posts.filter((p) => p.authorPersonaId === AUTHOR && !p.replyToHash)
  .sort((a, b) => a.minutesAgo - b.minutesAgo)[0];

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
const viewAs = async (pid) => {
  await api("POST", "/api/dev", { action: "viewAs", personaId: pid });
  await page.waitForTimeout(100);
};
const link = (fixtureHandle) => retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle }));
const beginRun = (label) => retry(() => api("POST", "/api/x/spend", { action: "beginRun", label }));
const spend = async () => (await retry(() => api("GET", "/api/x/spend"))).json;
// a costed publish under the 2% synthetic failure: retry 503s (transient
// adapter noise) but return refusals (402) and success untouched
async function post(body, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await api("POST", "/api/crosspost", body);
    if (last.status !== 503) return last;
  }
  return last;
}

console.log("\nX Interop Gate 3 — live destination + spend controls");

// ---- 1. the fixture crosspost lifecycle, gated and honest ----
await check("1. Lifecycle: estimate (rate card + lastVerified) → confirm gate → publish → ref + ledger entry", async () => {
  await reset();
  await beginRun("x3t1");
  await viewAs(VIEWER);
  await link("yeak_offchain");
  // flake-hardening: settle the fan-out (2% silent destination drop) before the original assertions
  const est = await retryContent(
    () => api("GET", "/api/crosspost?text=" + encodeURIComponent(LINK_TEXT)),
    (r) => r.status >= 200 && r.status < 300 && r.json?.destinations?.some((d) => d.id === "x"),
    4
  );
  const x = est.json.destinations.find((d) => d.id === "x");
  if (!x) throw new Error("X destination not offered after linking");
  if (x.cost.amount !== 0.195) throw new Error(`link-post estimate ${x.cost.amount}, rate card says 0.195`);
  if (x.rateCardVerified !== "2026-08-01") throw new Error("rate-card lastVerified missing from the estimate");

  // above $0.10 without confirmation → 402, and NOTHING spent or posted
  const refused = await post({ castHash: "0xx3a", text: LINK_TEXT, destinationIds: ["x"] });
  if (refused.status !== 402 || refused.json.cap !== "per_action_confirm")
    throw new Error(`unconfirmed publish: ${refused.status}/${refused.json.cap}`);
  if ((await spend()).entries.length !== 0) throw new Error("a refused publish left a ledger entry");

  const sent = await post({ castHash: "0xx3a", text: LINK_TEXT, destinationIds: ["x"], confirmSpend: true });
  if (sent.status !== 200) throw new Error(`confirmed publish failed: ${sent.status} ${sent.json.error ?? ""}`);
  const ref = sent.json.published[0].externalRef;
  if (!ref?.startsWith("x:post:")) throw new Error("no external ref");

  // the degradation contract: what the destination received IS the preview
  const got = (await retry(() => api("POST", "/api/dev", { action: "lastReceived", destinationId: "x" }))).json.received;
  if (got.text !== x.degradation.deliveredText) throw new Error("delivered text differs from the preview");

  const ledger = await spend();
  if (ledger.entries.length !== 1) throw new Error(`${ledger.entries.length} ledger entries, expected 1`);
  if (ledger.entries[0].amount !== 0.195 || ledger.entries[0].kind !== "publish")
    throw new Error("ledger entry wrong");
  if (ledger.entries[0].mode !== "fixture") throw new Error("fixture spend not marked fixture");
  if (ledger.totals.liveTotal !== 0) throw new Error("live spend total nonzero in a fixture run");

  const evs = await retry(() => api("GET", "/api/eventlog"));
  const ev = evs.json.events.find((e) => e.type === "crosspost" && e.triggeringCastId === "0xx3a");
  if (ev?.externalRef !== ref) throw new Error("event log missing the ref");
});

// ---- 2. SAFETY: the 50-send loop stops at the caps with zero past them ----
await check("2. SAFETY: 50-send loop — per-run cap stops it, then the day cap; 0 sends past either", async () => {
  await reset();
  await viewAs(VIEWER);
  await link("yeak_offchain");
  await beginRun("x3caps-a");
  let successes = 0;
  let refusedRun = 0;
  let successAfterRefusal = false;
  for (let i = 0; i < 50; i++) {
    const r = await post({ castHash: "0xx3cap" + i, text: LINK_TEXT, destinationIds: ["x"], confirmSpend: true });
    if (r.status === 200) {
      if (refusedRun > 0) successAfterRefusal = true;
      successes++;
    } else if (r.status === 402 && r.json.cap === "per_run") refusedRun++;
    else throw new Error(`send ${i}: unexpected ${r.status} ${r.json?.error ?? ""}`);
  }
  if (successes !== 5) throw new Error(`${successes} sends before the $1 run cap, expected 5 (5 × $0.195)`);
  if (refusedRun !== 45) throw new Error(`${refusedRun} run-cap refusals, expected 45`);
  if (successAfterRefusal) throw new Error("A SEND WENT THROUGH AFTER A CAP REFUSAL — queue-and-retry behaviour");

  // a fresh run frees the run cap but the DAY cap still binds
  await beginRun("x3caps-b");
  let second = 0;
  for (let i = 0; i < 10; i++) {
    const r = await post({ castHash: "0xx3day" + i, text: LINK_TEXT, destinationIds: ["x"], confirmSpend: true });
    if (r.status === 200) second++;
    else if (r.status === 402 && r.json.cap === "per_day") break;
    else if (r.status === 402 && r.json.cap === "per_run") throw new Error("run cap fired before the day cap");
  }
  if (second !== 5) throw new Error(`${second} sends in run 2 before the day cap, expected 5 ($1.95 of $2)`);
  await beginRun("x3caps-c");
  const overDay = await post({ castHash: "0xx3over", text: LINK_TEXT, destinationIds: ["x"], confirmSpend: true });
  if (overDay.status !== 402 || overDay.json.cap !== "per_day")
    throw new Error("a fresh run bypassed the daily cap");
  const ledger = await spend();
  if (ledger.totals.today !== 1.95) throw new Error(`day total ${ledger.totals.today}, expected exactly 1.95`);
});

// ---- 3. the double-post guard ----
await check("3. Double-post: injected failure + retry → exactly one ref; a duplicate send dedupes to the same ref", async () => {
  await reset();
  await viewAs(VIEWER);
  await link("yeak_offchain");
  await beginRun("x3dbl");
  await retry(() => api("POST", "/api/dev", { action: "forceFail", label: "destination.x_live.publish", count: 1 }));
  const failed = await api("POST", "/api/crosspost", {
    castHash: "0xx3dbl",
    text: LINK_TEXT,
    destinationIds: ["x"],
    confirmSpend: true,
  });
  if (failed.status !== 503) throw new Error(`injected failure returned ${failed.status}`);
  if ((await spend()).entries.length !== 0) throw new Error("a failed publish recorded spend");

  // the client retry: check-before-retry finds no landed post → publishes once
  const retried = await post({ castHash: "0xx3dbl", text: LINK_TEXT, destinationIds: ["x"], confirmSpend: true });
  if (retried.status !== 200) throw new Error("retry after failure did not converge");
  const ref = retried.json.published[0].externalRef;

  // a deliberate duplicate: same idempotency key → same ref, no new spend
  const dup = await post({ castHash: "0xx3dbl", text: LINK_TEXT, destinationIds: ["x"], confirmSpend: true });
  if (dup.json.published[0].externalRef !== ref) throw new Error("duplicate send produced a second ref");
  if (!dup.json.published[0].deduped) throw new Error("duplicate not marked deduped");
  const ledger = await spend();
  if (ledger.entries.length !== 1) throw new Error(`${ledger.entries.length} spend entries after dup, expected 1`);
  const evs = await retry(() => api("GET", "/api/eventlog"));
  const refs = evs.json.events.filter((e) => e.type === "crosspost" && e.triggeringCastId === "0xx3dbl");
  if (refs.length !== 1) throw new Error(`${refs.length} crosspost events, expected exactly 1`);
});

// ---- 4. owned-reads sync: incremental, costed, linked-only ----
await check("4. Owned-reads sync: on-demand, incremental via cursor, every request in the ledger", async () => {
  const first = await retry(() => api("POST", "/api/x/sync", { kind: "bookmarks" }));
  if (first.json.mode !== "fixture") throw new Error("sync mode not reported fixture");
  if (first.json.newItems !== 2) throw new Error(`first sync ${first.json.newItems} new, expected 2`);
  const second = await retry(() => api("POST", "/api/x/sync", { kind: "bookmarks" }));
  if (second.json.newItems !== 0) throw new Error("second sync re-pulled — not incremental");
  const follows = await retry(() => api("POST", "/api/x/sync", { kind: "follows" }));
  if (follows.json.newItems !== 1) throw new Error(`follow sync ${follows.json.newItems} new, expected 1`);
  const ledger = await spend();
  const reads = ledger.entries.filter((e) => e.kind === "read_sync");
  if (reads.length !== 3) throw new Error(`${reads.length} read_sync entries, expected 3`);
  const priv = (await retry(() => api("GET", "/api/x/import"))).json.privateImports;
  if (!priv.some((r) => r.text.includes("sequencer decentralization postmortem")))
    throw new Error("synced bookmark did not land in private imports");
  // unlinked persona: refused, not silently empty
  await viewAs(OUTSIDE);
  const refused = await api("POST", "/api/x/sync", { kind: "bookmarks" });
  if (refused.status !== 409) throw new Error(`unlinked sync returned ${refused.status}, expected 409`);
  await viewAs(VIEWER);
});

// ---- 5. collapse uses REAL overlap where the following import provides it ----
await check("5. Real overlap: viewer's imported X follows collapse the author's crosspost; others see both", async () => {
  await reset();
  await viewAs(VIEWER);
  await link("yeak_offchain");
  // import ONLY the following lane — the migration source is the overlap data
  const begun = await retry(() => api("POST", "/api/x/import", { action: "begin" }));
  await retry(() => api("POST", "/api/x/import", { action: "ingestFixture", sessionId: begun.json.sessionId }));
  // BYX G3: the follow list needs the fingerprint warning acknowledged
  await retry(() => api("POST", "/api/x/import", { action: "commit", sessionId: begun.json.sessionId, lanes: ["following"], acknowledgedFingerprintWarning: true }));

  // the author links the handle whose platform id is in the viewer's import
  await viewAs(AUTHOR);
  await link("gwei_whisperer_x");
  const sent = await post({
    castHash: gweiPost.hash,
    text: gweiPost.text,
    destinationIds: ["x"],
    confirmSpend: true,
  });
  if (sent.status !== 200) throw new Error("author crosspost failed: " + (sent.json.error ?? sent.status));

  // the rendering decision, through the REAL path (decorateCrossposts — the
  // function the classic feed calls), against genuine state: the author's
  // attestation, the viewer's hashed migration source, the crosspost record.
  // (Local casts author as session personas while attestations land on
  // seeded personas, so this staging is only reachable through the probe —
  // page-level chip rendering itself is covered in b2 t5.)
  const importing = await retry(() =>
    api("POST", "/api/dev", {
      action: "decorateProbe",
      castHash: gweiPost.hash,
      authorPersonaId: AUTHOR,
      viewerPersonaId: VIEWER,
    })
  );
  if (importing.json.copies !== 1)
    throw new Error(`importing viewer gets ${importing.json.copies} copies, expected 1 (real overlap)`);
  if (!importing.json.chip) throw new Error("probably-seen chip missing for the overlapping viewer");

  const outside = await retry(() =>
    api("POST", "/api/dev", {
      action: "decorateProbe",
      castHash: gweiPost.hash,
      authorPersonaId: AUTHOR,
      viewerPersonaId: OUTSIDE,
    })
  );
  if (outside.json.copies !== 2)
    throw new Error(`non-importing viewer gets ${outside.json.copies} copies, expected 2`);
  if (outside.json.mirrors !== 1) throw new Error("mirror copy missing for the non-overlapping viewer");
  await viewAs(null);
});

// ---- 6. PAGE: the money shot — live-rate estimate with its verification date ----
await check("6. PAGE: composer shows the live-rate estimate, its lastVerified date, and the confirm control", async () => {
  await reset();
  await viewAs(VIEWER);
  await link("yeak_offchain");
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // Poll for the composer to actually render before touching it — /home's
  // many retried mock adapter calls can outlast a flat wait under full-
  // sweep load, and a bare .click() then burns its 30s timeout and reports
  // INFRA (surfaced in a crypto-pass 4-sweep). One reload midway covers a
  // render that never settled. "poll for settled content, not a flat wait."
  const composerReady = await pollUntil(
    async () => (await page.locator("[data-testid=composer-input]").count()) >= 1,
    { tries: 20, delayMs: 400, midway: () => page.reload({ waitUntil: "networkidle" }) }
  );
  if (!composerReady) throw new Error("composer did not render on /home");
  await page.locator("[data-testid=composer-input]").first().click();
  await page.locator("[data-testid=composer-input]").first().fill(LINK_TEXT);
  const toggleReady = await pollUntil(
    async () => (await page.locator("[data-testid=crosspost-x]").count()) === 1,
    { tries: 20, delayMs: 400 }
  );
  if (!toggleReady) throw new Error("crosspost toggle did not appear in the composer");
  await page.locator("[data-testid=crosspost-x]").click();
  // flake-hardening: pollUntil + retryContent; an off/on re-toggle between attempts forces a fresh estimate fetch (no reload — composer text is client state); original assertion unchanged
  let firstAttempt = true;
  const note = await retryContent(
    async () => {
      if (!firstAttempt) {
        await page.locator("[data-testid=crosspost-x]").click();
        await page.locator("[data-testid=crosspost-x]").click();
      }
      firstAttempt = false;
      const rendered = await pollUntil(
        async () => (await page.locator("[data-testid=cost-note-x]").count()) === 1,
        { tries: 20, delayMs: 400 }
      );
      return rendered ? await page.locator("[data-testid=cost-note-x]").innerText() : "";
    },
    (n) => /0\.195/.test(n),
    3
  );
  if (!/0\.195/.test(note)) throw new Error(`cost note: "${note}"`);
  if (!(await page.locator("[data-testid=rate-verified-x]").innerText()).includes("2026-08-01"))
    throw new Error("rate-card verification date missing from the composer");
  if ((await page.locator("[data-testid=confirm-spend]").count()) !== 1)
    throw new Error("confirm control missing for an above-threshold spend");
  await viewAs(null);
});

// ---- 7. structural: spend mutations live in ONE file ----
await check("7. SAFETY: spend-ledger writes are pinned to lib/x/spend.ts", async () => {
  for (const pattern of ["xSpend.set(", "xPublished.set("]) {
    const hits = execSync(`grep -rl "${pattern.replace(/\(/g, "(")}" lib app --include=*.ts --include=*.tsx`, { encoding: "utf8" })
      .trim().split(/\r?\n/).filter(Boolean)
      .map((f) => f.replace(/\\/g, "/"));
    const outside = hits.filter((f) => !f.endsWith("lib/x/spend.ts"));
    if (outside.length) throw new Error(`"${pattern}" outside the ledger: ${outside.join(", ")}`);
  }
});

// ---- 8. the live-write test, reported honestly ----
await check("8. Live-write: SKIPPED — no X credentials and ENABLE_X_WRITE unset (FIXTURE-VERIFIED pass; real spend $0.00)", async () => {
  if (process.env.X_API_CLIENT_ID && process.env.ENABLE_X_WRITE === "true") {
    throw new Error("live credentials present — this suite build predates the live-write path");
  }
  const ledger = await spend();
  if (ledger.totals.liveTotal !== 0) throw new Error("live spend recorded in a fixture environment");
});

await reset();
await viewAs(null);
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} X Gate 3 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
