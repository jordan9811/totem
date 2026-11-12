// PUBLIC GO-LIVE — THE FARCASTER MINI APP: the manifest, the embed, the anon page's framing policy. PURE (no I/O, no Node
// API, no "server-only"): the manifest route (app/.well-known/farcaster.json/route.ts), the anon pages, the middleware's
// Edge bundle and scripts/unit-miniapp.mjs (esbuild) all import this one file, so the rules cannot drift apart.
//
// THE SPEC, CHECKED 2026-10-17 (never guessed): the zod schemas Farcaster clients validate with —
// @farcaster/miniapp-core 0.6.0 (published with @farcaster/miniapp-sdk 0.3.0, 2026-04-01): src/schemas/manifest.ts
// (domainManifestSchema, domainMiniAppConfigSchema), src/schemas/embeds.ts (miniAppEmbedNextSchema), src/schemas/shared.ts
// (secureUrlSchema, createSimpleStringSchema, hexColorSchema, DOMAIN_REGEX) — and the prose at
// https://miniapps.farcaster.xyz/docs/specification, /docs/guides/publishing and /docs/guides/sharing. Where the two
// differ the schema wins: the prose lists splashImageUrl as "Max length 32 characters", the schema (and every other URL
// field) says a secure URL of at most 1024 characters. MINIAPP_SPEC below names the version; re-read both before changing
// a field here.
//
// WHAT FARCASTER NEEDS FROM THE OWNER: accountAssociation = {header, payload, signature}, a JSON Farcaster Signature by
// the Farcaster account that owns the Mini App over {"domain": "<the final domain>"}. It is PUBLIC (it proves the domain,
// it grants nothing), so it lives in three app variables (MINIAPP_ACCOUNT_ASSOCIATION_HEADER / _PAYLOAD / _SIGNATURE)
// that scripts/owner/arm-miniapp.ps1 sets. Unset, the manifest is served WITHOUT it and says so in the route's log line:
// Farcaster refuses an unsigned app, and a manifest that claims to be signed when it is not would be a lie. A signed
// payload whose domain is not this site's host is LEFT OUT (and flagged): Farcaster would refuse it anyway, and serving
// it would only look armed.
//
// FRAMING (middleware.ts): /anon and /anon/p/<hash> may be framed by the Farcaster web client only (a Mini App opens in
// an iframe on the web, in a top-level WebView on a phone, where framing rules do not apply). The spec names NO origins,
// so FRAME_ANCESTORS is the Farcaster web client's hosts — the same hosts lib/fc/siwf/flow.ts SIWF_LINK_HOSTS trusts for
// the sign-in link — exact origins, no wildcard. VERIFY-YOURSELF on the first real run inside Farcaster on the web
// (Developer Tools' preview): widen this list BY NAME if a real client frames from another origin.

export const MINIAPP_SPEC = "@farcaster/miniapp-core 0.6.0 schemas + miniapps.farcaster.xyz/docs/specification (read 2026-10-17)";
/** the exact SDK version /anon bundles (package.json pins it; app code reads it through lib/miniapp/sdk.ts) */
export const MINIAPP_SDK_PACKAGE = "@farcaster/miniapp-sdk";
export const MINIAPP_SDK_VERSION = "0.3.0";

export const MANIFEST_PATH = "/.well-known/farcaster.json";
export const MINIAPP_HOME_PATH = "/anon";
export const ANON_SHARE_PREFIX = "/anon/p/";
export const MINIAPP_NAME = "Anon Wire";
export const MINIAPP_BUTTON_TITLE = "Post anonymously";
export const SPLASH_BACKGROUND = "#e8ddcb";
export const MINIAPP_SUBTITLE = "Post with no name on it";
// PUBLIC GO-LIVE (PRIV-LIVE-4): no "nobody learns which posts are yours, Totem included" — the sign-in, the posts and the
// reports reach Totem's validator from the visitor's own internet address (no outside relay yet), so that claim is not kept
export const MINIAPP_DESCRIPTION = "Post on Farcaster through one shared account, with no name on your posts. Open Totem for personas and rings.";
/** the Open Graph description (the schema caps it at 100 characters) */
export const MINIAPP_OG_DESCRIPTION = "Post on Farcaster from one shared account, with no name on your posts.";
export const MINIAPP_TAGS: readonly string[] = ["anonymous", "privacy", "posting", "totem"];
export const MINIAPP_CATEGORY = "social";

/** the three app variables the owner sets (arm-miniapp.ps1); public values, never secrets */
export const ASSOCIATION_VARS = {
  header: "MINIAPP_ACCOUNT_ASSOCIATION_HEADER",
  payload: "MINIAPP_ACCOUNT_ASSOCIATION_PAYLOAD",
  signature: "MINIAPP_ACCOUNT_ASSOCIATION_SIGNATURE",
} as const;

/** the images, served from public/miniapp/, with the spec's rules (manifest.ts: icon "1024x1024px PNG, no alpha",
 *  splash "200x200px"; sharing guide: an embed image is 3:2, at least 600x400, at most 3000x2000, under 10 MB) */
export const MINIAPP_IMAGES = {
  icon: { path: "/miniapp/icon.png", width: 1024, height: 1024, noAlpha: true },
  splash: { path: "/miniapp/splash.png", width: 200, height: 200, noAlpha: false },
  embed: { path: "/miniapp/embed.png", ratio: [3, 2] as const, minWidth: 600, minHeight: 400, maxWidth: 3000, maxHeight: 2000, maxBytes: 10 * 1024 * 1024 },
} as const;

/** the origins that may frame /anon and /anon/p/* (see the header: the Farcaster web client's hosts, exact) */
export const FRAME_ANCESTORS: readonly string[] = ["https://farcaster.xyz", "https://www.farcaster.xyz", "https://client.farcaster.xyz", "https://warpcast.com", "https://www.warpcast.com"];

/** the Farcaster web client's hosts a "view on Farcaster" link may point at (the same list, as hosts) */
export const FARCASTER_WEB_HOSTS: readonly string[] = FRAME_ANCESTORS.map((o) => o.slice("https://".length));

/** docs.farcaster.xyz/reference/farcaster/intent-urls (read 2026-10-17): https://farcaster.xyz/~/compose?text=…&embeds[]=… */
export const FARCASTER_COMPOSE_URL = "https://farcaster.xyz/~/compose";

// ------------------------------------------------------------------------------------------------ small pure helpers

/** the schema's DOMAIN_REGEX (shared.ts), plus its refinements: no scheme, no path, no port, no "@" */
const DOMAIN_RE = /^(?!.*\.\.)([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
export function isSpecDomain(v: string): boolean {
  return typeof v === "string" && v.length <= 1024 && DOMAIN_RE.test(v) && !v.includes("://") && !v.includes("/") && !v.includes("@") && !v.includes(":");
}

/** the schema's secureUrlSchema: https, at most 1024 characters, no space, not localhost, not an IP address */
export function secureUrlProblem(v: unknown): string | null {
  if (typeof v !== "string") return "is missing";
  if (v.length > 1024) return "is longer than 1024 characters";
  if (!v.startsWith("https://")) return "must be an https address";
  if (v.includes(" ")) return "must not contain spaces";
  let host = "";
  try {
    host = new URL(v).hostname;
  } catch {
    return "is not a URL";
  }
  if (host === "localhost" || host.endsWith(".localhost")) return "must not be localhost";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return "must not be an IP address";
  if (host.startsWith("[") && host.endsWith("]")) return "must not be an IP address";
  return null;
}

const SPECIAL_CHARS = /[@#$%^&*+=/\\|~«»]/;
const REPEATED_PUNCTUATION = /(!{2,}|\?{2,}|-{2,})/;
const EMOJI = /[\u{1F300}-\u{1F9FF}]|[\u{2702}-\u{27B0}]|[\u{2600}-\u{26FF}]|[\u{2B00}-\u{2BFF}]/u;
/** the schema's createSimpleStringSchema: a length cap, no emoji, none of @ # $ % ^ & * + = / \ | ~ « », no !! ?? -- */
export function simpleStringProblem(v: unknown, max: number, noSpaces = false): string | null {
  if (typeof v !== "string") return "is not text";
  if (v.length > max) return "is longer than " + max + " characters";
  if (noSpaces && /\s/.test(v)) return "must not contain spaces";
  if (EMOJI.test(v)) return "must not contain emoji or symbols";
  if (SPECIAL_CHARS.test(v)) return "must not contain @ # $ % ^ & * + = / \\ | ~ « »";
  if (REPEATED_PUNCTUATION.test(v)) return "must not repeat punctuation (!! ?? --)";
  return null;
}

const HEX_COLOR = /^#([0-9A-F]{3}|[0-9A-F]{6})$/i;

/** an origin and its host from a configured URL (APP_URL), or null when it is not a usable http(s) URL */
export function originOf(raw: string | undefined | null): { origin: string; host: string; https: boolean } | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return { origin: u.origin, host: u.hostname.toLowerCase(), https: u.protocol === "https:" };
  } catch {
    return null;
  }
}

/** base64 or base64url, padded or not, to bytes; null when it is neither (no atob, no Buffer: this runs on the Edge) */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function base64Bytes(v: string): Uint8Array | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!s || !/^[A-Za-z0-9+/]+$/.test(s) || s.length % 4 === 1) return null;
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}
function base64Json(v: string): unknown {
  const b = base64Bytes(v);
  if (!b) return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------------------------------------ the association

export interface DecodedAssociation {
  ok: boolean;
  fid: number | null;
  type: string | null;
  key: string | null;
  domain: string | null;
  problems: string[];
}

/**
 * What the three values say, checked for SHAPE (the spec: header.type "custody" or "auth", payload {domain}, all three
 * base64). The signature itself is Farcaster's to verify (the custody or auth key against the account, onchain): a
 * page that cannot check it must not pretend to. `expectHost`, when given, must equal the payload's domain exactly
 * (the publishing guide: "www.example.com" and "example.com" are different apps).
 */
export function decodeAssociation(a: { header?: string | null; payload?: string | null; signature?: string | null }, expectHost?: string | null): DecodedAssociation {
  const problems: string[] = [];
  const out: DecodedAssociation = { ok: false, fid: null, type: null, key: null, domain: null, problems };
  const header = String(a.header ?? "").trim();
  const payload = String(a.payload ?? "").trim();
  const signature = String(a.signature ?? "").trim();
  if (!header || !payload || !signature) {
    problems.push("the account association is incomplete (" + [!header ? "header" : "", !payload ? "payload" : "", !signature ? "signature" : ""].filter(Boolean).join(", ") + " missing)");
    return out;
  }
  const h = base64Json(header) as { fid?: unknown; type?: unknown; key?: unknown } | undefined;
  if (!h || typeof h !== "object") problems.push("the header is not base64 JSON");
  else {
    if (typeof h.fid === "number" && Number.isSafeInteger(h.fid) && h.fid > 0) out.fid = h.fid;
    else problems.push("the header names no account number (fid)");
    if (h.type === "custody" || h.type === "auth") out.type = h.type;
    else problems.push('the header type is not "custody" or "auth"');
    if (typeof h.key === "string" && /^0x[0-9a-fA-F]{40}$/.test(h.key)) out.key = h.key.toLowerCase();
    else problems.push("the header names no signing address (key)");
  }
  const p = base64Json(payload) as { domain?: unknown } | undefined;
  if (!p || typeof p !== "object") problems.push("the payload is not base64 JSON");
  else if (typeof p.domain !== "string" || !isSpecDomain(p.domain)) problems.push("the payload names no domain (a bare host like example.com, with no https:// and no path)");
  else {
    out.domain = p.domain.toLowerCase();
    if (expectHost && out.domain !== expectHost.toLowerCase()) problems.push("the payload is signed for " + out.domain + ", but this site is " + expectHost.toLowerCase() + " (sign again for this exact domain)");
  }
  const sig = base64Bytes(signature);
  if (!sig || sig.length < 65) problems.push("the signature is not a base64 signature of at least 65 bytes");
  out.ok = problems.length === 0;
  return out;
}

// ------------------------------------------------------------------------------------------------ the manifest

export interface MiniAppConfig {
  version: "1";
  name: string;
  iconUrl: string;
  homeUrl: string;
  splashImageUrl: string;
  splashBackgroundColor: string;
  subtitle: string;
  description: string;
  primaryCategory: string;
  tags: string[];
  tagline: string;
  ogTitle: string;
  ogDescription: string;
}
export interface Manifest {
  accountAssociation?: { header: string; payload: string; signature: string };
  miniapp: MiniAppConfig;
  /** the legacy name, kept for older clients — the schema requires it to be IDENTICAL to miniapp when both are present */
  frame: MiniAppConfig;
}
export interface BuiltManifest {
  manifest: Manifest;
  origin: string;
  host: string;
  /** true when a valid association for this host is included */
  signed: boolean;
  /** why it is not (or why something else is off) — plain words, names never values; the route logs them */
  flags: string[];
}

/**
 * The manifest for this deployment. `env` is process.env (APP_URL and the three association variables); `fallbackOrigin`
 * is the request's public origin (lib/platform/owner-access.ts publicOrigin), used only when APP_URL is unset or unusable,
 * and said so in the flags. Never throws.
 */
export function buildManifest(env: Record<string, string | undefined>, fallbackOrigin?: string | null): BuiltManifest {
  const flags: string[] = [];
  let o = originOf(env.APP_URL);
  if (!o) {
    flags.push("APP_URL is unset or not a URL: the manifest names the address this request came in on");
    o = originOf(fallbackOrigin) ?? { origin: "https://invalid.invalid", host: "invalid.invalid", https: true };
  }
  if (!o.https) flags.push("the site is not served over https: Farcaster accepts only https addresses");
  const at = (p: string) => o!.origin + p;
  const config: MiniAppConfig = {
    version: "1",
    name: MINIAPP_NAME,
    iconUrl: at(MINIAPP_IMAGES.icon.path),
    homeUrl: at(MINIAPP_HOME_PATH),
    splashImageUrl: at(MINIAPP_IMAGES.splash.path),
    splashBackgroundColor: SPLASH_BACKGROUND,
    subtitle: MINIAPP_SUBTITLE,
    description: MINIAPP_DESCRIPTION,
    primaryCategory: MINIAPP_CATEGORY,
    tags: [...MINIAPP_TAGS],
    tagline: MINIAPP_SUBTITLE,
    ogTitle: MINIAPP_NAME,
    ogDescription: MINIAPP_OG_DESCRIPTION,
  };
  const manifest: Manifest = { miniapp: config, frame: config };
  const raw = { header: env[ASSOCIATION_VARS.header], payload: env[ASSOCIATION_VARS.payload], signature: env[ASSOCIATION_VARS.signature] };
  const anySet = [raw.header, raw.payload, raw.signature].some((v) => String(v ?? "").trim() !== "");
  let signed = false;
  if (!anySet) flags.push("unsigned: " + Object.values(ASSOCIATION_VARS).join(", ") + " are unset (Farcaster refuses an unsigned Mini App; the owner signs it for the final domain, then runs scripts/owner/arm-miniapp.ps1)");
  else {
    const d = decodeAssociation(raw, o.host);
    if (d.ok) {
      manifest.accountAssociation = { header: String(raw.header).trim(), payload: String(raw.payload).trim(), signature: String(raw.signature).trim() };
      signed = true;
    } else flags.push("the account association is left out: " + d.problems.join("; "));
  }
  // put accountAssociation first, as the spec's examples do (key order is cosmetic; miniapp and frame stay identical)
  const ordered: Manifest = signed ? { accountAssociation: manifest.accountAssociation, miniapp: config, frame: config } : manifest;
  return { manifest: ordered, origin: o.origin, host: o.host, signed, flags };
}

/**
 * The spec's rules for a served manifest (domainManifestSchema + domainMiniAppConfigSchema), as plain-words problems.
 * `expectHost` = the host the file is served on: homeUrl must be on it, and a signed payload must name it exactly.
 * `requireSigned` adds the one rule an unsigned manifest breaks (the schema requires accountAssociation).
 */
export function validateManifest(m: unknown, expectHost: string, opts: { requireSigned?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (!m || typeof m !== "object") return ["the manifest is not a JSON object"];
  const man = m as Record<string, unknown>;
  const cfg = (man.miniapp ?? man.frame) as Record<string, unknown> | undefined;
  if (!cfg || typeof cfg !== "object") return ["the manifest has neither miniapp nor frame"];
  if (man.miniapp && man.frame && JSON.stringify(man.miniapp) !== JSON.stringify(man.frame)) problems.push('"frame" and "miniapp" are both present but not identical');
  if (cfg.version !== "1") problems.push('version must be "1"');
  if (typeof cfg.name !== "string" || cfg.name.length === 0) problems.push("name is missing");
  else if (cfg.name.length > 32) problems.push("name is longer than 32 characters");
  for (const k of ["iconUrl", "homeUrl"] as const) {
    const p = secureUrlProblem(cfg[k]);
    if (p) problems.push(k + " " + p);
  }
  for (const k of ["splashImageUrl", "webhookUrl", "heroImageUrl", "ogImageUrl", "imageUrl", "castShareUrl"] as const) {
    if (cfg[k] === undefined) continue;
    const p = secureUrlProblem(cfg[k]);
    if (p) problems.push(k + " " + p);
  }
  if (typeof cfg.homeUrl === "string") {
    try {
      const h = new URL(cfg.homeUrl).hostname.toLowerCase();
      if (h !== expectHost.toLowerCase()) problems.push("homeUrl is on " + h + ", not on the host that serves the manifest (" + expectHost.toLowerCase() + ")");
    } catch {
      /* already said above */
    }
  }
  if (cfg.splashBackgroundColor !== undefined && (typeof cfg.splashBackgroundColor !== "string" || !HEX_COLOR.test(cfg.splashBackgroundColor))) problems.push("splashBackgroundColor is not a hex colour (#RGB or #RRGGBB)");
  const simple: Array<[string, number]> = [["subtitle", 30], ["description", 170], ["tagline", 30], ["ogTitle", 30], ["ogDescription", 100]];
  for (const [k, max] of simple) {
    if (cfg[k] === undefined) continue;
    const p = simpleStringProblem(cfg[k], max);
    if (p) problems.push(k + " " + p);
  }
  if (cfg.tags !== undefined) {
    if (!Array.isArray(cfg.tags) || cfg.tags.length > 5) problems.push("tags must be at most 5");
    else for (const t of cfg.tags) {
      const p = simpleStringProblem(t, 20, true);
      if (p) problems.push("the tag " + JSON.stringify(t) + " " + p);
      else if (typeof t === "string" && t !== t.toLowerCase()) problems.push("the tag " + JSON.stringify(t) + " must be lowercase");
    }
  }
  if (cfg.primaryCategory !== undefined && !["games", "social", "finance", "utility", "productivity", "health-fitness", "news-media", "music", "shopping", "education", "developer-tools", "entertainment", "art-creativity"].includes(String(cfg.primaryCategory))) problems.push("primaryCategory is not one of the spec's categories");
  if (cfg.screenshotUrls !== undefined && (!Array.isArray(cfg.screenshotUrls) || cfg.screenshotUrls.length > 3)) problems.push("screenshotUrls must be at most 3");
  if (cfg.noindex !== undefined && typeof cfg.noindex !== "boolean") problems.push("noindex must be true or false");
  if (cfg.canonicalDomain !== undefined && (typeof cfg.canonicalDomain !== "string" || !isSpecDomain(cfg.canonicalDomain))) problems.push("canonicalDomain is not a bare domain");
  const a = man.accountAssociation as Record<string, unknown> | undefined;
  if (a === undefined) {
    if (opts.requireSigned) problems.push("accountAssociation is missing (Farcaster refuses an unsigned Mini App)");
  } else if (!a || typeof a !== "object" || typeof a.header !== "string" || typeof a.payload !== "string" || typeof a.signature !== "string") {
    problems.push("accountAssociation must have header, payload and signature, each a string");
  } else {
    const d = decodeAssociation(a as { header: string; payload: string; signature: string }, expectHost);
    for (const p of d.problems) problems.push("accountAssociation: " + p);
  }
  return problems;
}

// ------------------------------------------------------------------------------------------------ the embed

export interface MiniAppEmbed {
  version: "1";
  imageUrl: string;
  button: { title: string; action: { type: "launch_miniapp" | "launch_frame"; name: string; url: string; splashImageUrl: string; splashBackgroundColor: string } };
}

/** the fc:miniapp embed (launch_miniapp) — or, with `legacy`, the fc:frame one (launch_frame), same JSON otherwise */
export function miniAppEmbed(origin: string, legacy = false): MiniAppEmbed {
  return {
    version: "1",
    imageUrl: origin + MINIAPP_IMAGES.embed.path,
    button: {
      title: MINIAPP_BUTTON_TITLE,
      action: { type: legacy ? "launch_frame" : "launch_miniapp", name: MINIAPP_NAME, url: origin + MINIAPP_HOME_PATH, splashImageUrl: origin + MINIAPP_IMAGES.splash.path, splashBackgroundColor: SPLASH_BACKGROUND },
    },
  };
}

/** the two meta tags, name -> content, for Next's metadata `other` (rendered <meta name="fc:miniapp" content="…">) */
export function embedMeta(origin: string): Record<string, string> {
  return { "fc:miniapp": JSON.stringify(miniAppEmbed(origin)), "fc:frame": JSON.stringify(miniAppEmbed(origin, true)) };
}

/** miniAppEmbedNextSchema's rules as problems */
export function validateEmbed(e: unknown, opts: { legacy?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (!e || typeof e !== "object") return ["the embed is not a JSON object"];
  const x = e as Record<string, unknown>;
  if (String(x.version) !== "1" && String(x.version) !== "next") problems.push('version must be "1"');
  const ip = secureUrlProblem(x.imageUrl);
  if (ip) problems.push("imageUrl " + ip);
  const b = x.button as Record<string, unknown> | undefined;
  if (!b || typeof b !== "object") return [...problems, "button is missing"];
  if (typeof b.title !== "string" || b.title.length === 0) problems.push("button.title is missing");
  else if (b.title.length > 32) problems.push("button.title is longer than 32 characters");
  const a = b.action as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object") return [...problems, "button.action is missing"];
  const want = opts.legacy ? "launch_frame" : "launch_miniapp";
  if (a.type !== want) problems.push("button.action.type must be " + want);
  if (typeof a.name !== "string" || a.name.length === 0 || a.name.length > 32) problems.push("button.action.name must be 1 to 32 characters");
  for (const k of ["url", "splashImageUrl"] as const) {
    if (a[k] === undefined) continue;
    const p = secureUrlProblem(a[k]);
    if (p) problems.push("button.action." + k + " " + p);
  }
  if (a.splashBackgroundColor !== undefined && (typeof a.splashBackgroundColor !== "string" || !HEX_COLOR.test(a.splashBackgroundColor))) problems.push("button.action.splashBackgroundColor is not a hex colour");
  return problems;
}

// ------------------------------------------------------------------------------------------------ the images

export interface PngFacts {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** a tRNS chunk (transparency for a palette or a single colour) */
  hasTrns: boolean;
  /** an alpha channel (colour type 4 or 6) or a tRNS chunk */
  alpha: boolean;
  bytes: number;
}

/** read a PNG's header and chunk list (no decoding); null when it is not a PNG */
export function pngFacts(bytes: Uint8Array): PngFacts | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!bytes || bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return null;
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(12) !== "IHDR") return null;
  const width = u32(16);
  const height = u32(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  let hasTrns = false;
  let o = 8;
  while (o + 8 <= bytes.length) {
    const len = u32(o);
    const t = tag(o + 4);
    if (t === "tRNS") hasTrns = true;
    if (t === "IEND") break;
    o += 12 + len;
  }
  return { width, height, bitDepth, colorType, hasTrns, alpha: colorType === 4 || colorType === 6 || hasTrns, bytes: bytes.length };
}

/** the spec's image rules for one of the three images, as problems */
export function imageProblems(kind: keyof typeof MINIAPP_IMAGES, f: PngFacts | null): string[] {
  if (!f) return [kind + " is not a PNG"];
  const out: string[] = [];
  if (kind === "icon" || kind === "splash") {
    const r = MINIAPP_IMAGES[kind];
    if (f.width !== r.width || f.height !== r.height) out.push(kind + " is " + f.width + "x" + f.height + ", the spec says " + r.width + "x" + r.height);
    if (r.noAlpha && f.alpha) out.push(kind + " has an alpha channel or transparency; the spec says no alpha");
  } else {
    const r = MINIAPP_IMAGES.embed;
    if (f.width * r.ratio[1] !== f.height * r.ratio[0]) out.push("embed is " + f.width + "x" + f.height + ", not 3:2");
    if (f.width < r.minWidth || f.height < r.minHeight) out.push("embed is smaller than " + r.minWidth + "x" + r.minHeight);
    if (f.width > r.maxWidth || f.height > r.maxHeight) out.push("embed is larger than " + r.maxWidth + "x" + r.maxHeight);
    if (f.bytes >= r.maxBytes) out.push("embed is " + f.bytes + " bytes, the limit is under 10 MB");
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the anon pages

/** /anon and /anon/p/<one segment>: the only documents that may be framed (by FRAME_ANCESTORS) */
export function isAnonPagePath(path: string): boolean {
  return path === MINIAPP_HOME_PATH || /^\/anon\/p\/[^/]+$/.test(path);
}

/** the share page's address for one anonymous post (the validator's 64-hex cast hash) */
export const CAST_HASH_RE = /^[0-9a-f]{64}$/;
export function anonSharePath(castHash: string): string {
  return ANON_SHARE_PREFIX + castHash;
}

/** a "view on Farcaster" link is shown only for https on the Farcaster web client's hosts */
export function isFarcasterWebUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 1024) return false;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && !x.username && !x.password && FARCASTER_WEB_HOSTS.includes(x.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** the web composer with the post's link as its one embed (the intent URL format, embeds[] unencoded as the docs show it);
 *  no text: a share says nothing about who shared it */
export function farcasterComposeUrl(embedUrl: string, text = ""): string {
  const parts: string[] = [];
  if (text) parts.push("text=" + encodeURIComponent(text));
  parts.push("embeds[]=" + encodeURIComponent(embedUrl));
  return FARCASTER_COMPOSE_URL + "?" + parts.join("&");
}

const DEFAULT_SIWF_RELAY = "https://relay.farcaster.xyz"; // lib/fc/siwf/flow.ts DEFAULT_RELAY_URL (DELIBERATE DUPLICATE: unit-miniapp pins it)
const DEFAULT_SIWF_RPC = "https://mainnet.optimism.io"; // lib/fc/siwf/flow.ts DEFAULT_RPC_URL (DELIBERATE DUPLICATE: unit-miniapp pins it)

function httpOrigin(raw: string | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
    // plain http only to a loopback host (the suites' stubs); anything else must be https
    if (u.protocol === "http:" && !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Where an anon page's tab may connect, besides its own origin: the validator (the device's VALIDATOR_URL, built exactly
 * as lib/device/deviceEnv.server.ts builds it — NEXT_PUBLIC_VALIDATOR_URL, else lib/ports.ts validatorUrl(): DELIBERATE
 * DUPLICATE, unit-miniapp pins the two), the sign-in relay and chain node the sign-in card names before its first request
 * (the defaults, or a loopback / https override — an origin only, never a path or a key), and an OHTTP relay when one is
 * configured. Nothing else: no font host, no image host, no analytics.
 */
export function anonConnectOrigins(env: Record<string, string | undefined>): string[] {
  const port = (() => {
    const n = Number(env.LAYERS_VALIDATOR_PORT ?? env.VALIDATOR_PORT);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : 4001;
  })();
  const validator = httpOrigin(env.NEXT_PUBLIC_VALIDATOR_URL || env.VALIDATOR_URL || `http://localhost:${port}`);
  const relay = httpOrigin(env.FC_SIWF_RELAY_URL) ?? DEFAULT_SIWF_RELAY;
  const rpc = httpOrigin(env.FC_SIWF_RPC_URL) ?? DEFAULT_SIWF_RPC;
  const ohttp = String(env.ZK_RELAY ?? "").trim().toLowerCase() === "ohttp" ? httpOrigin(env.ZK_RELAY_URL) : null;
  return [...new Set([validator, relay, rpc, ohttp].filter((x): x is string => !!x))];
}

/**
 * PUBLIC GO-LIVE (F14) — the image hosts the Totem app loads DIRECTLY (components/CastCard.tsx MEDIA_HOSTS: Farcaster's
 * avatar and upload hosts plus the seed's fixed ones; every other host is click-to-load there). A DELIBERATE DUPLICATE —
 * CastCard keeps its list private — pinned equal by scripts/unit-miniapp.mjs M17. Why /anon's policy names them: "Open
 * Totem" is a SOFT navigation (components/anon/OpenLayersLink.tsx: a full load would start a fresh identity in a tab that
 * never saved this one), so the whole Totem session after it runs in /anon's document, under /anon's policy — and with
 * img-src 'self' only, every live-read avatar and picture in that tab broke until a reload. /anon itself shows no picture
 * from these hosts; the list is exact (a host, and its subdomains as CastCard allows them), never a wildcard scheme.
 */
export const ANON_MEDIA_HOSTS: readonly string[] = ["imagedelivery.net", "i.imgur.com", "res.cloudinary.com", "i.pravatar.cc", "picsum.photos", "api.dicebear.com"];
/** the img-src sources for ANON_MEDIA_HOSTS: https only, each host and its subdomains (CastCard's host === h || .h rule) */
export function anonImageSources(): string[] {
  return ANON_MEDIA_HOSTS.flatMap((h) => ["https://" + h, "https://*." + h]);
}

/**
 * The content security policy of /anon and /anon/p/*: framed by FRAME_ANCESTORS only; scripts, styles and fonts from this
 * origin only (Next's inline bootstrap needs 'unsafe-inline'; the prover's WebAssembly needs 'wasm-unsafe-eval'; its
 * worker starts from a blob: URL); images from this origin and the app's media hosts (ANON_MEDIA_HOSTS, above: the Totem
 * session that "Open Totem" continues in this document); connections to anonConnectOrigins() only — the same origins the
 * Totem app's browser device calls after the click-through (its validator, the sign-in relay and node, the OHTTP relay;
 * live reads go through this site's own /api/fc/read). `next dev` (NODE_ENV not production) also needs eval and its
 * websocket. No X-Frame-Options beside it: that header cannot name an allowed framer.
 */
export function anonPagePolicy(env: Record<string, string | undefined>): string {
  const dev = env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'" + (dev ? " 'unsafe-eval'" : ""),
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "connect-src 'self' " + anonConnectOrigins(env).join(" ") + " blob: data:" + (dev ? " ws: wss:" : ""),
    "img-src 'self' data: blob: " + anonImageSources().join(" "),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "media-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors " + FRAME_ANCESTORS.join(" "),
  ].join("; ");
}

// ------------------------------------------------------------------------------------------------ the one public host

/**
 * PUBLIC GO-LIVE (F6) — ONE PUBLIC ADDRESS. After the domain move the platform's own address (the *.up.railway.app one)
 * still served the whole app, and a page used there is broken in two ways nobody can see: a passkey binds to the host it
 * was made on (lib/device/custody: the relying party is location.hostname), so a passkey saved there never opens the
 * identity on the real domain; and the validator's fid gate refuses a sign-in for any domain but APP_URL's host, so a
 * sign-in there can never join the anonymous crowd. So, on the LIVE public site only, a page request on any other host
 * is sent (308, same path and query) to APP_URL. Returns the target, or null to let the request through.
 *
 *   * only when `live` (lib/platform/publicLive.ts isPublicLive(): a public deployment with PUBLIC_LIVE=true) and APP_URL
 *     is a usable http(s) URL — the preview, the rig and the owner service are untouched;
 *   * only GET and HEAD, and never /api/* (liveness, /api/health, is one of them; the validator is a separate service
 *     this middleware never sees);
 *   * the request's host is X-Forwarded-Host's first entry, else Host (lib/platform/owner-access.ts publicOrigin's order:
 *     a proxy that rewrites Host keeps the public one there), compared by hostname, case-insensitive;
 *   * NEVER redirected — so a misread can never loop or strand a probe: no host at all (the image optimizer's internal
 *     fetch carries no headers), a loopback host (localhost, *.localhost, 127.x, [::1]: the server's own probes and the
 *     local suites), and the platform's private network (*.railway.internal).
 * A forged X-Forwarded-Host changes only where its own sender is sent, and only ever to APP_URL.
 */
export function canonicalHostRedirect(o: { live: boolean; appUrl: string | undefined | null; method: string; path: string; search: string; host: string | null; forwardedHost: string | null }): string | null {
  if (!o.live) return null;
  const app = originOf(o.appUrl);
  if (!app) return null;
  const method = String(o.method || "").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const p = String(o.path || "");
  if (!p.startsWith("/") || p === "/api" || p.startsWith("/api/")) return null;
  const raw = (String(o.forwardedHost ?? "").split(",")[0] ?? "").trim() || String(o.host ?? "").trim();
  if (!raw) return null;
  let hostname = "";
  try {
    hostname = new URL("http://" + raw).hostname.toLowerCase();
  } catch {
    return null; // a host we cannot read is never acted on
  }
  if (!hostname) return null;
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (bare === "localhost" || bare.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(bare) || bare === "::1" || bare.endsWith(".railway.internal")) return null;
  if (hostname === app.host) return null;
  const search = String(o.search || "");
  return app.origin + p + (search && search !== "?" ? (search.startsWith("?") ? search : "?" + search) : "");
}
