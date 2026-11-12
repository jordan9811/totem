// X INTEROP GATE 4 — follow migration + deferred auto-follow.
//
// THE MATCHING RULE under adversarial test: matching consults ACCOUNT
// ATTESTATIONS only. A handle self-declared anywhere else (a graph claim in
// this suite) harvests ZERO follows. The pending list exists as hashes
// only, at rest and on the wire.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VALIDATOR = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const VIEWER = id("yeak__");
const RESTAKE = id("restakerelle"); // links restakerelle_x BEFORE import → batch match
const DAVE = id("drivethru_dave"); // links randomx_alpha LATER → the deferred moment
const HANNAH = id("handcuffhannah"); // links randomx_beta while EXCLUDED (not seeded-followed)
const LUKE = id("linescoreluke"); // links gwei_whisperer_x while deferred is OFF (not seeded-followed)
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
const migrate = () => retry(() => api("GET", "/api/x/migrate"));
async function importFollowing() {
  const begun = await retry(() => api("POST", "/api/x/import", { action: "begin" }));
  await retry(() => api("POST", "/api/x/import", { action: "ingestFixture", sessionId: begun.json.sessionId }));
  // BYX G3: the follow list needs the fingerprint warning acknowledged (this rig-only matcher reads the fixture lane)
  await retry(() => api("POST", "/api/x/import", { action: "commit", sessionId: begun.json.sessionId, lanes: ["following"], acknowledgedFingerprintWarning: true }));
}

console.log("\nX Interop Gate 4 — follow migration + deferred auto-follow");

// ---- 1. import → match → one-confirm batch, with origins ----
await check("1. Batch: import matches the pre-existing attestation; one confirm follows with origin x-migration", async () => {
  await reset();
  // the attestation EXISTS before the import — a batch match, not deferred
  await viewAs(RESTAKE);
  await link("restakerelle_x");
  await viewAs(VIEWER);
  await link("yeak_offchain");
  await importFollowing();

  // settle the fan-out migrate read to completeness before asserting
  let m = await retryContent(() => migrate(), (r) => r.json.matches.length === 1 && r.json.pendingCount === 3, 4);
  if (m.json.matches.length !== 1) throw new Error(`${m.json.matches.length} matches, expected 1`);
  if (m.json.matches[0].matchedHandle !== "restakerelle") throw new Error("wrong match");
  if (m.json.pendingCount !== 3) throw new Error(`pending ${m.json.pendingCount}, expected 3 hashed non-matches`);

  const done = await retry(() => api("POST", "/api/x/migrate", { action: "migrate" }));
  if (done.json.followed !== 1) throw new Error(`followed ${done.json.followed}, expected 1`);
  // settle the follow/eventlog reads to the expected content before asserting
  const f = await retryContent(() => retry(() => api("GET", "/api/follow")), (r) => r.json.following.includes(RESTAKE), 4);
  if (!f.json.following.includes(RESTAKE)) throw new Error("the follow did not land on the graph");
  const evs = await retryContent(
    () => retry(() => api("GET", "/api/eventlog?target=" + RESTAKE)),
    (r) => (r.json.events ?? []).some((e) => e.type === "follow" && e.context === "x-migration"),
    4
  );
  const ev = (evs.json.events ?? []).find((e) => e.type === "follow" && e.context === "x-migration");
  if (!ev) throw new Error("follow event missing its x-migration origin");
  m = await migrate();
  if (m.json.matches.length !== 0) throw new Error("migrated match still listed");
});

// ---- 2. self-declared handles NEVER match ----
await check("2. ADVERSARIAL: a self-declared handle claim harvests zero follows", async () => {
  // dave declares the handle everywhere he can — without the OAuth
  // attestation none of it is matching material
  await viewAs(DAVE);
  await retry(() =>
    api("POST", "/api/graph", { category: "interests", label: "x-handle: randomx_alpha", value: "true" })
  );
  await viewAs(VIEWER);
  const m = await migrate();
  if (m.json.matches.length !== 0)
    throw new Error("a graph claim produced a migration match — attestations are not the only source");
  await retry(() => api("POST", "/api/x/migrate", { action: "migrate" }));
  const f = await retry(() => api("GET", "/api/follow"));
  if (f.json.following.includes(DAVE)) throw new Error("self-declared claim harvested a follow");
});

// ---- 3. the deferred moment, the exclusion, and the off switch ----
await check("3. Deferred: exclusion suppresses; deferred-off suppresses; a real join auto-follows with both cards", async () => {
  // exclusion: randomx_beta is on the viewer's never-follow list
  await viewAs(VIEWER);
  await retry(() => api("POST", "/api/x/migrate", { action: "prefs", excludedHandles: ["randomx_beta"] }));
  await viewAs(HANNAH);
  await link("randomx_beta");
  await viewAs(VIEWER);
  let f = await retry(() => api("GET", "/api/follow"));
  if (f.json.following.includes(HANNAH)) throw new Error("EXCLUDED handle auto-followed");
  let m = await migrate();
  if ((m.json.notices ?? []).length !== 0) throw new Error("exclusion still produced a notice");

  // deferred off: luke links, nothing fires
  await retry(() => api("POST", "/api/x/migrate", { action: "prefs", deferred: false }));
  await viewAs(LUKE);
  await link("gwei_whisperer_x");
  await viewAs(VIEWER);
  f = await retry(() => api("GET", "/api/follow"));
  if (f.json.following.includes(LUKE)) throw new Error("deferred-off still auto-followed");
  // settle the fan-out matches array before asserting (notices check stays on the same result)
  m = await retryContent(() => migrate(), (r) => r.json.matches.some((x) => x.matchedHandle === "linescoreluke"), 4);
  if ((m.json.notices ?? []).length !== 0) throw new Error("deferred-off still produced a notice");
  // the attested match remains available for the BATCH path instead
  const lm = m.json.matches.find((x) => x.matchedHandle === "linescoreluke");
  if (!lm || lm.alreadyFollowing) throw new Error("attested match not surfaced for batch");

  // deferred on: dave links randomx_alpha → auto-follow + both cards
  await retry(() => api("POST", "/api/x/migrate", { action: "prefs", deferred: true }));
  await viewAs(DAVE);
  await link("randomx_alpha");
  await viewAs(VIEWER);
  // the deferred auto-follow is a side effect of link(); settle the reads before asserting
  f = await retryContent(() => retry(() => api("GET", "/api/follow")), (r) => r.json.following.includes(DAVE), 4);
  if (!f.json.following.includes(DAVE)) throw new Error("deferred join did not auto-follow");
  const evs = await retryContent(
    () => retry(() => api("GET", "/api/eventlog?target=" + DAVE)),
    (r) => (r.json.events ?? []).some((e) => e.type === "follow" && e.context === "x-migration-deferred"),
    4
  );
  if (!(evs.json.events ?? []).some((e) => e.type === "follow" && e.context === "x-migration-deferred"))
    throw new Error("deferred follow missing its origin");
  // settle the fan-out notices before asserting
  m = await retryContent(
    () => migrate(),
    (r) => (r.json.notices ?? []).some((n) => n.kind === "joined" && n.text.includes("@drivethru_dave")),
    4
  );
  const joined = (m.json.notices ?? []).find((n) => n.kind === "joined");
  if (!joined?.text.includes("@drivethru_dave")) throw new Error("follower's joined card missing");
  await viewAs(DAVE);
  // settle the fan-out waiting notice (and its aggregated count) before asserting
  const dm = await retryContent(
    () => migrate(),
    (r) => (r.json.notices ?? []).some((n) => n.kind === "waiting" && n.text.startsWith("1 person was waiting")),
    4
  );
  const waiting = (dm.json.notices ?? []).find((n) => n.kind === "waiting");
  if (!waiting) throw new Error("joiner's waiting card missing");
  if (!waiting.text.startsWith("1 person was waiting"))
    throw new Error(`waiting count wrong: "${waiting.text}"`);
  await viewAs(null);
});

// ---- 4. both cards RENDER through the injection queue ----
await check("4. PAGE: joined and waiting cards render in the feed via their own tenant", async () => {
  await viewAs(VIEWER);
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // poll for the server-rendered card instead of a flat wait; reload midway in case state landed late
  const joined = page.locator("[data-testid=migration-card][data-migration-kind=joined]");
  await pollUntil(async () => (await joined.count()) >= 1, {
    tries: 15,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  if ((await joined.count()) < 1) throw new Error("joined card not rendered in the feed");
  if (!(await joined.first().innerText()).includes("@drivethru_dave"))
    throw new Error("joined card names the wrong account");
  await viewAs(DAVE);
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // poll for the server-rendered card instead of a flat wait; reload midway in case state landed late
  const waiting = page.locator("[data-testid=migration-card][data-migration-kind=waiting]");
  await pollUntil(async () => (await waiting.count()) >= 1, {
    tries: 15,
    delayMs: 400,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  if ((await waiting.count()) < 1) throw new Error("waiting card not rendered for the joiner");
  await viewAs(null);
});

// ---- 5. the pending list is hashes, everywhere ----
await check("5. Pending list carries no plaintext ids — at rest and on the migrate surface", async () => {
  // retry transient validator errors; never scan an error body (that passes the leak check vacuously)
  const atRestRes = await retryContent(() => page.request.fetch(VALIDATOR + "/state/xMigrationSource"), (r) => r.ok(), 4);
  const atRest = await atRestRes.text();
  if (!atRestRes.ok() || !atRest) throw new Error("validator state unreadable — cannot scan for leaks (status " + atRestRes.status() + ")");
  for (const raw of RAW_FOLLOW_IDS) {
    if (atRest.includes(raw)) throw new Error(`raw platform id ${raw} at rest`);
  }
  await viewAs(VIEWER);
  const m = await migrate();
  const text = JSON.stringify(m.json);
  for (const raw of RAW_FOLLOW_IDS) {
    if (text.includes(raw)) throw new Error("raw platform id on the migrate surface");
  }
  if (/hashedId/.test(text)) throw new Error("hashes leak to the client — the surface needs counts and handles only");
});

// ---- 6. PAGE: the migration panel end-to-end ----
await check("6. PAGE: 'N of your X follows are here' → one confirm → followed", async () => {
  await reset();
  await viewAs(RESTAKE);
  await link("restakerelle_x");
  await viewAs(VIEWER);
  await link("yeak_offchain");
  await importFollowing();
  await page.goto(BASE + "/settings/import-x", { waitUntil: "networkidle" });
  // poll for the panel's settled text instead of a flat wait (no reload — the panel is client-fetched)
  await pollUntil(
    async () => (await page.locator("[data-testid=migration-count]").innerText()).includes("1 of your X follows"),
    { tries: 15, delayMs: 400 }
  );
  const count = await page.locator("[data-testid=migration-count]").innerText();
  if (!count.includes("1 of your X follows")) throw new Error(`count line reads "${count}"`);
  const pending = await page.locator("[data-testid=migration-pending]").innerText();
  if (!pending.includes("3 from your list")) throw new Error(`pending line reads "${pending}"`);
  await page.locator("[data-testid=migration-confirm]").click();
  let done = false;
  for (let i = 0; i < 15 && !done; i++) {
    await page.waitForTimeout(400);
    done = (await page.locator("[data-testid=migration-result]").count()) > 0;
  }
  if (!done) throw new Error("confirm never produced a result");
  if (!(await page.locator("[data-testid=migration-result]").innerText()).includes("Followed 1"))
    throw new Error("result line wrong");
  await viewAs(null);
});

await reset();
await viewAs(null);
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} X Gate 4 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
