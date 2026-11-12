// X INTEROP GATE 1 — account linking as attestations.
//
// PERSONA LAUNCH P2 (BYX G0, the honesty gate): the recorded exchange is a TEST link. It is attested as method
// "fixture" (proofRef "fixture:users/me:<id>") and reads "test link, not verified" — checks 2 and 8 assert exactly
// that now (they used to assert "oauth" / "verified via oauth", the label G0 retired as dishonest).
//
// FIXTURE-VERIFIED: no X_API_* credentials exist in this environment, so
// the OAuth exchange is the recorded fixture. The mode is asserted in test
// 1 — a fixture run that reports itself as live (or vice versa) is a
// failure, not a detail.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const VIEWER = id("yeak__");
const OTHER = id("crustcritic");
const PRIVATE = id("backyard_scope");
const HANDLE = "yeak_offchain";

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
async function retryRefusal(fn, wantStatus, attempts = 4) {
  // a REFUSAL check under the 2% synthetic failure: retry 503s, accept only
  // the expected refusal status, and fail loudly on a 2xx
  let last;
  for (let i = 0; i < attempts; i++) {
    const r = await fn();
    if (r.status === wantStatus) return r;
    if (r.status >= 200 && r.status < 300)
      throw new Error(`expected refusal ${wantStatus}, got success ${r.status}`);
    last = r;
  }
  throw new Error(`expected refusal ${wantStatus}, kept getting ${last.status} ${last.json?.error ?? ""}`);
}
const reset = async () => {
  await api("POST", "/api/dev", { action: "resetSeed" });
  await page.waitForTimeout(400);
};
const viewAs = async (pid) => {
  await api("POST", "/api/dev", { action: "viewAs", personaId: pid });
  await page.waitForTimeout(100);
};
const destIds = async (expectedIds = []) => {
  // retryContent settles the fan-out read: GET /api/crosspost can 200 with a silently dropped destination
  const r = await retryContent(
    () => api("GET", "/api/crosspost?text=probe"),
    (x) =>
      x.status >= 200 &&
      x.status < 300 &&
      expectedIds.every((id) => x.json.destinations.some((d) => d.id === id)),
    4
  );
  if (r.status < 200 || r.status >= 300)
    throw new Error("status " + r.status + " " + (r.json?.error ?? ""));
  return r.json.destinations.map((d) => d.id).sort();
};

console.log("\nX Interop Gate 1 — account linking");

// ---- 1. reality is reported, never conflated ----
await check("1. FIXTURE mode reported: no credentials, and the payload says so", async () => {
  await reset();
  const r = await retry(() => api("GET", "/api/x/link"));
  if (r.json.mode !== "fixture")
    throw new Error(`mode "${r.json.mode}" — this environment has no X credentials`);
});

// ---- 2. link → attestation on the ACTIVE persona → destination follows ----
await check("2. Link lands on the active persona; X destination binds for it ONLY", async () => {
  await viewAs(VIEWER);
  const before = await destIds(["x_mock"]); // presence assertion below — settle the drop-prone read first
  if (!before.includes("x_mock")) throw new Error("baseline missing the mock binding");
  const linked = await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: HANDLE }));
  const a = linked.json.attestation;
  if (a.handle !== HANDLE) throw new Error(`attested handle ${a.handle}`);
  if (a.personaId !== VIEWER) throw new Error("attestation landed on the wrong persona");
  if (a.method !== "fixture") throw new Error(`method ${a.method} — a recorded exchange is a test link (BYX G0)`);
  if (!/^fixture:users\/me:\d+$/.test(a.proofRef ?? "")) throw new Error(`proofRef ${a.proofRef}`);
  if (linked.json.label !== "test link, not verified") throw new Error(`label "${linked.json.label}"`);
  if (/token/i.test(a.proofRef ?? "")) throw new Error("proofRef carries token material");
  const after = await destIds(["x"]); // presence assertion below — settle the drop-prone read first
  if (!after.includes("x")) throw new Error("X destination did not bind after attestation");
  if (after.includes("x_mock")) throw new Error("mock binding not replaced by the real one");
  // another persona gets nothing from someone else's attestation
  await viewAs(OTHER);
  if ((await destIds()).includes("x")) throw new Error("X destination leaked to an unattested persona");
});

// ---- 3. one persona per handle ----
await check("3. A second persona claiming the attested handle is refused", async () => {
  await viewAs(OTHER);
  await retryRefusal(
    () => api("POST", "/api/x/link", { action: "link", fixtureHandle: HANDLE }),
    409
  );
  const r = await retry(() => api("GET", "/api/x/link"));
  if (r.json.attestation) throw new Error("refused claim still produced an attestation");
});

// ---- 4. private personas cannot carry external account attestations ----
await check("4. Private persona refusal, enforced at the adapter", async () => {
  await viewAs(PRIVATE);
  const r = await retryRefusal(
    () => api("POST", "/api/x/link", { action: "link", fixtureHandle: "scope_leaks" }),
    403
  );
  if (!/private personas/.test(r.json.error)) throw new Error("refusal does not explain itself");
  if ((await destIds()).length !== 0) throw new Error("private persona gained a destination");
});

// ---- 5. unlink reverses the binding and frees the handle ----
await check("5. Unlink: attestation gone, mock binding restored, handle freed", async () => {
  await viewAs(VIEWER);
  await retry(() => api("POST", "/api/x/link", { action: "unlink", handle: HANDLE }));
  const st = await retry(() => api("GET", "/api/x/link"));
  if (st.json.attestation) throw new Error("attestation survived unlink");
  const dests = await destIds(["x_mock"]); // x_mock presence asserted below — settle the drop-prone read first
  if (dests.includes("x")) throw new Error("X destination survived unlink");
  if (!dests.includes("x_mock")) throw new Error("mock binding not restored on unlink");
  // the handle is free again: the OTHER persona can claim it now
  await viewAs(OTHER);
  const claimed = await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: HANDLE }));
  if (claimed.json.attestation.personaId !== OTHER) throw new Error("freed handle claim failed");
  await retry(() => api("POST", "/api/x/link", { action: "unlink", handle: HANDLE }));
});

// ---- 6. re-link is idempotent for the owning persona ----
await check("6. Re-link by the same persona refreshes, never duplicates", async () => {
  await viewAs(VIEWER);
  await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: HANDLE }));
  const again = await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: HANDLE }));
  if (again.json.attestation.personaId !== VIEWER) throw new Error("re-link moved the attestation");
  const dests = await destIds(["x"]); // x presence settled first; a genuine duplicate (count 2) still fails below
  if (dests.filter((d) => d === "x").length !== 1) throw new Error("re-link duplicated the binding");
});

// ---- 7. structural leak check on the link surface ----
await check("7. Link payloads carry personas only — no root shape, no tokens", async () => {
  for (const pid of [VIEWER, OTHER, PRIVATE]) {
    await viewAs(pid);
    const r = await retry(() => api("GET", "/api/x/link"));
    const text = JSON.stringify(r.json);
    if (/"rootId"\s*:/.test(text)) throw new Error("link payload carries a rootId key");
    if (/"root_[A-Za-z0-9]/.test(text)) throw new Error("link payload carries a root_ value");
    if (/access_token|refresh_token/.test(text)) throw new Error("link payload carries token material");
  }
});

// ---- 8. PAGE: the panel, the acting persona, the link moment ----
await check("8. PAGE: settings panel links via the fixture flow and names the acting persona", async () => {
  await reset();
  await viewAs(VIEWER);
  await page.goto(BASE + "/settings/attestations", { waitUntil: "networkidle" });
  // pollUntil replaces a flat 800ms wait: the panel populates via a client-side fetch (no reload — client state)
  await pollUntil(
    async () => {
      const t = await page.locator("[data-testid=link-acting-persona]").innerText();
      return t.includes("@yeak__") && /fixture mode/.test(t);
    },
    { tries: 12, delayMs: 400 }
  );
  const acting = await page.locator("[data-testid=link-acting-persona]").innerText();
  if (!acting.includes("@yeak__")) throw new Error(`acting-persona line reads "${acting}"`);
  if (!/fixture mode/.test(acting)) throw new Error("fixture mode not surfaced in the UI");
  await page.locator("[data-testid=link-fixture-handle]").fill(HANDLE);
  await page.locator("[data-testid=link-connect]").click();
  let linked = false;
  for (let i = 0; i < 15 && !linked; i++) {
    await page.waitForTimeout(400);
    linked = (await page.locator("[data-testid=link-status][data-linked=true]").count()) > 0;
  }
  if (!linked) throw new Error("panel never showed the linked state");
  const status = await page.locator("[data-testid=link-status]").innerText();
  if (!status.includes("@" + HANDLE) || !/test link, not verified/.test(status))
    throw new Error(`linked status reads "${status}"`);
  if (/verified via/.test(status)) throw new Error("the retired 'verified via' wording is back");
  await viewAs(null);
});

await reset();
await viewAs(null);
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} X Gate 1 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
