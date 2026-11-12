// ACTING AS YOURSELF — the live site's "You" in the account menu (lib/device/actingRoot.ts), IN ONE PROCESS, with nothing
// real. The REAL modules, bundled with esbuild and run AS the live site's browser device (window defined, PUBLIC_LIVE=on,
// the device's own shims for next/server, next/headers and the session): the acting-persona resolver
// (lib/activePersona.ts), the device session (lib/device/shims/session.ts), the request host (lib/device/host.ts), the
// switch routes (app/api/seed-persona, app/api/personas/active), boot's naming rule, the persona separation module
// (lib/fc/hubRead/separation.ts) over the REAL device jar, post as you (lib/fc/rootSigner/flow.ts) and the hub reads
// (lib/fc/hubRead/read.ts) with their DEFAULT device runtimes (no test seam: what they ask is what a tab asks). Only the
// stateful edges are stand-ins (the store, the keystore, the sealed sign-in and posting key, the persona-fid record, the
// hub timeline's mode loader, which here applies no mode); the
// node is scripts/lib/farcaster-protocol-stub.mjs on loopback, behind a loopback stand-in of the validator's relay.
//
//   AR1 the resolver: on the live device a jar with no persona answers the public self (or nothing), NEVER the first
//       persona (the old fallback), and the device session's active identity follows; off the live site, as before
//   AR2 the request host: while no persona acts, EVERY write route the device serves that is not on the root's list is
//       refused 409 NO_ACTING_PERSONA before its handler runs (all of them, read from lib/device/routes.generated.ts);
//       the root's writes and every read go through; with a persona acting, or off the live site, nothing is refused;
//       every name on the root's list is a real device route
//   AR3 the switch: {asRoot:true} empties the persona and marks the tab; refused with no public self and off the live
//       site; switching to a persona (seed-persona, personas/active) names it and clears the mark; personas/active never
//       names the public self
//   AR4 boot: names the first persona unless the tab chose itself; a fresh jar (a reload) names the first persona again
//   AR5 switching takes effect for what is already queued: root → persona stops a queued root write and the root's hub
//       reads (the real separation module over the real jar); persona → root lets both go again, with the right bytes
//   M   MUTATIONS: each guard removed in the BUNDLE ONLY, and the check that covers it must then FAIL
//
//   node scripts/unit-acting-root.mjs            (npm run test:acting-root-unit)
//   node scripts/unit-acting-root.mjs --only=AR2
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length).split(",").filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const MUTATIONS = process.env.ACTINGROOT_MUTATION ? JSON.parse(process.env.ACTINGROOT_MUTATION) : [];
const QUIET = process.env.ACTINGROOT_UNIT_QUIET === "1";

let passed = 0;
let failed = 0;
const failedIds = [];
const out = (l) => (QUIET ? undefined : console.log(l));
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
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------- the bundle
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-actingroot-unit-"));
const S = (n) => path.join(tmp, n);
const ROOT_FID = 990777;
const FIRST = "p_" + "a1".repeat(16); // a persona made BEFORE the public self: the old fallback would act as it
const SECOND = "p_" + "b2".repeat(16);
const SELF_ID = "p_" + "c3".repeat(16); // the public self
const PRIV = "5e".repeat(32);
const stubs = {
  "server-only.ts": "export {};\n",
  // SPEC A: the hub timeline's mode loader (lib/fc/hubRead/modeSource.ts) reads the mode store, a stateful edge like the
  // store below; this suite is about who acts, so the timeline applies no mode here (scripts/unit-hub-read.mjs H17/H18
  // cover the mode, including that nothing is read or shown while a persona acts)
  "modeSource.ts": "export async function hubModeSpec() { return null; }\n",
  // SPEC C: the extras' loader (lib/fc/hubRead/extrasSource.ts: the readwise state, the desks, the ring inbox), stood in
  // for the same way (scripts/unit-hub-read.mjs H19-H21 cover the extras)
  "extrasSource.ts": "export async function hubExtrasSpec() { return null; }\n",
  // the store: the live viewer's getter answers the FIRST real persona (lib/adapters/mock/store.ts emptyWorldViewer)
  "store.ts": `export const knobs = { firstPersona: ${JSON.stringify(FIRST)} };
export const SEED_VIEWER: any = { fid: 1, rootId: "r_unit", personas: [] as string[], followingPersonaIds: [], likedPostHashes: [], bookmarkedPostHashes: [] };
Object.defineProperty(SEED_VIEWER, "activePersonaId", { get: () => knobs.firstPersona });
export const personaById = new Map<string, any>();
export const personaByHandle = new Map<string, any>();
const st = { personaDefaultMode: new Map<string, string>() };
export function state() { return st; }
`,
  // the keystore: the personas this device holds (the public self optional), in creation order
  "keystore.ts": `export const knobs = { withSelf: true };
const base = () => [
  { id: ${JSON.stringify(FIRST)}, name: "First", handle: "first", nonce: "n1" },
  { id: ${JSON.stringify(SECOND)}, name: "Second", handle: "second", nonce: "n2" },
  ...(knobs.withSelf ? [{ id: ${JSON.stringify(SELF_ID)}, name: "Stub Alice", handle: "stubalice", nonce: "n3", publicSelf: true }] : []),
];
export function listPersonas(): any[] { return base(); }
export function getPersona(id: string): any { return base().find((p) => p.id === id) ?? null; }
export function ownPersonaIds(): string[] { return base().map((p) => p.id); }
export type KeystorePersona = any;
`,
  "registry.ts": "export const adapters = { mode: { setActive: async () => undefined } };\n",
  "retry.ts": "export async function retryAdapter<T>(fn: () => Promise<T>): Promise<T> { return fn(); }\n",
  "ephemeral.ts": "export function hasModeOverride(): boolean { return false; }\n",
  "personaFid.ts": `export async function allPersonaFids() { return []; }
export async function anonAccountFid() { return null; }
export function ownAccountFids() { return new Set<number>(); }
`,
  "links.ts": `export async function mainLink() { return { fid: ${ROOT_FID}, fname: "stubalice", displayName: "Stub Alice", pfpUrl: null, disconnectedAt: null }; }
export async function ensureAccountLinksNamespace() { return "present"; }
export function resetAccountLinksCache() {}
`,
  // the root's sealed posting key: a fixed test key, signing exactly as lib/fc/rootSigner/store.ts does
  "rootStore.ts": `import { makeMessage, publicKeyHex } from "@/lib/fc/hub/message";
const PRIV = ${JSON.stringify(PRIV)};
export function newRootKeyPair() { return { priv: PRIV, key: "0x" + publicKeyHex(PRIV) }; }
export async function rootSignerView() { return { signer: { fid: ${ROOT_FID}, key: "0x" + publicKeyHex(PRIV), appFid: 1, state: "active", token: null, deeplinkUrl: null, deadline: 0, createdAt: 0, activatedAt: 1 }, forgotten: null }; }
export async function updateRootSigner(fn: any) { return fn({ v: 1, signer: null, forgotten: null }); }
export async function signAsRoot(fid: number, body: any, timestampMs = Date.now()) { return makeMessage({ fid, timestampMs, body, privateKeyHex: PRIV }); }
export type RootSignerView = any;
`,
  "entry.ts": `export * as actingRoot from "@/lib/device/actingRoot";
export { deviceJar } from "@/lib/device/jar";
export * as host from "@/lib/device/host";
export * as activePersona from "@/lib/activePersona";
export * as session from "@/lib/session";
export * as seedPersona from "@/app/api/seed-persona/route";
export * as personasActive from "@/app/api/personas/active/route";
export * as handleStem from "@/lib/identity/handleStem";
export * as sep from "@/lib/fc/hubRead/separation";
export * as flow from "@/lib/fc/rootSigner/flow";
export * as read from "@/lib/fc/hubRead/read";
export * as msg from "@/lib/fc/hub/message";
export * as storeStub from "@/lib/adapters/mock/store";
export * as keystoreStub from "@/lib/identity/keystore";
export { NextRequest } from "next/server";
`,
};
for (const [n, src] of Object.entries(stubs)) writeFileSync(S(n), src);
// the stateful edges, by module (relative and "@/" imports alike)
const REDIRECT = [
  [/(^|\/)adapters\/mock\/store$/, S("store.ts")],
  [/(^|\/)identity\/keystore$/, S("keystore.ts")],
  [/(^|\/)adapters\/registry$/, S("registry.ts")],
  [/(^|\/)adapters\/retry$/, S("retry.ts")],
  [/(^|\/)session\/ephemeral$/, S("ephemeral.ts")],
  [/(^|\/)fc\/personaFid$/, S("personaFid.ts")],
  [/(^|\/)fc\/siwf\/links$/, S("links.ts")],
  [/(^|\/)fc\/rootSigner\/store$/, S("rootStore.ts")],
];
const redirectPlugin = {
  name: "redirect",
  setup(b) {
    b.onResolve({ filter: /store$|keystore$|registry$|retry$|ephemeral$|personaFid$|links$/ }, (args) => {
      // a relative import ("./store" in lib/fc/rootSigner/flow.ts) is judged by where it points
      const p = args.path.startsWith(".") ? path.resolve(args.resolveDir, args.path).split(path.sep).join("/") : args.path;
      for (const [re, to] of REDIRECT) if (re.test(p)) return { path: to };
      return undefined;
    });
  },
};
const applied = new Set();
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
        applied.add(m);
      }
      return { contents: src, loader: "ts", resolveDir: path.dirname(args.path) };
    });
  },
};
const shim = (n) => path.join(ROOT, "lib", "device", "shims", n + ".ts");
let M;
try {
  const outFile = S("bundle.mjs");
  await build({
    plugins: [redirectPlugin, mutatePlugin],
    absWorkingDir: ROOT,
    entryPoints: [S("entry.ts")],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT, "tsconfig.json"),
    logLevel: "error",
    nodePaths: [path.join(ROOT, "node_modules")],
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
    alias: { "server-only": S("server-only.ts"), "next/server": shim("next-server"), "next/headers": shim("next-headers"), "@/lib/session/ephemeral": S("ephemeral.ts"), "@/lib/session": shim("session"), "@/lib/fc/hubRead/modeSource": S("modeSource.ts"), "@/lib/fc/hubRead/extrasSource": S("extrasSource.ts") },
  });
  // AS THE LIVE SITE'S DEVICE: a window, and the device env the server hands a live tab
  globalThis.window = globalThis;
  process.env.PUBLIC_LIVE = "on";
  M = await import(pathToFileURL(outFile).href);
  if (MUTATIONS.length && applied.size !== MUTATIONS.length) throw new Error("MUTATION FILE NOT IN THE BUNDLE");
} catch (e) {
  console.log("cannot bundle the acting-as-yourself modules: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
const { actingRoot, deviceJar, host, activePersona, session, seedPersona, personasActive, handleStem, sep, flow, read, msg, storeStub, keystoreStub, NextRequest } = M;
const SEEDC = activePersona.SEED_PERSONA_COOKIE;
const live = (on) => {
  process.env.PUBLIC_LIVE = on ? "on" : "";
};
const post = (mod, body) => mod.POST(new NextRequest("http://device.local/api/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const jsonOf = async (r) => {
  try {
    return await r.clone().json();
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------------- the network
const { startProtocolStub, decodeProto } = await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "farcaster-protocol-stub.mjs")).href);
const hub = await startProtocolStub({ firstFid: 991500 });
hub.seedAccount(ROOT_FID, "0x" + ROOT_FID.toString(16).padStart(40, "0"), msg.publicKeyHex(PRIV));
// a loopback stand-in for the validator's relay; `hold` keeps a submit waiting (a write in flight)
const relayed = [];
let hold = null;
const relay = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bytes = Buffer.concat(chunks);
  relayed.push(bytes.toString("hex"));
  if (hold) await hold.p;
  const r = await fetch(hub.hubUrl + "/v1/submitMessage", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes });
  const j = await r.json().catch(() => null);
  res.writeHead(r.status === 200 ? 200 : 502, { "content-type": "application/json" });
  res.end(JSON.stringify(r.status === 200 ? { ok: true, hash: j.hash } : { error: "Farcaster's node refused it: " + (j && j.error_detail ? j.error_detail : "") }));
});
await new Promise((r) => relay.listen(0, "127.0.0.1", r));
process.env.VALIDATOR_URL = "http://127.0.0.1:" + relay.address().port;
process.env.FC_ROOT_HUB_URL = hub.hubUrl;
// the tab's unpatched fetch (what the device's modules use for other origins)
globalThis.__layersOrigFetch = (u, init) => fetch(u, init);
const errOf = async (p) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};
const reset = () => {
  deviceJar.clear();
  live(true);
  keystoreStub.knobs.withSelf = true;
  storeStub.knobs.firstPersona = FIRST;
};

out("\nACTING AS YOURSELF UNIT — the live device's \"You\": resolver, request host, switch, boot, and the separation in flight" + (MUTATIONS.length ? "  [MUTATED BUNDLE]" : ""));

await check("AR1", "the resolver: on the live device no persona named answers the public self (or nothing), never the first persona; the device session follows; off the live site, as before", async () => {
  reset();
  assert(SEEDC === actingRoot.SEED_PERSONA_COOKIE_NAME, "the two cookie names differ: " + SEEDC + " / " + actingRoot.SEED_PERSONA_COOKIE_NAME);
  // a persona was made BEFORE the public self, so the store's live viewer would answer it: the old fallback
  assert(storeStub.SEED_VIEWER.activePersonaId === FIRST, "the stand-in viewer does not answer the first persona");
  assert(activePersona.activeSeedPersonaId() === SELF_ID, "an empty jar acted as " + activePersona.activeSeedPersonaId());
  const s = await session.getSession();
  assert(s.active && s.active.id === SELF_ID, "the session's active identity: " + (s.active ? s.active.id : null));
  // no public self (never signed in): nothing, never the first persona
  keystoreStub.knobs.withSelf = false;
  assert(activePersona.activeSeedPersonaId() === "", "no public self, yet it acted as " + activePersona.activeSeedPersonaId());
  const s2 = await session.getSession();
  assert(s2.active === null, "no public self, yet the session acts as " + (s2.active ? s2.active.id : null));
  keystoreStub.knobs.withSelf = true;
  // a persona named: that persona
  deviceJar.set(SEEDC, SECOND);
  assert(activePersona.activeSeedPersonaId() === SECOND && (await session.getSession()).active.id === SECOND, "a named persona is not the acting one");
  // off the live site (the preview's device): the old fallback, unchanged
  deviceJar.clear();
  live(false);
  assert(activePersona.activeSeedPersonaId() === FIRST, "off the live site the fallback changed: " + activePersona.activeSeedPersonaId());
  live(true);
  return "empty jar → the public self (or nothing); named → that persona; preview → unchanged";
});

// THE SPLIT, written out HERE independently of lib/device/actingRoot.ts (so moving a route either way is caught): the
// root's own writes (all methods), the routes judged by their body, and the persona actions. Every write route the device
// serves must be in exactly one of them (a new route has to be classified).
const EXPECT_ROOT = [
  "/api/fc/root", "/api/fc/hub", "/api/fc/siwf", "/api/x/signin", "/api/seed-persona", "/api/personas/active", "/api/personas", "/api/personas/post-mode", "/api/onboarding", "/api/device", "/api/recovery", "/api/zk", "/api/persona/chrome", "/api/dev",
  "/api/reach", "/api/anon/report", "/api/anon/moderation",
  "/api/modes", "/api/modes/active", "/api/rules", "/api/rules/preview", "/api/lenses", "/api/zones", "/api/readwise", "/api/delivery", "/api/actions/delivery", "/api/feed-health", "/api/feed-health/permission", "/api/feed-health/saturation", "/api/feed-health/readwise", "/api/algo/preview", "/api/algo/import", "/api/algo/export", "/api/packs/export", "/api/search/unified",
  // ADS, PHASE 1: the page's ad plan and the root's own hidden ads (what I see)
  "/api/ads",
  "/api/x/import", "/api/x/coldstore", "/api/x/match", "/api/graph/import",
  "/api/rings",
];
const EXPECT_BY_BODY = {
  "/api/anon": [
    [{ postAs: "root", text: "a root post" }, true],
    [{ action: "leaveCrowd" }, true],
    [{ action: "ownFidCheck", fid: 7 }, true],
    [{ action: "reveal", castHash: "0x01", personaId: SELF_ID }, true],
    [{ text: "no postAs: the route would pick a default posting persona" }, false],
    [{ personaId: FIRST, text: "as a persona" }, false],
    [{ postAs: "root", personaId: FIRST, text: "both" }, false],
    [{ action: "reveal", castHash: "0x01", personaId: FIRST }, false],
    [null, false],
  ],
  "/api/curators": [
    [{ feedId: "f1", subscribe: true, action: "badge" }, true],
    [{ feedId: "f1", subscribe: false }, true],
    [{ action: "draft", body: "a claim" }, false],
    [{ action: "sign", draftId: "d1" }, false],
  ],
};
const EXPECT_PERSONA = [
  "/api/actions/cast", "/api/actions/react", "/api/actions/follow", "/api/actions/act-as", "/api/follow", "/api/block", "/api/block-seed", "/api/fc/write", "/api/fc/persona", "/api/crosspost", "/api/influence", "/api/refute", "/api/strike", "/api/annotations/vote",
  "/api/private/audience", "/api/private/posts", "/api/private/react", "/api/private/posts/[hash]", "/api/identity/grant", "/api/identity/fork", "/api/launch", "/api/disclosure", "/api/disclosure/facets", "/api/disclosure/unlock",
  "/api/market/campaign", "/api/market/infofi", "/api/market/intent", "/api/rooms", "/api/rooms/highlight", "/api/channels", "/api/channels/join", "/api/folders", "/api/folders/follow", "/api/algo/publish",
  "/api/x/outbox", "/api/x/altlink", "/api/x/identity", "/api/x/link", "/api/x/migrate", "/api/x/port", "/api/x/sync", "/api/x/inbox", "/api/x/spend", "/api/signer", "/api/graph", "/api/graph/consent", "/api/personas/bindings",
  // classified by the test, not on either list the review named: sending a post to someone acts toward them as a persona;
  // an attestation connection is bound to the acting identity on the validator
  "/api/feed-health/send", "/api/attestations",
];

await check("AR2", "the request host: while no persona acts the persona actions are refused 409 NO_ACTING_PERSONA before their handler runs, and the root's own writes (all three dials) go through, some judged by their body; reads always; a persona acting or off the live site, nothing is refused", async () => {
  reset();
  // every route the device serves, from the generated table, each with a handler that records being run
  const table = readFileSync(path.join(ROOT, "lib", "device", "routes.generated.ts"), "utf8");
  const patterns = [...table.matchAll(/pattern: "([^"]+)"/g)].map((m) => m[1]);
  assert(patterns.length > 50, "the route table was not read (" + patterns.length + ")");
  const methodsOf = (p) => {
    const f = path.join(ROOT, "app", ...p.split("/").filter(Boolean), "route.ts");
    let src = "";
    try {
      src = readFileSync(f, "utf8");
    } catch {
      return [];
    }
    return [...src.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  };
  let ran = [];
  const routes = patterns.map((p) => {
    const mod = {};
    for (const m of methodsOf(p)) mod[m] = async () => (ran.push(m + " " + p), new Response("{}", { status: 200 }));
    const re = new RegExp("^" + p.replace(/\[[^\]]+\]/g, "[^/]+") + "$");
    return { pattern: p, re, params: [], mod };
  });
  for (const name of actingRoot.ROOT_WRITE_ROUTES) assert(patterns.includes(name), "the root's list names a route the device does not serve: " + name);
  const call = (p, method, body = "{}") => host.handleDeviceRequest(routes, new URL("http://device.local" + p.replace(/\[[^\]]+\]/g, "x")), "http://device.local" + p, { method, body: method === "GET" ? undefined : body });
  // no persona acts (the jar empty). Every write route the device serves is classified, exactly once
  const writes = [];
  for (const r of routes) for (const m of Object.keys(r.mod)) if (m !== "GET") writes.push([r.pattern, m]);
  const unclassified = [...new Set(writes.map(([p]) => p))].filter((p) => [EXPECT_ROOT.includes(p), p in EXPECT_BY_BODY, EXPECT_PERSONA.includes(p)].filter(Boolean).length !== 1);
  assert(!unclassified.length, "write routes not classified exactly once (root / by body / persona): " + unclassified.join(", "));
  const isRefusal = (res, j) => res.status === 409 && j && j.code === handleStem.NO_ACTING_PERSONA && j.error === handleStem.NO_ACTING_PERSONA_SENTENCE;
  let refused = 0;
  let through = 0;
  for (const [p, m] of writes) {
    if (p in EXPECT_BY_BODY) continue;
    ran = [];
    const res = await call(p, m);
    const j = await jsonOf(res);
    if (EXPECT_ROOT.includes(p)) {
      assert(res.status === 200 && ran.length === 1, "a ROOT write was refused while no persona acts: " + m + " " + p + " " + res.status + " " + JSON.stringify(j));
      through++;
    } else {
      assert(isRefusal(res, j) && ran.length === 0, "a PERSONA write went through while no persona acts: " + m + " " + p + " → " + res.status + " ran=" + ran.length);
      refused++;
    }
  }
  // the routes judged by their body: the root's bodies go through, a persona's are refused
  let byBody = 0;
  for (const [p, cases] of Object.entries(EXPECT_BY_BODY)) {
    for (const [b, ok] of cases) {
      ran = [];
      const res = await call(p, "POST", b === null ? "not json" : JSON.stringify(b));
      const j = await jsonOf(res);
      if (ok) assert(res.status === 200 && ran.length === 1, p + " " + JSON.stringify(b) + " is the root's own, yet refused: " + res.status);
      else assert(isRefusal(res, j) && ran.length === 0, p + " " + JSON.stringify(b) + " is a persona action, yet it went through: " + res.status + " ran=" + ran.length);
      byBody++;
    }
  }
  assert(refused >= 45 && through >= 40 && byBody >= 13, "vacuous: " + refused + " refused, " + through + " through, " + byBody + " by body");
  // every read goes through
  let reads = 0;
  for (const r of routes) {
    if (!r.mod.GET) continue;
    ran = [];
    const res = await call(r.pattern, "GET");
    assert(res.status === 200 && ran.length === 1, "a read was refused: " + r.pattern);
    reads++;
  }
  // a persona acting: nothing refused
  deviceJar.set(SEEDC, SECOND);
  ran = [];
  const ok = await call("/api/actions/react", "POST");
  assert(ok.status === 200 && ran.length === 1, "a persona's write was refused while it acts");
  // off the live site: nothing refused
  deviceJar.clear();
  live(false);
  ran = [];
  const pv = await call("/api/actions/react", "POST");
  live(true);
  assert(pv.status === 200 && ran.length === 1, "the preview's device refused a write");
  return refused + " persona-action writes refused (0 handlers run), " + through + " root writes through, " + byBody + " body cases right, " + reads + " reads through";
});

await check("AR3", "the switch: {asRoot:true} empties the persona and marks the tab; refused with no public self or off the live site; a persona switch names it and clears the mark; personas/active never names the public self", async () => {
  reset();
  deviceJar.set(SEEDC, FIRST);
  const r = await post(seedPersona, { asRoot: true });
  const j = await jsonOf(r);
  assert(r.status === 200 && j.acting === "root" && j.personaId === SELF_ID, "the switch answered " + r.status + " " + JSON.stringify(j));
  assert(!deviceJar.get(SEEDC) && deviceJar.get(actingRoot.ROOT_ACTING_COOKIE) === "1", "the jar after the switch: " + JSON.stringify(deviceJar.entries()));
  assert(actingRoot.noPersonaActs() && (await sep.personaActing()) === false, "a persona still acts after the switch");
  assert(activePersona.activeSeedPersonaId() === SELF_ID, "the acting identity after the switch: " + activePersona.activeSeedPersonaId());
  // back to a persona: named, and the mark goes
  const b = await post(seedPersona, { personaId: SECOND });
  assert(b.status === 200 && deviceJar.get(SEEDC) === SECOND && !deviceJar.get(actingRoot.ROOT_ACTING_COOKIE), "the persona switch: " + b.status + " " + JSON.stringify(deviceJar.entries()));
  assert((await sep.personaActing()) === true, "the persona switch did not make a persona act");
  // the public self is never a persona to act as, on either route
  const ps = await post(seedPersona, { personaId: SELF_ID });
  assert(ps.status === 403 && (await jsonOf(ps)).code === handleStem.PUBLIC_SELF_READ_ONLY, "seed-persona named the public self: " + ps.status);
  const pa = await post(personasActive, { personaId: SELF_ID });
  assert(pa.status === 403 && deviceJar.get(SEEDC) === SECOND, "personas/active named the public self: " + pa.status + " " + deviceJar.get(SEEDC));
  // personas/active with a persona, after acting as yourself: named, and the mark goes
  await post(seedPersona, { asRoot: true });
  const pb = await post(personasActive, { personaId: FIRST });
  assert(pb.status === 200 && deviceJar.get(SEEDC) === FIRST && !deviceJar.get(actingRoot.ROOT_ACTING_COOKIE), "personas/active after acting as yourself: " + pb.status + " " + JSON.stringify(deviceJar.entries()));
  // refusals: no public self (never signed in), and off the live site
  keystoreStub.knobs.withSelf = false;
  const ns = await post(seedPersona, { asRoot: true });
  assert(ns.status === 409 && (await jsonOf(ns)).code === "not_signed_in" && deviceJar.get(SEEDC) === FIRST, "the switch without a public self: " + ns.status);
  keystoreStub.knobs.withSelf = true;
  live(false);
  const off = await post(seedPersona, { asRoot: true });
  live(true);
  assert(off.status === 400 && deviceJar.get(SEEDC) === FIRST, "the switch off the live site: " + off.status);
  return "asRoot empties and marks; persona switches name and unmark; the public self refused on both routes";
});

await check("AR4", "boot: names the first persona unless the tab chose itself; a fresh jar (a reload) names the first persona again", async () => {
  reset();
  const personas = keystoreStub.listPersonas();
  actingRoot.nameDefaultActingPersona(personas);
  assert(deviceJar.get(SEEDC) === FIRST, "a fresh boot named " + deviceJar.get(SEEDC));
  actingRoot.actAsRoot();
  actingRoot.nameDefaultActingPersona(personas);
  assert(!deviceJar.get(SEEDC), "boot re-named a persona while the tab acts as itself: " + deviceJar.get(SEEDC));
  // a stale name is replaced, a good one kept
  deviceJar.clear();
  deviceJar.set(SEEDC, SELF_ID);
  actingRoot.nameDefaultActingPersona(personas);
  assert(deviceJar.get(SEEDC) === FIRST, "the public self stayed named as a persona");
  // the jar is tab memory: a reload starts over on the first persona (the safe direction)
  deviceJar.clear();
  actingRoot.nameDefaultActingPersona(personas);
  assert(deviceJar.get(SEEDC) === FIRST, "a reload did not name the first persona");
  return "kept empty while acting as yourself; the first persona after a reload";
});

await check("AR5", "switching takes effect for what is queued: root → persona stops a queued root write and the root's hub reads; persona → root lets both go again (the real separation module over the real jar)", async () => {
  reset();
  await post(seedPersona, { asRoot: true });
  hub.clearHubSteering();
  hub.resetHubReads();
  relayed.length = 0;
  const target = { fid: 990778, hash: "0x" + "a7".repeat(20) };
  // (a) a write in flight at the relay, and one queued behind it; then a switch to a persona
  let release;
  hold = { p: new Promise((r) => (release = r)) };
  const a = flow.reactAsRoot("like", target);
  for (let i = 0; i < 100 && relayed.length === 0; i++) await sleep(20);
  assert(relayed.length === 1, "the first like never reached the relay");
  const b = flow.reactAsRoot("recast", target);
  await sleep(50);
  await post(seedPersona, { personaId: FIRST });
  release();
  hold = null;
  const ea = await errOf(a);
  const eb = await errOf(b);
  assert(ea === null, "the like already sent did not complete: " + (ea && ea.message));
  assert(eb && eb.code === "acting_persona", "the queued recast went out after the switch to a persona: " + (eb ? eb.code : "sent"));
  assert(relayed.length === 1, relayed.length + " message(s) reached the relay (only the one already in flight may)");
  // (b) while the persona acts, the root's Following is not read at all
  const n0 = hub.hubRead.reads.length;
  const er = await errOf(read.hubTimeline({ waitMs: 200 }));
  assert(er && er.code === "acting_persona" && hub.hubRead.reads.length === n0, "a hub read while the persona acts: " + (er ? er.code : "answered") + ", " + (hub.hubRead.reads.length - n0) + " read(s)");
  // (c) persona → root: both go again, with the right bytes
  await post(seedPersona, { asRoot: true });
  await flow.reactAsRoot("recast", target);
  assert(relayed.length === 2, "the recast after switching back did not go: " + relayed.length);
  const m = decodeProto(Buffer.from(relayed[1], "hex"));
  const d = decodeProto(m[7][0]);
  const rb = decodeProto(d[7][0]);
  const tc = decodeProto(rb[2][0]);
  assert(Number(d[1][0]) === 3 && Number(d[2][0]) === ROOT_FID && Number(rb[1][0]) === 2 && Number(tc[1][0]) === target.fid && "0x" + Buffer.from(tc[2][0]).toString("hex") === target.hash, "the recast's bytes");
  assert([...(hub.state.reactions ?? new Map()).values()].some((r) => r.fid === ROOT_FID && r.kind === 2 && r.target.hash === target.hash), "the node does not hold the recast");
  hub.plantSynthetic({ root: ROOT_FID, n: 60, castsPer: 2, base: 3_950_000, prolific: false, future: false });
  read.resetHubReads();
  const v = await read.hubTimeline({ waitMs: 1500 });
  assert(v.state !== "error" && hub.hubRead.reads.length > n0, "the root's Following was not read after switching back: " + v.state);
  // (d) reads queued as the root stop at a switch to a persona
  read.resetHubReads();
  hub.hubRead.delayMs = 150;
  await read.hubTimeline({ waitMs: 300 });
  await post(seedPersona, { personaId: FIRST });
  await sleep(60);
  const atSwitch = hub.hubRead.reads.length;
  await sleep(1500);
  hub.hubRead.delayMs = 0;
  assert(hub.hubRead.reads.length === atSwitch, hub.hubRead.reads.length - atSwitch + " queued read(s) left after the switch to a persona");
  return "1 write in flight completed, the queued one refused; 0 reads as a persona; both again as yourself";
});

if (!MUTATIONS.length && ONLY.length === 0) {
  const AR = "lib/device/actingRoot.ts";
  const runs = [
    ["an empty jar on the live device falls back to the first persona", "AR1", [{ file: "lib/activePersona.ts", find: '  if (liveDeviceHere()) return publicSelfId() ?? "";', replace: "" }]],
    ["the device session falls back to the first persona", "AR1", [{ file: "lib/device/shims/session.ts", find: "?? (liveDevice() ? null : personas[0] ?? null)", replace: "?? personas[0] ?? null" }]],
    ["the request host runs a persona write while no persona acts", "AR2", [{ file: "lib/device/host.ts", find: "  if (noPersona) return json(noPersona.body, noPersona.status);", replace: "" }]],
    ["no persona acting is never detected", "AR2", [{ file: AR, find: "  return liveDevice() && !deviceJar.get(SEED_PERSONA_COOKIE_NAME);", replace: "  return false;" }]],
    // THE SPLIT, both directions
    ["a root write (modes) moved back to refused", "AR2", [{ file: AR, find: '  "/api/modes": true,\n', replace: "" }]],
    ["a root write (rings) moved back to refused", "AR2", [{ file: AR, find: '  "/api/rings": true,\n', replace: "" }]],
    ["a persona action (actions/cast) moved into the root's writes", "AR2", [{ file: AR, find: '  "/api/rings": true,\n', replace: '  "/api/rings": true,\n  "/api/actions/cast": true,\n' }]],
    ["a persona action (feed-health/send) moved into the root's writes", "AR2", [{ file: AR, find: '  "/api/feed-health/readwise": true,\n', replace: '  "/api/feed-health/readwise": true,\n  "/api/feed-health/send": true,\n' }]],
    ["an anonymous post naming a persona goes through", "AR2", [{ file: AR, find: '  return b.postAs === "root" && b.personaId === undefined;', replace: "  return true;" }]],
    ["the root's own anonymous post refused", "AR2", [{ file: AR, find: '  return b.postAs === "root" && b.personaId === undefined;', replace: "  return false;" }]],
    ["a reveal naming a persona goes through", "AR2", [{ file: AR, find: '  if (b.action === "reveal") return !!ctx.publicSelfId && b.personaId === ctx.publicSelfId;', replace: '  if (b.action === "reveal") return true;' }]],
    ["drafting a curator annotation goes through", "AR2", [{ file: AR, find: '!!b && b.action !== "draft" && b.action !== "sign";', replace: "true;" }]],
    ["the switch to yourself leaves the persona named", "AR3", [{ file: AR, find: "export function actAsRoot(): void {\n  deviceJar.delete(SEED_PERSONA_COOKIE_NAME);", replace: "export function actAsRoot(): void {" }]],
    ["a persona switch keeps the tab marked as itself", "AR3", [{ file: AR, find: "  deviceJar.set(SEED_PERSONA_COOKIE_NAME, personaId);\n  deviceJar.delete(ROOT_ACTING_COOKIE);", replace: "  deviceJar.set(SEED_PERSONA_COOKIE_NAME, personaId);" }]],
    ["personas/active names the public self", "AR3", [{ file: "app/api/personas/active/route.ts", find: "      if (refusal) return NextResponse.json(refusal, { status: 403 });", replace: "" }]],
    ["the switch to yourself without a Farcaster sign-in", "AR3", [{ file: "app/api/seed-persona/route.ts", find: '    if (!self) return NextResponse.json({ error: "Sign in with Farcaster first: acting as yourself means acting as your Farcaster account.", code: "not_signed_in" }, { status: 409 });', replace: '    if (!self) { actAsRoot(); return NextResponse.json({ ok: true, acting: "root", personaId: "" }); }' }]],
    ["boot re-names a persona while the tab acts as itself", "AR4", [{ file: AR, find: "  if (rootChosen()) return;\n", replace: "" }]],
    ["the separation ignores the jar (a persona never counts as acting)", "AR5", [{ file: "lib/fc/hubRead/separation.ts", find: "  return !!deviceJar.get(SEED_PERSONA_COOKIE);", replace: "  return false;" }]],
  ];
  await check("M", "MUTATIONS: each guard removed in the bundle only — the check that covers it FAILS (" + runs.length + " mutations)", async () => {
    const survived = [];
    for (const [label, target, muts] of runs) {
      const r = spawnSync(process.execPath, [SELF, "--only=" + target], {
        cwd: ROOT,
        env: { ...process.env, ACTINGROOT_MUTATION: JSON.stringify(muts), ACTINGROOT_UNIT_QUIET: "1", PUBLIC_LIVE: "" },
        encoding: "utf8",
        timeout: 240_000,
      });
      const tail = (r.stdout || "").trim().split("\n").pop() || "";
      if (r.status === 2) survived.push(label + " (could not be applied: " + (r.stdout || r.stderr || "").trim().slice(0, 160) + ")");
      else if (r.status === 0) survived.push(label + " (" + target + " still passed)");
      else if (!new RegExp("FAILED: .*\\b" + target + "\\b").test(tail)) survived.push(label + " (the run failed, but not " + target + ": " + tail + ")");
    }
    assert(!survived.length, survived.length + " mutation(s) survived: " + survived.join(" | "));
    return runs.length + " mutations, each caught";
  });
}

relay.close();
await hub.close();
rmSync(tmp, { recursive: true, force: true });
const summary = `${passed}/${passed + failed} acting-as-yourself unit checks passed` + (failed ? ` — FAILED: ${failedIds.join(",")}` : "");
console.log((QUIET ? "" : "\n") + summary);
process.exit(failed ? 1 : 0);
