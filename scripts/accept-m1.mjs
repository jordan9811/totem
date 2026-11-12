// MEGA GATE 1 — disclosure tiers, for real.
//
// Six tests. Each tier proves BOTH cases: a granted viewer sees the merged
// identity, and a non-granted viewer sees the bare persona — byte-identical
// to what a stock client would show.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const byHandle = new Map(personas.map((p) => [p.handle, p]));
const id = (h) => byHandle.get(h)?.id;

let failures = 0;
const results = [];
const ok = (n) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n);
};
const fail = (n, d) => {
  const infra = isInfraError(d);
  if (!infra) failures++;
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
const page = await ctx.newPage();

async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
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

/** Resolve `handle` as seen by `viewerHandle` (null = anonymous). */
async function seenBy(handle, viewerHandle) {
  const viewer = viewerHandle === null ? "" : id(viewerHandle);
  const r = await retry(() =>
    api("GET", `/api/identity?handle=${handle}&viewerPersonaId=${viewer}`)
  );
  return r.json.identity;
}

/** Render a profile PAGE as a given persona and read the DOM. */
async function pageAs(handle, viewerHandle) {
  // retry transient viewAs failures so a stale previous viewer can't yield a false leak verdict
  await retryContent(
    () => api("POST", "/api/dev", { action: "viewAs", personaId: viewerHandle ? id(viewerHandle) : null }),
    (r) => r.status === 200,
    3
  );
  await page.waitForTimeout(200);
  await page.goto(BASE + "/" + handle, { waitUntil: "networkidle" });
  // poll for the linked-identities render instead of a flat wait; absence sites just get a bounded settle
  await pollUntil(async () => (await page.locator("[data-testid='linked-identities']").count()) > 0, {
    tries: 8,
    delayMs: 300,
    midway: () => page.reload({ waitUntil: "networkidle" }),
  });
  const linked = await page.locator("[data-testid='linked-identities']").count();
  const body = await page.locator("body").innerText();
  return { linked, body };
}

console.log("\nMega Gate 1 — Disclosure tiers");
await api("POST", "/api/dev", { action: "resetSeed" });
// poll a known seed marker instead of a fixed sleep
await pollUntil(
  async () =>
    (await api("GET", "/api/identity?handle=basisrisk&viewerPersonaId=")).json?.identity?.linked?.tier === "public",
  { tries: 8, delayMs: 300 }
);

// ---- 1. PUBLIC ----
await check("1. PUBLIC: link is visible to anyone, including an anonymous viewer", async () => {
  // settle through fail-closed degraded rounds before asserting
  const anon = await retryContent(() => seenBy("basisrisk", null), (r) => r && !r.degraded, 4);
  if (!anon.linked) throw new Error("public link not visible to anonymous viewer");
  if (anon.linked.handle !== "duskorbiter") throw new Error("wrong sibling: " + anon.linked.handle);
  if (anon.linked.tier !== "public") throw new Error("tier: " + anon.linked.tier);
  // A public link is NOT merged rendering — it was given to everyone, so it
  // shows as a linked-identities fact, not as a card addressed to you.
  if (anon.merged) throw new Error("public link should not render merged");

  const stranger = await seenBy("basisrisk", "crustcritic");
  if (!stranger.linked) throw new Error("public link invisible to a logged-in stranger");
});

// ---- 2. WHITELIST ----
await check("2. WHITELIST: granted viewer sees merged; non-granted sees the bare persona", async () => {
  // settle through fail-closed degraded rounds before asserting
  const granted = await retryContent(() => seenBy("brothandbones", "crustcritic"), (r) => r && !r.degraded, 4); // on the whitelist
  if (!granted.merged) throw new Error("whitelisted viewer did not get merged rendering");
  if (!granted.displayName.includes("/")) throw new Error("no combined display name: " + granted.displayName);
  if (granted.linked?.handle !== "linescoreluke") throw new Error("wrong sibling");
  if (granted.linked?.tier !== "whitelist") throw new Error("tier: " + granted.linked?.tier);

  const outsider = await seenBy("brothandbones", "drivethru_dave"); // NOT on the whitelist
  if (outsider.merged) throw new Error("FAIL-OPEN: non-granted viewer got merged rendering");
  if (outsider.linked) throw new Error("FAIL-OPEN: non-granted viewer learned the linkage");
  if (outsider.displayName !== byHandle.get("brothandbones").name)
    throw new Error("bare render is not byte-identical: " + outsider.displayName);

  const anon = await seenBy("brothandbones", null);
  if (anon.linked) throw new Error("FAIL-OPEN: anonymous viewer learned a whitelist linkage");
});

// ---- 3. OPT-IN ----
await check("3. OPT-IN: does not resolve on sight; resolves after a request, which is recorded", async () => {
  const before = await seenBy("startsitsam", "drivethru_dave");
  if (before.linked) throw new Error("opt-in link resolved without a request");

  await retry(() =>
    api("POST", "/api/identity/grant", {
      action: "request",
      fromPersona: "startsitsam",
      toPersona: "deephistorydan",
      requesterPersona: "drivethru_dave",
    })
  );

  // settle through fail-closed degraded rounds before asserting
  const after = await retryContent(() => seenBy("startsitsam", "drivethru_dave"), (r) => r && !r.degraded && r.linked, 4);
  if (!after.linked) throw new Error("opt-in link did not resolve after a request");
  if (after.linked.tier !== "opt_in") throw new Error("tier: " + after.linked.tier);
  if (!after.merged) throw new Error("opt-in should render merged for the requester");

  // Someone else asking must not resolve it for a third party.
  const other = await seenBy("startsitsam", "crustcritic");
  if (other.linked) throw new Error("FAIL-OPEN: request by one viewer resolved it for another");
});

// ---- 4. WHO ASKED ----
await check("4. The 'who asked' list populates on opt-in resolution", async () => {
  // content-aware retry: a 200 with a dropped whoAsked row is incomplete, not proof of absence
  const r = await retryContent(
    () => retry(() => api("GET", `/api/identity/grant?personaId=${id("startsitsam")}`)),
    (x) => (x.json.whoAsked ?? []).some((y) => y.requesterPersona === id("drivethru_dave"))
  );
  const asked = r.json.whoAsked ?? [];
  const found = asked.find((x) => x.requesterPersona === id("drivethru_dave"));
  if (!found) throw new Error("requester not recorded in the who-asked list");
  if (!found.requestedAt) throw new Error("no timestamp on the request record");
});

// ---- 5. HIDDEN ----
await check("5. HIDDEN is absence: no grant exists, and nobody resolves it", async () => {
  for (const viewer of ["crustcritic", "yeak__", "drivethru_dave", null]) {
    const seen = await seenBy("aperture_annie", viewer);
    if (seen.linked)
      throw new Error(`FAIL-OPEN: hidden linkage resolved for ${viewer ?? "anonymous"}`);
    if (seen.merged) throw new Error("hidden linkage rendered merged");
  }
  // Assert ABSENCE, not a flag: there is no grant row for this pair at all.
  const r = await retry(() => api("GET", `/api/identity/grant?personaId=${id("aperture_annie")}`));
  const rows = (r.json.grants ?? []).filter(
    (g) => g.toPersona === id("collimationking") || g.fromPersona === id("collimationking")
  );
  if (rows.length > 0) throw new Error("a grant row exists for a 'hidden' pair — hidden must be absence");
});

// ---- 6. REVOKE + FAIL-CLOSED ----
await check("6. Revoke removes merged rendering without deleting history; a failed check renders BARE", async () => {
  // revoke the whitelist grant naming crustcritic
  // content-aware retry: don't abort the check on a 200 that dropped the live grant row
  const list = await retryContent(
    () => retry(() => api("GET", `/api/identity/grant?personaId=${id("brothandbones")}`)),
    (x) => (x.json.grants ?? []).some((g) => g.audienceMember === id("crustcritic") && g.revokedAt === null)
  );
  const target = (list.json.grants ?? []).find(
    (g) => g.audienceMember === id("crustcritic") && g.revokedAt === null
  );
  if (!target) throw new Error("no live whitelist grant to revoke");

  await retry(() => api("POST", "/api/identity/grant", { action: "revoke", grantId: target.id }));

  const after = await seenBy("brothandbones", "crustcritic");
  if (after.merged || after.linked) throw new Error("revoked grant still resolves");

  // History survives — they cannot unlearn it and we do not pretend otherwise.
  // content-aware retry: a dropped tombstone row on a 200 must not read as data loss
  const post = await retryContent(
    () => retry(() => api("GET", `/api/identity/grant?personaId=${id("brothandbones")}`)),
    (x) => (x.json.grants ?? []).some((g) => g.id === target.id)
  );
  const tomb = (post.json.grants ?? []).find((g) => g.id === target.id);
  if (!tomb) throw new Error("revoke deleted the record instead of tombstoning it");
  if (!tomb.revokedAt) throw new Error("tombstone has no revokedAt");

  // FAIL CLOSED: under failure injection a grant check must render the BARE
  // persona, never the merged one. Failing closed = failing to LESS disclosure.
  await api("POST", "/api/dev", { action: "maxLatency", on: true });
  try {
    for (let i = 0; i < 10; i++) {
      const seen = await seenBy("brothandbones", "yeak__"); // still whitelisted
      if (seen.merged && !seen.linked)
        throw new Error("merged render with no linkage payload — inconsistent");
      if (seen.degraded && seen.merged)
        throw new Error("FAIL-OPEN: degraded resolve produced a MERGED render");
    }
  } finally {
    await api("POST", "/api/dev", { action: "maxLatency", on: false });
  }
});

// ---- 7. PAGE-LEVEL (the surface that actually ships) ----
await check("7. PAGE render honours the grant: granted page shows the link, non-granted page does not", async () => {
  // This test exists because tests 1-6 drive /api/identity directly while
  // the PAGE resolves through activeSeedPersonaId(). Asserting only the API
  // left the rendered surface — the thing users actually see — unverified,
  // and a real leak sat behind that gap.
  // Test 6 revokes the crustcritic grant, so restore the seeded graph first —
  // otherwise this asserts against a grant the previous test deliberately killed.
  await api("POST", "/api/dev", { action: "resetSeed" });
  await page.waitForTimeout(700);

  // retry a degraded (bare) render before asserting; a genuine miss still fails below
  const granted = await retryContent(() => pageAs("brothandbones", "crustcritic"), (r) => r.linked > 0, 3);
  if (granted.linked === 0) throw new Error("granted viewer PAGE did not render the linkage");
  if (!granted.body.includes("linescoreluke")) throw new Error("granted page missing linked handle");

  const outsider = await pageAs("brothandbones", "drivethru_dave");
  if (outsider.linked > 0) throw new Error("FAIL-OPEN: non-granted PAGE rendered the linkage");
  if (outsider.body.includes("linescoreluke")) throw new Error("FAIL-OPEN: linked handle in non-granted page text");
  if (outsider.body.includes("Line Score Luke")) throw new Error("FAIL-OPEN: linked name in non-granted page text");

  const hidden = await pageAs("aperture_annie", "crustcritic");
  if (hidden.linked > 0) throw new Error("FAIL-OPEN: hidden linkage rendered on the page");

  await api("POST", "/api/dev", { action: "viewAs", personaId: null });
});

await browser.close();
const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Mega Gate 1 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
