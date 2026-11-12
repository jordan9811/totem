// FC PASS GATE 3 — real writes: ledger, caps, identity rule,
// check-before-retry. FIXTURE-VERIFIED: no credentials, ENABLE_FC_WRITE
// unset, zero network writes — the machinery is what fixture mode proves,
// and the live transport swaps in behind the same seam when Gate 1's
// throwaway credentials exist.
//
// The exactly-one assertions read the fixture NETWORK (what the sim
// "remote" actually holds), never the ledger's claim about itself — a
// ledger that lies would pass a ledger-only test.
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
const page = await (await browser.newContext()).newPage();

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
const write = (body) => api("POST", "/api/fc/write", body);
const ledger = async () => (await retry(() => api("GET", "/api/fc/write"))).json;
const simNetwork = async () =>
  (await retry(() => api("POST", "/api/dev", { action: "fcSimNetwork" }))).json.casts;

console.log("\nFC Gate 3 — write ledger, caps, identity, check-before-retry (fixture)");

// ---- 1. a fixture publish lands, ledgered, mode explicit ----
await check("1. Publish lands through the ledger; mode is explicitly fixture; the sim network holds it", async () => {
  await reset();
  const r = await retry(() => write({ action: "cast", text: "fc gate3 first [layers-test fixture]" }));
  if (!r.json.hash) throw new Error("no hash returned");
  if (r.json.mode !== "fixture") throw new Error(`mode ${r.json.mode}, expected fixture`);
  const l = await ledger();
  // THE safety invariant for sweeps is that writes are DISARMED, not that
  // credentials are absent. Post-Gate-1 the throwaway creds legitimately
  // exist on disk; creds-present + writeEnabled-false is the correct state,
  // and asserting the absence of creds would now fail for the wrong reason.
  if (l.writeEnabled !== false) throw new Error("writeEnabled not false — sweeps must never run armed");
  const sent = l.entries.filter((e) => e.mode === "fixture" && e.kind === "cast" && e.status === "sent");
  if (sent.length !== 1) throw new Error(`expected 1 sent cast entry, got ${sent.length}`);
  const net = await simNetwork();
  if (net.length !== 1) throw new Error(`sim network holds ${net.length} casts, expected 1`);
});

// ---- 2. SAFETY: the daily cast cap refuses loudly with zero network attempts after refusal ----
await check("2. SAFETY: cast cap (10/day) refuses the 11th loudly; the refusal makes zero network attempts", async () => {
  // 9 more (1 landed in test 1) — distinct texts, distinct content hashes
  for (let i = 2; i <= 10; i++) {
    await retry(() => write({ action: "cast", text: `fc gate3 cap filler ${i} [layers-test fixture]` }));
  }
  const before = (await simNetwork()).length;
  if (before !== 10) throw new Error(`setup: sim network ${before}, expected 10`);

  const refused = await write({ action: "cast", text: "fc gate3 the 11th [layers-test fixture]" });
  if (refused.status !== 429) throw new Error(`11th cast returned ${refused.status}, expected 429`);
  if (refused.json.cap !== "casts_per_day") throw new Error(`cap "${refused.json.cap}", expected casts_per_day`);

  const after = (await simNetwork()).length;
  if (after !== before) throw new Error("a REFUSED cast still reached the network");
  const l = await ledger();
  if (l.entries.some((e) => e.note.includes("the 11th")))
    throw new Error("a refused cast left a ledger entry — the cap must gate before the ledger opens");
});

// ---- 3. SAFETY: the total-actions cap ----
await check("3. SAFETY: total-actions cap (30/day) refuses the 31st action", async () => {
  // 10 casts so far; likes are actions too — fill to 30
  for (let i = 0; i < 20; i++) {
    await retry(() => write({ action: "like", targetHash: `0xtarget${i}` }));
  }
  const l = await ledger();
  if (l.ledger.fixture.today !== 30) throw new Error(`ledger counts ${l.ledger.fixture.today} actions, expected 30`);
  const refused = await write({ action: "like", targetHash: "0xtarget31" });
  if (refused.status !== 429) throw new Error(`31st action returned ${refused.status}, expected 429`);
  if (refused.json.cap !== "actions_per_day") throw new Error(`cap "${refused.json.cap}", expected actions_per_day`);
});

// ---- 4. THE ADVERSARIAL ONE: mid-publish kill → retry → exactly one cast ----
await check("4. SAFETY: connection killed mid-publish; the retry CHECKS before re-sending — exactly one cast exists", async () => {
  await reset();
  await retry(() => api("POST", "/api/dev", { action: "forceFcPublishDrop", count: 1 }));
  const text = "fc gate3 ambiguous publish [layers-test fixture]";

  const killed = await write({ action: "cast", text });
  if (killed.status !== 502) throw new Error(`dropped publish returned ${killed.status}, expected 502 ambiguous`);
  if (!killed.json.ambiguous) throw new Error("dropped publish not marked ambiguous");

  // the commit happened BEFORE the drop — the network already holds it
  let net = await simNetwork();
  if (net.length !== 1) throw new Error(`after the kill: sim network ${net.length}, expected exactly 1 (commit precedes response)`);

  // ledger must hold the PENDING receipt the retry resumes from
  let l = await ledger();
  const pending = l.entries.filter((e) => e.mode === "fixture" && e.status === "pending");
  if (pending.length !== 1) throw new Error(`expected 1 pending ledger entry, got ${pending.length}`);

  // retry the SAME text: must find the committed cast, not publish again
  const retried = await retry(() => write({ action: "cast", text }));
  if (!retried.json.deduped) throw new Error("retry did not dedupe — it blind-republished");
  net = await simNetwork();
  if (net.length !== 1) throw new Error(`after the retry: sim network ${net.length}, expected exactly 1`);
  l = await ledger();
  if (l.entries.some((e) => e.mode === "fixture" && e.status === "pending"))
    throw new Error("the pending entry never settled after the successful check");
});

// ---- 5. SAFETY: the identity rule, adversarially, zero network ----
await check("5. SAFETY: identity rule — bare probe matches the environment; a SECOND fid's signer always refuses", async () => {
  // Gate 1 has since produced real throwaway credentials, so this suite
  // must be correct in BOTH environments rather than assuming the
  // credential-free one. The bare probe's CORRECT answer depends on
  // whether creds exist; the foreign-identity refusal does not, and is the
  // half that actually guards anything.
  const configured = (await ledger()).throwawayConfigured;
  const bare = await write({ action: "identityProbe" });
  if (configured) {
    if (bare.status !== 200)
      throw new Error(`creds ARE configured, so the bare probe should pass; got ${bare.status}`);
    if (!bare.json.allowed) throw new Error("bare probe refused despite configured creds");
  } else {
    if (bare.status !== 403) throw new Error(`probe with no creds returned ${bare.status}, expected 403`);
    if (!/no throwaway credentials/i.test(bare.json.reason ?? ""))
      throw new Error(`refusal reason wrong: "${bare.json.reason}"`);
  }

  // UNCONDITIONAL: naming some OTHER fid's signer must refuse, always.
  const foreign = await write({ action: "identityProbe", fid: 3, signerUuid: "someone-elses-signer" });
  if (foreign.status !== 403) throw new Error(`foreign-identity probe returned ${foreign.status}, expected 403`);
  // and a foreign fid alone, without a signer, must refuse too
  const foreignFid = await write({ action: "identityProbe", fid: 3 });
  if (foreignFid.status !== 403)
    throw new Error(`foreign-fid probe returned ${foreignFid.status}, expected 403`);
});

// ---- 6. delete works and is ledgered; attribution row retracts with it ----
await check("6. Delete removes the cast from the network, ledgered, attribution retracted", async () => {
  await reset();
  const pub = await retry(() => write({ action: "cast", text: "fc gate3 deletable [layers-test fixture]" }));
  const del = await retry(() => write({ action: "delete", hash: pub.json.hash }));
  if (del.status !== 200) throw new Error(`delete returned ${del.status}`);
  const net = await simNetwork();
  if (net.length !== 0) throw new Error("deleted cast still on the sim network");
  const l = await ledger();
  if (!l.entries.some((e) => e.mode === "fixture" && e.kind === "delete" && e.status === "sent"))
    throw new Error("delete not ledgered");
});

// ---- 7. attribution rides the publish and respects the persona allowlist ----
await check("7. Publish-time attribution refuses a persona outside the viewer's own", async () => {
  const foreign = await write({
    action: "cast",
    text: "fc gate3 forged persona [layers-test fixture]",
    personaId: "persona_acc_crypto_1",
  });
  if (foreign.status !== 403) throw new Error(`foreign-persona publish returned ${foreign.status}, expected 403`);
  const net = await simNetwork();
  if (net.some((c) => c.text.includes("forged persona")))
    throw new Error("a refused attribution still published");
});

await reset();
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} FC Gate 3 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
