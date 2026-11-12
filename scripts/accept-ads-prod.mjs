// ADS, PHASE 1 — the house ad in the signed-in root's REAL Following (read by the tab from a Farcaster node), the ad dial
// per mode, "Why this ad", hide controls and the review-gated lot list, ON THE PRODUCTION SHAPE (Playwright, desktop),
// with nothing real. TWO RUNS, through the machine-wide lock (npm run test:ads-prod; it starts servers):
//   bash /c/Users/jorda/.totem-harness/with-lock.sh env PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ADS=on bash scripts/run-prod-shape.sh scripts/accept-ads-prod.mjs
//   bash /c/Users/jorda/.totem-harness/with-lock.sh env PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub bash scripts/run-prod-shape.sh scripts/accept-ads-prod.mjs
// The first runs Phase 1 SWITCHED ON (the app's ADS=on: AD1 to AD8); the second runs it DORMANT, as a deploy ships it
// (no ADS: AD1, AD2 and AD9). The launcher says which (EXPECT_ADS=on|off).
// The tab's node is the loopback Snapchain stub (PRODLIVE_HUB=stub, the default with PRODLIVE_SIWF=stub). Chromium
// resolves NOTHING but loopback, so no request can leave the machine (the advertiser's link included).
//
//   AD1 the shape: /api/dev 403, live mode, the hub stub answers, the tab's node is the stub; the lot list is served
//       read-only at /ads/lots.json and is the file the app ships
//   AD2 sign in with Farcaster as @stubalice (60 follows planted) and keep the identity with a passkey → /home as the root
//   AD3 GENERIC: Default with no setting is Generic (the default for the root); set to "Generic ads only" in Settings,
//       Modes, the house ad sits at rows 5, 20, 35 and 50 of the real Following, the posts between them are the node's
//       ground truth newest first, each ad is labelled "House ad" and carries the lot file's own words
//   AD4 WHY THIS AD: "Shown to everyone who has ads on. Nothing about you or your mode picked it.", "Ads in Default:
//       Generic ads only.", the house line, nobody counts it; the link is the lot's exact address and opens with no
//       Referer and nothing added
//   AD5 HIDE, SEALED: "Hide this ad" removes it from every slot at once, the validator gets ONE sealed record of 4,096
//       bytes with nothing readable in it, Undo brings it back; hidden again it stays hidden after a reload; Settings,
//       Modes lists it and "Show them all again" brings it back
//   AD6 NO ADS: set in Settings, Modes, Following carries no ad and its posts are the ground truth
//   AD7 EVENT SAFE SPACE: switched to on the pill, no ad (forced), and its editor offers no ad setting
//   AD8 NOTHING LEAVES: across the whole ad flow no request (URL, headers, body) names a lot, the ad's words, /api/ads or
//       /ads/lots.json; every validator write is a sealed state PUT; nothing reached any other host but the one tapped
//       link; and the in-tab ad actions (Why this ad, hide, Undo, the pill) caused ZERO node reads
//   AD9 (dormant run) DORMANT: the tab is handed no ADS hint; the real Following carries ZERO ad rows under Default
//       (whose dial is Generic), its posts the ground truth; Settings, Modes says "Ads aren't running on Totem yet." and
//       the dial still saves; saved Generic, still zero ad rows; /ads/lots.json is still served (AD1)
// ABORTS (exit 2): /api/dev must answer 403, EXPECT_PUBLIC_LIVE "true", EXPECT_HUB "stub", EXPECT_ADS "on" or "off".
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { STUB_ACCOUNTS, signForChannel } from "./lib/siwf-stub.mjs";
import { waitForDevice } from "./lib/page-health.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
const SIWF = (process.env.SIWF_STUB_URL || "").replace(/\/$/, "");
const HUBC = (process.env.HUB_STUB_URL || "").replace(/\/$/, "");
const HUB = (process.env.HUB_URL || "").replace(/\/$/, "");
const DESKTOP = { width: 1366, height: 900 };
const FID = STUB_ACCOUNTS.alice.fid;
const BASEFID = 4_100_000;
const N = 60;
const LOTS = JSON.parse(readFileSync(path.join(ROOT, "public", "ads", "lots.json"), "utf8"));
const HOUSE = LOTS.lots.find((l) => l.id === "house-following");
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
if (process.env.EXPECT_PUBLIC_LIVE !== "true" || process.env.EXPECT_HUB !== "stub") {
  console.log("  ABORT: start the pair with PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub (EXPECT_HUB=" + (process.env.EXPECT_HUB || "unset") + ")");
  process.exit(2);
}
const ADS_ON = process.env.EXPECT_ADS === "on";
if (process.env.EXPECT_ADS !== "on" && process.env.EXPECT_ADS !== "off") {
  console.log("  ABORT: EXPECT_ADS is " + (process.env.EXPECT_ADS || "unset") + " — run through scripts/run-prod-shape.sh (PRODLIVE_ADS=on, or unset for the dormant run)");
  process.exit(2);
}
const reads0 = HUBC ? await getJson(HUBC + "/__stub/hub/reads").catch(() => ({ json: null })) : { json: null };
const siwfState = SIWF ? (await getJson(SIWF + "/__stub/state").catch(() => ({ json: null }))).json : null;
if (!reads0.json || !Array.isArray(reads0.json.reads) || !HUB || !siwfState || siwfState.ok !== true || !HOUSE) {
  console.log("  ABORT: the hub stub (" + (HUBC || "unset") + ") or the SIWF stub does not answer, or public/ads/lots.json has no house-following lot");
  process.exit(2);
}
await post(SIWF + "/__stub/reset");
const hub = {
  steer: (b) => post(HUBC + "/__stub/hub/steer", b),
  plant: (b) => post(HUBC + "/__stub/hub/plant", b),
  reads: async () => (await getJson(HUBC + "/__stub/hub/reads")).json.reads.length,
  truth: async (limit) => (await getJson(HUBC + "/__stub/hub/truth?root=" + FID + "&limit=" + limit)).json.casts.map((c) => c.hash),
};
async function siwfApprove(who) {
  const st = (await getJson(SIWF + "/__stub/state")).json;
  const ch = st.channels[0];
  if (!ch) throw new Error("the SIWF stub has no channel to approve");
  const { message, signature } = await signForChannel(ch, who, { fid: who.fid });
  const r = await post(SIWF + "/v1/channel/authenticate", { channelToken: ch.token, message, signature, fid: who.fid, username: who.username, displayName: who.displayName, pfpUrl: who.pfpUrl, bio: "stub account", authMethod: "custody" });
  if (r.status !== 200) throw new Error("the SIWF stub refused the approval: " + r.status);
}
await hub.steer({ clear: true });
const syn = (await hub.plant({ synthetic: { root: FID, n: N, castsPer: 5, base: BASEFID, seed: 41, rootProfile: { username: "stubalice", display: "Stub Alice" } } })).json;

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
  requests.push({ url: r.url(), method: r.method(), headers: r.headers(), body, nav: r.isNavigationRequest() });
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
/** the timeline's rows as shown: a post's hash, or "AD:<lot>" */
const rowsNow = () =>
  page.$$eval('[data-testid="hub-timeline"] > div', (els) => els.map((e) => (e.hasAttribute("data-hub-ad") ? "AD:" + (e.querySelector('[data-testid="ad-unit"]')?.getAttribute("data-lot") ?? "?") : e.getAttribute("data-hub-item"))));
const adRows = (rows) => rows.map((r, i) => (r.startsWith("AD:") ? i + 1 : 0)).filter(Boolean);
async function following(wantAds) {
  await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="hub-following"][data-state="ready"]').waitFor({ timeout: 120_000 });
  await page.waitForFunction((n) => {
    const t = document.querySelector('[data-testid="hub-timeline"]');
    if (!t) return false;
    const s = t.getAttribute("data-ads-state");
    return s !== "pending" && Number(t.getAttribute("data-ads")) === n;
  }, wantAds, { timeout: 60_000 });
}
/** Settings, Modes: edit a mode and pick its ad setting, then save */
async function setDial(modeSlug, dial) {
  await page.goto(BASE + "/settings/modes", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await testid("mode-edit-" + modeSlug).click();
  await testid("mode-editor").waitFor({ timeout: 60_000 });
  await testid("mode-ad-dial-" + dial).click();
  await testid("mode-save").click();
  await page.getByTestId("mode-editor").waitFor({ state: "detached", timeout: 60_000 });
}
const flowStart = { at: 0 };

console.log("\nADS PROD — Phase 1 house ads in the real Following, " + (ADS_ON ? "SWITCHED ON (ADS=on)" : "DORMANT (no ADS)") + " (app " + BASE + ", validator " + VBASE + ", node " + HUB + "; planted " + syn.casts + " casts over " + N + " follows)");

await check("AD1 the shape: public, live, the hub stub answers, the tab's node is the stub; /ads/lots.json is served read-only and is the shipped file", async () => {
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  const env = await page.evaluate(() => window.__LAYERS_DEVICE_ENV || {});
  if (env.FC_ROOT_HUB_URL !== HUB || env.PUBLIC_LIVE !== "on") throw new Error("the device env: FC_ROOT_HUB_URL=" + env.FC_ROOT_HUB_URL + " PUBLIC_LIVE=" + env.PUBLIC_LIVE);
  // the switch, as the tab was handed it: ADS=on exactly when the app's ADS is on, and no ADS name at all otherwise
  if (ADS_ON ? env.ADS !== "on" : "ADS" in env) throw new Error("the device env's ADS: " + JSON.stringify(env.ADS) + " on a " + (ADS_ON ? "switched-on" : "dormant") + " pair");
  const served = await getJson(BASE + "/ads/lots.json");
  if (served.status !== 200 || !served.json || JSON.stringify(served.json) !== JSON.stringify(LOTS)) throw new Error("/ads/lots.json: " + served.status + " " + served.text.slice(0, 120));
  const put = await getJson(BASE + "/ads/lots.json", { method: "PUT", body: "{}" });
  if (put.status >= 200 && put.status < 300) throw new Error("/ads/lots.json accepted a PUT: " + put.status);
  return "node " + env.FC_ROOT_HUB_URL + "; device ADS=" + (env.ADS ?? "(none)") + "; list version " + LOTS.version + " (" + LOTS.lots.length + " lots), PUT " + put.status;
});

await check("AD2 sign in with Farcaster as @stubalice and keep the identity with a passkey → /home as the root", async () => {
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
  if (per.some((p) => p.publicSelf !== true)) throw new Error("expected no persona: " + JSON.stringify(per.map((p) => p.handle)));
});

if (!ADS_ON) {
  await check("AD9 DORMANT: no ADS hint in the tab; ZERO ad rows in the real Following under Default (its dial Generic), the posts the ground truth; Settings says 'Ads aren't running on Totem yet.' and the dial still saves; saved Generic, still zero ad rows", async () => {
    const modes = (await api("GET", "/api/modes")).json;
    const defId = modes?.modes?.find((m) => m.name === "Default")?.id;
    const d0 = modes?.adDials?.[defId];
    if (!d0 || d0.dial !== "generic" || modes.adsRunning !== false) throw new Error("Default's dial / the switch as Settings reads them: " + JSON.stringify({ d0, adsRunning: modes?.adsRunning }));
    const noAdRows = async () => {
      await page.goto(BASE + "/home?tab=following", { waitUntil: "load", timeout: 120_000 });
      await waitForDevice(page, 120_000);
      await page.locator('[data-testid="hub-following"][data-state="ready"]').waitFor({ timeout: 120_000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="hub-timeline"]')?.getAttribute("data-ads-dormant") === "true", null, { timeout: 60_000 });
      await sleep(1500); // a late plan would have landed by now
      const t = page.locator('[data-testid="hub-timeline"]');
      const rows = await rowsNow();
      const truth = await hub.truth(50);
      if (rows.some((r) => r.startsWith("AD:")) || (await page.locator('[data-testid="ad-unit"]').count()) !== 0 || (await t.getAttribute("data-ads")) !== "0" || (await t.getAttribute("data-ads-state")) !== "off") throw new Error("an ad row on a dormant site: " + rows.filter((r) => r.startsWith("AD:")).join());
      if (rows.length !== 50 || rows.findIndex((h, i) => h !== truth[i]) !== -1) throw new Error("the dormant page is not the ground truth (" + rows.length + " rows)");
    };
    await noAdRows();
    // Settings, Modes: the dial still saves, with the plain line beside it
    await page.goto(BASE + "/settings/modes", { waitUntil: "load", timeout: 120_000 });
    await waitForDevice(page, 120_000);
    await testid("mode-edit-default").click();
    await testid("mode-editor").waitFor({ timeout: 60_000 });
    const line = (await testid("mode-ads-dormant").innerText()).trim();
    if (line !== "Ads aren't running on Totem yet.") throw new Error("the dormant line: " + JSON.stringify(line));
    await testid("mode-ad-dial-generic").click();
    await testid("mode-save").click();
    await page.getByTestId("mode-editor").waitFor({ state: "detached", timeout: 60_000 });
    const d1 = (await api("GET", "/api/modes")).json?.adDials?.[defId];
    if (!d1 || d1.dial !== "generic" || d1.isDefault !== false) throw new Error("the dial did not save while dormant: " + JSON.stringify(d1));
    await noAdRows();
    // the tab never asked for the list
    const asked = requests.filter((r) => r.url.includes("/ads/lots.json"));
    if (asked.length) throw new Error("the browser asked for the lot list: " + asked.length + " request(s)");
    return "Default at Generic (default) and saved Generic: 0 ad rows both times, 50 posts = the ground truth; the line said; the list served (AD1), never fetched by the tab";
  });
  await browser.close();
  const failedOff = results.filter((r) => r[0] === "FAIL").length;
  console.log("\n" + (results.length - failedOff) + "/" + results.length + " checks passed" + (failedOff ? " — FAILED" : ""));
  process.exit(failedOff ? 1 : 0);
}

let selfId = "";
let defaultModeId = "";
await check("AD3 GENERIC: Default starts at Generic (the root's default); set to 'Generic ads only' in Settings, the house ad sits at rows 5, 20, 35, 50, the posts between are the node's ground truth, each ad says 'House ad' in the lot file's words", async () => {
  flowStart.at = requests.length;
  const per = (await api("GET", "/api/personas")).json?.personas ?? [];
  selfId = per.find((p) => p.publicSelf === true)?.id ?? "";
  const modes = (await api("GET", "/api/modes")).json;
  defaultModeId = modes?.modes?.find((m) => m.name === "Default")?.id ?? "";
  const d0 = modes?.adDials?.[defaultModeId];
  if (!selfId || !defaultModeId || !d0 || d0.dial !== "generic" || d0.isDefault !== true) throw new Error("the default before any setting: " + JSON.stringify(d0));
  // the default already shows the house ad
  await following(4);
  const before = await rowsNow();
  if (adRows(before).join() !== "5,20,35,50") throw new Error("under the default the ads are at rows " + adRows(before).join());
  // set it explicitly, through the editor
  await setDial("default", "generic");
  const d1 = (await api("GET", "/api/modes")).json?.adDials?.[defaultModeId];
  if (!d1 || d1.dial !== "generic" || d1.isDefault !== false) throw new Error("after saving Generic: " + JSON.stringify(d1));
  await following(4);
  const rows = await rowsNow();
  if (adRows(rows).join() !== "5,20,35,50") throw new Error("the ads are at rows " + adRows(rows).join());
  if (rows.length !== 54 || rows[rows.length - 1].startsWith("AD:")) throw new Error(rows.length + " rows, last " + rows[rows.length - 1]);
  if (!rows.filter((r) => r.startsWith("AD:")).every((r) => r === "AD:house-following")) throw new Error("not the house lot: " + rows.filter((r) => r.startsWith("AD:")).join());
  const truth = await hub.truth(50);
  const postsShown = rows.filter((r) => !r.startsWith("AD:"));
  const d = postsShown.findIndex((h, i) => h !== truth[i]);
  if (postsShown.length !== 50 || d !== -1) throw new Error("the posts between the ads differ from the ground truth at " + d);
  const t = page.locator('[data-testid="hub-timeline"]');
  if ((await t.getAttribute("data-ads-dial")) !== "generic" || (await t.getAttribute("data-ads-state")) !== "ok" || (await t.getAttribute("data-count")) !== "50") throw new Error("the timeline's marks: " + (await t.getAttribute("data-ads-dial")) + " " + (await t.getAttribute("data-ads-state")) + " " + (await t.getAttribute("data-count")));
  const first = page.locator('[data-testid="ad-unit"]').first();
  const label = await first.locator('[data-testid="ad-label"]').innerText();
  const body = await first.locator('[data-testid="ad-body"]').innerText();
  const headline = await first.locator('[data-testid="ad-headline"]').innerText();
  const who = await first.locator('[data-testid="ad-advertiser"]').innerText();
  if (label !== "House ad" || (await first.getAttribute("data-house")) !== "true") throw new Error("the label: " + label);
  if (body !== HOUSE.creative.body || headline !== HOUSE.creative.headline || who !== HOUSE.advertiser.name) throw new Error("the ad's words differ from public/ads/lots.json: " + JSON.stringify({ body, headline, who }));
  // never a cast card: the ad is not counted as a post anywhere
  if ((await page.locator('[data-testid="hub-timeline"] [data-testid="ad-unit"][data-testid="cast"]').count()) !== 0) throw new Error("an ad is marked as a cast");
  return "default generic → 4 ads; saved Generic → rows 5,20,35,50 of 54; 50 posts = the ground truth; 'House ad' in the file's words";
});

let nodeReadsInTab = 0;
await check("AD4 WHY THIS AD reads right; the link is the lot's exact address and opens with no Referer", async () => {
  const r0 = await hub.reads();
  const first = page.locator('[data-testid="ad-unit"]').first();
  await first.locator('[data-testid="ad-why-toggle"]').click();
  const why = first.locator('[data-testid="ad-why"]');
  await why.waitFor({ timeout: 30_000 });
  const reason = await why.locator('[data-testid="ad-why-reason"]').innerText();
  const dial = await why.locator('[data-testid="ad-why-dial"]').innerText();
  const where = await why.locator('[data-testid="ad-why-where"]').innerText();
  const house = await why.locator('[data-testid="ad-why-house"]').innerText();
  const measure = await why.locator('[data-testid="ad-why-measure"]').innerText();
  if (reason !== "Shown to everyone who has ads on. Nothing about you or your mode picked it.") throw new Error("the reason: " + reason);
  if (!dial.startsWith("Ads in Default: Generic ads only.")) throw new Error("the dial line: " + dial);
  if (!where.includes("No request tells Totem which ad you saw.") || !house.includes("house ad") || !measure.includes("Nobody counts that you saw it")) throw new Error("the lines: " + JSON.stringify({ where, house, measure }));
  const link = first.locator('[data-testid="ad-link"]');
  const href = await link.getAttribute("href");
  const rel = (await link.getAttribute("rel")) || "";
  if (href !== HOUSE.creative.url || !rel.includes("noreferrer") || !rel.includes("noopener") || (await link.getAttribute("referrerpolicy")) !== "no-referrer") throw new Error("the link: " + JSON.stringify({ href, rel }));
  // tap it: a new tab asks for exactly that address with no Referer (Chromium resolves nothing but loopback, so it stops there)
  const q0 = requests.length;
  const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 30_000 }), link.click()]);
  for (let i = 0; i < 40 && !requests.slice(q0).some((r) => r.url.startsWith(HOUSE.creative.url)); i++) await sleep(100);
  const out = requests.slice(q0).filter((r) => r.url.startsWith(HOUSE.creative.url));
  await popup.close().catch(() => {});
  if (!out.length) throw new Error("the tap made no request for the advertiser's page");
  for (const r of out) {
    if (r.url !== HOUSE.creative.url) throw new Error("the address was changed: " + r.url);
    const ref = Object.keys(r.headers).find((h) => h.toLowerCase() === "referer");
    if (ref) throw new Error("a Referer went with the tap: " + r.headers[ref]);
  }
  nodeReadsInTab += (await hub.reads()) - r0;
  return "reason, dial, house, measurement lines exact; the tap asked for " + out[0].url + " with no Referer";
});

const sealedPut = (from) => requests.slice(from).filter((r) => r.method === "PUT" && r.url === VBASE + "/state/adHides");
function sealedOk(p) {
  const b = JSON.parse(p.body);
  const rec = b.entries && b.entries._;
  if (!rec || Object.keys(b.entries).length !== 1 || !/^[0-9a-f]+$/.test(rec.ct || "") || rec.ct.length !== 8192 || rec.ns !== "adHides") throw new Error("not one 4,096-byte sealed record: " + p.body.slice(0, 200));
  for (const needle of ["house", "lots", "advertisers", selfId, "ontotem"]) if (needle && p.body.includes(needle)) throw new Error("the sealed record carries '" + needle + "'");
}
await check("AD5 HIDE, SEALED: Hide this ad empties every slot at once, ONE 4,096-byte sealed record reaches the validator, Undo restores; hidden again it survives a reload; Settings lists it; Show them all again restores", async () => {
  const r0 = await hub.reads();
  const q0 = requests.length;
  const first = page.locator('[data-testid="ad-unit"]').first();
  await first.locator('[data-testid="ad-hide"]').click();
  await testid("ad-hidden-notice").waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="hub-timeline"]')?.getAttribute("data-ads") === "0", null, { timeout: 30_000 });
  if ((await page.locator('[data-testid="ad-unit"]').count()) !== 0) throw new Error("an ad is still on screen after hiding it");
  for (let i = 0; i < 40 && !sealedPut(q0).length; i++) await sleep(250);
  const puts1 = sealedPut(q0);
  if (puts1.length !== 1) throw new Error(puts1.length + " sealed write(s) for one hide");
  sealedOk(puts1[0]);
  // Undo, from the line the hide left
  await testid("ad-hidden-undo").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="hub-timeline"]')?.getAttribute("data-ads") === "4", null, { timeout: 30_000 });
  if (adRows(await rowsNow()).join() !== "5,20,35,50") throw new Error("after Undo the ads are at " + adRows(await rowsNow()).join());
  for (let i = 0; i < 40 && sealedPut(q0).length < 2; i++) await sleep(250);
  sealedPut(q0).forEach(sealedOk);
  nodeReadsInTab += (await hub.reads()) - r0;
  // hidden again (the advertiser this time, from the menu), then a reload: it stays hidden
  const r1 = await hub.reads();
  await page.locator('[data-testid="ad-unit"]').first().locator('[data-testid="ad-menu"]').click();
  await page.locator('[data-testid="ad-menu-hide-advertiser"]').first().click();
  await page.locator('[data-testid="ad-hidden-notice"][data-what="advertiser"]').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="hub-timeline"]')?.getAttribute("data-ads") === "0", null, { timeout: 30_000 });
  nodeReadsInTab += (await hub.reads()) - r1;
  await following(0);
  if ((await page.locator('[data-testid="ad-unit"]').count()) !== 0 || (await page.locator('[data-testid="hub-timeline"]').getAttribute("data-ads-state")) !== "off") throw new Error("the hidden advertiser came back after a reload");
  // Settings, Modes: listed, and shown again
  await page.goto(BASE + "/settings/modes", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="ads-hidden"][data-count="1"]').waitFor({ timeout: 60_000 });
  if (!(await testid("ads-hidden").innerText()).includes("Every ad from " + HOUSE.advertiser.name)) throw new Error("the list: " + (await testid("ads-hidden").innerText()));
  await testid("ads-show-all").click();
  await page.locator('[data-testid="ads-hidden"][data-count="0"]').waitFor({ timeout: 60_000 });
  await following(4);
  if (adRows(await rowsNow()).join() !== "5,20,35,50") throw new Error("after Show them all again: " + adRows(await rowsNow()).join());
  const all = sealedPut(q0);
  all.forEach(sealedOk);
  return "hide → 0 ads + 1 sealed write; Undo → 4; advertiser hidden survives a reload; listed and shown again; " + all.length + " sealed writes, all 4,096 bytes";
});

await check("AD6 NO ADS: set in Settings, Modes, Following carries no ad and its posts are the ground truth", async () => {
  await setDial("default", "none");
  const d = (await api("GET", "/api/modes")).json?.adDials?.[defaultModeId];
  if (!d || d.dial !== "none") throw new Error("after saving No ads: " + JSON.stringify(d));
  await following(0);
  const t = page.locator('[data-testid="hub-timeline"]');
  if ((await t.getAttribute("data-ads-state")) !== "off" || (await t.getAttribute("data-ads-dial")) !== "none") throw new Error("the marks: " + (await t.getAttribute("data-ads-state")) + " " + (await t.getAttribute("data-ads-dial")));
  const rows = await rowsNow();
  const truth = await hub.truth(50);
  if (rows.length !== 50 || rows.some((r) => r.startsWith("AD:")) || rows.findIndex((h, i) => h !== truth[i]) !== -1) throw new Error("under No ads the page is not the ground truth (" + rows.length + " rows)");
  return "0 ads; 50 posts = the ground truth";
});

await check("AD7 EVENT SAFE SPACE: on the pill, no ad (forced, whatever is stored), also in a copy whose rules are off so its 50 posts show; its editor offers no ad setting", async () => {
  await setDial("default", "generic");
  // a copy of Event Safe Space with its rules off: its posts show (the preset's author-tier rule hides every Farcaster
  // post), and it keeps allowAds false, so it must still carry no ad
  const ok = (r, what) => {
    if (r.status < 200 || r.status > 299) throw new Error(what + ": " + r.status + " " + r.text.slice(0, 200));
    return r.json;
  };
  const safe0 = ok(await api("GET", "/api/modes"), "the modes").modes.find((m) => m.name === "Event Safe Space");
  const copy = ok(await api("POST", "/api/modes", { duplicateOf: safe0.id, name: "Event Safe Space copy" }), "the copy").mode;
  ok(await api("PATCH", "/api/modes", { modeId: copy.id, patch: { ruleIds: [] } }), "the copy's rules off");
  if (copy.allowAds !== false) throw new Error("the copy lost allowAds false");
  await following(4);
  const r0 = await hub.reads();
  const pick = async (name, slug) => {
    await testid("mode-pill").click();
    await testid("mode-option-" + slug).click();
    await page.locator(`[data-testid="hub-mode"][data-mode-name="${name}"]`).waitFor({ timeout: 60_000 });
  };
  const noAdsForced = () =>
    page.waitForFunction(() => {
      const t = document.querySelector('[data-testid="hub-timeline"]');
      return t && t.getAttribute("data-ads-state") === "off" && t.getAttribute("data-ads-dial") === "none" && t.getAttribute("data-ads") === "0";
    }, null, { timeout: 60_000 });
  // the preset: it hides every Farcaster post (said), and the plan under it is forced off
  await pick("Event Safe Space", "event-safe-space");
  await noAdsForced();
  const hidAll = await page.getByTestId("hub-mode-hid-all").count();
  // the copy: 50 posts on screen, zero ads
  await pick("Event Safe Space copy", "event-safe-space-copy");
  await noAdsForced();
  const rows = await rowsNow();
  if (rows.length !== 50 || rows.some((r) => r.startsWith("AD:")) || (await page.locator('[data-testid="ad-unit"]').count()) !== 0) throw new Error("the copy: " + rows.length + " rows, " + rows.filter((r) => r.startsWith("AD:")).length + " ads");
  // back to Default on the pill: the ads come back without any read
  await pick("Default", "default");
  await page.waitForFunction(() => document.querySelector('[data-testid="hub-timeline"]')?.getAttribute("data-ads") === "4", null, { timeout: 60_000 });
  nodeReadsInTab += (await hub.reads()) - r0;
  const modes = (await api("GET", "/api/modes")).json;
  const safe = modes.modes.find((m) => m.name === "Event Safe Space");
  const refused = await api("PATCH", "/api/modes", { modeId: safe.id, patch: { adDial: "generic" } });
  if (refused.status !== 400 || refused.json?.code !== "ads_forced_off") throw new Error("setting Event Safe Space to Generic answered " + refused.status);
  await page.goto(BASE + "/settings/modes", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await testid("mode-edit-event-safe-space").click();
  await testid("mode-ad-dial-forced").waitFor({ timeout: 60_000 });
  if ((await page.getByTestId("mode-ad-dial").count()) !== 0) throw new Error("Event Safe Space's editor offers an ad setting");
  return "the preset: 0 ads, forced (it hid all " + (hidAll ? "posts, said" : "?") + "); its copy with rules off: 50 posts, 0 ads; back on Default 4 again; the route refused it 400; the editor says " + JSON.stringify(await testid("mode-ad-dial-forced").innerText());
});

await check("AD8 NOTHING LEAVES: no request names a lot, the ad's words, /api/ads or /ads/lots.json; validator writes are sealed state PUTs; no other host but the tapped link; zero node reads from the in-tab ad actions", async () => {
  const flow = requests.slice(flowStart.at);
  const needles = [...new Set([...LOTS.lots.map((l) => l.id), HOUSE.creative.headline, HOUSE.creative.body.slice(0, 40), "/api/ads", "/ads/lots.json", "adDial"])];
  const hits = [];
  for (const r of flow) {
    if (r.url.startsWith(HOUSE.creative.url)) continue; // the tap itself (AD4 checked it)
    const hay = r.url + "\n" + JSON.stringify(r.headers) + "\n" + r.body;
    for (const n of needles) if (hay.includes(n)) hits.push(n + " in " + r.method + " " + r.url.slice(0, 90));
  }
  if (hits.length) throw new Error(hits.length + " request(s) carry ad facts: " + hits.slice(0, 4).join(" | "));
  const val = flow.filter((r) => r.url.startsWith(VBASE));
  const writes = val.filter((r) => r.method !== "GET" && r.method !== "OPTIONS");
  const notSealed = writes.filter((r) => !(r.method === "PUT" && /^\/state\/[A-Za-z]+$/.test(new URL(r.url).pathname)) && !/\/(zk|device|health|fc)\//.test(new URL(r.url).pathname));
  if (notSealed.length) throw new Error("validator writes other than sealed state: " + notSealed.slice(0, 3).map((r) => r.method + " " + new URL(r.url).pathname).join(", "));
  for (const w of writes.filter((r) => r.method === "PUT" && r.url.startsWith(VBASE + "/state/"))) {
    if (w.body.includes(selfId) && selfId) throw new Error("a sealed write carries the acting identity in the clear: " + new URL(w.url).pathname);
  }
  const hosts = new Set(flow.map((r) => new URL(r.url).origin));
  const allowed = new Set([new URL(BASE).origin, new URL(VBASE).origin, new URL(HUB).origin, new URL(HOUSE.creative.url).origin]);
  const strange = [...hosts].filter((h) => !allowed.has(h) && !h.startsWith("data:") && !h.startsWith("blob:"));
  if (strange.length) throw new Error("requests reached other hosts: " + strange.join(", "));
  if (nodeReadsInTab !== 0) throw new Error(nodeReadsInTab + " node read(s) caused by the in-tab ad actions");
  const putNs = [...new Set(writes.filter((r) => r.method === "PUT").map((r) => new URL(r.url).pathname))];
  return flow.length + " requests in the flow, none naming an ad; validator writes: " + putNs.join(", ") + "; 0 node reads from Why this ad, hide, Undo and the pill";
});

await browser.close();
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log("\n" + (results.length - failed) + "/" + results.length + " checks passed" + (failed ? " — FAILED" : ""));
process.exit(failed ? 1 : 0);
