// NEYNAR AS A SWITCH (SECURITY-POSTURE.md §42) — the per-surface source switch, ON THE PRODUCTION SHAPE (Playwright,
// desktop), with the relay ARMED on the loopback Neynar stub and the tab's Farcaster node the loopback hub stub. Nothing
// real: Chromium resolves nothing but loopback, the key is the stub's fake one, and no request can leave the machine.
// Run it TWICE (each run through the machine-wide harness lock):
//   EVERY SWITCH SET TO NEYNAR (search included):
//     bash /c/Users/jorda/.totem-harness/with-lock.sh env PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_FC_READ=stub \
//       PRODLIVE_FC_SOURCES=following=neynar,notifications=neynar,foryou=neynar,search=neynar,counts=neynar,channels=neynar \
//       bash scripts/run-prod-shape.sh scripts/accept-fc-source-prod.mjs
//   THE DEFAULT (every switch unset: network), the same armed relay:
//     bash /c/Users/jorda/.totem-harness/with-lock.sh env PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_FC_READ=stub \
//       bash scripts/run-prod-shape.sh scripts/accept-fc-source-prod.mjs
//
//   FS1 THE SHAPE AND THE HINTS: public, live, the relay armed on the stub, the tab's node the hub stub; the tab is handed
//       exactly FC_SOURCE_FORYOU and FC_SOURCE_SEARCH (all) or no source hint at all (default) — never one for Following,
//       notifications, counts or channels; the app's boot log says each surface's source, and (all) REFUSES Following,
//       notifications and counts with the sentence
//   FS2 SETTINGS › DEVELOPER shows each surface's source and why, read-only: (all) Following and notifications network,
//       refused ("would hand your account to Totem's server"), For You and search Via Neynar, counts unavailable, channels
//       off; (default) network everywhere, counts unavailable, channels off; no control on the panel
//   FS3 sign in with Farcaster as @stubalice and keep the identity with a passkey (the hub stub carries a 2-hop graph)
//   FS4 FOLLOWING STAYS ON THE NODE, whatever the switch says: the real Following fills from the hub stub (node reads
//       counted: the positive control), its source says "From Farcaster's network", and the Neynar stub and the relay route
//       saw NOTHING during it
//   FS5 NOTIFICATIONS STAY ON THE NODE the same way
//   FS6 SEARCH: (all) the device's results first ("From your device"), then "On Farcaster · Via Neynar" with the stub's one
//       probe cast and one probe person, each result marked Via Neynar; the relay was sent {op, arg} and nothing else, the
//       stub received q and limit only, and no request anywhere carried the root's fid or fname; (default) the page says
//       search isn't switched to Neynar and the stub saw nothing
//   FS7 THE OWN-ACCOUNT GUARD (all): a search for the root's fname, @fname, its fid, or the new persona's handle is NEVER
//       sent (the page says why), while the probe search still is (the control)
//   FS8 FOR YOU FOR A PERSONA: (all) the relay's list, the chip "Via Neynar" live; (default) an armed key alone puts nothing
//       from Neynar there: the line says For You via Neynar is switched off, and the stub saw no discovery read
//   FS9 THE RETIRED OWN-ACCOUNT READ: live=1 on the root's profile answers 409 names_you; the stub never saw the fname
//   FS10 OVER THE WHOLE RUN: (default) ZERO upstream requests reached the Neynar stub and the page made zero relay reads;
//       (all) the stub recorded no violation, every request was discovery, a search or a lookup, and none named the root
// ABORTS (exit 2): /api/dev must answer 403, EXPECT_PUBLIC_LIVE "true", EXPECT_HUB "stub", EXPECT_FC_READ "armed" with a
// stub at NEYNAR_STUB_URL, and EXPECT_FC_SOURCES either empty or every surface neynar.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { STUB_ACCOUNTS, signForChannel } from "./lib/siwf-stub.mjs";
import { STUB_SEARCH } from "./lib/neynar-stub.mjs";
import { waitForDevice } from "./lib/page-health.mjs";

const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
const SIWF = (process.env.SIWF_STUB_URL || "").replace(/\/$/, "");
const HUBC = (process.env.HUB_STUB_URL || "").replace(/\/$/, "");
const HUB = (process.env.HUB_URL || "").replace(/\/$/, "");
const NEYNAR = (process.env.NEYNAR_STUB_URL || "").replace(/\/$/, "");
const DESKTOP = { width: 1366, height: 900 };
const FID = STUB_ACCOUNTS.alice.fid;
const FNAME = STUB_ACCOUNTS.alice.username;
const ALL = "following=neynar,notifications=neynar,foryou=neynar,search=neynar,counts=neynar,channels=neynar";
const SOURCES = (process.env.EXPECT_FC_SOURCES ?? "").trim();
const MODE = SOURCES === "" ? "default" : SOURCES === ALL ? "all" : null;
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
if (process.env.EXPECT_PUBLIC_LIVE !== "true" || process.env.EXPECT_HUB !== "stub" || process.env.EXPECT_FC_READ !== "armed" || !NEYNAR || !MODE) {
  console.log(
    "  ABORT: start the pair with PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_FC_READ=stub and either no PRODLIVE_FC_SOURCES or PRODLIVE_FC_SOURCES=" +
      ALL +
      " (EXPECT_FC_SOURCES=" +
      JSON.stringify(SOURCES) +
      ", EXPECT_HUB=" +
      (process.env.EXPECT_HUB || "unset") +
      ", EXPECT_FC_READ=" +
      (process.env.EXPECT_FC_READ || "unset") +
      ")"
  );
  process.exit(2);
}
const neynar = async () => (await getJson(NEYNAR + "/__stub/state")).json;
const n0 = await neynar().catch(() => null);
const reads0 = HUBC ? await getJson(HUBC + "/__stub/hub/reads").catch(() => ({ json: null })) : { json: null };
const siwfState = SIWF ? (await getJson(SIWF + "/__stub/state").catch(() => ({ json: null }))).json : null;
if (!n0 || typeof n0.hits?.total !== "number" || !reads0.json || !Array.isArray(reads0.json.reads) || !HUB || !siwfState || siwfState.ok !== true) {
  console.log("  ABORT: the Neynar stub (" + NEYNAR + "), the hub stub (" + (HUBC || "unset") + ") or the SIWF stub does not answer");
  process.exit(2);
}
const START_HITS = n0.hits.total;
const START_REQS = n0.requests.length;
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
// the graph: @stubalice follows 30 accounts (8 of them active), and one fan follows her (a notification)
await hub.steer({ clear: true });
const g = (await hub.plant({ twoHop: { root: FID, base: 6_000_000, follows: 30, active: 8, outerBase: 6_500_000, outer: 10, rootProfile: { username: FNAME, display: "Stub Alice" } } })).json;
if (!g || !Array.isArray(g.follows)) {
  console.log("  ABORT: the hub stub did not plant the 2-hop graph (an old stub?)");
  process.exit(2);
}
await hub.plant({ profile: { fid: 6_900_001, username: "fsfan", display: "FS Fan" } });
await hub.plant({ follow: { fid: 6_900_001, target: FID, ts: Date.now() - 60_000 } });

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
  requests.push({ url: r.url(), method: r.method(), body, at: Date.now() });
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
/** the relay reads the PAGE made since `t` (the device's unpatched fetch of POST /api/fc/read), with their bodies */
const relayReads = (t) => requests.filter((x) => x.at >= t && x.method === "POST" && /\/api\/fc\/read$/.test(new URL(x.url).pathname));
const stubSince = async (n) => (await neynar()).requests.slice(n);
const goHome = async (q = "") => {
  await page.goto(BASE + "/home" + q, { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
};

console.log(`\nFC SOURCE PROD — the per-surface source switch (${MODE === "all" ? "EVERY switch set to neynar" : "the DEFAULT: every switch unset"}; app ${BASE}, node ${HUB}, Neynar stub ${NEYNAR})`);

await check("FS1 the shape and the hints: the relay armed on the stub, the node the hub stub, exactly the For You / search hints (or none), never one for Following, notifications, counts or channels; the boot log says each source" + (MODE === "all" ? " and refuses the hard-rule ones" : ""), async () => {
  await page.goto(BASE + "/welcome", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  const env = await page.evaluate(() => window.__LAYERS_DEVICE_ENV || {});
  if (env.FC_READ_RELAY !== "on" || env.FC_ROOT_HUB_URL !== HUB || env.PUBLIC_LIVE !== "on") throw new Error("the device env: " + JSON.stringify({ FC_READ_RELAY: env.FC_READ_RELAY, FC_ROOT_HUB_URL: env.FC_ROOT_HUB_URL, PUBLIC_LIVE: env.PUBLIC_LIVE }));
  const hints = Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("FC_SOURCE_")));
  const want = MODE === "all" ? { FC_SOURCE_FORYOU: "neynar", FC_SOURCE_SEARCH: "neynar" } : {};
  if (JSON.stringify(hints) !== JSON.stringify(want)) throw new Error("the tab's source hints: " + JSON.stringify(hints) + " (expected " + JSON.stringify(want) + ")");
  const log = path.join(process.env.TEMP || "/tmp", "layers-app.log");
  if (!existsSync(log)) throw new Error("the app log is not at " + log);
  const text = readFileSync(log, "utf8");
  const summary = MODE === "all" ? "FC SOURCES: following=network notifications=network forYou=neynar search=neynar counts=unavailable channels=off (Neynar read relay armed" : "FC SOURCES: following=network notifications=network forYou=network search=network counts=unavailable channels=off (Neynar read relay armed";
  if (!text.includes(summary)) throw new Error("the boot log has no line " + JSON.stringify(summary));
  const refused = ["FC_SOURCE_FOLLOWING=neynar is refused. Following stays on Farcaster's network: read through Neynar, it would hand your account to Totem's server.", "FC_SOURCE_NOTIFICATIONS=neynar is refused. Notifications stay on Farcaster's network: read through Neynar, they would hand your account to Totem's server.", "FC_SOURCE_COUNTS=neynar is refused."];
  for (const r of refused) {
    if (MODE === "all" && !text.includes("[boot] FC SOURCE REFUSED → " + r)) throw new Error("the boot log does not refuse: " + r.slice(0, 60));
    if (MODE === "default" && text.includes("FC SOURCE REFUSED")) throw new Error("the default boot refuses something");
  }
  return "hints " + JSON.stringify(hints) + "; boot: " + summary.slice(0, 70) + "…" + (MODE === "all" ? "; 3 refusals with the sentence" : "");
});

await check("FS2 Settings › Developer shows each surface's source and why, read-only", async () => {
  await page.goto(BASE + "/settings/developer", { waitUntil: "load", timeout: 120_000 });
  await testid("fc-sources").waitFor({ timeout: 60_000 });
  const rows = await page.$$eval('[data-testid="fc-source-row"]', (els) => els.map((e) => ({ s: e.getAttribute("data-surface"), eff: e.getAttribute("data-effective"), reason: e.getAttribute("data-reason"), why: e.querySelector('[data-testid="fc-source-why"]')?.textContent ?? "" })));
  const by = Object.fromEntries(rows.map((r) => [r.s, r]));
  const want = MODE === "all"
    ? { following: ["network", "refused"], notifications: ["network", "refused"], forYou: ["neynar", "neynar"], search: ["neynar", "neynar"], counts: ["unavailable", "refused"], channels: ["off", "not_built"] }
    : { following: ["network", "default"], notifications: ["network", "default"], forYou: ["network", "default"], search: ["network", "default"], counts: ["unavailable", "default"], channels: ["off", "not_built"] };
  const problems = [];
  for (const [s, [eff, reason]] of Object.entries(want)) if (!by[s] || by[s].eff !== eff || by[s].reason !== reason) problems.push(`${s}: ${JSON.stringify(by[s] ?? null).slice(0, 120)} (want ${eff}/${reason})`);
  if (MODE === "all" && !/would hand your account to Totem's server/.test(by.following?.why ?? "")) problems.push("Following's row does not say why");
  if ((await testid("fc-sources").getAttribute("data-relay")) !== "armed") problems.push("the panel does not say the relay is armed");
  if (await page.locator('[data-testid="fc-sources"] button, [data-testid="fc-sources"] input, [data-testid="fc-sources"] select').count()) problems.push("the panel has a control");
  if (problems.length) throw new Error(problems.join(" | "));
  return rows.map((r) => `${r.s}=${r.eff}`).join(" ");
});

await check("FS3 sign in with Farcaster as @stubalice and keep the identity with a passkey → /home as the root", async () => {
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

async function onTheNode(label, open, ready, sourceSel) {
  const t = Date.now();
  const nBefore = (await neynar()).hits.total;
  const hBefore = (await hub.reads()).reads.length;
  await open();
  await page.locator(ready).waitFor({ timeout: 120_000 });
  await sleep(1500);
  const src = await page.locator(sourceSel).first().getAttribute("data-source");
  const text = await page.locator(sourceSel).first().innerText();
  const hAfter = (await hub.reads()).reads.length;
  const nAfter = (await neynar()).hits.total;
  const relay = relayReads(t);
  const problems = [];
  if (src !== "network" || !/^From Farcaster's network/.test(text.trim())) problems.push(`the source says ${src}: ${text.slice(0, 60)}`);
  if (hAfter <= hBefore) problems.push("the node saw no read (the positive control)");
  if (nAfter !== nBefore) problems.push(nAfter - nBefore + " upstream request(s) reached the Neynar stub");
  if (relay.length) problems.push(relay.length + " relay read(s) from the page: " + relay.map((x) => x.body).join(" "));
  if (problems.length) throw new Error(label + ": " + problems.join(" | "));
  return `${hAfter - hBefore} node read(s), 0 Neynar requests, 0 relay reads; "${text.trim().slice(0, 50)}…"`;
}

await check("FS4 FOLLOWING STAYS ON THE NODE" + (MODE === "all" ? " with FC_SOURCE_FOLLOWING=neynar" : "") + ": filled from the hub, \"From Farcaster's network\", nothing to the Neynar stub or the relay", async () =>
  onTheNode("Following", () => goHome("?tab=following"), '[data-testid="hub-following"][data-state="ready"]', '[data-testid="hub-following-status"] [data-testid="feed-source"]')
);

await check("FS5 NOTIFICATIONS STAY ON THE NODE" + (MODE === "all" ? " with FC_SOURCE_NOTIFICATIONS=neynar" : "") + ": the same", async () =>
  onTheNode(
    "Notifications",
    async () => {
      await page.goto(BASE + "/notifications", { waitUntil: "load", timeout: 120_000 });
      await waitForDevice(page, 120_000);
    },
    '[data-testid="hub-notifs"][data-state="ready"]',
    '[data-testid="hub-notifs-coverage"]'
  )
);

const searchFor = async (q) => {
  const t = Date.now();
  const n = (await neynar()).requests.length;
  await page.goto(BASE + "/search?q=" + encodeURIComponent(q), { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  await page.locator('[data-testid="network-search"], [data-testid="network-search-error"]').first().waitFor({ timeout: 90_000 });
  await page.locator('[data-testid="search-source"], [data-testid="search-error"]').first().waitFor({ timeout: 90_000 });
  await sleep(800);
  if (await page.getByTestId("network-search-error").count()) throw new Error(`the search for "${q}" answered an error: ` + (await testid("network-search-error").innerText()));
  return { t, n };
};

await check("FS6 SEARCH" + (MODE === "all" ? ": the device first, then \"On Farcaster · Via Neynar\" with the stub's probe cast and person; the relay sent {op, arg} only, the stub q and limit only, and nothing named the root" : ": the page says search isn't switched to Neynar, and the stub saw nothing"), async () => {
  const { t, n } = await searchFor(STUB_SEARCH.term);
  const sec = testid("network-search");
  const source = await sec.getAttribute("data-source");
  const problems = [];
  const dev = await page.locator('[data-testid="search-source"][data-source="device"]').count();
  if (!dev) problems.push("the device's results carry no \"From your device\" source");
  const newReqs = await stubSince(n);
  if (MODE === "default") {
    if (source !== "network" || !/isn't switched to Neynar/.test(await sec.innerText())) problems.push("the section says " + source + ": " + (await sec.innerText()).slice(0, 80));
    if (newReqs.length) problems.push(newReqs.length + " request(s) reached the Neynar stub");
    if (relayReads(t).length) problems.push(relayReads(t).length + " relay read(s)");
    if (problems.length) throw new Error(problems.join(" | "));
    return "search isn't switched to Neynar (said); 0 stub requests, 0 relay reads";
  }
  if (source !== "neynar") problems.push("the section says " + source + ": " + (await sec.innerText()).slice(0, 100));
  // the device's results come FIRST on the page
  const order = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="search-source"]');
    const b = document.querySelector('[data-testid="network-search"]');
    return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  if (!order) problems.push("the Neynar section is not after the device's results");
  if ((await testid("network-search-label").innerText()).trim() !== "Via Neynar") problems.push("the section label is not Via Neynar");
  const posts = await page.$$eval('[data-testid="network-search-post"]', (els) => els.map((e) => ({ hash: e.getAttribute("data-hash"), via: e.getAttribute("data-via") })));
  const people = await page.$$eval('[data-testid="network-search-person"]', (els) => els.map((e) => ({ fid: Number(e.getAttribute("data-fid")), via: e.getAttribute("data-via"), text: e.textContent })));
  if (posts.length !== 1 || posts[0].hash !== STUB_SEARCH.hash || posts[0].via !== "neynar") problems.push("the posts: " + JSON.stringify(posts));
  if (people.length !== 1 || people[0].fid !== STUB_SEARCH.user.fid || people[0].via !== "neynar" || !/Via Neynar/.test(people[0].text)) problems.push("the people: " + JSON.stringify(people));
  // what the relay was sent: {op, arg} and the query, nothing else
  const bodies = relayReads(t).map((x) => {
    try {
      return JSON.parse(x.body);
    } catch {
      return { unreadable: x.body };
    }
  });
  const searches = bodies.filter((b) => /^search-/.test(b.op ?? ""));
  if (searches.length !== 2 || searches.some((b) => JSON.stringify(Object.keys(b).sort()) !== '["arg","op"]' || b.arg !== STUB_SEARCH.term)) problems.push("the relay bodies: " + JSON.stringify(bodies));
  // what the stub received: /cast/search and /user/search, q and limit only, q the probe term
  const ups = newReqs.filter((r) => r.route === "/cast/search" || r.route === "/user/search");
  if (ups.length !== 2) problems.push(ups.length + " search request(s) at the stub: " + newReqs.map((r) => r.route).join(","));
  for (const r of ups) {
    if (JSON.stringify(Object.keys(r.params).sort()) !== '["limit","q"]' || r.params.q !== STUB_SEARCH.term) problems.push(r.route + " carried " + r.query);
    if (r.violations.length) problems.push(r.route + " violations: " + r.violations.join(","));
  }
  // nothing that reached the relay or the stub named the root (her fid, her fname)
  for (const r of newReqs) if (new RegExp("(^|[^0-9])" + FID + "([^0-9]|$)").test(r.query) || r.query.toLowerCase().includes(FNAME)) problems.push("the stub saw the root in " + r.route + "?" + r.query);
  for (const b of bodies) if (JSON.stringify(b).includes(String(FID)) || JSON.stringify(b).toLowerCase().includes(FNAME)) problems.push("a relay body names the root: " + JSON.stringify(b));
  if (problems.length) throw new Error(problems.join(" | "));
  return `device first; 1 post + 1 person Via Neynar; relay sent ${searches.length} × {op, arg}; the stub got ${ups.map((r) => r.route + "?" + r.query).join(" and ")}; the root named nowhere`;
});

let personaHandle = null;
await check("FS7 THE OWN-ACCOUNT GUARD" + (MODE === "all" ? ": a search for her fname, @fname, her fid or her persona's handle is never sent (said); the probe still is" : " (default: nothing is ever sent; one own-name search, nothing at the stub)"), async () => {
  // a persona of her own first (its handle is one of her accounts too)
  await page.goto(BASE + "/home#make-persona", { waitUntil: "load", timeout: 120_000 });
  await testid("make-persona").waitFor({ timeout: 60_000 });
  await testid("make-persona-name").fill("Source Wren");
  await testid("make-persona-create").click();
  await testid("make-persona").waitFor({ state: "detached", timeout: 60_000 });
  const per = (await api("GET", "/api/personas")).json?.personas ?? [];
  personaHandle = per.find((p) => p.publicSelf !== true && /wren/i.test(p.name ?? ""))?.handle ?? null;
  if (!personaHandle) throw new Error("the persona was not made: " + JSON.stringify(per.map((p) => p.handle)));
  const queries = MODE === "all" ? [FNAME, "@" + FNAME, "posts by " + FNAME, String(FID), personaHandle] : [FNAME];
  const problems = [];
  for (const q of queries) {
    const { n } = await searchFor(q);
    const source = await testid("network-search").getAttribute("data-source");
    const want = MODE === "all" ? "names_you" : "network";
    if (source !== want) problems.push(`"${q}" → ${source}`);
    const seen = (await stubSince(n)).filter((r) => /search/.test(r.route));
    if (seen.length) problems.push(`"${q}" reached the stub: ${seen.map((r) => r.query).join(" ")}`);
  }
  if (MODE === "all") {
    const { n } = await searchFor(STUB_SEARCH.term + " again");
    const seen = (await stubSince(n)).filter((r) => /search/.test(r.route));
    if ((await testid("network-search").getAttribute("data-source")) !== "neynar" || seen.length !== 2) problems.push("the control search was not sent (" + seen.length + " at the stub)");
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return MODE === "all" ? `${queries.length} own-account queries kept on the device (said), the control sent` : "nothing sent";
});

await check("FS8 FOR YOU FOR A PERSONA" + (MODE === "all" ? ": the relay's list, the chip Via Neynar, live" : ": an armed key alone puts nothing from Neynar there; the line says so, and the stub saw no discovery read"), async () => {
  const n = (await neynar()).requests.length;
  const t = Date.now();
  await goHome();
  if (MODE === "all") {
    await page.locator('[data-testid="live-source"][data-state="live"]').waitFor({ timeout: 90_000 });
    const chip = testid("live-source");
    const text = (await chip.innerText()).trim();
    if ((await chip.getAttribute("data-via")) !== "neynar" || !/Via Neynar/.test(text)) throw new Error("the chip: " + text);
    const disc = (await stubSince(n)).filter((r) => r.route === "/feed");
    const bodies = relayReads(t).map((x) => x.body);
    if (!bodies.some((b) => b === '{"op":"discovery"}') && !disc.length) throw new Error("no discovery read, from the page or at the stub (the chip would be vacuous)");
    return `"${text}"; ${bodies.filter((b) => b === '{"op":"discovery"}').length} discovery relay read(s)`;
  }
  await page.locator('[data-testid="live-reads-line"]').waitFor({ timeout: 90_000 });
  const st = await testid("live-reads-line").getAttribute("data-state");
  const text = (await testid("live-reads-line").innerText()).trim();
  if (st !== "network" || !/For You via Neynar is switched off/.test(text)) throw new Error("the line: " + st + " " + text);
  if (await page.getByTestId("live-source").count()) throw new Error("a Via Neynar chip on a feed that read nothing from Neynar");
  const disc = (await stubSince(n)).filter((r) => r.route === "/feed");
  if (disc.length || relayReads(t).length) throw new Error(disc.length + " discovery read(s) at the stub, " + relayReads(t).length + " relay read(s) from the page");
  return `"${text}"; 0 discovery reads`;
});

await check("FS9 THE RETIRED OWN-ACCOUNT READ: live=1 on her own profile answers 409 names_you, and the stub never saw her fname", async () => {
  const n = (await neynar()).requests.length;
  const per = (await api("GET", "/api/personas")).json?.personas ?? [];
  const self = per.find((p) => p.publicSelf === true)?.handle;
  if (!self) throw new Error("no public self in the roster: " + JSON.stringify(per.map((p) => p.handle)));
  const r = await api("GET", "/api/profile?handle=" + encodeURIComponent(self) + "&live=1");
  if (r.status !== 409 || r.json?.code !== "names_you") throw new Error("live=1 on @" + self + " answered " + r.status + " " + r.text.slice(0, 160));
  await sleep(1000);
  const seen = (await stubSince(n)).filter((x) => x.query.toLowerCase().includes(FNAME));
  if (seen.length) throw new Error(seen.length + " stub request(s) named her fname");
  return "409 names_you; 0 lookups";
});

await check("FS10 OVER THE WHOLE RUN: " + (MODE === "default" ? "ZERO upstream requests reached the Neynar stub and the page made zero relay reads" : "no stub violation; every request discovery, a search or a lookup; none named the root"), async () => {
  const st = await neynar();
  const mine = st.requests.slice(START_REQS);
  if (MODE === "default") {
    const relay = relayReads(0);
    if (st.hits.total !== START_HITS || mine.length) throw new Error(st.hits.total - START_HITS + " upstream request(s): " + mine.map((r) => r.route).join(","));
    if (relay.length) throw new Error(relay.length + " relay read(s) from the page: " + relay.map((x) => x.body).slice(0, 4).join(" "));
    return "0 upstream requests, 0 relay reads, across Following, notifications, For You, search and the profile";
  }
  const problems = [];
  if (st.violations.length) problems.push(st.violations.length + " violation(s): " + st.violations.slice(0, 4).map((v) => v.kind + " " + v.route).join("; "));
  const allowed = new Set(["/feed", "/cast/search", "/user/search", "/cast/conversation", "/user/by_username", "/feed/user/casts"]);
  for (const r of mine) {
    if (!allowed.has(r.route)) problems.push("a request to " + r.route);
    if (new RegExp("(^|[^0-9])" + FID + "([^0-9]|$)").test(r.query) || r.query.toLowerCase().includes(FNAME) || (personaHandle && r.query.toLowerCase().includes(personaHandle.toLowerCase()))) problems.push("the root or her persona named in " + r.route + "?" + r.query);
  }
  if (!mine.length) problems.push("no request at all (the scan would be blind)");
  if (problems.length) throw new Error(problems.slice(0, 6).join(" | "));
  const routes = [...new Set(mine.map((r) => r.route))];
  return `${mine.length} request(s) (${routes.join(", ")}), 0 violations, none naming her or her persona`;
});

await browser.close();
const failedN = results.filter((r) => r[0] === "FAIL").length;
console.log("\n" + (results.length - failedN) + "/" + results.length + " checks passed" + (failedN ? " — FAILED" : ""));
process.exit(failedN ? 1 : 0);
