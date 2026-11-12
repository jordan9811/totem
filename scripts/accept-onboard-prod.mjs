// PUBLIC GO-LIVE — THE GUIDED FIRST RUN AND PUBLIC LIVE MODE ON THE PRODUCTION SHAPE (Playwright: desktop, Pixel 5, iPhone).
//
// The production-shaped pair in LIVE mode, with the Sign in with Farcaster stub:
//   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub bash scripts/run-prod-shape.sh scripts/accept-onboard-prod.mjs
//   (npm run test:onboard-prod; run by the verify agent — it starts servers)
// The launcher sets PUBLIC_LIVE=true on both processes and EXPECT_PUBLIC_LIVE=true for this suite, and points the app at
// the loopback SIWF stub (scripts/lib/siwf-stub.mjs). Every passkey is Chromium's virtual authenticator (CDP, PRF).
//
// THE NETWORK IS CLOSED: Chromium is launched with a host-resolver rule that resolves NOTHING but localhost and 127.0.0.1,
// and every request of every context is logged; a request to any other host fails the run (O12) — so a stray avatar host,
// a relay, a chain node or api.dicebear.com can never be reached from here, and is caught if it is tried.
//
//   O1  the shape: /api/dev 403 (public), EXPECT_PUBLIC_LIVE=true, the stub answers; a booted tab's device env says
//       PUBLIC_LIVE=on
//   O2  NO DEMO WORLD in live mode: the landing (the owner's doors, no preview pill), /home for a guest and /welcome name no
//       seeded handle, fixture name, trend or news title, and no fixture identity — in the DOM, in the server's HTML and
//       in the network log; the device minted NO persona
//   O2m THE MUTATION: the same scan on a tab whose device env has PUBLIC_LIVE stripped by a page script (the device then
//       boots the demo world) MUST find fixture content — otherwise O2 is vacuous
//   O3  THE OWNER'S FLOW (2026-11-05) on a desktop: the landing's Sign in with Farcaster → /welcome#next → Sign in with
//       Farcaster (step 1 of 3, three dots) → This is you → Keep your account → /home, in that order, with NO persona step
//       ever shown and NO persona made (the order check is self-tested against a doctored order and a persona step)
//   O4  the stub's sign-in becomes the identity's read-only public self (the stub saw one idOf and zero violations), and
//       This is you showed its Farcaster name and username, its picture held (its host is not one the app loads)
//   O5  a passkey save, then a reload, restores the identity (same anchor, the root and the persona are still there)
//   O6  This is you's X row shows the verified handle from a stub index served for the device's WHOLE-FILE download (one
//       GET of /x/fc-index, no per-account request, no read-relay request), with Show on, and Show is kept on the root's
//       profile (GET /api/profile publicSelf.xShown)
//   O7  /home as the root: "Posting as @you", what allowing Totem to post as you does, and the device's own answer (on a
//       pair with no app account: "isn't switched on on this site yet"; EXPECT_ROOT_POST=armed: the Allow button), no
//       composer input; "Pick up where you left off" with its three rows (FOLLOWING FROM THE HUB: Find your people → /fc/following
//       with the root's real follows count read from the hub stub, EXPECT_HUB=stub, and the X archive's link below it;
//       before: Find your people → Settings › Import from
//       X's people panel, Farcaster follows said to be coming; Bring your X posts; Make a persona); the persona made from
//       the card (optional) is anon by default, with a picture made on the device (a data: URI) and the anon route's own
//       sentence about where its posts go, word for word
//   O8  with a persona the composer is the real one; the live timeline says live reads are not switched on (this pair
//       arms none) and shows no demo world
//   O9  THE RETURNING VISITOR never sees the flow: (a) a reload of /welcome goes straight to /home; (b) with this
//       browser's site data cleared, /welcome#unlock + the passkey unlocks the identity and goes straight to /home
//   O10 the guest path: the landing's "Just looking?" door is /anon; a guest's /home says "Sign in with Farcaster to post"
//       (→ /welcome#next), the timeline's live NoPersonaYet (→ /welcome#next), no card, no error, no mode pill waiting on a
//       read that is never made
//   O11 Not now keeps the identity in this browser only (no passkey): a reload restores it, and the signed-in root with NO
//       persona is a returning visitor (/welcome → /home)
//   O12 phones: on Pixel 5 and iPhone the Farcaster step says it keeps the identity first, and the identity IS kept before
//       the "Open in the Farcaster app" link exists; Pixel 5 walks to /home (the card, no persona)
//   O16 This is you with a username taken inside Totem: the owner's words, three tap targets, the Farcaster username stays;
//       the one tapped is saved as the root's Totem username (GET ?profile=1 is marked taken in the tab: this pair's empty
//       world holds no other account to crowd the namespace for real); the Farcaster username is untouched
//   O13 zero requests to api.dicebear.com, and zero requests to any host but loopback, across every context
//
// PUBLIC GO-LIVE (fix pass F1, F2, F5, F8, F10):
//   O9c a returning visitor that is DONE, sent to /welcome#farcaster (the app's own form: the target rides the hash, which
//       never reaches the server) or /welcome?step=farcaster (an older link), lands on the Farcaster step (O9a is the
//       control: without the target it goes home); /welcome#unlock opens the unlock for that same not-fresh visitor
//   O10 (amended) the timeline's link goes to /welcome#next and lands PAST the welcome screen; the welcome screen's guest
//       door in live mode is the anonymous feed (/anon), not an empty /home; no request this context made names a target
//       (the server never learns where a visitor jumped)
//   O12 (amended, iPhone) a reload after the identity was kept for the app switch lands on the Farcaster step (never
//       Welcome) and says the waiting sign-in must start again
//   O14 THE ANONYMOUS UNIVERSE HINT FROM THE SERVER, NO INJECTION (F1): no init script, no env patch — what the app's own
//       server rendered into /anon and /home (the HTML's flight data) and what a tab's window.__LAYERS_DEVICE_ENV then
//       holds. EXPECT_ANON_UNIVERSE (scripts/run-prod-shape.sh PRODLIVE_ANON_UNIVERSE) says which pair this is:
//       "unset" (the default run): no ZK_ANON_UNIVERSE anywhere and ZK_MODE not live; "live": ZK_ANON_UNIVERSE=live AND
//       ZK_MODE=live on both pages. The HTML reader is self-tested against a doctored payload both ways. The live run:
//         PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ANON_UNIVERSE=live ONBOARD_ONLY=O14 \
//           bash scripts/run-prod-shape.sh scripts/accept-onboard-prod.mjs
//       (the launcher itself refuses to run suites on a live-universe pair whose /anon lacks the hint: the build predates
//       the fix). The code mutation (the spread dropped) is scripts/unit-onboarding.mjs U11's.
//   O15 SIGN IN AGAIN TO JOIN THE LIVE CROWD (F2, F5): a tab whose device env carries the live hint (INJECTED here: the
//       default pair has no armed relay — O14 is the check without injection) and whose GET /api/anon answers as the armed
//       live crowd answers a root that is not in it (lib/zk/anon/availability.ts ANON_LIVE_SIGN_IN_FIRST, read from that
//       file; a fetch wrapper installed after the device booted, so only that one read is stubbed): once signed in, the
//       card offers "Sign in again with Farcaster to join the anonymous crowd" after the disclosure; pressing it starts a
//       sign-in whose nonce BINDS this identity's crowd commitment (the stub's new channel nonce == lib/zk/anon/fcJoin.ts
//       joinNonceFor(commitment, salt), recomputed here); once a persona is made on /home's card, the composer carries the same way forward
//       (composer-anon-rejoin → /welcome#farcaster) and the target lands on the Farcaster step for a visitor the
//       machine would otherwise hand home, with no request naming it. THE CONTROL: the same stub without the hint offers
//       nothing (data-rejoin "na").
// ONBOARD_ONLY=O14,O15 (names, comma-separated) runs only those checks.
// ABORTS (exit 2): /api/dev must answer 403, EXPECT_PUBLIC_LIVE must be "true", SIWF_STUB_URL must answer /__stub/state.
import { chromium, devices } from "playwright";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STUB_ACCOUNTS, signForChannel } from "./lib/siwf-stub.mjs";
import { FIXTURE_IDENTITY_NEEDLES, FIXTURE_SELF_NEEDLES, describeHits, inlineErrors, scanNeedles, waitForDevice } from "./lib/page-health.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const STUB = (process.env.SIWF_STUB_URL || "").replace(/\/$/, "");
const DESKTOP = { width: 1366, height: 900 };

const results = [];
// PUBLIC GO-LIVE: ONBOARD_ONLY=O14,O15 runs only the named checks (the live-universe pair runs O14 alone)
const ONLY = (process.env.ONBOARD_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
const EXPECT_UNIVERSE = (process.env.EXPECT_ANON_UNIVERSE || "unset").trim();
const ok = (n, extra) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n + (extra ? " — " + extra : ""));
};
const fail = (n, d) => {
  results.push(["FAIL", n, d]);
  console.log("  FAIL  " + n + (d ? " — " + d : ""));
};
async function check(name, fn) {
  if (ONLY.length && !ONLY.includes(name.split(" ")[0])) return;
  try {
    const extra = await fn();
    ok(name, typeof extra === "string" ? extra : undefined);
  } catch (e) {
    fail(name, e && e.message ? e.message : String(e));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  console.log("  ABORT: EXPECT_PUBLIC_LIVE is not true — start the pair with PRODLIVE_PUBLIC_LIVE=true (this suite measures live mode only)");
  process.exit(2);
}
const stubState = STUB ? (await getJson(STUB + "/__stub/state").catch(() => ({ json: null }))).json : null;
if (!stubState || stubState.ok !== true) {
  console.log("  ABORT: SIWF_STUB_URL " + (STUB || "(unset)") + " does not answer /__stub/state — start the pair with PRODLIVE_SIWF=stub");
  process.exit(2);
}
const stub = {
  state: async () => (await getJson(STUB + "/__stub/state")).json,
  reset: () => getJson(STUB + "/__stub/reset", { method: "POST" }),
  /** act as the wallet on the newest channel */
  async approve(who) {
    const st = await stub.state();
    const ch = st.channels[0];
    if (!ch) throw new Error("the stub has no channel to approve");
    const { message, signature } = await signForChannel(ch, who, { fid: who.fid });
    const r = await getJson(STUB + "/v1/channel/authenticate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelToken: ch.token, message, signature, fid: who.fid, username: who.username, displayName: who.displayName, pfpUrl: who.pfpUrl, bio: "stub account", authMethod: "custody" }),
    });
    if (r.status !== 200) throw new Error("the stub refused the approval: " + r.status);
    return ch;
  },
};
await stub.reset();

// ---------------------------------------------------------------------------------------------------------------- needles
// The demo world, from the bank files themselves: every seeded handle (the fixture users and the seed personas), the
// fixture trends and news, and the fixture identity the chrome must never name. Handles are matched as @handle or as a
// whole word of 5+ characters; titles as whole strings.
const data = JSON.parse(readFileSync(path.join(ROOT, "lib/fixtures/data.json"), "utf8"));
const accounts = JSON.parse(readFileSync(path.join(ROOT, "seed/data/accounts.json"), "utf8"));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const handles = [...new Set([...data.users.map((u) => u.username), ...accounts.personas.map((p) => p.handle)].filter((h) => typeof h === "string" && h.length >= 5))];
const FIXTURE_NEEDLES = [
  ...FIXTURE_IDENTITY_NEEDLES,
  ...FIXTURE_SELF_NEEDLES,
  ...handles.map((h) => ({ label: "seeded @" + h, re: new RegExp("(?<![\\w.])@?" + esc(h) + "(?![\\w])", "i") })),
  ...(data.trends || []).filter((t) => t && t.title && t.title.length >= 8).map((t) => ({ label: "fixture trend " + t.title, re: new RegExp(esc(t.title)) })),
  ...(data.news || []).filter((n) => n && n.title && n.title.length >= 8).map((n) => ({ label: "fixture news " + n.title.slice(0, 30), re: new RegExp(esc(n.title)) })),
];

// ---------------------------------------------------------------------------------------------------------------- browser
// resolve NOTHING but loopback: a request to any other host cannot leave the machine, and is logged (O13)
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

async function profile(label, { deviceName = null, initScript = null } = {}) {
  const opts = deviceName ? { ...devices[deviceName] } : { viewport: DESKTOP };
  const ctx = await browser.newContext(opts);
  if (initScript) await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  const p = { label, ctx, page, requests: [], errors: [] };
  ctx.on("request", (r) => {
    const e = { label, url: r.url(), method: r.method() };
    p.requests.push(e);
    allRequests.push(e);
  });
  page.on("pageerror", (e) => p.errors.push(String(e).slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
  });
  p.cdp = cdp;
  p.passkeys = async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials.length;
  p.goto = async (route) => {
    await page.goto(BASE + route, { waitUntil: "load", timeout: 120_000 });
  };
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
  p.step = async () => page.evaluate(() => document.querySelector('[data-testid="onboarding"]')?.getAttribute("data-step") ?? (document.querySelector('[data-testid="onboard-done"]') ? "done" : null));
  p.waitStep = async (step, timeout = 60_000) => {
    await page.locator(`[data-testid="onboard-step-${step}"]`).waitFor({ timeout });
    return step;
  };
  p.text = () => page.evaluate(() => document.body.innerText);
  p.close = () => ctx.close().catch(() => {});
  return p;
}

/** the order check, and its own self-test (a doctored order must be refused) */
const FLOW = ["farcaster", "profile", "save", "done"];
function inOrder(seen) {
  const idx = seen.map((s) => FLOW.indexOf(s));
  if (idx.some((i) => i < 0)) return false;
  for (let i = 1; i < idx.length; i++) if (idx[i] <= idx[i - 1]) return false;
  return JSON.stringify(seen) === JSON.stringify(FLOW);
}
/** what the anon route says about where a post goes (lib/onboarding/state.ts destinationSentenceOf, restated) */
function expectedWhere(j) {
  if (j && typeof j === "object" && ["farcaster", "layers", "off"].includes(j.destination) && typeof j.destinationSentence === "string" && j.destinationSentence.trim()) return j.destinationSentence;
  if (j && j.previewOnly === true && typeof j.previewSentence === "string" && j.previewSentence.trim()) return j.previewSentence;
  if (j && j.available === false && typeof j.unavailableReason === "string" && j.unavailableReason.trim()) return j.unavailableReason;
  return null;
}

console.log("\nONBOARD PROD — the guided first run and public live mode (app " + BASE + ", siwf stub " + STUB + ")");

// ---------------------------------------------------------------------------------------------------------------- O1 + O2
let guest = null;
await check("O1 the shape: public (/api/dev 403), live (EXPECT_PUBLIC_LIVE), a booted tab's device env says PUBLIC_LIVE=on", async () => {
  guest = await profile("guest");
  await guest.goto("/home");
  await guest.device();
  const env = await guest.page.evaluate(() => (window.__LAYERS_DEVICE_ENV ? { ...window.__LAYERS_DEVICE_ENV } : null));
  if (!env || env.PUBLIC_LIVE !== "on") throw new Error("the device env: PUBLIC_LIVE=" + (env ? env.PUBLIC_LIVE : "(no env)"));
  return "PUBLIC_LIVE=on in the tab";
});

async function noDemoWorld(p, where) {
  const hits = scanNeedles(await p.text(), FIXTURE_NEEDLES);
  if (hits.length) throw new Error(where + " shows the demo world: " + describeHits(hits.slice(0, 4)));
}

await check("O2 no demo world: the landing (the owner's doors, no preview pill), /home for a guest and /welcome name nothing seeded — DOM, server HTML, network log — and the device minted no persona", async () => {
  if (!guest) throw new Error("no guest profile");
  const html = (await getJson(BASE + "/")).text;
  for (const id of ["door-start", "door-x", "door-unlock", "door-get-farcaster", "door-app", "door-docs", "landing-help", "landing-status"]) if (!html.includes(`data-testid="${id}"`)) throw new Error("the live landing lacks " + id);
  if (html.includes('data-testid="landing-preview-pill"')) throw new Error("the live landing still says preview");
  if (!/href="\/welcome#next"[^>]*data-testid="door-start"[^>]*>Sign in with Farcaster</.test(html)) throw new Error("Sign in with Farcaster does not go to /welcome#next");
  if (!/<button type="button" disabled=""[^>]*data-testid="door-x"[^>]*>Continue with X<span[^>]*>Soon<\/span>/.test(html)) throw new Error("Continue with X is not a disabled button marked Soon");
  if (!/href="https:\/\/farcaster\.xyz"[^>]*data-testid="door-get-farcaster"[^>]*>Get one free</.test(html)) throw new Error("no 'Get one free' link to farcaster.xyz");
  if (!html.includes(">One you. Many personas.</h1>") || !html.includes("Your Farcaster account, plus as many other faces as you want. You decide who sees which one is you.")) throw new Error("the landing lacks the owner's headline or line");
  if (/context collapse/i.test(html)) throw new Error("the live landing still carries the context-collapse paragraph");
  await guest.goto("/");
  await noDemoWorld(guest, "the landing");
  // /home, server HTML first (the right rail is server-rendered): no fixture trend, news, room or person
  const homeHtml = (await getJson(BASE + "/home")).text;
  // the TEXT the server rendered (scripts, styles and attribute values out: a numeric chunk name is not a fid)
  const homeText = homeHtml.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
  const htmlHits = scanNeedles(homeText, FIXTURE_NEEDLES);
  if (htmlHits.length) throw new Error("the server's /home HTML carries the demo world: " + describeHits(htmlHits.slice(0, 3)));
  await guest.goto("/home");
  await guest.device();
  await guest.page.locator('[data-testid="composer-no-persona"], [data-testid="feed-error"]').first().waitFor({ timeout: 60_000 });
  await sleep(1500);
  await noDemoWorld(guest, "/home");
  const errs = await inlineErrors(guest.page);
  if (errs.length) throw new Error("/home shows an error: " + errs.slice(0, 2).join("; "));
  const per = await guest.api("GET", "/api/personas");
  if (!Array.isArray(per.json?.personas) || per.json.personas.length !== 0) throw new Error("the device minted personas in live mode: " + per.text.slice(0, 160));
  await guest.goto("/welcome");
  await guest.device();
  await guest.waitStep("welcome");
  await noDemoWorld(guest, "/welcome");
  const netHits = guest.requests.filter((r) => handles.some((h) => r.url.toLowerCase().includes(h.toLowerCase())));
  if (netHits.length) throw new Error("the network log names a seeded handle: " + netHits.slice(0, 2).map((r) => r.url).join(", "));
  return "landing, /home, /welcome clean; 0 personas minted; " + FIXTURE_NEEDLES.length + " needles";
});

await check("O2m THE MUTATION: a tab whose device env has PUBLIC_LIVE stripped boots the demo world, and the same scan FINDS it (O2 is not vacuous)", async () => {
  const m = await profile("mutant", {
    initScript: () => {
      let v;
      Object.defineProperty(window, "__LAYERS_DEVICE_ENV", {
        configurable: true,
        get: () => v,
        set: (x) => {
          const c = { ...(x || {}) };
          delete c.PUBLIC_LIVE;
          v = c;
        },
      });
    },
  });
  try {
    await m.goto("/home");
    await m.device();
    await m.page.locator('main article[data-testid="cast"]').first().waitFor({ timeout: 60_000 });
    await sleep(1500);
    const hits = scanNeedles(await m.text(), FIXTURE_NEEDLES);
    if (!hits.length) throw new Error("with PUBLIC_LIVE stripped the scan found NO demo content — the no-demo checks would pass whatever the mode");
    return hits.length + " needle(s) hit, e.g. " + hits[0].label;
  } finally {
    await m.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------- O3..O9 (desktop)
let A = null;
const seen = [];
let personaHandle = null;
let rootHandle = null;
let anchorBefore = null;
await check("O3 Sign in with Farcaster walks the owner's three steps on a desktop, in order, and NEVER asks for a persona (the order check refuses a doctored order)", async () => {
  if (inOrder(["profile", "farcaster", "save", "done"])) throw new Error("the order check accepts a doctored order");
  if (inOrder(["farcaster", "profile", "save", "persona", "done"])) throw new Error("the order check accepts a persona step");
  if (!inOrder(FLOW)) throw new Error("the order check refuses the right order");
  A = await profile("desktop");
  // a stub index for the device's WHOLE-FILE download (the pair's validator has none built): fid 990777 → @stubalice_on_x
  A.indexServed = 0;
  await A.page.route((u) => new URL(u).pathname === "/x/fc-index", async (route) => {
    A.indexServed++;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*", etag: '"stub-index-1"' },
      body: JSON.stringify({ v: 1, builtAt: new Date().toISOString(), rows: 2, fnameCoverage: 1, xid: "1500000000000000001,1500000000000000002", fid: "990777,123456", xu: "stubalice_on_x,someone_else", fn: "stubalice,someone", at: "1760000000,1760000001" }),
    });
  });
  // every step the flow shows, as it shows it (a persona step appearing at any moment fails the walk)
  await A.page.exposeFunction("__obSaw", (s) => A.sawSteps.push(s));
  A.sawSteps = [];
  await A.page.addInitScript(() => {
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="onboarding"]');
      const s = el && el.getAttribute("data-step");
      if (s && s !== window.__obLast) {
        window.__obLast = s;
        window.__obSaw(s);
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-step"] });
  });
  await A.goto("/");
  await A.page.getByTestId("door-start").click();
  await A.page.waitForURL((u) => u.pathname === "/welcome" && u.hash === "#next", { timeout: 60_000 });
  const info = await A.device();
  anchorBefore = info.anchor;
  seen.push(await A.waitStep("farcaster"));
  if (await A.page.getByTestId("onboard-step-welcome").count()) throw new Error("the landing's Sign in with Farcaster door showed the welcome screen again");
  const prog = A.page.getByTestId("onboard-progress");
  if ((await prog.getAttribute("data-index")) !== "1" || (await prog.getAttribute("data-total")) !== "3") throw new Error("the indicator on Sign in says step " + (await prog.getAttribute("data-index")) + " of " + (await prog.getAttribute("data-total")));
  if ((await A.page.getByTestId("onboard-dots").locator("li").count()) !== 3) throw new Error("the indicator does not show three dots");
  // O4's half: sign in through the stub
  await A.page.getByTestId("link-farcaster").click();
  await A.page.getByTestId("siwf-qr").waitFor({ timeout: 45_000 });
  await stub.approve(STUB_ACCOUNTS.alice);
  await A.page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
  await A.page.getByTestId("onboard-next").click();
  seen.push(await A.waitStep("profile"));
  // This is you: the Farcaster profile, filled in; the verified X row with Show (O6's half)
  await A.page.getByTestId("onboard-profile").waitFor({ timeout: 60_000 });
  A.profileName = await A.page.getByTestId("onboard-profile-name").inputValue();
  rootHandle = await A.page.getByTestId("onboard-profile-handle").inputValue();
  A.picHeld = await A.page.getByTestId("onboard-profile-picture").getAttribute("data-held");
  await A.page.locator('[data-testid="onboard-x-row"]:not([data-state="checking"])').waitFor({ timeout: 60_000 });
  A.xState = await A.page.getByTestId("onboard-x-row").getAttribute("data-state");
  A.xText = await A.page.getByTestId("onboard-x-row").innerText();
  A.xShowChecked = A.xState === "connected" ? await A.page.getByTestId("onboard-x-show").isChecked() : null;
  await A.page.getByTestId("onboard-next").click();
  seen.push(await A.waitStep("save"));
  // Keep your account: the passkey save hands off to the home feed (O5's half)
  if ((await A.page.getByTestId("onboard-save-passkey").innerText()).trim() !== "Save with Face ID") throw new Error("the save button says " + (await A.page.getByTestId("onboard-save-passkey").innerText()));
  await A.page.getByTestId("onboard-keep-note").waitFor({ timeout: 10_000 });
  await A.page.getByTestId("onboard-save-passkey").click();
  await A.page.waitForURL((u) => u.pathname === "/home", { timeout: 90_000 });
  seen.push("done");
  if ((await A.passkeys()) !== 1) throw new Error("the authenticator holds " + (await A.passkeys()) + " passkeys after one save");
  if (!inOrder(seen)) throw new Error("the steps came in this order: " + seen.join(" → "));
  const shown = [...new Set(A.sawSteps)];
  if (shown.some((s) => !FLOW.includes(s))) throw new Error("the flow showed a step outside the three: " + shown.join(", "));
  // signed in as the root, with NO persona made: the read-only public self is the only roster entry
  const per = await A.api("GET", "/api/personas");
  const own = (per.json?.personas || []).filter((p) => p.publicSelf !== true);
  if (own.length !== 0) throw new Error("the first run made " + own.length + " persona(s): " + per.text.slice(0, 160));
  return seen.join(" → ") + " (shown: " + shown.join(", ") + "); 0 personas";
});

await check("O4 the stub's sign-in is the identity's read-only public self (one idOf, zero stub violations), and This is you showed it: the Farcaster name and username", async () => {
  if (!A) throw new Error("no desktop profile");
  const st = await A.api("GET", "/api/fc/siwf");
  if (st.json?.link?.handle !== "stubalice" && st.json?.link?.fname !== "stubalice") throw new Error("the link: " + st.text.slice(0, 200));
  const per = await A.api("GET", "/api/personas");
  const self = (per.json?.personas || []).find((p) => p.publicSelf === true);
  if (!self) throw new Error("no read-only public self in the roster: " + per.text.slice(0, 200));
  if (A.profileName !== STUB_ACCOUNTS.alice.displayName || rootHandle !== "stubalice") throw new Error("This is you showed " + JSON.stringify([A.profileName, rootHandle]));
  // the stub's picture is on a host the app does not load by itself: held (no request), never fetched behind the visitor's back
  if (A.picHeld !== "true") throw new Error("the Farcaster picture on pfp.example.invalid was not held");
  const s = await stub.state();
  if (s.violations.length) throw new Error("the stub recorded violations: " + JSON.stringify(s.violations.slice(0, 2)));
  if (s.counts.idOf < 1) throw new Error("the stub saw no idOf");
  return "@" + self.handle + " (read-only), \"" + A.profileName + "\", picture held, idOf " + s.counts.idOf;
});

await check("O6 This is you's X row: the verified handle from ONE whole-file index download (no per-account request, no relay read), Show on, and Show is kept on the root's profile", async () => {
  if (!A) throw new Error("no desktop profile");
  if (A.xState !== "connected" || !/@stubalice_on_x · Verified on your Farcaster account/.test(A.xText)) throw new Error("the X row showed " + A.xState + ": " + A.xText);
  if (A.xShowChecked !== true) throw new Error("Show was not on");
  const idx = A.requests.filter((r) => /\/x\/fc-index/.test(r.url));
  if (A.indexServed !== 1 || idx.some((r) => !/\/x\/fc-index$/.test(r.url.split("?")[0]) || /[?&]fid=/.test(r.url))) throw new Error("index requests: " + idx.map((r) => r.url).join(", "));
  const relay = A.requests.filter((r) => /\/api\/fc\/read/.test(r.url));
  if (relay.length) throw new Error("the read relay was asked: " + relay.length + " time(s)");
  const prof = await A.api("GET", "/api/profile?handle=" + encodeURIComponent(rootHandle));
  if (prof.json?.publicSelf?.xShown !== "stubalice_on_x") throw new Error("the root's profile does not show the X account: " + prof.text.slice(0, 200));
  return "@stubalice_on_x, 1 whole-file download, shown on @" + rootHandle;
});

await check("O7 /home as the root: 'Posting as @you', what allowing Totem to post as you does and the device's real answer (not switched on here, or the Allow button), and 'Pick up where you left off' with its three rows; a persona made THERE (optional) is anon by default, with a device-made picture and the route's own sentence", async () => {
  if (!A) throw new Error("no desktop profile");
  await A.page.getByTestId("composer-posting-as").first().waitFor({ timeout: 60_000 });
  const as = (await A.page.getByTestId("composer-posting-as").first().innerText()).trim();
  if (as !== "Posting as @" + rootHandle) throw new Error("the composer says " + JSON.stringify(as));
  const line = await A.page.getByTestId("composer-public-self").first().innerText();
  if (!/once you allow it/.test(line)) throw new Error("the composer does not say what allowing Totem to post as you does: " + line);
  // POST AS YOU: the offer is the device's answer — on a pair whose validator holds no app account, said plainly
  // (EXPECT_ROOT_POST=armed: the pair was started with PRODLIVE_ROOTPOST=stub, so the Allow button is offered)
  const offer = A.page.locator('[data-testid="composer-allow"] [data-testid="root-post-unavailable"], [data-testid="composer-allow"] [data-testid="root-post-connect"]').first();
  await offer.waitFor({ timeout: 60_000 });
  const offerId = await offer.getAttribute("data-testid");
  if (process.env.EXPECT_ROOT_POST === "armed") {
    if (offerId !== "root-post-connect" || (await A.page.getByTestId("root-post-allow").first().innerText()).trim() !== "Allow Totem to post as you") throw new Error("an armed pair does not offer Allow Totem to post as you: " + offerId);
  } else if (offerId !== "root-post-unavailable" || !/Allow Totem to post as you.*isn't switched on on this site yet/.test(await offer.innerText())) throw new Error("an unarmed pair does not say posting as you is not switched on here: " + offerId + " " + (await offer.innerText()));
  if ((await A.page.getByTestId("composer-input").count()) || (await A.page.getByTestId("root-composer-text").count())) throw new Error("a composer input is offered to a root that cannot post");
  await A.page.getByTestId("pickup").waitFor({ timeout: 30_000 });
  for (const id of ["pickup-people-link", "pickup-people-x-link", "pickup-x-posts-link", "pickup-persona-open"]) if (!(await A.page.getByTestId(id).count())) throw new Error("the card lacks " + id);
  // FOLLOWING FROM THE HUB: Find your people is the root's own Farcaster follows (read by the tab from the node), and the
  // X archive's matching stays one line below it
  if ((await A.page.getByTestId("pickup-people-link").getAttribute("href")) !== "/fc/following") throw new Error("Find your people goes to " + (await A.page.getByTestId("pickup-people-link").getAttribute("href")));
  if ((await A.page.getByTestId("pickup-people-x-link").getAttribute("href")) !== "/settings/import-x?return=/home#x-people") throw new Error("the X follows link goes to " + (await A.page.getByTestId("pickup-people-x-link").getAttribute("href")));
  if (/coming soon/i.test(await A.page.getByTestId("pickup-people").innerText())) throw new Error("Find your people still says Farcaster follows are coming");
  // the count, settled (never the loading line): the stub hub's default graph (alice follows 3) when the launcher started
  // it (EXPECT_HUB=stub, the default with PRODLIVE_SIWF=stub); without a hub stub the read cannot reach a node and must
  // say so (an error with Retry, never "0")
  await A.page.locator('[data-testid="pickup-people-count"]:not([data-state="loading"])').waitFor({ timeout: 60_000 });
  const pc = A.page.getByTestId("pickup-people-count");
  const pcState = await pc.getAttribute("data-state");
  if (process.env.EXPECT_HUB === "stub") {
    if (pcState !== "ok" || (await pc.getAttribute("data-count")) !== "3" || !/You follow 3 accounts on Farcaster\./.test(await pc.innerText())) throw new Error("the follows count: " + pcState + " " + (await pc.innerText()));
  } else if (pcState !== "error" || !/Couldn.t read who you follow/.test(await pc.innerText())) throw new Error("without a reachable node the count says: " + pcState + " " + (await pc.innerText()));
  if ((await A.page.getByTestId("pickup-x-posts-link").getAttribute("href")) !== "/settings/import-x?return=/home") throw new Error("Bring your X posts goes elsewhere");
  // the composer's Make a persona opens the card's form
  if ((await A.page.getByTestId("composer-make-persona").first().getAttribute("href")) !== "/home#make-persona") throw new Error("the composer's Make a persona goes to " + (await A.page.getByTestId("composer-make-persona").first().getAttribute("href")));
  await A.page.getByTestId("composer-make-persona").first().click();
  await A.page.getByTestId("make-persona").waitFor({ timeout: 30_000 });
  A.modeDefault = await A.page.getByTestId("make-persona-mode").getAttribute("data-mode");
  await A.page.locator('[data-testid="make-persona-where"]:not([data-state="checking"])').waitFor({ timeout: 60_000 });
  A.whereText = (await A.page.getByTestId("make-persona-where").innerText()).trim();
  A.whereState = await A.page.getByTestId("make-persona-where").getAttribute("data-state");
  A.anonAnswer = (await A.api("GET", "/api/anon")).json;
  await A.page.getByTestId("make-persona-name").fill("Night Owl");
  personaHandle = (await A.page.getByTestId("make-persona-handle").inputValue()).trim();
  A.picture = await A.page.getByTestId("make-persona-picture").getAttribute("src");
  await A.page.getByTestId("make-persona-create").click();
  await A.page.getByTestId("make-persona").waitFor({ state: "detached", timeout: 60_000 });
  if (A.modeDefault !== "anon") throw new Error("the default post mode was " + A.modeDefault);
  if (!A.picture || !A.picture.startsWith("data:image/svg+xml,")) throw new Error("the picture: " + (A.picture || "").slice(0, 60));
  const want = expectedWhere(A.anonAnswer);
  if (want === null) {
    if (A.whereState !== "unknown") throw new Error("the route said nothing usable and the form said: " + A.whereText);
  } else if (A.whereText !== want) throw new Error("the form said " + JSON.stringify(A.whereText) + ", the route says " + JSON.stringify(want));
  const after = (await A.api("GET", "/api/anon")).json;
  if (after?.postAs?.handle !== personaHandle || after?.postAs?.mode !== "anon") throw new Error("the new persona's post mode: " + JSON.stringify(after?.postAs ?? null).slice(0, 160));
  return "Posting as @" + rootHandle + " (not built, said); card's 3 rows; @" + personaHandle + ", anon, " + (want === null ? "route said nothing (form said so)" : "sentence word for word");
});

await check("O8 with a persona the composer is the real one (desktop); the live timeline says reads are not switched on (this pair has none armed) and shows no demo world", async () => {
  if (!A) throw new Error("no desktop profile");
  await A.page.getByTestId("composer-input").first().waitFor({ timeout: 60_000 });
  await A.page.getByTestId("live-reads-line").waitFor({ timeout: 60_000 });
  const st = await A.page.getByTestId("live-reads-line").getAttribute("data-state");
  if (st !== "unarmed") throw new Error("the reads line says " + st + " on a pair with reads unarmed");
  await noDemoWorld(A, "/home with a persona");
  return "composer-input; reads: unarmed";
});

await check("O5 a passkey save, then a reload, restores the identity (same anchor, the root and the persona are still there)", async () => {
  if (!A) throw new Error("no desktop profile");
  await A.goto("/home");
  const info = await A.device();
  if (info.restored !== true || info.anchor !== anchorBefore) throw new Error("after a reload: restored=" + info.restored + ", same anchor=" + (info.anchor === anchorBefore));
  const per = await A.api("GET", "/api/personas");
  if (!(per.json?.personas || []).some((p) => p.handle === personaHandle)) throw new Error("the persona is gone after the reload");
  if (!(per.json?.personas || []).some((p) => p.publicSelf === true && p.handle === rootHandle)) throw new Error("the root is gone after the reload");
  return "restored, @" + rootHandle + " + @" + personaHandle;
});

await check("O9a the returning visitor: a reload of /welcome goes straight to /home, no step shown", async () => {
  if (!A) throw new Error("no desktop profile");
  await A.goto("/welcome");
  await A.device();
  let sawStep = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const s = await A.step().catch(() => null);
    if (s && s !== "done") sawStep = s;
    if (/\/home(\?|$)/.test(new URL(A.page.url()).pathname + new URL(A.page.url()).search)) break;
    await sleep(250);
  }
  if (!/^\/home$/.test(new URL(A.page.url()).pathname)) throw new Error("still at " + A.page.url());
  if (sawStep) throw new Error("a returning visitor was shown the " + sawStep + " step");
  return "→ /home";
});

await check("O9c an explicit target: a returning visitor that is DONE lands on /welcome#farcaster's step (and ?step=farcaster's), not /home; /welcome#unlock opens the unlock for it", async () => {
  if (!A) throw new Error("no desktop profile");
  for (const route of ["/welcome#farcaster", "/welcome?step=farcaster"]) {
    await A.goto(route);
    const info = await A.device();
    if (info.restored !== true) throw new Error("the precondition: the saved identity was not restored on a reload (the check would not measure a returning visitor)");
    await A.waitStep("farcaster");
    await sleep(3000);
    if (!/^\/welcome$/.test(new URL(A.page.url()).pathname) || (await A.step()) !== "farcaster") throw new Error(route + ": the target did not hold: at " + A.page.url() + ", step " + (await A.step()));
    await A.page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
  }
  await A.goto("/welcome#unlock");
  await A.device();
  await A.page.getByTestId("onboard-unlock").waitFor({ timeout: 60_000 });
  await sleep(2000);
  if (!/^\/welcome$/.test(new URL(A.page.url()).pathname)) throw new Error("#unlock for a returning, done visitor went to " + A.page.url());
  return "#farcaster and ?step=farcaster held for a returning, done visitor; #unlock opened";
});

await check("O9b the returning visitor in a cleared browser: /welcome#unlock + the passkey unlocks, straight to /home", async () => {
  if (!A) throw new Error("no desktop profile");
  await A.page.goto("about:blank");
  await A.cdp.send("Storage.clearDataForOrigin", { origin: new URL(BASE).origin, storageTypes: "all" });
  await A.goto("/welcome#unlock");
  const fresh = await A.device();
  if (fresh.restored === true || fresh.anchor === anchorBefore) throw new Error("the cleared browser still restored the identity");
  await A.page.getByTestId("onboard-unlock").waitFor({ timeout: 60_000 });
  await A.page.getByTestId("onboard-unlock-passkey").click();
  await A.page.waitForURL(/\/home(\?|$)/, { timeout: 90_000 });
  const per = await A.api("GET", "/api/personas");
  if (!(per.json?.personas || []).some((p) => p.handle === personaHandle)) throw new Error("the unlocked identity lacks @" + personaHandle);
  return "unlocked → /home with @" + personaHandle;
});

// ---------------------------------------------------------------------------------------------------------------- O10, O11
await check("O10 the guest path: the landing's 'Just looking?' door is the anonymous feed; a guest's /home says 'Sign in with Farcaster to post' (→ /welcome#next, past the welcome screen), the welcome screen's guest door is /anon in live mode", async () => {
  const G = await profile("guest2");
  try {
    await G.goto("/");
    if ((await G.page.getByTestId("door-app").getAttribute("href")) !== "/anon") throw new Error("the landing's guest door goes to " + (await G.page.getByTestId("door-app").getAttribute("href")));
    await G.goto("/home");
    await G.device();
    await G.page.getByTestId("composer-no-persona").waitFor({ timeout: 60_000 });
    if (await G.page.getByTestId("composer-posting-as").count()) throw new Error("a guest is told it is posting as someone");
    const href = await G.page.getByTestId("composer-sign-in").getAttribute("href");
    if (href !== "/welcome#next") throw new Error("Sign in with Farcaster goes to " + href);
    // the timeline: the live NoPersonaYet for a guest, pointing at Sign in with Farcaster (no feed is built)
    await G.page.locator('[data-testid="world-no-persona"][data-mode="live"]').waitFor({ timeout: 60_000 });
    const link = await G.page.getByTestId("world-no-persona-link").getAttribute("href");
    if (link !== "/welcome#next") throw new Error("the timeline's link goes to " + link);
    if (await G.page.getByTestId("pickup").count()) throw new Error("a guest with no one to be is shown Pick up where you left off");
    const errs = await inlineErrors(G.page);
    if (errs.length) throw new Error("the guest's /home shows an error: " + errs.slice(0, 2).join("; "));
    if (await G.page.getByTestId("mode-pill-loading").count()) throw new Error("a mode pill waits for a read that is never made");
    // F8: the link lands PAST the welcome screen (a soft navigation: the same identity), at the first unmet step
    await G.page.getByTestId("world-no-persona-link").click();
    await G.page.waitForURL((u) => u.pathname === "/welcome" && u.hash === "#next", { timeout: 60_000 });
    await G.waitStep("farcaster");
    if (await G.page.getByTestId("onboard-step-welcome").count()) throw new Error("the welcome screen was shown to a visitor who came to sign in");
    // (a soft navigation to /welcome?step=next would fetch its flight data with that query: the server would see it)
    const named = G.requests.filter((r) => /[?&]step=/.test(r.url));
    if (named.length) throw new Error("a request named the target: " + named[0].url);
    // F8: the welcome screen's guest door in live mode is the anonymous feed (a guest's /home has nothing to show)
    await G.page.getByTestId("onboard-back").click();
    await G.waitStep("welcome");
    const guestDoor = G.page.getByTestId("onboard-guest");
    if ((await guestDoor.getAttribute("href")) !== "/anon" || (await guestDoor.getAttribute("data-mode")) !== "live") throw new Error("the live guest door: " + (await guestDoor.getAttribute("href")));
    if (!(await G.page.getByTestId("onboard-x-soon").isDisabled())) throw new Error("Continue with X is offered as working");
    return "landing guest door → /anon; /home → Sign in (→ /welcome#next → Farcaster, no welcome screen, no request naming it); guest door → /anon; no error";
  } finally {
    await G.close();
  }
});

await check("O11 Not now keeps the identity in this browser only: a reload restores it, and the signed-in root with NO persona is a returning visitor (/welcome → /home)", async () => {
  const R = await profile("resume");
  try {
    await R.goto("/welcome");
    await R.device();
    await R.waitStep("welcome");
    await R.page.getByTestId("onboard-new").click();
    await R.waitStep("farcaster");
    await R.page.getByTestId("link-farcaster").click();
    await R.page.getByTestId("siwf-qr").waitFor({ timeout: 45_000 });
    await stub.approve(STUB_ACCOUNTS.alice);
    await R.page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
    await R.page.getByTestId("onboard-next").click();
    await R.waitStep("profile");
    await R.page.getByTestId("onboard-profile").waitFor({ timeout: 60_000 });
    await R.page.getByTestId("onboard-next").click();
    await R.waitStep("save");
    if (await R.page.evaluate(() => window.__layersDevice.isPersistent())) throw new Error("the identity was kept before Not now (the check would be vacuous)");
    await R.page.getByTestId("onboard-keep").click();
    await R.page.waitForURL((u) => u.pathname === "/home", { timeout: 90_000 });
    if (!(await R.page.evaluate(() => window.__layersDevice.isPersistent()))) throw new Error("Not now did not keep the identity in this browser");
    if ((await R.passkeys()) !== 0) throw new Error("Not now registered a passkey");
    await R.goto("/welcome");
    const info = await R.device();
    if (info.restored !== true) throw new Error("the kept identity was not restored");
    await R.page.waitForURL((u) => u.pathname === "/home", { timeout: 60_000 });
    const own = ((await R.api("GET", "/api/personas")).json?.personas || []).filter((p) => p.publicSelf !== true);
    if (own.length) throw new Error("a persona exists: the check would not measure the no-persona rule");
    return "Not now → /home (kept, 0 passkeys); reload /welcome → /home with 0 personas";
  } finally {
    await R.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------- O16 (This is you: a taken username)
await check("O16 This is you: a username already taken inside Totem says '@x is taken on Totem. These are free:' with 3 tap targets and that the Farcaster username stays; the one tapped is saved as the root's Totem username (the Farcaster username untouched)", async () => {
  const T = await profile("taken");
  try {
    await T.goto("/welcome#next");
    await T.device();
    await T.waitStep("farcaster");
    await T.page.getByTestId("link-farcaster").click();
    await T.page.getByTestId("siwf-qr").waitFor({ timeout: 45_000 });
    await stub.approve(STUB_ACCOUNTS.alice);
    await T.page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
    // the device's own answer, as it would be were @stubalice someone else's here (this pair's empty world holds no other
    // account, so the namespace cannot be crowded for real): GET ?profile=1 only, read from the real answer and marked taken
    await T.page.evaluate(() => {
      const inner = window.fetch;
      window.fetch = async function (input, init) {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const u = new URL(href, location.href);
        const res = await inner.call(window, input, init);
        if (u.pathname === "/api/onboarding" && u.searchParams.get("profile") === "1") {
          const j = await res.clone().json();
          if (j && j.profile) {
            j.profile.taken = true;
            j.profile.suggestions = ["stubalice_fc", "its_stubalice", "stubalice_here"];
            j.profile.handle = "stubalice_fc";
          }
          return new Response(JSON.stringify(j), { status: res.status, headers: { "content-type": "application/json" } });
        }
        return res;
      };
    });
    await T.page.getByTestId("onboard-next").click();
    await T.waitStep("profile");
    const box = T.page.getByTestId("onboard-profile-taken");
    await box.waitFor({ timeout: 60_000 });
    const text = await box.innerText();
    if (!text.includes("@stubalice is taken on Totem. These are free:")) throw new Error("the taken words: " + text);
    if (!text.includes("Your Farcaster username stays @stubalice on Farcaster. This only changes your name inside Totem.")) throw new Error("the Farcaster-username words: " + text);
    const sugg = T.page.getByTestId("onboard-profile-suggestion");
    if ((await sugg.count()) !== 3) throw new Error("tap targets: " + (await sugg.count()));
    await sugg.nth(1).click();
    if ((await T.page.getByTestId("onboard-profile-handle").inputValue()) !== "its_stubalice") throw new Error("tapping a suggestion did not set the username");
    await T.page.getByTestId("onboard-next").click();
    await T.waitStep("save");
    const per = await T.api("GET", "/api/personas");
    const self = (per.json?.personas || []).find((p) => p.publicSelf === true);
    if (self?.handle !== "its_stubalice") throw new Error("the root's Totem username after Continue: " + (self && self.handle));
    const link = (await T.api("GET", "/api/fc/siwf")).json?.link;
    if (link?.fname !== "stubalice") throw new Error("the Farcaster username changed: " + (link && link.fname));
    const prof = await T.api("GET", "/api/profile?handle=its_stubalice");
    if (prof.status !== 200 || prof.json?.publicSelf?.fname !== "stubalice") throw new Error("the renamed root's profile: " + prof.status + " " + prof.text.slice(0, 160));
    return "taken words + 3 targets; @its_stubalice saved; Farcaster @stubalice untouched";
  } finally {
    await T.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------- O12 phones
for (const deviceName of ["Pixel 5", "iPhone 13"]) {
  await check(`O12 ${deviceName}: the Farcaster step keeps the identity BEFORE the Farcaster app link exists${deviceName === "Pixel 5" ? "; the walk ends on /home with Pick up where you left off and no persona" : ""}`, async () => {
    const P = await profile(deviceName, { deviceName });
    try {
      await P.goto("/welcome");
      await P.device();
      await P.waitStep("welcome");
      await P.page.getByTestId("onboard-new").click();
      await P.waitStep("farcaster");
      const phone = await P.page.getByTestId("onboarding").getAttribute("data-phone");
      if (phone !== "true") throw new Error("the flow did not see a phone");
      await P.page.getByTestId("siwf-keep-first").waitFor({ timeout: 30_000 });
      const before = await P.page.evaluate(() => window.__layersDevice.isPersistent());
      if (before !== false) throw new Error("a fresh identity was already kept (the check would be vacuous)");
      await P.page.getByTestId("link-farcaster").click();
      await P.page.getByTestId("siwf-open-app").waitFor({ timeout: 45_000 });
      const kept = await P.page.evaluate(() => window.__layersDevice.isPersistent());
      if (kept !== true) throw new Error("the Farcaster app link exists but the identity is NOT kept in this browser");
      if (await P.page.getByTestId("siwf-qr").count()) throw new Error("the phone shows a QR code first");
      if (deviceName !== "Pixel 5") {
        // F10: the app switch reloads the tab — the kept identity comes back on the Farcaster step (never Welcome), told
        // that the sign-in that was waiting must be started again
        await P.goto("/welcome");
        const back = await P.device();
        if (back.restored !== true) throw new Error("the kept identity was not restored by the reload");
        await P.waitStep("farcaster");
        if (await P.page.getByTestId("onboard-step-welcome").count()) throw new Error("a reload during the app switch landed on Welcome");
        await P.page.getByTestId("onboard-farcaster-after-reload").waitFor({ timeout: 30_000 });
        return "kept before the deep link; a reload lands on Farcaster with the start-again sentence";
      }
      await stub.approve(STUB_ACCOUNTS.alice);
      await P.page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
      await P.page.getByTestId("onboard-next").click();
      await P.waitStep("profile");
      await P.page.getByTestId("onboard-profile").waitFor({ timeout: 60_000 });
      await P.page.getByTestId("onboard-next").click();
      await P.waitStep("save");
      // the identity is already kept (keepFirst): Not now hands off without asking again
      await P.page.getByTestId("onboard-keep").click();
      await P.page.waitForURL((u) => u.pathname === "/home", { timeout: 90_000 });
      await P.page.getByTestId("pickup").waitFor({ timeout: 60_000 });
      const own = ((await P.api("GET", "/api/personas")).json?.personas || []).filter((p) => p.publicSelf !== true);
      if (own.length) throw new Error("the phone's walk made a persona");
      return "kept before the deep link; Sign in → This is you → Not now → /home with the card, 0 personas";
    } finally {
      await P.close();
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------- O14 (F1)
/** the device env the SERVER put in a page's HTML (the flight data escapes its quotes): the two names this check reads */
function hintInHtml(html) {
  const pick = (name) => {
    const all = [...String(html).matchAll(new RegExp(name + '[\\\\"]*:[\\\\"]*([A-Za-z_-]+)', "g"))].map((m) => m[1]);
    return all.length ? [...new Set(all)] : [];
  };
  return { universe: pick("ZK_ANON_UNIVERSE"), mode: pick("ZK_MODE") };
}
await check(`O14 F1: the anonymous universe hint comes from the app's SERVER, with no injection (this pair: ${EXPECT_UNIVERSE}) — /anon and /home, in the HTML and in a tab's device env`, async () => {
  if (EXPECT_UNIVERSE !== "live" && EXPECT_UNIVERSE !== "unset") throw new Error("EXPECT_ANON_UNIVERSE must be live or unset, got " + EXPECT_UNIVERSE);
  // the reader's self-test, both ways (a reader that finds nothing would pass "unset" for the wrong reason)
  const doctored = 'self.__next_f.push([1,"{\\"env\\":{\\"ZK_MODE\\":\\"live\\",\\"ZK_ANON_UNIVERSE\\":\\"live\\"}}"])';
  const plain = 'self.__next_f.push([1,"{\\"env\\":{\\"ZK_MODE\\":\\"fixture\\"}}"])';
  const d = hintInHtml(doctored);
  const q = hintInHtml(plain);
  if (d.universe.join() !== "live" || d.mode.join() !== "live" || q.universe.length !== 0 || q.mode.join() !== "fixture") throw new Error("the HTML reader failed its self-test: " + JSON.stringify({ d, q }));
  const seen = [];
  for (const route of ["/anon", "/home"]) {
    const html = (await getJson(BASE + route)).text;
    const h = hintInHtml(html);
    if (!h.mode.length) throw new Error(route + ": the server's HTML carries no device env at all (ZK_MODE not found) — the reader or the page changed");
    // a context with NO init script: exactly what the page handed the device
    const T = await profile("hint" + route.replace(/\//g, "-"));
    try {
      await T.goto(route);
      await T.page.waitForFunction(() => !!window.__LAYERS_DEVICE_ENV, null, { timeout: 120_000 });
      const env = await T.page.evaluate(() => ({ ...window.__LAYERS_DEVICE_ENV }));
      if (EXPECT_UNIVERSE === "live") {
        if (h.universe.join() !== "live" || h.mode.join() !== "live") throw new Error(route + ": the server's HTML says ZK_ANON_UNIVERSE=" + (h.universe.join("|") || "(absent)") + " ZK_MODE=" + h.mode.join("|") + " on a pair whose app holds ZK_ANON_UNIVERSE=live");
        if (env.ZK_ANON_UNIVERSE !== "live" || env.ZK_MODE !== "live") throw new Error(route + ": the tab's device env says ZK_ANON_UNIVERSE=" + env.ZK_ANON_UNIVERSE + " ZK_MODE=" + env.ZK_MODE);
      } else {
        if (h.universe.length || h.mode.includes("live")) throw new Error(route + ": the server's HTML carries a universe hint on a pair that set none: " + JSON.stringify(h));
        if ("ZK_ANON_UNIVERSE" in env || env.ZK_MODE === "live") throw new Error(route + ": the tab's device env carries a hint on a pair that set none: " + JSON.stringify({ u: env.ZK_ANON_UNIVERSE, m: env.ZK_MODE }));
      }
      seen.push(route + " " + (env.ZK_ANON_UNIVERSE ?? "-") + "/" + env.ZK_MODE);
    } finally {
      await T.close();
    }
  }
  return "reader self-tested; " + seen.join(", ");
});

// ---------------------------------------------------------------------------------------------------------------- O15 (F2, F5)
/** lib/zk/anon/availability.ts's own sentence for a root outside the armed live crowd (never a copy typed here) */
const SIGN_IN_FIRST = (/export const ANON_LIVE_SIGN_IN_FIRST = "([^"]+)";/.exec(readFileSync(path.join(ROOT, "lib/zk/anon/availability.ts"), "utf8")) || [])[1] || null;
/** GET /api/anon as the armed live crowd answers a root that is not in it (the route's field names; availability's words) */
const CROWD_ANSWER = SIGN_IN_FIRST
  ? { mode: "live", host: "tab", available: false, unavailableReason: SIGN_IN_FIRST, unavailableCode: "crowd", availableFrom: null, anonDeploymentOff: false, unavailableDetail: "this root's commitment is not a leaf of the live valid (one per Farcaster account), and no Farcaster join is known in this tab", destination: "off", destinationSentence: SIGN_IN_FIRST, postedSentence: null, previewOnly: false, previewSentence: null, postAs: null, slotsPerWindow: 4, windowHours: 6 }
  : null;
/** lib/zk/anon/fcJoin.ts joinNonceFor, recomputed (the binding the stub's channel nonce must carry) */
function joinNonceFor(commitment, salt) {
  const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const d = createHash("sha256").update("layers-anon-fid-join/1|" + commitment + "|" + salt, "utf8").digest();
  let out = "";
  for (let i = 0; i < 16; i++) out += B62[d[i] % 62];
  return out;
}
/** the live hint added to the page's device env (ZK_ANON_UNIVERSE only: the tab keeps ZK_MODE fixture, so it registers nothing live) */
const HINT_INIT = () => {
  let held;
  Object.defineProperty(window, "__LAYERS_DEVICE_ENV", {
    configurable: true,
    get: () => held,
    set: (v) => {
      held = v && typeof v === "object" ? Object.assign(v, { ZK_ANON_UNIVERSE: "live" }) : v;
    },
  });
};
/** AFTER the device booted: answer GET /api/anon (that path, no query) with `answer`; everything else as before */
async function stubAnonRead(page, answer) {
  await page.evaluate((a) => {
    const inner = window.fetch;
    window.__onboardAnonStubHits = 0;
    window.fetch = function (input, init) {
      try {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const u = new URL(href, location.href);
        const method = String((init && init.method) || (typeof input === "object" && input && input.method) || "GET").toUpperCase();
        if (u.origin === location.origin && u.pathname === "/api/anon" && u.search === "" && method === "GET") {
          window.__onboardAnonStubHits++;
          return Promise.resolve(new Response(JSON.stringify(a), { status: 200, headers: { "content-type": "application/json" } }));
        }
      } catch {
        /* not ours: fall through */
      }
      return inner.call(window, input, init);
    };
  }, answer);
}
async function signInAlice(P) {
  await P.page.getByTestId("link-farcaster").click();
  await P.page.getByTestId("siwf-qr").waitFor({ timeout: 45_000 });
  await stub.approve(STUB_ACCOUNTS.alice);
  await P.page.locator('[data-testid="siwf-status"][data-state="signed-in"]').waitFor({ timeout: 60_000 });
}
await check("O15 F2: a signed-in visitor in a live-hinted tab whose crowd answer asks for a sign-in is offered 'Sign in again…', which starts a sign-in BINDING this identity's crowd commitment (the composer carries the same way, #farcaster holds); without the hint nothing is offered", async () => {
  if (!CROWD_ANSWER) throw new Error("ANON_LIVE_SIGN_IN_FIRST could not be read from lib/zk/anon/availability.ts");
  // THE CONTROL first: the same crowd answer, no live hint — the card must not even ask
  const N = await profile("rejoin-nohint");
  try {
    await N.goto("/welcome");
    await N.device();
    await stubAnonRead(N.page, CROWD_ANSWER);
    await N.waitStep("welcome");
    await N.page.getByTestId("onboard-new").click();
    await N.waitStep("farcaster");
    await signInAlice(N);
    await sleep(2500);
    const st = await N.page.getByTestId("link-farcaster-card").getAttribute("data-rejoin");
    if (st !== "na" || (await N.page.getByTestId("siwf-rejoin").count())) throw new Error("without the live hint the card offered a rejoin (data-rejoin " + st + ")");
  } finally {
    await N.close();
  }
  const R = await profile("rejoin", { initScript: HINT_INIT });
  try {
    await R.goto("/welcome");
    await R.device();
    const env = await R.page.evaluate(() => ({ ...window.__LAYERS_DEVICE_ENV }));
    if (env.ZK_ANON_UNIVERSE !== "live" || env.ZK_MODE === "live") throw new Error("the injection: " + JSON.stringify({ u: env.ZK_ANON_UNIVERSE, m: env.ZK_MODE }));
    await stubAnonRead(R.page, CROWD_ANSWER);
    await R.waitStep("welcome");
    await R.page.getByTestId("onboard-new").click();
    await R.waitStep("farcaster");
    await signInAlice(R);
    await R.page.locator('[data-testid="link-farcaster-card"][data-rejoin="offered"]').waitFor({ timeout: 30_000 });
    await R.page.getByTestId("siwf-rejoin-disclosure").waitFor({ timeout: 10_000 });
    const label = (await R.page.getByTestId("siwf-rejoin").innerText()).trim();
    if (label !== "Sign in again with Farcaster to join the anonymous crowd") throw new Error("the button says " + JSON.stringify(label));
    if ((await R.page.evaluate(() => window.__onboardAnonStubHits)) < 1) throw new Error("the card offered without reading the crowd answer");
    // pressing it starts a sign-in whose nonce binds this identity's crowd commitment (lib/zk/anon/fcJoin.ts fcJoinNonce)
    const before = (await stub.state()).channels.length;
    await R.page.getByTestId("siwf-rejoin").click();
    await R.page.getByTestId("siwf-qr").waitFor({ timeout: 45_000 });
    const st = await stub.state();
    if (st.channels.length !== before + 1) throw new Error("the stub saw " + (st.channels.length - before) + " new channel(s)");
    const pending = await R.page.evaluate(() => (window.__layersFcJoin && window.__layersFcJoin.pending ? { ...window.__layersFcJoin.pending } : null));
    if (!pending || pending.nonce !== st.channels[0].nonce) throw new Error("the new sign-in is not a binding one: pending " + JSON.stringify(pending && pending.nonce) + ", channel " + st.channels[0].nonce);
    if (joinNonceFor(pending.commitment, pending.salt) !== st.channels[0].nonce) throw new Error("the channel nonce is not joinNonceFor(commitment, salt)");
    await R.page.getByTestId("siwf-cancel").click();
    // the composer: the same way forward beside the crowd sentence (a persona made on /home's card: the root alone has no
    // composer to post from), and the target holds for a visitor who is otherwise done
    await R.page.getByTestId("onboard-next").click();
    await R.waitStep("profile");
    await R.page.getByTestId("onboard-profile").waitFor({ timeout: 60_000 });
    await R.page.getByTestId("onboard-next").click();
    await R.waitStep("save");
    await R.page.getByTestId("onboard-keep").click();
    await R.page.waitForURL((u) => u.pathname === "/home", { timeout: 90_000 });
    await R.page.getByTestId("pickup-persona-open").click();
    await R.page.getByTestId("make-persona-name").fill("Rejoin Owl");
    await R.page.getByTestId("make-persona-create").click();
    await R.page.getByTestId("make-persona").waitFor({ state: "detached", timeout: 60_000 });
    const rejoin = R.page.getByTestId("composer-anon-rejoin").first();
    await rejoin.waitFor({ timeout: 60_000 });
    if ((await rejoin.getAttribute("href")) !== "/welcome#farcaster") throw new Error("the composer's link goes to " + (await rejoin.getAttribute("href")));
    if ((await rejoin.innerText()).trim() !== "Sign in again with Farcaster to join the anonymous crowd") throw new Error("the composer's link says " + (await rejoin.innerText()));
    await rejoin.click();
    await R.page.waitForURL((u) => u.pathname === "/welcome" && u.hash === "#farcaster", { timeout: 60_000 });
    await R.waitStep("farcaster");
    await sleep(2500);
    if ((await R.step()) !== "farcaster" || !/^\/welcome$/.test(new URL(R.page.url()).pathname)) throw new Error("#farcaster did not hold for a visitor who is signed in, kept and has a persona: " + R.page.url());
    const named = R.requests.filter((r) => /[?&]step=/.test(r.url));
    if (named.length) throw new Error("a request named the target (the server would learn this visitor went to sign in again): " + named[0].url);
    await R.page.locator('[data-testid="link-farcaster-card"][data-rejoin="offered"]').waitFor({ timeout: 30_000 });
    return "control: no hint → nothing; hinted: offered after the disclosure, a binding sign-in (nonce == joinNonceFor), the composer's link → #farcaster held, no request named it";
  } finally {
    await R.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------- O13
await check("O13 zero requests to api.dicebear.com, and none to any host but loopback, across every context", async () => {
  // the O2m mutant is excluded on purpose: it IS the demo world (PUBLIC_LIVE stripped), which still draws third-party
  // avatars — its requests could not leave the machine (the resolver rule), and they are the mutation's, not live mode's
  const live = allRequests.filter((r) => r.label !== "mutant");
  // the POSITIVE CONTROL: the mutant's demo world draws third-party pictures, and this log must have seen them try —
  // otherwise "zero non-loopback requests" below would prove nothing about the log
  const control = allRequests.filter((r) => r.label === "mutant" && !isLoopbackUrl(r.url));
  if (!control.length) throw new Error("the request log saw no non-loopback request even from the demo-world mutant: the guard is blind (run O2m with O13)");
  const dice = live.filter((r) => /dicebear/i.test(r.url));
  if (dice.length) throw new Error(dice.length + " request(s) to api.dicebear.com, e.g. " + dice[0].url.slice(0, 100));
  const off = live.filter((r) => !isLoopbackUrl(r.url));
  if (off.length) throw new Error(off.length + " non-loopback request(s): " + [...new Set(off.map((r) => r.label + " " + new URL(r.url).host))].slice(0, 5).join(", "));
  return live.length + " requests, all loopback (the mutant's " + (allRequests.length - live.length) + " excluded)";
});

if (guest) await guest.close();
if (A) await A.close();
await browser.close();
// ONBOARD_ONLY that matched nothing is a typo, never a pass
if (ONLY.length && !results.length) fail("ONBOARD_ONLY", "no check is named " + ONLY.join(", "));
const passed = results.filter((r) => r[0] === "PASS").length;
const failedN = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${failedN === 0 ? "PASSED" : "FAILED"}: ${passed} checks passed, ${failedN} failed`);
process.exit(failedN === 0 ? 0 : 1);
