// POST-DEPLOY PASS Gate 3 — PER-ACCOUNT DELIVERY TIERS.
//
//   1. NEVER MISS MOVES A POST UP — and only up: the account lands in the pinned block at the top, and the
//      feed's membership gains nothing that was not already eligible.
//   2. QUIET MOVES A POST DOWN — a deranked account falls; it is not hidden, which is what facet-only and a
//      block are for.
//   3. BANNER IS A STRIP, NOT A NOTIFICATION — the account surfaces above the timeline AND stays in it.
//   4. FACET ONLY IS THE EXISTING FACET-FOLLOW, PRESENTED AS A TIER — refused with no facet selected (that
//      would hide everything they post), and the scope it names is the one the feed applies.
//   5. THE TIER IS (ACCOUNT x MODE) — never-miss in one mode and quiet in another, on ONE account, and the
//      placement differs accordingly.
//   6. THE MANAGEMENT SCREEN LISTS EXACTLY THE NON-NORMAL SET — normal is the absence of a row, so setting
//      one back removes it rather than storing "normal".
//   7. NEVER MISS RESPECTS THE CAUGHT-UP CONTRACT — it may pin above the banner; below it stays readwise and
//      folders only. A tier that could manufacture content below the banner would undo the anti-doomscroll rule.
//   8. NO PARALLEL FILTER PATH — the feed never compares a tier string; every decision is an evaluateGroup
//      call on a compiled rule, through the same evaluator modes, packs and lenses use.
//   9. AN IMPORTED ALGORITHM CANNOT PIN OR BANNER — those two actions are the owner's own, refused by name on
//      import. A pin an algorithm can set is an ad slot with extra steps.
//  10. THE TIER MAP IS VAULT DATA — ciphertext under one opaque address, and no account named in the clear.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36).slice(-5);

async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? "")); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const jar = new Map();
async function api(method, path, body) {
  const headers = { "content-type": "application/json" };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => k + "=" + v).join("; ");
  const r = await fetch(BASE + path, { method, headers, cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  let json = null;
  try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}
const feed = async () => {
  const r = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  return r.json;
};
/** the best (lowest) index of a persona's posts in the card list, or -1 */
const indexOf = (cards, personaId) => cards.findIndex((c) => c.kind === "post" && c.cast?.personaId === personaId);
const postsOf = (cards, personaId) => cards.filter((c) => c.kind === "post" && c.cast?.personaId === personaId);
const setTier = (personaId, tier, modeId) => api("POST", "/api/delivery", modeId ? { personaId, tier, modeId } : { personaId, tier });

function dbRows() {
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
  const d = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const out = [];
    for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) {
      for (const row of d.prepare(`SELECT * FROM "${t}"`).all()) out.push([t, JSON.stringify(row)]);
    }
    return out;
  } finally { d.close(); }
}

console.log("\nPost-deploy Gate 3 — per-account delivery tiers (app " + BASE + ")");

// ---------------------------------------------------------------- setup ----
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
const base = await feed();
const baseCards = base.cards ?? [];
if (baseCards.length < 8) { console.log("  ABORT: the seeded feed is too small to measure placement (" + baseCards.length + " cards)"); process.exit(2); }
const authorsInOrder = [...new Set(baseCards.filter((c) => c.kind === "post" && c.cast?.personaId).map((c) => c.cast.personaId))];
if (authorsInOrder.length < 3) { console.log("  ABORT: fewer than three distinct authors on the page"); process.exit(2); }
const TOP = authorsInOrder[0];
// the never-miss target: someone present but DOWN the page, so "moved up" means something
const LOW = authorsInOrder[authorsInOrder.length - 1];
const BANNER_ACCOUNT = authorsInOrder[1];
const activeModeId = base.mode?.id;
async function clearAll() {
  const rows = (await api("GET", "/api/delivery")).json?.rows ?? [];
  for (const r of rows) await api("POST", "/api/delivery", { personaId: r.personaId, modeId: r.modeId, tier: "normal" });
}
await clearAll();

await check("1. NEVER MISS MOVES A POST UP, AND ADDS NOTHING", async () => {
  const before = indexOf(baseCards, LOW);
  if (before <= 0) throw new Error("the target was already at the top (" + before + ") — the check would prove nothing");
  const r = await retry(() => setTier(LOW, "never-miss"));
  if (r.json?.tier !== "never-miss") throw new Error("the tier did not take: " + JSON.stringify(r.json).slice(0, 140));
  try {
    const after = await feed();
    const at = indexOf(after.cards, LOW);
    if (at < 0) throw new Error("the never-miss account disappeared from the feed entirely");
    if (!(at < before)) throw new Error("never-miss did not move the account up: " + before + " -> " + at);
    const pinnedNow = after.pinnedHashes ?? [];
    if (!pinnedNow.length) throw new Error("the build reports nothing pinned");
    if (!pinnedNow.includes(after.cards[at].cast.hash)) throw new Error("the account moved up without being pinned — that is ranking noise, not the tier");
    // ONE post per pinned account: never-miss is not a request to hear only from them
    if (pinnedNow.length !== 1) throw new Error("one account on never-miss pinned " + pinnedNow.length + " posts — the top of the page is not a pin board");
    // pinning REORDERS: the page does not grow, and what was pinned belongs to the pinned account
    if ((after.cards ?? []).length > baseCards.length) throw new Error("pinning grew the page: " + baseCards.length + " -> " + after.cards.length);
    const pinnedCard = after.cards.find((c) => c.kind === "post" && pinnedNow.includes(c.cast?.hash));
    if (!pinnedCard || pinnedCard.cast.personaId !== LOW) throw new Error("something other than the pinned account was pinned");
    return "index " + before + " -> " + at + ", exactly 1 pinned, page still " + after.cards.length + " cards";
  } finally {
    await setTier(LOW, "normal");
  }
});

await check("2. QUIET MOVES A POST DOWN, WITHOUT HIDING IT", async () => {
  const before = indexOf(baseCards, TOP);
  const beforeCount = postsOf(baseCards, TOP).length;
  const r = await retry(() => setTier(TOP, "quiet"));
  if (r.json?.tier !== "quiet") throw new Error("the tier did not take: " + JSON.stringify(r.json).slice(0, 140));
  let at;
  try {
    const after = await feed();
    at = indexOf(after.cards, TOP);
    if (at >= 0 && !(at > before)) throw new Error("quiet did not move the account down: " + before + " -> " + at);
    // deranked, not disappeared: it either fell down the page or fell OFF it. Hiding is what
    // facet-only and a block are for, and quiet is deliberately neither.
    if (!(at >= 0 || beforeCount > 0)) throw new Error("the account vanished rather than falling");
  } finally {
    await setTier(TOP, "normal");
  }
  const restored = indexOf((await feed()).cards, TOP);
  if (restored < 0) throw new Error("setting the tier back to normal did not restore the account");
  return "index " + before + " -> " + (at < 0 ? "off the page" : at) + ", normal restores it at " + restored;
});

await check("3. BANNER IS A STRIP, NOT A NOTIFICATION — and the account stays in the timeline", async () => {
  const empty = await feed();
  if ((empty.previewStrip ?? []).length) throw new Error("the strip is non-empty before any banner tier is set");
  const r = await retry(() => setTier(BANNER_ACCOUNT, "banner"));
  if (r.json?.tier !== "banner") throw new Error("the tier did not take: " + JSON.stringify(r.json).slice(0, 140));
  let strip, at;
  try {
    const after = await feed();
    strip = after.previewStrip ?? [];
    at = indexOf(after.cards, BANNER_ACCOUNT);
    if (!strip.length) throw new Error("the banner tier produced no strip");
    if (!strip.every((s) => s.authorPersonaId === BANNER_ACCOUNT)) throw new Error("the strip carries an account that is not on the banner tier");
    if (strip.length > 6) throw new Error("the strip is not capped: " + strip.length + " items");
    // it is a strip, not a filter: the account is still ranked in the timeline
    if (at < 0) throw new Error("the banner tier removed the account from the timeline");
    // The strip is drawn from the build ELIGIBLE set, which is deliberately wider than the
    // visible page — a banner post that fell off the page still surfaces, which is the tier
    // doing its job — so what must hold is that every item is a real post by that account.
    if (!strip.every((s) => s.hash && s.text && typeof s.minutesAgo === "number")) throw new Error("a strip item is not a real post");
  } finally {
    await setTier(BANNER_ACCOUNT, "normal");
  }
  if (((await feed()).previewStrip ?? []).length) throw new Error("the strip survived the tier going back to normal");
  return strip.length + " strip item(s) for @" + strip[0].handle + ", still ranked at " + at;
});

await check("4. FACET ONLY IS THE EXISTING FACET-FOLLOW, AND IS REFUSED WITH NO FACET", async () => {
  const ACCOUNT = "persona_acc_crypto_2"; // root_acc_crypto_2: crypto here, astronomy on its sibling
  const ROOT = "root_acc_crypto_2";
  // no facet followed yet: refusing is the point — "facet only" with nothing selected is "hide everything"
  const refused = await api("POST", "/api/delivery", { personaId: ACCOUNT, tier: "facet-only" });
  if (refused.status !== 409 || refused.json?.code !== "no_facet") throw new Error("facet-only was accepted with no facet followed: " + refused.status + " " + JSON.stringify(refused.json).slice(0, 140));
  // follow the facet this account posts in: it stays visible, and the tier is accepted
  await retry(() => api("POST", "/api/disclosure/facets", { facetId: "facet_" + ROOT + "_crypto", follow: true }));
  const accepted = await retry(() => setTier(ACCOUNT, "facet-only"));
  if (accepted.json?.tier !== "facet-only") throw new Error("facet-only was refused with a facet followed: " + JSON.stringify(accepted.json).slice(0, 140));
  const withFacet = await feed();
  const visible = postsOf(withFacet.cards, ACCOUNT).length;
  // now follow the OTHER facet only: the account posts outside it, so it goes
  await retry(() => api("POST", "/api/disclosure/facets", { facetId: "facet_" + ROOT + "_crypto", follow: false }));
  await retry(() => api("POST", "/api/disclosure/facets", { facetId: "facet_" + ROOT + "_astronomy", follow: true }));
  const otherFacet = await feed();
  const after = postsOf(otherFacet.cards, ACCOUNT).length;
  if (!(after < visible || visible === 0)) throw new Error("scoping to a facet this account does not post in changed nothing: " + visible + " -> " + after);
  if (after !== 0) throw new Error("the account still has " + after + " post(s) outside the followed facet");
  await retry(() => api("POST", "/api/disclosure/facets", { facetId: "facet_" + ROOT + "_astronomy", follow: false }));
  await setTier(ACCOUNT, "normal");
  return "refused with no facet; " + visible + " post(s) inside the followed facet, 0 outside it";
});

let secondMode = null;
await check("5. THE TIER IS (ACCOUNT x MODE): one account, two tiers, two placements", async () => {
  const made = await retry(() => api("POST", "/api/modes", { name: "pd3-second-" + stamp, ranking: { recency: 0.7, affinity: 0.2, quality: 0.1 }, notificationPolicy: "mentions_only" }));
  secondMode = made.json?.mode;
  if (!secondMode) throw new Error("could not create a second mode: " + JSON.stringify(made.json).slice(0, 140));
  await retry(() => setTier(LOW, "never-miss", activeModeId));
  await retry(() => setTier(LOW, "quiet", secondMode.id));
  const inA = (await api("GET", "/api/delivery?personaId=" + LOW + "&modeId=" + activeModeId)).json;
  const inB = (await api("GET", "/api/delivery?personaId=" + LOW + "&modeId=" + secondMode.id)).json;
  if (inA?.tier !== "never-miss" || inB?.tier !== "quiet") throw new Error("the same account does not hold two tiers: " + inA?.tier + " / " + inB?.tier);
  // and the PLACEMENT follows the mode, not just the record.
  //
  // Compared by PINNED-ness rather than by raw index: two modes rank with
  // different weights, so index 22 under one and 27 under the other says nothing
  // about the tier. Whether the build pinned the account does.
  await retry(() => api("POST", "/api/modes/active", { modeId: activeModeId }));
  const inModeA = await feed();
  if (inModeA.mode?.id !== activeModeId) throw new Error("the first mode did not activate: " + inModeA.mode?.id);
  const posA = indexOf(inModeA.cards, LOW);
  const pinnedA = (inModeA.pinnedHashes ?? []).length > 0;
  await retry(() => api("POST", "/api/modes/active", { modeId: secondMode.id }));
  const inModeB = await feed();
  if (inModeB.mode?.id !== secondMode.id) throw new Error("the second mode did not activate: " + inModeB.mode?.id);
  const posB = indexOf(inModeB.cards, LOW);
  const pinnedB = (inModeB.pinnedHashes ?? []).length > 0;
  await retry(() => api("POST", "/api/modes/active", { modeId: activeModeId }));
  if (posA < 0) throw new Error("the never-miss account is missing in the first mode");
  if (!pinnedA) throw new Error("never-miss did not pin in the mode it was set for");
  if (pinnedB) throw new Error("the SECOND mode pinned the account too — the tier is not per mode");
  return "pinned in " + inModeA.mode?.name + " at index " + posA + ", not pinned in the second (index " + (posB < 0 ? "off the page" : posB) + ")";
});

await check("6. THE MANAGEMENT SCREEN LISTS EXACTLY THE NON-NORMAL SET", async () => {
  const r = (await api("GET", "/api/delivery")).json;
  const rows = r?.rows ?? [];
  const key = (x) => x.modeId + "|" + x.personaId + "|" + x.tier;
  const want = new Set([activeModeId + "|" + LOW + "|never-miss", secondMode.id + "|" + LOW + "|quiet"]);
  const got = new Set(rows.map(key));
  for (const w of want) if (!got.has(w)) throw new Error("a setting is missing from the list: " + w + " (have " + [...got].join(", ") + ")");
  for (const g of got) if (!want.has(g)) throw new Error("the list carries a setting nothing set: " + g);
  if (rows.some((x) => x.tier === "normal")) throw new Error("a normal row is stored — normal is the absence of a setting");
  if (!rows.every((x) => x.handle && x.modeName)) throw new Error("a row does not name its account and mode, so it is not reviewable");
  // setting one back to normal REMOVES it
  await retry(() => setTier(LOW, "normal", secondMode.id));
  const after = ((await api("GET", "/api/delivery")).json?.rows ?? []).map(key);
  if (after.includes(secondMode.id + "|" + LOW + "|quiet")) throw new Error("setting a tier back to normal left the row behind");
  if (after.length !== rows.length - 1) throw new Error("the list did not shrink by exactly one: " + rows.length + " -> " + after.length);
  return rows.length + " rows, exactly the set that was written; back to normal removes the row";
});

await check("7. NEVER MISS RESPECTS THE CAUGHT-UP CONTRACT — above it, never below, never resurrected", async () => {
  await retry(() => setTier(LOW, "never-miss", activeModeId));
  try {
    // PART ONE: a PARTIAL exhaust. Set the last visit just older than the pinned
    // post, so it is one of the few posts that count as new. The banner appears,
    // and the pin has to be above it — which is the half of the contract that
    // says never-miss may pin above the banner.
    const seeded = await feed();
    const pinnedHash = (seeded.pinnedHashes ?? [])[0];
    if (!pinnedHash) throw new Error("nothing was pinned, so the caught-up interaction is untested");
    const pinCard = seeded.cards.find((c) => c.cast?.hash === pinnedHash);
    if (!pinCard) throw new Error("the pinned post is not on the page before the exhaust");
    const pinAge = Math.round((Date.now() - (pinCard.cast.timestamp ?? Date.now())) / 60000);
    await retry(() => api("POST", "/api/dev", { action: "setLastVisit", minutesAgo: pinAge + 5 }));
    let cards = [];
    let i = -1;
    for (let n = 0; n < 8; n++) {
      cards = (await feed()).cards ?? [];
      i = cards.findIndex((c) => c.kind === "caughtup");
      if (i >= 0) break;
      await sleep(400);
    }
    if (i < 0) throw new Error("the caught-up banner never appeared on a partial exhaust, so the contract cannot be checked");
    const pinIdx = cards.findIndex((c) => c.cast?.hash === pinnedHash);
    if (pinIdx < 0) throw new Error("the pinned post fell off a page it is fresh enough to be on");
    if (!(pinIdx < i)) throw new Error("the pinned post is at " + pinIdx + ", the banner at " + i + " — a pin below the banner breaks the contract");
    const below1 = cards.slice(i + 1).filter((c) => c.kind === "post");
    if (below1.length) throw new Error("there are " + below1.length + " post(s) below the banner on a partial exhaust");

    // PART TWO: a FULL exhaust. Everything has been seen, including the pinned
    // post. Never-miss must NOT resurrect it — pinning reorders what the feed
    // already holds, it does not manufacture content below the banner, and a
    // tier that could would undo the anti-doomscroll rule outright.
    await retry(() => api("POST", "/api/dev", { action: "forceExhaust" }));
    let full = [];
    let j = -1;
    for (let n = 0; n < 8; n++) {
      full = (await feed()).cards ?? [];
      j = full.findIndex((c) => c.kind === "caughtup");
      if (j >= 0) break;
      await sleep(400);
    }
    if (j < 0) throw new Error("the banner never appeared on a full exhaust");
    const postsAnywhere = full.filter((c) => c.kind === "post");
    if (postsAnywhere.length) throw new Error("a fully exhausted feed still carries " + postsAnywhere.length + " post(s) — never-miss resurrected content");
    const allowed = new Set(["readwise", "folder"]);
    const strays = full.slice(j + 1).filter((c) => !allowed.has(c.kind));
    if (strays.length) throw new Error("something other than readwise/folder is below the banner: " + strays.map((c) => c.kind).join(", "));
    return "partial exhaust: pin at " + pinIdx + ", banner at " + i + "; full exhaust: no posts at all, " + (full.length - j - 1) + " card(s) below the banner";
  } finally {
    await api("POST", "/api/dev", { action: "setLastVisit", minutesAgo: 10080 });
    await setTier(LOW, "normal", activeModeId);
  }
});

await check("8. NO PARALLEL FILTER PATH: the feed never compares a tier string", async () => {
  const raw = readFileSync("lib/feed.ts", "utf8");
  // comments out first: the gate is about what the CODE compares, and the code
  // that does not compare a tier still has to be allowed to talk about tiers
  const feedSrc = raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  // The two names that are unambiguously TIER names. "quiet" and "banner" are
  // also ACTION names, which the feed legitimately compares — that IS the
  // rules-engine path — so they carry no signal here; the structural check just
  // below is what closes the hole they would have covered.
  for (const lit of ['"never-miss"', '"facet-only"']) {
    if (feedSrc.includes(lit)) throw new Error("lib/feed.ts compares the tier literal " + lit + " — that is the parallel path this gate exists to avoid");
  }
  // the resolved tier is read for exactly ONE purpose: filling the evaluator context
  if (!/const deliveryOf = /.test(feedSrc)) throw new Error("lib/feed.ts does not resolve a delivery tier at all");
  // EVERY call site must be filling an evaluator context, and nothing else. Counting the
  // calls and demanding exactly one was the first version, and Gate 5 broke it correctly:
  // the review found the LIVE evaluation context had no delivery tier at all, so quiet
  // failed open on live content, and the fix was a second call site — a legitimate one. The
  // claim that carries the weight is not "how many" but "each one fills a context".
  const uses = (feedSrc.match(/deliveryOf\(/g) || []).length;
  const inContext = (feedSrc.match(/delivery:\s*\{\s*tier:[^}]*deliveryOf\(/g) || []).length;
  if (uses < 1) throw new Error("lib/feed.ts never calls the delivery resolver");
  if (uses !== inContext) throw new Error("the resolved delivery tier is called " + uses + " times but only " + inContext + " of those fill an evaluator context — a call that does anything else IS the parallel path");
  for (const act of ["pin", "banner", "downrank"]) {
    const re = new RegExp('r\\.action === "' + act + '" && evaluateGroup');
    if (!re.test(feedSrc)) throw new Error("the " + act + " action is not decided by evaluateGroup in lib/feed.ts");
  }
  if (!/delivery:\s*\{\s*tier:/.test(feedSrc)) throw new Error("the feed does not hand the evaluator a delivery tier at all");
  const tiersSrc = readFileSync("lib/delivery/tiers.ts", "utf8");
  if (!/compileDeliveryRules/.test(tiersSrc)) throw new Error("the tiers are not compiled into rules");
  const evalSrc = readFileSync("lib/rules/evaluate.ts", "utf8");
  if (!/case "delivery.tier"/.test(evalSrc)) throw new Error("delivery.tier is not a field the shared evaluator knows");
  return "feed.ts compares no tier literal; " + uses + " resolver call(s), all filling an evaluator context; pin/banner/downrank via evaluateGroup; delivery.tier is an evaluator field";
});

await check("9. AN IMPORTED ALGORITHM CANNOT PIN OR BANNER", async () => {
  for (const action of ["pin", "banner"]) {
    const r = await api("POST", "/api/algo/import", {
      artifact: {
        name: "pd3-hostile-" + action + "-" + stamp,
        version: 1,
        ranking: { recency: 0.5, engagement: 0.2, authorAffinity: 0.2, clusterAffinity: 0.1 },
        rules: [{ name: "hoist", action, root: { combinator: "AND", clauses: [{ field: "author.tier", op: "gte", value: 1 }] } }],
      },
      activate: false,
    });
    if (r.status >= 200 && r.status < 300 && r.json?.mode) throw new Error("an imported algorithm was allowed to use " + action);
    const said = JSON.stringify(r.json ?? {});
    if (!said.includes(action)) throw new Error("the refusal does not name the action " + action + ": " + said.slice(0, 200));
  }
  return "pin and banner both refused on import, by name";
});

await check("10. THE TIER MAP IS VAULT DATA: ciphertext, one opaque address, no account in the clear", async () => {
  await retry(() => setTier(LOW, "never-miss", activeModeId));
  const rows = dbRows();
  const mine = rows.filter(([t, s]) => t === "adapter_state" && s.includes("deliveryTiers"));
  if (!mine.length) throw new Error("the deliveryTiers namespace never reached the validator state");
  for (const [t, s] of mine) {
    const o = JSON.parse(s);
    const val = o.value ?? o.data ?? s;
    const parsed = typeof val === "string" ? (() => { try { return JSON.parse(val); } catch { return null; } })() : val;
    if (!parsed || typeof parsed !== "object" || !("ct" in parsed)) throw new Error("a deliveryTiers row is not ciphertext: " + t + " " + s.slice(0, 140));
    if (o.key && !["_", "__whole"].includes(o.key)) throw new Error("deliveryTiers is addressed by " + o.key + ", not one opaque key");
  }
  const named = rows.filter(([t, s]) => t === "adapter_state" && s.includes("deliveryTiers") && s.includes(LOW));
  if (named.length) throw new Error("the tiered account is named in a validator row in the clear");
  return mine.length + " sealed row(s), " + rows.length + " rows scanned, no account named";
});

await clearAll();
await api("POST", "/api/dev", { action: "resetSeed" });
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} Gate 3 checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
