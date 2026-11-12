// TIER B GATE 3 — InfoFi market extensions on the escrow ledger.
//
// THE MONEY INVARIANT (safety set): every escrowed amount resolves to exactly
// one terminal state — settled, refunded, or lottery — and no path strands or
// double-spends mock funds, including under injected adapter failures.
// Checked here as the conservation identity
//     Δ(sum of balances + held escrow) === 1000 × Δ(accounts)
// which holds through every legitimate flow (new accounts lazily seed at
// 1000) and breaks by a non-1000 amount on any strand or double-spend.
//
// HAND-COMPUTED tip-epoch split (test 6) for the seeded chan_openfloor posts,
// pot = 3 tips × 2 = 6, quadratic weights on likes at close:
//   0xchanopen00  crypto_1  30 likes  √30 = 5.4772256
//   0xchanopen01  crypto_3  46 likes  √46 = 6.7823300
//   0xchanopen02  crypto_5  21 likes  √21 = 4.5825757
//   Σweights = 16.8421313
//   shares (floor 2dp): 1.95 / 2.41 / 1.63  → allocated 5.99
//   remainder 0.01 → highest weight (crypto_3) → FINAL: 1.95 / 2.42 / 1.63
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { assertServersUp, isInfraError, retryContent } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;

const VIEWER = id("yeak__"); // persona_viewer_main
const BUSINESS = id("crustcritic");
const MUTUAL = id("0xledgerline"); // followed by the viewer
const FOLLOWED2 = id("gwei_whisperer"); // followed
const OUTSIDER = id("restakerelle"); // NOT followed

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
const fi = (body) => api("POST", "/api/market/infofi", body);
const fiRetry = (body) => retry(() => fi(body));
const surf = (q) => retry(() => api("GET", "/api/market/infofi?surface=" + q));
const balanceAs = async (pid) => {
  await viewAs(pid);
  return (await surf("balance")).json.balance;
};
const conservation = async () => (await surf("conservation")).json;
const advance = (ms) => fiRetry({ action: "advanceClock", ms });

/** The invariant check: any drift not explained by lazy 1000-seeded accounts
 * is stranded or duplicated money. */
function assertConserved(before, after, label) {
  const drift = after.conservationTotal - before.conservationTotal - 1000 * (after.accounts - before.accounts);
  if (Math.abs(drift) > 0.001)
    throw new Error(`${label}: conservation broken — unexplained drift of ${drift.toFixed(3)}`);
}

console.log("\nTier B Gate 3 — InfoFi market extensions");

// ---- 1. request-priced reads: the seeded request settles on dwell ----
await check("1. Seeded read request: dwell threshold settles, retry is idempotent", async () => {
  await reset();
  const c0 = await conservation();
  await viewAs(VIEWER);
  // settle: retry until the seeded request is present (transient per-item drops), then assert as before
  const inbox = (await retryContent(() => surf("inbox"), (r) => r.json.inbox.length === 1, 4)).json.inbox;
  if (inbox.length !== 1) throw new Error(`expected 1 seeded request, got ${inbox.length}`);
  const req = inbox[0];
  if (req.fromHandle !== "crustcritic") throw new Error(`seeded requester is ${req.fromHandle}`);
  if (req.entityClass !== "businesses") throw new Error(`class ${req.entityClass}, expected businesses`);
  if (req.price !== 25) throw new Error(`business price ${req.price}, expected 25`);

  // below the dwell threshold nothing settles
  let r = await fiRetry({ action: "recordDwell", requestId: req.id, dwellMs: 3000 });
  if (r.json.request.status !== "pending") throw new Error("3s dwell settled a request with an 8s threshold");
  let esc = (await surf("escrow&id=" + req.escrowId)).json.escrow;
  if (esc.status !== "held") throw new Error(`escrow ${esc.status} after sub-threshold dwell`);

  // past the threshold: read, settled, viewer credited
  r = await fiRetry({ action: "recordDwell", requestId: req.id, dwellMs: 9000 });
  if (r.json.request.status !== "read") throw new Error("9s dwell did not settle");
  esc = (await surf("escrow&id=" + req.escrowId)).json.escrow;
  if (esc.status !== "settled") throw new Error(`escrow ${esc.status}, expected settled`);
  if (esc.resolvedTo !== VIEWER) throw new Error("settle went to " + esc.resolvedTo);
  const bal = await balanceAs(VIEWER);
  if (bal !== 1025) throw new Error(`viewer balance ${bal}, expected 1025`);

  // a client retry after the settle is idempotent — no second credit
  r = await fiRetry({ action: "recordDwell", requestId: req.id, dwellMs: 9000 });
  if (r.json.request.status !== "read") throw new Error("idempotent retry changed status");
  if ((await balanceAs(VIEWER)) !== 1025) throw new Error("retry double-credited the read");
  assertConserved(c0, await conservation(), "reads settle");
});

// ---- 2. reads: the window refund ----
await check("2. Unread request refunds when its window closes", async () => {
  const c0 = await conservation();
  await viewAs(OUTSIDER);
  const prices = (await retry(() => api("GET", "/api/market/infofi?surface=prices&personaId=" + VIEWER))).json;
  const expectedPrice = prices.readPrices[prices.yourClass];
  if (!(expectedPrice > 0)) throw new Error(`outsider class ${prices.yourClass} priced ${expectedPrice} — cannot test`);
  const before = await balanceAs(OUTSIDER);
  const r = await fiRetry({ action: "requestRead", toPersona: VIEWER, castHash: "0xcr0012" });
  if (r.json.request.price !== expectedPrice)
    throw new Error(`charged ${r.json.request.price}, rate card says ${expectedPrice}`);
  if (r.json.balance !== before - expectedPrice) throw new Error("hold did not debit the requester");

  await advance(3_700_000); // past the 1h window
  await viewAs(VIEWER);
  const inbox = (await surf("inbox")).json.inbox; // fetch runs the expiry sweep
  if (inbox.some((i) => i.id === r.json.request.id)) throw new Error("expired request still in the inbox");
  const esc = (await surf("escrow&id=" + r.json.request.escrowId)).json.escrow;
  if (esc.status !== "refunded") throw new Error(`escrow ${esc.status}, expected refunded`);
  if ((await balanceAs(OUTSIDER)) !== before) throw new Error("refund did not restore the requester");
  assertConserved(c0, await conservation(), "reads refund");
});

// ---- 3. pay-to-DM: reply refunds, ignoring slashes, mutuals bypass ----
await check("3. DM: reply refunds the sender, ignoring slashes, mutuals pay nothing", async () => {
  await reset();
  const c0 = await conservation();
  // non-mutual pays to land in the inbox
  await viewAs(OUTSIDER);
  let r = await fiRetry({ action: "sendDm", toPersona: VIEWER, text: "collab?" });
  if (!r.json.dm.escrowId) throw new Error("non-mutual DM escrowed nothing");
  const paid = 1000 - r.json.balance;
  if (!(paid > 0)) throw new Error("non-mutual DM did not debit the sender");

  // a reply refunds
  await viewAs(VIEWER);
  await fiRetry({ action: "replyDm", dmId: r.json.dm.id });
  if ((await balanceAs(OUTSIDER)) !== 1000) throw new Error("reply did not refund the sender");

  // ignored past the window: the fee is kept — the spam slash
  await viewAs(OUTSIDER);
  r = await fiRetry({ action: "sendDm", toPersona: VIEWER, text: "bump" });
  const viewerBefore = await balanceAs(VIEWER);
  await advance(3_700_000);
  const swept = await fiRetry({ action: "sweepDms" });
  if (swept.json.slashed < 1) throw new Error("expired DM was not slashed");
  const esc = (await surf("escrow&id=" + r.json.dm.escrowId)).json.escrow;
  if (esc.status !== "settled" || esc.resolvedTo !== VIEWER)
    throw new Error(`slash escrow ${esc.status} → ${esc.resolvedTo}`);
  if ((await balanceAs(VIEWER)) !== viewerBefore + paid) throw new Error("slash fee did not reach the recipient");
  if ((await balanceAs(OUTSIDER)) !== 1000 - paid) throw new Error("slashed sender balance wrong");

  // mutuals bypass: no escrow, no debit
  await viewAs(MUTUAL);
  const mb = await balanceAs(MUTUAL);
  r = await fiRetry({ action: "sendDm", toPersona: VIEWER, text: "hey, free" });
  if (r.json.dm.escrowId !== null) throw new Error("mutual DM escrowed money");
  if ((await balanceAs(MUTUAL)) !== mb) throw new Error("mutual DM debited the sender");
  assertConserved(c0, await conservation(), "dm");
});

// ---- 4. pledge: award inside the window, refusal after it ----
await check("4. Pledge: author awards within the window; the closed window refuses", async () => {
  await reset();
  const c0 = await conservation();
  await viewAs(VIEWER);
  let r = await fiRetry({ action: "createPledge", castHash: "0xcr0013", amount: 10 });
  if (r.json.balance !== 990) throw new Error(`pledger balance ${r.json.balance}, expected 990`);
  const p1 = r.json.pledge;
  // settle: retry until the seeded replier appears in the pool, then assert as before
  const q = (await retryContent(() => retry(() => api("GET", "/api/market/infofi?surface=pledges&castHash=0xcr0013")), (r) => r.json.qualifying?.includes(id("restakerelle")), 4)).json;
  if (!q.qualifying.includes(id("restakerelle")))
    throw new Error("seeded replier missing from the qualifying pool");

  // award to a qualifying replier inside the window
  r = await fiRetry({ action: "awardPledge", pledgeId: p1.id, winnerPersonaId: OUTSIDER });
  if (r.json.pledge.status !== "awarded") throw new Error("award did not land");
  const esc = (await surf("escrow&id=" + p1.escrowId)).json.escrow;
  if (esc.status !== "settled" || esc.resolvedTo !== OUTSIDER) throw new Error("award money went astray");

  // a second pledge whose window lapses: the award path must refuse
  r = await fiRetry({ action: "createPledge", castHash: "0xcr0014", amount: 7 });
  const p2 = r.json.pledge;
  await advance(7_300_000); // past the 2h window
  const refused = await fi({ action: "awardPledge", pledgeId: p2.id, winnerPersonaId: id("0xledgerline") });
  if (refused.status !== 409) throw new Error(`closed-window award returned ${refused.status}, expected 409`);
  if (!/lottery/.test(refused.json.error)) throw new Error("refusal does not name the lottery");
  await fiRetry({ action: "sweepPledges" }); // resolve p2 so it cannot leak into later tests
  assertConserved(c0, await conservation(), "pledge award");
});

// ---- 5. pledge lottery: deterministic draw over the real replier pool ----
await check("5. Lottery: deterministic seeded draw; no-replier pledge refunds", async () => {
  await reset();
  // grow the pool beyond the seeded replier with two composer replies
  await retry(() => api("POST", "/api/signer", {}));
  await retry(() => api("POST", "/api/personas", { name: "B3A", handle: "b3a_" + Date.now().toString(36) }));
  await retry(() => api("POST", "/api/actions/cast", { text: "qualifying reply A", replyToHash: "0xcr0014" }));
  await retry(() => api("POST", "/api/personas", { name: "B3B", handle: "b3b_" + Date.now().toString(36) }));
  await retry(() => api("POST", "/api/actions/cast", { text: "qualifying reply B", replyToHash: "0xcr0014" }));

  await viewAs(VIEWER);
  const r = await fiRetry({ action: "createPledge", castHash: "0xcr0014", amount: 9 });
  const pledge = r.json.pledge;
  // settle: the pool feeds the deterministic mod-N recompute below — retry until complete, then assert as before
  const pool = (await retryContent(() => retry(() => api("GET", "/api/market/infofi?surface=pledges&castHash=0xcr0014")), (r) => r.json.qualifying?.length >= 3 && r.json.qualifying.includes(id("0xledgerline")), 4)).json.qualifying;
  if (pool.length < 3) throw new Error(`pool has ${pool.length} repliers, expected seeded + 2 local`);
  if (!pool.includes(id("0xledgerline"))) throw new Error("seeded replier missing from pool");

  await advance(7_300_000);
  await fiRetry({ action: "sweepPledges" });
  // settle: retry until the pledge is present in the surface, then find and assert as before
  const after = (await retryContent(() => retry(() => api("GET", "/api/market/infofi?surface=pledges&castHash=0xcr0014")), (r) => r.json.pledges.some((p) => p.id === pledge.id), 4)).json
    .pledges.find((p) => p.id === pledge.id);
  if (after.status !== "lottery") throw new Error(`pledge status ${after.status} after sweep`);

  // recompute the documented draw: sha256("lottery:" + pledgeId) mod pool
  const digest = createHash("sha256").update("lottery:" + pledge.id).digest();
  const expected = pool[digest.readUInt32BE(0) % pool.length];
  if (after.winner !== expected)
    throw new Error(`drew ${after.winner}, deterministic recompute says ${expected}`);
  const esc = (await surf("escrow&id=" + pledge.escrowId)).json.escrow;
  if (esc.status !== "lottery" || esc.resolvedTo !== expected) throw new Error("lottery money went astray");

  // a second sweep must not re-draw
  const again = await fiRetry({ action: "sweepPledges" });
  if (again.json.drawn !== 0) throw new Error("second sweep re-drew a resolved pledge");

  // no qualifying repliers → the pledge refunds instead of inventing a winner
  const r2 = await fiRetry({ action: "createPledge", castHash: "0xchanopen00", amount: 5 });
  const before = (await balanceAs(VIEWER));
  await advance(7_300_000);
  await fiRetry({ action: "sweepPledges" });
  const esc2 = (await surf("escrow&id=" + r2.json.pledge.escrowId)).json.escrow;
  if (esc2.status !== "refunded") throw new Error(`no-replier pledge ${esc2.status}, expected refunded`);
  if ((await balanceAs(VIEWER)) !== before + 5) throw new Error("no-replier refund did not land");
});

// ---- 6. tip-gated channel: the hand-computed quadratic split ----
await check("6. Tip epoch: quadratic split matches the hand-computed values exactly", async () => {
  await reset();
  const c0 = await conservation();
  const tippers = [
    [id("0xledgerline"), "0xchanopen00"],
    [id("gwei_whisperer"), "0xchanopen01"],
    [id("restakerelle"), "0xchanopen02"],
  ];
  for (const [pid, hash] of tippers) {
    await viewAs(pid);
    const r = await fiRetry({ action: "tipToCast", castHash: hash });
    if (r.json.balance !== 998) throw new Error(`tip did not debit 2 from ${pid}`);
  }
  // the rule only exists in the tip-gated channel
  await viewAs(id("0xledgerline"));
  const wrongChan = await fi({ action: "tipToCast", channelId: "chan_waiverroom", castHash: "0xchanwaiv00" });
  if (wrongChan.status !== 409) throw new Error("tip accepted in a non-gated channel");

  // the window is real: closing early refuses
  const early = await fi({ action: "closeEpoch" });
  if (early.status !== 409) throw new Error("epoch closed before its window");

  await advance(86_500_000); // past 24h
  const closed = await fiRetry({ action: "closeEpoch" });
  const dist = Object.fromEntries(closed.json.distributions.map((d) => [d.personaId, d.amount]));
  // HAND-COMPUTED (see header): 1.95 / 2.42 / 1.63
  const expect = { [id("0xledgerline")]: 1.95, [id("gwei_whisperer")]: 2.42, [id("restakerelle")]: 1.63 };
  for (const [pid, amt] of Object.entries(expect)) {
    if (dist[pid] !== amt) throw new Error(`${pid} got ${dist[pid]}, hand-computed ${amt}`);
  }
  const sum = closed.json.distributions.reduce((a, d) => a + d.amount, 0);
  if (Math.round(sum * 100) !== 600) throw new Error(`pot paid out ${sum}, expected exactly 6`);
  if ((await balanceAs(id("gwei_whisperer"))) !== 1000.42) throw new Error("winner balance wrong after split");

  // every tip escrow reached its terminal state; a second close refuses
  const epoch = (await surf("epoch")).json.epoch;
  for (const eid of epoch.escrowIds) {
    const esc = (await surf("escrow&id=" + eid)).json.escrow;
    if (esc.status !== "settled") throw new Error(`tip escrow ${esc.status} after close`);
  }
  const reclose = await fi({ action: "closeEpoch" });
  if (reclose.status !== 409) throw new Error("epoch closed twice");
  assertConserved(c0, await conservation(), "tip epoch");
});

// ---- 7. SAFETY SET: the money invariant under injected adapter failures ----
await check("7. SAFETY: conservation holds under forced settle failures; ledger audit clean", async () => {
  // structural: balances mutate only inside the escrow ledger
  const { execSync } = await import("node:child_process");
  const hits = execSync('grep -rl "balances.set(" lib app --include=*.ts --include=*.tsx', { encoding: "utf8" })
    .trim().split(/\r?\n/).filter(Boolean);
  if (hits.length !== 1 || !hits[0].replace(/\\/g, "/").endsWith("lib/market/escrow.ts"))
    throw new Error("balance mutation outside the escrow ledger: " + hits.join(", "));

  await reset();
  const c0 = await conservation();

  // forced transient failures: retry recovers, money moves exactly once
  await viewAs(VIEWER);
  // settle: retry until the seeded request is present before dereferencing inbox[0]
  const inbox = (await retryContent(() => surf("inbox"), (r) => r.json.inbox.length >= 1, 4)).json.inbox;
  await retry(() => api("POST", "/api/dev", { action: "forceFail", label: "settle.record", count: 2 }));
  const r = await fiRetry({ action: "recordDwell", requestId: inbox[0].id, dwellMs: 9000 });
  if (r.json.request.status !== "read") throw new Error("settle did not survive transient failures");
  if ((await balanceAs(VIEWER)) !== 1025) throw new Error("transient failures double- or under-credited");

  // forced PERSISTENT failure mid-flow: the route fails loudly, the ledger
  // stays consistent, and the client retry converges without a double-spend
  await viewAs(OUTSIDER);
  const dm = await fiRetry({ action: "sendDm", toPersona: VIEWER, text: "will be ignored" });
  await advance(3_700_000);
  await retry(() => api("POST", "/api/dev", { action: "forceFail", label: "settle.record", count: 3 }));
  const failed = await fi({ action: "sweepDms" }); // all 3 attempts forced down
  if (failed.status !== 503) throw new Error(`persistent failure returned ${failed.status}, expected a loud 503`);
  const esc = (await surf("escrow&id=" + dm.json.dm.escrowId)).json.escrow;
  if (esc.status !== "settled") throw new Error("escrow not terminal after the failed sweep");
  const vb = await balanceAs(VIEWER);
  const retried = await fiRetry({ action: "sweepDms" }); // converges, nothing re-slashed
  if (retried.json.slashed !== 0) throw new Error("retry re-slashed a resolved DM");
  if ((await balanceAs(VIEWER)) !== vb) throw new Error("retry moved money twice");

  // full-ledger audit: every escrow in exactly one state, no negative balance
  const ledger = (await surf("ledger")).json;
  for (const e of ledger.escrows) {
    if (!["held", "settled", "refunded", "lottery"].includes(e.status))
      throw new Error(`escrow ${e.id} in unknown state ${e.status}`);
  }
  for (const [pid, bal] of Object.entries(ledger.balances)) {
    if (bal < 0) throw new Error(`negative balance on ${pid}: ${bal}`);
  }
  assertConserved(c0, await conservation(), "failure injection");
});

await reset();
await viewAs(null);
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Tier B Gate 3 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
