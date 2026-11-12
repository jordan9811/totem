// POST AS YOU — "Allow Totem to post as you" ON THE PRODUCTION SHAPE (Playwright, desktop), with nothing real:
//   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ROOTPOST=stub bash scripts/run-prod-shape.sh scripts/accept-root-post-prod.mjs
//   (npm run test:root-post-prod; it starts servers: one harness at a time)
// The launcher arms the validator with the stub's PUBLIC test app account and points it (and the tab's hub read) at the
// loopback stubs (scripts/lib/farcaster-api-stub.mjs: Farcaster's key request API, which recovers every signature with
// viem; scripts/lib/farcaster-protocol-stub.mjs: a Snapchain node with its own decoder). Chromium resolves NOTHING but
// loopback, so no request can leave the machine; every request is logged.
//
//   RP1 the shape: /api/dev 403, live mode, both stubs answer, the validator's app account is armed with the stub's fid,
//       and the tab's device env names the hub stub (FC_ROOT_HUB_URL) — handed over by the app server, not injected
//   RP2 sign in with Farcaster (the SIWF stub's @stubalice) and keep the identity with a passkey → /home as the root
//   RP3 /home: "Posting as @stubalice", the line saying what allowing does, the disclosure BEFORE the request, the Allow
//       button, and no text box
//   RP4 Allow: the approval panel with a QR code and a farcaster:// link; the stub holds ONE request naming the app fid and
//       the tab's own public key; the validator, not the page, called Farcaster's API
//   RP5 REFUSALS: an approval from ANOTHER account is refused in words and no composer appears; an approval whose key the
//       node does not list keeps waiting and never enables the composer
//   RP6 the right approval: the root composer, "Posts go to Farcaster as @stubalice." and the main-app note
//   RP7 post: the node holds the cast for fid 990777 signed by the tab's key, the line says "Posted to Farcaster as
//       @stubalice" with its link; Delete removes it on the node
//   RP8 a node refusal (the key removed in the Farcaster app) is an ERROR with the node's words, never "Posted"
//   RP9 Settings › Account: Totem can post as @stubalice; Disconnect needs DISCONNECT typed; then the composer offers Allow
//       again and the page says how to remove the key in the Farcaster app
//   RP10 nothing left the machine; the Farcaster API stub saw no browser Origin (zero violations). The private key's
//       confinement (never in an answer, a request or a log) is measured in-process by scripts/unit-root-post.mjs R5
// ABORTS (exit 2): /api/dev must answer 403, EXPECT_PUBLIC_LIVE must be "true", both stubs must answer.
import { chromium } from "playwright";
import { STUB_ACCOUNTS, signForChannel } from "./lib/siwf-stub.mjs";
import { waitForDevice } from "./lib/page-health.mjs";

const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
const SIWF = (process.env.SIWF_STUB_URL || "").replace(/\/$/, "");
const RP = (process.env.ROOTPOST_STUB_URL || "").replace(/\/$/, "");
const RP_HUB = (process.env.ROOTPOST_HUB_URL || "").replace(/\/$/, "");
const DESKTOP = { width: 1366, height: 900 };
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

// ---------------------------------------------------------------------------------------------------------------- preflight
const dev = await getJson(BASE + "/api/dev").catch(() => ({ status: 0 }));
if (dev.status !== 403) {
  console.log("  ABORT: GET /api/dev answered " + dev.status + " — run on the production-shaped pair (scripts/run-prod-shape.sh)");
  process.exit(2);
}
if ((process.env.EXPECT_PUBLIC_LIVE || "") !== "true" || (process.env.EXPECT_ROOT_POST || "") !== "armed") {
  console.log("  ABORT: start the pair with PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ROOTPOST=stub");
  process.exit(2);
}
const siwfState = SIWF ? (await getJson(SIWF + "/__stub/state").catch(() => ({ json: null }))).json : null;
const rpState0 = RP ? (await getJson(RP + "/__stub/state").catch(() => ({ json: null }))).json : null;
if (!siwfState || siwfState.ok !== true || !rpState0 || !Array.isArray(rpState0.requests)) {
  console.log("  ABORT: the SIWF stub (" + (SIWF || "unset") + ") or the post-as-you stub (" + (RP || "unset") + ") does not answer /__stub/state");
  process.exit(2);
}
await post(SIWF + "/__stub/reset");
const rp = {
  state: async () => (await getJson(RP + "/__stub/state")).json,
  approve: (userFid, extra = {}) => post(RP + "/__stub/approve", { userFid, ...extra }),
  removeKey: (userFid, key) => post(RP + "/__stub/remove-key", { userFid, key }),
};
async function siwfApprove(who) {
  const st = (await getJson(SIWF + "/__stub/state")).json;
  const ch = st.channels[0];
  if (!ch) throw new Error("the SIWF stub has no channel to approve");
  const { message, signature } = await signForChannel(ch, who, { fid: who.fid });
  const r = await post(SIWF + "/v1/channel/authenticate", { channelToken: ch.token, message, signature, fid: who.fid, username: who.username, displayName: who.displayName, pfpUrl: who.pfpUrl, bio: "stub account", authMethod: "custody" });
  if (r.status !== 200) throw new Error("the SIWF stub refused the approval: " + r.status);
}

// ---------------------------------------------------------------------------------------------------------------- browser
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"] });
const ctx = await browser.newContext({ viewport: DESKTOP });
const page = await ctx.newPage();
const requests = [];
ctx.on("request", (r) => requests.push({ url: r.url(), method: r.method(), body: r.postDataBuffer() ? r.postDataBuffer().toString("hex") : "" }));
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable", { enableUI: false });
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
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
const testid = (id) => page.getByTestId(id).first();
let deviceKey = null;
const FID = STUB_ACCOUNTS.alice.fid;

console.log("\nROOT POST PROD — Allow Totem to post as you (app " + BASE + ", validator " + VBASE + ", stubs " + RP + " / " + RP_HUB + ")");

await check("RP1 the shape: public, live, the app account armed with the stub's fid, and the tab told the hub stub by the app server", async () => {
  const acct = await getJson(VBASE + "/fc/app-account");
  if (acct.json?.ready !== true || acct.json?.appFid !== rpState0.appFid) throw new Error("the validator's app account: " + acct.text.slice(0, 200));
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await waitForDevice(page, 120_000);
  const env = await page.evaluate(() => window.__LAYERS_DEVICE_ENV || {});
  if (env.FC_ROOT_HUB_URL !== RP_HUB || env.PUBLIC_LIVE !== "on") throw new Error("the device env: FC_ROOT_HUB_URL=" + env.FC_ROOT_HUB_URL + " PUBLIC_LIVE=" + env.PUBLIC_LIVE);
  return "app fid " + acct.json.appFid + ", hub " + env.FC_ROOT_HUB_URL;
});

await check("RP2 sign in with Farcaster as @stubalice and keep the identity with a passkey → /home as the root", async () => {
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
  const per = await api("GET", "/api/personas");
  if (!(per.json?.personas || []).some((p) => p.publicSelf === true)) throw new Error("no public self: " + per.text.slice(0, 200));
});

await check("RP3 /home: Posting as @stubalice, what allowing does, the disclosure BEFORE any request, the Allow button, no text box", async () => {
  await testid("composer-posting-as").waitFor({ timeout: 60_000 });
  const as = (await testid("composer-posting-as").innerText()).trim();
  if (as !== "Posting as @stubalice") throw new Error("the composer says " + as);
  if (!/once you allow it/.test(await testid("composer-public-self").innerText())) throw new Error("no line about what allowing does");
  await testid("root-post-allow").waitFor({ timeout: 60_000 });
  if ((await testid("root-post-allow").innerText()).trim() !== "Allow Totem to post as you") throw new Error("the button says " + (await testid("root-post-allow").innerText()));
  const before = await testid("root-post-connect").innerText();
  for (const w of ["keeps it in your vault", "may ask you to pay a small network fee", "sees them (they're public anyway) and your internet address", "post those from another network"]) if (!before.includes(w)) throw new Error("the disclosure lacks: " + w);
  if (await page.getByTestId("root-composer-text").count()) throw new Error("a text box is offered before Totem may post");
  const st = await rp.state();
  if (st.requests.length !== 0) throw new Error("a key request was made before the click");
});

await check("RP4 Allow: the approval with a QR code and a farcaster:// link; ONE request naming the app fid and the tab's own key, made by the validator", async () => {
  await testid("root-post-allow").click();
  await testid("root-post-approve").waitFor({ timeout: 60_000 });
  await testid("root-post-qr").waitFor({ timeout: 10_000 });
  const href = await testid("root-post-link").getAttribute("href");
  if (!/^farcaster:\/\/signed-key-request\?token=0x[0-9a-f]{24}$/.test(href || "")) throw new Error("the link is " + href);
  const st = await rp.state();
  const s = await api("GET", "/api/fc/root");
  deviceKey = s.json?.key;
  if (st.requests.length !== 1 || st.requests[0].requestFid !== st.appFid || st.requests[0].key !== deviceKey || !href.endsWith(st.requests[0].token)) throw new Error("the stub's requests: " + JSON.stringify(st.requests) + " key " + deviceKey);
  if (st.calls.some((c) => c.origin)) throw new Error("the page called Farcaster's API itself");
  if (requests.some((r) => r.url.startsWith(RP))) throw new Error("the browser made a request to the Farcaster API stub");
  return "token " + st.requests[0].token.slice(0, 10) + "…, key " + deviceKey.slice(0, 10) + "…";
});

await check("RP5 REFUSALS: another account's approval is refused in words (no composer); a key the node does not list keeps waiting and never enables the composer", async () => {
  await rp.approve(STUB_ACCOUNTS.bob.fid);
  await testid("root-post-error").waitFor({ timeout: 30_000 });
  const err = await testid("root-post-error").innerText();
  if (!/different Farcaster account/.test(err)) throw new Error("the refusal says: " + err);
  await testid("root-post-allow").waitFor({ timeout: 30_000 });
  if (await page.getByTestId("root-composer").count()) throw new Error("a composer appeared for another account's approval");
  // a fresh request, approved by the right account, whose key never reaches the node
  await testid("root-post-allow").click();
  await testid("root-post-approve").waitFor({ timeout: 60_000 });
  await rp.approve(FID, { addKey: false });
  await page.locator('[data-testid="root-post-approve"][data-stage="waiting_for_hub"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(7000); // two more looks: still waiting, never enabled
  if (await page.getByTestId("root-composer").count()) throw new Error("the composer appeared for a key the node does not list");
  await testid("root-post-cancel").click();
  await testid("root-post-allow").waitFor({ timeout: 30_000 });
  return "other account refused; unlisted key still waiting after 7 s";
});

await check("RP6 the right approval: the root composer, \"Posts go to Farcaster as @stubalice.\" and the main-app note", async () => {
  await testid("root-post-allow").click();
  await testid("root-post-approve").waitFor({ timeout: 60_000 });
  deviceKey = (await api("GET", "/api/fc/root")).json?.key;
  await rp.approve(FID);
  await testid("root-composer").waitFor({ timeout: 60_000 });
  if ((await testid("root-composer-line").innerText()).trim() !== "Posts go to Farcaster as @stubalice.") throw new Error("the line says " + (await testid("root-composer-line").innerText()));
  if (!/hides new posts from accounts that haven't accepted its rules/.test(await testid("root-composer-main-app-note").innerText())) throw new Error("no main-app note");
  const st = await rp.state();
  if (!st.hub.keys.some((k) => k.fidKey === FID + ":" + deviceKey.slice(2) && k.state === 1)) throw new Error("the node does not list the key");
  if (st.hub.signerReads < 1) throw new Error("the tab never read the node");
});

let castHash = null;
await check("RP7 post as the root: the node holds the cast for fid 990777 signed by the tab's key; the line says Posted with its link; Delete removes it", async () => {
  await testid("root-composer-text").fill("hello from my own account, via Totem");
  await testid("root-composer-submit").click();
  await page.locator('[data-testid="root-composer-result"][data-kind="ok"]').waitFor({ timeout: 60_000 });
  const line = await testid("root-composer-result").innerText();
  if (!/Posted to Farcaster as @stubalice\./.test(line) || !/view it on Farcaster/.test(line)) throw new Error("the line says " + line);
  const st = await rp.state();
  const c = st.hub.casts.find((x) => x.text === "hello from my own account, via Totem");
  if (!c || c.fid !== FID || c.removed) throw new Error("the node's casts: " + JSON.stringify(st.hub.casts));
  castHash = c.hash;
  const sub = requests.filter((r) => r.url === VBASE + "/fc/hub/submit").pop();
  if (!sub || !sub.body.includes(deviceKey.slice(2))) throw new Error("the relayed message is not signed by the tab's key");
  await testid("root-composer-delete").click();
  await page.locator('[data-testid="root-composer-result"]', { hasText: "Deleted from Farcaster." }).waitFor({ timeout: 60_000 });
  const st2 = await rp.state();
  if (!st2.hub.casts.find((x) => x.hash === castHash)?.removed) throw new Error("the cast was not removed on the node");
  return castHash.slice(0, 12) + "… posted and deleted";
});

await check("RP8 a node refusal (the key removed in the Farcaster app) is an ERROR with the node's words, never Posted", async () => {
  await rp.removeKey(FID, deviceKey);
  await testid("root-composer-text").fill("this one must not post");
  await testid("root-composer-submit").click();
  await page.locator('[data-testid="root-composer-result"][data-kind="error"]').waitFor({ timeout: 60_000 });
  const line = await testid("root-composer-result").innerText();
  if (!/Not posted/.test(line) || !/invalid signer/.test(line)) throw new Error("the line says " + line);
  const st = await rp.state();
  if (st.hub.casts.some((x) => x.text === "this one must not post")) throw new Error("the refused post landed");
  await post(RP + "/__stub/add-key", { userFid: FID, key: deviceKey });
});

await check("RP9 Settings › Account: Totem can post as @stubalice; Disconnect needs DISCONNECT; then Allow is offered again and the page says how to remove the key", async () => {
  await page.goto(BASE + "/settings/account", { waitUntil: "load", timeout: 120_000 });
  await page.locator('[data-testid="root-post-settings"][data-state="active"]').waitFor({ timeout: 60_000 });
  if (!/Totem can post as @stubalice/.test(await testid("root-post-settings").innerText())) throw new Error("the settings row does not say it can post");
  await testid("root-post-disconnect-confirm").fill("disconnect");
  if (await testid("root-post-disconnect").isEnabled()) throw new Error("Disconnect is enabled without DISCONNECT typed");
  await testid("root-post-disconnect-confirm").fill("DISCONNECT");
  await testid("root-post-disconnect").click();
  await page.locator('[data-testid="root-post-settings"][data-state="none"]').waitFor({ timeout: 60_000 });
  const how = await testid("root-post-remove-how").innerText();
  if (!/Connected apps/.test(how) || !/remove Totem/.test(how)) throw new Error("the page says " + how);
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 120_000 });
  await testid("root-post-allow").waitFor({ timeout: 60_000 });
  if (await page.getByTestId("root-composer").count()) throw new Error("the root composer survived a disconnect");
});

await check("RP10 nothing left the machine and the Farcaster API stub saw no browser Origin (the private key's confinement is scripts/unit-root-post.mjs R5's)", async () => {
  const off = requests.filter((r) => {
    try {
      const h = new URL(r.url).hostname;
      return !["localhost", "127.0.0.1", "::1"].includes(h) && !/^(data|blob|about):/.test(r.url);
    } catch {
      return false;
    }
  });
  if (off.length) throw new Error("requests to other hosts: " + off.slice(0, 3).map((r) => r.url).join(", "));
  const st = await rp.state();
  if (st.violations.length) throw new Error("the stub recorded violations: " + JSON.stringify(st.violations.slice(0, 2)));
  const st2 = (await getJson(VBASE + "/health")).json;
  if (!st2 || st2.ok !== true) throw new Error("the validator is not healthy");
  return requests.length + " requests, all loopback; " + st.requests.length + " key requests, " + st.hub.submits.length + " hub submits";
});

await browser.close();
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log("\n" + (results.length - failed) + "/" + results.length + " checks passed" + (failed ? " — FAILED" : ""));
process.exit(failed ? 1 : 0);
