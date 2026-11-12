// X INTEROP GATE 2 — archive import. FIXTURE-VERIFIED: no real archive
// exists in /imports, so the constructed fixture (matching X's export
// structure: data/ account.js, tweets.js, like.js, bookmark.js,
// following.js, personalization.js) is the subject. Fixture counts:
//   posts 5 (one dated Mar 2022) · likes 3 · following 4 (bookmark.js: 2, NOT read)
//   personalization: 3 benign, 3 SENSITIVE (health/politics/finances)
//
// PERSONA LAUNCH P2 (BYX G0/G3) — the contract moved, and these checks assert the NEW one:
//   * a fixture link is a TEST link: it never earns a verified import (checks 1, 2 used to assert "verified"); the
//     positive verified path is the Farcaster verification, tested in scripts/accept-x5.mjs R11;
//   * the bookmarks lane is gone (no X archive source lists a bookmarks file): check 5 asserts bookmark.js is NOT read;
//   * the follow list needs the fingerprint warning acknowledged (checks 1, 6, 8 send or tick it; check 1 also
//     asserts the refusal without it);
//   * the fixture ingest is rig-only (this suite runs on the rig).
import { chromium } from "playwright";
import { assertServersUp, isInfraError, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VALIDATOR = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const VIEWER = id("yeak__");
const OTHER = id("crustcritic");
const HANDLE = "yeak_offchain";
// raw platform ids from the fixture following.js — these must NEVER appear
// at rest (the migration source stores hashes only)
const RAW_FOLLOW_IDS = JSON.parse(
  readFileSync("fixtures/x-archive/data/following.js", "utf8").replace(/^window\.YTD\.following\.part0 = /, "")
).map((r) => r.following.accountId);

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
  await api("POST", "/api/dev", { action: "resetSeed" });
  await page.waitForTimeout(400);
};
const viewAs = async (pid) => {
  await api("POST", "/api/dev", { action: "viewAs", personaId: pid });
  await page.waitForTimeout(100);
};
const imp = (body) => retry(() => api("POST", "/api/x/import", body));
async function importFixture() {
  const begun = await imp({ action: "begin" });
  await imp({ action: "ingestFixture", sessionId: begun.json.sessionId });
  const preview = await retry(() => api("GET", "/api/x/import?sessionId=" + begun.json.sessionId));
  return { sessionId: begun.json.sessionId, preview: preview.json };
}
const laneCount = (preview, lane) => preview.lanes.find((l) => l.lane === lane)?.count;

console.log("\nX Interop Gate 2 — archive import");

// ---- 1. all lanes, exact counts, preview === landed ----
await check("1. Fixture archive: preview counts land count-for-count across all lanes", async () => {
  await reset();
  await viewAs(VIEWER);
  await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: HANDLE }));
  const { sessionId, preview } = await importFixture();
  if (preview.session.archiveHandle !== HANDLE) throw new Error("archive identity not read from account.js");
  if (preview.session.verified) throw new Error("a TEST (fixture) link earned a verified import — BYX G0");
  if (preview.lanes.some((l) => l.lane === "bookmarks")) throw new Error("the retired bookmarks lane is offered");
  const expect = { posts: 5, likes: 3, following: 4, personalization: 3 };
  for (const [lane, n] of Object.entries(expect)) {
    if (laneCount(preview, lane) !== n)
      throw new Error(`preview ${lane}=${laneCount(preview, lane)}, expected ${n}`);
  }
  const p13n = preview.lanes.find((l) => l.lane === "personalization");
  if (p13n.sensitiveHeld !== 3) throw new Error(`sensitiveHeld ${p13n.sensitiveHeld}, expected 3`);

  // the follow list without the fingerprint acknowledgement is REFUSED, and nothing lands
  const refused = await api("POST", "/api/x/import", { action: "commit", sessionId, lanes: Object.keys(expect) });
  if (refused.status !== 409 || !/fingerprint/.test(refused.json?.error ?? "")) throw new Error(`commit without the acknowledgement: ${refused.status}`);
  const committed = await imp({ action: "commit", sessionId, lanes: Object.keys(expect), acknowledgedFingerprintWarning: true });
  for (const [lane, n] of Object.entries(expect)) {
    if (committed.json.landed[lane] !== n)
      throw new Error(`landed ${lane}=${committed.json.landed[lane]} != preview ${n}`);
  }
  if (committed.json.heldSensitive !== 3) throw new Error("sensitive items not all held at commit");
});

// ---- 2. original timestamps on the profile ----
await check("2. Imported posts render on the profile with ORIGINAL dates (2022 post says 2022)", async () => {
  await page.goto(BASE + "/" + "yeak__", { waitUntil: "networkidle" });
  // settle the server-rendered profile before asserting (was a fixed 800ms wait)
  await pollUntil(async () => (await page.locator("[data-testid=imported-post]").count()) === 5, {
    tries: 20, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  const section = page.locator("[data-testid=imported-from-x]");
  if ((await section.count()) !== 1) throw new Error("imported-from-x section missing from the profile");
  // BYX G0: the persona's link is a TEST link of the archive's handle — the shelf says exactly that, never "verified"
  const testLink = await page.locator("[data-testid=import-test-link]").count();
  if (testLink !== 1) throw new Error("the shelf does not say 'test link, not verified' for a fixture-linked archive");
  if ((await page.locator("[data-testid=import-verified]").count()) !== 0) throw new Error("a fixture link reads as a verified import");
  const posts = await page.locator("[data-testid=imported-post]").count();
  if (posts !== 5) throw new Error(`profile renders ${posts} imported posts, expected 5`);
  const dates = await page.locator("[data-testid=imported-post-date]").allInnerTexts();
  if (!dates.some((d) => /2022/.test(d))) throw new Error("the 2022 post lost its original date");
  // imports are history, not fresh content: nothing in the discovery feed
  const feed = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  const feedText = JSON.stringify(feed.json);
  if (feedText.includes("basis trade unwinds are never orderly"))
    throw new Error("an imported post leaked into the feed as fresh content");
});

// ---- 3. sensitive items: held everywhere until per-category opt-in ----
await check("3. SAFETY: sensitive inferences appear NOWHERE until category opt-in; opt-in imports exactly that category", async () => {
  // adversarial sweep: claims list and matching surface must not carry them
  const graph = await retry(() => api("GET", "/api/graph"));
  const claimsText = JSON.stringify(graph.json);
  for (const needle of ["Mental health awareness", "Political commentary", "Personal finance and investing"]) {
    if (claimsText.includes(needle)) throw new Error(`sensitive item "${needle}" reached the claims surface`);
  }
  // benign x-inferred claims DID land, clearly distinct from self/attested
  const inferred = (graph.json.claims ?? []).filter((c) => c.source === "x-inferred");
  if (inferred.length !== 3) throw new Error(`${inferred.length} x-inferred claims, expected 3`);
  if (!inferred.some((c) => c.label === "x-inferred: Technology")) throw new Error("benign claim missing");

  // the queue names them; direct import without consent refuses
  const q = (await retry(() => api("GET", "/api/x/import"))).json.sensitiveQueue;
  if (q.length !== 3) throw new Error(`queue holds ${q.length}, expected 3`);
  const health = q.find((x) => x.category === "health");
  const refused = await api("POST", "/api/x/import", { action: "importSensitive", key: health.key });
  if (refused.status !== 409) throw new Error(`no-consent import returned ${refused.status}, expected 409`);

  // opt in to HEALTH only → that one imports; politics/finances stay held
  await retry(() => api("POST", "/api/graph/consent", { category: "health", consented: true }));
  await imp({ action: "importSensitive", key: health.key });
  const after = await retry(() => api("GET", "/api/graph"));
  const healthClaim = (after.json.claims ?? []).find((c) => c.label === "x-inferred: Mental health awareness");
  if (!healthClaim) throw new Error("consented health item did not import");
  if (healthClaim.source !== "x-inferred") throw new Error("imported claim lost its x-inferred provenance");
  const claimsText2 = JSON.stringify(after.json);
  if (claimsText2.includes("Political commentary")) throw new Error("politics item imported without its own consent");
  const q2 = (await retry(() => api("GET", "/api/x/import"))).json.sensitiveQueue;
  if (q2.length !== 2) throw new Error("queue did not shrink by exactly one");
});

// ---- 4. no plaintext following list at rest ----
await check("4. Following list at rest is hashed — raw platform ids appear nowhere in persisted state", async () => {
  const res = await page.request.fetch(VALIDATOR + "/state/xMigrationSource");
  const atRest = await res.text();
  for (const raw of RAW_FOLLOW_IDS) {
    if (atRest.includes(raw)) throw new Error(`raw platform id ${raw} found at rest`);
  }
  const rows = JSON.parse(atRest);
  const n = Array.isArray(rows) ? rows.length : Object.keys(rows).length;
  if (n < 1) throw new Error("migration source is empty — the hashing test would be vacuous");
});

// ---- 5. BYX G3: bookmark.js is NOT read (the bookmarks lane is retired) ----
await check("5. bookmark.js is not read: no bookmarks lane, no archive bookmark among the private imports, no 'X import' folder filled", async () => {
  const { preview } = await importFixture();
  if (!preview.session.files.includes("bookmark.js")) throw new Error("the fixture's bookmark.js was not even seen — the check would be vacuous");
  if (preview.lanes.some((l) => l.lane === "bookmarks")) throw new Error("a bookmarks lane is offered");
  const priv = (await retry(() => api("GET", "/api/x/import"))).json.privateImports ?? [];
  if (priv.some((r) => r.kind === "bookmark")) throw new Error("an archive bookmark landed");
  await page.goto(BASE + "/folders/folder_ximport_" + VIEWER, { waitUntil: "networkidle" });
  if ((await page.locator("[data-testid=imported-bookmark]").count()) !== 0) throw new Error("the X import folder renders bookmarks");
  await retry(() => api("POST", "/api/x/import", { action: "discard", sessionId: preview.session.id }));
});

// ---- 6. idempotency: the same archive twice lands zero new ----
await check("6. Second import of the same archive is a no-op (no duplicates)", async () => {
  const { sessionId } = await importFixture();
  const committed = await imp({
    action: "commit",
    sessionId,
    lanes: ["posts", "likes", "following", "personalization"],
    acknowledgedFingerprintWarning: true,
  });
  for (const [lane, n] of Object.entries(committed.json.landed)) {
    if (n !== 0) throw new Error(`re-import landed ${n} new ${lane} records`);
  }
  await page.goto(BASE + "/" + "yeak__", { waitUntil: "networkidle" });
  // poll for exactly 5 (catches both a slow render and duplicates); was a fixed 600ms wait
  await pollUntil(async () => (await page.locator("[data-testid=imported-post]").count()) === 5, {
    tries: 16, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  if ((await page.locator("[data-testid=imported-post]").count()) !== 5)
    throw new Error("re-import duplicated profile posts");
});

// ---- 7. handle mismatch → unverified import ----
await check("7. Archive whose handle matches no attestation lands as 'unverified import'", async () => {
  await viewAs(OTHER); // crustcritic holds no attestation for yeak_offchain
  const { sessionId, preview } = await importFixture();
  if (preview.session.verified) throw new Error("unattested archive claimed verified");
  await imp({ action: "commit", sessionId, lanes: ["posts"] });
  await page.goto(BASE + "/" + "crustcritic", { waitUntil: "networkidle" });
  // settle the server-rendered profile before asserting (was a fixed 800ms wait)
  await pollUntil(async () => (await page.locator("[data-testid=import-unverified]").count()) === 1, {
    tries: 16, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  if ((await page.locator("[data-testid=import-unverified]").count()) !== 1)
    throw new Error("unverified-import attribution missing");
  await viewAs(null);
});

// ---- 8. resume: an in-flight session survives a refresh ----
await check("8. PAGE: wizard previews the fixture with exact counts; an uncommitted session resumes", async () => {
  await reset();
  await viewAs(VIEWER);
  await page.goto(BASE + "/settings/import-x", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator("[data-testid=import-load-fixture]").click();
  let previewed = false;
  for (let i = 0; i < 20 && !previewed; i++) {
    await page.waitForTimeout(500);
    previewed = (await page.locator("[data-testid=import-preview]").count()) > 0;
  }
  if (!previewed) throw new Error("wizard never reached the preview");
  const posts = await page.locator("[data-testid=lane-count-posts]").innerText();
  if (posts !== "5") throw new Error(`wizard shows ${posts} posts, expected 5`);
  if ((await page.locator("[data-testid=preview-sensitive-held]").count()) !== 1)
    throw new Error("sensitive-held note missing from the preview");

  // refresh WITHOUT committing: the session resumes
  await page.goto(BASE + "/settings/import-x", { waitUntil: "networkidle" });
  // poll for the resume banner; no midway reload — the refresh itself is the behavior under test
  await pollUntil(async () => (await page.locator("[data-testid=import-resumed]").count()) === 1, {
    tries: 20, delayMs: 500,
  });
  if ((await page.locator("[data-testid=import-resumed]").count()) !== 1)
    throw new Error("refresh lost the in-flight session");
  if ((await page.locator("[data-testid=lane-count-posts]").innerText()) !== "5")
    throw new Error("resumed session lost its parsed files");

  // commit from the resumed session — the landed lines render (BYX G3: the follow lane is on, so its fingerprint
  // warning must be acknowledged first; Import is disabled until it is)
  if (!(await page.locator("[data-testid=import-commit]").isDisabled())) throw new Error("Import was enabled before the fingerprint warning was acknowledged");
  await page.locator("[data-testid=import-ack-fingerprint]").check();
  await page.locator("[data-testid=import-commit]").click();
  let done = false;
  for (let i = 0; i < 20 && !done; i++) {
    await page.waitForTimeout(500);
    done = (await page.locator("[data-testid=import-done]").count()) > 0;
  }
  if (!done) throw new Error("commit from the resumed session did not complete");
  await viewAs(null);
});

await reset();
await viewAs(null);
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} X Gate 2 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
