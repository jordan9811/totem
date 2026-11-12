// SIGN IN WITH X (2026-11-06) — ON THE PRODUCTION SHAPE (Playwright, desktop), against the loopback X stub.
//
//   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_X=stub bash scripts/run-prod-shape.sh scripts/accept-x-signin-prod.mjs
//   (npm run test:x-signin-prod, through the shared harness lock). Without PRODLIVE_X=stub (EXPECT_X_SIGNIN=unset) the
//   same suite checks DORMANCY instead (D1): that is the shape the public site has until the owner arms it.
// The launcher arms the app with the stub's test client id and authorize page and the validator with the same client id
// and the stub's API (scripts/lib/x-api-stub.mjs), and fails the run on any stub violation or any token left unrevoked.
//
// THE NETWORK IS CLOSED: Chromium resolves nothing but loopback; every request of every context is logged; a request to
// any other host fails A8. The real X is never called.
//
//   D1 (dormant pair) the landing's Continue with X is the disabled Soon button; /welcome's welcome screen too; step 1 is
//      "Sign in with Farcaster" with no X card; the tab holds no X_SIGNIN hint; the device answers xsi_dormant; the
//      validator's relay says not armed (names only) and refuses an exchange 503 not_armed
//   A1 the armed shape: the validator's relay is ready (a public client: confidential=false); /welcome hands the tab
//      X_SIGNIN=on and the stub's client id (and never a secret); the landing's Continue with X is a door to /welcome#next
//   A2 THE X PATH, desktop: the landing's Continue with X → Sign in (step 1, the X card with its disclosure) → Continue with
//      X → the identity KEPT before leaving → X's consent page with exactly the PKCE S256 request (client id, the app's
//      /welcome/x, users.read tweet.read, a state, a 43-character challenge) → Authorize → /welcome/x → This is you with
//      the X name, username and picture (held: X's image host is not one the app loads) and "@StubXAlice · Signed in with
//      X" (Show on) → Keep your account (Not now) → /home, with NO persona made; the address bar never kept the code; the
//      tab's stored request is gone; the stub issued ONE token and it was revoked
//   A3 what each party saw: the TAB reached the stub only on its consent pages (never the token or API endpoints), and
//      the validator exactly once (POST /x/signin/exchange); the APP SERVER got the one callback navigation and nothing
//      else carrying the code; neither server's log holds the code or the X account
//   A4 the root as X: /api/onboarding says X signed in, Farcaster not; Pick up where you left off says "You signed in with
//      X" with Connect Farcaster; Following offers Connect Farcaster instead of a Farcaster read; the profile is "Your X
//      account" with @StubXAlice on X and no Farcaster link; the switcher chip says "X · your own account"
//   A5 a replay of the callback URL is refused (xsi_no_request) and never reaches X; a wrong state is refused (xsi_state)
//      before any exchange; Cancel on X is "You didn't allow it" (xsi_denied); a code past X's 30 seconds is xsi_code
//   A6 BOTH: the X-signed-in root connects Farcaster (Sign in with Farcaster on its stub) — one public self, both links;
//      Settings › Account lists both; the profile says "Your Farcaster and X accounts"; the chip "Farcaster and X"
//   A8 zero requests to any host but loopback, in every context; zero stub violations; every token revoked
// ABORTS (exit 2): /api/dev must answer 403, EXPECT_PUBLIC_LIVE must be "true"; armed: X_STUB_URL and SIWF_STUB_URL answer.
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { STUB_ACCOUNTS, signForChannel } from "./lib/siwf-stub.mjs";
import { STUB_CLIENT_ID, STUB_X_USERS } from "./lib/x-api-stub.mjs";
import { waitForDevice } from "./lib/page-health.mjs";

const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
const XSTUB = (process.env.X_STUB_URL || "").replace(/\/$/, "");
const FSTUB = (process.env.SIWF_STUB_URL || "").replace(/\/$/, "");
const MODE = (process.env.EXPECT_X_SIGNIN || "unset").trim();
const LOGDIR = process.env.TEMP || "/tmp";
const DESKTOP = { width: 1366, height: 900 };

const results = [];
const ok = (n, extra) => {
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
    ok(name, typeof extra === "string" ? extra : undefined);
  } catch (e) {
    fail(name, e && e.message ? e.message : String(e));
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

// ---------------------------------------------------------------------------------------------------------------- preflight
const dev = await getJson(BASE + "/api/dev").catch(() => ({ status: 0 }));
if (dev.status !== 403) {
  console.log("  ABORT: GET /api/dev answered " + dev.status + " — run on the production-shaped pair (scripts/run-prod-shape.sh)");
  process.exit(2);
}
if ((process.env.EXPECT_PUBLIC_LIVE || "") !== "true") {
  console.log("  ABORT: EXPECT_PUBLIC_LIVE is not true — start the pair with PRODLIVE_PUBLIC_LIVE=true");
  process.exit(2);
}
if (MODE === "armed") {
  const xs = XSTUB ? (await getJson(XSTUB + "/__stub/state").catch(() => ({ json: null }))).json : null;
  const fs = FSTUB ? (await getJson(FSTUB + "/__stub/state").catch(() => ({ json: null }))).json : null;
  if (!xs || !fs || fs.ok !== true) {
    console.log("  ABORT: X_STUB_URL " + (XSTUB || "(unset)") + " or SIWF_STUB_URL " + (FSTUB || "(unset)") + " does not answer — start the pair with PRODLIVE_X=stub PRODLIVE_SIWF=stub");
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------------------------------------------- browser
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"] });
const allRequests = [];
const isLoopbackUrl = (u) => {
  try {
    const x = new URL(u);
    if (x.protocol === "data:" || x.protocol === "blob:" || x.protocol === "about:") return true;
    const h = x.hostname.replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch {
    return true;
  }
};
async function profile(label) {
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  const p = { label, ctx, page, requests: [], navs: [] };
  ctx.on("request", (r) => {
    const e = { label, url: r.url(), method: r.method(), nav: r.isNavigationRequest() };
    p.requests.push(e);
    allRequests.push(e);
  });
  p.goto = (route) => page.goto(BASE + route, { waitUntil: "load", timeout: 120_000 });
  p.device = () => waitForDevice(page, 120_000);
  p.api = (method, route, body) =>
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
  p.waitStep = async (step, timeout = 60_000) => page.locator(`[data-testid="onboard-step-${step}"]`).waitFor({ timeout });
  p.close = () => ctx.close().catch(() => {});
  return p;
}
const xstub = {
  state: async () => (await getJson(XSTUB + "/__stub/state")).json,
  force: (o) => getJson(XSTUB + "/__stub/force", { method: "POST", body: JSON.stringify(o) }),
};
const fstub = {
  state: async () => (await getJson(FSTUB + "/__stub/state")).json,
  async approve(who) {
    const st = await fstub.state();
    const ch = st.channels[0];
    if (!ch) throw new Error("the Farcaster stub has no channel to approve");
    const { message, signature } = await signForChannel(ch, who, { fid: who.fid });
    const r = await getJson(FSTUB + "/v1/channel/authenticate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelToken: ch.token, message, signature, fid: who.fid, username: who.username, displayName: who.displayName, pfpUrl: who.pfpUrl, bio: "stub account", authMethod: "custody" }),
    });
    if (r.status !== 200) throw new Error("the Farcaster stub refused the approval: " + r.status);
  },
};

/** from step 1 (the X card ready) to X's consent page: returns the authorize request's parameters */
async function toX(P) {
  const card = P.page.locator('[data-testid="xsi-card"][data-state="ready"]');
  await card.waitFor({ timeout: 60_000 });
  await P.page.getByTestId("xsi-disclosure").waitFor({ timeout: 10_000 });
  await P.page.getByTestId("xsi-start").click();
  await P.page.waitForURL((u) => u.origin === XSTUB && u.pathname === "/i/oauth2/authorize", { timeout: 60_000 });
  return Object.fromEntries(new URL(P.page.url()).searchParams);
}
/** the callback navigation's URL (the one request that carries the code), as the browser made it */
const callbackOf = (P) => [...P.requests].reverse().find((r) => r.nav && new URL(r.url).pathname === "/welcome/x" && new URL(r.url).origin === BASE)?.url ?? null;

console.log("\nX SIGN-IN PROD — Sign in with X on the production shape (app " + BASE + ", validator " + VBASE + ", x stub " + (XSTUB || "none") + ", mode " + MODE + ")");

// ---------------------------------------------------------------------------------------------------------------- dormant
if (MODE !== "armed") {
  await check("D1 dormant: Continue with X is Soon on the landing and the welcome screen; step 1 has no X card; no tab hint; the device says xsi_dormant; the relay is not armed", async () => {
    const landing = await getJson(BASE + "/");
    if (!/<button type="button" disabled=""[^>]*data-testid="door-x"[^>]*>Continue with X<span[^>]*>Soon<\/span>/.test(landing.text)) throw new Error("the landing's Continue with X is not the disabled Soon button");
    if (landing.text.includes('data-testid="door-x-on"')) throw new Error("the landing offers Continue with X on a dormant pair");
    const P = await profile("dormant");
    try {
      await P.goto("/welcome");
      await P.device();
      await P.waitStep("welcome");
      if (!(await P.page.getByTestId("onboard-x-soon").isDisabled())) throw new Error("the welcome screen offers Continue with X");
      if (await P.page.getByTestId("onboard-x").count()) throw new Error("an armed X door on a dormant pair");
      const env = await P.page.evaluate(() => window.__LAYERS_DEVICE_ENV || {});
      if ("X_SIGNIN" in env || "X_CLIENT_ID" in env) throw new Error("the tab holds an X hint: " + Object.keys(env).filter((k) => k.startsWith("X_")).join(","));
      const st = await P.api("GET", "/api/x/signin");
      if (st.status !== 200 || st.json?.available !== false || st.json?.code !== "xsi_dormant") throw new Error("the device says " + st.text.slice(0, 160));
      await P.page.getByTestId("onboard-new").click();
      await P.waitStep("farcaster");
      const title = await P.page.locator("h1").first().innerText();
      if (title !== "Sign in with Farcaster" || (await P.page.getByTestId("onboard-x-signin").count())) throw new Error("step 1 changed on a dormant pair: " + title);
    } finally {
      await P.close();
    }
    const cfg = await getJson(VBASE + "/x/signin/config");
    if (cfg.json?.ready !== false || !cfg.json.problems.some((p) => /^X_CLIENT_ID is unset/.test(p))) throw new Error("the relay config: " + cfg.text.slice(0, 200));
    const ex = await getJson(VBASE + "/x/signin/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "c".repeat(20), codeVerifier: "v".repeat(43), redirectUri: BASE + "/welcome/x", clientId: "x" }) });
    if (ex.status !== 503 || ex.json?.code !== "not_armed") throw new Error("the relay answered " + ex.status + " " + ex.text.slice(0, 120));
    return "Soon everywhere; xsi_dormant; relay 503 not_armed";
  });
} else {
  // -------------------------------------------------------------------------------------------------------------- armed
  await check("A1 the armed shape: the relay is ready (a public client); /welcome hands the tab X_SIGNIN=on and the client id, never a secret; the landing's Continue with X is a door", async () => {
    const cfg = await getJson(VBASE + "/x/signin/config");
    if (cfg.json?.ready !== true || cfg.json.confidential !== false) throw new Error("the relay config: " + cfg.text.slice(0, 200));
    const html = (await getJson(BASE + "/welcome")).text;
    if (!/X_SIGNIN[\\"]*:[\\"]*on/.test(html) || !html.includes(STUB_CLIENT_ID)) throw new Error("/welcome carries no X_SIGNIN=on hint with the client id");
    if (/X_CLIENT_SECRET/.test(html)) throw new Error("/welcome names a client secret");
    const landing = (await getJson(BASE + "/")).text;
    if (!/<a href="\/welcome#next"[^>]*data-testid="door-x-on"/.test(landing)) throw new Error("the landing's Continue with X is not a door to /welcome#next");
    if (landing.includes('data-testid="door-x"')) throw new Error("the landing still shows the Soon button beside the door");
    return "relay ready (public client); hint + client id; door → /welcome#next";
  });

  const A = await profile("A");
  let cb = null;
  let authz = null;
  await check("A2 THE X PATH: Continue with X → Sign in → kept → X (S256, the callback, two scopes) → Authorize → This is you (X name, username, held picture, Signed in with X) → Not now → /home; no persona; the code left the address bar; one token, revoked", async () => {
    const before = await xstub.state();
    await A.goto("/");
    await A.page.getByTestId("door-x-on").click();
    await A.page.waitForURL((u) => u.pathname === "/welcome" && u.hash === "#next", { timeout: 60_000 });
    const info = await A.device();
    if (info.persistent === true || info.restored === true) throw new Error("a fresh visitor's identity was already kept");
    await A.waitStep("farcaster");
    if ((await A.page.locator("h1").first().innerText()) !== "Sign in") throw new Error("armed step 1 is not 'Sign in'");
    await A.page.getByTestId("onboard-x-signin").waitFor({ timeout: 30_000 });
    authz = await toX(A);
    const keys = Object.keys(authz).sort().join(",");
    if (keys !== "client_id,code_challenge,code_challenge_method,redirect_uri,response_type,scope,state") throw new Error("the authorize parameters: " + keys);
    if (authz.client_id !== STUB_CLIENT_ID || authz.redirect_uri !== BASE + "/welcome/x" || authz.scope !== "users.read tweet.read" || authz.code_challenge_method !== "S256" || authz.response_type !== "code") throw new Error("a parameter: " + JSON.stringify(authz));
    if (!/^[A-Za-z0-9_-]{43}$/.test(authz.code_challenge) || authz.state.length < 22) throw new Error("a weak challenge or state");
    await A.page.getByTestId("x-stub-authorize").click();
    await A.page.waitForURL((u) => u.pathname === "/welcome" && u.hash === "#profile", { timeout: 90_000 });
    cb = callbackOf(A);
    if (!cb || !new URL(cb).searchParams.get("code")) throw new Error("no callback navigation with a code was seen");
    const after = await A.device();
    if (after.restored !== true) throw new Error("the identity was not kept across the trip to X (restored=" + after.restored + ")");
    if (/[?&]code=/.test(A.page.url())) throw new Error("the address bar still holds the code: " + A.page.url());
    await A.page.getByTestId("onboard-profile").waitFor({ timeout: 60_000 });
    const name = await A.page.getByTestId("onboard-profile-name").inputValue();
    const handle = await A.page.getByTestId("onboard-profile-handle").inputValue();
    const held = await A.page.getByTestId("onboard-profile-picture").getAttribute("data-held");
    const xrow = A.page.getByTestId("onboard-x-row");
    if (name !== STUB_X_USERS.alice.name || handle !== "stubxalice") throw new Error("This is you shows " + name + " @" + handle);
    if (held !== "true") throw new Error("X's picture was loaded (its host is not one the app loads by itself)");
    if ((await xrow.getAttribute("data-state")) !== "signed-in" || !(await xrow.innerText()).includes("@StubXAlice") || !(await A.page.getByTestId("onboard-x-show").isChecked())) throw new Error("the X row: " + (await xrow.innerText()));
    if (!(await A.page.getByText("Your X username stays @StubXAlice on X").count()) && (await A.page.getByTestId("onboard-profile-taken").count())) throw new Error("a taken username without the X promise");
    await A.page.getByTestId("onboard-next").click();
    await A.waitStep("save");
    await A.page.getByTestId("onboard-keep").click();
    await A.page.waitForURL((u) => u.pathname === "/home", { timeout: 90_000 });
    const per = await A.api("GET", "/api/personas");
    const own = (per.json?.personas || []).filter((p) => p.publicSelf !== true);
    const selves = (per.json?.personas || []).filter((p) => p.publicSelf === true);
    if (own.length || selves.length !== 1 || selves[0].handle !== "stubxalice") throw new Error("the roster: " + per.text.slice(0, 200));
    const pending = await A.page.evaluate(() => sessionStorage.getItem("totem:x-signin"));
    if (pending !== null) throw new Error("the tab still holds the sign-in request");
    const st = await xstub.state();
    if (st.tokens.issued - before.tokens.issued !== 1 || st.tokens.revoked - before.tokens.revoked !== 1) throw new Error("tokens: " + JSON.stringify(st.tokens));
    if (st.lastFields !== "profile_image_url,verified,verified_type") throw new Error("users/me was asked for " + st.lastFields);
    return "@StubXAlice → @stubxalice; kept, restored after X; 1 token issued and revoked; 0 personas";
  });

  await check("A3 what each party saw: the tab reached the stub only on its consent pages and the validator once; the app server got the one callback; no server log holds the code or the X account", async () => {
    if (!cb) throw new Error("A2 did not finish");
    const code = new URL(cb).searchParams.get("code");
    const toStub = A.requests.filter((r) => r.url.startsWith(XSTUB + "/"));
    const off = toStub.filter((r) => !new URL(r.url).pathname.startsWith("/i/oauth2/authorize") && new URL(r.url).pathname !== "/favicon.ico");
    if (off.length) throw new Error("the tab called the X stub beyond its consent pages: " + off.map((r) => r.method + " " + new URL(r.url).pathname).join(", "));
    const exchanges = A.requests.filter((r) => r.url.startsWith(VBASE + "/x/signin/") && r.method === "POST");
    if (exchanges.length !== 1) throw new Error(exchanges.length + " exchange(s) to the validator (expected exactly one)");
    const appWithCode = A.requests.filter((r) => r.url.startsWith(BASE) && r.url.includes(code));
    if (appWithCode.length !== 1 || !appWithCode[0].nav) throw new Error(appWithCode.length + " request(s) to the app carried the code (expected the one callback navigation)");
    const scanned = [];
    for (const f of ["layers-app.log", "layers-validator.log"]) {
      const p = path.join(LOGDIR, f);
      if (!existsSync(p)) continue;
      const text = readFileSync(p, "utf8");
      scanned.push(f + " " + text.length + "B");
      for (const needle of [code, STUB_X_USERS.alice.username, STUB_X_USERS.alice.id, authz.state]) if (text.includes(needle)) throw new Error(f + " holds " + (needle === code ? "the code" : needle === authz.state ? "the state" : "the X account"));
    }
    if (!scanned.length) throw new Error("no server log to scan (vacuous)");
    return toStub.length + " consent-page request(s), 1 exchange, 1 callback; scanned " + scanned.join(", ");
  });

  await check("A4 the root as X: X signed in, Farcaster not; Pick up says so with Connect Farcaster; Following offers Connect Farcaster; the profile is 'Your X account'; the chip says X", async () => {
    const ob = await A.api("GET", "/api/onboarding");
    if (ob.json?.publicSelf !== false || ob.json?.xSignedIn !== true) throw new Error("/api/onboarding: " + ob.text.slice(0, 160));
    await A.goto("/home");
    await A.device();
    await A.page.getByTestId("pickup-people-x-only").waitFor({ timeout: 60_000 });
    if ((await A.page.getByTestId("pickup-connect-farcaster").getAttribute("href")) !== "/welcome#farcaster") throw new Error("Connect Farcaster does not go to the Sign in step");
    // the account menu: the root's row names the account it is (X), never "Farcaster"
    await A.page.getByTestId("account-switcher-button").click();
    await A.page.getByTestId("account-switcher").waitFor({ timeout: 30_000 });
    const chipLoc = A.page.getByTestId("account-switcher").getByTestId("public-self-chip");
    await chipLoc.waitFor({ timeout: 30_000 });
    let chip = "";
    for (let i = 0; i < 40 && !/^X · /.test(chip); i++) {
      chip = (await chipLoc.innerText()).trim();
      if (!/^X · /.test(chip)) await A.page.waitForTimeout(250);
    }
    if (!/^X · your own account/.test(chip)) throw new Error("the switcher chip says " + chip);
    await A.page.keyboard.press("Escape");
    await A.goto("/home?tab=following");
    await A.device();
    await A.page.getByTestId("connect-farcaster").waitFor({ timeout: 60_000 });
    if (await A.page.locator('[data-testid^="hub-following"]').count()) throw new Error("Following read Farcaster for an X-only root");
    await A.goto("/stubxalice");
    await A.device();
    await A.page.getByTestId("public-self-profile").waitFor({ timeout: 60_000 });
    const body = await A.page.evaluate(() => document.body.innerText);
    if (!body.includes("Your X account")) throw new Error("the profile does not say 'Your X account'");
    if (await A.page.getByTestId("open-on-farcaster").count()) throw new Error("an X-only root's profile links to farcaster.xyz");
    const xa = A.page.getByTestId("public-self-x");
    if ((await xa.getAttribute("href")) !== "https://x.com/StubXAlice") throw new Error("the X link: " + (await xa.getAttribute("href")));
    const live = await A.api("GET", "/api/profile?handle=stubxalice&live=1");
    if (live.status !== 409 || live.json?.code !== "not_farcaster") throw new Error("live=1 on an X-only root answered " + live.status + " (it must never become a Farcaster lookup)");
    return "flags, Pick up, Following, profile, live=1 refused";
  });

  await check("A5 refusals: a replayed callback (xsi_no_request, X never asked); a wrong state (xsi_state, no exchange); Cancel on X (xsi_denied); a code past 30 seconds (xsi_code)", async () => {
    if (!cb) throw new Error("A2 did not finish");
    const calls0 = (await xstub.state()).tokenCalls;
    await A.page.goto(cb, { waitUntil: "load", timeout: 120_000 });
    await A.page.locator('[data-testid="xsi-callback"][data-state="refused"]').waitFor({ timeout: 90_000 });
    if ((await A.page.getByTestId("xsi-callback").getAttribute("data-code")) !== "xsi_no_request") throw new Error("a replay: " + (await A.page.getByTestId("xsi-callback").getAttribute("data-code")));
    if ((await xstub.state()).tokenCalls !== calls0) throw new Error("a replayed callback reached X");
    const outcomes = [];
    for (const [label, how, want] of [
      ["wrong state", "state", "xsi_state"],
      ["cancel", "cancel", "xsi_denied"],
      ["30 seconds", "slow", "xsi_code"],
    ]) {
      const B = await profile("B-" + how);
      try {
        await B.goto("/welcome#farcaster");
        await B.device();
        await B.waitStep("farcaster");
        if (how === "slow") await xstub.force({ codeTtlMs: 0 });
        const q = await toX(B);
        const callsBefore = (await xstub.state()).tokenCalls;
        if (how === "state") {
          // X's real answer, with the state swapped (an answer this tab did not ask for)
          const link = await B.page.getByTestId("x-stub-authorize").getAttribute("href");
          const r = await fetch(XSTUB + link, { redirect: "manual" });
          const loc = new URL(r.headers.get("location"));
          loc.searchParams.set("state", "Z".repeat(32));
          await B.page.goto(loc.toString(), { waitUntil: "load", timeout: 120_000 });
        } else if (how === "cancel") await B.page.getByTestId("x-stub-cancel").click();
        else await B.page.getByTestId("x-stub-authorize").click();
        await B.page.locator('[data-testid="xsi-callback"][data-state="refused"]').waitFor({ timeout: 90_000 });
        const got = await B.page.getByTestId("xsi-callback").getAttribute("data-code");
        if (got !== want) throw new Error(label + ": " + got + " — " + (await B.page.getByTestId("xsi-callback-error").innerText().catch(() => "")));
        const callsAfter = (await xstub.state()).tokenCalls;
        if (how !== "slow" && callsAfter !== callsBefore) throw new Error(label + " reached X's token endpoint");
        const ob = await B.api("GET", "/api/onboarding");
        if (ob.json?.xSignedIn !== false) throw new Error(label + " linked an X account");
        if (q.state.length < 22) throw new Error("weak state");
        outcomes.push(label + " → " + got);
      } finally {
        if (how === "slow") await xstub.force({ codeTtlMs: 30_000 });
        await B.close();
      }
    }
    return "replay → xsi_no_request; " + outcomes.join("; ");
  });

  await check("A6 BOTH: the X root connects Farcaster — one public self, both links; Settings › Account lists both; the profile says both", async () => {
    await A.goto("/welcome#farcaster");
    await A.device();
    await A.waitStep("farcaster");
    await A.page.getByTestId("link-farcaster").click();
    await A.page.getByTestId("siwf-qr").waitFor({ timeout: 45_000 });
    await fstub.approve(STUB_ACCOUNTS.alice);
    await A.page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
    const ob = await A.api("GET", "/api/onboarding");
    if (ob.json?.publicSelf !== true || ob.json?.xSignedIn !== true) throw new Error("/api/onboarding: " + ob.text.slice(0, 160));
    const per = await A.api("GET", "/api/personas");
    const selves = (per.json?.personas || []).filter((p) => p.publicSelf === true);
    if (selves.length !== 1 || selves[0].handle !== "stubxalice") throw new Error("public selves: " + JSON.stringify(selves.map((p) => p.handle)));
    await A.goto("/settings/account");
    await A.device();
    await A.page.locator('[data-testid="account-farcaster"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
    await A.page.locator('[data-testid="account-x"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
    await A.goto("/stubxalice");
    await A.device();
    await A.page.getByTestId("public-self-profile").waitFor({ timeout: 60_000 });
    const body = await A.page.evaluate(() => document.body.innerText);
    if (!body.includes("Your Farcaster and X accounts")) throw new Error("the profile does not name both accounts");
    if (!(await A.page.getByTestId("open-on-farcaster").count())) throw new Error("the profile lost its Farcaster link");
    await A.page.getByTestId("account-switcher-button").click();
    const chipLoc = A.page.getByTestId("account-switcher").getByTestId("public-self-chip");
    await chipLoc.waitFor({ timeout: 30_000 });
    let chip = "";
    for (let i = 0; i < 40 && !/^Farcaster and X · /.test(chip); i++) {
      chip = (await chipLoc.innerText()).trim();
      if (!/^Farcaster and X · /.test(chip)) await A.page.waitForTimeout(250);
    }
    if (!/^Farcaster and X · your own account/.test(chip)) throw new Error("the switcher chip says " + chip);
    return "1 public self; Farcaster + X rows; both on the profile and the chip";
  });

  await check("A8 the network and the stub: zero non-loopback requests; zero stub violations; every token revoked", async () => {
    const st = await xstub.state();
    if (st.violations.length) throw new Error("stub violations: " + JSON.stringify(st.violations.slice(0, 4)));
    if (st.tokens.issued !== st.tokens.revoked) throw new Error(st.tokens.issued - st.tokens.revoked + " token(s) left alive");
    if (st.preflights) throw new Error(st.preflights + " preflight(s) on X's API");
    return st.authorizes + " consent page(s), " + st.tokens.issued + " token(s), all revoked";
  });
  await A.close();
}

const external = allRequests.filter((r) => !isLoopbackUrl(r.url));
if (external.length) fail("A8 no request leaves the machine", external.length + " request(s) to other hosts: " + [...new Set(external.map((r) => new URL(r.url).host))].join(", "));
else ok("A8 no request leaves the machine", allRequests.length + " requests, all loopback");

await browser.close();
const failedN = results.filter((r) => r[0] === "FAIL").length;
console.log("\n" + (results.length - failedN) + "/" + results.length + " checks passed" + (failedN ? " — FAILED: " + results.filter((r) => r[0] === "FAIL").map((r) => r[1].split(" ")[0]).join(",") : ""));
process.exit(failedN ? 1 : 0);
