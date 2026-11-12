// SIGN IN WITH X (2026-11-06) — A LOOPBACK STAND-IN FOR X's OAuth 2.0 PAGES AND API, for the tests. The real X API is
// never called by any test (docs/mechanism/sign-in-with-x.md).
//
// Sign in with X runs in the visitor's tab (the authorize redirect, the callback, the state check) and through the
// validator's thin relay (the token exchange, /2/users/me, the revoke). On the production-shaped pair
// (scripts/run-prod-shape.sh under PRODLIVE_X=stub) the APP hands the page X_SIGNIN_AUTHORIZE_URL = this stub's
// /i/oauth2/authorize (loopback: the only non-default value the device honours) and the VALIDATOR gets X_SIGNIN_API_URL =
// this stub, so the whole flow runs against it. It behaves like X where X has been measured or documented (2026-11-06):
//   GET  /i/oauth2/authorize            the consent page: response_type=code, client_id, redirect_uri (EXACT match of a
//                                       registered callback), scope, state, code_challenge, code_challenge_method=S256
//   GET  /i/oauth2/authorize/approve    the visitor pressed "Authorize app" → 302 redirect_uri?state=…&code=…
//   GET  /i/oauth2/authorize/deny       the visitor pressed "Cancel"        → 302 redirect_uri?error=access_denied&state=…
//   POST /2/oauth2/token                form: grant_type, code, redirect_uri, code_verifier, client_id (public) or HTTP
//                                       Basic (confidential). A code lives 30 seconds and redeems ONCE; the verifier must
//                                       hash (S256) to the challenge. → { token_type: "bearer", expires_in, access_token, scope }
//   GET  /2/users/me                    Bearer token → { data: { id, name, username, + the user.fields asked } }
//   POST /2/oauth2/revoke               form: token (+ client_id or Basic) → { revoked: true }
//   OPTIONS anything                    404 with NO Access-Control-* header (X answers no browser CORS for a third party)
//   GET  /__stub/state | POST /__stub/reset | POST /__stub/force {codeTtlMs, tokenDown, usersMeDown, secret, as} |
//   POST /__stub/shutdown
// VIOLATIONS (the launcher fails the run on any): the token, users/me or revoke endpoint reached by a BROWSER (an Origin
// header or a browser's user agent: only the validator may call them); a preflight on the API; a Cookie on any
// API call; an authorize request that is not S256, lacks a state or a 43-character challenge, asks for a scope beyond
// users.read and tweet.read, or names an unregistered redirect_uri; users/me asked for fields beyond profile_image_url,
// verified and verified_type, or for an expansion; any call to a following/followers endpoint (Totem does not read them);
// a path or method outside the contract.
//
// Its accounts are TEST constants: STUB_X_USERS.alice (@StubXAlice) and .bob (@stubxbob). Codes and tokens are random and
// never served back by /__stub/state (only counts). Loopback only; default port 4338. Two ways:
//   * as a process — `node scripts/lib/x-api-stub.mjs serve --port 4338 --redirect http://localhost:3001/welcome/x`;
//   * in-process — `startXApiStub({ port: 0, redirects: [...] })`.
import http from "node:http";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

/** ports the stub must never take: the pinned pairs, accept-cu4's probes, the owner-service rig, the other stubs */
export const FORBIDDEN_PORTS = new Set([3001, 4001, 3009, 3011, 3023, 3029, 3091, 3100, 3101, 4009, 4057, 4063, 4091, 4319, 4321, 4335, 4337]);
export const STUB_DEFAULT_PORT = 4338;
/** the stub X app's client id (public by nature, like a real one) */
export const STUB_CLIENT_ID = "xstub-client-0123456789";
export const STUB_REDIRECT_DEFAULT = "http://localhost:3001/welcome/x";
export const STUB_X_USERS = Object.freeze({
  alice: Object.freeze({ id: "1990777000000000001", username: "StubXAlice", name: "Stub X Alice", profile_image_url: "https://pbs.twimg.com/profile_images/1990777/stubxalice_normal.jpg", verified: false, verified_type: "none" }),
  bob: Object.freeze({ id: "1990778000000000002", username: "stubxbob", name: "Stub X Bob", profile_image_url: "https://pbs.twimg.com/profile_images/1990778/stubxbob_normal.png", verified: true, verified_type: "blue" }),
});
const ALLOWED_SCOPES = new Set(["users.read", "tweet.read"]);
const ALLOWED_FIELDS = new Set(["profile_image_url", "verified", "verified_type"]);

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const s256 = (verifier) => b64url(createHash("sha256").update(verifier, "ascii").digest());

export function createXApiStub({ redirects = [STUB_REDIRECT_DEFAULT], clientId = STUB_CLIENT_ID, log = (s) => console.log("[x-stub] " + s), onShutdown = () => {} } = {}) {
  const st = {
    n: 0,
    requests: [],
    violations: [],
    authorizes: 0,
    approvals: 0,
    denials: 0,
    codes: new Map(), // code → { user, challenge, redirectUri, clientId, issuedAt, used }
    tokens: new Map(), // token → { user, revoked }
    pendingAuth: new Map(), // id → { redirectUri, state, challenge }
    counts: { tokenCalls: 0, redeemed: 0, replays: 0, expired: 0, pkceFailed: 0, usersMe: 0, revokes: 0, preflights: 0 },
    knobs: { codeTtlMs: 30_000, tokenDown: 0, usersMeDown: 0, secret: "", as: "alice" },
    lastFields: null,
  };
  const violation = (entry, kind, detail = "") => {
    st.violations.push({ kind, path: entry.path, detail: String(detail).slice(0, 160) });
    log("VIOLATION " + kind + " " + entry.path + (detail ? " (" + detail + ")" : ""));
  };
  const reset = () => {
    st.requests = [];
    st.violations = [];
    st.authorizes = st.approvals = st.denials = 0;
    st.codes.clear();
    st.tokens.clear();
    st.pendingAuth.clear();
    for (const k of Object.keys(st.counts)) st.counts[k] = 0;
    st.knobs = { codeTtlMs: 30_000, tokenDown: 0, usersMeDown: 0, secret: "", as: "alice" };
    st.lastFields = null;
  };
  const snapshot = () => ({
    requests: st.requests.map((r) => ({ n: r.n, method: r.method, path: r.path, kind: r.kind })),
    violations: st.violations,
    authorizes: st.authorizes,
    approvals: st.approvals,
    denials: st.denials,
    codes: { issued: st.codes.size, redeemed: st.counts.redeemed, replays: st.counts.replays, expired: st.counts.expired, pkceFailed: st.counts.pkceFailed },
    tokens: { issued: st.tokens.size, revoked: [...st.tokens.values()].filter((t) => t.revoked).length },
    tokenCalls: st.counts.tokenCalls,
    usersMe: st.counts.usersMe,
    revokes: st.counts.revokes,
    preflights: st.counts.preflights,
    lastFields: st.lastFields,
    knobs: { ...st.knobs, secret: st.knobs.secret ? "(set)" : "" },
  });

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  };
  const html = (res, status, body) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end("<!doctype html><html><head><meta charset=utf-8><title>X stub</title></head><body>" + body + "</body></html>");
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let t = "";
      req.on("data", (d) => {
        t += d;
        if (t.length > 65536) req.destroy();
      });
      req.on("end", () => resolve(t));
      req.on("error", () => resolve(""));
    });
  /** a browser reached an endpoint only the validator may call (a browser always sends Origin on a cross-origin call and a
   *  Mozilla user agent; Node's fetch sends neither — its Sec-Fetch-Mode header is not a browser's tell) */
  const fromBrowser = (req) => !!req.headers.origin || /Mozilla\//.test(String(req.headers["user-agent"] || ""));
  const basicOk = (req) => {
    const h = String(req.headers.authorization || "");
    if (!h.startsWith("Basic ")) return false;
    const pair = Buffer.from(h.slice(6), "base64").toString("utf8");
    return pair === clientId + ":" + st.knobs.secret;
  };
  /** the client: public (client_id in the body, NO secret) unless the stub was told the app is confidential */
  const clientOk = (req, form) => (st.knobs.secret ? basicOk(req) && !form.get("client_id") : form.get("client_id") === clientId && !req.headers.authorization);

  async function authorize(req, res, entry, u) {
    entry.kind = "authorize";
    st.authorizes++;
    const q = u.searchParams;
    const redirectUri = q.get("redirect_uri") || "";
    const state = q.get("state") || "";
    const challenge = q.get("code_challenge") || "";
    const scopes = String(q.get("scope") || "").split(" ").filter(Boolean);
    if (q.get("client_id") !== clientId) {
      violation(entry, "authorize", "unknown client_id");
      return html(res, 400, "<p>Something went wrong. You weren't able to give access to the App.</p>");
    }
    if (!redirects.includes(redirectUri)) {
      violation(entry, "authorize", "redirect_uri is not a registered callback");
      return html(res, 400, "<p>Something went wrong (redirect_uri).</p>");
    }
    if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || state.length < 22 || state.length > 500)
      violation(entry, "authorize", "not an S256 PKCE request with a state");
    if (!scopes.length || scopes.some((s) => !ALLOWED_SCOPES.has(s)) || !scopes.includes("users.read")) violation(entry, "authorize", "scope " + scopes.join(" "));
    const ref = String(req.headers.referer || "");
    if (ref && /[?#]/.test(ref)) violation(entry, "referer", "the authorize page was reached with a Referer carrying a query or fragment");
    const id = b64url(randomBytes(12));
    st.pendingAuth.set(id, { redirectUri, state, challenge });
    const who = st.knobs.as === "bob" ? STUB_X_USERS.bob : STUB_X_USERS.alice;
    return html(
      res,
      200,
      `<h1>Totem (stub) wants to access your X account</h1><p data-testid="x-stub-who">as @${who.username}</p>` +
        `<p>Scopes: <span data-testid="x-stub-scopes">${scopes.join(" ")}</span></p>` +
        `<a data-testid="x-stub-authorize" href="/i/oauth2/authorize/approve?req=${id}">Authorize app</a> ` +
        `<a data-testid="x-stub-cancel" href="/i/oauth2/authorize/deny?req=${id}">Cancel</a>`
    );
  }

  function approveOrDeny(req, res, entry, u, approve) {
    entry.kind = approve ? "approve" : "deny";
    const p = st.pendingAuth.get(u.searchParams.get("req") || "");
    if (!p) return html(res, 400, "<p>That request is gone.</p>");
    st.pendingAuth.delete(u.searchParams.get("req"));
    const to = new URL(p.redirectUri);
    if (approve) {
      st.approvals++;
      const code = b64url(randomBytes(24)) + "." + b64url(randomBytes(6));
      st.codes.set(code, { user: st.knobs.as === "bob" ? STUB_X_USERS.bob : STUB_X_USERS.alice, challenge: p.challenge, redirectUri: p.redirectUri, clientId, issuedAt: Date.now(), used: false });
      to.searchParams.set("state", p.state);
      to.searchParams.set("code", code);
    } else {
      st.denials++;
      to.searchParams.set("error", "access_denied");
      to.searchParams.set("state", p.state);
    }
    res.writeHead(302, { location: to.toString(), "cache-control": "no-store" });
    res.end();
  }

  async function token(req, res, entry) {
    entry.kind = "token";
    st.counts.tokenCalls++;
    if (fromBrowser(req)) violation(entry, "browser", "the token endpoint was called by a browser (only the validator may)");
    const form = new URLSearchParams(await readBody(req));
    if (st.knobs.tokenDown > 0) {
      st.knobs.tokenDown--;
      return send(res, 503, { title: "Service Unavailable" });
    }
    if (!clientOk(req, form)) return send(res, 401, { error: "invalid_client", error_description: "Missing valid authorization header" });
    if (form.get("grant_type") !== "authorization_code") return send(res, 400, { error: "unsupported_grant_type" });
    const code = form.get("code") || "";
    const c = st.codes.get(code);
    if (!c) return send(res, 400, { error: "invalid_request", error_description: "Value passed for the authorization code was invalid." });
    if (c.used) {
      st.counts.replays++;
      return send(res, 400, { error: "invalid_grant", error_description: "the code was already used" });
    }
    c.used = true; // a code redeems ONCE, whatever happens next
    if (Date.now() - c.issuedAt > st.knobs.codeTtlMs) {
      st.counts.expired++;
      return send(res, 400, { error: "invalid_grant", error_description: "the code expired" });
    }
    if (form.get("redirect_uri") !== c.redirectUri) return send(res, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
    if (s256(form.get("code_verifier") || "") !== c.challenge) {
      st.counts.pkceFailed++;
      return send(res, 400, { error: "invalid_grant", error_description: "code_verifier mismatch" });
    }
    st.counts.redeemed++;
    const access = "xstub-tok-" + b64url(randomBytes(24));
    st.tokens.set(access, { user: c.user, revoked: false });
    return send(res, 200, { token_type: "bearer", expires_in: 7200, access_token: access, scope: "users.read tweet.read" });
  }

  function usersMe(req, res, entry, u) {
    entry.kind = "users.me";
    st.counts.usersMe++;
    if (fromBrowser(req)) violation(entry, "browser", "users/me was called by a browser (only the validator may)");
    const fields = String(u.searchParams.get("user.fields") || "").split(",").filter(Boolean);
    st.lastFields = fields.join(",");
    if (fields.some((f) => !ALLOWED_FIELDS.has(f))) violation(entry, "fields", "user.fields beyond the three: " + fields.join(","));
    if (u.searchParams.get("expansions")) violation(entry, "fields", "an expansion was asked (billed per object since 2026-11-22)");
    if (st.knobs.usersMeDown > 0) {
      st.knobs.usersMeDown--;
      return send(res, 503, { title: "Service Unavailable" });
    }
    const h = String(req.headers.authorization || "");
    const t = h.startsWith("Bearer ") ? st.tokens.get(h.slice(7)) : null;
    if (!t || t.revoked) return send(res, 401, { title: "Unauthorized", type: "about:blank", status: 401, detail: "Unauthorized" });
    const data = { id: t.user.id, name: t.user.name, username: t.user.username };
    for (const f of fields) if (ALLOWED_FIELDS.has(f)) data[f] = t.user[f];
    return send(res, 200, { data });
  }

  async function revoke(req, res, entry) {
    entry.kind = "revoke";
    st.counts.revokes++;
    if (fromBrowser(req)) violation(entry, "browser", "revoke was called by a browser (only the validator may)");
    const form = new URLSearchParams(await readBody(req));
    if (!clientOk(req, form)) return send(res, 401, { error: "invalid_client" });
    const t = st.tokens.get(form.get("token") || "");
    if (t) t.revoked = true;
    return send(res, 200, { revoked: true });
  }

  async function control(req, res, u) {
    if (u.pathname === "/__stub/state") return send(res, 200, snapshot());
    if (u.pathname === "/__stub/reset" && req.method === "POST") {
      reset();
      return send(res, 200, { ok: true });
    }
    if (u.pathname === "/__stub/force" && req.method === "POST") {
      let j = {};
      try {
        j = JSON.parse((await readBody(req)) || "{}");
      } catch {
        j = {};
      }
      if (Number.isSafeInteger(j.codeTtlMs) && j.codeTtlMs >= 0) st.knobs.codeTtlMs = j.codeTtlMs;
      if (Number.isSafeInteger(j.tokenDown) && j.tokenDown >= 0) st.knobs.tokenDown = Math.min(j.tokenDown, 20);
      if (Number.isSafeInteger(j.usersMeDown) && j.usersMeDown >= 0) st.knobs.usersMeDown = Math.min(j.usersMeDown, 20);
      if (typeof j.secret === "string") st.knobs.secret = j.secret;
      if (j.as === "alice" || j.as === "bob") st.knobs.as = j.as;
      return send(res, 200, { ok: true, knobs: snapshot().knobs });
    }
    if (u.pathname === "/__stub/shutdown" && req.method === "POST") {
      send(res, 200, { ok: true });
      setTimeout(onShutdown, 50);
      return;
    }
    return send(res, 404, { error: "unknown control" });
  }

  return {
    async handle(req, res) {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname.startsWith("/__stub/")) return control(req, res, u);
      const entry = { n: ++st.n, method: req.method, path: u.pathname, kind: "unknown" };
      st.requests.push(entry);
      if (st.requests.length > 2000) st.requests.splice(0, st.requests.length - 2000);
      if (req.method === "OPTIONS") {
        // X answers no CORS for a third-party origin: a preflight here means a browser tried to call the API directly
        entry.kind = "preflight";
        st.counts.preflights++;
        violation(entry, "preflight", "a browser preflighted the API (X would answer 404 with no CORS)");
        res.writeHead(404, { "content-type": "application/json" });
        return res.end('{"errors":[{"message":"Sorry, that page does not exist","code":34}]}');
      }
      if (u.pathname.startsWith("/2/") && req.headers.cookie) violation(entry, "cookie", "an API call carried a Cookie");
      if (req.method === "GET" && u.pathname === "/i/oauth2/authorize") return authorize(req, res, entry, u);
      if (req.method === "GET" && u.pathname === "/i/oauth2/authorize/approve") return approveOrDeny(req, res, entry, u, true);
      if (req.method === "GET" && u.pathname === "/i/oauth2/authorize/deny") return approveOrDeny(req, res, entry, u, false);
      if (req.method === "POST" && u.pathname === "/2/oauth2/token") return token(req, res, entry);
      if (req.method === "GET" && u.pathname === "/2/users/me") return usersMe(req, res, entry, u);
      if (req.method === "POST" && u.pathname === "/2/oauth2/revoke") return revoke(req, res, entry);
      if (/^\/2\/users\/[^/]+\/(following|followers)$/.test(u.pathname)) {
        violation(entry, "following", "a follows endpoint was called (Totem does not read them: off by decision, $0.01 per user returned)");
        return send(res, 403, { title: "Forbidden" });
      }
      if (u.pathname === "/favicon.ico") return send(res, 404, {});
      violation(entry, "off-contract", req.method + " " + u.pathname);
      return send(res, 404, { errors: [{ message: "Sorry, that page does not exist", code: 34 }] });
    },
    snapshot,
    reset,
  };
}

export async function startXApiStub({ port = STUB_DEFAULT_PORT, redirects, clientId, log } = {}) {
  if (port && FORBIDDEN_PORTS.has(port)) throw new Error("x-api-stub: port " + port + " belongs to a pair or another stub");
  let server;
  const stub = createXApiStub({ redirects, clientId, log, onShutdown: () => server && server.close() });
  server = http.createServer((req, res) => {
    stub.handle(req, res).catch(() => {
      try {
        res.writeHead(500);
        res.end();
      } catch {
        /* closed */
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const actual = server.address().port;
  return { url: "http://127.0.0.1:" + actual, port: actual, stub, close: () => new Promise((r) => server.close(() => r())) };
}

// ------------------------------------------------------------------------------------------------ CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === "serve") {
    const i = process.argv.indexOf("--port");
    const port = i > 0 ? Number(process.argv[i + 1]) : STUB_DEFAULT_PORT;
    if (!Number.isSafeInteger(port) || port <= 0 || FORBIDDEN_PORTS.has(port)) {
      console.log("[x-stub] refusing port " + (i > 0 ? process.argv[i + 1] : port) + " (a pinned or another stub's port)");
      process.exit(1);
    }
    const redirects = [];
    process.argv.forEach((a, k) => a === "--redirect" && process.argv[k + 1] && redirects.push(process.argv[k + 1]));
    const s = await startXApiStub({ port, redirects: redirects.length ? redirects : [STUB_REDIRECT_DEFAULT] });
    console.log("[x-stub] listening on " + s.url + " (loopback X OAuth 2.0 + API; test accounts only; callbacks: " + (redirects.length ? redirects : [STUB_REDIRECT_DEFAULT]).join(", ") + ")");
  } else if (cmd === "client-id") {
    process.stdout.write(STUB_CLIENT_ID);
  } else {
    console.log("usage: node scripts/lib/x-api-stub.mjs serve --port 4338 [--redirect <url>]... | client-id");
    process.exit(1);
  }
}
