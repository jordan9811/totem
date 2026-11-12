import { NextResponse, type NextRequest } from "next/server";
import { MAINTENANCE_HTML, MAINTENANCE_RETRY_AFTER_SECONDS, maintenanceEnabled } from "@/lib/platform/maintenance";
import { isDocsPath } from "@/lib/platform/preview";
import { MANIFEST_PATH, anonPagePolicy, canonicalHostRedirect, isAnonPagePath } from "@/lib/miniapp/manifest";
import { isPublicLive } from "@/lib/platform/publicLive";
import {
  OWNER_COOKIE,
  OWNER_INTERNAL_HEADER,
  OWNER_LOGIN_API,
  OWNER_LOGIN_PATH,
  OWNER_PASSKEY_OPTIONS_API,
  OWNER_PASSKEY_VERIFY_API,
  OWNER_SECURITY_API,
  OWNER_STATE_API,
  ownerInternalToken,
  ownerInternalTokenOk,
  OWNER_LOGIN_ERRORS,
  ownerSessionLive,
  parseOwnerGateState,
  publicOrigin,
  readOwnerCookie,
  readOwnerSecret,
  safeNextPath,
  type OwnerGateState,
  type OwnerSession,
} from "@/lib/platform/owner-access";

// BROWSER KEYSTORE PASS Gate 4 — rate limiting on every API route of the app server (the previous pass's Gates 3
// and 5 assumed it existed; it did not). A token bucket per client address, in this process's memory: 200 requests
// of burst, refilled at 3 per second, and a 429 with Retry-After beyond that. The rig (ZK_DEV_HOOKS=true) is exempt
// — its suites hammer one address on purpose. Per-instance by design (A-CU-4-RATE-LIMIT-PER-INSTANCE): a deployment
// with several instances multiplies the budget by their number, which is still a budget.
const CAPACITY = 200;
const REFILL_PER_SECOND = 3;

// PROD-LIVE (D-PRODLIVE-OWNER-SERVICE): the same token bucket, parameterised, so the owner login can have a much
// tighter budget of its own. Each limiter forgets an idle bucket only after it would have refilled completely —
// forgetting it sooner would hand an attacker a full bucket for waiting.
function limiter(capacity: number, refillPerSecond: number) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  const idleMs = Math.max(120_000, Math.ceil((capacity / refillPerSecond) * 1000));
  let sweptAt = Date.now();
  return function take(key: string, now: number): { ok: boolean; retryAfterSeconds: number } {
    if (now - sweptAt > 60_000) {
      for (const [k, b] of buckets) if (now - b.at > idleMs) buckets.delete(k);
      sweptAt = now;
    }
    const b = buckets.get(key) ?? { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSecond);
    b.at = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      buckets.set(key, b);
      return { ok: true, retryAfterSeconds: 0 };
    }
    buckets.set(key, b);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / refillPerSecond)) };
  };
}
const take = limiter(CAPACITY, REFILL_PER_SECOND);
/** PERSONA LAUNCH GO-LIVE: the folder prover.js's source offer is served from (scripts/lib/gpl-source.mjs OFFER_URL, without
 *  its slash — a DELIBERATE DUPLICATE: this middleware is its own bundle; scripts/unit-prover.mjs G8 pins the two) */
const SOURCE_OFFER_PATH = "/device/source";
// PROD-LIVE: owner login attempts — 10 per address, refilled one a minute; and 30 across ALL addresses, refilled one
// every ten seconds, so rotating addresses (or a spoofed forwarding header) buys no more guesses. At most ~360
// guesses an hour against a passphrase the runbook makes 32 random bytes long. The global bucket can be drained to
// lock the login out for a while; a session already issued keeps working, which is the trade taken.
const takeLoginPerAddress = limiter(10, 1 / 60);
const takeLoginGlobal = limiter(30, 1 / 10);
// OWNER PASSKEYS (D-OWNER-PASSKEYS): the two exempt passkey routes are metered exactly like the passphrase route —
// the same shape, buckets of their own (a sign-in takes two requests, and a cancelled Face ID prompt must not spend
// the passphrase fallback's budget)
const takePasskeyPerAddress = limiter(10, 1 / 60);
const takePasskeyGlobal = limiter(30, 1 / 10);
/** every path the gate admits WITHOUT a session, each an EXACT string, with the budget its POSTs spend */
const METERED_EXEMPT = new Map<string, readonly [ReturnType<typeof limiter>, ReturnType<typeof limiter>]>([
  [OWNER_LOGIN_API, [takeLoginGlobal, takeLoginPerAddress]],
  [OWNER_PASSKEY_OPTIONS_API, [takePasskeyGlobal, takePasskeyPerAddress]],
  [OWNER_PASSKEY_VERIFY_API, [takePasskeyGlobal, takePasskeyPerAddress]],
]);

/**
 * PERSONA LAUNCH GO-LIVE (A-WEB-PROXY-HOP-HEADERS) — the address the platform's EDGE vouches for, never one the client
 * wrote. The left-most X-Forwarded-For entry is whatever the client sent (an edge that appends keeps it), so keying on
 * it let one client pick a fresh bucket per request. Railway documents X-Real-IP as the client's address, set by its
 * edge: its RIGHT-most entry is taken (should a client's own copy ever survive beside the edge's, Node joins the two and
 * the edge's comes last). Without it, the RIGHT-most X-Forwarded-For entry: the hop the nearest proxy appended. Empty
 * entries are skipped. DELIBERATE DUPLICATE of validator/caps.js edgeClientAddress (scripts/unit-prover.mjs G9 runs both
 * over the same cases, a forged left-most entry included).
 */
function lastListEntry(v: string | null | undefined): string {
  const parts = String(v ?? "").split(",");
  for (let i = parts.length - 1; i >= 0; i--) {
    const s = parts[i].trim();
    if (s) return s;
  }
  return "";
}
function edgeForwardedAddress(headers: Headers): string | null {
  return lastListEntry(headers.get("x-real-ip")) || lastListEntry(headers.get("x-forwarded-for")) || null;
}

function clientAddress(req: NextRequest): string {
  // attack-custody-1 #6 / -2 #7 / -3 #6: a forwarding header is honoured only behind a configured proxy
  // (TRUST_PROXY=true); otherwise the platform's own address or, self-hosted with no proxy, one shared budget
  // (A-CU-5-TRUST-PROXY: set it behind the reverse proxy the deployment actually has). PERSONA LAUNCH GO-LIVE: and then
  // only the hop the edge vouches for (edgeForwardedAddress above), never the client-written left-most entry
  const forwarded = process.env.TRUST_PROXY === "true" ? edgeForwardedAddress(req.headers) : null;
  // FC-READ (review, cost-abuse-3): normalised (addressKeyOf below), so an IPv6 /64 is one bucket here as in the
  // relay. An IPv4 address keys exactly as before, and no address at all stays "local" — with TRUST_PROXY unset (the
  // rig and every local suite) nothing changes.
  const raw = req.ip || forwarded;
  return raw ? addressKeyOf(raw) : "local";
}

// FC-READ (review, cost-abuse-3) — the per-address KEY, not the raw address string. The three functions below are
// IDENTICAL in app/api/fc/read/route.ts (this middleware is its own bundle; the unit harness checks the two copies match):
//   * IPv4 ("a.b.c.d", or "a.b.c.d:port") -> "a.b.c.d", as before
//   * IPv6 -> its /64 ("2001:db8:1:2::/64"): a subscriber's prefix is one bucket, however many of its 2^64
//     addresses it rotates through (it used to be a fresh bucket per address, even behind an honest edge)
//   * IPv4-mapped IPv6 ("::ffff:a.b.c.d") -> "a.b.c.d", the same bucket as the plain IPv4
//   * anything unparseable -> one shared "unknown" bucket, so a junk forwarding value buys no fresh buckets
function addressKeyOf(raw: string): string {
  let s = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\](?::\d{1,5})?$/.exec(s);
  if (bracketed) s = bracketed[1];
  else {
    const withPort = /^([0-9.]+):\d{1,5}$/.exec(s);
    if (withPort) s = withPort[1];
  }
  const v4 = ipv4Octets(s);
  if (v4) return v4.join(".");
  const v6 = ipv6Groups(s.replace(/%[0-9a-z._~-]+$/, ""));
  if (!v6) return "unknown";
  if (v6[0] === 0 && v6[1] === 0 && v6[2] === 0 && v6[3] === 0 && v6[4] === 0 && v6[5] === 0xffff) {
    return [v6[6] >> 8, v6[6] & 255, v6[7] >> 8, v6[7] & 255].join(".");
  }
  return v6.slice(0, 4).map((g) => g.toString(16)).join(":") + "::/64";
}

function ipv4Octets(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

function ipv6Groups(s: string): number[] | null {
  if (s.length < 2 || s.length > 45 || !/^[0-9a-f:.]+$/.test(s)) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string, last: boolean): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const segs = part.split(":");
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (last && i === segs.length - 1 && seg.includes(".")) {
        const o = ipv4Octets(seg);
        if (!o) return null;
        out.push((o[0] << 8) | o[1], (o[2] << 8) | o[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(seg)) out.push(parseInt(seg, 16));
      else return null;
    }
    return out;
  };
  const head = parse(halves[0], halves.length === 1);
  const tail = halves.length === 2 ? parse(halves[1], true) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  return fill >= 1 ? [...head, ...new Array<number>(fill).fill(0), ...tail] : null;
}

// FC-READ (review, key-custody-1): no DOCUMENT of this app may be framed by another site. A framed preview page runs
// the device, and the device spends the live-read budget for the visitor — so without this, any site could make its
// visitors' browsers spend it by framing /<fname>/status/<hash> pages (the relay's custom header and Sec-Fetch-Site
// check stop only DIRECT requests). frame-ancestors 'none' is the standard control; X-Frame-Options: DENY covers
// browsers without CSP level 2. Set on every non-API response this middleware lets through or makes (pages, the
// device's static files, the maintenance page, the owner login redirect) — on the rig and the owner service as
// well, where it is harmless: nothing in app/, components/, lib/, public/ or scripts/ frames a page (the device smoke
// page is a top-level navigation). A JSON API answer is not a document and is left as it was.
// DOCS UNDER APP: the one exception is a /docs response the docs route makes itself — it carries its own complete
// policy, frame-ancestors 'none' included (see the isDocsPath branch in middleware() below).
const FRAME_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["content-security-policy", "frame-ancestors 'none'"],
  ["x-frame-options", "DENY"],
];
function unframeable<T extends Response>(res: T): T {
  for (const [k, v] of FRAME_HEADERS) res.headers.set(k, v);
  return res;
}

// PUBLIC GO-LIVE (the native anon page + the Farcaster Mini App) — THE ONE FRAMING EXCEPTION. /anon and /anon/p/<hash>
// open inside Farcaster as a Mini App, which on the web is an iframe on the Farcaster client's own origin, so these two
// documents (and ONLY these: lib/miniapp/manifest.ts isAnonPagePath, an exact path or one segment under /anon/p/) carry
// frame-ancestors naming the Farcaster web client's origins (FRAME_ANCESTORS) instead of 'none', and no X-Frame-Options
// (it cannot name an allowed framer, and DENY beside an allowlist would block the Mini App in browsers that honour it).
// The same header is the page's whole content security policy: scripts, styles and fonts from this origin only, images
// from this origin and the Totem app's media hosts (F14: "Open Totem" is a soft navigation, so the app's session runs
// in this document under this policy), connections to this origin, the validator and the sign-in services the page
// names before its first request (anonPagePolicy). Every other document keeps unframeable() above — /home and /welcome are never frameable — and a
// redirect, the maintenance page or the owner gate's answer for /anon stays unframeable too (they are made before this).
// Built once per process: it reads only the environment, which does not change while the server runs.
let anonPolicy: string | null = null;
function anonFramed<T extends Response>(res: T): T {
  anonPolicy ??= anonPagePolicy(process.env);
  res.headers.set("content-security-policy", anonPolicy);
  res.headers.delete("x-frame-options");
  return res;
}

function limited(retryAfterSeconds: number, error = "rate limited") {
  return NextResponse.json({ error, retryAfterSeconds }, { status: 429, headers: { "retry-after": String(retryAfterSeconds), "cache-control": "no-store" } });
}

/** OWNER PASSKEYS (review UX-8): a spent sign-in budget. A browser's FORM post to the passphrase route (anything that
 *  is not JSON — the route's own rule) gets the sign-in page back, 303 to /owner-login?error=busy with the form's own
 *  `next`, so the owner reads "Too many tries" there instead of a raw JSON page; every other caller (the scripts, the
 *  passkey routes' fetches) gets the 429 JSON as before. Nothing here spends or refunds a token. */
async function tooManyLogins(req: NextRequest, path: string, retryAfterSeconds: number): Promise<NextResponse> {
  const ctype = (req.headers.get("content-type") ?? "").toLowerCase();
  if (path !== OWNER_LOGIN_API || ctype.includes("application/json")) return limited(retryAfterSeconds, "too many login attempts");
  let next = "/home";
  try {
    // only a body that declares a small length is read (a browser's form always does); a chunked one is not
    const declared = Number(req.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared <= 8192) {
      const text = await req.text();
      if (text.length <= 8192) next = safeNextPath(new URLSearchParams(text).get("next"));
    }
  } catch {
    next = "/home";
  }
  const to = new URL(OWNER_LOGIN_PATH, publicOrigin(req.headers));
  to.searchParams.set("error", OWNER_LOGIN_ERRORS.busy);
  to.searchParams.set("next", next);
  const res = NextResponse.redirect(to, 303);
  res.headers.set("cache-control", "no-store");
  res.headers.set("retry-after", String(retryAfterSeconds));
  return res;
}

// ------------------------------------------------------------------------------------------------ the gate's state
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — a session is live only in the server's CURRENT epoch and, for a passkey
// session, while that passkey is still registered. That state lives on the owner app's volume, and this middleware
// runs in the Edge sandbox, which cannot read a file — so it asks the server it runs inside: GET OWNER_STATE_API over
// the server's own loopback, with a header token derived from the passphrase (the route answers nobody else, and the
// gate admits that exact path without a session only with the token). The answer — the epoch and the live passkey
// slot ids, opaque random values — is cached for a moment and shared by concurrent requests:
//   * the cache is trusted for GATE_STATE_TTL_MS at most; a session the cache calls dead is re-checked against a
//     FRESH read before it is turned away (so a just-written state — the first sign-in ever, a new epoch — never
//     bounces the owner), at most once per GATE_STATE_RECHECK_MS, so a revoked cookie cannot make reads on demand
//   * an ADMITTED POST to the Security route (the one route that changes the gate's state: a new epoch, a passkey
//     added or removed) drops the cache and keeps it off for a while, so "sign out everywhere" and "remove passkey"
//     take effect on the very next request, not after the TTL. Only a live owner session can trigger it.
//   * a read that fails is retried once; then the request is REFUSED with a 503 — never admitted on a guess
// Only a request whose cookie already verifies (its MAC, its expiry) ever causes a read: a stranger's junk cookie
// costs nothing. On the rig and the public preview (no OWNER_ACCESS_SECRET) none of this runs.
const GATE_STATE_TTL_MS = 2_000;
const GATE_STATE_RECHECK_MS = 250;
const GATE_STATE_DIRTY_MS = 10_000;
const GATE_STATE_TIMEOUT_MS = 2_500;
let gateCache: { value: OwnerGateState; at: number } | null = null;
let gateRead: { promise: Promise<{ value: OwnerGateState; at: number }>; startedAt: number } | null = null;
let gateDirtySince = 0;
let gateDirtyUntil = 0;
let gateFailureLoggedAt = 0;

function markGateStateDirty(now: number): void {
  gateCache = null;
  gateDirtySince = now;
  gateDirtyUntil = now + GATE_STATE_DIRTY_MS;
}

/** the server's own listener, over plain http on loopback: req.nextUrl names it (next start builds the middleware's
 *  URL from its own hostname and port — and from x-forwarded-proto, which is why the scheme is NOT taken from it) */
function internalOrigin(req: NextRequest): string {
  const u = req.nextUrl;
  const h = u.hostname.replace(/^\[|\]$/g, "");
  const host = h === "" || h === "localhost" || h === "0.0.0.0" || h === "::" ? "127.0.0.1" : h.includes(":") ? `[${h}]` : h;
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  return `http://${host}:${port}`;
}

async function readGateStateOnce(url: string, token: string): Promise<OwnerGateState> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GATE_STATE_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { [OWNER_INTERNAL_HEADER]: token, accept: "application/json" }, signal: ac.signal });
    if (r.status !== 200) throw new Error("the state route answered " + r.status);
    const state = parseOwnerGateState(await r.json());
    if (!state) throw new Error("the state route answered a malformed state");
    return state;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGateState(req: NextRequest, secret: string): Promise<OwnerGateState> {
  const url = internalOrigin(req) + OWNER_STATE_API;
  const token = await ownerInternalToken(secret);
  try {
    return await readGateStateOnce(url, token);
  } catch {
    await new Promise((r) => setTimeout(r, 100));
    return readGateStateOnce(url, token);
  }
}

/** the gate's state, from the cache when it may be trusted, else from one read shared with every concurrent request
 *  that may join it (a read that began before the cache was distrusted is never joined); null when it cannot be read */
async function gateState(req: NextRequest, secret: string, now: number, force: boolean): Promise<{ value: OwnerGateState; at: number } | null> {
  const dirty = now < gateDirtyUntil;
  if (!force && !dirty && gateCache && now - gateCache.at < GATE_STATE_TTL_MS) return gateCache;
  const notBefore = force ? now : dirty ? gateDirtySince : 0;
  let read = gateRead;
  if (!read || read.startedAt < notBefore) {
    const startedAt = Date.now();
    const promise = fetchGateState(req, secret).then((value) => {
      const fresh = { value, at: startedAt };
      if (!gateCache || gateCache.at <= startedAt) gateCache = fresh;
      return fresh;
    });
    const entry = { promise, startedAt };
    read = entry;
    gateRead = entry;
    const done = () => {
      if (gateRead === entry) gateRead = null;
    };
    promise.then(done, done);
  }
  try {
    return await read.promise;
  } catch (e) {
    if (now - gateFailureLoggedAt > 60_000) {
      gateFailureLoggedAt = now;
      console.error("[owner-gate] the gate's state could not be read; sessions are refused until it can (" + ((e as Error)?.message ?? "error") + ")");
    }
    return null;
  }
}

/** live, dead, or undecidable (the state could not be read). A "dead" verdict is never taken from a stale cache. */
async function sessionVerdict(req: NextRequest, secret: string, session: OwnerSession, now: number): Promise<"live" | "dead" | "unavailable"> {
  let state = await gateState(req, secret, now, false);
  if (!state) return "unavailable";
  if (ownerSessionLive(session, state.value)) return "live";
  if (now - state.at > GATE_STATE_RECHECK_MS) {
    state = await gateState(req, secret, Date.now(), true);
    if (!state) return "unavailable";
    if (ownerSessionLive(session, state.value)) return "live";
  }
  return "dead";
}

const GATE_UNAVAILABLE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Totem — one moment</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0f1419;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}main{max-width:420px;padding:24px}h1{font-size:23px;margin:0 0 8px}p{color:#536471;font-size:15px;line-height:20px;margin:0}</style></head><body><main><h1>One moment</h1><p>The owner service could not check your sign-in just now. Reload the page in a few seconds.</p></main></body></html>`;

function gateUnavailable(path: string): NextResponse {
  const headers = { "retry-after": "5", "cache-control": "no-store" };
  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "the owner sign-in check is unavailable right now; try again in a moment", code: "owner_gate_unavailable" }, { status: 503, headers });
  }
  return new NextResponse(GATE_UNAVAILABLE_HTML, { status: 503, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

/**
 * PROD-LIVE (D-PRODLIVE-OWNER-SERVICE) — THE OWNER ACCESS GATE. When OWNER_ACCESS_SECRET is set, every page and every
 * route answers only to a request carrying a LIVE owner session cookie (issued by POST /api/owner-login after a
 * constant-time passphrase check, or by POST /api/owner-login/passkey/verify after a verified Face ID / fingerprint
 * assertion). Exempt: liveness (the platform's health check and the signed health probe), the login page, the
 * passphrase route and the two passkey sign-in routes (metered), the internal state route (only with its token), and
 * the static icon the login page shows. Pages redirect to the login page; routes answer 401 JSON. Returns null when
 * the request may proceed.
 *
 * Why it exists: the owner service is a rig-shaped deployment (the server holds the owner's keystore, so its personas
 * can hold real Farcaster accounts). Without this gate that URL would be notes/runbooks/PREVIEW-READINESS.md §1 exactly — "every
 * visitor IS the owner". With it, the URL is the "single-tester demo behind an access secret" that document names
 * as the only honest shared-identity form. On the rig laptop and the public preview the variable is unset and
 * nothing below runs.
 */
async function ownerGate(req: NextRequest, path: string): Promise<NextResponse | null> {
  const secret = readOwnerSecret();
  if (!secret) return null;
  const now = Date.now();
  // PROD-LIVE (review: the matcher's unanchored exclusion): every exemption in this gate is an EXACT path, never a
  // prefix — /owner-loginX, /icon.svgX, /api/healthX, /api/owner-loginX, /api/owner-login/passkey/optionsX,
  // /api/owner-login/passkey/options/ and /api/owner-login/passkey are all gated (checked by running this middleware
  // against them: 303 for pages, 401 for routes)
  const budget = METERED_EXEMPT.get(path);
  if (budget) {
    // reachable without a session — and metered, whatever the rig flag says
    if (req.method === "POST") {
      const [global, perAddress] = budget;
      const g = global("*", now);
      if (!g.ok) return tooManyLogins(req, path, g.retryAfterSeconds);
      const mine = perAddress(clientAddress(req), now);
      if (!mine.ok) return tooManyLogins(req, path, mine.retryAfterSeconds);
    }
    return null;
  }
  // the middleware's own read of the gate's state: admitted only with the token (without it, gated like any path)
  if (path === OWNER_STATE_API && (await ownerInternalTokenOk(req.headers.get(OWNER_INTERNAL_HEADER), secret))) return null;
  if (path === OWNER_LOGIN_PATH || path === "/icon.svg") return null;
  // a secret too short to be a passphrase keeps the gate SHUT (the login route refuses it; the boot check refuses to
  // start with it) — fail closed, never open
  const session = await readOwnerCookie(req.cookies.get(OWNER_COOKIE)?.value, secret);
  if (session) {
    const verdict = await sessionVerdict(req, secret, session, now);
    if (verdict === "live") {
      // the owner is about to change the gate's state: stop trusting the cached copy (see the cache's note above)
      if (req.method === "POST" && path === OWNER_SECURITY_API) markGateStateDirty(Date.now());
      return null;
    }
    if (verdict === "unavailable") return gateUnavailable(path);
  }
  if (path.startsWith("/api/")) {
    return NextResponse.json(
      { error: "owner login required", code: "owner_login_required", login: OWNER_LOGIN_PATH },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }
  // absolute, on the owner's own origin: behind the platform's proxy req.nextUrl names the internal listener
  const to = new URL(OWNER_LOGIN_PATH, publicOrigin(req.headers));
  to.searchParams.set("next", path + (req.nextUrl.search || ""));
  const res = NextResponse.redirect(to, 303);
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // PUBLIC PREVIEW Gate 5 (D-CU-6-THE-KILL-SWITCH-IS-AN-ENVIRONMENT-FLAG): one variable puts the whole app into a
  // static maintenance state — no data, no device, no validator call — without a rebuild. Liveness still answers, so
  // the platform and the health probe can tell "paused on purpose" from "down".
  if (maintenanceEnabled() && path !== "/api/health") {
    const retry = String(MAINTENANCE_RETRY_AFTER_SECONDS);
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "maintenance", retryAfterSeconds: MAINTENANCE_RETRY_AFTER_SECONDS }, { status: 503, headers: { "retry-after": retry, "cache-control": "no-store" } });
    }
    return unframeable(new NextResponse(MAINTENANCE_HTML, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": retry, "cache-control": "no-store" } }));
  }
  // liveness is never gated and never throttled: the platform's health check carries no cookie
  if (path === "/api/health") return NextResponse.next();
  // PUBLIC GO-LIVE (F6): ONE PUBLIC ADDRESS. On the live public site a page request on any host but APP_URL's (the
  // platform's own *.up.railway.app address, after the domain move) is sent to the same path and query on APP_URL: a
  // passkey saved on the old address binds to it, and the validator refuses a sign-in for it, so a page used there is
  // broken in ways nobody can see. GET/HEAD pages only, never /api/*; loopback and the platform's private network are never
  // redirected (lib/miniapp/manifest.ts canonicalHostRedirect says why). Off on the preview, the rig and the owner service.
  const canonical = canonicalHostRedirect({
    live: isPublicLive(),
    appUrl: process.env.APP_URL,
    method: req.method,
    path,
    search: req.nextUrl.search,
    host: req.headers.get("host"),
    forwardedHost: req.headers.get("x-forwarded-host"),
  });
  if (canonical) {
    const res = NextResponse.redirect(canonical, 308);
    res.headers.set("cache-control", "no-store");
    return unframeable(res);
  }
  // PROD-LIVE (D-PRODLIVE-OWNER-SERVICE): the owner gate, ahead of everything the page or route would do
  const gated = await ownerGate(req, path);
  if (gated) return path.startsWith("/api/") ? gated : unframeable(gated);
  // PERSONA LAUNCH GO-LIVE (A-GPL-SOURCE-OFFER): the browser prover's GPL-3.0 source offer is a static folder
  // (public/device/source/, written by scripts/build-device.mjs on every build). Next's static server answers a file by
  // its name but never a folder's index, so the folder's own address — with or without its slash: prover.js's banner and
  // Help link the slash form — is served the notice page. AFTER the owner gate (the owner service gates it like every
  // path) and BEFORE the trailing-slash redirect (which would otherwise strip the slash and find nothing).
  if (path === SOURCE_OFFER_PATH || path === SOURCE_OFFER_PATH + "/") return unframeable(NextResponse.rewrite(new URL(SOURCE_OFFER_PATH + "/index.html", req.url)));
  // DOCS UNDER APP (D-DOCS-UNDER-APP): next.config.mjs turns off Next's built-in "/x/ -> /x" redirect, because the
  // docs' section pages live at a trailing slash; it is done here instead, for every path but the docs. AFTER the
  // owner gate on purpose: the gate's exemptions are exact strings, so "/owner-login/" or "/api/owner-login/" is gated
  // like any near miss (unit-owner-passkeys B2) and a stranger is never redirected anywhere but the login page.
  // The target is built on the request's OWN url (a plain URL: a NextURL clone would put the slash back), so Next's
  // router relativizes the Location exactly as its built-in redirect did ("/home"), on the rig and behind the proxy.
  if (path.length > 1 && path.endsWith("/") && !isDocsPath(path)) {
    const to = new URL(req.url);
    to.pathname = path.replace(/\/+$/, "") || "/";
    const res = NextResponse.redirect(to, 308);
    return path.startsWith("/api/") ? res : unframeable(res);
  }
  // DOCS UNDER APP: the docs route (app/docs/[[...slug]]/route.ts) sets the docs' whole header set itself — its own
  // content security policy (frame-ancestors 'none' included) and X-Frame-Options. Next APPENDS a header the
  // middleware set to the route's own, so the frame headers here would arrive as a second policy and a doubled
  // X-Frame-Options; the route's single policy replaces them instead. Not metered: it is a document, not the API.
  if (isDocsPath(path)) return NextResponse.next();
  // PUBLIC GO-LIVE: the Farcaster Mini App manifest is a JSON document its route answers with its own headers (content
  // type, cache, CORS); it is not a page, so no frame headers. Its exact path only (a trailing slash was redirected above).
  if (path === MANIFEST_PATH) return NextResponse.next();
  // PUBLIC GO-LIVE: /anon and /anon/p/<hash> may be framed by the Farcaster web client only (anonFramed, above)
  if (isAnonPagePath(path)) return anonFramed(NextResponse.next());
  // the rate limiter is the API's; a page load is not metered (its data comes from the device, in the page)
  if (!path.startsWith("/api/")) return unframeable(NextResponse.next());
  if (process.env.ZK_DEV_HOOKS === "true") return NextResponse.next();
  const r = take(clientAddress(req), Date.now());
  if (r.ok) return NextResponse.next();
  return limited(r.retryAfterSeconds);
}

// the kill switch covers pages as well as routes, so the matcher is everything but the build's own static output.
//
// PROD-LIVE (review: THE OWNER GATE WAS SKIPPABLE). This was "/((?!_next/static|_next/image|favicon.ico).*)": an
// unescaped dot and no anchor, so ANY path starting "favicon" plus one character skipped the middleware entirely —
// /favicon.ico/status/<hash> and /faviconXico/… reached app/(main)/[handle]/status/[hash] and rendered the rig layout
// (the owner's roster in the payload) with no session, and /_next/staticX/…, /_next/imageX were skipped too. Now it
// skips exactly two things, anchored: the build's chunks under "/_next/static/" (the trailing slash is the anchor)
// and the image optimizer at exactly "/_next/image" ($ — Next compiles the source to
// ^(?:\/(_next\/data\/[^/]{1,}))?(?:\/((?!_next\/static\/|_next\/image$).*))(.json)?[\/#\?]?$ and execs it against
// the pathname, which carries no query). The optimizer's upstream fetch of a local ?url= re-enters the router — and
// so this middleware — with no headers at all (next/dist/server/image-optimizer.js fetchInternalImage), so it
// cannot fetch a gated page or route for a stranger. favicon.ico is NOT exempt: it is served by app/favicon.ico now
// (a static metadata route, so a bare /favicon.ico no longer reaches the [handle] page and its Neynar lookup), and on
// the owner service it is gated like everything else (the login page shows /icon.svg). Tested against Next 14.2's
// own getMiddlewareMatchers + getMiddlewareRouteMatcher: skipped — /_next/static/chunks/a.js, /_next/image; RUN —
// /favicon.ico, /favicon.ico/status/0xabc, /faviconXico/x, /_next/staticX/y, /_next/static, /_next/imageX,
// /_next/image/x, /api/health, /api/healthX, /owner-login, /owner-loginX, /home. The gate's own exemptions above are
// exact string matches (never a prefix), and the (main) layout and /device verify the session themselves as well
// (lib/platform/owner-access.ts ownerSessionRefused), so a mistake here can no longer open the owner's roster.
export const config = { matcher: ["/((?!_next/static/|_next/image$).*)"] };
