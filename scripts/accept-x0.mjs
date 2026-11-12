// X INTEROP GATE 0 — put-by-id settlement records.
//
// PERSONA LAUNCH P2 (BYX G0, the honesty gate) adds checks 5–6 (additive; 1–4 unchanged): a fixture X link is a TEST
// link and says so, sync never reports "live", and "Import from X" is reachable from Settings. The off-rig halves (no
// fixture link, no X destination, no fixture ingest on a public deployment) are unit-tested in scripts/unit-x-v1.mjs.
//
// The Tier B filed limitation, verbatim: "if settle.record fails
// persistently AFTER an escrow resolves, the earnings-record entry for that
// settlement is lost while the ledger stays correct." This gate closes it:
// record ids derive from escrow + terminal state, the write is put-by-id,
// and every retry path re-puts — so a later retry produces exactly ONE
// record, never zero, never two, with the ledger untouched throughout.
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const VIEWER = id("yeak__");
const OUTSIDER = id("restakerelle");

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
const viewAs = async (pid) => {
  await api("POST", "/api/dev", { action: "viewAs", personaId: pid });
  await page.waitForTimeout(100);
};
const fi = (body) => api("POST", "/api/market/infofi", body);
const fiRetry = (body) => retry(() => fi(body));
const surf = (q) => retry(() => api("GET", "/api/market/infofi?surface=" + q));
const forceFail = (count) =>
  retry(() => api("POST", "/api/dev", { action: "forceFail", label: "settle.record", count }));
const recordsWithId = async (recId) => {
  const r = await retry(() => api("GET", "/api/earnings"));
  return (r.json.events ?? []).filter((e) => e.id === recId);
};
const conservation = async () => (await surf("conservation")).json;

console.log("\nX Interop Gate 0 — put-by-id settlement records");

// ---- 1. THE FILED SCENARIO: persistent failure, later retry, exactly one ----
await check("1. Reads: persistent record failure → later retry → exactly ONE record", async () => {
  await reset();
  await viewAs(VIEWER);
  const inbox = (await surf("inbox")).json.inbox;
  const req = inbox[0];
  const recId = "rec_" + req.escrowId + ":settled";
  const c0 = await conservation();

  // persistent failure: all 3 retryAdapter attempts forced down
  await forceFail(3);
  const failed = await fi({ action: "recordDwell", requestId: req.id, dwellMs: 9000 });
  if (failed.status !== 503) throw new Error(`expected loud 503, got ${failed.status}`);
  // the ledger already settled — and the record is LOST (the Tier B state)
  const esc = (await surf("escrow&id=" + req.escrowId)).json.escrow;
  if (esc.status !== "settled") throw new Error("escrow not settled after the failed record");
  if ((await recordsWithId(recId)).length !== 0)
    throw new Error("record exists despite persistent failure — forceFail did not bite");

  // the LATER RETRY: converges to exactly one record, ledger untouched
  const retried = await fiRetry({ action: "recordDwell", requestId: req.id, dwellMs: 9000 });
  if (retried.json.request.status !== "read") throw new Error("retry did not return the read state");
  let recs = await recordsWithId(recId);
  if (recs.length !== 1) throw new Error(`after retry: ${recs.length} records, expected exactly 1`);

  // and AGAIN: put-by-id means still exactly one
  await fiRetry({ action: "recordDwell", requestId: req.id, dwellMs: 9000 });
  recs = await recordsWithId(recId);
  if (recs.length !== 1) throw new Error(`after second retry: ${recs.length} records — put-by-id broken`);
  if (recs[0].amount !== req.price) throw new Error("record amount wrong");

  const bal = (await surf("balance")).json.balance;
  if (bal !== 1025) throw new Error(`viewer balance ${bal} — the ledger moved more than once`);
  const c1 = await conservation();
  const drift = c1.conservationTotal - c0.conservationTotal - 1000 * (c1.accounts - c0.accounts);
  if (Math.abs(drift) > 0.001) throw new Error(`conservation drifted ${drift.toFixed(3)}`);
});

// ---- 2. same convergence on the DM slash path ----
await check("2. DM slash: lost record lands on the next sweep, exactly once", async () => {
  await viewAs(OUTSIDER);
  const dm = await fiRetry({ action: "sendDm", toPersona: VIEWER, text: "will be ignored" });
  const recId = "rec_" + dm.json.dm.escrowId + ":settled";
  await fiRetry({ action: "advanceClock", ms: 3_700_000 });
  await forceFail(3);
  const failed = await fi({ action: "sweepDms" });
  if (failed.status !== 503) throw new Error(`expected loud 503, got ${failed.status}`);
  if ((await recordsWithId(recId)).length !== 0) throw new Error("slash record exists despite failure");

  // later sweep: no re-slash, and the record converges
  const swept = await fiRetry({ action: "sweepDms" });
  if (swept.json.slashed !== 0) throw new Error("retry re-slashed a resolved DM");
  // the record belongs to the RECIPIENT — earnings are per-active-persona
  await viewAs(VIEWER);
  let recs = await recordsWithId(recId);
  if (recs.length !== 1) throw new Error(`after sweep retry: ${recs.length} records, expected 1`);
  await fiRetry({ action: "sweepDms" }); // and a third pass stays at one
  recs = await recordsWithId(recId);
  if (recs.length !== 1) throw new Error("repeated sweeps duplicated the slash record");
});

// ---- 3. transient failures still recover to exactly one (b3 regression) ----
await check("3. Transient record failure (2 of 3 attempts) recovers with exactly one record", async () => {
  await reset();
  await viewAs(VIEWER);
  const inbox = (await surf("inbox")).json.inbox;
  const req = inbox[0];
  const recId = "rec_" + req.escrowId + ":settled";
  await forceFail(2); // retryAdapter's 3rd attempt succeeds
  const r = await fiRetry({ action: "recordDwell", requestId: req.id, dwellMs: 9000 });
  if (r.json.request.status !== "read") throw new Error("dwell did not settle through transients");
  const recs = await recordsWithId(recId);
  if (recs.length !== 1) throw new Error(`${recs.length} records after transient recovery`);
});

// ---- 4. legacy call sites without recordId still work (no signature break) ----
await check("4. Legacy record calls (no recordId) still mint ids and land once", async () => {
  // the market intent award path predates put-by-id and passes no recordId
  await viewAs(VIEWER);
  const before = (await retry(() => api("GET", "/api/earnings"))).json.events.length;
  const intent = await retry(() =>
    api("POST", "/api/market/intent", {
      category: "espresso",
      description: "x0 legacy record probe",
      escrowAmount: 500,
      pitchSlots: 1,
      windowMs: 60000,
    })
  );
  if (!intent.json.intent) throw new Error("intent create failed");
  // lapse it → the refund settlement records through the legacy path
  const lapsed = await retry(() => api("POST", "/api/market/intent", { action: "lapse", intentId: intent.json.intent.id }));
  if (!lapsed.json.intent) throw new Error("lapse failed");
  const after = (await retry(() => api("GET", "/api/earnings"))).json.events;
  if (after.length !== before + 1) throw new Error(`legacy path recorded ${after.length - before} events, expected 1`);
  if (!after.some((e) => /^settle_/.test(e.id) && e.note?.includes("x0 legacy record probe")))
    throw new Error("legacy record lost its minted id shape");
});

// ---- 5. BYX G0: the honesty labels ----
await check("5. G0 honesty: a fixture X link is method 'fixture', labelled 'test link, not verified'; sync answers fixture (never live); the rig says fixtureAvailable", async () => {
  await reset();
  await viewAs(VIEWER);
  const before = await retry(() => api("GET", "/api/x/link"));
  if (before.json.fixtureAvailable !== true) throw new Error("the rig must offer the fixture link (fixtureAvailable " + before.json.fixtureAvailable + ")");
  const linked = await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: "x0_g0_probe" }));
  const a = linked.json.attestation;
  if (a?.method !== "fixture") throw new Error("method " + a?.method);
  if (!/^fixture:users\/me:\d+$/.test(a.proofRef ?? "")) throw new Error("proofRef " + a.proofRef);
  if (linked.json.label !== "test link, not verified") throw new Error("label " + linked.json.label);
  const again = await retry(() => api("GET", "/api/x/link"));
  if (again.json.label !== "test link, not verified") throw new Error("GET label " + again.json.label);
  const sync = await retry(() => api("POST", "/api/x/sync", { kind: "bookmarks" }));
  if (sync.json.mode !== "fixture") throw new Error("sync mode " + sync.json.mode);
  await retry(() => api("POST", "/api/x/link", { action: "unlink", handle: "x0_g0_probe" }));
});

// ---- 6. BYX G0: Import from X is reachable ----
await check("6. G0: Settings lists 'Import from X' (settings-link-import-x) after Account & Personas, and it leads to the import page", async () => {
  await page.goto(BASE + "/settings", { waitUntil: "networkidle" });
  const links = await page.locator('[data-testid^="settings-link-"]').evaluateAll((as) => as.map((a) => a.getAttribute("data-testid")));
  const at = links.indexOf("settings-link-import-x");
  if (at < 0) throw new Error("no Import from X row: " + links.join(","));
  if (at !== links.indexOf("settings-link-account") + 1) throw new Error("the row is not right after Account & Personas: " + links.join(","));
  await page.locator("[data-testid=settings-link-import-x]").click();
  await page.waitForURL((u) => new URL(u).pathname === "/settings/import-x", { timeout: 30_000 });
  await page.locator("[data-testid=x-import-wizard]").waitFor({ timeout: 30_000 });
  await page.locator("[data-testid=import-load-fixture]").waitFor({ timeout: 30_000 }); // the rig's test archive
});

await reset();
await viewAs(null);
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} X Gate 0 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
