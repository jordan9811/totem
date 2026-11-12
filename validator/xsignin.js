"use strict";
// SIGN IN WITH X (2026-11-06) — THE THIN, STATELESS RELAY (the public validator's side). SECURITY-POSTURE.md §38;
// docs/mechanism/sign-in-with-x.md.
//
// WHY IT EXISTS: X's token endpoint (POST https://api.x.com/2/oauth2/token) and its API (GET /2/users/me) answer no browser
// CORS for a third-party origin. Measured 2026-11-06 with Origin: https://ontotem.com: the token endpoint's preflight is a
// 404 and /2/users/me's a 405, neither with an Access-Control-* header (X allows only its own x.com and twitter.com). So the
// visitor's tab cannot redeem its own code, and ONE thin step has to run off the browser. It runs HERE, like
// /fc/hub/submit (validator/keyrequest.js), and never on the public app server.
//
//   GET  /x/signin/config     public: { ready, confidential, problems } (names, never a value)
//   POST /x/signin/exchange   { code, codeVerifier, redirectUri, clientId } → 200 { user, revoked }
//        1. POST {X}/2/oauth2/token   grant_type=authorization_code, code, redirect_uri, code_verifier, client_id (a public
//           client: PKCE only); with X_CLIENT_SECRET set, HTTP Basic client_id:client_secret instead (a confidential one)
//        2. GET  {X}/2/users/me?user.fields=profile_image_url,verified,verified_type   Bearer <the access token>
//        3. POST {X}/2/oauth2/revoke  token=<the access token> — ALWAYS, whatever step 2 answered
//        → the profile's six fields alone. The access token never leaves this process, and it is gone when the request ends.
//
// WHAT IT KEEPS: NOTHING. No table, no file, no cache, no log line with a code, a verifier, a token, an account id, a
// username or an address; the only log line is a count every ten minutes. Its rate limit counts per client address in
// memory (as every route here does) and forgets after the window. It is a relay, not a verifier: the tab trusts its
// answer (A-XSI-RELAY-TRUSTED-FOR-PROFILE), because X's OAuth 2.0 issues no signed identity token a browser could check.
//
// NOT AN OPEN RELAY: only the client id this validator is armed with (X_CLIENT_ID) is forwarded; a redirect_uri must be
// an https Totem callback (…/welcome/x, no query) — X checks it again against the app's registered callbacks.
//
// ARMED BY ENV: X_CLIENT_ID (public), and X_CLIENT_SECRET only when the owner's X app is a confidential client. Unset →
// 503 not_armed with the missing NAMES. X_SIGNIN=off is the kill switch. X_SIGNIN_API_URL overrides X's API base: https,
// or loopback http off a hosting platform (the tests' stub, scripts/lib/x-api-stub.mjs).
const { edgeClientAddress } = require("./caps");

const DEFAULT_API = "https://api.x.com";
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const SECRET_RE = /^[\x21-\x7e]{8,256}$/;
const CODE_RE = /^[A-Za-z0-9._~-]{8,1024}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const USER_FIELDS = "profile_image_url,verified,verified_type";
const HOUR = 3_600_000;
/** sign-ins are rare: per client address an hour, and for the whole process an hour */
const LIMITS = Object.freeze({ exchangesPerAddressHour: 20, exchangesPerHour: 3000 });
/** X's OAuth error codes the relay names back (RFC 6749 §5.2); anything else is "other" — X's own text is never echoed */
const X_ERRORS = new Set(["invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope"]);
const OFF = new Set(["off", "false", "0", "no", "disabled"]);

const isLoopbackHost = (h) => {
  const x = String(h).trim().toLowerCase().replace(/^\[|\]$/g, "");
  return x === "localhost" || x === "::1" || /^127\.\d+\.\d+\.\d+$/.test(x);
};
const hosted = (env) => require("./env-contract").isHostedPlatform(env);

/** X's API base: https (no credentials, query or fragment), or loopback http off a hosting platform */
function apiBase(raw, isHosted) {
  const s = String(raw ?? "").trim();
  if (!s) return { base: DEFAULT_API, error: null };
  let u;
  try {
    u = new URL(s);
  } catch {
    return { base: null, error: "is not a URL" };
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return { base: null, error: "carries credentials, a path, a query or a fragment" };
  if (u.protocol === "https:" || (u.protocol === "http:" && isLoopbackHost(u.hostname) && !isHosted)) return { base: u.origin, error: null };
  return { base: null, error: "must be an https address" };
}

/** the relay as this process's environment has it: { ready, clientId, confidential, api, problems } (names only) */
function xSigninConfig(env = process.env) {
  const problems = [];
  if (OFF.has(String(env.X_SIGNIN ?? "").trim().toLowerCase())) problems.push("X_SIGNIN is off (the kill switch)");
  const clientId = String(env.X_CLIENT_ID ?? "").trim();
  if (!clientId) problems.push("X_CLIENT_ID is unset (the X app's OAuth 2.0 client id)");
  else if (!CLIENT_ID_RE.test(clientId)) problems.push("X_CLIENT_ID is not an X OAuth 2.0 client id");
  const secret = String(env.X_CLIENT_SECRET ?? "").trim();
  if (secret && !SECRET_RE.test(secret)) problems.push("X_CLIENT_SECRET is not a client secret (8 to 256 visible characters)");
  const api = apiBase(env.X_SIGNIN_API_URL, hosted(env));
  if (api.error) problems.push("X_SIGNIN_API_URL " + api.error);
  return { ready: problems.length === 0, clientId: clientId || null, confidential: !!secret, api: api.base, problems };
}

/** an https Totem callback (…/welcome/x, no userinfo, query or fragment), or loopback http off a hosting platform */
function redirectOk(raw, isHosted) {
  if (typeof raw !== "string" || raw.length > 512) return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/welcome/x") return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && isLoopbackHost(u.hostname) && !isHosted;
}

/** a fetch with a timeout: { status, json } (never throws on an HTTP status; throws on no answer) */
async function call(fetchImpl, url, init, timeoutMs = 15_000) {
  const res = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** the profile's six fields, shaped (the tab shapes them again: lib/x/signin/pkce.ts readXUser) */
function readUser(j) {
  const d = j && j.data;
  if (!d || typeof d !== "object") return null;
  if (typeof d.id !== "string" || !/^[0-9]{1,20}$/.test(d.id) || typeof d.username !== "string" || !/^[A-Za-z0-9_]{1,15}$/.test(d.username)) return null;
  return {
    id: d.id,
    username: d.username,
    name: typeof d.name === "string" ? d.name.slice(0, 100) : null,
    profile_image_url: typeof d.profile_image_url === "string" && d.profile_image_url.length <= 512 ? d.profile_image_url : null,
    verified: d.verified === true,
    verified_type: typeof d.verified_type === "string" ? d.verified_type.slice(0, 16) : null,
  };
}

function mountXSignin(app, { devHooks = false, trustProxy = process.env.TRUST_PROXY === "true", log = console, now = () => Date.now(), limits = LIMITS, fetchImpl = (...a) => fetch(...a) } = {}) {
  const caps = limits;
  const buckets = new Map();
  const counts = { exchanges: 0, refused: 0, revokeFailed: 0 };
  const address = (req) => edgeClientAddress(req, trustProxy);
  const take = (kind, key, max, windowMs) => {
    if (devHooks) return 0;
    const t = now();
    const k = kind + "|" + key;
    let b = buckets.get(k);
    if (!b || t - b.at >= windowMs) {
      b = { n: 0, at: t };
      buckets.set(k, b);
    }
    if (b.n >= max) return Math.max(1, Math.ceil((b.at + windowMs - t) / 1000));
    b.n++;
    return 0;
  };
  const sweep = setInterval(() => {
    const t = now();
    for (const [k, b] of buckets) if (t - b.at >= HOUR) buckets.delete(k);
    if (counts.exchanges || counts.refused || counts.revokeFailed) {
      log.log("[x-signin] last 10 min: " + counts.exchanges + " sign-in(s) relayed, " + counts.refused + " refused, " + counts.revokeFailed + " token revoke(s) not confirmed");
      counts.exchanges = counts.refused = counts.revokeFailed = 0;
    }
  }, 600_000);
  if (sweep.unref) sweep.unref();

  app.get("/x/signin/config", (req, res) => {
    const c = xSigninConfig();
    res.setHeader("Cache-Control", "no-store");
    res.json({ ready: c.ready, confidential: c.confidential, problems: c.problems });
  });

  app.post("/x/signin/exchange", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const c = xSigninConfig();
    if (!c.ready) return res.status(503).json({ error: "Sign in with X isn't switched on on this site yet.", code: "not_armed", problems: c.problems });
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const code = typeof b.code === "string" ? b.code : "";
    const verifier = typeof b.codeVerifier === "string" ? b.codeVerifier : "";
    const redirectUri = typeof b.redirectUri === "string" ? b.redirectUri : "";
    const clientId = typeof b.clientId === "string" ? b.clientId : "";
    if (!CODE_RE.test(code) || !VERIFIER_RE.test(verifier) || !redirectOk(redirectUri, hosted(process.env))) {
      counts.refused++;
      return res.status(400).json({ error: "That is not a sign-in this relay forwards (a code, a PKCE verifier and a Totem callback address).", code: "bad_request" });
    }
    if (clientId !== c.clientId) {
      counts.refused++;
      return res.status(400).json({ error: "That sign-in is for another X app; this relay forwards Totem's only.", code: "wrong_client" });
    }
    const wait = take("addr", address(req), caps.exchangesPerAddressHour, HOUR) || take("all", "*", caps.exchangesPerHour, HOUR);
    if (wait) {
      counts.refused++;
      res.setHeader("Retry-After", String(wait));
      return res.status(429).json({ error: "Too many sign-ins from this address just now. Try again in a few minutes.", code: "rate_limited", retryAfterSeconds: wait });
    }
    // the secret, when there is one, is read HERE, at call time, and goes no further than this header
    const secret = String(process.env.X_CLIENT_SECRET ?? "").trim();
    // (docs.x.com user-access-token: base64 of "client_id:client_secret", as X's own example spells it)
    const auth = secret ? { authorization: "Basic " + Buffer.from(c.clientId + ":" + secret).toString("base64") } : {};
    const form = (o) => new URLSearchParams(o).toString();
    let tok;
    try {
      tok = await call(fetchImpl, c.api + "/2/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...auth },
        body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, ...(secret ? {} : { client_id: c.clientId }) }),
      });
    } catch {
      counts.refused++;
      return res.status(502).json({ error: "X did not answer. Nothing was saved; start again.", code: "x_unreachable" });
    }
    const access = tok.json && typeof tok.json.access_token === "string" && tok.json.access_token.length <= 4096 ? tok.json.access_token : "";
    if (tok.status < 200 || tok.status >= 300 || !access || String((tok.json && tok.json.token_type) || "").toLowerCase() !== "bearer") {
      counts.refused++;
      const xe = tok.json && typeof tok.json.error === "string" && X_ERRORS.has(tok.json.error) ? tok.json.error : "other";
      return res.status(tok.status >= 200 && tok.status < 300 ? 502 : 400).json({ error: "X refused the sign-in code.", code: "x_refused", xError: xe, status: tok.status });
    }
    let me = null;
    try {
      me = await call(fetchImpl, c.api + "/2/users/me?user.fields=" + USER_FIELDS, { headers: { authorization: "Bearer " + access, accept: "application/json" } });
    } catch {
      me = null;
    }
    // ALWAYS revoke: the token has done its one job (or failed it), and nothing here will ever use it again
    let revoked = false;
    try {
      const rv = await call(fetchImpl, c.api + "/2/oauth2/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...auth },
        body: form({ token: access, token_type_hint: "access_token", ...(secret ? {} : { client_id: c.clientId }) }),
      });
      revoked = rv.status >= 200 && rv.status < 300 && !(rv.json && rv.json.revoked === false);
    } catch {
      revoked = false;
    }
    if (!revoked) counts.revokeFailed++;
    if (!me) {
      counts.refused++;
      return res.status(502).json({ error: "X did not answer with the account. Nothing was saved; start again.", code: "x_users_me", revoked });
    }
    if (me.status < 200 || me.status >= 300) {
      counts.refused++;
      return res.status(502).json({ error: "X would not say which account signed in.", code: "x_users_me", status: me.status, revoked });
    }
    const user = readUser(me.json);
    if (!user) {
      counts.refused++;
      return res.status(502).json({ error: "X's answer about the account was not one this site can read.", code: "x_answer", revoked });
    }
    counts.exchanges++;
    return res.json({ user, revoked });
  });

  return { config: xSigninConfig, limits: caps, stop: () => clearInterval(sweep) };
}

module.exports = { mountXSignin, xSigninConfig, redirectOk, readUser, LIMITS, USER_FIELDS };
