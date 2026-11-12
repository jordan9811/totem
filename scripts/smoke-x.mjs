// PERSONA LAUNCH P2 (BYX v1) — the PRODUCTION-SHAPE smoke for "Bring your X": the import runs in a FRESH browser
// profile, answered by the in-tab device (the server holds no identity), against the local prod-shape pair
// (scripts/run-prod-shape.sh) or a deployment:
//   BASE_URL=http://localhost:3001 VALIDATOR_URL=http://127.0.0.1:4001 [EXPECT_X_INDEX=absent|built] node scripts/smoke-x.mjs
//   P1  GET <validator>/x/fc-index/meta matches EXPECT_X_INDEX (default "absent": no index built on this validator);
//       absent → after the import the people panel says the list isn't available here, never a count
//   P2  the synthetic ZIP (with 20 MB of junk media) is read IN THE TAB → the planted counts → Import → the device's
//       shelf holds 3,000 posts
//   P3  (EXPECT_X_INDEX=built only) "Check again" against the deployment's REAL index → at least the 3 real matches
//       (dwr, varunsrin, mirceap); skipped, and said so, otherwise
//   P5  the honest words and the Save moment (reviews UX-5, UX-10): before Import the page says the archive FILE never
//       leaves the browser and the picked parts are saved sealed (never "nothing is uploaded"), and that this identity
//       lives only in this tab; no Save card before Import, the card once the import lands
//   P4  "See your history on @handle" is a SOFT navigation (review UX-1): the profile it opens shows the 3,000 posts
//   P6  the browser never requested api.farcaster.xyz or fnames.farcaster.xyz (the device never crawls)
//   P7  every PUT /state/* the browser sent was under 256 KiB and was accepted (no 413)
//   P8  a FULL load of the Attestations page: the tab-only identity is gone with its shelf (P4's vacuity check), and
//       the Linked accounts panel tells a guest no Farcaster how-to it cannot follow (review UX-11)
// One fresh profile, TWO new roots (the first boot, and P8's full load): the per-address daily cap on new roots
// applies on a deployment.
import { chromium } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PLANT, writeSynthArchive } from "./lib/x-archive-synth.mjs";

const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
const EXPECT = (process.env.EXPECT_X_INDEX || "absent").trim();
if (!["absent", "built"].includes(EXPECT)) {
  console.log("EXPECT_X_INDEX must be absent or built");
  process.exit(2);
}
const LIMIT = 262144;
const results = [];
const ok = (n, extra) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n + (extra ? " — " + extra : ""));
};
const fail = (n, d) => {
  results.push(["FAIL", n, d]);
  console.log("  FAIL  " + n + (d ? " — " + d : ""));
};
const skip = (n, why) => {
  results.push(["SKIP", n, why]);
  console.log("  SKIP  " + n + " — " + why);
};
async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, typeof extra === "string" ? extra : undefined);
  } catch (e) {
    fail(name, e.message);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, { tries = 60, delayMs = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await pred()) return true;
    await sleep(delayMs);
  }
  return false;
}

console.log(`\nBring your X — production-shape smoke (app ${BASE}, validator ${VBASE}, index expected ${EXPECT})`);
const TMP = mkdtempSync(path.join(os.tmpdir(), "layers-smoke-x-"));
const synth = writeSynthArchive(TMP, { seed: 11, junkMB: 20 });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
const page = await ctx.newPage();
const requests = [];
const puts = [];
page.on("request", (r) => {
  requests.push(r.url());
  if (r.method() === "PUT" && /\/state\//.test(r.url())) puts.push({ url: r.url(), bytes: Buffer.byteLength(r.postData() ?? "", "utf8"), status: null, req: r });
});
page.on("response", (res) => {
  const p = puts.find((x) => x.req === res.request());
  if (p) p.status = res.status();
});
page.on("pageerror", (e) => console.log("   [pageerror] " + String(e).slice(0, 160)));

const deviceApi = (method, p, body) =>
  page.evaluate(async ({ method, p, body }) => {
    const r = await fetch(p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try {
      json = await r.json();
    } catch {}
    return { status: r.status, json };
  }, { method, p, body });

const waitDevice = () =>
  page.evaluate(() => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("the device did not boot within 60 s")), 60000);
    const wait = () => (window.__layersDevice ? window.__layersDevice.ready.then((i) => { clearTimeout(t); res(i); }, rej) : setTimeout(wait, 100));
    wait();
  }));

let meta = null;
/** what the pick step said before Import (P5 reads it) */
let beforeImport = null;
await check(`P1a. the validator's X index status is "${EXPECT}" (EXPECT_X_INDEX)`, async () => {
  const r = await fetch(VBASE + "/x/fc-index/meta", { cache: "no-store" });
  if (r.status !== 200) throw new Error("meta answered " + r.status);
  meta = await r.json();
  if (meta.available !== (EXPECT === "built")) throw new Error("meta.available " + meta.available + " but EXPECT_X_INDEX=" + EXPECT);
  if (EXPECT === "absent") {
    const idx = await fetch(VBASE + "/x/fc-index", { cache: "no-store" });
    if (idx.status !== 503) throw new Error("no index, but /x/fc-index answered " + idx.status + " (it must be 503, never an empty index)");
  }
  return meta.available ? `${meta.rows} rows, built ${meta.builtAt}` : "not built";
});

await check("P2. a fresh profile reads the synthetic ZIP IN THE TAB → the planted counts → Import → the device's shelf holds 3,000 posts", async () => {
  await page.goto(BASE + "/settings/import-x", { waitUntil: "load" });
  await waitDevice();
  await page.getByTestId("import-file").waitFor({ state: "attached", timeout: 60_000 });
  if ((await page.getByTestId("import-load-fixture").count()) !== 0) throw new Error("the fixture button is offered on a production-shaped site");
  // P5's "before" half, read on the pick step: the local-only sentence once the route said who keeps the lanes, the
  // tab-only sentence once the device said the identity is only in this tab, and no Save card yet
  const local = page.getByTestId("import-local-only");
  await until(async () => (await local.getAttribute("data-saved-by")) !== "");
  await until(async () => (await page.getByTestId("import-tab-only").count()) === 1, { tries: 30 });
  beforeImport = {
    savedBy: await local.getAttribute("data-saved-by"),
    local: (await local.innerText()).replace(/\s+/g, " "),
    tabOnly: (await page.getByTestId("import-tab-only").count()) === 1 ? await page.getByTestId("import-tab-only").innerText() : null,
    card: await page.getByTestId("save-moment").count(),
  };
  await page.setInputFiles("[data-testid=import-file]", synth.zipPath);
  if (!(await until(async () => (await page.locator("[data-testid=import-preview][data-source=page]").count()) === 1, { tries: 120 }))) throw new Error("the archive was not read in the tab");
  const summary = await page.getByTestId("import-summary").innerText();
  if (!summary.includes("3,000 posts (400 retweets, 600 replies)") || !summary.includes("1,000 people you follow")) throw new Error("summary: " + summary);
  await page.getByTestId("import-ack-fingerprint").check();
  await page.getByTestId("import-commit").click();
  if (!(await until(async () => (await page.locator("[data-testid=import-done], [data-testid=import-error]").count()) >= 1, { tries: 240 }))) throw new Error("the import did not finish");
  if ((await page.getByTestId("import-error").count()) > 0) throw new Error("import error: " + (await page.getByTestId("import-error").innerText()));
  const sum = await deviceApi("GET", "/api/x/import?view=summary");
  if (sum.status !== 200 || sum.json?.shelf?.count !== 3000) throw new Error("the device's shelf: " + JSON.stringify(sum.json?.shelf ?? sum.json).slice(0, 200));
  if (sum.json.fixtureAvailable !== false) throw new Error("fixtureAvailable on a production-shaped site");
  return summary;
});

await check("P5. the honest words and the Save moment (reviews UX-10, UX-5): the file never leaves the browser and the picked parts are saved sealed; the identity is said to live only in this tab; no Save card before Import, the card once it lands", async () => {
  if (!beforeImport) throw new Error("P2 did not reach the pick step");
  if (beforeImport.savedBy !== "device") throw new Error("savedBy " + beforeImport.savedBy + " on a production-shaped site (the in-tab device keeps the lanes)");
  if (!beforeImport.local.includes("The archive file never leaves this browser.") || !/Only the parts you pick below are saved, sealed so Totem.\s?server can.t read them\./.test(beforeImport.local))
    throw new Error("the local-only sentence reads: " + beforeImport.local);
  if (/Nothing is uploaded/.test(beforeImport.local)) throw new Error("the overstated 'Nothing is uploaded' is back");
  if (!beforeImport.tabOnly || !/lives only in this tab; save it before importing/.test(beforeImport.tabOnly)) throw new Error("no tab-only sentence before the import: " + beforeImport.tabOnly);
  if (beforeImport.card !== 0) throw new Error("a Save card was showing before the import (the moment would be unmeasured)");
  // the import landed in P2: the card is the import's moment
  try {
    await page.getByTestId("save-moment").waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    throw new Error("no Save card after the import landed (SaveMoment's MOMENT_KINDS must name \"import\")");
  }
  // out of the way of the clicks that follow; the strip stays until the identity is saved
  await page.getByTestId("save-moment-dismiss").click();
  return beforeImport.tabOnly;
});

await check(`P1b. the people panel says what the index state says (${EXPECT === "absent" ? "'isn't available on this site yet', no count" : "a count is offered"})`, async () => {
  // PERSONA LAUNCH P2 (verify): NO reload here. The public device is ephemeral-first (D-CU-0-6: an unsaved identity
  // lives in the tab's memory), so a page.goto boots a NEW device with nothing imported and the panel rightly says
  // "Import who you follow" — the check then measured a stranger. The panel re-reads on "layers:x-imported", so the
  // same page settles; and it must have read THIS import (the 1,000 planted follows), or a panel that never saw the
  // list could pass on its wording alone.
  if (!(await until(async () => (await page.locator("[data-testid=x-people-unavailable], [data-testid=x-people-unchecked], [data-testid=x-people-sentence]").count()) >= 1)))
    // say what the panel DID show (an error, "import who you follow", or still checking)
    throw new Error("the people panel did not settle: " + ((await page.getByTestId("x-people").innerText().catch(() => "(no panel)")) || "").replace(/\s+/g, " ").slice(0, 240));
  const seen = (await page.getByTestId("x-people").innerText()).replace(/\s+/g, " ");
  if (!seen.includes("1,000 people you follow")) throw new Error("the panel did not read the imported follow list: " + seen.slice(0, 240));
  // review UX-10: where the follow list lives, in true words (a sealed copy IS stored; never "never sent anywhere")
  const privacy = page.getByTestId("x-people-privacy");
  if ((await privacy.getAttribute("data-saved-by")) !== "device") throw new Error("the panel's savedBy " + (await privacy.getAttribute("data-saved-by")));
  const pt = (await privacy.innerText()).replace(/\s+/g, " ");
  if (!/matched on your own device, and Totem.\s?server keeps only a sealed copy it can.t read/.test(pt) || /never sent anywhere/.test(pt)) throw new Error("the privacy line reads: " + pt);
  if (EXPECT === "absent") {
    if ((await page.getByTestId("x-people-sentence").count()) !== 0) throw new Error("a count without an index");
    const t = await page.getByTestId("x-people-unavailable").innerText();
    if (!/isn.t available on this site yet/.test(t)) throw new Error("panel: " + t);
  } else if ((await page.getByTestId("x-people-unavailable").count()) !== 0) throw new Error("the panel says unavailable while the index is built");
});

if (EXPECT === "built") {
  await check("P3. 'Check again' against the deployment's REAL index → at least the 3 real matches", async () => {
    await page.getByTestId("x-people-check").click();
    if (!(await until(async () => (await page.getByTestId("x-people-sentence").count()) === 1, { tries: 240 }))) throw new Error("no sentence");
    const matched = Number(await page.getByTestId("x-people-sentence").getAttribute("data-matched"));
    if (!(matched >= 3)) throw new Error("matched " + matched);
    const xs = await page.getByTestId("x-people-x").evaluateAll((as) => as.map((a) => a.textContent));
    for (const f of PLANT.realFollows) if (!xs.includes("@" + f.xu)) throw new Error("missing @" + f.xu);
    return matched + " matched";
  });
} else {
  skip("P3. a rematch against the real index", "EXPECT_X_INDEX=absent (no index on this validator)");
}

await check("P4. 'See your history on @handle' is a SOFT navigation (review UX-1): the profile it opens on this tab-only identity shows the 3,000 imported posts", async () => {
  const link = page.getByTestId("done-see-shelf");
  if ((await link.count()) !== 1) throw new Error("the done step offers no link to the history");
  const href = await link.getAttribute("href");
  await page.evaluate(() => (window.__smokeXSoft = 1));
  await link.click();
  await page.waitForURL((u) => new URL(u).pathname === href, { timeout: 30_000 });
  if ((await page.evaluate(() => window.__smokeXSoft)) !== 1) throw new Error("a FULL page load, not a soft navigation: the tab-only identity and its import were wiped");
  const shelf = page.getByTestId("imported-from-x");
  if (!(await until(async () => (await shelf.count()) === 1 && (await shelf.getAttribute("data-state")) === "ok", { tries: 120 })))
    throw new Error("the profile shows no readable shelf: " + ((await shelf.innerText().catch(() => "(no shelf)")) || "").replace(/\s+/g, " ").slice(0, 200));
  const total = await page.getByTestId("shelf-counts").getAttribute("data-total");
  if (total !== "3000") throw new Error("the shelf's total is " + total + ", not 3000");
  return href + " shows 3,000 posts";
});

await check("P6. the browser never requested api.farcaster.xyz or fnames.farcaster.xyz (the device never crawls the lists)", async () => {
  const bad = requests.filter((u) => /api\.farcaster\.xyz|fnames\.farcaster\.xyz/.test(u));
  if (bad.length) throw new Error(bad.length + " request(s): " + bad[0]);
  if (requests.length < 10) throw new Error("only " + requests.length + " requests were recorded — the check would be vacuous");
  return requests.length + " requests checked";
});

await check("P7. every PUT /state/* the browser sent was under 256 KiB and accepted", async () => {
  if (puts.length < 8) throw new Error("only " + puts.length + " state PUTs were seen — the import did not save its pieces from the tab");
  const big = puts.filter((p) => p.bytes >= LIMIT);
  if (big.length) throw new Error(big.length + " PUT(s) at or over the limit, largest " + Math.max(...big.map((p) => p.bytes)));
  const refused = puts.filter((p) => p.status !== null && p.status !== 200);
  if (refused.length) throw new Error(refused.length + " PUT(s) refused: " + refused.map((p) => p.status).join(","));
  const pieces = puts.filter((p) => /\/state\/xShelf\.g[01]\.\d+$/.test(p.url));
  if (pieces.length < 8) throw new Error("the shelf was not saved in pieces from the tab: " + pieces.length);
  return `${puts.length} PUTs, largest ${Math.max(...puts.map((p) => p.bytes))} B`;
});

await check("P8. a FULL load drops the tab-only identity with its shelf (so P4 measured the soft navigation, not luck), and the Linked accounts panel offers a guest no Farcaster how-to it cannot follow (review UX-11)", async () => {
  await page.goto(BASE + "/settings/attestations", { waitUntil: "load" });
  await waitDevice();
  const sum = await deviceApi("GET", "/api/x/import?view=summary");
  if (sum.status !== 200) throw new Error("the new identity's summary answered " + sum.status);
  if (sum.json?.shelf?.count !== 0) throw new Error("the shelf survived a full load (" + sum.json?.shelf?.count + "): P4 would be vacuous");
  await page.getByTestId("linked-accounts").waitFor({ timeout: 60_000 });
  if (!(await until(async () => (await page.locator("[data-testid=link-unavailable], [data-testid=link-how], [data-testid=link-error]").count()) >= 1)))
    throw new Error("the Linked accounts panel did not settle");
  if ((await page.getByTestId("link-how").count()) !== 0) throw new Error("the public site tells a guest to verify X on a Farcaster account this persona does not have");
  if ((await page.getByTestId("link-error").count()) !== 0) throw new Error("the panel shows an error: " + (await page.getByTestId("link-error").innerText()));
  const t = await page.getByTestId("link-unavailable").innerText();
  if (!/Showing your X account on a persona isn.t available on this site yet/.test(t)) throw new Error("the panel reads: " + t);
  return "shelf 0 after the full load; " + t;
});

await browser.close();
rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => r[0] === "FAIL");
const passed = results.filter((r) => r[0] === "PASS");
console.log(`\n${passed.length}/${passed.length + failed.length} smoke-x checks passed` + (results.some((r) => r[0] === "SKIP") ? " (P3 skipped: EXPECT_X_INDEX=absent)" : ""));
process.exit(failed.length ? 1 : 0);
