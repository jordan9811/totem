// PERSONA LAUNCH P7 — the prover track's NODE-ONLY harness (npm run test:prover-unit once the verify agent adds it). No
// app server, no browser, no pinned port: esbuild bundles of the track's modules with stubs where a module would reach a
// device, the validator's own CommonJS modules required as they are, and an in-process validator on listen(0) where a
// real HPKE round trip or a real route is the point. Every guard has a MUTATION: a patched copy that must turn its check
// red (a mutation whose anchor is gone is reported as such, never as a pass).
//
//   W  THE WEB CHANNEL'S REQUEST (lib/zk/anon/webChannel.ts): one request per send, every fetch init field pinned
//      (credentials omit, no-referrer, no-store, redirect error, cors, no keepalive), exactly one header
//      (text/plain;charset=UTF-8), the body exactly 4096 bytes, the PoW in the query; malformed sends refused before any
//      request; the head GET mapped onto the web route and nothing else readable; one request call site in the file
//   R  RELAY SELECTION (lib/zk/anon/relay.ts + submit.ts): node → the isolated socket (unchanged diagnostics); browser →
//      the web channel (channel "web", reusedSocket null); OHTTP in the browser never falls back to direct; tor refuses;
//      a LIVE envelope never leaves a browser
//   V  AVAILABILITY (lib/zk/anon/availability.ts, D-ANON-SWITCH): the whole matrix — the switch, the rep binding only on
//      a server, a public server off, the browser's fixture on + preview-only, live off, not-in-the-crowd off for now,
//      unreadable off; the plain tree name pinned to lib/zk/config.ts
//   F  THE FIXTURE CORE (lib/zk/transport/fixtureCore.ts): tag parity with validator/zk.js, nullifier parity with
//      lib/zk/nullifier.ts, canonical-input parity, the refusals
//   K  THE WORKER CORE (lib/zk/prover/browser-worker.ts, bundled for node): fixture-prove; a REAL live Groth16 proof from
//      the pinned files, verified by the validator's own verifyLiveProof; a tampered zkey, a tampered bundled vkey, an
//      absent or "present:false" manifest and a foreign URL all refused for the right reason
//   H  THE BRIDGE (lib/zk/transport/browser.ts): one job per fresh worker, terminated; no Worker = a refusal, never the
//      page's own thread; a timeout terminates; a wrong-job answer is refused; live through the bridge with the
//      nullifier cross-check
//   O  A REAL HPKE ROUND TRIP of the web OHTTP adapter through scripts/lib-ohttp-relay.mjs to validator/anon.js's
//      gateway, and the direct web route, both from the real webChannel (node's fetch standing in for the browser's)
//   A  THE VALIDATOR'S WEB ROUTE GUARDS (validator/anon.js, mutated in memory): the header policy, the refused set on
//      its own, TRUST_PROXY, the body size, the PoW from the query, the universe gate
//   P  POW parity (lib/zk/anon/pow.ts ↔ validator/anon.js powValid)
//   E  THE DEVICE ENVIRONMENT'S ANON HINTS (lib/device/deviceEnv.server.ts anonRelayHints)
//   B  THE BUILD BUDGET (scripts/build-device.mjs budgetViolations) and the snarkjs markers, proven present in a real
//      prover bundle so the device.js check cannot go stale
//   S  SOURCE RULES (accept-z1 check 4's, the C2 anchors in the route, the debug-only prover hook, the smoke knobs'
//      loopback guard; S4: the boot-time prover load, the tab-close guard, the request-free worker scope, no provingMs)
// PERSONA LAUNCH P7 review fixes, each with its mutations:
//   L1  H1/H3/K7 — the prover is loaded at BOOT in every tab; a job never makes a request (blob: worker, files in the job)
//   L2  R2/H4 — the padded body is an allowlist of the envelope; no provingMs on any envelope
//   UXH-2  V1/U1 — unknown is not yes ("checking", off); the composer's read runs one check at once; POST 409 'checking'
//   UXH-3  D1/U1 — "keep this tab open" on every line of a post the tab holds; the recent list; the window expiry
//   UXH-8  U1 — postAs.ownerService; UXH-11 V1 — the crowd sentence is one complete sentence
// PUBLIC GO-LIVE (the gpl track; the stopped run tagged its half "PERSONA LAUNCH GO-LIVE"), each with its mutations:
//   V3/V4/E2  D-PUBLIC-ANON-TREE — the four deliberate duplicates of the plain tree (config.ts, availability.ts,
//             validator/zk.js, and the TAB's copy via deviceEnv.server.ts) agree under every environment, or the tab is
//             off in plain words; the client floor is never NaN; a fresh root joins and hears WHEN; a crowd under the
//             floor is off for now; U1 the route's join (once, never from the poll, never from a server device)
//   A1        A-WEB-PROXY-HOP-HEADERS — Railway's documented edge headers (validator/test/fixtures/railway-hop-headers.json)
//             tolerated only under TRUST_PROXY=true; no cf-*
//   G1-G8     A-GPL-SOURCE-OFFER — the source offer at /device/source/ (scripts/lib/gpl-source.mjs, build-device.mjs
//             stageSourceOffer): exactly the bundle's Totem inputs, byte-equal, hashed; the build files; the GPL text;
//             tagged upstream links; the commit; a clean notice page; the deployed check; the banner; the build wiring;
//             one address everywhere
//   G9        the rate-limit key behind the edge (validator/caps.js edgeClientAddress = middleware.ts edgeForwardedAddress)
//   B3/B4     (verify) REQUIRE_ZK_ARTIFACTS / ZK_ARTIFACT_FETCH in scripts/build-device.mjs: the required files, their 6 MiB budget,
//             the build failing on either; a fetched file kept only on its pins, never re-fetched (an injected fetch)
//   G10       (verify) no limiter keys on the client-written left-most X-Forwarded-For entry (a source scan, proven able to hit)
//   A5c       ASM-2B — the TEST universe refused at the web door, before verification, of an armed public relay or a live
//             product (PUBLIC_LIVE on a public deployment; a misspelt value counts as live); the rig and the preview unchanged
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = mkdtempSync(path.join(os.tmpdir(), "layers-prover-unit-"));
process.on("exit", () => rmSync(HERE, { recursive: true, force: true }));
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");

// the client reads these at module load, the validator at call time: fast PoW, a short response floor, the rig shape
process.env.ZK_POW_BITS = "8";
process.env.ZK_ANON_RESPONSE_MS = "20";
process.env.ZK_DEV_HOOKS = "true";
for (const k of ["ZK_ANON_POST", "ZK_ANON_POST_TREE", "ZK_GATE_TIER", "ZK_RELAY", "ZK_RELAY_URL", "ZK_RELAY_THIRD_PARTY", "TRUST_PROXY", "LAYERS_WORLD", "NODE_ENV"]) delete process.env[k];

let passed = 0;
let failed = 0;
let infra = 0;
const failures = [];
async function check(name, fn) {
  try {
    const extra = await fn();
    passed++;
    console.log(`  PASS  ${name}${typeof extra === "string" ? " — " + extra : ""}`);
  } catch (e) {
    if (e && e.infra) {
      infra++;
      console.log(`  INFRA ${name} — ${e.message}`);
      return;
    }
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name} — ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function mutation(name, run) {
  let threw = null;
  try {
    await run();
  } catch (e) {
    threw = e;
  }
  await check(`MUTATION ${name} → the check goes red`, async () => {
    assert(threw !== null, "the broken copy PASSED — the check is vacuous");
    assert(!/^patch anchor not found/.test(String(threw.message ?? "")), "the mutation did not apply — " + threw.message);
    // a broken copy that does not even BUILD proves nothing about the check
    assert(!/^Build failed/.test(String(threw.message ?? "")), "the mutated copy did not build — " + String(threw.message).slice(0, 200));
    return String(threw.message ?? threw).slice(0, 120);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const te = new TextEncoder();
const td = new TextDecoder();

// ------------------------------------------------------------------------------------------------ the bundler
let bundleSeq = 0;
const VKEY_FILE = path.join(ROOT, "node_modules", "@semaphore-protocol", "proof", "src", "verification-keys.json");
const VKEY_TEXT = readFileSync(VKEY_FILE, "utf8");
/** bundle `entrySrc` with `mocks` (repo path without extension, or a bare specifier → module source) and `patches`
 *  (repo file → [[from, to], …] applied to a COPY; relative imports in the copy rewritten to their @/ form) */
async function bundle(entrySrc, mocks = {}, patches = {}, buildOpts = {}) {
  const dir = path.join(HERE, "b" + ++bundleSeq);
  mkdirSync(dir, { recursive: true });
  const mockFile = {};
  for (const [k, src] of Object.entries(mocks)) {
    const f = path.join(dir, "mock__" + k.replace(/[^A-Za-z0-9]/g, "_") + ".mjs");
    writeFileSync(f, src.trim() + "\n");
    mockFile[k] = f;
  }
  const patched = {};
  for (const [file, edits] of Object.entries(patches)) {
    let src = readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
    for (const [from, to] of edits) {
      if (!src.includes(from)) throw new Error(`patch anchor not found in ${file}: ${from.slice(0, 90)}`);
      src = src.split(from).join(to);
    }
    const d = path.posix.dirname(file);
    src = src.replace(/from "(\.\.?\/[^"]+)"/g, (_, rel) => `from "@/${path.posix.normalize(path.posix.join(d, rel))}"`);
    src = src.replace(/import\("(\.\.?\/[^"]+)"\)/g, (_, rel) => `import("@/${path.posix.normalize(path.posix.join(d, rel))}")`);
    const f = path.join(dir, "patched__" + file.replace(/[\\/]/g, "__"));
    writeFileSync(f, src);
    patched[file.replace(/\.(ts|tsx|mjs|js)$/, "")] = f;
  }
  const plugin = {
    name: "prover-unit-mocks",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (mockFile[args.path]) return { path: mockFile[args.path] };
        let abs = null;
        if (args.path.startsWith("@/")) abs = path.join(ROOT, args.path.slice(2));
        else if (args.path.startsWith(".") && args.importer && !args.importer.startsWith(dir)) abs = path.resolve(path.dirname(args.importer), args.path);
        if (!abs) return undefined;
        const rel = path.relative(ROOT, abs).split(path.sep).join("/").replace(/\.(ts|tsx|mjs|js)$/, "");
        if (mockFile[rel]) return { path: mockFile[rel] };
        if (patched[rel]) return { path: patched[rel] };
        return undefined;
      });
    },
  };
  const entry = path.join(dir, "entry.ts");
  writeFileSync(entry, entrySrc);
  const out = path.join(dir, "out.mjs");
  await build({
    absWorkingDir: ROOT,
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT, "tsconfig.json"),
    plugins: [plugin],
    loader: { ".json": "json" },
    logLevel: "silent",
    // patched copies live in the temp dir: bare imports resolve from the repo's node_modules
    nodePaths: [path.join(ROOT, "node_modules")],
    define: { __LAYERS_PINNED_VKEY_TEXT__: JSON.stringify(VKEY_TEXT) },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    ...buildOpts,
  });
  return import(pathToFileURL(out).href);
}
const SERVER_ONLY = { "server-only": "export {};" };

// the validator's own modules (CommonJS, as they are)
const vz = require(path.join(ROOT, "validator", "zk.js"));
const vanon = require(path.join(ROOT, "validator", "anon.js"));
const { Identity } = require("@semaphore-protocol/identity");
const { Group } = require("@semaphore-protocol/group");

// a window-less node process, a browser-shaped one, restored after each scenario
const realFetch = globalThis.fetch;
async function asBrowser(fn) {
  globalThis.window = globalThis.window ?? {};
  try {
    return await fn();
  } finally {
    delete globalThis.window;
  }
}

const hex = (b) => Buffer.from(b).toString("hex");
const randomField = () => (BigInt("0x" + hex(globalThis.crypto.getRandomValues(new Uint8Array(30))))).toString(10);
console.log("\nPersona launch P7 — the browser prover, the web channel, availability (node-only)");

// ================================================================================================ W — the web channel
console.log("\nW — the web channel's request");
const WC_ENTRY = `export * from "@/lib/zk/anon/webChannel";`;
const WC = await bundle(WC_ENTRY, SERVER_ONLY);
function captureFetch(answer = '{"outcome":"accepted"}', status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { status, arrayBuffer: async () => te.encode(answer).buffer };
  };
  return calls;
}
async function webShapeScenario(M) {
  const calls = captureFetch();
  try {
    const body = new Uint8Array(4096).fill(0x78);
    const r = await M.webSubmitDirect("http://127.0.0.1:4063/", body, "abc_1-Z");
    assert(r.status === 200 && td.decode(r.body).includes("accepted"), "the answer was not handed back");
    assert(calls.length === 1, "requests made: " + calls.length);
    const { url, init } = calls[0];
    assert(url === "http://127.0.0.1:4063/zk/anon/web?pow=abc_1-Z", "url: " + url);
    assert(init.method === "POST", "method " + init.method);
    assert(init.credentials === "omit", "credentials: " + init.credentials);
    assert(init.referrerPolicy === "no-referrer", "referrerPolicy: " + init.referrerPolicy);
    assert(init.cache === "no-store", "cache: " + init.cache);
    assert(init.redirect === "error", "redirect: " + init.redirect);
    assert(init.mode === "cors", "mode: " + init.mode);
    assert(init.keepalive === false, "keepalive: " + init.keepalive);
    const hk = Object.keys(init.headers ?? {});
    assert(hk.length === 1 && hk[0] === "content-type" && init.headers["content-type"] === "text/plain;charset=UTF-8", "headers: " + JSON.stringify(init.headers));
    assert(init.body && init.body.length === 4096, "body bytes: " + (init.body && init.body.length));
    const allowed = new Set(["credentials", "referrerPolicy", "cache", "redirect", "mode", "keepalive", "method", "headers", "signal", "body"]);
    for (const k of Object.keys(init)) assert(allowed.has(k), "an init field nobody pinned: " + k);
    // refusals before any request
    const before = calls.length;
    for (const [what, run] of [
      ["4095 bytes", () => M.webSubmitDirect("http://127.0.0.1:4063", new Uint8Array(4095), "a")],
      ["4097 bytes", () => M.webSubmitDirect("http://127.0.0.1:4063", new Uint8Array(4097), "a")],
      ["no nonce", () => M.webSubmitDirect("http://127.0.0.1:4063", body, "")],
      ["a nonce with a slash", () => M.webSubmitDirect("http://127.0.0.1:4063", body, "a/b")],
      ["http to a remote host", () => M.webSubmitDirect("http://validator.example", body, "a")],
      ["a URL with credentials", () => M.webSubmitDirect("https://u:p@validator.example", body, "a")],
      ["a GET of another path", () => M.webGetDirect("http://127.0.0.1:4063", "/zk/members?mode=fixture")],
      ["an OHTTP relay with no URL", () => M.webOhttpPost("", new Uint8Array(10))],
    ]) {
      let threw = false;
      try {
        await run();
      } catch {
        threw = true;
      }
      assert(threw, "not refused: " + what);
    }
    assert(calls.length === before, "a refused send still made a request");
    await M.webGetDirect("https://validator.example", "/zk/anon/head?mode=fixture&tree=tier-2");
    const g = calls[calls.length - 1];
    assert(g.url === "https://validator.example/zk/anon/web/head?mode=fixture&tree=tier-2", "head url: " + g.url);
    assert(Object.keys(g.init.headers).length === 0 && g.init.credentials === "omit" && g.init.referrerPolicy === "no-referrer" && g.init.body === undefined, "the head GET carries something: " + JSON.stringify(g.init));
    await M.webOhttpPost("https://relay.example/ohttp", new Uint8Array(70));
    const o = calls[calls.length - 1];
    assert(o.url === "https://relay.example/ohttp" && o.init.headers["content-type"] === "message/ohttp-req" && o.init.credentials === "omit", "ohttp post: " + JSON.stringify({ url: o.url, h: o.init.headers }));
    await M.webOhttpKeys("https://relay.example/ohttp/");
    assert(calls[calls.length - 1].url === "https://relay.example/ohttp/keys", "keys url: " + calls[calls.length - 1].url);
  } finally {
    globalThis.fetch = realFetch;
  }
}
await check("W1 a submission is ONE request: POST /zk/anon/web?pow=…, credentials omit, no-referrer, no-store, redirect error, cors, no keepalive, ONE header (text/plain;charset=UTF-8), a 4096-byte body; malformed sends make no request; the head GET maps onto the web route, OHTTP keys and posts go to the relay", () => webShapeScenario(WC));
await mutation("W1 / credentials:'omit' dropped", async () => webShapeScenario(await bundle(WC_ENTRY, SERVER_ONLY, { "lib/zk/anon/webChannel.ts": [['  credentials: "omit",\n', ""]] })));
await mutation("W1 / referrerPolicy:'no-referrer' dropped", async () => webShapeScenario(await bundle(WC_ENTRY, SERVER_ONLY, { "lib/zk/anon/webChannel.ts": [['  referrerPolicy: "no-referrer",\n', ""]] })));
await mutation("W1 / a second header added", async () => webShapeScenario(await bundle(WC_ENTRY, SERVER_ONLY, { "lib/zk/anon/webChannel.ts": [['{ "content-type": WEB_CONTENT_TYPE }', '{ "content-type": WEB_CONTENT_TYPE, "x-zk-pow": powNonce }']] })));
await mutation("W1 / the constant-size refusal dropped", async () => webShapeScenario(await bundle(WC_ENTRY, SERVER_ONLY, { "lib/zk/anon/webChannel.ts": [["body.length !== ZK_SUBMIT_BYTES", "false"]] })));

// ================================================================================================ R — relay selection
console.log("\nR — relay selection (node: the isolated socket; browser: the web channel)");
const R_MOCKS = {
  ...SERVER_ONLY,
  "lib/zk/anon/webChannel": `
const R = () => (globalThis.__RW ??= { calls: [] });
const ok = () => ({ status: 200, body: new TextEncoder().encode('{"outcome":"accepted"}'), ms: 1, headersSet: ["content-type"] });
export async function webSubmitDirect(v, b, p) { R().calls.push(["web-submit", v, b.length, p]); return ok(); }
export async function webGetDirect(v, p) { R().calls.push(["web-get", v, p]); return { status: 200, body: new TextEncoder().encode("{}"), ms: 1, headersSet: [] }; }
export async function webOhttpKeys(u) { R().calls.push(["web-ohttp-keys", u]); if (!u) throw new Error("web channel: the OHTTP relay URL is not configured (ZK_RELAY_URL) — refusing; never a fallback to direct"); return { status: 500, body: new Uint8Array(0), ms: 1, headersSet: [] }; }
export async function webOhttpPost(u) { R().calls.push(["web-ohttp-post", u]); return { status: 500, body: new Uint8Array(0), ms: 1, headersSet: [] }; }`,
  "lib/zk/anon/client": `
const R = () => (globalThis.__RW ??= { calls: [] });
export async function isolatedRequest(url, o) { R().calls.push(["isolated", url, o.method]); return { status: 200, body: new TextEncoder().encode('{"outcome":"accepted"}'), contentType: "application/json", reusedSocket: false, headersSent: ["host", "content-type", "content-length", "x-zk-pow"], ms: 1 }; }
export function recordAnonSubmission(d) { (R().diag ??= []).push(d); }
export function lastAnonSubmission() { const d = R().diag ?? []; return d[d.length - 1] ?? null; }`,
};
const R_ENTRY = `export * as relay from "@/lib/zk/anon/relay"; export * as submit from "@/lib/zk/anon/submit"; export * as config from "@/lib/zk/config";`;
process.env.VALIDATOR_URL = "http://127.0.0.1:4063";
function fixtureEnvelope(mode = "fixture") {
  const pub = { mode, claimKind: "tier-membership", tree: "valid", epoch: 7, merkleTreeRoot: "1", scope: "2", message: "3", personaId: "p_x", gateId: "foryou", challenge: "epoch-7" };
  return { v: 1, mode, claimKind: "tier-membership", publicInputs: pub, nullifier: "4", proof: { scheme: "layers-zk-fixture/1", tag: "00" } };
}
async function relayScenario(M) {
  const T = (globalThis.__RW = { calls: [], diag: [] });
  M.relay.setRelayOverride(null);
  // NODE: the isolated socket, the node diagnostics (accept-z1 check 4's reading)
  assert(!M.relay.inBrowserDevice() && M.relay.relayChannel() === "node", "a node process thinks it is a browser");
  assert(M.relay.currentRelay() === M.relay.directRelay, "node: not the isolated direct relay");
  const n = await M.submit.submitAnonymous(fixtureEnvelope());
  assert(n.outcome === "accepted" && n.channel === "node", "node submit: " + JSON.stringify(n));
  assert(T.calls.length === 1 && T.calls[0][0] === "isolated" && T.calls[0][1] === "http://127.0.0.1:4063/zk/anon/submit", "node calls: " + JSON.stringify(T.calls));
  const nd = T.diag[T.diag.length - 1];
  assert(nd.agentFalse === true && nd.reusedSocket === false && nd.channel === "node", "node diagnostics: " + JSON.stringify(nd));
  await asBrowser(async () => {
    T.calls.length = 0;
    // BROWSER: the web channel, PoW handed over as the query nonce
    assert(M.relay.inBrowserDevice() && M.relay.relayChannel() === "web", "a browser-shaped process is not the browser device");
    assert(M.relay.currentRelay() === M.relay.webDirectRelay, "browser: not the web direct relay");
    const w = await M.submit.submitAnonymous(fixtureEnvelope());
    assert(w.outcome === "accepted" && w.channel === "web" && w.bytes === 4096 && w.reusedSocket === null, "browser submit: " + JSON.stringify(w));
    assert(T.calls.length === 1 && T.calls[0][0] === "web-submit" && T.calls[0][2] === 4096 && /^[0-9a-z]+$/.test(T.calls[0][3]), "browser calls: " + JSON.stringify(T.calls));
    const wd = T.diag[T.diag.length - 1];
    assert(wd.channel === "web" && wd.agentFalse === false && wd.reusedSocket === null, "web diagnostics: " + JSON.stringify(wd));
    // a LIVE envelope never leaves a browser
    T.calls.length = 0;
    const l = await M.submit.submitAnonymous(fixtureEnvelope("live"));
    assert(l.outcome === "refused" && T.calls.length === 0 && l.note === M.submit.BROWSER_LIVE_REFUSAL, "a live envelope left the browser: " + JSON.stringify({ l, calls: T.calls }));
    // the head over the web channel
    T.calls.length = 0;
    await M.relay.anonymousHead("fixture", "tier-2").catch(() => null);
    assert(T.calls.length === 1 && T.calls[0][0] === "web-get" && T.calls[0][2] === "/zk/anon/head?mode=fixture&tree=tier-2", "browser head: " + JSON.stringify(T.calls));
    // OHTTP with no URL: a refusal, never a fallback to direct
    M.relay.setRelayOverride({ kind: "ohttp", url: "", thirdParty: false });
    T.calls.length = 0;
    const o = await M.submit.submitAnonymous(fixtureEnvelope());
    assert(o.outcome === "transport-error" && !T.calls.some((c) => c[0] === "web-submit" || c[0] === "isolated"), "ohttp without a URL fell back: " + JSON.stringify(T.calls));
    // OHTTP with a URL: the keys THROUGH the relay; a failed key fetch is a transport error, still no direct send
    M.relay.setRelayOverride({ kind: "ohttp", url: "https://relay.example/ohttp", thirdParty: false });
    T.calls.length = 0;
    const o2 = await M.submit.submitAnonymous(fixtureEnvelope());
    assert(o2.outcome === "transport-error" && T.calls.length === 1 && T.calls[0][0] === "web-ohttp-keys" && T.calls[0][1] === "https://relay.example/ohttp", "ohttp in the browser: " + JSON.stringify(T.calls));
    // tor refuses
    M.relay.setRelayOverride({ kind: "tor", url: "", thirdParty: false });
    T.calls.length = 0;
    const t = await M.submit.submitAnonymous(fixtureEnvelope());
    assert(t.outcome === "transport-error" && T.calls.length === 0, "tor in the browser: " + JSON.stringify(T.calls));
    M.relay.setRelayOverride(null);
  });
  M.relay.setRelayOverride({ kind: "tor", url: "", thirdParty: false });
  T.calls.length = 0;
  const t2 = await M.submit.submitAnonymous(fixtureEnvelope());
  assert(t2.outcome === "transport-error" && T.calls.length === 0, "tor in node: " + JSON.stringify(T.calls));
  M.relay.setRelayOverride(null);
}
const R = await bundle(R_ENTRY, R_MOCKS);
await check("R1 node → the isolated socket (agentFalse, reusedSocket false); browser → the web channel (channel web, 4096 B, PoW as the nonce, reusedSocket null); a live envelope never leaves a browser; OHTTP in the browser fetches keys THROUGH the relay and never falls back to direct; tor refuses in both", () => relayScenario(R));
await mutation("R1 / the browser branch removed from currentRelay", async () => relayScenario(await bundle(R_ENTRY, R_MOCKS, { "lib/zk/anon/relay.ts": [["  if (inBrowserDevice()) {\n    // PERSONA LAUNCH P7", "  if (false) {\n    // PERSONA LAUNCH P7"]] })));
await mutation("R1 / OHTTP with no URL falls back to the web direct route", async () => relayScenario(await bundle(R_ENTRY, R_MOCKS, { "lib/zk/anon/relay.ts": [['    if (c.kind === "ohttp") return webOhttpRelay(c.url);\n    if (c.kind === "tor") return torRelay;\n    return webDirectRelay;', '    if (c.kind === "ohttp" && c.url) return webOhttpRelay(c.url);\n    if (c.kind === "tor") return torRelay;\n    return webDirectRelay;']] })));
await mutation("R1 / the browser's live-envelope refusal removed from submit.ts", async () => relayScenario(await bundle(R_ENTRY, R_MOCKS, { "lib/zk/anon/submit.ts": [['if (channel === "web" && (envelope?.mode !== "fixture"', 'if (false && (envelope?.mode !== "fixture"']] })));
// PERSONA LAUNCH P7 (L2): the padded body is an ALLOWLIST of the envelope — a prover timing (or anything else a caller
// hangs on the in-memory object) never rides the anonymous wire
async function wireScenario(M) {
  const allowed = new Set(M.submit.WIRE_ENVELOPE_KEYS);
  assert(JSON.stringify([...allowed]) === JSON.stringify(["v", "mode", "claimKind", "publicInputs", "nullifier", "proof", "payload"]), "the wire allowlist moved: " + JSON.stringify([...allowed]));
  const bare = fixtureEnvelope();
  const env = { ...bare, provingMs: 1234.5, debugNote: "a local note" };
  const body = M.submit.paddedBody(env);
  assert(body && body.length === 4096, "the padded body: " + (body && body.length));
  const parsed = JSON.parse(td.decode(body));
  assert(JSON.stringify(Object.keys(parsed)) === '["envelope","p"]', "the body's own keys: " + Object.keys(parsed).join(","));
  const keys = Object.keys(parsed.envelope);
  assert(keys.every((k) => allowed.has(k)), "a key outside the allowlist went on the wire: " + keys.filter((k) => !allowed.has(k)).join(","));
  assert(!("provingMs" in parsed.envelope) && !td.decode(body).includes("1234.5"), "provingMs went on the wire");
  assert(JSON.stringify(parsed.envelope) === JSON.stringify(bare), "the allowlisted envelope is not the envelope's own fields");
  const withPayload = { ...bare, payload: { text: "t", nonce: "n", note: "ab" }, provingMs: 5 };
  const p2 = JSON.parse(td.decode(M.submit.paddedBody(withPayload)));
  assert(p2.envelope.payload && p2.envelope.payload.text === "t" && !("provingMs" in p2.envelope), "the payload: " + JSON.stringify(p2.envelope).slice(0, 160));
}
await check("R2 (L2) the padded anonymous body carries ONLY the allowlisted envelope fields {v, mode, claimKind, publicInputs, nullifier, proof, payload}: a provingMs or any other field on the in-memory envelope never reaches the wire", () => wireScenario(R));
await mutation("R2 / the whole envelope object serialized again (provingMs back on the wire)", async () => wireScenario(await bundle(R_ENTRY, R_MOCKS, { "lib/zk/anon/submit.ts": [["  const wire = wireEnvelope(envelope);", "  const wire = envelope as unknown as Record<string, unknown>;"]] })));

// ================================================================================================ V — availability
console.log("\nV — availability (D-ANON-SWITCH)");
const V_MOCKS = {
  "lib/adapters/registry": `export function currentRepImpl() { const T = globalThis.__AVR; if (T.throws) throw new Error("the registry could not be read"); return T.rep; }`,
};
const V_ENTRY = `export * from "@/lib/zk/anon/availability";`;
/** PERSONA LAUNCH GO-LIVE: sixty decoy leaves — a crowd over the client's floor of 50 */
const CROWD60 = Array.from({ length: 60 }, (_, i) => "9" + String(1000 + i));
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
async function availabilityScenario(M) {
  globalThis.__AVR = { rep: "mock", throws: false };
  const on = (a) => a.on === true;
  const commitment = "12345";
  const snapPlain = (members) => ({ mode: "fixture", tree: M.plainAnonTreeName(), members: { members } });
  // SERVER-SIDE (rig shape: not a public deployment)
  withEnv({ ZK_DEV_HOOKS: "true", ZK_ANON_POST: undefined }, () => {
    let a = M.anonPostingAvailability({ mode: "fixture" });
    assert(!on(a) && a.scope === "deployment" && a.reason === M.ANON_OFF_SERVER && !a.previewOnly, "server, rep mock, switch unset: " + JSON.stringify(a));
    globalThis.__AVR.rep = "zk";
    a = M.anonPostingAvailability({ mode: "live" });
    assert(on(a) && !a.previewOnly && a.scope === null, "server, rep zk: " + JSON.stringify(a));
    globalThis.__AVR.rep = "mock";
  });
  withEnv({ ZK_DEV_HOOKS: "true", ZK_ANON_POST: "on" }, () => {
    const a = M.anonPostingAvailability({ mode: "fixture" });
    assert(on(a) && !a.previewOnly, "server, rep mock + ZK_ANON_POST=on: " + JSON.stringify(a));
  });
  withEnv({ ZK_DEV_HOOKS: "true", ZK_ANON_POST: "off" }, () => {
    globalThis.__AVR.rep = "zk";
    const a = M.anonPostingAvailability({ mode: "fixture" });
    assert(!on(a) && a.scope === "deployment" && a.reason === M.ANON_OFF_SWITCH, "server, rep zk + ZK_ANON_POST=off: " + JSON.stringify(a));
    globalThis.__AVR.rep = "mock";
  });
  withEnv({ ZK_DEV_HOOKS: "true", ZK_ANON_POST: "yes please" }, () => {
    const a = M.anonPostingAvailability({ mode: "fixture" });
    assert(!on(a) && a.reason === M.ANON_OFF_UNREADABLE, "a switch that is neither on nor off: " + JSON.stringify(a));
  });
  withEnv({ ZK_DEV_HOOKS: "true", ZK_ANON_POST: undefined }, () => {
    M.setAnonPostingOverride("on");
    let a = M.anonPostingAvailability({ mode: "fixture" });
    assert(on(a), "override on, rep mock: " + JSON.stringify(a));
    M.setAnonPostingOverride("off");
    globalThis.__AVR.rep = "zk";
    a = M.anonPostingAvailability({ mode: "fixture" });
    assert(!on(a) && a.reason === M.ANON_OFF_SWITCH, "override off, rep zk: " + JSON.stringify(a));
    M.setAnonPostingOverride(null);
    a = M.anonPostingAvailability({ mode: "fixture" });
    assert(on(a), "override cleared, rep zk: " + JSON.stringify(a));
    globalThis.__AVR.throws = true;
    a = M.anonPostingAvailability({ mode: "fixture" });
    assert(!on(a) && a.reason === M.ANON_OFF_UNREADABLE, "an unreadable registry: " + JSON.stringify(a));
    globalThis.__AVR = { rep: "mock", throws: false };
    a = M.anonPostingAvailability({ mode: "nonsense" });
    assert(!on(a) && a.reason === M.ANON_OFF_UNREADABLE, "a universe that is neither: " + JSON.stringify(a));
  });
  // a PUBLIC deployment's server: off, whatever the switch says (the keyless server)
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_POST: "on" }, () => {
    globalThis.__AVR.rep = "zk";
    const a = M.anonPostingAvailability({ mode: "fixture" });
    assert(!on(a) && a.reason === M.ANON_OFF_PUBLIC_SERVER, "a public server with the switch on: " + JSON.stringify(a));
    globalThis.__AVR.rep = "mock";
  });
  // THE BROWSER DEVICE — the rep binding never asked
  await asBrowser(async () => {
    withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_POST: undefined }, () => {
      globalThis.__AVR = { rep: "mock", throws: false };
      let a = M.anonPostingAvailability({ mode: "fixture" });
      assert(on(a) && a.previewOnly === true && a.scope === null, "browser fixture, rep mock: " + JSON.stringify(a));
      globalThis.__AVR.throws = true; // the registry is never read in the browser
      a = M.anonPostingAvailability({ mode: "fixture" });
      assert(on(a) && a.previewOnly === true, "browser fixture read the rep binding: " + JSON.stringify(a));
      globalThis.__AVR.throws = false;
      a = M.anonPostingAvailability({ mode: "live" });
      assert(!on(a) && a.scope === "deployment" && a.reason === M.ANON_OFF_BROWSER_LIVE, "browser live: " + JSON.stringify(a));
      M.setAnonPostingOverride("on");
      a = M.anonPostingAvailability({ mode: "live" });
      assert(!on(a) && a.reason === M.ANON_OFF_BROWSER_LIVE, "the override switched the live universe on in a browser: " + JSON.stringify(a));
      M.setAnonPostingOverride(null);
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapPlain(["1", "2"]), commitment });
      assert(!on(a) && a.scope === "now" && a.reason === M.ANON_NOT_IN_CROWD && a.code === "crowd", "browser, not a leaf: " + JSON.stringify(a));
      // PERSONA LAUNCH GO-LIVE: a leaf of a crowd that clears the client's floor (50) — a crowd under it is off now (V4)
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapPlain([...CROWD60, commitment]), commitment });
      assert(on(a) && a.previewOnly && a.code === null, "browser, a leaf: " + JSON.stringify(a));
      // PERSONA LAUNCH P7 (UXH-2): UNKNOWN IS NOT YES — asked for the per-root judgement (snap passed, even null), a tab
      // that cannot judge is off for now ("checking"), never on
      const checking = (x) => !on(x) && x.scope === "now" && x.reason === M.ANON_CHECKING && x.code === "checking";
      a = M.anonPostingAvailability({ mode: "fixture", snap: null, commitment });
      assert(checking(a), "browser, no check yet (snap null): " + JSON.stringify(a));
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapPlain(["1", commitment]), commitment: null });
      assert(checking(a), "browser, no readable identity: " + JSON.stringify(a));
      a = M.anonPostingAvailability({ mode: "fixture", snap: { mode: "fixture", tree: "attest:x.y/z", members: { members: ["1"] } }, commitment });
      assert(checking(a), "a snapshot of another tree was taken as yes: " + JSON.stringify(a));
      a = M.anonPostingAvailability({ mode: "fixture", snap: { ...snapPlain(["1"]), mode: "live" }, commitment });
      assert(checking(a), "a snapshot of another universe was taken as yes: " + JSON.stringify(a));
      a = M.anonPostingAvailability({ mode: "fixture", snap: { mode: "fixture", tree: M.plainAnonTreeName(), members: { members: [1, 2] } }, commitment });
      assert(!on(a) && a.scope === "now" && a.reason === M.ANON_OFF_UNREADABLE && a.code === "unreadable", "an unreadable member list: " + JSON.stringify(a));
      // the deployment-only question (the gate's and the outbox's call: no `snap` key) is unchanged: on, preview-only
      a = M.anonPostingAvailability({ mode: "fixture" });
      assert(on(a) && a.previewOnly === true, "the deployment-only call in a browser: " + JSON.stringify(a));
      // UXH-11: the crowd sentence is ONE complete sentence a stranger can read (no "You're not … yet" pointing at a step
      // the preview does not offer)
      assert(/^[A-Z]/.test(M.ANON_NOT_IN_CROWD) && M.ANON_NOT_IN_CROWD.endsWith(".") && (M.ANON_NOT_IN_CROWD.match(/\./g) || []).length === 1 && !M.ANON_NOT_IN_CROWD.startsWith("You're not in the anonymous crowd yet"), "the crowd sentence: " + M.ANON_NOT_IN_CROWD);
    });
    withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_POST: "off" }, () => {
      const a = M.anonPostingAvailability({ mode: "fixture" });
      assert(!on(a) && a.reason === M.ANON_OFF_SWITCH, "browser with the switch off: " + JSON.stringify(a));
    });
  });
}
const V = await bundle(V_ENTRY, V_MOCKS);
await check("V1 the matrix: server rep mock → off ('Anonymous posting is off on this server.'), rep zk → on, switch on → on with rep mock, switch off → off with rep zk, override on/off/cleared, garbage switch / unreadable registry / unknown universe → off; a public server → off; browser fixture → on + preview-only (rep never read), browser live → off (the override cannot lift it), not a leaf → off for now, another tree or universe → unjudged, unreadable members → off", () => availabilityScenario(V));
await mutation("V1 / the browser branch asks the rep binding again", async () =>
  availabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [['      if (mode === "live") {\n        return off(', '      if (currentRepImpl() !== "zk") return off("deployment", ANON_OFF_SERVER, "rep");\n      if (mode === "live") {\n        return off(']] }))
);
await mutation("V1 / the browser's live refusal removed", async () => availabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [['      if (mode === "live") {\n        return off(', '      if (false) {\n        return off(']] })));
// PERSONA LAUNCH GO-LIVE: the not-a-leaf branch now says WHEN (notInCrowd) — the same guard, at its new anchor
await mutation("V1 / not-a-leaf no longer refused", async () => availabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [["if (v === false) return notInCrowd(", "if (v === 42) return notInCrowd("]] })));
await mutation("V1 / the switch ignored", async () => availabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [['if (sw === "off") return off(', 'if (sw === "never") return off(']] })));
await mutation("V1 (UXH-2) / the fail-open return restored: no check yet → on", async () =>
  availabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [['if (o.snap === undefined || o.snap === null) return off("now", ANON_CHECKING,', 'if (o.snap === undefined || o.snap === null) return { on: true, previewOnly: true, scope: null, reason: null, detail: null, code: null } || off("now", ANON_CHECKING,']] }))
);
await mutation("V1 (UXH-2) / another tree or universe taken as yes again", async () => availabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [['if (v === "unjudged") return off(', 'if (v === "never") return off(']] })));
await mutation("V1 (UXH-2) / no identity taken as yes", async () => availabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [['if (typeof o.commitment !== "string" || !o.commitment) return off(', 'if (false) return off(']] })));
await check("V2 the plain anon tree's name is lib/zk/config.ts ZK_ANON_POST_TREE under every environment (the deliberate duplicate cannot drift)", async () => {
  let n = 0;
  for (const env of [{}, { ZK_GATE_TIER: "5" }, { ZK_GATE_TIER: "0" }, { ZK_GATE_TIER: "99" }, { ZK_ANON_POST_TREE: "valid" }, { ZK_ANON_POST_TREE: "", ZK_GATE_TIER: "3" }]) {
    const vars = { ZK_GATE_TIER: undefined, ZK_ANON_POST_TREE: undefined, ...env };
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    try {
      // a fresh bundle per environment: config.ts reads the environment when it is first evaluated
      const C2 = await bundle(`export { ZK_ANON_POST_TREE } from "@/lib/zk/config";`, SERVER_ONLY);
      assert(C2.ZK_ANON_POST_TREE === V.plainAnonTreeName(), `env ${JSON.stringify(env)}: config ${C2.ZK_ANON_POST_TREE}, availability ${V.plainAnonTreeName()}`);
      n++;
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  return n + " environments";
});

// PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE) — V3: the deliberate duplicates pinned; V4: the public tree's new rules
await check("V3 (GO-LIVE) the deliberate duplicates cannot drift: isPlainTreeName (lib/zk/config.ts = lib/zk/anon/availability.ts) over good and bad names; the client floor (config ZK_ANON_FLOOR = availability anonFloorHere) under every environment, a value that is not a number reading 50 in both (never NaN); the validator's plain tree (validator/zk.js anonPostTree) = config ZK_ANON_POST_TREE under V2's environments", async () => {
  const C0 = await bundle(`export { isPlainTreeName } from "@/lib/zk/config";`, SERVER_ONLY);
  const names = ["valid", "tier-1", "tier-2", "tier-10", "tier-0", "tier-11", "tier-2x", "attest:fc.reach/gte-1k", "attest:onchain.wallet-age/gt2y", "attest:Bad/x", "attest:a/b/c", "attest:a/", "", "invalid", "valid ", " valid", 5, null, undefined];
  const want = { valid: true, "tier-1": true, "tier-2": true, "tier-10": true, "attest:fc.reach/gte-1k": true, "attest:onchain.wallet-age/gt2y": true };
  for (const n of names) {
    assert(C0.isPlainTreeName(n) === V.isPlainTreeName(n), "isPlainTreeName disagrees on " + JSON.stringify(n));
    assert(V.isPlainTreeName(n) === (want[n] === true), "isPlainTreeName(" + JSON.stringify(n) + ") = " + V.isPlainTreeName(n));
  }
  let floors = 0;
  for (const raw of [undefined, "", "1", "50", "7", "120", "abc", "-3", "0"]) {
    const saved = process.env.ZK_ANON_FLOOR;
    if (raw === undefined) delete process.env.ZK_ANON_FLOOR;
    else process.env.ZK_ANON_FLOOR = raw;
    try {
      const C1 = await bundle(`export { ZK_ANON_FLOOR } from "@/lib/zk/config";`, SERVER_ONLY);
      const here = V.anonFloorHere();
      assert(C1.ZK_ANON_FLOOR === here, `ZK_ANON_FLOOR=${JSON.stringify(raw)}: config ${C1.ZK_ANON_FLOOR}, availability ${here}`);
      assert(Number.isFinite(here) && here >= 1, `ZK_ANON_FLOOR=${JSON.stringify(raw)} read as ${here}`);
      if (raw === "abc") assert(here === 50, "a floor that is not a number did not read as the default 50: " + here);
      floors++;
    } finally {
      if (saved === undefined) delete process.env.ZK_ANON_FLOOR;
      else process.env.ZK_ANON_FLOOR = saved;
    }
  }
  assert(typeof vz.anonPostTree === "function", "validator/zk.js exports no anonPostTree");
  let trees = 0;
  for (const env of [{}, { ZK_GATE_TIER: "5" }, { ZK_GATE_TIER: "0" }, { ZK_GATE_TIER: "99" }, { ZK_ANON_POST_TREE: "valid" }, { ZK_ANON_POST_TREE: "", ZK_GATE_TIER: "3" }]) {
    const vars = { ZK_GATE_TIER: undefined, ZK_ANON_POST_TREE: undefined, ...env };
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    try {
      const C2 = await bundle(`export { ZK_ANON_POST_TREE } from "@/lib/zk/config";`, SERVER_ONLY);
      assert(C2.ZK_ANON_POST_TREE === vz.anonPostTree() && vz.anonPostTree() === V.plainAnonTreeName(), `env ${JSON.stringify(env)}: config ${C2.ZK_ANON_POST_TREE}, validator ${vz.anonPostTree()}, availability ${V.plainAnonTreeName()}`);
      trees++;
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  return `${names.length} names, ${floors} floors, ${trees} tree environments`;
});

/** V4: the public tree's rules in a TAB — the floor, the join's WHEN, the failed join, the mismatch, a garbled tree name */
async function goLiveAvailabilityScenario(M) {
  const on = (a) => a.on === true;
  const commitment = "12345";
  const T0 = 1_760_700_000_000;
  const H = 3_600_000;
  const timeText = (s) => "T@" + s;
  const snapAt = (members, over = {}) => ({ mode: "fixture", tree: M.plainAnonTreeName(), members: { members }, epoch: { epoch: 100, epochMs: 6 * H, msRemaining: H }, fetchedAt: T0, anonConfig: null, ...over });
  await asBrowser(async () => {
    withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_POST: undefined, ZK_ANON_POST_TREE: "valid", ZK_ANON_FLOOR: undefined }, () => {
      // THE FLOOR: a leaf of a crowd of 2 is off now, saying what the crowd needs and has; a lower floor from the env is
      // honoured; a floor that is not a number is the default, never NaN
      let a = M.anonPostingAvailability({ mode: "fixture", snap: snapAt(["1", commitment]), commitment });
      assert(!on(a) && a.scope === "now" && a.code === "crowd" && a.reason === M.anonFloorSentence(50, 2), "a leaf of a crowd of 2: " + JSON.stringify(a));
      assert(M.anonFloorSentence(50, 1).includes("there is 1 now") && M.anonFloorSentence(50, 2).includes("there are 2 now"), "the floor sentence's count: " + M.anonFloorSentence(50, 1));
      withEnv({ ZK_ANON_FLOOR: "2" }, () => {
        const b = M.anonPostingAvailability({ mode: "fixture", snap: snapAt(["1", commitment]), commitment });
        assert(on(b), "a crowd of 2 under ZK_ANON_FLOOR=2: " + JSON.stringify(b));
      });
      withEnv({ ZK_ANON_FLOOR: "abc" }, () => {
        const b = M.anonPostingAvailability({ mode: "fixture", snap: snapAt(["1", commitment]), commitment });
        assert(!on(b) && b.reason === M.anonFloorSentence(50, 2), "a floor that is not a number let a crowd of 2 through: " + JSON.stringify(b));
      });
      // THE JOIN'S WHEN: registered, a leaf from epoch 101 — the next epoch starts at T0 + 1 h (the last check's fetch time
      // plus its msRemaining); the sentence names that moment; availableFrom is it
      const join = { registered: true, activeFromEpoch: 101, error: null };
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapAt(CROWD60), commitment, join, now: T0 + 1000, timeText });
      assert(!on(a) && a.code === "crowd" && a.scope === "now" && a.availableFrom === T0 + H && a.reason === M.anonJoinSentence({ when: "T@" + (T0 + H), hours: 6, floor: 50, crowd: 60 }), "joined, before the window: " + JSON.stringify(a));
      assert(!a.reason.includes("Posting here also needs"), "the join sentence names a floor the crowd already clears: " + a.reason);
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapAt(["1", "2", "3"]), commitment, join, now: T0 + 1000, timeText });
      assert(a.reason === M.anonJoinSentence({ when: "T@" + (T0 + H), hours: 6, floor: 50, crowd: 3 }) && a.reason.includes("at least 50 people") && a.reason.includes("there were 3"), "joined into a crowd under the floor: " + a.reason);
      // the window has started, the last check is from the window before: checking (the route runs a fresh check)
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapAt(CROWD60), commitment, join, now: T0 + 2 * H, timeText });
      assert(!on(a) && a.code === "checking" && a.reason === M.ANON_CHECKING, "joined, the window started, the check is stale: " + JSON.stringify(a));
      // a check FROM that window still does not list it: not in the crowd (revoked, or refused)
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapAt(CROWD60, { epoch: { epoch: 101, epochMs: 6 * H, msRemaining: 5 * H } }), commitment, join, now: T0 + 2 * H, timeText });
      assert(!on(a) && a.code === "crowd" && a.reason === M.ANON_NOT_IN_CROWD, "joined, the window's own check does not list it: " + JSON.stringify(a));
      // the epoch timing unreadable: joined, "once the next window starts" (never a made-up time)
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapAt(CROWD60, { epoch: null }), commitment, join, now: T0, timeText });
      assert(!on(a) && a.code === "crowd" && a.reason === M.ANON_JOINED_NEXT_WINDOW, "joined, no epoch timing: " + JSON.stringify(a));
      // a failed join, and no join at all
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapAt(CROWD60), commitment, join: { registered: false, activeFromEpoch: null, error: "the validator answered 503" }, now: T0 });
      assert(!on(a) && a.code === "crowd" && a.reason === M.ANON_JOIN_FAILED && /503/.test(a.detail || ""), "a failed join: " + JSON.stringify(a));
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapAt(CROWD60), commitment });
      assert(!on(a) && a.code === "crowd" && a.reason === M.ANON_NOT_IN_CROWD, "no join known: " + JSON.stringify(a));
      // THE MISMATCH: the validator accepts another plain tree → off deployment-wide, in plain words; the same tree, or an
      // unread config, is judged as usual
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapAt([...CROWD60, commitment], { anonConfig: { tree: "tier-2" } }), commitment });
      assert(!on(a) && a.scope === "deployment" && a.code === "mismatch" && a.reason === M.ANON_OFF_TREE_MISMATCH, "a validator on another tree: " + JSON.stringify(a));
      a = M.anonPostingAvailability({ mode: "fixture", snap: snapAt([...CROWD60, commitment], { anonConfig: { tree: "valid" } }), commitment });
      assert(on(a), "the same tree on both sides: " + JSON.stringify(a));
      // the words: each new sentence is ONE plain sentence (UXH-11's rule), the join sentence starts as the suite expects
      for (const s of [M.ANON_NOT_IN_CROWD, M.ANON_JOIN_FAILED, M.ANON_JOINED_NEXT_WINDOW, M.ANON_OFF_TREE_MISMATCH]) assert(/^[A-Z]/.test(s) && s.endsWith(".") && (s.match(/\./g) || []).length === 1 && !s.includes(".."), "not one plain sentence: " + s);
      assert(!/can't join it from here/.test(M.ANON_NOT_IN_CROWD), "the dead end is back: " + M.ANON_NOT_IN_CROWD);
    });
    // A GARBLED TREE NAME (deviceEnv forwards "invalid"): off deployment-wide, said, for every caller — never "checking"
    withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_POST: undefined, ZK_ANON_POST_TREE: "invalid" }, () => {
      for (const a of [M.anonPostingAvailability({ mode: "fixture" }), M.anonPostingAvailability({ mode: "fixture", snap: null, commitment })]) {
        assert(!on(a) && a.scope === "deployment" && a.code === "unreadable" && a.reason === M.ANON_OFF_UNREADABLE, "a garbled tree name: " + JSON.stringify(a));
      }
    });
  });
  // the clock time, in the visitor's own words: the same day, tomorrow, rounded to the minute (never the minute before)
  const base = new Date(2026, 9, 17, 14, 0, 0, 0).getTime();
  assert(M.joinTimeText(base - 3, base - 3 * H) === M.joinTimeText(base, base - 3 * H), "a start 3 ms early shows another minute: " + M.joinTimeText(base - 3, base - 3 * H));
  assert(!M.joinTimeText(base, base - 3 * H).startsWith("tomorrow"), "a start later the same day reads as tomorrow");
  const midnight = new Date(2026, 9, 18, 0, 0, 0, 0).getTime();
  assert(M.joinTimeText(midnight, midnight - 2 * H).startsWith("tomorrow at "), "a start after midnight does not say tomorrow: " + M.joinTimeText(midnight, midnight - 2 * H));
}
await check("V4 (GO-LIVE, D-PUBLIC-ANON-TREE) in a tab: a leaf of a crowd under the floor is off and says what the crowd needs (env floor honoured, NaN never); a joined root hears the clock time its first window starts (availableFrom), 'checking' once that window began on a stale check, 'not in the crowd' when that window's check still omits it, 'once the next window starts' without timing; a failed join is said; a validator on another tree is off deployment-wide; a garbled tree name is off; one plain sentence each; the clock text rounds to the minute and says tomorrow", () => goLiveAvailabilityScenario(V));
await mutation("V4 / the floor check removed", async () => goLiveAvailabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [["if (crowd < floor) return off(", "if (false) return off("]] })));
await mutation("V4 / a floor that is not a number read as NaN (the fail-open)", async () => goLiveAvailabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [["return Number.isFinite(n) ? Math.max(1, n) : 50;", "return Math.max(1, n);"]] })));
await mutation("V4 / the join's WHEN dropped (a joined root hears the dead end)", async () => goLiveAvailabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [["    if (startsAt > now) {", "    if (false) {"]] })));
await mutation("V4 / 'checking' after the window began dropped", async () => goLiveAvailabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [["if (snapEpoch !== null && snapEpoch < j.activeFromEpoch) return off(", "if (false) return off("]] })));
await mutation("V4 / the tree mismatch no longer refused", async () => goLiveAvailabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [["if (served !== null && served !== plainAnonTreeName()) return off(", "if (false) return off("]] })));
await mutation("V4 / a garbled tree name no longer refused", async () => goLiveAvailabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [["if (!isPlainTreeName(plainAnonTreeName())) return off(", "if (false) return off("]] })));
await mutation("V4 / the clock text no longer rounds to the minute", async () => goLiveAvailabilityScenario(await bundle(V_ENTRY, V_MOCKS, { "lib/zk/anon/availability.ts": [["const d = new Date(Math.round(startsAt / 60_000) * 60_000);", "const d = new Date(startsAt);"]] })));

// ================================================================================================ F — the fixture core
console.log("\nF — the fixture core (one scheme, three hosts)");
const F_ENTRY = `export * as core from "@/lib/zk/transport/fixtureCore"; export { nullifierFor } from "@/lib/zk/nullifier"; export { canonicalPublicInputs } from "@/lib/zk/transport/types";`;
const ID = new Identity("layers-unit-prover/1");
const COMMIT = String(ID.commitment);
const DECOYS = Array.from({ length: 6 }, (_, i) => String(new Identity("layers-unit-prover-decoy/" + i).commitment));
async function fixtureCoreScenario(M) {
  for (let i = 0; i < 8; i++) {
    const canonical = "layers-zk-public/1|fixture|x|" + randomField();
    const nul = randomField();
    assert(M.core.fixtureTag(canonical, nul) === vz.fixtureTag(canonical, nul), "fixtureTag differs from validator/zk.js");
    const scope = BigInt(randomField());
    assert(M.core.fixtureNullifier(scope, ID.secretScalar) === M.nullifierFor(scope, ID.secretScalar), "the nullifier differs from lib/zk/nullifier.ts");
  }
  const members = [COMMIT, ...DECOYS];
  const root = new Group(members.map(BigInt)).root.toString();
  const pub = { mode: "fixture", claimKind: "tier-membership", tree: "tier-2", epoch: 9, merkleTreeRoot: root, scope: randomField(), message: randomField(), personaId: "p_unit", gateId: "foryou", challenge: "epoch-9" };
  assert(M.canonicalPublicInputs(pub) === vz.canonicalPublicInputs(pub), "canonical inputs differ from the validator's");
  const { nullifier, tag } = M.core.fixtureProveCore("tier-membership", pub, members, COMMIT, ID.secretScalar);
  assert(nullifier === M.nullifierFor(BigInt(pub.scope), ID.secretScalar).toString(10), "the proved nullifier is not the circuit formula");
  assert(tag === vz.fixtureTag(vz.canonicalPublicInputs(pub), nullifier), "the validator would not accept the tag");
  const env = { v: 1, mode: "fixture", claimKind: "tier-membership", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag } };
  assert(M.core.fixtureVerifyCore("tier-membership", env).ok === true, "the envelope does not verify");
  assert(M.core.fixtureVerifyCore("tier-membership", { ...env, publicInputs: { ...pub, scope: randomField() } }).code === "TAMPER", "a tampered scope verified");
  let threw = "";
  try {
    M.core.fixtureProveCore("tier-membership", pub, DECOYS, COMMIT, ID.secretScalar);
  } catch (e) {
    threw = e.message;
  }
  assert(threw === M.core.NOT_A_MEMBER, "a non-member was proved: " + threw);
  for (const bad of [{ ...pub, mode: "live" }, { ...pub, scope: "not-a-field" }, { ...pub, claimKind: "attestation" }]) {
    let t = false;
    try {
      M.core.fixtureProveCore("tier-membership", bad, members, COMMIT, ID.secretScalar);
    } catch {
      t = true;
    }
    assert(t, "proved a malformed request: " + JSON.stringify(bad).slice(0, 80));
  }
}
const F = await bundle(F_ENTRY, SERVER_ONLY);
await check("F1 fixtureTag = validator/zk.js, the nullifier = lib/zk/nullifier.ts (Poseidon(2)([hash(scope), secret])), canonical inputs = the validator's; a proved envelope verifies on both sides; non-member / live / non-field / mismatched kind refused", () => fixtureCoreScenario(F));
await mutation("F1 / the nullifier's input order swapped", async () => fixtureCoreScenario(await bundle(F_ENTRY, SERVER_ONLY, { "lib/zk/transport/fixtureCore.ts": [["poseidon2([semaphoreHash(scope), secretScalar])", "poseidon2([secretScalar, semaphoreHash(scope)])"]] })));

// ================================================================================================ K — the worker core
console.log("\nK — the worker core (lib/zk/prover/browser-worker.ts, bundled for node)");
const K_ENTRY = `export * from "@/lib/zk/prover/browser-worker";`;
const K = await bundle(K_ENTRY, {});
const ART_DIR = path.join(ROOT, process.env.ZK_ARTIFACT_DIR || ".zk-artifacts");
const haveArtifacts = existsSync(path.join(ART_DIR, "semaphore-20.wasm")) && existsSync(path.join(ART_DIR, "semaphore-20.zkey"));
function artifactDeps({ manifest = { present: true }, tamperZkey = false, vkeyText = undefined } = {}) {
  const fetched = [];
  const files = {
    "/device/zk/manifest.json": manifest === null ? null : te.encode(JSON.stringify(manifest)),
    "/device/zk/semaphore-20.wasm": haveArtifacts ? new Uint8Array(readFileSync(path.join(ART_DIR, "semaphore-20.wasm"))) : null,
    "/device/zk/semaphore-20.zkey": haveArtifacts ? new Uint8Array(readFileSync(path.join(ART_DIR, "semaphore-20.zkey"))) : null,
  };
  if (tamperZkey && files["/device/zk/semaphore-20.zkey"]) files["/device/zk/semaphore-20.zkey"][100_000] ^= 1;
  return {
    fetched,
    deps: {
      async fetchBytes(p) {
        fetched.push(p);
        return files[p] ?? null;
      },
      ...(vkeyText !== undefined ? { vkeyText: () => vkeyText } : {}),
    },
  };
}
const livePub = (members) => ({ mode: "live", claimKind: "tier-membership", tree: "tier-2", epoch: 11, merkleTreeRoot: new Group(members.map(BigInt)).root.toString(), scope: randomField(), message: randomField(), personaId: "p_unit", gateId: "foryou", challenge: "epoch-11" });
const liveJob = (members, extra = {}) => ({ id: 3, op: "live-prove", claimKind: "tier-membership", publicInputs: livePub(members), members, commitment: COMMIT, secret: ID.secretScalar.toString(), depth: 20, ...extra });
function needArtifacts() {
  if (!haveArtifacts) throw Object.assign(new Error("the pinned proving files are not in " + ART_DIR + " (this check proves for real; nothing downloads them)"), { infra: true });
}
await check("K1 fixture-prove in the worker core = the fixture core's answer (same nullifier, same tag); a job with no secret is refused", async () => {
  const members = [COMMIT, ...DECOYS];
  const pub = { ...livePub(members), mode: "fixture" };
  const a = await K.handleJob({ id: 1, op: "fixture-prove", claimKind: "tier-membership", publicInputs: pub, members, commitment: COMMIT, secret: ID.secretScalar.toString() });
  const d = F.core.fixtureProveCore("tier-membership", pub, members, COMMIT, ID.secretScalar);
  assert(a.ok && a.result.nullifier === d.nullifier && a.result.tag === d.tag && a.id === 1, "answer: " + JSON.stringify(a).slice(0, 200));
  const b = await K.handleJob({ id: 2, op: "fixture-prove", claimKind: "tier-membership", publicInputs: pub, members, commitment: COMMIT });
  assert(!b.ok && /no secret/.test(b.error), "a job with no secret: " + JSON.stringify(b));
});
let liveProof = null;
await check("K2 live-prove: a REAL Groth16 proof from the pinned files (fetched only from /device/zk/), single-threaded, self-verified — and the VALIDATOR's own verifyLiveProof accepts it; a tampered copy does not verify", async () => {
  needArtifacts();
  assert(typeof vz.verifyLiveProof === "function", "validator/zk.js exports no verifyLiveProof (the xout seam)");
  const members = [COMMIT, ...DECOYS];
  const { deps, fetched } = artifactDeps();
  const a = await K.handleJob(liveJob(members), deps);
  assert(a.ok, "live-prove refused: " + a.error);
  assert(fetched.every((p) => p.startsWith("/device/zk/")) && fetched.length === 3, "fetched: " + fetched.join(", "));
  const p = a.result.proof;
  liveProof = p;
  const ok = await vz.verifyLiveProof({ merkleTreeDepth: p.merkleTreeDepth, points: p.points }, p, p.nullifier);
  assert(ok === true, "the validator refused the worker's proof");
  const bad = await vz.verifyLiveProof({ merkleTreeDepth: p.merkleTreeDepth, points: p.points }, { ...p, message: randomField() }, p.nullifier);
  assert(bad === false, "the validator accepted a proof over another message");
  const v = await K.handleJob({ id: 4, op: "live-verify", proof: p }, deps);
  const v2 = await K.handleJob({ id: 5, op: "live-verify", proof: { ...p, nullifier: String(BigInt(p.nullifier) + BigInt(1)) } }, deps);
  assert(v.ok && v.result.valid === true && v2.ok && v2.result.valid === false, "live-verify: " + JSON.stringify([v.result, v2.result]));
  return `prove ${Math.round(a.timings.proveMs)} ms, verify ${Math.round(a.timings.verifyMs)} ms, ${a.timings.artifactBytes} bytes`;
});
async function tamperedZkeyScenario(M) {
  needArtifacts();
  const { deps } = artifactDeps({ tamperZkey: true });
  const a = await M.handleJob(liveJob([COMMIT, ...DECOYS]), deps);
  assert(!a.ok && /not the pinned one/.test(a.error), "a tampered zkey was not refused by its pin: " + JSON.stringify(a.error ?? a.ok));
}
await check("K3 a tampered zkey (one bit flipped, same length) is refused by its pin before proving", () => tamperedZkeyScenario(K));
await mutation("K3 / the sha256 and blake2b-512 pin checks removed", async () => tamperedZkeyScenario(await bundle(K_ENTRY, {}, { "lib/zk/prover/browser-worker.ts": [["  if ((await deps.sha256Hex(bytes)) !== pin.sha256)", "  if (false)"], ["  if (toHex(blake2b(bytes, { dkLen: 64 })) !== pin.blake2b512)", "  if (false)"]] })));
async function vkeyScenario(M) {
  const { deps, fetched } = artifactDeps({ vkeyText: VKEY_TEXT.replace('"protocol"', ' "protocol"') });
  const a = await M.handleJob(liveJob([COMMIT, ...DECOYS]), deps);
  assert(!a.ok && /NOT the build pin/.test(a.error), "a tampered bundled vkey: " + JSON.stringify(a.error ?? a.ok));
  assert(fetched.length === 0, "the proving files were fetched before the key was checked: " + fetched.join(", "));
  const { deps: d2 } = artifactDeps({ vkeyText: null });
  const b = await M.handleJob({ id: 9, op: "live-verify", proof: liveProof ?? { merkleTreeDepth: 20, merkleTreeRoot: "1", nullifier: "1", message: "1", scope: "1", points: Array(8).fill("1") } }, d2);
  assert(!b.ok && /carries no verification key/.test(b.error), "a bundle with no key verified: " + JSON.stringify(b));
}
await check("K4 a bundled verification key that is not the pin is refused before ANY file is fetched; a bundle with no key verifies nothing", () => vkeyScenario(K));
await mutation("K4 / the vkey pin comparison removed", async () => vkeyScenario(await bundle(K_ENTRY, {}, { "lib/zk/prover/browser-worker.ts": [["if (bytes.length !== VKEY_PIN.bytes || sha !== VKEY_PIN.sha256) throw", "if (false) throw"]] })));
await check("K5 no proving files on this site: an absent manifest or present:false is the plain refusal, and neither the wasm nor the zkey is asked for", async () => {
  for (const manifest of [null, { present: false }]) {
    const { deps, fetched } = artifactDeps({ manifest });
    const a = await K.handleJob(liveJob([COMMIT, ...DECOYS]), deps);
    assert(!a.ok && a.error === K.ARTIFACTS_ABSENT, "manifest " + JSON.stringify(manifest) + ": " + JSON.stringify(a.error));
    assert(fetched.length === 1 && fetched[0] === "/device/zk/manifest.json", "fetched: " + fetched.join(", "));
  }
});
async function originScenario(M) {
  const origin = "http://localhost:3001";
  assert(M.sameOriginZkUrl("/device/zk/semaphore-20.wasm", origin) === origin + "/device/zk/semaphore-20.wasm", "the own path was refused");
  for (const bad of ["https://cdn.example/device/zk/semaphore-20.wasm", "//cdn.example/device/zk/x", "/device/prover.js", "/device/zk/x?y=1", "/api/zk"]) {
    let t = false;
    try {
      M.sameOriginZkUrl(bad, origin);
    } catch {
      t = true;
    }
    assert(t, "fetchable: " + bad);
  }
  let t = false;
  try {
    M.sameOriginZkUrl("/device/zk/x", null);
  } catch {
    t = true;
  }
  assert(t, "fetchable with no origin");
}
await check("K6 the worker fetches its own site's /device/zk/ files only — another origin, another path, a query, or no origin at all is refused", () => originScenario(K));
await mutation("K6 / the same-origin comparison removed", async () => originScenario(await bundle(K_ENTRY, {}, { "lib/zk/prover/browser-worker.ts": [["if (u.origin !== origin || !u.pathname", "if (!u.pathname"]] })));

// PERSONA LAUNCH P7 (L1): a fetch stand-in that serves a path → bytes map (by pathname, so a same-origin absolute URL
// matches too) and records every call
function serveFetch(files = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const key = /^https?:/.test(u) ? new URL(u).pathname : u;
    const b = files[key];
    if (b === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
  return calls;
}
function realArtifactFiles(manifest = { present: true }) {
  return {
    "/device/zk/manifest.json": te.encode(JSON.stringify(manifest)),
    "/device/zk/semaphore-20.wasm": new Uint8Array(readFileSync(path.join(ART_DIR, "semaphore-20.wasm"))),
    "/device/zk/semaphore-20.zkey": new Uint8Array(readFileSync(path.join(ART_DIR, "semaphore-20.zkey"))),
  };
}
/** L1: the INSTALLED worker answers from the files its job carries, never the network — even with an origin and a fetch
 *  that would serve every file */
async function workerNoRequestScenario(KM) {
  const calls = serveFetch({ "/device/zk/manifest.json": te.encode('{"present":true}'), ...(haveArtifacts ? realArtifactFiles() : {}) });
  globalThis.location = { origin: "http://localhost:3001" };
  try {
    const a = await KM.answerWorkerMessage(liveJob([COMMIT, ...DECOYS]));
    assert(!a.ok && a.error === KM.ARTIFACTS_ABSENT, "a live job carrying no files: " + JSON.stringify(a.error ?? a.ok));
    const b = await KM.answerWorkerMessage({ id: 6, op: "artifacts", files: { "/device/zk/manifest.json": te.encode('{"present":false}') } });
    assert(!b.ok && b.error === KM.ARTIFACTS_ABSENT, "a job carrying an absent manifest: " + JSON.stringify(b.error ?? b.ok));
    assert(calls.length === 0, "the worker asked the network: " + calls.join(", "));
    if (haveArtifacts) {
      const c = await KM.answerWorkerMessage({ id: 7, op: "artifacts", files: realArtifactFiles() });
      assert(c.ok && c.result.bytes > 5_000_000 && c.pins?.zkeySha256, "the carried files were not pin-checked and used: " + JSON.stringify(c.error ?? c.result));
      assert(calls.length === 0, "the worker asked the network with the files in hand: " + calls.join(", "));
    }
  } finally {
    delete globalThis.location;
    globalThis.fetch = realFetch;
  }
}
await check("K7 (L1) the installed worker (answerWorkerMessage) proves only from the files its job carries — a job without them is the plain 'not on this site' refusal and the worker makes NO request, even where a fetch would serve every file; carried files are pin-checked and used", () => workerNoRequestScenario(K));
await mutation("K7 / the installed worker given the network deps again (the lazy fetch)", async () => workerNoRequestScenario(await bundle(K_ENTRY, {}, { "lib/zk/prover/browser-worker.ts": [["  return handleJob(data, inMemoryDeps(data));", "  return handleJob(data);"]] })));

// ================================================================================================ H — the bridge
console.log("\nH — the bridge (lib/zk/transport/browser.ts)");
const H_MOCKS = {
  ...SERVER_ONLY,
  "lib/zk/identity": `export function zkCommitment() { return globalThis.__BH.commitment; } export function zkSecretScalarForProver() { return globalThis.__BH.secret; }`,
};
const H_ENTRY = `export * from "@/lib/zk/transport/browser";`;
/** a Worker stand-in that runs the REAL installed-worker path (K.answerWorkerMessage: the job's own files, never the
 *  network) on the job it is posted, asynchronously. L1: a worker started from anything but a blob: URL is a request
 *  for its script (and, /public being max-age=0, a revalidation) — counted as a network load */
function installFakeWorker({ answer = null, never = false } = {}) {
  const log = (globalThis.__FW = { created: [], posted: [], terminated: 0, networkLoads: 0 });
  globalThis.Worker = class {
    constructor(url, opts) {
      log.created.push({ url: String(url), opts });
      if (!String(url).startsWith("blob:")) log.networkLoads++;
      this.onmessage = null;
      this.onerror = null;
    }
    postMessage(job) {
      log.posted.push(job);
      if (never) return;
      setTimeout(async () => {
        const a = answer ? answer(job) : await K.answerWorkerMessage(job);
        this.onmessage?.({ data: a });
      }, 0);
    }
    terminate() {
      log.terminated++;
    }
  };
  return log;
}
/** the prover's bytes as the site serves them, for the boot-time load (the fake worker never runs them) */
const PROVER_BYTES = te.encode("export {};\n");
const freshPreload = () => {
  delete globalThis.__layersBrowserPreload;
};
async function bridgeScenario(M) {
  globalThis.__BH = { commitment: COMMIT, secret: ID.secretScalar };
  const members = [COMMIT, ...DECOYS];
  const pub = { ...livePub(members), mode: "fixture" };
  // L1: the boot-time load first (every tab), then the job makes no request
  freshPreload();
  const fetched = serveFetch({ "/device/prover.js": PROVER_BYTES });
  try {
    await M.preloadProverNow("fixture");
    assert(fetched.length === 1 && fetched[0] === "/device/prover.js", "the boot load: " + fetched.join(", "));
    fetched.length = 0;
    await bridgeJobs(M, members, pub);
    assert(fetched.length === 0, "a job made a request: " + fetched.join(", "));
  } finally {
    globalThis.fetch = realFetch;
  }
}
async function bridgeJobs(M, members, pub) {
  // one job, a fresh module worker from the boot-loaded blob: URL, terminated after its answer; the secret only in the job
  const log = installFakeWorker();
  const env = await M.browserTransport("fixture").prove("tier-membership", pub, { members });
  assert(log.created.length === 1 && log.created[0].url.startsWith("blob:") && log.created[0].opts?.type === "module", "worker: " + JSON.stringify(log.created));
  assert(log.networkLoads === 0, "the worker was started from the network");
  assert(log.terminated === 1, "the worker was not terminated after its answer");
  assert(log.posted[0].op === "fixture-prove" && log.posted[0].secret === ID.secretScalar.toString(10), "the job: " + JSON.stringify(log.posted[0]).slice(0, 120));
  const d = F.core.fixtureProveCore("tier-membership", pub, members, COMMIT, ID.secretScalar);
  assert(env.nullifier === d.nullifier && env.proof.tag === d.tag && (await M.browserTransport("fixture").verify("tier-membership", env)).ok, "the envelope from the worker");
  const entry = M.proverLog().pop();
  assert(entry.op === "fixture-prove" && entry.ok === true && typeof entry.where === "string" && entry.where.length > 0, "the job log: " + JSON.stringify(entry));
  assert(!JSON.stringify(M.proverLog()).includes(ID.secretScalar.toString(10)), "the job log holds the secret");
  // a non-member is refused before any worker exists
  installFakeWorker();
  let t = "";
  try {
    await M.browserTransport("fixture").prove("tier-membership", pub, { members: DECOYS });
  } catch (e) {
    t = e.message;
  }
  assert(/not a member/.test(t) && globalThis.__FW.created.length === 0, "a non-member: " + t);
  // NO WORKER: a refusal, never the page's own thread
  delete globalThis.Worker;
  t = "";
  try {
    await M.browserTransport("fixture").prove("tier-membership", pub, { members });
  } catch (e) {
    t = e.message;
  }
  assert(t === M.NO_WORKER, "no Worker: " + (t || "PROVED ON THE PAGE'S OWN THREAD"));
  // a worker that never answers is stopped at its timeout
  const slow = installFakeWorker({ never: true });
  t = "";
  try {
    await M.runProverJob({ op: "bench" }, 40);
  } catch (e) {
    t = e.message;
  }
  assert(/took longer/.test(t) && slow.terminated === 1, "timeout: " + t + " terminated " + slow.terminated);
  // an answer for another job is refused
  installFakeWorker({ answer: (job) => ({ id: job.id + 1, ok: true, op: job.op, where: "x", result: { nullifier: "1", tag: "2" }, timings: { totalMs: 1 } }) });
  t = "";
  try {
    await M.browserTransport("fixture").prove("tier-membership", pub, { members });
  } catch (e) {
    t = e.message;
  }
  assert(/different job/.test(t), "a wrong-job answer: " + t);
  delete globalThis.Worker;
}
const H = await bundle(H_ENTRY, H_MOCKS);
await check("H1 a fixture proof is made in ONE fresh module worker started from the boot-loaded prover (a blob: URL — no request at job time), terminated after it answers, logged with where it ran; a non-member is refused before a worker exists; NO Worker is a plain refusal (never the page's own thread); a silent worker is stopped at its timeout; an answer for another job is refused", () => bridgeScenario(H));
await mutation("H1 / a main-thread fallback when there is no Worker", async () =>
  bridgeScenario(
    await bundle(H_ENTRY, H_MOCKS, {
      "lib/zk/transport/browser.ts": [
        [
          '  if (typeof W !== "function") {\n    record({ ok: false, where: null, error: NO_WORKER });\n    return Promise.reject(new Error(NO_WORKER));\n  }',
          '  if (typeof W !== "function") {\n    const { fixtureProveCore } = await_core();\n    return Promise.resolve({ id: jobId, ok: true, op: job.op, where: "page", result: fixtureProveCore(job.claimKind as never, job.publicInputs as never, job.members as never, job.commitment as never, BigInt(job.secret as string)) });\n  }',
        ],
        ['import { fixturePrecheck, fixtureVerifyCore, NOT_A_MEMBER } from "./fixtureCore";', 'import { fixturePrecheck, fixtureVerifyCore, NOT_A_MEMBER, fixtureProveCore } from "./fixtureCore";\nconst await_core = () => ({ fixtureProveCore });'],
      ],
    })
  )
);
await check("H2 live through the bridge: a real proof made by the worker core, the nullifier cross-checked on the device (Poseidon(hash(scope), secret)), then verified in a second worker job; the validator accepts the envelope's proof", async () => {
  needArtifacts();
  globalThis.__BH = { commitment: COMMIT, secret: ID.secretScalar };
  // L1: the live boot load (prover + the three proving files), then the jobs carry the files and request nothing
  freshPreload();
  const fetched = serveFetch({ "/device/prover.js": PROVER_BYTES, ...realArtifactFiles() });
  try {
    await H.preloadProverNow("live");
    assert(fetched.length === 4, "the live boot load: " + fetched.join(", "));
    fetched.length = 0;
    const log = installFakeWorker();
    const members = [COMMIT, ...DECOYS];
    const pub = livePub(members);
    const t = H.browserTransport("live");
    const env = await t.prove("tier-membership", pub, { members });
    const v = await t.verify("tier-membership", env);
    assert(v.ok, "verify: " + JSON.stringify(v));
    const tampered = await t.verify("tier-membership", { ...env, nullifier: String(BigInt(env.nullifier) + BigInt(1)) });
    assert(!tampered.ok, "a tampered envelope verified");
    const ok = await vz.verifyLiveProof({ merkleTreeDepth: env.proof.merkleTreeDepth, points: env.proof.points }, env.publicInputs, env.nullifier);
    assert(ok === true, "the validator refused the bridge's proof");
    assert(H.lastVerifiedPins()?.wasmSha256 && H.lastVerifiedPins()?.zkeySha256 && H.lastVerifiedPins()?.vkeySha256, "the verified pins were not kept (the label's condition 5 reads them): " + JSON.stringify(H.lastVerifiedPins()));
    assert(H.lastProve()?.op === "live-prove", "the last proof was not recorded");
    // L1: a real proof and two verifies, and not one request; L2: the prove time is in the tab's memory, not on the envelope
    assert(fetched.length === 0 && log.networkLoads === 0, "the live jobs made a request: " + JSON.stringify({ fetched, loads: log.networkLoads }));
    assert(!("provingMs" in env) && typeof H.lastProve()?.provingMs === "number", "provingMs: on the envelope " + ("provingMs" in env) + ", in memory " + H.lastProve()?.provingMs);
  } finally {
    delete globalThis.Worker;
    globalThis.fetch = realFetch;
    freshPreload();
  }
  return "worker jobs: " + H.proverLog().map((e) => e.op + (e.ok ? "" : "✗")).slice(-3).join(", ");
});

// ================================================================ H3 / H4 — L1 (no request at job time) and L2 (no timing on the envelope)
/** L1: every tab loads the prover at boot; a job before that load is refused, never loaded lazily; after it, no job makes
 *  a request; live jobs carry the boot-loaded files; a build without proving files is asked once */
async function preloadScenario(M) {
  globalThis.__BH = { commitment: COMMIT, secret: ID.secretScalar };
  const members = [COMMIT, ...DECOYS];
  const pub = { ...livePub(members), mode: "fixture" };
  try {
    // (a) before any load: a plain, retryable refusal — no worker, no request
    freshPreload();
    let fetched = serveFetch({ "/device/prover.js": PROVER_BYTES });
    let log = installFakeWorker();
    let t = "";
    try {
      await M.browserTransport("fixture").prove("tier-membership", pub, { members });
    } catch (e) {
      t = e.message;
    }
    assert(t === M.PROVER_NOT_LOADED, "a proof before the prover loaded: " + (t || "PROVED"));
    assert(log.created.length === 0 && log.networkLoads === 0 && fetched.length === 0, "a proof before the load made a worker or a request: " + JSON.stringify({ created: log.created, fetched }));
    // (b) the boot-time load in the test universe: the prover only, once; a pass with nothing missing asks nothing
    await M.preloadProverNow("fixture");
    assert(fetched.length === 1 && fetched[0] === M.PROVER_URL, "the fixture boot load: " + fetched.join(", "));
    await M.preloadProverNow("fixture");
    assert(fetched.length === 1, "a second pass with nothing missing made a request: " + fetched.join(", "));
    assert(M.preloadStatus().proverReady === true && M.preloadStatus().prover?.bytes === PROVER_BYTES.length, "the load status: " + JSON.stringify(M.preloadStatus()));
    // (c) jobs after it: zero requests, every worker from the same blob: URL
    fetched.length = 0;
    log = installFakeWorker();
    await M.browserTransport("fixture").prove("tier-membership", pub, { members });
    await M.runProverJob({ op: "bench", rounds: 1 }, 10_000);
    assert(log.created.length === 2 && log.created.every((c) => c.url.startsWith("blob:")) && new Set(log.created.map((c) => c.url)).size === 1, "workers: " + JSON.stringify(log.created));
    assert(log.networkLoads === 0 && fetched.length === 0, "a job made a request: " + JSON.stringify({ loads: log.networkLoads, fetched }));
    // (d) live, before the files are loaded: a files job is refused — no worker, no request
    log = installFakeWorker();
    t = "";
    try {
      await M.runProverJob({ op: "artifacts" }, 10_000);
    } catch (e) {
      t = e.message;
    }
    assert(t === M.FILES_NOT_LOADED && log.created.length === 0 && fetched.length === 0, "a files job before the files loaded: " + (t || "RAN"));
    if (haveArtifacts) {
      // the live boot load: manifest, wasm, zkey — once each — then nothing; the job carries them and asks nothing
      const files = realArtifactFiles();
      fetched = serveFetch({ "/device/prover.js": PROVER_BYTES, ...files });
      await M.preloadProverNow("live");
      assert(JSON.stringify(fetched) === JSON.stringify(M.ZK_FILE_PATHS), "the live boot load: " + fetched.join(", "));
      await M.preloadProverNow("live");
      assert(fetched.length === 3, "a second live pass made a request: " + fetched.join(", "));
      fetched.length = 0;
      log = installFakeWorker();
      const a = await M.runProverJob({ op: "artifacts" }, 120_000);
      assert(a.ok && a.result?.bytes === files["/device/zk/semaphore-20.wasm"].length + files["/device/zk/semaphore-20.zkey"].length, "the artifacts job: " + JSON.stringify(a.result));
      assert(fetched.length === 0 && log.networkLoads === 0, "the artifacts job made a request: " + JSON.stringify({ fetched, loads: log.networkLoads }));
      assert(log.posted[0].files && Object.keys(log.posted[0].files).length === 3, "the job did not carry the boot-loaded files");
    }
    // (e) a build that shipped no proving files: the manifest is asked once, the job carries it, the worker answers its
    // plain refusal, and no later pass asks again
    freshPreload();
    fetched = serveFetch({ "/device/prover.js": PROVER_BYTES, "/device/zk/manifest.json": te.encode('{"present":false}') });
    await M.preloadProverNow("live");
    assert(fetched.join(",") === "/device/prover.js,/device/zk/manifest.json", "the absent-build boot load: " + fetched.join(", "));
    fetched.length = 0;
    log = installFakeWorker();
    t = "";
    try {
      await M.runProverJob({ op: "artifacts" }, 10_000);
    } catch (e) {
      t = e.message;
    }
    assert(t === K.ARTIFACTS_ABSENT && fetched.length === 0 && log.networkLoads === 0, "an absent build: " + JSON.stringify({ t, fetched, loads: log.networkLoads }));
    await M.preloadProverNow("live");
    assert(fetched.length === 0, "an absent build was asked again: " + fetched.join(", "));
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.Worker;
    freshPreload();
  }
}
await check("H3 (L1) the prover is loaded at BOOT, never at job time: a job before the load is refused plainly (no worker, no request); the boot load asks /device/prover.js once (and, live, the manifest, wasm and zkey once each); every later job — fixture, bench, artifacts — starts from the same blob: URL and makes ZERO requests, live jobs carrying the boot-loaded files; a build without proving files is asked once", () => preloadScenario(H));
await mutation("H3 / the worker started from /device/prover.js again (the lazy load)", async () => preloadScenario(await bundle(H_ENTRY, H_MOCKS, { "lib/zk/transport/browser.ts": [['      worker = new W(url, { type: "module", name: "layers-prover" });', '      worker = new W(PROVER_URL, { type: "module", name: "layers-prover" });']] })));
await mutation("H3 / a job loads the prover itself when the boot load has not landed", async () =>
  preloadScenario(
    await bundle(H_ENTRY, H_MOCKS, {
      "lib/zk/transport/browser.ts": [
        ["  if (url === null) {\n    record({ ok: false, where: null, error: PROVER_NOT_LOADED });", "  if (false) {\n    record({ ok: false, where: null, error: PROVER_NOT_LOADED });"],
        ['      worker = new W(url, { type: "module", name: "layers-prover" });', '      worker = new W(url ?? PROVER_URL, { type: "module", name: "layers-prover" });'],
      ],
    })
  )
);
await mutation("H3 / a live job runs before its files are loaded", async () => preloadScenario(await bundle(H_ENTRY, H_MOCKS, { "lib/zk/transport/browser.ts": [["    if (files === null) {", "    if (false) {"]] })));

/** L2: a live envelope from the browser bridge carries no prover timing; the tab keeps it in memory */
async function l2BridgeScenario(M) {
  globalThis.__BH = { commitment: COMMIT, secret: ID.secretScalar };
  const members = [COMMIT, ...DECOYS];
  const pub = livePub(members);
  freshPreload();
  serveFetch({ "/device/prover.js": PROVER_BYTES, "/device/zk/manifest.json": te.encode('{"present":false}') });
  try {
    await M.preloadProverNow("live");
    installFakeWorker({
      answer: (job) => ({
        id: job.id,
        ok: true,
        op: job.op,
        where: "DedicatedWorkerGlobalScope",
        result: { proof: { merkleTreeDepth: 20, merkleTreeRoot: job.publicInputs.merkleTreeRoot, nullifier: F.nullifierFor(BigInt(job.publicInputs.scope), ID.secretScalar).toString(10), message: job.publicInputs.message, scope: job.publicInputs.scope, points: Array(8).fill("1") } },
        timings: { proveMs: 4321, totalMs: 5000 },
        pins: null,
      }),
    });
    const env = await M.browserTransport("live").prove("tier-membership", pub, { members });
    assert(!("provingMs" in env), "the envelope carries provingMs: " + env.provingMs);
    const extra = Object.keys(env).filter((k) => !["v", "mode", "claimKind", "publicInputs", "nullifier", "proof"].includes(k));
    assert(extra.length === 0, "the envelope carries fields beyond its own: " + extra.join(","));
    assert(M.lastProve()?.provingMs === 4321, "the prove time was not kept in the tab's memory: " + JSON.stringify(M.lastProve()));
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.Worker;
    freshPreload();
  }
}
await check("H4 (L2) a live envelope from the browser bridge carries only its own fields — no provingMs; the worker's prove time is kept in the tab's memory (lastProve) for Settings and the live-z scripts", () => l2BridgeScenario(H));
await mutation("H4 / provingMs hung on the envelope again", async () =>
  l2BridgeScenario(await bundle(H_ENTRY, H_MOCKS, { "lib/zk/transport/browser.ts": [["      // L2: the prove time stays in this tab's memory (lastProve) — never a field on the envelope that leaves it\n", "      (envelope as ProofEnvelope & { provingMs?: number }).provingMs = a.timings?.proveMs;\n"]] }))
);

// ================================================================================================ O — real HPKE round trip
console.log("\nO — a real round trip: the web channel (direct and OHTTP) to validator/anon.js");
const { createApp } = require(path.join(ROOT, "validator", "server.js"));
const { startRelay } = await import(pathToFileURL(path.join(ROOT, "scripts", "lib-ohttp-relay.mjs")).href);
const created = createApp(":memory:");
const vserver = await new Promise((resolve) => {
  const s = created.app.listen(0, "127.0.0.1", () => resolve(s));
});
const VAL = "http://127.0.0.1:" + vserver.address().port;
const relay = await startRelay({ gateway: VAL });
const fieldOfV = (domain, canonical) => vz.fieldOf(domain, canonical);
let nulSeq = 880000;
async function freshV(mode = "fixture") {
  const ep = (await (await realFetch(VAL + "/zk/epoch?mode=fixture")).json()).epoch;
  const members = await (await realFetch(VAL + "/zk/members?mode=fixture&tree=valid")).json();
  const personaId = "p_web_o";
  const challenge = "epoch-" + ep;
  const scope = fieldOfV("scope", `layers/zk-scope/v1|discovery-tier|${ep}|${personaId}`);
  const message = fieldOfV("message", [personaId, "foryou", challenge, members.root].join("|"));
  const nullifier = String(nulSeq++);
  const pub = { mode, claimKind: "tier-membership", tree: "valid", epoch: ep, merkleTreeRoot: members.root, scope, message, personaId, gateId: "foryou", challenge };
  return { v: 1, mode, claimKind: "tier-membership", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: vz.fixtureTag(vz.canonicalPublicInputs(pub), nullifier) } };
}
process.env.VALIDATOR_URL = VAL;
const O = await bundle(`export * as relay from "@/lib/zk/anon/relay"; export * as submit from "@/lib/zk/anon/submit";`, { ...SERVER_ONLY, "lib/zk/anon/client": R_MOCKS["lib/zk/anon/client"].replace("export async function isolatedRequest(url, o) {", "export async function isolatedRequest(url, o) { throw new Error('the node socket was used in a browser'); ") });
try {
  await check("O1 the browser's DIRECT web channel against the real validator: accepted, then replay (node's fetch adds its own user-agent / accept-language / sec-fetch-mode — all tolerated by the web route)", async () => {
    await asBrowser(async () => {
      O.relay.setRelayOverride(null);
      const env = await freshV();
      const a = await O.submit.submitAnonymous(env);
      const b = await O.submit.submitAnonymous(env);
      assert(a.outcome === "accepted" && a.channel === "web" && b.outcome === "replay", JSON.stringify([a, b]));
    });
  });
  await check("O2 the browser's OHTTP adapter: HPKE in the 'tab', the key configuration fetched THROUGH the relay, ciphertext to the relay, the gateway (validator/anon.js) decapsulates the strict inner request — accepted, then replay; the relay forwarded both; the head over OHTTP too", async () => {
    await asBrowser(async () => {
      O.relay.setRelayOverride({ kind: "ohttp", url: relay.url, thirdParty: false });
      const f0 = relay.stats.forwarded;
      const k0 = relay.stats.keyFetches;
      const env = await freshV();
      const a = await O.submit.submitAnonymous(env);
      const b = await O.submit.submitAnonymous(env);
      assert(a.outcome === "accepted" && b.outcome === "replay" && a.relay === "ohttp", JSON.stringify([a, b]));
      assert(relay.stats.forwarded - f0 === 2 && relay.stats.keyFetches - k0 === 2, "relay stats: " + JSON.stringify(relay.stats));
      const head = await O.relay.anonymousHead("fixture", "valid");
      assert(head.mode === "fixture" && head.tree === "valid" && /^[0-9a-f]{64}$/.test(head.hash), "head: " + JSON.stringify(head));
      O.relay.setRelayOverride(null);
    });
  });
} finally {
  await relay.close();
  vserver.close();
}

// ================================================================================================ A — the validator's web route guards
console.log("\nA — validator/anon.js's web route guards (mutated in memory)");
const Module = require("node:module");
const ANON_PATH = path.join(ROOT, "validator", "anon.js");
const ANON_SRC = readFileSync(ANON_PATH, "utf8").replace(/\r\n/g, "\n");
function compileAnon(edits = []) {
  let src = ANON_SRC;
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error("patch anchor not found in validator/anon.js: " + from.slice(0, 90));
    src = src.split(from).join(to);
  }
  const file = path.join(ROOT, "validator", "anon.mutant-" + ++bundleSeq + ".js");
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  return m.exports;
}
const BROWSER_HEADERS = { "content-type": "text/plain;charset=UTF-8", accept: "*/*", "accept-encoding": "gzip", "accept-language": "en", "cache-control": "no-cache", connection: "keep-alive", dnt: "1", origin: "http://localhost:3001", pragma: "no-cache", priority: "u=1, i", "sec-ch-ua": '"Chromium";v="140"', "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"', "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "cross-site", "sec-gpc": "1", "user-agent": "Mozilla/5.0" };
function headerPolicyScenario(A) {
  delete process.env.TRUST_PROXY;
  for (const h of Object.keys(BROWSER_HEADERS)) assert(A.webHeaderAllowed(h), "a browser header refused: " + h);
  for (const h of ["cookie", "authorization", "proxy-authorization", "referer", "x-layers-device", "x-layers-whatever", "x-unknown", "x-forwarded-for", "via", "forwarded", "x-railway-edge", "x-railway-request-id"]) assert(!A.webHeaderAllowed(h), "tolerated without TRUST_PROXY: " + h);
  process.env.TRUST_PROXY = "true";
  try {
    for (const h of ["x-forwarded-for", "x-forwarded-proto", "x-real-ip", "forwarded", "via", "x-request-id", "x-request-start"]) assert(A.webHeaderAllowed(h), "a hop header refused behind a declared proxy: " + h);
    // PERSONA LAUNCH GO-LIVE (A-WEB-PROXY-HOP-HEADERS): every header Railway's edge documents (the fixture), and no cf-*
    const railway = JSON.parse(readFileSync(path.join(ROOT, "validator", "test", "fixtures", "railway-hop-headers.json"), "utf8"));
    for (const h of [...Object.keys(railway.documented), ...Object.keys(railway.observed_not_documented).filter((k) => !k.startsWith("_"))]) assert(A.webHeaderAllowed(h), "a header Railway's edge adds refused behind a declared proxy: " + h);
    for (const h of ["cf-connecting-ip", "cf-ray", "x-envoy-external-address"]) assert(!A.webHeaderAllowed(h), "an undocumented edge header tolerated: " + h);
    for (const h of ["cookie", "authorization", "referer", "x-layers-device"]) assert(!A.webHeaderAllowed(h), "tolerated behind a proxy: " + h);
    // PUBLIC GO-LIVE: the one x-railway-* name a CLIENT sends (it asks the edge for debug headers) — the hop prefix covers its
    // spelling, the refused set keeps it out
    assert(!A.webHeaderAllowed("x-railway-debug") && !A.webHeaderAllowed("X-Railway-Debug"), "a client's x-railway-debug tolerated behind a proxy");
  } finally {
    delete process.env.TRUST_PROXY;
  }
}
await check("A1 the web header policy: every browser-forced header tolerated; cookie / authorization / proxy-authorization / referer / x-layers-* / unknown refused; proxy hop headers only behind TRUST_PROXY=true, and the person-naming ones never", () => headerPolicyScenario(vanon));
await mutation("A1 / TRUST_PROXY no longer asked", async () => headerPolicyScenario(compileAnon([["if (trustProxy() && (WEB_PROXY_HEADERS", "if (true && (WEB_PROXY_HEADERS"]])));
await mutation("A1 (GO-LIVE) / the x-railway- prefix dropped", async () => headerPolicyScenario(compileAnon([['const WEB_PROXY_PREFIXES = ["x-forwarded-", "x-railway-"];', 'const WEB_PROXY_PREFIXES = ["x-forwarded-"];']])));
await mutation("A1 (GO-LIVE) / x-railway-debug no longer refused (the hop prefix lets a client's debug header in)", async () => headerPolicyScenario(compileAnon([['"referer", "x-railway-debug"]);', '"referer"]);']])));
function refusedSetScenario(A) {
  // the refused set holds ON ITS OWN: with every other header allowed (a careless widening), these still refuse
  for (const h of ["cookie", "authorization", "proxy-authorization", "referer", "x-layers-device"]) assert(!A.webHeaderAllowed(h), "the refused set did not hold: " + h);
}
await check("A2 the refused set holds on its own: with the allowlist widened to everything, cookie / authorization / proxy-authorization / referer / x-layers-* still refuse", () => refusedSetScenario(compileAnon([["  if (ALLOWED_HEADERS.has(k) || WEB_BROWSER_HEADERS.has(k)", "  if (true || WEB_BROWSER_HEADERS.has(k)"]])));
await mutation("A2 / the refused set removed (allowlist widened)", async () => refusedSetScenario(compileAnon([["  if (ALLOWED_HEADERS.has(k) || WEB_BROWSER_HEADERS.has(k)", "  if (true || WEB_BROWSER_HEADERS.has(k)"], ['  if (WEB_REFUSED_HEADERS.has(k) || k.startsWith("x-layers-")) return false;\n', ""]])));
// the route itself, over HTTP, on a mutable copy: size, PoW from the query, the universe gate (the zk module's spy decides
// a marked live envelope is valid, so only the gate can refuse it)
const express = require("express");
const { openDb } = require(path.join(ROOT, "validator", "db.js"));
const realVerify = vz.verifyAndRecord;
const verifiedModes = [];
vz.verifyAndRecord = async (db, env) => {
  verifiedModes.push(env && env.mode);
  if (env && env.__unitAccept === true) return { status: 200, json: { ok: true } };
  return realVerify(db, env);
};
// the "original" for the route scenarios is a FRESH compile of the unmodified file, made after the spy is in place (anon.js
// binds verifyAndRecord when it loads), so a door that let a request through would reach the spy and be seen
const ANON_NOW = () => compileAnon([]);
async function routeServer(A) {
  const app = express();
  const db = openDb(":memory:");
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });
  A.mountAnon(app, db);
  const s = await new Promise((resolve) => {
    const x = app.listen(0, "127.0.0.1", () => resolve(x));
  });
  return { base: "http://127.0.0.1:" + s.address().port, close: () => s.close() };
}
const { request: httpRequest } = require("node:http");
function rawPost(base, p, body, headers) {
  const u = new URL(base + p);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", agent: false, headers: { ...headers, "content-length": String(body.length) } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")).outcome));
    });
    req.on("error", reject);
    req.end(body);
  });
}
function solve(body, bits = 8) {
  for (let i = 0; ; i++) if (vanon.powValid(body, i.toString(36), bits)) return i.toString(36);
}
function pad(envelope, size = 4096) {
  const bare = Buffer.byteLength(JSON.stringify({ envelope, p: "" }));
  return Buffer.from(JSON.stringify({ envelope, p: "x".repeat(Math.max(0, size - bare)) }));
}
async function routeScenario(A, which) {
  const srv = await routeServer(A);
  try {
    // an envelope the spy accepts (a marked live one) isolates each door from the proof check
    const live = { ...fixtureEnvelope("live"), __unitAccept: true };
    const fixtureMarked = { ...fixtureEnvelope("fixture"), __unitAccept: true };
    if (which === "size") {
      const small = pad(live, 4000);
      const outcome = await rawPost(srv.base, "/zk/anon/web?pow=" + solve(small), small, BROWSER_HEADERS);
      assert(outcome === "malformed", "a 4000-byte body: " + outcome);
    }
    if (which === "pow") {
      const body = pad(fixtureMarked);
      const outcome = await rawPost(srv.base, "/zk/anon/web", body, { ...BROWSER_HEADERS, "x-zk-pow": solve(body) });
      assert(outcome === "refused", "a header nonce was taken: " + outcome);
    }
    if (which === "universe") {
      const before = verifiedModes.length;
      const body = pad(live);
      const outcome = await rawPost(srv.base, "/zk/anon/web?pow=" + solve(body), body, BROWSER_HEADERS);
      assert(outcome === "refused" && !verifiedModes.slice(before).includes("live"), "a live envelope: " + outcome + " (verified: " + verifiedModes.slice(before).join(",") + ")");
    }
    if (which === "headers") {
      const body = pad(fixtureMarked);
      const control = await rawPost(srv.base, "/zk/anon/web?pow=" + solve(body), body, BROWSER_HEADERS);
      assert(control === "accepted", "the control (no cookie) was not accepted: " + control);
      const body2 = pad({ ...fixtureMarked, nullifier: "5" });
      const outcome = await rawPost(srv.base, "/zk/anon/web?pow=" + solve(body2), body2, { ...BROWSER_HEADERS, cookie: "a=b" });
      assert(outcome === "refused", "a cookie: " + outcome);
    }
  } finally {
    srv.close();
  }
}
await check("A3 the route refuses a body that is not 4096 bytes ('malformed', constant shape)", () => routeScenario(ANON_NOW(), "size"));
await mutation("A3 / the size door removed", async () => routeScenario(compileAnon([["else if (bodyBytes.length !== WEB_BODY_BYTES) outcome = \"malformed\";", ""]]), "size"));
await check("A4 the route reads the PoW from the QUERY only (a header nonce is no nonce)", () => routeScenario(ANON_NOW(), "pow"));
await mutation("A4 / the PoW read from the header too", async () => routeScenario(compileAnon([['const pow = typeof req.query.pow === "string" ? req.query.pow : "";', 'const pow = typeof req.query.pow === "string" ? req.query.pow : String(req.headers["x-zk-pow"] || "");']]), "pow"));
await check("A5 the route refuses a live-universe envelope BEFORE verification (the spy that would accept it is never called)", () => routeScenario(ANON_NOW(), "universe"));
await mutation("A5 / the universe gate removed", async () => routeScenario(compileAnon([["else if (!webEnvelopeUniverseOk(bodyBytes)) outcome = \"refused\";", ""]]), "universe"));
// PUBLIC GO-LIVE (verify, the relay track's door in validator/anon.js webEnvelopeUniverseOk): with the PUBLIC relay ready (the
// agent path armed), a live envelope from a browser passes the universe gate and reaches verification; an envelope whose two
// modes disagree never does; unarmed, A5 above keeps every live envelope refused. The armed env is set only around the request.
const ARMED_PUBLIC_RELAY = { FC_ANON_FID: "812345", FC_ANON_SIGNER_UUID: "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d", FC_ANON_NEYNAR_KEY: "anonstub-unit-prover-0001", ZK_ANON_RELAY_LIVE: "on", ZK_ANON_POST_LIVE_CAP: "5" };
// (withEnvAsync is the helper declared further down, hoisted: sets the names, restores them after)
async function armedDoorScenario(A) {
  const srv = await routeServer(A);
  try {
    const live = { ...fixtureEnvelope("live"), __unitAccept: true };
    const before = verifiedModes.length;
    const body = pad(live);
    const outcome = await withEnvAsync(ARMED_PUBLIC_RELAY, () => rawPost(srv.base, "/zk/anon/web?pow=" + solve(body), body, BROWSER_HEADERS));
    assert(outcome !== "refused" && verifiedModes.slice(before).includes("live"), "with the public relay ready a live envelope was " + outcome + " (verified: " + verifiedModes.slice(before).join(",") + ")");
    const mixed = { ...live, nullifier: "6", publicInputs: { ...live.publicInputs, mode: "fixture" } };
    const before2 = verifiedModes.length;
    const body2 = pad(mixed);
    const outcome2 = await withEnvAsync(ARMED_PUBLIC_RELAY, () => rawPost(srv.base, "/zk/anon/web?pow=" + solve(body2), body2, BROWSER_HEADERS));
    assert(outcome2 === "refused" && verifiedModes.length === before2, "an envelope whose modes disagree: " + outcome2 + " (verified: " + verifiedModes.slice(before2).join(",") + ")");
  } finally {
    srv.close();
  }
}
await check("A5b with the PUBLIC @anon relay ready (the agent path armed) a live envelope from a browser passes the universe gate to verification; one whose envelope and public inputs name different universes is refused before it", () => armedDoorScenario(ANON_NOW()));
await mutation("A5b / the live door never opens", async () => armedDoorScenario(compileAnon([['return env.mode === "live" && require("./anonpublic").liveWebDoorOpen();', "return false;"]])));
await mutation("A5b / the two modes no longer compared", async () => armedDoorScenario(compileAnon([["if (!env || !env.publicInputs || env.mode !== env.publicInputs.mode) return false;", "if (!env || !env.publicInputs) return false;"]])));
await mutation("A5 / the live door open while the relay is unarmed", async () => routeScenario(compileAnon([['return env.mode === "live" && require("./anonpublic").liveWebDoorOpen();', 'return env.mode === "live";']]), "universe"));
// PUBLIC GO-LIVE (ASM-2B): the TEST universe's proof is a public hash, so at the door of an ARMED public relay or a LIVE product
// (PUBLIC_LIVE on a public deployment; a misspelt value counts as live: the public validator never runs seed.js, which is what
// refuses one) a test envelope is refused BEFORE verification — the spy that would accept it is never called. On the rig (where
// PUBLIC_LIVE is ignored) and the unarmed public preview it passes the door as before. Each env is set only around its request.
const RELAY_UNARMED = { FC_ANON_FID: undefined, FC_ANON_SIGNER_UUID: undefined, FC_ANON_NEYNAR_KEY: undefined, ZK_ANON_RELAY_LIVE: undefined, ZK_ANON_POST_LIVE_CAP: undefined, NEYNAR_API_KEY: undefined, NEYNAR_SIGNER_UUID: undefined };
const ON_PUBLIC_SHAPE = { NODE_ENV: "production", ZK_DEV_HOOKS: undefined };
async function fixtureDoorScenario(A) {
  const srv = await routeServer(A);
  let seq = 900;
  const send = async (vars) => {
    const env = { ...fixtureEnvelope("fixture"), nullifier: String(seq++), __unitAccept: true };
    const before = verifiedModes.length;
    const body = pad(env);
    const outcome = await withEnvAsync(vars, () => rawPost(srv.base, "/zk/anon/web?pow=" + solve(body), body, BROWSER_HEADERS));
    return { outcome, verified: verifiedModes.slice(before).includes("fixture") };
  };
  try {
    const cases = [
      ["the rig, relay unarmed (control)", { ...RELAY_UNARMED, PUBLIC_LIVE: undefined }, true],
      ["the rig with PUBLIC_LIVE=true (ignored on a rig-shaped process)", { ...RELAY_UNARMED, PUBLIC_LIVE: "true" }, true],
      ["the unarmed public preview (PUBLIC_LIVE=false)", { ...RELAY_UNARMED, ...ON_PUBLIC_SHAPE, PUBLIC_LIVE: "false" }, true],
      ["the unarmed public preview (PUBLIC_LIVE unset)", { ...RELAY_UNARMED, ...ON_PUBLIC_SHAPE, PUBLIC_LIVE: undefined }, true],
      ["an ARMED public relay", { ...ARMED_PUBLIC_RELAY, NEYNAR_API_KEY: undefined, NEYNAR_SIGNER_UUID: undefined, PUBLIC_LIVE: undefined }, false],
      ["a LIVE product (PUBLIC_LIVE=true on a public deployment)", { ...RELAY_UNARMED, ...ON_PUBLIC_SHAPE, PUBLIC_LIVE: "true" }, false],
      ["a misspelt PUBLIC_LIVE (yes) on a public deployment", { ...RELAY_UNARMED, ...ON_PUBLIC_SHAPE, PUBLIC_LIVE: "yes" }, false],
    ];
    for (const [label, vars, passes] of cases) {
      const r = await send(vars);
      if (passes) assert(r.outcome === "accepted" && r.verified, label + ": a test envelope did not pass the door (" + r.outcome + ", verified " + r.verified + ")");
      else assert(r.outcome === "refused" && !r.verified, label + ": a forged test envelope was " + r.outcome + (r.verified ? " and reached verification" : ""));
    }
    return cases.length + " doors";
  } finally {
    srv.close();
  }
}
await check("A5c the TEST universe is refused at the door, before verification, of an ARMED public relay and of a LIVE product (a misspelt PUBLIC_LIVE counts as live); the rig and the unarmed preview pass it as before", () => fixtureDoorScenario(ANON_NOW()));
const ASM2B_RULE = 'if (env.mode === "fixture") return !(require("./anonpublic").liveWebDoorOpen() || publicLiveValidator());';
await mutation("A5c / the test universe passes unconditionally (the old `return true`)", async () => fixtureDoorScenario(compileAnon([[ASM2B_RULE, 'if (env.mode === "fixture") return true;']])));
await mutation("A5c / the armed relay no longer closes the test door", async () => fixtureDoorScenario(compileAnon([[ASM2B_RULE, 'if (env.mode === "fixture") return !publicLiveValidator();']])));
await mutation("A5c / PUBLIC_LIVE no longer closes the test door", async () => fixtureDoorScenario(compileAnon([[ASM2B_RULE, 'if (env.mode === "fixture") return !require("./anonpublic").liveWebDoorOpen();']])));
await mutation("A5c / a misspelt PUBLIC_LIVE leaves the test door open (seed.js's exact reading)", async () => fixtureDoorScenario(compileAnon([['return !(v === undefined || v === "" || v === "false");', 'return v === "true";']])));
await mutation("A5c / PUBLIC_LIVE honoured on a rig-shaped process (the rig would lose its test universe)", async () => fixtureDoorScenario(compileAnon([['  if (!require("./env-contract").isPublicDeployment(env)) return false;\n', ""]])));
await check("A6 the route refuses a cookie even on an envelope verification would accept (the same request without it is accepted)", () => routeScenario(ANON_NOW(), "headers"));
await mutation("A6 / the web header door removed", async () => routeScenario(compileAnon([["if (!hasOnlyWebAllowedHeaders(req.headers)) outcome = \"refused\";\n      else if", "if (false) outcome = \"refused\";\n      else if"]]), "headers"));
vz.verifyAndRecord = realVerify;

// ================================================================================================ P — PoW parity
console.log("\nP — proof of work, both sides");
await check("P1 lib/zk/anon/pow.ts solves what validator/anon.js powValid accepts, and both refuse another body's nonce (no Buffer on the client side)", async () => {
  const PW = await bundle(`export * from "@/lib/zk/anon/pow";`, {});
  for (let i = 0; i < 5; i++) {
    const body = globalThis.crypto.getRandomValues(new Uint8Array(4096));
    const other = globalThis.crypto.getRandomValues(new Uint8Array(4096));
    const { nonce } = PW.solvePow(body, 10);
    assert(vanon.powValid(Buffer.from(body), nonce, 10) && PW.powValid(body, nonce, 10), "the nonce does not verify on both sides");
    // bound to the body: both sides give the SAME verdict on another body (almost always "no"; parity is the deterministic claim)
    assert(vanon.powValid(Buffer.from(other), nonce, 10) === PW.powValid(other, nonce, 10), "the two sides disagree about another body");
    assert(!PW.powValid(body, nonce + "!", 10) && !vanon.powValid(Buffer.from(body), nonce + "!", 10), "a malformed nonce passed");
    const vn = solve(Buffer.from(body), 10);
    assert(PW.powValid(body, vn, 10), "the client refuses the validator's own solution");
  }
  const code = readFileSync(path.join(ROOT, "lib", "zk", "anon", "pow.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert(!/\bBuffer\b/.test(code) && !/node:crypto|platform\/crypto/.test(code), "pow.ts still depends on Buffer or node crypto");
});

// ================================================================================================ E — the device environment
console.log("\nE — the device environment's anonymous-posting hints");
await check("E1 anonRelayHints: the switch forwarded only as on/off (anything else 'invalid' = off in the tab); an OHTTP relay URL forwarded only when https with no userinfo, query or fragment (otherwise ohttp with NO url: the tab refuses); tor named; direct sends nothing", async () => {
  const DE = await bundle(`export { anonRelayHints, deviceEnv } from "@/lib/device/deviceEnv.server";`, {
    ...SERVER_ONLY,
    "lib/fc/readRelay.server": `export function relayArmed() { return false; }`,
    "lib/fc/siwf/flow": `export function siwfDeviceHints() { return {}; }`,
  });
  const h = DE.anonRelayHints;
  const eq = (a, b, what) => assert(JSON.stringify(a) === JSON.stringify(b), what + ": " + JSON.stringify(a));
  eq(h({}), {}, "nothing set");
  eq(h({ ZK_ANON_POST: "OFF" }), { ZK_ANON_POST: "off" }, "off");
  eq(h({ ZK_ANON_POST: "on" }), { ZK_ANON_POST: "on" }, "on");
  eq(h({ ZK_ANON_POST: "maybe" }), { ZK_ANON_POST: "invalid" }, "garbage");
  eq(h({ ZK_RELAY: "ohttp", ZK_RELAY_URL: "https://relay.example/ohttp", ZK_RELAY_THIRD_PARTY: "true" }), { ZK_RELAY: "ohttp", ZK_RELAY_URL: "https://relay.example/ohttp", ZK_RELAY_THIRD_PARTY: "true" }, "a good relay");
  for (const bad of ["http://relay.example/ohttp", "https://u:p@relay.example/", "https://relay.example/?key=secret", "https://relay.example/#x", "not a url"]) eq(h({ ZK_RELAY: "ohttp", ZK_RELAY_URL: bad }), { ZK_RELAY: "ohttp" }, "refused URL " + bad);
  eq(h({ ZK_RELAY: "tor" }), { ZK_RELAY: "tor" }, "tor");
  eq(h({ ZK_RELAY: "direct", ZK_RELAY_URL: "https://x.example" }), {}, "direct");
  const env = await withEnv({ ZK_ANON_POST: "off", ZK_RELAY: undefined, ZK_RELAY_URL: undefined }, async () => DE.deviceEnv());
  assert(env.ZK_ANON_POST === "off", "deviceEnv() does not carry the switch: " + JSON.stringify(env).slice(0, 200));
  // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the plain anonymous tree — forwarded as a well-formed name only, "invalid"
  // otherwise (the tab reads it as off), nothing when unset (the tab's default is the validator's default)
  eq(h({ ZK_ANON_POST_TREE: "valid" }), { ZK_ANON_POST_TREE: "valid" }, "the public tree");
  eq(h({ ZK_ANON_POST_TREE: " tier-3 " }), { ZK_ANON_POST_TREE: "tier-3" }, "a tier tree (trimmed)");
  eq(h({ ZK_ANON_POST_TREE: "attest:fc.reach/gte-1k" }), { ZK_ANON_POST_TREE: "attest:fc.reach/gte-1k" }, "an attestation tree");
  for (const bad of ["tier-0", "Valid", "valid; drop", "https://x.example/?k=1", "attest:BAD/x"]) eq(h({ ZK_ANON_POST_TREE: bad }), { ZK_ANON_POST_TREE: "invalid" }, "a garbled tree " + bad);
  eq(h({ ZK_ANON_POST_TREE: "" }), {}, "a blank tree");
  const env2 = await withEnv({ ZK_ANON_POST: undefined, ZK_RELAY: undefined, ZK_RELAY_URL: undefined, ZK_ANON_POST_TREE: "valid", ZK_ANON_FLOOR: "1" }, async () => DE.deviceEnv());
  assert(env2.ZK_ANON_POST_TREE === "valid", "deviceEnv() does not carry the tree: " + JSON.stringify(env2).slice(0, 300));
  assert(!("ZK_ANON_FLOOR" in env2), "deviceEnv() forwarded the crowd floor (no server variable may lower a visitor's floor)");
});
await mutation("E1 / the tree forwarded unchecked", async () => {
  const DE = await bundle(`export { anonRelayHints } from "@/lib/device/deviceEnv.server";`, { ...SERVER_ONLY, "lib/fc/readRelay.server": `export function relayArmed() { return false; }`, "lib/fc/siwf/flow": `export function siwfDeviceHints() { return {}; }` }, { "lib/device/deviceEnv.server.ts": [['out.ZK_ANON_POST_TREE = isPlainTreeName(tree) ? tree : "invalid";', "out.ZK_ANON_POST_TREE = tree;"]] });
  const got = DE.anonRelayHints({ ZK_ANON_POST_TREE: "valid; drop" });
  assert(got.ZK_ANON_POST_TREE === "invalid", "a garbled tree was forwarded as " + JSON.stringify(got.ZK_ANON_POST_TREE));
});

// PUBLIC GO-LIVE (D-PUBLIC-ANON-TREE) — E2: the FOURTH deliberate duplicate, the TAB's tree. V2/V3 pin lib/zk/config.ts,
// lib/zk/anon/availability.ts and validator/zk.js to one another; the browser device reads only what
// lib/device/deviceEnv.server.ts forwards (ZK_GATE_TIER is not forwarded), so its tree is plainAnonTreeName() over the
// forwarded hints alone. Under every environment: with ZK_ANON_POST_TREE set and well-formed (the public shape: "valid" on
// both services) the tab proves exactly the server's and the validator's tree; unset, the tab names the default tier-2,
// which agrees when the deployment's tier is 2. Whenever the two still differ (another tier with no tree set, or a value
// with surrounding spaces, which the tab trims and the validator does not), the tab is OFF deployment-wide in plain words
// (ANON_OFF_TREE_MISMATCH, judged against the validator's own anon config), never proving into a tree the validator
// refuses; a garbled name is off as unreadable. Each environment lands in exactly one of those cases, and all occur.
const DE_MOCKS = { ...SERVER_ONLY, "lib/fc/readRelay.server": `export function relayArmed() { return false; }`, "lib/fc/siwf/flow": `export function siwfDeviceHints() { return {}; }` };
const TAB_TREE_ENVS = [{}, { ZK_GATE_TIER: "5" }, { ZK_GATE_TIER: "0" }, { ZK_GATE_TIER: "99" }, { ZK_GATE_TIER: "2" }, { ZK_ANON_POST_TREE: "valid" }, { ZK_ANON_POST_TREE: "valid", ZK_GATE_TIER: "7" }, { ZK_ANON_POST_TREE: " tier-4 " }, { ZK_ANON_POST_TREE: "attest:fc.reach/gte-1k" }, { ZK_ANON_POST_TREE: "", ZK_GATE_TIER: "3" }, { ZK_ANON_POST_TREE: "Valid" }];
async function tabTreeScenario(DE) {
  const cases = { same: 0, mismatchSaid: 0, garbledOff: 0 };
  globalThis.__AVR = { rep: "mock", throws: false };
  for (const env of TAB_TREE_ENVS) {
    const server = withEnv({ ZK_GATE_TIER: undefined, ZK_ANON_POST_TREE: undefined, ...env }, () => vz.anonPostTree());
    const hints = DE.anonRelayHints({ ...env });
    // the tab's process.env holds the forwarded names only (the device env), never the server's ZK_GATE_TIER
    const tabEnv = { ZK_GATE_TIER: undefined, ZK_ANON_POST_TREE: hints.ZK_ANON_POST_TREE, NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_POST: undefined, ZK_ANON_FLOOR: undefined };
    const tab = withEnv(tabEnv, () => V.plainAnonTreeName());
    const set = String(env.ZK_ANON_POST_TREE ?? "").trim();
    if (set && !V.isPlainTreeName(set)) {
      // garbled: forwarded as "invalid", the tab is off as unreadable whatever the validator says
      const a = await asBrowser(() => withEnv(tabEnv, () => V.anonPostingAvailability({ mode: "fixture" })));
      assert(hints.ZK_ANON_POST_TREE === "invalid" && a.on !== true && a.code === "unreadable" && a.reason === V.ANON_OFF_UNREADABLE, `env ${JSON.stringify(env)}: a garbled tree in the tab: ${JSON.stringify({ hints, a })}`);
      cases.garbledOff++;
      continue;
    }
    // what reaches the tab: the set name exactly (trimmed), or nothing, and then the tab's own default tier-2
    assert(tab === (set || "tier-2"), `env ${JSON.stringify(env)}: the tab proves ${tab}, expected ${set || "tier-2"}`);
    if (tab === server) {
      cases.same++;
      continue;
    }
    // the tab and the validator disagree (an unset tree at a tier other than 2, or a name the validator reads with its
    // surrounding spaces): the tab must refuse, deployment-wide, said — never prove into a tree the validator refuses
    const commitment = "4242";
    const snap = { mode: "fixture", tree: tab, members: { members: [...CROWD60, commitment] }, epoch: { epoch: 100, epochMs: 6 * 3_600_000, msRemaining: 3_600_000 }, fetchedAt: Date.now(), anonConfig: { tree: server } };
    const a = await asBrowser(() => withEnv(tabEnv, () => V.anonPostingAvailability({ mode: "fixture", snap, commitment })));
    assert(a.on !== true && a.scope === "deployment" && a.code === "mismatch" && a.reason === V.ANON_OFF_TREE_MISMATCH, `env ${JSON.stringify(env)}: the tab (${JSON.stringify(tab)}) and the validator (${JSON.stringify(server)}) disagree, and the tab answered ${JSON.stringify(a)}`);
    cases.mismatchSaid++;
  }
  assert(cases.same >= 1 && cases.mismatchSaid >= 1 && cases.garbledOff >= 1, "not every case was exercised: " + JSON.stringify(cases));
  return `${TAB_TREE_ENVS.length} environments: ${cases.same} agree, ${cases.mismatchSaid} off as a mismatch, ${cases.garbledOff} off as unreadable`;
}
await check("E2 (GO-LIVE, D-PUBLIC-ANON-TREE) the TAB's tree under every environment: a set, well-formed ZK_ANON_POST_TREE (the public 'valid') reaches the tab exactly and equals the server's and the validator's; unset, the tab's default tier-2 agrees at tier 2; any remaining disagreement is OFF as a said mismatch (never a proof into a refused tree); a garbled name is off as unreadable", async () => tabTreeScenario(await bundle(`export { anonRelayHints } from "@/lib/device/deviceEnv.server";`, DE_MOCKS)));
await mutation("E2 / the tree no longer forwarded to the tab", async () => tabTreeScenario(await bundle(`export { anonRelayHints } from "@/lib/device/deviceEnv.server";`, DE_MOCKS, { "lib/device/deviceEnv.server.ts": [["  if (tree) out.ZK_ANON_POST_TREE = ", "  if (false) out.ZK_ANON_POST_TREE = "]] })));
await mutation("E2 / the forwarded tree rewritten (a tier tree sent as valid)", async () => tabTreeScenario(await bundle(`export { anonRelayHints } from "@/lib/device/deviceEnv.server";`, DE_MOCKS, { "lib/device/deviceEnv.server.ts": [['out.ZK_ANON_POST_TREE = isPlainTreeName(tree) ? tree : "invalid";', 'out.ZK_ANON_POST_TREE = isPlainTreeName(tree) ? "valid" : "invalid";']] })));

// ================================================================================================ B — the build budget
console.log("\nB — the build budget and the snarkjs markers");
const BD = await import(pathToFileURL(path.join(ROOT, "scripts", "build-device.mjs")).href);
await check("B1 budgetViolations: a pass at the budgets; device.js over 5,242,880 B, any snarkjs/ffjavascript marker in device.js, prover.js over 1,572,864 B, or an unreadable size each fail", async () => {
  assert(BD.DEVICE_BUDGET_BYTES === 5_242_880 && BD.PROVER_BUDGET_BYTES === 1_572_864, "the budgets moved");
  assert(BD.budgetViolations({ deviceBytes: 5_242_880, deviceText: "clean", proverBytes: 1_572_864 }).length === 0, "the budgets themselves fail");
  assert(BD.budgetViolations({ deviceBytes: 5_242_881, deviceText: "clean", proverBytes: 1 }).length === 1, "device over budget passed");
  assert(BD.budgetViolations({ deviceBytes: 1, deviceText: "clean", proverBytes: 1_572_865 }).length === 1, "prover over budget passed");
  for (const m of BD.SNARK_MARKERS) assert(BD.budgetViolations({ deviceBytes: 1, deviceText: "x" + m + "x", proverBytes: 1 }).length === 1, "marker not caught: " + m);
  assert(BD.budgetViolations({ deviceBytes: NaN, deviceText: undefined, proverBytes: NaN }).length === 3, "unknown sizes passed");
});
await check("B2 a REAL prover bundle (the build's own options: browser, esm, minified) carries the snarkjs/ffjavascript literal markers — so the device.js check would catch snarkjs — and fits its budget", async () => {
  const r = await build({ absWorkingDir: ROOT, entryPoints: [path.join(ROOT, "lib", "zk", "prover", "browser-worker.ts")], bundle: true, write: false, format: "esm", platform: "browser", target: ["es2022"], minify: true, legalComments: "none", tsconfig: path.join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"', __LAYERS_PINNED_VKEY_TEXT__: JSON.stringify(VKEY_TEXT) }, logLevel: "error" });
  const text = r.outputFiles[0].text;
  const present = BD.SNARK_MARKERS.filter((m) => text.includes(m));
  assert(present.length >= 3, "too few markers present in a prover bundle: " + present.join(", "));
  assert(BD.budgetViolations({ deviceBytes: 1, deviceText: text, proverBytes: 1 }).length >= 1, "snarkjs in device.js would pass");
  const bytes = Buffer.byteLength(text);
  assert(bytes <= BD.PROVER_BUDGET_BYTES, "the prover bundle is over budget: " + bytes);
  return `${bytes} bytes; markers present: ${present.map((m) => JSON.stringify(m)).join(", ")}`;
});

// PUBLIC GO-LIVE (verify, the relay track's build switches): REQUIRE_ZK_ARTIFACTS / ZK_ARTIFACT_FETCH in scripts/build-device.mjs.
// The two functions are compiled from the build script's OWN text (so a mutation patches exactly what ships), with the
// node imports they use prepended; fetchMissingArtifacts takes an injected fetch, so nothing here touches a network.
const BD_SRC = readFileSync(path.join(ROOT, "scripts", "build-device.mjs"), "utf8").replace(/\r\n/g, "\n");
async function compileZkSwitches(edits = []) {
  let src = BD_SRC;
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error("patch anchor not found in scripts/build-device.mjs: " + from.slice(0, 60));
    src = src.split(from).join(to);
  }
  const a = src.indexOf("export const ZK_FILES_BUDGET_BYTES");
  const b = src.indexOf("/** literals only snarkjs", a);
  if (a < 0 || b < 0) throw new Error("patch anchor not found in scripts/build-device.mjs: ZK_FILES_BUDGET_BYTES … SNARK_MARKERS");
  const mod = [
    'import { createHash } from "node:crypto";',
    'import { existsSync, mkdirSync, writeFileSync } from "node:fs";',
    'import path from "node:path";',
    'const sha256 = (b) => createHash("sha256").update(b).digest("hex");',
    'const blake2b512 = (b) => createHash("blake2b512").update(b).digest("hex");',
    src.slice(a, b),
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(mod).toString("base64"));
}
const { createHash: zkHash } = await import("node:crypto");
const zkPin = (file, buf) => ({ file, bytes: buf.length, sha256: zkHash("sha256").update(buf).digest("hex"), blake2b512: zkHash("blake2b512").update(buf).digest("hex") });
function zkRulesScenario(Z) {
  assert(Z.ZK_FILES_BUDGET_BYTES === 6_291_456, "the proving files' budget moved: " + Z.ZK_FILES_BUDGET_BYTES);
  assert(Z.zkArtifactViolations({ required: true, present: false, reason: "x is not in y", bytes: 0 }).length === 1, "REQUIRE_ZK_ARTIFACTS=1 with no files passed");
  assert(Z.zkArtifactViolations({ required: false, present: false, reason: "absent", bytes: 0 }).length === 0, "a build that does not require the files failed without them");
  assert(Z.zkArtifactViolations({ required: true, present: true, bytes: 5_738_124 }).length === 0, "the real depth-20 pair (5,738,124 bytes) failed its budget");
  assert(Z.zkArtifactViolations({ required: true, present: true, bytes: 6_291_457 }).length === 1, "proving files over the budget passed");
  assert(Z.zkArtifactViolations({ required: false, present: true, bytes: NaN }).length === 1, "an unknown size passed");
}
async function zkFetchScenario(Z) {
  const dir = path.join(HERE, "zkfetch-" + ++bundleSeq);
  const good = { wasm: Buffer.from("wasm-bytes-0123456789"), zkey: Buffer.from("zkey-bytes-9876543210") };
  const pins = { PINNED_DEPTH: 20, SEMAPHORE_ARTIFACT_BASE: "https://pins.invalid/semaphore/", ARTIFACT_PINS: { 20: { wasm: zkPin("semaphore-20.wasm", good.wasm), zkey: zkPin("semaphore-20.zkey", good.zkey) } } };
  const asked = [];
  const fakeFetch = (serve) => async (url) => {
    asked.push(url);
    const name = url.slice(url.lastIndexOf("/") + 1);
    const body = serve[name];
    if (body === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
  // 1. both missing, the host serves the pinned bytes: both written, both noted as checked, each URL the pinned base + the file
  let notes = await Z.fetchMissingArtifacts(pins, dir, fakeFetch({ "semaphore-20.wasm": good.wasm, "semaphore-20.zkey": good.zkey }));
  assert(existsSync(path.join(dir, "semaphore-20.wasm")) && existsSync(path.join(dir, "semaphore-20.zkey")), "pinned bytes were not kept: " + notes.join(" | "));
  assert(notes.length === 2 && notes.every((n) => /pins checked/.test(n)), "the notes do not say the pins were checked: " + notes.join(" | "));
  assert(asked.length === 2 && asked.every((u) => u.startsWith(pins.SEMAPHORE_ARTIFACT_BASE)), "a fetch went somewhere else: " + asked.join(", "));
  // 2. present files are never fetched again
  asked.length = 0;
  notes = await Z.fetchMissingArtifacts(pins, dir, fakeFetch({}));
  assert(asked.length === 0 && notes.length === 0, "a file already present was fetched again");
  // 3. off-pin bytes (one byte flipped) are discarded and never written; a 404 is noted and nothing written
  const dir2 = path.join(HERE, "zkfetch-" + ++bundleSeq);
  const bad = Buffer.from(good.wasm);
  bad[0] ^= 1;
  notes = await Z.fetchMissingArtifacts(pins, dir2, fakeFetch({ "semaphore-20.wasm": bad }));
  assert(!existsSync(path.join(dir2, "semaphore-20.wasm")), "OFF-PIN bytes were written to the artifact folder");
  assert(!existsSync(path.join(dir2, "semaphore-20.zkey")), "a 404 wrote a file");
  assert(notes.some((n) => /do not match the pins/.test(n)) && notes.some((n) => /answered 404/.test(n)), "the discard / the 404 is not said: " + notes.join(" | "));
}
function zkWiringViolations(src) {
  const out = [];
  const fetchAt = src.indexOf('if (process.env.ZK_ARTIFACT_FETCH === "1") for (const n of await fetchMissingArtifacts(pins, artifactDir))');
  const stageAt = src.indexOf("const staged = stageArtifacts(pins, { artifactDir, outDir: ZK_OUT });");
  if (fetchAt < 0) out.push("main() does not fetch only under ZK_ARTIFACT_FETCH=1");
  if (stageAt < 0 || (fetchAt >= 0 && fetchAt > stageAt)) out.push("the fetch does not run before the staging");
  if (!src.includes('required: process.env.REQUIRE_ZK_ARTIFACTS === "1"')) out.push("REQUIRE_ZK_ARTIFACTS=1 is not what makes the files required");
  if (!src.includes("if (v.length || zv.length) {") || !src.includes("for (const line of [...v, ...zv])")) out.push("a proving-files violation does not fail the build");
  return out;
}
await check("B3 REQUIRE_ZK_ARTIFACTS: a build that requires the pinned proving files fails without them, over their 6 MiB budget, or with an unknown size; the real depth-20 pair fits; a build that does not require them passes without them; and main() fails the build on any of these", async () => {
  zkRulesScenario(await compileZkSwitches());
  const v = zkWiringViolations(BD_SRC);
  assert(v.length === 0, v.join(" | "));
});
await mutation("B3 / the required check dropped", async () => zkRulesScenario(await compileZkSwitches([["if (required && !present) out.push(", "if (false) out.push("]])));
await mutation("B3 / the 6 MiB budget dropped", async () => zkRulesScenario(await compileZkSwitches([["else if (present && bytes > ZK_FILES_BUDGET_BYTES) out.push(", "else if (false) out.push("]])));
await mutation("B3 / main() no longer fails on a proving-files violation", async () => {
  const bad = BD_SRC.split("if (v.length || zv.length) {").join("if (v.length) {");
  if (bad === BD_SRC) throw new Error("patch anchor not found in scripts/build-device.mjs: if (v.length || zv.length) {");
  const v = zkWiringViolations(bad);
  assert(v.length === 0, v.join(" | "));
});
await check("B4 ZK_ARTIFACT_FETCH: a missing pinned file is fetched from the pinned host only, kept only when its bytes, sha256 and blake2b-512 equal the pins, never re-fetched when present; off-pin bytes and a 404 write nothing and are said (an injected fetch, no network)", async () => {
  await zkFetchScenario(await compileZkSwitches());
});
await mutation("B4 / the pin check of fetched bytes dropped", async () => zkFetchScenario(await compileZkSwitches([["if (b.length !== pin.bytes || sha256(b) !== pin.sha256 || blake2b512(b) !== pin.blake2b512) {", "if (false) {"]])));
await mutation("B4 / a present file fetched again", async () => zkFetchScenario(await compileZkSwitches([["    if (existsSync(file)) continue;\n", ""]])));

// PUBLIC GO-LIVE (verify, A-WEB-PROXY-HOP-HEADERS): no rate limiter keys on the CLIENT-WRITTEN left-most X-Forwarded-For
// entry any more — a source scan over validator/*.js, middleware.ts and app/api/**, proven able to hit on the old line.
const LEFTMOST_XFF = /forwarded-for[^;\n]{0,120}?split\(\s*["'],\s*["']\s*\)\s*(\?\.)?\[\s*0\s*\]/i;
function leftmostXffHits(files) {
  const hits = [];
  for (const [rel, text] of files) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (LEFTMOST_XFF.test(line)) hits.push(rel + ":" + (i + 1));
    });
  }
  return hits;
}
function sourcesForXffScan() {
  const { readdirSync, statSync } = require("node:fs");
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push([path.relative(ROOT, p).replace(/\\/g, "/"), readFileSync(p, "utf8")]);
    }
  };
  for (const name of readdirSync(path.join(ROOT, "validator"))) if (/\.js$/.test(name)) out.push(["validator/" + name, readFileSync(path.join(ROOT, "validator", name), "utf8")]);
  out.push(["middleware.ts", readFileSync(path.join(ROOT, "middleware.ts"), "utf8")]);
  walk(path.join(ROOT, "app", "api"));
  return out;
}
await check("G10 no limiter keys on the client-written left-most X-Forwarded-For entry (validator/*.js, middleware.ts, app/api/**); the custody offers and the ring drop ask validator/caps.js edgeClientAddress; the scan hits the old custody line (not vacuous)", () => {
  const files = sourcesForXffScan();
  assert(files.length > 40 && files.some(([r]) => r === "validator/custody.js") && files.some(([r]) => r === "app/api/fc/read/route.ts"), "the scan did not read the files it names (" + files.length + ")");
  const hits = leftmostXffHits(files);
  assert(hits.length === 0, "left-most X-Forwarded-For keying at " + hits.join(", "));
  const old = 'const clientAddress = (req) => (process.env.TRUST_PROXY === "true" && (req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "local";';
  const oldTs = '      ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim()';
  assert(leftmostXffHits([["doctored.js", old], ["doctored.ts", oldTs]]).length === 2, "the scan is blind to the old left-most lines");
  const custody = readFileSync(path.join(ROOT, "validator", "custody.js"), "utf8");
  const ringdrop = readFileSync(path.join(ROOT, "validator", "ringdrop.js"), "utf8");
  assert(/const clientAddress = \(req\) => require\("\.\/caps"\)\.edgeClientAddress\(req, process\.env\.TRUST_PROXY === "true"\);/.test(custody), "validator/custody.js does not key with edgeClientAddress");
  assert(/const addressOf = \(req\) => require\("\.\/caps"\)\.edgeClientAddress\(req, trustProxy\);/.test(ringdrop), "validator/ringdrop.js does not key with edgeClientAddress");
  return files.length + " files scanned, 0 left-most keys";
});
await mutation("G10 / custody.js keys on the left-most entry again", async () => {
  const files = sourcesForXffScan().map(([r, t]) => (r === "validator/custody.js" ? [r, t.replace(/const clientAddress = \(req\) => require\("\.\/caps"\)\.edgeClientAddress\(req, process\.env\.TRUST_PROXY === "true"\);/, 'const clientAddress = (req) => (process.env.TRUST_PROXY === "true" && (req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "local";')] : [r, t]));
  if (files.find(([r]) => r === "validator/custody.js")[1].includes("edgeClientAddress(req, process.env")) throw new Error("patch anchor not found in validator/custody.js: edgeClientAddress");
  const hits = leftmostXffHits(files);
  assert(hits.length === 0, "left-most X-Forwarded-For keying at " + hits.join(", "));
});

// ================================================================================================ G — the GPL-3.0 source offer
// PERSONA LAUNCH GO-LIVE (A-GPL-SOURCE-OFFER, owner decision J): prover.js's corresponding source is served beside it at
// /device/source/, generated on every build from the committed files (scripts/lib/gpl-source.mjs, driven by
// scripts/build-device.mjs stageSourceOffer). Each guard below is proven by a broken copy that must fail.
console.log("\nG — the GPL-3.0 source offer (scripts/lib/gpl-source.mjs, scripts/build-device.mjs stageSourceOffer)");
const GS = await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "gpl-source.mjs")).href);
// a REAL prover build with a metafile (nothing written): the inputs the offer must serve
// PUBLIC GO-LIVE: the build's OWN options (scripts/build-device.mjs proverOptions), so the offer's inputs cannot drift from the
// real build's (an inject or alias added there shows up here)
const GPL_BUILD = await build({ ...BD.proverOptions(VKEY_TEXT, ""), outfile: path.join(HERE, "g-prover", "prover.js"), write: false, metafile: true, logLevel: "error" });
const GPL_INPUTS = GS.layersInputsOf(GPL_BUILD.metafile);
// what the deployed smoke check pins (scripts/smoke-deployed.mjs EXPECT_OFFER_FILES) — the two must name the same files
const SMOKE_SRC = readFileSync(path.join(ROOT, "scripts", "smoke-deployed.mjs"), "utf8");
const SMOKE_FILES = JSON.parse(/const EXPECT_OFFER_FILES = (\[[^\]]*\]);/.exec(SMOKE_SRC)?.[1] ?? "null");
let gplSeq = 0;
const offerDir = () => path.join(HERE, "g-offer-" + ++gplSeq);
/** a fetchBytes over a WRITTEN offer folder, as the deployment's static server answers it (the folder's own address is
 *  its notice page, a missing file is 404) — scripts/smoke-deployed.mjs check 11 runs the same function over HTTP */
const folderFetch = (dir, overrides = {}) => async (u) => {
  if (Object.prototype.hasOwnProperty.call(overrides, u)) return overrides[u];
  if (!u.startsWith(GS.OFFER_URL)) return { status: 404, bytes: Buffer.alloc(0) };
  const rel = u === GS.OFFER_URL ? "index.html" : u.slice(GS.OFFER_URL.length);
  const f = path.join(dir, ...rel.split("/"));
  return existsSync(f) ? { status: 200, bytes: readFileSync(f) } : { status: 404, bytes: Buffer.alloc(0) };
};
await check("G1 the offer serves EXACTLY the prover's Totem inputs (read from a real build's metafile: the five files), each byte-equal to its committed source with its sha256; the build files; snarkjs and ffjavascript at the versions the banner names with tagged upstream links; the GPL text; and the deployed smoke check pins the same five", async () => {
  assert(JSON.stringify(GPL_INPUTS) === JSON.stringify(["lib/zk/ceremonyPins.ts", "lib/zk/hash.ts", "lib/zk/prover/browser-worker.ts", "lib/zk/transport/fixtureCore.ts", "lib/zk/transport/types.ts"]), "the prover's Totem inputs: " + JSON.stringify(GPL_INPUTS));
  assert(Array.isArray(SMOKE_FILES) && JSON.stringify([...SMOKE_FILES].sort()) === JSON.stringify(GPL_INPUTS), "scripts/smoke-deployed.mjs EXPECT_OFFER_FILES is not the bundle's set: " + JSON.stringify(SMOKE_FILES));
  const dir = offerDir();
  const m = BD.stageSourceOffer({ outDir: dir, metafile: GPL_BUILD.metafile });
  assert(JSON.stringify(m.files.map((f) => f.path)) === JSON.stringify(GPL_INPUTS), "the manifest's files: " + JSON.stringify(m.files.map((f) => f.path)));
  for (const e of [...m.files, ...m.build]) {
    const served = readFileSync(path.join(dir, ...(e.path + ".txt").split("/")));
    const src = readFileSync(path.join(ROOT, ...e.path.split("/")));
    assert(served.equals(src), e.path + ": the served copy is not byte-equal to the committed source");
    assert(GS.sha256Hex(src) === e.sha256 && e.url === GS.OFFER_URL + e.path + ".txt", e.path + ": hash or address");
  }
  assert(JSON.stringify(m.build.map((f) => f.path)) === JSON.stringify([...GS.BUILD_FILES].sort()), "the build files: " + JSON.stringify(m.build.map((f) => f.path)));
  const ups = Object.fromEntries(m.upstream.map((u) => [u.name, u]));
  assert(ups.snarkjs?.version === BD.SNARKJS_VERSION && ups.ffjavascript?.version === BD.FFJS_VERSION, "the manifest's versions are not the banner's: " + JSON.stringify(m.upstream));
  assert(ups.snarkjs.source === "https://github.com/iden3/snarkjs/tree/v" + BD.SNARKJS_VERSION && ups.ffjavascript.source === "https://github.com/iden3/ffjavascript/tree/v" + BD.FFJS_VERSION, "the upstream links: " + JSON.stringify(m.upstream));
  assert(readFileSync(path.join(dir, "GPL-3.0.txt"), "utf8").includes("GNU GENERAL PUBLIC LICENSE"), "the GPL text");
  assert(typeof m.commit === "string" && m.commit.length > 0, "no commit");
  assert(GS.servedProblems({ outDir: dir, manifest: m, readSource: (r) => readFileSync(path.join(ROOT, ...r.split("/"))) }).length === 0, "the written offer has problems");
  return `${m.files.length} Totem files, ${m.build.length} build files, ${m.packages.length} bundled packages; snarkjs ${ups.snarkjs.version}, ffjavascript ${ups.ffjavascript.version}; commit ${m.commit.slice(0, 12)}`;
});
// G2 — every build-time guard, each by a broken input that must make stageSourceOffer THROW (the build then deletes prover.js)
const stage = (over = {}) => BD.stageSourceOffer({ outDir: offerDir(), metafile: GPL_BUILD.metafile, ...over });
const flipAfterWrite = Object.assign(() => {}, {
  afterWrite: (dir) => {
    const f = path.join(dir, "lib", "zk", "hash.ts.txt");
    const b = readFileSync(f);
    b[10] ^= 1;
    writeFileSync(f, b);
  },
});
await mutation("G2 / one byte of a served copy flipped (the written file is not the committed source)", async () => stage({ mutate: flipAfterWrite }));
await mutation("G2 / a path dropped from the offer (the bundle carries a file the offer does not serve)", async () => stage({ mutate: (offer) => offer.manifest.files.pop() }));
await mutation("G2 / the GPL-3.0 text (snarkjs's COPYING) missing", async () => stage({ gplPath: path.join(HERE, "no-such-COPYING") }));
await mutation("G2 / the banner names a snarkjs version the bundle does not carry", async () => stage({ snarkjsVersion: "0.0.1" }));
await mutation("G2 / a sha256 doctored in the manifest", async () => stage({ mutate: (offer) => { offer.manifest.files[0].sha256 = "0".repeat(64); } }));
await mutation("G2 / a metafile input the offer cannot serve (a new kind of virtual input)", async () => stage({ metafile: { ...GPL_BUILD.metafile, inputs: { ...GPL_BUILD.metafile.inputs, "<virtual>:x": { bytes: 1, imports: [] } } } }));
await check("G2 the control: the same staging, unbroken, passes (so each red above is its guard's)", async () => {
  const m = stage();
  return m.files.length + " files";
});
await check("G3 offerProblems: a sixth Totem input the offer does not serve, an offered file the bundle does not carry, a missing build file, a non-tagged upstream link, and a missing commit are each named; the real offer has none", async () => {
  const dir = offerDir();
  const m = BD.stageSourceOffer({ outDir: dir, metafile: GPL_BUILD.metafile });
  assert(GS.offerProblems(m, GPL_INPUTS).length === 0, "the real offer has problems: " + GS.offerProblems(m, GPL_INPUTS).join("; "));
  const has = (arr, re) => arr.some((p) => re.test(p));
  assert(has(GS.offerProblems(m, [...GPL_INPUTS, "lib/zk/config.ts"]), /bundle carries lib\/zk\/config\.ts/), "a sixth input was not named");
  const fewer = JSON.parse(JSON.stringify(m));
  fewer.files = fewer.files.filter((f) => f.path !== "lib/zk/hash.ts");
  assert(has(GS.offerProblems(fewer, GPL_INPUTS), /bundle carries lib\/zk\/hash\.ts/), "a dropped file was not named");
  assert(has(GS.offerProblems(m, GPL_INPUTS.filter((p) => p !== "lib/zk/hash.ts")), /serves lib\/zk\/hash\.ts, which the bundle does not carry/), "an extra offered file was not named");
  const nob = JSON.parse(JSON.stringify(m));
  nob.build = nob.build.filter((f) => f.path !== "scripts/build-device.mjs");
  assert(has(GS.offerProblems(nob, GPL_INPUTS), /build file scripts\/build-device\.mjs/), "a missing build file was not named");
  const badLink = JSON.parse(JSON.stringify(m));
  badLink.upstream.find((u) => u.name === "snarkjs").source = "https://github.com/iden3/snarkjs";
  assert(has(GS.offerProblems(badLink, GPL_INPUTS), /not the tagged upstream/), "an untagged link was not named");
  const noCommit = { ...m, commit: "" };
  assert(has(GS.offerProblems(noCommit, GPL_INPUTS), /no commit/), "a missing commit was not named");
});
await check("G4 the notice page carries NO inline script or style and links every served file and the license; a page with a <script>, a style attribute, an onclick or a missing link is caught", async () => {
  const dir = offerDir();
  const m = BD.stageSourceOffer({ outDir: dir, metafile: GPL_BUILD.metafile });
  const html = readFileSync(path.join(dir, "index.html"), "utf8");
  assert(GS.indexHtmlProblems(html, m).length === 0, "the notice page: " + GS.indexHtmlProblems(html, m).join("; "));
  assert(/<title>Source code of the Totem browser prover<\/title>/.test(html), "the notice page's title");
  for (const [what, bad] of [["a script", html.replace("</body>", "<script>1</script></body>")], ["a style block", html.replace("</head>", "<style>p{}</style></head>")], ["a style attribute", html.replace("<h1>", '<h1 style="x">')], ["an inline handler", html.replace("<h1>", '<h1 onclick="x()">')], ["a missing link", html.replace('href="' + m.files[0].url + '"', 'href="/elsewhere"')]]) {
    assert(GS.indexHtmlProblems(bad, m).length >= 1, "the notice-page check missed " + what);
  }
});
await check("G5 a DEPLOYED offer is checked the way smoke check 11 checks it (deployedOfferProblems over the served folder): clean as written; a doctored manifest hash, a 404, a GPL file that is not the license, and a notice page that does not answer are each caught", async () => {
  const dir = offerDir();
  const m = BD.stageSourceOffer({ outDir: dir, metafile: GPL_BUILD.metafile });
  const ok = await GS.deployedOfferProblems(m, folderFetch(dir), { expectFiles: 5 });
  assert(ok.length === 0, "the written offer, served: " + ok.join("; "));
  const doctored = JSON.parse(JSON.stringify(m));
  doctored.files[0].sha256 = (doctored.files[0].sha256[0] === "0" ? "1" : "0") + doctored.files[0].sha256.slice(1);
  assert((await GS.deployedOfferProblems(doctored, folderFetch(dir), { expectFiles: 5 })).some((p) => p.includes(doctored.files[0].url)), "a doctored hash passed (smoke check 11's self-test would be vacuous)");
  assert((await GS.deployedOfferProblems(m, folderFetch(dir, { [m.files[1].url]: { status: 404, bytes: Buffer.alloc(0) } }), { expectFiles: 5 })).some((p) => /answered 404/.test(p)), "a 404 passed");
  assert((await GS.deployedOfferProblems(m, folderFetch(dir, { [m.licenseText]: { status: 200, bytes: Buffer.from("MIT License") } }), { expectFiles: 5 })).some((p) => /GPL-3\.0 text/.test(p)), "a GPL file that is not the license passed");
  assert((await GS.deployedOfferProblems(m, folderFetch(dir, { [GS.OFFER_URL]: { status: 404, bytes: Buffer.alloc(0) } }), { expectFiles: 5 })).some((p) => p.startsWith(GS.OFFER_URL + " answered 404")), "a missing notice page passed");
  assert((await GS.deployedOfferProblems(m, folderFetch(dir), { expectFiles: 6 })).some((p) => /expected 6/.test(p)), "a wrong file count passed");
});
await check("G6 prover.js's banner (proverBanner) names the source offer, the LICENSE file inside its first 1,200 characters, both GPL versions, and EXACTLY the Totem files the bundle was built from — read from the metafile, never hand-kept", async () => {
  const banner = BD.proverBanner({ layersFiles: GPL_INPUTS });
  assert(banner.includes(GS.OFFER_URL), "the banner does not name " + GS.OFFER_URL);
  assert(banner.slice(0, 1200).includes("/device/prover.js.LICENSE.txt"), "the LICENSE file is not in the banner's first 1,200 characters");
  assert(banner.includes("snarkjs " + BD.SNARKJS_VERSION) && banner.includes("ffjavascript " + BD.FFJS_VERSION), "the banner's versions");
  const named = [...banner.matchAll(/lib\/zk\/[A-Za-z/-]+\.ts/g)].map((x) => x[0]);
  assert(JSON.stringify([...new Set(named)].sort()) === JSON.stringify(GPL_INPUTS), "the banner names " + JSON.stringify([...new Set(named)].sort()));
  assert(BD.proverBanner({ layersFiles: [...GPL_INPUTS, "lib/zk/config.ts"] }).includes("lib/zk/config.ts"), "the banner does not follow the metafile's set");
  return banner.length + " characters";
});
/** the build script's own wiring: main() writes the LICENSE file and the offer INSIDE one try, and its catch removes
 *  prover.js, its LICENSE file and the offer folder before failing — a source rule (main() is not run here: it would
 *  regenerate the shared route table) */
function buildWiringViolations(src) {
  const out = [];
  const main = src.slice(src.indexOf("async function main()"));
  const t = main.indexOf("  try {\n    writeLicenseFile(banner);");
  const stageAt = main.indexOf("stageSourceOffer({ outDir: path.join(OUT_DIR, OFFER_DIR_NAME), metafile: proverResult.metafile })", t);
  const catchAt = main.indexOf("} catch (e) {", t);
  if (t < 0 || stageAt < 0 || catchAt < stageAt) out.push("main() does not write the LICENSE file and the offer inside one try");
  const rm = main.slice(catchAt, catchAt + 600);
  if (!/for \(const f of \[PROVER_OUT, PROVER_OUT \+ "\.LICENSE\.txt"\]\) rmSync\(f, \{ force: true \}\);/.test(rm)) out.push("a failed offer does not delete prover.js and its LICENSE file");
  if (!/process\.exit\(1\)/.test(rm)) out.push("a failed offer does not fail the build");
  if (!/JSON\.stringify\(built\) !== JSON\.stringify\(bannerFiles\)/.test(main)) out.push("the real build's inputs are not compared with the banner's");
  if (!/metafile: true, logLevel: "silent" \}\);\n  const bannerFiles = layersInputsOf\(pre\.metafile\);/.test(main)) out.push("the banner's files do not come from a metafile pre-pass");
  return out;
}
await check("G7 scripts/build-device.mjs main(): the LICENSE file and the offer are written inside one try whose catch deletes prover.js, its LICENSE file and the offer and fails the build; the banner's files come from a metafile pre-pass and must equal the real build's", () => {
  const v = buildWiringViolations(readFileSync(path.join(ROOT, "scripts", "build-device.mjs"), "utf8").replace(/\r\n/g, "\n"));
  assert(v.length === 0, v.join("; "));
});
await mutation("G7 / the catch no longer deletes prover.js", async () => {
  const src = readFileSync(path.join(ROOT, "scripts", "build-device.mjs"), "utf8").replace(/\r\n/g, "\n");
  const anchor = 'for (const f of [PROVER_OUT, PROVER_OUT + ".LICENSE.txt"]) rmSync(f, { force: true });';
  assert(src.includes(anchor), "patch anchor not found in scripts/build-device.mjs");
  const v = buildWiringViolations(src.replace(anchor, "/* kept */"));
  assert(v.length === 0, v.join("; "));
});
await check("G8 the offer's address is one address everywhere: the middleware's folder rewrite (before the trailing-slash redirect, after the owner gate), Help's link, the LICENSE notice (via the banner) and .gitignore (the folder is generated, never committed)", () => {
  const mw = readFileSync(path.join(ROOT, "middleware.ts"), "utf8").replace(/\r\n/g, "\n");
  const help = readFileSync(path.join(ROOT, "app", "help", "page.tsx"), "utf8");
  const gi = readFileSync(path.join(ROOT, ".gitignore"), "utf8").split(/\r?\n/);
  assert(/const SOURCE_OFFER_PATH = "\/device\/source";/.test(mw) && GS.OFFER_URL === "/device/source/", "the middleware's SOURCE_OFFER_PATH is not OFFER_URL without its slash");
  const rewrite = mw.indexOf('if (path === SOURCE_OFFER_PATH || path === SOURCE_OFFER_PATH + "/") return unframeable(NextResponse.rewrite(new URL(SOURCE_OFFER_PATH + "/index.html", req.url)));');
  const gate = mw.indexOf("const gated = await ownerGate(req, path);");
  const slash = mw.indexOf('if (path.length > 1 && path.endsWith("/") && !isDocsPath(path)) {');
  assert(rewrite > 0 && gate > 0 && slash > 0 && gate < rewrite && rewrite < slash, "the folder rewrite is not between the owner gate and the trailing-slash redirect");
  assert(/const GPL_SOURCE_OFFER = "\/device\/source\/";/.test(help) && help.includes("Source code of the browser prover (GPL-3.0)") && help.includes("href={GPL_SOURCE_OFFER}"), "Help does not link the source offer in plain words");
  assert(gi.includes("public/device/source/"), ".gitignore does not cover public/device/source/");
});

// PERSONA LAUNCH GO-LIVE (A-WEB-PROXY-HOP-HEADERS) — the rate-limit key behind a declared proxy, on both processes
console.log("\nG9 — the rate-limit key behind the edge (validator/caps.js edgeClientAddress = middleware.ts edgeForwardedAddress)");
const CAPS_PATH = path.join(ROOT, "validator", "caps.js");
const CAPS_SRC = readFileSync(CAPS_PATH, "utf8").replace(/\r\n/g, "\n");
function compileCaps(edits = []) {
  let src = CAPS_SRC;
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error("patch anchor not found in validator/caps.js: " + from.slice(0, 90));
    src = src.split(from).join(to);
  }
  const file = path.join(ROOT, "validator", "caps.mutant-" + ++bundleSeq + ".js");
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  return m.exports;
}
/** the middleware's two functions, cut from its source and compiled on their own (the middleware is an Edge bundle) */
async function middlewareEdgeAddress() {
  const src = readFileSync(path.join(ROOT, "middleware.ts"), "utf8").replace(/\r\n/g, "\n");
  const a = src.indexOf("function lastListEntry(");
  const b = src.indexOf("function clientAddress(", a);
  if (a < 0 || b < 0) throw new Error("patch anchor not found in middleware.ts: lastListEntry / edgeForwardedAddress");
  const { transform } = require("esbuild");
  const js = (await transform(src.slice(a, b) + "\nexport { edgeForwardedAddress };", { loader: "ts", format: "esm" })).code;
  return (await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"))).edgeForwardedAddress;
}
const EDGE_CASES = [
  // [headers, the key behind a declared proxy]
  [{}, "SOCKET"],
  [{ "x-forwarded-for": "198.51.100.1" }, "198.51.100.1"],
  [{ "x-forwarded-for": "6.6.6.6, 203.0.113.50" }, "203.0.113.50"], // the client wrote 6.6.6.6: never the key
  [{ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.50" }, "203.0.113.50"],
  [{ "x-forwarded-for": "6.6.6.6, 203.0.113.50, " }, "203.0.113.50"], // an empty trailing entry skipped
  [{ "x-forwarded-for": " , " }, "SOCKET"],
  [{ "x-real-ip": "203.0.113.77", "x-forwarded-for": "6.6.6.6, 198.51.101.9" }, "203.0.113.77"], // Railway's documented header wins
  [{ "x-real-ip": "6.6.6.6, 203.0.113.77" }, "203.0.113.77"], // a client copy joined before the edge's
  [{ "x-real-ip": " ", "x-forwarded-for": "6.6.6.6, 203.0.113.8" }, "203.0.113.8"],
];
function edgeKeyScenario(caps, mw) {
  for (const [h, want] of EDGE_CASES) {
    const got = caps.edgeClientAddress({ headers: h, socket: { remoteAddress: "SOCKET" } }, true);
    assert(got === want, "caps.js keyed " + JSON.stringify(h) + " as " + got + ", want " + want);
    const viaMw = mw(new Headers(h)) || "SOCKET";
    assert(viaMw === want, "middleware.ts keyed " + JSON.stringify(h) + " as " + viaMw + ", want " + want);
    // without TRUST_PROXY: always the socket, whatever the headers say
    assert(caps.edgeClientAddress({ headers: h, socket: { remoteAddress: "SOCKET" } }, false) === "SOCKET", "a header was honoured without TRUST_PROXY: " + JSON.stringify(h));
  }
  // server.js asks the same function (one rule for both validator limiters)
  const server = readFileSync(path.join(ROOT, "validator", "server.js"), "utf8");
  assert(/const key = edgeClientAddress\(req, process\.env\.TRUST_PROXY === "true"\);/.test(server) && !/x-forwarded-for"\] \|\| ""\)\.split\(","\)\[0\]/.test(server), "validator/server.js does not key its token bucket with edgeClientAddress");
  assert(/const address = \(req\) => edgeClientAddress\(req, trustProxy\);/.test(CAPS_SRC), "validator/caps.js's new-identity cap does not key with edgeClientAddress");
}
const MW_EDGE = await middlewareEdgeAddress();
const vcaps = require(CAPS_PATH);
await check("G9 behind TRUST_PROXY=true both processes key on the hop the edge vouches for — X-Real-IP's right-most entry, else X-Forwarded-For's right-most — never a client-written left-most entry (empty entries skipped; the socket without TRUST_PROXY); the two copies agree case by case; server.js and the new-identity cap ask the same function", () => edgeKeyScenario(vcaps, MW_EDGE));
await mutation("G9 / caps.js keyed on the left-most X-Forwarded-For again", async () => edgeKeyScenario(compileCaps([['const viaEdge = lastListEntry(h["x-real-ip"]) || lastListEntry(h["x-forwarded-for"]);', 'const viaEdge = String(h["x-forwarded-for"] || "").split(",")[0].trim() || lastListEntry(h["x-real-ip"]);']]), MW_EDGE));
await mutation("G9 / caps.js honours the headers without TRUST_PROXY", async () => edgeKeyScenario(compileCaps([["  if (trustProxy) {\n    const viaEdge", "  if (true) {\n    const viaEdge"]]), MW_EDGE));

// ================================================================================================ U — the composer's route (UXH-2/3/8)
console.log("\nU — app/api/anon/route.ts: unknown is not yes, the first check, the recent list, the owner-service rings");
const U_MOCKS = {
  ...SERVER_ONLY,
  "next/server": `
export class NextRequest {}
export const NextResponse = { json: (body, init) => ({ status: (init && init.status) || 200, body }) };`,
  "lib/zk/prefetch": `
const U = () => globalThis.__UR;
export function cachedSnapshot(mode) { const s = U().snap; return s && s.mode === mode ? s : null; }
export async function prefetchTick(mode) { U().ticks.push(mode); if (U().tickSets) U().snap = U().tickSets(mode); return { ok: !!U().snap }; }
export function ensurePrefetchLoop() { U().loops++; }`,
  "lib/zk/identity": `export function zkCommitment() { const c = globalThis.__UR.commitment; if (c === null) throw new Error("no identity"); return c; }`,
  "lib/zk/gate": `
const U = () => globalThis.__UR;
export function wantedAnonPosts() { return U().wanted.map((h) => ({ castHash: h, attempts: 0, motivatedAt: 1 })); }
export async function requestAnonPost(text, opts) { U().requests.push({ text, opts }); return { ok: true, castHash: "c".repeat(64), tree: "tier-2", warnings: [], launchPending: false }; }
export function anonWindowHours() { return 6; }
export function anonPostTree() { return "tier-2"; }
export function reachOfferInputFor() { return {}; }
export function launchRevealSentence() { return "x"; }`,
  "lib/zk/anon/queue": `
const U = () => globalThis.__UR;
export async function anonPostItems() { return U().items; }
export async function attributionRecord(h) { return U().records[h] ?? null; }
export async function attributionCastHashes() { return Object.keys(U().records); }
export async function anonPostsAhead() { return 0; }`,
  "lib/zk/anon/outcomes": `
const U = () => globalThis.__UR;
export function anonOutcome(h) { return U().outcomes[h] ?? null; }
export function anonOutcomes() { return Object.values(U().outcomes); }`,
  "lib/identity/postMode": `
export async function defaultPostingPersonaId() { return "p_u"; }
export function isOwnPostingPersona() { return true; }
export async function anonPersonaRefusal() { return null; }
export function handleOfPersona() { return "u"; }
export async function postModeView() { return { handle: "u", mode: "anon", explicit: false, ownAccount: false, options: ["anon"], settable: true, choiceRequired: false, launched: false }; }`,
  "lib/rings/model": `export async function ringsSeeingPosts() { return ["Inner"]; }`,
  "lib/launch/confirm": `export async function launchUnderWay() { return false; }`,
  "lib/zk/privacy": `export async function privacyConditions() { return { private: false, label: "DEMO", conditions: [] }; } export async function ownIdentityFacts() { return { personaFids: [], throwawayFid: null }; }`,
  "lib/zk/validatorClient": `
const U = () => globalThis.__UR;
export async function fetchAnonPostConfig(mode, castHash) { U().reads.push(["config", castHash ?? null]); return { liveRelay: false, fid: null, relayIntervalMs: 3600000, lastRefusal: castHash ? { reason: "refused", at: 1 } : undefined, ...(U().configTree ? { tree: U().configTree } : {}) }; }
export async function fetchAnonCasts() { U().reads.push(["casts", null]); return []; }`,
  "lib/zk/anon/slots": `export function relayCapReason() { return null; }`,
  "lib/zk/anonAttribution": `export async function revealableCastHashes() { return []; } export async function revealAttribution() { return { ok: false, reason: "x" }; }`,
  "lib/zk/anon/relayAccount": `export function relayJoinRefusesPosting() { return false; } export function relayAccountVerdict() { return { detail: "" }; } export const SEED_SELF_FID = 0;`,
  "lib/world-flag": `export function isOwnerService() { return globalThis.__UR.owner === true; }`,
  "lib/adapters/registry": `export function currentRepImpl() { return globalThis.__UR.rep ?? "zk"; }`,
  "lib/adapters/mock/store": `export async function hydrate() {} export function state() { return { zkQueue: new Map() }; }`,
  "lib/reach/held": `export async function refreshHeldReach() { return { error: null }; }`,
  // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the join — records each registration; answers what the state says
  "lib/zk/registration": `export async function registerCommitment(mode, commitment) { const U = globalThis.__UR; U.joins.push({ mode, commitment }); if (U.joinThrows) throw new Error("the validator could not be reached"); return U.joinAnswer ?? { status: 201, ok: true, activeFromEpoch: 101 }; }`,
  "lib/reach/trees": `export function offeredAnonTrees() { return { offered: [], defaultTree: "tier-2", reason: null }; } export function reachRefusal() { return null; }`,
};
const U_ENTRY = `export * as route from "@/app/api/anon/route"; export * as av from "@/lib/zk/anon/availability";`;
async function withEnvAsync(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
function uState(over = {}) {
  globalThis.__UR = { snap: null, tickSets: null, ticks: [], loops: 0, commitment: "777", wanted: [], requests: [], items: [], records: {}, outcomes: {}, reads: [], owner: false, rep: "zk", joins: [], joinAnswer: null, joinThrows: false, configTree: null, ...over };
  delete globalThis.__layersAnonFirstCheck;
  delete globalThis.__layersAnonJoin;
  delete globalThis.__layersAnonRefresh;
  return globalThis.__UR;
}
// PERSONA LAUNCH GO-LIVE: every snapshot carries sixty decoys besides the named members (a crowd over the floor of 50)
const uSnap = (members) => ({ mode: "fixture", tree: "tier-2", members: { members: [...members, ...CROWD60] }, epoch: { epoch: 100, epochMs: 6 * 3_600_000, msRemaining: 3_600_000 }, fetchedAt: Date.now(), anonHead: { mode: "fixture", tree: "tier-2", hash: "h" }, anonHeadError: null, anonConfig: null });
const uReq = (q, body) => ({ nextUrl: { searchParams: new URLSearchParams(q) }, json: async () => body ?? {} });
const ENV_PUBLIC = { NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_POST: undefined, ZK_GATE_TIER: undefined, ZK_ANON_POST_TREE: undefined, ZK_MODE: undefined };
/** PERSONA LAUNCH GO-LIVE: the join sentence (lib/zk/anon/availability.ts anonJoinSentence), recognised by its fixed opening */
const JOINED = (s) => typeof s === "string" && s.startsWith("You've joined the anonymous crowd on this preview, and you can post anonymously from ");
async function routeAnonScenario(M) {
  await asBrowser(() =>
    withEnvAsync(ENV_PUBLIC, async () => {
      // 1. the composer's full read in a tab with no check yet: ONE check runs now; a leaf → available, no code
      let U = uState({ tickSets: () => uSnap(["1", "777"]) });
      let r = await M.route.GET(uReq(""));
      assert(U.ticks.length === 1, "the full read in a fresh tab ran " + U.ticks.length + " check(s)");
      assert(r.body.available === true && r.body.unavailableCode === null && r.body.host === "tab" && r.body.previewOnly === true, "a leaf after the first check: " + JSON.stringify({ a: r.body.available, code: r.body.unavailableCode, reason: r.body.unavailableReason, host: r.body.host }));
      // 2. the check read nothing: "checking" — off, plainly, not deployment-wide; no second check inside the retry window
      U = uState({ tickSets: () => null });
      r = await M.route.GET(uReq(""));
      assert(r.body.available === false && r.body.unavailableReason === M.av.ANON_CHECKING && r.body.unavailableCode === "checking" && r.body.anonDeploymentOff === false, "no check result: " + JSON.stringify({ a: r.body.available, code: r.body.unavailableCode, reason: r.body.unavailableReason }));
      r = await M.route.GET(uReq(""));
      assert(U.ticks.length === 1, "a second read inside the retry window ran another check: " + U.ticks.length);
      // 3. a POST while checking: 409 'checking', nothing minted, the words stay
      let p = await M.route.POST(uReq("", { text: "hello" }));
      assert(p.status === 409 && p.body.code === "checking" && p.body.error === M.av.ANON_CHECKING && U.requests.length === 0, "a POST while checking: " + JSON.stringify({ s: p.status, b: p.body, minted: U.requests.length }));
      // 4. outside the crowd: 409 'crowd' in the plain sentence, nothing minted, no check (a snapshot exists)
      // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): and the post JOINS the crowd (once) — the sentence says from when
      U = uState({ snap: uSnap(["1", "2"]) });
      p = await M.route.POST(uReq("", { text: "hello" }));
      assert(p.status === 409 && p.body.code === "crowd" && JOINED(p.body.error) && typeof p.body.availableFrom === "number" && U.requests.length === 0 && U.ticks.length === 0, "a POST outside the crowd: " + JSON.stringify({ s: p.status, b: p.body }));
      assert(U.joins.length === 1 && U.joins[0].mode === "fixture" && U.joins[0].commitment === "777", "the POST's join: " + JSON.stringify(U.joins));
      // 4b. (GO-LIVE) the composer's full read joins once and says WHEN; a second read and the memory-only poll never
      // register again, and the poll says the same sentence from the join this tab holds
      U = uState({ snap: uSnap(["1", "2"]) });
      r = await M.route.GET(uReq(""));
      assert(r.body.available === false && r.body.unavailableCode === "crowd" && JOINED(r.body.unavailableReason) && typeof r.body.availableFrom === "number" && r.body.availableFrom > Date.now(), "the composer's read outside the crowd: " + JSON.stringify({ a: r.body.available, code: r.body.unavailableCode, reason: r.body.unavailableReason, from: r.body.availableFrom }));
      assert(U.joins.length === 1, "the composer's read joined " + U.joins.length + " time(s)");
      await M.route.GET(uReq(""));
      const poll = await M.route.GET(uReq("availability=1"));
      assert(U.joins.length === 1, "a second read or the poll registered again: " + U.joins.length);
      assert(poll.body.unavailableReason === r.body.unavailableReason && poll.body.unavailableCode === "crowd", "the poll's line: " + JSON.stringify(poll.body));
      // 4c. (GO-LIVE) a refused join is said (the reason rides the detail), and not retried inside JOIN_RETRY_MS
      U = uState({ snap: uSnap(["1", "2"]), joinAnswer: { status: 409, ok: false, error: "commitment already registered to another root" } });
      r = await M.route.GET(uReq(""));
      assert(r.body.unavailableReason === M.av.ANON_JOIN_FAILED && /another root/.test(r.body.unavailableDetail || "") && r.body.unavailableCode === "crowd", "a refused join: " + JSON.stringify({ reason: r.body.unavailableReason, detail: r.body.unavailableDetail }));
      await M.route.GET(uReq(""));
      assert(U.joins.length === 1, "a refused join was retried at once: " + U.joins.length);
      // an unreachable validator: the same sentence, never a crash
      U = uState({ snap: uSnap(["1", "2"]), joinThrows: true });
      r = await M.route.GET(uReq(""));
      assert(r.body.unavailableReason === M.av.ANON_JOIN_FAILED && /could not be reached/.test(r.body.unavailableDetail || ""), "an unreachable validator at the join: " + JSON.stringify({ reason: r.body.unavailableReason, detail: r.body.unavailableDetail }));
      // 4d. (GO-LIVE) the poll in a tab that never joined: the plain sentence, no registration
      U = uState({ snap: uSnap(["1", "2"]) });
      r = await M.route.GET(uReq("availability=1"));
      assert(r.body.unavailableReason === M.av.ANON_NOT_IN_CROWD && U.joins.length === 0, "the poll joined, or said something else: " + JSON.stringify({ b: r.body, joins: U.joins.length }));
      // a leaf never joins
      U = uState({ snap: uSnap(["777"]) });
      await M.route.GET(uReq(""));
      assert(U.joins.length === 0, "a leaf was registered again");
      // in the crowd: minted once
      U = uState({ snap: uSnap(["777"]) });
      p = await M.route.POST(uReq("", { text: "hello" }));
      assert(p.status === 202 && U.requests.length === 1 && p.body.previewOnly === true, "a POST in the crowd: " + JSON.stringify({ s: p.status, b: p.body }));
      // 5. the memory-only poll: never a check, never a validator read
      U = uState();
      r = await M.route.GET(uReq("availability=1"));
      assert(r.body.unavailableCode === "checking" && r.body.on === false && U.ticks.length === 0 && U.reads.length === 0, "the poll: " + JSON.stringify({ b: r.body, ticks: U.ticks.length, reads: U.reads }));
      // 6. the recent list (UXH-3): waiting, queued, refused, dropped and lost-with-the-tab posts — never an accepted one,
      // never a validator read, never a check; the device-side window expiry
      const now = Date.now();
      const h = (c) => c.repeat(64);
      U = uState({
        snap: uSnap(["777"]),
        wanted: [h("a")],
        items: [
          { id: "q1", castHash: h("b"), status: "queued", outcome: null, epoch: 100, notBefore: now + 1000, sentAt: null, personaId: null },
          { id: "q2", castHash: h("c"), status: "sent", outcome: "refused", epoch: 98, notBefore: now - 7 * 3_600_000, sentAt: now - 60_000, personaId: null },
          { id: "q3", castHash: h("d"), status: "sent", outcome: "accepted", epoch: 100, notBefore: now - 60_000, sentAt: now - 30_000, personaId: null },
          { id: "q4", castHash: h("f"), status: "sent", outcome: "refused", epoch: 100, notBefore: now - 60_000, sentAt: now - 30_000, personaId: null },
        ],
        outcomes: { [h("e")]: { castHash: h("e"), mode: "fixture", stage: "dropped", reason: "r", lastStage: "membership", attempts: 1, firstAt: now, lastAt: now, queuedId: null, epoch: null, warnings: [] } },
        records: { [h("9")]: { mode: "fixture", castHash: h("9"), at: now - 1000, personaId: null, settled: null }, [h("d")]: { mode: "fixture", castHash: h("d"), at: now, personaId: null, settled: null } },
      });
      r = await M.route.GET(uReq("recent=1"));
      const got = (r.body.recent ?? []).map((x) => x.castHash).sort();
      const want = [h("9"), h("a"), h("b"), h("c"), h("e"), h("f")].sort();
      assert(JSON.stringify(got) === JSON.stringify(want), "the recent list: " + got.map((x) => x[0]).join(","));
      assert(U.reads.length === 0 && U.ticks.length === 0, "the recent list read the validator or ran a check: " + JSON.stringify({ reads: U.reads, ticks: U.ticks.length }));
      const of = (c) => r.body.recent.find((x) => x.castHash === h(c));
      assert(of("c").expiredWindow === true && of("f").expiredWindow === false, "the window expiry: " + JSON.stringify([of("c").expiredWindow, of("f").expiredWindow]));
      assert(of("9").status === "unknown" && of("9").host === "tab" && of("a").status === "wanted" && of("e").status === "dropped", "the statuses: " + JSON.stringify(["9", "a", "e"].map((c) => of(c).status)));
      // PUBLIC GO-LIVE (PRIV-LIVE-2): a TAB's per-post poll never asks the signed reader (that read is device-signed and names the post)
      U.reads.length = 0;
      await M.route.GET(uReq("castHash=" + h("c")));
      assert(!U.reads.some((x) => x[0] === "config" && x[1] === h("c")), "a tab's per-post poll read the refusal reason (a device-signed read naming the post)");
    })
  );
  // a SERVER-SIDE device: the composer's read runs no check; postAs.ownerService follows isOwnerService (UXH-8)
  await withEnvAsync({ NODE_ENV: undefined, ZK_DEV_HOOKS: "true", ZK_ANON_POST: undefined, ZK_MODE: undefined }, async () => {
    // PERSONA LAUNCH GO-LIVE: never a join from a server-side device (its registration is the owner's own step), and the
    // route says so when the validator accepts another plain tree (every proof would be refused there)
    let Us = uState({ snap: uSnap(["1"]) });
    let rs = await M.route.GET(uReq(""));
    assert(Us.joins.length === 0, "a server-side device joined from the composer's read");
    Us = uState({ snap: uSnap(["777"]), configTree: "valid" });
    rs = await M.route.GET(uReq(""));
    assert(rs.body.available === false && rs.body.unavailableReason === M.av.ANON_OFF_TREE_MISMATCH, "a validator on another tree, server-side: " + JSON.stringify({ a: rs.body.available, reason: rs.body.unavailableReason }));
    Us = uState({ snap: uSnap(["777"]), configTree: "tier-2" });
    rs = await M.route.GET(uReq(""));
    assert(rs.body.unavailableReason !== M.av.ANON_OFF_TREE_MISMATCH, "the same tree on both sides was called a mismatch");
    const U = uState({ tickSets: () => uSnap(["777"]), owner: true });
    const r = await M.route.GET(uReq(""));
    assert(U.ticks.length === 0, "a server-side device ran a check from the composer's read");
    assert(r.body.postAs?.ownerService === true && JSON.stringify(r.body.postAs?.rings) === '["Inner"]', "the owner service's postAs: " + JSON.stringify(r.body.postAs));
    uState({ owner: false });
    const r2 = await M.route.GET(uReq(""));
    assert(r2.body.postAs?.ownerService === false, "postAs off the owner service: " + JSON.stringify(r2.body.postAs));
    // PUBLIC GO-LIVE (PRIV-LIVE-2, final verify): a SERVER-SIDE device's per-post poll still reads a refused post's reason
    // (the owner's own app, over its private network), and its recent list never reads the validator at all — the
    // positive half that keeps the tab-side "never" and "the recent list asks the validator" from passing vacuously
    const hs = (c) => c.repeat(64);
    const nowS = Date.now();
    const Ur = uState({ snap: uSnap(["777"]), items: [{ id: "s1", castHash: hs("c"), status: "sent", outcome: "refused", epoch: 98, notBefore: nowS - 60_000, sentAt: nowS - 30_000, personaId: null }] });
    await M.route.GET(uReq("castHash=" + hs("c")));
    assert(Ur.reads.some((x) => x[0] === "config" && x[1] === hs("c")), "a server-side device's per-post poll no longer reads the refusal reason: " + JSON.stringify(Ur.reads));
    Ur.reads.length = 0;
    const rr = await M.route.GET(uReq("recent=1"));
    assert((rr.body.recent ?? []).some((x) => x.castHash === hs("c")), "the server-side recent list lost the refused post: " + JSON.stringify(rr.body.recent));
    assert(Ur.reads.length === 0, "a server-side device's recent list read the validator: " + JSON.stringify(Ur.reads));
  });
}
const UR = await bundle(U_ENTRY, U_MOCKS);
await check("U1 (UXH-2/3/8) the composer's route: a fresh tab's full read runs ONE check now (a leaf → available); a check that read nothing is 'checking' (off, not deployment-wide, no second check inside 30 s); POST while checking is 409 'checking' and outside the crowd 409 'crowd', nothing minted; the ?availability=1 poll never checks or reads; ?recent=1 lists waiting/queued/refused/dropped/lost posts (never accepted ones) with the device-side window expiry and no validator read; a server-side device never checks from a read; postAs.ownerService follows isOwnerService", () => routeAnonScenario(UR));
await mutation("U1 / the composer's read runs no first check", async () => routeAnonScenario(await bundle(U_ENTRY, U_MOCKS, { "app/api/anon/route.ts": [['  if (!castHash && req.nextUrl.searchParams.get("recent") !== "1") await firstCheckIfNone(mode);\n', ""]] })));
await mutation("U1 / a POST while checking reported as 'crowd'", async () => routeAnonScenario(await bundle(U_ENTRY, U_MOCKS, { "app/api/anon/route.ts": [["code: refusalCodeOf(here)", 'code: here.scope === "now" ? "crowd" : "unavailable"']] })));
await mutation("U1 / the memory-only poll runs a check", async () => routeAnonScenario(await bundle(U_ENTRY, U_MOCKS, { "app/api/anon/route.ts": [["    const av = await availabilityHere(mode);\n    return NextResponse.json({ mode, host, on: av.on", "    const av = await availabilityHere(mode, { firstCheck: true });\n    return NextResponse.json({ mode, host, on: av.on"]] })));
await mutation("U1 / the recent list asks the validator", async () => routeAnonScenario(await bundle(U_ENTRY, U_MOCKS, { "app/api/anon/route.ts": [["recent.push(await statusOf(h, false));", "recent.push(await statusOf(h, true));"]] })));
await mutation("U1 (GO-LIVE) / the composer's read does not join", async () => routeAnonScenario(await bundle(U_ENTRY, U_MOCKS, { "app/api/anon/route.ts": [["  const av = await availabilityHere(mode, { join: true });", "  const av = await availabilityHere(mode);"]] })));
await mutation("U1 (GO-LIVE) / the memory-only poll joins", async () => routeAnonScenario(await bundle(U_ENTRY, U_MOCKS, { "app/api/anon/route.ts": [["    const av = await availabilityHere(mode);\n    return NextResponse.json({ mode, host, on: av.on", "    const av = await availabilityHere(mode, { join: true });\n    return NextResponse.json({ mode, host, on: av.on"]] })));
await mutation("U1 (GO-LIVE) / a refused join retried at once", async () => routeAnonScenario(await bundle(U_ENTRY, U_MOCKS, { "app/api/anon/route.ts": [["Date.now() - r.at < JOIN_RETRY_MS", "false"]] })));
await mutation("U1 (GO-LIVE) / the route's tree check removed", async () => routeAnonScenario(await bundle(U_ENTRY, U_MOCKS, { "app/api/anon/route.ts": [['else if (typeof config.tree === "string" && config.tree !== (await import("@/lib/zk/gate")).anonPostTree())', "else if (false)"]] })));
await mutation("U1 (PRIV-LIVE-2) / a tab's per-post poll asks the signed reader again", async () => routeAnonScenario(await bundle(U_ENTRY, U_MOCKS, { "app/api/anon/route.ts": [['    if (reads && host === "server" && item && item.status === "sent" && item.outcome === "refused") {', '    if (reads && item && item.status === "sent" && item.outcome === "refused") {']] })));
await mutation("U1 / postAs.ownerService not answered", async () => routeAnonScenario(await bundle(U_ENTRY, U_MOCKS, { "app/api/anon/route.ts": [["ownerService: isOwnerService() };", "ownerService: false };"]] })));

// ================================================================================================ D — the status line's words (UXH-3)
console.log("\nD — the anonymous post's status line in a tab (components/AnonPostStatus.tsx) and the tab-holds-a-post predicate");
const D_ENTRY = `export * from "@/components/AnonPostStatus"; export { anonHeldInTab, anonDroppedInTabSentence } from "@/lib/zk/anon/availability";`;
async function describeScenario(M) {
  const timing = { nextTickWithinMs: 750_000, jitterMaxMs: 600_000, relayIntervalMs: 3_600_000, relaySlotJitterMaxMs: 600_000, relaySpreadMs: 0 };
  const base = (over) => ({ status: "wanted", item: null, outcome: null, validatorRefusal: null, timing, ...over });
  const now = Date.now();
  const o = (stage) => ({ stage, reason: "the last check refused it", lastStage: "x", attempts: 2, warnings: [] });
  for (const [what, s] of [
    ["waiting for its proof", base({ status: "wanted" })],
    ["retrying", base({ status: "wanted", outcome: o("retrying") })],
    ["waiting for the next window", base({ status: "wanted", outcome: o("deferred") })],
    ["proved, not yet sent", base({ status: "queued", item: { status: "queued", outcome: null, notBefore: now + 60_000, sentAt: null } })],
  ]) {
    const tab = M.describeAnonStatus({ ...s, host: "tab" }, now);
    const srv = M.describeAnonStatus({ ...s, host: "server" }, now);
    assert(tab.text.includes(M.KEEP_TAB_OPEN), what + " in a tab does not say to keep the tab open: " + tab.text);
    assert(!srv.text.includes(M.KEEP_TAB_OPEN), what + " on a server says to keep a tab open: " + srv.text);
  }
  const acc = M.describeAnonStatus(base({ status: "sent", item: { status: "sent", outcome: "accepted", notBefore: now, sentAt: now }, host: "tab", previewOnly: true }), now);
  assert(acc.text === M.PREVIEW_ACCEPTED, "an accepted post in a tab: " + acc.text);
  const refused = { status: "sent", outcome: "refused", notBefore: now - 1000, sentAt: now };
  assert(M.describeAnonStatus(base({ status: "sent", item: refused, host: "tab", expiredWindow: true }), now).text === M.EXPIRED_IN_CLOSED_TAB, "a post sent after its window ended (judged on the device) is not the closed-tab sentence");
  assert(M.describeAnonStatus(base({ status: "sent", item: refused, host: "tab", expiredWindow: false }), now).text !== M.EXPIRED_IN_CLOSED_TAB, "a refusal inside its window read as the closed-tab sentence");
  assert(M.describeAnonStatus(base({ status: "unknown", host: "tab" }), now).text === M.LOST_WITH_TAB, "a post lost with the tab");
  const dropped = M.describeAnonStatus(base({ status: "dropped", outcome: { stage: "dropped", reason: M.anonDroppedInTabSentence("my own words"), lastStage: "membership", attempts: 1, warnings: [] }, host: "tab" }), now);
  assert(dropped.tone === "bad" && dropped.text.startsWith("Not posted: ") && dropped.text.includes("“my own words”") && !dropped.text.endsWith("”.") && !dropped.text.endsWith(".."), "the dropped line with the words given back: " + dropped.text);
  const plain = M.describeAnonStatus(base({ status: "dropped", outcome: { stage: "dropped", reason: "the proof was refused", lastStage: "x", attempts: 1, warnings: [] } }), now);
  assert(plain.text === "Not posted: the proof was refused.", "a plain dropped line: " + plain.text);
  // the predicate the device's beforeunload asks
  assert(M.anonHeldInTab(1, []) === true, "a post waiting for its proof is not held");
  assert(M.anonHeldInTab(0, [{ claimKind: "anon-post", status: "queued" }]) === true, "a proved, unsent post is not held");
  assert(M.anonHeldInTab(0, [{ claimKind: "anon-post", status: "sent" }, { claimKind: "tier-membership", status: "queued" }, { claimKind: "anon-attribution", status: "sent" }]) === false, "a tab with nothing to lose asks before closing");
  assert(M.anonHeldInTab(0, []) === false, "an empty tab is held");
}
const D_MOCKS = {
  ...V_MOCKS,
  react: `export function useEffect() {} export function useState(v) { return [v, () => {}]; }`,
  "react/jsx-runtime": `export function jsx() { return null; } export const jsxs = jsx; export const Fragment = "fragment";`,
};
const JSX = { jsx: "automatic" };
const DM = await bundle(D_ENTRY, D_MOCKS, {}, JSX);
await check("D1 (UXH-3) in a TAB every line of a post the tab still holds (waiting for its proof, retrying, waiting for the window, proved and unsent) says to keep the tab open — never on a server, never once accepted; a post sent after its window ended (judged on the device) is the closed-tab sentence; a lost post says so; a dropped line hands the words back and ends once; the tab-holds-a-post predicate", () => describeScenario(DM));
await mutation("D1 / the waiting line no longer says to keep the tab open", async () => describeScenario(await bundle(D_ENTRY, D_MOCKS, { "components/AnonPostStatus.tsx": [["text: inTab(`Waiting for its proof", "text: (`Waiting for its proof"]] }, JSX)));
await mutation("D1 / the queued line no longer says to keep the tab open", async () => describeScenario(await bundle(D_ENTRY, D_MOCKS, { "components/AnonPostStatus.tsx": [["text: inTab(`Proof made.", "text: (`Proof made."]] }, JSX)));
await mutation("D1 / the device-side window expiry ignored", async () => describeScenario(await bundle(D_ENTRY, D_MOCKS, { "components/AnonPostStatus.tsx": [["(s.expiredWindow === true || expiredEpoch(", "(expiredEpoch("]] }, JSX)));
await mutation("D1 / the predicate ignores the proved, unsent posts", async () => describeScenario(await bundle(D_ENTRY, D_MOCKS, { "lib/zk/anon/availability.ts": [['  for (const q of queue) if (q && q.claimKind === "anon-post" && q.status === "queued") return true;\n', ""]] }, JSX)));

// ================================================================================================ S — source rules
console.log("\nS — source rules");
await check("S1 accept-z1 check 4's rule over lib/zk/anon/{client,submit,relay}.ts (no request call, no persist / validatorClient / undici import); webChannel.ts has exactly ONE request call site", () => {
  for (const f of ["lib/zk/anon/client.ts", "lib/zk/anon/submit.ts", "lib/zk/anon/relay.ts"]) {
    const src = readFileSync(path.join(ROOT, f), "utf8");
    assert(!/from "@\/lib\/adapters\/mock\/persist"|from "\.\.\/validatorClient"|from "undici"|\bfetch\(/.test(src), f + " touches a shared transport");
  }
  const wc = readFileSync(path.join(ROOT, "lib", "zk", "anon", "webChannel.ts"), "utf8");
  const n = (wc.match(/\bfetch\(/g) ?? []).length;
  assert(n === 1, "webChannel.ts request call sites: " + n);
});
await check("S2 the route keeps unit-anon-slots C2's anchors verbatim and asks availability.ts (never the rep binding itself)", () => {
  const src = readFileSync(path.join(ROOT, "app", "api", "anon", "route.ts"), "utf8").replace(/\r\n/g, "\n");
  for (const a of ["if (deploymentOff) unavailableReason = deploymentOff.reason;", "anonDeploymentOff: true", "const capReason = relayCapReason(mode, config, wantedAnonPosts().length + (await anonPostsAhead(mode, readAt)));", "else if (capReason) unavailableReason = capReason;", 'lifetimeCap: mode === "live" && typeof config.cap === "number" ? config.cap : null', "anonPostingAvailability({ mode, snap: cachedSnapshot(mode), commitment, join: joinStateFor(mode, commitment) })"]) assert(src.includes(a), "missing: " + a);
  assert(src.indexOf("const readAt = Date.now();") < src.indexOf("const config = await fetchAnonPostConfig(mode);"), "readAt after the config read");
  assert(!/currentRepImpl\(\)/.test(src), "the route asks the rep binding itself");
});
await check("S3 the device's prover hook is DEBUG ONLY (every member behind LAYERS_DEVICE_DEBUG); the smoke page's knobs sit behind its loopback guard", () => {
  const e = readFileSync(path.join(ROOT, "lib", "device", "entry.ts"), "utf8").replace(/\r\n/g, "\n");
  const start = e.indexOf("  prover: {\n    log:");
  const block = e.slice(start, e.indexOf("\n  },\n", start));
  assert(start > 0, "no prover block");
  for (const m of ["log:", "run:", "liveSample:", "needles:", "preload:"]) assert(new RegExp(m + " DEBUG\\b").test(block) || new RegExp(m + "\\s*DEBUG\\s*\\?").test(block), m + " is not behind DEBUG");
  const s = readFileSync(path.join(ROOT, "public", "device", "smoke.html"), "utf8");
  const guard = s.indexOf("if (!loopback) {");
  const knobs = s.indexOf('env.ZK_JITTER_MIN_MS = q.get("jmin")');
  const ret = s.indexOf("return;", guard);
  assert(guard > 0 && ret > guard && knobs > ret, "the knobs are not behind the loopback guard");
});
await check("S5 (UXH-11) the production-shape suite looks for the module's own words: scripts/accept-anon-prod.mjs NOT_IN_CROWD and CHECKING equal lib/zk/anon/availability.ts ANON_NOT_IN_CROWD and ANON_CHECKING", () => {
  const src = readFileSync(path.join(ROOT, "scripts", "accept-anon-prod.mjs"), "utf8");
  const lit = (name) => new RegExp("^const " + name + ' = "([^"]+)";', "m").exec(src)?.[1];
  assert(lit("NOT_IN_CROWD") === V.ANON_NOT_IN_CROWD, "NOT_IN_CROWD: suite " + JSON.stringify(lit("NOT_IN_CROWD")) + " / module " + JSON.stringify(V.ANON_NOT_IN_CROWD));
  assert(lit("CHECKING") === V.ANON_CHECKING, "CHECKING: suite " + JSON.stringify(lit("CHECKING")) + " / module " + JSON.stringify(V.ANON_CHECKING));
  // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the suite's JOIN_RE / JOIN_PREFIX / FLOOR_RE match the module's OWN
  // sentences (with and without the floor part, a count of 1 and of many) — and refuse the old dead end
  const re = (name) => {
    const m = new RegExp("^const " + name + " = (/.+/);$", "m").exec(src);
    assert(m, "the suite has no " + name);
    return new Function("return " + m[1])();
  };
  const JOIN_RE = re("JOIN_RE");
  const FLOOR_RE = re("FLOOR_RE");
  const prefix = lit("JOIN_PREFIX");
  for (const crowd of [0, 1, 3, 60]) {
    const s = V.anonJoinSentence({ when: "2:00 PM", hours: 6, floor: 50, crowd });
    const m = JOIN_RE.exec(s);
    assert(m && m[1] === "2:00 PM" && (crowd < 50 ? m[3] === "50" : m[2] === undefined), "the suite's JOIN_RE does not read the module's sentence (crowd " + crowd + "): " + s);
    assert(s.startsWith(prefix), "the suite's JOIN_PREFIX is not the module's opening: " + s);
  }
  for (const n of [1, 2, 49]) assert(FLOOR_RE.test(V.anonFloorSentence(50, n)), "the suite's FLOOR_RE does not read the module's sentence: " + V.anonFloorSentence(50, n));
  assert(!JOIN_RE.test("Anonymous posting on this preview is open only to people already in the anonymous crowd, and you can't join it from here yet."), "the suite's JOIN_RE accepts the old dead end");
});
/** PERSONA LAUNCH P7 (L1, L2, UXH-3) — the source rules the behaviour checks above cannot reach (the device entry runs
 *  only in a browser; the worker-scope block only inside a worker; live.ts forks a child) */
function p7SourceViolations({ entry, worker, live, browser }) {
  const out = [];
  // L1: every tab starts the boot-time load inside the boot, BEFORE it waits for the identity (never from a job)
  const ready = entry.indexOf("api.ready = (async () => {");
  const preload = entry.indexOf("b.startProverPreload()", ready);
  const boot = entry.indexOf("await bootDevice()", ready);
  if (ready < 0 || preload < 0 || boot < 0 || preload > boot) out.push("entry.ts: the prover's boot-time load is not started at boot, before the identity");
  // UXH-3: the tab asks before closing while it holds an anonymous post
  if (!/window\.addEventListener\("beforeunload"/.test(entry)) out.push("entry.ts: no beforeunload guard");
  if (!entry.includes("held = anonHeldInTab(gate.wantedAnonPosts().length, store.state().zkQueue.values());")) out.push("entry.ts: the beforeunload guard does not ask anonHeldInTab with the wanted set and the queue");
  if (!/if \(held\) \{\s*ev\.preventDefault\(\);/.test(entry)) out.push("entry.ts: the beforeunload guard never asks");
  // L1: the installed worker answers from in-memory files only, and its scope's fetch refuses
  const scope = worker.slice(worker.indexOf("if (inWorkerScope()) {"));
  if (!scope.startsWith("if (inWorkerScope()) {")) out.push("browser-worker.ts: no worker-scope block");
  if (!/\(globalThis as \{ fetch\?: unknown \}\)\.fetch = \(\) => Promise\.reject\(/.test(scope)) out.push("browser-worker.ts: the worker scope's fetch is not refused");
  if (!scope.includes("void answerWorkerMessage(ev.data)")) out.push("browser-worker.ts: the installed worker does not answer through answerWorkerMessage");
  if (/void handleJob\(ev\.data\)/.test(scope)) out.push("browser-worker.ts: the installed worker calls handleJob with the network deps");
  // L2: nothing hangs a prover timing on an envelope
  for (const [name, src] of [["live.ts", live], ["browser.ts", browser]]) if (/\.provingMs\s*=/.test(src.replace(/^\s*\/\/.*$/gm, ""))) out.push(name + ": an envelope carries provingMs again");
  return out;
}
const p7Sources = () => ({
  entry: readFileSync(path.join(ROOT, "lib", "device", "entry.ts"), "utf8").replace(/\r\n/g, "\n"),
  worker: readFileSync(path.join(ROOT, "lib", "zk", "prover", "browser-worker.ts"), "utf8").replace(/\r\n/g, "\n"),
  live: readFileSync(path.join(ROOT, "lib", "zk", "transport", "live.ts"), "utf8").replace(/\r\n/g, "\n"),
  browser: readFileSync(path.join(ROOT, "lib", "zk", "transport", "browser.ts"), "utf8").replace(/\r\n/g, "\n"),
});
await check("S4 (L1/L2/UXH-3) the device starts the prover's boot-time load at boot (before the identity) and guards closing a tab that holds an anonymous post; the installed worker answers from in-memory files with its fetch refused; no transport hangs provingMs on an envelope", () => {
  const v = p7SourceViolations(p7Sources());
  assert(v.length === 0, v.join(" | "));
});
for (const [name, edit] of [
  ["the boot-time load removed from the device's boot", (x) => ({ ...x, entry: x.entry.replace(".then((b) => b.startProverPreload())", ".then(() => undefined)") })],
  ["the beforeunload guard never asks", (x) => ({ ...x, entry: x.entry.replace("if (held) {\n        ev.preventDefault();", "if (false) {\n        ev.preventDefault();") })],
  ["the installed worker given the network deps", (x) => ({ ...x, worker: x.worker.replace("void answerWorkerMessage(ev.data)", "void handleJob(ev.data)") })],
  ["the worker scope's fetch left working", (x) => ({ ...x, worker: x.worker.replace("(globalThis as { fetch?: unknown }).fetch = () => Promise.reject(", "void (() => Promise.reject(") })],
  ["provingMs hung on the live envelope again", (x) => ({ ...x, live: x.live.replace("    lastLive = { at: Date.now(), ms };", "    (envelope as ProofEnvelope & { provingMs?: number }).provingMs = ms;\n    lastLive = { at: Date.now(), ms };") })],
]) {
  await mutation("S4 / " + name, async () => {
    const before = p7Sources();
    const after = edit(before);
    if (JSON.stringify(after) === JSON.stringify(before)) throw new Error("patch anchor not found in the S4 sources: " + name);
    const v = p7SourceViolations(after);
    assert(v.length === 0, v.join(" | "));
  });
}

// ================================================================================================ T — the banner follows the tick
// PERSONA LAUNCH wave 3 (final verify, found by accept-cu6 check 3 on the production shape): since UXH-2 a tab's first
// prefetch tick lands seconds after boot (the composer's first read runs it), so a banner that computed the privacy
// label once, before it, kept "5 of 8 fail" while the device held "3 of 8". The tick now announces itself in the
// document (lib/device/bootState.ts announceZkTick, called at the end of every lib/zk/prefetch.ts runTick) and the banner
// computes the label again on it.
console.log("\nT — the preview banner follows the device's ticks");
const TICK_ENTRY = 'export { announceZkTick, ZK_TICK_EVENT } from "@/lib/device/bootState";\n';
async function tickEventScenario(Mx) {
  const seen = [];
  const hadWindow = "window" in globalThis;
  globalThis.window = { dispatchEvent: (e) => { seen.push(e.type); return true; } };
  try {
    Mx.announceZkTick();
  } finally {
    if (!hadWindow) delete globalThis.window;
  }
  assert(seen.length === 1 && seen[0] === Mx.ZK_TICK_EVENT && Mx.ZK_TICK_EVENT === "layers:zk-tick", "announceZkTick did not dispatch exactly one layers:zk-tick: " + JSON.stringify(seen));
  // no window (a server-side device): nothing thrown, nothing dispatched
  Mx.announceZkTick();
  return "one event per tick, no window no throw";
}
function tickWiringViolations(prefetchSrc, bannerSrc) {
  const out = [];
  const p = prefetchSrc.replace(/\r\n/g, "\n");
  const run = p.slice(p.indexOf("async function runTick("), p.indexOf("export function prefetchTick("));
  if (!run.includes("s.ticks.push(tick);")) out.push("runTick was not found (no s.ticks.push)");
  else if (!/s\.ticks\.push\(tick\);[\s\S]*announceZkTick\(\);[\s\S]*return tick;\s*\}\s*$/.test(run)) out.push("runTick does not announce the tick after recording it");
  const b = bannerSrc.replace(/\r\n/g, "\n");
  if (!/window\.addEventListener\(ZK_TICK_EVENT, onTick\)/.test(b)) out.push("the banner does not listen for the tick");
  if (!/const onTick = \(\) => \{\s*if \(verdictRef\.current !== null\) setAttempt\(\(a\) => a \+ 1\);\s*\};/.test(b)) out.push("the banner's tick listener does not compute the label again");
  if (!/window\.removeEventListener\(ZK_TICK_EVENT, onTick\)/.test(b)) out.push("the banner never removes its tick listener");
  if (!/\}, \[attempt\]\);/.test(b)) out.push("the banner's verdict read does not re-run on attempt");
  return out;
}
const TK = await bundle(TICK_ENTRY);
await check("T1 a prefetch tick is announced in the document (one layers:zk-tick, nothing without a window) and the preview banner computes the privacy label again on it (runTick announces after recording; the banner listens, re-reads, and unlistens)", async () => {
  const r = await tickEventScenario(TK);
  const v = tickWiringViolations(readFileSync(path.join(ROOT, "lib", "zk", "prefetch.ts"), "utf8"), readFileSync(path.join(ROOT, "components", "PreviewBanner.tsx"), "utf8"));
  assert(v.length === 0, v.join(" | "));
  return r;
});
await mutation("T1 / runTick no longer announces the tick", async () => {
  const src = readFileSync(path.join(ROOT, "lib", "zk", "prefetch.ts"), "utf8");
  const bad = src.replace("  announceZkTick();\n  return tick;", "  return tick;").replace("  announceZkTick();\r\n  return tick;", "  return tick;");
  if (bad === src) throw new Error("patch anchor not found in lib/zk/prefetch.ts: announceZkTick();");
  const v = tickWiringViolations(bad, readFileSync(path.join(ROOT, "components", "PreviewBanner.tsx"), "utf8"));
  assert(v.length === 0, v.join(" | "));
});
await mutation("T1 / the banner ignores the tick", async () => {
  const src = readFileSync(path.join(ROOT, "components", "PreviewBanner.tsx"), "utf8");
  const bad = src.split("window.addEventListener(ZK_TICK_EVENT, onTick);").join("");
  if (bad === src) throw new Error("patch anchor not found in components/PreviewBanner.tsx: addEventListener(ZK_TICK_EVENT");
  const v = tickWiringViolations(readFileSync(path.join(ROOT, "lib", "zk", "prefetch.ts"), "utf8"), bad);
  assert(v.length === 0, v.join(" | "));
});
await mutation("T1 / announceZkTick dispatches nothing", async () => {
  const M = await bundle(TICK_ENTRY, {}, { "lib/device/bootState.ts": [["if (typeof window !== \"undefined\") window.dispatchEvent(new CustomEvent(ZK_TICK_EVENT));", "void 0;"]] });
  await tickEventScenario(M);
});

const total = passed + failed + infra;
console.log(`\n${passed}/${total} prover-unit checks passed` + (failed ? `, ${failed} FAILED: ${failures.join(" | ")}` : "") + (infra ? `, ${infra} infra` : ""));
// snarkjs/ffjavascript keep a curve alive; the result is printed, so the process ends here
process.exit(failed ? 1 : infra ? 2 : 0);
