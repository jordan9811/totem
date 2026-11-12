// OWNER PASSKEYS (D-OWNER-PASSKEYS) — THE OWNER GATE'S PASSKEY SIGN-IN, CALLED DIRECTLY. NODE-ONLY: no server, no
// socket, no port, no Railway. middleware.ts, the five /api/owner-login routes and the owner modules are bundled with
// esbuild (the repo's devDependency; the @/ paths from tsconfig.json, `server-only` shimmed) and driven in-process with
// NextRequest objects. The middleware's loopback read of the gate's state (fetch → OWNER_STATE_API) is answered by a
// fetch stub that runs the request through the middleware again and then the state route — what the real server does.
// Time is a controllable clock (Date.now), so challenge TTLs, enrollment freshness, session expiry, cache TTLs and
// rate-limit refills are exercised for real. A software authenticator (scripts/lib/soft-authenticator.mjs: ES256 via
// @noble/curves, Ed25519 and RS256 via node:crypto) plays the owner's devices. The passphrase is random per run and
// never printed; neither is any cookie. Every file it writes is under the OS temp directory, removed at the end.
//
//   A  rig / public preview (no OWNER_ACCESS_SECRET): a no-op everywhere
//   B  the allowlist: exactly the new paths, exactly; the internal state route only with its token; nothing revealed
//   C  registration: only from a fresh passphrase session; every create() check; single-use, session-bound challenges;
//      at most 5; stored beside KEYSTORE_DIR with no private key, passphrase or cookie in the file
//   D  one-tap sign-in end to end, and every refusal: origin, RP ID, replay, expiry, unknown credential, counter
//      regression, flags, user handle, a concurrent same-counter pair
//   E  revocation: removing a passkey, sign out everywhere, a new passphrase — at the gate and the backstop
//   F  failure is a refusal: the state unreadable, malformed or corrupt; forged and v1 cookies; no state source
//   G  lifetime: OWNER_SESSION_DAYS (default 30, cap 90), expiry   H  metering   I  the rest (incl. the device bundle)
//   J  the review's findings, server side, each driven to its failure: PK-1 (emoji names), PK-2 (short credential
//      ids), the writer's read-back guard, PK-4 (script sessions), PK-5 (durable renames), UX-1 (lost device), UX-2
//      (the QR code), UX-4 (not my device), UX-5, UX-8, UX-10, UX-12, UX-13
//   K  the review's findings, browser side: lib/owner/passkeyClient.ts driven END TO END through the middleware and
//      the routes by a fake browser holding a software authenticator (conditional mediation, attachment, Signal API,
//      add-flow words), the session watcher, the components and the sign-in page rendered with react-dom/server
//      (no browser, no DOM), and the arm script's text
//
//   node scripts/unit-owner-passkeys.mjs             every check (about 15 s)
//   node scripts/unit-owner-passkeys.mjs --mutate    MUTATION SWEEP: each control weakened in the bundle only (the
//                                                    repo is never touched); every mutation must turn a check red
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { SoftAuthenticator } from "./lib/soft-authenticator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);
const rootRequire = createRequire(path.join(ROOT, "package.json"));
const { build } = rootRequire("esbuild");

let passed = 0;
let failed = 0;
const failures = [];
async function check(name, fn) {
  try {
    const extra = await fn();
    passed++;
    console.log(`  PASS  ${name}${typeof extra === "string" ? " — " + extra : ""}`);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name} — ${e && e.message ? e.message : String(e)}`);
  }
}
function need(cond, why) {
  if (!cond) throw new Error(why);
}
function section(title) {
  console.log("\n" + title);
}

// ------------------------------------------------------------------------------------------------ clock + env
const realNow = Date.now.bind(Date);
const clock = { t: realNow() };
Date.now = () => clock.t;
const advance = (ms) => {
  clock.t += ms;
};
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const TMP = mkdtempSync(path.join(os.tmpdir(), "layers-owner-passkeys-"));
const VOLUME = path.join(TMP, "data");
const KEYSTORE = path.join(VOLUME, "keystore");
mkdirSync(KEYSTORE, { recursive: true });
const STATE_FILE = path.join(VOLUME, "owner-passkeys.json");
const SECRET = randomBytes(32).toString("base64url"); // never printed
const APP = "https://owner-app.example.test";
const RP_ID = "owner-app.example.test";
const BASE = "https://localhost:3999"; // what next start's middleware sees behind the platform's proxy (x-forwarded-proto https)

function ownerEnv() {
  process.env.OWNER_ACCESS_SECRET = SECRET;
  process.env.APP_URL = APP;
  process.env.KEYSTORE_DIR = KEYSTORE;
  process.env.ZK_DEV_HOOKS = "true";
  process.env.TRUST_PROXY = "true";
  delete process.env.OWNER_SESSION_DAYS;
  delete process.env.OWNER_PASSKEYS_FILE;
  delete process.env.LAYERS_MAINTENANCE;
}
ownerEnv();

// ------------------------------------------------------------------------------------------------ the bundle
writeFileSync(path.join(TMP, "server-only.mjs"), "export {};\n");
writeFileSync(
  path.join(TMP, "entry.ts"),
  [
    'export * as mw from "@/middleware";',
    'export * as loginRoute from "@/app/api/owner-login/route";',
    'export * as optionsRoute from "@/app/api/owner-login/passkey/options/route";',
    'export * as verifyRoute from "@/app/api/owner-login/passkey/verify/route";',
    'export * as securityRoute from "@/app/api/owner-login/security/route";',
    'export * as stateRoute from "@/app/api/owner-login/state/route";',
    'export * as access from "@/lib/platform/owner-access";',
    'export * as store from "@/lib/platform/owner-store.server";',
    'export * as passkeys from "@/lib/platform/owner-passkeys.server";',
    'export { NextRequest, NextResponse } from "next/server";',
    "",
  ].join("\n")
);
// MUTATION MODE (PASSKEY_MUTATION=<name>): one control weakened IN THE BUNDLE ONLY (the repo is never touched), to prove
// the checks below can fail — a harness that stays green under a mutation is measuring nothing (mutate.mjs drives it)
const MUTATIONS = {
  "no-uv": ["lib/platform/owner-passkeys.server.ts", "allowedOrigins: [rp.origin], rpId: rp.rpId, requireUserVerification: true }", "allowedOrigins: [rp.origin], rpId: rp.rpId, requireUserVerification: false }"],
  "counter-lt": ["lib/platform/owner-passkeys.server.ts", "signCount <= c.signCount", "signCount < c.signCount"],
  "prefix-exempt": ["middleware.ts", "const budget = METERED_EXEMPT.get(path);", "const budget = [...METERED_EXEMPT].find(([p]) => path.startsWith(p))?.[1];"],
  "no-epoch": ["lib/platform/owner-access.ts", "if (!state.epoch || s.epoch !== state.epoch) return false;", "if (!state.epoch) return false;"],
  "no-slot": ["lib/platform/owner-access.ts", "return s.via === VIA_PASSPHRASE || state.slots.includes(s.via);", "return true;"],
  "challenge-reuse": ["lib/platform/owner-store.server.ts", "table.delete(challenge);", ""],
  "any-origin": ["lib/platform/owner-passkeys.server.ts", "allowedOrigins: [rp.origin], rpId: rp.rpId, requireUserVerification: true }", "allowedOrigins: [rp.origin, \"https://evil.example.test\", \"http://owner-app.example.test\", \"https://owner-app.example.test:8443\", \"https://example.test\", \"https://owner-app.example.test.evil.test\"], rpId: rp.rpId, requireUserVerification: true }"],
  "no-dirty": ["middleware.ts", "if (req.method === \"POST\" && path === OWNER_SECURITY_API) markGateStateDirty(Date.now());", ""],
  "dirty-for-strangers": ["middleware.ts", "  const now = Date.now();\n  // PROD-LIVE (review: the matcher's unanchored exclusion)", "  const now = Date.now();\n  if (req.method === \"POST\" && path.startsWith(\"/api/owner-login\")) markGateStateDirty(now);\n  // PROD-LIVE (review: the matcher's unanchored exclusion)"],
  "no-enroll-fresh": ["lib/platform/owner-passkeys.server.ts", "if (session.via !== VIA_PASSPHRASE || now - session.iat > OWNER_ENROLL_FRESH_MS) {", "if (session.via !== VIA_PASSPHRASE) {"],
  "enroll-any-session": ["lib/platform/owner-passkeys.server.ts", "if (session.via !== VIA_PASSPHRASE || now - session.iat > OWNER_ENROLL_FRESH_MS) {", "if (false) {"],
  "state-fail-open": ["middleware.ts", "if (verdict === \"unavailable\") return gateUnavailable(path);", "if (verdict === \"unavailable\") return null;"],
  "no-binding": ["lib/platform/owner-store.server.ts", "return s.passkeys.filter((p) => p.binding === binding);", "return s.passkeys;"],
  "no-userhandle": ["lib/platform/owner-passkeys.server.ts", "if (userHandle !== ownerHandle) return fail(\"user-handle\", 401);", ""],
  "no-be-check": ["lib/platform/owner-passkeys.server.ts", "if (flags.be !== cred.backupEligible) return fail(\"backup-eligibility\", 401);", ""],
  "no-cap": ["lib/platform/owner-passkeys.server.ts", "if (live.length >= OWNER_PASSKEYS_MAX) return fail(\"full\", 409, \"passkeys_full\");", ""],
  "token-optional": ["middleware.ts", "if (path === OWNER_STATE_API && (await ownerInternalTokenOk(req.headers.get(OWNER_INTERNAL_HEADER), secret))) return null;", "if (path === OWNER_STATE_API) return null;"],
  "options-leak": ["lib/platform/owner-passkeys.server.ts", "return { challenge, rpId: rp.rpId, timeout: OWNER_WEBAUTHN_TIMEOUT_MS, userVerification: \"required\" };", "return { challenge, rpId: rp.rpId, timeout: OWNER_WEBAUTHN_TIMEOUT_MS, userVerification: \"required\", allowCredentials: [] } as never;"],
  "no-rp-hash": ["lib/custody/webauthn.ts", "if (!safeEq(parsed.rpIdHash.toString(\"hex\"), rpIdHash.toString(\"hex\"))) return { ok: false, reason: \"rpIdHash\" };\n    if (!parsed.flags.up) return { ok: false, reason: \"user-present\" };\n    if (ctx.requireUserVerification && !parsed.flags.uv) return { ok: false, reason: \"user-verified\" };\n    // L3 §7.2", "if (!parsed.flags.up) return { ok: false, reason: \"user-present\" };\n    if (ctx.requireUserVerification && !parsed.flags.uv) return { ok: false, reason: \"user-verified\" };\n    // L3 §7.2"],
  "lifetime-uncapped": ["lib/platform/owner-access.ts", "return Math.min(n, OWNER_SESSION_DAYS_MAX);", "return n;"],
  // the review's fixes (sections J, K) — each one undone in turn
  "name-reader-64": ["lib/platform/owner-store.server.ts", "v.length <= OWNER_PASSKEY_NAME_MAX * 2 && Array.from(v).length <= OWNER_PASSKEY_NAME_MAX", "v.length <= 64"],
  "no-readback": ["lib/platform/owner-store.server.ts", "  try {\n    parseState(text);\n  } catch (e) {", "  try {\n    void text;\n  } catch (e) {"],
  "short-id-ok": ["lib/platform/owner-passkeys.server.ts", "if (Buffer.from(v.credentialId, \"base64url\").length < OWNER_PASSKEY_ID_MIN_BYTES) return fail(\"credential-id-short\", 400);", ""],
  "script-full-life": ["app/api/owner-login/route.ts", "const lifetimeMs = Math.min(ownerSessionMs(), OWNER_SCRIPT_SESSION_MS);", "const lifetimeMs = ownerSessionMs();"],
  "no-dir-fsync": ["lib/platform/owner-store.server.ts", "  syncOwnerStateDirectory(path.dirname(file));\n}", "}"],
  "register-keeps-session": ["app/api/owner-login/security/route.ts", "[ownerCookieHeader(cookie), ownerHintCookieHeader(r.passkey.slot)]", "[ownerHintCookieHeader(r.passkey.slot)]"],
  "lost-keeps-epoch": ["app/api/owner-login/security/route.ts", "          rotateOwnerEpoch(s);\n          return { write: true, result: s.passkeys.length !== before };", "          return { write: true, result: s.passkeys.length !== before };"],
  "register-any-epoch": ["lib/platform/owner-passkeys.server.ts", "if (s.epoch !== session.epoch) return { write: false, result: fail(\"epoch\", 401) };", ""],
  "hint-any-attachment": ["app/api/owner-login/passkey/verify/route.ts", "const onThisDevice = body.authenticatorAttachment !== \"cross-platform\";", "const onThisDevice = true;"],
  "shared-new-iat": ["lib/platform/owner-access.ts", "return sealOwnerSession(secret, { iat: s.iat, exp: e,", "return sealOwnerSession(secret, { iat: Date.now(), exp: e,"],
  "challenge-401": ["lib/platform/owner-passkeys.server.ts", "return fail(\"challenge\", 400, \"try_again\");", "return fail(\"challenge\", 401);"],
  "form-503-json": ["app/api/owner-login/route.ts", "    if (body.form) return backToLogin(req, OWNER_LOGIN_ERRORS.unavailable, body.next);\n    return json({ error: \"the owner service could not record", "    return json({ error: \"the owner service could not record"],
  "busy-reads-chunked": ["middleware.ts", "if (Number.isFinite(declared) && declared <= 8192) {", "if (!(declared > 8192)) {"],
  "busy-json": ["middleware.ts","if (path !== OWNER_LOGIN_API || ctype.includes(\"application/json\")) return limited(retryAfterSeconds, \"too many login attempts\");", "return limited(retryAfterSeconds, \"too many login attempts\");"],
  "stale-hint-kept": ["app/api/owner-login/route.ts", "const staleHint = isPasskeySlot(hint) && !hinted ? [ownerHintCookieHeader(null)] : [];", "const staleHint = [];"],
  "signal-all": ["lib/platform/owner-passkeys.server.ts", "allAcceptedCredentialIds: live.map((p) => p.id) }", "allAcceptedCredentialIds: s.passkeys.map((p) => p.id) }"],
  "status-get-dirty": ["middleware.ts", "if (req.method === \"POST\" && path === OWNER_SECURITY_API) markGateStateDirty(Date.now());", "if (path === OWNER_SECURITY_API) markGateStateDirty(Date.now());"],
  "owner-username": ["lib/platform/owner-passkeys.server.ts", "user: { id: userHandle, name: OWNER_PASSKEY_USER_NAME, displayName: OWNER_PASSKEY_USER_NAME },", "user: { id: userHandle, name: \"owner\", displayName: \"Totem owner\" },"],
  "client-no-attachment": ["lib/owner/passkeyClient.ts", "authenticatorAttachment: attachment === \"platform\" || attachment === \"cross-platform\" ? attachment : null,", "authenticatorAttachment: null,"],
  "client-no-renew": ["lib/owner/passkeyClient.ts", "      if (visible()) renew();\n      else stale = true;", "      void 0;"],
  "client-renew-hidden": ["lib/owner/passkeyClient.ts", "      if (visible()) renew();\n      else stale = true;", "      renew();"],
  "client-no-signal": ["lib/owner/passkeyClient.ts", "    signalAcceptedCredentials(v.json.signal);\n", ""],
  "client-add-signin-words": ["lib/owner/passkeyClient.ts", "  const adding = ctx === \"offer\" || ctx === \"add\";", "  const adding = false;"],
  "client-retry-signed-out": ["lib/owner/passkeyClient.ts", "if (status === 400 && code === \"try_again\") return err(\"retry\", ctx);", "if (status === 400 && code === \"try_again\") return err(\"signed-out\", ctx);"],
  "watch-any-401": ["lib/owner/sessionWatch.ts", "if (!told && j?.code === \"owner_login_required\") {", "if (!told) {"],
  "fold-open": ["components/owner/OwnerSignIn.tsx", "open={showPassphrase}", "open={true}"],
  "no-username-field": ["components/owner/OwnerSignIn.tsx", "<input type=\"text\" name=\"username\" autoComplete=\"username\" value=\"owner\" readOnly hidden aria-hidden=\"true\" tabIndex={-1} data-testid=\"owner-login-username\" />", ""],
  "hint-hides-add": ["components/owner/OwnerSecurityPanel.tsx", ") : session.canEnroll ? (", ") : session.canEnroll && !thisDevicePasskey ? ("],
};
const mutationName = process.env.PASSKEY_MUTATION || "";
const mutation = mutationName ? MUTATIONS[mutationName] : null;
if (mutationName && !mutation) throw new Error("unknown mutation " + mutationName);

// --mutate: run this file once per mutation; every one must turn at least one check red (a mutation that survives is
// a control this harness cannot see fail, and its green run proves nothing about that control)
if (process.argv.includes("--mutate")) {
  rmSync(TMP, { recursive: true, force: true });
  Date.now = realNow;
  const names = Object.keys(MUTATIONS);
  console.log(`OWNER PASSKEYS — MUTATION SWEEP: ${names.length} mutations, each applied to the bundle only`);
  let survived = 0;
  for (const name of names) {
    const r = spawnSync(process.execPath, [SELF], { env: { ...process.env, PASSKEY_MUTATION: name }, encoding: "utf8", timeout: 600_000 });
    const out = (r.stdout || "") + (r.stderr || "");
    const reds = [...new Set([...out.matchAll(/^\s+FAIL\s+([A-Z][0-9]+)/gm)].map((x) => x[1]))];
    if (/anchor not found/.test(out)) {
      survived++;
      console.log(`  BROKEN    ${name}: its anchor is no longer in the source — update the mutation`);
    } else if (r.status !== 0 && reds.length) console.log(`  KILLED    ${name}: red → ${reds.join(", ")}`);
    else {
      survived++;
      console.log(`  SURVIVED  ${name}: every check stayed green (exit ${r.status})`);
    }
  }
  console.log(`\n${names.length - survived} of ${names.length} mutations killed`);
  process.exit(survived ? 1 : 0);
}
const mutationPlugin = {
  name: "mutate",
  setup(b) {
    b.onLoad({ filter: /\.tsx?$/ }, (args) => {
      const rel = path.relative(ROOT, args.path).split(path.sep).join("/");
      if (!mutation || rel !== mutation[0]) return undefined;
      const text = readFileSync(args.path, "utf8").replace(/\r\n/g, "\n");
      if (!text.includes(mutation[1])) throw new Error(`mutation ${mutationName}: anchor not found in ${rel}`);
      return { contents: text.replace(mutation[1], mutation[2]), loader: rel.endsWith(".tsx") ? "tsx" : "ts" };
    });
  },
};
if (mutation) console.log(`MUTATION ${mutationName}: ${mutation[0]} weakened in the bundle only`);
const OUT = path.join(TMP, mutation ? `bundle.${mutationName}.cjs` : "bundle.cjs");
await build({
  plugins: [mutationPlugin],
  absWorkingDir: ROOT,
  entryPoints: [path.join(TMP, "entry.ts")],
  outfile: OUT,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: ["node20"],
  tsconfig: path.join(ROOT, "tsconfig.json"),
  alias: { "server-only": path.join(TMP, "server-only.mjs") },
  nodePaths: [path.join(ROOT, "node_modules")],
  logLevel: "error",
});
const m = createRequire(import.meta.url)(OUT);
const { access, store } = m;

// ------------------------------------------------------------------------------------------------ the loopback
// the middleware's own read of the gate's state, answered as the server would: through the middleware, then the route
const fetchLog = [];
let fetchMode = "ok"; // "ok" | "fail" | "malformed"
/** section K: the fake browser's device — the browser code's RELATIVE fetches go through the gate and the routes as
 *  this device (its cookie jar, its address), exactly as the owner's browser would */
let clientDevice = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("/")) {
    if (!clientDevice) throw new Error("harness: a relative fetch with no fake browser installed: " + url);
    const r = await send((init.method ?? "GET").toUpperCase(), url, { device: clientDevice, raw: init.body, headers: init.headers ?? {} });
    return r.res ?? new Response(null, { status: r.status });
  }
  const headers = new Headers(init.headers ?? {});
  fetchLog.push({ url, token: headers.get(access.OWNER_INTERNAL_HEADER) });
  if (fetchMode === "fail") throw new TypeError("fetch failed (harness: loopback down)");
  if (fetchMode === "malformed") return new Response(JSON.stringify({ epoch: "nope", slots: "x" }), { status: 200, headers: { "content-type": "application/json" } });
  const u = new URL(url);
  if (u.pathname !== access.OWNER_STATE_API) throw new Error("harness: unexpected fetch from the middleware: " + url);
  const req = new m.NextRequest(url, { method: "GET", headers });
  const mres = await m.mw.middleware(req);
  if (mres.headers.get("x-middleware-next") !== "1") return mres;
  return m.stateRoute.GET(req);
};

// ------------------------------------------------------------------------------------------------ requests
const ROUTES = {
  "/api/owner-login": m.loginRoute,
  "/api/owner-login/passkey/options": m.optionsRoute,
  "/api/owner-login/passkey/verify": m.verifyRoute,
  "/api/owner-login/security": m.securityRoute,
  "/api/owner-login/state": m.stateRoute,
};

class Device {
  constructor(ip) {
    this.ip = ip;
    this.jar = new Map();
  }
  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(res) {
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const sc of list) {
      const [pair, ...attrs] = sc.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const maxAge = attrs.map((a) => a.trim()).find((a) => /^max-age=/i.test(a));
      if (maxAge && Number(maxAge.split("=")[1]) <= 0) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  get session() {
    return this.jar.get(access.OWNER_COOKIE);
  }
}

function makeReq(method, p, { device, body, headers = {}, origin = APP, raw } = {}) {
  const h = new Headers(headers);
  if (device?.ip) h.set("x-forwarded-for", device.ip);
  if (origin !== null && method !== "GET") h.set("origin", origin);
  if (device && device.jar.size) h.set("cookie", device.cookieHeader());
  let b;
  if (raw !== undefined) b = raw;
  else if (body !== undefined) {
    h.set("content-type", "application/json");
    b = JSON.stringify(body);
  }
  // a browser always declares the length of what it sends (and the middleware reads a form body only when it does)
  if (typeof b === "string" && !h.has("content-length")) h.set("content-length", String(Buffer.byteLength(b)));
  return new m.NextRequest(BASE + p, { method, headers: h, body: b });
}

/** one request through the gate and then (if admitted) the route; pages and other routes answer a stand-in 200 */
async function send(method, p, opts = {}) {
  const req = makeReq(method, p, opts);
  const mres = await m.mw.middleware(req);
  if (mres.headers.get("x-middleware-next") !== "1") {
    return { stage: "middleware", status: mres.status, headers: mres.headers, json: await safeJson(mres), res: mres };
  }
  const mod = ROUTES[p];
  if (!mod) return { stage: "app", status: 200, headers: new Headers(), json: null };
  const handler = mod[method];
  if (typeof handler !== "function") return { stage: "route", status: 405, headers: new Headers(), json: null };
  const res = await handler(req);
  opts.device?.absorb(res);
  return { stage: "route", status: res.status, headers: res.headers, json: await safeJson(res), res };
}
/** straight to a route handler (no middleware) — for the crypto checks, so the gate's sign-in budget is not spent */
async function direct(method, p, opts = {}) {
  const req = makeReq(method, p, opts);
  const res = await ROUTES[p][method](req);
  opts.device?.absorb(res);
  return { stage: "route", status: res.status, headers: res.headers, json: await safeJson(res), res };
}
async function safeJson(res) {
  try {
    return await res.clone().json();
  } catch {
    return null;
  }
}
const admitted = (r) => r.stage !== "middleware";

// ------------------------------------------------------------------------------------------------ flows
/** a SCRIPT's sign-in (JSON): a session of at most a day (review PK-4) — enough for every check that only needs "a
 *  passphrase session"; checks about the browser's OWNER_SESSION_DAYS use formLogin */
async function passphraseLogin(device, opts = {}) {
  const r = await direct("POST", "/api/owner-login", { device, body: { passphrase: opts.passphrase ?? process.env.OWNER_ACCESS_SECRET }, origin: null });
  need(r.status === 200, "passphrase login answered " + r.status + " " + JSON.stringify(r.json));
  return r;
}
const FORM = { "content-type": "application/x-www-form-urlencoded" };
/** a BROWSER's sign-in: the passphrase form, as /owner-login posts it (303 on success) */
async function formLogin(device, { next = "/home", passphrase, via = direct } = {}) {
  const raw = new URLSearchParams({ next, passphrase: passphrase ?? process.env.OWNER_ACCESS_SECRET }).toString();
  const r = await via("POST", "/api/owner-login", { device, raw, headers: FORM });
  need(r.status === 303, "form login answered " + r.status);
  return r;
}
const locationOf = (r) => r.headers.get("location") ?? "";
const setCookieFor = (r, name) => (typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : []).find((c) => c.startsWith(name + "="));
async function registerOptions(device) {
  return direct("POST", "/api/owner-login/security", { device, body: { action: "register-options" } });
}
async function register(device, auth, { name = "Test device", tamper = {}, options } = {}) {
  const o = options ?? (await registerOptions(device));
  if (o.status !== 200) return o;
  const opt = o.json.options;
  const cred = auth.create({ challenge: opt.challenge, rpId: RP_ID, origin: APP, userHandle: opt.user.id, ...tamper });
  return direct("POST", "/api/owner-login/security", { device, body: { action: "register", name, credential: cred } });
}
async function signInOptions(device, via = direct) {
  const r = await via("POST", "/api/owner-login/passkey/options", { device, body: {} });
  need(r.status === 200, "options answered " + r.status);
  return r.json;
}
/** `attachment`: what the browser reports as PublicKeyCredential.authenticatorAttachment ("platform", "cross-platform"
 *  for the phone over the QR code); left out, the body carries none (a browser that does not report it) */
async function passkeySignIn(device, auth, { tamper = {}, via = direct, challenge, attachment } = {}) {
  const o = challenge ? { challenge } : await signInOptions(device, via);
  const assertion = auth.get({ challenge: o.challenge, rpId: RP_ID, origin: APP, ...tamper });
  return via("POST", "/api/owner-login/passkey/verify", { device, body: { ...assertion, next: "/home", ...(attachment !== undefined ? { authenticatorAttachment: attachment } : {}) } });
}
function stateFile() {
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}
function cookieParts(v) {
  return v.split(".");
}
async function gateAdmits(device, p = "/api/personas") {
  const r = await send("GET", p, { device });
  return admitted(r);
}
async function backstopRefuses(device) {
  return access.ownerSessionRefused(() => device.session, process.env, store.ownerGateStateSource);
}
function storedCount(slot) {
  return stateFile().passkeys.find((p) => p.slot === slot).signCount;
}
/** the next automatic assertion counts from what the server holds, so a refusal can only be the tampering's doing */
function syncCounter(auth, slot) {
  auth.counter = storedCount(slot);
}
function freshClockForGate() {
  advance(5_000); // past the middleware's state cache TTL
}

console.log("OWNER PASSKEYS — node-only harness (no server, no socket): " + path.relative(ROOT, OUT).replace(/\\/g, "/"));

// ================================================================================================ A. rig / public
section("A. no OWNER_ACCESS_SECRET (the rig laptop, the public preview): everything here is a no-op");
await check("A1. the middleware admits every page and route with no cookie, and never reads the gate's state", async () => {
  delete process.env.OWNER_ACCESS_SECRET;
  try {
    const before = fetchLog.length;
    for (const [method, p] of [["GET", "/home"], ["GET", "/api/personas"], ["POST", "/api/owner-login/security"], ["GET", "/api/owner-login/state"], ["POST", "/api/owner-login/passkey/verify"], ["GET", "/owner-login/add-passkey"]]) {
      const r = await m.mw.middleware(makeReq(method, p, { device: new Device("203.0.113.1"), body: method === "POST" ? {} : undefined }));
      need(r.headers.get("x-middleware-next") === "1", `${method} ${p} was not admitted (${r.status})`);
    }
    need(fetchLog.length === before, "the middleware fetched the gate's state with no secret set");
    return "6 paths admitted, 0 state reads";
  } finally {
    ownerEnv();
  }
});
await check("A2. every owner route answers 404 with no secret; nothing is written to the volume", async () => {
  delete process.env.OWNER_ACCESS_SECRET;
  try {
    const d = new Device("203.0.113.2");
    const rs = [
      await direct("POST", "/api/owner-login", { device: d, body: { passphrase: "x".repeat(40) }, origin: null }),
      await direct("POST", "/api/owner-login/passkey/options", { device: d, body: {} }),
      await direct("POST", "/api/owner-login/passkey/verify", { device: d, body: {} }),
      await direct("POST", "/api/owner-login/security", { device: d, body: { action: "signout-everywhere" } }),
      await direct("GET", "/api/owner-login/state", { device: d }),
    ];
    need(rs.every((r) => r.status === 404), "statuses " + rs.map((r) => r.status).join(","));
    need(!existsSync(STATE_FILE), "a state file was written with no secret set");
    return "5 routes 404";
  } finally {
    ownerEnv();
  }
});
await check("A3. the backstop (ownerSessionRefused) is false without a secret and never even reads the cookie", async () => {
  delete process.env.OWNER_ACCESS_SECRET;
  try {
    let read = 0;
    const refused = await access.ownerSessionRefused(() => {
      read++;
      return "junk";
    });
    need(refused === false && read === 0, `refused=${refused}, cookie reads=${read}`);
  } finally {
    ownerEnv();
  }
});

// ================================================================================================ B. allowlist
section("B. the allowlist: exactly the new paths, exactly; nothing revealed to a stranger");
await check("B1. EXEMPT (no session): POST /api/owner-login, /api/owner-login/passkey/options, /api/owner-login/passkey/verify; GET /owner-login, /icon.svg, /api/health", async () => {
  const d = new Device("203.0.113.10");
  for (const [method, p] of [["POST", "/api/owner-login"], ["POST", "/api/owner-login/passkey/options"], ["POST", "/api/owner-login/passkey/verify"], ["GET", "/owner-login"], ["GET", "/icon.svg"], ["GET", "/api/health"]]) {
    const r = await m.mw.middleware(makeReq(method, p, { device: d, body: method === "POST" ? {} : undefined }));
    need(r.headers.get("x-middleware-next") === "1", `${method} ${p} answered ${r.status} instead of passing`);
  }
  return "6 exact paths pass";
});
await check("B2. GATED (no session): every near miss — suffixes, trailing slashes, parents, siblings, the security and state routes — 401 for routes, 303 for pages", async () => {
  const d = new Device("203.0.113.11");
  const api = [
    "/api/owner-login/passkey/optionsX",
    "/api/owner-login/passkey/options/",
    "/api/owner-login/passkey/options/x",
    "/api/owner-login/passkey",
    "/api/owner-login/passkey/",
    "/api/owner-login/passkey/verifyX",
    "/api/owner-login/passkey/verify/x",
    "/api/owner-login/passkeys",
    "/api/owner-login/security",
    "/api/owner-login/state",
    "/api/owner-login/stateX",
    "/api/owner-login/X",
    "/api/owner-loginX",
    "/api/owner-login/",
  ];
  const wrong = [];
  for (const p of api) {
    for (const method of ["GET", "POST"]) {
      const r = await send(method, p, { device: d, body: method === "POST" ? {} : undefined });
      if (r.stage !== "middleware" || r.status !== 401) wrong.push(`${method} ${p} → ${r.stage} ${r.status}`);
    }
  }
  for (const p of ["/owner-login/add-passkey", "/owner-loginX", "/owner-login/", "/settings/owner-security", "/home"]) {
    const r = await send("GET", p, { device: d });
    if (r.stage !== "middleware" || r.status !== 303) wrong.push(`GET ${p} → ${r.stage} ${r.status}`);
  }
  need(!wrong.length, wrong.join(" | "));
  return `${api.length * 2} route requests 401, 5 pages 303`;
});
await check("B3. the INTERNAL state route: admitted only with the passphrase-derived token; the token is not accepted on any other path; the route answers 404 without it", async () => {
  const d = new Device("203.0.113.12");
  const token = await access.ownerInternalToken(SECRET);
  const ok = await m.mw.middleware(makeReq("GET", "/api/owner-login/state", { device: d, headers: { [access.OWNER_INTERNAL_HEADER]: token } }));
  need(ok.headers.get("x-middleware-next") === "1", "the token did not admit the state route (" + ok.status + ")");
  const bad = await send("GET", "/api/owner-login/state", { device: d, headers: { [access.OWNER_INTERNAL_HEADER]: "0".repeat(64) } });
  need(bad.stage === "middleware" && bad.status === 401, "a wrong token was admitted: " + bad.stage + " " + bad.status);
  for (const p of ["/api/owner-login/stateX", "/api/personas", "/api/owner-login/security"]) {
    const r = await send("GET", p, { device: d, headers: { [access.OWNER_INTERNAL_HEADER]: token } });
    need(r.stage === "middleware" && r.status === 401, "the token opened " + p);
  }
  const noToken = await m.stateRoute.GET(makeReq("GET", "/api/owner-login/state", { device: d }));
  need(noToken.status === 404, "the state route answered " + noToken.status + " without the token");
  return "token admits exactly one path; the route itself 404s without it";
});
let optionKeysEmpty;
await check("B4. the sign-in options reveal nothing: exactly {challenge, rpId, timeout, userVerification}, no allowCredentials, no user, no count (checked again with passkeys registered: E0)", async () => {
  const o = await signInOptions(new Device("203.0.113.13"));
  optionKeysEmpty = Object.keys(o).sort().join(",");
  need(optionKeysEmpty === "challenge,rpId,timeout,userVerification", "keys: " + optionKeysEmpty);
  need(o.rpId === RP_ID && o.userVerification === "required" && /^[A-Za-z0-9_-]{43}$/.test(o.challenge), "values: " + JSON.stringify({ rpId: o.rpId, uv: o.userVerification }));
  return "keys " + optionKeysEmpty;
});
await check("B5. a cross-site Origin header is refused by both sign-in routes (403); a missing one too", async () => {
  const d = new Device("203.0.113.14");
  const a = await direct("POST", "/api/owner-login/passkey/options", { device: d, body: {}, origin: "https://evil.example.test" });
  const b = await direct("POST", "/api/owner-login/passkey/verify", { device: d, body: {}, origin: "https://evil.example.test" });
  const c = await direct("POST", "/api/owner-login/passkey/options", { device: d, body: {}, origin: null });
  need(a.status === 403 && b.status === 403 && c.status === 403, `statuses ${a.status},${b.status},${c.status}`);
});

// ================================================================================================ C. registration
section("C. registration: only from a fresh PASSPHRASE session; stored on the volume beside the keystore");
const laptop = new Device("198.51.100.20");
const phone = new Device("198.51.100.21");
const phoneKey = new SoftAuthenticator({ alg: -7, counter: 0, counterStep: 1 });
let phoneSlot;
await check("C1. a passphrase sign-in (the browser's form) mints a v2 cookie for the volume's epoch (via 'p', 30 days) and writes the state file BESIDE KEYSTORE_DIR", async () => {
  const r = await formLogin(laptop);
  need(existsSync(STATE_FILE), "no state file at " + STATE_FILE);
  const st = stateFile();
  const parts = cookieParts(laptop.session);
  need(parts[0] === "v2" && parts.length === 7, "cookie shape " + parts[0] + "/" + parts.length);
  need(parts[3] === st.epoch && parts[4] === "p", "cookie epoch/via do not match the volume");
  need(Number(parts[2]) - Number(parts[1]) === 30 * DAY, "lifetime " + (Number(parts[2]) - Number(parts[1])));
  const sc = r.headers.getSetCookie().find((c) => c.startsWith(access.OWNER_COOKIE + "="));
  need(/Max-Age=2592000/.test(sc) && /HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Strict/.test(sc), "Set-Cookie attributes");
  need(path.dirname(STATE_FILE) === path.dirname(KEYSTORE), "not beside the keystore");
  return "state at <volume>/owner-passkeys.json, Max-Age 2592000";
});
await check("C2. no session: the security route is 401 at the gate AND in the route itself", async () => {
  const stranger = new Device("198.51.100.22");
  const g = await send("POST", "/api/owner-login/security", { device: stranger, body: { action: "register-options" } });
  const r = await direct("POST", "/api/owner-login/security", { device: stranger, body: { action: "register-options" } });
  need(g.stage === "middleware" && g.status === 401, "gate: " + g.stage + " " + g.status);
  need(r.status === 401, "route: " + r.status);
});
await check("C3. a fresh passphrase session registers a passkey: options (platform, discoverable, UV required, attestation none, ES256 first), create, verify, stored", async () => {
  await passphraseLogin(phone);
  const o = await registerOptions(phone);
  need(o.status === 200, "options " + o.status + " " + JSON.stringify(o.json));
  const opt = o.json.options;
  need(opt.rp.id === RP_ID && opt.authenticatorSelection.userVerification === "required" && opt.authenticatorSelection.residentKey === "required" && opt.authenticatorSelection.authenticatorAttachment === "platform" && opt.attestation === "none", "options policy");
  need(opt.pubKeyCredParams[0].alg === -7 && opt.excludeCredentials.length === 0, "algs/exclude");
  const r = await register(phone, phoneKey, { name: "Owner's iPhone", options: o });
  need(r.status === 200 && r.json?.passkey?.slot, "register " + r.status + " " + JSON.stringify(r.json));
  phoneSlot = r.json.passkey.slot;
  need(phone.jar.get(access.OWNER_HINT_COOKIE) === phoneSlot, "no device hint cookie");
  const st = stateFile();
  const rec = st.passkeys.find((p) => p.slot === phoneSlot);
  need(rec && rec.id === Buffer.from(phoneKey.credId).toString("base64url") && rec.alg === -7 && rec.signCount === 0 && rec.name === "Owner's iPhone", "stored record");
  const text = readFileSync(STATE_FILE, "utf8");
  need(!text.includes(phoneKey.privateMarker()), "the private key reached the file");
  need(!text.includes(SECRET) && !text.includes(phone.session), "a secret or a cookie reached the file");
  return "slot " + phoneSlot.length + " hex chars; no private key, passphrase or cookie in the file";
});
await check("C9. a FORM passphrase sign-in goes on to the one-tap offer (/owner-login/add-passkey?next=…) — unless this device's hint names a live passkey, then straight to next", async () => {
  const raw = "passphrase=" + encodeURIComponent(SECRET) + "&next=%2Fsettings";
  const form = { "content-type": "application/x-www-form-urlencoded" };
  const fresh = new Device("198.51.100.31");
  const a = await direct("POST", "/api/owner-login", { device: fresh, raw, headers: form });
  need(a.status === 303 && a.headers.get("location") === APP + "/owner-login/add-passkey?next=%2Fsettings", "no hint: " + a.status + " " + a.headers.get("location"));
  need(fresh.session && cookieParts(fresh.session)[4] === "p", "no passphrase session was set");
  const b = await direct("POST", "/api/owner-login", { device: phone, raw, headers: form });
  need(b.status === 303 && b.headers.get("location") === APP + "/settings", "live hint: " + b.status + " " + b.headers.get("location"));
  const stale = new Device("198.51.100.32");
  stale.jar.set(access.OWNER_HINT_COOKIE, "0".repeat(16));
  const c = await direct("POST", "/api/owner-login", { device: stale, raw, headers: form });
  need(c.status === 303 && c.headers.get("location").includes("/owner-login/add-passkey"), "a stale hint skipped the offer: " + c.headers.get("location"));
  const wrongPass = await direct("POST", "/api/owner-login", { device: new Device("198.51.100.33"), raw: "passphrase=nope-nope-nope-nope&next=%2Fsettings", headers: form });
  need(wrongPass.status === 303 && /\/owner-login\?error=1/.test(wrongPass.headers.get("location")), "a wrong passphrase: " + wrongPass.headers.get("location"));
  return "offer / straight on / stale hint → offer / wrong passphrase → error";
});
await check("C4. a STALE passphrase session (older than 30 minutes) cannot register: 403 passphrase_required", async () => {
  const d = new Device("198.51.100.23");
  await passphraseLogin(d);
  advance(31 * MIN);
  const o = await registerOptions(d);
  need(o.status === 403 && o.json?.code === "passphrase_required", "answered " + o.status + " " + JSON.stringify(o.json));
});
await check("C5. registration refusals: wrong origin, wrong RP ID, UV missing, UP missing, wrong type, cross-origin iframe, credential id mismatch, an algorithm not offered, RSA-1024", async () => {
  const d = new Device("198.51.100.24");
  await passphraseLogin(d);
  const cases = [
    ["wrong origin", { origin: "https://evil.example.test" }],
    ["http origin", { origin: "http://owner-app.example.test" }],
    ["wrong RP ID", { rpIdOverride: "evil.example.test" }],
    ["parent-domain RP ID", { rpIdOverride: "example.test" }],
    ["UV missing", { uv: false }],
    ["UP missing", { up: false }],
    ["type webauthn.get", { type: "webauthn.get" }],
    ["crossOrigin true", { crossOrigin: true }],
    ["BS without BE", { be: false, bs: true }],
    ["rawId mismatch", { rawIdOverride: randomBytes(32) }],
    ["alg -35 (not offered)", { algOverride: -35 }],
    ["SPKI of another key", { spkiOverride: new SoftAuthenticator({ alg: -8 }).spki }],
  ];
  const wrong = [];
  for (const [label, tamper] of cases) {
    const r = await register(d, new SoftAuthenticator({ alg: -7 }), { tamper });
    if (r.status === 200) wrong.push(label + " was ACCEPTED");
  }
  const rsaShort = await register(d, new SoftAuthenticator({ alg: -257, rsaBits: 1024 }));
  if (rsaShort.status === 200) wrong.push("RSA-1024 was ACCEPTED");
  need(!wrong.length, wrong.join(" | "));
  need(stateFile().passkeys.length === 1, "a refused registration was stored");
  return cases.length + 1 + " refused, nothing stored";
});
await check("C6. a registration challenge is single-use and belongs to the session that asked: replay refused, another session's challenge refused, a sign-in challenge refused", async () => {
  const a = new Device("198.51.100.25");
  const b = new Device("198.51.100.26");
  await passphraseLogin(a);
  await passphraseLogin(b);
  const auth = new SoftAuthenticator({ alg: -7 });
  const o = await registerOptions(a);
  const cred = auth.create({ challenge: o.json.options.challenge, rpId: RP_ID, origin: APP, userHandle: o.json.options.user.id });
  const viaB = await direct("POST", "/api/owner-login/security", { device: b, body: { action: "register", name: "x", credential: cred } });
  need(viaB.status !== 200, "another session's challenge was accepted");
  const replay = await direct("POST", "/api/owner-login/security", { device: a, body: { action: "register", name: "x", credential: cred } });
  need(replay.status !== 200, "the challenge, spent by B's attempt, was accepted again for A");
  const login = await signInOptions(a);
  const cred2 = auth.create({ challenge: login.challenge, rpId: RP_ID, origin: APP, userHandle: o.json.options.user.id });
  const viaLogin = await direct("POST", "/api/owner-login/security", { device: a, body: { action: "register", name: "x", credential: cred2 } });
  need(viaLogin.status !== 200, "a sign-in challenge registered a passkey");
  need(stateFile().passkeys.length === 1, "something was stored");
  return `${viaB.status} / ${replay.status} / ${viaLogin.status}`;
});
await check("C7. Ed25519 and RS256-2048 (Windows Hello) register; a duplicate credential is refused 409", async () => {
  const d = new Device("198.51.100.27");
  const ed = new SoftAuthenticator({ alg: -8 });
  const rsa = new SoftAuthenticator({ alg: -257 });
  // review UX-1: a registration signs the registering device in WITH its new passkey — so each one here starts from a
  // fresh passphrase sign-in (in real use, one device adds one passkey: its own)
  await passphraseLogin(d);
  const r1 = await register(d, ed, { name: "Ed25519 key" });
  await passphraseLogin(d);
  const r2 = await register(d, rsa, { name: "Windows Hello" });
  need(r1.status === 200 && r2.status === 200, `ed ${r1.status}, rsa ${r2.status} ${JSON.stringify(r2.json)}`);
  await passphraseLogin(d);
  const dup = await register(d, ed, { name: "again" });
  need(dup.status === 409 && dup.json?.code === "passkey_exists", "duplicate answered " + dup.status + " " + JSON.stringify(dup.json));
  // both sign in
  const s1 = await passkeySignIn(new Device("198.51.100.28"), ed);
  const s2 = await passkeySignIn(new Device("198.51.100.29"), rsa);
  need(s1.status === 200 && s2.status === 200, `sign-ins ${s1.status}/${s2.status}`);
  return "3 passkeys now";
});
let fullCheckDevice;
await check("C8. at most 5: the 6th is refused at options (409 passkeys_full) and, for options fetched before the 5th landed, at the commit", async () => {
  const d = new Device("198.51.100.30");
  const other = new Device("198.51.100.34");
  await passphraseLogin(d);
  need(stateFile().passkeys.length === 3, "expected 3 to start, found " + stateFile().passkeys.length);
  const r4 = await register(d, new SoftAuthenticator({ alg: -7 }), { name: "fourth" });
  need(r4.status === 200, "4th " + r4.status);
  await passphraseLogin(d); // d is signed in WITH "fourth" now (review UX-1): a passphrase session again, to ask
  const early = await registerOptions(d); // room for one more when asked
  need(early.status === 200, "early options " + early.status);
  await passphraseLogin(other);
  const r5 = await register(other, new SoftAuthenticator({ alg: -7 }), { name: "fifth" }); // the 5th lands from another device
  need(r5.status === 200, "5th " + r5.status);
  const sixthOptions = await registerOptions(d);
  need(sixthOptions.status === 409 && sixthOptions.json?.code === "passkeys_full", "6th options " + sixthOptions.status);
  const late = await register(d, new SoftAuthenticator({ alg: -7 }), { name: "sixth", options: early });
  need(late.status === 409 && late.json?.code === "passkeys_full", "6th commit " + late.status + " " + JSON.stringify(late.json));
  need(stateFile().passkeys.length === 5, "count " + stateFile().passkeys.length);
  fullCheckDevice = d;
  return "5 stored, 6th refused twice";
});
await check("E0 (B4 again). with 5 passkeys registered the sign-in options are byte-for-byte the same shape: no credential id anywhere", async () => {
  const o = await signInOptions(new Device("203.0.113.15"));
  const keys = Object.keys(o).sort().join(",");
  need(keys === optionKeysEmpty, "keys changed: " + keys);
  const text = JSON.stringify(o);
  for (const p of stateFile().passkeys) need(!text.includes(p.id) && !text.includes(p.slot), "a credential id or slot leaked");
  need(!text.includes(stateFile().userHandle), "the user handle leaked");
  return "same keys, no ids";
});

// ================================================================================================ D. sign-in
section("D. one-tap sign-in and its refusals");
let phoneSession;
await check("D1. ONE TAP end to end through the gate: options → Face ID → verify → session (via the passkey's slot) + hint; the gate admits pages and routes with it (state read over loopback with the token); the backstop agrees", async () => {
  advance(HOUR); // a full sign-in budget
  const d = new Device("192.0.2.40");
  const before = fetchLog.length;
  const r = await passkeySignIn(d, phoneKey, { via: send });
  need(r.status === 200 && r.json?.ok === true && r.json.next === "/home", "verify " + r.status + " " + JSON.stringify(r.json));
  const parts = cookieParts(d.session);
  need(parts[4] === phoneSlot && parts[3] === stateFile().epoch, "the session does not name the passkey's slot / the epoch");
  need(d.jar.get(access.OWNER_HINT_COOKIE) === phoneSlot, "no hint cookie");
  need(await gateAdmits(d, "/api/personas"), "the gate refused the new session on a route");
  need(await gateAdmits(d, "/home"), "the gate refused the new session on a page");
  need((await backstopRefuses(d)) === false, "the backstop refused the new session");
  const reads = fetchLog.slice(before);
  need(reads.length >= 1, "the gate never read its state");
  need(reads.every((f) => f.url === "http://127.0.0.1:3999/api/owner-login/state"), "unexpected state URL " + reads[0]?.url);
  need(reads.every((f) => /^[0-9a-f]{64}$/.test(f.token ?? "")), "the state read carried no token");
  need(stateFile().passkeys.find((p) => p.slot === phoneSlot).lastUsedAt === clock.t, "lastUsedAt not written");
  phoneSession = d;
  return `admitted; ${reads.length} loopback read(s) of http://127.0.0.1:3999/api/owner-login/state (scheme NOT taken from the proxied https URL)`;
});
await check("D2. wrong ORIGIN in the signed clientData is refused: another site, http instead of https, another port, the parent domain", async () => {
  const wrong = [];
  for (const origin of ["https://evil.example.test", "http://owner-app.example.test", "https://owner-app.example.test:8443", "https://example.test", "https://owner-app.example.test.evil.test"]) {
    const r = await passkeySignIn(new Device("192.0.2.41"), phoneKey, { tamper: { origin } });
    if (r.status === 200) wrong.push(origin);
  }
  need(!wrong.length, "accepted: " + wrong.join(", "));
  const control = await passkeySignIn(new Device("192.0.2.41"), phoneKey);
  need(control.status === 200, "positive control (untampered) answered " + control.status);
  return "5 refused; the untampered control passed";
});
await check("D3. wrong RP ID (the authenticatorData's rpIdHash) is refused: another host, the parent domain", async () => {
  for (const rp of ["evil.example.test", "example.test", "localhost"]) {
    const r = await passkeySignIn(new Device("192.0.2.42"), phoneKey, { tamper: { rpIdOverride: rp } });
    need(r.status === 401, rp + " answered " + r.status);
  }
  const control = await passkeySignIn(new Device("192.0.2.42"), phoneKey);
  need(control.status === 200, "positive control (untampered) answered " + control.status);
  return "3 refused; the untampered control passed";
});
await check("D4. REPLAY: the identical assertion a second time is refused; a never-issued challenge is refused; an expired one (2 min) is refused; a registration challenge cannot sign in", async () => {
  const d = new Device("192.0.2.43");
  const o = await signInOptions(d);
  const assertion = phoneKey.get({ challenge: o.challenge, rpId: RP_ID, origin: APP });
  const first = await direct("POST", "/api/owner-login/passkey/verify", { device: d, body: assertion });
  const second = await direct("POST", "/api/owner-login/passkey/verify", { device: new Device("192.0.2.44"), body: assertion });
  need(first.status === 200 && second.status === 401, `first ${first.status}, replay ${second.status}`);
  const made = await passkeySignIn(new Device("192.0.2.45"), phoneKey, { challenge: Buffer.from(randomBytes(32)).toString("base64url") });
  need(made.status === 401, "a made-up challenge answered " + made.status);
  const o2 = await signInOptions(d);
  advance(2 * MIN + 1);
  const late = await passkeySignIn(new Device("192.0.2.46"), phoneKey, { challenge: o2.challenge });
  need(late.status === 401, "an expired challenge answered " + late.status);
  const regDev = new Device("192.0.2.47");
  await passphraseLogin(regDev);
  // a registration challenge (bound to regDev's session) presented to the sign-in route
  const fullErr = await registerOptions(regDev); // 409 (full) — so take one from the store directly
  need(fullErr.status === 409, "expected the full service to refuse options");
  const regChallenge = store.issueOwnerChallenge("register", cookieParts(regDev.session)[5]);
  const cross = await passkeySignIn(new Device("192.0.2.48"), phoneKey, { challenge: regChallenge });
  need(cross.status === 401, "a registration challenge signed in: " + cross.status);
  return "replay / made-up / expired / cross-purpose all 401";
});
await check("D5. UNKNOWN credential refused: a never-registered authenticator; a registered credential id signed by another key", async () => {
  const stranger = new SoftAuthenticator({ alg: -7 });
  stranger.userHandle = stateFile().userHandle;
  const a = await passkeySignIn(new Device("192.0.2.50"), stranger);
  need(a.status === 401, "unknown credential answered " + a.status);
  const b = await passkeySignIn(new Device("192.0.2.51"), phoneKey, { tamper: { signWith: stranger } });
  need(b.status === 401, "a forged signature answered " + b.status);
});
await check("D6. COUNTER: increasing passes; equal is refused; lower is refused; the next increase passes again; a synced passkey (always 0) passes every time", async () => {
  const d = new Device("192.0.2.52");
  const cur = stateFile().passkeys.find((p) => p.slot === phoneSlot).signCount;
  const up = await passkeySignIn(d, phoneKey, { tamper: { counter: cur + 5 } });
  need(up.status === 200, "an increase answered " + up.status);
  const same = await passkeySignIn(d, phoneKey, { tamper: { counter: cur + 5 } });
  need(same.status === 401, "an equal counter answered " + same.status);
  const lower = await passkeySignIn(d, phoneKey, { tamper: { counter: cur + 2 } });
  need(lower.status === 401, "a lower counter answered " + lower.status);
  const zero = await passkeySignIn(d, phoneKey, { tamper: { counter: 0 } });
  need(zero.status === 401, "a reset-to-zero counter answered " + zero.status);
  const again = await passkeySignIn(d, phoneKey, { tamper: { counter: cur + 6 } });
  need(again.status === 200, "the next increase answered " + again.status);
  need(stateFile().passkeys.find((p) => p.slot === phoneSlot).signCount === cur + 6, "the counter was not written back");
  syncCounter(phoneKey, phoneSlot);
  // a synced passkey: counter always 0, BE+BS set
  const synced = new SoftAuthenticator({ alg: -7, counterStep: 0, be: true, bs: true });
  const room = new Device("192.0.2.53");
  await passphraseLogin(room);
  // make room: remove the "fourth" passkey
  const fourth = stateFile().passkeys.find((p) => p.name === "fourth");
  const rm = await direct("POST", "/api/owner-login/security", { device: room, body: { action: "remove", slot: fourth.slot } });
  need(rm.status === 200, "remove for room " + rm.status);
  const reg = await register(room, synced, { name: "iCloud passkey" });
  need(reg.status === 200, "synced registration " + reg.status);
  for (let i = 0; i < 3; i++) {
    const s = await passkeySignIn(new Device("192.0.2.54"), synced);
    need(s.status === 200, "synced sign-in " + i + " answered " + s.status);
  }
  const rec = stateFile().passkeys.find((p) => p.name === "iCloud passkey");
  need(rec.backupEligible === true && rec.backupState === true && rec.signCount === 0, "synced record " + JSON.stringify({ be: rec.backupEligible, bs: rec.backupState, c: rec.signCount }));
  return "equal / lower / zero refused; synced 0,0,0 accepted";
});
await check("D7. flag and handle refusals: UV missing, UP missing, type webauthn.create, cross-origin iframe, no user handle, another user handle, BE flipped, BS without BE", async () => {
  const cases = [
    ["UV missing", { uv: false }],
    ["UP missing", { up: false }],
    ["type webauthn.create", { type: "webauthn.create" }],
    ["crossOrigin", { crossOrigin: true }],
    ["no user handle", { omitUserHandle: true }],
    ["another user handle", { userHandle: Buffer.from(randomBytes(16)).toString("base64url") }],
    ["BE flipped on", { be: true }],
    ["BS without BE", { be: false, bs: true }],
  ];
  syncCounter(phoneKey, phoneSlot);
  const wrong = [];
  for (const [label, tamper] of cases) {
    const r = await passkeySignIn(new Device("192.0.2.55"), phoneKey, { tamper });
    if (r.status === 200) wrong.push(label);
  }
  need(!wrong.length, "accepted: " + wrong.join(", "));
  const control = await passkeySignIn(new Device("192.0.2.55"), phoneKey);
  need(control.status === 200, "positive control (untampered, counter above the stored one) answered " + control.status);
  return cases.length + " refused (every counter above the stored one); the untampered control passed";
});
await check("D8. CONCURRENCY: two valid assertions carrying the SAME counter, verified at once — exactly one passes (the counter is re-checked inside the synchronous commit)", async () => {
  const cur = stateFile().passkeys.find((p) => p.slot === phoneSlot).signCount;
  const d = new Device("192.0.2.56");
  const [o1, o2] = [await signInOptions(d), await signInOptions(d)];
  const a1 = phoneKey.get({ challenge: o1.challenge, rpId: RP_ID, origin: APP, counter: cur + 1 });
  const a2 = phoneKey.get({ challenge: o2.challenge, rpId: RP_ID, origin: APP, counter: cur + 1 });
  const [r1, r2] = await Promise.all([
    direct("POST", "/api/owner-login/passkey/verify", { device: new Device("192.0.2.57"), body: a1 }),
    direct("POST", "/api/owner-login/passkey/verify", { device: new Device("192.0.2.58"), body: a2 }),
  ]);
  need([r1.status, r2.status].sort().join(",") === "200,401", `statuses ${r1.status}, ${r2.status}`);
  phoneKey.counter = cur + 1;
  return "200 + 401";
});
await check("D9. a passkey session cannot register another passkey (403 passphrase_required) — a stolen phone cannot mint itself a lasting way in", async () => {
  const o = await registerOptions(phoneSession);
  need(o.status === 403 && o.json?.code === "passphrase_required", "answered " + o.status + " " + JSON.stringify(o.json));
});

// ================================================================================================ E. revocation
section("E. revocation: removing a passkey, sign out everywhere, a new passphrase");
await check("E1. REMOVE a passkey: its assertions are refused, and the sessions it signed in — the session of the device that ADDED it included (review UX-1) — die at the gate and at the backstop, at once, not after a cache TTL, while other sessions live on", async () => {
  const admin = new Device("192.0.2.60");
  await passphraseLogin(admin);
  const fifth = stateFile().passkeys.find((p) => p.name === "fifth");
  need(fifth, "(precondition) the 'fifth' passkey is registered");
  const room = await direct("POST", "/api/owner-login/security", { device: admin, body: { action: "remove", slot: fifth.slot } });
  need(room.status === 200, "making room answered " + room.status);
  // the tablet adds its own Face ID from a fresh passphrase session — and is then signed in WITH it
  const tabletReg = new Device("192.0.2.65");
  await passphraseLogin(tabletReg);
  const tablet = new SoftAuthenticator({ alg: -7 });
  const reg = await register(tabletReg, tablet, { name: "Tablet" });
  need(reg.status === 200, "register " + reg.status);
  need(cookieParts(tabletReg.session)[4] === reg.json.passkey.slot, "the adding device is not signed in with its new passkey");
  const tabletDev = new Device("192.0.2.61");
  const s = await passkeySignIn(tabletDev, tablet);
  need(s.status === 200, "tablet sign-in " + s.status);
  need(await gateAdmits(tabletDev), "the tablet session was not admitted before removal");
  need(await gateAdmits(tabletReg), "the adding device's session was not admitted before removal");
  need(await gateAdmits(phoneSession), "the phone session was not admitted before removal"); // warms the gate's cache
  // removal goes THROUGH the gate (as in the browser), which drops its cached state
  const rm = await send("POST", "/api/owner-login/security", { device: admin, body: { action: "remove", slot: reg.json.passkey.slot } });
  need(rm.status === 200 && rm.json?.signedOut === false, "remove " + rm.status + " " + JSON.stringify(rm.json));
  for (const [label, d] of [["a passkey sign-in", tabletDev], ["the adding device", tabletReg]]) {
    const api = await send("GET", "/api/personas", { device: d });
    const page = await send("GET", "/home", { device: d });
    need(api.stage === "middleware" && api.status === 401 && page.status === 303, `${label}: api ${api.stage} ${api.status}, page ${page.status}`);
    need((await backstopRefuses(d)) === true, `the backstop still accepts ${label}'s session`);
  }
  const again = await passkeySignIn(new Device("192.0.2.62"), tablet);
  need(again.status === 401, "the removed passkey signed in: " + again.status);
  need(await gateAdmits(phoneSession), "the phone session died with the tablet's passkey");
  need(await gateAdmits(admin), "the passphrase session died");
  return "removed passkey: assertion 401; its two sessions (sign-in, and the device that added it) 401/303 at the gate, refused at the backstop; others live";
});
await check("E2. a session removing ITS OWN passkey is told it signed itself out, and its cookies are cleared", async () => {
  const admin = new Device("192.0.2.63");
  await passphraseLogin(admin);
  const own = new SoftAuthenticator({ alg: -7 });
  const reg = await register(admin, own, { name: "Spare" });
  need(reg.status === 200, "register " + reg.status);
  const dev = new Device("192.0.2.64");
  need((await passkeySignIn(dev, own)).status === 200, "sign-in");
  const rm = await direct("POST", "/api/owner-login/security", { device: dev, body: { action: "remove", slot: reg.json.passkey.slot } });
  need(rm.status === 200 && rm.json?.signedOut === true, "answered " + rm.status + " " + JSON.stringify(rm.json));
  need(!dev.jar.has(access.OWNER_COOKIE) && !dev.jar.has(access.OWNER_HINT_COOKIE), "cookies not cleared");
});
await check("E3. SIGN OUT EVERYWHERE: a new epoch on the volume; every cookie (passphrase and passkey, every device, the caller's too) is refused at the gate and the backstop on the very next request; passkeys stay, so one tap gets back in", async () => {
  advance(HOUR);
  const pp = new Device("192.0.2.70");
  await passphraseLogin(pp);
  const pk = new Device("192.0.2.71");
  need((await passkeySignIn(pk, phoneKey)).status === 200, "passkey sign-in");
  const caller = new Device("192.0.2.72");
  await passphraseLogin(caller);
  const devices = [pp, pk, caller, phoneSession];
  for (const d of devices) need(await gateAdmits(d), "a session was not live before the sign-out");
  const oldEpoch = stateFile().epoch;
  const kept = { ...Object.fromEntries(devices.map((d, i) => [i, d.session])) };
  const r = await send("POST", "/api/owner-login/security", { device: caller, body: { action: "signout-everywhere" } });
  need(r.status === 200 && r.json?.signedOut === true, "answered " + r.status + " " + JSON.stringify(r.json));
  need(stateFile().epoch !== oldEpoch, "the epoch did not change");
  need(!caller.jar.has(access.OWNER_COOKIE), "the caller's cookie was not cleared");
  // even the caller's OLD cookie value, replayed, is dead
  caller.jar.set(access.OWNER_COOKIE, kept[2]);
  const results = [];
  for (const d of devices) {
    const api = await send("GET", "/api/personas", { device: d });
    const page = await send("GET", "/home", { device: d });
    const back = await backstopRefuses(d);
    results.push(`${api.status}/${page.status}/${back}`);
    need(api.stage === "middleware" && api.status === 401 && page.status === 303 && back === true, "a cookie survived: " + results.join(" "));
  }
  need(stateFile().passkeys.some((p) => p.slot === phoneSlot), "the passkeys were removed by a sign-out");
  const back = new Device("192.0.2.73");
  need((await passkeySignIn(back, phoneKey)).status === 200, "one tap did not get back in");
  need(await gateAdmits(back), "the new session is not admitted");
  return "4 cookies → " + results.join(" ") + "; one tap back in";
});
await check("E4. the gate's cache never admits a revoked session it already cached as live: warmed, revoked out of band, refused within the TTL bound", async () => {
  const d = new Device("192.0.2.74");
  await passphraseLogin(d);
  need(await gateAdmits(d), "not admitted");
  // revoke WITHOUT passing the gate (as a second instance or an operator would): the cache may serve the old state for
  // at most its TTL (2 s) — then the session is refused
  m.store.withOwnerState((s) => {
    m.store.rotateOwnerEpoch(s);
    return { write: true, result: null };
  });
  advance(2_001);
  need(!(await gateAdmits(d)), "admitted after the TTL");
  return "refused once the 2 s TTL passed";
});
await check("E5. A NEW PASSPHRASE (the kill switch) ends every session AND retires every passkey; the first sign-in with the new passphrase prunes them from the volume", async () => {
  advance(HOUR);
  const d = new Device("192.0.2.75");
  need((await passkeySignIn(d, phoneKey)).status === 200, "sign-in before the rotation");
  const pp = new Device("192.0.2.76");
  await passphraseLogin(pp);
  const NEW = randomBytes(32).toString("base64url");
  process.env.OWNER_ACCESS_SECRET = NEW;
  try {
    freshClockForGate();
    need(!(await gateAdmits(d)) && !(await gateAdmits(pp)), "an old cookie survived the new passphrase");
    const old = await passkeySignIn(new Device("192.0.2.77"), phoneKey);
    need(old.status === 401, "a passkey from the old passphrase signed in: " + old.status);
    const st = await m.store.readOwnerGateState(NEW);
    need(st.slots.length === 0, "the gate state lists retired passkeys");
    need(stateFile().passkeys.length > 0, "(precondition) the file still holds them before the next passphrase sign-in");
    const fresh = new Device("192.0.2.78");
    await passphraseLogin(fresh, { passphrase: NEW });
    need(stateFile().passkeys.length === 0, "the retired passkeys were not pruned");
    need(await gateAdmits(fresh), "the new passphrase's session is not admitted");
    // the owner adds Face ID again (fresh passphrase session): the phone is re-registered
    const rereg = await register(fresh, phoneKey, { name: "Owner's iPhone" });
    need(rereg.status === 200, "re-registration " + rereg.status);
    phoneSlot = rereg.json.passkey.slot;
  } finally {
    process.env.OWNER_ACCESS_SECRET = NEW; // keep running under the new passphrase
  }
  return "old sessions dead, old passkeys retired then pruned, re-added";
});

const SECRET2 = () => process.env.OWNER_ACCESS_SECRET;
await check("E6. only an ADMITTED owner request to the Security route makes the gate distrust its cache: a stranger's POSTs (Security route, passphrase route, passkey route; junk or no cookie) cause no state read at all", async () => {
  advance(HOUR); // past any earlier dirty window
  const owner = new Device("192.0.2.95");
  await passphraseLogin(owner, { passphrase: SECRET2() });
  need(await gateAdmits(owner), "the owner is not admitted"); // warms the cache
  const base = fetchLog.length;
  need(await gateAdmits(owner), "the owner is not admitted (cached)");
  need(fetchLog.length === base, "a fresh cached state was read again");
  const stranger = new Device("192.0.2.96");
  stranger.jar.set(access.OWNER_COOKIE, "v2.junk");
  const s1 = await send("POST", "/api/owner-login/security", { device: stranger, body: { action: "signout-everywhere" } });
  const s2 = await send("POST", "/api/owner-login", { device: new Device("192.0.2.97"), body: { passphrase: "x".repeat(20) }, origin: null });
  const s3 = await send("POST", "/api/owner-login/passkey/verify", { device: new Device("192.0.2.98"), body: {} });
  need(s1.status === 401 && s2.status === 401 && s3.status === 400, `stranger statuses ${s1.status}/${s2.status}/${s3.status}`);
  need(await gateAdmits(owner), "the owner was refused after a stranger's POSTs");
  need(fetchLog.length === base, `a stranger's POSTs made the gate read its state (${fetchLog.length - base} read(s))`);
  // positive control: the owner's own Security POST (renaming a slot that does not exist — the route answers 404)
  const own = await send("POST", "/api/owner-login/security", { device: owner, body: { action: "rename", slot: "0".repeat(16), name: "x" } });
  need(own.stage === "route" && own.status === 404, "the owner's Security POST: " + own.stage + " " + own.status);
  const afterOwn = fetchLog.length;
  need(await gateAdmits(owner), "the owner was refused after their own Security POST");
  need(fetchLog.length > afterOwn, "the owner's Security POST did not make the gate re-read its state");
  return "stranger POSTs: 0 reads; the owner's own Security POST: the next request re-reads";
});

// ================================================================================================ F. failure
section("F. failure is a refusal, never an admission");
await check("F1. the gate's state cannot be read (loopback down): routes 503 owner_gate_unavailable, pages 503 — never admitted; back to normal when it heals", async () => {
  const d = new Device("192.0.2.80");
  await passphraseLogin(d, { passphrase: SECRET2() });
  freshClockForGate();
  fetchMode = "fail";
  try {
    const api = await send("GET", "/api/personas", { device: d });
    const page = await send("GET", "/home", { device: d });
    need(api.stage === "middleware" && api.status === 503 && api.json?.code === "owner_gate_unavailable", "api " + api.stage + " " + api.status);
    need(page.stage === "middleware" && page.status === 503 && /could not check/.test(await page.res.text()), "page " + page.stage + " " + page.status);
    need(page.res.headers.get("x-frame-options") === "DENY", "the 503 page is frameable");
  } finally {
    fetchMode = "ok";
  }
  freshClockForGate();
  need(await gateAdmits(d), "not admitted after the loopback healed");
  return "503 both; admitted again after";
});
await check("F2. the state route answers a malformed state: 503, never admitted", async () => {
  const d = new Device("192.0.2.81");
  await passphraseLogin(d, { passphrase: SECRET2() });
  freshClockForGate();
  fetchMode = "malformed";
  try {
    const api = await send("GET", "/api/personas", { device: d });
    need(api.stage === "middleware" && api.status === 503, "answered " + api.stage + " " + api.status);
  } finally {
    fetchMode = "ok";
  }
});
await check("F3. a CORRUPT state file: the state route 503 → the gate 503; passkey sign-in 503 (never 200); a passphrase sign-in moves it aside and starts fresh (new epoch, no passkeys, old cookies dead)", async () => {
  const d = new Device("192.0.2.82");
  await passphraseLogin(d, { passphrase: SECRET2() });
  const keep = readFileSync(STATE_FILE, "utf8");
  writeFileSync(STATE_FILE, "{ not json");
  freshClockForGate();
  const api = await send("GET", "/api/personas", { device: d });
  need(api.stage === "middleware" && api.status === 503, "gate answered " + api.stage + " " + api.status);
  const pk = await passkeySignIn(new Device("192.0.2.83"), phoneKey);
  need(pk.status === 503, "passkey sign-in answered " + pk.status);
  const fresh = new Device("192.0.2.84");
  await passphraseLogin(fresh, { passphrase: SECRET2() });
  const aside = readdirSync(VOLUME).filter((f) => f.startsWith("owner-passkeys.json.unreadable-"));
  need(aside.length === 1, "the unreadable file was not kept aside");
  need(stateFile().passkeys.length === 0 && stateFile().epoch !== JSON.parse(keep).epoch, "not a fresh state");
  freshClockForGate();
  need(!(await gateAdmits(d)), "a cookie from before the reset survived");
  need(await gateAdmits(fresh), "the fresh session is not admitted");
  // re-register the phone for the rest of the run
  const rereg = await register(fresh, phoneKey, { name: "Owner's iPhone" });
  need(rereg.status === 200, "re-registration " + rereg.status);
  phoneSlot = rereg.json.passkey.slot;
  return "moved aside as " + aside[0].replace(/\d+$/, "<ms>");
});
await check("F4. a v1 cookie (the old one-day passphrase cookie) and tampered v2 cookies (via changed to 'p', epoch changed, exp extended) are refused", async () => {
  const d = new Device("192.0.2.85");
  need((await passkeySignIn(d, phoneKey)).status === 200, "sign-in");
  const parts = cookieParts(d.session);
  const forged = [
    `v1.${clock.t + DAY}.${"a".repeat(32)}.${"b".repeat(64)}`,
    [parts[0], parts[1], parts[2], parts[3], "p", parts[5], parts[6]].join("."),
    [parts[0], parts[1], parts[2], "c".repeat(32), parts[4], parts[5], parts[6]].join("."),
    [parts[0], parts[1], String(Number(parts[2]) + DAY), parts[3], parts[4], parts[5], parts[6]].join("."),
    [parts[0], "0" + parts[1], parts[2], parts[3], parts[4], parts[5], parts[6]].join("."),
  ];
  for (const f of forged) {
    const x = new Device("192.0.2.86");
    x.jar.set(access.OWNER_COOKIE, f);
    need(!(await gateAdmits(x)), "a forged cookie was admitted");
    need(await backstopRefuses(x), "the backstop accepted a forged cookie");
  }
  return forged.length + " forged cookies refused";
});
await check("F5. no state source registered in a process: the backstop REFUSES a valid session (never fails open)", async () => {
  const d = new Device("192.0.2.87");
  await passphraseLogin(d, { passphrase: SECRET2() });
  const key = Symbol.for("layers.owner.gateStateSource");
  const saved = globalThis[key];
  globalThis[key] = undefined;
  try {
    need((await access.ownerSessionRefused(() => d.session)) === true, "accepted with no state source");
  } finally {
    globalThis[key] = saved;
  }
  need((await access.ownerSessionRefused(() => d.session)) === false, "refused with the source restored");
});

// ================================================================================================ G. lifetime
section("G. session lifetime: OWNER_SESSION_DAYS (default 30, cap 90), expiry");
await check("G1. OWNER_SESSION_DAYS (a browser's sign-in): unset → 30 days; 7 → 7; 365 → capped at 90; 'abc', '0', '-5', '1.5' → 30 — in the cookie and in Max-Age", async () => {
  const rows = [[undefined, 30], ["7", 7], ["365", 90], ["90", 90], ["abc", 30], ["0", 30], ["-5", 30], ["1.5", 30]];
  const wrong = [];
  for (const [v, days] of rows) {
    if (v === undefined) delete process.env.OWNER_SESSION_DAYS;
    else process.env.OWNER_SESSION_DAYS = v;
    const d = new Device("192.0.2.90");
    const r = await formLogin(d, { passphrase: SECRET2() });
    const parts = cookieParts(d.session);
    const sc = r.headers.getSetCookie().find((c) => c.startsWith(access.OWNER_COOKIE + "="));
    const ok = Number(parts[2]) - Number(parts[1]) === days * DAY && sc.includes(`Max-Age=${days * 86400}`);
    if (!ok) wrong.push(`${v} → ${(Number(parts[2]) - Number(parts[1])) / DAY} days`);
  }
  delete process.env.OWNER_SESSION_DAYS;
  need(!wrong.length, wrong.join(", "));
  return rows.length + " settings";
});
await check("G2. a 30-day (browser) session is valid on day 29 and refused on day 31; lowering OWNER_SESSION_DAYS to 7 refuses a 30-day cookie at once", async () => {
  const d = new Device("192.0.2.91");
  await formLogin(d, { passphrase: SECRET2() });
  advance(29 * DAY);
  freshClockForGate();
  need(await gateAdmits(d), "refused on day 29");
  advance(2 * DAY);
  need(!(await gateAdmits(d)), "admitted on day 31");
  const e = new Device("192.0.2.92");
  await formLogin(e, { passphrase: SECRET2() });
  process.env.OWNER_SESSION_DAYS = "7";
  try {
    need(!(await gateAdmits(e)), "a 30-day cookie survived OWNER_SESSION_DAYS=7");
  } finally {
    delete process.env.OWNER_SESSION_DAYS;
  }
});

// ================================================================================================ H. metering
section("H. the passkey routes are metered like the passphrase route");
await check("H1. per address: the 11th sign-in POST within the budget is 429 'too many login attempts'; another address still passes; the passphrase route's budget is separate", async () => {
  advance(HOUR);
  const d = new Device("192.0.2.100");
  const statuses = [];
  for (let i = 0; i < 11; i++) {
    const r = await m.mw.middleware(makeReq("POST", "/api/owner-login/passkey/options", { device: d, body: {} }));
    statuses.push(r.headers.get("x-middleware-next") === "1" ? "pass" : String(r.status));
  }
  need(statuses.slice(0, 10).every((s) => s === "pass") && statuses[10] === "429", "statuses " + statuses.join(","));
  const verify = await m.mw.middleware(makeReq("POST", "/api/owner-login/passkey/verify", { device: d, body: {} }));
  need(verify.status === 429, "verify shares the address's passkey budget: " + verify.status);
  const other = await m.mw.middleware(makeReq("POST", "/api/owner-login/passkey/options", { device: new Device("192.0.2.101"), body: {} }));
  need(other.headers.get("x-middleware-next") === "1", "another address was throttled");
  const pass = await m.mw.middleware(makeReq("POST", "/api/owner-login", { device: d, body: {} }));
  need(pass.headers.get("x-middleware-next") === "1", "the passphrase route shared the passkey budget");
  return "10 pass, 11th 429";
});
await check("H2. globally: 30 sign-in POSTs across rotating addresses, then 429 for everyone", async () => {
  advance(HOUR);
  let passedCount = 0;
  let first429 = -1;
  for (let i = 0; i < 31; i++) {
    const r = await m.mw.middleware(makeReq("POST", "/api/owner-login/passkey/verify", { device: new Device(`10.9.${i}.1`), body: {} }));
    if (r.headers.get("x-middleware-next") === "1") passedCount++;
    else if (first429 < 0 && r.status === 429) first429 = i;
  }
  need(passedCount === 30 && first429 === 30, `passed ${passedCount}, first 429 at ${first429}`);
});

// ================================================================================================ I. other surfaces
section("I. the rest: Security actions, names, the device bundle");
await check("I1. the Security route is JSON-only and same-origin: a cross-site Origin 403, no Origin 403, a form body 415", async () => {
  const d = new Device("192.0.2.110");
  await passphraseLogin(d, { passphrase: SECRET2() });
  const a = await direct("POST", "/api/owner-login/security", { device: d, body: { action: "signout-everywhere" }, origin: "https://evil.example.test" });
  const b = await direct("POST", "/api/owner-login/security", { device: d, body: { action: "signout-everywhere" }, origin: null });
  const c = await direct("POST", "/api/owner-login/security", { device: d, raw: "action=signout-everywhere", headers: { "content-type": "application/x-www-form-urlencoded" } });
  need(a.status === 403 && b.status === 403 && c.status === 415, `statuses ${a.status},${b.status},${c.status}`);
  need(await gateAdmits(d), "a refused request signed everyone out");
});
await check("I2. rename: control and bidi characters stripped, whitespace collapsed, 40 characters at most; an unknown slot 404", async () => {
  const d = new Device("192.0.2.111");
  await passphraseLogin(d, { passphrase: SECRET2() });
  const r = await direct("POST", "/api/owner-login/security", { device: d, body: { action: "rename", slot: phoneSlot, name: "  My\u202e  phone\u0007 " + "x".repeat(60) } });
  need(r.status === 200, "rename " + r.status);
  const name = stateFile().passkeys.find((p) => p.slot === phoneSlot).name;
  need(!/[\u202e\u0007]/.test(name) && !/\s\s/.test(name) && [...name].length <= 40 && name.startsWith("My phone"), "stored name " + JSON.stringify(name));
  const u = await direct("POST", "/api/owner-login/security", { device: d, body: { action: "rename", slot: "0".repeat(16), name: "x" } });
  need(u.status === 404, "unknown slot " + u.status);
  return JSON.stringify(name);
});
await check("I3. the device bundle: scripts/device-routes.mjs (run on scratch copies) — the prefix rule removes EXACTLY the four owner-login routes beyond the exact rule; the whole server-only expansion is the exact expected set (the six old entries, the four owner-login routes, fc/connect and fc/connector); fc/connector is kept out by its OWN entry, never swallowed as a child of fc/connect; the server-only list carries /api/fc/connect and /api/fc/connector", async () => {
  const src = readFileSync(path.join(ROOT, "scripts", "device-routes.mjs"), "utf8");
  const OLD_FILTER = ".filter((rel) => !SERVER_ONLY.has(rel))";
  const NEW_FILTER = ".filter((rel) => !isServerOnly(rel))";
  const NO_FILTER = ".filter(() => true)";
  need(src.includes(NEW_FILTER), "the generator no longer filters with isServerOnly — this check cannot run");
  const runVariant = (label, text) => {
    const out = path.join(TMP, `routes.${label}.ts`);
    const patched = text.replace(/const ROOT = [^\n]+\n/, `const ROOT = ${JSON.stringify(ROOT)};\n`).replace(/const OUT = [^\n]+\n/, `const OUT = ${JSON.stringify(out)};\n`);
    need(patched.includes(JSON.stringify(out)), "could not retarget the generator");
    const copy = path.join(TMP, `device-routes.${label}.mjs`);
    writeFileSync(copy, patched);
    execFileSync(process.execPath, [copy], { stdio: "pipe" });
    const gen = readFileSync(out, "utf8");
    return { gen, imports: new Set([...gen.matchAll(/@\/app\/api\/(.+?)\/route"/g)].map((x) => x[1])) };
  };
  const now = runVariant("now", src);
  const before = runVariant("exact", src.replace(NEW_FILTER, OLD_FILTER));
  const whole = runVariant("none", src.replace(NEW_FILTER, NO_FILTER));
  // (1) what the PREFIX rule removes beyond the old exact rule: the four owner-login subroutes, and nothing else.
  // CONNECT MAIN added "fc/connect" to SERVER_ONLY: it has no subroutes (app/api/fc/connect/route.ts only), so the
  // exact rule and the prefix rule both drop it and it never shows in this difference — it shows in (2).
  const removed = [...before.imports].filter((r) => !now.imports.has(r)).sort();
  const added = [...now.imports].filter((r) => !before.imports.has(r));
  need(removed.join(",") === "owner-login/passkey/options,owner-login/passkey/verify,owner-login/security,owner-login/state", "the prefix rule removed beyond the exact rule: " + removed.join(","));
  need(added.length === 0, "the prefix rule added: " + added.join(","));
  // (2) the whole server-only expansion, against the UNFILTERED table: the exact set, the fc/connect route named.
  // CONNECTOR SETUP (verify): "fc/connector" is its own entry now (viem's signer stays out of the public bundle)
  const kept = [...whole.imports].filter((r) => !now.imports.has(r)).sort();
  const EXPECTED_SERVER_ONLY_EXPANSION = ["custody/passkey/challenge", "custody/passkey/release", "dev/live", "fc/connect", "fc/connector", "fc/read", "health", "owner-login", "owner-login/passkey/options", "owner-login/passkey/verify", "owner-login/security", "owner-login/state"];
  need(kept.join(",") === EXPECTED_SERVER_ONLY_EXPANSION.join(","), "the server keeps: " + kept.join(","));
  need(whole.imports.has("fc/connect") && !now.imports.has("fc/connect"), "fc/connect is not a route of the app, or it is still in the device's table");
  need(whole.imports.has("fc/connector") && !now.imports.has("fc/connector"), "fc/connector is not a route of the app, or it is still in the device's table");
  need(![...now.imports].some((r) => r.startsWith("owner-login")), "an owner-login route is in the device's table");
  // (3) prefix semantics are "/api/<entry>" and "/api/<entry>/…", never a sibling that merely starts with the same
  // letters. fc/connector leaves the table by its OWN entry: with that entry removed (a variant of the generator),
  // fc/connect's prefix must NOT take fc/connector with it — the sibling stays in the table while fc/connect is gone.
  const WITHOUT_CONNECTOR = src.replace(', "fc/connector"]', "]");
  need(WITHOUT_CONNECTOR !== src, "could not build the generator variant without the fc/connector entry (the SERVER_ONLY line changed shape)");
  const sibling = runVariant("sibling", WITHOUT_CONNECTOR);
  need(sibling.imports.has("fc/connector") && !sibling.imports.has("fc/connect"), "without its own entry fc/connector was swallowed by fc/connect's prefix (or fc/connect came back): " + [...sibling.imports].filter((r) => r.startsWith("fc/")).join(","));
  const so = JSON.parse(now.gen.match(/export const SERVER_ONLY_ROUTES = (\[[^\]]*\])/)[1]);
  need(so.join(",") === "/api/health,/api/dev/live,/api/custody/passkey/challenge,/api/custody/passkey/release,/api/owner-login,/api/fc/read,/api/fc/connect,/api/fc/connector", "server-only list " + so.join(","));
  // the checked-in table, for the record: any difference is routes added by other work since it was generated (the
  // build regenerates it: npm run build → scripts/build-device.mjs)
  const repo = new Set([...readFileSync(path.join(ROOT, "lib", "device", "routes.generated.ts"), "utf8").matchAll(/@\/app\/api\/(.+?)\/route"/g)].map((x) => x[1]));
  const pending = [...now.imports].filter((r) => !repo.has(r));
  need(!pending.some((r) => r.startsWith("owner-login")), "the checked-in table would gain an owner-login route");
  return `prefix rule: exactly 4 removed beyond the exact rule, 0 added; whole server-only expansion = ${kept.length} routes incl. fc/connect and fc/connector; the sibling stays when its own entry is removed; checked-in table otherwise behind by ${pending.length} route(s) from other work (${pending.join(", ") || "none"})`;
});
await check("I4. the store file location: beside KEYSTORE_DIR on its volume; OWNER_PASSKEYS_FILE overrides; no KEYSTORE_DIR → inside .keystore/ (gitignored), never the repo root", async () => {
  const f = m.store.ownerStateFile;
  need(f({ KEYSTORE_DIR: "/data/keystore" }).replace(/\\/g, "/").endsWith("/data/owner-passkeys.json"), "/data/keystore → " + f({ KEYSTORE_DIR: "/data/keystore" }));
  need(f({ KEYSTORE_DIR: "/data" }).replace(/\\/g, "/").endsWith("/data/owner-passkeys.json"), "/data → " + f({ KEYSTORE_DIR: "/data" }));
  need(f({ OWNER_PASSKEYS_FILE: path.join(TMP, "x.json"), KEYSTORE_DIR: "/data/keystore" }) === path.join(TMP, "x.json"), "override ignored");
  need(f({}).replace(/\\/g, "/").endsWith("/.keystore/owner-passkeys.json"), "rig default " + f({}));
});

// ================================================================================================ J. the review, server side
section("J. the review's findings, server side: each driven to the failure it described — now refused, or fixed");
/** a Set-Cookie header for a failure message: never the cookie's value */
const redact = (sc) => String(sc ?? "(none)").replace(/^([^=;]+)=[^;]*/, "$1=<value>");
const HINT = access.OWNER_HINT_COOKIE;
const b64id = (bytes) => Buffer.from(bytes).toString("base64url");
async function liveIds() {
  const binding = await access.ownerPasskeyBinding(SECRET2());
  return stateFile()
    .passkeys.filter((p) => p.binding === binding)
    .map((p) => p.id)
    .sort();
}

await check("J1 (PK-1). a 40-emoji name (40 code points, 80 UTF-16 units) is taken by rename AND by registration, stored whole, and the state still reads back — the gate keeps admitting the owner and one tap keeps working (before: the reader rejected it, the whole gate answered 503, and the only way out forgot every passkey)", async () => {
  advance(HOUR);
  const owner = new Device("192.0.2.120");
  await passphraseLogin(owner);
  const emoji = "\u{1F600}".repeat(40);
  const r = await direct("POST", "/api/owner-login/security", { device: owner, body: { action: "rename", slot: phoneSlot, name: emoji } });
  need(r.status === 200, "rename answered " + r.status + " " + JSON.stringify(r.json));
  const stored = stateFile().passkeys.find((p) => p.slot === phoneSlot).name;
  need([...stored].length === 40 && stored.length === 80, `stored ${[...stored].length} code points / ${stored.length} UTF-16 units`);
  need(store.readOwnerState() !== null, "the state does not read back");
  freshClockForGate();
  need(await gateAdmits(owner), "the gate no longer admits the owner after the rename");
  need((await passkeySignIn(new Device("192.0.2.121"), phoneKey)).status === 200, "one tap stopped working after the rename");
  // registration with such a name: 20 flags (40 code points, 80 units)
  const regDev = new Device("192.0.2.122");
  await passphraseLogin(regDev);
  const flags = "\u{1F1FA}\u{1F1F8}".repeat(20);
  const reg = await register(regDev, new SoftAuthenticator({ alg: -7 }), { name: flags });
  need(reg.status === 200 && reg.json?.passkey?.name === flags, "registration answered " + reg.status + " " + JSON.stringify(reg.json));
  need(store.readOwnerState() !== null, "the state does not read back after the registration");
  // the registration went straight to the route (not through the gate, which would have dropped its cache), and the
  // device now holds a session naming the NEW passkey: let the gate's 2 s cache age out, as a real request would not need
  freshClockForGate();
  need(await gateAdmits(regDev), "the gate refused the device's new passkey session after the registration");
  // every awkward shape through the cleaner lands inside the reader's rule
  for (const raw of ["\u{1F600}".repeat(60), "\u{1F1FA}\u{1F1F8}".repeat(30), "a".repeat(400), "\u{1F468}‍\u{1F469}‍\u{1F467}".repeat(12), "é".repeat(50), " ‮ x \u0007 "]) {
    const c = store.cleanPasskeyName(raw);
    need(c === null || store.passkeyNameFits(c), "the cleaner made a name the reader rejects, from " + JSON.stringify(raw.slice(0, 6)));
  }
  const tidy = await direct("POST", "/api/owner-login/security", { device: regDev, body: { action: "remove", slot: reg.json.passkey.slot } });
  need(tidy.status === 200, "tidy " + tidy.status);
  return "rename 200 (40 code points / 80 units stored), the state reads back, the gate admits, one tap works; a 20-flag registration 200";
});

await check("J2 (PK-1, PK-2). THE WRITER'S GUARD: a write the reader would reject is refused before anything is written (OwnerStateError 'rejected') — a 41-character name, an empty name, a 4-byte credential id, a repeated slot; the file stays byte-for-byte the same and no temp file is left", async () => {
  const before = readFileSync(STATE_FILE, "utf8");
  const cases = [
    ["a 41-character name", (s) => (s.passkeys[0].name = "x".repeat(41))],
    ["an empty name", (s) => (s.passkeys[0].name = "")],
    ["a 4-byte credential id", (s) => (s.passkeys[0].id = b64id(randomBytes(4)))],
    ["a repeated slot", (s) => s.passkeys.push({ ...s.passkeys[0], id: b64id(randomBytes(32)) })],
  ];
  need(stateFile().passkeys.length >= 1, "(precondition) a passkey to change");
  for (const [label, mutate] of cases) {
    let threw = null;
    try {
      store.withOwnerState((s) => {
        mutate(s);
        return { write: true, result: null };
      });
    } catch (e) {
      threw = e;
    }
    need(threw && threw.kind === "rejected", `${label}: ${threw ? "failed as '" + threw.kind + "'" : "WRITTEN"}`);
    need(readFileSync(STATE_FILE, "utf8") === before, label + ": the file changed");
  }
  need(!readdirSync(VOLUME).some((f) => f.endsWith(".tmp")), "a temp file was left on the volume");
  need(store.readOwnerState() !== null, "the state does not read back");
  return cases.length + " refused, the file untouched";
});

await check("J3 (PK-2). credential ids shorter than 16 bytes are refused at registration (400) and never stored — 4 bytes, and 12 and 15 (which the reader alone would take); 16 bytes registers; the state reads back and the session lives (before: a 4-byte id was stored and locked the gate)", async () => {
  const d = new Device("192.0.2.125");
  await passphraseLogin(d);
  const count = stateFile().passkeys.length;
  for (const n of [4, 12, 15]) {
    const k = new SoftAuthenticator({ alg: -7 });
    k.credId = randomBytes(n);
    const r = await register(d, k, { name: "short " + n });
    need(r.status === 400, `a ${n}-byte id answered ${r.status} ${JSON.stringify(r.json)}`);
  }
  need(stateFile().passkeys.length === count, "a short id was stored");
  need(store.readOwnerState() !== null && (await gateAdmits(d)), "the state or the session broke");
  const k16 = new SoftAuthenticator({ alg: -7 });
  k16.credId = randomBytes(16);
  const ok = await register(d, k16, { name: "sixteen" });
  need(ok.status === 200, "a 16-byte id answered " + ok.status);
  const tidy = await direct("POST", "/api/owner-login/security", { device: d, body: { action: "remove", slot: ok.json.passkey.slot } });
  need(tidy.status === 200, "tidy " + tidy.status);
  return "4 / 12 / 15 bytes → 400, nothing stored; 16 bytes → 200";
});

await check("J4 (PK-4). a SCRIPT's sign-in (JSON) lasts a day — exp−iat 24 h, Max-Age=86400, expiresInSeconds 86400 — and the gate refuses it after that; a browser's form sign-in still lasts OWNER_SESSION_DAYS; with OWNER_SESSION_DAYS=1 a script's is still a day", async () => {
  const script = new Device("192.0.2.126");
  const r = await passphraseLogin(script);
  const p = cookieParts(script.session);
  need(Number(p[2]) - Number(p[1]) === DAY, "a script session lasts " + (Number(p[2]) - Number(p[1])) / HOUR + " h");
  need(/Max-Age=86400(;|$)/.test(setCookieFor(r, access.OWNER_COOKIE) ?? ""), "Set-Cookie " + redact(setCookieFor(r, access.OWNER_COOKIE)));
  need(r.json?.expiresInSeconds === 86400, "expiresInSeconds " + r.json?.expiresInSeconds);
  const browser = new Device("192.0.2.127");
  await formLogin(browser);
  const b = cookieParts(browser.session);
  need(Number(b[2]) - Number(b[1]) === 30 * DAY, "a browser session lasts " + (Number(b[2]) - Number(b[1])) / DAY + " days");
  advance(DAY + MIN);
  freshClockForGate();
  need(!(await gateAdmits(script)), "a script session lived past a day");
  need(await gateAdmits(browser), "the browser session died with the script's");
  process.env.OWNER_SESSION_DAYS = "1";
  try {
    const s2 = new Device("192.0.2.128");
    const r2 = await passphraseLogin(s2);
    const q = cookieParts(s2.session);
    need(Number(q[2]) - Number(q[1]) === DAY && r2.json?.expiresInSeconds === 86400, "with OWNER_SESSION_DAYS=1: " + (Number(q[2]) - Number(q[1])) / HOUR + " h");
  } finally {
    delete process.env.OWNER_SESSION_DAYS;
  }
  return "script 24 h (Max-Age 86400), refused after; browser 30 days";
});

await check("J5 (PK-5). DURABLE writes: on POSIX, AFTER the rename, the state file's directory is opened and fsynced — sign out everywhere, a rename, and both renames of the move-aside of a corrupt file; a directory that cannot be fsynced is logged, never a refusal (the write stands); on Windows no directory is opened", async () => {
  const fs = createRequire(import.meta.url)("node:fs");
  const real = { openSync: fs.openSync, fsyncSync: fs.fsyncSync, closeSync: fs.closeSync, renameSync: fs.renameSync };
  const plat = Object.getOwnPropertyDescriptor(process, "platform");
  const FAKE_FD = 2_000_000_001;
  let spyDir = path.resolve(path.dirname(STATE_FILE));
  let log = [];
  let failDirSync = false;
  fs.openSync = (p, ...rest) => {
    if (typeof p === "string" && path.resolve(p) === spyDir) {
      log.push("open-dir");
      return FAKE_FD;
    }
    return real.openSync(p, ...rest);
  };
  fs.fsyncSync = (fd) => {
    if (fd !== FAKE_FD) {
      log.push("fsync-file");
      return real.fsyncSync(fd);
    }
    log.push("fsync-dir");
    if (failDirSync) throw Object.assign(new Error("EINVAL: invalid argument, fsync"), { code: "EINVAL" });
  };
  fs.closeSync = (fd) => (fd === FAKE_FD ? void log.push("close-dir") : real.closeSync(fd));
  fs.renameSync = (a, b) => {
    log.push("rename");
    return real.renameSync(a, b);
  };
  const ONE = "fsync-file,rename,open-dir,fsync-dir,close-dir";
  try {
    Object.defineProperty(process, "platform", { ...plat, value: "linux" });
    const d = new Device("192.0.2.129");
    await passphraseLogin(d);
    log = [];
    const so = await direct("POST", "/api/owner-login/security", { device: d, body: { action: "signout-everywhere" } });
    need(so.status === 200 && log.join(",") === ONE, "sign out everywhere: " + so.status + " " + log.join(","));
    const d2 = new Device("192.0.2.129");
    await passphraseLogin(d2);
    log = [];
    const rn = await direct("POST", "/api/owner-login/security", { device: d2, body: { action: "rename", slot: phoneSlot, name: "iPhone" } });
    need(rn.status === 200 && log.join(",") === ONE, "rename: " + rn.status + " " + log.join(","));
    // a corrupt file on another volume: moved aside (a rename), then a fresh state written (another)
    const asideDir = path.join(TMP, "aside-volume");
    mkdirSync(asideDir, { recursive: true });
    writeFileSync(path.join(asideDir, "owner-passkeys.json"), "{ not json");
    process.env.OWNER_PASSKEYS_FILE = path.join(asideDir, "owner-passkeys.json");
    spyDir = path.resolve(asideDir);
    log = [];
    try {
      await passphraseLogin(new Device("192.0.2.129"));
    } finally {
      delete process.env.OWNER_PASSKEYS_FILE;
      spyDir = path.resolve(path.dirname(STATE_FILE));
    }
    need(log.join(",") === "rename,open-dir,fsync-dir,close-dir," + ONE, "move-aside: " + log.join(","));
    // a directory that cannot be fsynced: the write stands and the answer is 200
    failDirSync = true;
    const d3 = new Device("192.0.2.129");
    await passphraseLogin(d3);
    const e0 = stateFile().epoch;
    const so2 = await direct("POST", "/api/owner-login/security", { device: d3, body: { action: "signout-everywhere" } });
    need(so2.status === 200 && stateFile().epoch !== e0, "a failed directory fsync: " + so2.status);
    failDirSync = false;
    Object.defineProperty(process, "platform", { ...plat, value: "win32" });
    const d4 = new Device("192.0.2.129");
    await passphraseLogin(d4);
    log = [];
    const so3 = await direct("POST", "/api/owner-login/security", { device: d4, body: { action: "signout-everywhere" } });
    need(so3.status === 200 && !log.includes("open-dir") && log.includes("rename"), "win32: " + log.join(","));
  } finally {
    Object.defineProperty(process, "platform", plat);
    Object.assign(fs, real);
  }
  return "POSIX: " + ONE + " (x2 for the move-aside); EINVAL logged, write kept; win32: no directory opened";
});

await check("J6 (UX-1). A LOST DEVICE — adding Face ID signs the adding device in WITH its new passkey, so Remove from another device ends that device's session at once (before: it kept its passphrase session for weeks); 'Lost this device?' removes the passkey AND draws a new epoch in one write: every session ends, passphrase ones included, the lost passkey cannot tap back in, another device's passkey can; 'lost' for a passkey already gone still signs everything out", async () => {
  advance(HOUR);
  const iphone = new Device("192.0.2.130");
  await formLogin(iphone);
  const reg = await register(iphone, new SoftAuthenticator({ alg: -7, be: true, bs: true, counterStep: 0 }), { name: "iPhone" });
  need(reg.status === 200, "register " + reg.status);
  const slot = reg.json.passkey.slot;
  const p = cookieParts(iphone.session);
  need(p[4] === slot && p[3] === stateFile().epoch, "the adding device is still on " + (p[4] === "p" ? "its passphrase session" : "another session"));
  need(iphone.jar.get(HINT) === slot && /Max-Age=2592000/.test(setCookieFor(reg, access.OWNER_COOKIE) ?? ""), "hint / new cookie " + redact(setCookieFor(reg, access.OWNER_COOKIE)));
  need(await gateAdmits(iphone), "the adding device's new session is not admitted");
  const laptopA = new Device("192.0.2.131");
  await passphraseLogin(laptopA);
  const rm = await send("POST", "/api/owner-login/security", { device: laptopA, body: { action: "remove", slot } });
  need(rm.status === 200 && rm.json?.signedOut === false, "remove " + rm.status);
  need(!(await gateAdmits(iphone)) && (await backstopRefuses(iphone)), "the lost iPhone's session survived Remove (the review's case a)");
  // "Lost this device?": the phone has its passkey in one browser AND a passphrase session in another; the laptop has its own
  const phoneSafari = new Device("192.0.2.132");
  await passphraseLogin(phoneSafari);
  const lostKey = new SoftAuthenticator({ alg: -7, be: true, bs: true, counterStep: 0 });
  const r2 = await register(phoneSafari, lostKey, { name: "iPhone" });
  need(r2.status === 200, "register the phone " + r2.status);
  const lostSlot = r2.json.passkey.slot;
  const phoneChrome = new Device("192.0.2.133");
  await passphraseLogin(phoneChrome);
  const laptopB = new Device("192.0.2.134");
  await passphraseLogin(laptopB);
  const laptopKey = new SoftAuthenticator({ alg: -257 });
  const r3 = await register(laptopB, laptopKey, { name: "Windows PC" });
  need(r3.status === 200, "register the laptop " + r3.status);
  for (const d of [phoneSafari, phoneChrome, laptopB]) need(await gateAdmits(d), "a session was not live before");
  const e0 = stateFile().epoch;
  const lost = await send("POST", "/api/owner-login/security", { device: laptopB, body: { action: "lost", slot: lostSlot } });
  need(lost.status === 200 && lost.json?.removed === true && lost.json?.signedOut === true, "lost answered " + lost.status + " " + JSON.stringify(lost.json));
  const st = stateFile();
  need(st.epoch !== e0 && !st.passkeys.some((x) => x.slot === lostSlot) && st.passkeys.some((x) => x.slot === r3.json.passkey.slot), "not one write of: a new epoch, the lost passkey gone, the rest kept");
  need(!laptopB.jar.has(access.OWNER_COOKIE), "the caller's cookie was not cleared");
  for (const [label, d] of [["its passkey session", phoneSafari], ["its passphrase session", phoneChrome], ["the caller's", laptopB]]) {
    need(!(await gateAdmits(d)) && (await backstopRefuses(d)), "the lost phone's " + label + " survived 'Lost this device?'");
  }
  need((await passkeySignIn(new Device("192.0.2.135"), lostKey)).status === 401, "the lost passkey signed in");
  const back = new Device("192.0.2.136");
  need((await passkeySignIn(back, laptopKey)).status === 200 && (await gateAdmits(back)), "the laptop's own passkey could not get back in with one tap");
  const e1 = stateFile().epoch;
  const again = await direct("POST", "/api/owner-login/security", { device: back, body: { action: "lost", slot: lostSlot } });
  need(again.status === 200 && again.json?.removed === false && stateFile().epoch !== e1, "'lost' for a passkey already gone: " + again.status + " " + JSON.stringify(again.json));
  const tidyDev = new Device("192.0.2.137");
  need((await passkeySignIn(tidyDev, laptopKey)).status === 200, "tidy sign-in");
  need((await direct("POST", "/api/owner-login/security", { device: tidyDev, body: { action: "remove", slot: r3.json.passkey.slot } })).status === 200, "tidy");
  return "Remove ends the adding device's session; Lost: new epoch + passkey gone in one write, the phone's passkey AND passphrase sessions dead, the lost passkey 401, the laptop's passkey one tap back in";
});

await check("J7 (UX-1). a registration whose session was signed out everywhere while the prompt was open is refused 401 at the commit: nothing stored, no session minted for the new epoch", async () => {
  const d = new Device("192.0.2.138");
  await passphraseLogin(d);
  const o = await registerOptions(d);
  need(o.status === 200, "options " + o.status);
  const k = new SoftAuthenticator({ alg: -7 });
  const cred = k.create({ challenge: o.json.options.challenge, rpId: RP_ID, origin: APP, userHandle: o.json.options.user.id });
  const session = await access.readOwnerCookie(d.session, SECRET2());
  store.withOwnerState((s) => {
    store.rotateOwnerEpoch(s); // another device: sign out everywhere, while this prompt is open
    return { write: true, result: null };
  });
  const r = await m.passkeys.verifyOwnerPasskeyRegistration(SECRET2(), m.passkeys.ownerRelyingParty(), session, { name: "late", credential: cred });
  need(!r.ok && r.status === 401 && r.reason === "epoch", "the commit answered " + JSON.stringify(r));
  need(!stateFile().passkeys.some((x) => x.id === b64id(k.credId)), "the late passkey was stored");
  const viaRoute = await direct("POST", "/api/owner-login/security", { device: d, body: { action: "register", name: "late", credential: cred } });
  need(viaRoute.status === 401 && !setCookieFor(viaRoute, access.OWNER_COOKIE), "the route answered " + viaRoute.status);
  return "commit 401 'epoch', nothing stored, nothing minted";
});

await check("J8 (UX-2). THE QR CODE: a sign-in the browser reports as cross-platform (the phone's passkey, used on the laptop) signs the laptop in but sets NO hint — so the laptop's next passphrase sign-in gets the add-Face-ID offer; a live hint already on the device survives it; platform, and a browser that reports nothing, set the hint as before", async () => {
  advance(HOUR);
  const phone = new Device("192.0.2.140");
  await passphraseLogin(phone);
  const pk = new SoftAuthenticator({ alg: -7, be: true, bs: true, counterStep: 0 });
  const reg = await register(phone, pk, { name: "iPhone" });
  need(reg.status === 200, "register " + reg.status);
  const slot = reg.json.passkey.slot;
  const laptop = new Device("192.0.2.141");
  const qr = await passkeySignIn(laptop, pk, { attachment: "cross-platform" });
  need(qr.status === 200 && laptop.session && cookieParts(laptop.session)[4] === slot, "QR sign-in " + qr.status);
  need(!laptop.jar.has(HINT) && !setCookieFor(qr, HINT), "the laptop was told it has the phone's passkey");
  const later = await formLogin(laptop, { next: "/settings/owner-security" });
  need(locationOf(later) === APP + "/owner-login/add-passkey?next=%2Fsettings%2Fowner-security", "the laptop's passphrase sign-in went to " + locationOf(later));
  const ipad = new Device("192.0.2.142");
  need((await passkeySignIn(ipad, pk, { attachment: "platform" })).status === 200 && ipad.jar.get(HINT) === slot, "a platform (synced) sign-in set no hint");
  const old = new Device("192.0.2.143");
  need((await passkeySignIn(old, pk)).status === 200 && old.jar.get(HINT) === slot, "a sign-in that reports no attachment set no hint");
  const laptop2 = new Device("192.0.2.144");
  await passphraseLogin(laptop2);
  const r2 = await register(laptop2, new SoftAuthenticator({ alg: -257 }), { name: "Windows PC" });
  need(r2.status === 200, "register Windows Hello " + r2.status);
  const own = r2.json.passkey.slot;
  const qr2 = await passkeySignIn(laptop2, pk, { attachment: "cross-platform" });
  need(qr2.status === 200 && laptop2.jar.get(HINT) === own, "the laptop's own live hint was replaced or cleared by a QR sign-in");
  // tidy (laptop2 is signed in with the phone's passkey now: its own goes first, then the phone's)
  for (const s of [own, slot]) need((await direct("POST", "/api/owner-login/security", { device: laptop2, body: { action: "remove", slot: s } })).status === 200, "tidy");
  return "QR: signed in, no hint, then the offer; a live hint kept; platform / unreported: hint";
});

await check("J9 (UX-4). 'This isn't my device': the session is re-issued with the SAME issue time, epoch, method and nonce and an expiry at most 2 h away, in a cookie with no Max-Age; the gate admits it, then refuses it after 2 h; a 31-minute-old passphrase session that shortens itself still cannot add a passkey (the enrollment window never restarts)", async () => {
  const d = new Device("192.0.2.145");
  await formLogin(d);
  const before = cookieParts(d.session);
  const r = await direct("POST", "/api/owner-login/security", { device: d, body: { action: "shared-device" } });
  need(r.status === 200 && r.json?.ok === true, "answered " + r.status);
  const sc = setCookieFor(r, access.OWNER_COOKIE) ?? "";
  need(sc && !/max-age/i.test(sc) && /HttpOnly/.test(sc) && /SameSite=Strict/.test(sc), "Set-Cookie " + redact(sc));
  const after = cookieParts(d.session);
  need([1, 3, 4, 5].every((i) => after[i] === before[i]), "the issue time, epoch, method or nonce changed");
  const exp = Number(after[2]);
  need(exp > clock.t && exp <= clock.t + 2 * HOUR, "the expiry is " + Math.round((exp - clock.t) / MIN) + " min away");
  need(await gateAdmits(d), "the shortened session is not admitted");
  advance(2 * HOUR + MIN);
  freshClockForGate();
  need(!(await gateAdmits(d)), "admitted after 2 h");
  const e = new Device("192.0.2.146");
  await passphraseLogin(e);
  advance(31 * MIN);
  need((await direct("POST", "/api/owner-login/security", { device: e, body: { action: "shared-device" } })).status === 200, "shared-device");
  const o = await registerOptions(e);
  need(o.status === 403 && o.json?.code === "passphrase_required", "a stale session shortened itself into enrollment: " + o.status);
  return "same iat/epoch/via/nonce, ≤ 2 h, no Max-Age; refused after 2 h; no enrollment window";
});

await check("J10 (UX-5). a registration challenge that expired under an open prompt answers 400 try_again — the session is still signed in, never 401; renaming or removing a passkey already gone answers 404 passkey_gone", async () => {
  const d = new Device("192.0.2.147");
  await passphraseLogin(d);
  const o = await registerOptions(d);
  need(o.status === 200, "options " + o.status);
  advance(2 * MIN + 1);
  const cred = new SoftAuthenticator({ alg: -7 }).create({ challenge: o.json.options.challenge, rpId: RP_ID, origin: APP, userHandle: o.json.options.user.id });
  const r = await direct("POST", "/api/owner-login/security", { device: d, body: { action: "register", name: "slow", credential: cred } });
  need(r.status === 400 && r.json?.code === "try_again", "an expired registration challenge answered " + r.status + " " + JSON.stringify(r.json));
  need(await gateAdmits(d), "the session is not live");
  for (const action of ["rename", "remove"]) {
    const g = await direct("POST", "/api/owner-login/security", { device: d, body: { action, slot: "0".repeat(16), name: "x" } });
    need(g.status === 404 && g.json?.code === "passkey_gone", action + " answered " + g.status + " " + JSON.stringify(g.json));
  }
  return "400 try_again; 404 passkey_gone";
});

await check("J11 (UX-8). the passphrase FORM never lands on a JSON page: a volume that cannot record the sign-in → 303 /owner-login?error=unavailable&next=<its next>, no session; the 11th form POST from one address → 303 /owner-login?error=busy&next=<its next> (Retry-After kept); a JSON caller still gets the 503 and the 429 JSON", async () => {
  const dirAsFile = path.join(TMP, "state-is-a-directory");
  mkdirSync(dirAsFile, { recursive: true });
  process.env.OWNER_PASSKEYS_FILE = dirAsFile;
  try {
    const f = await direct("POST", "/api/owner-login", { device: new Device("192.0.2.150"), raw: new URLSearchParams({ passphrase: SECRET2(), next: "/settings" }).toString(), headers: FORM });
    need(f.status === 303 && locationOf(f) === APP + "/owner-login?error=unavailable&next=%2Fsettings", "unwritable volume, form: " + f.status + " " + locationOf(f));
    need(!setCookieFor(f, access.OWNER_COOKIE), "a session was minted with no epoch on the volume");
    const j = await direct("POST", "/api/owner-login", { device: new Device("192.0.2.150"), body: { passphrase: SECRET2() }, origin: null });
    need(j.status === 503 && j.json?.code === "owner_state_unavailable", "unwritable volume, JSON: " + j.status);
  } finally {
    delete process.env.OWNER_PASSKEYS_FILE;
  }
  advance(HOUR);
  const typo = new Device("192.0.2.151");
  const seen = [];
  let last;
  for (let i = 0; i < 11; i++) {
    last = await send("POST", "/api/owner-login", { device: typo, raw: new URLSearchParams({ passphrase: "wrong-wrong-wrong-" + i, next: "/settings/owner-security" }).toString(), headers: FORM });
    seen.push(last.stage[0] + last.status);
  }
  need(seen.slice(0, 10).every((s) => s === "r303"), "the first ten: " + seen.join(","));
  need(last.stage === "middleware" && last.status === 303 && locationOf(last) === APP + "/owner-login?error=busy&next=%2Fsettings%2Fowner-security", "the 11th: " + last.stage + " " + last.status + " " + locationOf(last));
  need(Number(last.headers.get("retry-after")) >= 1, "no Retry-After on the 11th");
  // a body that declares no length (chunked) is never read by the middleware: the page still comes back, to /home
  const chunked = await send("POST", "/api/owner-login", { device: typo, raw: new TextEncoder().encode(new URLSearchParams({ passphrase: "x", next: "/settings" }).toString()), headers: FORM });
  need(chunked.stage === "middleware" && chunked.status === 303 && locationOf(chunked) === APP + "/owner-login?error=busy&next=%2Fhome", "a body with no declared length: " + chunked.status + " " + locationOf(chunked));
  const asJson = await send("POST", "/api/owner-login", { device: typo, body: { passphrase: "x".repeat(20) }, origin: null });
  need(asJson.stage === "middleware" && asJson.status === 429 && asJson.json?.error === "too many login attempts", "a JSON caller over the budget: " + asJson.status);
  return "unwritable → 303 error=unavailable; 11th form → 303 error=busy; JSON keeps 503 / 429";
});

await check("J12 (UX-10). a STALE hint is cleared: a passphrase form sign-in from a device whose hint names a removed passkey clears it (and gets the offer); a live hint is kept; a QR sign-in clears a stale one; every successful sign-in carries the Signal API list — the RP ID, the owner's user handle and exactly the live credential ids (no retired, no removed one); a refusal carries none", async () => {
  const phone = new Device("192.0.2.155");
  await passphraseLogin(phone);
  const k = new SoftAuthenticator({ alg: -7 });
  const reg = await register(phone, k, { name: "Old phone" });
  need(reg.status === 200, "register " + reg.status);
  const dead = reg.json.passkey.slot;
  const admin = new Device("192.0.2.156");
  await passphraseLogin(admin);
  need((await direct("POST", "/api/owner-login/security", { device: admin, body: { action: "remove", slot: dead } })).status === 200, "remove elsewhere");
  need(phone.jar.get(HINT) === dead, "(precondition) the phone still carries its hint");
  const f = await formLogin(phone);
  need(/Max-Age=0/.test(setCookieFor(f, HINT) ?? "") && !phone.jar.has(HINT), "the stale hint was not cleared: " + redact(setCookieFor(f, HINT)));
  need(locationOf(f).startsWith(APP + "/owner-login/add-passkey"), "no offer: " + locationOf(f));
  const ipad = new Device("192.0.2.157");
  need((await passkeySignIn(ipad, phoneKey, { attachment: "platform" })).status === 200, "iPad sign-in");
  const kept = ipad.jar.get(HINT);
  const f2 = await formLogin(ipad);
  need(!setCookieFor(f2, HINT) && ipad.jar.get(HINT) === kept && locationOf(f2) === APP + "/home", "a live hint was touched, or the offer shown");
  const laptop = new Device("192.0.2.158");
  laptop.jar.set(HINT, dead);
  need((await passkeySignIn(laptop, phoneKey, { attachment: "cross-platform" })).status === 200 && !laptop.jar.has(HINT), "a stale hint survived a QR sign-in");
  const RETIRED = "f".repeat(16);
  store.withOwnerState((s) => {
    s.passkeys.push({ ...s.passkeys[0], slot: RETIRED, id: b64id(randomBytes(32)), binding: "0".repeat(32), name: "retired" });
    return { write: true, result: null };
  });
  try {
    const sig = await passkeySignIn(new Device("192.0.2.159"), phoneKey);
    need(sig.status === 200, "sign-in " + sig.status);
    const got = sig.json?.signal;
    const want = await liveIds();
    need(got && got.rpId === RP_ID && got.userId === stateFile().userHandle, "the signal's RP ID / user handle");
    need([...got.allAcceptedCredentialIds].sort().join(",") === want.join(","), `the signal lists ${got.allAcceptedCredentialIds.length} ids, the live ones are ${want.length}`);
    need(!got.allAcceptedCredentialIds.includes(b64id(k.credId)), "a removed passkey is in the list");
    const bad = await passkeySignIn(new Device("192.0.2.160"), phoneKey, { tamper: { uv: false } });
    need(bad.status === 401 && bad.json?.signal === undefined, "a refusal carried the list");
  } finally {
    store.withOwnerState((s) => {
      s.passkeys = s.passkeys.filter((x) => x.slot !== RETIRED);
      return { write: true, result: null };
    });
  }
  return "stale hint cleared (form, QR), live hint kept; the signal list = the live ids exactly";
});

await check("J13 (UX-13). 'already signed in?': GET /api/owner-login/security answers {ok:true} to a live session through the gate and 401 at the gate without one; the GET never marks the gate's cache dirty (no extra state read)", async () => {
  advance(HOUR);
  const d = new Device("192.0.2.162");
  await passphraseLogin(d);
  need(await gateAdmits(d), "not admitted"); // warms the cache
  const base = fetchLog.length;
  const r = await send("GET", "/api/owner-login/security", { device: d });
  need(r.stage === "route" && r.status === 200 && r.json?.ok === true, "a live session: " + r.stage + " " + r.status);
  need(await gateAdmits(d), "not admitted after the GET");
  need(fetchLog.length === base, `the GET made the gate re-read its state (${fetchLog.length - base} read(s))`);
  const s = await send("GET", "/api/owner-login/security", { device: new Device("192.0.2.163") });
  need(s.stage === "middleware" && s.status === 401, "no session: " + s.stage + " " + s.status);
  return "200 {ok:true} / 401; no state read";
});

await check("J14 (UX-12). a new passkey is saved under a name he recognises: user.name and user.displayName are 'Totem owner' (the phone's passkey screens and the Passwords app showed 'owner')", async () => {
  const d = new Device("192.0.2.165");
  await passphraseLogin(d);
  const o = await registerOptions(d);
  need(o.status === 200, "options " + o.status);
  need(o.json.options.user.name === "Totem owner" && o.json.options.user.displayName === "Totem owner", "user " + o.json.options.user.name + " / " + o.json.options.user.displayName);
});

// ================================================================================================ K. the review, browser side
section("K. the review's findings, browser side: the browser code end to end through the gate and the routes, the pages as served, the arm script's words");
const STUBS = path.join(TMP, "ui-stubs");
mkdirSync(STUBS, { recursive: true });
const stubFiles = {
  "next/navigation": ["next-navigation.mjs", 'export function useRouter() { return { refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }; }\nexport function usePathname() { return "/"; }\nexport function useSearchParams() { return new URLSearchParams(); }\nexport function redirect(to) { throw Object.assign(new Error("NEXT_REDIRECT " + to), { digest: "NEXT_REDIRECT" }); }\n'],
  "next/link": ["next-link.mjs", 'import { createElement } from "react";\nexport default function Link({ href, children, prefetch, replace, scroll, ...rest }) { return createElement("a", { href: typeof href === "string" ? href : String(href), ...rest }, children); }\n'],
  "next/headers": ["next-headers.mjs", "export function cookies() { const jar = globalThis.__ownerHarnessCookies ?? new Map(); return { get(name) { return jar.has(name) ? { name, value: jar.get(name) } : undefined; } }; }\n"],
  "@/components/Providers": ["providers.mjs", "export function useApp() { return {}; }\n"],
  "server-only": ["server-only.mjs", "export {};\n"],
};
for (const [file, text] of Object.values(stubFiles)) writeFileSync(path.join(STUBS, file), text);
const stubPlugin = {
  name: "ui-stubs",
  setup(b) {
    b.onResolve({ filter: /^(next\/navigation|next\/link|next\/headers|@\/components\/Providers|server-only)$/ }, (a) => ({ path: path.join(STUBS, stubFiles[a.path][0]) }));
  },
};
writeFileSync(
  path.join(TMP, "ui-entry.tsx"),
  [
    'export * as client from "@/lib/owner/passkeyClient";',
    'export * as watch from "@/lib/owner/sessionWatch";',
    'export { OwnerSignIn } from "@/components/owner/OwnerSignIn";',
    'export { AddPasskeyOffer, OfferChoices } from "@/components/owner/AddPasskey";',
    'export { OwnerSecurityPanel, removeConfirmTail, lostConfirmTail, everywhereNote, BACK_HERE } from "@/components/owner/OwnerSecurityPanel";',
    'export { default as OwnerLoginPage } from "@/app/owner-login/page";',
    'export { createElement } from "react";',
    'export { renderToStaticMarkup } from "react-dom/server";',
    "",
  ].join("\n")
);
const UI_OUT = path.join(TMP, mutation ? `ui.${mutationName}.cjs` : "ui.cjs");
await build({
  plugins: [mutationPlugin, stubPlugin],
  absWorkingDir: ROOT,
  entryPoints: [path.join(TMP, "ui-entry.tsx")],
  outfile: UI_OUT,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: ["node20"],
  jsx: "automatic",
  tsconfig: path.join(ROOT, "tsconfig.json"),
  nodePaths: [path.join(ROOT, "node_modules")],
  logLevel: "error",
});
const ui = createRequire(import.meta.url)(UI_OUT);
// the UI bundle carries its own copy of the store, which registered ITS state source over the main bundle's: put the
// main one back, so nothing below depends on which copy answers (both read the same file)
access.registerOwnerStateSource(store.ownerGateStateSource);

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, what, ms = 4000) {
  const until = realNow() + ms;
  while (!cond()) {
    if (realNow() > until) throw new Error("timed out waiting for " + what);
    await realSleep(5);
  }
}
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** a fake browser for lib/owner/passkeyClient.ts: navigator.credentials backed by a SoftAuthenticator, PublicKeyCredential
 *  with conditional mediation and the Signal API, a document with a visibility state — and every relative fetch going
 *  through the real gate and routes as `device`. Restored by restore(). */
function fakeBrowser({ auth, device, attachment = "platform", ua = IPHONE_UA, conditional = true, platform = true, create = {} } = {}) {
  const saved = Object.fromEntries(["window", "navigator", "PublicKeyCredential", "document"].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const calls = { get: [], create: [], signal: [] };
  const pending = [];
  const listeners = new Set();
  const doc = { visibilityState: "visible", addEventListener: (t, f) => t === "visibilitychange" && listeners.add(f), removeEventListener: (t, f) => listeners.delete(f) };
  const toBytes = (s) => new Uint8Array(Buffer.from(s, "base64url"));
  const b64 = (v) => Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).toString("base64url");
  const asAssertion = (a) => ({
    rawId: toBytes(a.rawId).buffer,
    type: "public-key",
    authenticatorAttachment: attachment,
    response: { clientDataJSON: toBytes(a.response.clientDataJSON).buffer, authenticatorData: toBytes(a.response.authenticatorData).buffer, signature: toBytes(a.response.signature).buffer, userHandle: a.response.userHandle ? toBytes(a.response.userHandle).buffer : null },
  });
  class FakePublicKeyCredential {
    static async isUserVerifyingPlatformAuthenticatorAvailable() {
      return platform;
    }
    static async isConditionalMediationAvailable() {
      return conditional;
    }
    static async signalAllAcceptedCredentials(o) {
      calls.signal.push(o);
    }
  }
  const credentials = {
    get(opts) {
      const challenge = b64(opts.publicKey.challenge);
      calls.get.push({ mediation: opts.mediation ?? null, signal: !!opts.signal, uv: opts.publicKey.userVerification, challenge });
      const make = (t = {}) => asAssertion(auth.get({ challenge, rpId: RP_ID, origin: APP, ...t }));
      if (opts.signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
      if (opts.mediation !== "conditional") return Promise.resolve(make());
      return new Promise((resolve, reject) => {
        const entry = { challenge, settled: false, aborted: false };
        entry.pick = (t) => !entry.settled && ((entry.settled = true), resolve(make(t)));
        entry.cancel = () => !entry.settled && ((entry.settled = true), reject(new DOMException("cancelled", "NotAllowedError")));
        opts.signal?.addEventListener("abort", () => !entry.settled && ((entry.settled = entry.aborted = true), reject(new DOMException("aborted", "AbortError"))));
        pending.push(entry);
      });
    },
    async create(opts) {
      const pk = opts.publicKey;
      calls.create.push({ user: pk.user.name, exclude: pk.excludeCredentials.length });
      if (create.mode === "cancel") throw new DOMException("cancelled", "NotAllowedError");
      if (pk.excludeCredentials.some((c) => b64(c.id) === b64id(auth.credId))) throw new DOMException("exists", "InvalidStateError");
      if (create.waitMs) advance(create.waitMs);
      const c = auth.create({ challenge: b64(pk.challenge), rpId: RP_ID, origin: APP, userHandle: b64(pk.user.id) });
      return {
        rawId: toBytes(c.rawId).buffer,
        type: "public-key",
        authenticatorAttachment: "platform",
        response: {
          clientDataJSON: toBytes(c.response.clientDataJSON).buffer,
          getPublicKey: () => toBytes(c.response.publicKey).buffer,
          getPublicKeyAlgorithm: () => c.response.publicKeyAlgorithm,
          getAuthenticatorData: () => toBytes(c.response.authenticatorData).buffer,
          getTransports: () => c.response.transports,
        },
      };
    },
  };
  const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true, enumerable: true });
  define("navigator", { userAgent: ua, maxTouchPoints: 0, credentials });
  define("PublicKeyCredential", FakePublicKeyCredential);
  define("window", globalThis);
  define("document", doc);
  clientDevice = device;
  return {
    calls,
    pending,
    doc,
    show(state) {
      doc.visibilityState = state;
      for (const f of [...listeners]) f();
    },
    restore() {
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete globalThis[k];
      }
      clientDevice = null;
    },
  };
}

await check("K1 (UX-12, UX-5, UX-11, UX-15). THE WORDS: each device's own unlock (Face ID, Touch ID, Windows Hello, …); adding says 'You're still signed in' when cancelled and never talks about the passphrase or signing out; a cancelled sign-in is one more tap; 'not switched on' never blames the browser", async () => {
  const c = ui.client;
  const t = (ua, ratio = 0, touchPoints = 0) => ({ ua, ratio, touchPoints });
  const rows = [
    [t(IPHONE_UA, 2.16), "Face ID"],
    [t(IPHONE_UA, 1.78), "Touch ID"],
    [t("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15", 1.6, 0), "Touch ID"],
    [t("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15", 1.43, 5), "Face ID or Touch ID"],
    [t(WIN_UA), "Windows Hello"],
    [t("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36"), "your fingerprint or screen lock"],
    [t("Mozilla/5.0 (X11; Linux x86_64)"), "Face ID / fingerprint"],
  ];
  for (const [traits, want] of rows) need(c.unlockName(traits) === want, traits.ua.slice(0, 30) + "… → " + c.unlockName(traits));
  const w = (kind, ctx) => c.ownerPasskeyMessage(kind, ctx, "Face ID");
  need(/still signed in/.test(w("cancelled", "offer")) && /Not now/.test(w("cancelled", "offer")), "offer cancel: " + w("cancelled", "offer"));
  need(/still signed in/.test(w("cancelled", "add")) && !/Not now/.test(w("cancelled", "add")), "Security cancel: " + w("cancelled", "add"));
  for (const kind of ["cancelled", "refused", "retry"]) for (const ctx of ["offer", "add"]) need(!/passphrase|signed out/i.test(w(kind, ctx)), `${ctx}/${kind}: ${w(kind, ctx)}`);
  need(w("cancelled", "signin") === "Face ID was cancelled. Tap the button to try again.", "sign-in cancel: " + w("cancelled", "signin"));
  for (const ctx of ["signin", "offer", "add", "manage"]) need(!/browser/i.test(w("off", ctx)) && /switched on/.test(w("off", ctx)), "off (" + ctx + "): " + w("off", ctx));
  need(w("gone", "manage") === "That Face ID / fingerprint sign-in was already removed.", "gone: " + w("gone", "manage"));
  return rows.length + " devices; the add / sign-in / off words";
});

await check("K2 (UX-5, UX-15). the Security route's answers as the owner reads them: 401 → signed out; 400 try_again → try again (never 'signed out'); 404 passkey_gone → already removed; 503 owner_passkeys_unavailable → not switched on; 429 → too many tries", async () => {
  const rows = [
    [401, "owner_login_required", "add", "signed-out"],
    [400, "try_again", "add", "retry"],
    [400, "try_again", "offer", "retry"],
    [400, "owner_passkey_not_added", "add", "retry"],
    [404, "passkey_gone", "manage", "gone"],
    [400, "bad_name", "manage", "bad-name"],
    [503, "owner_passkeys_unavailable", "add", "off"],
    [429, undefined, "manage", "busy"],
    [403, "passphrase_required", "add", "passphrase"],
    [409, "passkey_exists", "offer", "exists"],
    [503, "owner_state_unavailable", "manage", "unavailable"],
  ];
  for (const [status, code, ctx, kind] of rows) {
    const e = ui.client.mapSecurityError(status, code, ctx);
    need(e.kind === kind, `${status} ${code} (${ctx}) → ${e.kind}`);
  }
  return rows.length + " answers";
});

await check("K3 (UX-2, UX-10). ONE TAP from the browser code, end to end: the sign-in reports the authenticator's attachment — the phone over the QR code ('cross-platform') signs the laptop in with NO hint, the device's own passkey ('platform') sets it — and afterwards the browser's passkey manager is told exactly the live passkeys (Signal API)", async () => {
  advance(HOUR);
  const laptop = new Device("192.0.2.170");
  let fb = fakeBrowser({ auth: phoneKey, device: laptop, attachment: "cross-platform", ua: WIN_UA });
  try {
    const to = await ui.client.signInWithPasskey("/settings/owner-security");
    need(to === "/settings/owner-security", "went to " + to);
    need(laptop.session && cookieParts(laptop.session)[4] === phoneSlot, "the laptop is not signed in with the phone's passkey");
    need(!laptop.jar.has(HINT), "the laptop was told it has the phone's passkey");
    need(fb.calls.get.length === 1 && fb.calls.get[0].uv === "required" && fb.calls.get[0].mediation === null, "the get() call " + JSON.stringify(fb.calls.get.map((g) => ({ ...g, challenge: "…" }))));
    const s = fb.calls.signal[0];
    need(fb.calls.signal.length === 1 && s.rpId === RP_ID && s.userId === stateFile().userHandle && [...s.allAcceptedCredentialIds].sort().join(",") === (await liveIds()).join(","), "the Signal API was not told the live list");
  } finally {
    fb.restore();
  }
  const phone = new Device("192.0.2.171");
  fb = fakeBrowser({ auth: phoneKey, device: phone, attachment: "platform" });
  try {
    await ui.client.signInWithPasskey("/home");
    need(phone.jar.get(HINT) === phoneSlot, "the phone's own passkey set no hint");
  } finally {
    fb.restore();
  }
  return "QR: signed in, no hint; platform: hint; the Signal API told the live list";
});

await check("K4 (UX-3). PASSKEY AUTOFILL, end to end: one conditional request kept open (mediation 'conditional', an abort signal, UV required); renewed with a NEW challenge before the server's 2-minute TTL, only while the page is visible (a hidden page renews when shown); a cancelled pick is offered again; picking signs in through the real routes; stop() aborts; a spent budget stops it quietly — no error, no loop", async () => {
  advance(HOUR);
  const ipad = new Device("192.0.2.172");
  const fb = fakeBrowser({ auth: phoneKey, device: ipad });
  try {
    const signedIn = [];
    const errors = [];
    const h = ui.client.startConditionalSignIn("/home", { onSignedIn: (to) => signedIn.push(to), onError: (e) => errors.push(e.kind) }, 60);
    await waitFor(() => fb.pending.length === 1, "the first conditional request");
    need(fb.calls.get[0].mediation === "conditional" && fb.calls.get[0].signal && fb.calls.get[0].uv === "required", "the request " + JSON.stringify({ ...fb.calls.get[0], challenge: "…" }));
    await waitFor(() => fb.pending.length === 2, "the renewal");
    need(fb.pending[0].aborted && fb.pending[1].challenge !== fb.pending[0].challenge, "not renewed with a new challenge");
    fb.show("hidden");
    await realSleep(200);
    need(fb.pending.length === 2, "renewed while hidden (" + fb.pending.length + " requests)");
    fb.show("visible");
    await waitFor(() => fb.pending.length === 3, "the renewal on being shown");
    advance(2_000);
    fb.pending[2].cancel();
    await waitFor(() => fb.pending.length === 4, "the offer again after a cancelled pick");
    fb.pending[3].pick();
    await waitFor(() => signedIn.length === 1, "onSignedIn");
    need(signedIn[0] === "/home" && ipad.session && cookieParts(ipad.session)[4] === phoneSlot && !errors.length, "the pick did not sign in: " + JSON.stringify({ signedIn, errors }));
    await realSleep(150);
    need(fb.pending.length === 4, "it kept renewing after signing in");
    h.stop();
    // stop() aborts an open request, and nothing follows
    const h2 = ui.client.startConditionalSignIn("/home", { onSignedIn: () => errors.push("signed-in"), onError: (e) => errors.push(e.kind) }, 60);
    await waitFor(() => fb.pending.length === 5, "a request to stop");
    h2.stop();
    await realSleep(150);
    need(fb.pending[4].aborted && fb.pending.length === 5 && !errors.length, "stop() did not end it");
    // a spent sign-in budget: no request, no error, no retry
    const tired = new Device("192.0.2.173");
    for (let i = 0; i < 10; i++) await m.mw.middleware(makeReq("POST", "/api/owner-login/passkey/options", { device: tired, body: {} }));
    fb.restore();
    const fb2 = fakeBrowser({ auth: phoneKey, device: tired });
    try {
      ui.client.startConditionalSignIn("/home", { onSignedIn: () => errors.push("signed-in"), onError: (e) => errors.push(e.kind) }, 60);
      await realSleep(250);
      need(fb2.calls.get.length === 0 && !errors.length, "over budget: " + fb2.calls.get.length + " request(s), errors " + errors.join(","));
    } finally {
      fb2.restore();
    }
  } finally {
    fb.restore();
  }
  return "open → renewed (visible only) → re-offered after a cancel → picked and signed in; stop() aborts; over budget: silent";
});

await check("K5 (UX-5, UX-3, UX-1). ADDING from the browser code, end to end: a cancelled prompt → 'You're still signed in' (and it is), in Windows' words; a prompt left open past the challenge's 2 minutes → 'retry', never 'signed out'; a device already holding one of his passkeys → 'exists'; success signs this device in with its new passkey and sets its hint", async () => {
  advance(HOUR);
  const pc = new Device("192.0.2.175");
  await formLogin(pc);
  const k = new SoftAuthenticator({ alg: -257 });
  const attempt = async (opts, ctx) => {
    const fb = fakeBrowser({ auth: k, device: pc, ua: WIN_UA, ...opts });
    try {
      return await ui.client.addPasskeyForThisDevice("Windows PC", ctx).then(
        (p) => ({ ok: true, p }),
        (e) => ({ ok: false, kind: e.kind, message: e.message })
      );
    } finally {
      fb.restore();
    }
  };
  const cancelled = await attempt({ create: { mode: "cancel" } }, "offer");
  need(!cancelled.ok && cancelled.kind === "cancelled" && /still signed in/.test(cancelled.message) && /Windows Hello/.test(cancelled.message), "cancel: " + JSON.stringify(cancelled));
  need(await gateAdmits(pc), "not signed in after a cancel");
  const slow = await attempt({ create: { waitMs: 3 * MIN } }, "add");
  need(!slow.ok && slow.kind === "retry" && !/signed out/i.test(slow.message), "a slow prompt: " + JSON.stringify(slow));
  need(await gateAdmits(pc), "not signed in after a slow prompt");
  const fbExists = fakeBrowser({ auth: phoneKey, device: pc });
  try {
    const e = await ui.client.addPasskeyForThisDevice("iPad", "offer").then(() => null, (x) => x);
    need(e?.kind === "exists", "a device with his synced passkey: " + e?.kind);
  } finally {
    fbExists.restore();
  }
  const done = await attempt({}, "add");
  need(done.ok && done.p.name === "Windows PC" && cookieParts(pc.session)[4] === done.p.slot && pc.jar.get(HINT) === done.p.slot, "success: " + JSON.stringify(done.ok ? { name: done.p.name } : done));
  const fbTidy = fakeBrowser({ auth: k, device: pc });
  try {
    const r = await ui.client.ownerSecurityAction({ action: "remove", slot: done.p.slot });
    need(r.signedOut === true, "removing this device's own passkey did not say it signed this device out");
  } finally {
    fbTidy.restore();
  }
  return "cancel / slow / exists / added — each in its own words";
});

await check("K6 (UX-14). a session that ends while a page is open is SAID: the page's own /api/ call answered 401 owner_login_required reports it once, the response itself untouched; a 401 for another reason, another origin's 401 or a 200 does not; uninstalling restores fetch", async () => {
  const answers = { "/api/a": [401, { code: "owner_login_required" }], "/api/b": [401, { code: "other" }], "https://elsewhere.example.test/api/c": [401, { code: "owner_login_required" }], "/api/d": [200, { ok: true }] };
  const original = async (input) => {
    const [status, body] = answers[typeof input === "string" ? input : input.url] ?? [404, {}];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const win = { fetch: original, location: { origin: APP, href: APP + "/home" } };
  let told = 0;
  const off = ui.watch.watchOwnerSession(win, () => told++);
  for (const u of ["/api/b", "https://elsewhere.example.test/api/c", "/api/d"]) await win.fetch(u);
  await realSleep(10);
  need(told === 0, "reported for a 401 that is not the gate's, or a 200");
  const r = await win.fetch("/api/a");
  need(r.status === 401 && (await r.json()).code === "owner_login_required", "the caller's response was consumed or changed");
  await win.fetch("/api/a");
  await realSleep(10);
  need(told === 1, "reported " + told + " time(s)");
  off();
  need(win.fetch === original, "fetch was not restored");
  need(ui.watch.signInAgainHref("/settings?x=1") === "/owner-login?next=%2Fsettings%3Fx%3D1", "the way back in: " + ui.watch.signInAgainHref("/settings?x=1"));
  return "once, untouched, restored";
});

await check("K7 (UX-11, UX-7, UX-3, UX-8, UX-15, UX-6). THE SIGN-IN PAGE as served (react-dom/server, no script): passkey-first, the passphrase form sits in a closed native <details> (it opens with no script); the form has a hidden username 'owner' and a passphrase field marked 'current-password webauthn'; passphrase-first says his phone's passkey may work here; passkeys switched off → no passkey button, no fold; error=wrong/unavailable/busy each say so; the page has no 'Sign out' form; a hinted device is passkey-first", async () => {
  const sign = (props) => ui.renderToStaticMarkup(ui.createElement(ui.OwnerSignIn, { next: "/home", error: null, hinted: false, passkeysOn: true, ...props }));
  const first = sign({ hinted: true });
  const det = /<details\b([^>]*)>([\s\S]*?)<\/details>/.exec(first);
  need(det && !/\bopen\b/.test(det[1]), "passkey-first: no closed <details>");
  need(/<summary[^>]*>Use your passphrase instead<\/summary>/.test(det[2]) && /<form[^>]*action="\/api\/owner-login"/.test(det[2]) && /name="passphrase"/.test(det[2]), "the fold does not hold the passphrase form");
  need(/data-testid="owner-passkey-signin"/.test(first), "no big passkey button");
  const pf = sign({});
  const user = /<input[^>]*name="username"[^>]*>/.exec(pf)?.[0] ?? "";
  need(/autocomplete="username"/i.test(user) && /value="owner"/.test(user) && /\bhidden=""/.test(user), "the username field: " + (user || "(none)"));
  const pass = /<input[^>]*name="passphrase"[^>]*>/.exec(pf)?.[0] ?? "";
  need(/autocomplete="current-password webauthn"/i.test(pass), "the passphrase field: " + pass);
  need(/data-testid="owner-passkey-maybe"/.test(pf) && /often works here too/.test(pf), "no 'it may work here' line");
  const off = sign({ passkeysOn: false, hinted: true });
  need(!/owner-passkey-signin/.test(off) && !/<details/.test(off) && /name="passphrase"/.test(off), "passkeys off: a passkey button or a fold");
  const words = { wrong: /was not accepted/, unavailable: /couldn(&#x27;|')t finish signing you in/, busy: /Too many tries/ };
  for (const [error, re] of Object.entries(words)) need(re.test(sign({ error })), "error=" + error + " is not said");
  globalThis.__ownerHarnessCookies = new Map();
  try {
    const page = ui.renderToStaticMarkup(ui.OwnerLoginPage({ searchParams: { next: "/settings", error: "busy" } }));
    need(!/name="logout"/.test(page) && !/owner-logout/.test(page), "the sign-in page still has a Sign out form");
    need(/Too many tries/.test(page) && /data-testid="owner-login-continue"/.test(page) && /data-passkey-first="false"/.test(page), "the page with error=busy");
    globalThis.__ownerHarnessCookies = new Map([[HINT, "a".repeat(16)]]);
    need(/data-passkey-first="true"/.test(ui.renderToStaticMarkup(ui.OwnerLoginPage({ searchParams: {} }))), "a hinted device is not passkey-first");
  } finally {
    delete globalThis.__ownerHarnessCookies;
  }
  return "fold / username / webauthn / maybe-line / off / 3 errors / no sign-out / hinted";
});

await check("K8 (UX-4, UX-7). THE OFFER: it says it is for his OWN phone or computer, above the button; 'This isn't my device' beside 'Not now'; the later route asks for the passphrase once more; the served page is 'One moment' until the browser is checked", async () => {
  const choices = ui.renderToStaticMarkup(ui.createElement(ui.OfferChoices, { next: "/home", busy: false, note: null, onAdded() {}, onExists() {}, onNotMine() {} }));
  need(/Only on your own phone or computer/.test(choices), "no own-device line");
  need(choices.indexOf("Only on your own") < choices.indexOf('data-testid="owner-add-passkey"'), "the warning is not above the button");
  need(/data-testid="owner-offer-not-mine"/.test(choices) && /This isn(&#x27;|')t my device/.test(choices) && /data-testid="owner-offer-skip"/.test(choices), "no 'This isn't my device' beside 'Not now'");
  need(/It will ask for your passphrase once more/.test(choices), "no word on the later route");
  need(/owner-offer-checking/.test(ui.renderToStaticMarkup(ui.createElement(ui.AddPasskeyOffer, { next: "/home" }))), "the served offer is not 'One moment'");
});

await check("K9 (UX-1, UX-2, UX-5, UX-6, UX-9, UX-15). SETTINGS › SECURITY as served: 'Sign out of this device' is a plain form (POST /api/owner-login, logout=1); every passkey row has 'Lost this device?'; the hinted one reads 'used on this device'; a hint never hides Add from a fresh passphrase session; the sign-out-everywhere note says how THIS device gets back in; Remove's words for this session's own passkey and a synced one; a read error and 'switched off' in plain words; every sign-out comes back to Security", async () => {
  const A = "a".repeat(16);
  const B = "b".repeat(16);
  const base = {
    passkeys: [
      { slot: A, name: "iPhone", createdAt: 1, lastUsedAt: null, synced: true },
      { slot: B, name: "Windows PC", createdAt: 1, lastUsedAt: 2, synced: false },
    ],
    thisDeviceSlot: B,
    session: { via: "passphrase", passkeyName: null, slot: null, expiresAt: 10, canEnroll: true },
    sessionDays: 30,
    max: 5,
    passkeysAvailable: true,
    readError: null,
  };
  const render = (over = {}) => ui.renderToStaticMarkup(ui.createElement(ui.OwnerSecurityPanel, { initial: { ...base, ...over, session: { ...base.session, ...(over.session ?? {}) } } }));
  const a = render();
  const form = /<form[^>]*data-testid="owner-signout-this-device-form"[^>]*>[\s\S]*?<\/form>/.exec(a)?.[0] ?? "";
  need(/method="post"/.test(form) && /action="\/api\/owner-login"/.test(form) && /name="logout" value="1"/.test(form) && /Sign out of this device/.test(form), "no plain 'Sign out of this device' form");
  need((a.match(/data-testid="owner-passkey-lost"/g) ?? []).length === 2, "not every row has 'Lost this device?'");
  need(/Windows PC<span[^>]*> · used on this device<\/span>/.test(a) && !/iPhone<span/.test(a), "the hinted row's label");
  need(/data-testid="owner-add-passkey"/.test(a) && /data-testid="owner-enroll-despite-hint"/.test(a), "a hint hid Add from a fresh passphrase session");
  need(/getting back in here is one tap/.test(a), "the everywhere note, with a passkey here");
  need(/need your passphrase to get back in here/.test(render({ thisDeviceSlot: null })), "the everywhere note, without one");
  const c = render({ readError: "Couldn't load your Face ID / fingerprint sign-ins. Reload the page.", passkeysAvailable: false });
  need(!/Something went wrong/.test(c) && !/APP_URL/.test(c) && !/volume/i.test(c) && /switched on for this service yet/.test(c) && /Reload the page/.test(c), "jargon, or a doubled prefix");
  const d = render({ session: { via: "passkey", passkeyName: "Windows PC", slot: B, canEnroll: false } });
  need(/data-testid="owner-this-device-has-one"/.test(d) && !/data-testid="owner-add-passkey"/.test(d), "a passkey session on a device that has one");
  need(/signed out now/.test(ui.removeConfirmTail(true, false)) && !/signed out now/.test(ui.removeConfirmTail(false, false)), "Remove's words for this session's own passkey");
  need(/iCloud Keychain or your Google account/.test(ui.removeConfirmTail(false, true)) && /Lost this device\?/.test(ui.removeConfirmTail(false, false)), "Remove's words for a synced passkey / the pointer to Lost");
  need(/signs out every device, this one too/.test(ui.lostConfirmTail("one tap")) && /with your passphrase/.test(ui.lostConfirmTail("your passphrase")), "Lost's words");
  need(ui.BACK_HERE === "/owner-login?next=%2Fsettings%2Fowner-security", "a sign-out lands on " + ui.BACK_HERE);
  return "sign-out form / Lost on every row / used-on label / Add despite hint / notes / plain words / back to Security";
});

await check("K10 (PK-3, UX-1, UX-7). THE ARM SCRIPT's words: the lost-device advice names the one action that does both ('Lost this device?' removes it AND signs out every device) and no longer offers 'or Sign out everywhere' as enough; the session length names OWNER_SESSION_DAYS; the password-manager entry gets the username and the website, on a manager the iPhone also has; the phone is named as the second device; every printed line is ASCII (Windows PowerShell 5.1 reads the BOM-less file as ANSI)", async () => {
  const text = readFileSync(path.join(ROOT, "scripts", "owner", "arm-owner-service.ps1"), "utf8");
  const printed = [...text.matchAll(/^\s*(?:Write-Info|Write-Note|Write-Ok|Write-Plan|Add-Pending)\b.*$/gm)].map((x) => x[0]);
  const wide = printed.filter((l) => /[^\x00-\x7f]/.test(l));
  need(!wide.length, "non-ASCII in printed lines: " + wide.map((l) => l.trim().slice(0, 60)).join(" | "));
  const all = printed.join("\n");
  need(!/remove its Face ID \/ fingerprint, or Sign out everywhere/.test(all), "the old 'or Sign out everywhere' advice is still printed");
  need(/Lost this device\?/.test(all) && /removes it AND/.test(all) && /signs out every device/.test(all), "the lost-device advice does not name the one action that does both");
  need(/OWNER_SESSION_DAYS/.test(all), "the session length is hard-coded");
  need(/username owner and the website/.test(all) && /also on your iPhone/.test(all), "the password-manager entry has no username / website, or the iPhone is not named");
  need(/Do the same once on your iPhone/.test(all), "the phone is not named as the second device in the YOU line");
  return printed.length + " printed lines, all ASCII";
});

// ------------------------------------------------------------------------------------------------ done
rmSync(UI_OUT, { force: true });
globalThis.fetch = realFetch;
Date.now = realNow;
rmSync(TMP, { recursive: true, force: true });
rmSync(OUT, { force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log("FAILED: " + failures.join(" | "));
  process.exit(1);
}
