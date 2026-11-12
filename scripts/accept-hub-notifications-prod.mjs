// NOTIFICATIONS FROM FARCASTER — the signed-in root's real Farcaster notifications, read by the TAB from a Farcaster node,
// ON THE PRODUCTION SHAPE (Playwright, desktop), with nothing real:
//   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ROOTPOST=stub bash scripts/run-prod-shape.sh scripts/accept-hub-notifications-prod.mjs
//   (npm run test:hub-notif-prod; it starts servers: one harness at a time)
// The launcher points the tab's node (FC_ROOT_HUB_URL) at the loopback Snapchain stub (scripts/lib/farcaster-protocol-stub.mjs
// via farcaster-api-stub.mjs serve --graph default), whose /__stub/hub/* paths plant followers, mentions, replies, likes
// and recasts for @stubalice, with the real node's PER-SHARD answers. Chromium resolves NOTHING but loopback.
//
//   HN1 the shape: /api/dev 403, live mode, the hub stub answers, the tab's node is the stub
//   HN2 sign in with Farcaster as @stubalice and keep the identity with a passkey → /home as the root (no persona)
//   HN3 THE BADGE before viewing: the rail's Notifications entry counts the 5 unread groups
//   HN4 /notifications as the root: the planted followers, mention, reply, likes and recasts, GROUPED and NEWEST FIRST
//       ("Fan10, Fan11 and 12 others liked your post"), each marked new; the coverage line; the badge CLEARS on view; the
//       validator received the seen time only as a 256-byte sealed record
//   HN5 the seen record holds across a reload (nothing new, no badge); a new follower then shows as the only new one, the
//       badge counts 1, and viewing clears it again
//   HN6 the tabs: Mentions = the mention and the reply; Priority without likes and recasts
//   HN7 the items open the hub pages by fragment (an actor's profile, the liked post's thread, the reply's thread), and once
//       Totem may post as you the reply card's Like reaches the relay as the right signed bytes
//   HN8 NEVER FAIL OPEN: with every node read failing, the page is an ERROR with Retry (never "no notifications") and the
//       badge says it cannot tell; Retry recovers once the node answers
//   HN9 the APP SERVER and the VALIDATOR learned nothing new: no request to either carries a follower's fid or a hash the
//       tab read (the liked reply excepted: it went through the relay by design), and the /notifications request carries
//       no identifier
//   HN10 the NODE saw only plain reads: no preflight, cookie or Referer; the page's Origin; at most 8 in flight; every
//       by-target read names the root only
//   HN11 PERSONA SEPARATION: once a persona acts, /notifications is the persona's (no hub list, no badge) and the node
//       sees ZERO reads; choosing You reads the root's again; choosing the persona again: zero reads
// ABORTS (exit 2): /api/dev must answer 403, EXPECT_PUBLIC_LIVE "true", EXPECT_HUB "stub", EXPECT_ROOT_POST "armed".
import { chromium } from "playwright";
import { STUB_ACCOUNTS, signForChannel } from "./lib/siwf-stub.mjs";
import { waitForDevice } from "./lib/page-health.mjs";
import { decodeProto } from "./lib/farcaster-protocol-stub.mjs";

const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
const SIWF = (process.env.SIWF_STUB_URL || "").replace(/\/$/, "");
const RP = (process.env.ROOTPOST_STUB_URL || "").replace(/\/$/, "");
const HUBC = (process.env.HUB_STUB_URL || "").replace(/\/$/, "");
const HUB = (process.env.HUB_URL || "").replace(/\/$/, "");
const DESKTOP = { width: 1366, height: 900 };
const FID = STUB_ACCOUNTS.alice.fid;
const FAN = 4_200_000;
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
const wholeSecond = (ms) => ms - (ms % 1000);

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
if (!reads0.json || !Array.isArray(reads0.json.reads) || !HUB || !siwfState || siwfState.ok !== true || !RP) {
  console.log("  ABORT: the hub stub (" + (HUBC || "unset") + "), the SIWF stub or the post-as-you stub does not answer");
  process.exit(2);
}
await post(SIWF + "/__stub/reset");
const hub = {
  steer: (b) => post(HUBC + "/__stub/hub/steer", b),
  plant: (b) => post(HUBC + "/__stub/hub/plant", b),
  reads: async () => (await getJson(HUBC + "/__stub/hub/reads")).json,
};
async function siwfApprove(who) {
  const st = (await getJson(SIWF + "/__stub/state")).json;
  const ch = st.channels[0];
  if (!ch) throw new Error("the SIWF stub has no channel to approve");
  const { message, signature } = await signForChannel(ch, who, { fid: who.fid });
  const r = await post(SIWF + "/v1/channel/authenticate", { channelToken: ch.token, message, signature, fid: who.fid, username: who.username, displayName: who.displayName, pfpUrl: who.pfpUrl, bio: "stub account", authMethod: "custody" });
  if (r.status !== 200) throw new Error("the SIWF stub refused the approval: " + r.status);
}

// the planted notifications of @stubalice (newest first): a mention (8 min ago), 3 new followers (10 min), a reply to her
// newest post (15 min), 14 likes on it (from 20 min), 2 recasts on her second post (from 50 min). Her own posts first.
await hub.steer({ clear: true, shardedParents: true });
const now = Date.now();
const at = (min) => wholeSecond(now - min * 60_000);
const fan = (i) => FAN + i;
for (let i = 0; i < 25; i++) await hub.plant({ profile: { fid: fan(i), username: "fan" + i, display: "Fan" + i } });
const p0 = (await hub.plant({ cast: { fid: FID, ts: at(30), text: "my newest post on the hub", seed: "hn:p0" } })).json.hash;
const p1 = (await hub.plant({ cast: { fid: FID, ts: at(60), text: "my second post", seed: "hn:p1" } })).json.hash;
await hub.plant({ cast: { fid: FID, ts: at(90), text: "my third post", seed: "hn:p2" } });
for (let i = 0; i < 3; i++) await hub.plant({ follow: { fid: fan(i), target: FID, ts: at(10) - i * 1000 } });
const replyHash = (await hub.plant({ cast: { fid: fan(3), ts: at(15), text: "a reply to your newest post", parent: { fid: FID, hash: p0 }, seed: "hn:reply" } })).json.hash;
const mentionHash = (await hub.plant({ cast: { fid: fan(4), ts: at(8), text: "hey  have a look", mentions: [FID], mentionsPositions: [4], seed: "hn:mention" } })).json.hash;
for (let i = 0; i < 14; i++) await hub.plant({ reaction: { fid: fan(10 + i), kind: "like", target: { fid: FID, hash: p0 }, ts: at(20 + i) } });
await hub.plant({ reaction: { fid: fan(10), kind: "recast", target: { fid: FID, hash: p1 }, ts: at(50) } });
await hub.plant({ reaction: { fid: fan(11), kind: "recast", target: { fid: FID, hash: p1 }, ts: at(55) } });
const WANT = [
  ["mention", "Fan4 mentioned you"],
  ["follow", "Fan0, Fan1 and 1 other followed you"],
  ["reply", "Fan3 replied to your post"],
  ["like", "Fan10, Fan11 and 12 others liked your post"],
  ["recast", "Fan10 and Fan11 recast your post"],
];
const plantedFids = new Set(Array.from({ length: 25 }, (_, i) => fan(i)));

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
  let hex = "";
  if (r.url().endsWith("/fc/hub/submit")) {
    try {
      hex = r.postDataBuffer() ? r.postDataBuffer().toString("hex") : "";
    } catch {
      hex = "";
    }
  }
  requests.push({ url: r.url(), method: r.method(), headers: r.headers(), body, hex, at: Date.now() });
});
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable", { enableUI: false });
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
const testid = (id) => page.getByTestId(id).first();
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
const submits = () => requests.filter((r) => r.url === VBASE + "/fc/hub/submit" && r.method === "POST");
const railBadge = () => page.locator('[data-chrome="rail-left"] [data-testid="notif-badge"]');
/** the list as the page shows it: [kind, sentence-or-cast-hash, unread] */
const listed = () =>
  page.$$eval('[data-testid="hub-notifs-list"] > [data-testid="hub-notif"]', (els) =>
    els.map((e) => [e.getAttribute("data-kind"), e.querySelector('[data-testid="hub-notif-text"]')?.textContent?.replace(/ · .*$/, "").trim() ?? e.querySelector("article")?.getAttribute("data-hash") ?? "", e.getAttribute("data-unread")])
  );
const openNotifications = async (tab = "") => {
  await page.goto(BASE + "/notifications" + (tab ? "?tab=" + tab : ""), { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="hub-notifs"][data-state="ready"]').waitFor({ timeout: 90_000 });
};
/** the last message the relay received, decoded */
function lastMessage() {
  const s = submits().pop();
  if (!s || !s.hex) throw new Error("no bytes reached the relay");
  const m = decodeProto(Buffer.from(s.hex, "hex"));
  const d = decodeProto(m[7][0]);
  const hexOf = (u) => "0x" + Buffer.from(u).toString("hex");
  const out = { type: Number(d[1][0]), fid: Number(d[2][0]), signer: Buffer.from(m[6][0]).toString("hex") };
  if (d[7]) {
    const rb = decodeProto(d[7][0]);
    out.reaction = Number(rb[1][0]);
    const c = decodeProto(rb[2][0]);
    out.target = { fid: Number(c[1][0]), hash: hexOf(c[2][0]) };
  }
  return out;
}
const touched = new Set();
let viewedAt = 0;

console.log("\nHUB NOTIFICATIONS PROD — Notifications from Farcaster (app " + BASE + ", validator " + VBASE + ", node " + HUB + ")");

await check("HN1 the shape: public, live, the hub stub answers, and the tab's node is the stub", async () => {
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  const env = await page.evaluate(() => window.__LAYERS_DEVICE_ENV || {});
  if (env.FC_ROOT_HUB_URL !== HUB || env.PUBLIC_LIVE !== "on") throw new Error("the device env: FC_ROOT_HUB_URL=" + env.FC_ROOT_HUB_URL + " PUBLIC_LIVE=" + env.PUBLIC_LIVE);
  return "node " + env.FC_ROOT_HUB_URL;
});

await check("HN2 sign in with Farcaster as @stubalice and keep the identity with a passkey → /home as the root (no persona)", async () => {
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
  const per = (await api("GET", "/api/personas")).json?.personas ?? [];
  if (per.some((p) => p.publicSelf !== true) || !per.some((p) => p.publicSelf === true)) throw new Error("not a visitor with only their own account: " + JSON.stringify(per.map((p) => [p.handle, !!p.publicSelf])));
});

await check("HN3 THE BADGE before viewing: the rail's Notifications entry counts the 5 unread groups", async () => {
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-chrome="rail-left"] [data-testid="notif-badge"][data-state="unread"]').waitFor({ timeout: 90_000 });
  const n = await railBadge().getAttribute("data-count");
  const text = (await railBadge().innerText()).trim();
  if (n !== "5" || text !== "5") throw new Error("the badge says " + n + " / " + JSON.stringify(text));
  // the phone tab bar's badge is the same store (one ask for both): when the bar is mounted (hidden at desktop width), it
  // carries the same count
  if (await page.locator('[data-chrome="tabbar"]').count()) {
    const tb = await page.locator('[data-chrome="tabbar"] [data-testid="notif-badge"]').getAttribute("data-count");
    if (tb !== "5") throw new Error("the tab bar's badge says " + tb);
  }
  return "5 unread";
});

await check("HN4 /notifications as the root: grouped, newest first, each marked new; the coverage line; the badge clears on view; the validator got only a 256-byte sealed record", async () => {
  const before = requests.length;
  await openNotifications();
  viewedAt = Date.now();
  const got = await listed();
  const shape = got.map(([k, t]) => [k, k === "reply" || k === "mention" ? "" : t]);
  const want = WANT.map(([k, t]) => [k, k === "reply" || k === "mention" ? "" : t]);
  if (JSON.stringify(shape) !== JSON.stringify(want)) throw new Error("the list: " + JSON.stringify(got) + " want " + JSON.stringify(WANT));
  if (got[0][1] !== mentionHash || got[2][1] !== replyHash) throw new Error("the cards: " + got[0][1] + " / " + got[2][1]);
  if (!got.every((g) => g[2] === "1")) throw new Error("not every row marked new on the first view: " + got.map((g) => g[2]));
  const cov = await testid("hub-notifs-coverage").innerText();
  if (!/your newest 50 followers and 50 mentions, and the replies, likes and recasts on your newest 25 posts/.test(cov)) throw new Error("the coverage line: " + cov);
  const mention = await page.locator(`[data-testid="hub-notif"][data-kind="mention"] article`).first().innerText();
  if (!mention.includes("hey @stubalice have a look")) throw new Error("the mention card: " + mention.slice(0, 160));
  // the badge clears once the page has marked them seen
  await railBadge().waitFor({ state: "detached", timeout: 60_000 });
  // the validator received the seen time as the fcNotifications record: ciphertext of exactly 256 bytes, no plaintext
  let puts = [];
  for (let i = 0; i < 40 && !puts.length; i++) {
    puts = requests.slice(before).filter((r) => r.method === "PUT" && r.url === VBASE + "/state/fcNotifications");
    if (!puts.length) await sleep(250);
  }
  if (!puts.length) throw new Error("no sealed seen record reached the validator");
  for (const p of puts) {
    const b = JSON.parse(p.body);
    const rec = b.entries && b.entries._;
    if (!rec || Object.keys(b.entries).length !== 1 || !/^[0-9a-f]+$/.test(rec.ct || "") || rec.ct.length !== 512 || rec.ns !== "fcNotifications") throw new Error("not one 256-byte sealed record: " + p.body.slice(0, 200));
    if (/seenAt|"fid"|"m"/.test(p.body)) throw new Error("plaintext in the seen record");
  }
  return got.length + " groups in order, all new; badge cleared; " + puts.length + " sealed write(s) of 256 bytes";
});

await check("HN5 the seen record holds across a reload (nothing new, no badge); a new follower is then the only new one, the badge counts 1, and viewing clears it again", async () => {
  await openNotifications();
  const again = await listed();
  if (again.some((g) => g[2] === "1")) throw new Error("rows marked new again after a reload: " + JSON.stringify(again));
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await sleep(4000);
  if (await railBadge().count()) throw new Error("a badge after everything was seen: " + (await railBadge().getAttribute("data-count")));
  // a new follower, after the view
  await hub.plant({ follow: { fid: fan(24), target: FID, ts: wholeSecond(Date.now() - 5000) } });
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-chrome="rail-left"] [data-testid="notif-badge"][data-state="unread"]').waitFor({ timeout: 90_000 });
  const n = await railBadge().getAttribute("data-count");
  if (n !== "1") throw new Error("the badge after one new follower: " + n);
  await openNotifications();
  const got = await listed();
  if (got[0][0] !== "follow" || got[0][1] !== "Fan24 followed you" || got[0][2] !== "1" || got.slice(1).some((g) => g[2] === "1")) throw new Error("the list after a new follower: " + JSON.stringify(got));
  await railBadge().waitFor({ state: "detached", timeout: 60_000 });
  return "seen across a reload; 1 new follower = badge 1, the only new row; cleared";
});

await check("HN6 the tabs: Mentions = the mention and the reply; Priority without likes and recasts; the seen follower rejoins the day's follows", async () => {
  await openNotifications("mentions");
  const m = (await listed()).map((g) => g[0]);
  if (m.join() !== "mention,reply") throw new Error("Mentions: " + m);
  await openNotifications("priority");
  const got = await listed();
  const p = got.map((g) => g[0]);
  // everything is seen now, so the newest follower is back in the same day's group (4 followers in one row)
  if (p.join() !== "follow,mention,reply" || got[0][1] !== "Fan24, Fan0 and 2 others followed you") throw new Error("Priority: " + JSON.stringify(got));
  return "Mentions " + m.length + ", Priority " + p.length + " ('" + got[0][1] + "')";
});

await check("HN7 the items open the hub pages by fragment; once Totem may post as you, the reply card's Like reaches the relay as the right signed bytes", async () => {
  await openNotifications();
  const actor = await page.locator('[data-testid="hub-notif"][data-kind="like"] [data-testid="hub-notif-actor"]').first().getAttribute("href");
  if (actor !== "/fc/profile#" + fan(10)) throw new Error("the first liker links to " + actor);
  const target = await page.locator('[data-testid="hub-notif"][data-kind="like"] [data-testid="hub-notif-target"]').getAttribute("href");
  if (target !== "/fc/cast#" + FID + "/" + p0) throw new Error("the liked post links to " + target);
  // the reply's card opens its thread
  await page.locator(`[data-testid="hub-notif"][data-kind="reply"] article`).getByText("a reply to your newest post", { exact: true }).first().click();
  await page.locator(`[data-testid="hub-thread"][data-hash="${replyHash}"]`).waitFor({ timeout: 60_000 });
  if (!page.url().endsWith("/fc/cast#" + fan(3) + "/" + replyHash)) throw new Error("the reply opened " + page.url());
  // allow Totem to post as you (the post-as-you stub approves), then like the reply from the notifications page
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await testid("root-post-allow").waitFor({ timeout: 60_000 });
  await testid("root-post-allow").click();
  await testid("root-post-approve").waitFor({ timeout: 60_000 });
  await post(RP + "/__stub/approve", { userFid: FID });
  await testid("root-composer").waitFor({ timeout: 60_000 });
  const key = (await api("GET", "/api/fc/root")).json?.key;
  if (!/^0x[0-9a-f]{64}$/.test(key || "")) throw new Error("no active key: " + key);
  await openNotifications();
  const like = page.locator(`[data-testid="hub-notif"][data-kind="reply"] article [data-testid="action-like"]`).first();
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-testid="hub-notif"][data-kind="reply"] article [data-testid="action-like"]');
    return !!b && !b.getAttribute("data-disabled") && b.getAttribute("data-pressed") === "false";
  }, null, { timeout: 60_000 });
  const n = submits().length;
  await like.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="hub-notif"][data-kind="reply"] article [data-testid="action-like"]')?.getAttribute("data-pressed") === "true", null, { timeout: 60_000 });
  if (submits().length !== n + 1) throw new Error(submits().length - n + " message(s) reached the relay for one like");
  const m = lastMessage();
  if (m.type !== 3 || m.fid !== FID || m.reaction !== 1 || m.target?.fid !== fan(3) || m.target?.hash !== replyHash || m.signer !== key.slice(2)) throw new Error("the like's bytes say " + JSON.stringify(m));
  touched.add(replyHash);
  return "profile and thread by fragment; 1 like at the relay (decoded: REACTION_ADD by " + FID + " on " + replyHash.slice(0, 10) + "…)";
});

await check("HN8 NEVER FAIL OPEN: every node read failing is an ERROR with Retry (never 'no notifications') and the badge says it cannot tell; Retry recovers", async () => {
  await hub.steer({ fail: { path: "*", status: 500 } });
  await page.goto(BASE + "/notifications", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await testid("hub-notifs-error").waitFor({ timeout: 120_000 });
  const said = await testid("hub-notifs-error").innerText();
  if (!/Couldn.t read your notifications/.test(said) || !/not an empty list/.test(said)) throw new Error("the error says: " + said.slice(0, 200));
  if (await page.locator('[data-testid="hub-notifs-empty"]').count()) throw new Error("an empty state beside the error");
  await page.locator('[data-chrome="rail-left"] [data-testid="notif-badge"][data-state="unknown"]').waitFor({ timeout: 90_000 });
  await hub.steer({ clear: true, shardedParents: true });
  await testid("hub-notifs-retry").click();
  await page.locator('[data-testid="hub-notifs"][data-state="ready"]').waitFor({ timeout: 90_000 });
  const got = await listed();
  if (got.length !== WANT.length) throw new Error("after Retry: " + got.length + " rows");
  return "error with Retry, the badge unknown, then " + got.length + " rows";
});

await check("HN9 the app server and the validator learned nothing new: no request to either carries a follower's fid or a hash the tab read (the liked reply excepted), and /notifications carries no identifier", async () => {
  const hashNeedles = new Set([p0, p1, mentionHash, replyHash]);
  for (const h of touched) hashNeedles.delete(h); // HN7's like went through the validator's relay, by design (§35)
  const fidNeedles = [...plantedFids].map(String);
  const toUs = requests.filter((r) => r.url.startsWith(BASE) || r.url.startsWith(VBASE));
  const problems = [];
  for (const r of toUs) {
    const where = (r.url + " " + JSON.stringify(r.headers)).toLowerCase();
    const all = where + " " + String(r.body).toLowerCase();
    for (const h of hashNeedles) if (all.includes(h) || all.includes(h.slice(2))) problems.push(r.method + " " + r.url.slice(0, 80) + " carries a hash the tab read");
    for (const f of fidNeedles) if (new RegExp("(^|[^0-9])" + f + "([^0-9]|$)").test(where)) problems.push(r.method + " " + r.url.slice(0, 80) + " carries follower fid " + f);
    if (/\/notifications/.test(r.url) && /[?&](fid|hash)=|#/.test(r.url)) problems.push("an identifier on the notifications request: " + r.url);
  }
  if (!toUs.some((r) => /\/notifications(\?|$)/.test(r.url))) problems.push("the /notifications page was never requested (the check would be vacuous)");
  // the positive control: the needles DO show up where they belong, in the tab's own reads of the node
  const toNode = requests.filter((r) => r.url.startsWith(HUB));
  if (!toNode.some((r) => r.url.toLowerCase().includes(p0)) || !toNode.some((r) => new RegExp("fid=" + fan(10) + "\\b").test(r.url))) problems.push("the needles were not seen even in the tab's node reads (the scan would be blind)");
  if (problems.length) throw new Error([...new Set(problems)].slice(0, 5).join(" | "));
  return toUs.length + " requests to the app server and validator, none carrying a notification's account or post";
});

await check("HN10 the node saw only plain reads: no preflight, cookie or Referer; the page's Origin; at most 8 in flight; every by-target read names the root only", async () => {
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
  const byTarget = reads.filter((x) => ["/v1/linksByTargetFid", "/v1/castsByMention", "/v1/reactionsByCast", "/v1/castsByParent"].includes(x.path) && x.fid !== FID && !(x.path === "/v1/castsByParent" && x.fid === fan(3)));
  if (byTarget.length) problems.push(byTarget.length + " by-target read(s) naming another account, e.g. " + byTarget[0].path + " fid " + byTarget[0].fid);
  for (const p of ["/v1/linksByTargetFid", "/v1/castsByMention", "/v1/reactionsByCast"]) if (!reads.some((x) => x.path === p)) problems.push("no " + p + " read (vacuous)");
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
  return reads.length + " node reads, at most " + r.maxInFlight + " in flight, Origin " + origin + "; all loopback";
});

await check("HN11 PERSONA SEPARATION: once a persona acts, /notifications is the persona's (no hub list, no badge) and the node sees zero reads; choosing You reads the root's again; choosing the persona again: zero reads", async () => {
  await page.goto(BASE + "/home#make-persona", { waitUntil: "load", timeout: 120_000 });
  await testid("make-persona").waitFor({ timeout: 60_000 });
  await testid("make-persona-name").fill("Notif Owl");
  await testid("make-persona-create").click();
  await testid("make-persona").waitFor({ state: "detached", timeout: 60_000 });
  await sleep(1500);
  const per = (await api("GET", "/api/personas")).json?.personas ?? [];
  const self = per.find((p) => p.publicSelf === true);
  const persona = per.find((p) => p.publicSelf !== true);
  if (!self || !persona) throw new Error("the roster: " + JSON.stringify(per.map((p) => [p.handle, !!p.publicSelf])));
  const acting = async () => (await api("GET", "/api/persona/chrome")).json?.activePersonaId;
  if ((await acting()) !== persona.id) throw new Error("the persona is not acting");
  const before = (await hub.reads()).reads.length;
  await page.goto(BASE + "/notifications", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await sleep(6000);
  if (await page.locator('[data-testid="hub-notifs"], [data-testid="hub-notifs-error"], [data-testid="hub-notifs-loading"]').count()) throw new Error("the root's notifications rendered while the persona acts");
  if (await page.locator('[data-testid="notif-badge"]').count()) throw new Error("a badge while the persona acts");
  const island = await page.locator('[data-testid="notification-row"], [data-testid="notifications-error"], [data-testid="notifications-muted"], [data-testid="notifications-policy-error"]').count();
  const nothing = await page.getByText("Nothing here yet.").count();
  if (!island && !nothing) throw new Error("the persona's notifications did not render: " + (await page.locator("main").innerText()).slice(0, 200));
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await sleep(4000);
  if (await page.locator('[data-testid="notif-badge"]').count()) throw new Error("a badge on /home while the persona acts");
  const mid = (await hub.reads()).reads.length;
  if (mid !== before) throw new Error(mid - before + " node read(s) while the persona acted");
  // choose You: the root's notifications come back (client navigation: a reload would go back to the first persona)
  await testid("account-switcher-button").click();
  await page.locator(`[data-testid="persona-row-${self.handle}"][data-you="true"]`).click();
  for (let i = 0; i < 60 && (await acting()) !== self.id; i++) await sleep(250);
  if ((await acting()) !== self.id) throw new Error("the acting identity after choosing You: " + (await acting()));
  await page.mouse.click(700, 5);
  await page.locator('[data-chrome="rail-left"] [data-testid="nav-item"][data-slot="notifications"]').click();
  await page.waitForURL((u) => u.pathname === "/notifications", { timeout: 60_000 });
  await page.locator('[data-testid="hub-notifs"][data-state="ready"]').waitFor({ timeout: 90_000 });
  const asYou = (await hub.reads()).reads.length;
  if (asYou <= mid) throw new Error("no node read while acting as yourself");
  // choose the persona again (from this page): the root goes quiet
  await testid("account-switcher-button").click();
  await page.locator(`[data-testid="persona-row-${persona.handle}"]`).click();
  for (let i = 0; i < 60 && (await acting()) !== persona.id; i++) await sleep(250);
  if ((await acting()) !== persona.id) throw new Error("the acting identity after choosing the persona: " + (await acting()));
  await sleep(1500);
  const r2 = (await hub.reads()).reads.length;
  await sleep(5000);
  if (await page.locator('[data-testid="hub-notifs"]').count()) throw new Error("the root's notifications stayed on screen after choosing the persona");
  if (await page.locator('[data-testid="notif-badge"]').count()) throw new Error("the badge stayed after choosing the persona");
  const seenNow = await api("POST", "/api/fc/hub", { op: "notifications" });
  if (seenNow.status !== 409 || seenNow.json?.code !== "acting_persona") throw new Error("the device answered the root's notifications while the persona acts: " + seenNow.status);
  const r3 = (await hub.reads()).reads.length;
  if (r3 !== r2) throw new Error(r3 - r2 + " node read(s) after choosing the persona again");
  return "0 reads as the persona; " + (asYou - mid) + " as You; 0 after choosing the persona again; the device refused acting_persona";
});

await browser.close();
const failedN = results.filter((r) => r[0] === "FAIL").length;
console.log("\n" + (results.length - failedN) + "/" + results.length + " checks passed" + (failedN ? " — FAILED" : ""));
process.exit(failedN ? 1 : 0);
