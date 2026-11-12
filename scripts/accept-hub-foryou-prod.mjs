// FOR YOU FROM THE HUB (SPEC B) — the signed-in root's discovery feed, read by the TAB from a Farcaster node, ON THE
// PRODUCTION SHAPE (Playwright, desktop), with nothing real:
//   bash /c/Users/jorda/.totem-harness/with-lock.sh env PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ROOTPOST=stub \
//     bash scripts/run-prod-shape.sh scripts/accept-hub-foryou-prod.mjs      (npm run test:hub-foryou-prod)
// The launcher points the tab's node (FC_ROOT_HUB_URL) at the loopback Snapchain stub (scripts/lib/farcaster-protocol-stub.mjs
// via farcaster-api-stub.mjs serve), whose /__stub/hub/plant { twoHop } plants a 2-hop graph around @stubalice and
// /__stub/hub/foryou-truth computes what For You may show under ANY keyed half (the tab's half is drawn under its own vault
// key, which this suite cannot know, so the truth is a SUPERSET and each proof is exact). Not "every account eligible":
// that pick is no superset, since a follow brings in its 2 newest reactions by accounts IN the half, so a half that leaves
// some out reaches further down (FY3 failed about one run in two on it, 2026-11-07: "outer 15 post 0", the 5th like of
// the 12th sampled follow, shown when @o15 fell in the half). Chromium resolves NOTHING but loopback, so no request
// can leave the machine.
//
//   FY1 the shape: /api/dev 403, live mode, the hub stub answers, the tab's node is the stub
//   FY2 sign in with Farcaster as @stubalice and keep the identity with a passkey → /home, For You, as the root
//   FY3 For You FILLS from the hub, progressively (cards while it still reads), then ready: every card is a candidate the
//       stub can account for, by an account @stubalice does NOT follow and not by her (the posts by a followed account and
//       by her, liked by every active follow and newest of all, are absent), each with its proof line, counted exactly
//   FY4 it SAYS WHAT IS COVERED: "From 12 people you follow who liked a post in the last 3 days, and N accounts several of
//       them follow." (N = the accounts the node was asked about), what the counts mean here, and who sees what
//   FY5 IN THE MODE'S ORDER, on the real pill: a recency-only mode is newest first; an engagement-only mode puts the posts
//       most liked or recast by the people she follows first; back to Default; every mode the same posts as the load
//       showed before the switches, and ZERO node reads across them
//   FY6 the APP SERVER and the VALIDATOR learned nothing: no request to either carries a fid or a hash For You read
//   FY7 the NODE saw only plain reads (no preflight, cookie or Referer), at most 8 in flight, and nothing left the machine
//   FY8 NEVER FAIL OPEN: with the node failing every reaction read, For You is an ERROR ("not an empty feed"), never an
//       empty state; Retry recovers once the node answers
//   FY9 PERSONA SEPARATION: once @stubalice makes a persona and acts as it, For You is the persona's (no hub feed) and the
//       node sees ZERO new reads, on For You and on Following
// Not here, and why: the exclusion of an OWN PERSONA'S account (never read, never shown) needs a persona with its own
// Farcaster fid, which the production shape cannot mint without a registrar; scripts/unit-hub-foryou.mjs F2 proves it
// (and a mutation of each guard is caught there).
// ABORTS (exit 2): /api/dev must answer 403, EXPECT_PUBLIC_LIVE "true", EXPECT_HUB "stub", EXPECT_ROOT_POST "armed".
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { STUB_ACCOUNTS, signForChannel } from "./lib/siwf-stub.mjs";
import { waitForDevice } from "./lib/page-health.mjs";

const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
const SIWF = (process.env.SIWF_STUB_URL || "").replace(/\/$/, "");
const HUBC = (process.env.HUB_STUB_URL || "").replace(/\/$/, "");
const HUB = (process.env.HUB_URL || "").replace(/\/$/, "");
const DESKTOP = { width: 1366, height: 900 };
const FID = STUB_ACCOUNTS.alice.fid;
const FBASE = 5_000_000;
const OUTER = 5_500_000;
const ACTIVE = 12;
const results = [];
async function check(name, fn) {
  try {
    const extra = await fn();
    results.push(["PASS", name]);
    console.log("  PASS  " + name + (typeof extra === "string" ? " — " + extra : ""));
  } catch (e) {
    results.push(["FAIL", name]);
    console.log("  FAIL  " + name + " — " + (e && e.message ? e.message : String(e)));
  }
}
const getJson = async (url, init) => {
  const r = await fetch(url, { cache: "no-store", ...init });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: r.status, text, json };
};
const post = (url, body) => getJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------------- preflight
const dev = await getJson(BASE + "/api/dev").catch(() => ({ status: 0 }));
if (dev.status !== 403) {
  console.log("  ABORT: GET /api/dev answered " + dev.status + " — run on the production-shaped pair (scripts/run-prod-shape.sh)");
  process.exit(2);
}
if (process.env.EXPECT_PUBLIC_LIVE !== "true" || process.env.EXPECT_HUB !== "stub" || process.env.EXPECT_ROOT_POST !== "armed") {
  console.log("  ABORT: start the pair with PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ROOTPOST=stub (EXPECT_HUB=" + (process.env.EXPECT_HUB || "unset") + ")");
  process.exit(2);
}
const reads0 = HUBC ? await getJson(HUBC + "/__stub/hub/reads").catch(() => ({ json: null })) : { json: null };
const siwfState = SIWF ? (await getJson(SIWF + "/__stub/state").catch(() => ({ json: null }))).json : null;
if (!reads0.json || !Array.isArray(reads0.json.reads) || !HUB || !siwfState || siwfState.ok !== true) {
  console.log("  ABORT: the hub stub (" + (HUBC || "unset") + ") or the SIWF stub does not answer");
  process.exit(2);
}
await post(SIWF + "/__stub/reset");
const hub = {
  steer: (b) => post(HUBC + "/__stub/hub/steer", b),
  plant: (b) => post(HUBC + "/__stub/hub/plant", b),
  reads: async () => (await getJson(HUBC + "/__stub/hub/reads")).json,
  truth: async () => (await getJson(HUBC + "/__stub/hub/foryou-truth?root=" + FID)).json,
};
async function siwfApprove(who) {
  const st = (await getJson(SIWF + "/__stub/state")).json;
  const ch = st.channels[0];
  if (!ch) throw new Error("the SIWF stub has no channel to approve");
  const { message, signature } = await signForChannel(ch, who, { fid: who.fid });
  const r = await post(SIWF + "/v1/channel/authenticate", { channelToken: ch.token, message, signature, fid: who.fid, username: who.username, displayName: who.displayName, pfpUrl: who.pfpUrl, bio: "stub account", authMethod: "custody" });
  if (r.status !== 200) throw new Error("the SIWF stub refused the approval: " + r.status);
}

// the graph: @stubalice follows 60 accounts, the 12 she followed most recently liked and recast posts by 20 accounts she
// does not follow, which they also follow; they also liked (newest of all) a post by an account she follows and one of hers
await hub.steer({ clear: true });
const g = (await hub.plant({ twoHop: { root: FID, base: FBASE, follows: 60, active: ACTIVE, outerBase: OUTER, outer: 20, rootProfile: { username: "stubalice", display: "Stub Alice" } } })).json;
if (!g || !Array.isArray(g.follows)) {
  console.log("  ABORT: the hub stub did not plant the 2-hop graph (an old stub?)");
  process.exit(2);
}
const T = await hub.truth();
if (!T || !Array.isArray(T.posts) || !Array.isArray(T.allIn)) {
  console.log("  ABORT: the hub stub's For You truth has no any-half superset (an old stub?)");
  process.exit(2);
}
const superset = new Map(T.posts.map((p) => [p.hash, p]));
// the posts For You would pick were every account in the half: a card outside it is one only a keyed half reaches
const allIn = new Set(T.allIn);
const followed = new Set(g.follows);
const sampled = new Set(T.sample);
/** a card the truth cannot account for, said as what the node holds: the cast, its author, who in the sample reacted */
async function unaccounted(hash) {
  const st = (await getJson(HUBC + "/__stub/state").catch(() => ({ json: null }))).json;
  const c = st && st.hub ? st.hub.casts.find((x) => x.hash === hash) : null;
  if (!c) return hash + " (not a cast the stub holds)";
  const by = st.hub.reactions.filter((r) => r.target.hash === hash).map((r) => (r.kind === "like" ? "liked" : "recast") + " by " + r.fid + (sampled.has(r.fid) ? " (sampled)" : ""));
  return hash + ' = "' + c.text + '" by fid ' + c.fid + (followed.has(c.fid) ? " (followed)" : "") + (c.fid === FID ? " (her)" : "") + "; " + (by.length ? by.join(", ") : "nobody reacted to it");
}
const now = Date.now();

// ---------------------------------------------------------------------------------------------------------------- browser
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"] });
const ctx = await browser.newContext({ viewport: DESKTOP });
const page = await ctx.newPage();
const requests = [];
ctx.on("request", (r) => {
  let body = "";
  try {
    body = r.postData() || "";
  } catch {
    body = "";
  }
  requests.push({ url: r.url(), method: r.method(), headers: r.headers(), body });
});
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable", { enableUI: false });
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
const testid = (id) => page.getByTestId(id).first();
const cards = () => page.$$eval('[data-testid="hub-foryou-timeline"] [data-hub-item]', (els) =>
  els.map((e) => {
    const p = e.querySelector('[data-testid="hub-foryou-proof"]');
    return { hash: e.getAttribute("data-hub-item"), proof: p ? { likes: Number(p.getAttribute("data-likes")), recasts: Number(p.getAttribute("data-recasts")), followedBy: Number(p.getAttribute("data-followed-by")), text: p.textContent } : null };
  })
);
const api = (method, route, body) =>
  page.evaluate(
    async ({ method, route, body }) => {
      const r = await fetch(route, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: r.status, json, text };
    },
    { method, route, body }
  );
const readyForYou = async () => {
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="hub-foryou"][data-state="ready"]').waitFor({ timeout: 120_000 });
};

console.log("\nHUB FOR YOU PROD — For You from the hub (app " + BASE + ", validator " + VBASE + ", node " + HUB + "; " + g.follows.length + " follows, " + ACTIVE + " active, " + T.posts.length + " candidates before the keyed half)");

await check("FY1 the shape: public, live, the hub stub answers, and the tab's node is the stub", async () => {
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  const env = await page.evaluate(() => window.__LAYERS_DEVICE_ENV || {});
  if (env.FC_ROOT_HUB_URL !== HUB || env.PUBLIC_LIVE !== "on") throw new Error("the device env: FC_ROOT_HUB_URL=" + env.FC_ROOT_HUB_URL + " PUBLIC_LIVE=" + env.PUBLIC_LIVE);
  return "node " + env.FC_ROOT_HUB_URL;
});

await check("FY2 sign in with Farcaster as @stubalice and keep the identity with a passkey → /home as the root", async () => {
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 120_000 });
  await testid("door-start").click();
  await page.waitForURL((u) => u.pathname === "/welcome", { timeout: 60_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="onboard-step-farcaster"]').waitFor({ timeout: 60_000 });
  await testid("link-farcaster").click();
  await testid("siwf-qr").waitFor({ timeout: 45_000 });
  await siwfApprove(STUB_ACCOUNTS.alice);
  await page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
  await testid("onboard-next").click();
  await page.locator('[data-testid="onboard-step-profile"]').waitFor({ timeout: 60_000 });
  await testid("onboard-next").click();
  await page.locator('[data-testid="onboard-step-save"]').waitFor({ timeout: 60_000 });
  await testid("onboard-save-passkey").click();
  await page.waitForURL((u) => u.pathname === "/home", { timeout: 90_000 });
});

let shown = [];
await check("FY3 For You fills from the hub, progressively, with candidates only: never by an account she follows or by her; each card's proof exact", async () => {
  await hub.steer({ delayMs: 60 });
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  let sawFilling = false;
  for (let i = 0; i < 300 && !sawFilling; i++) {
    sawFilling = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="hub-foryou"]');
      const t = document.querySelector('[data-testid="hub-foryou-timeline"]');
      return !!s && s.getAttribute("data-state") === "loading" && !!t && Number(t.getAttribute("data-count")) > 0;
    });
    if (!sawFilling) await sleep(100);
  }
  await page.locator('[data-testid="hub-foryou"][data-state="ready"]').waitFor({ timeout: 120_000 });
  await hub.steer({ delayMs: 0 });
  if (!sawFilling) throw new Error("never saw cards while it was still reading (not progressive)");
  shown = await cards();
  if (shown.length < 5) throw new Error("only " + shown.length + " cards");
  for (const c of shown) {
    const t = superset.get(c.hash);
    if (!t) throw new Error("a card the stub cannot account for: " + (await unaccounted(c.hash)));
    if (t.fid === FID || followed.has(t.fid)) throw new Error("a card by " + (t.fid === FID ? "her" : "an account she follows") + ": " + t.text);
    if (!c.proof || c.proof.likes !== t.likes || c.proof.recasts !== t.recasts || c.proof.followedBy !== t.followedBy) throw new Error("the proof of '" + t.text + "': " + JSON.stringify(c.proof) + " want " + JSON.stringify({ l: t.likes, r: t.recasts, f: t.followedBy }));
  }
  for (const h of [g.followedPost.hash, g.rootPost.hash]) if (shown.some((c) => c.hash === h)) throw new Error("an excluded post is shown: " + h);
  const marked = await page.$$eval('[data-testid="hub-foryou-timeline"] article[data-testid="cast"]', (els) => els.every((e) => e.getAttribute("data-live") === "true" && !!e.querySelector('[data-testid="network-marker"]')));
  if (!marked) throw new Error("a card without the read-only mark");
  const liked = shown.filter((c) => c.proof.likes + c.proof.recasts > 0).length;
  const halfOnly = shown.filter((c) => !allIn.has(c.hash)).map((c) => superset.get(c.hash).text);
  return shown.length + " cards while and after reading (" + liked + " liked or recast by people she follows, " + (shown.length - liked) + " from accounts several of them follow); 0 by her or anyone she follows; " + (halfOnly.length ? halfOnly.length + " only her keyed half reaches (" + halfOnly.join(", ") + ")" : "none beyond the every-account pick");
});

await check("FY4 it says what is covered: the sample and the accounts in words, what the counts mean here, and who sees what", async () => {
  const cov = testid("hub-foryou-coverage");
  const text = (await cov.innerText()).trim();
  const accounts = Number(await cov.getAttribute("data-accounts"));
  if ((await cov.getAttribute("data-active")) !== String(ACTIVE) || (await cov.getAttribute("data-probed")) !== String(g.follows.length)) throw new Error("the coverage numbers: " + JSON.stringify({ active: await cov.getAttribute("data-active"), probed: await cov.getAttribute("data-probed") }));
  const want = `From ${ACTIVE} people you follow who liked a post in the last 3 days` + (accounts > 0 ? `, and ${accounts} account${accounts === 1 ? "" : "s"} several of them follow.` : ".");
  if (text !== want) throw new Error("the coverage says: " + text + " want " + want);
  // the accounts named are exactly the ones the node was asked for their newest posts
  const r = await hub.reads();
  const asked = new Set(r.reads.filter((x) => x.path === "/v1/castsByFid" && x.at >= now && x.fid !== FID).map((x) => x.fid));
  if (asked.size !== accounts) throw new Error("the page says " + accounts + " accounts, the node was asked about " + asked.size);
  if (!/count only the people you follow/.test(await testid("hub-foryou-signals").innerText())) throw new Error("the signals line: " + (await testid("hub-foryou-signals").innerText()));
  if (!/key only your vault holds/.test(await testid("hub-foryou-who-sees").innerText())) throw new Error("the who-sees line: " + (await testid("hub-foryou-who-sees").innerText()));
  return text;
});

await check("FY5 in the mode's order on the real pill: recency only is newest first; engagement only puts the most liked by the people she follows first; back to Default; zero node reads across the switches", async () => {
  const ok = (r, what) => {
    if (r.status < 200 || r.status > 299) throw new Error(what + ": " + r.status + " " + r.text.slice(0, 200));
    return r.json;
  };
  ok(await api("POST", "/api/modes", { name: "Newest only", ranking: { recency: 1, engagement: 0, authorAffinity: 0, clusterAffinity: 0 } }), "the Newest only mode");
  ok(await api("POST", "/api/modes", { name: "Most liked", ranking: { recency: 0, engagement: 1, authorAffinity: 0, clusterAffinity: 0 } }), "the Most liked mode");
  await readyForYou();
  await testid("mode-pill").waitFor({ timeout: 60_000 });
  await page.locator('[data-testid="hub-mode"]').waitFor({ timeout: 60_000 });
  await sleep(1500);
  // the posts of THIS load, before any switch: a mode re-orders the same posts. (Not FY3's load: a new load may pick
  // others, since which posts a follow brings in skips those another follow brought in first, so it depends on the order
  // the sample's reads came back in; said below, never failed on.)
  const before = await cards();
  if (before.length < 5) throw new Error("only " + before.length + " cards before the switches");
  for (const c of before) if (!superset.has(c.hash)) throw new Error("a card the stub cannot account for: " + (await unaccounted(c.hash)));
  const r0 = (await hub.reads()).reads.length;
  const same = (a, b) => a.length === b.length && a.every((c) => b.some((s) => s.hash === c.hash));
  const pick = async (name, id) => {
    await testid("mode-pill").click();
    await testid("mode-option-" + id).click();
    await page.locator(`[data-testid="hub-mode"][data-mode-name="${name}"], [data-testid="hub-mode-error"]`).first().waitFor({ timeout: 60_000 });
    if (await page.getByTestId("hub-mode-error").count()) throw new Error("the mode could not be applied: " + (await testid("hub-mode-error").innerText()));
    await page.locator('[data-testid="hub-foryou"][data-state="ready"]').waitFor({ timeout: 60_000 });
    await sleep(400);
    const got = await cards();
    if (!same(got, before)) throw new Error(name + " shows other posts than before the switches: " + got.length + " vs " + before.length);
    return got;
  };
  const newest = await pick("Newest only", "newest-only");
  const ts = newest.map((c) => superset.get(c.hash).ts);
  if (!ts.every((t, i) => i === 0 || t <= ts[i - 1])) throw new Error("Newest only is not newest first");
  const liked = await pick("Most liked", "most-liked");
  const eng = liked.map((c) => Math.log10(1 + c.proof.likes + 3 * c.proof.recasts));
  if (!eng.every((x, i) => i === 0 || x <= eng[i - 1] + 1e-12) || !(eng[0] > eng[eng.length - 1])) throw new Error("Most liked is not most liked first: " + eng.map((x) => x.toFixed(2)).join(","));
  if (liked.map((c) => c.hash).join() === newest.map((c) => c.hash).join()) throw new Error("the two modes gave the same order (the check would be vacuous)");
  await pick("Default", "default");
  const r1 = (await hub.reads()).reads.length;
  if (r1 !== r0) throw new Error(r1 - r0 + " node read(s) across the mode switches");
  const vsFy3 = same(before, shown) ? "the same " + before.length + " posts as FY3's load" : before.filter((c) => !shown.some((s) => s.hash === c.hash)).length + " of " + before.length + " posts other than FY3's load picked (the sample's reads came back in another order)";
  return "newest first; most liked first (" + eng[0].toFixed(2) + " → " + eng[eng.length - 1].toFixed(2) + "); every mode the same posts; 0 node reads across 3 switches; " + vsFy3;
});

await check("FY6 the app server and the validator learned nothing: no request to either carries a fid or a hash For You read", async () => {
  const r = await hub.reads();
  const nodeReads = r.reads.filter((x) => x.at >= now);
  const fidNeedles = [...new Set(nodeReads.map((x) => x.fid).filter((f) => f && f !== FID))].map(String);
  const hashNeedles = new Set([...superset.keys()]);
  const toUs = requests.filter((x) => x.url.startsWith(BASE) || x.url.startsWith(VBASE));
  const problems = [];
  for (const q of toUs) {
    const where = (q.url + " " + JSON.stringify(q.headers)).toLowerCase();
    const all = where + " " + String(q.body).toLowerCase();
    for (const h of hashNeedles) if (all.includes(h) || all.includes(h.slice(2))) problems.push(q.method + " " + q.url.slice(0, 80) + " carries a cast hash");
    for (const f of fidNeedles) if (new RegExp("(^|[^0-9])" + f + "([^0-9]|$)").test(where)) problems.push(q.method + " " + q.url.slice(0, 80) + " carries fid " + f);
  }
  // the positive control: the needles DO show up in the tab's own node reads
  const toNode = requests.filter((x) => x.url.startsWith(HUB));
  if (!fidNeedles.length || !toNode.some((x) => new RegExp("fid=" + fidNeedles[0] + "\\b").test(x.url))) problems.push("the needles were not seen even in the tab's node reads (the scan would be blind)");
  const log = path.join(process.env.TEMP || "/tmp", "layers-app.log");
  let logNote = "the app log was not found at " + log;
  if (existsSync(log)) {
    const text = readFileSync(log, "utf8").toLowerCase();
    for (const h of hashNeedles) if (text.includes(h)) problems.push("the app log carries a cast hash");
    logNote = "the app log (" + text.length + " chars) carries none";
  }
  if (problems.length) throw new Error([...new Set(problems)].slice(0, 5).join(" | "));
  return toUs.length + " requests to the app server and validator, none carrying the " + fidNeedles.length + " fids or " + hashNeedles.size + " hashes; " + logNote;
});

await check("FY7 the node saw only plain reads (no preflight, cookie or Referer; the page's Origin), at most 8 in flight, and nothing left the machine", async () => {
  const r = await hub.reads();
  const reads = r.reads.filter((x) => x.at >= now);
  const origin = new URL(BASE).origin;
  const problems = [];
  if (r.preflights) problems.push(r.preflights + " preflight(s)");
  if (reads.some((x) => x.cookie)) problems.push("a read carried a cookie");
  if (reads.some((x) => x.referer)) problems.push("a read carried a Referer");
  const origins = [...new Set(reads.map((x) => x.origin))];
  if (origins.length !== 1 || origins[0] !== origin) problems.push("origins seen: " + origins.join(","));
  if (r.maxInFlight > 8) problems.push(r.maxInFlight + " in flight");
  const off = requests.filter((x) => {
    try {
      const h = new URL(x.url).hostname;
      return !["localhost", "127.0.0.1", "::1"].includes(h) && !/^(data|blob|about):/.test(x.url);
    } catch {
      return false;
    }
  });
  if (off.length) problems.push("requests to other hosts: " + off.slice(0, 3).map((x) => x.url).join(", "));
  if (problems.length) throw new Error(problems.join(" | "));
  return reads.length + " node reads, at most " + r.maxInFlight + " in flight, Origin " + origin + "; " + requests.length + " requests, all loopback";
});

await check("FY8 NEVER FAIL OPEN: the node failing every reaction read is an ERROR on For You ('not an empty feed'), never an empty state; Retry recovers", async () => {
  await hub.steer({ fail: { path: "/v1/reactionsByFid", status: 500 } });
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="hub-foryou-error"]').waitFor({ timeout: 120_000 });
  const code = await testid("hub-foryou-error").getAttribute("data-code");
  const e = await testid("hub-foryou-error").innerText();
  if (code !== "foryou_unreadable" || !/not an empty feed/.test(e)) throw new Error("the error: " + code + " " + e);
  if (await page.getByTestId("hub-foryou-empty").count()) throw new Error("an empty state shown for a failed read");
  await hub.steer({ clear: true });
  await testid("hub-foryou-retry").click();
  await page.locator('[data-testid="hub-foryou"][data-state="ready"]').waitFor({ timeout: 120_000 });
  const n = (await cards()).length;
  if (n < 5) throw new Error("after Retry: " + n + " cards");
  return "error, then " + n + " cards after Retry";
});

await check("FY9 PERSONA SEPARATION: once @stubalice makes a persona and acts as it, For You is the persona's (no hub feed) and the node sees zero new reads, on For You and on Following", async () => {
  await page.goto(BASE + "/home#make-persona", { waitUntil: "load", timeout: 120_000 });
  await testid("make-persona").waitFor({ timeout: 60_000 });
  await testid("make-persona-name").fill("Hub Wren");
  await testid("make-persona-create").click();
  await testid("make-persona").waitFor({ state: "detached", timeout: 60_000 });
  await sleep(2000);
  const before = (await hub.reads()).reads.length;
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await sleep(6000);
  if (await page.locator('[data-testid="hub-foryou"], [data-testid="hub-foryou-timeline"], [data-testid="hub-foryou-loading"]').count()) throw new Error("the root's For You rendered while the persona acts");
  const said = await page.locator("main, body").first().innerText();
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await sleep(5000);
  if (await page.locator('[data-testid="hub-following"], [data-testid="hub-timeline"]').count()) throw new Error("the root's Following rendered while the persona acts");
  const after = (await hub.reads()).reads.length;
  if (after !== before) throw new Error(after - before + " node read(s) while the persona acted");
  return "0 node reads across For You and Following while the persona acted (For You showed " + (/Live Farcaster reads/.test(said) ? "the live-reads line" : "the persona's world") + ")";
});

await browser.close();
const failedN = results.filter((r) => r[0] === "FAIL").length;
console.log("\n" + (results.length - failedN) + "/" + results.length + " checks passed" + (failedN ? " — FAILED" : ""));
process.exit(failedN ? 1 : 0);
