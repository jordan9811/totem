// FC-READ — PUBLIC LIVE FARCASTER READS, accepted end to end against the PRODUCTION-SHAPED pair and a loopback Neynar.
//
// The design (lead decision): on a public deployment the browser device reads real Farcaster casts through ONE
// server route, POST /api/fc/read (lib/fc/readRelay.server.ts, the only reader of NEYNAR_READ_API_KEY). Discovery
// surfaces go live; Following, notifications, history, search, the rail and every server render stay seed; writes on a
// network cast are refused per target (403 NETWORK_READ_ONLY); deploying without the key changes nothing visible but
// honest labels. FC-READ (no channels): the owner's v1 decision is that channels are not an emphasis — discovery reads
// a server-held list of AUTHORS (FC_READ_FIDS) through GET /v2/farcaster/feed/?feed_type=filter&filter_type=fids, one
// page per miss, never a channel feed; there is no "channel" op, and every channel tab stays seed. The side apps get
// the stub's own fid list; the pair gets it from run-prod-shape.sh (`node scripts/lib/neynar-stub.mjs fids`).
// FC-READ (house): discovery has a SECOND source the owner may choose instead — FC_READ_HOUSE_FID, one "house"
// Farcaster account whose FOLLOWS are the curation list (discovery = GET /v2/farcaster/feed/following/?fid=<house>
// &with_recasts=false&limit=25, the fid pinned to the server's constant). Exactly ONE source may be set: both, neither
// or a malformed value leave the relay unarmed (bad_config). The pair runs either source (run-prod-shape.sh
// PRODLIVE_FC_READ_SOURCE=fids|house; the stub serves the same planted corpus both ways, so every pair check measures
// either); checks 24-24d measure the house source, and its refusals, on side apps.
// This suite proves each of those against real processes — and every check asserts its PRECONDITION
// first, because the design's list of vacuous tests is binding: a refused like proves nothing when no live card
// rendered, a budget refusal proves nothing when the relay was never armed, "no fid upstream" proves nothing against a
// stub that ignores query strings, a shared-cache test proves nothing without the upstream hit count.
//
//   PRODLIVE_FC_READ=stub PRODLIVE_FC_SOURCES=foryou=neynar bash scripts/run-prod-shape.sh [--build] scripts/accept-fcread.mjs
//   (NEYNAR AS A SWITCH, §42: an armed key alone no longer puts Neynar on For You; FC_SOURCE_FORYOU=neynar does, and
//   check 0 refuses a pair started without it. The side apps hold FC_SOURCE_FORYOU=neynar themselves: sideEnv.)
//   (or, with that pair already up: node scripts/accept-fcread.mjs; NEYNAR_STUB_URL defaults to 127.0.0.1:4319)
//
// ABORTS (exit 2) unless: BASE_URL and VALIDATOR_URL are loopback (this suite needs the stub; it never runs against a
// deployment — scripts/smoke-deployed.mjs does, with EXPECT_FC_READ), /api/dev answers 403 (the public shape), the
// validator answers, the Neynar stub answers at NEYNAR_STUB_URL, and FCREAD_SIDE_PORT (default 3029) is free.
//
// Two kinds of app are measured:
//   * THE PAIR (BASE_URL), started by run-prod-shape.sh with a fake key and the stub as its upstream — the browser
//     checks run here, as a visitor would meet them;
//   * SIDE APPS: `next start` of the same build on FCREAD_SIDE_PORT with one variable changed each (no key, a spent
//     budget, the kill switch, TRUST_PROXY=true), pointed at an IN-PROCESS stub so their upstream counts are exact.
//     Side apps use the same validator (its CORS is open), so their devices boot for real.
//
//   0. the pair's relay is ARMED on THIS stub: status armed, and a miss arrives at the stub carrying the fake key
//      (the precondition for every pair check)
//   2. LIVE CARDS: /home shows data-live cards whose hashes are 0x + 40 hex and were served by the stub; the page's
//      device env says FC_READ_RELAY=on; feed2 marks those cards network:true
//  2d. FC-READ (review) THE NETWORK MARKER: every live card carries a visible "Farcaster · read-only" marker
//      (data-testid=network-marker); no seed card carries one
//  16. THE LIVE-SOURCE CHIP says "live" (data-state), in copy free of the page-health needle words; feed2 and the
//      classic feed report liveSource relay/live; the Following surface reports seed
//   3. NO DIRECT UPSTREAM: while live cards are visible, no page request went to api.neynar.com or the stub's origin
//      (every non-loopback request is intercepted and recorded — nothing leaves the machine)
//  15. THE SCORE FLOOR hides an author below FC_READ_MIN_SCORE and one with no score (the stub served both); their
//      profiles answer not_found
// 15b. THE DENYLIST (FC_READ_DENY) hides a served hash, in the feed and as a thread
// 15c. FC-READ (future-dated casts) A CAST DATED DECADES AHEAD (the stub serves a top-level cast dated 2061, a shape the
//      real network carries) is dropped: not in the discovery value, not on /home (whose final order is by recency,
//      so it would sit on top), and its thread answers not_found
//  17. PAGE HEALTH EXCLUDES CAST TEXT: a live card whose text is made of needle words ("404", "refusing to",
//      "Couldn't load") is visible, and scripts/lib/page-health.mjs inlineErrors still reads the page as clean
//  18. MEDIA: every <img> on a live card is referrerpolicy=no-referrer + loading=lazy, the image requests themselves
//      carried no Referer, and an image on a host outside the allowlist is click-to-load — never requested until the
//      visitor clicks
//  2b. a live THREAD and a live PROFILE open in the browser (the relay's thread, user and user-casts ops)
//  2c. FC-READ (review) on that thread and that profile: the live-source chip says live (copy free of needle words),
//      the permalink root and the profile header carry the network marker
//  22. FC-READ (review) A FIXTURE PROFILE IS NOT NETWORK: /karpathy (lib/fixtures/data.json) renders with no data-live
//      Follow, no network marker, no live-source chip and no relay lookup — on a relay-armed deployment
//  20. FC-READ (review) FRAMING: every document answers CSP frame-ancestors 'none' + X-Frame-Options DENY, and a
//      preview page framed by another site is blocked by the browser (no script, no relay request)
//   6. SHARED CACHE: a second browser profile gets the same live cards with the stub's hit count UNCHANGED
//   7. LIKE: liking a live card is refused 403 NETWORK_READ_ONLY with the sentence and the count stays; liking a seed
//      card still answers 200
//  7b. the other writes on a live card are refused the same way: recast, reply, act-as, folder add, stake
//   8. FOLLOWING STAYS LOCAL: a post round-trips on Following with the relay on; Following carries no network cast
//  23. FC-READ (no channels) NO LIVE CHANNEL TAB: a channel-shaped classic home tab ("art", a former default channel,
//      and the fixture's own channel tab) answers seed from the device with no relay request and no stub hit, while
//      For You on the same device still reads the relay (the positive control)
//  21. FC-READ (review) AN AUTHOR-HIDE-RULE MODE (Event Safe Space, rule_no_low_tier): the timeline shows the seeded
//      cards with the chip at data-state=filtered — never an empty page under a live label; back on Default, live
// 21b. the bound extras that act on a cast's identity (refute, note, custom-rule) are disabled on a live card with
//      the sentence, and a tap navigates nowhere
//  5a. CLIENT PARAMETERS ARE REFUSED, NOT STRIPPED: fid, viewer_fid, cursor, limit, provider, a query string, an
//      unknown op, a malformed hash or handle, the RETIRED channel op (FC-READ no channels: any id, a former default
//      channel included) → 400 bad_op, stub hits frozen
//   1. NO KEY (side app): status no_key, the device env carries no hint, seed cards render, no live card, no relay
//      request from the page, the stub never called
//   9. BUDGET (side app, FC_READ_DAILY_CREDITS=1): status ARMED first (so the refusal is the budget's, not no_key),
//      then every read → 503 fc_read_budget with the stub never called
// 16b. the chip says "budget" on that app, over seed cards, and the device does not retry a final refusal
//  9b. FC-READ (review) on that app a thread page and a profile page the relay refused (503 fc_read_budget) render
//      the PAUSED state (data-testid=live-paused: the relay's sentence + Retry), never the load-error block
//  10. KILL SWITCH (side app, FC_READ=off): status off, reads → 503 fc_read_off, no hint in the page, stub never called
//  5b. LOOKUPS (side app): discovery, user, user-casts and a thread through the relay; the payloads are mapped (no raw
//      Neynar fields); user-casts carries the fid the by_username lookup resolved. FC-READ (no channels): the channel
//      op is refused 400 bad_op with ZERO upstream calls (discovery cached or not), and no channel feed is ever read
//  5d. FC-READ (no channels) DISCOVERY READS THE DECIDED ENDPOINT (side app, exact counts): its one miss is ONE
//      upstream GET /v2/farcaster/feed/ carrying exactly feed_type=filter, filter_type=fids, fids=<the app's
//      FC_READ_FIDS>, with_recasts=false, limit=25 (no cursor, no viewer_fid) and never /feed/channels; the reply the
//      stub planted inside that feed is dropped, and no relayed cast carries a channel. FC-READ (future-dated casts):
//      the top-level cast the stub planted with a 2061 date is dropped too, and no cast is dated > 10 min ahead — in
//      the discovery value AND on its author's profile (user-casts, which the stub answers with that cast in it)
//  5c. FC-READ (review) fnames that are also parameter words (cursor, following, notifications) are LOOKED UP — one
//      upstream by_username each, answered not_found — never refused after a charge
//  2e. FC-READ (review) a STALE answer on a thread and a profile page turns their chip to data-state=stale (the
//      relay's own answer, relabelled stale on the wire: the relay itself never shelves a lookup, the tab does)
// 20b. FC-READ (review) with the framing headers stripped (a proxy that drops them), a framed preview page's device
//      still makes NO lookup — it shows the paused state — while the same page opened top level does
//  13. NEGATIVE CACHE: a random 40-hex thread reaches the stub once, then is answered 404 from cache (a case variant too)
//  12. THE SERVER STAYS SEED: fetching a random /<fname>, /home, /explore, a profile and a thread page (no browser, so
//      no device) causes no stub hit — after a positive control that a miss on this app does move the counter
//  11. CROSS-SITE: no x-layers-relay header, Sec-Fetch-Site: cross-site, a GET, a text/plain body, and a real
//      browser on another site (fetch with the header → preflight refused; no-cors → refused) — stub hits frozen
//  14. TRUST_PROXY=true + spoofed X-Forwarded-For: first proven that the spoofed address DOES choose the per-address
//      bucket (else this would be GAP 6's vacuous local test), then a 100-address burst is still held by the global
//      bucket (<= 60 upstream, 429 fc_read_rate with Retry-After)
//  24. FC-READ (house) THE HOUSE SOURCE (side app holding FC_READ_HOUSE_FID and no FC_READ_FIDS): armed; its one
//      discovery miss is ONE upstream GET /v2/farcaster/feed/following/ carrying exactly fid=<the house fid>,
//      with_recasts=false, limit=25 (no viewer_fid, no cursor) and nothing else; the in-feed reply, the low/no-score
//      authors, the denylisted hash and the future-dated cast never reach the value; /home renders live cards from it (the page's own read a
//      cache hit); the status names neither the source nor the fid
// 24b. FC-READ (house) THE HOUSE MISS COSTS 100 (4 x limit 25, like the fids read): on a 100-credit day the status is
//      live, the one miss is served, and the status then says budget
// 24c. FC-READ (house) EXACTLY ONE SOURCE: FC_READ_FIDS + FC_READ_HOUSE_FID both set → bad_config, and neither set →
//      bad_config — each with discovery 503 fc_read_unarmed, no hint in the page, ZERO stub calls, and a log line that
//      names the variables and never a value (the same key, base, fid list and house fid arm alone: 5b, 24)
// 24d. FC-READ (house) A MALFORMED HOUSE FID (zero; a leading zero; a list; a username) → bad_config naming
//      FC_READ_HOUSE_FID, zero stub calls (the full malformed matrix, in-process, is check 25's U6)
//  25. FC-READ (house, review: house-pathcheck-untested) THE RELAY'S OWN CHECKS: scripts/unit-fcread-relay.mjs calls
//      upstreamPathAllowed and the arming directly (every other following shape refused in house mode, none in list
//      mode, the house path for discovery only, malformed/both/neither sources bad_config with zero fetches) — the
//      refusals no end-to-end check can see, because the relay only ever builds the one correct path
//   5. UPSTREAM DISCIPLINE, over everything both stubs saw: no violation, raw query strings recorded, every relay
//      endpoint exercised, no viewer_fid/cursor/provider, a fid only on user-casts and only a resolved one, never a
//      device's pseudo-fid, never /notifications or a following feed, the fake key on every call. FC-READ (no
//      channels): never a channel feed, and every discovery request carries exactly the decided constants.
//      FC-READ (house): the one following feed allowed is the pinned house request (house fid, pinned constants,
//      nothing else), and the pair read discovery from the source it was started with (PRODLIVE_FC_READ_SOURCE)
//   4. THE KEY NEVER LEAVES THE SERVER: not in /home, /explore or /device HTML, the RSC payload, device.js (served and
//      on disk), the page's device env, any relay body, the app log or .next/static; device.js carries neither
//      NEYNAR_READ_API_KEY nor readRelay; the side apps' keys are in none of their outputs
//  19. THE STATUS OP IS PUBLIC-SAFE on every app measured: documented fields only, no number, never the key
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { INLINE_ERROR_NEEDLES, inlineErrors, scanNeedles, waitForDevice, waitForTimelineCards } from "./lib/page-health.mjs";
import {
  FORBIDDEN_PORTS,
  HASH40,
  RELAY,
  STUB_DEFAULT_PORT,
  STUB_DENY_HASH,
  STUB_KEY_PREFIX,
  STUB_MARKERS,
  STUB_MEDIA_HOST,
  STUB_USERS,
  discoveryParamProblems,
  houseRequestProblems,
  isChannelFeedRequest,
  isFollowingFeedRequest,
  startNeynarStub,
  statusProblems,
  stubClient,
  stubDiscoveryFids,
  stubHouseFid,
} from "./lib/neynar-stub.mjs";

const BASE = (process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/$/, "");
const VBASE = (process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`).replace(/\/$/, "");
const STUB_URL = (process.env.NEYNAR_STUB_URL || `http://127.0.0.1:${STUB_DEFAULT_PORT}`).replace(/\/$/, "");
const SIDE_PORT = Number(process.env.FCREAD_SIDE_PORT || 3029);
// the side apps answer on "localhost"; the stub (and its cross-site probe page) on 127.0.0.1 — a different site
const SIDE_BASE = `http://localhost:${SIDE_PORT}`;
const SENTENCE = RELAY.networkReadOnly.error;
const LIVE_SEL = 'main article[data-testid="cast"][data-live]:not([data-live="false"])';
const MARKER_LIST = Object.values(STUB_MARKERS);
const stamp = Date.now().toString(36).slice(-5);

const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e && e.message ? e.message : String(e)); } }
/** a precondition: when it does not hold, the check FAILS saying so — it never passes over nothing */
const need = (cond, msg) => { if (!cond) throw new Error("precondition: " + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const isLoopbackUrl = (u) => { try { const x = typeof u === "string" ? new URL(u) : u; return x.protocol === "data:" || x.protocol === "blob:" || LOOPBACK.has(x.hostname); } catch { return true; } };
const portOf = (u) => { try { const x = new URL(u); return x.port || (x.protocol === "https:" ? "443" : "80"); } catch { return ""; } };
const randomHash = () => "0x" + randomBytes(20).toString("hex");
const get = async (url, init) => { const r = await fetch(url, { cache: "no-store", ...init }); const text = await r.text(); return { status: r.status, text, type: r.headers.get("content-type") || "" }; };
const summary = (x) => JSON.stringify(x).slice(0, 180);
// FC-READ (review): the shared UI contract for the new states
const NETWORK_MARKER_TEXT = "Farcaster · read-only";
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
/** the device's CLOSED table of relay-refusal sentences (lib/views/social.ts LIVE_PAUSED_SENTENCES), read from the
 *  source the islands and the device both import — so "the paused block carries the relay's sentence" is checked
 *  against the one table, not a copy that could drift. null when the table cannot be read (a precondition then). */
function livePausedSentences() {
  try {
    const src = readFileSync(path.join("lib", "views", "social.ts"), "utf8");
    const m = /export const LIVE_PAUSED_SENTENCES\s*=\s*\{([\s\S]*?)\}\s*as const/.exec(src);
    if (!m) return null;
    const out = {};
    for (const x of m[1].matchAll(/^\s*([a-z_]+)\s*:\s*"((?:[^"\\]|\\.)*)"/gm)) out[x[1]] = JSON.parse('"' + x[2] + '"');
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
const PAUSED = livePausedSentences();
/** a document's response headers (lower-cased names), fetched with no browser */
async function headersOf(url) {
  const r = await fetch(url, { cache: "no-store", redirect: "manual" });
  await r.arrayBuffer().catch(() => null);
  return { status: r.status, h: Object.fromEntries([...r.headers].map(([k, v]) => [k.toLowerCase(), v])) };
}
/** what a thread or profile page shows about where its content came from (frame = the page, or one of its frames) */
const pageMarks = (frame) =>
  frame.evaluate(() => {
    const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const txt = (el) => (el?.innerText || "").replace(/\s+/g, " ").trim();
    const root = document.querySelector('main article[data-testid="permalink-cast"]');
    const rootMarker = root ? root.querySelector('[data-testid="network-marker"]') : null;
    const paused = document.querySelector('[data-testid="live-paused"]');
    return {
      path: location.pathname,
      chips: [...document.querySelectorAll('[data-testid="live-source"]')].map((c) => ({ state: c.getAttribute("data-state"), text: txt(c), visible: vis(c) })),
      root: root ? { live: root.getAttribute("data-live"), hash: root.getAttribute("data-hash"), marker: rootMarker ? { text: txt(rootMarker), visible: vis(rootMarker) } : null } : null,
      liveFollow: document.querySelectorAll('main [data-testid="follow-button"][data-live="true"]').length,
      // markers outside any cast article: the permalink root is an article too, so "header" = not inside an article
      headerMarkers: [...document.querySelectorAll('main [data-testid="network-marker"]')].filter((m) => !m.closest("article")).map((m) => ({ text: txt(m), visible: vis(m) })),
      allMarkers: document.querySelectorAll('main [data-testid="network-marker"]').length,
      paused: paused ? { text: txt(paused), visible: vis(paused), retry: !!paused.querySelector('[data-testid="live-paused-retry"]') || !!document.querySelector('[data-testid="live-paused-retry"]') } : null,
      loadError: [...document.querySelectorAll('[data-testid="permalink-error"], [data-testid="profile-error"]')].filter(vis).map(txt),
      notFound: !!document.querySelector('[data-testid="permalink-not-found"], [data-testid="profile-not-found"]'),
      handleShown: txt(document.querySelector("main")).match(/@[A-Za-z0-9_.-]+/g) ?? [],
    };
  });
/** wait until `pred(marks)` holds on `frame`, or the time runs out; returns the last marks read */
async function waitMarks(frame, pred, ms) {
  const deadline = Date.now() + ms;
  let last = null;
  while (Date.now() < deadline) {
    last = await pageMarks(frame).catch(() => last);
    if (last && pred(last)) return last;
    await sleep(500);
  }
  return last;
}

console.log("\nFC-READ — public live Farcaster reads (app " + BASE + ", validator " + VBASE + ", stub " + STUB_URL + ", side apps on :" + SIDE_PORT + ")");

// ---------------------------------------------------------------- preflight: local only, the public shape, the stub
if (!isLoopbackUrl(BASE) || !isLoopbackUrl(VBASE)) {
  console.log("  ABORT: this suite runs only against the LOCAL production-shaped pair (it needs the loopback Neynar stub); a deployment is measured by scripts/smoke-deployed.mjs with EXPECT_FC_READ");
  process.exit(2);
}
if (FORBIDDEN_PORTS.has(SIDE_PORT) || String(SIDE_PORT) === portOf(BASE) || String(SIDE_PORT) === portOf(VBASE)) {
  console.log("  ABORT: FCREAD_SIDE_PORT=" + SIDE_PORT + " is pinned for the pair or another suite");
  process.exit(2);
}
const devProbe = await get(BASE + "/api/dev").catch(() => ({ status: 0 }));
if (devProbe.status !== 403) {
  console.log("  ABORT: /api/dev answered " + devProbe.status + " — this suite runs against the PUBLIC shape (dev hooks off), never the rig");
  process.exit(2);
}
const vh = await get(VBASE + "/health").catch(() => ({ status: 0 }));
if (vh.status !== 200) {
  console.log("  ABORT: the validator's /health answered " + vh.status + " at " + VBASE);
  process.exit(2);
}
const mainStub = stubClient(STUB_URL);
const st0 = await mainStub.state().catch(() => null);
if (!st0 || !st0.ok) {
  console.log("  ABORT: no Neynar stub answers at " + STUB_URL + " — start the pair with: PRODLIVE_FC_READ=stub PRODLIVE_FC_SOURCES=foryou=neynar bash scripts/run-prod-shape.sh");
  process.exit(2);
}
async function portOpen(port) {
  return new Promise((r) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => { s.destroy(); r(true); });
    s.once("error", () => r(false));
  });
}
if (await portOpen(SIDE_PORT)) {
  console.log("  ABORT: port " + SIDE_PORT + " is already held — a side app left from an earlier run? Free it (or set FCREAD_SIDE_PORT) and re-run");
  process.exit(2);
}
// a device boot is a burst of validator calls; wait until the per-address bucket holds a reserve (cu6's lesson).
// FC-READ (review): a function now — the review's checks boot about twice as many devices (a mode switch, a framed
// page and its control, paused and stale pages on the side apps), so each browser section waits for a reserve first
async function validatorReserve(ms = 180_000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const burst = await Promise.all(Array.from({ length: 8 }, () => get(VBASE + "/zk/members").catch(() => ({ status: 0 }))));
    if (burst.every((r) => r.status !== 429 && r.status !== 0)) return true;
    await sleep(5000);
  }
  return false;
}
if (!(await validatorReserve())) {
  console.log("  ABORT: the validator's rate-limit bucket never held a reserve within 180 s");
  process.exit(2);
}
const needReserve = async () => need(await validatorReserve(), "the validator's rate-limit bucket never held a reserve within 180 s — a device boot here would fail for that, not for what is measured");
const MAIN_KEY = st0.key;
const PLANTED = st0.planted;
// FC-READ (no channels): the decided discovery read, and the author list the side apps hold as FC_READ_FIDS (the
// stub's own: every planted cast's author, so each one is served the way Neynar would serve it — by its author's fid)
const DISC = RELAY.discovery;
const SIDE_FIDS = stubDiscoveryFids();
// FC-READ (house): the second source — the stub's one house account (its following feed is the same planted corpus)
const HOUSE = RELAY.house;
const HOUSE_FID = stubHouseFid();
/** FC-READ (house): which source the PAIR was started with — run-prod-shape.sh passes PRODLIVE_FC_READ_SOURCE in stub
 *  mode ("fids" by default, "house"); "" when the suite runs without the launcher (check 5 then reports what it saw) */
const PAIR_SOURCE = (process.env.PRODLIVE_FC_READ_SOURCE || "").trim().toLowerCase();
if (PAIR_SOURCE && PAIR_SOURCE !== "fids" && PAIR_SOURCE !== "house") {
  console.log("  ABORT: PRODLIVE_FC_READ_SOURCE=" + JSON.stringify(PAIR_SOURCE) + " is neither fids nor house");
  process.exit(2);
}
/** FC-READ (house): a recorded upstream request is a discovery read (either source, or a wrong following feed) */
const isDiscoveryRead = (x) => (x.route === DISC.route && typeof x.params?.[DISC.fidsParam] === "string") || isFollowingFeedRequest(x.route, x.params);
/** FC-READ (no channels): why a planted cast may be missing from the pair's discovery answer — the pair's FC_READ_FIDS
 *  (read back from the fids its last discovery request carried) does not name the planted authors. "" when it does. */
async function plantedReachNote() {
  const st = await mainStub.state().catch(() => null);
  const last = [...(st?.requests ?? [])].reverse().find(isDiscoveryRead);
  if (!last) {
    const ch = (st?.requests ?? []).find((x) => isChannelFeedRequest(x.route, x.params));
    return ch ? ` (the pair read a CHANNEL feed (${ch.route}) instead of the fids feed: a build from before FC-READ (no channels)?)` : " (the pair made no discovery read upstream)";
  }
  // FC-READ (house): a house-mode pair reads the house account's following feed; the stub's house follows every
  // planted author, so the only way a planted cast is missing there is a request that is not the pinned one
  if (isFollowingFeedRequest(last.route, last.params)) {
    const off = houseRequestProblems(last, HOUSE_FID);
    return off.length
      ? ` (the pair read a following feed that is not the stub's pinned house request — ${off.join("; ")}: in stub house mode the pair needs ${HOUSE.env}="$(node scripts/lib/neynar-stub.mjs house-fid)")`
      : "";
  }
  const asked = new Set(String(last.params[DISC.fidsParam]).split(",").map(Number));
  const missing = Object.entries(PLANTED.fids ?? {}).filter(([, f]) => Number.isInteger(f) && !asked.has(f)).map(([k]) => k);
  return missing.length
    ? ` (the pair's ${DISC.fidsEnv} omits the planted ${missing.join(", ")} author(s): in stub mode the pair needs ${DISC.fidsEnv}="$(node scripts/lib/neynar-stub.mjs fids)")`
    : "";
}
const needPlanted = async (cond, msg) => { if (!cond) need(false, msg + (await plantedReachNote())); };

// ---------------------------------------------------------------- the relay, from node (no browser, no device)
const relayBodies = []; // every relay answer the suite saw (node and browser) — the key scan reads them all
async function relay(base, body, { headers = {}, noHeader = false, xff, raw, query = "", contentType = "application/json" } = {}) {
  const h = { "content-type": contentType, ...(noHeader ? {} : { [RELAY.header]: "1" }), ...(xff ? { "x-forwarded-for": xff } : {}), ...headers };
  const r = await fetch(base + RELAY.path + query, { method: "POST", headers: h, body: raw ?? JSON.stringify(body), cache: "no-store" });
  const text = await r.text();
  relayBodies.push(text);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, retryAfter: r.headers.get("retry-after") };
}
/** the casts in a relay value, whatever op produced it */
function castsOf(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.casts)) return v.casts;
  if (v && v.cast) return [v.cast, ...(v.ancestors ?? []), ...(v.replies ?? [])];
  return [];
}
const statuses = []; // [label, json] for check 19

// ---------------------------------------------------------------- the browser: hermetic, recorded
const browser = await chromium.launch();
// a 1x1 transparent PNG: what every non-loopback request is answered with (nothing leaves this machine)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const isRelayUrl = (u) => { try { return new URL(u).pathname === RELAY.path; } catch { return false; } };

async function openCtx(label, { intercept = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // FC-READ (lead fix): validator429 — the validator's rate-limit refusals this context met. A device boot is a burst of
  // validator calls from the one loopback address every local suite shares; when one fails, the failure line says
  // whether the bucket was empty, so "the product broke" and "the harness drained the bucket" read differently.
  const rec = { label, requests: [], external: [], relay: [], errors: [], validator429: 0 };
  // every non-loopback request is answered HERE and recorded with its Referer: "no request reached api.neynar.com" and
  // "live images carry no referrer" are measured on the wire the browser built, not read off attributes alone
  // FC-READ (lead fix): { intercept: false } opts a context out. Any ctx.route turns on request interception, and under
  // interception Playwright itself ANSWERS every CORS preflight with an approval (Access-Control-Allow-Origin/-Headers
  // echoed back) — so a page's "preflight refused" is never the server's refusal there. Check 11 measures exactly that
  // refusal, from a static page that loads nothing off this machine, so its context runs without interception.
  if (intercept) await ctx.route((url) => !isLoopbackUrl(url), async (route) => {
    const req = route.request();
    let referer = null;
    try { referer = await req.headerValue("referer"); } catch { /* none */ }
    rec.external.push({ url: req.url(), host: hostOf(req.url()), type: req.resourceType(), referer, at: Date.now() });
    await route.fulfill({ status: 200, contentType: "image/png", body: PNG }).catch(() => {});
  });
  ctx.on("request", (req) => rec.requests.push({ url: req.url(), method: req.method(), post: req.postData() || "", at: Date.now(), req }));
  ctx.on("response", async (res) => {
    if (res.status() === 429 && isValidatorUrl(res.url())) rec.validator429++;
    if (res.request().method() !== "POST" || !isRelayUrl(res.url())) return;
    let body = "";
    try { body = await res.text(); } catch { /* aborted */ }
    relayBodies.push(body);
    const post = res.request().postData() || "";
    let op = "?";
    let arg;
    try { ({ op, arg } = JSON.parse(post)); } catch { /* not json */ }
    rec.relay.push({ status: res.status(), post, op, arg, body, at: Date.now() });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => rec.errors.push(String(e).slice(0, 200)));
  return { ctx, page, rec, info: null, env: null, close: () => ctx.close().catch(() => {}) };
}

/** the validator, however a page addresses it (the build names localhost; VALIDATOR_URL may name 127.0.0.1) */
const isValidatorUrl = (u) => { try { const x = new URL(u); return LOOPBACK.has(x.hostname) && portOf(u) === portOf(VBASE); } catch { return false; } };
/** FC-READ (lead fix): appended to a failure in a browser context that met validator 429s (see openCtx) */
const rateNote = (d) => (d?.rec?.validator429 ? ` [${d.rec.validator429} validator 429 answer(s) in this browser context: the shared per-address bucket ran dry — suspect the harness before the product]` : "");
/** a full load of `p`, the device booted, its env read (the hint the server set) */
async function load(d, base, p) {
  await d.page.goto(base + p, { waitUntil: "load", timeout: 120_000 });
  d.info = await waitForDevice(d.page, 120_000).catch((e) => {
    throw new Error(String(e && e.message ? e.message : e) + rateNote(d));
  });
  d.env = await d.page.evaluate(() => (window.__LAYERS_DEVICE_ENV ? { ...window.__LAYERS_DEVICE_ENV } : null));
  await d.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  return d.info;
}

const apiInPage = (page, method, p, body) =>
  page.evaluate(
    async ({ method, p, body }) => {
      const r = await fetch(p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null;
      try { json = await r.json(); } catch { /* not json */ }
      return { status: r.status, json };
    },
    { method, p, body }
  );

const liveCards = (page) =>
  page.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((a) => ({
      hash: a.getAttribute("data-hash"),
      text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 800),
      authors: [...a.querySelectorAll("a[href]")].map((x) => x.getAttribute("href")).filter((h) => /^\/[A-Za-z0-9_.-]+$/.test(h || "")),
      imgs: [...a.querySelectorAll("img")].map((i) => ({ src: i.getAttribute("src") || "", referrerpolicy: i.getAttribute("referrerpolicy"), loading: i.getAttribute("loading") })),
      clickToLoad: [...a.querySelectorAll('[data-testid="media-click-to-load"]')].map((b) => ({ host: b.getAttribute("data-host"), title: b.getAttribute("title") || "" })),
    })), LIVE_SEL);

async function waitLive(page, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const n = await page.locator(LIVE_SEL).count().catch(() => 0);
    if (n > 0) return n;
    await sleep(500);
  }
  return 0;
}
const relaySummary = (d) => d.rec.relay.map((r) => `${r.op}${r.arg ? "(" + String(r.arg).slice(0, 12) + ")" : ""}→${r.status}`).join(", ") || "no relay request";

// ---------------------------------------------------------------- side apps: the same build, one variable changed
const require = createRequire(import.meta.url);
const contract = require("../validator/env-contract.js");
const sideChildren = new Set();
const sideOutputs = []; // [label, getOutput, key]
function killTree(child) {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch { /* already gone */ }
}
process.on("exit", () => { for (const c of sideChildren) killTree(c); });

async function waitPortFree(port, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!(await portOpen(port))) return;
    await sleep(500);
  }
  throw new Error("port " + port + " still held " + Math.round(ms / 1000) + " s later — refusing to measure a stale side app");
}

function sideEnv(extra) {
  const env = { ...process.env };
  // nothing of the caller's relay config or hosting leaks in: each side app states its own
  for (const k of Object.keys(env)) if (k.startsWith("RAILWAY_") || k.startsWith("FC_READ") || k.startsWith("NEYNAR_READ")) delete env[k];
  for (const n of [...(contract.MUST_NOT_SHIP ?? []), ...(contract.VALIDATOR_REFUSES ?? [])]) env[n] = "";
  Object.assign(env, {
    NODE_ENV: "production",
    ZK_DEV_HOOKS: "",
    LAYERS_REQUIRE_SIG: "true",
    ZK_PREFETCH_MS: "3000",
    DATA_SOURCE: "",
    CUSTODY_FIXTURE_PROVIDER: "",
    LAYERS_MAINTENANCE: "",
    TRUST_PROXY: "",
    OWNER_ACCESS_SECRET: "",
    LAYERS_HOSTED: "",
    LAYERS_APP_PORT: String(SIDE_PORT),
    LAYERS_VALIDATOR_PORT: portOf(VBASE),
    VALIDATOR_URL: VBASE,
    NEXT_PUBLIC_VALIDATOR_URL: VBASE,
    APP_URL: SIDE_BASE,
    KEYSTORE_DIR: mkdtempSync(path.join(tmpdir(), "layers-fcread-")),
    // blank, not absent: a set-but-empty variable beats .env.local in `next start`
    NEYNAR_READ_API_KEY: "",
    NEYNAR_READ_BASE_URL: "",
    FC_READ_RIG: "",
    FC_READ_DENY: "",
    // FC-READ (no channels): the owner's real author list (.env.local, once live) must never reach a side app; the
    // armed side apps name the stub's own list (sideRelayArgs), the others hold none
    FC_READ_FIDS: "",
    // FC-READ (house): the same for the owner's real house account — blank, not absent (a set-but-empty variable beats
    // .env.local), or every fids-mode side app would hold BOTH sources and answer bad_config; the house apps name the
    // stub's own house fid (sideHouseArgs)
    FC_READ_HOUSE_FID: "",
    // NEYNAR AS A SWITCH (§42): this suite measures the relay's For You list and the lookups it opens, which the operator
    // switches on with FC_SOURCE_FORYOU (an armed key alone no longer puts Neynar on For You). Every other switch blank,
    // not absent (a set-but-empty variable beats .env.local).
    FC_SOURCE_FOLLOWING: "",
    FC_SOURCE_NOTIFICATIONS: "",
    FC_SOURCE_FORYOU: "neynar",
    FC_SOURCE_SEARCH: "",
    FC_SOURCE_COUNTS: "",
    FC_SOURCE_CHANNELS: "",
  });
  return { ...env, ...extra };
}

async function startSide(label, extra) {
  await waitPortFree(SIDE_PORT);
  const env = sideEnv(extra);
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(SIDE_PORT)], { env, cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  sideChildren.add(child);
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (out += b));
  const exited = new Promise((r) => child.on("exit", (code) => r(code)));
  sideOutputs.push([label, () => out, extra.NEYNAR_READ_API_KEY || ""]);
  const stop = async () => {
    killTree(child);
    await Promise.race([exited, sleep(10_000)]);
    sideChildren.delete(child);
    await waitPortFree(SIDE_PORT).catch(() => {});
  };
  for (let i = 0; i < 180; i++) {
    const code = await Promise.race([exited, sleep(500).then(() => undefined)]);
    if (code !== undefined) {
      sideChildren.delete(child);
      throw new Error(`the ${label} side app exited ${code} before answering: ` + out.slice(-300));
    }
    try {
      const r = await fetch(SIDE_BASE + "/api/health", { cache: "no-store" });
      if (r.ok) return { label, base: SIDE_BASE, out: () => out, stop };
    } catch { /* not yet */ }
  }
  await stop();
  throw new Error(`the ${label} side app did not answer /api/health within 90 s: ` + out.slice(-300));
}

/**
 * FC-READ (lead fix, check 20b): a real header-stripping proxy on a loopback socket — "a proxy that drops them",
 * literally. 20b used to strip the framing headers with Playwright's route.fulfill, and a document the automation layer
 * fulfils has no network address: the browser then treats it as outside the loopback address space and refuses its
 * requests to the loopback validator ("Permission was denied for this request to access the `loopback` address
 * space") — so the framed device could never boot, and the check failed on its own rig, not on the product. Served
 * from this socket, the page keeps a loopback address like every other page in the suite. Everything is forwarded to
 * `targetBase` (Host rewritten to the target's, no forwarding header added, bodies streamed both ways); only
 * Content-Security-Policy and X-Frame-Options are dropped, from every response. `stripped()` counts the HTML documents
 * served for `countPath` with at least one of those headers removed.
 */
async function startStripProxy(targetBase, countPath) {
  const target = new URL(targetBase);
  let stripped = 0;
  const server = http.createServer((req, res) => {
    const up = http.request(
      { hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: target.host } },
      (ur) => {
        const headers = { ...ur.headers };
        let dropped = false;
        for (const k of Object.keys(headers)) {
          if (/^(content-security-policy|x-frame-options)$/i.test(k)) {
            delete headers[k];
            dropped = true;
          }
        }
        if (dropped && String(req.url).split("?")[0] === countPath && /text\/html/i.test(String(ur.headers["content-type"] || ""))) stripped++;
        res.writeHead(ur.statusCode || 502, headers);
        ur.pipe(res);
      }
    );
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("proxy: upstream unreachable");
    });
    req.pipe(up);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  if (FORBIDDEN_PORTS.has(port)) {
    server.close();
    throw new Error("the OS handed the stripping proxy pinned port " + port);
  }
  // addressed as localhost (the app's host name): cross-site from the probe page on 127.0.0.1, as the app itself is
  return {
    base: "http://localhost:" + port,
    stripped: () => stripped,
    close: () => new Promise((r) => { if (server.closeAllConnections) server.closeAllConnections(); server.close(() => r()); }),
  };
}

// ================================================================ THE PAIR
let pairArmed = false;
const A = await openCtx("A");
let B = null;
const deviceFids = new Set();
const initialLive = { hashes: [] };

await check("0. the pair's relay is ARMED on this stub: status armed, and a miss reaches the stub carrying the fake key", async () => {
  need(MAIN_KEY.startsWith(STUB_KEY_PREFIX) && MAIN_KEY.length >= 16, "the stub's key is not a fake stub key");
  const status = await relay(BASE, { op: "status" });
  statuses.push(["the pair", status.json]);
  if (status.status !== 200) throw new Error("the status op answered " + status.status + " " + status.text.slice(0, 160));
  // FC-READ (no channels): FC_READ_FIDS has no default, so a stub-mode pair started without it answers bad_config.
  // FC-READ (house): nor does FC_READ_HOUSE_FID — and holding BOTH is bad_config too
  const fidsHint = status.json?.reason === "bad_config"
    ? ` — bad_config: the pair's app must hold exactly ONE discovery source: ${DISC.fidsEnv} (stub mode: "$(node scripts/lib/neynar-stub.mjs fids)") or ${HOUSE.env} (PRODLIVE_FC_READ_SOURCE=house: "$(node scripts/lib/neynar-stub.mjs house-fid)"), never both`
    : "";
  if (status.json?.armed !== true || status.json?.reason !== "armed") throw new Error("the pair's relay is not armed (" + summary(status.json) + ") — was it started with PRODLIVE_FC_READ=stub?" + fidsHint + " Every pair check below measures nothing");
  // NEYNAR AS A SWITCH (§42): an armed key alone no longer puts Neynar on For You — the operator's FC_SOURCE_FORYOU does.
  // Every pair check below measures the relay's For You list, so the pair must have been started with it on.
  if (!/(^|,)\s*foryou=(neynar|auto)\b/.test(process.env.EXPECT_FC_SOURCES ?? "")) {
    throw new Error("the pair was not started with For You switched to Neynar (EXPECT_FC_SOURCES=" + JSON.stringify(process.env.EXPECT_FC_SOURCES ?? "") + ") — run: PRODLIVE_FC_READ=stub PRODLIVE_FC_SOURCES=foryou=neynar bash scripts/run-prod-shape.sh scripts/accept-fcread.mjs");
  }
  // FC-READ (no channels): the status answer names no channel list any more (check 19 polices its fields)
  const probe = randomHash();
  const r = await relay(BASE, { op: "thread", arg: probe });
  const st = await mainStub.state();
  const seen = st.requests.find((x) => x.route === "/cast/conversation" && x.params.identifier === probe);
  if (!seen) throw new Error("a thread miss on the pair never reached the stub at " + STUB_URL + " (relay answered " + r.status + ") — the pair's relay points somewhere else");
  if (!seen.keyOk) throw new Error("the pair called the stub without the fake key");
  if (r.status !== 404 || r.json?.code !== "not_found") throw new Error("an unknown hash answered " + r.status + " " + summary(r.json) + " (expected 404 not_found)");
  pairArmed = true;
  return "armed; the probe miss reached the stub with the key and answered 404 not_found";
});
const needPair = () => need(pairArmed, "the pair's relay is not armed on the stub (check 0)");

await check("2. LIVE CARDS: /home shows data-live cards (0x + 40 hex, served by the stub), the device env hint is on, feed2 marks them network:true", async () => {
  needPair();
  await load(A, BASE, "/home");
  if (Number.isInteger(A.info?.fid)) deviceFids.add(A.info.fid);
  need(A.env && A.env.KEYSTORE_DIR === "/keystore", "the page's device env (window.__LAYERS_DEVICE_ENV) is not readable");
  if (A.env.FC_READ_RELAY !== "on") throw new Error("the relay is armed, but the page's device env carries FC_READ_RELAY=" + JSON.stringify(A.env.FC_READ_RELAY));
  const n = await waitLive(A.page, 60_000);
  if (!n) throw new Error("no live card (data-live) on /home within 60 s — relay traffic: " + relaySummary(A));
  await sleep(1500); // the whole timeline, not its first card
  const cards = await liveCards(A.page);
  const served = new Set((await mainStub.state()).served.hashes);
  const bad = cards.filter((c) => !HASH40.test(c.hash || "") || !served.has(c.hash));
  if (bad.length) throw new Error("live card(s) whose hash is not a network hash the stub served: " + bad.map((c) => c.hash).join(", "));
  if (!A.rec.relay.some((r) => r.op === "discovery" && r.status === 200)) throw new Error("live cards, but no 200 discovery read was seen from the page (" + relaySummary(A) + ")");
  const feed2 = await apiInPage(A.page, "GET", "/api/feed2?surface=discovery");
  const net = (feed2.json?.cards ?? []).filter((c) => c.network === true || c.cast?.network === true).map((c) => c.cast?.hash);
  if (!net.length) throw new Error("feed2 marks no card network:true (" + feed2.status + ")");
  if (!cards.some((c) => net.includes(c.hash))) throw new Error("none of the DOM's live cards is a network:true card in feed2");
  initialLive.hashes = cards.map((c) => c.hash);
  return `${cards.length} live card(s) on /home, ${net.length} network card(s) in feed2`;
});

await check(`2d. THE NETWORK MARKER: every live card carries a visible "${NETWORK_MARKER_TEXT}" marker; no seed card carries one`, async () => {
  needPair();
  need(initialLive.hashes.length > 0, "no live card rendered (check 2) — 'every live card is marked' would be vacuous");
  const cards = await A.page.evaluate((sel) => {
    const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    return [...document.querySelectorAll('main article[data-testid="cast"]')].map((a) => ({
      hash: a.getAttribute("data-hash"),
      live: a.matches(sel),
      markers: [...a.querySelectorAll('[data-testid="network-marker"]')].map((m) => ({ text: (m.innerText || "").replace(/\s+/g, " ").trim(), visible: vis(m) })),
    }));
  }, LIVE_SEL);
  const live = cards.filter((c) => c.live);
  need(live.length > 0, "the DOM shows no live card now");
  const problems = [];
  const unmarked = live.filter((c) => !c.markers.some((m) => m.visible && m.text === NETWORK_MARKER_TEXT));
  if (unmarked.length) problems.push(`${unmarked.length} of ${live.length} live card(s) lack a visible "${NETWORK_MARKER_TEXT}" marker (e.g. ${unmarked[0].hash?.slice(0, 10)}…: ${JSON.stringify(unmarked[0].markers)})`);
  const seedMarked = cards.filter((c) => !c.live && c.markers.length);
  if (seedMarked.length) problems.push(`${seedMarked.length} seed card(s) carry a network marker`);
  const needleHits = scanNeedles(NETWORK_MARKER_TEXT, INLINE_ERROR_NEEDLES);
  if (needleHits.length) problems.push("the marker's copy carries needle words: " + needleHits.map((h) => h.label).join(", "));
  if (problems.length) throw new Error(problems.join(" | "));
  return `${live.length} live card(s) marked, ${cards.length - live.length} seed card(s) unmarked`;
});

await check("16. THE LIVE-SOURCE CHIP says live, in copy free of the needle words; feed2 and the classic feed report relay/live; the Following surface reports seed", async () => {
  needPair();
  need(initialLive.hashes.length > 0, "no live card rendered (check 2)");
  const chip = A.page.locator('[data-testid="live-source"]').first();
  await chip.waitFor({ timeout: 15_000 }).catch(() => { throw new Error("no data-testid=live-source chip on a live /home"); });
  const state = await chip.getAttribute("data-state");
  const text = (await chip.innerText()).trim();
  if (state !== "live") throw new Error("the chip's data-state is " + JSON.stringify(state));
  const hits = scanNeedles(text, INLINE_ERROR_NEEDLES);
  if (hits.length) throw new Error("the chip's copy carries needle words: " + hits.map((h) => h.label).join(", "));
  const f2 = await apiInPage(A.page, "GET", "/api/feed2?surface=discovery");
  if (f2.json?.liveSource?.source !== "relay" || f2.json?.liveSource?.state !== "live") throw new Error("feed2 liveSource is " + summary(f2.json?.liveSource));
  const classic = await apiInPage(A.page, "GET", "/api/feed?tab=foryou&page=0");
  if (classic.json?.liveSource?.source !== "relay") throw new Error("the classic For You liveSource is " + summary(classic.json?.liveSource));
  if (!(classic.json?.casts ?? []).some((c) => c.network === true)) throw new Error("the classic For You carries no network:true cast");
  const following = await apiInPage(A.page, "GET", "/api/feed2?surface=following");
  if (following.json?.liveSource?.source !== "seed") throw new Error("the Following surface's liveSource is " + summary(following.json?.liveSource) + " (Following never reads the relay)");
  return `chip "${text}" (live); feed2 relay/live; classic relay; Following seed`;
});

await check("3. NO DIRECT UPSTREAM: while live cards are visible, no page request went to api.neynar.com or the stub's origin", async () => {
  needPair();
  need(initialLive.hashes.length > 0, "no live card rendered (check 2) — 'no upstream request' would be vacuous");
  need(A.rec.relay.length > 0, "the recorder saw no relay request at all — it would not see an upstream one either");
  const stubHost = portOf(STUB_URL);
  const bad = [...A.rec.requests, ...A.rec.external].filter((r) => /(^|\.)neynar\.com$/i.test(hostOf(r.url)) || (isLoopbackUrl(r.url) && portOf(r.url) === stubHost));
  if (bad.length) throw new Error(bad.length + " request(s) to the upstream from the page: " + [...new Set(bad.map((r) => r.method + " " + r.url.slice(0, 90)))].slice(0, 4).join(", "));
  return `${A.rec.requests.length} page request(s), ${A.rec.relay.length} through the relay, none upstream`;
});

await check("15. THE SCORE FLOOR hides an author below it and one with no score (both served by the stub); their profiles answer not_found", async () => {
  needPair();
  const st = await mainStub.state();
  await needPlanted(st.served.discovery.includes(PLANTED.low.hash) && st.served.discovery.includes(PLANTED.none.hash), "the stub's last discovery answer did not carry the planted low-score and no-score casts");
  const v = await relay(BASE, { op: "discovery" }); // a cache hit on the pair: no credit, no miss
  need(v.status === 200, "the discovery read answered " + v.status);
  const hashes = castsOf(v.json?.value).map((c) => c.hash);
  need(hashes.length >= 3, "the discovery value carries " + hashes.length + " cast(s) — too few to mean anything");
  const problems = [];
  if (hashes.includes(PLANTED.low.hash)) problems.push("the low-score author's cast is in the discovery value");
  if (hashes.includes(PLANTED.none.hash)) problems.push("the no-score author's cast is in the discovery value");
  const dom = await liveCards(A.page);
  for (const [k, m] of [["low", STUB_MARKERS.low], ["none", STUB_MARKERS.none]]) if (dom.some((c) => c.text.includes(m) || c.hash === PLANTED[k].hash)) problems.push(`the ${k}-score cast is on /home`);
  for (const u of [STUB_USERS.low, STUB_USERS.none]) {
    const r = await relay(BASE, { op: "user", arg: u.username });
    if (r.status !== 404 || r.json?.code !== "not_found") problems.push(`@${u.username}'s profile answered ${r.status} ${summary(r.json)}`);
  }
  const lookedUp = (await mainStub.state()).requests.filter((x) => x.route === "/user/by_username" && [STUB_USERS.low.username, STUB_USERS.none.username].includes(x.params.username));
  need(lookedUp.length >= 1 || problems.length > 0, "neither hidden profile was looked up upstream — the not_found could be the cache's, not the floor's");
  if (problems.length) throw new Error(problems.join("; "));
  return `${hashes.length} cast(s) admitted; both hidden in the value, on /home and as profiles`;
});

await check("15b. THE DENYLIST (FC_READ_DENY) hides a served hash — in the feed and as a thread", async () => {
  needPair();
  const st = await mainStub.state();
  await needPlanted(st.served.discovery.includes(PLANTED.denied.hash), "the stub's last discovery answer did not carry the planted denylisted cast");
  const v = await relay(BASE, { op: "discovery" });
  need(v.status === 200 && castsOf(v.json?.value).length >= 3, "the discovery value is empty (" + v.status + ")");
  if (castsOf(v.json.value).some((c) => c.hash === PLANTED.denied.hash)) throw new Error("the denylisted hash is in the discovery value — is FC_READ_DENY reaching the app (run-prod-shape.sh sets it in stub mode)?");
  if ((await liveCards(A.page)).some((c) => c.hash === PLANTED.denied.hash || c.text.includes(STUB_MARKERS.denied))) throw new Error("the denylisted cast is on /home");
  const t = await relay(BASE, { op: "thread", arg: PLANTED.denied.hash });
  if (t.status !== 404 || t.json?.code !== "not_found") throw new Error("the denylisted hash as a thread answered " + t.status + " " + summary(t.json));
  return "hidden in the feed, on /home and as a thread";
});

// FC-READ (future-dated casts): the relay drops a cast dated more than 10 minutes ahead of its clock (projectCast) — the
// device orders the feed by recency, so one such cast would otherwise sit on top of the public feed for decades
await check("15c. A FUTURE-DATED CAST (served by the stub, dated 2061) is dropped: not in the discovery value, not on /home, and its thread answers not_found", async () => {
  needPair();
  need(PLANTED.future && HASH40.test(PLANTED.future.hash || ""), "the stub plants no future-dated cast (scripts/lib/neynar-stub.mjs STUB_FUTURE_HASH)");
  const st = await mainStub.state();
  await needPlanted(st.served.discovery.includes(PLANTED.future.hash), "the stub's last discovery answer did not carry the planted future-dated cast");
  const v = await relay(BASE, { op: "discovery" }); // a cache hit on the pair: no credit, no miss
  const casts = castsOf(v.json?.value);
  need(v.status === 200 && casts.length >= 3, "the discovery value is empty (" + v.status + ")");
  const problems = [];
  if (casts.some((c) => c.hash === PLANTED.future.hash)) problems.push("the future-dated cast is in the discovery value");
  const ahead = casts.filter((c) => typeof c.timestamp === "number" && c.timestamp > Date.now() + 10 * 60_000);
  if (ahead.length) problems.push(ahead.length + " discovery cast(s) dated more than 10 minutes ahead");
  const dom = await liveCards(A.page);
  need(dom.length > 0, "no live card on /home — 'not on /home' would be vacuous");
  if (dom.some((c) => c.hash === PLANTED.future.hash || c.text.includes(STUB_MARKERS.future))) problems.push("the future-dated cast is on /home");
  const t = await relay(BASE, { op: "thread", arg: PLANTED.future.hash });
  if (t.status !== 404 || t.json?.code !== "not_found") problems.push("the future-dated hash as a thread answered " + t.status + " " + summary(t.json));
  const conv = (await mainStub.state()).requests.filter((x) => x.route === "/cast/conversation" && x.params.identifier === PLANTED.future.hash);
  need(conv.length >= 1 || problems.length > 0, "the future-dated thread was never read upstream — the not_found could be the cache's, not the date rule's");
  if (problems.length) throw new Error(problems.join("; "));
  return `dropped from the discovery value (${casts.length} cast(s), none ahead of the clock), absent from ${dom.length} live card(s) on /home, and its thread answers not_found after ${conv.length} upstream read(s)`;
});

await check("17. PAGE HEALTH EXCLUDES CAST TEXT: a live card made of needle words is visible, and inlineErrors reads the page as clean", async () => {
  needPair();
  const cards = await liveCards(A.page);
  const needle = cards.find((c) => c.text.includes(STUB_MARKERS.needle));
  await needPlanted(needle, "the planted needle cast is not on /home — the exclusion is untested");
  need(scanNeedles(needle.text, INLINE_ERROR_NEEDLES).length > 0, "the needle cast's text matches no needle — there is nothing to exclude");
  const errs = await inlineErrors(A.page);
  if (errs.length) throw new Error("inlineErrors on a healthy live /home: " + errs.join("; "));
  return "the needle card says " + scanNeedles(needle.text, INLINE_ERROR_NEEDLES).map((h) => '"' + h.label + '"').join(", ") + "; the page reads clean";
});

await check("18. MEDIA: live <img>s are no-referrer + lazy, their requests carried no Referer, and an unlisted host is click-to-load and never fetched before the click", async () => {
  needPair();
  await sleep(2000); // the avatars in view have had time to load
  const cards = await liveCards(A.page);
  const imgs = cards.flatMap((c) => c.imgs);
  need(imgs.length > 0, "no <img> inside any live card");
  const badAttr = imgs.filter((i) => i.referrerpolicy !== "no-referrer" || i.loading !== "lazy");
  if (badAttr.length) throw new Error(badAttr.length + " live <img> without referrerpolicy=no-referrer + loading=lazy: " + badAttr.slice(0, 3).map((i) => `${hostOf(i.src)} (${i.referrerpolicy}, ${i.loading})`).join(", "));
  const liveHosts = new Set(imgs.map((i) => hostOf(i.src)).filter(Boolean));
  const reqs = A.rec.external.filter((e) => liveHosts.has(e.host) && e.type === "image");
  need(reqs.length > 0, "no image request to a live card's host was seen (" + [...liveHosts].join(", ") + ")");
  const withRef = reqs.filter((e) => e.referer);
  if (withRef.length) throw new Error(withRef.length + " live image request(s) carried a Referer (e.g. to " + withRef[0].host + ")");
  const media = cards.find((c) => c.text.includes(STUB_MARKERS.media));
  await needPlanted(media, "the planted media cast (an image on " + STUB_MEDIA_HOST + ") is not on /home");
  if (!media.clickToLoad.length) throw new Error("the image on " + STUB_MEDIA_HOST + " renders without a click-to-load control");
  if (media.imgs.some((i) => hostOf(i.src) === STUB_MEDIA_HOST)) throw new Error("an <img> for " + STUB_MEDIA_HOST + " is on the card before any click");
  if (A.rec.external.some((e) => e.host === STUB_MEDIA_HOST)) throw new Error(STUB_MEDIA_HOST + " was requested before the visitor asked");
  const placeholder = A.page.locator(`${LIVE_SEL}[data-hash="${media.hash}"] [data-testid="media-click-to-load"]`).first();
  await placeholder.click({ timeout: 10_000 });
  const deadline = Date.now() + 10_000;
  let req = null;
  while (Date.now() < deadline && !req) {
    req = A.rec.external.find((e) => e.host === STUB_MEDIA_HOST) ?? null;
    if (!req) await sleep(300);
  }
  const after = (await liveCards(A.page)).find((c) => c.hash === media.hash);
  const img = after?.imgs.find((i) => hostOf(i.src) === STUB_MEDIA_HOST);
  if (!img) throw new Error("clicking click-to-load did not render the image");
  if (img.referrerpolicy !== "no-referrer") throw new Error("the clicked-in image lacks referrerpolicy=no-referrer");
  if (req && req.referer) throw new Error("the clicked-in image request carried a Referer");
  return `${imgs.length} live <img>(s) clean, ${reqs.length} image request(s) with no Referer; ${STUB_MEDIA_HOST} held until the click${req ? ", then fetched with no Referer" : ""}`;
});

// FC-READ (review): what 2b opened, and what those pages showed about their source — 2c judges it
const liveThread = { author: null, hash: null, threadMarks: null, profileMarks: null };
await check("2b. a live THREAD and a live PROFILE open in the browser (the relay's thread, user and user-casts ops)", async () => {
  needPair();
  const cards = await liveCards(A.page);
  const pick = cards.find((c) => !MARKER_LIST.some((m) => c.text.includes(m)) && c.authors.some((a) => /^\/[a-z0-9][a-z0-9-]{0,15}$/.test(a)));
  need(pick, "no ordinary live card with an fname-shaped author link on /home");
  const author = pick.authors.find((a) => /^\/[a-z0-9][a-z0-9-]{0,15}$/.test(a));
  await load(A, BASE, `${author}/status/${pick.hash}`);
  if (Number.isInteger(A.info?.fid)) deviceFids.add(A.info.fid);
  // the thread's ROOT is the permalink article (data-testid=permalink-cast), marked data-live like a timeline card
  const root = A.page.locator(`main article[data-testid="permalink-cast"][data-live="true"][data-hash="${pick.hash}"]`).first();
  await root.waitFor({ timeout: 45_000 }).catch(() => { throw new Error(`the thread page never showed the live root ${pick.hash.slice(0, 10)}… (${relaySummary(A)})`); });
  const replies = await A.page.locator(LIVE_SEL, { hasText: STUB_MARKERS.reply }).count();
  if (!A.rec.relay.some((r) => r.op === "thread" && r.arg === pick.hash && r.status === 200)) throw new Error("the thread page did not read the relay's thread op (" + relaySummary(A) + ")");
  liveThread.author = author;
  liveThread.hash = pick.hash;
  liveThread.threadMarks = await waitMarks(A.page, (m) => m.chips.length > 0 && !!m.root?.marker, 10_000);
  const tErrs = await inlineErrors(A.page);
  if (tErrs.length) throw new Error("the live thread page: " + tErrs.join("; "));
  await load(A, BASE, author);
  if (Number.isInteger(A.info?.fid)) deviceFids.add(A.info.fid);
  const n = await waitLive(A.page, 45_000);
  const name = author.slice(1);
  const ops = (op) => A.rec.relay.some((r) => r.op === op && r.arg === name && r.status === 200);
  if (!ops("user") || !ops("user-casts")) throw new Error(`the profile page did not read user and user-casts for @${name} (${relaySummary(A)})`);
  if (!n) throw new Error(`@${name}'s profile shows no live card`);
  liveThread.profileMarks = await waitMarks(A.page, (m) => m.chips.length > 0 && m.headerMarkers.length > 0, 10_000);
  const pErrs = await inlineErrors(A.page);
  if (pErrs.length) throw new Error("the live profile page: " + pErrs.join("; "));
  return `thread ${pick.hash.slice(0, 10)}… with ${replies} live repl(ies); @${name}'s profile with ${n} live card(s)`;
});

await check(`2c. on that live thread and that live profile: the live-source chip says live (no needle words), and the permalink root and the profile header carry "${NETWORK_MARKER_TEXT}"`, async () => {
  needPair();
  need(liveThread.threadMarks && liveThread.profileMarks, "2b did not open a live thread and a live profile");
  const problems = [];
  for (const [label, m] of [["thread", liveThread.threadMarks], ["profile", liveThread.profileMarks]]) {
    const chip = m.chips.find((c) => c.visible) ?? m.chips[0];
    if (!chip) problems.push(`the live ${label} page has no data-testid=live-source chip`);
    else {
      if (chip.state !== "live") problems.push(`the ${label} chip's data-state is ${JSON.stringify(chip.state)} (expected live)`);
      if (!chip.visible) problems.push(`the ${label} chip is not visible`);
      const hits = scanNeedles(chip.text, INLINE_ERROR_NEEDLES);
      if (hits.length) problems.push(`the ${label} chip's copy carries needle words: ${hits.map((h) => h.label).join(", ")}`);
    }
  }
  const root = liveThread.threadMarks.root;
  if (!root || root.live !== "true") problems.push("the permalink root is not data-live=true");
  else if (!root.marker || !root.marker.visible || root.marker.text !== NETWORK_MARKER_TEXT) problems.push(`the live permalink root's marker is ${JSON.stringify(root.marker)}`);
  const header = liveThread.profileMarks.headerMarkers;
  if (!header.some((x) => x.visible && x.text === NETWORK_MARKER_TEXT)) problems.push(`the live profile header carries no visible "${NETWORK_MARKER_TEXT}" marker (${JSON.stringify(header)})`);
  if (liveThread.profileMarks.liveFollow < 1) problems.push("the live profile's Follow is not the disabled data-live one");
  if (problems.length) throw new Error(problems.join(" | "));
  return `thread chip "${liveThread.threadMarks.chips[0].text}", profile chip "${liveThread.profileMarks.chips[0].text}"; root and header marked`;
});

await check("22. A FIXTURE PROFILE IS NOT NETWORK: /karpathy (a fixture user) shows no data-live Follow, no network marker, no live-source chip, and the device never asks the relay about it", async () => {
  needPair();
  const fx = JSON.parse(readFileSync(path.join("lib", "fixtures", "data.json"), "utf8"));
  const users = Array.isArray(fx.users) ? fx.users : Object.values(fx.users ?? {});
  // an fname-SHAPED fixture handle: the relay WOULD accept it as a lookup, so a wrong order (relay before fixture)
  // or a page-wide "this page reads through the relay" flag would both show here
  const u = users.find((x) => x?.username === "karpathy") ?? users.find((x) => /^[a-z0-9][a-z0-9-]{0,15}$/.test(x?.username ?? ""));
  need(u, "lib/fixtures/data.json has no fname-shaped fixture user");
  const before = A.rec.relay.length;
  await needReserve();
  await load(A, BASE, "/" + u.username);
  if (Number.isInteger(A.info?.fid)) deviceFids.add(A.info.fid);
  need(A.env?.FC_READ_RELAY === "on", "the relay hint is off on this page — a fixture profile unmarked would prove nothing");
  const m = await waitMarks(A.page, (x) => x.handleShown.includes("@" + u.username) || x.notFound || x.loadError.length > 0, 45_000);
  need(m && m.handleShown.includes("@" + u.username), `the fixture profile @${u.username} did not render (${summary(m)})`);
  await sleep(1500); // any late island (the posts, the header's follow) has settled
  const after = await pageMarks(A.page);
  const problems = [];
  if (after.liveFollow) problems.push(`${after.liveFollow} data-live Follow control(s) on a fixture profile`);
  if (after.allMarkers) problems.push(`${after.allMarkers} network marker(s) on a fixture profile`);
  if (after.chips.some((c) => c.state === "live" || c.state === "stale")) problems.push("a live-source chip claims live content on a fixture profile");
  if (await A.page.locator(LIVE_SEL).count()) problems.push("live cards on a fixture profile");
  const asked = A.rec.relay.slice(before).filter((r) => ["user", "user-casts"].includes(r.op) && String(r.arg).toLowerCase() === u.username.toLowerCase());
  if (asked.length) problems.push(`the device asked the relay about @${u.username} (${asked.map((r) => r.op).join(", ")})`);
  if (problems.length) throw new Error(problems.join(" | "));
  return `@${u.username} (fid ${u.fid}): seed profile, unmarked, 0 relay lookups`;
});

await check("6. SHARED CACHE: a second browser profile gets the same live cards with the stub's hit count unchanged", async () => {
  needPair();
  need(initialLive.hashes.length > 0, "profile A saw no live card (check 2)");
  const before = (await mainStub.state()).hits.total;
  B = await openCtx("B");
  await load(B, BASE, "/home");
  if (Number.isInteger(B.info?.fid)) deviceFids.add(B.info.fid);
  const n = await waitLive(B.page, 60_000);
  if (!n) throw new Error("profile B shows no live card (" + relaySummary(B) + ")");
  need(B.rec.relay.some((r) => r.op === "discovery" && r.status === 200), "profile B's page never asked the relay for discovery — an unchanged count would prove nothing");
  await sleep(1500);
  const after = (await mainStub.state()).hits.total;
  const bHashes = (await liveCards(B.page)).map((c) => c.hash);
  const a = new Set(initialLive.hashes);
  const b = new Set(bHashes);
  const onlyA = [...a].filter((h) => !b.has(h));
  const onlyB = [...b].filter((h) => !a.has(h));
  if (after !== before) throw new Error(`the stub was called ${after - before} more time(s) for profile B — the shared cache did not serve it`);
  if (onlyA.length || onlyB.length) throw new Error(`the two profiles differ: only A ${onlyA.length}, only B ${onlyB.length}`);
  return `${b.size} identical live card(s); stub hits ${before} → ${after}`;
});

let liveHashForWrites = null;
await check("7. LIKE: liking a live card is refused 403 NETWORK_READ_ONLY with the sentence and the count stays; liking a seed card answers 200", async () => {
  needPair();
  need(B, "no second profile (check 6)");
  const card = (await liveCards(B.page)).find((c) => !MARKER_LIST.some((m) => c.text.includes(m)));
  need(card && HASH40.test(card.hash || ""), "no ordinary live card on profile B's /home");
  liveHashForWrites = card.hash;
  const api = await apiInPage(B.page, "POST", "/api/actions/react", { hash: card.hash, kind: "like", on: true });
  if (api.status !== RELAY.networkReadOnly.status || api.json?.code !== RELAY.networkReadOnly.code) throw new Error(`the device's like route answered ${api.status} ${summary(api.json)} for a network cast`);
  if (api.json?.error !== SENTENCE) throw new Error("the refusal's sentence differs: " + JSON.stringify(api.json?.error));
  const like = B.page.locator(`${LIVE_SEL}[data-hash="${card.hash}"] [data-testid="action-like"]`).first();
  need(await like.count(), "the live card has no data-testid=action-like control");
  const read = async () => ({ text: (await like.innerText().catch(() => "")).trim(), cls: (await like.getAttribute("class")) || "", title: (await like.getAttribute("title")) || "" });
  const before = await read();
  await like.click({ force: true, timeout: 5000 }).catch(() => {});
  let toast = "";
  try {
    await B.page.getByTestId("toast").first().waitFor({ timeout: 5000 });
    toast = await B.page.getByTestId("toast").first().innerText();
  } catch { /* no toast */ }
  await sleep(1500);
  const after = await read();
  if (after.text !== before.text) throw new Error(`the like count moved on a refused like (${JSON.stringify(before.text)} → ${JSON.stringify(after.text)})`);
  if (/text-x-pink/.test(after.cls) && !/text-x-pink/.test(before.cls)) throw new Error("the heart turned on for a refused like");
  if (!toast.includes(SENTENCE) && !after.title.includes(SENTENCE)) throw new Error("neither a toast nor the control's tooltip carries the sentence (toast " + JSON.stringify(toast.slice(0, 80)) + ")");
  const seed = await apiInPage(B.page, "GET", "/api/feed?tab=following&page=0");
  const seedCast = (seed.json?.casts ?? []).find((c) => typeof c.hash === "string" && !HASH40.test(c.hash));
  need(seedCast, "the Following feed offered no seed cast to like (" + seed.status + ")");
  const okLike = await apiInPage(B.page, "POST", "/api/actions/react", { hash: seedCast.hash, kind: "like", on: true });
  if (![200, 201].includes(okLike.status)) throw new Error(`liking a SEED cast answered ${okLike.status} ${summary(okLike.json)} — the refusal is not per target`);
  await apiInPage(B.page, "POST", "/api/actions/react", { hash: seedCast.hash, kind: "like", on: false });
  return `live like 403 ${api.json.code}, count ${JSON.stringify(before.text)} kept, ${toast.includes(SENTENCE) ? "toast" : "tooltip"} says the sentence; seed like ${okLike.status}`;
});

await check("7b. the other writes on a live card are refused 403 NETWORK_READ_ONLY: recast, reply, act-as, folder add, stake", async () => {
  needPair();
  need(liveHashForWrites && B, "no live card from check 7");
  const hash = liveHashForWrites;
  const problems = [];
  const expect = (label, r) => {
    if (r.status !== RELAY.networkReadOnly.status || r.json?.code !== RELAY.networkReadOnly.code || r.json?.error !== SENTENCE) problems.push(`${label} → ${r.status} ${summary(r.json)}`);
  };
  expect("recast", await apiInPage(B.page, "POST", "/api/actions/react", { hash, kind: "recast", on: true }));
  const replyText = "fcread reply " + stamp;
  expect("reply", await apiInPage(B.page, "POST", "/api/actions/cast", { text: replyText, replyToHash: hash }));
  const persona = B.info?.personaIds?.[0];
  need(persona, "the device named no persona for act-as");
  expect("act-as reply", await apiInPage(B.page, "POST", "/api/actions/act-as", { kind: "reply", targetHash: hash, text: replyText + " as", asPersonaId: persona }));
  let folders = await apiInPage(B.page, "GET", "/api/folders");
  let folderId = folders.json?.folders?.[0]?.id;
  if (!folderId) {
    const made = await apiInPage(B.page, "POST", "/api/folders", { name: "fcread " + stamp, isPublic: false, postHashes: [] });
    folderId = made.json?.folder?.id;
  }
  need(folderId, "no folder to add to (GET and create both came back empty)");
  expect("folder add", await apiInPage(B.page, "POST", "/api/folders", { action: "addPost", folderId, postHash: hash }));
  expect("folder create with the post", await apiInPage(B.page, "POST", "/api/folders", { name: "fcread with " + stamp, isPublic: false, postHashes: [hash] }));
  expect("stake", await apiInPage(B.page, "POST", "/api/influence", { action: "stake", castHash: hash, stakeAction: "curate" }));
  const following = await apiInPage(B.page, "GET", "/api/feed?tab=following&page=0");
  if (JSON.stringify(following.json).includes(replyText)) problems.push("the refused reply shows up on Following anyway");
  if (problems.length) throw new Error(problems.join(" | "));
  return "recast, reply, act-as reply, folder add, folder create, stake: all 403 NETWORK_READ_ONLY";
});

await check("8. FOLLOWING STAYS LOCAL: with the relay on, a post round-trips on Following, and Following carries no network cast", async () => {
  needPair();
  need(B && B.env?.FC_READ_RELAY === "on" && initialLive.hashes.length > 0, "the relay is not visibly on for this device (no hint, or no live card) — a round trip would prove nothing about Following staying local");
  const text = "fcread round trip " + stamp;
  const cast = await apiInPage(B.page, "POST", "/api/actions/cast", { text });
  if (![200, 201].includes(cast.status)) throw new Error("posting answered " + cast.status + " " + summary(cast.json));
  const feed = await apiInPage(B.page, "GET", "/api/feed?tab=following&page=0");
  if (!JSON.stringify(feed.json).includes(text)) throw new Error("the post is not on Following (" + feed.status + ")");
  const served = new Set((await mainStub.state()).served.hashes);
  const net = (feed.json?.casts ?? []).filter((c) => c.network === true || served.has(c.hash));
  if (net.length) throw new Error("Following carries " + net.length + " network cast(s)");
  const f2 = await apiInPage(B.page, "GET", "/api/feed2?surface=following");
  const net2 = (f2.json?.cards ?? []).filter((c) => c.network === true || c.cast?.network === true || served.has(c.cast?.hash));
  if (net2.length) throw new Error("the Following surface (feed2) carries " + net2.length + " network card(s)");
  return "posted and read back on Following; no network cast there";
});

// FC-READ (no channels): channel tabs used to map to the relay's "channel" op (any channel-shaped tab asked; the
// allowlist decided). The owner's v1 decision is that channels are not an emphasis, so a channel tab stays seed exactly
// as an off-list tab always did — no relay request at all, not a request the relay refuses.
await check("23. NO LIVE CHANNEL TAB: a channel-shaped classic home tab (\"art\", a former default channel, and the fixture's own channel tab) answers seed from the device with no relay request and no stub hit; For You on the same device still reads the relay", async () => {
  needPair();
  need(B && B.env?.FC_READ_RELAY === "on" && initialLive.hashes.length > 0, "the relay is not visibly on for this device (no hint, or no live card) — a seed channel tab would prove nothing");
  const fx = JSON.parse(readFileSync(path.join("lib", "fixtures", "data.json"), "utf8"));
  const fixtureTab = (Array.isArray(fx.channels) ? fx.channels : []).map((c) => c?.id).find((id) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(id || ""));
  need(fixtureTab, "lib/fixtures/data.json names no channel-shaped home tab");
  const tabs = [...new Set(["art", fixtureTab])];
  // quiet first: nothing else on this page may be asking the relay while the window is open
  await B.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const relaySent = () => B.rec.requests.filter((q) => isRelayUrl(q.url) && q.method === "POST");
  const sentBefore = relaySent().length;
  const hitsBefore = (await mainStub.state()).hits.total;
  const served = new Set((await mainStub.state()).served.hashes);
  const problems = [];
  const seen = [];
  for (const tab of tabs) {
    const r = await apiInPage(B.page, "GET", `/api/feed?tab=${encodeURIComponent(tab)}&page=0`);
    need(r.status === 200 && Array.isArray(r.json?.casts) && r.json.casts.length > 0, `the classic feed for tab "${tab}" answered ${r.status} with ${r.json?.casts?.length ?? 0} cast(s) — a seed tab must still show its fixture slice`);
    if (r.json?.liveSource?.source !== "seed") problems.push(`tab "${tab}": liveSource ${summary(r.json?.liveSource)} (expected seed)`);
    const net = r.json.casts.filter((c) => c.network === true || c.live === true || served.has(c.hash));
    if (net.length) problems.push(`tab "${tab}": ${net.length} network cast(s)`);
    seen.push(`"${tab}" ${r.json.casts.length} seed cast(s)`);
  }
  await sleep(1500); // a late relay request from the device would land here
  const sent = relaySent().slice(sentBefore);
  if (sent.length) problems.push(`the device sent ${sent.length} relay request(s) while only channel tabs were read: ${[...new Set(sent.map((q) => q.post.slice(0, 60)))].join(", ")}`);
  const hitsAfter = (await mainStub.state()).hits.total;
  if (hitsAfter !== hitsBefore) problems.push(`the stub was called ${hitsAfter - hitsBefore} time(s) while only channel tabs were read`);
  // positive control, AFTER the window: the same device, the same route, For You — relay-sourced, so the seed answers
  // above are the tab rule's, not a device that stopped reading the relay
  const fy = await apiInPage(B.page, "GET", "/api/feed?tab=foryou&page=0");
  need(fy.json?.liveSource?.source === "relay", `the positive control (For You on the same device) is not relay-sourced (${summary(fy.json?.liveSource)}) — "seed" above would not be the channel-tab rule's`);
  if (problems.length) throw new Error(problems.join(" | "));
  return `${seen.join(", ")}: source seed, 0 relay requests, stub hits ${hitsBefore} → ${hitsAfter}; For You relay/${fy.json.liveSource.state}`;
});

// FC-READ (review): one device, two modes. The mode is switched through the pill (a full load would mint a new visitor
// and forget it), and the Default row is rebound first so the switch back renders the extras on live cards (21b).
let C = null;
const modeState = { defaultId: null, defaultSlots: null, safeId: null, backLive: 0 };
const EXTRAS = ["refute", "note", "custom-rule"];
async function pickMode(page, name) {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  await page.locator('[data-testid="mode-pill"]').first().click({ timeout: 10_000 });
  await page.locator(`[data-testid="mode-option-${slug}"]`).first().click({ timeout: 10_000 });
  await page.locator(`[data-testid="mode-pill"][data-active-mode="${name}"]`).first().waitFor({ timeout: 20_000 });
}
await check('21. AN AUTHOR-HIDE-RULE MODE (Event Safe Space): the timeline shows the seeded cards with the chip at data-state="filtered", never an empty live feed', async () => {
  needPair();
  await needReserve();
  C = await openCtx("modes");
  await load(C, BASE, "/home");
  if (Number.isInteger(C.info?.fid)) deviceFids.add(C.info.fid);
  need((await waitLive(C.page, 60_000)) > 0, "no live card under Default on this device (" + relaySummary(C) + ") — a filtered state would be indistinguishable from a dead relay");
  const modes = (await apiInPage(C.page, "GET", "/api/modes")).json;
  const def = modes?.modes?.find((x) => x.name === "Default");
  const safe = modes?.modes?.find((x) => x.name === "Event Safe Space");
  need(def && safe, "the device's modes lack Default or Event Safe Space (" + summary(modes?.modes?.map((x) => x.name)) + ")");
  need((safe.ruleIds ?? []).includes("rule_no_low_tier"), "Event Safe Space carries no rule_no_low_tier — it is not an author-hide-rule mode any more (" + summary(safe.ruleIds) + ")");
  need(modes.activeId === def.id, "the active mode is not Default");
  modeState.defaultId = def.id;
  modeState.defaultSlots = def.actionButtonSlots;
  modeState.safeId = safe.id;
  // 21b's binding, made now: the switch back to Default below is what re-renders the row
  const bind = await apiInPage(C.page, "PATCH", "/api/modes", { modeId: def.id, patch: { actionButtonSlots: { ...def.actionButtonSlots, cast: ["reply", "like", ...EXTRAS, "share"] } } });
  need(bind.status === 200, "rebinding Default's cast row answered " + bind.status + " " + summary(bind.json));
  await pickMode(C.page, "Event Safe Space");
  const chip = C.page.locator('[data-testid="live-source"][data-state="filtered"]').first();
  await chip.waitFor({ timeout: 30_000 }).catch(async () => {
    const now = await C.page.locator('[data-testid="live-source"]').first().getAttribute("data-state").catch(() => null);
    throw new Error(`no live-source chip at data-state=filtered under Event Safe Space (chip: ${JSON.stringify(now)})`);
  });
  const text = squash(await chip.innerText());
  const cards = await waitForTimelineCards(C.page, 30_000);
  const problems = [];
  if (!/hides accounts it can.t rate/i.test(text)) problems.push("the filtered chip's copy is " + JSON.stringify(text) + " (expected the mode sentence)");
  const hits = scanNeedles(text, INLINE_ERROR_NEEDLES);
  if (hits.length) problems.push("the chip's copy carries needle words: " + hits.map((h) => h.label).join(", "));
  const live = await C.page.locator(LIVE_SEL).count();
  if (live) problems.push(`${live} live card(s) under the filtered chip`);
  const f2 = await apiInPage(C.page, "GET", "/api/feed2?surface=discovery");
  const f2cards = f2.json?.cards ?? [];
  if (!f2cards.length) problems.push("feed2 answers an EMPTY discovery timeline under Event Safe Space");
  if (f2cards.some((c) => c.network === true || c.cast?.network === true)) problems.push("feed2 still carries network cards under Event Safe Space");
  if (f2.json?.liveSource?.state === "live") problems.push("feed2 claims liveSource live over a mode that hides every network author");
  const errs = await inlineErrors(C.page);
  if (errs.length) problems.push("the filtered /home: " + errs.join("; "));
  // and back: Default reads live again (the same device, the same tab)
  await pickMode(C.page, "Default");
  modeState.backLive = await waitLive(C.page, 45_000);
  if (!modeState.backLive) problems.push("back on Default the live cards did not return (" + relaySummary(C) + ")");
  if (problems.length) throw new Error(problems.join(" | "));
  return `chip "${text}" over ${cards} seeded card(s), 0 live; feed2 ${f2cards.length} card(s), liveSource ${summary(f2.json?.liveSource)}; Default live again (${modeState.backLive})`;
});

await check("21b. THE IDENTITY EXTRAS on a live card (refute, note, custom-rule — bound to the row) are disabled with the sentence, and a tap navigates nowhere", async () => {
  needPair();
  need(C && modeState.backLive > 0, "no live card on the rebound Default row (check 21)");
  const card = C.page.locator(LIVE_SEL).first();
  const problems = [];
  const startUrl = C.page.url();
  for (const a of EXTRAS) {
    const b = card.locator(`[data-testid="action-${a}"]`).first();
    need(await b.count(), `the bound "${a}" control is not on the live card — the rebinding did not render, so nothing about it was measured`);
    const disabled = await b.getAttribute("aria-disabled");
    const title = (await b.getAttribute("title")) || "";
    if (disabled !== "true") problems.push(`${a}: aria-disabled=${JSON.stringify(disabled)}`);
    if (title !== SENTENCE) problems.push(`${a}: its tooltip is ${JSON.stringify(title.slice(0, 80))}`);
    await b.click({ force: true, timeout: 5000 }).catch(() => {});
    await sleep(1200);
    if (C.page.url() !== startUrl) {
      problems.push(`${a}: a tap navigated to ${new URL(C.page.url()).pathname}${new URL(C.page.url()).search}`);
      await C.page.goBack().catch(() => {});
      await sleep(1000);
    }
  }
  // per target, not per page: a seed card on the same row keeps the control live (when the timeline shows one)
  const seedCard = C.page.locator('main article[data-testid="cast"]:not([data-live]), main article[data-testid="cast"][data-live="false"]').first();
  let seedNote = "no seed card on this timeline";
  if (await seedCard.count()) {
    const sb = seedCard.locator('[data-testid="action-custom-rule"]').first();
    if (await sb.count()) {
      if ((await sb.getAttribute("aria-disabled")) === "true") problems.push("custom-rule is disabled on a SEED card too — the refusal is not per target");
      else seedNote = "a seed card's custom-rule stays enabled";
    }
  }
  // put the row back (the tab is thrown away next, but a device that outlived it must not keep a test binding)
  if (modeState.defaultSlots) await apiInPage(C.page, "PATCH", "/api/modes", { modeId: modeState.defaultId, patch: { actionButtonSlots: modeState.defaultSlots } }).catch(() => null);
  if (problems.length) throw new Error(problems.join(" | "));
  return `${EXTRAS.join(", ")}: aria-disabled with the sentence, no navigation; ${seedNote}`;
});
if (C) await C.close();

await check("20. FRAMING: every document answers CSP frame-ancestors 'none' + X-Frame-Options DENY, and a preview page another site frames is blocked by the browser (no script, no relay request)", async () => {
  needPair();
  const fname = "fcr" + randomBytes(5).toString("hex").slice(0, 9);
  const docs = ["/", "/home", "/explore", "/settings", "/device", `/${fname}`, `/${fname}/status/${randomHash()}`];
  const problems = [];
  const seen = [];
  for (const p of docs) {
    const { status, h } = await headersOf(BASE + p);
    if (status >= 300 && status < 400) { seen.push(`${p} ${status}`); continue; } // a redirect is not a document
    need((h["content-type"] || "").includes("text/html"), `${p} answered ${status} ${h["content-type"]} — not a document`);
    const csp = h["content-security-policy"] || "";
    if (!/(^|;)\s*frame-ancestors\s+'none'\s*(;|$)/i.test(csp)) problems.push(`${p}: content-security-policy ${JSON.stringify(csp.slice(0, 120))}`);
    if (!/^\s*deny\s*$/i.test(h["x-frame-options"] || "")) problems.push(`${p}: x-frame-options ${JSON.stringify(h["x-frame-options"] ?? null)}`);
    seen.push(`${p.length > 20 ? p.slice(0, 20) + "…" : p} ${status}`);
  }
  // the browser half: a page on ANOTHER site (the stub's 127.0.0.1 origin) frames a thread page for a fresh hash
  const hash = randomHash();
  const target = `${BASE}/${fname}/status/${hash}`;
  const X = await openCtx("framed");
  try {
    await X.page.goto(STUB_URL + "/__stub/xsite.html", { waitUntil: "load" });
    await X.page.evaluate(
      (src) =>
        new Promise((resolve) => {
          const f = document.createElement("iframe");
          f.id = "fcread-probe";
          f.width = "1000";
          f.height = "800";
          const done = () => resolve(true);
          f.addEventListener("load", done, { once: true });
          setTimeout(done, 20_000);
          f.src = src;
          document.body.appendChild(f);
        }),
      target
    );
    await sleep(4000);
    need(X.rec.requests.some((q) => q.url === target), "the other site's frame never requested the preview page — the browser half measured nothing");
    const fromApp = X.rec.requests.filter((q) => q.url.startsWith(BASE) && q.url !== target);
    if (fromApp.length) problems.push(`the framed page loaded ${fromApp.length} subresource(s) (${[...new Set(fromApp.map((q) => new URL(q.url).pathname))].slice(0, 3).join(", ")}) — the browser rendered it`);
    if (X.rec.relay.length) problems.push(`${X.rec.relay.length} relay request(s) from the framed page (${relaySummary(X)})`);
    const upstream = (await mainStub.state()).requests.filter((x) => x.params?.identifier === hash);
    if (upstream.length) problems.push("the framed hash reached the stub");
  } finally {
    await X.close();
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return `${docs.length} documents (${seen.join(", ")}) carry both headers; the framed page was blocked: no script, no relay request, the hash never upstream`;
});

await check("5a. CLIENT PARAMETERS ARE REFUSED, NOT STRIPPED: fid, viewer_fid, cursor, limit, provider, a query string, unknown ops, malformed args, the retired channel op (any id) → 400 bad_op, stub hits frozen", async () => {
  needPair();
  const fid = [...deviceFids][0] ?? -1;
  const cases = [
    ["discovery + fid", { op: "discovery", fid: 3 }],
    ["discovery + viewer_fid", { op: "discovery", viewer_fid: 3 }],
    ["discovery + cursor", { op: "discovery", cursor: "eyJ0IjoxfQ" }],
    ["discovery + limit", { op: "discovery", limit: 100 }],
    ["discovery + provider", { op: "discovery", provider: "mbd" }],
    ["user-casts + the device's own fid", { op: "user-casts", arg: "dwr", fid }],
    ["notifications", { op: "notifications" }],
    ["following", { op: "following" }],
    ["feed", { op: "feed", arg: "following" }],
    ["thread, short hash", { op: "thread", arg: "0xabc" }],
    ["thread, not hex", { op: "thread", arg: "0x" + "g".repeat(40) }],
    ["user, not an fname", { op: "user", arg: "Not A Name!" }],
    // FC-READ (no channels): the channel op is retired — refused whatever the id, a former default channel included
    ["channel (retired), a former default channel", { op: "channel", arg: "art" }],
    ["channel (retired), any id", { op: "channel", arg: "fcread-not-listed" }],
    ["discovery with an arg", { op: "discovery", arg: "x" }],
  ];
  const before = (await mainStub.state()).hits.total;
  const problems = [];
  for (const [label, body] of cases) {
    const r = await relay(BASE, body);
    if (r.status !== 400 || r.json?.code !== "bad_op") problems.push(`${label} → ${r.status} ${summary(r.json)}`);
  }
  const q = await relay(BASE, { op: "discovery" }, { query: "?fid=3" });
  if (q.status !== 400 || q.json?.code !== "bad_op") problems.push(`a query string → ${q.status} ${summary(q.json)}`);
  const after = (await mainStub.state()).hits.total;
  if (after !== before) problems.push(`the stub was called ${after - before} time(s) by refused requests`);
  if (problems.length) throw new Error(problems.join(" | "));
  return `${cases.length + 1} malformed requests refused 400 bad_op; stub hits ${before} → ${after}`;
});

if (A) await A.close();
if (B) await B.close();

// ================================================================ SIDE APPS (an in-process stub; exact counts)
let sideStub = null;
const sideLog = { requests: [], violations: [] };
for (let i = 0; i < 3 && !sideStub; i++) {
  try { sideStub = await startNeynarStub({ port: 0, log: (s) => console.log("   [side stub] " + s) }); } catch (e) { if (i === 2) console.log("   (the side stub did not start: " + e.message + ")"); }
}
/** keep what the side stub saw before clearing it for the next app */
async function resetSide() {
  if (!sideStub) return;
  const st = await sideStub.state();
  sideLog.requests.push(...st.requests.map((r) => ({ ...r, src: "side" })));
  sideLog.violations.push(...st.violations);
  await sideStub.reset();
}
const needSide = () => need(sideStub, "the in-process Neynar stub did not start");
// FC-READ (no channels): an armed side app reads discovery by the stub's own authors (every planted cast's author)
const sideRelayArgs = () => ({ NEYNAR_READ_API_KEY: sideStub.key, NEYNAR_READ_BASE_URL: sideStub.baseUrl, FC_READ_RIG: "stub", [DISC.fidsEnv]: SIDE_FIDS.join(",") });

async function withSide(label, extra, fn) {
  needSide();
  await resetSide();
  const app = await startSide(label, extra);
  try {
    return await fn(app);
  } finally {
    await app.stop();
  }
}

const htmlHint = (html) => ({ env: /KEYSTORE_DIR/.test(html), hint: /FC_READ_RELAY/.test(html) });

await check("1. NO KEY: status no_key, no hint in the page, seed cards render with no live card, the page never asks the relay, the stub is never called", async () => {
  return withSide("no-key", { NEYNAR_READ_API_KEY: "", NEYNAR_READ_BASE_URL: sideStub?.baseUrl ?? "", FC_READ_RIG: "stub" }, async (app) => {
    const status = await relay(app.base, { op: "status" });
    statuses.push(["no key", status.json]);
    if (status.status !== 200 || status.json?.armed !== false || status.json?.reason !== "no_key") throw new Error("status " + status.status + " " + summary(status.json) + " (expected unarmed, no_key)");
    const read = await relay(app.base, { op: "discovery" });
    if (read.status !== 503 || read.json?.code !== "fc_read_unarmed") throw new Error("a read answered " + read.status + " " + summary(read.json) + " (expected 503 fc_read_unarmed)");
    const html = await get(app.base + "/home");
    const h = htmlHint(html.text);
    need(h.env, "the /home HTML carries no serialized device env — 'no hint' would be vacuous");
    if (h.hint) throw new Error("the /home HTML names FC_READ_RELAY with no key on the server");
    const K = await openCtx("K");
    try {
      await load(K, app.base, "/home");
      need(K.env && K.env.KEYSTORE_DIR === "/keystore", "the page's device env is not readable");
      if (K.env.FC_READ_RELAY) throw new Error("the device env carries FC_READ_RELAY=" + JSON.stringify(K.env.FC_READ_RELAY));
      const cards = await waitForTimelineCards(K.page, 60_000);
      const live = await K.page.locator(LIVE_SEL).count();
      if (live) throw new Error(live + " live card(s) with no key");
      const chip = K.page.locator('[data-testid="live-source"]');
      if ((await chip.count()) && ["live", "stale"].includes(await chip.first().getAttribute("data-state"))) throw new Error("a live-source chip claims live content with no key");
      const f2 = await apiInPage(K.page, "GET", "/api/feed2?surface=discovery");
      if (f2.json?.liveSource?.source !== "seed") throw new Error("feed2 liveSource is " + summary(f2.json?.liveSource) + " (expected seed)");
      if (K.rec.relay.length) throw new Error("the page asked the relay " + K.rec.relay.length + " time(s) with no hint");
      const st = await sideStub.state();
      if (st.hits.total !== 0) throw new Error("the stub was called " + st.hits.total + " time(s) with no key");
      return `no_key; ${cards} seed card(s), 0 live, 0 relay requests, 0 upstream calls`;
    } finally {
      await K.close();
    }
  });
});

// FC-READ (review): the budget app now serves two checks (9 + 16b, then 9b's thread and profile pages), started once
let BUD = null;
try {
  needSide();
  await resetSide();
  BUD = await startSide("budget", { ...sideRelayArgs(), FC_READ_DAILY_CREDITS: "1" });
} catch (e) {
  console.log("   (the budget side app did not start: " + (e && e.message ? e.message : e) + " — checks 9 and 9b will say so)");
}
let budgetArmed = false;
await check("9. BUDGET (FC_READ_DAILY_CREDITS=1): status ARMED first, then every read → 503 fc_read_budget with the stub never called; 16b. the chip says budget over seed cards, and the device does not retry", async () => {
  need(BUD, "the budget side app did not start");
  return (async (app) => {
    const status = await relay(app.base, { op: "status" });
    statuses.push(["budget spent", status.json]);
    // GAP 5: a refusal that is really no_key must not pass as the budget's
    need(status.status === 200 && status.json?.armed === true && status.json?.reason === "armed", "the relay is not armed on this app (" + summary(status.json) + ") — a refusal would be no_key's, not the budget's");
    if (status.json?.state !== "budget") throw new Error("the status state is " + JSON.stringify(status.json?.state) + " (expected budget)");
    budgetArmed = true;
    const problems = [];
    for (const [label, body] of [["discovery", { op: "discovery" }], ["thread", { op: "thread", arg: randomHash() }], ["user", { op: "user", arg: "dwr" }]]) {
      const r = await relay(app.base, body);
      if (r.status !== 503 || r.json?.code !== "fc_read_budget") problems.push(`${label} → ${r.status} ${summary(r.json)}`);
    }
    if ((await sideStub.state()).hits.total !== 0) problems.push("the stub was called with the budget spent");
    if (problems.length) throw new Error(problems.join(" | "));
    // 16b: what the visitor sees
    const V = await openCtx("budget");
    try {
      await load(V, app.base, "/home");
      need(V.env?.FC_READ_RELAY === "on", "the device env carries no relay hint on an armed app — the page would never meet the budget");
      const cards = await waitForTimelineCards(V.page, 60_000);
      const chip = V.page.locator('[data-testid="live-source"]').first();
      await chip.waitFor({ timeout: 20_000 }).catch(() => { throw new Error("no live-source chip over the budget refusal — seed content would pass for live"); });
      const state = await chip.getAttribute("data-state");
      const text = (await chip.innerText()).trim();
      if (state !== "budget") throw new Error("the chip's data-state is " + JSON.stringify(state) + " (expected budget)");
      const hits = scanNeedles(text, INLINE_ERROR_NEEDLES);
      if (hits.length) throw new Error("the chip's copy carries needle words: " + hits.map((h) => h.label).join(", "));
      const f2 = await apiInPage(V.page, "GET", "/api/feed2?surface=discovery");
      if (f2.json?.liveSource?.source !== "relay" || f2.json?.liveSource?.state !== "budget") throw new Error("feed2 liveSource is " + summary(f2.json?.liveSource));
      if (await V.page.locator(LIVE_SEL).count()) throw new Error("live cards under a spent budget");
      const errs = await inlineErrors(V.page);
      if (errs.length) throw new Error("the budget-spent /home: " + errs.join("; "));
      // FINAL means final: no identical relay request within 1.5 s of a 503/429/400/404 answer
      await sleep(2500);
      const finals = V.rec.relay.filter((r) => [400, 404, 429, 503].includes(r.status));
      need(finals.length > 0, "the page met no final relay refusal — 'no retry' would be vacuous (" + relaySummary(V) + ")");
      const retried = finals.filter((f) => V.rec.requests.some((q) => isRelayUrl(q.url) && q.post === f.post && q.at > f.at && q.at - f.at < 1500));
      if (retried.length) throw new Error(retried.length + " final refusal(s) retried within 1.5 s: " + retried.map((r) => r.op + "→" + r.status).join(", "));
      if ((await sideStub.state()).hits.total !== 0) throw new Error("the page's reads reached the stub with the budget spent");
      return `armed, state budget; 3 reads → 503 fc_read_budget; 0 upstream calls; chip "${text}" over ${cards} seed card(s); ${finals.length} final refusal(s), none retried`;
    } finally {
      await V.close();
    }
  })(BUD);
});

await check('9b. a THREAD and a PROFILE page the relay refused (503 fc_read_budget) render the paused state — data-testid="live-paused" with the relay\'s sentence and a Retry — never the load-error block', async () => {
  need(BUD && budgetArmed, "the budget app is not up, or its relay was not armed with the budget spent (check 9)");
  need(PAUSED && PAUSED.budget, "lib/views/social.ts LIVE_PAUSED_SENTENCES (the device's refusal sentences) could not be read");
  await needReserve();
  const W = await openCtx("budget-lookups");
  const problems = [];
  const done = [];
  try {
    const fname = "fcr" + randomBytes(5).toString("hex").slice(0, 9);
    const hash = randomHash();
    for (const [label, p, op, arg] of [["thread", `/${fname}/status/${hash}`, "thread", hash], ["profile", `/${fname}`, "user", fname]]) {
      const before = W.rec.relay.length;
      await load(W, BUD.base, p);
      need(W.env?.FC_READ_RELAY === "on", "the device env carries no relay hint on this armed app");
      const m = await waitMarks(W.page, (x) => !!x.paused || x.loadError.length > 0 || x.notFound, 45_000);
      // the precondition: THIS page's lookup went to the relay and the relay refused it for the budget.
      // FC-READ (lead fix): the recorder files a relay answer only after reading its body, and the page can render the
      // paused block from that same answer first — so wait (briefly) for the record instead of racing it
      const mine = () => W.rec.relay.slice(before).find((r) => r.op === op && String(r.arg).toLowerCase() === arg);
      for (let i = 0; i < 20 && !mine(); i++) await sleep(250);
      const asked = mine();
      const showed = m?.paused ? "the paused block" : m?.loadError.length ? "the load-error block: " + JSON.stringify(m.loadError[0].slice(0, 120)) : m?.notFound ? "a not-found block" : "nothing settled";
      need(asked && asked.status === 503 && /fc_read_budget/.test(asked.body), `the ${label} page's ${op} lookup was not refused 503 fc_read_budget by the relay (${relaySummary(W)}; the page showed ${showed})${rateNote(W)}`);
      if (!m?.paused) {
        problems.push(`${label}: no live-paused block (${m?.loadError.length ? "the load-error block: " + JSON.stringify(m.loadError[0].slice(0, 120)) : m?.notFound ? "a not-found block" : "nothing settled"})`);
        continue;
      }
      if (!m.paused.visible) problems.push(`${label}: live-paused is not visible`);
      if (!m.paused.text.includes(PAUSED.budget)) problems.push(`${label}: live-paused says ${JSON.stringify(m.paused.text.slice(0, 140))}, not the budget sentence`);
      if (!m.paused.retry) problems.push(`${label}: live-paused has no data-testid=live-paused-retry`);
      if (m.loadError.length) problems.push(`${label}: the load-error block renders too`);
      const hits = scanNeedles(m.paused.text, INLINE_ERROR_NEEDLES);
      if (hits.length) problems.push(`${label}: the paused copy carries needle words (${hits.map((h) => h.label).join(", ")})`);
      const errs = await inlineErrors(W.page);
      if (errs.length) problems.push(`${label}: ${errs.join("; ")}`);
      // Retry is a real control: pressed, the page re-asks and (the budget still spent) stays paused — no error block
      await W.page.locator('[data-testid="live-paused-retry"]').first().click({ timeout: 5000 }).catch((e) => problems.push(`${label}: Retry could not be pressed (${String(e.message).slice(0, 80)})`));
      await sleep(2000);
      const again = await pageMarks(W.page);
      if (!again.paused) problems.push(`${label}: after Retry the paused block is gone (${again.loadError.length ? "load-error: " + again.loadError[0].slice(0, 80) : "nothing"})`);
      if (again.loadError.length) problems.push(`${label}: after Retry the load-error block renders`);
      done.push(`${label} paused`);
    }
    if ((await sideStub.state()).hits.total !== 0) problems.push("the budget app's lookups reached the stub");
  } finally {
    await W.close();
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return `${done.join(", ")} with "${PAUSED.budget}" + Retry; no needle, no load-error block, 0 upstream calls`;
});
if (BUD) await BUD.stop().catch(() => {});

await check("10. KILL SWITCH (FC_READ=off): status off, reads → 503 fc_read_off, no hint in the page, the stub never called", async () => {
  return withSide("off", { ...sideRelayArgs(), FC_READ: "off" }, async (app) => {
    const status = await relay(app.base, { op: "status" });
    statuses.push(["kill switch", status.json]);
    // the key and the base URL are the ones that arm the budget and lookup apps: "off" is the only thing different
    if (status.status !== 200 || status.json?.armed !== false || status.json?.reason !== "off") throw new Error("status " + summary(status.json) + " (expected unarmed, off)");
    const problems = [];
    for (const [label, body] of [["discovery", { op: "discovery" }], ["thread", { op: "thread", arg: randomHash() }]]) {
      const r = await relay(app.base, body);
      if (r.status !== 503 || r.json?.code !== "fc_read_off") problems.push(`${label} → ${r.status} ${summary(r.json)}`);
    }
    const html = await get(app.base + "/home");
    const h = htmlHint(html.text);
    need(h.env, "the /home HTML carries no serialized device env");
    if (h.hint) problems.push("the /home HTML still names FC_READ_RELAY under the kill switch");
    if ((await sideStub.state()).hits.total !== 0) problems.push("the stub was called under the kill switch");
    if (problems.length) throw new Error(problems.join(" | "));
    return "off; reads 503 fc_read_off; no hint; 0 upstream calls";
  });
});

// the lookup app: TRUST_PROXY=true, so each request can name its own address (and check 14 can test the global bucket)
let R = null;
let xffN = 0;
const xff = () => { xffN++; return `10.77.${(xffN >> 8) & 255}.${xffN & 255}`; };
try {
  needSide();
  await resetSide();
  R = await startSide("lookups", { ...sideRelayArgs(), TRUST_PROXY: "true" });
} catch (e) {
  console.log("   (the lookup side app did not start: " + (e && e.message ? e.message : e) + " — checks 5b and 11-14 will say so)");
}
const needR = () => need(R, "the lookup side app did not start");
const sideHits = async () => (await sideStub.state()).hits.total;
let rArmed = false;
/** FC-READ (no channels): 5b's discovery answer on the lookup app — 5d reads what that one miss sent upstream */
let rDiscovery = null;

await check("5b. LOOKUPS through the relay: discovery, user, user-casts and a thread; the retired channel op → 400 bad_op with ZERO upstream calls (before and after discovery is cached); mapped payloads (no raw Neynar fields); user-casts carries the fid by_username resolved", async () => {
  needR();
  const status = await relay(R.base, { op: "status" }, { xff: xff() });
  statuses.push(["lookups", status.json]);
  need(status.json?.armed === true, "the lookup app's relay is not armed (" + summary(status.json) + ")");
  rArmed = true;
  const planted = (await sideStub.state()).planted;
  const known = planted.discoveryHashes[6];
  const who = planted.knownUser;
  const problems = [];
  // FC-READ (no channels): the channel op is RETIRED, not filtered from discovery any more. Asked on a cold cache it must
  // not start a discovery miss; asked with discovery cached it must not be cut from it — 400 bad_op both times, and
  // not one upstream call either way (a former default channel and an arbitrary id alike)
  const channelRefused = async (when) => {
    const before = await sideHits();
    for (const id of ["art", "fcread-not-listed"]) {
      const r = await relay(R.base, { op: "channel", arg: id }, { xff: xff() });
      if (r.status !== 400 || r.json?.code !== "bad_op") problems.push(`the channel op for "${id}" ${when} → ${r.status} ${summary(r.json)} (expected 400 bad_op)`);
    }
    const calls = (await sideHits()) - before;
    if (calls !== 0) problems.push(`the channel op ${when} made ${calls} upstream call(s) (expected 0)`);
  };
  await channelRefused("on a cold cache");
  const d = await relay(R.base, { op: "discovery" }, { xff: xff() });
  need(d.status === 200, "the discovery read answered " + d.status + " " + summary(d.json) + " — nothing was cached for the channel op to be refused over");
  rDiscovery = d;
  await channelRefused("with discovery cached");
  const u = await relay(R.base, { op: "user", arg: who.username }, { xff: xff() });
  const uc = await relay(R.base, { op: "user-casts", arg: who.username }, { xff: xff() });
  const t = await relay(R.base, { op: "thread", arg: known }, { xff: xff() });
  const answered = [];
  for (const [label, r] of [["discovery", d], ["user", u], ["user-casts", uc], ["thread", t]]) if (r.status !== 200) answered.push(`${label} → ${r.status} ${summary(r.json)}`);
  if (answered.length) throw new Error([...answered, ...problems].join(" | "));
  if (u.json.value?.fid !== who.fid) problems.push(`user @${who.username} answered fid ${u.json.value?.fid} (expected ${who.fid})`);
  if (t.json.value?.cast?.hash !== known) problems.push("the thread's root is not the asked hash");
  if (!castsOf(uc.json.value).length) problems.push("user-casts is empty");
  const st = await sideStub.state();
  const chReq = st.requests.filter((x) => isChannelFeedRequest(x.route, x.params));
  if (chReq.length) problems.push(`${chReq.length} channel feed request(s) upstream (${[...new Set(chReq.map((x) => x.route))].join(", ")}) — channels are not a v1 emphasis`);
  const ucReq = st.requests.find((x) => x.route === "/feed/user/casts");
  const byName = st.requests.filter((x) => x.route === "/user/by_username" && typeof x.answeredFid === "number").map((x) => x.answeredFid);
  if (!ucReq) problems.push("user-casts never reached /feed/user/casts");
  else if (!byName.includes(Number(ucReq.params.fid))) problems.push(`/feed/user/casts carried fid ${ucReq.params.fid}, not one by_username resolved (${byName.join(", ")})`);
  // the payloads are the MAPPED shapes: none of the raw wire's fields survive (the raw corpus carries all of them)
  need(readFileSync(path.join("fixtures", "neynar", "user-bulk.json"), "utf8").includes("custody_address"), "the raw recordings carry no custody_address — the mapping check would be vacuous");
  const RAW = /"(custody_address|verified_addresses|auth_addresses|viewer_context|verifications|object|reactions|mentioned_profiles)"\s*:/;
  for (const [label, r] of [["discovery", d], ["user", u], ["user-casts", uc], ["thread", t]]) {
    const m = RAW.exec(r.text);
    if (m) problems.push(`the ${label} payload carries raw field ${m[1]}`);
  }
  const allCasts = [d, uc, t].flatMap((r) => castsOf(r.json.value));
  const unmarked = allCasts.filter((x) => x.network !== true || !HASH40.test(x.hash || ""));
  if (unmarked.length) problems.push(unmarked.length + " relayed cast(s) without network:true or a 40-hex hash");
  if (problems.length) throw new Error(problems.join(" | "));
  return `4 ops answered 200; the channel op 400 bad_op x4 (cold and cached), 0 upstream calls; ${allCasts.length} mapped cast(s); user-casts fid ${ucReq.params.fid} = @${who.username}'s resolved fid`;
});

await check(`5d. DISCOVERY READS THE DECIDED ENDPOINT: its one miss is ONE upstream GET ${DISC.path} with exactly feed_type=filter, filter_type=fids, fids=<the app's ${DISC.fidsEnv}>, with_recasts=false, limit=${DISC.params.limit} (no cursor, no viewer_fid), never a channel feed; the reply and the future-dated cast planted in that feed are dropped (the future-dated one from its author's profile too), and no relayed cast carries a channel`, async () => {
  needR();
  need(rArmed && rDiscovery && rDiscovery.status === 200, "5b made no 200 discovery read on the lookup app — there is no miss to measure");
  const st = await sideStub.state();
  // the lookup app's stub log starts empty (resetSide before it started) and 5b's discovery was its only discovery miss
  const feeds = st.requests.filter((x) => x.route === DISC.route);
  const channelFeeds = st.requests.filter((x) => isChannelFeedRequest(x.route, x.params));
  const problems = [];
  if (channelFeeds.length) problems.push(`${channelFeeds.length} channel feed request(s) (${[...new Set(channelFeeds.map((x) => x.route + (x.params.filter_type ? "?filter_type=" + x.params.filter_type : "")))].join(", ")})`);
  need(feeds.length > 0, `the discovery miss never reached ${DISC.path} (the stub saw: ${[...new Set(st.requests.map((x) => x.route))].join(", ") || "nothing"})`);
  if (feeds.length !== DISC.pagesPerMiss) problems.push(`${feeds.length} upstream ${DISC.route} request(s) for ONE discovery miss (expected ${DISC.pagesPerMiss}: one page, no cursor)`);
  for (const r of feeds) {
    if (!/\/v2\/farcaster\/feed\/?$/.test(r.path)) problems.push(`the discovery path is ${JSON.stringify(r.path)} (expected ${DISC.path})`);
    const bad = discoveryParamProblems(r.params, SIDE_FIDS);
    if (bad.length) problems.push(`#${r.n} ${r.route}?${r.query.slice(0, 120)}: ${bad.join("; ")}`);
    if (r.status !== 200) problems.push(`#${r.n} was answered ${r.status}`);
  }
  // the page the stub answered carried next.cursor (more remained): a relay that followed it would show a second
  // request above, and the cursor itself is a stub violation (check 5)
  need(Array.isArray(st.served.lastFids) && st.served.discovery.length > 0, "the stub recorded no fids discovery answer");
  // replies: the stub planted one INSIDE the fids feed; the relay's discovery shows top-level casts only
  const planted = st.planted;
  need(st.served.discovery.includes(planted.feedReply.hash), "the stub's discovery answer did not carry its planted reply — 'replies are dropped' would be vacuous");
  const casts = castsOf(rDiscovery.json.value);
  need(casts.length >= 3, "the discovery value carries " + casts.length + " cast(s) — too few to mean anything");
  if (casts.some((x) => x.hash === planted.feedReply.hash)) problems.push("the reply planted inside the discovery feed is in the discovery value");
  // FC-READ (future-dated casts): the stub also planted a TOP-LEVEL cast dated 2061 (the real network carries some); the
  // device orders by recency, so the relay must drop it or it would sit on top of the public feed for decades
  need(planted.future && st.served.discovery.includes(planted.future.hash), "the stub's discovery answer did not carry its planted future-dated cast — 'future-dated casts are dropped' would be vacuous");
  if (casts.some((x) => x.hash === planted.future.hash)) problems.push("the cast dated " + planted.future.timestamp + " (served in the discovery feed) is in the discovery value");
  const ahead = casts.filter((x) => typeof x.timestamp === "number" && x.timestamp > Date.now() + 10 * 60_000);
  if (ahead.length) problems.push(`${ahead.length} discovery cast(s) dated more than 10 minutes ahead`);
  const withParent = casts.filter((x) => x.parentHash);
  if (withParent.length) problems.push(`${withParent.length} discovery cast(s) carry a parentHash (discovery is top-level casts only)`);
  const withChannel = casts.filter((x) => x && typeof x === "object" && "channel" in x);
  if (withChannel.length) problems.push(`${withChannel.length} relayed cast(s) carry a channel field — discovery is not channel-labelled in v1`);
  const nFids = String(feeds[0]?.params?.[DISC.fidsParam] ?? "").split(",").length;
  // FC-READ (future-dated casts, review: future-profile-unmeasured): the PROFILE too. The stub answers the author's
  // /feed/user/casts with the 2061 cast in it (it builds user casts from the discovery corpus), so the relay's
  // user-casts op must drop it there as well. Precondition: that upstream answer really carried it.
  need(planted.future.username, "the stub names no author for its future-dated cast (plantedSummary future.username)");
  const pc = await relay(R.base, { op: "user-casts", arg: planted.future.username }, { xff: xff() });
  need(pc.status === 200, `@${planted.future.username}'s user-casts answered ${pc.status} ${summary(pc.json)} — the profile check needs an admitted author`);
  const ucFuture = (await sideStub.state()).requests.filter((x) => x.route === "/feed/user/casts" && Number(x.params.fid) === planted.fids.future);
  need(ucFuture.some((x) => x.status === 200 && Array.isArray(x.servedHashes) && x.servedHashes.includes(planted.future.hash)), `the stub's /feed/user/casts answer for fid ${planted.fids.future} did not carry the future-dated cast — "dropped from the profile" would be vacuous`);
  const profileCasts = castsOf(pc.json.value);
  need(profileCasts.length >= 1, `@${planted.future.username}'s user-casts value is empty — nothing shows the other casts still flow`);
  if (profileCasts.some((x) => x.hash === planted.future.hash)) problems.push(`the cast dated ${planted.future.timestamp} is on @${planted.future.username}'s profile (user-casts)`);
  const profileAhead = profileCasts.filter((x) => typeof x.timestamp === "number" && x.timestamp > Date.now() + 10 * 60_000);
  if (profileAhead.length) problems.push(`${profileAhead.length} profile cast(s) dated more than 10 minutes ahead`);
  if (problems.length) throw new Error(problems.join(" | "));
  return `1 miss → 1 GET ${feeds[0].path}?${Object.entries(DISC.params).map(([k, v]) => k + "=" + v).join("&")}&${DISC.fidsParam}=<${nFids} fids = ${DISC.fidsEnv}>; 0 channel feeds; the in-feed reply and the future-dated cast dropped; ${casts.length} top-level cast(s), none channel-labelled; the future-dated cast off @${planted.future.username}'s profile too (${profileCasts.length} cast(s) there)`;
});

await check("5c. fnames that are also parameter words (cursor, following, notifications) are LOOKED UP: one by_username upstream each, answered not_found and negative-cached — never refused after a charge", async () => {
  needR();
  need(rArmed, "the lookup app's relay is not armed (5b)");
  const problems = [];
  const summaryParts = [];
  const userCastsCalls = async () => (await sideStub.state()).requests.filter((x) => x.route === "/feed/user/casts").length;
  const ucBefore = await userCastsCalls();
  for (const name of ["cursor", "following", "notifications"]) {
    const r1 = await relay(R.base, { op: "user", arg: name }, { xff: xff() });
    const r2 = await relay(R.base, { op: "user", arg: name }, { xff: xff() });
    const rc = await relay(R.base, { op: "user-casts", arg: name }, { xff: xff() });
    const st = await sideStub.state();
    const seen = st.requests.filter((x) => x.route === "/user/by_username" && x.params.username === name);
    // the bug this guards: a defence-in-depth check matched these words anywhere in the upstream PATH (values
    // included) after the budget had been charged, so the lookup failed as fc_read_upstream with no request made
    if (seen.length !== 1) problems.push(`@${name}: ${seen.length} by_username request(s) upstream (expected exactly 1: looked up once, then negative-cached)`);
    else if (seen[0].status !== 404) problems.push(`@${name}: the stub answered ${seen[0].status}`);
    for (const [label, r] of [["first", r1], ["repeat", r2], ["user-casts", rc]]) if (r.status !== 404 || r.json?.code !== "not_found") problems.push(`@${name} ${label} → ${r.status} ${summary(r.json)}`);
    summaryParts.push(`@${name} 1 upstream → not_found`);
  }
  const ucAfter = await userCastsCalls();
  if (ucAfter !== ucBefore) problems.push(`user-casts for users that do not exist reached /feed/user/casts ${ucAfter - ucBefore} time(s)`);
  const v = (await sideStub.state()).violations.filter((x) => x.route === "/user/by_username");
  if (v.length) problems.push("the stub recorded violation(s) on these lookups: " + v.map((x) => x.kind).join(", "));
  if (problems.length) throw new Error(problems.join(" | "));
  return summaryParts.join("; ") + "; repeats and user-casts from the negative cache";
});

await check("2e. a STALE relay answer on a thread and a profile page turns their live-source chip to data-state=stale (the relay's own 200 answer, relabelled stale on the wire)", async () => {
  needR();
  need(rArmed, "the lookup app's relay is not armed (5b)");
  const planted = (await sideStub.state()).planted;
  const who = planted.knownUser;
  const hash = planted.discoveryHashes[6]; // 5b read it: a cache hit here, no credit
  need(HASH40.test(hash || "") && /^[a-z0-9][a-z0-9-]{0,15}$/.test(who.username), "the stub's known user or hash is not the network shape");
  await needReserve();
  const S = await openCtx("stale");
  const rewritten = [];
  try {
    // the relay never serves a LOOKUP from its shelf (privacy-safety-2), so a stale thread or profile in the field is the
    // TAB's own shelf (content.ts relayFetch, after the relay refuses a re-ask) — reached only past the device's
    // minutes-long freshness, too slow to wait for here. Both paths hand the page the same {stale: true} result, so the
    // relay's own 200 relabelled stale on the wire drives the same device and island code in seconds. What THIS
    // measures is the page: given a stale answer, do the thread and profile pages say so
    await S.ctx.route((u) => isRelayUrl(u), async (route) => {
      const req = route.request();
      let op = "";
      try { op = JSON.parse(req.postData() || "{}").op; } catch { /* not json */ }
      if (req.method() !== "POST" || !["thread", "user", "user-casts"].includes(op)) return route.fallback();
      const resp = await route.fetch();
      const text = await resp.text();
      let j = null;
      try { j = JSON.parse(text); } catch { /* not json */ }
      if (resp.status() !== 200 || !j || !("value" in j)) return route.fulfill({ response: resp, body: text });
      rewritten.push(op);
      return route.fulfill({ response: resp, body: JSON.stringify({ ...j, stale: true, state: "stale" }) });
    });
    const problems = [];
    for (const [label, p, want] of [["thread", `/${who.username}/status/${hash}`, "thread"], ["profile", `/${who.username}`, "user"]]) {
      const before = rewritten.length;
      await load(S, R.base, p);
      const m = await waitMarks(S.page, (x) => x.chips.some((c) => c.state === "stale") || !!x.paused || x.notFound || x.loadError.length > 0, 45_000);
      need(rewritten.slice(before).includes(want), `the ${label} page's ${want} answer was never relabelled (${relaySummary(S)}) — nothing stale reached the page`);
      const chip = m?.chips.find((c) => c.visible) ?? m?.chips[0];
      if (!chip) problems.push(`${label}: no live-source chip over a stale answer`);
      else {
        if (chip.state !== "stale") problems.push(`${label}: the chip's data-state is ${JSON.stringify(chip.state)} over a stale answer`);
        const hits = scanNeedles(chip.text, INLINE_ERROR_NEEDLES);
        if (hits.length) problems.push(`${label}: the stale chip's copy carries needle words (${hits.map((h) => h.label).join(", ")})`);
      }
      if (label === "thread" && m?.root?.live !== "true") problems.push("thread: the stale root is not shown as a live (network) cast");
    }
    if (problems.length) throw new Error(problems.join(" | "));
    return `${rewritten.length} relay answer(s) relabelled stale; thread and profile chips say stale`;
  } finally {
    await S.close();
  }
});

await check("20b. with the framing headers STRIPPED (a proxy that drops them), a framed preview page's device makes no lookup and shows the paused state, while the same page opened top level does look up", async () => {
  needR();
  need(rArmed, "the lookup app's relay is not armed (5b)");
  need(PAUSED && PAUSED.framed, "lib/views/social.ts LIVE_PAUSED_SENTENCES has no framed sentence");
  const fname = "fcr" + randomBytes(5).toString("hex").slice(0, 9);
  const hash = randomHash();
  const targetPath = `/${fname}/status/${hash}`;
  const upstreamFor = async () => (await sideStub.state()).requests.filter((x) => x.route === "/cast/conversation" && x.params.identifier === hash).length;
  await needReserve();
  // the stripping proxy in front of the lookup app (see startStripProxy: why not Playwright's route.fulfill)
  const proxy = await startStripProxy(R.base, targetPath);
  const target = proxy.base + targetPath;
  const X = await openCtx("framed-stripped");
  const problems = [];
  try {
    await X.page.goto(sideStub.url + "/__stub/xsite.html", { waitUntil: "load" });
    await X.page.evaluate((src) => {
      const f = document.createElement("iframe");
      f.id = "fcread-probe";
      f.width = "1000";
      f.height = "800";
      f.src = src;
      document.body.appendChild(f);
    }, target);
    const deadline = Date.now() + 20_000;
    let frame = null;
    while (Date.now() < deadline && !frame) {
      frame = X.page.frames().find((f) => f !== X.page.mainFrame() && f.url().startsWith(proxy.base)) ?? null;
      if (!frame) await sleep(300);
    }
    need(proxy.stripped() > 0 && frame, "the framed document was never served with its headers stripped (" + proxy.stripped() + " rewrite(s)) — the device's own guard was not reached");
    // the device booted IN the frame: otherwise "no lookup" could be a dead page, not a guard
    const info = await waitForDevice(frame, 120_000).catch((e) => { throw new Error("precondition: the framed page's device did not boot (" + String(e.message).slice(0, 160) + ") — a skipped lookup cannot be told from a dead page" + rateNote(X)); });
    if (Number.isInteger(info?.fid)) deviceFids.add(info.fid);
    const m = await waitMarks(frame, (x) => !!x.paused || x.notFound || x.loadError.length > 0 || !!x.root, 45_000);
    const lookups = X.rec.relay.filter((r) => ["thread", "user", "user-casts"].includes(r.op));
    if (lookups.length) problems.push(`the framed page made ${lookups.length} relay lookup(s): ${lookups.map((r) => r.op + "→" + r.status).join(", ")}`);
    // FC-READ (lead fix): the answered list is filed after each body is read; the SENT list is filed as the request
    // leaves, so a lookup still in flight (or never answered) counts too
    const sentLookups = X.rec.requests.filter((q) => isRelayUrl(q.url) && q.method === "POST" && /"op"\s*:\s*"(thread|user|user-casts)"/.test(q.post));
    if (sentLookups.length > lookups.length) problems.push(`the framed page sent ${sentLookups.length} relay lookup(s) (${lookups.length} answered so far)`);
    if ((await upstreamFor()) !== 0) problems.push("the framed hash reached the stub");
    if (!m?.paused) problems.push(`the framed thread page shows no live-paused block (${m?.notFound ? "not-found — a lie about a post that may exist" : m?.loadError.length ? "the load-error block" : "nothing settled"})`);
    else if (!m.paused.text.includes(PAUSED.framed)) problems.push(`the framed page's paused block says ${JSON.stringify(m.paused.text.slice(0, 120))}, not the framed sentence`);
  } finally {
    await X.close();
  }
  // positive control: the SAME page, top level, in a fresh tab — through the same stripping proxy, so the proxy path is
  // shown to reach the relay as well — does look the hash up (so "no lookup" above was the frame guard, not a page that
  // never asks, nor a proxy that never forwards)
  const T = await openCtx("framed-control");
  try {
    await load(T, proxy.base, targetPath);
    if (Number.isInteger(T.info?.fid)) deviceFids.add(T.info.fid);
    await waitMarks(T.page, (x) => x.notFound || !!x.paused || x.loadError.length > 0 || !!x.root, 45_000);
    const asked = T.rec.relay.some((r) => r.op === "thread" && r.arg === hash);
    need(asked && (await upstreamFor()) === 1, `the top-level control did not look the hash up (${relaySummary(T)}; ${await upstreamFor()} upstream) — the frame's silence proves nothing`);
  } finally {
    await T.close();
    await proxy.close().catch(() => {});
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return `framed (headers stripped by a loopback proxy): device booted, 0 lookups, paused with the framed sentence; top level through the same proxy: 1 lookup, 1 upstream`;
});

await check("13. NEGATIVE CACHE: a random 40-hex thread reaches the stub once, then is answered 404 from cache (its uppercase variant too)", async () => {
  needR();
  need(rArmed, "the lookup app's relay is not armed (5b)");
  const h = randomHash();
  const seenFor = async () => (await sideStub.state()).requests.filter((x) => x.route === "/cast/conversation" && x.params.identifier === h);
  const r1 = await relay(R.base, { op: "thread", arg: h }, { xff: xff() });
  const first = await seenFor();
  need(first.length === 1 && first[0].status === 404, "the first read of the random hash did not reach the stub once and 404 there (" + first.length + " request(s))");
  if (r1.status !== 404 || r1.json?.code !== "not_found") throw new Error("the first read answered " + r1.status + " " + summary(r1.json));
  const r2 = await relay(R.base, { op: "thread", arg: h }, { xff: xff() });
  const r3 = await relay(R.base, { op: "thread", arg: "0x" + h.slice(2).toUpperCase() }, { xff: xff() });
  const again = await seenFor();
  if (r2.status !== 404 || r3.status !== 404) throw new Error(`the repeats answered ${r2.status} / ${r3.status}`);
  if (again.length !== 1) throw new Error(`the hash reached the stub ${again.length} time(s) — not negative-cached`);
  return "1 upstream call, then 404 from cache (twice, one of them uppercase)";
});

await check("12. THE SERVER STAYS SEED: a random /<fname>, /home, /explore, a live author's profile and a thread page (fetched with no browser) cause no stub hit", async () => {
  needR();
  need(rArmed, "the lookup app's relay is not armed (5b)");
  const planted = (await sideStub.state()).planted;
  const fname = "fcr" + randomBytes(5).toString("hex").slice(0, 9);
  const before = await sideHits();
  const pages = [`/${fname}`, "/home", "/explore", `/${planted.knownUser.username}`, `/${planted.knownUser.username}/status/${planted.discoveryHashes[7]}`, `/${fname}/status/${randomHash()}`];
  const answered = [];
  for (const p of pages) {
    const r = await get(R.base + p);
    if (r.status >= 500) throw new Error(`${p} answered ${r.status}`);
    answered.push(`${p.length > 24 ? p.slice(0, 24) + "…" : p} ${r.status}`);
  }
  await sleep(500);
  const after = await sideHits();
  // positive control: a miss on THIS app does move the counter, so "unchanged" above is a measurement
  const ctl = await relay(R.base, { op: "thread", arg: randomHash() }, { xff: xff() });
  const afterCtl = await sideHits();
  need(afterCtl === after + 1, `the positive control (a relay miss) moved the stub counter by ${afterCtl - after}, not 1 (answered ${ctl.status}) — the counter cannot witness the pages`);
  if (after !== before) throw new Error(`server renders called the stub ${after - before} time(s) — a page load is an unmetered spend path`);
  return `${pages.length} server renders (${answered.join(", ")}): 0 upstream calls; the control miss: +1`;
});

await check("11. CROSS-SITE: no header, Sec-Fetch-Site: cross-site, a GET, a text/plain body, and a browser on another site (preflight refused; no-cors refused) — stub hits frozen", async () => {
  needR();
  need(rArmed, "the lookup app's relay is not armed (5b)");
  const before = await sideHits();
  const problems = [];
  const refusedNode = async (label, p) => {
    const r = await p;
    if (!(r.status >= 400 && r.status < 500) || r.json?.value !== undefined) problems.push(`${label} → ${r.status} ${summary(r.json)}`);
    return r;
  };
  await refusedNode("no x-layers-relay header", relay(R.base, { op: "thread", arg: randomHash() }, { noHeader: true, xff: xff() }));
  await refusedNode("Sec-Fetch-Site: cross-site", relay(R.base, { op: "thread", arg: randomHash() }, { xff: xff(), headers: { "sec-fetch-site": "cross-site" } }));
  await refusedNode("a text/plain body (a form or a no-cors fetch)", relay(R.base, null, { raw: JSON.stringify({ op: "thread", arg: randomHash() }), contentType: "text/plain", xff: xff() }));
  const g = await fetch(R.base + RELAY.path + "?op=discovery", { cache: "no-store" });
  if (g.status < 400) problems.push(`a GET → ${g.status}`);
  // a real browser on another site: the stub's page at 127.0.0.1 is a different site from localhost
  // FC-READ (lead fix): the precondition used to read Sec-Fetch-Site off the automation layer's request objects and got
  // [null, null] — the preflighted fetch is never sent, and Playwright does not reliably expose the network stack's
  // sec-fetch-* headers on the no-cors one (measured: it did for a 204 answer, not for the relay's 403). So "this page
  // is on another site" is now established twice over, by things that CAN be read:
  //   (a) arithmetic — a site is scheme + registrable domain (a port is not part of it), and neither 127.0.0.1 nor
  //       localhost has a registrable domain, so each host is its own site: the probe page and the app differ;
  //   (b) the browser's own label, witnessed — the same page sends the SAME two shapes (the preflighted one and the
  //       no-cors one) to the stub's /__stub/echo addressed as localhost, the app's site, and the stub records the
  //       Sec-Fetch-Site the browser attached (the OPTIONS preflight included), which must be cross-site;
  // and the relay's answer to the no-cors probe is observed on the wire (a 4xx response to a POST this page sent),
  // so "stub hits frozen" below is a refusal of a request that ARRIVED, not of one that never left the tab.
  const siteOf = (u) => { try { const x = new URL(u); return x.protocol + "//" + x.hostname.toLowerCase(); } catch { return ""; } };
  const probeOrigin = new URL(sideStub.url).origin;
  const echoUrl = `http://localhost:${new URL(sideStub.url).port}/__stub/echo`;
  need(siteOf(probeOrigin) && siteOf(R.base) && siteOf(probeOrigin) !== siteOf(R.base), `the probe page (${probeOrigin}) and the app (${R.base}) are the same site — nothing here would be cross-site`);
  need(siteOf(echoUrl) === siteOf(R.base), `the echo witness (${echoUrl}) is not on the app's site (${R.base}) — its label would not be the relay's`);
  const X = await openCtx("xsite", { intercept: false }); // a real preflight, refused by the server (see openCtx)
  let seen = null;
  let browserHalf = "";
  try {
    await X.page.goto(sideStub.url + "/__stub/xsite.html", { waitUntil: "load" });
    const target = R.base + RELAY.path;
    const echoesBefore = (await sideStub.state()).echoes.length;
    const out = await X.page.evaluate(
      async ({ target, echoUrl, h1, h2 }) => {
        const res = {};
        const shapes = async (url, a1, a2) => {
          const r2 = {};
          try {
            const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-layers-relay": "1" }, body: JSON.stringify({ op: "thread", arg: a1 }) });
            r2.preflight = "answered " + r.status;
          } catch {
            r2.preflight = "blocked";
          }
          try {
            await fetch(url, { method: "POST", mode: "no-cors", headers: { "content-type": "text/plain" }, body: JSON.stringify({ op: "thread", arg: a2 }) });
            r2.noCors = "sent";
          } catch {
            r2.noCors = "failed";
          }
          return r2;
        };
        Object.assign(res, await shapes(target, h1, h2));
        res.echo = await shapes(echoUrl, h1, h2);
        return res;
      },
      { target, echoUrl, h1: randomHash(), h2: randomHash() }
    );
    await sleep(1000);
    seen = X.rec.requests.filter((q) => q.url.startsWith(R.base + RELAY.path) && q.method === "POST");
    need(seen.length > 0, "the other site's page sent nothing to the relay — the browser half measured nothing");
    // (b) the browser's label on the app's site, from this page: both shapes cross-site, from the probe's origin
    const echoes = (await sideStub.state()).echoes.slice(echoesBefore);
    const pre = echoes.find((e) => e.method === "OPTIONS" && /x-layers-relay/i.test(e.requestHeaders || ""));
    const nc = echoes.find((e) => e.method === "POST" && e.secFetchMode === "no-cors");
    need(pre && nc, `the echo witness recorded ${echoes.length} request(s) (${echoes.map((e) => e.method).join(", ") || "none"}), not the preflight and the no-cors POST — the browser's label was not measured (echo probe: ${JSON.stringify(out.echo)})`);
    need(pre.secFetchSite === "cross-site" && nc.secFetchSite === "cross-site", `the browser labelled the probe page's requests to the app's site Sec-Fetch-Site ${JSON.stringify([pre.secFetchSite, nc.secFetchSite])}, not cross-site`);
    need(pre.origin === probeOrigin && nc.origin === probeOrigin, `the echo witness saw Origin ${JSON.stringify([pre.origin, nc.origin])}, not the probe page's ${probeOrigin}`);
    // the relay's own answer to the no-cors probe, on the wire (the preflighted POST never leaves the tab)
    // (the response recorder reads the body first, so give it a moment rather than race it)
    let answered = [];
    for (let i = 0; i < 20 && !answered.length; i++) {
      answered = X.rec.relay.filter((r) => r.status > 0);
      if (!answered.length) await sleep(250);
    }
    need(answered.length > 0, "no relay answer to the probe page's no-cors POST was observed — it may never have arrived, and a refusal of nothing proves nothing");
    const accepted = answered.filter((r) => r.status < 400 || r.status >= 500);
    if (accepted.length) problems.push("the relay answered the other site's page " + accepted.map((r) => r.status).join(", ") + " (expected a 4xx refusal)");
    if (out.preflight !== "blocked") problems.push("a cross-site fetch WITH the header was not blocked (" + out.preflight + ") — a preflight was approved");
    if (out.noCors !== "sent") problems.push("the no-cors probe could not be sent (" + out.noCors + ")");
    browserHalf = `relay answered the no-cors probe ${answered.map((r) => r.status).join("/")}; the browser labels that page cross-site (preflight + no-cors, witnessed)`;
  } finally {
    await X.close();
  }
  const after = await sideHits();
  if (after !== before) problems.push(`the stub was called ${after - before} time(s) by refused requests`);
  // positive control: the same shape WITH the header, same-origin, does reach the stub
  const ctl = await relay(R.base, { op: "thread", arg: randomHash() }, { xff: xff(), headers: { "sec-fetch-site": "same-origin" } });
  const afterCtl = await sideHits();
  need(afterCtl === after + 1, `the positive control moved the stub counter by ${afterCtl - after} (answered ${ctl.status}) — 'frozen' above would be vacuous`);
  if (problems.length) throw new Error(problems.join(" | "));
  return `4 node refusals + a cross-site browser (preflight blocked, no-cors refused; ${browserHalf}): 0 upstream calls; the control: +1`;
});

await check(`14. TRUST_PROXY=true + spoofed X-Forwarded-For: the spoofed address picks the per-address bucket (proven first), and a 100-address burst is still held by the global bucket (<= ${RELAY.globalMissesPerMinute} upstream, 429 fc_read_rate + Retry-After)`, async () => {
  needR();
  need(rArmed, "the lookup app's relay is not armed (5b)");
  // GAP 6: locally, without TRUST_PROXY, every request shares one bucket and a spoof test proves nothing. So first show
  // that on THIS app a spoofed address really does choose its own bucket.
  const one = "10.99.0.1";
  let n = 0;
  let limited = null;
  for (let i = 0; i < RELAY.perAddressMisses * 2; i++) {
    const r = await relay(R.base, { op: "thread", arg: randomHash() }, { xff: one });
    n++;
    if (r.status === 429) { limited = r; break; }
  }
  need(limited && limited.json?.code === "fc_read_rate", `one spoofed address never ran out of misses in ${n} — the per-address bucket does not follow X-Forwarded-For here, so the global test would be vacuous`);
  const other = await relay(R.base, { op: "thread", arg: randomHash() }, { xff: "10.99.0.2" });
  need(other.status === 404, `a DIFFERENT spoofed address was refused as well (${other.status} ${summary(other.json)}) — the limit is not per address, so the burst below would not isolate the global bucket`);
  const before = await sideHits();
  const burst = await Promise.all(Array.from({ length: 100 }, (_, i) => relay(R.base, { op: "thread", arg: randomHash() }, { xff: `10.98.${(i >> 8) & 255}.${i & 255}` })));
  const during = (await sideHits()) - before;
  const rate = burst.filter((r) => r.status === 429 && r.json?.code === "fc_read_rate");
  const odd = burst.filter((r) => ![404, 429].includes(r.status));
  if (!rate.length) throw new Error(`100 misses from 100 spoofed addresses all went through (${during} upstream calls) — no global bound`);
  if (rate.some((r) => !r.retryAfter)) throw new Error("a 429 fc_read_rate lacks Retry-After");
  if (during > RELAY.globalMissesPerMinute) throw new Error(`${during} upstream calls in the burst — more than the global ${RELAY.globalMissesPerMinute} a minute`);
  if (odd.length) throw new Error(odd.length + " burst answer(s) were neither 404 nor 429: " + [...new Set(odd.map((r) => r.status))].join(", "));
  return `per-address limit after ${n} misses (a second address still served); burst: ${during} upstream, ${rate.length} of 100 → 429 fc_read_rate`;
});

if (R) await R.stop().catch(() => {});

// ================================================================ FC-READ (house): the second discovery source
// The owner chooses in the morning between FC_READ_FIDS (a list of authors) and FC_READ_HOUSE_FID (one house account
// whose FOLLOWS are the list). Both must be ready, so the house source is measured here as fully as the fids source is
// on the lookup app (5b / 5d), on side apps of the same build against the same in-process stub: its one pinned request,
// its moderation, its price, and the refusals that keep the two sources exclusive.
/** FC-READ (house): an armed side app on the house source — the stub's house account, and NO fid list (sideEnv blanks
 *  FC_READ_FIDS by name, so .env.local's cannot ride along either) */
const sideHouseArgs = () => ({ NEYNAR_READ_API_KEY: sideStub.key, NEYNAR_READ_BASE_URL: sideStub.baseUrl, FC_READ_RIG: "stub", [HOUSE.env]: String(HOUSE_FID) });
let houseArmed = false;

/**
 * FC-READ (house): an app whose relay must be UNARMED with bad_config: status bad_config, a discovery read 503
 * fc_read_unarmed, no relay hint in the /home HTML, ZERO stub calls, and the relay's one "[fc-read] unarmed:
 * bad_config (...)" line naming `mustName` (all of them) or one of `anyOf`, while the app's output carries none of
 * `values` (the configured values: a variable is named, never its value). Returns the problems; [] = as required.
 */
async function badConfigProblems(app, label, { mustName = [], anyOf = [], values = [], exactLine = "" }) {
  const problems = [];
  const status = await relay(app.base, { op: "status" });
  statuses.push([label, status.json]);
  if (status.status !== 200 || status.json?.armed !== false || status.json?.reason !== "bad_config") problems.push(`${label}: status ${status.status} ${summary(status.json)} (expected unarmed, bad_config)`);
  const read = await relay(app.base, { op: "discovery" });
  if (read.status !== 503 || read.json?.code !== "fc_read_unarmed") problems.push(`${label}: discovery → ${read.status} ${summary(read.json)} (expected 503 fc_read_unarmed)`);
  const html = await get(app.base + "/home");
  const h = htmlHint(html.text);
  need(h.env, `${label}: the /home HTML carries no serialized device env — 'no hint' would be vacuous`);
  if (h.hint) problems.push(`${label}: the /home HTML names FC_READ_RELAY on an unarmed relay`);
  const calls = (await sideStub.state()).hits.total;
  if (calls !== 0) problems.push(`${label}: the stub was called ${calls} time(s) (expected 0: an unarmed relay spends nothing)`);
  // the arming line is written at first use (the status op above); give the child's stdout a moment to arrive
  let line = "";
  for (let i = 0; i < 20 && !line; i++) {
    line = (app.out().match(/\[fc-read\] unarmed: bad_config[^\n]*/) || [""])[0];
    if (!line) await sleep(250);
  }
  if (!line) problems.push(`${label}: no "[fc-read] unarmed: bad_config" line in the app's output`);
  else {
    const missingNames = mustName.filter((n) => !line.includes(n));
    if (missingNames.length) problems.push(`${label}: the log line does not name ${missingNames.join(", ")}: "${line.trim().slice(0, 160)}"`);
    if (anyOf.length && !anyOf.some((n) => line.includes(n))) problems.push(`${label}: the log line names neither ${anyOf.join(" nor ")}: "${line.trim().slice(0, 160)}"`);
    if (exactLine && line.trim() !== exactLine) problems.push(`${label}: the log line is "${line.trim().slice(0, 160)}" (expected exactly "${exactLine}")`);
  }
  for (const [what, v] of values) if (v && app.out().includes(v)) problems.push(`${label}: the app's output printed the configured value of ${what}`);
  return problems;
}

await check(`24. HOUSE SOURCE: a side app holding ${HOUSE.env} (and no ${DISC.fidsEnv}) arms; its discovery miss is ONE upstream GET ${HOUSE.path} with exactly fid=<the house fid>, with_recasts=${HOUSE.params.with_recasts}, limit=${HOUSE.params.limit} (no viewer_fid, no cursor) and nothing else; the in-feed reply, the low/no-score authors, the denylisted hash and the future-dated cast never reach the value; /home renders live cards from it; the status names neither source nor fid`, async () => {
  needSide();
  return withSide("house", { ...sideHouseArgs(), FC_READ_DENY: STUB_DENY_HASH }, async (app) => {
    const status = await relay(app.base, { op: "status" });
    statuses.push(["house", status.json]);
    need(status.status === 200 && status.json?.armed === true && status.json?.reason === "armed", `the house side app's relay did not arm on ${HOUSE.env} alone (${status.status} ${summary(status.json)}) — a build from before FC-READ (house)? Nothing below would measure the house source`);
    houseArmed = true;
    const problems = [];
    const sj = JSON.stringify(status.json);
    if (sj.includes(String(HOUSE_FID)) || /house|fids|following/i.test(sj)) problems.push("the status answer names the source or the house fid: " + sj.slice(0, 160));
    need((await sideStub.state()).hits.total === 0, "the stub was called before the discovery read — its log could not attribute the miss");
    const d = await relay(app.base, { op: "discovery" });
    need(d.status === 200, "the house discovery read answered " + d.status + " " + summary(d.json));
    const st = await sideStub.state();
    const reqs = st.requests;
    need(st.served.lastSource === "house", `the stub served no house-feed answer (the relay asked: ${reqs.map((x) => x.route).join(", ") || "nothing"})`);
    // exactly ONE upstream request for the one miss, and it is the pinned one
    if (reqs.length !== HOUSE.pagesPerMiss) problems.push(`${reqs.length} upstream request(s) for ONE discovery miss (expected ${HOUSE.pagesPerMiss}: one page, no cursor): ${reqs.map((x) => x.route).join(", ")}`);
    const pinned = reqs.filter((x) => houseRequestProblems(x, HOUSE_FID).length === 0);
    if (!pinned.length) problems.push("no upstream request was the pinned house read: " + reqs.map((x) => `${x.path}?${x.query.slice(0, 100)} (${houseRequestProblems(x, HOUSE_FID).join("; ")})`).join(" | "));
    for (const x of reqs) {
      if (x.path !== HOUSE.path) problems.push(`#${x.n} went to ${JSON.stringify(x.path)} (the pinned path is ${HOUSE.path})`);
      if (x.status !== 200) problems.push(`#${x.n} was answered ${x.status}`);
      if (x.route === DISC.route) problems.push(`#${x.n} read the fids feed on the house source`);
      if (isChannelFeedRequest(x.route, x.params)) problems.push(`#${x.n} read a channel feed (${x.route})`);
    }
    if (st.violations.length) problems.push(`${st.violations.length} stub violation(s): ` + st.violations.slice(0, 4).map((v) => `${v.kind} ${v.route}${v.detail ? " (" + v.detail.slice(0, 100) + ")" : ""}`).join("; "));
    // moderation: the stub's house feed carried every planted cast; the relay's value must not
    const planted = st.planted;
    // FC-READ (future-dated casts): and the top-level cast dated 2061, which would otherwise sit on top of the feed
    const dropped = { "in-feed reply": planted.feedReply.hash, "low-score author": planted.low.hash, "no-score author": planted.none.hash, "denylisted hash": STUB_DENY_HASH, "future-dated cast": planted.future?.hash };
    const servedD = new Set(st.served.discovery);
    const unserved = Object.entries(dropped).filter(([, h]) => !servedD.has(h)).map(([k]) => k);
    need(!unserved.length, "the stub's house answer did not carry the planted " + unserved.join(", ") + " — 'dropped' would be vacuous");
    const casts = castsOf(d.json.value);
    need(casts.length >= 3, "the house discovery value carries " + casts.length + " cast(s) — too few to mean anything");
    const hashes = new Set(casts.map((x) => x.hash));
    for (const [k, h] of Object.entries(dropped)) if (hashes.has(h)) problems.push(`the ${k} (served by the house feed) is in the discovery value`);
    if (casts.some((x) => x.parentHash)) problems.push("a discovery cast carries a parentHash (discovery is top-level casts only)");
    const odd = casts.filter((x) => x.network !== true || !HASH40.test(x.hash || "") || !servedD.has(x.hash) || (x && typeof x === "object" && "channel" in x));
    if (odd.length) problems.push(`${odd.length} relayed cast(s) not network:true + a 40-hex hash the house feed served, or carrying a channel field`);
    // the browser: live cards on /home, from that one read (the page's own discovery a cache hit)
    await needReserve();
    const Hh = await openCtx("H");
    let live = 0;
    try {
      await load(Hh, app.base, "/home");
      if (Number.isInteger(Hh.info?.fid)) deviceFids.add(Hh.info.fid);
      need(Hh.env && Hh.env.KEYSTORE_DIR === "/keystore", "the house app's device env is not readable");
      if (Hh.env.FC_READ_RELAY !== "on") problems.push("the house app's device env carries FC_READ_RELAY=" + JSON.stringify(Hh.env.FC_READ_RELAY));
      const n = await waitLive(Hh.page, 60_000);
      if (!n) throw new Error([...problems, "no live card on the house app's /home within 60 s — relay traffic: " + relaySummary(Hh) + rateNote(Hh)].join(" | "));
      await sleep(1500);
      const cards = await liveCards(Hh.page);
      live = cards.length;
      const after = await sideStub.state();
      const servedNow = new Set(after.served.discovery);
      const foreign = cards.filter((c) => !HASH40.test(c.hash || "") || !servedNow.has(c.hash));
      if (foreign.length) problems.push(`${foreign.length} live card(s) whose hash the house feed did not serve (${foreign.map((c) => String(c.hash).slice(0, 10)).join(", ")})`);
      const leaked = cards.filter((c) => Object.values(dropped).includes(c.hash));
      if (leaked.length) problems.push(`${leaked.length} live card(s) the relay must have dropped (reply, low/no score or denylisted)`);
      if (!Hh.rec.relay.some((r) => r.op === "discovery" && r.status === 200)) problems.push("live cards, but no 200 discovery read was seen from the page (" + relaySummary(Hh) + ")");
      const following = after.requests.filter((x) => isFollowingFeedRequest(x.route, x.params));
      if (following.length !== 1) problems.push(`the stub saw ${following.length} following-feed request(s) after the page loaded (expected the one miss above: the page's discovery is a cache hit)`);
      if (after.requests.some((x) => x.route === DISC.route)) problems.push("the page's reads reached the fids feed on the house source");
      if (after.violations.length) problems.push(`${after.violations.length} stub violation(s) after the page loaded`);
    } finally {
      await Hh.close();
    }
    if (problems.length) throw new Error(problems.join(" | "));
    const q = reqs[0];
    return `armed on ${HOUSE.env} alone; 1 miss → 1 GET ${q.path}?${q.query}; the reply, low/no-score, denylisted and future-dated casts dropped; ${casts.length} cast(s) in the value; ${live} live card(s) on /home; status ${sj}`;
  });
});

await check(`24b. THE HOUSE MISS COSTS ${HOUSE.creditsPerMiss} (4 × limit ${HOUSE.params.limit}, like the fids read): with FC_READ_DAILY_CREDITS=${HOUSE.creditsPerMiss} the status is live, the one miss is served by ONE pinned upstream GET, and the status then says budget`, async () => {
  need(houseArmed, "the house source did not arm (check 24) — a budget measured on an unarmed relay proves nothing");
  return withSide("house-cost", { ...sideHouseArgs(), FC_READ_DAILY_CREDITS: String(HOUSE.creditsPerMiss) }, async (app) => {
    const s1 = await relay(app.base, { op: "status" });
    statuses.push(["house, a 100-credit day", s1.json]);
    need(s1.json?.armed === true && s1.json?.state === "live", `before the miss the status is ${summary(s1.json)} (expected armed and live: the day must hold one miss)`);
    const d = await relay(app.base, { op: "discovery" });
    const st = await sideStub.state();
    const problems = [];
    if (d.status !== 200) problems.push(`the one miss a ${HOUSE.creditsPerMiss}-credit day holds answered ${d.status} ${summary(d.json)} — charged more than ${HOUSE.creditsPerMiss}?`);
    if (st.requests.length !== 1 || houseRequestProblems(st.requests[0], HOUSE_FID).length) problems.push(`the miss made ${st.requests.length} upstream request(s)${st.requests[0] ? " (" + houseRequestProblems(st.requests[0], HOUSE_FID).join("; ") + ")" : ""} (expected ONE pinned house GET)`);
    const s2 = await relay(app.base, { op: "status" });
    statuses.push(["house, the day spent", s2.json]);
    // "budget" = not even the cheapest miss fits any more: after one house miss on a 100-credit day that means it was
    // charged at least 99 — and it was served, so at most 100
    if (s2.json?.state !== "budget") problems.push(`after the one house miss the status is ${summary(s2.json)} (expected state budget: the miss should have spent ${HOUSE.creditsPerMiss} of ${HOUSE.creditsPerMiss} — charged less?)`);
    if (problems.length) throw new Error(problems.join(" | "));
    return `live → one pinned GET (${d.status}) → budget: the house miss is charged ${HOUSE.creditsPerMiss} credits`;
  });
});

await check(`24c. EXACTLY ONE SOURCE: ${DISC.fidsEnv} and ${HOUSE.env} both set → bad_config; neither set → bad_config — each with discovery 503 fc_read_unarmed, no hint in the page, ZERO stub calls, and a log line naming the variables, never a value`, async () => {
  // the precondition: each source ARMS alone on this key, base URL and stub — so bad_config here is the combination's
  need(rArmed, `the fids source did not arm on the lookup app (5b) — the same ${DISC.fidsEnv} must arm alone, or bad_config here proves nothing`);
  need(houseArmed, `the house source did not arm (check 24) — the same ${HOUSE.env} must arm alone, or bad_config here proves nothing`);
  const problems = [];
  const notes = [];
  await withSide("both-sources", { ...sideRelayArgs(), [HOUSE.env]: String(HOUSE_FID) }, async (app) => {
    const p = await badConfigProblems(app, "both set", { mustName: [DISC.fidsEnv, HOUSE.env], values: [[DISC.fidsEnv, SIDE_FIDS.join(",")], [HOUSE.env, String(HOUSE_FID)]] });
    problems.push(...p);
    if (!p.length) notes.push("both: bad_config, 0 upstream");
  });
  // neither: the key, the base and the rig switch arm the other apps; only the source is missing (sideEnv blanks both)
  await withSide("no-source", { NEYNAR_READ_API_KEY: sideStub.key, NEYNAR_READ_BASE_URL: sideStub.baseUrl, FC_READ_RIG: "stub" }, async (app) => {
    const p = await badConfigProblems(app, "neither set", { anyOf: [DISC.fidsEnv, HOUSE.env] });
    problems.push(...p);
    if (!p.length) notes.push("neither: bad_config, 0 upstream");
  });
  if (problems.length) throw new Error(problems.join(" | "));
  return notes.join("; ") + "; the log names the variables, never a value";
});

await check(`24d. A MALFORMED ${HOUSE.env} (zero; a leading zero; a list of fids; a username) → bad_config naming ${HOUSE.env}, never its value: discovery 503 fc_read_unarmed, no hint, ZERO stub calls`, async () => {
  need(houseArmed, `the house source did not arm on a well-formed ${HOUSE.env} (check 24) — a refusal of a malformed one proves nothing`);
  const problems = [];
  const notes = [];
  // the two mistakes an owner is likeliest to make — pasting several accounts, and pasting the account's name — and
  // the two spellings FID_ITEM exists to refuse (review: future-profile-unmeasured): zero, and a leading zero (one
  // account, one spelling). The rest of the malformed matrix runs in-process in check 25 (U6).
  for (const [label, value] of [["zero", "0"], ["a leading zero", `0${HOUSE_FID}`], ["a list", `${HOUSE_FID},${HOUSE_FID + 1}`], ["a username", "fcreadhousetypo"]]) {
    await withSide("house-malformed", { ...sideHouseArgs(), [HOUSE.env]: value }, async (app) => {
      // "0" appears in any app log by accident (ports, timings); for it the exact-line match below is the no-value check
      const p = await badConfigProblems(app, `${HOUSE.env} = ${label}`, { mustName: [HOUSE.env], exactLine: `[fc-read] unarmed: bad_config (${HOUSE.env})`, values: value.length >= 3 ? [[HOUSE.env, value]] : [] });
      problems.push(...p);
      if (!p.length) notes.push(`${label}: bad_config (${HOUSE.env}), 0 upstream`);
    });
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return notes.join("; ");
});
await resetSide().catch(() => {});

// FC-READ (house, review: house-pathcheck-untested): the refusals the side apps cannot see. The relay only ever builds
// the one correct path, so checks 24 and 5 look at a request that was always going to pass; the path check's own
// refusals, and the full malformed-source matrix, are measured by calling the relay's code directly
await check("25. THE RELAY'S OWN CHECKS (scripts/unit-fcread-relay.mjs, in-process): every other following shape refused in house mode, none admitted in list mode, the house path for discovery only, malformed / both / neither sources bad_config with zero fetches, and each source's one request", async () => {
  const r = spawnSync(process.execPath, [path.join("scripts", "unit-fcread-relay.mjs")], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = /(\d+)\/(\d+) fc-read unit checks passed/.exec(out);
  need(m, "the unit harness printed no total (exit " + r.status + "): " + out.trim().split(/\r?\n/).slice(-3).join(" / ").slice(0, 300));
  const failed = out.split(/\r?\n/).filter((l) => /^\s*FAIL\s/.test(l)).map((l) => l.trim().slice(0, 140));
  if (r.status !== 0 || m[1] !== m[2] || failed.length) throw new Error(`${m[1]}/${m[2]} (exit ${r.status}): ${failed.join(" | ")}`);
  need(Number(m[2]) >= 8, `the unit harness ran only ${m[2]} check(s) — it has lost some`);
  return `${m[1]}/${m[2]} unit checks passed`;
});

// ================================================================ what went upstream, and where the key went
await check("5. UPSTREAM DISCIPLINE over everything both stubs saw: no violation, raw queries recorded, every endpoint exercised, no viewer_fid/cursor/provider, fid only a resolved one on user-casts, never a device's pseudo-fid, never notifications, no following feed but the pinned house request, never a channel feed, every discovery read the decided one, the pair's reads from the source it was started with", async () => {
  const main = await mainStub.state();
  const all = [...main.requests.map((r) => ({ ...r, src: "pair" })), ...sideLog.requests];
  const violations = [...main.violations.map((v) => ({ ...v, src: "pair" })), ...sideLog.violations.map((v) => ({ ...v, src: "side" }))];
  // GAP 4: a stub that ignored query strings would make every "no fid upstream" claim vacuous
  // FC-READ (no channels): the discovery endpoint is now /feed with a fids filter (never /feed/channels)
  need(all.some((r) => r.route === DISC.route && new RegExp("(^|&)" + DISC.fidsParam + "=").test(r.query)), "no raw query string was recorded for the discovery read (" + DISC.route + " with " + DISC.fidsParam + "=)");
  const routes = new Set(all.map((r) => r.route));
  const missing = [DISC.route, "/cast/conversation", "/user/by_username", "/feed/user/casts"].filter((r) => !routes.has(r));
  // FC-READ (house): the house source's one endpoint is a relay endpoint too (check 24's side app reads it)
  const isPinnedHouse = (r) => houseRequestProblems(r, HOUSE_FID).length === 0;
  if (!all.some(isPinnedHouse)) missing.push(`the house feed (${HOUSE.path}, pinned)`);
  need(!missing.length, "these relay endpoints were never exercised, so nothing was measured about them: " + missing.join(", "));
  const problems = [];
  if (violations.length) problems.push(violations.length + " stub violation(s): " + violations.slice(0, 6).map((v) => `${v.src} ${v.kind} ${v.route}${v.detail ? " (" + v.detail + ")" : ""}`).join("; "));
  for (const r of all) {
    for (const p of ["viewer_fid", "cursor", "provider"]) if (p in r.params) problems.push(`${r.src} ${r.route} carried ${p}`);
    if (/^\/notifications/.test(r.route)) problems.push(`${r.src} called ${r.route}`);
    // FC-READ (house): a following feed is allowed as the pinned house request ONLY — the house fid, with_recasts=false,
    // limit=25 on /feed/following/, nothing else; any other (another fid, a viewer's, the /feed/ spelling) is a problem
    const following = isFollowingFeedRequest(r.route, r.params);
    if (following && !isPinnedHouse(r)) problems.push(`${r.src} read a following feed that is not the pinned house request (${houseRequestProblems(r, HOUSE_FID).join("; ")})`);
    // FC-READ (no channels): /feed IS the fids discovery read — and only ever the decided one (a following feed on that
    // pathname is reported above; any other filter is a problem, as is a channel feed by any path)
    if (r.route === DISC.route && !following) {
      const bad = discoveryParamProblems(r.params);
      if (bad.length) problems.push(`${r.src} ${r.route}?${r.query.slice(0, 80)}: ${bad.join("; ")}`);
    }
    if (isChannelFeedRequest(r.route, r.params)) problems.push(`${r.src} read a channel feed (${r.route}) — channels are not a v1 emphasis`);
    if ("fid" in r.params && r.route !== "/feed/user/casts" && !isPinnedHouse(r)) problems.push(`${r.src} ${r.route} carried a fid`);
    if (!r.keyOk) problems.push(`${r.src} ${r.route} without the fake key`);
  }
  // a fid on user-casts only when an earlier by_username lookup in the same log resolved it
  for (const log of [main.requests, sideLog.requests]) {
    for (let i = 0; i < log.length; i++) {
      const r = log[i];
      if (r.route !== "/feed/user/casts") continue;
      const resolved = log.slice(0, i).some((x) => x.route === "/user/by_username" && x.answeredFid === Number(r.params.fid));
      if (!resolved) problems.push(`/feed/user/casts carried fid ${r.params.fid}, which no earlier by_username lookup resolved`);
    }
  }
  const fids = [...deviceFids].filter((f) => Number.isInteger(f) && f !== 0);
  need(fids.length > 0, "no device fid was recorded from the browsers — the pseudo-fid check would be vacuous");
  for (const f of fids) {
    // the pseudo-fid is negative (lib/device/boot.ts pseudoFid); its magnitude is checked too when it is too large to
    // collide with a real account's fid by chance
    for (const token of [String(f), ...(Math.abs(f) >= 1_000_000 ? [String(Math.abs(f))] : [])]) {
      const re = new RegExp(`(^|[=,&])${token.replace("-", "\\-")}(&|,|$)`);
      const hit = all.find((r) => re.test(r.query));
      if (hit) problems.push(`a device's pseudo-fid ${f} rode ${hit.route}`);
    }
  }
  // FC-READ (house): the pair read discovery from the source it was started with (run-prod-shape.sh passes
  // PRODLIVE_FC_READ_SOURCE in stub mode) — never the other one, and never both
  const pairReads = main.requests.filter(isDiscoveryRead);
  const pairHouse = pairReads.filter(isPinnedHouse).length;
  const pairFids = pairReads.filter((r) => r.route === DISC.route && !isFollowingFeedRequest(r.route, r.params)).length;
  const pairSeen = pairHouse && pairFids ? "both" : pairHouse ? "house" : pairFids ? "fids" : "none";
  if (pairSeen === "both") problems.push(`the pair read discovery from BOTH sources (${pairFids} fids, ${pairHouse} house) — exactly one may be configured`);
  if (PAIR_SOURCE) {
    need(pairReads.length > 0, "the pair made no discovery read upstream (check 2) — its source cannot be measured");
    if (pairSeen !== PAIR_SOURCE) problems.push(`the pair was started with PRODLIVE_FC_READ_SOURCE=${PAIR_SOURCE}, but its discovery reads were ${pairSeen} (${pairFids} fids, ${pairHouse} house) — was the pair restarted with --no-restart under another source?`);
  }
  if (problems.length) throw new Error([...new Set(problems)].slice(0, 8).join(" | "));
  const srcNote = PAIR_SOURCE ? `the pair read the ${PAIR_SOURCE} source (${pairReads.length} discovery miss(es))` : `the pair's discovery source: ${pairSeen} (PRODLIVE_FC_READ_SOURCE unset: not asserted)`;
  return `${all.length} upstream request(s) across ${routes.size} endpoint(s), 0 violations; the house request only as pinned; ${srcNote}; ${fids.length} device pseudo-fid(s) absent`;
});

await check("4. THE KEY NEVER LEAVES THE SERVER: not in /home, /explore or /device HTML, the RSC payload, device.js, the device env, any relay body, the app log or .next/static; device.js names neither NEYNAR_READ_API_KEY nor readRelay", async () => {
  need(MAIN_KEY.startsWith(STUB_KEY_PREFIX) && MAIN_KEY.length >= 16, "no fake key to look for");
  const texts = [];
  const add = (label, t, control) => {
    need(typeof t === "string" && t.length > 0, label + " is empty — scanning it would prove nothing");
    if (control) need(control.test(t), label + " lacks " + control + " — it is not the text this check means to scan");
    texts.push([label, t]);
  };
  add("/home HTML", (await get(BASE + "/home")).text, /KEYSTORE_DIR/);
  add("/home RSC payload", (await get(BASE + "/home", { headers: { RSC: "1" } })).text);
  add("/explore HTML", (await get(BASE + "/explore")).text);
  add("/device HTML", (await get(BASE + "/device")).text, /KEYSTORE_DIR/);
  const served = await get(BASE + "/device/device.js");
  add("device.js (served)", served.text, /\/api\/fc\/read/);
  const file = path.join("public", "device", "device.js");
  need(existsSync(file), "public/device/device.js does not exist (build first)");
  add("device.js (file)", readFileSync(file, "latin1"));
  add("relay bodies", relayBodies.join("\n"), new RegExp(STUB_MARKERS.media));
  add("the page's device env", JSON.stringify(A?.env ?? {}), /FC_READ_RELAY/);
  const log = path.join(process.env.TEMP || process.env.TMP || tmpdir(), "layers-app.log");
  need(existsSync(log), "the pair's app log is not at " + log);
  add("the pair's app log", readFileSync(log, "latin1"), /\[fc-read\] armed/);
  const walk = (dir, out = []) => { if (!existsSync(dir)) return out; for (const e of readdirSync(dir)) { const p = path.join(dir, e); const s = statSync(p); if (s.isDirectory()) walk(p, out); else if (s.size < 20 * 1024 * 1024) out.push(p); } return out; };
  const statics = walk(path.join(".next", "static"));
  need(statics.length > 0, ".next/static is empty (build first)");
  add(".next/static", statics.map((f) => readFileSync(f, "latin1")).join("\n"));
  const problems = [];
  for (const [label, t] of texts) if (t.includes(MAIN_KEY)) problems.push("the key is in " + label);
  const dj = texts.find(([l]) => l === "device.js (file)")[1];
  for (const n of ["NEYNAR_READ_API_KEY", "readRelay"]) if (dj.includes(n) || served.text.includes(n)) problems.push("device.js contains " + n);
  if (sideStub) {
    for (const [label, out, key] of sideOutputs) {
      if (!key) continue;
      if (out().includes(key)) problems.push(`the ${label} side app's output printed its key`);
      if (relayBodies.some((b) => b.includes(key))) problems.push(`a relay body carried the ${label} side app's key`);
    }
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return `${texts.length} texts scanned (${Math.round(texts.reduce((n, [, t]) => n + t.length, 0) / 1024)} KB), the key in none; device.js clean of the key's name and the relay module`;
});

await check("19. THE STATUS OP IS PUBLIC-SAFE on every app measured: documented fields only, no number, never the key", async () => {
  need(statuses.length >= 3, "only " + statuses.length + " status answer(s) were collected");
  need(statuses.some(([, j]) => j?.armed === true) && statuses.some(([, j]) => j?.state === "budget"), "no armed or budget-spent status was collected — the fields most likely to carry a number were not seen");
  const keys = [MAIN_KEY, ...sideOutputs.map(([, , k]) => k).filter(Boolean)];
  const problems = [];
  for (const [label, j] of statuses) {
    const p = statusProblems(j);
    for (const k of keys) if (JSON.stringify(j ?? {}).includes(k)) p.push("THE KEY");
    if (p.length) problems.push(`${label}: ${p.join(", ")}`);
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return statuses.map(([l, j]) => `${l}: ${j.reason}/${j.state}`).join("; ");
});

// ---------------------------------------------------------------- done
await browser.close().catch(() => {});
if (sideStub) await sideStub.close().catch(() => {});
for (const c of sideChildren) killTree(c);
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} fc-read checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
