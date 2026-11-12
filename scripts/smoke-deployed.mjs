// PUBLIC PREVIEW Gate 6 (run as BROWSER KEYSTORE PASS Gate 6) — the post-deploy check, against DEPLOYED urls.
//   BASE_URL=https://<app> VALIDATOR_URL=https://<validator> [NEXT_PUBLIC_DOCS_URL=<override>] [EXPECT_FC_READ=no_key|armed|off] [EXPECT_ANON_RELAY=unarmed|armed] [EXPECT_PUBLIC_LIVE=true] [EXPECT_MINIAPP_SIGNED=true] node scripts/smoke-deployed.mjs
// Runs unchanged against a local pair (BASE_URL=http://localhost:3001 VALIDATOR_URL=http://127.0.0.1:4001).
//   1. the landing page renders cold (no device, no state) with the app door AND the docs door — DOCS UNDER APP
//      (D-DOCS-UNDER-APP): always, to /docs on this app, or to NEXT_PUBLIC_DOCS_URL when the deployment overrides it
//      (pass the same value here; leave it unset for the default)
//   2. the app loads cold in an empty browser profile: the device boots, the preview banner names a computed state
//  2a. FC-READ — THE READ RELAY IS IN THE STATE THE OPERATOR EXPECTS. POST /api/fc/read {op:"status"} must report
//      reason === EXPECT_FC_READ (default "no_key": the deployment holds no read key; "armed" once the owner has set
//      NEYNAR_READ_API_KEY on the app service; "off" under the kill switch). A smoke that passed with the relay
//      silently unarmed would prove nothing about live reads, so the expectation is explicit. The status answer
//      carries no number and no key, and only armed / reason / state (RELAY.statusKeys). FC-READ (no channels): it no
//      longer lists channels — the owner's v1 decision is that channels are not an emphasis, so there is no channel
//      allowlist to publish, and a `channels` field fails 2a as a build from before that change (nor does the status
//      publish the discovery author list, FC_READ_FIDS). When armed: /home shows a live card (data-live, a 0x + 40-hex
//      hash) and liking it is refused 403 NETWORK_READ_ONLY with the preview's sentence; when not armed: /home shows
//      no live card at all
//      (deploying without the key changes nothing visible). Runs in profile A's page before 2b leaves /home.
//      Note: 2b's needle scan excludes cast cards (scripts/lib/page-health.mjs NEEDLE_SCAN_EXCLUDE), because real
//      Farcaster casts can say "404".
//  2b. CONTENT (PROD-LIVE, D-CU-0-4): what the pages SHOW — /home has timeline cards and no inline load error, and
//      /settings, reached by CLICKING nav-settings (a soft navigation: the unsaved identity is kept), renders its
//      sections. Checks 2–8 used to drive only the device's API layer, so this suite passed 8/8 while every page of
//      the preview printed "Couldn't load … refusing to mint a device key" inside an HTTP 200. Profile A only: no
//      extra fresh profile, no extra root (the per-address daily cap on new roots is the owner's too).
//   3. a persona can be created (a fork, in the device)
//   4. a post round-trips (cast, then read back from the feed)
//   5. the docs door leads to the docs: the door's href resolved against BASE_URL (so the relative /docs is this
//      app's own). On the app: the HTTP contract of scripts/lib/docs-probe.mjs, light (/docs -> /docs/, pages 200 with
//      one policy whose hashes match, internal 404, traversal refused, assets immutable) and a real browser load of
//      /docs/ with no console error and no policy violation. An override elsewhere: it answers below 400.
//   6. both health endpoints answer the SIGNED Totem health payload (scripts/lib/health-probe.mjs)
//   7. dev routes are refused on both processes; an unsigned reputation event is refused
//   8. two independent browser profiles get two independent roots (the multi-tenancy answer, in production)
//   9. PERSONA LAUNCH P1 (SIWF) — SIGN IN WITH FARCASTER RUNS IN THE BROWSER: a POST /api/fc/siwf to the deployed SERVER
//      answers 404 device_only (the server never verifies a sign-in, and never reads the body); in profile A's booted
//      device GET /api/fc/siwf reports available, with the relay and RPC hosts the deployment should use
//      (EXPECT_SIWF_RELAY_HOST, default relay.farcaster.xyz; EXPECT_SIWF_RPC_HOST, default mainnet.optimism.io), and the
//      status read itself makes NO request to either (it is a pure read in the tab). The real sign-in is the owner's
//      manual run on the deployed site (notes/runbooks/OWNER-CHECKLIST.md); this check asserts the shape only.
//  10. PERSONA LAUNCH wave 3 (P7, A-WEB-PROXY-HOP-HEADERS) — THE EDGE LETS THE BROWSER CHANNEL THROUGH: GET
//      <VALIDATOR_URL>/zk/anon/web/head?mode=fixture&tree=tier-2 from this process (no browser-only header, so a refusal
//      can only come from a header the hosting edge added) must NOT answer {"error":"refused"} — a hop header outside
//      the web route's list (validator/anon.js) refuses EVERY browser submission, fail closed. Not vacuous: the same
//      request WITH a cookie must be refused, so the probe can see the route's refusal when there is one.
//      PERSONA LAUNCH GO-LIVE (A-WEB-PROXY-HOP-HEADERS, D-PUBLIC-ANON-TREE) — extended: the deployment's anonymous tree is
//      EXPECT_ANON_TREE (default "valid", the public default; scripts/run-prod-shape.sh passes the pair's) on BOTH sides —
//      the validator's public /zk/anon-post/config and the app's device env in profile A's page (a mismatch refuses every
//      stranger's proof); the head read is for that tree; and the POST door is probed through the edge too: a 5-byte body
//      to /zk/anon/web must answer "malformed" (the size door sits AFTER the header door, so "malformed" proves the edge's
//      headers passed it — the constant-shape answer says nothing else) and the same POST with a cookie "refused". Nothing
//      is consumed (a malformed body never reaches the proof of work). The first deploy re-checks
//      validator/test/fixtures/railway-hop-headers.json (documented, not recorded) against the real edge here.
//  11. PERSONA LAUNCH wave 3 (P7) — THE GPL-3.0 NOTICE SHIPS WITH THE PROVER: /device/prover.js.LICENSE.txt answers 200
//      with the GNU GENERAL PUBLIC LICENSE text, and /device/prover.js's banner names that file.
//      PERSONA LAUNCH GO-LIVE (A-GPL-SOURCE-OFFER) — extended to the SOURCE OFFER: /device/source/ answers 200 (the notice
//      page, no inline script or style); /device/source/manifest.json lists EXACTLY the five Totem files prover.js is
//      built from, each with its sha256, plus the build files, snarkjs and ffjavascript with their versions and tagged
//      upstream links, and a commit (equal to the app's /api/health commit when both are hashes); every served file answers
//      200 and hashes to its entry (scripts/lib/gpl-source.mjs deployedOfferProblems); GPL-3.0.txt is the license;
//      prover.js's banner names /device/source/ and the manifest's versions; PUBLIC GO-LIVE: /help links it
//      (help-gpl-source, "Source code of the browser prover (GPL-3.0)"). Not vacuous: the same check over a DOCTORED
//      manifest (one sha256 changed, in-process) must report the mismatch, or check 11 fails.
//  12. PERSONA LAUNCH GO-LIVE (kept while the live-registrar track is PARKED, SECURITY-POSTURE §29): the public
//      validator's registrar is SIMULATED — /registrar/config says simulated:true and never live, and asking for mode=live
//      does not turn it live (REGISTRAR_LIVE is refused at boot on a public process).
//  13. PERSONA LAUNCH GO-LIVE (kept while the live-X track is PARKED, SECURITY-POSTURE §30): the public validator's X
//      outbox is OFF — /x/outbox/config?mode=fixture says live:false, and mode=live is refused or says live:false
//      (X_LIVE and the X_LAYERS_* credentials are refused at boot on a public process).
//  14. PUBLIC GO-LIVE (relay): THE PUBLIC @anon RELAY is in the state the operator expects (EXPECT_ANON_RELAY = unarmed,
//      the default, or armed): liveRelay, the agent path, the fid gate for this host, the filter, the moderators, /terms
//      and (armed) the proving files. Status only, nothing posted; a doctored answer (liveRelay flipped) must be caught.
//  15. PUBLIC GO-LIVE (anonpage): /anon loads nothing from another origin and carries the fc:miniapp embed; only the
//      Farcaster web origins may frame it, with no X-Frame-Options; /home stays unframeable; /.well-known/farcaster.json
//      parses with homeUrl on this host; EXPECT_MINIAPP_SIGNED=true requires a signature for this host; not vacuous (4
//      doctored copies).
//  16. onboard: PUBLIC LIVE MODE as expected (EXPECT_PUBLIC_LIVE): the device env, no starter persona, the live doors, no
//      demo identity in the server HTML; a doctored self-test proves the scan can hit. Checks 1, 2b and 3 are live-aware
//      under EXPECT_PUBLIC_LIVE=true (the Get started / guest doors; the no-persona page instead of timeline cards; a
//      plain persona create instead of a fork).
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { FIXTURE_IDENTITY_NEEDLES, FIXTURE_SELF_NEEDLES, inlineErrors, scanNeedles, waitForTimelineCards } from "./lib/page-health.mjs";
import { DOCS_PATH, probeDocsBrowser, probeDocsHttp } from "./lib/docs-probe.mjs";
import { RELAY, statusProblems } from "./lib/neynar-stub.mjs";
import { OFFER_URL, deployedOfferProblems } from "./lib/gpl-source.mjs";

const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || "").replace(/\/$/, "");
// DOCS UNDER APP: what the door must say — the override this deployment carries, else the app's own /docs
const DOCS = (process.env.NEXT_PUBLIC_DOCS_URL || "").trim() || DOCS_PATH;
// FC-READ: what the relay's status op must report on this deployment (the reason vocabulary: RELAY.reasons)
const EXPECT_FC_READ = (process.env.EXPECT_FC_READ || "no_key").trim();
if (!RELAY.reasons.includes(EXPECT_FC_READ)) {
  console.log("EXPECT_FC_READ=" + EXPECT_FC_READ + " is not a relay reason (" + RELAY.reasons.join(", ") + ")");
  process.exit(2);
}
// PUBLIC GO-LIVE (onboard): is this deployment in public live mode (PUBLIC_LIVE=true on the app)?
const EXPECT_PUBLIC_LIVE = (process.env.EXPECT_PUBLIC_LIVE || "").trim() === "true";
if (!BASE || !VBASE) {
  console.log("usage: BASE_URL=https://app VALIDATOR_URL=https://validator [NEXT_PUBLIC_DOCS_URL=<only if the deployment overrides /docs>] node scripts/smoke-deployed.mjs");
  process.exit(2);
}
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const stamp = Date.now().toString(36).slice(-5);
const get = async (url, init) => { const r = await fetch(url, { cache: "no-store", ...init }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ } return { status: r.status, text, json }; };

console.log("\nDeployed smoke (app " + BASE + ", validator " + VBASE + ", docs " + DOCS + ", relay expected " + EXPECT_FC_READ + ")");
const browser = await chromium.launch();

async function device(label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   [" + label + " pageerror] " + String(e).slice(0, 160)));
  const d = { ctx, page, info: null };
  d.load = async (path = "/home") => {
    await page.goto(BASE + path, { waitUntil: "load" });
    d.info = await page.evaluate(() => new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("the device did not boot within 60 s")), 60000);
      const wait = () => (window.__layersDevice ? window.__layersDevice.ready.then((i) => { clearTimeout(t); res(i); }, rej) : setTimeout(wait, 100));
      wait();
    }));
    return d.info;
  };
  d.api = (method, p, body) => page.evaluate(async ({ method, p, body }) => {
    const r = await fetch(p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, json };
  }, { method, p, body });
  d.close = () => ctx.close();
  return d;
}

await check("1. the landing page renders cold with the app door and the docs door (to " + DOCS + ")", async () => {
  const r = await get(BASE + "/");
  if (r.status !== 200) throw new Error("landing " + r.status);
  if (EXPECT_PUBLIC_LIVE ? !(/data-testid="door-start"/.test(r.text) && /data-testid="door-app"/.test(r.text)) : !/Enter the app/.test(r.text)) throw new Error(EXPECT_PUBLIC_LIVE ? "no Sign in with Farcaster / guest door (live mode)" : "no app door");
  const door = /<a[^>]*data-testid="door-docs"[^>]*>/.exec(r.text)?.[0] ?? "";
  if (!door || !/Read the docs/.test(r.text)) throw new Error("no docs door (the app serves the docs itself, so the door is unconditional)");
  const href = (/href="([^"]*)"/.exec(door)?.[1] ?? "").replace(/&amp;/g, "&");
  if (href !== DOCS) throw new Error("the docs door goes to " + href + ", want " + DOCS + (DOCS === DOCS_PATH ? " — an old NEXT_PUBLIC_DOCS_URL left on the service overrides /docs: delete it" : ""));
  if (!/DEMO — not yet private/.test(r.text)) throw new Error("the status section does not name the DEMO label");
  return r.text.length + " bytes";
});

let A = null;
await check("2. the app loads cold in an empty profile: the device boots and the preview banner names a computed state", async () => {
  A = await device("A");
  const info = await A.load("/home");
  if (!info || !info.rootId) throw new Error("no device info");
  await A.page.getByTestId("preview-banner").waitFor({ timeout: 30000 });
  let state = "computing";
  for (let i = 0; i < 60 && state === "computing"; i++) { state = await A.page.getByTestId("preview-banner").getAttribute("data-state"); if (state === "computing") await new Promise((r) => setTimeout(r, 500)); }
  if (!["demo", "private"].includes(state)) throw new Error("banner state " + state + " — the label was not computed");
  return "root " + info.rootId + ", banner " + state;
});

// FC-READ: the relay's state, asserted against what the operator says it should be — in profile A's page, still on /home
const LIVE_CARD = 'main article[data-testid="cast"][data-live]:not([data-live="false"])';
await check(`2a. RELAY: the read relay's status is "${EXPECT_FC_READ}" (EXPECT_FC_READ)` + (EXPECT_FC_READ === "armed" ? "; a live card renders and its like is refused 403 NETWORK_READ_ONLY" : "; /home shows no live card"), async () => {
  if (!A || !A.info) throw new Error("no booted device from check 2");
  const r = await get(BASE + RELAY.path, { method: "POST", headers: { "content-type": "application/json", [RELAY.header]: "1" }, body: JSON.stringify({ op: "status" }) });
  if (r.status !== 200 || !r.json || typeof r.json.armed !== "boolean") throw new Error("the status op answered " + r.status + " " + r.text.slice(0, 160));
  // the status answer is public: never a budget number, never anything but the documented fields (FC-READ (no
  // channels): armed, reason, state — no channel list any more, and statusProblems names a `channels` field outright)
  const problems = statusProblems(r.json);
  if (problems.length) throw new Error("the status answer: " + problems.join("; ") + " — " + r.text.slice(0, 160));
  if (r.json.reason !== EXPECT_FC_READ) throw new Error(`the relay reports ${JSON.stringify(r.json.reason)} (armed ${r.json.armed}), expected ${JSON.stringify(EXPECT_FC_READ)} — set EXPECT_FC_READ to what this deployment should be`);
  const p = A.page;
  // NEYNAR AS A SWITCH (SECURITY-POSTURE.md §42): an armed key alone no longer puts Neynar on For You — the app's
  // FC_SOURCE_FORYOU=neynar|auto does, and the page says so in its device hint. Armed but switched to the network: the
  // feed answers source seed, state "network", and no live card renders (the relay is asked nothing for For You).
  if (EXPECT_FC_READ === "armed") {
    const forYouHint = await p.evaluate(() => (window.__LAYERS_DEVICE_ENV ? window.__LAYERS_DEVICE_ENV.FC_SOURCE_FORYOU ?? "" : null));
    if (forYouHint !== "neynar" && forYouHint !== "auto") {
      const f = await A.api("GET", "/api/feed?tab=foryou");
      const src = f.json?.liveSource ?? null;
      const netCasts = (f.json?.casts ?? []).filter((c) => /^0x[0-9a-f]{40}$/.test(String(c?.hash ?? "")));
      if (!src || src.source !== "seed" || src.state !== "network" || netCasts.length) throw new Error("armed, For You switched to the network: the feed says " + JSON.stringify(src) + " with " + netCasts.length + " network cast(s)");
      const pageLive = await p.locator(LIVE_CARD).count();
      if (pageLive) throw new Error(`armed, For You switched to the network, yet /home shows ${pageLive} live card(s)`);
      return `status armed (state ${r.json.state}); For You on Farcaster's network (FC_SOURCE_FORYOU not neynar): no live card, the feed says seed/network`;
    }
  }
  // PUBLIC GO-LIVE (verify): in public live mode a visitor with no persona has no timeline yet (the page says so: the
  // live no-persona marker), so the relay's casts are read where a persona's timeline reads them, the device's own feed
  // route (GET /api/feed?tab=foryou, answered in the tab). Not armed: the marker is there and no live card, and the feed
  // says no relay source and carries no network-shaped cast. Armed: the feed says relay/live, carries a network cast,
  // and liking it is refused exactly as on the page.
  if (EXPECT_PUBLIC_LIVE) {
    await p.locator('[data-testid="world-no-persona"][data-mode="live"]').first().waitFor({ timeout: 45000 }).catch(() => { throw new Error("live mode: the no-persona page never rendered on /home"); });
    const pageLive = await p.locator(LIVE_CARD).count();
    const f = await A.api("GET", "/api/feed?tab=foryou");
    if (f.status !== 200 || !f.json || !Array.isArray(f.json.casts)) throw new Error("live mode: the device's feed answered " + f.status);
    const netCasts = f.json.casts.filter((c) => /^0x[0-9a-f]{40}$/.test(String(c?.hash ?? "")));
    const src = f.json.liveSource ?? null;
    if (EXPECT_FC_READ !== "armed") {
      if (pageLive) throw new Error(`live mode, the relay is ${EXPECT_FC_READ}, yet /home shows ${pageLive} live card(s)`);
      if ((src && src.source === "relay" && src.state === "live") || netCasts.length) throw new Error(`live mode, the relay is ${EXPECT_FC_READ}, yet the feed says ${JSON.stringify(src)} with ${netCasts.length} network cast(s)`);
      return `status ${r.json.reason} (state ${r.json.state}); live mode: the no-persona page, no live card, no relay source`;
    }
    if (!src || src.source !== "relay" || src.state !== "live" || !netCasts.length) throw new Error("live mode, armed: the device's feed says " + JSON.stringify(src) + " with " + netCasts.length + " network cast(s)");
    const lhash = netCasts[0].hash;
    const llike = await A.api("POST", "/api/actions/react", { hash: lhash, kind: "like", on: true });
    const lwant = RELAY.networkReadOnlyLive; // PUBLIC GO-LIVE (F11): the live site says "this site", never "this preview"
    if (llike.status !== lwant.status || llike.json?.code !== lwant.code || llike.json?.error !== lwant.error) throw new Error(`live mode: liking a live cast answered ${llike.status} ${JSON.stringify(llike.json).slice(0, 160)} (expected ${lwant.status} ${lwant.code})`);
    return `status armed (state ${r.json.state}); live mode: the feed's live cast ${lhash.slice(0, 10)}…; its like refused ${llike.status} ${llike.json.code}`;
  }
  if (EXPECT_FC_READ !== "armed") {
    // deploying without the key changes nothing visible: the timeline is there (2b checks it too) and none of it is live
    await waitForTimelineCards(p, 45000);
    const live = await p.locator(LIVE_CARD).count();
    if (live) throw new Error(`the relay is ${EXPECT_FC_READ}, yet /home shows ${live} live card(s)`);
    return `status ${r.json.reason} (state ${r.json.state}); /home shows no live card`;
  }
  // armed: the precondition for the refusal is a REAL live card, never "no card, nothing refused"
  const hint = await p.evaluate(() => (window.__LAYERS_DEVICE_ENV ? window.__LAYERS_DEVICE_ENV.FC_READ_RELAY ?? "" : null));
  if (hint !== "on") throw new Error("the relay is armed but the page's device env does not say so (FC_READ_RELAY=" + JSON.stringify(hint) + ")");
  await p.locator(LIVE_CARD).first().waitFor({ timeout: 45000 }).catch(() => { throw new Error("armed, but no live card (data-live) rendered on /home within 45 s"); });
  const hash = await p.locator(LIVE_CARD).first().getAttribute("data-hash");
  if (!/^0x[0-9a-f]{40}$/.test(hash || "")) throw new Error("the live card's hash is not the network shape: " + JSON.stringify(hash));
  const like = await A.api("POST", "/api/actions/react", { hash, kind: "like", on: true });
  const want = RELAY.networkReadOnly;
  if (like.status !== want.status || like.json?.code !== want.code) throw new Error(`liking a live card answered ${like.status} ${JSON.stringify(like.json).slice(0, 160)} (expected ${want.status} ${want.code})`);
  if (like.json?.error !== want.error) throw new Error("the refusal's sentence differs: " + JSON.stringify(like.json?.error));
  return `status armed (state ${r.json.state}); live card ${hash.slice(0, 10)}…; its like refused ${like.status} ${like.json.code}`;
});

// PROD-LIVE (D-CU-0-4): the pages, not the API. Runs in profile A's page, which is on /home with a booted device.
// /settings is reached by a CLICK (next/link), never page.goto: A's identity is unsaved, and a full document load
// would wipe it and mint a second root — a cost against the per-address daily cap this suite must not add to.
await check("2b. CONTENT: /home shows timeline cards and no inline load error; /settings, reached by clicking nav-settings, renders its sections", async () => {
  if (!A || !A.info) throw new Error("no booted device from check 2");
  const p = A.page;
  // PUBLIC GO-LIVE: a live visitor with no persona has no timeline yet; the page says so
  const cards = EXPECT_PUBLIC_LIVE ? await p.locator('[data-testid="world-no-persona"][data-mode="live"]').first().waitFor({ timeout: 45000 }).then(() => 0) : await waitForTimelineCards(p, 45000);
  const homeErrs = await inlineErrors(p);
  if (homeErrs.length) throw new Error("/home: " + homeErrs.join("; "));
  await p.evaluate(() => { window.__smokeSoftNav = 1; });
  const nav = p.getByTestId("nav-settings");
  if (!(await nav.count())) throw new Error("no data-testid=nav-settings in the chrome: /settings is not reachable by clicking");
  await nav.first().click();
  await p.waitForURL((u) => new URL(u).pathname === "/settings", { timeout: 30000 });
  await p.locator('[data-testid^="settings-link-"]').first().waitFor({ timeout: 30000 });
  const sections = await p.locator('[data-testid^="settings-link-"]').count();
  if (sections < 5) throw new Error("/settings rendered " + sections + " section link(s)");
  const settingsErrs = await inlineErrors(p);
  if (settingsErrs.length) throw new Error("/settings: " + settingsErrs.join("; "));
  const kept = await p.evaluate(() => ({ soft: window.__smokeSoftNav === 1, root: window.__layersDevice?.info?.rootId ?? null }));
  if (!kept.soft) throw new Error("reaching /settings was a full document load: an unsaved visitor's identity would have been replaced");
  if (kept.root !== A.info.rootId) throw new Error("the device's root changed across the navigation");
  return cards + " timeline card(s), " + sections + " settings sections, same root";
});

await check("3. a persona can be created in the device", async () => {
  // PUBLIC GO-LIVE: live mode mints no starter persona, so there is nothing to fork from: a plain create
  const fork = EXPECT_PUBLIC_LIVE ? await A.api("POST", "/api/personas", { name: "Smoke " + stamp, handle: "smoke_" + stamp }) : await A.api("POST", "/api/identity/fork", { fromPersona: A.info.personaIds[0], carry: [], newHandle: "smoke_" + stamp, newName: "Smoke " + stamp });
  if (![200, 201].includes(fork.status)) throw new Error("fork " + fork.status + " " + JSON.stringify(fork.json).slice(0, 120));
  const per = await A.api("GET", "/api/personas");
  if (!(per.json?.personas ?? []).some((p) => p.handle === "smoke_" + stamp)) throw new Error("the new persona is not in the roster");
  return "@smoke_" + stamp;
});

await check("4. a post round-trips", async () => {
  const text = "deployed smoke " + stamp;
  const cast = await A.api("POST", "/api/actions/cast", { text });
  if (![200, 201].includes(cast.status)) throw new Error("cast " + cast.status + " " + JSON.stringify(cast.json).slice(0, 120));
  const feed = await A.api("GET", "/api/feed?tab=following");
  if (!JSON.stringify(feed.json).includes(text)) throw new Error("the cast is not in the feed (" + feed.status + ")");
});

await check("5. the docs door leads to the docs (" + DOCS + ", resolved against BASE_URL)", async () => {
  const target = new URL(DOCS, BASE + "/");
  if (target.origin !== new URL(BASE).origin) {
    // an override on another address: it must answer, and that is all this suite can say about it
    const r = await fetch(target, { redirect: "follow" });
    if (r.status >= 400) throw new Error("docs " + r.status + " at " + target);
    return "override " + target + ": " + r.status;
  }
  // on this app (the default): the contract, light, and a real browser load (it boots no device, so no root)
  const http = await probeDocsHttp(target.origin, { light: true });
  const page = await probeDocsBrowser(browser, target.origin, { walk: false });
  return http + "; browser: " + page;
});

await check("6. both processes answer the signed Totem health payload", async () => {
  const v = spawnSync(process.execPath, ["scripts/lib/health-probe.mjs", VBASE, "layers-validator"], { encoding: "utf8" });
  if (v.status !== 0) throw new Error("validator: " + (v.stdout + v.stderr).trim().slice(-200));
  const a = spawnSync(process.execPath, ["scripts/lib/health-probe.mjs", BASE, "layers"], { encoding: "utf8" });
  if (a.status !== 0) throw new Error("app: " + (a.stdout + a.stderr).trim().slice(-200));
  return (v.stdout.trim().split("\n").pop() || "") + " | " + (a.stdout.trim().split("\n").pop() || "");
});

await check("7. dev routes are refused on both processes; an unsigned reputation event is refused", async () => {
  const dev = await get(BASE + "/api/dev");
  if (![403, 404].includes(dev.status)) throw new Error("/api/dev GET answered " + dev.status);
  const act = await get(BASE + "/api/dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resetSeed" }) });
  if (![403, 404].includes(act.status)) throw new Error("/api/dev resetSeed answered " + act.status);
  const live = await get(BASE + "/api/dev/live");
  if (![403, 404].includes(live.status)) throw new Error("/api/dev/live answered " + live.status);
  const reset = await get(VBASE + "/zk/dev/reset", { method: "POST" });
  if (![403, 404].includes(reset.status)) throw new Error("validator /zk/dev/reset answered " + reset.status);
  // a REAL root of ours, a valid kind: the body has to get past the shape checks so the refusal is about the missing
  // signature and not about a malformed request (the property is "a stranger cannot inflate a root's reputation")
  const ev = await get(VBASE + "/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rootId: A.info.rootId, type: "cast_created", count: 1 }) });
  if (ev.status !== 401) throw new Error("unsigned /events for an existing root answered " + ev.status + " " + JSON.stringify(ev.json).slice(0, 120));
  const state = await get(VBASE + "/state");
  if (state.status !== 401) throw new Error("unsigned /state answered " + state.status);
});

await check("8. two independent browser profiles get two independent roots", async () => {
  const B = await device("B");
  const ib = await B.load("/home");
  if (ib.rootId === A.info.rootId || ib.anchor === A.info.anchor) throw new Error("B got A's root");
  const feedB = await B.api("GET", "/api/feed?tab=following");
  if (JSON.stringify(feedB.json).includes("deployed smoke " + stamp)) throw new Error("B's following feed carries A's cast");
  await B.close();
  return "roots differ";
});

const EXPECT_SIWF_RELAY_HOST = (process.env.EXPECT_SIWF_RELAY_HOST || "relay.farcaster.xyz").trim();
const EXPECT_SIWF_RPC_HOST = (process.env.EXPECT_SIWF_RPC_HOST || "mainnet.optimism.io").trim();
await check(`9. SIGN IN WITH FARCASTER runs in the browser: the server answers 404 device_only; the device reports ${EXPECT_SIWF_RELAY_HOST} / ${EXPECT_SIWF_RPC_HOST} with no request to either`, async () => {
  const srv = await get(BASE + "/api/fc/siwf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) });
  if (srv.status !== 404 || srv.json?.code !== "device_only") throw new Error("the server answered a sign-in: " + srv.status + " " + srv.text.slice(0, 160));
  if (!A || !A.info) throw new Error("profile A has no booted device (check 2 failed)");
  const seen = [];
  const onReq = (r) => seen.push(r.url());
  A.page.on("request", onReq);
  let st;
  try {
    st = await A.api("GET", "/api/fc/siwf");
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    A.page.off("request", onReq);
  }
  if (st.status !== 200 || st.json?.available !== true || st.json?.mode !== "live") throw new Error("the device's status: " + st.status + " " + JSON.stringify(st.json).slice(0, 200));
  if (st.json.relayHost !== EXPECT_SIWF_RELAY_HOST || st.json.rpcHost !== EXPECT_SIWF_RPC_HOST) throw new Error(`the device reports ${st.json.relayHost} / ${st.json.rpcHost}`);
  if (st.json.session !== null || st.json.link !== null) throw new Error("a fresh profile already has a sign-in: " + JSON.stringify(st.json).slice(0, 160));
  const hosts = new Set([EXPECT_SIWF_RELAY_HOST, EXPECT_SIWF_RPC_HOST]);
  const touched = seen.filter((u) => { try { return hosts.has(new URL(u).host); } catch { return false; } });
  if (touched.length) throw new Error("the status read made " + touched.length + " request(s) to the relay or RPC");
  const local = seen.filter((u) => { try { return new URL(u).pathname === "/api/fc/siwf"; } catch { return false; } });
  if (local.length) throw new Error("the status read reached the server (" + local.length + " request(s)): the device did not answer /api/fc/siwf");
  return `server 404; device ${st.json.relayHost} / ${st.json.rpcHost}; 0 requests`;
});

// PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the anonymous tree this deployment must run on both services
const EXPECT_ANON_TREE = (process.env.EXPECT_ANON_TREE || "valid").trim();
await check(`10. THE BROWSER CHANNEL through this deployment's edge: the validator and the app's device both name the tree ${EXPECT_ANON_TREE}; the web head read is not refused (a cookie on it is); a short POST to the web route is malformed, not refused (refused with a cookie)`, async () => {
  // a. the two halves of the deployment name the same plain tree (else every stranger's proof is refused)
  const cfg = await get(VBASE + "/zk/anon-post/config?mode=fixture");
  if (cfg.status !== 200 || !cfg.json) throw new Error("the validator's anon config answered " + cfg.status + " " + cfg.text.slice(0, 120));
  if (cfg.json.tree !== EXPECT_ANON_TREE) throw new Error(`the validator accepts anon posts into ${JSON.stringify(cfg.json.tree)}, expected ${JSON.stringify(EXPECT_ANON_TREE)} — set ZK_ANON_POST_TREE=${EXPECT_ANON_TREE} on the validator service`);
  if (!A || !A.page) throw new Error("profile A has no page (check 2 failed): the app's half cannot be read");
  const devTree = await A.page.evaluate(() => (window.__LAYERS_DEVICE_ENV ? window.__LAYERS_DEVICE_ENV.ZK_ANON_POST_TREE ?? null : undefined));
  if (devTree === undefined) throw new Error("profile A's page carries no device env");
  if (devTree !== EXPECT_ANON_TREE) throw new Error(`the app tells visitors' tabs to prove ${JSON.stringify(devTree)}, expected ${JSON.stringify(EXPECT_ANON_TREE)} — set ZK_ANON_POST_TREE=${EXPECT_ANON_TREE} on the app service`);
  // b. the head read through the edge (GET)
  const url = VBASE + "/zk/anon/web/head?mode=fixture&tree=" + encodeURIComponent(EXPECT_ANON_TREE);
  const plain = await get(url, { credentials: "omit", redirect: "error" });
  if (plain.json?.error === "refused") throw new Error("the web route refused a plain read: a header added on the way (the hosting edge's) is outside validator/anon.js's list, so every browser submission would be refused");
  if (!(plain.status === 200 || (plain.status === 404 && plain.json?.error === "unknown"))) throw new Error("the web head answered " + plain.status + " " + plain.text.slice(0, 160));
  const cookie = await get(url, { headers: { cookie: "layers_probe=1" }, redirect: "error" });
  if (cookie.json?.error !== "refused") throw new Error("the same read with a cookie was not refused (" + cookie.status + " " + cookie.text.slice(0, 120) + "): this probe cannot see the route's refusal");
  // c. the POST door through the edge: the size door sits after the header door, so "malformed" means the edge's headers
  // passed (nothing is consumed: a 5-byte body never reaches the proof of work)
  const post = (headers) => get(VBASE + "/zk/anon/web?pow=smoke", { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8", ...headers }, body: "smoke", redirect: "error" });
  const p1 = await post({});
  if (p1.json?.outcome !== "malformed") throw new Error("a short POST to the web route answered " + JSON.stringify(p1.json?.outcome ?? p1.status) + ", not malformed: " + (p1.json?.outcome === "refused" ? "a header the hosting edge adds is outside validator/anon.js's list (or TRUST_PROXY is not true on the validator) — every browser submission would be refused" : p1.text.slice(0, 120)));
  const p2 = await post({ cookie: "layers_probe=1" });
  if (p2.json?.outcome !== "refused") throw new Error("the same POST with a cookie answered " + JSON.stringify(p2.json?.outcome ?? p2.status) + ": this probe cannot see the POST door's refusal");
  return `tree ${EXPECT_ANON_TREE} on both; head ${plain.status}${plain.status === 404 ? " (no test crowd on " + EXPECT_ANON_TREE + " yet)" : ""}, with a cookie refused; POST malformed, with a cookie refused`;
});

// PERSONA LAUNCH GO-LIVE (A-GPL-SOURCE-OFFER): the five Totem files prover.js is built from — a sixth would be a REVIEWED
// change (the build already refuses to ship one unoffered); this list is what the deployment must offer, exactly
const EXPECT_OFFER_FILES = ["lib/zk/ceremonyPins.ts", "lib/zk/hash.ts", "lib/zk/prover/browser-worker.ts", "lib/zk/transport/fixtureCore.ts", "lib/zk/transport/types.ts"];
await check("11. the GPL-3.0 notice ships with the browser prover: /device/prover.js.LICENSE.txt answers the license, and prover.js names it; the SOURCE OFFER at /device/source/ serves exactly the five Totem files (each hashing to its manifest entry), the build files, snarkjs / ffjavascript with versions and tagged links, a commit, and the GPL text (a doctored manifest is caught)", async () => {
  const lic = await get(BASE + "/device/prover.js.LICENSE.txt");
  if (lic.status !== 200) throw new Error("/device/prover.js.LICENSE.txt answered " + lic.status);
  if (!lic.text.includes("GNU GENERAL PUBLIC LICENSE")) throw new Error("/device/prover.js.LICENSE.txt does not carry the GPL-3.0 text");
  if (!lic.text.includes(OFFER_URL)) throw new Error("/device/prover.js.LICENSE.txt does not name the source offer " + OFFER_URL);
  const head = await fetch(BASE + "/device/prover.js", { cache: "no-store" });
  const js = await head.text();
  if (head.status !== 200) throw new Error("/device/prover.js answered " + head.status);
  const banner = js.slice(0, 2000);
  if (!banner.includes("/device/prover.js.LICENSE.txt")) throw new Error("prover.js's banner does not name its LICENSE file");
  if (!banner.includes(OFFER_URL)) throw new Error("prover.js's banner does not name the source offer " + OFFER_URL);
  // PUBLIC GO-LIVE: Help links the offer in plain words — the line a visitor finds (app/help/page.tsx, help-gpl-source)
  const help = await get(BASE + "/help", { redirect: "manual" });
  if (help.status !== 200) throw new Error("/help answered " + help.status);
  const helpLink = /<a[^>]*data-testid="help-gpl-source"[^>]*>/.exec(help.text)?.[0] ?? "";
  if (!helpLink.includes('href="' + OFFER_URL + '"')) throw new Error("/help does not link the source offer " + OFFER_URL + " (help-gpl-source): " + (helpLink.slice(0, 160) || "absent"));
  // the offer itself
  const cache = new Map();
  const fetchBytes = async (u) => {
    if (!cache.has(u)) {
      const r = await fetch(new URL(u, BASE + "/"), { cache: "no-store", redirect: "follow" });
      cache.set(u, { status: r.status, bytes: Buffer.from(await r.arrayBuffer()) });
    }
    return cache.get(u);
  };
  const mf = await fetchBytes(OFFER_URL + "manifest.json");
  if (mf.status !== 200) throw new Error(OFFER_URL + "manifest.json answered " + mf.status + " (was the build's source offer written? scripts/build-device.mjs)");
  let manifest;
  try {
    manifest = JSON.parse(mf.bytes.toString("utf8"));
  } catch {
    throw new Error(OFFER_URL + "manifest.json is not JSON");
  }
  const paths = (manifest.files || []).map((f) => f.path).sort();
  if (JSON.stringify(paths) !== JSON.stringify([...EXPECT_OFFER_FILES].sort())) throw new Error("the offer serves " + JSON.stringify(paths) + ", not exactly the five Totem files " + JSON.stringify(EXPECT_OFFER_FILES));
  const problems = await deployedOfferProblems(manifest, fetchBytes, { expectFiles: EXPECT_OFFER_FILES.length });
  if (problems.length) throw new Error("the source offer: " + problems.slice(0, 6).join("; "));
  // the banner names the versions the manifest carries
  for (const name of ["snarkjs", "ffjavascript"]) {
    const u = (manifest.upstream || []).find((x) => x.name === name);
    if (!u || !banner.includes(`${name} ${u.version}`)) throw new Error(`prover.js's banner does not name ${name} ${u ? u.version : "(absent from the manifest)"}`);
  }
  // the commit: present; equal to the app's own when both are hashes (the offer came from the build that is serving)
  if (typeof manifest.commit !== "string" || !manifest.commit) throw new Error("the manifest names no commit");
  const health = await get(BASE + "/api/health");
  const live = typeof health.json?.commit === "string" ? health.json.commit : "";
  const hex = (s) => /^[0-9a-f]{7,40}$/.test(s);
  if (hex(manifest.commit) && hex(live) && !(manifest.commit.startsWith(live) || live.startsWith(manifest.commit))) throw new Error(`the offer names commit ${manifest.commit.slice(0, 12)} but the app reports ${live.slice(0, 12)}`);
  // NOT VACUOUS: the same check over a doctored manifest (one byte of one hash changed) must see the mismatch
  const doctored = JSON.parse(JSON.stringify(manifest));
  const h0 = doctored.files[0].sha256;
  doctored.files[0].sha256 = (h0[0] === "0" ? "1" : "0") + h0.slice(1);
  const caught = await deployedOfferProblems(doctored, fetchBytes, { expectFiles: EXPECT_OFFER_FILES.length });
  if (!caught.some((p) => p.includes(doctored.files[0].url))) throw new Error("a doctored manifest (a wrong sha256) passed the offer check — the check is vacuous");
  return `LICENSE ${lic.text.length} chars; prover.js ${js.length} bytes; offer: ${paths.length} Totem files + ${(manifest.build || []).length} build files, all hashing to the manifest; snarkjs ${(manifest.upstream || []).find((x) => x.name === "snarkjs")?.version}; commit ${manifest.commit.slice(0, 12)}${hex(live) ? " (= the app's)" : ""}; a doctored hash caught`;
});

await check("12. THE REGISTRAR on this deployment is SIMULATED: /registrar/config says simulated:true and never live; asking for mode=live does not make it live", async () => {
  const c = await get(VBASE + "/registrar/config");
  if (c.status !== 200 || !c.json) throw new Error("/registrar/config answered " + c.status + " " + c.text.slice(0, 120));
  if (c.json.simulated !== true) throw new Error("the public registrar does not say simulated:true: " + c.text.slice(0, 200));
  if (c.json.live === true || c.json.mode === "live") throw new Error("the public registrar says it is live: " + c.text.slice(0, 200));
  const l = await get(VBASE + "/registrar/config?mode=live");
  if (l.status === 200 && l.json && (l.json.simulated !== true || l.json.live === true || l.json.mode === "live")) throw new Error("asking the public registrar for mode=live answered a live registrar: " + l.text.slice(0, 200));
  return `simulated:true; mode=live → ${l.status}${l.status === 200 ? " (still simulated)" : " (refused)"}`;
});

await check("13. THE X OUTBOX on this deployment is OFF: /x/outbox/config?mode=fixture says live:false; mode=live is refused or says live:false", async () => {
  const c = await get(VBASE + "/x/outbox/config?mode=fixture");
  if (c.status !== 200 || !c.json) throw new Error("/x/outbox/config answered " + c.status + " " + c.text.slice(0, 120));
  if (c.json.live !== false) throw new Error("the public X outbox does not say live:false: " + c.text.slice(0, 200));
  const l = await get(VBASE + "/x/outbox/config?mode=live");
  if (l.status === 200 && l.json && l.json.live !== false) throw new Error("the public X outbox in mode=live does not say live:false: " + l.text.slice(0, 200));
  return `live:false; mode=live → ${l.status}${l.status === 200 ? " (live:false)" : " (refused)"}`;
});

// ---- PUBLIC GO-LIVE: checks 14 (relay), 15 (anonpage), 16 (onboard) are pasted HERE, verbatim, in that order ----

// 14. PUBLIC GO-LIVE (the relay track) — THE PUBLIC @anon RELAY IS IN THE STATE THE OPERATOR EXPECTS. EXPECT_ANON_RELAY = unarmed (default) | armed.
const EXPECT_ANON_RELAY = (process.env.EXPECT_ANON_RELAY || "unarmed").trim();
function anonRelayProblems(expect, cfg, ps, appHost) {
  const out = [];
  const armed = expect === "armed";
  if (cfg.status !== 200 || !cfg.json) return ["/zk/anon-post/config?mode=live answered " + cfg.status];
  if (cfg.json.liveRelay !== armed) out.push("liveRelay is " + cfg.json.liveRelay + ", expected " + armed);
  if (armed && cfg.json.relayKind !== "agent") out.push("relayKind is " + cfg.json.relayKind + ", expected agent");
  if (cfg.json.fidGate !== true) out.push("the config does not say fidGate:true (a build without the fid gate)");
  if (ps.status !== 200 || !ps.json) { out.push("/zk/anon/public-status?mode=live answered " + ps.status); return out; }
  if (!!(ps.json.relay && ps.json.relay.ready) !== armed) out.push("relay.ready is not " + armed);
  if (!(ps.json.fidGate && ps.json.fidGate.on === true)) out.push("the fid gate is not on");
  else if (armed && ps.json.fidGate.domain !== appHost) out.push("the fid gate checks sign-ins for " + ps.json.fidGate.domain + ", not " + appHost);
  if (ps.json.filter !== "on") out.push("the text filter is not on");
  if (armed && !(Array.isArray(ps.json.moderators) && ps.json.moderators.length > 0)) out.push("no moderator is set up");
  if (/FC_ANON_NEYNAR_KEY=|"apiKey"|"signerUuid"/.test(ps.text + cfg.text)) out.push("a relay credential field appears in a public answer");
  return out;
}
await check(`14. THE PUBLIC @anon RELAY is "${EXPECT_ANON_RELAY}" (EXPECT_ANON_RELAY): liveRelay, the agent path, the fid gate for this host, the filter, the moderators, /terms and the proving files — status only, nothing posted`, async () => {
  if (!["unarmed", "armed"].includes(EXPECT_ANON_RELAY)) throw new Error("EXPECT_ANON_RELAY must be unarmed or armed");
  const cfg = await get(VBASE + "/zk/anon-post/config?mode=live");
  const ps = await get(VBASE + "/zk/anon/public-status?mode=live");
  const terms = await get(BASE + "/terms");
  const man = await get(BASE + "/device/zk/manifest.json");
  const appHost = new URL(BASE).host;
  const problems = anonRelayProblems(EXPECT_ANON_RELAY, cfg, ps, appHost);
  if (terms.status !== 200) problems.push("/terms answered " + terms.status);
  if (EXPECT_ANON_RELAY === "armed" && !(man.status === 200 && man.json && man.json.present === true)) problems.push("/device/zk/manifest.json does not say present:true");
  const doctored = { ...cfg, json: cfg.json ? { ...cfg.json, liveRelay: !cfg.json.liveRelay } : cfg.json };
  if (cfg.json && anonRelayProblems(EXPECT_ANON_RELAY, doctored, ps, appHost).length === 0) problems.push("the judge passed a doctored answer (liveRelay flipped): vacuous");
  if (problems.length) throw new Error(problems.join("; "));
  return `liveRelay ${cfg.json.liveRelay}, relayKind ${cfg.json.relayKind}, fid gate on for ${appHost}, moderators ${(ps.json.moderators || []).length}`;
});

// ---- PUBLIC GO-LIVE (anonpage): check 15, for scripts/smoke-deployed.mjs at the marker after check 13 (after relay's 14).
// The anon page (/anon) and the Farcaster Mini App on a deployment: the page loads nothing from another origin and carries
// the fc:miniapp embed; ONLY the Farcaster web origins may frame it (and no X-Frame-Options); /home stays unframeable; the
// manifest parses with homeUrl on this deployment's host, and is signed for this host when it is signed at all
// (EXPECT_MINIAPP_SIGNED=true requires it: after scripts/owner/arm-miniapp.ps1). Not vacuous: four doctored copies of what
// was read (an outside script, a wildcard framer, a frameable /home, homeUrl elsewhere) must each be caught.
// FARCASTER_FRAMERS is a DELIBERATE DUPLICATE of lib/miniapp/manifest.ts FRAME_ANCESTORS (scripts/unit-miniapp.mjs M16 pins it).
const FARCASTER_FRAMERS = ["https://farcaster.xyz", "https://www.farcaster.xyz", "https://client.farcaster.xyz", "https://warpcast.com", "https://www.warpcast.com"];
// PUBLIC GO-LIVE (F14): DELIBERATE DUPLICATE of lib/miniapp/manifest.ts anonImageSources() (unit-miniapp M16 pins it): after
// "Open Totem" the whole session runs under /anon's policy, so its img-src names the app's media hosts, exactly these
const ANON_MEDIA_SOURCES = ["https://imagedelivery.net", "https://*.imagedelivery.net", "https://i.imgur.com", "https://*.i.imgur.com", "https://res.cloudinary.com", "https://*.res.cloudinary.com", "https://i.pravatar.cc", "https://*.i.pravatar.cc", "https://picsum.photos", "https://*.picsum.photos", "https://api.dicebear.com", "https://*.api.dicebear.com"];
function anonPageProblems({ html, csp, xfo, homeCsp, homeXfo, manifest, base }) {
  const out = [];
  const origin = new URL(base).origin;
  for (const m of String(html).matchAll(/<(script|link|img|iframe|source|video|audio)\b[^>]*?\b(src|href)="([^"]+)"/gi)) {
    const u = m[3].replace(/&amp;/g, "&");
    if (/^(data:|blob:|#)/.test(u)) continue;
    let o;
    try {
      o = new URL(u, base).origin;
    } catch {
      continue;
    }
    if (o !== origin) out.push(m[1] + " loads from " + o);
  }
  const dir = Object.fromEntries(String(csp || "").split(";").map((d) => d.trim()).filter(Boolean).map((d) => d.split(/\s+/)).map(([k, ...v]) => [k, v]));
  if (JSON.stringify(dir["frame-ancestors"]) !== JSON.stringify(FARCASTER_FRAMERS)) out.push("/anon frame-ancestors is " + JSON.stringify(dir["frame-ancestors"] ?? null));
  if (xfo) out.push("/anon carries X-Frame-Options " + xfo + " (it would block the Mini App)");
  for (const k of ["script-src", "style-src", "font-src"]) if (!dir[k] || dir[k].some((v) => /^https?:/.test(v))) out.push("/anon " + k + " is " + JSON.stringify(dir[k] ?? null));
  // PUBLIC GO-LIVE (F14): images from this origin and EXACTLY the app's media hosts — still an exact list, never a wildcard host
  if (JSON.stringify(dir["img-src"] ?? null) !== JSON.stringify(["'self'", "data:", "blob:", ...ANON_MEDIA_SOURCES])) out.push("/anon img-src is " + JSON.stringify(dir["img-src"] ?? null));
  if (homeCsp !== "frame-ancestors 'none'" || homeXfo !== "DENY") out.push("/home is frameable (" + homeCsp + " / " + homeXfo + ")");
  if (!/<meta\s+name="fc:miniapp"\s+content="/.test(String(html))) out.push("no fc:miniapp embed on /anon");
  const cfg = manifest && typeof manifest === "object" ? manifest.miniapp : null;
  if (!cfg || cfg.version !== "1" || !cfg.name || !cfg.iconUrl || !cfg.homeUrl) out.push("the manifest misses version / name / iconUrl / homeUrl");
  else {
    try {
      if (new URL(cfg.homeUrl).host !== new URL(base).host) out.push("the manifest's homeUrl " + cfg.homeUrl + " is not on " + new URL(base).host);
    } catch {
      out.push("the manifest's homeUrl is not a URL");
    }
  }
  return out;
}
await check("15. THE ANON PAGE AND THE MINI APP: /anon loads nothing from another origin and carries the fc:miniapp embed; only the Farcaster web origins may frame it (no X-Frame-Options); /home stays unframeable; /.well-known/farcaster.json parses with homeUrl on this host" + (process.env.EXPECT_MINIAPP_SIGNED === "true" ? ", SIGNED for it (EXPECT_MINIAPP_SIGNED)" : "") + "; five doctored copies are caught", async () => {
  const r = await fetch(BASE + "/anon", { cache: "no-store" });
  const html = await r.text();
  if (r.status !== 200) throw new Error("/anon answered " + r.status);
  const h = await fetch(BASE + "/home", { cache: "no-store" });
  await h.arrayBuffer();
  const m = await fetch(BASE + "/.well-known/farcaster.json", { cache: "no-store" });
  let manifest = null;
  try {
    manifest = await m.json();
  } catch {
    manifest = null;
  }
  if (m.status !== 200) throw new Error("/.well-known/farcaster.json answered " + m.status);
  const facts = { html, csp: r.headers.get("content-security-policy"), xfo: r.headers.get("x-frame-options"), homeCsp: h.headers.get("content-security-policy"), homeXfo: h.headers.get("x-frame-options"), manifest, base: BASE };
  const problems = anonPageProblems(facts);
  if (problems.length) throw new Error(problems.join(" | "));
  const signed = !!(manifest && manifest.accountAssociation);
  if (process.env.EXPECT_MINIAPP_SIGNED === "true" && !signed) throw new Error("the manifest is UNSIGNED (EXPECT_MINIAPP_SIGNED=true): sign it for " + new URL(BASE).hostname + " and run scripts/owner/arm-miniapp.ps1");
  if (signed) {
    let d = null;
    try {
      d = JSON.parse(Buffer.from(String(manifest.accountAssociation.payload), "base64url").toString("utf8")).domain;
    } catch {
      d = null;
    }
    if (d !== new URL(BASE).hostname) throw new Error("the manifest is signed for " + JSON.stringify(d) + ", not " + new URL(BASE).hostname);
  }
  const doctored = [
    { ...facts, html: String(facts.html).replace("</head>", '<script src="https://cdn.doctored.invalid/x.js"></script></head>') },
    { ...facts, csp: String(facts.csp).replace(/frame-ancestors [^;]+/, "frame-ancestors *") },
    { ...facts, homeCsp: null },
    { ...facts, manifest: { ...manifest, miniapp: { ...manifest.miniapp, homeUrl: "https://elsewhere.invalid/anon" } } },
    { ...facts, csp: String(facts.csp).replace(/img-src ([^;]+)/, "img-src $1 https://images.doctored.invalid") },
  ];
  const missed = doctored.map((f, i) => (anonPageProblems(f).length ? null : i)).filter((i) => i !== null);
  if (missed.length) throw new Error("doctored copies #" + missed.join(", #") + " passed — the check is vacuous");
  return FARCASTER_FRAMERS.length + " framers; img-src the " + ANON_MEDIA_SOURCES.length + " media sources; manifest " + (signed ? "signed for " + new URL(BASE).hostname : "UNSIGNED (Farcaster refuses the Mini App until the owner signs it)") + "; " + doctored.length + " doctored copies caught";
});

// 15b. PUBLIC GO-LIVE (F6): ONE PUBLIC ADDRESS. After the domain move, the platform's own address (OLD_APP_URL, e.g. the
// *.up.railway.app one) must send every page to the same path and query on APP_URL with a 308 and cache-control no-store
// (middleware.ts canonicalHostRedirect), while its /api/health still answers 200 (never a redirect: the platform's health
// check uses it). Without OLD_APP_URL: a NOTE. Not vacuous: a doctored answer (200, no Location) must be caught in-process.
function oldHostProblems({ page, health, want }) {
  const out = [];
  if (page.status !== 308) out.push("the old address answered " + page.status + " for a page, not 308");
  if (page.location !== want) out.push("its Location is " + JSON.stringify(page.location) + ", not " + JSON.stringify(want));
  if (!/no-store/.test(String(page.cacheControl || ""))) out.push("the redirect is cacheable (" + JSON.stringify(page.cacheControl) + ")");
  if (health.status !== 200) out.push("the old address's /api/health answered " + health.status + (health.location ? " to " + health.location : "") + ", not 200");
  return out;
}
await check("15b. ONE PUBLIC ADDRESS (F6): " + (process.env.OLD_APP_URL ? "the old address " + process.env.OLD_APP_URL + " sends /anon?from=smoke to APP_URL with a 308, no-store; its /api/health answers 200" : "no OLD_APP_URL given (NOTE)") + "; a doctored answer is caught", async () => {
  const doctoredOut = oldHostProblems({ page: { status: 200, location: null, cacheControl: null }, health: { status: 200 }, want: "https://x.invalid/anon?from=smoke" });
  if (!doctoredOut.length) throw new Error("a doctored answer (200, no Location) passed — the check is vacuous");
  const old = String(process.env.OLD_APP_URL || "").replace(/\/+$/, "");
  if (!old) return "NOTE: set OLD_APP_URL to the platform's own address once the domain is live (the doctored answer was caught)";
  const appUrl = String(process.env.APP_URL || BASE);
  const want = new URL(appUrl).origin + "/anon?from=smoke";
  const pr = await fetch(old + "/anon?from=smoke", { redirect: "manual", cache: "no-store" });
  await pr.arrayBuffer().catch(() => null);
  const hr = await fetch(old + "/api/health", { redirect: "manual", cache: "no-store" });
  await hr.arrayBuffer().catch(() => null);
  const facts = { page: { status: pr.status, location: pr.headers.get("location"), cacheControl: pr.headers.get("cache-control") }, health: { status: hr.status, location: hr.headers.get("location") }, want };
  const problems = oldHostProblems(facts);
  if (problems.length) throw new Error(problems.join(" | "));
  return "308 to " + want + " (no-store); /api/health 200; the doctored answer caught";
});

// 16. PUBLIC GO-LIVE (the onboard track's): PUBLIC LIVE MODE as expected (EXPECT_PUBLIC_LIVE). Live: a booted tab's device env carries
// PUBLIC_LIVE=on and its device minted no persona; the landing shows the owner's front door (2026-11-05: "One you. Many personas.",
// Sign in with Farcaster → /welcome#next, Continue with X DISABLED and marked Soon (SIGN IN WITH X: with EXPECT_X_SIGNIN=armed,
// a door to /welcome#next instead), I've used Totem before, Get one free →
// farcaster.xyz, the guest door → /anon), no context-collapse paragraph and no preview pill; the TEXT
// of the landing's and /home's server HTML names no seeded handle, fixture identity or fixture trend. Not live: the device env
// carries no PUBLIC_LIVE. Not vacuous: the scan over a doctored text that quotes one seeded handle must hit (in-process).
await check(`16. PUBLIC LIVE MODE is ${EXPECT_PUBLIC_LIVE ? "on" : "off"} as expected (EXPECT_PUBLIC_LIVE): device env, starter personas, the landing's doors, no demo identity in the server HTML`, async () => {
  const { readFileSync } = await import("node:fs");
  const fx = JSON.parse(readFileSync(new URL("../lib/fixtures/data.json", import.meta.url), "utf8"));
  const acct = JSON.parse(readFileSync(new URL("../seed/data/accounts.json", import.meta.url), "utf8"));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const handles = [...fx.users.map((u) => u.username), ...acct.personas.map((x) => x.handle)].filter((h) => typeof h === "string" && h.length >= 5);
  const needles = [...FIXTURE_IDENTITY_NEEDLES, ...FIXTURE_SELF_NEEDLES, ...handles.map((h) => ({ label: "@" + h, re: new RegExp("(?<![\\w.])@?" + esc(h) + "(?![\\w])", "i") })), ...(fx.trends || []).filter((t) => t && t.title && t.title.length >= 8).map((t) => ({ label: t.title, re: new RegExp(esc(t.title)) }))];
  if (!scanNeedles("a post by @" + acct.personas[0].handle, needles).length) throw new Error("the needle scan is blind (doctored self-test)");
  const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
  const P = await device("16");
  try {
    await P.load("/home");
    const env = await P.page.evaluate(() => (window.__LAYERS_DEVICE_ENV ? { ...window.__LAYERS_DEVICE_ENV } : null));
    if (!EXPECT_PUBLIC_LIVE) {
      if (env && "PUBLIC_LIVE" in env) throw new Error("the device env carries PUBLIC_LIVE=" + env.PUBLIC_LIVE + " on a deployment expected NOT live");
      return "not live: no PUBLIC_LIVE in the device env";
    }
    if (!env || env.PUBLIC_LIVE !== "on") throw new Error("the device env says PUBLIC_LIVE=" + (env ? env.PUBLIC_LIVE : "(no env)"));
    const per = await P.api("GET", "/api/personas");
    if ((per.json?.personas ?? []).length !== 0) throw new Error("the device minted " + per.json.personas.length + " persona(s) in live mode");
  } finally {
    await P.close();
  }
  const landing = await get(BASE + "/");
  // SIGN IN WITH X: EXPECT_X_SIGNIN=armed (the owner ran scripts/owner/arm-x-signin.ps1) expects the real door instead of Soon
  const xArmed = String(process.env.EXPECT_X_SIGNIN || "unset").trim() === "armed";
  for (const id of ["door-start", xArmed ? "door-x-on" : "door-x", "door-app", "door-unlock", "door-get-farcaster"]) if (!landing.text.includes(`data-testid="${id}"`)) throw new Error("the live landing lacks " + id);
  if (landing.text.includes('data-testid="landing-preview-pill"')) throw new Error("the live landing still says preview");
  if (!landing.text.includes(">One you. Many personas.</h1>")) throw new Error("the live landing lacks the headline");
  if (!/href="\/welcome#next"[^>]*data-testid="door-start"[^>]*>Sign in with Farcaster</.test(landing.text)) throw new Error("Sign in with Farcaster does not go to /welcome#next");
  if (xArmed) {
    if (!/<a href="\/welcome#next"[^>]*data-testid="door-x-on"/.test(landing.text) || landing.text.includes('data-testid="door-x"')) throw new Error("EXPECT_X_SIGNIN=armed, but Continue with X is not a door to /welcome#next");
  } else if (!/<button type="button" disabled=""[^>]*data-testid="door-x"[^>]*>Continue with X<span[^>]*>Soon<\/span>/.test(landing.text)) throw new Error("Continue with X is not shown disabled and marked Soon (an armed site: EXPECT_X_SIGNIN=armed)");
  if (!/href="https:\/\/farcaster\.xyz"[^>]*data-testid="door-get-farcaster"/.test(landing.text)) throw new Error("no Get one free link to farcaster.xyz");
  if (!/href="\/anon"[^>]*data-testid="door-app"/.test(landing.text)) throw new Error("the guest door does not go to the anonymous feed");
  if (/context collapse/i.test(landing.text)) throw new Error("the live landing still carries the context-collapse paragraph");
  for (const [where, html] of [["the landing", landing.text], ["/home", (await get(BASE + "/home")).text]]) {
    const hits = scanNeedles(textOf(html), needles);
    if (hits.length) throw new Error(where + " names the demo world: " + hits.slice(0, 3).map((h) => h.label).join(", "));
  }
  return "live: device env PUBLIC_LIVE=on, 0 starter personas, the owner's landing, landing + /home clean";
});

if (A) await A.close();
await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} deployed smoke checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
