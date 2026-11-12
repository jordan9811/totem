// TIER B GATE 4 — curator issuance.
//
// The two rules under test, both fail-closed:
//   1. Below threshold an annotation renders NOWHERE (display side — proven
//      in a4; re-proven here against the issuance path's drafts).
//   2. A DRAFT is visible only to its author and invited co-signers. Not to
//      other curators, not to subscribers, not to an adversarial fetch.
// Plus the money shot: the seeded 2-of-3 draft one signature from live.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;

const AUTHOR = "todayinruins"; // drafted + signed the seeded draft
const COSIGNER = "marginalia_mo"; // invited, signature pending
const COSIGNER2 = "archive_annette"; // invited, signature pending
const OTHER_DESK = "footnote_feiler"; // a curator — on a DIFFERENT desk
const CIVILIAN = "yeak__"; // not a curator at all
const SEED_CLAIM_FRAGMENT = "annualizes a single epoch";

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
  await page.waitForTimeout(100);
};
const curators = () => retry(() => api("GET", "/api/curators"));

console.log("\nTier B Gate 4 — Curator issuance");

// ---- 1. the seeded mid-flight draft, and the threshold moment ----
await check("1. Seeded 2-of-3 draft: one signature pending; co-signing issues it live", async () => {
  await reset();
  await viewAs(AUTHOR);
  // settle the composite payload (seeded draft + records feed) before asserting; a genuine absence still fails below
  let r = await retryContent(
    curators,
    (x) =>
      x.json.drafts.some((d) => d.claim.includes(SEED_CLAIM_FRAGMENT)) &&
      x.json.feeds.some((f) => f.id === "curator_recordsdesk"),
    4
  );
  const draft = r.json.drafts.find((d) => d.claim.includes(SEED_CLAIM_FRAGMENT));
  if (!draft) throw new Error("seeded draft missing for its author");
  if (draft.status !== "pending") throw new Error(`seeded draft status ${draft.status}`);
  if (draft.signedHandles.length !== 1 || draft.signedHandles[0] !== AUTHOR)
    throw new Error("seeded draft should carry exactly the author's signature");
  if (draft.canSign) throw new Error("author already signed — canSign must be false");
  // sub-threshold: the annotation is NOT in the live feed
  const records = r.json.feeds.find((f) => f.id === "curator_recordsdesk");
  if (records.annotations.some((a) => a.claim.includes(SEED_CLAIM_FRAGMENT)))
    throw new Error("sub-threshold draft is IN the live annotation list");

  // THE THRESHOLD MOMENT: the invited co-signer signs, the annotation issues
  await viewAs(COSIGNER);
  r = await curators();
  const mine = r.json.drafts.find((d) => d.claim.includes(SEED_CLAIM_FRAGMENT));
  if (!mine?.canSign) throw new Error("invited co-signer cannot sign");
  const signed = await retry(() => api("POST", "/api/curators", { action: "sign", draftId: mine.id }));
  if (signed.json.draft.status !== "issued") throw new Error("threshold signature did not issue");

  // retry until the issued annotation is readable; a genuine absence still fails below
  r = await retryContent(
    curators,
    (x) =>
      x.json.feeds
        .find((f) => f.id === "curator_recordsdesk")
        .annotations.some((a) => a.claim.includes(SEED_CLAIM_FRAGMENT)),
    4
  );
  const live = r.json.feeds
    .find((f) => f.id === "curator_recordsdesk")
    .annotations.find((a) => a.claim.includes(SEED_CLAIM_FRAGMENT));
  if (!live) throw new Error("issued annotation missing from the live feed");
  if (live.signerCount !== 2) throw new Error(`issued with ${live.signerCount} signers, expected 2`);
});

// ---- 2. draft visibility is invited-only (adversarial fetches) ----
await check("2. Sub-threshold draft invisible to everyone not invited — including other curators", async () => {
  await reset();
  // a curator on a DIFFERENT desk: sees nothing
  await viewAs(OTHER_DESK);
  let r = await curators();
  if (r.json.drafts.some((d) => d.claim.includes(SEED_CLAIM_FRAGMENT)))
    throw new Error("off-desk curator can see the draft");
  // a civilian: sees nothing
  await viewAs(CIVILIAN);
  r = await curators();
  if (r.json.drafts.length !== 0) throw new Error("civilian receives drafts");
  // and the raw payload never carries the claim text anywhere
  if (JSON.stringify(r.json).includes(SEED_CLAIM_FRAGMENT))
    throw new Error("draft claim text leaked into a non-invited payload");
  // adversarial sign attempt: refused loudly, draft unmoved
  const drafts = await (async () => {
    await viewAs(AUTHOR);
    // settle: the seeded draft must be readable before the .id deref below
    return (
      await retryContent(curators, (x) => x.json.drafts.some((d) => d.claim.includes(SEED_CLAIM_FRAGMENT)), 4)
    ).json.drafts;
  })();
  const draftId = drafts.find((d) => d.claim.includes(SEED_CLAIM_FRAGMENT)).id;
  await viewAs(OTHER_DESK);
  const forced = await api("POST", "/api/curators", { action: "sign", draftId });
  if (forced.status !== 403) throw new Error(`uninvited sign returned ${forced.status}, expected 403`);
  await viewAs(AUTHOR);
  // settle: the draft was fetched by id above, so absence here is a read-side drop
  const after = (
    await retryContent(curators, (x) => x.json.drafts.some((d) => d.id === draftId), 4)
  ).json.drafts.find((d) => d.id === draftId);
  if (after.status !== "pending" || after.signedHandles.length !== 1)
    throw new Error("adversarial sign attempt changed the draft");
});

// ---- 3. issuance mechanics: idempotent signing, exact threshold ----
await check("3. Signing is idempotent; issue happens at exactly the threshold", async () => {
  await reset();
  await viewAs(COSIGNER2);
  const created = await retry(() =>
    api("POST", "/api/curators", {
      action: "draft",
      feedId: "curator_recordsdesk",
      targetCastId: "0xcr0012",
      claim: "B4 mechanics: the chart here truncates its y-axis at 40, not zero.",
      evidenceLink: "https://example.org/b4/axis",
    })
  );
  if (created.json.draft.status !== "pending") throw new Error("1-of-2 draft issued prematurely");
  // author re-signs: idempotent, still 1 signature, still pending
  const again = await retry(() => api("POST", "/api/curators", { action: "sign", draftId: created.json.draft.id }));
  if (again.json.draft.status !== "pending") throw new Error("author double-sign issued the draft");
  // settle: the just-created draft must be readable before the deref below
  let r = await retryContent(curators, (x) => x.json.drafts.some((y) => y.id === created.json.draft.id), 4);
  let d = r.json.drafts.find((x) => x.id === created.json.draft.id);
  if (d.signedHandles.length !== 1) throw new Error("double-sign duplicated a signature");
  // second desk member signs → exactly at threshold → issued
  await viewAs(COSIGNER);
  const issue = await retry(() => api("POST", "/api/curators", { action: "sign", draftId: created.json.draft.id }));
  if (issue.json.draft.status !== "issued") throw new Error("threshold signature did not issue");
  // signing an issued draft is a no-op, not an error
  const post = await retry(() => api("POST", "/api/curators", { action: "sign", draftId: created.json.draft.id }));
  if (post.json.draft.status !== "issued") throw new Error("post-issue sign broke the draft");
  // retry until the issued annotation is readable; a genuine absence still fails below
  r = await retryContent(
    curators,
    (x) =>
      x.json.feeds
        .find((f) => f.id === "curator_recordsdesk")
        .annotations.some((a) => a.claim.includes("B4 mechanics")),
    4
  );
  const live = r.json.feeds
    .find((f) => f.id === "curator_recordsdesk")
    .annotations.find((a) => a.claim.includes("B4 mechanics"));
  if (!live) throw new Error("issued annotation missing from live feed");
});

// ---- 4. non-curators cannot draft; drafts carry personas, never the root ----
await check("4. Civilians cannot draft; issuance payloads are persona-only (no root shape)", async () => {
  await viewAs(CIVILIAN);
  const refused = await api("POST", "/api/curators", {
    action: "draft",
    feedId: "curator_recordsdesk",
    targetCastId: "0xcr0011",
    claim: "should never exist",
    evidenceLink: "",
  });
  if (refused.status !== 403) throw new Error(`civilian draft returned ${refused.status}, expected 403`);
  // structural leak check on every issuance-facing persona's payload —
  // the full needle scan runs in test:rootleak, which now covers /api/curators
  for (const h of [AUTHOR, COSIGNER, OTHER_DESK, CIVILIAN]) {
    await viewAs(h);
    const r = await curators();
    const text = JSON.stringify(r.json);
    if (/"rootId"\s*:/.test(text)) throw new Error(`curators payload for ${h} carries a rootId key`);
    if (/"root_[A-Za-z0-9]/.test(text)) throw new Error(`curators payload for ${h} carries a root_ value`);
  }
});

// ---- 5. a 1-of-1 desk issues at creation ----
await check("5. Single-curator desk: drafting IS issuing (threshold 1)", async () => {
  await reset();
  await viewAs(OTHER_DESK); // footnote_feiler, Footnote Desk, threshold 1
  const created = await retry(() =>
    api("POST", "/api/curators", {
      action: "draft",
      feedId: "curator_footnote",
      targetCastId: "0xcr0011",
      claim: "B4 solo desk: the filing quoted settled in March, not May.",
      evidenceLink: "https://example.org/b4/solo",
    })
  );
  if (created.json.draft.status !== "issued") throw new Error("1-of-1 draft did not issue at creation");
  // retry until the issued annotation is readable; a genuine absence still fails below
  const r = await retryContent(
    curators,
    (x) =>
      x.json.feeds
        .find((f) => f.id === "curator_footnote")
        .annotations.some((a) => a.claim.includes("B4 solo desk")),
    4
  );
  const live = r.json.feeds
    .find((f) => f.id === "curator_footnote")
    .annotations.find((a) => a.claim.includes("B4 solo desk"));
  if (!live) throw new Error("solo-desk annotation missing from live feed");
});

// ---- 6. the curator record ----
await check("6. Accuracy record: issued-with-signature counts shift on issue; tallies are consistent", async () => {
  await reset();
  await viewAs(AUTHOR);
  // settle: curatorRecord can drop an item for a round; a genuine absence still fails below
  let r = await retryContent(curators, (x) => x.json.curatorRecord.some((y) => y.feedId === "curator_recordsdesk"), 4);
  let rec = r.json.curatorRecord.find((x) => x.feedId === "curator_recordsdesk");
  if (!rec) throw new Error("desk member has no curator record");
  const before = rec.issuedSigned;
  if (before < 1) throw new Error("seeded valid annotation with this signature not counted");
  const acc = rec.accuracy;
  const total = acc.concur + acc.dispute;
  if (total > 0 && acc.accuracy !== Math.round((acc.concur / total) * 100))
    throw new Error("accuracy percentage inconsistent with its own tallies");
  if (total === 0 && acc.accuracy !== null) throw new Error("accuracy invented without verdicts");
  // civilians have no record
  await viewAs(CIVILIAN);
  if ((await curators()).json.curatorRecord.length !== 0) throw new Error("civilian has a curator record");
  // issue the seeded draft; the author's issued count rises by one
  await viewAs(COSIGNER);
  // settle: the seeded draft must be readable before the .id deref
  const draftId = (
    await retryContent(curators, (x) => x.json.drafts.some((d) => d.claim.includes(SEED_CLAIM_FRAGMENT)), 4)
  ).json.drafts.find((d) => d.claim.includes(SEED_CLAIM_FRAGMENT)).id;
  await retry(() => api("POST", "/api/curators", { action: "sign", draftId }));
  await viewAs(AUTHOR);
  // settle on the DELTA the assertion needs, not row existence (the row
  // exists before the sign too — existence would accept a stale read)
  rec = (
    await retryContent(
      curators,
      (x) => x.json.curatorRecord.find((y) => y.feedId === "curator_recordsdesk")?.issuedSigned === before + 1,
      4
    )
  ).json.curatorRecord.find((x) => x.feedId === "curator_recordsdesk");
  if (rec.issuedSigned !== before + 1)
    throw new Error(`issuedSigned ${rec.issuedSigned} after issue, expected ${before + 1}`);

  // the record UPDATES ON DISPUTE (the Gate 4 exit line): a fresh dispute
  // vote on a live desk annotation moves the tally by exactly one
  // settle: the annotation was just issued, so retry the read before the double deref
  const annId = (
    await retryContent(
      curators,
      (x) =>
        x.json.feeds
          .find((f) => f.id === "curator_recordsdesk")
          .annotations.some((a) => a.claim.includes(SEED_CLAIM_FRAGMENT)),
      4
    )
  ).json.feeds
    .find((f) => f.id === "curator_recordsdesk")
    .annotations.find((a) => a.claim.includes(SEED_CLAIM_FRAGMENT)).id;
  const disputesBefore = rec.accuracy.dispute;
  await viewAs(CIVILIAN);
  await retry(() => api("POST", "/api/annotations/vote", { annotationId: annId, vote: "dispute" }));
  await viewAs(AUTHOR);
  // settle on the dispute DELTA, not row existence
  rec = (
    await retryContent(
      curators,
      (x) =>
        x.json.curatorRecord.find((y) => y.feedId === "curator_recordsdesk")?.accuracy?.dispute ===
        disputesBefore + 1,
      4
    )
  ).json.curatorRecord.find((x) => x.feedId === "curator_recordsdesk");
  if (rec.accuracy.dispute !== disputesBefore + 1)
    throw new Error(`dispute tally ${rec.accuracy.dispute} after vote, expected ${disputesBefore + 1}`);
  const t2 = rec.accuracy.concur + rec.accuracy.dispute;
  if (rec.accuracy.accuracy !== Math.round((rec.accuracy.concur / t2) * 100))
    throw new Error("accuracy percentage did not recompute after the dispute");
});

// ---- 7. PAGE: the desk, the chrome, the threshold moment ----
await check("7. PAGE: desk shows 'Curating as', 1-of-2 progress, and the sign→live moment", async () => {
  await reset();
  await viewAs(COSIGNER);
  await page.goto(BASE + "/curators/desk", { waitUntil: "networkidle" });
  // poll for the client-rendered state instead of a flat wait (no reload: client-side fetch under test); original asserts below
  await pollUntil(
    async () => (await page.locator("[data-testid=curating-as]").innerText()).includes("@" + COSIGNER),
    { tries: 15, delayMs: 400 }
  );
  const chrome = await page.locator("[data-testid=curating-as]").innerText();
  if (!chrome.includes("@" + COSIGNER)) throw new Error(`chrome says "${chrome}", not the acting persona`);
  await pollUntil(
    async () => /1 of 2/.test(await page.locator("[data-testid=draft-progress]").first().innerText()),
    { tries: 15, delayMs: 400 }
  );
  const progress = await page.locator("[data-testid=draft-progress]").first().innerText();
  if (!/1 of 2/.test(progress)) throw new Error(`progress reads "${progress}", expected 1 of 2`);
  if (!progress.includes("@" + COSIGNER)) throw new Error("progress does not name the awaited co-signer");
  await page.locator("[data-testid=draft-sign]").first().click();
  let live = false;
  for (let i = 0; i < 15 && !live; i++) {
    await page.waitForTimeout(400);
    live = (await page.locator("[data-testid=draft-live]").count()) > 0;
  }
  if (!live) throw new Error("signing did not surface the issued state");
  // settle the feed read before the final assertion; a genuine absence still fails below
  const r = await retryContent(
    curators,
    (x) =>
      x.json.feeds
        .find((f) => f.id === "curator_recordsdesk")
        .annotations.some((a) => a.claim.includes(SEED_CLAIM_FRAGMENT)),
    4
  );
  if (
    !r.json.feeds
      .find((f) => f.id === "curator_recordsdesk")
      .annotations.some((a) => a.claim.includes(SEED_CLAIM_FRAGMENT))
  )
    throw new Error("page-signed draft did not reach the live feed");
  await viewAs(null);
});

await reset();
await viewAs(null);
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Tier B Gate 4 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
