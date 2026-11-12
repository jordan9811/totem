// PUBLIC GO-LIVE — THE FARCASTER MINI APP AND THE ANON PAGE'S RULES, NODE-ONLY (npm run test:miniapp-unit once the verify
// agent adds the script). No server, no browser, no network: lib/miniapp/manifest.ts, lib/miniapp/sdk.ts, middleware.ts,
// the manifest route and the anon page's pure helpers are bundled with esbuild (next/server and next/link stubbed, the
// Mini App SDK replaced by a recording fake, relay's AnonReportButton by an empty stub) and called directly.
//
//   M1  a signed manifest for the site's own host: included, and it passes every rule of the spec's schema
//       (@farcaster/miniapp-core 0.6.0 domainManifestSchema + domainMiniAppConfigSchema, as lib/miniapp/manifest.ts
//       states them), requireSigned included
//   M2  DROP EACH REQUIRED FIELD (version, name, iconUrl, homeUrl; accountAssociation's header, payload, signature) ->
//       each is caught by name
//   M3  a WRONG DOMAIN (signed for another host, or www vs bare) -> left out of the served manifest, flagged, and caught
//   M4  NO ASSOCIATION -> served unsigned, flagged by the three variable names; requireSigned catches it
//   M5  THE IMAGES: public/miniapp/{icon,splash,embed}.png meet the spec (icon 1024x1024 PNG with no alpha, splash
//       200x200, embed 3:2 within 600x400..3000x2000 and under 10 MB); an image over a limit, of the wrong size, the wrong
//       ratio or with alpha is caught
//   M6  THE EMBED (fc:miniapp launch_miniapp, fc:frame launch_frame) passes; a long title, a wrong action type and an
//       http image are caught
//   M7  the spec's string rules (no @ # / …, no emoji, the caps) hold for every text this app ships, and a bad one is caught
//   M8  homeUrl on another host is caught;  M9  frame and miniapp differing is caught
//   M10 the web composer link is the documented intent URL (https://farcaster.xyz/~/compose?embeds[]=…), no text
//   M11 "View on Farcaster" only for https on the Farcaster web hosts
//   M12 where /anon may connect: the validator (the device's own expression — pinned against lib/ports.ts), the sign-in
//       relay and node (pinned against lib/fc/siwf/flow.ts's defaults) or a loopback / https override as an origin only,
//       an OHTTP relay when configured; a non-loopback http override is refused
//   M13 the anon page's policy: frame-ancestors = the Farcaster web origins only, no wildcard, no eval in production;
//       img-src is EXACTLY 'self' data: blob: plus the app's media hosts (F14: the Totem session "Open Totem" continues
//       in /anon's document), the only wildcard anywhere a "https://*.<media host>" subdomain source
//   M17 F14: lib/miniapp/manifest.ts ANON_MEDIA_HOSTS is exactly components/CastCard.tsx MEDIA_HOSTS (the deliberate
//       duplicate), read from CastCard's source
//   M14 base64 and base64url decode the same
//   M15 the SDK is pinned exactly (0.3.0) wherever it appears (package.json, node_modules): never a range
//   M16 the DELIBERATE DUPLICATE of FRAME_ANCESTORS in scripts/smoke-deployed.mjs check 15 (FARCASTER_FRAMERS) equals it,
//       once gpl has pasted check 15 (until then a NOTE)
//   V1  A MINI APP SIGN-IN PASSES THE DEVICE'S OWN VERIFIER (lib/fc/siwf/verify.ts, the one a relay completion gets): a
//       message shaped as a Farcaster host builds it for sdk.actions.signIn (statement "Farcaster Auth", chain 10, this
//       host, a uri on this origin but another path, OUR nonce, farcaster://fid/N), signed by a real key, verifies against
//       a fake chain; another domain, another nonce or another account are refused. When lib/fc/siwf/flow.ts carries the
//       Mini App steps (relay applies the anonpage diff), its fid parser reads that message's account number
//   F1  middleware: /anon and /anon/p/<64 hex> carry the anon policy (Farcaster framers only) and NO X-Frame-Options
//   F2  middleware: every other document (/home, /welcome, /device, /, /anonx, /anon/x, /anon/p/a/b) stays unframeable
//   F3  middleware: /anon/ is redirected (unframeable); the manifest path passes untouched; maintenance stays unframeable
//   H1  F6, ONE PUBLIC ADDRESS: on a LIVE public site (PUBLIC_LIVE=true) a page request on another host (Host, or
//       X-Forwarded-Host first) is 308'd to the same path and query on APP_URL, unframeable and no-store; /api/* (health
//       included), POST, loopback, *.railway.internal, no host and the canonical host itself pass; the preview (flag off),
//       the rig (ZK_DEV_HOOKS=true) and an unset APP_URL never redirect
//   R1  the manifest route: 200 JSON, nosniff, cacheable, readable from any origin, valid for the host it names
//   S1  the SDK is NEVER EVALUATED outside a Farcaster client (not framed, no WebView): detect says outside and the fake
//       package's module body never ran
//   S2  inside (the host answers): ready() exactly once; sign-in passes our nonce with acceptAuthAddress; compose and
//       openUrl reach the host
//   S3  framed but the host does not answer: nothing is called (no ready, no sign-in)
//   S4  a declined sign-in is "rejected"; any other failure is null (never a fake success)
//   S5  the package missing from the build: outside, nothing breaks
//   U1  the page's helpers: the crowd sentence, the feed parser (malformed rows and off-host links dropped; no list =
//       "unsupported", never "empty"), the Post button only on an answer that SAYS yes
//   U2  "Open Totem" is a SOFT link (next/link) to /welcome?from=anon in a browser, and the SDK's openUrl inside a
//       Mini App (with the sentence that Totem opens in the browser)
//   U3  the page renders (server render, before the device boots): the explainer, the honest residuals one tap away, the
//       click-through, "Starting…" (never a sign-in or a composer before the device answers); the composer shows where a
//       post goes only when posting is on, and the reason (once) when it is off
//   SP  the share page /anon/p/<hash> (a server page, no device): the live universe first, then the test one (labelled);
//       a hidden/unknown cast (404 JSON in both) is notFound; a malformed hash is notFound with NO request; a validator that
//       cannot be read, or that does not answer single posts, is an honest error view — never notFound; an answer for
//       another cast is refused; the request carries only mode and hash; the embed meta is printed
//   SPL ASM-2, the share page on a LIVE site (PUBLIC_LIVE=true on a public shape, or ZK_ANON_UNIVERSE set on the app):
//       ONLY the live universe is read — a test-universe post is notFound after exactly ONE request (mode=live, never
//       mode=fixture), a live post still renders; the preview (flag off) still falls back to the test universe
//   U4  F3/F4: joinRecorded says "in the crowd" only on a recorded join (availableFrom, or available), never on unknown
//   C1  PRIV-LIVE-4 / F9: none of the anon page's files says "not even Totem", "Totem included", "no one can match a
//       post", "can't tell which person" or "launched accounts"; the explainer carries the address sentence
//   MUT every guard above is removed in the BUNDLE ONLY (the repo is never touched) and the check that covers it must
//       then FAIL — a check that cannot fail is not evidence
//
//   node scripts/unit-miniapp.mjs                 (all, then the mutation runs)
//   node scripts/unit-miniapp.mjs --only=M3,F1    (a subset; the mutation runs use this)
//   MINIAPP_MUTATION='[{"file":"…","find":"…","replace":"…"}]' node scripts/unit-miniapp.mjs --only=M3
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import zlib from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");

const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length).split(",").filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const MUTATIONS = process.env.MINIAPP_MUTATION ? JSON.parse(process.env.MINIAPP_MUTATION) : [];
const IS_CHILD = MUTATIONS.length > 0;

// a closed network: nothing here may fetch (the route and the middleware make no request; a regression would)
globalThis.fetch = async (u) => {
  throw new Error("unit-miniapp: unexpected network request to " + String(u));
};

let passed = 0;
const failed = [];
async function check(id, name, fn) {
  if (!want(id)) return;
  try {
    const extra = await fn();
    passed++;
    console.log(`  PASS  ${id} ${name}${typeof extra === "string" && extra ? " — " + extra : ""}`);
  } catch (e) {
    failed.push(id);
    console.log(`  FAIL  ${id} ${name} — ${(e && e.message) || e}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// ---------------------------------------------------------------------------------------------------- the bundles
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-miniapp-unit-"));
const S = (n) => path.join(tmp, n);
writeFileSync(
  S("next-server.ts"),
  `export class NextResponse extends Response {
  static json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
    return new NextResponse(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  }
  static next() { return new NextResponse(null, { status: 200, headers: { "x-middleware-next": "1" } }); }
  static redirect(url: URL | string, status = 307) { return new NextResponse(null, { status, headers: { location: String(url) } }); }
  static rewrite(url: URL | string) { return new NextResponse(null, { status: 200, headers: { "x-middleware-rewrite": String(url) } }); }
}
export class NextRequest {}
`
);
writeFileSync(S("server-only.ts"), "export {};\n");
writeFileSync(S("next-headers.ts"), 'export function headers() { return new Headers({ host: "layers.example" }); }\nexport function cookies() { return { get: (_n: string) => undefined }; }\n');
writeFileSync(
  S("next-navigation.ts"),
  'export function notFound(): never { throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" }); }\nexport function redirect(u: string): never { throw Object.assign(new Error("NEXT_REDIRECT " + u), { digest: "NEXT_REDIRECT" }); }\n'
);
writeFileSync(S("next-link.tsx"), `import * as React from "react";\nexport default function Link(props: any) { const { href, children, ...rest } = props; return React.createElement("a", { "data-next-link": "1", href, ...rest }, children); }\n`);
writeFileSync(S("report-stub.tsx"), "export function AnonReportButton(_p: { castHash: string; universe: string }) { return null; }\n");
// the Mini App SDK, faked and RECORDING: its module body counts its own evaluations (S1 proves it never runs outside)
writeFileSync(
  S("fake-sdk.cjs"),
  `const f = (globalThis.__fakeSdk = globalThis.__fakeSdk || { evaluated: 0, calls: [], inMiniApp: false, signIn: "ok", missing: false });
if (f.missing) { const e = new Error("Cannot find module '@farcaster/miniapp-sdk'"); e.code = "MODULE_NOT_FOUND"; throw e; }
f.evaluated++;
const sdk = {
  isInMiniApp: async (ms) => { f.calls.push("isInMiniApp"); return f.inMiniApp; },
  context: Promise.resolve({ user: { fid: 990777, username: "stubalice", displayName: "Stub Alice", pfpUrl: null } }),
  actions: {
    ready: async () => { f.calls.push("ready"); },
    signIn: async (o) => {
      f.calls.push("signIn:" + o.nonce + ":" + o.acceptAuthAddress);
      if (f.signIn === "reject") { const e = new Error("Sign in rejected by user"); e.name = "SignIn.RejectedByUser"; throw e; }
      if (f.signIn === "throw") throw new Error("host failure");
      return { message: "a message", signature: "0x" + "11".repeat(65), authMethod: "authAddress" };
    },
    composeCast: async (o) => { f.calls.push("composeCast:" + JSON.stringify(o)); return { cast: null }; },
    openUrl: async (u) => { f.calls.push("openUrl:" + u); },
  },
};
module.exports = { sdk, default: sdk };
`
);
writeFileSync(
  S("entry-pure.ts"),
  `export * as man from "@/lib/miniapp/manifest";
export * as ports from "@/lib/ports";
export * as verify from "@/lib/fc/siwf/verify";
`
);
writeFileSync(S("entry-mw.ts"), `export * as mw from "@/middleware";\nexport * as route from "@/app/.well-known/farcaster.json/route";\n`);
writeFileSync(
  S("entry-ui.ts"),
  `export * as sdk from "@/lib/miniapp/sdk";
export * as explainer from "@/components/anon/AnonExplainer";
export * as feed from "@/components/anon/AnonFeed";
export * as composer from "@/components/anon/AnonComposer";
export * as share from "@/components/anon/ShareToFarcaster";
export * as open from "@/components/anon/OpenLayersLink";
export * as app from "@/app/anon/AnonApp";
export * as sharePage from "@/app/anon/p/[castHash]/page";
export * as React from "react";
export { renderToStaticMarkup } from "react-dom/server";
`
);

const mutationsApplied = new Set();
const mutatePlugin = {
  name: "mutate",
  setup(b) {
    if (!MUTATIONS.length) return;
    b.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
      const rel = args.path.split(path.sep).join("/");
      const mine = MUTATIONS.filter((m) => rel.endsWith(m.file));
      if (!mine.length) return undefined;
      let src = readFileSync(args.path, "utf8").replace(/\r\n/g, "\n");
      for (const m of mine) {
        if (!src.includes(m.find)) throw new Error("MUTATION ANCHOR NOT FOUND in " + m.file + ": " + m.find.slice(0, 80));
        src = src.replace(m.find, m.replace);
        mutationsApplied.add(m);
      }
      return { contents: src, loader: args.path.endsWith(".tsx") ? "tsx" : "ts", resolveDir: path.dirname(args.path) };
    });
  },
};
const common = {
  plugins: [mutatePlugin],
  absWorkingDir: ROOT,
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node20"],
  tsconfig: path.join(ROOT, "tsconfig.json"),
  jsx: "automatic",
  logLevel: "error",
  nodePaths: [path.join(ROOT, "node_modules")],
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "next/server": S("next-server.ts"),
    "server-only": S("server-only.ts"),
    "next/link": S("next-link.tsx"),
    "next/headers": S("next-headers.ts"),
    "next/navigation": S("next-navigation.ts"),
    "@/components/zk/AnonReportButton": S("report-stub.tsx"),
    "@farcaster/miniapp-sdk": S("fake-sdk.cjs"),
  },
};
let P, MW, uiFile;
try {
  await build({ ...common, entryPoints: [S("entry-pure.ts")], outfile: S("pure.mjs") });
  await build({ ...common, entryPoints: [S("entry-mw.ts")], outfile: S("mw.mjs") });
  await build({ ...common, entryPoints: [S("entry-ui.ts")], outfile: S("ui.mjs") });
  P = await import(pathToFileURL(S("pure.mjs")).href);
  uiFile = pathToFileURL(S("ui.mjs")).href;
} catch (e) {
  console.log("  FAIL  BUILD — " + ((e && e.message) || e));
  process.exit(1);
}
const M = P.man;

// ---------------------------------------------------------------------------------------------------- fixtures
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
const assoc = (domain, { fid = 777001, type = "custody", key = "0x" + "ab".repeat(20), sigBytes = 65 } = {}) => ({
  header: b64url(JSON.stringify({ fid, type, key })),
  payload: b64url(JSON.stringify({ domain })),
  signature: Buffer.alloc(sigBytes, 7).toString("base64url"),
});
const envFor = (appUrl, a) => ({ APP_URL: appUrl, ...(a ? { MINIAPP_ACCOUNT_ASSOCIATION_HEADER: a.header, MINIAPP_ACCOUNT_ASSOCIATION_PAYLOAD: a.payload, MINIAPP_ACCOUNT_ASSOCIATION_SIGNATURE: a.signature } : {}) });
const HOST = "layers.example";
const APP = "https://" + HOST;
const clone = (x) => JSON.parse(JSON.stringify(x));

/** a minimal PNG of any size and colour type (IHDR + an empty IDAT stream + IEND), for the size rules */
function pngOf(w, h, colorType = 2, { trns = false, pad = 0 } = {}) {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (trns) parts.push(chunk("tRNS", Buffer.from([0, 0, 0, 0, 0, 0])));
  parts.push(chunk("IDAT", zlib.deflateSync(Buffer.alloc(pad))), chunk("IEND", Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(parts));
}

// ---------------------------------------------------------------------------------------------------- M: the manifest
await check("M1", "a signed manifest for the site's own host is included and passes every spec rule (requireSigned too)", () => {
  const b = M.buildManifest(envFor(APP, assoc(HOST)));
  assert(b.signed === true && b.manifest.accountAssociation && b.host === HOST, "not signed: " + JSON.stringify(b.flags));
  const p = M.validateManifest(b.manifest, HOST, { requireSigned: true });
  assert(p.length === 0, "problems: " + p.join(" | "));
  assert(b.manifest.miniapp.homeUrl === APP + "/anon" && b.manifest.miniapp.iconUrl === APP + "/miniapp/icon.png" && b.manifest.miniapp.splashImageUrl === APP + "/miniapp/splash.png", "the urls: " + JSON.stringify(b.manifest.miniapp));
  assert(!("webhookUrl" in b.manifest.miniapp), "a webhook is declared (the Mini App sends no notifications)");
  assert(JSON.stringify(b.manifest.frame) === JSON.stringify(b.manifest.miniapp), "frame and miniapp differ");
  assert(M.MINIAPP_SPEC.includes("0.6.0") && M.MINIAPP_SPEC.includes("miniapps.farcaster.xyz"), "the spec version is not named");
  return "homeUrl " + b.manifest.miniapp.homeUrl;
});

await check("M2", "dropping each required field is caught by name (version, name, iconUrl, homeUrl; header, payload, signature)", () => {
  const good = M.buildManifest(envFor(APP, assoc(HOST))).manifest;
  const out = [];
  for (const k of ["version", "name", "iconUrl", "homeUrl"]) {
    const m = clone(good);
    delete m.miniapp[k];
    delete m.frame[k];
    const p = M.validateManifest(m, HOST, { requireSigned: true });
    assert(p.some((x) => x.startsWith(k + " ")), "dropping " + k + " was not caught: " + p.join(" | "));
    out.push(k);
  }
  for (const k of ["header", "payload", "signature"]) {
    const m = clone(good);
    delete m.accountAssociation[k];
    const p = M.validateManifest(m, HOST, { requireSigned: true });
    assert(p.some((x) => x.startsWith("accountAssociation")), "dropping accountAssociation." + k + " was not caught: " + p.join(" | "));
    out.push("accountAssociation." + k);
  }
  const noCfg = clone(good);
  delete noCfg.miniapp;
  delete noCfg.frame;
  assert(M.validateManifest(noCfg, HOST).length > 0, "a manifest with neither miniapp nor frame passed");
  return out.join(", ");
});

await check("M3", "a WRONG DOMAIN is left out of the served manifest, flagged, and caught (another host; www vs bare)", () => {
  const b = M.buildManifest(envFor(APP, assoc("other.example")));
  assert(b.signed === false && !b.manifest.accountAssociation, "an association signed for another domain was served");
  assert(b.flags.some((f) => f.includes("signed for other.example") && f.includes(HOST)), "not flagged: " + b.flags.join(" | "));
  const w = M.buildManifest(envFor(APP, assoc("www." + HOST)));
  assert(w.signed === false, "www." + HOST + " was accepted for " + HOST);
  const m = clone(M.buildManifest(envFor(APP)).manifest);
  m.accountAssociation = assoc("other.example");
  assert(M.validateManifest(m, HOST).some((p) => p.includes("signed for other.example")), "validateManifest did not catch the wrong domain");
  const d = M.decodeAssociation(assoc("https://" + HOST + "/x"), HOST);
  assert(!d.ok && d.problems.some((p) => p.includes("no domain")), "a payload with a scheme and path passed: " + JSON.stringify(d));
  const t = M.decodeAssociation(assoc(HOST, { type: "app_key" }), HOST);
  assert(!t.ok, "a header type other than custody/auth passed");
  return b.flags[0].slice(0, 90);
});

await check("M4", "NO ASSOCIATION: served unsigned, flagged by the three variable names; requireSigned catches it", () => {
  const b = M.buildManifest(envFor(APP));
  assert(b.signed === false && !b.manifest.accountAssociation, "signed with nothing set");
  const f = b.flags.join(" | ");
  for (const n of ["MINIAPP_ACCOUNT_ASSOCIATION_HEADER", "MINIAPP_ACCOUNT_ASSOCIATION_PAYLOAD", "MINIAPP_ACCOUNT_ASSOCIATION_SIGNATURE"]) assert(f.includes(n), "the flag does not name " + n + ": " + f);
  assert(f.includes("unsigned"), "the flag does not say unsigned: " + f);
  assert(M.validateManifest(b.manifest, HOST).length === 0, "an unsigned manifest is otherwise invalid: " + M.validateManifest(b.manifest, HOST).join(" | "));
  assert(M.validateManifest(b.manifest, HOST, { requireSigned: true }).some((p) => p.includes("accountAssociation is missing")), "requireSigned did not catch the missing association");
  const partial = M.buildManifest({ APP_URL: APP, MINIAPP_ACCOUNT_ASSOCIATION_HEADER: assoc(HOST).header });
  assert(partial.signed === false && partial.flags.some((x) => x.includes("incomplete")), "a partial association was not flagged: " + partial.flags.join(" | "));
  const noApp = M.buildManifest({}, "https://fallback.example");
  assert(noApp.host === "fallback.example" && noApp.flags.some((x) => x.startsWith("APP_URL is unset")), "APP_URL unset is not flagged");
  return "flagged: " + f.slice(0, 80);
});

await check("M5", "THE IMAGES meet the spec, and a wrong size, a wrong ratio, an alpha channel or an over-limit image is caught", () => {
  const facts = {};
  for (const k of ["icon", "splash", "embed"]) {
    const f = path.join(ROOT, "public", "miniapp", k + ".png");
    assert(existsSync(f), "missing public/miniapp/" + k + ".png");
    facts[k] = M.pngFacts(new Uint8Array(readFileSync(f)));
    const p = M.imageProblems(k, facts[k]);
    assert(p.length === 0, k + ": " + p.join(" | "));
  }
  assert(facts.icon.alpha === false && facts.icon.colorType === 2, "the icon is not RGB without alpha");
  const caught = (k, png, what) => {
    const p = M.imageProblems(k, M.pngFacts(png));
    assert(p.length > 0, what + " was not caught");
  };
  caught("icon", pngOf(1025, 1024), "a 1025x1024 icon");
  caught("icon", pngOf(1024, 1024, 6), "an icon with an alpha channel (RGBA)");
  caught("icon", pngOf(1024, 1024, 3, { trns: true }), "a palette icon with transparency (tRNS)");
  caught("splash", pngOf(256, 256), "a 256x256 splash");
  caught("embed", pngOf(1200, 801), "a 1200x801 embed (not 3:2)");
  caught("embed", pngOf(3300, 2200), "a 3300x2200 embed (over 3000x2000)");
  caught("embed", pngOf(450, 300), "a 450x300 embed (under 600x400)");
  const big = { ...M.pngFacts(pngOf(1200, 800)), bytes: 10 * 1024 * 1024 };
  assert(M.imageProblems("embed", big).some((p) => p.includes("10 MB")), "a 10 MB embed was not caught");
  assert(M.imageProblems("icon", null).length === 1 && M.pngFacts(new Uint8Array([1, 2, 3])) === null, "a non-PNG was not caught");
  return `icon ${facts.icon.width}x${facts.icon.height} type ${facts.icon.colorType}, splash ${facts.splash.width}x${facts.splash.height}, embed ${facts.embed.width}x${facts.embed.height} (${facts.embed.bytes} B)`;
});

await check("M6", "THE EMBED: fc:miniapp (launch_miniapp) and fc:frame (launch_frame) pass; a long title, a wrong type, an http image are caught", () => {
  const e = M.miniAppEmbed(APP);
  assert(M.validateEmbed(e).length === 0, M.validateEmbed(e).join(" | "));
  const l = M.miniAppEmbed(APP, true);
  assert(M.validateEmbed(l, { legacy: true }).length === 0 && l.button.action.type === "launch_frame", "legacy: " + M.validateEmbed(l, { legacy: true }).join(" | "));
  assert(e.button.action.url === APP + "/anon" && e.imageUrl === APP + "/miniapp/embed.png", "embed urls: " + JSON.stringify(e));
  const meta = M.embedMeta(APP);
  assert(JSON.parse(meta["fc:miniapp"]).button.action.type === "launch_miniapp" && JSON.parse(meta["fc:frame"]).button.action.type === "launch_frame", "the meta pair");
  const long = clone(e);
  long.button.title = "x".repeat(33);
  assert(M.validateEmbed(long).some((p) => p.includes("title")), "a 33-character title passed");
  const wrong = clone(e);
  wrong.button.action.type = "launch_frame";
  assert(M.validateEmbed(wrong).some((p) => p.includes("launch_miniapp")), "a launch_frame action passed as fc:miniapp");
  const http = clone(e);
  http.imageUrl = "http://" + HOST + "/miniapp/embed.png";
  assert(M.validateEmbed(http).some((p) => p.startsWith("imageUrl")), "an http image passed");
  const local = clone(e);
  local.imageUrl = "https://localhost/miniapp/embed.png";
  assert(M.validateEmbed(local).some((p) => p.startsWith("imageUrl")), "a localhost image passed");
  return "button '" + e.button.title + "'";
});

await check("M7", "the spec's string rules hold for every shipped text, and a bad one is caught", () => {
  const cfg = M.buildManifest(envFor(APP)).manifest.miniapp;
  for (const [k, max] of [["subtitle", 30], ["description", 170], ["tagline", 30], ["ogTitle", 30], ["ogDescription", 100]]) assert(M.simpleStringProblem(cfg[k], max) === null, k + ": " + M.simpleStringProblem(cfg[k], max));
  assert(cfg.name.length <= 32 && M.MINIAPP_BUTTON_TITLE.length <= 32, "name or button over 32");
  const bad = clone(M.buildManifest(envFor(APP)).manifest);
  bad.miniapp.description = "Post @anon #now";
  bad.frame = bad.miniapp;
  assert(M.validateManifest(bad, HOST).some((p) => p.startsWith("description")), "a description with @ and # passed");
  const tags = clone(M.buildManifest(envFor(APP)).manifest);
  tags.miniapp.tags = ["Anon"];
  tags.frame = tags.miniapp;
  assert(M.validateManifest(tags, HOST).some((p) => p.includes("lowercase")), "an uppercase tag passed");
  const six = clone(M.buildManifest(envFor(APP)).manifest);
  six.miniapp.tags = ["a", "b", "c", "d", "e", "f"];
  six.frame = six.miniapp;
  assert(M.validateManifest(six, HOST).some((p) => p.includes("at most 5")), "six tags passed");
  assert(M.simpleStringProblem("no no!!", 30) !== null && M.simpleStringProblem("a 🚩 flag", 30) !== null, "repeated punctuation or an emoji passed");
  return cfg.description.length + "/170 characters";
});

await check("M8", "homeUrl on another host is caught", () => {
  const m = clone(M.buildManifest(envFor(APP)).manifest);
  m.miniapp.homeUrl = "https://elsewhere.example/anon";
  m.frame = m.miniapp;
  assert(M.validateManifest(m, HOST).some((p) => p.startsWith("homeUrl is on elsewhere.example")), M.validateManifest(m, HOST).join(" | "));
});

await check("M9", "frame and miniapp differing is caught", () => {
  const m = clone(M.buildManifest(envFor(APP)).manifest);
  m.frame = { ...m.miniapp, name: "Another" };
  assert(M.validateManifest(m, HOST).some((p) => p.includes("not identical")), "differing frame/miniapp passed");
});

await check("M10", "the web composer link is the documented intent URL, with the post's link as its one embed and no text", () => {
  const link = APP + "/anon/p/" + "a".repeat(64);
  const u = M.farcasterComposeUrl(link);
  assert(u.startsWith("https://farcaster.xyz/~/compose?embeds[]="), u);
  assert(decodeURIComponent(u.split("embeds[]=")[1]) === link, "the embed does not decode back: " + u);
  assert(!u.includes("text="), "a text parameter was added: " + u);
  assert(M.anonSharePath("b".repeat(64)) === "/anon/p/" + "b".repeat(64) && M.CAST_HASH_RE.test("c".repeat(64)) && !M.CAST_HASH_RE.test("C".repeat(64)), "the share path or the hash rule");
  return u.slice(0, 70) + "…";
});

await check("M11", '"View on Farcaster" only for https on the Farcaster web hosts', () => {
  assert(M.isFarcasterWebUrl("https://farcaster.xyz/~/conversations/0xabc"), "farcaster.xyz refused");
  for (const bad of ["http://farcaster.xyz/x", "https://evil.example/x", "https://farcaster.xyz.evil.example/x", "https://user:pw@farcaster.xyz/x", "javascript:alert(1)", 42, null]) assert(!M.isFarcasterWebUrl(bad), "accepted " + String(bad));
});

await check("M12", "where /anon may connect: the validator (pinned to lib/ports.ts), the sign-in relay and node (pinned to flow.ts), loopback/https overrides as origins only, OHTTP when set; non-loopback http refused", () => {
  const d = M.anonConnectOrigins({});
  assert(JSON.stringify(d) === JSON.stringify(["http://localhost:4001", "https://relay.farcaster.xyz", "https://mainnet.optimism.io"]), "defaults: " + JSON.stringify(d));
  // the DELIBERATE DUPLICATES: the validator expression is lib/ports.ts validatorUrl() when NEXT_PUBLIC_VALIDATOR_URL is unset
  const saved = { ...process.env };
  try {
    for (const k of ["NEXT_PUBLIC_VALIDATOR_URL", "VALIDATOR_URL", "LAYERS_VALIDATOR_PORT", "VALIDATOR_PORT"]) delete process.env[k];
    process.env.LAYERS_VALIDATOR_PORT = "4555";
    assert(M.anonConnectOrigins({ LAYERS_VALIDATOR_PORT: "4555" })[0] === new URL(P.ports.validatorUrl()).origin, "the validator origin differs from lib/ports.ts validatorUrl()");
    process.env.VALIDATOR_URL = "https://v.example";
    assert(M.anonConnectOrigins({ VALIDATOR_URL: "https://v.example" })[0] === new URL(P.ports.validatorUrl()).origin, "VALIDATOR_URL differs from lib/ports.ts");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  const flow = readFileSync(path.join(ROOT, "lib", "fc", "siwf", "flow.ts"), "utf8");
  assert(flow.includes('export const DEFAULT_RELAY_URL = "https://relay.farcaster.xyz";') && flow.includes('export const DEFAULT_RPC_URL = "https://mainnet.optimism.io";'), "lib/fc/siwf/flow.ts defaults moved: update the duplicates in lib/miniapp/manifest.ts");
  const o = M.anonConnectOrigins({ NEXT_PUBLIC_VALIDATOR_URL: "https://validator.example/x", FC_SIWF_RELAY_URL: "http://127.0.0.1:4321/", FC_SIWF_RPC_URL: "https://opt.example/v2/SECRETKEY", ZK_RELAY: "ohttp", ZK_RELAY_URL: "https://ohttp.example/relay" });
  assert(JSON.stringify(o) === JSON.stringify(["https://validator.example", "http://127.0.0.1:4321", "https://opt.example", "https://ohttp.example"]), "overrides: " + JSON.stringify(o));
  assert(!o.join(" ").includes("SECRETKEY"), "a path (a key) reached the policy");
  const r = M.anonConnectOrigins({ FC_SIWF_RELAY_URL: "http://relay.evil.example", FC_SIWF_RPC_URL: "ftp://x" });
  assert(r.includes("https://relay.farcaster.xyz") && !r.some((x) => x.includes("evil")) && r.includes("https://mainnet.optimism.io"), "a non-loopback http override was allowed: " + JSON.stringify(r));
  return o.join(" ");
});

await check("M13", "the anon page's policy: frame-ancestors = the Farcaster web origins only, no wildcard, no eval in production", () => {
  const pol = M.anonPagePolicy({ NODE_ENV: "production", NEXT_PUBLIC_VALIDATOR_URL: "https://validator.example" });
  const dir = Object.fromEntries(pol.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert(JSON.stringify(dir["frame-ancestors"]) === JSON.stringify(M.FRAME_ANCESTORS), "frame-ancestors: " + dir["frame-ancestors"]);
  assert(M.FRAME_ANCESTORS.every((o) => /^https:\/\/[a-z0-9.-]+$/.test(o) && !o.includes("*")), "a framer is not an exact https origin");
  // PUBLIC GO-LIVE (F14): the only wildcard allowed anywhere is a media host's subdomain source in img-src
  const media = M.anonImageSources();
  assert(JSON.stringify(media) === JSON.stringify(M.ANON_MEDIA_HOSTS.flatMap((h) => ["https://" + h, "https://*." + h])) && M.ANON_MEDIA_HOSTS.length > 0, "anonImageSources is not ANON_MEDIA_HOSTS, each host and its subdomains: " + JSON.stringify(media));
  const tokens = pol.split(";").flatMap((d) => d.trim().split(/\s+/).slice(1));
  const wild = tokens.filter((t) => t.includes("*") && !media.includes(t));
  assert(wild.length === 0 && !tokens.includes("*") && !pol.includes("'unsafe-eval'") && !dir["frame-ancestors"].includes("'none'"), "a wildcard, eval or 'none' in: " + pol);
  for (const k of ["script-src", "style-src", "font-src"]) assert(dir[k] && dir[k].every((v) => !/^https?:/.test(v)), k + " names an outside origin: " + dir[k]);
  assert(JSON.stringify(dir["img-src"]) === JSON.stringify(["'self'", "data:", "blob:", ...media]), "img-src is not exactly 'self' data: blob: + the media hosts: " + dir["img-src"]);
  assert(dir["connect-src"].includes("https://validator.example") && dir["object-src"][0] === "'none'" && dir["frame-src"][0] === "'none'", "connect/object/frame: " + pol);
  const dev = M.anonPagePolicy({ NODE_ENV: "development" });
  assert(dev.includes("'unsafe-eval'"), "next dev needs eval");
  assert(M.isAnonPagePath("/anon") && M.isAnonPagePath("/anon/p/" + "a".repeat(64)) && !M.isAnonPagePath("/anon/") && !M.isAnonPagePath("/anonx") && !M.isAnonPagePath("/anon/p/a/b") && !M.isAnonPagePath("/home"), "isAnonPagePath");
  return dir["frame-ancestors"].join(" ");
});

await check("M17", "F14: ANON_MEDIA_HOSTS is exactly components/CastCard.tsx MEDIA_HOSTS (the deliberate duplicate)", () => {
  const src = readFileSync(path.join(ROOT, "components", "CastCard.tsx"), "utf8");
  const m = /const MEDIA_HOSTS\s*=\s*(\[[^\]]*\])/.exec(src);
  assert(m, "components/CastCard.tsx has no MEDIA_HOSTS list (moved? update lib/miniapp/manifest.ts ANON_MEDIA_HOSTS and this check)");
  const cast = JSON.parse(m[1].replace(/'/g, '"').replace(/,\s*\]$/, "]"));
  assert(JSON.stringify(cast) === JSON.stringify([...M.ANON_MEDIA_HOSTS]), "CastCard MEDIA_HOSTS " + JSON.stringify(cast) + " != ANON_MEDIA_HOSTS " + JSON.stringify(M.ANON_MEDIA_HOSTS));
  return cast.length + " hosts";
});

await check("M14", "base64 and base64url, padded or not, decode the same; junk is null", () => {
  const s = JSON.stringify({ domain: "a-b.example", n: "é" });
  const std = Buffer.from(s).toString("base64");
  const url = Buffer.from(s).toString("base64url");
  const dec = (x) => Buffer.from(M.base64Bytes(x)).toString("utf8");
  assert(dec(std) === s && dec(url) === s && dec(std.replace(/=+$/, "")) === s, "decode mismatch");
  assert(M.base64Bytes("***") === null && M.base64Bytes("") === null && M.base64Bytes("a") === null, "junk decoded");
});

await check("M15", "the Mini App SDK is pinned EXACTLY (0.3.0) wherever it appears — never a range", () => {
  assert(M.MINIAPP_SDK_VERSION === "0.3.0" && M.MINIAPP_SDK_PACKAGE === "@farcaster/miniapp-sdk", "the pin in lib/miniapp/manifest.ts");
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const dep = (pkg.dependencies ?? {})[M.MINIAPP_SDK_PACKAGE] ?? (pkg.devDependencies ?? {})[M.MINIAPP_SDK_PACKAGE];
  if (dep !== undefined) assert(dep === M.MINIAPP_SDK_VERSION, "package.json has " + dep + ", not the exact " + M.MINIAPP_SDK_VERSION);
  const inst = path.join(ROOT, "node_modules", "@farcaster", "miniapp-sdk", "package.json");
  if (existsSync(inst)) assert(JSON.parse(readFileSync(inst, "utf8")).version === M.MINIAPP_SDK_VERSION, "node_modules holds another version");
  return dep === undefined ? "NOTE: not in package.json yet (the verify agent adds it); the pin itself holds" : "package.json " + dep + (existsSync(inst) ? ", installed" : ", not installed yet");
});

await check("M16", "smoke-deployed check 15's FARCASTER_FRAMERS is exactly FRAME_ANCESTORS (the deliberate duplicate)", () => {
  const f = path.join(ROOT, "scripts", "smoke-deployed.mjs");
  const src = existsSync(f) ? readFileSync(f, "utf8") : "";
  const m = /const FARCASTER_FRAMERS = (\[[^\]]*\]);/.exec(src);
  if (!m) return "NOTE: check 15 is not in scripts/smoke-deployed.mjs yet (gpl pastes it); nothing to pin";
  const list = JSON.parse(m[1]);
  assert(JSON.stringify(list) === JSON.stringify(M.FRAME_ANCESTORS), "smoke check 15 frames " + JSON.stringify(list) + ", the middleware " + JSON.stringify(M.FRAME_ANCESTORS));
  // PUBLIC GO-LIVE (F14): check 15's media-source duplicate, once gpl applies the anonpage diff (until then a NOTE: check 15
  // as pasted still forbids any https image host on /anon, and would refuse the F14 policy on a deployment)
  const media = /const ANON_MEDIA_SOURCES = (\[[^\]]*\]);/.exec(src);
  if (!media) return list.length + " origins, equal; NOTE: smoke check 15 has no ANON_MEDIA_SOURCES yet (the anonpage cross-file diff for F14): until it lands, check 15 refuses /anon's img-src on a deployment";
  const sources = JSON.parse(media[1]);
  assert(JSON.stringify(sources) === JSON.stringify(M.anonImageSources()), "smoke check 15's ANON_MEDIA_SOURCES " + JSON.stringify(sources) + " != anonImageSources() " + JSON.stringify(M.anonImageSources()));
  return list.length + " origins, equal; " + sources.length + " media sources, equal";
});

await check("V1", "a Mini App sign-in (a host-built SIWF message over OUR nonce) passes the device's own verifier; another domain, nonce or account is refused", async () => {
  const viem = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");
  const { createSiweMessage } = require("viem/siwe");
  const V = P.verify;
  const acct = privateKeyToAccount(viem.keccak256(viem.toBytes("unit-miniapp/custody/777001")));
  const nonce = "Ab3dEf6hIj9kLm2n";
  const now = Date.now();
  const message = createSiweMessage({ domain: HOST, address: acct.address, statement: "Farcaster Auth", uri: APP + "/anon", version: "1", chainId: 10, nonce, issuedAt: new Date(now), expirationTime: new Date(now + 5 * 60_000), resources: ["farcaster://fid/777001"] });
  const signature = await acct.signMessage({ message });
  const calls = [];
  const rpc = async (method, params) => {
    calls.push(method);
    if (method === "eth_chainId") return "0xa";
    if (method === "eth_call") {
      const d = viem.decodeFunctionData({ abi: V.ID_REGISTRY_ABI, data: params[0].data });
      const owner = String(d.args[0]).toLowerCase();
      return viem.encodeFunctionResult({ abi: V.ID_REGISTRY_ABI, functionName: "idOf", result: owner === acct.address.toLowerCase() ? 777001n : 0n });
    }
    throw new Error("unexpected rpc " + method);
  };
  const expect = { domain: HOST, origin: APP, nonce, deadlineMs: now + 10 * 60_000, nowMs: now };
  const ok = await V.verifySiwf({ message, signature, fid: 777001, nonce, authMethod: "custody" }, expect, { rpc, chainChecked: false });
  assert(ok.verified.fid === 777001 && ok.verified.authMethod === "custody" && calls.includes("eth_call"), "not verified: " + JSON.stringify(ok));
  const refused = async (what, c, e) => {
    try {
      await V.verifySiwf(c, e, { rpc, chainChecked: true });
    } catch (err) {
      return err && err.code;
    }
    throw new Error(what + " was accepted");
  };
  assert((await refused("another domain", { message, signature, fid: 777001, nonce, authMethod: "custody" }, { ...expect, domain: "other.example" })) === "siwf_message", "another domain");
  assert((await refused("another nonce", { message, signature, fid: 777001, nonce: "Zz3dEf6hIj9kLm2n", authMethod: "custody" }, { ...expect, nonce: "Zz3dEf6hIj9kLm2n" })) === "siwf_message", "another nonce");
  assert((await refused("another account", { message, signature, fid: 777002, nonce, authMethod: "custody" }, expect)) === "siwf_message", "another account");
  const flow = readFileSync(path.join(ROOT, "lib", "fc", "siwf", "flow.ts"), "utf8");
  const m = /function fidOfSiwfMessage[\s\S]*?const m = (\/.*\/m)\.exec\(message\)/.exec(flow);
  if (!m) return "NOTE: lib/fc/siwf/flow.ts has no Mini App steps yet (relay applies the anonpage diff); the verifier half holds";
  const re = new Function("return " + m[1])();
  const hit = re.exec(message);
  assert(hit && Number(hit[1]) === 777001, "flow.ts's fid parser does not read the message's farcaster://fid/N line: " + m[1]);
  return "verified, and flow.ts's fid parser reads fid " + hit[1];
});

// ---------------------------------------------------------------------------------------------------- F/R: middleware + route
// the environment the middleware's policy is built from (once per process), as on a public deployment
Object.assign(process.env, { NODE_ENV: "production", NEXT_PUBLIC_VALIDATOR_URL: "https://validator.example", APP_URL: APP });
delete process.env.ZK_DEV_HOOKS;
delete process.env.OWNER_ACCESS_SECRET;
delete process.env.LAYERS_MAINTENANCE;
MW = await import(pathToFileURL(S("mw.mjs")).href);
const req = (p, { method = "GET", host = "localhost:3001" } = {}) => {
  const url = new URL("http://" + host + p);
  return { nextUrl: url, url: url.toString(), method, headers: new Headers({ host }), cookies: { get: () => undefined }, ip: undefined, text: async () => "" };
};
const frameOf = (res) => ({ csp: res.headers.get("content-security-policy") ?? "", xfo: res.headers.get("x-frame-options"), status: res.status, location: res.headers.get("location") });
const ANON_HASH = "d".repeat(64);

await check("F1", "middleware: /anon and /anon/p/<64 hex> carry the anon policy (Farcaster framers only) and NO X-Frame-Options", async () => {
  for (const p of ["/anon", "/anon/p/" + ANON_HASH]) {
    const f = frameOf(await MW.mw.middleware(req(p)));
    const fa = (f.csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-ancestors")) ?? "").split(/\s+/).slice(1);
    assert(JSON.stringify(fa) === JSON.stringify(M.FRAME_ANCESTORS), p + " frame-ancestors: " + fa.join(" "));
    assert(f.xfo === null, p + " carries X-Frame-Options " + f.xfo);
    assert(f.csp.includes("connect-src 'self' https://validator.example") && !f.csp.includes("'unsafe-eval'"), p + " policy: " + f.csp);
  }
  return "frame-ancestors " + M.FRAME_ANCESTORS.length + " origins";
});

await check("F2", "middleware: every other document stays unframeable (frame-ancestors 'none' + X-Frame-Options DENY)", async () => {
  const paths = ["/home", "/welcome", "/device", "/", "/anonx", "/anon/x", "/anon/p/a/b", "/settings/moderation", "/terms", "/miniapp/icon.png"];
  for (const p of paths) {
    const f = frameOf(await MW.mw.middleware(req(p)));
    assert(f.csp === "frame-ancestors 'none'" && f.xfo === "DENY", p + ": " + JSON.stringify(f));
  }
  return paths.length + " paths";
});

await check("F3", "middleware: /anon/ is redirected (unframeable); the manifest passes untouched; maintenance on /anon stays unframeable", async () => {
  const r = frameOf(await MW.mw.middleware(req("/anon/")));
  assert(r.status === 308 && /\/anon$/.test(r.location ?? "") && r.csp === "frame-ancestors 'none'" && r.xfo === "DENY", "/anon/: " + JSON.stringify(r));
  const m = await MW.mw.middleware(req(M.MANIFEST_PATH));
  assert(m.headers.get("x-middleware-next") === "1" && m.headers.get("content-security-policy") === null && m.headers.get("x-frame-options") === null && m.headers.get("location") === null, "the manifest: " + JSON.stringify([...m.headers]));
  process.env.LAYERS_MAINTENANCE = "true";
  try {
    const mm = frameOf(await MW.mw.middleware(req("/anon")));
    assert(mm.status === 503 && mm.csp === "frame-ancestors 'none'" && mm.xfo === "DENY", "maintenance on /anon: " + JSON.stringify(mm));
  } finally {
    delete process.env.LAYERS_MAINTENANCE;
  }
});

await check("H1", "F6: on a LIVE public site a page on another host is 308'd to the same path+query on APP_URL; /api, POST, loopback, private network, no host and the canonical host pass; preview, rig and unset APP_URL never redirect", async () => {
  const OLD = "layers-production.up.railway.app";
  const hreq = (p, { method = "GET", host = OLD, xfh = null } = {}) => {
    const url = new URL("http://localhost:8080" + p); // next start's own listener on the platform's PORT, as behind its proxy (runner-test 5 refuses the default-port literal)
    const headers = new Headers();
    if (host !== null) headers.set("host", host);
    if (xfh !== null) headers.set("x-forwarded-host", xfh);
    return { nextUrl: url, url: url.toString(), method, headers, cookies: { get: () => undefined }, ip: undefined, text: async () => "" };
  };
  const saved = { ...process.env };
  const savedWindow = globalThis.window;
  delete globalThis.window; // the middleware runs on the server (Edge): no window (isPublicLive reads the server's flag)
  const setEnv = (o) => {
    for (const k of ["PUBLIC_LIVE", "ZK_DEV_HOOKS", "APP_URL"]) delete process.env[k];
    Object.assign(process.env, { NODE_ENV: "production" }, o);
  };
  try {
    setEnv({ PUBLIC_LIVE: "true", APP_URL: APP });
    const r = await MW.mw.middleware(hreq("/anon", { method: "GET" }));
    const withQ = await MW.mw.middleware(hreq("/welcome?from=anon&x=1"));
    assert(r.status === 308 && r.headers.get("location") === APP + "/anon", "/anon on the old host: " + r.status + " " + r.headers.get("location"));
    assert(withQ.status === 308 && withQ.headers.get("location") === APP + "/welcome?from=anon&x=1", "the query is kept: " + withQ.headers.get("location"));
    assert(r.headers.get("cache-control") === "no-store" && r.headers.get("x-frame-options") === "DENY" && r.headers.get("content-security-policy") === "frame-ancestors 'none'", "the redirect's headers: " + JSON.stringify([...r.headers]));
    const head = await MW.mw.middleware(hreq("/home", { method: "HEAD" }));
    assert(head.status === 308, "HEAD on the old host: " + head.status);
    // X-Forwarded-Host first (a proxy that rewrites Host keeps the public one there): the canonical one passes, another redirects
    const viaXfh = await MW.mw.middleware(hreq("/home", { host: "internal:3000", xfh: OLD + ", edge.example" }));
    assert(viaXfh.status === 308 && viaXfh.headers.get("location") === APP + "/home", "X-Forwarded-Host " + OLD + ": " + viaXfh.status);
    const canonXfh = await MW.mw.middleware(hreq("/home", { host: OLD, xfh: HOST }));
    assert(canonXfh.status !== 308 && canonXfh.headers.get("location") === null, "the canonical X-Forwarded-Host was redirected: " + canonXfh.status);
    const passes = [
      ["the canonical host", hreq("/home", { host: HOST })],
      ["the canonical host, upper case with a port", hreq("/home", { host: HOST.toUpperCase() + ":443" })],
      ["/api/health", hreq("/api/health")],
      ["/api/anon", hreq("/api/anon")],
      ["a POST", hreq("/home", { method: "POST" })],
      ["localhost", hreq("/home", { host: "localhost:3001" })],
      ["127.0.0.1", hreq("/home", { host: "127.0.0.1:3001" })],
      ["[::1]", hreq("/home", { host: "[::1]:3001" })],
      ["the private network", hreq("/home", { host: "app.railway.internal" })],
      ["no host", hreq("/home", { host: null })],
    ];
    for (const [what, q] of passes) {
      const res = await MW.mw.middleware(q);
      assert(res.status !== 308 || /\/$/.test(q.nextUrl.pathname), what + " was redirected: " + res.status + " " + res.headers.get("location"));
      assert(!String(res.headers.get("location") ?? "").startsWith(APP + "/"), what + " was sent to APP_URL: " + res.headers.get("location"));
    }
    for (const [what, env] of [
      ["the preview (PUBLIC_LIVE unset)", { APP_URL: APP }],
      ["PUBLIC_LIVE=false", { PUBLIC_LIVE: "false", APP_URL: APP }],
      ["the rig (ZK_DEV_HOOKS=true)", { PUBLIC_LIVE: "true", ZK_DEV_HOOKS: "true", APP_URL: APP }],
      ["no APP_URL", { PUBLIC_LIVE: "true" }],
    ]) {
      setEnv(env);
      const res = await MW.mw.middleware(hreq("/anon"));
      assert(res.status !== 308 && res.headers.get("location") === null, what + " redirected: " + res.status + " " + res.headers.get("location"));
    }
    return "old host -> " + r.headers.get("location");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    if (savedWindow !== undefined) globalThis.window = savedWindow;
  }
});

await check("R1", "the manifest route: 200 JSON, nosniff, cacheable, readable from any origin, valid for the host it names", async () => {
  const res = await MW.route.GET(req(M.MANIFEST_PATH));
  assert(res.status === 200 && (res.headers.get("content-type") ?? "").includes("application/json"), "status/type: " + res.status + " " + res.headers.get("content-type"));
  assert(res.headers.get("access-control-allow-origin") === "*" && res.headers.get("x-content-type-options") === "nosniff" && /max-age=\d+/.test(res.headers.get("cache-control") ?? ""), "headers: " + JSON.stringify([...res.headers]));
  const body = JSON.parse(await res.text());
  const p = M.validateManifest(body, HOST);
  assert(p.length === 0 && body.miniapp.homeUrl === APP + "/anon" && !body.accountAssociation, "body: " + p.join(" | "));
  return "unsigned, homeUrl " + body.miniapp.homeUrl;
});

// ---------------------------------------------------------------------------------------------------- S/U: the SDK + the page
let uiN = 0;
/** a FRESH copy of the UI bundle (its module state — the SDK's one detection per document — starts over) in a window */
async function freshUi(win, fake) {
  globalThis.__fakeSdk = { evaluated: 0, calls: [], inMiniApp: false, signIn: "ok", missing: false, ...fake };
  globalThis.window = win;
  return import(uiFile + "?n=" + ++uiN);
}
const topWindow = () => {
  const w = {};
  w.parent = w;
  return w;
};
const framedWindow = () => ({ parent: {} });

await check("S1", "outside a Farcaster client the SDK is NEVER EVALUATED (not framed, no WebView): detect says outside", async () => {
  const U = await freshUi(topWindow(), { inMiniApp: true });
  const s = await U.sdk.detectMiniApp(50);
  assert(s.inside === false && s.sdk === false, "detect: " + JSON.stringify(s));
  assert((await U.sdk.miniAppReady()) === false && (await U.sdk.miniAppOpenUrl("https://x.example")) === false, "an SDK call went through outside");
  assert(globalThis.__fakeSdk.evaluated === 0 && globalThis.__fakeSdk.calls.length === 0, "the SDK module ran outside a client: " + JSON.stringify(globalThis.__fakeSdk));
  return "0 evaluations";
});

await check("S2", "inside (the host answers): ready() once; sign-in carries our nonce with acceptAuthAddress; compose and openUrl reach the host", async () => {
  const U = await freshUi(framedWindow(), { inMiniApp: true });
  assert((await U.sdk.detectMiniApp(50)).inside === true, "not detected inside");
  assert((await U.sdk.miniAppReady()) === true && (await U.sdk.miniAppReady()) === true, "ready");
  const calls = globalThis.__fakeSdk.calls;
  assert(calls.filter((c) => c === "ready").length === 1, "ready() was called " + calls.filter((c) => c === "ready").length + " times");
  const r = await U.sdk.miniAppSignIn("n0nce123", "2026-10-17T12:00:00.000Z");
  assert(r && r.message === "a message" && r.authMethod === "authAddress" && calls.includes("signIn:n0nce123:true"), "sign-in: " + JSON.stringify(r) + " " + calls.join(","));
  assert((await U.sdk.miniAppCompose(APP + "/anon/p/" + ANON_HASH)) === true && calls.some((c) => c.startsWith("composeCast:") && c.includes(ANON_HASH) && c.includes('"embeds"')), "compose");
  assert((await U.sdk.miniAppOpenUrl(APP + "/welcome?from=anon")) === true && calls.includes("openUrl:" + APP + "/welcome?from=anon"), "openUrl");
  const u = await U.sdk.miniAppUser();
  assert(u && u.fid === 990777 && u.username === "stubalice", "the host user: " + JSON.stringify(u));
  return calls.join(", ").slice(0, 120);
});

await check("S3", "framed but the host does not answer: nothing is called (no ready, no sign-in, no compose)", async () => {
  const U = await freshUi(framedWindow(), { inMiniApp: false });
  assert((await U.sdk.detectMiniApp(50)).inside === false, "detected inside");
  assert((await U.sdk.miniAppReady()) === false && (await U.sdk.miniAppSignIn("n")) === null && (await U.sdk.miniAppCompose("https://x.example")) === false, "a call went through");
  const calls = globalThis.__fakeSdk.calls;
  assert(calls.every((c) => c === "isInMiniApp"), "calls: " + calls.join(","));
});

await check("S4", "a declined sign-in is 'rejected'; any other failure is null (never a fake success)", async () => {
  let U = await freshUi(framedWindow(), { inMiniApp: true, signIn: "reject" });
  const a = await U.sdk.miniAppSignIn("n1");
  assert(a && a.rejected === true, "declined: " + JSON.stringify(a));
  U = await freshUi(framedWindow(), { inMiniApp: true, signIn: "throw" });
  assert((await U.sdk.miniAppSignIn("n2")) === null, "a host failure was not null");
});

await check("S5", "the package missing from the build: nothing breaks (outside, and framed)", async () => {
  let U = await freshUi(framedWindow(), { missing: true, inMiniApp: true });
  const s = await U.sdk.detectMiniApp(50);
  assert(s.inside === false && s.sdk === false && (await U.sdk.miniAppReady()) === false, "missing package: " + JSON.stringify(s));
  U = await freshUi(topWindow(), { missing: true });
  assert((await U.sdk.detectMiniApp(50)).inside === false, "outside");
});

await check("U1", "the page's helpers: the crowd sentence; the feed parser (bad rows and off-host links dropped; no list = unsupported); Post only on an answer that SAYS yes", async () => {
  const U = await freshUi(topWindow(), {});
  const c = U.explainer.crowdSentence;
  assert(c({ members: 12, floor: 50, availableFrom: null, unreadable: false }) === "12 of 50 people have joined. Posting opens at 50.", c({ members: 12, floor: 50, availableFrom: null, unreadable: false }));
  assert(c({ members: 70, floor: 50, availableFrom: null, unreadable: false }).startsWith("70 people have joined"), "over the floor");
  assert(/This browser can post from .+ \(new members are let in every 6 hours\)\.$/.test(c({ members: 70, floor: 50, availableFrom: Date.UTC(2026, 9, 17, 18), unreadable: false })), "availableFrom");
  assert(c({ members: null, floor: 50, availableFrom: null, unreadable: true }).includes("couldn't be read") && c(null).startsWith("Checking") && c({ members: null, floor: 50, availableFrom: null, unreadable: false, checking: true }).startsWith("Checking"), "unknown is said as unknown (and no check yet as checking)");
  // PUBLIC GO-LIVE (verify): posting OFF for the site (a live site before its @anon is switched on) is said as off, never
  // as a crowd that is "open" — even when the test universe's members would clear the floor
  const offSentence = "Anonymous posting isn't switched on for this site yet, so nothing can be posted anonymously right now.";
  assert(c({ members: 70, floor: 50, availableFrom: null, unreadable: false, off: offSentence }) === offSentence, "an OFF site still says a crowd count: " + c({ members: 70, floor: 50, availableFrom: null, unreadable: false, off: offSentence }));
  assert(c(U.explainer.offCrowd(offSentence, 50)) === offSentence && c(U.explainer.offCrowd(null, 50)) === U.explainer.CROWD_OFF_FALLBACK, "offCrowd");
  const off = U.explainer.postingOffForSite;
  assert(off({ destination: "off" }) && off({ anonDeploymentOff: true }) && !off({ destination: "layers" }) && !off({ destination: "farcaster" }) && !off(null), "postingOffForSite");
  const appSrc = readFileSync(path.join(ROOT, "app", "anon", "AnonApp.tsx"), "utf8");
  const offAt = appSrc.indexOf("if (postingOffForSite(j)) setCrowd(offCrowd(");
  const membersAt = appSrc.indexOf("st.snapshot.members");
  assert(offAt > 0 && membersAt > offAt, "AnonApp does not check 'posting off for this site' before it reads the crowd's members");
  const parsed = U.feed.parseFeed({ universe: "live", casts: [{ castHash: "e".repeat(64), text: "ok", at: 1, castUrl: "https://farcaster.xyz/~/c/1" }, { castHash: "bad", text: "x" }, { castHash: "f".repeat(64), text: "off-host", castUrl: "https://evil.example/x" }, { castHash: "a".repeat(64) }] });
  assert(parsed && parsed.universe === "live" && parsed.casts.length === 2 && parsed.casts[0].castUrl && parsed.casts[1].castUrl === null, "parsed: " + JSON.stringify(parsed));
  assert(U.feed.parseFeed({ mode: "fixture", recent: [] }) === null && U.feed.parseFeed(null) === null, "an answer without casts is not 'unsupported'");
  const down = U.feed.parseFeed({ universe: "live", casts: null, castsError: "the anonymous posts couldn't be read just now (503)" });
  assert(down && down.error && down.error.includes("503") && !("casts" in down), "the relay's casts:null + castsError is not an error: " + JSON.stringify(down));
  const po = U.composer.postOffered;
  assert(po({ available: true }) && !po({ available: null }) && !po({}) && !po(null) && !po({ available: false }) && !po({ available: true, destination: "off" }), "postOffered fails open");
  assert(U.share.SHARE_COST.includes("may guess"), "the share's cost sentence");
});

await check("U2", "'Open Totem' is a SOFT link to /welcome?from=anon in a browser, and the SDK's openUrl inside a Mini App (with the sentence)", async () => {
  const U = await freshUi(topWindow(), {});
  const html = U.renderToStaticMarkup(U.React.createElement(U.open.OpenLayersLink, { inMiniApp: false, origin: APP }));
  assert(/<a[^>]*data-next-link="1"[^>]*href="\/welcome\?from=anon"/.test(html) || /<a[^>]*href="\/welcome\?from=anon"[^>]*data-next-link="1"/.test(html), "not a next/link soft link: " + html);
  assert((html.match(/<a /g) ?? []).length === 1, "a second, plain link: " + html);
  const mini = U.renderToStaticMarkup(U.React.createElement(U.open.OpenLayersLink, { inMiniApp: true, origin: APP }));
  assert(!mini.includes("<a ") && mini.includes('data-mode="miniapp"') && mini.includes(U.open.MINIAPP_STORAGE_NOTE.replace(/'/g, "&#x27;").slice(0, 30)), "the Mini App branch: " + mini);
  assert(U.open.OPEN_LAYERS_HREF === "/welcome?from=anon", "the href");
});

await check("U3", "the page renders before the device boots (explainer, click-through, Starting…; no sign-in or composer yet); the composer says where a post goes only when it is on, and the reason once when it is off", async () => {
  const U = await freshUi(topWindow(), {});
  const html = U.renderToStaticMarkup(U.React.createElement(U.app.AnonApp, { env: {}, origin: APP }));
  for (const id of ["anon-app", "anon-explainer", "anon-crowd", "anon-who-sees", "anon-open-layers", "anon-boot", "anon-terms-link"]) assert(html.includes('data-testid="' + id + '"'), "missing " + id);
  for (const id of ["anon-signin", "anon-composer", "anon-feed"]) assert(!html.includes('data-testid="' + id + '"'), id + " drawn before the device answered");
  assert(html.includes('data-boot="booting"') && html.includes('data-miniapp="checking"'), "the boot and Mini App states");
  const C = (view) => U.renderToStaticMarkup(U.React.createElement(U.composer.AnonComposer, { view, loading: false, onReload: async () => {}, ownNames: ["stubalice"], origin: APP, inMiniApp: false, onPosted: () => {} }));
  const on = C({ available: true, destination: "layers", destinationSentence: "WHERE IT GOES", postedSentence: "POSTED" });
  assert(on.includes("WHERE IT GOES") && !on.includes('data-testid="anon-unavailable"') && on.includes('data-offered="yes"'), "on: " + on.slice(0, 300));
  const off = C({ available: false, destination: "off", destinationSentence: "THE REASON", unavailableReason: "THE REASON", unavailableCode: "crowd" });
  assert(off.split("THE REASON").length === 2 && off.includes('data-testid="anon-unavailable"') && !off.includes('data-testid="anon-destination"') && off.includes('data-offered="no"'), "off says the reason once: " + off.slice(0, 400));
  assert(/data-testid="anon-post"[^>]*disabled=""/.test(on) || /disabled=""[^>]*data-testid="anon-post"/.test(on), "Post enabled with no words");
});

await check("SP", "the share page: live first then test (labelled); hidden/unknown = notFound; a bad hash = notFound with no request; unreadable = an error view, never notFound; another cast refused; only mode+hash sent", async () => {
  const U = await freshUi(topWindow(), {});
  const H = "a".repeat(64);
  const realFetch = globalThis.fetch;
  const seen = [];
  const seenNet = [];
  const run = async (answers, hash = H) => {
    seen.length = 0;
    seenNet.length = 0;
    globalThis.fetch = async (u, init) => {
      const url = new URL(String(u));
      // THE HUB ROUTE: the protocol's copy (GET /zk/anon/network-cast); unset = a validator with no hub (501)
      if (url.pathname.endsWith("/zk/anon/network-cast")) {
        seenNet.push(url.toString());
        const n = answers.network ?? { status: 501, body: { error: "not set up", code: "network-reads-off" } };
        if (n === "throw") throw new Error("ECONNREFUSED");
        return new Response(JSON.stringify(n.body), { status: n.status ?? 200, headers: { "content-type": "application/json" } });
      }
      seen.push({ url: url.toString(), headers: Object.keys(init?.headers ?? {}) });
      const a = answers[url.searchParams.get("mode")];
      if (a === "throw") throw new Error("ECONNREFUSED");
      if (!a) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
      return new Response(a.text ?? JSON.stringify(a.body), { status: a.status ?? 200, headers: { "content-type": a.type ?? "application/json" } });
    };
    try {
      const el = await U.sharePage.default({ params: { castHash: hash } });
      return { html: U.renderToStaticMarkup(el) };
    } catch (e) {
      return { thrown: e && e.digest ? e.digest : String(e) };
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  const cast = (over = {}) => ({ body: { cast: { castHash: H, hash: "0x" + "b".repeat(40), text: "hello from anon", at: 1_790_000_000_000, castUrl: "https://farcaster.xyz/~/conversations/0x" + "b".repeat(40), ...over } } });
  const live = await run({ live: cast() });
  assert(live.html && live.html.includes('data-mode="live"') && live.html.includes("hello from anon") && live.html.includes('data-testid="anon-share-cast-link"') && !live.html.includes("Preview only"), "live: " + JSON.stringify(live).slice(0, 300));
  assert(seen.length === 1 && /\/zk\/anon-cast\?mode=live&hash=a{64}$/.test(seen[0].url) && seen[0].headers.join(",") === "accept", "the request: " + JSON.stringify(seen));
  const test = await run({ fixture: cast({ castUrl: "https://evil.example/x" }) });
  assert(test.html && test.html.includes('data-mode="fixture"') && test.html.includes("Preview only") && !test.html.includes("anon-share-cast-link") && seen.length === 2, "the test universe: " + JSON.stringify(test).slice(0, 300));
  assert((await run({})).thrown === "NEXT_NOT_FOUND", "a hidden or unknown cast is not a 404");
  const bad = await run({}, "NOT-A-HASH");
  assert(bad.thrown === "NEXT_NOT_FOUND" && seen.length === 0, "a malformed hash: " + JSON.stringify(bad) + " after " + seen.length + " requests");
  const down = await run({ live: "throw", fixture: "throw" });
  assert(down.html && down.html.includes('data-testid="anon-share-error"') && down.html.includes("couldn"), "unreadable: " + JSON.stringify(down).slice(0, 300));
  const old = await run({ live: { status: 404, type: "text/html", text: "Cannot GET" }, fixture: { status: 404, type: "text/html", text: "Cannot GET" } });
  assert(old.html && old.html.includes("single posts"), "a validator without the read: " + JSON.stringify(old).slice(0, 300));
  const other = await run({ live: cast({ castHash: "c".repeat(64) }) });
  assert(other.html && other.html.includes('data-testid="anon-share-error"'), "an answer for another cast was shown: " + JSON.stringify(other).slice(0, 200));
  // THE HUB ROUTE: a live row whose network hash the hub has is shown as the PROTOCOL's copy (marked); the hub saying it is
  // not there (deleted on the network) is notFound; an unreadable hub keeps the row, said as unchecked; a 0x network hash
  // is read from the hub alone; the live row with no hub (501, above) made exactly one network request and no mark
  const NH = "0x" + "b".repeat(40);
  const net = (over = {}) => ({ status: 200, body: { source: "hub", fid: 1, cast: { hash: NH, castHash: H, text: "hello from the protocol", at: 1_790_000_000_000, castUrl: null, ...over } } });
  const onNet = await run({ live: cast(), network: net() });
  assert(onNet.html && onNet.html.includes("hello from the protocol") && !onNet.html.includes("hello from anon") && onNet.html.includes('data-testid="anon-share-onnet"') && seenNet.length === 1 && seenNet[0].endsWith("/zk/anon/network-cast?hash=" + NH), "the protocol's copy: " + JSON.stringify(onNet).slice(0, 300) + " " + JSON.stringify(seenNet));
  const gone = await run({ live: cast(), network: { status: 404, body: { error: "no @anon post with that hash is on Farcaster (or it was removed)" } } });
  assert(gone.thrown === "NEXT_NOT_FOUND", "a cast the hub no longer has was shown: " + JSON.stringify(gone).slice(0, 200));
  const hubDown = await run({ live: cast(), network: "throw" });
  assert(hubDown.html && hubDown.html.includes("hello from anon") && hubDown.html.includes('data-testid="anon-share-unchecked"') && seenNet.length === 2, "an unreadable hub: " + JSON.stringify(hubDown).slice(0, 300));
  const noHub = await run({ live: cast() });
  assert(noHub.html && !noHub.html.includes("anon-share-onnet") && !noHub.html.includes("anon-share-unchecked") && seenNet.length === 1, "no hub on this validator: " + JSON.stringify(noHub).slice(0, 200));
  const byNet = await run({ network: net() }, NH);
  assert(byNet.html && byNet.html.includes("hello from the protocol") && seen.length === 0 && seenNet.length === 1, "a 0x network hash: " + JSON.stringify(byNet).slice(0, 300));
  const byNetGone = await run({ network: { status: 404, body: { error: "gone" } } }, NH);
  assert(byNetGone.thrown === "NEXT_NOT_FOUND", "an unknown network hash is not a 404");
  const meta = await U.sharePage.generateMetadata();
  assert(meta.other && JSON.parse(meta.other["fc:miniapp"]).button.action.type === "launch_miniapp", "the share page has no fc:miniapp embed");
});

await check("SPL", "ASM-2: on a LIVE site the share page reads ONLY the live universe (a test post is notFound after one live request; a live post renders); the preview still falls back", async () => {
  const U = await freshUi(topWindow(), {});
  const H = "e".repeat(64);
  const realFetch = globalThis.fetch;
  const savedEnv = { ...process.env };
  const savedWindow = globalThis.window;
  const seen = [];
  const cast = { cast: { castHash: H, hash: "0x" + "b".repeat(40), text: "a post", at: 1_790_000_000_000, castUrl: "https://farcaster.xyz/~/conversations/0x" + "b".repeat(40) } };
  /** the validator holds this hash in `holds` only ("live" / "fixture"); every other universe answers the JSON 404 */
  const run = async (holds) => {
    seen.length = 0;
    globalThis.fetch = async (u) => {
      const url = new URL(String(u));
      if (url.pathname.endsWith("/zk/anon/network-cast")) return new Response(JSON.stringify({ error: "not set up", code: "network-reads-off" }), { status: 501, headers: { "content-type": "application/json" } });
      seen.push(url.searchParams.get("mode"));
      if (url.searchParams.get("mode") === holds) return new Response(JSON.stringify(cast), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ error: "no anonymous post with that hash is showing" }), { status: 404, headers: { "content-type": "application/json" } });
    };
    try {
      const el = await U.sharePage.default({ params: { castHash: H } });
      return { html: U.renderToStaticMarkup(el) };
    } catch (e) {
      return { thrown: e && e.digest ? e.digest : String(e) };
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  const setEnv = (o) => {
    for (const k of ["PUBLIC_LIVE", "ZK_DEV_HOOKS", "ZK_ANON_UNIVERSE"]) delete process.env[k];
    Object.assign(process.env, { NODE_ENV: "production" }, o);
  };
  delete globalThis.window; // a server page: isPublicLive reads the SERVER's flag (no window)
  try {
    const out = [];
    for (const [what, env] of [
      ["PUBLIC_LIVE=true", { PUBLIC_LIVE: "true" }],
      ["ZK_ANON_UNIVERSE=live", { ZK_ANON_UNIVERSE: "live" }],
      ["ZK_ANON_UNIVERSE=<garbled> (fail closed)", { ZK_ANON_UNIVERSE: "Live!" }],
    ]) {
      setEnv(env);
      const fx = await run("fixture");
      assert(fx.thrown === "NEXT_NOT_FOUND", what + ": a test-universe post was not a 404 on a live site: " + JSON.stringify(fx).slice(0, 200));
      assert(JSON.stringify(seen) === JSON.stringify(["live"]), what + ": the share page asked the test universe on a live site: " + JSON.stringify(seen));
      const lv = await run("live");
      assert(lv.html && lv.html.includes('data-mode="live"') && lv.html.includes("a post"), what + ": a live post did not render: " + JSON.stringify(lv).slice(0, 200));
      out.push(what);
    }
    // the preview, the rig: unchanged — the test post still renders, labelled
    for (const [what, env] of [
      ["the preview (flag off)", {}],
      ["the rig (ZK_DEV_HOOKS=true, PUBLIC_LIVE set but ignored)", { ZK_DEV_HOOKS: "true", PUBLIC_LIVE: "true" }],
    ]) {
      setEnv(env);
      const fx = await run("fixture");
      assert(fx.html && fx.html.includes('data-mode="fixture"') && fx.html.includes("Preview only") && JSON.stringify(seen) === JSON.stringify(["live", "fixture"]), what + ": the test post: " + JSON.stringify(fx).slice(0, 200) + " after " + JSON.stringify(seen));
    }
    return "live only under " + out.join("; ");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
    globalThis.window = savedWindow;
  }
});

await check("U4", "F3/F4: joinRecorded is 'in the crowd' only on a recorded join (availableFrom, or available), never on unknown", async () => {
  const U = await freshUi(topWindow(), {});
  const j = U.app.joinRecorded;
  assert(j({ available: true }) && j({ available: false, availableFrom: Date.UTC(2026, 9, 18, 12) }), "a recorded join was not 'in the crowd'");
  assert(!j(null) && !j({}) && !j({ available: null }) && !j({ available: false, unavailableCode: "crowd" }) && !j({ available: false, availableFrom: null }) && !j({ availableFrom: Number.NaN }), "an unknown or refused join read as 'in the crowd'");
  assert(U.app.SIGNED_IN_NOT_JOINED && !/crowd/i.test(U.app.SIGNED_IN_NOT_JOINED) && /in the crowd/.test(U.app.SIGNED_IN_JOINED), "the signed-in words");
  // the keep is said before a live sign-in (F3) and the Mini App's move warning names the browser losing its place
  assert(/keeps it on this device/.test(U.app.LIVE_KEEP_NOTE) && /loses its place/.test(U.app.MINIAPP_MOVES_PLACE) && /closing it first loses the place/.test(U.app.JOIN_KEEP_NOTE), "the keep sentences");
  assert(/runs this page and knows your account/.test(U.app.MINIAPP_HOST_SEES) && /open this page in a browser/.test(U.app.MINIAPP_HOST_SEES), "the host sentence");
});

await check("C1", "PRIV-LIVE-4 / F9: no anon page file says 'not even Totem', 'Totem included', 'no one can match a post', 'can't tell which person' or 'launched accounts'; the explainer carries the address sentence", async () => {
  const files = ["app/anon/AnonApp.tsx", "app/anon/page.tsx", "app/anon/p/[castHash]/page.tsx", "components/anon/AnonExplainer.tsx", "components/anon/OpenLayersLink.tsx", "components/anon/AnonComposer.tsx", "components/anon/AnonFeed.tsx", "components/anon/ShareToFarcaster.tsx", "lib/miniapp/manifest.ts"];
  const banned = [/not even Totem/i, /Totem included/i, /no one can match a post/i, /can(?:'|&rsquo;|’)t tell which person/i, /launched accounts/i, /Nobody learns/i];
  // vacuity: every rule catches the sentence it was written for (the old shipped words, verbatim)
  const old = [
    "Nobody learns which posts are yours,\n        not even Totem: your post is checked",
    "Post on Farcaster with no name on it. Nobody learns which posts are yours, Totem included.",
    "It never goes on your posts, and no one can match a post to it.",
    "They can't tell which person in the crowd sent it.",
    "Want personas, rings and your own launched accounts?",
  ];
  for (const s of old) assert(banned.some((b) => b.test(s)), "no rule catches the old words: " + s);
  const hits = [];
  for (const f of files) {
    // comments may quote the old words to say why they are gone; the shipped strings may not
    const code = readFileSync(path.join(ROOT, f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/^\s*\{\/\*.*\*\/\}\s*$/.test(l)).join("\n");
    for (const b of banned) if (b.test(code)) hits.push(f + ": " + b);
  }
  assert(hits.length === 0, "an overclaim still ships: " + hits.join(" | "));
  const U = await freshUi(topWindow(), {});
  const E = U.explainer;
  assert(/same internet address|from your internet address/.test(E.ADDRESS_SENTENCE) && /different network/.test(E.ADDRESS_SENTENCE), "the address sentence: " + E.ADDRESS_SENTENCE);
  // the explainer as it draws (the bundle, so a mutation of the shipped words reaches it)
  const html = U.renderToStaticMarkup(U.React.createElement(E.AnonExplainer, { crowd: null, previewOnly: false }));
  assert(!banned.some((b) => b.test(html.replace(/&#x27;/g, "'"))) && html.includes(E.POST_CARRIES_NO_NAME.replace(/'/g, "&#x27;").slice(0, 40)), "the explainer as drawn: " + html.slice(0, 400));
  assert(/Totem records which Farcaster account joined/.test(E.SIGN_IN_JOINS_LIVE) && !/records/.test(E.SIGN_IN_JOINS_PREVIEW), "the sign-in residual (live names the record; the preview has none)");
  const explainerSrc = readFileSync(path.join(ROOT, "components", "anon", "AnonExplainer.tsx"), "utf8");
  assert(explainerSrc.includes("{ADDRESS_SENTENCE}"), "the explainer does not show the address sentence");
  assert(U.open.OPEN_LAYERS_LEAD === "Want personas and rings?", "the click-through lead: " + U.open.OPEN_LAYERS_LEAD);
  const man = M.buildManifest(envFor(APP)).manifest.miniapp;
  assert(!/Nobody learns|Totem included/i.test(man.description + " " + man.ogDescription), "the manifest still overclaims: " + man.description + " / " + man.ogDescription);
  return files.length + " files";
});

// ---------------------------------------------------------------------------------------------------- mutations
if (IS_CHILD) {
  for (const m of MUTATIONS) if (!mutationsApplied.has(m)) failed.push("MUTATION-NOT-APPLIED:" + m.file);
} else if (ONLY.length === 0) {
  const MUTS = [
    { id: "M2", why: "the name rule removed", file: "lib/miniapp/manifest.ts", find: 'if (typeof cfg.name !== "string" || cfg.name.length === 0) problems.push("name is missing");', replace: 'if (false) problems.push("name is missing");' },
    { id: "M3", why: "the domain must equal the host — removed", file: "lib/miniapp/manifest.ts", find: "if (expectHost && out.domain !== expectHost.toLowerCase())", replace: "if (false)" },
    { id: "M4", why: "the unsigned flag removed", file: "lib/miniapp/manifest.ts", find: 'if (!anySet) flags.push("unsigned: "', replace: 'if (false) flags.push("unsigned: "' },
    { id: "M5", why: "the no-alpha rule removed", file: "lib/miniapp/manifest.ts", find: "if (r.noAlpha && f.alpha)", replace: "if (false)" },
    { id: "M5", why: "the 3:2 rule removed", file: "lib/miniapp/manifest.ts", find: "if (f.width * r.ratio[1] !== f.height * r.ratio[0])", replace: "if (false)" },
    { id: "M6", why: "https no longer required", file: "lib/miniapp/manifest.ts", find: 'if (!v.startsWith("https://")) return "must be an https address";', replace: "" },
    { id: "M8", why: "homeUrl's host no longer compared", file: "lib/miniapp/manifest.ts", find: "if (h !== expectHost.toLowerCase())", replace: "if (false)" },
    { id: "M12", why: "a non-loopback http override allowed", file: "lib/miniapp/manifest.ts", find: 'if (u.protocol === "http:" && !/^(localhost|127\\.\\d+\\.\\d+\\.\\d+|\\[::1\\])$/i.test(u.hostname)) return null;', replace: "" },
    { id: "M13", why: "frame-ancestors widened to any origin", file: "lib/miniapp/manifest.ts", find: '"frame-ancestors " + FRAME_ANCESTORS.join(" "),', replace: '"frame-ancestors *",' },
    { id: "F2", why: "isAnonPagePath widened to any /anon prefix", file: "lib/miniapp/manifest.ts", find: 'return path === MINIAPP_HOME_PATH || /^\\/anon\\/p\\/[^/]+$/.test(path);', replace: 'return path.startsWith("/anon");' },
    { id: "F2", why: "every page framed like /anon", file: "middleware.ts", find: "if (isAnonPagePath(path)) return anonFramed(", replace: "if (true) return anonFramed(" },
    { id: "R1", why: "the manifest's CORS header removed", file: "app/.well-known/farcaster.json/route.ts", find: '"access-control-allow-origin": "*",', replace: "" },
    { id: "S1", why: "the not-framed short-circuit removed (the SDK evaluated everywhere)", file: "lib/miniapp/sdk.ts", find: "if (!mightBeMiniApp()) return { inside: false, sdk: false };", replace: "" },
    { id: "S3", why: "calls made without the host's confirmation", file: "lib/miniapp/sdk.ts", find: "return s.inside ? loadSdk() : null;", replace: "return loadSdk();" },
    { id: "S4", why: "a host failure read as a success", file: "lib/miniapp/sdk.ts", find: 'if (String((e as { name?: string })?.name ?? "").includes("RejectedByUser")) return { rejected: true };\n    return null;', replace: 'return { message: "", signature: "" };' },
    { id: "U1", why: "a list that could not be read shown as empty", file: "components/anon/AnonFeed.tsx", find: "if (o.casts === null) return { error:", replace: "if (o.casts === null) return { universe: \"live\", casts: [] } as never; if (false) return { error:" },
    { id: "U1", why: "the feed accepts any link", file: "components/anon/AnonFeed.tsx", find: "castUrl: isFarcasterWebUrl(x.castUrl) ? x.castUrl : null", replace: "castUrl: typeof x.castUrl === \"string\" ? x.castUrl : null" },
    { id: "U1", why: "Post offered on an unknown answer (fail open)", file: "components/anon/AnonComposer.tsx", find: 'return !!v && v.available === true && v.destination !== "off";', replace: 'return !!v && v.available !== false && v.destination !== "off";' },
    { id: "U3", why: "the destination shown when posting is off (the reason said twice)", file: "components/anon/AnonComposer.tsx", find: '{view?.destinationSentence && view.destination !== "off" ? (', replace: "{view?.destinationSentence ? (" },
    { id: "SP", why: "a failed read rendered as not found", file: "app/anon/p/[castHash]/page.tsx", find: 'return failure ? { kind: "error", reason: failure } : { kind: "missing" };', replace: 'return { kind: "missing" };' },
    { id: "SP", why: "the test universe not labelled", file: "app/anon/p/[castHash]/page.tsx", find: '{read.cast.mode === "fixture" ? <span', replace: "{false ? <span" },
    { id: "SP", why: "an answer for another cast accepted", file: "app/anon/p/[castHash]/page.tsx", find: 'if (c.castHash !== hash || typeof c.text !== "string") {', replace: 'if (typeof c.text !== "string") {' },
    { id: "U2", why: "a plain link instead of the soft one", file: "components/anon/OpenLayersLink.tsx", find: '<Link href={OPEN_LAYERS_HREF} data-testid="anon-open-layers"', replace: '<a href={OPEN_LAYERS_HREF} data-testid="anon-open-layers"' },
    // PUBLIC GO-LIVE (anonpage fixes)
    { id: "M13", why: "F14: the media hosts dropped from /anon's img-src (the Totem session after Open Totem loses its pictures)", file: "lib/miniapp/manifest.ts", find: "\"img-src 'self' data: blob: \" + anonImageSources().join(\" \"),", replace: "\"img-src 'self' data: blob:\"," },
    { id: "M17", why: "F14: the media-host duplicate drifts from CastCard's list", file: "lib/miniapp/manifest.ts", find: '"picsum.photos", "api.dicebear.com"];', replace: '"picsum.photos"];' },
    { id: "H1", why: "F6: the old-address redirect dropped from the middleware", file: "middleware.ts", find: "if (canonical) {", replace: "if (false) {" },
    { id: "H1", why: "F6: the live gate removed (the preview would redirect too)", file: "lib/miniapp/manifest.ts", find: "if (!o.live) return null;", replace: "" },
    { id: "H1", why: "F6: loopback and the private network no longer exempt (a probe could loop)", file: "lib/miniapp/manifest.ts", find: 'if (bare === "localhost" || bare.endsWith(".localhost") || /^127\\.\\d+\\.\\d+\\.\\d+$/.test(bare) || bare === "::1" || bare.endsWith(".railway.internal")) return null;', replace: "" },
    { id: "H1", why: "F6: /api redirected too (liveness included)", file: "lib/miniapp/manifest.ts", find: 'if (!p.startsWith("/") || p === "/api" || p.startsWith("/api/")) return null;', replace: 'if (!p.startsWith("/")) return null;' },
    { id: "SPL", why: "ASM-2: the test-universe fallback restored on a live site", file: "app/anon/p/[castHash]/page.tsx", find: 'return isPublicLive(env) || anonUniverseSet ? ["live"] : ["live", "fixture"];', replace: 'return ["live", "fixture"];' },
    { id: "SPL", why: "ASM-2: a garbled ZK_ANON_UNIVERSE read as the preview (fail open)", file: "app/anon/p/[castHash]/page.tsx", find: 'const anonUniverseSet = String(env.ZK_ANON_UNIVERSE ?? "").trim() !== "";', replace: 'const anonUniverseSet = String(env.ZK_ANON_UNIVERSE ?? "").trim() === "live";' },
    { id: "U4", why: "F4: 'in the crowd' on any answer (fail open)", file: "app/anon/AnonApp.tsx", find: 'return !!view && (view.available === true || (typeof view.availableFrom === "number" && Number.isFinite(view.availableFrom)));', replace: "return !!view;" },
    { id: "C1", why: "PRIV-LIVE-4: the manifest's 'Totem included' overclaim restored", file: "lib/miniapp/manifest.ts", find: 'export const MINIAPP_DESCRIPTION = "Post on Farcaster through one shared account, with no name on your posts. Open Totem for personas and rings.";', replace: 'export const MINIAPP_DESCRIPTION = "Post on Farcaster through one shared account. Nobody learns which posts are yours, Totem included. Open Totem for personas and rings.";' },
    { id: "C1", why: "PRIV-LIVE-4: the explainer's 'not even Totem' restored", file: "components/anon/AnonExplainer.tsx", find: "Everything posted here goes out from it. {POST_CARRIES_NO_NAME}", replace: "Everything posted here goes out from it. Nobody learns which posts are yours, not even Totem." },
    { id: "C1", why: "F9: 'your own launched accounts' restored while Launch is parked", file: "components/anon/OpenLayersLink.tsx", find: 'export const OPEN_LAYERS_LEAD = "Want personas and rings?";', replace: 'export const OPEN_LAYERS_LEAD = "Want personas, rings and your own launched accounts?";' },
  ];
  console.log("\n  mutations (each must make its check FAIL):");
  for (const m of MUTS) {
    // the U2 mutation turns the <Link> into an <a>: its closing tag must follow
    const list = m.id === "U2" ? [{ file: m.file, find: m.find, replace: m.replace }, { file: m.file, find: "Open Totem\n          </Link>", replace: "Open Totem\n          </a>" }] : [{ file: m.file, find: m.find, replace: m.replace }];
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--only=" + m.id], { env: { ...process.env, MINIAPP_MUTATION: JSON.stringify(list) }, encoding: "utf8", timeout: 180_000 });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    const caught = r.status !== 0 && new RegExp("FAIL\\s+" + m.id + "\\b").test(out) && !out.includes("MUTATION ANCHOR NOT FOUND") && !out.includes("MUTATION-NOT-APPLIED");
    if (caught) {
      passed++;
      console.log(`  PASS  MUT ${m.id} catches: ${m.why}`);
    } else {
      failed.push("MUT:" + m.id);
      console.log(`  FAIL  MUT ${m.id} did NOT catch: ${m.why}\n${out.split("\n").filter((l) => /FAIL|ANCHOR|BUILD/.test(l)).slice(0, 4).join("\n")}`);
    }
  }
}

try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  /* best effort */
}
console.log(`\nunit-miniapp: ${passed} passed, ${failed.length} failed${failed.length ? " (" + failed.join(", ") + ")" : ""}`);
process.exit(failed.length ? 1 : 0);
