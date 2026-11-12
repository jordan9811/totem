// SIGN IN WITH X (2026-11-06) — WHERE IT IS OFFERED: the public app server's hints to the tab, the landing's promise, and
// the tab's own reading of them. Pure over an env object (no imports), so the server (lib/device/deviceEnv.server.ts,
// components/landing/Landing.tsx), the device (lib/x/signin/flow.ts) and scripts/unit-x-signin.mjs share one rule.
//
// ARMED BY ENV, DORMANT WITHOUT IT. The public APP carries X_CLIENT_ID, the X app's OAuth 2.0 client id: a PUBLIC value
// (it rides every authorize URL, in the visitor's address bar), so it may be served to every tab. Without it the server
// forwards NOTHING (the device env is byte for byte what it was) and every "Continue with X" says Soon, exactly as before
// this was built. X_CLIENT_SECRET, when X requires a confidential client, lives on the VALIDATOR only (validator/xsignin.js);
// the public app refuses it at boot (lib/platform/env-contract.ts APP_ONLY_REFUSES).
//
//   X_CLIENT_ID              the client id; malformed → X_SIGNIN "bad_config" (the variable's NAME is forwarded, never
//                            the value) and the card says "not available on this deployment (misconfigured)"
//   X_SIGNIN=off             the kill switch: the card says it is switched off (next page load, no rebuild)
//   X_SIGNIN_AUTHORIZE_URL   tests only: a LOOPBACK http(s) URL whose path is /i/oauth2/authorize (scripts/lib/x-api-stub.mjs);
//                            refused on a hosting platform, and anything with userinfo, a query or a fragment is refused
//                            by name
// The rig and the owner service (ZK_DEV_HOOKS=true) get no hint: their app pages run no browser device, and the owner
// service connects accounts its own way.

export const X_AUTHORIZE_DEFAULT = "https://x.com/i/oauth2/authorize";
/** an X OAuth 2.0 client id: base64url-like, as the X developer console shows it (e.g. 34 characters) */
export const X_CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const OFF = new Set(["off", "false", "0", "no", "disabled"]);

type Env = Record<string, string | undefined>;

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

function hostedPlatform(env: Env): boolean {
  // the same detection as lib/platform/env-contract.ts isHostedPlatform (a DELIBERATE duplicate: this file has no imports)
  const railway = ["RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"].some((n) => !!(env[n] ?? "").trim());
  return railway || (env.LAYERS_HOSTED ?? "").trim().toLowerCase() === "true";
}

export type AuthorizeRule = { ok: true; url: string; host: string } | { ok: false };

/** X_SIGNIN_AUTHORIZE_URL: unset = X's own page; otherwise a LOOPBACK http(s) URL with the path /i/oauth2/authorize only,
 *  and never on a hosting platform */
export function authorizeUrlRule(raw: string | undefined, hosted: boolean): AuthorizeRule {
  const v = (raw ?? "").trim();
  if (!v || v === X_AUTHORIZE_DEFAULT) return { ok: true, url: X_AUTHORIZE_DEFAULT, host: "x.com" };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false };
  }
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/i/oauth2/authorize") return { ok: false };
  if (hosted) return { ok: false };
  if ((u.protocol === "http:" || u.protocol === "https:") && isLoopbackHost(u.hostname)) return { ok: true, url: u.origin + u.pathname, host: u.host };
  return { ok: false };
}

/**
 * The hints the public app server hands every tab (names and checked values only). Unset X_CLIENT_ID: nothing at all.
 * `log` is told the refused variable's NAME once per process (never its value).
 */
export function xSigninDeviceHints(env: Env, log: (line: string) => void = () => undefined): Record<string, string> {
  if (env.ZK_DEV_HOOKS === "true") return {};
  const id = (env.X_CLIENT_ID ?? "").trim();
  if (!id) return {};
  if (OFF.has((env.X_SIGNIN ?? "").trim().toLowerCase())) return { X_SIGNIN: "off" };
  if (!X_CLIENT_ID_RE.test(id)) {
    log("[x-signin] bad_config (X_CLIENT_ID)");
    return { X_SIGNIN: "bad_config", X_SIGNIN_BAD: "X_CLIENT_ID" };
  }
  const authz = authorizeUrlRule(env.X_SIGNIN_AUTHORIZE_URL, hostedPlatform(env));
  if (!authz.ok) {
    log("[x-signin] bad_config (X_SIGNIN_AUTHORIZE_URL)");
    return { X_SIGNIN: "bad_config", X_SIGNIN_BAD: "X_SIGNIN_AUTHORIZE_URL" };
  }
  return { X_SIGNIN: "on", X_CLIENT_ID: id, ...(authz.url !== X_AUTHORIZE_DEFAULT ? { X_SIGNIN_AUTHORIZE_URL: authz.url } : {}) };
}

/** may a page PROMISE "Continue with X" (an enabled button)? Only where the tab will be told "on" */
export function xSigninOfferedHere(env: Env): boolean {
  return xSigninDeviceHints(env).X_SIGNIN === "on";
}

/** the tab's reading of the hint, for UI only (the device's own gate decides whether a sign-in may start) */
export function xSigninHinted(): boolean {
  if (typeof window === "undefined") return false;
  const env = (window as unknown as { __LAYERS_DEVICE_ENV?: Env }).__LAYERS_DEVICE_ENV ?? {};
  return env.X_SIGNIN === "on";
}
