// MEGA PASS 2 — Gate 2 acceptance (fixture): LENSES — the algo through different curves.
//   1. ROUND TRIP through the algo pipeline: a seeded lens exports as a signed artifact, previews with EXACT counts
//      and the influence delta, imports and pins itself on the active mode; the preview's hides equal the
//      post-activation reality to the post
//   2. SWITCHING RE-RANKS MEASURABLY: canonical is the identity (byte-for-byte the feed without a lens); the
//      dwell-heavy lens moves posts; the settings preview shows the same re-ranked order the feed serves
//   3. HOSTILE LENS refused on all FIVE guardrails BY NAME (destination indicator, correction cards, disclosure,
//      the k-floor, the overdraw rule) — and all five surfaces still function afterwards
//   4. EVALUATE API: base terms + lens terms sum to the score exactly; the canonical lens contributes nothing
//   5. LEGIBILITY: under the dwell-heavy lens the seeded coordinated cluster's accrual is LOWER than canonical
//   6. A FILTER PACK MAY PIN A LENS: attached to a mode with no lens of its own, the pack's lens applies;
//      the mode's own pin wins; detaching returns to canonical
//   7. STRIPPED, NEVER SILENT: an unknown signal and an out-of-range weight are stripped AND reported at preview;
//      a stripped lens is not what its author signed, so the import refuses on the signature
// Fixture, pinned ports, no network, no spend.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const seedAccounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(seedAccounts);

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const SLOW = "lens_slow_reads";
const CANON = "lens_canonical";
const CLUSTER = ["persona_acc_crypto_4", "persona_acc_crypto_5", "persona_acc_crypto_6"];
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

await assertServersUp(BASE);
async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? JSON.stringify(r.json)?.slice(0, 200))); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const reset = () => retry(() => dev("resetSeed"));
const lenses = async () => (await retry(() => api("GET", "/api/lenses"))).json;
const apply = (lensId, modeId) => retry(() => api("POST", "/api/lenses", { action: "apply", lensId, ...(modeId ? { modeId } : {}) }));
const feedPosts = async () => ((await retry(() => api("GET", "/api/feed2"))).json.cards ?? []).filter((c) => c.kind === "post" && c.cast && !c.private).map((c) => c.cast.hash);
const moved = (a, b) => b.filter((h, i) => a[i] !== h).length;

await reset();
let canonicalOrder = [];
let slowOrder = [];
let importedLensId = null;

await check("1. ROUND TRIP: a seeded lens exports signed, previews with EXACT counts + the influence delta, imports and pins itself on the active mode; preview hides == post-activation reality", async () => {
  const L = await lenses();
  if (!L.lenses.some((l) => l.id === CANON) || !L.lenses.some((l) => l.id === SLOW)) throw new Error("seeded lenses missing: " + JSON.stringify(L.lenses.map((l) => l.id)));
  if (L.active.id !== CANON || L.active.source !== "canonical") throw new Error("the active mode does not start on the canonical lens: " + JSON.stringify(L.active));
  canonicalOrder = await feedPosts();
  if (canonicalOrder.length < 10) throw new Error("feed too small to measure: " + canonicalOrder.length);
  const exp = (await retry(() => api("GET", `/api/lenses?export=${SLOW}`))).json.artifact;
  if (exp.kind !== "lens" || !exp.lens || !/^[0-9a-f]{128}$/.test(exp.signature)) throw new Error("export is not a signed lens artifact: " + JSON.stringify(Object.keys(exp)));
  if (!exp.lens.signals || !exp.lens.influenceDistribution) throw new Error("the lens section is incomplete");
  const pv = (await retry(() => api("POST", "/api/algo/preview", { artifact: exp }))).json.preview;
  if (!pv || typeof pv.hides !== "number" || pv.total !== canonicalOrder.length) throw new Error("preview counts are not exact against the current feed: " + JSON.stringify({ hides: pv?.hides, total: pv?.total, feed: canonicalOrder.length }));
  if (!pv.influence || typeof pv.influence.canonical?.score !== "number" || typeof pv.influence.underLens?.score !== "number") throw new Error("preview carries no influence delta: " + JSON.stringify(pv.influence));
  if (pv.violations.length) throw new Error("a clean export reported violations: " + JSON.stringify(pv.violations));
  const imp = await api("POST", "/api/algo/import", { artifact: exp, activate: true });
  if (imp.status !== 200 || !imp.json.lens?.id) throw new Error("import failed: " + imp.status + " " + JSON.stringify(imp.json).slice(0, 300));
  importedLensId = imp.json.lens.id;
  const after = await lenses();
  if (after.active.id !== importedLensId || after.active.source !== "mode") throw new Error("the imported lens is not pinned on the active mode: " + JSON.stringify(after.active));
  if (!after.lenses.some((l) => l.id === importedLensId)) throw new Error("the imported lens is not listed");
  const now = await feedPosts();
  const hidden = canonicalOrder.filter((h) => !now.includes(h)).length;
  if (hidden !== pv.hides) throw new Error(`preview said hides=${pv.hides}, activation hid ${hidden}`);
  slowOrder = now;
});

await check("2. SWITCHING RE-RANKS MEASURABLY: canonical is the identity; the dwell-heavy lens moves posts; the settings preview shows the order the feed serves", async () => {
  await apply(null);
  const backOnCanon = await feedPosts();
  if (backOnCanon.join() !== canonicalOrder.join()) throw new Error("back on canonical the feed is not byte-for-byte the original order");
  if ((await lenses()).active.id !== CANON) throw new Error("active lens is not canonical after apply(null)");
  await apply(SLOW);
  const under = await feedPosts();
  const n = moved(canonicalOrder, under);
  if (n < 5) throw new Error(`the dwell-heavy lens moved only ${n} posts`);
  if (under.join() !== slowOrder.join()) throw new Error("the seeded lens and its imported copy rank differently");
  const pv = (await retry(() => api("GET", `/api/lenses?preview=${SLOW}`))).json;
  if (pv.moved !== n) throw new Error(`the pane preview reports ${pv.moved} moved, the feed moved ${n}`);
  if (pv.under.map((p) => p.hash).join() !== under.join()) throw new Error("the pane's re-ranked order differs from the feed's");
  // the money shot renders: two columns and the delta line
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE + "/settings/lenses", { waitUntil: "networkidle" });
    await page.locator(`[data-testid='lens-preview-${SLOW}']`).click();
    await page.locator("[data-testid='lens-preview']").waitFor({ timeout: 15000 });
    const shown = Number(await page.locator("[data-testid='lens-preview']").getAttribute("data-moved"));
    if (shown !== n) throw new Error(`the pane shows ${shown} moved`);
    const delta = page.locator("[data-testid='lens-influence-delta']");
    if (!(await delta.count())) throw new Error("no influence delta rendered");
    const active = await page.locator("[data-testid='lens-active']").getAttribute("data-lens");
    if (active !== SLOW) throw new Error("the pane does not show the active lens: " + active);
  } finally {
    await browser.close();
  }
});

await check("3. HOSTILE LENS refused on all FIVE guardrails BY NAME, and all five surfaces still function", async () => {
  const exp = (await retry(() => api("GET", `/api/lenses?export=${SLOW}`))).json.artifact;
  const hostile = { ...exp, lens: { ...exp.lens, hideDestination: true, suppressCorrections: true, disclosure: "public", kFloor: 1, allowOverdraw: true } };
  const before = await lenses();
  const imp = await api("POST", "/api/algo/import", { artifact: hostile, activate: true });
  if (imp.status === 200) throw new Error("the hostile lens imported");
  const v = JSON.stringify(imp.json?.violations ?? []);
  for (const k of ["hideDestination", "suppressCorrections", "disclosure", "kFloor", "allowOverdraw"]) if (!v.includes(`"${k}"`)) throw new Error("refusal does not name " + k + ": " + v.slice(0, 300));
  if (!/refused/.test(v)) throw new Error("the refusal is not marked as a refusal (stripped instead): " + v.slice(0, 200));
  const pv = (await api("POST", "/api/algo/preview", { artifact: hostile })).json?.preview;
  if (!pv || pv.total !== 0 || !JSON.stringify(pv.violations).includes("kFloor")) throw new Error("the preview did not refuse the hostile lens: " + JSON.stringify(pv).slice(0, 200));
  const after = await lenses();
  if (after.lenses.length !== before.lenses.length || after.active.id !== before.active.id) throw new Error("the hostile import changed the lens store or the active lens");
  // the five surfaces
  // (1) the composer destination indicator renders (client-side) for a PRIVATE persona — the same probe Tier A's hostile-artifact check uses
  const privateId = seedList.find((p) => p.handle === "backyard_scope")?.id;
  if (!privateId) throw new Error("setup: private persona backyard_scope not in the seed");
  await retry(() => dev("viewAs", { personaId: privateId }));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "layers_view_as", value: privateId, url: BASE }]);
    const page = await ctx.newPage();
    await page.goto(BASE + "/home", { waitUntil: "networkidle" });
    let seen = 0;
    for (let i = 0; i < 20 && !seen; i++) { seen = await page.locator("[data-testid=composer-audience]").count(); if (!seen) await sleep(400); }
    if (!seen) throw new Error("composer destination indicator missing");
  } finally {
    await browser.close();
    await retry(() => dev("viewAs", { personaId: null }));
  }
  const feed = (await retry(() => api("GET", "/api/feed2"))).json.cards;
  if (!feed.some((c) => c.kind === "correction")) throw new Error("correction cards absent");
  const d = (await retry(() => api("GET", `/api/disclosure?personaId=${MAIN}&viewerPersonaId=${ALT}`))).json;
  if (d.canViewLinkage !== true) throw new Error("disclosure behaviour changed");
  const k = (await retry(() => api("GET", "/api/market/campaign"))).json;
  if (!(k.kFloor >= 1)) throw new Error("k-floor vanished: " + JSON.stringify(k).slice(0, 100));
  const over = await api("POST", "/api/influence", { action: "stake", castHash: "0xcr0001", stakeAction: "like", amount: 50 });
  const a = (await retry(() => api("GET", "/api/influence?view=allowance"))).json.allowance;
  if (a.remaining >= 50 ? over.status !== 200 : over.status !== 409) throw new Error("the overdraw rule changed: " + over.status + " with remaining " + a.remaining);
});

await check("4. EVALUATE API: base terms + lens terms sum to the score exactly; the canonical lens contributes nothing; every canonical signal is listed", async () => {
  const e = (await retry(() => api("GET", `/api/lenses/${SLOW}/evaluate?castId=0xcr0036`))).json;
  const sum = (ts) => ts.reduce((acc, t) => acc + t.contribution, 0);
  if (Math.abs(sum(e.base) + sum(e.lens) - e.score) > 1e-9) throw new Error(`breakdown does not sum to the score: ${sum(e.base)} + ${sum(e.lens)} ≠ ${e.score}`);
  if (Math.abs(sum(e.lens) - e.lensScore) > 1e-9 || Math.abs(sum(e.base) - e.baseScore) > 1e-9) throw new Error("partial sums disagree with the reported partial scores");
  const signals = e.lens.map((t) => t.signal);
  for (const s of ["recasts", "likes", "stakesGood", "stakesWorthReading", "stakesWrong", "stakesMisleading", "stakesNoteWorthy", "dwell", "tier", "attestations", "curatorSubscriptions", "earlyCurve", "saturation"]) if (!signals.includes(s)) throw new Error("signal missing from the breakdown: " + s);
  if (!e.lens.some((t) => t.signal === "dwell" && t.weight === 3)) throw new Error("the dwell weight is not the lens's");
  if (!e.base.some((t) => t.term === "recency" && t.contribution > 0)) throw new Error("the base terms are not the mode's ranking");
  const c = (await retry(() => api("GET", `/api/lenses/${CANON}/evaluate?castId=0xcr0036`))).json;
  if (c.lens.some((t) => t.contribution !== 0) || c.score !== c.baseScore) throw new Error("the canonical lens is not the identity in the evaluate API");
  const bad = await api("GET", `/api/lenses/${SLOW}/evaluate`);
  if (bad.status !== 400) throw new Error("evaluate without castId was not refused");
});

await check("5. LEGIBILITY: under the dwell-heavy lens the seeded coordinated cluster's accrual is LOWER than under canonical (early curve off, coordination discounted)", async () => {
  const E = (await retry(() => api("GET", "/api/influence?view=allowance"))).json.allowance.epoch;
  const d = (await retry(() => api("GET", `/api/lenses?delta=${SLOW}&personaIds=${CLUSTER.join(",")}&epoch=${E - 1}`))).json.delta;
  if (!(d.canonical.evaluated >= 9)) throw new Error("the cluster's stakes were not evaluated: " + JSON.stringify(d));
  if (!(d.canonical.score > 0)) throw new Error("the cluster accrues nothing even under canonical: " + JSON.stringify(d));
  if (!(d.underLens.score < d.canonical.score)) throw new Error(`the dwell-heavy lens did not reduce the cluster's accrual: ${d.underLens.score} vs ${d.canonical.score}`);
  const ev = (await retry(() => api("GET", `/api/influence?view=evaluate&personaId=${CLUSTER[0]}&epoch=${E - 1}&curves=${encodeURIComponent(JSON.stringify({ early: { enabled: false, weight: 0, halfLifeRank: 3 }, confirmation: { confirmedWeight: 1, unconfirmedWeight: 0 }, pointsPerStewardship: 5, maxStewardshipPerEpoch: 10, coordination: { enabled: true, penalty: 0.5 } }))}`))).json.evaluation;
  if (!ev.items.some((i) => i.coordinated)) throw new Error("the cluster member's stakes are not marked coordinated in the evaluation");
});

await check("6. A FILTER PACK MAY PIN A LENS: attached to a mode with no lens of its own the pack's lens applies; the mode's own pin wins; detaching returns to canonical", async () => {
  await apply(null);
  const pack = (await retry(() => api("POST", "/api/packs/export", { name: "Lens pack", summary: "pins slow reads", lensId: SLOW }))).json.artifact;
  if (!pack.lens || pack.kind !== "filter_pack") throw new Error("the pack export carries no lens section");
  const imp = (await retry(() => api("POST", "/api/algo/import", { artifact: pack, activate: false }))).json;
  if (!imp.pack?.id) throw new Error("pack import failed: " + JSON.stringify(imp).slice(0, 200));
  const modeId = (await lenses()).activeModeId;
  await retry(() => api("PATCH", "/api/modes", { modeId, patch: { filterPackIds: [imp.pack.id] } }));
  const viaPack = await lenses();
  if (viaPack.active.source !== "pack") throw new Error("the pack's lens does not apply: " + JSON.stringify(viaPack.active));
  const order = await feedPosts();
  if (order.join() !== slowOrder.join()) throw new Error("the pack-pinned lens ranks differently from the lens itself");
  await apply(SLOW, modeId);
  if ((await lenses()).active.source !== "mode") throw new Error("the mode's own pin did not win over the pack's");
  await apply(null, modeId);
  await retry(() => api("PATCH", "/api/modes", { modeId, patch: { filterPackIds: [] } }));
  const back = await lenses();
  if (back.active.id !== CANON) throw new Error("detaching the pack did not return to canonical: " + JSON.stringify(back.active));
  if ((await feedPosts()).join() !== canonicalOrder.join()) throw new Error("the feed did not return to the canonical order");
});

await check("7. STRIPPED, NEVER SILENT: an unknown signal and an out-of-range weight are stripped AND reported at preview; a stripped lens is not what its author signed, so the import refuses on the signature", async () => {
  const exp = (await retry(() => api("GET", `/api/lenses?export=${SLOW}`))).json.artifact;
  const noisy = { ...exp, lens: { ...exp.lens, signals: { ...exp.lens.signals, sparkle: 2, dwell: 99 } } };
  const pv = (await api("POST", "/api/algo/preview", { artifact: noisy })).json?.preview;
  const v = JSON.stringify(pv?.violations ?? []);
  if (!/sparkle/.test(v) || !/stripped/.test(v)) throw new Error("the unknown signal was not reported as stripped: " + v.slice(0, 200));
  if (!/"dwell"/.test(v)) throw new Error("the out-of-range weight was not reported: " + v.slice(0, 200));
  // the sanitized shape no longer matches the signature, so the import must refuse on the SIGNATURE — a stripped
  // artifact is a changed artifact, and its author did not sign this one
  const imp = await api("POST", "/api/algo/import", { artifact: noisy, activate: false });
  if (imp.status === 200) throw new Error("a stripped artifact imported under its original signature");
  if (!/signature/.test(JSON.stringify(imp.json?.violations ?? []))) throw new Error("the refusal does not name the signature: " + JSON.stringify(imp.json).slice(0, 200));
});

await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Mega pass 2 Gate 2 (lenses) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
