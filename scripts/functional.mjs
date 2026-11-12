// Functional verification (run once after visual PASS or at loop end):
// stub signer → create persona → post cast → appears under persona identity →
// like → count increments → second persona → block from a second browser
// context → the blocked persona vanishes from context 2's feed, its sibling
// stays (root-level fan-out removed by design: ZK Pass 2 migration 006) →
// tier badge renders from validator data.
import { chromium } from "playwright";
import { retryContent, pollUntil } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
let failures = 0;
const ok = (name) => console.log("  PASS  " + name);
const fail = (name, detail) => {
  failures++;
  console.log("  FAIL  " + name + (detail ? " — " + detail : ""));
};

async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e.message);
  }
}

const browser = await chromium.launch();
const stamp = Date.now().toString(36);

// ---- Context 1: the poster ----
const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p1 = await ctx1.newPage();

// Stub signer connect + first persona via API (the UI path is the account
// switcher; the API is the same contract the UI calls).
// retryContent absorbs transient setup-POST failures; assertions below are unchanged
const signer = await retryContent(() => p1.request.post(BASE + "/api/signer", { data: {} }), (res) => res.ok(), 4);
const signerBody = await signer.json();
await check("stub signer connect returns an OPAQUE handle, never a root id", async () => {
  // v3 (architecture-v3): the browser gets a one-way session handle. A
  // rootId in this response would be root material leaving the keystore,
  // which scripts/root-leak.mjs also enforces.
  if (!signerBody.session) throw new Error("no session handle: " + JSON.stringify(signerBody));
  if ("rootId" in signerBody) throw new Error("LEAK: signer response carries rootId");
  if (/^root_/.test(String(signerBody.session))) throw new Error("LEAK: handle is a raw root id");
});

// retryContent absorbs transient setup-POST failures; assertion below is unchanged
const personaA = await (
  await retryContent(() => p1.request.post(BASE + "/api/personas", {
    data: { name: "Persona A", handle: "pa_" + stamp },
  }), (res) => res.ok(), 4)
).json();
await check("create persona A", async () => {
  if (!personaA.persona?.id) throw new Error(JSON.stringify(personaA));
});

// Post a cast through the UI compose modal.
await p1.goto(BASE + "/home?feed=classic", { waitUntil: "networkidle" });
const castText = "Functional check " + stamp;
await p1.getByTestId("nav-post-button").click();
await p1.waitForSelector("[data-testid='compose-modal']");
await p1.getByTestId("composer-input").last().fill(castText);
await p1.getByTestId("composer-submit").last().click();
await check("toast appears on cast success", () =>
  p1.waitForSelector("[data-testid='toast']", { timeout: 5000 })
);
// pollUntil replaces a fixed 1200ms wait: reload until the server-rendered feed carries the cast
await pollUntil(async () => {
  await p1.goto(BASE + "/home?feed=classic", { waitUntil: "networkidle" });
  return (await p1.locator("[data-testid='cast']", { hasText: castText }).count()) > 0;
}, { tries: 6, delayMs: 800 });

await check("cast appears in timeline under persona A identity", async () => {
  const card = p1.locator("[data-testid='cast']", { hasText: castText }).first();
  await card.waitFor({ timeout: 5000 });
  const handle = await card.textContent();
  if (!handle.includes("@pa_" + stamp)) throw new Error("persona handle missing: " + handle);
  if (handle.includes("layers:persona")) throw new Error("marker leaked into UI");
});

await check("optimistic like increments the count", async () => {
  const card = p1.locator("[data-testid='cast']", { hasText: castText }).first();
  const like = card.getByTestId("action-like");
  const before = (await like.textContent()).trim();
  await like.click();
  // pollUntil replaces a fixed 300ms wait; no reload — optimistic client state is under test
  await pollUntil(async () => (await like.textContent()).trim() === "1", { tries: 8, delayMs: 250 });
  const after = (await like.textContent()).trim();
  if (!(before === "" && after === "1")) throw new Error(`before='${before}' after='${after}'`);
});

// Second persona on the same root.
// retryContent absorbs transient setup-POST failures; assertion below is unchanged
const personaA2 = await (
  await retryContent(() => p1.request.post(BASE + "/api/personas", {
    data: { name: "Persona A2", handle: "pa2_" + stamp },
  }), (res) => res.ok(), 4)
).json();
await check("create second persona on same root", async () => {
  if (!personaA2.persona?.id) throw new Error(JSON.stringify(personaA2));
});
// Post as persona A2 (cookie now points at A2).
// retryContent: this write was fire-and-forget; a silent 2% failure misattributed itself to the block test
await retryContent(() => p1.request.post(BASE + "/api/actions/cast", {
  data: { text: "Second persona speaking " + stamp },
}), (res) => res.ok(), 4);

await check("tier badge renders from validator response", async () => {
  await p1.goto(BASE + "/home?feed=classic", { waitUntil: "networkidle" });
  const badge = p1.locator("[data-testid='tier-badge']").first();
  await badge.waitFor({ timeout: 5000 });
  const text = (await badge.textContent()).trim();
  if (!/^([1-9]|10)$/.test(text)) throw new Error("badge text: " + text);
});

// ---- Context 2: the blocker ----
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p2 = await ctx2.newPage();
// retryContent absorbs transient setup-POST failures on the ctx2 signer + persona writes
await retryContent(() => p2.request.post(BASE + "/api/signer", { data: {} }), (res) => res.ok(), 4);
const personaB = await (
  await retryContent(() => p2.request.post(BASE + "/api/personas", {
    data: { name: "Persona B", handle: "pb_" + stamp },
  }), (res) => res.ok(), 4)
).json();

// Fresh roots are tier 1 by design, so discovery (For You) filters them for
// OTHER viewers. The Following feed is the unfiltered surface — that is
// where cross-context visibility is contractually guaranteed.
await check("context 2 sees both of root A's personas pre-block (Following)", async () => {
  // retryContent settles per-item adapter drops before the original assertions run
  const feed = await retryContent(async () => {
    await p2.goto(BASE + "/home?feed=classic&tab=following", { waitUntil: "networkidle" });
    return p2.locator("[data-testid='timeline']").textContent();
  }, (f) => f.includes("@pa_" + stamp) && f.includes("@pa2_" + stamp), 4);
  if (!feed.includes("@pa_" + stamp)) throw new Error("persona A not visible pre-block");
  if (!feed.includes("@pa2_" + stamp)) throw new Error("persona A2 not visible pre-block");
});

// Block persona A only. ZK PASS 2 Gate 2: root-level fan-out is GONE by
// design (the validator no longer holds persona → root); A2 stays visible.
await check("block API accepts persona-level block", async () => {
  const res = await p2.request.post(BASE + "/api/block", {
    data: { personaId: personaA.persona.id },
  });
  if (!res.ok()) throw new Error(String(res.status()));
});

await check("the blocked persona vanishes from context 2's feed; its sibling stays (root-level fan-out removed by design — ZK Pass 2 migration 006)", async () => {
  await p2.goto(BASE + "/home?feed=classic&tab=following", { waitUntil: "networkidle" });
  const feed = await p2.locator("[data-testid='timeline']").textContent();
  if (feed.includes("@pa_" + stamp)) throw new Error("persona A still visible");
  if (!feed.includes("@pa2_" + stamp)) throw new Error("persona A2 vanished — a server-side persona → root link is back (that is exactly what 006 removed)");
});

await check("context 1 still sees its own casts (block is one-directional)", async () => {
  // retryContent settles per-item adapter drops before the original assertion runs
  const feed = await retryContent(async () => {
    await p1.goto(BASE + "/home?feed=classic", { waitUntil: "networkidle" });
    return p1.locator("[data-testid='timeline']").textContent();
  }, (f) => f.includes("@pa_" + stamp), 4);
  if (!feed.includes("@pa_" + stamp)) throw new Error("own cast missing");
});

await browser.close();
console.log(failures === 0 ? "\nALL FUNCTIONAL CHECKS PASSED" : `\n${failures} FUNCTIONAL CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
