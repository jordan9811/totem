// SIGN IN WITH X (2026-11-06) — THE PKCE HALF, THE DEVICE FLOW, THE SEALED RECORD, THE ROUTE AND THE CARD, CALLED DIRECTLY;
// AND THE VALIDATOR'S RELAY UNDER MUTATION. docs/mechanism/sign-in-with-x.md; SECURITY-POSTURE.md §38.
//
// Bundles lib/x/signin/{pkce,config,flow}.ts, lib/fc/siwf/{flow,links}.ts, lib/identity/{mainName,keystore}.ts and
// app/api/x/signin/route.ts with esbuild (the unit-siwf.mjs recipe: `server-only` shimmed, next/server stubbed, the
// validator's vault store replaced by an in-memory stub of lib/adapters/mock/persist.ts). The keystore, the vault cipher,
// the sealed pins and the recovery roster are the REAL modules, on a temporary KEYSTORE_DIR.
//
// THE NETWORK IS LOOPBACK AND CLOSED: the device's fetch reaches ONE address, the REAL relay (validator/xsignin.js on an
// in-process express app), which reaches scripts/lib/x-api-stub.mjs (in-process, an ephemeral port). The harness plays the
// visitor on the stub's consent page. Any other URL from the device fails the run. The real X API is never called.
//
//   X1  PKCE and the authorize URL: a 43-character RFC 7636 verifier, its S256 challenge, a state; exactly the parameters
//       (response_type, client_id, redirect_uri = <origin>/welcome/x, scope "users.read tweet.read", S256; no offline.access);
//       start keeps the request in THIS TAB's storage only and makes NO request; readXUser keeps X's own image host only
//   X2  positive control: start → X → finish → the X link sealed with exactly the allowed keys; ONE public self persona
//       (publicSelf, xShown); the stored request gone; X issued one token and it was REVOKED; the minimal fields asked;
//       mainLink() still answers Farcaster only (null here); the device never saw a token
//   X3  replay: the same callback again is refused (xsi_no_request) and X is not asked again; a reused code inside a fresh
//       request is X's own refusal (xsi_code)
//   X4  the state: a wrong state, a missing state, a repeated state are refused (xsi_state) before any request; X's
//       access_denied with the right state is xsi_denied; with a wrong one, a mismatch
//   X5  expiry: a request older than ten minutes is xsi_expired; a code past X's 30 seconds is xsi_code; nothing sealed
//   X6  dormant and switches: no X_SIGNIN → xsi_dormant and no request; off; bad_config; the server's hints (unset X_CLIENT_ID
//       forwards NOTHING; the rig gets nothing; an authorize override only as loopback and never on a hosting platform)
//   X7  no code, verifier, state or token in any thrown or answered message, view or log line
//   X8  one X account per root (live or tombstoned; the same account re-arms after a disconnect); the stem rule refuses a
//       persona whose handle shares the X username's stem
//   X9  BOTH: a root that signed in with Farcaster first — the X account joins that public self; then Sign in with
//       Farcaster on an X-first root joins the X public self; one persona, both links, neither write drops the other
//   X10 the padded record: empty, one link, and the worst-case Farcaster + X pair all seal to 1,024 ciphertext bytes, the
//       pair by dropping optional fields in the fixed order
//   X11 a persona handle derived from the root's X username is refused (lib/identity/mainName.ts)
//   X12 the route: any server answers 404 device_only WITHOUT reading the body (GET and POST)
//   X13 the card and the doors: safeAuthorizeUrl keeps x.com's page and loopback only; the welcome screen's Continue with X
//       is a door when armed and Soon when not; step 1 is "Sign in" with the X card beside Farcaster when armed
//   M   MUTATIONS: each guard is removed in the BUNDLE (or a temporary COPY of the relay) ONLY — the repo is never touched —
//       and the check that covers it must then FAIL
//
//   node scripts/unit-x-signin.mjs                (npm run test:x-signin-unit)
//   node scripts/unit-x-signin.mjs --only=X3,X7
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
const express = require("express");

const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length).split(",").filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const MUTATIONS = process.env.XSI_MUTATION ? JSON.parse(process.env.XSI_MUTATION) : [];
const QUIET = process.env.XSI_UNIT_QUIET === "1";

let passed = 0;
let failed = 0;
const failedIds = [];
const out = (line) => {
  if (!QUIET) console.log(line);
};
async function check(id, name, fn) {
  if (!want(id)) return;
  try {
    const extra = await fn();
    passed++;
    out(`  PASS  ${id} ${name}${typeof extra === "string" ? " — " + extra : ""}`);
  } catch (e) {
    failed++;
    failedIds.push(id);
    out(`  FAIL  ${id} ${name} — ${e && e.message ? e.message : String(e)}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ---------------------------------------------------------------------------------------------------- the bundles
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-xsi-unit-"));
process.env.KEYSTORE_DIR = path.join(tmp, "keystore");
const S = (name) => path.join(tmp, name);
const stubs = {
  "server-only.ts": "export {};\n",
  "next-server.ts": `export class NextResponse {
  status: number; body: unknown; headers: Record<string, string>;
  constructor(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) { this.status = init.status ?? 200; this.body = body; this.headers = init.headers ?? {}; }
  static json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) { return new NextResponse(body, init); }
}
export class NextRequest {
  nextUrl: URL; method: string; private raw: string | undefined; reads = 0;
  constructor(url: string, init: { method?: string; body?: string } = {}) { this.nextUrl = new URL(url); this.method = init.method ?? "GET"; this.raw = init.body; }
  async json() { this.reads++; return JSON.parse(this.raw ?? ""); }
  async text() { this.reads++; return this.raw ?? ""; }
}
`,
  "persist.ts": `export const validatorStore = new Map<string, Record<string, unknown>>();
export const knobs = { flushed: [] as { ns: string; entries: Record<string, unknown> }[] };
export async function fetchState(ns: string): Promise<{ status: number; ok: boolean; json: () => Promise<any> }> {
  const entries = validatorStore.get(ns);
  if (!entries) return { status: 200, ok: true, json: async () => ({ entries: {} }) };
  return { status: 200, ok: true, json: async () => ({ entries: JSON.parse(JSON.stringify(entries)) }) };
}
export async function flushVault(ns: string, entries: Record<string, unknown>): Promise<void> {
  knobs.flushed.push({ ns, entries: JSON.parse(JSON.stringify(entries)) });
  validatorStore.set(ns, JSON.parse(JSON.stringify(entries)));
}
export async function flush(ns: string, entries: Record<string, unknown>): Promise<void> { return flushVault(ns, entries); }
export async function signedWriteHeaders(): Promise<Record<string, string>> { return {}; }
export function sealedNamespaces(): Set<string> { return new Set(); }
export function resetEnvelopeBootstrap(): void {}
`,
  "store.ts": `export const SEED_VIEWER = { personas: [] as string[], activePersonaId: "", rootId: "root_unit", fid: -1 };
export const personaById = new Map<string, { id: string; handle: string }>();
export const personaByHandle = new Map<string, { id: string; handle: string }>();
export function state() { return {}; }
export async function hydrate(): Promise<void> {}
`,
  "session.ts": `export async function getSession() { return { rootId: "root_unit", personas: [], active: null }; }
export const PERSONA_COOKIE = "layers_active_persona";
`,
  "rootRoster.ts": `export const rosterCalls: { rootId: string; id: string; rec: unknown }[] = [];
export async function recordPersona(rootId: string, id: string, rec?: unknown): Promise<void> { rosterCalls.push({ rootId, id, rec }); }
`,
  "personaKind.ts": `export type PersonaKind = "public" | "private" | "unknown";
export function kindOf(): PersonaKind { return "public"; }
`,
  "keys.ts": `export function isKeystoreRootedPersona(): boolean { return false; }
export function fcSignerPublicKeyFor(): string | null { return null; }
`,
  "zk-config.ts": `export function zkMode(): string { return "fixture"; }
export function anonSnapshot(): null { return null; }
`,
  "entry.ts": `export * as pkce from "@/lib/x/signin/pkce";
export * as config from "@/lib/x/signin/config";
export * as xflow from "@/lib/x/signin/flow";
export * as siwf from "@/lib/fc/siwf/flow";
export * as links from "@/lib/fc/siwf/links";
export * as mainName from "@/lib/identity/mainName";
export * as ks from "@/lib/identity/keystore";
export * as route from "@/app/api/x/signin/route";
export * as persistStub from "@/lib/adapters/mock/persist";
export * as storeStub from "@/lib/adapters/mock/store";
export * as pins from "@/lib/vault/sealedPins";
export * as pf from "@/lib/fc/personaFid";
export * as nextStub from "next/server";
`,
  // the card and the doors, rendered (React bundled in; next/link and the app context stubbed)
  "next-link.tsx": `import * as React from "react";\nexport default function Link(props: any) { const { href, children, prefetch, ...rest } = props; return React.createElement("a", { href, ...rest }, children); }\n`,
  "next-navigation.ts": `export function useRouter() { return { replace() {}, push() {}, refresh() {} }; }\n`,
  "providers.ts": `export function useApp() { return { publicLive: true, toast() {}, refresh() {} }; }\n`,
  "ui-entry.tsx": `export { safeAuthorizeUrl, X_SIGNIN_DISCLOSURE } from "@/components/x/XSignIn";
export { WelcomeStep } from "@/components/onboarding/steps/WelcomeStep";
export { FarcasterStep } from "@/components/onboarding/steps/FarcasterStep";
export * as React from "react";
export { renderToStaticMarkup } from "react-dom/server";
`,
};
for (const [name, src] of Object.entries(stubs)) writeFileSync(S(name), src);

const mutationsApplied = new Set();
const mutatePlugin = {
  name: "mutate",
  setup(b) {
    const mine0 = MUTATIONS.filter((m) => !m.file.startsWith("validator/"));
    if (!mine0.length) return;
    b.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
      const rel = args.path.split(path.sep).join("/");
      const mine = mine0.filter((m) => rel.endsWith(m.file));
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
const COMMON = {
  plugins: [mutatePlugin],
  absWorkingDir: ROOT,
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node20"],
  tsconfig: path.join(ROOT, "tsconfig.json"),
  logLevel: "error",
  nodePaths: [path.join(ROOT, "node_modules")],
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
};
let M;
let UI;
try {
  await build({
    ...COMMON,
    entryPoints: [S("entry.ts")],
    outfile: S("bundle.mjs"),
    alias: {
      "server-only": S("server-only.ts"),
      "next/server": S("next-server.ts"),
      "@/lib/adapters/mock/persist": S("persist.ts"),
      "@/lib/adapters/mock/store": S("store.ts"),
      "@/lib/session": S("session.ts"),
      "@/lib/identity/rootRoster": S("rootRoster.ts"),
      "@/lib/identity/personaKind": S("personaKind.ts"),
      "@/lib/identity/keys": S("keys.ts"),
      "@/lib/zk/config": S("zk-config.ts"),
    },
  });
  M = await import(pathToFileURL(S("bundle.mjs")).href);
  await build({
    ...COMMON,
    entryPoints: [S("ui-entry.tsx")],
    outfile: S("ui-bundle.mjs"),
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "server-only": S("server-only.ts"), "next/link": S("next-link.tsx"), "next/navigation": S("next-navigation.ts"), "@/components/Providers": S("providers.ts") },
  });
  UI = await import(pathToFileURL(S("ui-bundle.mjs")).href);
  const bundleMuts = MUTATIONS.filter((m) => !m.file.startsWith("validator/"));
  if (bundleMuts.length && mutationsApplied.size !== bundleMuts.length) throw new Error("MUTATION FILE NOT IN THE BUNDLE");
} catch (e) {
  console.log("cannot bundle the Sign in with X modules: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
const { pkce, config, xflow, siwf, links, mainName, ks, route, persistStub, storeStub, pins, pf, nextStub } = M;

out("\nX SIGN-IN UNIT — Sign in with X, called in-process (the real relay against a loopback X stub; no request leaves)" + (MUTATIONS.length ? "  [MUTATED BUNDLE]" : ""));

// ---------------------------------------------------------------------------------------------------- the loopback network
const ORIGIN = "https://app.example.test";
const CALLBACK = ORIGIN + "/welcome/x";
const stubMod = await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "x-api-stub.mjs")).href);
const xstub = await stubMod.startXApiStub({ port: 0, redirects: [CALLBACK], log: () => {} });
process.env.X_CLIENT_ID = stubMod.STUB_CLIENT_ID;
process.env.X_SIGNIN_API_URL = xstub.url;
const relayMod = require(path.join(ROOT, "validator", "xsignin.js"));
const relayApp = express();
relayApp.use(express.json());
const relayLogs = [];
const relayMounted = relayMod.mountXSignin(relayApp, { log: { log: (...a) => relayLogs.push(a.join(" ")) }, limits: { exchangesPerAddressHour: 10_000, exchangesPerHour: 100_000 } });
const relayServer = await new Promise((resolve) => {
  const s = relayApp.listen(0, "127.0.0.1", () => resolve(s));
});
const RELAY = "http://127.0.0.1:" + relayServer.address().port;

/** every request the DEVICE made (it may reach the relay's exchange and nothing else) */
const deviceCalls = [];
const unexpected = [];
const deviceFetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  deviceCalls.push(url);
  if (url !== RELAY + "/x/signin/exchange") {
    unexpected.push(url);
    throw new Error("the device reached an address it must not: " + url);
  }
  return fetch(url, init);
};
const store = new Map();
const storage = { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => store.set(k, String(v)), remove: (k) => store.delete(k) };
let clockOffset = 0;
const logLines = [];
const ENV_ON = { X_SIGNIN: "on", X_CLIENT_ID: stubMod.STUB_CLIENT_ID, X_SIGNIN_AUTHORIZE_URL: xstub.url + "/i/oauth2/authorize", VALIDATOR_URL: RELAY };
function device(env = ENV_ON) {
  xflow.__setXsiRuntimeForTests({ env, fetch: deviceFetch, now: () => Date.now() + clockOffset, storage: () => storage, log: (l) => logLines.push(l) });
}
const stubState = () => fetch(xstub.url + "/__stub/state").then((r) => r.json());
const force = (o) => fetch(xstub.url + "/__stub/force", { method: "POST", body: JSON.stringify(o) });

/** everything answered or thrown, for X7's scan */
const seen = [];
async function attempt(fn) {
  try {
    const v = await fn();
    seen.push(JSON.stringify(v));
    return { ok: true, value: v };
  } catch (e) {
    seen.push(String(e && e.message));
    return { ok: false, code: e && e.code, message: String(e && e.message) };
  }
}
const secretsSeen = { codes: [], verifiers: [], states: [] };

/** the visitor on X: the consent page, then Authorize (or Cancel) → the callback's search, as X's redirect carries it */
async function visitX(authorizeUrl, { deny = false } = {}) {
  const page = await (await fetch(authorizeUrl)).text();
  const m = new RegExp('href="(/i/oauth2/authorize/' + (deny ? "deny" : "approve") + '\\?req=[^"]+)"').exec(page);
  assert(m, "the stub's consent page refused the request: " + page.replace(/<[^>]+>/g, " ").slice(0, 160));
  const r = await fetch(xstub.url + m[1], { redirect: "manual" });
  const loc = new URL(r.headers.get("location"));
  assert(loc.origin + loc.pathname === CALLBACK, "X sent the visitor somewhere else: " + loc.origin + loc.pathname);
  const code = loc.searchParams.get("code");
  if (code) secretsSeen.codes.push(code);
  return loc.search;
}
function rememberPending() {
  const p = pkce.readPending(storage.get(pkce.PENDING_KEY));
  if (p) {
    secretsSeen.verifiers.push(p.verifier);
    secretsSeen.states.push(p.state);
  }
  return p;
}
/** a fresh identity: a new keystore root (no personas), an empty vault, nothing stored in the tab */
async function freshRoot() {
  ks.resetKeystore();
  persistStub.validatorStore.clear();
  links.resetAccountLinksCache();
  pins.resetSealedPins();
  if (typeof pf.resetPersonaFidCache === "function") pf.resetPersonaFidCache();
  storeStub.personaByHandle.clear();
  storeStub.personaById.clear();
  store.clear();
  xflow.resetXsi();
  clockOffset = 0;
  await fetch(xstub.url + "/__stub/reset", { method: "POST" });
  device();
}
async function signIn({ as = "alice", deny = false } = {}) {
  await force({ as });
  const s = await xflow.startXsi({ origin: ORIGIN });
  rememberPending();
  const search = await visitX(s.authorizeUrl, { deny });
  return { start: s, search, finish: () => attempt(() => xflow.finishXsi({ origin: ORIGIN, search })) };
}
const xRecord = async () => {
  links.resetAccountLinksCache();
  return links.rootLinks();
};

// ---------------------------------------------------------------------------------------------------- the checks
await check("X1", "PKCE and the authorize URL: a 43-character verifier, its S256 challenge, a state; exactly the parameters; kept in this tab only, no request; readXUser keeps X's own image host", async () => {
  await freshRoot();
  for (let i = 0; i < 20; i++) {
    const r = await pkce.freshRequest();
    assert(pkce.verifierOk(r.verifier) && r.verifier.length === 43, "a verifier off RFC 7636: " + r.verifier.length);
    const want = createHash("sha256").update(r.verifier, "ascii").digest("base64url");
    assert(r.challenge === want, "the challenge is not S256(verifier)");
    assert(pkce.stateOk(r.state) && r.state.length >= 22, "a weak state");
  }
  const before = deviceCalls.length;
  const s = await xflow.startXsi({ origin: ORIGIN });
  assert(deviceCalls.length === before, "start made a request");
  const u = new URL(s.authorizeUrl);
  assert(u.origin + u.pathname === xstub.url + "/i/oauth2/authorize", "the authorize page: " + u.origin + u.pathname);
  const q = Object.fromEntries(u.searchParams);
  assert(JSON.stringify(Object.keys(q).sort()) === JSON.stringify(["client_id", "code_challenge", "code_challenge_method", "redirect_uri", "response_type", "scope", "state"]), "the parameters: " + Object.keys(q).sort());
  assert(q.response_type === "code" && q.client_id === stubMod.STUB_CLIENT_ID && q.redirect_uri === CALLBACK && q.code_challenge_method === "S256", "a parameter is wrong: " + JSON.stringify(q));
  assert(q.scope === "users.read tweet.read" && !/offline\.access/.test(s.authorizeUrl), "the scopes: " + q.scope);
  assert(/scope=users\.read%20tweet\.read/.test(s.authorizeUrl), "the scope is not %20-separated");
  const p = rememberPending();
  assert(p && p.state === q.state && createHash("sha256").update(p.verifier, "ascii").digest("base64url") === q.code_challenge && p.redirectUri === CALLBACK, "the stored request does not match the URL");
  assert(!s.authorizeUrl.includes(p.verifier), "the verifier left the tab in the URL");
  // readXUser: X's own image host only, the 400x400 size, and the id and username shapes
  const good = pkce.readXUser({ id: "123", username: "Ab_1", name: " N ", profile_image_url: "https://pbs.twimg.com/profile_images/1/a_normal.jpg", verified: true, verified_type: "blue" });
  assert(good && good.pfpUrl === "https://pbs.twimg.com/profile_images/1/a_400x400.jpg" && good.name === "N" && good.verified && good.verifiedType === "blue", JSON.stringify(good));
  assert(pkce.readXUser({ id: "123", username: "ab", profile_image_url: "https://evil.example/p.jpg" }).pfpUrl === null, "a foreign picture host was kept");
  assert(pkce.readXUser({ id: "123", username: "ab", profile_image_url: "http://pbs.twimg.com/p.jpg" }).pfpUrl === null, "an http picture was kept");
  for (const bad of [{ id: "12a", username: "ab" }, { id: "1", username: "has space" }, { id: "1", username: "sixteencharsxxxx" }, null]) assert(pkce.readXUser(bad) === null, "a malformed user passed: " + JSON.stringify(bad));
  return "20 pairs; " + Object.keys(q).length + " parameters, S256, two scopes; 0 requests at start";
});

await check("X2", "positive control: start → X → finish → the X link sealed with the allowed keys; one public self; the request gone; the token revoked; minimal fields; mainLink stays Farcaster-only; the device never saw a token", async () => {
  await freshRoot();
  const { finish } = await signIn({ as: "alice" });
  const r = await finish();
  assert(r.ok, "the sign-in was refused: " + r.code + " " + r.message);
  assert(r.value.link && r.value.link.username === stubMod.STUB_X_USERS.alice.username && r.value.link.disconnected === false, JSON.stringify(r.value.link));
  assert(r.value.moment === "signed-in", "no signed-in moment");
  assert(storage.get(pkce.PENDING_KEY) === null, "the request stayed in the tab's storage");
  const { farcaster, x } = await xRecord();
  assert(farcaster === null, "an X-only root has a Farcaster link");
  assert(x && x.xid === stubMod.STUB_X_USERS.alice.id && x.username === "StubXAlice" && x.name === "Stub X Alice" && x.verified === false && x.verifiedType === "none", JSON.stringify(x));
  assert(x.pfpUrl === "https://pbs.twimg.com/profile_images/1990777/stubxalice_400x400.jpg", "the picture: " + x.pfpUrl);
  assert((await links.mainLink()) === null, "mainLink() answered the X link");
  const sealed = persistStub.validatorStore.get("accountLinks");
  assert(sealed && Object.keys(sealed).length === 1, "accountLinks is not one record");
  const keys = Object.keys(x).sort().join(",");
  assert(keys === "disconnectedAt,kind,name,personaId,pfpUrl,username,verified,verifiedAt,verifiedType,xid", "the X link carries other keys: " + keys);
  const mine = ks.listPersonas().filter((p) => p.publicSelf === true);
  assert(mine.length === 1 && mine[0].id === x.personaId && mine[0].nonce === pkce.X_PERSONA_NONCE(x.xid) && mine[0].handle === "stubxalice" && mine[0].xShown === "StubXAlice", "the public self: " + JSON.stringify(mine));
  const st = await stubState();
  assert(st.tokens.issued === 1 && st.tokens.revoked === 1, "tokens: " + JSON.stringify(st.tokens));
  assert(st.lastFields === "profile_image_url,verified,verified_type", "users/me fields: " + st.lastFields);
  assert(st.violations.length === 0, "stub violations: " + JSON.stringify(st.violations));
  assert(!seen.some((s) => s.includes("xstub-tok-")), "a token reached the device");
  // the status view says it, with no code, verifier or state
  const v = await xflow.xsiStatus();
  assert(v.available && v.link && v.link.username === "StubXAlice" && v.pending === false, JSON.stringify(v));
  return "@" + x.username + " linked; 1 token issued, 1 revoked; 1 public self";
});

await check("X3", "replay: the same callback again is refused before any request (xsi_no_request); a reused code inside a fresh request is X's refusal (xsi_code); nothing sealed twice", async () => {
  await freshRoot();
  const first = await signIn();
  assert((await first.finish()).ok, "the first finish failed");
  const calls = (await stubState()).tokenCalls;
  const again = await first.finish();
  assert(!again.ok && again.code === "xsi_no_request", "a replayed callback: " + JSON.stringify(again));
  assert((await stubState()).tokenCalls === calls, "a replayed callback reached X");
  // a fresh request in another identity, answered with the OLD (spent) code under the new state
  await freshRoot();
  await xflow.startXsi({ origin: ORIGIN });
  const p = rememberPending();
  const oldCode = new URLSearchParams(first.search).get("code");
  const reused = await attempt(() => xflow.finishXsi({ origin: ORIGIN, search: "?state=" + p.state + "&code=" + encodeURIComponent(oldCode) }));
  assert(!reused.ok && reused.code === "xsi_code", "a reused code: " + JSON.stringify(reused));
  const { x } = await xRecord();
  assert(x === null, "a refused sign-in sealed an X link");
  assert(!ks.listPersonas().some((pp) => pp.publicSelf === true), "a refused sign-in minted a public self");
  return "replayed callback refused with 0 X calls; reused code refused by X";
});

await check("X4", "the state: wrong, missing or repeated → xsi_state before any request; access_denied with the right state → xsi_denied, with a wrong one → a mismatch", async () => {
  const cases = [];
  for (const [label, mangle, want] of [
    ["wrong state", (s, p) => s.replace("state=" + encodeURIComponent(p.state), "state=" + "A".repeat(32)), "xsi_state"],
    ["no state", (s) => s.replace(/state=[^&]+&?/, ""), "xsi_state"],
    ["a repeated state", (s, p) => s + "&state=" + p.state, "xsi_state"],
  ]) {
    await freshRoot();
    const { search } = await signIn();
    const p = pkce.readPending(storage.get(pkce.PENDING_KEY));
    const calls = (await stubState()).tokenCalls;
    const r = await attempt(() => xflow.finishXsi({ origin: ORIGIN, search: mangle(search, p) }));
    assert(!r.ok && r.code === want, label + ": " + JSON.stringify(r));
    assert((await stubState()).tokenCalls === calls, label + " reached X");
    assert((await xRecord()).x === null, label + " sealed a link");
    cases.push(label);
  }
  await freshRoot();
  const denied = await signIn({ deny: true });
  const d = await denied.finish();
  assert(!d.ok && d.code === "xsi_denied", "access_denied: " + JSON.stringify(d));
  await freshRoot();
  const denied2 = await signIn({ deny: true });
  const d2 = await attempt(() => xflow.finishXsi({ origin: ORIGIN, search: denied2.search.replace(/state=[^&]+/, "state=" + "B".repeat(32)) }));
  assert(!d2.ok && d2.code === "xsi_state", "a forged access_denied: " + JSON.stringify(d2));
  // another page's origin is not this request's callback
  await freshRoot();
  const other = await signIn();
  const o = await attempt(() => xflow.finishXsi({ origin: "https://other.example.test", search: other.search }));
  assert(!o.ok && o.code === "xsi_no_request", "another origin's callback: " + JSON.stringify(o));
  return cases.length + " state cases; denied; forged denial; another origin";
});

await check("X5", "expiry: a request older than ten minutes is xsi_expired; a code past X's 30 seconds is xsi_code; nothing sealed", async () => {
  await freshRoot();
  const late = await signIn();
  clockOffset = 10 * 60_000 + 1000;
  const r = await late.finish();
  assert(!r.ok && r.code === "xsi_expired", "a stale request: " + JSON.stringify(r));
  clockOffset = 0;
  await freshRoot();
  await force({ codeTtlMs: 0 });
  const slow = await signIn();
  await new Promise((res) => setTimeout(res, 5));
  const r2 = await slow.finish();
  assert(!r2.ok && r2.code === "xsi_code", "a code past its life: " + JSON.stringify(r2));
  assert((await stubState()).codes.expired === 1, "X did not see an expired code");
  assert((await xRecord()).x === null, "an expired sign-in sealed a link");
  return "10-minute request and 30-second code both refused";
});

await check("X6", "dormant and switches: no X_SIGNIN → xsi_dormant with no request; off; bad_config; the server's hints (unset forwards NOTHING; the rig nothing; an override only loopback, never hosted)", async () => {
  await freshRoot();
  const base = { VALIDATOR_URL: RELAY };
  const calls = deviceCalls.length;
  for (const [env, want] of [
    [base, "xsi_dormant"],
    [{ ...base, X_CLIENT_ID: stubMod.STUB_CLIENT_ID }, "xsi_dormant"],
    [{ ...ENV_ON, X_SIGNIN: "off" }, "xsi_off"],
    [{ ...ENV_ON, X_SIGNIN: "bad_config", X_SIGNIN_BAD: "X_CLIENT_ID" }, "bad_config"],
    [{ ...ENV_ON, X_CLIENT_ID: "bad id!" }, "bad_config"],
    [{ ...ENV_ON, X_SIGNIN_AUTHORIZE_URL: "https://evil.example/i/oauth2/authorize" }, "bad_config"],
    [{ ...ENV_ON, X_SIGNIN_AUTHORIZE_URL: xstub.url + "/i/oauth2/authorize?x=1" }, "bad_config"],
  ]) {
    device(env);
    const v = await xflow.xsiStatus();
    assert(!v.available && v.code === want, JSON.stringify(env) + " → " + JSON.stringify(v));
    const s = await attempt(() => xflow.startXsi({ origin: ORIGIN }));
    assert(!s.ok && s.code === want, "start under " + JSON.stringify(env) + " → " + JSON.stringify(s));
  }
  device();
  assert(deviceCalls.length === calls && storage.get(pkce.PENDING_KEY) === null, "a refused start made a request or stored a request");
  const H = (env) => config.xSigninDeviceHints(env);
  assert(JSON.stringify(H({})) === "{}", "no X_CLIENT_ID still forwards something: " + JSON.stringify(H({})));
  assert(JSON.stringify(H({ ZK_DEV_HOOKS: "true", X_CLIENT_ID: stubMod.STUB_CLIENT_ID })) === "{}", "the rig is handed a hint");
  assert(JSON.stringify(H({ X_CLIENT_ID: stubMod.STUB_CLIENT_ID })) === JSON.stringify({ X_SIGNIN: "on", X_CLIENT_ID: stubMod.STUB_CLIENT_ID }), "armed: " + JSON.stringify(H({ X_CLIENT_ID: stubMod.STUB_CLIENT_ID })));
  assert(H({ X_CLIENT_ID: stubMod.STUB_CLIENT_ID, X_SIGNIN: "off" }).X_SIGNIN === "off", "the kill switch");
  assert(H({ X_CLIENT_ID: "bad id!" }).X_SIGNIN === "bad_config" && !JSON.stringify(H({ X_CLIENT_ID: "bad id!" })).includes("bad id!"), "a malformed id is forwarded or echoed");
  const loop = "http://127.0.0.1:4338/i/oauth2/authorize";
  assert(H({ X_CLIENT_ID: stubMod.STUB_CLIENT_ID, X_SIGNIN_AUTHORIZE_URL: loop }).X_SIGNIN_AUTHORIZE_URL === loop, "a loopback override is not forwarded off a hosting platform");
  const hosted = H({ X_CLIENT_ID: stubMod.STUB_CLIENT_ID, X_SIGNIN_AUTHORIZE_URL: loop, RAILWAY_ENVIRONMENT: "production" });
  assert(hosted.X_SIGNIN === "bad_config" && hosted.X_SIGNIN_BAD === "X_SIGNIN_AUTHORIZE_URL" && !hosted.X_SIGNIN_AUTHORIZE_URL, "a hosted platform forwards an override: " + JSON.stringify(hosted));
  for (const bad of ["https://evil.example/i/oauth2/authorize", "http://127.0.0.1:4338/elsewhere", "http://u:p@127.0.0.1:4338/i/oauth2/authorize"]) assert(H({ X_CLIENT_ID: stubMod.STUB_CLIENT_ID, X_SIGNIN_AUTHORIZE_URL: bad }).X_SIGNIN === "bad_config", "an override passed: " + bad);
  assert(config.xSigninOfferedHere({ X_CLIENT_ID: stubMod.STUB_CLIENT_ID }) && !config.xSigninOfferedHere({}) && !config.xSigninOfferedHere({ X_CLIENT_ID: stubMod.STUB_CLIENT_ID, X_SIGNIN: "off" }), "the landing's promise");
  return "7 device gates, 0 requests; 9 server hint cases";
});

await check("X7", "no code, verifier, state or token in any thrown or answered message, view or log line", async () => {
  const hay = [...seen, ...logLines, ...relayLogs].join("\n");
  const needles = [...secretsSeen.codes, ...secretsSeen.verifiers, ...secretsSeen.states, "xstub-tok-"];
  assert(needles.length >= 3, "vacuous: no secrets were collected (" + needles.length + ")");
  const hit = needles.find((n) => n && hay.includes(n));
  assert(!hit, "a secret reached an answer or a log line: " + String(hit).slice(0, 10) + "…");
  return seen.length + " answers and " + (logLines.length + relayLogs.length) + " log lines scanned for " + needles.length + " needles: none";
});

await check("X8", "one X account per root (live or tombstoned; the same account re-arms after a disconnect); the stem rule refuses a persona sharing the X username's stem", async () => {
  await freshRoot();
  assert((await (await signIn({ as: "alice" })).finish()).ok, "alice's sign-in failed");
  const live = await attempt(() => xflow.startXsi({ origin: ORIGIN }));
  assert(!live.ok && live.code === "xsi_signed_in", "a second start while signed in: " + JSON.stringify(live));
  const dis = await attempt(() => xflow.disconnectXsi("DISCONNECT"));
  assert(dis.ok && dis.value.link && dis.value.link.disconnected === true, "disconnect: " + JSON.stringify(dis));
  const selfAfter = ks.listPersonas().find((p) => p.publicSelf === true);
  assert(selfAfter && !selfAfter.xShown, "the profile still shows a disconnected X account");
  const bob = await (await signIn({ as: "bob" })).finish();
  assert(!bob.ok && bob.code === "xsi_one_x", "another X account on a tombstoned root: " + JSON.stringify(bob));
  const back = await (await signIn({ as: "alice" })).finish();
  assert(back.ok && back.value.link.disconnected === false, "the same account did not re-arm: " + JSON.stringify(back));
  assert(ks.listPersonas().filter((p) => p.publicSelf === true).length === 1, "re-arming minted a second public self");
  // the stem rule: a persona named like the X account refuses the sign-in (matching names would publicly link them)
  await freshRoot();
  ks.createPersona({ name: "Night", handle: "stubxalice_alt", kind: "public" });
  const stem = await (await signIn({ as: "alice" })).finish();
  assert(!stem.ok && stem.code === "xsi_handle_stem" && /@stubxalice_alt/.test(stem.message), "the stem rule: " + JSON.stringify(stem));
  assert((await xRecord()).x === null, "a stem refusal sealed a link");
  return "second start, other account, re-arm, stem: all as the rule says";
});

await check("X9", "BOTH: Farcaster first then X joins its public self; X first then Sign in with Farcaster joins the X public self; one persona, both links, neither write drops the other", async () => {
  // (a) Farcaster first: a sealed Farcaster link and its public self (as Sign in with Farcaster leaves them)
  await freshRoot();
  const fcSelf = ks.createPersona({ name: "Fc Main", handle: "fcmain", kind: "public", publicSelf: true, nonce: "siwf-main/v1|990777" });
  await links.updateAccountLinks(() => ({ v: 1, links: [{ kind: "farcaster", fid: 990777, fname: "fcmain", displayName: "Fc Main", pfpUrl: null, bio: null, personaId: fcSelf.id, authMethod: "custody", signer: "0x" + "ab".repeat(20), nonceHash: "00".repeat(32), messageHash: "11".repeat(32), verifiedAt: Date.now(), verifier: { rpcHost: "stub" }, disconnectedAt: null }] }));
  const a = await (await signIn({ as: "alice" })).finish();
  assert(a.ok, "X after Farcaster: " + JSON.stringify(a));
  let both = await xRecord();
  assert(both.farcaster && both.farcaster.fid === 990777 && both.x && both.x.personaId === fcSelf.id, "the X link does not name the Farcaster public self: " + JSON.stringify(both.x));
  let selves = ks.listPersonas().filter((p) => p.publicSelf === true);
  assert(selves.length === 1 && selves[0].handle === "fcmain" && selves[0].name === "Fc Main" && selves[0].xShown === "StubXAlice", "the adopted persona changed or a second one was minted: " + JSON.stringify(selves));
  assert((await links.mainLink()).fid === 990777, "mainLink() is not the Farcaster link");
  // (b) X first, then Sign in with Farcaster (its fixture network, in this process) joins the X public self
  await freshRoot();
  assert((await (await signIn({ as: "alice" })).finish()).ok, "X first failed");
  const xSelf = ks.listPersonas().find((p) => p.publicSelf === true);
  siwf.__setSiwfRuntimeForTests({ env: { FC_SIWF: "fixture", LAYERS_DEVICE_DEBUG: "1", CUSTODY_FIXTURE_PROVIDER: "allow" } });
  try {
    siwf.resetSiwf();
    const started = await siwf.startSiwf({ origin: ORIGIN, host: "app.example.test" });
    await siwf.fixtureApproveSiwf({ sessionId: started.session.id });
    const polled = await siwf.pollSiwf(started.session.id);
    assert(polled.session && polled.session.stage === "verified", "the Farcaster sign-in did not verify: " + JSON.stringify(polled.session));
  } finally {
    siwf.__setSiwfRuntimeForTests(null);
  }
  both = await xRecord();
  assert(both.x && both.x.username === "StubXAlice" && both.x.disconnectedAt === null, "Sign in with Farcaster dropped the X link: " + JSON.stringify(both));
  assert(both.farcaster && both.farcaster.personaId === xSelf.id, "the Farcaster link does not name the X public self");
  selves = ks.listPersonas().filter((p) => p.publicSelf === true);
  assert(selves.length === 1 && selves[0].id === xSelf.id && selves[0].handle === xSelf.handle && selves[0].name === xSelf.name, "the X public self changed, or a second one was minted: " + JSON.stringify(selves));
  // and an X disconnect keeps the Farcaster link (and the reverse)
  assert((await attempt(() => xflow.disconnectXsi("DISCONNECT"))).ok, "the X disconnect failed");
  both = await xRecord();
  assert(both.farcaster && both.farcaster.disconnectedAt === null && both.x.disconnectedAt !== null, "an X disconnect touched the Farcaster link");
  return "FC→X and X→FC: one public self, two links each time";
});

await check("X10", "the padded record: empty, one link and the worst-case Farcaster + X pair all seal to 1,024 ciphertext bytes; the pair drops optional fields in the fixed order", async () => {
  await freshRoot();
  // the sealed record's ciphertext, in bytes (hex in the entry: the unit-siwf U9 measure)
  const ct = (entries) => {
    const keys = Object.keys(entries);
    assert(keys.length === 1 && keys[0] === "_" && typeof entries._.ct === "string", "not one opaque record: " + keys.join(","));
    return entries._.ct.length / 2;
  };
  const sizeOf = (doc) => ct(links.sealAccountLinksDoc(doc));
  const empty = sizeOf({ v: 1, links: [] });
  const fcWorst = { kind: "farcaster", fid: 9_007_199_254_740_991, fname: "f".repeat(64), displayName: "😀".repeat(64), pfpUrl: "https://" + "p".repeat(240) + ".x", bio: "😀".repeat(160), personaId: "p_" + "a".repeat(32), authMethod: "authAddress", signer: "0x" + "ab".repeat(20), nonceHash: "0".repeat(64), messageHash: "1".repeat(64), verifiedAt: 1_800_000_000_000, verifier: { rpcHost: "r".repeat(64) }, disconnectedAt: 1_800_000_000_000 };
  const xWorst = { kind: "x", xid: "9".repeat(20), username: "u".repeat(15), name: "😀".repeat(50), pfpUrl: "https://pbs.twimg.com/" + "q".repeat(170), verified: true, verifiedType: "government", personaId: "p_" + "b".repeat(32), verifiedAt: 1_800_000_000_000, disconnectedAt: 1_800_000_000_000 };
  const fitted = links.fitDoc({ v: 1, links: [xWorst, fcWorst] });
  assert(fitted.links[0].kind === "farcaster" && fitted.links[1].kind === "x", "the fixed order (Farcaster first) is not kept");
  const fcF = fitted.links[0];
  const xF = fitted.links[1];
  const dropped = [fcF.bio === null && "fc.bio", xF.name === null && "x.name", fcF.pfpUrl === null && "fc.pfpUrl", xF.pfpUrl === null && "x.pfpUrl", fcF.displayName === null && "fc.displayName"].filter(Boolean);
  // with today's caps the worst pair fits once four fields are gone, in this order (the fifth drop, the Farcaster display
  // name, is the net under a future field)
  assert(dropped.join(",") === "fc.bio,x.name,fc.pfpUrl,x.pfpUrl" && fcF.displayName !== null, "the fixed order of drops: " + dropped.join(","));
  assert(xF.xid === xWorst.xid && xF.username === xWorst.username && fcF.fid === fcWorst.fid, "an id or a username was dropped");
  const pair = sizeOf(fitted);
  const oneX = sizeOf(links.fitDoc({ v: 1, links: [xWorst] }));
  assert(empty === pair && empty === oneX, "the sealed sizes differ: empty " + empty + ", one X " + oneX + ", worst pair " + pair);
  // and the record a real sign-in sealed
  assert((await (await signIn()).finish()).ok, "the sign-in failed");
  const real = ct(persistStub.validatorStore.get("accountLinks"));
  assert(real === empty, "a real X sign-in's record is " + real + " bytes, the empty one " + empty);
  return "empty " + empty + " = one X " + oneX + " = worst pair " + pair + " = a real sign-in " + real + "; drops in order";
});

await check("X11", "a persona handle derived from the root's X username is refused (lib/identity/mainName.ts)", async () => {
  await freshRoot();
  assert((await (await signIn({ as: "alice" })).finish()).ok, "the sign-in failed");
  siwf.__setSiwfRuntimeForTests({ env: { FC_SIWF: "fixture", LAYERS_DEVICE_DEBUG: "1", CUSTODY_FIXTURE_PROVIDER: "allow" } });
  try {
    links.resetAccountLinksCache();
    const why = await mainName.mainNameDerivation("stubxalice2");
    assert(typeof why === "string" && /your X account \(@StubXAlice\)/.test(why), "a handle derived from the X username passed: " + why);
    assert((await mainName.mainNameDerivation("nightowl")) === null, "an unrelated handle was refused");
  } finally {
    siwf.__setSiwfRuntimeForTests(null);
  }
  return "derived refused, unrelated allowed";
});

await check("X12", "the route: any server answers 404 device_only WITHOUT reading the body (GET and POST)", async () => {
  const req = new nextStub.NextRequest(ORIGIN + "/api/x/signin", { method: "POST", body: JSON.stringify({ action: "start" }) });
  const r = await route.POST(req);
  assert(r.status === 404 && r.body.code === "device_only" && req.reads === 0, "POST: " + r.status + " " + JSON.stringify(r.body) + " reads=" + req.reads);
  const g = await route.GET();
  assert(g.status === 404 && g.body.code === "device_only", "GET: " + g.status);
  return "404 device_only, 0 body reads";
});

await check("X13", "the card and the doors: safeAuthorizeUrl keeps x.com's page and loopback only; Continue with X is a door when armed and Soon when not; step 1 is 'Sign in' with the X card when armed", async () => {
  const ok = ["https://x.com/i/oauth2/authorize?client_id=a", "http://127.0.0.1:4338/i/oauth2/authorize?x=1", "http://localhost:4338/i/oauth2/authorize"];
  const bad = ["https://x.com.evil.example/i/oauth2/authorize", "https://evil.example/i/oauth2/authorize", "https://x.com/login", "javascript:alert(1)", "https://u:p@x.com/i/oauth2/authorize", "http://x.com/i/oauth2/authorize", 42];
  for (const u of ok) assert(UI.safeAuthorizeUrl(u), "refused: " + u);
  for (const u of bad) assert(UI.safeAuthorizeUrl(u) === null, "kept: " + u);
  const h = UI.React.createElement;
  const html = (el) => UI.renderToStaticMarkup(el);
  const noop = () => {};
  const armed = html(h(UI.WelcomeStep, { startOpen: false, live: true, xArmed: true, onNew: noop, onUnlocked: noop }));
  assert(/<button[^>]*data-testid="onboard-x"[^>]*>/.test(armed) && !armed.includes('data-testid="onboard-x-soon"'), "armed: the welcome screen does not offer Continue with X");
  const dormant = html(h(UI.WelcomeStep, { startOpen: false, live: true, onNew: noop, onUnlocked: noop }));
  assert(/<button[^>]*data-testid="onboard-x-soon"[^>]*disabled=""/.test(dormant) && !dormant.includes('data-testid="onboard-x"'), "dormant: Continue with X is not the disabled Soon button");
  const step = html(h(UI.FarcasterStep, { signedIn: false, xArmed: true, phone: false, onChanged: noop, onNext: noop, onSkip: noop, onBack: noop }));
  assert(step.includes(">Sign in</h1>") && step.includes('data-testid="onboard-x-signin"'), "armed step 1: " + step.slice(0, 200));
  const step0 = html(h(UI.FarcasterStep, { signedIn: false, phone: false, onChanged: noop, onNext: noop, onSkip: noop, onBack: noop }));
  assert(step0.includes(">Sign in with Farcaster</h1>") && !step0.includes('data-testid="onboard-x-signin"'), "dormant step 1 changed");
  assert(/internet address/.test(UI.X_SIGNIN_DISCLOSURE) && /keeps nothing/.test(UI.X_SIGNIN_DISCLOSURE), "the disclosure lost a clause");
  return ok.length + " kept, " + bad.length + " refused; the doors by arming";
});

// ---------------------------------------------------------------------------------------------------- M: mutations
/** a temporary COPY of the relay (with caps.js and env-contract.js beside it) with one mutation, for the relay's tests */
function mutatedRelayCopy(muts) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "layers-xsi-relay-"));
  for (const f of ["caps.js", "env-contract.js"]) copyFileSync(path.join(ROOT, "validator", f), path.join(dir, f));
  let src = readFileSync(path.join(ROOT, "validator", "xsignin.js"), "utf8").replace(/\r\n/g, "\n");
  for (const m of muts) {
    if (!src.includes(m.find)) return { dir, error: "MUTATION ANCHOR NOT FOUND: " + m.find.slice(0, 80) };
    src = src.replace(m.find, m.replace);
  }
  writeFileSync(path.join(dir, "xsignin.js"), src);
  mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  return { dir, file: path.join(dir, "xsignin.js") };
}

if (!MUTATIONS.length && want("M")) {
  const SELF = fileURLToPath(import.meta.url);
  const runs = [
    ["the stored request is not removed before judging (a replay is honoured)", "X3", [{ file: "lib/x/signin/flow.ts", find: "      st.remove(PENDING_KEY); // ONE SHOT: whatever happens next, this request can never be answered twice\n", replace: "" }]],
    ["the state is not compared", "X4", [{ file: "lib/x/signin/pkce.ts", find: '  if (!params.state || !sameString(params.state, pending.state)) return { ok: false, code: "xsi_state" };\n', replace: "" }]],
    ["the challenge method is plain", "X1", [{ file: "lib/x/signin/pkce.ts", find: '    code_challenge_method: "S256",', replace: '    code_challenge_method: "plain",' }]],
    ["offline.access is asked for", "X1", [{ file: "lib/x/signin/pkce.ts", find: 'export const X_SIGNIN_SCOPES: readonly string[] = ["users.read", "tweet.read"];', replace: 'export const X_SIGNIN_SCOPES: readonly string[] = ["users.read", "tweet.read", "offline.access"];' }]],
    ["a foreign picture host is kept", "X1", [{ file: "lib/x/signin/pkce.ts", find: "X_IMAGE_HOSTS.includes(u.hostname.toLowerCase())", replace: "true" }]],
    ["a stale request is accepted", "X5", [{ file: "lib/x/signin/pkce.ts", find: '  if (!(now - pending.createdAt >= 0 && now - pending.createdAt <= PENDING_TTL_MS)) return { ok: false, code: "xsi_expired" };\n', replace: "" }]],
    ["the dormant gate opens without X_SIGNIN=on", "X6", [{ file: "lib/x/signin/flow.ts", find: '  if (mode !== "on") return { ok: false, code: "xsi_dormant" };', replace: "" }]],
    ["a hosting platform forwards an authorize override", "X6", [{ file: "lib/x/signin/config.ts", find: "  if (hosted) return { ok: false };\n", replace: "" }]],
    ["an unarmed server still forwards a hint", "X6", [{ file: "lib/x/signin/config.ts", find: "  if (!id) return {};", replace: '  if (!id) return { X_SIGNIN: "off" };' }]],
    ["one X account per root is not enforced", "X8", [
      { file: "lib/x/signin/flow.ts", find: '  if (both.x && both.x.xid !== user.id) throw new XsiError("xsi_one_x");', replace: "" },
      { file: "lib/x/signin/flow.ts", find: '      if (prev && prev.xid !== user.id) throw new XsiError("xsi_one_x");', replace: "" },
    ]],
    ["the stem rule is skipped at X sign-in", "X8", [{ file: "lib/x/signin/flow.ts", find: "  if (clash)\n    throw new XsiError(", replace: "  if (false)\n    throw new XsiError(" }]],
    ["Sign in with Farcaster drops the X link", "X9", [{ file: "lib/fc/siwf/flow.ts", find: '      return { v: 1, links: [next, ...all.links.filter((l) => l.kind !== "farcaster")] };', replace: "      return { v: 1, links: [next] };" }]],
    ["the X sign-in mints its own public self beside Farcaster's", "X9", [{ file: "lib/x/signin/flow.ts", find: "  const adopted = fcSelf && fcSelf.publicSelf === true ? fcSelf : null;", replace: "  const adopted = null as typeof fcSelf;" }]],
    ["mainLink() answers the first link of any kind", "X2", [{ file: "lib/fc/siwf/links.ts", find: "  const fc = doc.links.find(isFc) ?? null;\n  return fc ? cloneLink(fc) : null;", replace: "  const fc = (doc.links[0] ?? null) as AccountLink | null;\n  return fc ? cloneLink(fc) : null;" }]],
    ["the pair's fit skips a drop", "X10", [{ file: "lib/fc/siwf/links.ts", find: "    () => fc && (fc.pfpUrl = null),\n", replace: "" }]],
    ["the route reads the body before refusing", "X12", [{ file: "app/api/x/signin/route.ts", find: '  if (typeof window === "undefined") return deviceOnly();\n  let body', replace: '  await req.json().catch(() => null);\n  if (typeof window === "undefined") return deviceOnly();\n  let body' }]],
    ["a refusal echoes the code", "X3,X7", [{ file: "lib/x/signin/flow.ts", find: '    if (code === "x_refused") throw new XsiError("xsi_code");', replace: '    if (code === "x_refused") throw new XsiError("xsi_code", "X refused " + body.code);' }]],
    ["a handle derived from the X username is allowed", "X11", [{ file: "lib/identity/mainName.ts", find: "    if (x && derivedFromMain(handle, x.username))", replace: "    if (false)" }]],
    ["the card opens any https link", "X13", [{ file: "components/x/XSignIn.tsx", find: '    if (u.protocol === "https:" && u.hostname === "x.com" && u.pathname === "/i/oauth2/authorize") return u.toString();', replace: '    if (u.protocol === "https:") return u.toString();' }]],
    ["the armed welcome screen still says Soon", "X13", [{ file: "components/onboarding/steps/WelcomeStep.tsx", find: "{xArmed ? armedX : soonX}", replace: "{soonX}" }]],
  ];
  // the relay's guards, each under validator/test/xsignin.test.js (a mutated COPY: the repo is never touched)
  const relayRuns = [
    ["the token is never revoked", "the six profile fields, the token REVOKED", [{ find: 'c.api + "/2/oauth2/revoke"', replace: 'c.api + "/2/oauth2/revoke-skipped"' }]],
    ["any client id is forwarded", "only the armed client id", [{ find: "    if (clientId !== c.clientId) {", replace: "    if (false) {" }]],
    ["any redirect is forwarded", "only the armed client id", [{ find: "    if (!CODE_RE.test(code) || !VERIFIER_RE.test(verifier) || !redirectOk(redirectUri, hosted(process.env))) {", replace: "    if (!CODE_RE.test(code) || !VERIFIER_RE.test(verifier)) {" }]],
    ["users/me is asked for more fields", "the minimal fields asked", [{ find: 'const USER_FIELDS = "profile_image_url,verified,verified_type";', replace: 'const USER_FIELDS = "profile_image_url,verified,verified_type,public_metrics";' }]],
    ["the relay logs the code", "nothing logged", [{ find: "    counts.exchanges++;\n", replace: '    counts.exchanges++;\n    log.log("[x-signin] relayed " + code);\n' }]],
    ["the access token is answered", "the six profile fields, the token REVOKED", [{ find: "    return res.json({ user, revoked });", replace: "    return res.json({ user, revoked, access });" }]],
    ["the kill switch is ignored", "dormant", [{ find: '  if (OFF.has(String(env.X_SIGNIN ?? "").trim().toLowerCase())) problems.push("X_SIGNIN is off (the kill switch)");', replace: "" }]],
    ["a users/me failure leaves the token alive", "users/me failing still REVOKES", [{ find: "    let me = null;\n    try {\n      me = await call(", replace: "    let me = null;\n    try {\n      if (true) throw new Error('skip');\n      me = await call(" }, { find: '    // ALWAYS revoke: the token has done its one job (or failed it), and nothing here will ever use it again\n    let revoked = false;\n    try {', replace: "    let revoked = false;\n    if (!me) return res.status(502).json({ error: 'x', code: 'x_users_me', revoked });\n    try {" }]],
  ];
  await check("M", "MUTATIONS: each guard removed in the bundle (or a copy of the relay) only — the check that covers it FAILS (" + (runs.length + relayRuns.length) + " mutations)", async () => {
    const survived = [];
    for (const [label, target, muts] of runs) {
      const r = spawnSync(process.execPath, [SELF, "--only=" + target], {
        cwd: ROOT,
        env: { ...process.env, XSI_MUTATION: JSON.stringify(muts), XSI_UNIT_QUIET: "1", KEYSTORE_DIR: "" },
        encoding: "utf8",
        timeout: 240_000,
      });
      const tail = (r.stdout || "").trim().split("\n").pop() || "";
      const mustFail = target.split(",").pop();
      if (r.status === 2) survived.push(label + " (the mutation could not be applied: " + (r.stdout || r.stderr || "").trim().slice(0, 160) + ")");
      else if (r.status === 0) survived.push(label + " (" + mustFail + " still passed)");
      else if (!new RegExp("FAILED: .*\\b" + mustFail + "\\b").test(tail)) survived.push(label + " (the run failed, but not " + mustFail + ": " + tail + ")");
    }
    for (const [label, testName, muts] of relayRuns) {
      const copy = mutatedRelayCopy(muts);
      if (copy.error) {
        survived.push(label + " (" + copy.error + ")");
        rmSync(copy.dir, { recursive: true, force: true });
        continue;
      }
      const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", path.join(ROOT, "validator", "test", "xsignin.test.js")], {
        cwd: ROOT,
        env: { ...process.env, XSIGNIN_MODULE: copy.file, NODE_PATH: path.join(ROOT, "node_modules") },
        encoding: "utf8",
        timeout: 240_000,
      });
      rmSync(copy.dir, { recursive: true, force: true });
      const notOk = (r.stdout || "").split("\n").filter((l) => /^\s*not ok \d+ - /.test(l));
      if (r.status === 0) survived.push(label + " (every relay test still passed)");
      else if (!notOk.some((l) => l.includes(testName))) survived.push(label + " (the run failed, but not '" + testName + "': " + notOk.join(" | ").slice(0, 200) + ")");
    }
    assert(!survived.length, survived.length + " mutation(s) survived: " + survived.join(" | "));
    return runs.length + " bundle + " + relayRuns.length + " relay mutations, each caught by its check";
  });
}

// ---------------------------------------------------------------------------------------------------- the end
relayMounted.stop();
await new Promise((r) => relayServer.close(r));
await xstub.close();
if (unexpected.length) {
  failed++;
  failedIds.push("NET");
  out("  FAIL  NET the device reached " + unexpected.length + " address(es) it must not: " + unexpected.slice(0, 3).join(", "));
}
rmSync(tmp, { recursive: true, force: true });
const summary = `${passed}/${passed + failed} X sign-in unit checks passed` + (failed ? ` — FAILED: ${failedIds.join(",")}` : "");
console.log((QUIET ? "" : "\n") + summary);
process.exit(failed ? 1 : 0);
