// TIER B GATE 2 — the crosspost composer, protocol-agnostic.
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
const viewAs = async (handle) => {
  await api("POST", "/api/dev", { action: "viewAs", personaId: handle ? id(handle) : null });
  await page.waitForTimeout(150);
};

// CONTENT-aware fetch, not status-only. /api/crosspost GET calls
// costEstimate() per destination and try/catches each one — a destination
// whose estimate hits the mocks' natural 2% synthetic failure is silently
// dropped from an otherwise-200 response ("don't offer it this round",
// which is deliberate product behavior, not a bug). A status-only retry
// accepts that incomplete 200, which then surfaces either as a phantom
// binding failure or as an undefined-property crash downstream.
// converted to the shared retryContent helper (same 6 content-checked rounds, returns last result)
const crosspostFull = (text, expect = ["tiktok_mock", "x_mock"]) =>
  retryContent(
    () => retry(() => api("GET", "/api/crosspost?text=" + encodeURIComponent(text))),
    (r) => expect.every((e) => r.json.destinations.some((d) => d.id === e)),
    6
  );

console.log("\nTier B Gate 2 — Crosspost composer");

// ---- 1. per-persona binding ----
await check("1. Destination list follows the ACTIVE persona; unbound publish is refused", async () => {
  await reset();
  await viewAs("yeak__");
  const bound = await crosspostFull("hello");
  const ids = bound.json.destinations.map((d) => d.id).sort();
  if (ids.join(",") !== "tiktok_mock,x_mock")
    throw new Error(`main persona should offer both mocks, got ${ids.join(",")}`);

  // the PRIVATE persona binds nothing — no external accounts by construction.
  // Zero IS the expected content here, so a plain status retry is correct.
  await viewAs("backyard_scope");
  const priv = await retry(() => api("GET", "/api/crosspost?text=hello"));
  if (priv.json.destinations.length !== 0)
    throw new Error("private persona was offered destinations it has no attestation for");

  // server-side refusal, not a quiet skip
  const forced = await api("POST", "/api/crosspost", {
    castHash: "0xforged",
    text: "hi",
    destinationIds: ["x_mock"],
  });
  if (forced.status !== 403) throw new Error(`unbound publish returned ${forced.status}, expected 403`);
  await viewAs(null);
});

// ---- 2. the link surcharge appears exactly when a link is present ----
await check("2. Cost estimate: plain $0.015, link post 13x — surfaced before send", async () => {
  await viewAs("yeak__");
  const plain = await crosspostFull("no links here", ["x_mock"]);
  const withLink = await crosspostFull("read this https://example.org/piece", ["x_mock"]);
  const xPlain = plain.json.destinations.find((d) => d.id === "x_mock");
  const xLink = withLink.json.destinations.find((d) => d.id === "x_mock");
  if (xPlain.cost.amount !== 0.015) throw new Error(`plain cost ${xPlain.cost.amount}, expected 0.015`);
  if (xLink.cost.amount !== 0.195) throw new Error(`link cost ${xLink.cost.amount}, expected 0.195 (13x)`);
  if (Math.abs(xLink.cost.amount / xPlain.cost.amount - 13) > 0.001)
    throw new Error("link surcharge is not 13x");
});

// ---- 3. degradation preview matches what the destination receives ----
await check("3. Degradation: preview equals the draft the mock destination received", async () => {
  await reset();
  await viewAs("yeak__");
  const long = "read this first https://example.org/essay " + "x".repeat(400);
  const preview = await crosspostFull(long);
  const xPrev = preview.json.destinations.find((d) => d.id === "x_mock").degradation;
  const tkPrev = preview.json.destinations.find((d) => d.id === "tiktok_mock").degradation;
  if (!xPrev.truncated) throw new Error("440-char draft should truncate for X (280)");
  if (!tkPrev.linksDropped) throw new Error("TikTok mock carries no links — preview must say so");
  if (tkPrev.truncated) throw new Error("440 chars fits TikTok's 2200 — no truncation expected");

  // settle: retry the publish until both destinations report delivery (fresh castHash per attempt)
  await retryContent(
    () =>
      retry(() =>
        api("POST", "/api/crosspost", {
          castHash: "0xlocaltest" + Date.now().toString(36),
          text: long,
          destinationIds: ["x_mock", "tiktok_mock"],
        })
      ),
    (r) => r.json.published.length === 2,
    4
  );
  // settle: retry lastReceived until a delivery is actually recorded, then assert as before
  const gotX = (await retryContent(() => retry(() => api("POST", "/api/dev", { action: "lastReceived", destinationId: "x_mock" })), (r) => r.json.received?.text != null, 4)).json.received;
  const gotTk = (await retryContent(() => retry(() => api("POST", "/api/dev", { action: "lastReceived", destinationId: "tiktok_mock" })), (r) => r.json.received?.text != null, 4)).json.received;
  if (gotX.text !== xPrev.deliveredText)
    throw new Error("X received text differs from the degradation preview");
  if (gotTk.text !== tkPrev.deliveredText)
    throw new Error("TikTok received text differs from the degradation preview");
  if (gotTk.links.length !== 0) throw new Error("links reached a destination that cannot carry them");
});

// ---- 4. the event log carries the crosspost with its external ref ----
await check("4. Crosspost lands in the relationship log with an external ref", async () => {
  await reset();
  await viewAs("yeak__");
  // settle: retry the publish (fresh castHash per attempt) until the fan-out actually published
  let castHash;
  const pub = await retryContent(
    () => {
      castHash = "0xlocalb2" + Date.now().toString(36);
      return retry(() => api("POST", "/api/crosspost", { castHash, text: "logged", destinationIds: ["x_mock"] }));
    },
    (r) => r.json.published?.length === 1,
    6
  );
  const ref = pub.json.published[0].externalRef;
  if (!ref?.startsWith("x:post:")) throw new Error("no external ref returned");
  const evs = await retry(() => api("GET", "/api/eventlog"));
  const ev = evs.json.events.find((e) => e.type === "crosspost" && e.triggeringCastId === castHash);
  if (!ev) throw new Error("no crosspost event in the log");
  if (ev.externalRef !== ref) throw new Error("event lost the external ref");
  if (ev.targetPersona !== "x_mock") throw new Error("event does not name the destination");
});

// ---- 5. collapse: once + chip for overlap, twice for non-overlap, pref wins ----
await check("5. Collapse: overlapping viewer sees one copy + chip; non-overlapping sees both", async () => {
  await reset();
  // author a real local cast, then crosspost it
  await retry(() => api("POST", "/api/signer", {}));
  await retry(() => api("POST", "/api/personas", { name: "B2", handle: "b2_" + Date.now().toString(36) }));
  const cast = await retry(() =>
    api("POST", "/api/actions/cast", { text: "collapse subject post" })
  );
  const hash = cast.json.hash;
  await viewAs("yeak__");
  await retry(() =>
    api("POST", "/api/crosspost", { castHash: hash, text: "collapse subject post", destinationIds: ["x_mock"] })
  );

  // overlapping viewer (crustcritic overlaps x_mock): ONE copy + chip
  await viewAs("crustcritic");
  await page.goto(BASE + "/home?feed=classic", { waitUntil: "networkidle" });
  // settle: poll until the collapsed feed renders (server-rendered — midway reload OK), then assert
  await pollUntil(
    async () =>
      (await page.locator(`[data-testid=cast]`, { hasText: "collapse subject post" }).count()) === 1 &&
      (await page.locator("[data-testid=crosspost-chip]").count()) === 1,
    { midway: () => page.reload({ waitUntil: "networkidle" }) }
  );
  let copies = await page.locator(`[data-testid=cast]`, { hasText: "collapse subject post" }).count();
  let chips = await page.locator("[data-testid=crosspost-chip]").count();
  if (copies !== 1) throw new Error(`overlapping viewer sees ${copies} copies, expected 1`);
  if (chips !== 1) throw new Error("no probably-seen chip for the overlapping viewer");

  // non-overlapping viewer: BOTH copies (original + mirror)
  await viewAs("drivethru_dave");
  await page.goto(BASE + "/home?feed=classic", { waitUntil: "networkidle" });
  // settle: poll for both copies + mirror attribution (server-rendered — midway reload OK), then assert
  await pollUntil(
    async () =>
      (await page.locator(`[data-testid=cast]`, { hasText: "collapse subject post" }).count()) === 2 &&
      (await page.locator("[data-testid=mirror-attribution]").count()) === 1,
    { midway: () => page.reload({ waitUntil: "networkidle" }) }
  );
  copies = await page.locator(`[data-testid=cast]`, { hasText: "collapse subject post" }).count();
  const mirrors = await page.locator("[data-testid=mirror-attribution]").count();
  if (copies !== 2) throw new Error(`non-overlapping viewer sees ${copies} copies, expected 2`);
  if (mirrors !== 1) throw new Error("mirror copy missing its attribution line");

  // viewer preference disables collapse even for the overlapping viewer
  await viewAs("crustcritic");
  await retry(() => api("POST", "/api/dev", { action: "setCollapse", disabled: true }));
  await page.goto(BASE + "/home?feed=classic", { waitUntil: "networkidle" });
  // settle: poll until the un-collapsed feed shows both copies (server-rendered — midway reload OK)
  await pollUntil(
    async () => (await page.locator(`[data-testid=cast]`, { hasText: "collapse subject post" }).count()) === 2,
    { midway: () => page.reload({ waitUntil: "networkidle" }) }
  );
  copies = await page.locator(`[data-testid=cast]`, { hasText: "collapse subject post" }).count();
  if (copies !== 2) throw new Error("collapse preference did not disable collapsing");
  await retry(() => api("POST", "/api/dev", { action: "setCollapse", disabled: false }));
  await viewAs(null);
});

// ---- 6. the composer panel shows the estimate before send ----
await check("6. PAGE: composer shows destinations and the link-cost note before send", async () => {
  await reset();
  await viewAs("yeak__");
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator("[data-testid=composer-input]").first().click();
  await page.locator("[data-testid=composer-input]").first().fill("look at this https://example.org/link");
  // settle: poll for the panel — NO reload here, the composer draft is client-side state
  await pollUntil(async () => (await page.locator("[data-testid=crosspost-panel]").count()) === 1, { tries: 15 });
  if ((await page.locator("[data-testid=crosspost-panel]").count()) !== 1)
    throw new Error("crosspost panel missing from the composer");
  await page.locator("[data-testid=crosspost-x_mock]").click();
  // the panel shows "Estimating cost…" until the CURRENT draft's estimate
  // lands (stale prices are never shown) — poll for the SETTLED CONTENT,
  // not mere element existence: the note element exists while it still
  // says "Estimating…", and breaking on existence asserts on that
  // unsettled text (caught by the FC-pass Gate 0 sweep, run 1)
  let note = "";
  const settled = await pollUntil(
    async () => {
      if ((await page.locator("[data-testid=cost-note-x_mock]").count()) !== 1) return false;
      note = await page.locator("[data-testid=cost-note-x_mock]").innerText();
      return /contains a link/.test(note) && /0\.195/.test(note);
    },
    { tries: 30, delayMs: 400 }
  );
  if (!settled) throw new Error(`cost note wrong or missing: "${note}"`);
  await viewAs(null);
});

await reset();
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Tier B Gate 2 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
