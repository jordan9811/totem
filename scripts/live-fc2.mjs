// FC PASS — GATE 2 LIVE VERIFICATION (reads only; run explicitly, never in
// sweeps). Flips the runtime source to neynar, renders every major surface
// against the real current network, captures screenshot evidence into
// shots/, asserts no blank surfaces, exercises the mode re-filter, and
// flips back to seed. ENABLE_FC_WRITE stays unset — this script cannot
// write, spend, or post by construction.
//
// Output is the auditable record: timestamps, sample cast hashes and
// authors, per-surface pass/fail. Screenshots: shots/fc-live-*.png.
import { chromium } from "playwright";
import { assertServersUp } from "./lib-health.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
mkdirSync("shots", { recursive: true });

const results = [];
const ok = (n, extra = "") => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n + (extra ? " — " + extra : ""));
};
const fail = (n, d) => {
  results.push(["FAIL", n, d]);
  console.log("  FAIL  " + n + (d ? " — " + d : ""));
};
async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, typeof extra === "string" ? extra : "");
  } catch (e) {
    fail(name, e.message);
  }
}

await assertServersUp(BASE);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1600 } })).newPage();

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
const poll = async (pred, tries = 25, delayMs = 500) => {
  for (let i = 0; i < tries; i++) {
    try {
      if (await pred()) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
};

console.log(`\nFC Gate 2 LIVE verification — ${new Date().toISOString()}`);
console.log("ENABLE_FC_WRITE:", process.env.ENABLE_FC_WRITE ?? "unset", "(must be unset/false)");

await api("POST", "/api/dev", { action: "resetSeed" });
await api("POST", "/api/dev", { action: "setDataSource", source: "neynar" });

let liveHash = null;
let liveUsername = null;

// ---- 1. the live probe confirms real data is flowing ----
await check("LIVE 1. transport probe returns real current casts", async () => {
  const r = await api("GET", "/api/dev/live");
  if (r.json.liveFetch !== "ok") throw new Error(`liveFetch=${r.json.liveFetch}: ${r.json.error ?? ""}`);
  if (!r.json.count) throw new Error("live probe returned zero casts");
  return `count=${r.json.count} sample=${JSON.stringify(r.json.sample?.[0] ?? null)}`;
});

// ---- 2. home timeline renders live content, persona/mode layer intact ----
await check("LIVE 2. /home renders live casts with the mode header intact (screenshot)", async () => {
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  const rendered = await poll(async () => (await page.locator("[data-testid=cast]").count()) >= 3);
  if (!rendered) throw new Error("fewer than 3 casts rendered on live /home");
  if ((await page.locator("[data-testid=mode-pill]").count()) !== 1)
    throw new Error("mode pill missing over live content — the persona/mode layer dropped");
  const feed = await api("GET", "/api/feed2?surface=discovery");
  const livePost = (feed.json.cards ?? []).find((c) => c.kind === "post" && c.cast.author?.fid > 0);
  if (livePost) {
    liveHash = livePost.cast.hash;
    liveUsername = livePost.cast.author.username;
  }
  await page.screenshot({ path: "shots/fc-live-home.png", fullPage: false });
  return `first live cast ${liveHash} by @${liveUsername}`;
});

// ---- 3. mode switch visibly re-filters the live feed ----
// Mode ranking is WINDOW SELECTION (final display order is recency, as it
// is for seeded content), so the assertable effect of a mode switch is
// membership, not ordering. hideReplies gives a deterministic membership
// rule keyed on real live data (parentHash).
await check("LIVE 3. a hideReplies mode filters live replies out of the feed; default shows them", async () => {
  const modes = (await api("GET", "/api/modes")).json;
  const dflt = modes.modes.find((m) => m.name === "Default");
  const mk = await api("POST", "/api/modes", {
    name: "Live NoReplies probe",
    ranking: { recency: 1, engagement: 1, authorAffinity: 1, clusterAffinity: 1 },
    ruleIds: [], notificationPolicy: "all", actionButtonSlots: { composer: [], nav: [] },
    showTrending: true, calmRanking: false, isPreset: false, hideReplies: true,
  });
  const posts = async () =>
    (await api("GET", "/api/feed2?surface=discovery")).json.cards
      .filter((c) => c.kind === "post" && c.cast.author?.fid > 0)
      .map((c) => ({ hash: c.cast.hash, isReply: Boolean(c.cast.parentHash || c.cast.replyingTo) }));

  if (dflt) await api("POST", "/api/modes/active", { modeId: dflt.id });
  const before = await posts();
  await api("POST", "/api/modes/active", { modeId: mk.json.mode.id });
  const after = await posts();
  if (dflt) await api("POST", "/api/modes/active", { modeId: dflt.id });

  if (after.some((c) => c.isReply))
    throw new Error("hideReplies mode still shows live replies — the mode layer is not filtering live content");
  const beforeReplies = before.filter((c) => c.isReply).length;
  if (beforeReplies > 0 && after.length >= before.length)
    throw new Error("default feed had replies but the hideReplies feed did not shrink");
  return beforeReplies > 0
    ? `filtered ${beforeReplies} live replies (${before.length} → ${after.length})`
    : `no replies in the current live window — invariant holds vacuously (${after.length} casts, all non-replies)`;
});

// ---- 4. a live profile renders ----
await check("LIVE 4. a live profile page renders (screenshot)", async () => {
  if (!liveUsername) throw new Error("no live username captured");
  await page.goto(`${BASE}/${liveUsername}`, { waitUntil: "networkidle" });
  const rendered = await poll(async () => (await page.locator("main").innerText()).includes(liveUsername));
  if (!rendered) throw new Error(`profile for @${liveUsername} did not render its handle`);
  await page.screenshot({ path: "shots/fc-live-profile.png", fullPage: false });
  return `@${liveUsername}`;
});

// ---- 5. a live thread renders ----
await check("LIVE 5. a live cast permalink + conversation renders (screenshot)", async () => {
  if (!liveHash || !liveUsername) throw new Error("no live cast captured");
  await page.goto(`${BASE}/${liveUsername}/status/${liveHash}`, { waitUntil: "networkidle" });
  const rendered = await poll(async () => (await page.locator("[data-testid=permalink-cast]").count()) === 1);
  if (!rendered) throw new Error("permalink cast did not render");
  await page.screenshot({ path: "shots/fc-live-thread.png", fullPage: false });
  return liveHash;
});

// ---- 6. notifications + explore render live without blanking ----
await check("LIVE 6. /notifications and /explore render live content (screenshots)", async () => {
  await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
  const notifOk = await poll(async () => (await page.locator("main").innerText()).trim().length > 40);
  await page.screenshot({ path: "shots/fc-live-notifications.png", fullPage: false });
  await page.goto(BASE + "/explore", { waitUntil: "networkidle" });
  const exploreOk = await poll(async () => (await page.locator("main").innerText()).trim().length > 40);
  await page.screenshot({ path: "shots/fc-live-explore.png", fullPage: false });
  if (!notifOk) throw new Error("notifications surface blank under live");
  if (!exploreOk) throw new Error("explore surface blank under live");
});

// ---- 7. switching source back leaves persona/grant/mode state untouched ----
await check("LIVE 7. flip back to seed — persona/mode state untouched by the excursion", async () => {
  await api("POST", "/api/dev", { action: "setDataSource", source: "seed" });
  const r = await api("GET", "/api/dev");
  if (r.json.registry.dataSource !== "seed") throw new Error("did not return to seed");
  const modes = await api("GET", "/api/modes");
  if (!modes.json.modes?.length) throw new Error("modes lost after the live excursion");
});

await api("POST", "/api/dev", { action: "resetSeed" });
await browser.close();

const fails = results.filter((r) => r[0] === "FAIL");
console.log(
  fails.length === 0
    ? `\nLIVE VERIFICATION PASSED (${results.length}/${results.length}) — evidence in shots/fc-live-*.png`
    : `\n${fails.length} of ${results.length} LIVE checks FAILED`
);
process.exit(fails.length ? 1 : 0);
