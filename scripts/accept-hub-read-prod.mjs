// FOLLOWING FROM THE HUB — the signed-in root's own Farcaster graph, read by the TAB from a Farcaster node, ON THE
// PRODUCTION SHAPE (Playwright, desktop), with nothing real:
//   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ROOTPOST=stub bash scripts/run-prod-shape.sh scripts/accept-hub-read-prod.mjs
//   (npm run test:hub-read-prod; it starts servers: one harness at a time)
// The launcher points the tab's node (FC_ROOT_HUB_URL, handed over by the app server) at the loopback Snapchain stub
// (scripts/lib/farcaster-protocol-stub.mjs via farcaster-api-stub.mjs serve --graph default), whose /__stub/hub/* paths
// plant the graph and steer the reads. Chromium resolves NOTHING but loopback, so no request can leave the machine.
//
//   HR1 the shape: /api/dev 403, live mode, the hub stub answers, and the tab's device env names it (from the app server)
//   HR2 sign in with Farcaster as @stubalice (120 follows planted on the stub hub, a reply chain among them) and keep the
//       identity with a passkey → /home as the root
//   HR3 "Pick up where you left off": Find your people says "You follow 120 accounts on Farcaster." and links /fc/following
//   HR4 Following: PROGRESSIVE (with a slow node, cards show while "Reading posts from …" still counts), then the first 20
//       cards are EXACTLY the stub's ground truth, newest first, each marked "Farcaster · read-only"
//   HR5 a reply in the timeline says "Replying to @…" and opens /fc/cast#<fid>/<hash>: the post it replies to above it, its
//       own reply below it
//   HR6 its author opens /fc/profile#<fid>: the account's name and posts
//   HR7 /fc/following lists who @stubalice follows, most recently followed first, 50 at a time ("Show more" → 100)
//   HR8 POST AS YOU: the root's own post appears at the top of Following, by its node hash, as @stubalice
//   HR9 NEVER FAIL OPEN: with the node failing the follows read, Following is an ERROR ("… not an empty list") and the
//       home card's count an error too, never "You don't follow anyone"; Retry recovers once the node answers
//   HR10 the APP SERVER and the VALIDATOR learned nothing new: no request to either (URL, headers, body) and no app log line
//       carries a followed account's fid or any cast hash the tab read; the /fc/* page requests carry no fragment
//   HR11 the NODE saw only plain reads: no preflight, no cookie, no Referer, the page's Origin, at most 8 in flight, only
//       the root's graph asked about; and nothing left the machine
//   HR12 PERSONA SEPARATION (reads): once a persona acts, nothing is read from the node as the root
// POST AS YOU ON HUB CARDS (Reply, Like, Recast and their undo; Delete on the root's own cast), in the order they run:
//   HR13 (after HR7) BEFORE Totem may post as you: a hub card's Like, Recast and Reply are disabled with the one-line
//       reason, a tap says it, and nothing reaches the relay; the thread page's reply box says the same
//   HR14 (after HR8) as the root: Like, Recast and both undos reach the validator's relay as REACTION_ADD / REACTION_REMOVE
//       signed by the tab's key for fid 990777 naming the card's fid + hash (decoded from the bytes), the node holds the
//       result, and the button is pressed only after; a card the root had already recast elsewhere shows pressed (read
//       from the node); Reply opens a composer whose cast carries the card as its parent; Delete removes the root's cast
//   HR15 (after HR14) a NODE REFUSAL (the key removed in the Farcaster app) is a sentence on the card with the node's words,
//       and the button stays unpressed
//   HR16 (after HR12) while the persona acts: the device refuses every root write (like, recast, reply, delete, a post)
//       with acting_persona, the relay receives nothing, and the composer no longer offers "Post as @you instead"
//   HR18 (after HR13) THE ROOT'S OWN WRITES with no persona at all: a mode made and activated, a rule, a ring, an X import
//       begun (each 2xx and read back); a persona action refused 409 NO_ACTING_PERSONA
//   HR19 (after HR17) the same root writes as You after making a persona, and the guard steps aside once the persona acts
//   HR20 (after HR18, spec A) YOUR MODE ON THE REAL FOLLOWING, as the root with no persona: the pill is on Following; a
//       mode muting a word hides exactly those posts ("Your mode hid 3 of these 50 posts."); never-miss set from a hub
//       card's menu (keyed fc:<fid>, no "facet only") pins one post of that account on top; a mode hiding everything
//       says "Your mode hid all 50 posts."; back on Default the page is the ground truth, newest first; what Default
//       weighs that Farcaster posts can't carry is said; ZERO node reads across the switches and the tier
//   HR17 ACTING AS YOURSELF: choosing You in the account menu reads the root's Following from the node, a hub card's like
//       reaches the relay with the right bytes and a persona write is refused NO_ACTING_PERSONA; the composer and the
//       menu say who acts; choosing the persona again: zero node reads and zero relay submits
// SPEC C (readwise and the extras on real posts):
//   HR21 (after HR20) READWISE ON THE REAL FOLLOWING, as the root with no persona: a long real-shaped cast (80 words) is a
//       reading piece; kept on screen past its length-scaled threshold it shows read, and the dwell left the tab ONLY
//       inside the sealed readwiseState record (no request carries the hash, the chunk id or the words; none reached the
//       app server); the bin takes it off (a plain post again, listed in the bin with its words) and Restore brings it
//       back read; ZERO node reads for any of it
//   HR22 (after HR11) CLOSE-FRIEND SENDS THROUGH A RING: a second visitor (@stubbob, signed in with Farcaster, his own
//       passkey) puts @stubalice's private ring address in his ring "Close" and sends her an old post she follows and one
//       she never read; his tick publishes the fixed-size sealed note; her next tick opens it and her Following, already
//       on screen, splices the post in "Sent to you by Bobby" and says the other isn't shown; no node read on her side
//       names a sent post, and no request of either tab carries the sent post's hash or fid in the clear. (A live tab
//       ticks every ~10 minutes; the composer's first check of a page load runs one tick at once, and both tabs use it.)
// The correction cards (desk notes on real posts) are NOT checked here: the live site runs the empty world, which has no
// desk to subscribe to (desks are seeded demo data, and a desk's signatures verify only for personas a device holds or
// the seed's fixtures), so the production shape cannot hold one. scripts/unit-hub-read.mjs H20 checks them through the
// engine.
// ABORTS (exit 2): /api/dev must answer 403, EXPECT_PUBLIC_LIVE "true", EXPECT_HUB "stub", EXPECT_ROOT_POST "armed".
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
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
const BASEFID = 4_000_000;
const N = 120;
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
  truth: async (limit) => (await getJson(HUBC + "/__stub/hub/truth?root=" + FID + "&limit=" + limit)).json.casts,
};
async function siwfApprove(who) {
  const st = (await getJson(SIWF + "/__stub/state")).json;
  const ch = st.channels[0];
  if (!ch) throw new Error("the SIWF stub has no channel to approve");
  const { message, signature } = await signForChannel(ch, who, { fid: who.fid });
  const r = await post(SIWF + "/v1/channel/authenticate", { channelToken: ch.token, message, signature, fid: who.fid, username: who.username, displayName: who.displayName, pfpUrl: who.pfpUrl, bio: "stub account", authMethod: "custody" });
  if (r.status !== 200) throw new Error("the SIWF stub refused the approval: " + r.status);
}

// the graph: @stubalice follows N synthetic accounts, and a reply chain among them (the newest posts)
await hub.steer({ clear: true });
const syn = (await hub.plant({ synthetic: { root: FID, n: N, castsPer: 5, base: BASEFID, seed: 3, rootProfile: { username: "stubalice", display: "Stub Alice" } } })).json;
const now = Date.now();
const PARENT_FID = BASEFID + 10;
const REPLY_FID = BASEFID + 20;
const CHILD_FID = BASEFID + 30;
const parentHash = (await hub.plant({ cast: { fid: PARENT_FID, ts: wholeSecond(now - 20 * 60_000), text: "the parent post of the chain", seed: "hr:parent" } })).json.hash;
const replyHash = (await hub.plant({ cast: { fid: REPLY_FID, ts: wholeSecond(now - 90_000), text: "a reply in the chain", parent: { fid: PARENT_FID, hash: parentHash }, seed: "hr:reply" } })).json.hash;
const childHash = (await hub.plant({ cast: { fid: CHILD_FID, ts: wholeSecond(now - 60_000), text: "a reply to the reply", parent: { fid: REPLY_FID, hash: replyHash }, seed: "hr:child" } })).json.hash;
// POST AS YOU ON HUB CARDS: a recast @stubalice already made elsewhere (the card must show it pressed, read from the node)
await hub.plant({ reaction: { fid: FID, kind: "recast", target: { fid: CHILD_FID, hash: childHash }, ts: wholeSecond(now - 30_000) } });
// SPEC A (HR20): three recent posts carrying a word a mode will mute, by three followed accounts
const MUTED = "zebrafish";
const mutedHashes = [];
for (const [i, f] of [BASEFID + 40, BASEFID + 41, BASEFID + 42].entries()) {
  mutedHashes.push((await hub.plant({ cast: { fid: f, ts: wholeSecond(now - (3 + i) * 60_000), text: "a Zebrafish sighting, number " + (i + 1), seed: "hr:muted:" + i } })).json.hash);
}
const followed = new Set(Array.from({ length: N }, (_, i) => BASEFID + i));
// SPEC C (HR22): an old post by a followed account (read for the Following, far below the page) that a friend sends
const SENT_FID = BASEFID + 60;
const sentHash = (await hub.plant({ cast: { fid: SENT_FID, ts: wholeSecond(now - 13 * 86_400_000), text: "an old post a friend sends you", seed: "hr:sent" } })).json.hash;
const NEVER_READ = { fid: BASEFID + 61, hash: "0x" + "ab".repeat(20) };
const BOB = STUB_ACCOUNTS.bob;

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
  // the relay's bytes, kept as hex (POST AS YOU ON HUB CARDS: HR14 decodes them)
  let hex = "";
  if (r.url().endsWith("/fc/hub/submit")) {
    try {
      hex = r.postDataBuffer() ? r.postDataBuffer().toString("hex") : "";
    } catch {
      hex = "";
    }
  }
  requests.push({ url: r.url(), method: r.method(), headers: r.headers(), body, hex, nav: r.isNavigationRequest() });
});
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable", { enableUI: false });
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
const testid = (id) => page.getByTestId(id).first();
// SPEC C: the page's own posts, in order — never a card the injection queue spliced in (a requeued reading piece, a sent
// post), which says why it is there and is checked on its own
const cardHashes = (scope) => page.$$eval(scope + ' article[data-testid="cast"]', (els) => els.filter((e) => !e.closest('[data-placement="queue"]')).map((e) => e.getAttribute("data-hash")));
// POST AS YOU ON HUB CARDS
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
const card = (hash) => page.locator(`[data-testid="hub-timeline"] article[data-hash="${hash}"]`).first();
const btn = (hash, id) => card(hash).locator(`[data-testid="${id}"]`).first();
const submits = () => requests.filter((r) => r.url === VBASE + "/fc/hub/submit" && r.method === "POST");
const stubState = async () => (await getJson(RP + "/__stub/state")).json;
/** the last message the relay received, decoded: MessageData's type, fid, body, and the signer */
function lastMessage() {
  const s = submits().pop();
  if (!s || !s.hex) throw new Error("no bytes reached the relay");
  const m = decodeProto(Buffer.from(s.hex, "hex"));
  const d = decodeProto(m[7][0]);
  const hexOf = (u) => "0x" + Buffer.from(u).toString("hex");
  const castId = (b) => {
    const c = decodeProto(b);
    return { fid: Number(c[1][0]), hash: hexOf(c[2][0]) };
  };
  const out = { type: Number(d[1][0]), fid: Number(d[2][0]), signer: Buffer.from(m[6][0]).toString("hex") };
  if (d[7]) {
    const rb = decodeProto(d[7][0]);
    out.reaction = Number(rb[1][0]);
    out.target = castId(rb[2][0]);
  }
  if (d[5]) {
    const cb = decodeProto(d[5][0]);
    out.text = cb[4] ? Buffer.from(cb[4][0]).toString("utf8") : "";
    out.parent = cb[3] ? castId(cb[3][0]) : null;
  }
  if (d[6]) out.removed = hexOf(decodeProto(d[6][0])[1][0]);
  return out;
}
const touched = new Set(); // the hashes HR14 / HR15 sent through the validator's relay, by design (§35)

console.log("\nHUB READ PROD — Following from the hub (app " + BASE + ", validator " + VBASE + ", node " + HUB + "; planted " + syn.casts + " casts over " + N + " follows)");

await check("HR1 the shape: public, live, the hub stub answers, and the tab's node is the stub, handed over by the app server", async () => {
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  const env = await page.evaluate(() => window.__LAYERS_DEVICE_ENV || {});
  if (env.FC_ROOT_HUB_URL !== HUB || env.PUBLIC_LIVE !== "on") throw new Error("the device env: FC_ROOT_HUB_URL=" + env.FC_ROOT_HUB_URL + " PUBLIC_LIVE=" + env.PUBLIC_LIVE);
  return "node " + env.FC_ROOT_HUB_URL;
});

await check("HR2 sign in with Farcaster as @stubalice and keep the identity with a passkey → /home as the root", async () => {
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

await check("HR3 Pick up where you left off: 'You follow 120 accounts on Farcaster.' and Find your people → /fc/following", async () => {
  await page.locator('[data-testid="pickup-people-count"][data-state="ok"]').waitFor({ timeout: 60_000 });
  const c = testid("pickup-people-count");
  if ((await c.getAttribute("data-count")) !== String(N) || !(await c.innerText()).includes("You follow 120 accounts on Farcaster.")) throw new Error("the card says: " + (await c.innerText()));
  if ((await testid("pickup-people-link").getAttribute("href")) !== "/fc/following") throw new Error("Find your people goes to " + (await testid("pickup-people-link").getAttribute("href")));
});

await check("HR4 Following: progressive (cards while it is still reading), then the first 20 cards are exactly the ground truth, newest first, each read-only marked", async () => {
  await hub.steer({ delayMs: 120 });
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  let sawFilling = false;
  for (let i = 0; i < 200 && !sawFilling; i++) {
    sawFilling = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="hub-following-progress"]');
      const t = document.querySelector('[data-testid="hub-timeline"]');
      return !!p && !!t && Number(t.getAttribute("data-count")) > 0;
    });
    if (!sawFilling) await sleep(100);
  }
  await page.locator('[data-testid="hub-following"][data-state="ready"]').waitFor({ timeout: 120_000 });
  await hub.steer({ delayMs: 0 });
  if (!sawFilling) throw new Error("never saw cards while it was still reading (not progressive)");
  const truth = (await hub.truth(20)).map((c) => c.hash);
  const got = (await cardHashes('[data-testid="hub-timeline"]')).slice(0, 20);
  const d = got.findIndex((h, i) => h !== truth[i]);
  if (got.length < 20 || d !== -1) throw new Error("the first 20 differ from the truth at " + d + ": " + got.slice(0, 3).join(",") + " vs " + truth.slice(0, 3).join(","));
  const marked = await page.$$eval('[data-testid="hub-timeline"] article[data-testid="cast"]', (els) => els.slice(0, 20).every((e) => e.getAttribute("data-live") === "true" && !!e.querySelector('[data-testid="network-marker"]')));
  if (!marked) throw new Error("a card without the read-only mark");
  const status = await testid("hub-following-count").innerText();
  if (!status.includes("You follow 120 accounts")) throw new Error("the status line: " + status);
  return "cards while reading; 20/20 match the truth";
});

await check("HR5 a reply says 'Replying to @…' and opens /fc/cast#<fid>/<hash>: the post it replies to above it, its reply below it", async () => {
  const card = page.locator(`[data-testid="hub-timeline"] article[data-hash="${replyHash}"]`);
  await card.waitFor({ timeout: 30_000 });
  const text = await card.innerText();
  if (!text.includes("Replying to @acct10")) throw new Error("the reply card says: " + text.slice(0, 200));
  await card.getByText("a reply in the chain", { exact: true }).first().click();
  await page.waitForURL((u) => u.pathname === "/fc/cast" && u.hash === `#${REPLY_FID}/${replyHash}`, { timeout: 30_000 });
  await page.locator(`[data-testid="hub-thread"][data-hash="${replyHash}"]`).waitFor({ timeout: 60_000 });
  const anc = await cardHashes('[data-testid="hub-thread-ancestors"]');
  const rep = await cardHashes('[data-testid="hub-thread-replies"]');
  if (anc.join() !== parentHash || rep.join() !== childHash) throw new Error("the thread: ancestors " + anc.join() + " replies " + rep.join());
  return "parent above, reply below";
});

await check("HR6 its author opens /fc/profile#<fid>: the account's name and posts", async () => {
  await page.locator(`[data-testid="hub-thread-cast"] a[href="/fc/profile#${REPLY_FID}"]`).first().click();
  await page.waitForURL((u) => u.pathname === "/fc/profile" && u.hash === `#${REPLY_FID}`, { timeout: 30_000 });
  await page.locator(`[data-testid="hub-profile"][data-fid="${REPLY_FID}"]`).waitFor({ timeout: 60_000 });
  if ((await testid("hub-profile-username").innerText()).trim() !== "@acct20") throw new Error("the profile: " + (await testid("hub-profile-username").innerText()));
  const casts = await cardHashes('[data-testid="hub-profile-casts"]');
  if (!casts.includes(replyHash)) throw new Error("the profile's posts lack the reply");
});

await check("HR7 /fc/following lists who @stubalice follows, most recently followed first, 50 at a time", async () => {
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="pickup-people-count"][data-state="ok"]').waitFor({ timeout: 60_000 });
  await testid("pickup-people-link").click();
  await page.waitForURL((u) => u.pathname === "/fc/following", { timeout: 30_000 });
  await page.locator('[data-testid="hub-people"]').waitFor({ timeout: 60_000 });
  if ((await testid("hub-people-count").getAttribute("data-count")) !== String(N)) throw new Error("the count: " + (await testid("hub-people-count").innerText()));
  const fids = await page.$$eval('[data-testid="hub-person"]', (els) => els.map((e) => Number(e.getAttribute("data-fid"))));
  if (fids.length !== 50 || fids[0] !== BASEFID + N - 1 || fids[1] !== BASEFID + N - 2) throw new Error("the first page: " + fids.length + " rows, starting " + fids.slice(0, 2));
  if (!(await page.locator('[data-testid="hub-person-username"]').first().innerText()).includes("@acct119")) throw new Error("the first row's name");
  await testid("hub-people-more").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="hub-person"]').length === 100, null, { timeout: 60_000 });
  return "50, then 100 rows";
});

// SPEC C (HR22): her private ring address, made now, as a friend would have been handed it earlier. Made BEFORE anything
// else writes her rings document: lib/rings/inbox.ts mints the spare addresses into the document's first write (or the
// deferred upkeep, 15 minutes to 3 hours later), and HR18 below makes a ring
let aliceAddr = null;
let aliceAddrError = "not tried";
await (async () => {
  for (let i = 0; i < 40 && !aliceAddr; i++) {
    const a = await api("POST", "/api/rings", { action: "createAddress", label: "for Bob" }).catch((e) => ({ status: 0, text: String(e), json: null }));
    if (a.status === 200 && /^LR1\./.test(a.json?.address?.address ?? "")) aliceAddr = a.json.address.address;
    else {
      aliceAddrError = a.status + " " + String(a.text).slice(0, 200);
      await sleep(500);
    }
  }
})();

const NEEDS_KEY = "Liking, recasting and replying here act as @stubalice on Farcaster, once you allow Totem to post as you (Settings, Account).";
await check("HR13 BEFORE Totem may post as you: a hub card's Like, Recast and Reply are disabled with the one-line reason, a tap says it, nothing reaches the relay; the thread's reply box says the same", async () => {
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await card(replyHash).waitFor({ timeout: 60_000 });
  // the reason arrives once the device has answered (it says "Checking…" until then)
  await page.waitForFunction((h) => document.querySelector(`[data-testid="hub-timeline"] article[data-hash="${h}"] [data-testid="action-like"]`)?.getAttribute("title")?.includes("once you allow"), replyHash, { timeout: 60_000 });
  for (const id of ["action-like", "action-recast", "action-reply"]) {
    const b = btn(replyHash, id);
    if ((await b.getAttribute("data-disabled")) !== "true" || (await b.getAttribute("title")) !== NEEDS_KEY) throw new Error(id + ": disabled=" + (await b.getAttribute("data-disabled")) + " title=" + (await b.getAttribute("title")));
  }
  // a tap on the disabled button (aria-disabled, so a tap can still say why: Playwright needs force to tap it)
  await btn(replyHash, "action-like").click({ force: true });
  await card(replyHash).locator('[data-testid="hub-action-error"]').waitFor({ timeout: 30_000 });
  const said = await card(replyHash).locator('[data-testid="hub-action-error"]').innerText();
  if (said.trim() !== NEEDS_KEY) throw new Error("the tap said: " + said);
  if (await page.getByTestId("hub-card-reply").count()) throw new Error("a reply composer opened before Totem may post as you");
  if (submits().length) throw new Error(submits().length + " message(s) reached the relay");
  await card(replyHash).getByText("a reply in the chain", { exact: true }).first().click();
  await page.locator(`[data-testid="hub-thread"][data-hash="${replyHash}"]`).waitFor({ timeout: 60_000 });
  await page.locator('[data-testid="hub-reply-needs-key"][data-reason="key"]').waitFor({ timeout: 60_000 });
  if (await page.getByTestId("hub-reply").count()) throw new Error("the thread offers a reply box before Totem may post as you");
  return "3 buttons disabled with the reason; the tap said it; 0 messages at the relay";
});

/** THE ROOT'S OWN WRITES (lib/device/actingRoot.ts ROOT_WRITES): with no persona acting, each answers 2xx and its effect
 *  reads back; a persona action is refused 409 NO_ACTING_PERSONA. Used with no persona at all (HR18) and as You (HR19). */
async function rootLevelWrites(tag) {
  const done = [];
  const ok = (r, what) => {
    if (r.status < 200 || r.status > 299) throw new Error(what + ": " + r.status + " " + r.text.slice(0, 200));
    done.push(what);
    return r.json;
  };
  // what I see: a mode, made and switched to
  const mode = ok(await api("POST", "/api/modes", { name: "Root mode " + tag }), "create a mode").mode;
  if (!mode || !mode.id) throw new Error("no mode in the answer");
  ok(await api("POST", "/api/modes/active", { modeId: mode.id }), "activate it");
  const modes = ok(await api("GET", "/api/modes"), "read the modes");
  if (modes.activeId !== mode.id || !modes.modes.some((m) => m.id === mode.id)) throw new Error("the mode is not active: " + JSON.stringify({ active: modes.activeId, want: mode.id }));
  // what I see: a rule
  const word = "rootrule" + tag;
  const rule = ok(await api("POST", "/api/rules", { name: "Root rule " + tag, action: "hide", root: { op: "and", conditions: [{ field: "text", cmp: "contains", value: word }] } }), "add a rule").rule;
  if (!rule || !rule.id) throw new Error("no rule in the answer");
  const rules = ok(await api("GET", "/api/rules"), "read the rules").rules;
  if (!rules.some((r) => r.id === rule.id)) throw new Error("the rule does not read back");
  // who sees me: a ring
  ok(await api("POST", "/api/rings", { action: "createRing", label: "Ring " + tag }), "create a ring");
  const rings = ok(await api("GET", "/api/rings"), "read the rings");
  if (!JSON.stringify(rings.rings ?? []).includes("Ring " + tag)) throw new Error("the ring does not read back: " + JSON.stringify(rings).slice(0, 200));
  // your own data: the X archive import's first step (its session reads back)
  const begun = ok(await api("POST", "/api/x/import", { action: "begin" }), "begin an X archive import");
  if (!begun.sessionId) throw new Error("no import session");
  const imp = await api("GET", "/api/x/import");
  if (!imp.text.includes(begun.sessionId)) throw new Error("the import session does not read back");
  // a persona action: refused before its route runs
  const cast = await api("POST", "/api/actions/cast", { text: "as a persona, while none acts " + tag });
  if (cast.status !== 409 || cast.json?.code !== "NO_ACTING_PERSONA") throw new Error("a persona action while no persona acts: " + cast.status + " " + cast.text.slice(0, 160));
  return done.length + " root writes answered and read back (" + done.join(", ") + "); a persona cast refused 409 NO_ACTING_PERSONA";
}

await check("HR18 THE ROOT'S OWN WRITES with no persona at all (the default path): a mode made and activated, a rule, a ring, an X import begun, each 2xx and read back; a persona action refused 409 NO_ACTING_PERSONA", async () => {
  const per = (await api("GET", "/api/personas")).json?.personas ?? [];
  if (per.some((p) => p.publicSelf !== true) || !per.some((p) => p.publicSelf === true)) throw new Error("not a visitor with only their own account: " + JSON.stringify(per.map((p) => [p.handle, !!p.publicSelf])));
  return rootLevelWrites("a" + Date.now().toString(36));
});

await check("HR20 YOUR MODE ON THE REAL FOLLOWING (spec A), signed in as the root with no persona: the pill is on Following; a mode muting a word hides exactly those posts ('Your mode hid 3 of these 50 posts'); a mode hiding everything says 'Your mode hid all 50 posts.'; never-miss set on a hub card pins one post of that account on top; back on Default the page is newest first again (the ground truth); what Farcaster posts can't carry is said; zero node reads across the switches", async () => {
  const per = (await api("GET", "/api/personas")).json?.personas ?? [];
  if (per.some((p) => p.publicSelf !== true)) throw new Error("expected no persona yet: " + JSON.stringify(per.map((p) => p.handle)));
  // the rules and modes, as the root (the device keys them to the public self while no persona acts)
  const ok = (r, what) => {
    if (r.status < 200 || r.status > 299) throw new Error(what + ": " + r.status + " " + r.text.slice(0, 200));
    return r.json;
  };
  const mute = ok(await api("POST", "/api/rules", { name: "Mute zebrafish", action: "hide", root: { combinator: "AND", clauses: [{ field: "post.text", op: "contains", value: MUTED.toUpperCase() }] } }), "the muted-word rule").rule;
  const all = ok(await api("POST", "/api/rules", { name: "Everything", action: "hide", root: { combinator: "AND", clauses: [{ field: "post.age", op: "gte", value: 0 }] } }), "the hide-all rule").rule;
  ok(await api("POST", "/api/modes", { name: "Zebra free", ruleIds: [mute.id] }), "the Zebra free mode");
  ok(await api("POST", "/api/modes", { name: "Hide all", ruleIds: [all.id] }), "the Hide all mode");
  // Following, freshly loaded (the pill reads the new modes); then nothing more may be read from the node for any switch
  const q0 = requests.length;
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="hub-following"][data-state="ready"]').waitFor({ timeout: 120_000 });
  await testid("mode-pill").waitFor({ timeout: 60_000 });
  await page.locator('[data-testid="hub-mode"]').waitFor({ timeout: 60_000 });
  await sleep(1500);
  const r0 = (await hub.reads()).reads.length;
  const q1 = requests.length;
  const truth50 = (await hub.truth(50)).map((c) => c.hash);
  for (const h of mutedHashes) if (!truth50.includes(h)) throw new Error("a muted post is not among the newest 50 (the check would be vacuous)");
  const pick = async (name, testidName) => {
    await testid("mode-pill").click();
    await testid("mode-option-" + testidName).click();
    await page.locator(`[data-testid="hub-mode"][data-mode-name="${name}"], [data-testid="hub-mode-error"]`).first().waitFor({ timeout: 60_000 });
    if (await page.getByTestId("hub-mode-error").count()) throw new Error("the mode could not be applied: " + (await testid("hub-mode-error").innerText()));
    if ((await testid("mode-pill").getAttribute("data-active-mode")) !== name) throw new Error("the pill says " + (await testid("mode-pill").getAttribute("data-active-mode")));
  };
  const said = [];
  // (1) the muted word, in any case: exactly those three posts go, the rest stay in the ground truth's order
  await pick("Zebra free", "zebra-free");
  const zf = await cardHashes('[data-testid="hub-timeline"]');
  const wantZf = truth50.filter((h) => !mutedHashes.includes(h));
  const dz = zf.findIndex((h, i) => h !== wantZf[i]);
  if (zf.length !== wantZf.length || dz !== -1) throw new Error("under the muted word the page differs from the truth at " + dz + " (" + zf.length + " vs " + wantZf.length + ")");
  const hid = await testid("hub-mode-hid").innerText();
  if (!hid.includes("Your mode hid 3 of these 50 posts.")) throw new Error("the line says: " + hid);
  if ((await page.locator('[data-testid="hub-timeline"]').innerText()).toLowerCase().includes(MUTED)) throw new Error("a muted post is on screen");
  said.push("muted 3 of 50");
  // (2) never miss, from a hub card's own menu: one post of that account, on top, marked; nothing else moves
  const target = zf[14];
  await card(target).locator('[data-testid="cast-kebab"]').click();
  const picker = page.locator('[data-testid="cast-menu-delivery"][data-hub="true"] [data-testid="delivery-picker"]').first();
  await picker.waitFor({ timeout: 30_000 });
  if (await picker.locator('[data-testid="delivery-option-facet-only"]').count()) throw new Error("facet only is offered for a Farcaster account");
  const acct = await picker.getAttribute("data-persona");
  if (!/^fc:\d+$/.test(acct || "")) throw new Error("the tier is keyed " + acct);
  await page.locator(`[data-testid="delivery-picker"][data-persona="${acct}"][data-tier="normal"]`).waitFor({ timeout: 30_000 });
  await picker.locator('[data-testid="delivery-option-never-miss"]').click();
  await page.locator('[data-testid="hub-mode"][data-pinned="1"]').waitFor({ timeout: 60_000 });
  const pinnedNow = await cardHashes('[data-testid="hub-timeline"]');
  const fidOf = Number(acct.slice(3));
  const truthRows = await hub.truth(50);
  const byAcct = truthRows.filter((c) => c.fid === fidOf && !mutedHashes.includes(c.hash)).map((c) => c.hash);
  if (pinnedNow[0] !== byAcct[0]) throw new Error("the pinned post is " + pinnedNow[0] + ", not the account's newest " + byAcct[0]);
  if ((await page.getByTestId("hub-pinned-label").count()) !== 1) throw new Error((await page.getByTestId("hub-pinned-label").count()) + " posts marked Never miss");
  const rest = pinnedNow.slice(1);
  const wantRest = wantZf.filter((h) => h !== byAcct[0]);
  if (rest.join() !== wantRest.join()) throw new Error("pinning moved more than the one post");
  said.push("never miss pinned " + acct + " (one post, on top)");
  // (3) a mode that hides everything: said as that, never as an empty Following
  await pick("Hide all", "hide-all");
  await testid("hub-mode-hid-all").waitFor({ timeout: 60_000 });
  const ha = await testid("hub-mode-hid-all").innerText();
  if (!ha.includes("Your mode hid all 50 posts.")) throw new Error("the hide-all line: " + ha);
  if ((await cardHashes('[data-testid="hub-timeline"]')).length) throw new Error("cards under a mode that hides everything");
  if (await page.getByTestId("hub-following-empty").count()) throw new Error("an empty-Following line under a mode that hid everything");
  said.push("hid all 50");
  // (4) back on Default: newest first, exactly the ground truth; the never-miss tier belonged to Zebra free only
  await pick("Default", "default");
  const back = await cardHashes('[data-testid="hub-timeline"]');
  const truth20 = truth50.slice(0, 20);
  const db = back.slice(0, 20).findIndex((h, i) => h !== truth20[i]);
  if (back.length < 20 || db !== -1) throw new Error("back on Default the first 20 differ from the truth at " + db);
  const hm = page.locator('[data-testid="hub-mode"]');
  if ((await hm.getAttribute("data-hidden")) !== "0" || (await hm.getAttribute("data-ranked")) !== "false" || (await hm.getAttribute("data-pinned")) !== "0") throw new Error("Default's line: " + JSON.stringify({ hidden: await hm.getAttribute("data-hidden"), ranked: await hm.getAttribute("data-ranked"), pinned: await hm.getAttribute("data-pinned") }));
  // what Default weighs that Farcaster posts can't carry is SAID (engagement: the node keeps no counts)
  const gaps = page.locator('[data-testid="hub-mode-gaps"]');
  if (!(await gaps.innerText()).includes("Not available on Farcaster posts") || !(await page.locator('[data-testid="hub-mode-gap"][data-term="engagement"]').count())) throw new Error("Default's engagement weight is not said");
  said.push("Default = the truth");
  // (5) ZERO node reads caused by any of it
  const r1 = (await hub.reads()).reads.length;
  if (r1 !== r0) throw new Error(r1 - r0 + " node read(s) across the mode switches and the tier: " + JSON.stringify((await hub.reads()).reads.slice(r0).map((x) => x.path + "?" + x.fid)));
  // the modes are the root's own: the device's mode route agrees with the pill
  const modes = ok(await api("GET", "/api/modes"), "read the modes");
  if (modes.modes.find((m) => m.id === modes.activeId)?.name !== "Default") throw new Error("the device's active mode: " + modes.activeId);
  // what reached Totem's validator: the sealed tier record read at most once for the page load (the same GET the sample
  // feed makes), and during the switches only sealed writes (the active mode, the tier); no request to the app server
  const toVal = (from, to) => requests.slice(from, to).filter((r) => r.url.startsWith(VBASE));
  const tierGets = toVal(q0, q1).filter((r) => r.method === "GET" && r.url.startsWith(VBASE + "/state/deliveryTiers")).length;
  if (tierGets > 1) throw new Error(tierGets + " reads of the tier record for one page load");
  const during = toVal(q1);
  const reads = during.filter((r) => r.method === "GET");
  if (reads.some((r) => r.url.startsWith(VBASE + "/state/deliveryTiers"))) throw new Error("the tier record was read again during the switches");
  // (a page's own RSC refresh after a tier is set is the picker's existing router.refresh: no identifier in it, HR10)
  const appCalls = requests.slice(q1).filter((r) => r.url.startsWith(BASE) && !r.nav && !/\/_next\/|_rsc=/.test(r.url) && r.headers?.rsc !== "1");
  if (appCalls.length) throw new Error("the switches reached the app server: " + appCalls.slice(0, 3).map((r) => r.method + " " + r.url.slice(0, 80)).join(", "));
  const writes = during.filter((r) => r.method !== "GET").map((r) => r.method + " " + new URL(r.url).pathname);
  return said.join("; ") + "; 0 node reads; the tier record read " + tierGets + "x on load; during the switches the validator got " + writes.length + " sealed write(s) (" + [...new Set(writes)].join(", ") + ") and " + reads.length + " read(s)";
});

await check("HR21 READWISE ON THE REAL FOLLOWING (spec C), as the root with no persona: a long real-shaped cast is a reading piece; kept on screen past its length-scaled threshold it shows read, its dwell left the tab only inside the SEALED readwiseState record (no request carries the hash, the chunk id or the words; nothing reached the app server); the bin takes it off and lists it, Restore brings it back read; zero node reads", async () => {
  const per = (await api("GET", "/api/personas")).json?.personas ?? [];
  if (per.some((p) => p.publicSelf !== true)) throw new Error("expected no persona yet: " + JSON.stringify(per.map((p) => p.handle)));
  // a long cast lands on the node (80 words: the shortest piece the length slider allows, so its threshold is 10 s)
  const words = Array.from({ length: 80 }, (_, i) => "lightyear" + i);
  const text = words.join(" ");
  const pieceHash = (await hub.plant({ cast: { fid: BASEFID + 50, ts: wholeSecond(Date.now() - 20_000), text, seed: "hr21:piece" } })).json.hash;
  const chunkId = pieceHash + "#chunk1";
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="hub-following"][data-state="ready"]').waitFor({ timeout: 120_000 });
  const piece = page.locator(`[data-testid="hub-piece"][data-chunk-id="${chunkId}"]`);
  await piece.waitFor({ timeout: 60_000 });
  if ((await piece.getAttribute("data-read")) !== "false") throw new Error("a new piece is already read: " + (await piece.getAttribute("data-read")));
  if (!(await piece.innerText()).includes("Reading piece · from your Following")) throw new Error("the piece does not say what it is");
  if ((await piece.locator(`article[data-hash="${pieceHash}"]`).count()) !== 1) throw new Error("the piece does not hold its post");
  const pieceCount = Number(await testid("hub-timeline").getAttribute("data-pieces"));
  if (!(pieceCount >= 1)) throw new Error("the page counts " + pieceCount + " pieces");
  await sleep(1500);
  const r0 = (await hub.reads()).reads.length;
  const q0 = requests.length;
  // on screen past the threshold, then off screen: the card adds the time up and seals it once, as it leaves
  await piece.scrollIntoViewIfNeeded();
  await sleep(11_500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction((id) => document.querySelector(`[data-testid="readwise-chunk"][data-chunk-id="${id}"]`)?.getAttribute("data-read") === "1", chunkId, { timeout: 30_000 });
  await sleep(500);
  const during = requests.slice(q0);
  const sealed = during.filter((r) => r.method === "PUT" && r.url.startsWith(VBASE + "/state/readwiseState"));
  if (!sealed.length) throw new Error("no sealed write of the readwise record (the positive control): " + during.map((r) => r.method + " " + r.url.slice(0, 60)).join(", ").slice(0, 300));
  if (!sealed.every((r) => r.headers["x-layers-sig"] || r.headers["x-layers-device"])) throw new Error("the sealed write is not device-signed");
  const needles = [pieceHash, pieceHash.slice(2), chunkId, "#chunk", "lightyear"];
  const problems = [];
  for (const r of during) {
    const all = (r.url + " " + JSON.stringify(r.headers) + " " + String(r.body)).toLowerCase();
    for (const n0 of needles) if (all.includes(n0.toLowerCase())) problems.push(r.method + " " + r.url.slice(0, 70) + " carries " + n0);
  }
  if (during.some((r) => r.url.startsWith(BASE + "/api/readwise"))) problems.push("the dwell reached the app server");
  if (problems.length) throw new Error([...new Set(problems)].slice(0, 4).join(" | "));
  // the bin: X puts it there; the post stays on the page as a plain post; the bin lists it with its words
  await page.evaluate(() => window.scrollTo(0, 0));
  await piece.locator('[data-testid="readwise-dismiss"]').click();
  await piece.waitFor({ state: "detached", timeout: 60_000 });
  await page.locator(`[data-testid="hub-timeline"] [data-placement="page"] article[data-hash="${pieceHash}"]`).waitFor({ timeout: 30_000 });
  const rw = await api("GET", "/api/readwise");
  const entry = (rw.json?.bin ?? []).find((b) => b.chunkId === chunkId);
  if (rw.status !== 200 || !entry || entry.text !== text) throw new Error("the bin: " + rw.status + " " + JSON.stringify(rw.json?.bin ?? rw.json).slice(0, 200));
  const r1 = (await hub.reads()).reads.length;
  if (r1 !== r0) throw new Error(r1 - r0 + " node read(s) for the piece, its dwell and the bin: " + JSON.stringify((await hub.reads()).reads.slice(r0).map((x) => x.path + "?" + x.fid)));
  // Restore: the piece is back, and still read (the sealed record kept its dwell)
  const back = await api("POST", "/api/readwise", { action: "restore", chunkId });
  if (back.status !== 200) throw new Error("restore: " + back.status + " " + back.text.slice(0, 160));
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator(`[data-testid="hub-piece"][data-chunk-id="${chunkId}"][data-read="true"]`).waitFor({ timeout: 60_000 });
  return "a piece of 80 words; read after 11.5 s on screen; " + sealed.length + " sealed write(s), nothing in the clear in " + during.length + " requests; binned and restored (read); 0 node reads";
});

let postedHash = null;
await check("HR8 POST AS YOU: the root's own post appears at the top of Following, by its node hash, as @stubalice", async () => {
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await testid("root-post-allow").waitFor({ timeout: 60_000 });
  await testid("root-post-allow").click();
  await testid("root-post-approve").waitFor({ timeout: 60_000 });
  await post(RP + "/__stub/approve", { userFid: FID });
  await testid("root-composer").waitFor({ timeout: 60_000 });
  await testid("root-composer-text").fill("my own post, from the hub suite");
  await testid("root-composer-submit").click();
  await page.locator('[data-testid="root-composer-result"][data-kind="ok"]').waitFor({ timeout: 60_000 });
  const st = (await getJson(RP + "/__stub/state")).json;
  const c = st.hub.casts.find((x) => x.text === "my own post, from the hub suite");
  if (!c || c.fid !== FID) throw new Error("the node does not hold the post");
  postedHash = c.hash;
  // a client navigation to the Following tab: the device still holds this tab's post (shown at once), the node confirms it
  await testid("tab-following").click();
  await page.locator(`[data-testid="hub-timeline"] article[data-hash="${postedHash}"]`).waitFor({ timeout: 60_000 });
  const first = (await cardHashes('[data-testid="hub-timeline"]'))[0];
  if (first !== postedHash) throw new Error("the root's post is not on top: " + first);
  // at once, the card names the root from its own sign-in (never a bare account number), and keeps that name after
  // the node's profile is read
  const card = page.locator(`[data-testid="hub-timeline"] article[data-hash="${postedHash}"]`);
  const atOnce = await card.innerText();
  if (!atOnce.includes("@stubalice") || /Farcaster account 990777/.test(atOnce) || !atOnce.includes("my own post, from the hub suite")) throw new Error("the card at once: " + atOnce.slice(0, 160));
  await page.locator('[data-testid="hub-following"][data-state="ready"]').waitFor({ timeout: 60_000 });
  const settled = await card.innerText();
  if (!settled.includes("Stub Alice") || !settled.includes("@stubalice")) throw new Error("the card once settled: " + settled.slice(0, 160));
  return postedHash.slice(0, 12) + "… on top, as @stubalice at once";
});

let deviceKey = null;
await check("HR14 POST AS YOU ON HUB CARDS: Like, Recast and both undos reach the relay as the right signed bytes and land on the node, pressed only after; an earlier recast shows pressed; Reply carries the card as its parent; Delete removes the root's cast", async () => {
  deviceKey = (await api("GET", "/api/fc/root")).json?.key;
  if (!/^0x[0-9a-f]{64}$/.test(deviceKey || "")) throw new Error("no active key: " + deviceKey);
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="hub-following"][data-state="ready"]').waitFor({ timeout: 60_000 });
  const like = btn(replyHash, "action-like");
  const recast = btn(replyHash, "action-recast");
  // the buttons work now (no reason), and their state comes from the node: not liked yet; the child cast, recast
  // elsewhere before, shows pressed
  await page.waitForFunction((h) => document.querySelector(`[data-testid="hub-timeline"] article[data-hash="${h}"] [data-testid="action-recast"]`)?.getAttribute("data-pressed") === "true", childHash, { timeout: 60_000 });
  if ((await like.getAttribute("data-disabled")) || (await like.getAttribute("data-pressed")) !== "false") throw new Error("the like before: disabled=" + (await like.getAttribute("data-disabled")) + " pressed=" + (await like.getAttribute("data-pressed")));
  const want = { fid: REPLY_FID, hash: replyHash };
  const same = (a, b) => a && b && a.fid === b.fid && a.hash === b.hash;
  const n0 = submits().length;
  const step = async (b, pressed, type, reaction, label) => {
    const n = submits().length;
    await b.click();
    await page.waitForFunction(({ h, id, p }) => document.querySelector(`[data-testid="hub-timeline"] article[data-hash="${h}"] [data-testid="${id}"]`)?.getAttribute("data-pressed") === p, { h: replyHash, id: reaction === 1 ? "action-like" : "action-recast", p: String(pressed) }, { timeout: 60_000 });
    if (submits().length !== n + 1) throw new Error(label + ": " + (submits().length - n) + " message(s) reached the relay");
    const m = lastMessage();
    if (m.type !== type || m.fid !== FID || m.reaction !== reaction || !same(m.target, want) || m.signer !== deviceKey.slice(2)) throw new Error(label + ": the bytes say " + JSON.stringify(m));
    const st = await stubState();
    const has = st.hub.reactions.some((r) => r.fid === FID && r.kind === (reaction === 1 ? "like" : "recast") && same(r.target, want));
    if (has !== pressed) throw new Error(label + ": the node " + (has ? "holds" : "does not hold") + " it");
  };
  await step(like, true, 3, 1, "like");
  await step(recast, true, 3, 2, "recast");
  await step(like, false, 4, 1, "unlike");
  await step(recast, false, 4, 2, "unrecast");
  touched.add(replyHash);
  // Reply: a composer under the card, posting as @stubalice with this card as the parent
  await btn(replyHash, "action-reply").click();
  await card(replyHash).locator('[data-testid="hub-card-reply"]').waitFor({ timeout: 30_000 });
  await card(replyHash).locator('[data-testid="hub-card-reply-text"]').fill("a reply from a hub card");
  await card(replyHash).locator('[data-testid="hub-card-reply-submit"]').click();
  await card(replyHash).locator('[data-testid="hub-card-reply-result"][data-kind="ok"]').waitFor({ timeout: 60_000 });
  const said = await card(replyHash).locator('[data-testid="hub-card-reply-result"]').innerText();
  if (!/Replied on Farcaster as @stubalice\./.test(said)) throw new Error("the reply line says " + said);
  const m = lastMessage();
  if (m.type !== 1 || m.fid !== FID || m.text !== "a reply from a hub card" || !same(m.parent, want) || m.signer !== deviceKey.slice(2)) throw new Error("the reply's bytes say " + JSON.stringify(m));
  const st = await stubState();
  const mine = st.hub.casts.find((c) => c.text === "a reply from a hub card");
  if (!mine || mine.fid !== FID || !same(mine.parent, want) || mine.removed) throw new Error("the node's reply: " + JSON.stringify(mine));
  touched.add(mine.hash);
  // Delete (the root's own cast, now on top of Following): two taps in the card's menu
  await card(mine.hash).waitFor({ timeout: 60_000 });
  await card(mine.hash).locator('[data-testid="cast-kebab"]').click();
  await card(mine.hash).locator('[data-testid="hub-delete"][data-confirm="false"]').click();
  await card(mine.hash).locator('[data-testid="hub-delete"][data-confirm="true"]').click();
  await page.locator('[data-testid="toast"]', { hasText: "Deleted from Farcaster." }).waitFor({ timeout: 60_000 });
  const d = lastMessage();
  if (d.type !== 2 || d.fid !== FID || d.removed !== mine.hash) throw new Error("the delete's bytes say " + JSON.stringify(d));
  if (!(await stubState()).hub.casts.find((c) => c.hash === mine.hash)?.removed) throw new Error("the node still holds the deleted reply");
  await card(mine.hash).waitFor({ state: "detached", timeout: 60_000 });
  // a card that is not the root's own offers no Delete
  await card(replyHash).locator('[data-testid="cast-kebab"]').click();
  if (await card(replyHash).locator('[data-testid="hub-delete"]').count()) throw new Error("Delete offered on someone else's cast");
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  return submits().length - n0 + " messages, each decoded: like, recast, unlike, unrecast, reply (parent " + replyHash.slice(0, 10) + "…), delete";
});

await check("HR15 a NODE REFUSAL (the key removed in the Farcaster app) is a sentence on the card with the node's words, and the button stays unpressed", async () => {
  const target = (await cardHashes('[data-testid="hub-timeline"]')).find((h) => h !== replyHash && h !== childHash && h !== postedHash);
  if (!target) throw new Error("no other card to like");
  await post(RP + "/__stub/remove-key", { userFid: FID, key: deviceKey });
  const n = submits().length;
  await btn(target, "action-like").click();
  await card(target).locator('[data-testid="hub-action-error"]').waitFor({ timeout: 60_000 });
  const said = await card(target).locator('[data-testid="hub-action-error"]').innerText();
  if (!/^Not liked: /.test(said) || !/invalid signer/.test(said)) throw new Error("the card says: " + said);
  if ((await btn(target, "action-like").getAttribute("data-pressed")) === "true") throw new Error("pressed after a refusal");
  if (submits().length !== n + 1) throw new Error("the refused like did not reach the relay once (" + (submits().length - n) + ")");
  if ((await stubState()).hub.reactions.some((r) => r.fid === FID && r.target.hash === target)) throw new Error("the refused like landed");
  touched.add(target);
  await post(RP + "/__stub/add-key", { userFid: FID, key: deviceKey });
  return "said: " + said.slice(0, 90);
});

await check("HR9 NEVER FAIL OPEN: the node failing the follows read is an ERROR on Following and on the home card, never 'You don't follow anyone'; Retry recovers", async () => {
  await hub.steer({ fail: { path: "/v1/linksByFid", fid: FID, status: 500 } });
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="hub-following-error"]').waitFor({ timeout: 60_000 });
  const e = await testid("hub-following-error").innerText();
  if (!/Couldn.t read who you follow/.test(e) || !/not an empty list/.test(e)) throw new Error("the error says: " + e);
  if (await page.getByTestId("hub-following-empty").count()) throw new Error("an empty state shown beside the error");
  if (/don.t follow anyone/i.test(await page.locator("main, body").first().innerText())) throw new Error("'You don't follow anyone' shown for a failed read");
  await page.locator('[data-testid="pickup-people-count"][data-state="error"]').waitFor({ timeout: 60_000 });
  await hub.steer({ clear: true });
  await testid("hub-following-retry").click();
  await page.locator('[data-testid="hub-following"][data-state="ready"]').waitFor({ timeout: 60_000 });
  const n = (await cardHashes('[data-testid="hub-timeline"]')).length;
  if (n < 20) throw new Error("after Retry: " + n + " cards");
  return "error, then " + n + " cards after Retry";
});

await check("HR10 the app server and the validator learned nothing new: no request to either and no app log line carries a followed fid or a hash the tab read; /fc/* requests carry no fragment", async () => {
  const truth = await hub.truth(5000);
  const hashNeedles = new Set([...truth.map((c) => c.hash), parentHash, replyHash, childHash]);
  if (postedHash) hashNeedles.delete(postedHash); // the root's own post went through the validator's relay, by design (§35)
  // so did HR14's and HR15's likes, recasts, reply and delete (the target's hash is in the signed bytes, by design: §35)
  for (const h of touched) hashNeedles.delete(h);
  const fidNeedles = [...followed].map(String);
  const toUs = requests.filter((r) => r.url.startsWith(BASE) || r.url.startsWith(VBASE));
  const problems = [];
  for (const r of toUs) {
    const head = JSON.stringify(r.headers).toLowerCase();
    const where = (r.url + " " + head).toLowerCase();
    const all = where + " " + String(r.body).toLowerCase();
    for (const h of hashNeedles) if (all.includes(h) || all.includes(h.slice(2))) problems.push(r.method + " " + r.url.slice(0, 80) + " carries a cast hash");
    for (const f of fidNeedles) if (new RegExp("(^|[^0-9])" + f + "([^0-9]|$)").test(where)) problems.push(r.method + " " + r.url.slice(0, 80) + " carries followed fid " + f);
    if (/\/fc\/(cast|profile)/.test(r.url) && r.url.includes("#")) problems.push("a fragment reached the server: " + r.url);
  }
  if (!toUs.some((r) => /\/fc\/cast/.test(r.url)) || !toUs.some((r) => /\/fc\/profile/.test(r.url))) problems.push("the /fc pages were never requested (the check would be vacuous)");
  // the positive control: the same needles DO show up where they belong, in the tab's own reads of the node
  const toNode = requests.filter((r) => r.url.startsWith(HUB));
  if (!toNode.some((r) => r.url.toLowerCase().includes(replyHash)) || !toNode.some((r) => new RegExp("fid=" + REPLY_FID + "\\b").test(r.url))) problems.push("the needles were not seen even in the tab's node reads (the scan would be blind)");
  const log = path.join(process.env.TEMP || "/tmp", "layers-app.log");
  let logNote = "the app log was not found at " + log;
  if (existsSync(log)) {
    const text = readFileSync(log, "utf8").toLowerCase();
    for (const h of hashNeedles) if (text.includes(h)) problems.push("the app log carries a cast hash");
    logNote = "the app log (" + text.length + " chars) carries none";
  }
  if (problems.length) throw new Error([...new Set(problems)].slice(0, 5).join(" | "));
  return toUs.length + " requests to the app server and validator, none carrying the graph; " + hashNeedles.size + " hashes looked for; " + logNote;
});

await check("HR11 the node saw only plain reads (no preflight, cookie or Referer; the page's Origin; at most 8 in flight; only the root's graph), and nothing left the machine", async () => {
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
  const outside = reads.filter((x) => x.fid !== FID && !followed.has(x.fid));
  if (outside.length) problems.push(outside.length + " read(s) about accounts outside the graph, e.g. fid " + outside[0].fid);
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

await check("HR22 CLOSE-FRIEND SENDS THROUGH A RING (spec C): @stubbob (his own tab, Sign in with Farcaster, his own passkey) puts @stubalice's private ring address in his ring and sends her an old post she follows and one she never read; his tick publishes the sealed note; her next tick opens it and her Following (already on screen) splices the post in 'Sent to you by Bobby' and says the other isn't shown; no node read on her side names a sent post; no request of either tab carries the sent post's hash or fid in the clear", async () => {
  const per = (await api("GET", "/api/personas")).json?.personas ?? [];
  if (per.some((p) => p.publicSelf !== true)) throw new Error("expected @stubalice with no persona yet");
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="hub-following"][data-state="ready"]').waitFor({ timeout: 120_000 });
  if (await page.locator(`[data-testid="hub-timeline"] article[data-hash="${sentHash}"]`).count()) throw new Error("the old post is on her page already (the check would be vacuous)");
  // her device's tick (it reads the drop for every device, every few seconds, sent anything or not)
  const zk = await api("POST", "/api/zk", { action: "prefetchStatus" });
  if (zk.status !== 200) throw new Error("her device's tick: " + zk.status + " " + zk.text.slice(0, 160));
  // her private ring address (made after sign-in, above), handed to Bob out of band: an address, never her account and
  // never a persona
  const addr = aliceAddr;
  if (!addr) throw new Error("no ring address for her: " + aliceAddrError);
  if (addr.includes(String(FID))) throw new Error("the address carries her fid");
  // Bob: another visitor, his own tab, signed in with Farcaster as @stubbob, his own passkey
  const ctx2 = await browser.newContext({ viewport: DESKTOP });
  const bob = await ctx2.newPage();
  const bobRequests = [];
  ctx2.on("request", (r) => {
    let body = "";
    try {
      body = r.postData() || "";
    } catch {
      body = "";
    }
    bobRequests.push({ url: r.url(), method: r.method(), headers: r.headers(), body, at: Date.now() });
  });
  const cdp2 = await ctx2.newCDPSession(bob);
  await cdp2.send("WebAuthn.enable", { enableUI: false });
  await cdp2.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const bobApi = (method, route, body) =>
    bob.evaluate(
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
  try {
    await post(SIWF + "/__stub/reset");
    await bob.goto(BASE + "/", { waitUntil: "load", timeout: 120_000 });
    await bob.getByTestId("door-start").first().click();
    await bob.waitForURL((u) => u.pathname === "/welcome", { timeout: 60_000 });
    await waitForDevice(bob, 120_000);
    await bob.locator('[data-testid="onboard-step-farcaster"]').waitFor({ timeout: 60_000 });
    await bob.getByTestId("link-farcaster").first().click();
    await bob.getByTestId("siwf-qr").first().waitFor({ timeout: 45_000 });
    await siwfApprove(BOB);
    await bob.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
    await bob.getByTestId("onboard-next").first().click();
    await bob.locator('[data-testid="onboard-step-profile"]').waitFor({ timeout: 60_000 });
    await bob.getByTestId("onboard-next").first().click();
    await bob.locator('[data-testid="onboard-step-save"]').waitFor({ timeout: 60_000 });
    await bob.getByTestId("onboard-save-passkey").first().click();
    await bob.waitForURL((u) => u.pathname === "/home", { timeout: 90_000 });
    await waitForDevice(bob, 120_000);
    const ok = (r, what) => {
      if (r.status < 200 || r.status > 299) throw new Error("bob: " + what + ": " + r.status + " " + r.text.slice(0, 200));
      return r.json;
    };
    // his ring, shown to its people as "Bobby"; Alice's address in it
    const ring = ok(await bobApi("POST", "/api/rings", { action: "createRing", label: "Close", shareAs: "Bobby" }), "createRing");
    ok(await bobApi("POST", "/api/rings", { action: "addMember", ringId: ring.id, address: addr }), "addMember");
    // sends: by id only, as the root (no persona acts in his tab)
    const s1 = ok(await bobApi("POST", "/api/rings", { action: "send", ringId: ring.id, target: { fid: SENT_FID, hash: sentHash } }), "send the old post");
    if (s1.members !== 1) throw new Error("the send reached " + s1.members + " people");
    ok(await bobApi("POST", "/api/rings", { action: "send", ringId: ring.id, target: NEVER_READ }), "send a post she never read");
    // his device's tick publishes. A live tab ticks every ~10 minutes; the composer's first check of a page load runs one
    // tick at once (app/api/anon/route.ts firstCheckIfNone: the same uniform reads every tick makes), and that is the tick
    // used here, on both sides
    const from = Date.now();
    ok(await bobApi("POST", "/api/zk", { action: "prefetchStatus" }), "his device's tick loop");
    await bobApi("GET", "/api/anon");
    for (let i = 0; i < 240 && !bobRequests.some((r) => r.at >= from && r.method === "PUT" && r.url === VBASE + "/rings/drop/batch"); i++) await sleep(250);
    const put = bobRequests.find((r) => r.at >= from && r.method === "PUT" && r.url === VBASE + "/rings/drop/batch");
    if (!put) throw new Error("his tick did not publish to the drop");
    if (!put.headers["x-layers-sig"]) throw new Error("the publish is not device-signed");
    // her next tick opens it (her Following's next page load, as when she comes back; the island is up before the tick),
    // and her Following splices the post in, saying who sent it, with no read caused by it
    await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
    await waitForDevice(page, 120_000);
    await page.locator('[data-testid="hub-following"][data-state="ready"]').waitFor({ timeout: 120_000 });
    await sleep(1500);
    const herReads = async () => (await hub.reads()).reads.filter((x) => x.fid !== BOB.fid);
    const n0 = (await herReads()).length;
    const q0 = requests.length;
    await api("GET", "/api/anon");
    const sent = page.locator(`[data-testid="hub-timeline"] [data-hub-card="sent"][data-hub-item="${sentHash}"]`);
    await sent.waitFor({ timeout: 90_000 });
    const said = await sent.getByTestId("hub-sent-by").innerText();
    if (said.trim() !== "Sent to you by Bobby") throw new Error("the sent card says: " + said);
    if ((await sent.getAttribute("data-placement")) !== "queue" || !(await sent.locator(`article[data-hash="${sentHash}"]`).count())) throw new Error("the sent card is not the spliced post");
    if (!(await sent.innerText()).includes("an old post a friend sends you")) throw new Error("the sent card does not show the post");
    await page.locator('[data-testid="hub-extras-notice"][data-kind="sent_not_held"]').waitFor({ timeout: 30_000 });
    const notice = await page.locator('[data-testid="hub-extras-notice"][data-kind="sent_not_held"]').innerText();
    if (!/1 post sent to you isn.t shown/.test(notice)) throw new Error("the not-held line: " + notice);
    if (await page.locator(`[data-hub-item="${NEVER_READ.hash}"]`).count()) throw new Error("a post she never read is shown");
    await sleep(1500);
    // no read was caused by the send: none names either sent post (a castById for it, a thread under it); whatever else
    // her tab read meanwhile is the Following's own (its page load finishing, its refresh), reported below
    const nodeAfter = requests.slice(q0).filter((r) => r.url.startsWith(HUB));
    const named = nodeAfter.filter((r) => [sentHash.slice(2), NEVER_READ.hash.slice(2)].some((h) => r.url.toLowerCase().includes(h)));
    if (named.length) throw new Error("her tab read the sent post from the node: " + named.map((r) => r.url.slice(r.url.indexOf("/v1/"))).join(", "));
    if (nodeAfter.some((r) => new URL(r.url).searchParams.get("fid") === String(NEVER_READ.fid) && new URL(r.url).pathname === "/v1/castById")) throw new Error("her tab looked up a post by the account of the post she never read");
    const n1 = (await herReads()).length;
    const kinds = [...new Set(nodeAfter.map((r) => new URL(r.url).pathname))];
    // nothing in the clear: no request of either tab to the app server or the validator carries the sent post's hash or
    // its author's fid (Bob's send, his sealed rings record and his drop rows; her drop reads)
    const problems = [];
    const scan = (list, who) => {
      for (const r of list) {
        if (!(r.url.startsWith(BASE) || r.url.startsWith(VBASE))) continue;
        const all = (r.url + " " + JSON.stringify(r.headers) + " " + String(r.body)).toLowerCase();
        for (const h of [sentHash, sentHash.slice(2), NEVER_READ.hash.slice(2)]) if (all.includes(h)) problems.push(who + " " + r.method + " " + r.url.slice(0, 70) + " carries a sent hash");
        if (new RegExp("(^|[^0-9])" + SENT_FID + "([^0-9]|$)").test(r.url + " " + JSON.stringify(r.headers))) problems.push(who + " " + r.method + " " + r.url.slice(0, 70) + " names the sent post's author");
      }
    };
    scan(bobRequests, "bob");
    scan(requests, "alice");
    if (bobRequests.some((r) => r.url.startsWith(BASE + "/api/rings"))) problems.push("bob's send reached the app server");
    if (problems.length) throw new Error([...new Set(problems)].slice(0, 4).join(" | "));
    return "sealed note published (" + put.body.length + " bytes); spliced 'Sent to you by Bobby' on her next tick; 1 not held, said; " + (n1 - n0) + " node read(s) on her side meanwhile (" + (kinds.join(", ") || "none") + "), none naming a sent post; nothing in the clear in " + (bobRequests.length + requests.length) + " requests";
  } finally {
    await ctx2.close().catch(() => undefined);
  }
});

await check("HR12 PERSONA SEPARATION: once @stubalice makes a persona and acts as it, nothing is read from the node as her: Following is the persona's (no hub timeline), the home card says her follows are hidden, /fc/following refuses, and the node sees zero new reads", async () => {
  await page.goto(BASE + "/home#make-persona", { waitUntil: "load", timeout: 120_000 });
  await testid("make-persona").waitFor({ timeout: 60_000 });
  await testid("make-persona-name").fill("Hub Owl");
  await testid("make-persona-create").click();
  await testid("make-persona").waitFor({ state: "detached", timeout: 60_000 });
  await sleep(1500);
  const before = (await hub.reads()).reads.length;
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await sleep(6000);
  const onFollowing = await page.locator('[data-testid="hub-following"], [data-testid="hub-timeline"]').count();
  if (onFollowing) throw new Error("the root's hub timeline rendered while the persona acts");
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await sleep(4000);
  if (await page.locator('[data-testid="pickup"]').count()) {
    if (!(await page.locator('[data-testid="pickup-people-hidden"]').count())) throw new Error("the home card does not say the follows are hidden: " + (await testid("pickup").innerText()).slice(0, 200));
    if (await page.locator('[data-testid="pickup-people-count"]').count()) throw new Error("the home card still reads the root's follows count");
  }
  await page.goto(BASE + "/fc/following", { waitUntil: "load", timeout: 120_000 });
  await testid("hub-people-error").waitFor({ timeout: 60_000 });
  const said = await testid("hub-people-error").innerText();
  if (!/acting as a persona/.test(said)) throw new Error("/fc/following says: " + said.slice(0, 200));
  const after = (await hub.reads()).reads.length;
  if (after !== before) throw new Error(after - before + " node read(s) while the persona acted");
  return "0 node reads across Following, the home card and /fc/following while the persona acted";
});

await check("HR16 PERSONA SEPARATION (writes): while the persona acts the device refuses every root write (like, recast, unlike, reply, delete, a post) with acting_persona, the relay receives nothing, and the composer does not offer posting as @stubalice", async () => {
  const n = submits().length;
  const st0 = await stubState();
  const target = { fid: REPLY_FID, hash: replyHash };
  const refused = [];
  for (const [label, body] of [
    ["like", { action: "react", reaction: "like", target }],
    ["recast", { action: "react", reaction: "recast", target }],
    ["unlike", { action: "react", reaction: "like", target, remove: true }],
    ["reply", { action: "cast", text: "a reply while a persona acts", parent: target }],
    ["delete", { action: "delete", hash: postedHash ?? replyHash }],
    ["post", { action: "cast", text: "a post as the root while a persona acts" }],
  ]) {
    const r = await api("POST", "/api/fc/root", body);
    if (r.status !== 409 || r.json?.code !== "acting_persona" || !/acting as a persona/.test(r.json?.error || "")) throw new Error(label + ": " + r.status + " " + r.text.slice(0, 160));
    refused.push(label);
  }
  if (submits().length !== n) throw new Error(submits().length - n + " message(s) reached the relay while the persona acted");
  const st1 = await stubState();
  if (st1.hub.submits.length !== st0.hub.submits.length) throw new Error("the node received a submit while the persona acted");
  // the composer: no "Post as @stubalice instead" beside the persona's box; the line says why
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await testid("composer-root-off-while-persona").waitFor({ timeout: 60_000 });
  if (await page.getByTestId("composer-post-as-root").count()) throw new Error("the composer still offers posting as the root");
  return refused.length + " writes refused (" + refused.join(", ") + "); 0 messages at the relay";
});

await check("HR17 ACTING AS YOURSELF: with a persona, choosing You in the account menu reads the root's Following from the node and a hub card's like reaches the relay with the right bytes, while a persona write is refused NO_ACTING_PERSONA; choosing the persona again: zero node reads, zero relay submits", async () => {
  const per = (await api("GET", "/api/personas")).json?.personas ?? [];
  const self = per.find((p) => p.publicSelf === true);
  const persona = per.find((p) => p.publicSelf !== true);
  if (!self || !persona) throw new Error("the roster: " + JSON.stringify(per.map((p) => [p.handle, !!p.publicSelf])));
  const acting = async () => (await api("GET", "/api/persona/chrome")).json?.activePersonaId;
  if ((await acting()) !== persona.id) throw new Error("the persona is not acting before the switch");
  // choose You
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await testid("account-switcher-button").click();
  const you = page.locator(`[data-testid="persona-row-${self.handle}"][data-you="true"]`);
  await you.waitFor({ timeout: 30_000 });
  if ((await you.getAttribute("data-acting")) !== "false") throw new Error("You is marked acting before it was chosen");
  await you.click();
  for (let i = 0; i < 60 && (await acting()) !== self.id; i++) await sleep(250);
  if ((await acting()) !== self.id) throw new Error("the acting identity after choosing You: " + (await acting()));
  // the composer is the root's, and says which identity acts
  await testid("root-composer").waitFor({ timeout: 60_000 });
  if ((await testid("composer-posting-as").innerText()).trim() !== "Posting as @stubalice") throw new Error("the composer says " + (await testid("composer-posting-as").innerText()));
  if (!/acting as yourself/.test(await testid("composer-acting-as-you").innerText())) throw new Error("the composer does not say you act as yourself");
  await testid("account-switcher-button").click();
  await page.locator(`[data-testid="persona-row-${self.handle}"][data-you="true"][data-acting="true"]`).waitFor({ timeout: 30_000 });
  if (!/reload goes back to your first persona/.test(await testid("you-acting-note").innerText())) throw new Error("the row does not say what a reload does");
  await page.mouse.click(700, 5);
  // Following is the root's again, read from the node. A CLIENT navigation: a page load is a reload, and a reload goes
  // back to the first persona (the tab's jar is memory), which is the safe direction the menu states
  const reads0 = (await hub.reads()).reads.length;
  await testid("tab-following").click();
  await page.locator('[data-testid="hub-following"][data-state="ready"]').waitFor({ timeout: 90_000 });
  const reads1 = (await hub.reads()).reads.length;
  if (reads1 <= reads0) throw new Error("no node read while acting as yourself");
  // a hub card's like, as the root, with the right bytes
  const n = submits().length;
  const like = btn(replyHash, "action-like");
  await page.waitForFunction((h) => { const b = document.querySelector(`[data-testid="hub-timeline"] article[data-hash="${h}"] [data-testid="action-like"]`); return !!b && !b.getAttribute("data-disabled"); }, replyHash, { timeout: 60_000 });
  const wasPressed = (await like.getAttribute("data-pressed")) === "true";
  await like.click();
  await page.waitForFunction(({ h, p }) => document.querySelector(`[data-testid="hub-timeline"] article[data-hash="${h}"] [data-testid="action-like"]`)?.getAttribute("data-pressed") === p, { h: replyHash, p: String(!wasPressed) }, { timeout: 60_000 });
  if (submits().length !== n + 1) throw new Error(submits().length - n + " message(s) reached the relay for one like");
  const m = lastMessage();
  if (m.type !== (wasPressed ? 4 : 3) || m.fid !== FID || m.reaction !== 1 || m.target?.fid !== REPLY_FID || m.target?.hash !== replyHash || m.signer !== deviceKey.slice(2)) throw new Error("the like's bytes say " + JSON.stringify(m));
  // a persona write while no persona acts: refused before its route runs
  const pw = await api("POST", "/api/actions/react", { hash: replyHash, kind: "like", on: true });
  if (pw.status !== 409 || pw.json?.code !== "NO_ACTING_PERSONA") throw new Error("a persona write while acting as yourself: " + pw.status + " " + pw.text.slice(0, 160));
  if (submits().length !== n + 1) throw new Error("the refused persona write reached the relay");
  if ((await acting()) !== self.id) throw new Error("acting as yourself did not survive a client navigation");
  // choose the persona again (from this page, no reload): the root goes quiet
  await testid("account-switcher-button").click();
  await page.locator(`[data-testid="persona-row-${persona.handle}"]`).click();
  for (let i = 0; i < 60 && (await acting()) !== persona.id; i++) await sleep(250);
  if ((await acting()) !== persona.id) throw new Error("the acting identity after choosing the persona: " + (await acting()));
  await sleep(1500);
  const reads2 = (await hub.reads()).reads.length;
  const s2 = submits().length;
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await sleep(5000);
  if (await page.locator('[data-testid="hub-following"], [data-testid="hub-timeline"]').count()) throw new Error("the root's hub timeline rendered after choosing the persona");
  const rr = await api("POST", "/api/fc/root", { action: "react", reaction: "like", target: { fid: REPLY_FID, hash: replyHash } });
  if (rr.status !== 409 || rr.json?.code !== "acting_persona") throw new Error("a root like after choosing the persona: " + rr.status + " " + rr.text.slice(0, 160));
  const reads3 = (await hub.reads()).reads.length;
  if (reads3 !== reads2) throw new Error(reads3 - reads2 + " node read(s) after choosing the persona again");
  if (submits().length !== s2) throw new Error(submits().length - s2 + " relay submit(s) after choosing the persona again");
  return (reads1 - reads0) + " node reads as yourself, 1 like at the relay (decoded), the persona write refused; then 0 reads and 0 submits as the persona";
});

await check("HR19 THE ROOT'S OWN WRITES as You, after making a persona: the same mode, rule, ring and X import still work, and a persona action is refused; back on the persona, the persona's cast is not refused by the guard", async () => {
  const per = (await api("GET", "/api/personas")).json?.personas ?? [];
  const self = per.find((p) => p.publicSelf === true);
  const persona = per.find((p) => p.publicSelf !== true);
  if (!self || !persona) throw new Error("no persona to come back from");
  const acting = async () => (await api("GET", "/api/persona/chrome")).json?.activePersonaId;
  // choose You (from this page: a reload would go back to the first persona)
  await testid("account-switcher-button").click();
  await page.locator(`[data-testid="persona-row-${self.handle}"][data-you="true"]`).click();
  for (let i = 0; i < 60 && (await acting()) !== self.id; i++) await sleep(250);
  if ((await acting()) !== self.id) throw new Error("the acting identity after choosing You: " + (await acting()));
  const said = await rootLevelWrites("b" + Date.now().toString(36));
  // back on the persona: the guard steps aside (the persona's own route decides)
  await testid("account-switcher-button").click();
  await page.locator(`[data-testid="persona-row-${persona.handle}"]`).click();
  for (let i = 0; i < 60 && (await acting()) !== persona.id; i++) await sleep(250);
  if ((await acting()) !== persona.id) throw new Error("the acting identity after choosing the persona: " + (await acting()));
  const cast = await api("POST", "/api/actions/cast", { text: "the persona posts again" });
  if (cast.json?.code === "NO_ACTING_PERSONA") throw new Error("the persona's cast was refused by the no-persona guard while the persona acts");
  return said + "; as the persona again the cast answered " + cast.status + " (not the guard)";
});

await browser.close();
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log("\n" + (results.length - failed) + "/" + results.length + " checks passed" + (failed ? " — FAILED" : ""));
process.exit(failed ? 1 : 0);
