// POST AS YOU — the one configurable address of the flow, its rule and the hint the server hands the page. A module of
// its own so the server layout (lib/device/deviceEnv.server.ts) can read it without pulling the vault into its bundle.
//
// FC_ROOT_HUB_URL is the Snapchain node THIS TAB reads to check its own posting key (GET /v1/onChainSignersByFid; the
// public node answers browser reads with Access-Control-Allow-Origin *). Unset = the public node. Else a BARE origin
// (no user, query, fragment or path), https or loopback http; on a hosting platform only the default. The device env is a
// page-settable global served to every visitor, so a keyed provider URL can never be forwarded into it
// (A-SIWF-PAGE-IS-THE-DEVICE, the same rule as Sign in with Farcaster's node).
export const DEFAULT_ROOT_HUB_URL = "https://snap.farcaster.xyz:3381";

const isLoopbackHost = (h: string) => {
  const x = h.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return x === "localhost" || x === "::1" || /^127\.\d+\.\d+\.\d+$/.test(x);
};

export function hubReadUrlRule(raw: string | undefined, hosted: boolean): { ok: true; url: string; host: string } | { ok: false } {
  const v = (raw ?? "").trim();
  if (!v) return { ok: true, url: DEFAULT_ROOT_HUB_URL, host: new URL(DEFAULT_ROOT_HUB_URL).host };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false };
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return { ok: false };
  if (u.origin === DEFAULT_ROOT_HUB_URL) return { ok: true, url: DEFAULT_ROOT_HUB_URL, host: u.host };
  if (hosted) return { ok: false };
  if (u.protocol === "https:" || (u.protocol === "http:" && isLoopbackHost(u.hostname))) return { ok: true, url: u.origin, host: u.host };
  return { ok: false };
}

/** the device env hint (names and checked values only): the override when set AND allowed; a refused value forwards
 *  FC_ROOT_POST=bad_config and no URL, so the tab says "misconfigured" and makes no request */
export function rootPostDeviceHints(env: Record<string, string | undefined>, hosted: boolean): Record<string, string> {
  const raw = (env.FC_ROOT_HUB_URL ?? "").trim();
  if (!raw) return {};
  const r = hubReadUrlRule(raw, hosted);
  if (!r.ok) return { FC_ROOT_POST: "bad_config" };
  return r.url === DEFAULT_ROOT_HUB_URL ? {} : { FC_ROOT_HUB_URL: r.url };
}
