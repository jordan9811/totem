// POST AS YOU — "Allow Totem to post as you", END TO END IN ONE PROCESS, with nothing real: the browser device's flow
// (lib/fc/rootSigner/{flow,store,config}.ts, lib/fc/hub/message.ts, app/api/fc/root/route.ts) bundled with esbuild and
// run as a device (the runtime seam), the REAL validator (validator/server.js createApp(":memory:") with its key request
// routes and hub relay) on a loopback port, and the loopback stubs: scripts/lib/farcaster-api-stub.mjs (Farcaster's
// signed key request API, recovering every signature with viem) and scripts/lib/farcaster-protocol-stub.mjs (a Snapchain
// node with its own decoder, BLAKE3 and Ed25519 checks, and the KeyRegistry it consults). The keystore, the vault cipher,
// the sealed pins and the accountLinks record are the REAL modules on a temporary KEYSTORE_DIR; only the validator's
// state store is an in-memory stub (lib/adapters/mock/persist.ts). No request leaves the machine.
//
//   R1  the browser's message port is BYTE-IDENTICAL to validator/hubmessage.js (casts, replies, deletes, likes, recasts)
//   R2  the hub URL rule and the device hint (default, loopback, refused on a hosting platform, no query/path/userinfo)
//   R3  no server answers: the route refuses 404 device_only BEFORE reading the body, in every server shape
//   R4  before sign-in / unarmed / armed: available, the reason, nothing invented
//   R5  start: the key is SEALED before the validator hears of it; the approval link + QR; the key is random, not a persona's
//       or the seed's; no private key in any answer, request or log
//   R6  approval: ANOTHER account's approval is refused and the key forgotten; a key the node does NOT list is never
//       enabled and is refused after the grace window; the right account + the node listing it enables it
//   R7  posting: a cast, a reply, a like, a recast and a delete reach the node signed by the root's key for the root's fid;
//       too long is refused before anything is sent; a node's refusal is an ERROR with its words, never a silent drop
//   R8  an EXPIRED request: no link shown, the poll refuses and the key goes
//   R9  answers the device does not trust: a WRONG requestFid, an EXPIRED deadline, a foreign link, another key; and
//       Farcaster refusing a validator configured with the wrong requestFid
//   R10 disconnect: DISCONNECT typed; the key forgotten (its public half kept); how to remove it in the Farcaster app;
//       posting refused after
//   R11 the vault: exactly 1,024 ciphertext bytes with and without a key; uniform presence; a doctored record refused
//   R12 PERSONA SEPARATION FOR WRITES (hub cards' Reply / Like / Recast and their undo): the bytes that reach the relay
//       are EXACTLY the message the root's key signs for the root's fid (a like, a recast, a reply with its parent, both
//       undos, a delete), re-built byte for byte; while a persona acts NOTHING is signed or sent (every write, a switch
//       during signing included, an unreadable jar counted as acting); nothing targets an own persona fid (a like's or
//       recast's target, a reply's parent; an unreadable persona list refuses a targeted write)
//   M   MUTATIONS: each guard removed in the BUNDLE ONLY, and the check that covers it must then FAIL
//
//   node scripts/unit-root-post.mjs            (npm run test:root-post-unit)
//   node scripts/unit-root-post.mjs --only=R6
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length).split(",").filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const MUTATIONS = process.env.ROOTPOST_MUTATION ? JSON.parse(process.env.ROOTPOST_MUTATION) : [];
const QUIET = process.env.ROOTPOST_UNIT_QUIET === "1";

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

// ---------------------------------------------------------------------------------------------------- the bundle
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-rootpost-unit-"));
process.env.KEYSTORE_DIR = path.join(tmp, "keystore");
const S = (n) => path.join(tmp, n);
const stubs = {
  "server-only.ts": "export {};\n",
  "next-server.ts": `export class NextResponse {
  status: number; body: unknown; headers: Record<string, string>;
  constructor(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) { this.status = init.status ?? 200; this.body = body; this.headers = init.headers ?? {}; }
  static json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) { return new NextResponse(body, init); }
}
export class NextRequest {
  nextUrl: URL; method: string; private raw: string | undefined; readCount = 0;
  constructor(url: string, init: { method?: string; body?: string } = {}) { this.nextUrl = new URL(url); this.method = init.method ?? "GET"; this.raw = init.body; }
  async json() { this.readCount++; return JSON.parse(this.raw ?? ""); }
  async text() { this.readCount++; return this.raw ?? ""; }
}
`,
  "persist.ts": `export const validatorStore = new Map<string, Record<string, unknown>>();
export const knobs = { flushed: [] as { ns: string; entries: Record<string, unknown>; at: number }[], seq: 0 };
export async function fetchState(ns: string): Promise<{ status: number; ok: boolean; json: () => Promise<any> }> {
  const entries = validatorStore.get(ns);
  if (!entries) return { status: 200, ok: true, json: async () => ({ entries: {} }) };
  return { status: 200, ok: true, json: async () => ({ entries: JSON.parse(JSON.stringify(entries)) }) };
}
export async function flushVault(ns: string, entries: Record<string, unknown>): Promise<void> {
  knobs.flushed.push({ ns, entries: JSON.parse(JSON.stringify(entries)), at: ++knobs.seq });
  validatorStore.set(ns, JSON.parse(JSON.stringify(entries)));
}
export async function flush(ns: string, entries: Record<string, unknown>): Promise<void> { return flushVault(ns, entries); }
export async function signedWriteHeaders(): Promise<Record<string, string>> { return {}; }
export function sealedNamespaces(): Set<string> { return new Set(); }
export function resetEnvelopeBootstrap(): void {}
`,
  // PERSONA SEPARATION FOR WRITES: the device's answers (the vault's persona accounts, the jar's acting persona), steered
  // by R12; the flow asks this module by default (no injection), so a flow that stopped asking would be caught
  "separation.ts": `export const knobs = { own: new Set<number>(), acting: false as boolean, actingSeq: [] as boolean[], ownThrows: false, actingThrows: false, ownAsked: 0, actingAsked: 0 };
export async function ownPersonaAccounts() { knobs.ownAsked++; if (knobs.ownThrows) throw new Error("the vault is unreadable"); return { fids: new Set(knobs.own), names: new Map<number, string | null>() }; }
export async function personaActing() { knobs.actingAsked++; if (knobs.actingThrows) throw new Error("the jar is unreadable"); return knobs.actingSeq.length ? (knobs.actingSeq.shift() as boolean) : knobs.acting; }
`,
  "entry.ts": `export * as flow from "@/lib/fc/rootSigner/flow";
export * as sep from "@/lib/fc/hubRead/separation";
export * as store from "@/lib/fc/rootSigner/store";
export * as config from "@/lib/fc/rootSigner/config";
export * as msg from "@/lib/fc/hub/message";
export * as links from "@/lib/fc/siwf/links";
export * as ks from "@/lib/identity/keystore";
export * as vault from "@/lib/vault/vault";
export * as pins from "@/lib/vault/sealedPins";
export * as route from "@/app/api/fc/root/route";
export * as persistStub from "@/lib/adapters/mock/persist";
export * as nextStub from "next/server";
`,
};
for (const [n, src] of Object.entries(stubs)) writeFileSync(S(n), src);
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
let M;
try {
  const outFile = S("bundle.mjs");
  await build({
    plugins: [mutatePlugin],
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
    alias: { "server-only": S("server-only.ts"), "next/server": S("next-server.ts"), "@/lib/adapters/mock/persist": S("persist.ts"), "@/lib/fc/hubRead/separation": S("separation.ts") },
  });
  M = await import(pathToFileURL(outFile).href);
  if (MUTATIONS.length && applied.size !== MUTATIONS.length) throw new Error("MUTATION FILE NOT IN THE BUNDLE");
} catch (e) {
  console.log("cannot bundle the post-as-you modules: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
const { flow, store, config, msg, links, ks, route, persistStub, nextStub, sep } = M;

// ---------------------------------------------------------------------------------------------------- the network
const hubJs = require(path.join(ROOT, "validator", "hubmessage.js"));
const { startRootPostStubs, SIWF_STUB_FIDS } = await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "farcaster-api-stub.mjs")).href);
const { decodeProto } = await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "farcaster-protocol-stub.mjs")).href);
const net = await startRootPostStubs();
const [USER_FID, OTHER_FID] = SIWF_STUB_FIDS;
for (const k of ["NODE_ENV", "FC_APP_FID", "FC_APP_CUSTODY_KEY", "FC_APP_SPONSOR", "FC_KEY_REQUEST_API_URL", "FC_KEY_REQUEST_TTL_SEC", "FC_HUB_URL", "FC_ANON_FID", "LAYERS_HOSTED", "TRUST_PROXY"]) delete process.env[k];
// the rig shape for the validator: its own per-address caps are measured in validator/test/keyrequest.test.js
process.env.ZK_DEV_HOOKS = "true";
const { createApp } = require(path.join(ROOT, "validator", "server.js"));
const logs = [];
const keepLog = console.log;
const keepWarn = console.warn;
const keepErr = console.error;
const capture = (...a) => logs.push(a.map(String).join(" "));
console.warn = capture;
console.error = capture;
console.log = capture; // the validator's migration lines
const v = createApp(":memory:");
console.log = keepLog;
let vServer;
await new Promise((r) => (vServer = v.app.listen(0, "127.0.0.1", r)));
const VBASE = "http://127.0.0.1:" + vServer.address().port;
const ARM = () => {
  process.env.FC_APP_FID = String(net.appFid);
  process.env.FC_APP_CUSTODY_KEY = net.appKey;
  process.env.FC_KEY_REQUEST_API_URL = net.api.base;
  process.env.FC_HUB_URL = net.protocol.hubUrl;
};
const DISARM = () => {
  delete process.env.FC_APP_FID;
  delete process.env.FC_APP_CUSTODY_KEY;
};

// every request the device makes, recorded; `rewrite` lets a check doctor the validator's answer (R9)
const seen = [];
let rewrite = null;
let clock = Date.now();
const deviceFetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body instanceof Uint8Array ? Buffer.from(init.body).toString("hex") : typeof init.body === "string" ? init.body : "";
  seen.push({ url: u, method: init.method ?? "GET", body, credentials: init.credentials, referrerPolicy: init.referrerPolicy });
  const res = await fetch(url, init);
  if (rewrite && u.startsWith(VBASE)) {
    const r = await rewrite(u, res);
    if (r) return r;
  }
  return res;
};
flow.__setRootPostRuntimeForTests({ device: true, env: { VALIDATOR_URL: VBASE, FC_ROOT_HUB_URL: net.protocol.hubUrl }, fetch: deviceFetch, now: () => clock });
const resetFlow = () => {
  flow.resetRootPost();
  store.resetRootSignerCache();
  rewrite = null;
  clock = Date.now();
};
const errOf = async (p) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};
const signIn = async (fid = USER_FID, fname = "stubalice") => {
  links.resetAccountLinksCache();
  await links.updateAccountLinks(() => ({ v: 1, links: [{ kind: "farcaster", fid, fname, displayName: "Stub Alice", pfpUrl: null, bio: null, personaId: "p_unit_self", authMethod: "custody", signer: "0x" + "ab".repeat(20), nonceHash: "00".repeat(32), messageHash: "11".repeat(32), verifiedAt: Date.now(), verifier: { rpcHost: "stub" }, disconnectedAt: null }] }));
};
const hubCasts = () => [...net.protocol.state.casts.entries()].map(([hash, c]) => ({ hash, ...c }));
const activeKey = async () => (await store.rootSignerView()).signer;
/** start → approve (as the stub would after the user taps Approve) → poll until active */
async function connect() {
  const s1 = await flow.startRootPost();
  assert(s1.state === "pending" && s1.approval, "start did not give an approval: " + JSON.stringify(s1).slice(0, 300));
  net.api.approve("latest", { userFid: USER_FID });
  const s2 = await flow.pollRootPost();
  assert(s2.state === "active", "the approved key did not become active: " + JSON.stringify(s2).slice(0, 300));
  return s2;
}

out("\nPOST AS YOU UNIT — the device's flow, the real validator, loopback Farcaster API + Snapchain stubs" + (MUTATIONS.length ? "  [MUTATED BUNDLE]" : ""));

await check("R1", "the browser's message port is byte-identical to validator/hubmessage.js, and the stub node decodes both", async () => {
  const priv = "3a".repeat(32);
  const ts = Date.UTC(2026, 10, 5, 12);
  const cases = [
    { type: "CastAdd", text: "hello from my own account" },
    { type: "CastAdd", text: "a reply", parent: { fid: 3, hash: "0x" + "ab".repeat(20) } },
    { type: "CastAdd", text: "ünïcödé ✓ 🧪" },
    { type: "CastRemove", targetHash: "0x" + "cd".repeat(20) },
    { type: "ReactionAdd", reaction: "like", target: { fid: 990778, hash: "0x" + "ef".repeat(20) } },
    { type: "ReactionAdd", reaction: "recast", target: { fid: 1, hash: "0x" + "01".repeat(20) } },
    { type: "ReactionRemove", reaction: "like", target: { fid: 990778, hash: "0x" + "ef".repeat(20) } },
  ];
  for (const body of cases) {
    const a = msg.makeMessage({ fid: 990777, timestampMs: ts, body, privateKeyHex: priv });
    const b = hubJs.makeMessage({ fid: 990777, timestampMs: ts, body, privateKey: priv });
    assert(Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes)) === 0 && a.hash === b.hash && a.signer === b.signer, body.type + " differs between the two implementations");
  }
  assert(msg.bodyProblem({ type: "CastAdd", text: "x".repeat(321) }) === "the cast is longer than 320 bytes", "the 320-byte rule");
  assert(msg.bodyProblem({ type: "ReactionAdd", reaction: "boost", target: { fid: 1, hash: "0x" + "00".repeat(20) } }), "an unknown reaction refused");
  // the stub node (its own decoder) accepts a TS-built reply and like for a key it lists
  net.protocol.state.keys.set(990777 + ":" + msg.publicKeyHex(priv), { state: 1, keyType: 1, at: 0 });
  for (const body of [cases[1], cases[4]]) {
    const m = msg.makeMessage({ fid: 990777, body, privateKeyHex: priv });
    const r = await hubJs.submitMessage(net.protocol.hubUrl, m);
    assert(r.ok && r.hash === m.hash, body.type + " refused by the stub node: " + JSON.stringify(r));
  }
  net.protocol.state.keys.delete(990777 + ":" + msg.publicKeyHex(priv));
  return cases.length + " bodies identical";
});

await check("R2", "the hub URL rule and the device hint", async () => {
  const r = config.hubReadUrlRule;
  assert(r("", false).ok && r("", false).url === "https://snap.farcaster.xyz:3381", "the default");
  assert(r("http://127.0.0.1:9999", false).ok && !r("http://127.0.0.1:9999", true).ok, "loopback only off a hosting platform");
  assert(r("https://hub.example.org", false).ok && !r("https://hub.example.org", true).ok, "a bare https origin only off a hosting platform");
  for (const bad of ["https://hub.example.org/v1", "https://u:p@hub.example.org", "https://hub.example.org?key=1", "http://hub.example.org", "ftp://x"]) assert(!r(bad, false).ok, "refused: " + bad);
  assert(JSON.stringify(config.rootPostDeviceHints({}, true)) === "{}", "unset forwards nothing");
  assert(config.rootPostDeviceHints({ FC_ROOT_HUB_URL: "https://hub.example.org?key=secret" }, false).FC_ROOT_POST === "bad_config" && !JSON.stringify(config.rootPostDeviceHints({ FC_ROOT_HUB_URL: "https://hub.example.org?key=secret" }, false)).includes("secret"), "a refused value forwards no URL");
  assert(config.rootPostDeviceHints({ FC_ROOT_HUB_URL: "http://127.0.0.1:4555" }, false).FC_ROOT_HUB_URL === "http://127.0.0.1:4555", "the loopback stub is forwarded");
});

await check("R3", "no server answers: the route refuses 404 device_only BEFORE reading the body (GET and POST)", async () => {
  // this harness has no window, so the route sees a server — exactly the shape a public or rig server is
  const req = new nextStub.NextRequest("http://x/api/fc/root", { method: "POST", body: JSON.stringify({ action: "cast", text: "never" }) });
  const r = await route.POST(req);
  assert(r.status === 404 && r.body.code === "device_only" && req.readCount === 0, "the server read the body or answered: " + JSON.stringify(r.body));
  const g = await route.GET();
  assert(g.status === 404 && g.body.code === "device_only", "GET answered on a server");
  // and the flow's own gate refuses a non-device runtime
  flow.__setRootPostRuntimeForTests({ device: false, env: {}, fetch: deviceFetch, now: () => clock });
  const e = await errOf(flow.rootPostStatus());
  flow.__setRootPostRuntimeForTests({ device: true, env: { VALIDATOR_URL: VBASE, FC_ROOT_HUB_URL: net.protocol.hubUrl }, fetch: deviceFetch, now: () => clock });
  assert(e && e.code === "device_only", "the flow ran outside a device");
});

await check("R4", "before sign-in: not_signed_in; unarmed: not_armed; armed: available with nothing invented", async () => {
  resetFlow();
  links.resetAccountLinksCache();
  persistStub.validatorStore.delete("accountLinks");
  const s0 = await flow.rootPostStatus();
  assert(!s0.available && s0.code === "not_signed_in" && s0.account === null, JSON.stringify(s0));
  await signIn();
  DISARM();
  resetFlow();
  const s1 = await flow.rootPostStatus();
  assert(!s1.available && s1.code === "not_armed" && s1.account.fid === USER_FID && s1.state === "none", JSON.stringify(s1));
  const e = await errOf(flow.startRootPost());
  assert(e && e.code === "not_armed", "start ran unarmed");
  ARM();
  resetFlow();
  const s2 = await flow.rootPostStatus();
  assert(s2.available && s2.code === null && s2.state === "none" && s2.key === null && s2.approval === null && s2.sponsored === false, JSON.stringify(s2));
});

let firstKey = null;
await check("R5", "start: the key is SEALED before the validator hears of it; link + QR; a random key that is no persona's; no private key anywhere", async () => {
  resetFlow();
  ARM();
  await signIn();
  // a persona of the same root exists: its keys must be nothing like the root's posting key
  const persona = ks.createPersona({ name: "Quiet", handle: "quiet_unit", kind: "public" });
  seen.length = 0;
  const flushBefore = persistStub.knobs.flushed.length;
  const s = await flow.startRootPost();
  assert(s.state === "pending" && s.approval && /^farcaster:\/\/signed-key-request\?token=0x[0-9a-f]{24}$/.test(s.approval.url) && s.approval.qr.path.length > 100, JSON.stringify(s).slice(0, 400));
  assert(/^0x[0-9a-f]{64}$/.test(s.key) && s.appFid === net.appFid && s.deadline > Math.floor(Date.now() / 1000), "key / app fid / deadline");
  firstKey = s.key;
  const flushes = persistStub.knobs.flushed.slice(flushBefore).filter((f) => f.ns === "rootSigner");
  const reqIdx = seen.findIndex((x) => x.url.endsWith("/fc/key-request") && x.method === "POST");
  assert(flushes.length >= 2 && reqIdx >= 0, "expected a seal before and after the request");
  // ORDER: the first seal (the pending key, no token) happened before the POST was even built: the POST's body names the
  // key, and that key is in the vault already (decrypt the FIRST flush)
  const firstSealed = M.vault.decryptNamespace("rootSigner", flushes[0].entries)._.m.signer;
  assert(firstSealed && firstSealed.key === s.key && firstSealed.token === null && firstSealed.state === "pending", "the first seal is not the bare pending key");
  assert(JSON.parse(seen[reqIdx].body).key === s.key, "the request names another key");
  // the private half: in the vault only
  const priv = firstSealed.priv;
  const everywhere = [JSON.stringify(s), ...seen.map((x) => x.url + " " + x.body), ...logs, JSON.stringify(net.api.calls), JSON.stringify(net.api.requests)].join("\n").toLowerCase();
  assert(!everywhere.includes(priv), "the private key reached an answer, a request or a log");
  // never a persona's key, never the seed's derivations
  const personaKeys = [ks.fcSignerPublicKey(persona.id), ks.personaPublicKey(persona.id)].filter(Boolean).map((k) => k.toLowerCase());
  assert(!personaKeys.includes(s.key.slice(2)) && !ks.keyMaterialForLeakTest().map((k) => String(k).toLowerCase()).includes(priv), "the root's key is a persona's or the seed's");
  // the device asked the validator without cookies or referrer, and never called Farcaster's API itself
  assert(seen.every((x) => x.credentials === "omit" && x.referrerPolicy === "no-referrer"), "a request carried credentials or a referrer");
  assert(seen.every((x) => !x.url.startsWith(net.api.base)) && net.api.violations.length === 0, "the device called Farcaster's API directly");
  // resuming: a second start while pending re-uses the same request (no second key, no second request)
  const n = net.api.requests.length;
  const again = await flow.startRootPost();
  assert(again.key === s.key && net.api.requests.length === n, "a second start made a new request");
});

await check("R6", "approval: another account refused; a key the node does not list never enabled, then refused; the right account enables it", async () => {
  resetFlow();
  ARM();
  await signIn();
  await flow.cancelRootPost();
  // (a) approved by ANOTHER account in the visitor's Farcaster app
  const a = await flow.startRootPost();
  net.api.approve("latest", { userFid: OTHER_FID });
  const ea = await errOf(flow.pollRootPost());
  assert(ea && ea.code === "other_account", "another account's approval was accepted: " + (ea ? ea.code : "no error"));
  const va = await store.rootSignerView();
  assert(va.signer === null && va.forgotten && va.forgotten.key === a.key && va.forgotten.fid === OTHER_FID, "the key was not forgotten");
  // (b) approved by the right account, but the node never lists the key (it never reached the KeyRegistry)
  const b = await flow.startRootPost();
  assert(b.key !== a.key, "a fresh key after a refusal");
  net.api.approve("latest", { userFid: USER_FID, addKey: false });
  const sb = await flow.pollRootPost();
  assert(sb.state === "pending" && sb.stage === "waiting_for_hub" && (await activeKey()).state === "pending", "not listed, yet enabled: " + JSON.stringify(sb).slice(0, 200));
  const castE = await errOf(flow.castAsRoot("must not post"));
  assert(castE && castE.code === "no_key", "posted with a key the node does not list");
  clock += flow.HUB_GRACE_MS + 1000;
  const eb = await errOf(flow.pollRootPost());
  assert(eb && eb.code === "not_on_hub", "a key the node never listed was not refused: " + (eb ? eb.code : "no error"));
  assert((await store.rootSignerView()).signer === null, "the unlisted key was kept");
  clock = Date.now();
  // (c) the right account, and the node lists it
  const c = await flow.startRootPost();
  const sp = await flow.pollRootPost();
  assert(sp.state === "pending" && sp.stage === "waiting", "a pending request reads as pending");
  net.api.approve("latest", { userFid: USER_FID });
  const sc = await flow.pollRootPost();
  assert(sc.state === "active" && sc.key === c.key && sc.activatedAt && sc.approval === null, JSON.stringify(sc).slice(0, 300));
  const k = await activeKey();
  assert(k.state === "active" && k.token === null && k.deeplinkUrl === null, "the active record still carries the token or link");
  assert(net.protocol.calls.some((x) => x.path === "/v1/onChainSignersByFid"), "the node was never read");
});

await check("R7", "posting: cast, reply, like, recast, delete reach the node signed by the root's key for the root's fid; refusals are errors", async () => {
  resetFlow();
  ARM();
  await signIn();
  const k = (await activeKey()) ?? (await connect(), await activeKey());
  const before = hubCasts().length;
  const c = await flow.castAsRoot("hello, it is me");
  const cast = net.protocol.state.casts.get(c.hash);
  assert(cast && cast.fid === USER_FID && cast.text === "hello, it is me" && c.url === "https://farcaster.xyz/stubalice/" + c.hash.slice(0, 10), "the cast did not land as the root: " + JSON.stringify(c));
  const sub = net.protocol.calls.filter((x) => x.path === "/v1/submitMessage").pop();
  assert(sub && sub.status === 200, "the node's last submit was not accepted");
  // the message's signer IS the root's key (decode what the node stored: the relay forwarded the bytes unchanged)
  const lastBytes = seen.filter((x) => x.url.endsWith("/fc/hub/submit")).pop().body;
  const decoded = hubJs.makeMessage; // presence check only; the signer is checked through the node accepting it for the fid
  void decoded;
  assert(lastBytes.includes(k.key.slice(2)), "the submitted message's signer is not the root's key");
  const reply = await flow.castAsRoot("a reply", { fid: OTHER_FID, hash: "0x" + "cd".repeat(20) });
  assert(net.protocol.state.casts.get(reply.hash).parent.fid === OTHER_FID, "the reply lost its parent");
  const target = { fid: OTHER_FID, hash: "0x" + "cd".repeat(20) };
  const mine = () => [...net.protocol.state.reactions.values()].filter((r) => r.fid === USER_FID && r.target.hash === target.hash);
  await flow.reactAsRoot("like", target);
  await flow.reactAsRoot("recast", target);
  assert(mine().length === 2 && mine().some((r) => r.kind === 1) && mine().some((r) => r.kind === 2), "the like and recast did not land: " + JSON.stringify(mine()));
  await flow.reactAsRoot("like", target, true);
  assert(mine().length === 1 && mine()[0].kind === 2, "the unlike did not land");
  await flow.deleteAsRoot(c.hash);
  assert(net.protocol.state.casts.get(c.hash).removed === true, "the delete did not land");
  const st = await flow.rootPostStatus();
  assert(!st.posted.some((p) => p.hash === c.hash) && st.posted.some((p) => p.hash === reply.hash), "the composer's list is wrong");
  // refusals: too long (nothing sent), empty, and the NODE refusing (the user removed the key in the Farcaster app)
  const n = seen.length;
  const tl = await errOf(flow.castAsRoot("x".repeat(321)));
  assert(tl && tl.code === "too_long" && seen.length === n, "a 321-byte cast was sent or not refused");
  assert((await errOf(flow.castAsRoot("   "))).code === "empty", "an empty cast");
  net.api.removeKey(USER_FID, k.key);
  const hr = await errOf(flow.castAsRoot("after the key was removed"));
  assert(hr && hr.code === "hub_refused" && /invalid signer/.test(hr.message), "the node's refusal was not an error with its words: " + (hr ? hr.message : "no error"));
  assert(hubCasts().length === before + 2, "a refused post landed");
  net.protocol.state.keys.set(USER_FID + ":" + k.key.slice(2), { state: 1, keyType: 1, at: 0 });
  // the relay down: an error, never "posted"
  DISARM();
  const off = await errOf(flow.castAsRoot("relay unarmed"));
  ARM();
  assert(off && off.code === "not_armed", "an unarmed relay read as posted");
});

await check("R8", "an EXPIRED request: no link shown; the poll refuses; the key goes", async () => {
  resetFlow();
  ARM();
  await signIn();
  await flow.disconnectRootPost("DISCONNECT");
  const s = await flow.startRootPost();
  clock = (s.deadline + 5) * 1000;
  const st = await flow.rootPostStatus();
  assert(st.approval === null && st.code === "expired", "an expired link was shown: " + JSON.stringify(st).slice(0, 200));
  const e = await errOf(flow.pollRootPost());
  assert(e && e.code === "expired", "the poll did not refuse");
  assert((await store.rootSignerView()).signer === null, "the expired key was kept");
  // approving AFTER expiry changes nothing here (the device no longer holds the request)
  net.api.approve("latest", { userFid: USER_FID });
  clock = Date.now();
  const after = await flow.rootPostStatus();
  assert(after.state === "none", "an expired request came back to life");
});

await check("R9", "untrusted answers: a WRONG requestFid, an EXPIRED deadline, a foreign link, another key — refused, nothing shown; Farcaster refuses a mis-configured requestFid", async () => {
  ARM();
  await signIn();
  const doctor = (patch) => async (u, res) => {
    if (!u.endsWith("/fc/key-request") || res.status !== 201) return null;
    const j = await res.json();
    return new Response(JSON.stringify({ ...j, ...patch(j) }), { status: 201, headers: { "content-type": "application/json" } });
  };
  for (const [label, patch] of [
    ["a wrong requestFid", (j) => ({ requestFid: j.requestFid + 1 })],
    ["an expired deadline", () => ({ deadline: Math.floor(Date.now() / 1000) - 30 })],
    ["a deadline more than a day away", () => ({ deadline: Math.floor(Date.now() / 1000) + 3 * 86400 })],
    ["a foreign link", (j) => ({ deeplinkUrl: "https://evil.example/approve?token=" + j.token })],
    ["another key", () => ({ key: "0x" + "77".repeat(32) })],
  ]) {
    resetFlow();
    await flow.cancelRootPost();
    rewrite = doctor(patch);
    const e = await errOf(flow.startRootPost());
    rewrite = null;
    assert(e && e.code === "bad_answer", label + " was accepted: " + (e ? e.code : "no error"));
    const st = await flow.rootPostStatus();
    assert(st.approval === null && st.state === "none", label + ": a link was shown anyway");
  }
  // the validator configured with the wrong fid: Farcaster itself refuses (the signature recovers to another custody)
  resetFlow();
  process.env.FC_APP_FID = String(OTHER_FID);
  const e = await errOf(flow.startRootPost());
  ARM();
  assert(e && e.code === "farcaster" && /does not recover/.test(e.message), "a wrong requestFid was not refused by Farcaster: " + (e ? e.message : "no error"));
});

await check("R10", "disconnect: DISCONNECT typed; the key forgotten, its public half kept; how to remove it; posting refused after", async () => {
  resetFlow();
  ARM();
  await signIn();
  if (!(await activeKey()) || (await activeKey()).state !== "active") {
    await flow.cancelRootPost();
    await connect();
  }
  const k = await activeKey();
  const e = await errOf(flow.disconnectRootPost("disconnect"));
  assert(e && e.code === "confirm_required" && (await activeKey()).state === "active", "a lowercase confirm disconnected");
  const d = await flow.disconnectRootPost("DISCONNECT");
  assert(d.state === "none" && d.forgotten && d.forgotten.key === k.key && /Connected apps/.test(d.removeHow), JSON.stringify(d).slice(0, 300));
  const doc = M.vault.decryptNamespace("rootSigner", persistStub.validatorStore.get("rootSigner"))._.m;
  assert(doc.signer === null && !JSON.stringify(doc).includes(k.key.slice(2).slice(0, 0) + "priv"), "the private key is still sealed");
  const pe = await errOf(flow.castAsRoot("after disconnect"));
  assert(pe && pe.code === "no_key", "posted after a disconnect");
  // a disconnected ACCOUNT (Sign in with Farcaster tombstoned) cannot start either
  await links.updateAccountLinks((doc2) => ({ v: 1, links: doc2.links.map((l) => ({ ...l, disconnectedAt: Date.now() })) }));
  resetFlow();
  const ds = await errOf(flow.startRootPost());
  assert(ds && ds.code === "disconnected_account", "a disconnected account could start");
  await signIn();
});

await check("R11", "the vault: exactly 1,024 bytes with and without a key; uniform presence once; a doctored record refused", async () => {
  const ctLen = (entries) => {
    assert(Object.keys(entries).length === 1 && entries._ && /^[0-9a-f]+$/.test(entries._.ct), "not one opaque hex record");
    return entries._.ct.length / 2;
  };
  const empty = store.sealRootSignerDoc({ v: 1, signer: null, forgotten: null });
  const pair = store.newRootKeyPair();
  const full = store.sealRootSignerDoc({ v: 1, signer: { fid: 2 ** 40, priv: pair.priv, key: pair.key, appFid: 2 ** 40, state: "pending", token: "0x" + "a".repeat(158), deeplinkUrl: "https://client.farcaster.xyz/deeplinks/signed-key-request?token=" + "0x" + "a".repeat(158) + "&x=" + "b".repeat(70), deadline: 2 ** 31, createdAt: Date.now(), activatedAt: Date.now() }, forgotten: { key: pair.key, fid: 2 ** 40, at: Date.now() } });
  assert(ctLen(empty) === ctLen(full) && ctLen(empty) === store.ROOT_SIGNER_BYTES, "sizes differ: " + ctLen(empty) + " / " + ctLen(full));
  // a deleted-but-PINNED namespace is refused (this device sealed it before), never read as "no key"
  persistStub.validatorStore.delete("rootSigner");
  store.resetRootSignerCache();
  const pinned = await errOf(store.rootSignerView());
  assert(pinned && /EMPTY on the validator but this device has sealed it before/.test(pinned.message), "a deleted namespace read as fresh");
  // uniform presence: a root that never sealed it (pins reset, as a seed reset does) seals the empty record ONCE
  M.pins.resetSealedPins();
  store.resetRootSignerCache();
  const n0 = persistStub.knobs.flushed.filter((f) => f.ns === "rootSigner").length;
  const r1 = await store.ensureRootSignerNamespace();
  const r2 = await store.ensureRootSignerNamespace();
  assert(r1 === "sealed" && r2 === "present" && persistStub.knobs.flushed.filter((f) => f.ns === "rootSigner").length === n0 + 1, r1 + " " + r2);
  // a doctored record (its key is not its private key's public half) is refused, never posted with
  const other = store.newRootKeyPair();
  persistStub.validatorStore.set("rootSigner", store.sealRootSignerDoc({ v: 1, signer: { fid: USER_FID, priv: pair.priv, key: other.key, appFid: 1, state: "active", token: null, deeplinkUrl: null, deadline: 1, createdAt: 1, activatedAt: 1 }, forgotten: null }));
  store.resetRootSignerCache();
  resetFlow();
  const e = await errOf(flow.castAsRoot("doctored"));
  assert(e && e.code === "vault", "a doctored record was used: " + (e ? e.code : "no error"));
  persistStub.validatorStore.set("rootSigner", store.sealRootSignerDoc({ v: 1, signer: null, forgotten: null }));
  store.resetRootSignerCache();
});

await check("R12", "PERSONA SEPARATION FOR WRITES: a like / recast / reply / undo / delete reaches the relay as exactly the message the root's key signs; while a persona acts nothing is signed or sent; nothing targets an own persona fid", async () => {
  resetFlow();
  ARM();
  await signIn();
  sep.knobs.own = new Set();
  sep.knobs.acting = false;
  sep.knobs.actingSeq = [];
  sep.knobs.ownThrows = sep.knobs.actingThrows = false;
  let k = await activeKey();
  if (!k || k.state !== "active") {
    await flow.cancelRootPost();
    await connect();
    k = await activeKey();
  }
  const priv = M.vault.decryptNamespace("rootSigner", persistStub.validatorStore.get("rootSigner"))._.m.signer.priv;
  assert(/^[0-9a-f]{64}$/.test(priv) && "0x" + msg.publicKeyHex(priv) === k.key, "the sealed key is not the active one");
  const OWN = 991_777;
  const target = { fid: OTHER_FID, hash: "0x" + "a1".repeat(20) };
  const ownTarget = { fid: OWN, hash: "0x" + "b2".repeat(20) };
  const submits = () => seen.filter((x) => x.url === VBASE + "/fc/hub/submit");
  const reactions = () => [...(net.protocol.state.reactions ?? new Map()).values()].filter((r) => r.fid === USER_FID);
  /** the last bytes that reached the relay, decoded, and re-built from the root's key: they must be the same bytes */
  const lastIs = (body, label) => {
    const hex = submits().pop().body;
    const bytes = Buffer.from(hex, "hex");
    const m = decodeProto(bytes);
    const d = decodeProto(m[7][0]);
    assert(Number(d[2][0]) === USER_FID, label + ": signed for fid " + d[2][0]);
    assert(Buffer.from(m[6][0]).toString("hex") === k.key.slice(2), label + ": the signer is not the root's key");
    const rebuilt = msg.makeMessage({ fid: USER_FID, timestampMs: msg.FARCASTER_EPOCH_MS + Number(d[3][0]) * 1000, body, privateKeyHex: priv });
    assert(Buffer.compare(Buffer.from(rebuilt.bytes), bytes) === 0, label + ": the bytes at the relay are not the message the root's key signs for that body");
    return d;
  };
  // (a) the right bytes, and the node holds the result
  const like = await flow.reactAsRoot("like", target);
  const dl = lastIs({ type: "ReactionAdd", reaction: "like", target }, "like");
  assert(Number(dl[1][0]) === 3 && like.hash && reactions().some((r) => r.kind === 1 && r.target.hash === target.hash && r.target.fid === target.fid), "the like did not land as a REACTION_ADD of type LIKE");
  await flow.reactAsRoot("recast", target);
  lastIs({ type: "ReactionAdd", reaction: "recast", target }, "recast");
  assert(reactions().some((r) => r.kind === 2 && r.target.hash === target.hash), "the recast did not land");
  await flow.reactAsRoot("like", target, true);
  const du = lastIs({ type: "ReactionRemove", reaction: "like", target }, "unlike");
  assert(Number(du[1][0]) === 4 && !reactions().some((r) => r.kind === 1 && r.target.hash === target.hash), "the unlike did not land as a REACTION_REMOVE");
  await flow.reactAsRoot("recast", target, true);
  lastIs({ type: "ReactionRemove", reaction: "recast", target }, "unrecast");
  assert(!reactions().some((r) => r.target.hash === target.hash), "the unrecast did not land");
  const reply = await flow.castAsRoot("a reply from a hub card", target);
  lastIs({ type: "CastAdd", text: "a reply from a hub card", parent: target }, "reply");
  assert(net.protocol.state.casts.get(reply.hash)?.parent?.hash === target.hash, "the reply lost its parent");
  await flow.deleteAsRoot(reply.hash);
  lastIs({ type: "CastRemove", targetHash: reply.hash }, "delete");
  assert(net.protocol.state.casts.get(reply.hash).removed === true, "the delete did not land");
  // (b) a persona acting: every write refused with acting_persona, nothing signed or sent, nothing new on the node
  const n0 = seen.length;
  const casts0 = net.protocol.state.casts.size;
  const r0 = reactions().length;
  sep.knobs.acting = true;
  for (const [label, p] of [
    ["a cast", () => flow.castAsRoot("as the root while a persona acts")],
    ["a reply", () => flow.castAsRoot("a reply while a persona acts", target)],
    ["a like", () => flow.reactAsRoot("like", target)],
    ["a recast", () => flow.reactAsRoot("recast", target)],
    ["an unlike", () => flow.reactAsRoot("like", target, true)],
    ["a delete", () => flow.deleteAsRoot(reply.hash)],
  ]) {
    const e = await errOf(p());
    assert(e && e.code === "acting_persona" && e.status === 409 && /acting as a persona/.test(e.message), label + " while a persona acts: " + (e ? e.code : "it was sent"));
  }
  assert(seen.length === n0 && net.protocol.state.casts.size === casts0 && reactions().length === r0, seen.length - n0 + " request(s) left while a persona acted");
  // an unreadable jar counts as acting
  sep.knobs.acting = false;
  sep.knobs.actingThrows = true;
  const ej = await errOf(flow.reactAsRoot("like", target));
  sep.knobs.actingThrows = false;
  assert(ej && ej.code === "acting_persona" && seen.length === n0, "an unreadable jar let a like go: " + (ej ? ej.code : "sent"));
  // a switch to a persona WHILE the message is being signed: the last word stops it before the bytes leave
  sep.knobs.actingSeq = [false, true];
  const es = await errOf(flow.reactAsRoot("like", target));
  sep.knobs.actingSeq = [];
  assert(es && es.code === "acting_persona" && seen.length === n0, "a switch during signing let the like go: " + (es ? es.code : "sent"));
  // (c) an own persona's cast is never liked, recast or replied to as the root
  sep.knobs.own = new Set([OWN]);
  for (const [label, p] of [
    ["a like", () => flow.reactAsRoot("like", ownTarget)],
    ["a recast", () => flow.reactAsRoot("recast", ownTarget)],
    ["an unlike", () => flow.reactAsRoot("like", ownTarget, true)],
    ["a reply", () => flow.castAsRoot("replying to my own persona", ownTarget)],
  ]) {
    const e = await errOf(p());
    assert(e && e.code === "own_persona" && e.status === 403, label + " of an own persona's cast: " + (e ? e.code : "it was sent"));
  }
  assert(seen.length === n0, "a write naming an own persona left the tab");
  // the persona list unreadable: a write with a target does not go; a top-level cast (no target) still does
  sep.knobs.ownThrows = true;
  const eo = await errOf(flow.reactAsRoot("like", target));
  assert(eo && eo.code === "vault" && seen.length === n0, "an unreadable persona list let a like go: " + (eo ? eo.code : "sent"));
  const top = await flow.castAsRoot("a top-level post names no other account");
  sep.knobs.ownThrows = false;
  assert(net.protocol.state.casts.get(top.hash), "a top-level post was refused with no target to check");
  await flow.deleteAsRoot(top.hash);
  assert(sep.knobs.ownAsked > 0 && sep.knobs.actingAsked > 0, "the flow never asked the separation module (the guard would be vacuous)");
  sep.knobs.own = new Set();
  return "6 bodies byte-identical at the relay; 6 writes refused while acting, 0 requests; 4 own-persona targets refused";
});

if (!MUTATIONS.length && ONLY.length === 0) {
  const F = "lib/fc/rootSigner/flow.ts";
  const runs = [
    ["the approving account is not checked", "R6", [{ file: F, find: "    if (userFid !== null && userFid !== acct.fid) {", replace: "    if (false) {" }]],
    ["the node's listing is not checked", "R6", [{ file: F, find: "      active = await keyActiveOnHub(rt, acct.fid, s.key);", replace: "      active = true;" }]],
    ["the answer's requestFid is not checked", "R9", [{ file: F, find: "j.requestFid !== app.appFid || ", replace: "" }]],
    ["the answer's deadline is not checked", "R9", [{ file: F, find: "deadline <= nowS + 60 || ", replace: "" }]],
    ["the approval link's host is not checked", "R9", [{ file: F, find: "  return u.protocol === \"https:\" && APPROVAL_LINK_HOSTS.includes(u.hostname.toLowerCase());", replace: "  return true;" }]],
    ["an expired pending request still shows its link", "R8", [{ file: F, find: "    const expired = s.deadline * 1000 <= rt.now();", replace: "    const expired = false;" }]],
    ["the key is sent before it is sealed", "R5", [{ file: F, find: "      await seal((doc) => ({ ...doc, signer: { fid: acct.fid, priv: p.priv, key: p.key, appFid: app.appFid as number, state: \"pending\", token: null, deeplinkUrl: null, deadline: 0, createdAt: rt.now(), activatedAt: null } }));", replace: "      void p;" }]],
    ["the node's refusal is swallowed as posted", "R7", [{ file: F, find: "  if (res.status !== 200 || !j || j.ok !== true) {", replace: "  if (false) {" }]],
    ["a disconnect without the typed word", "R10", [{ file: F, find: '  if (confirm !== "DISCONNECT") throw new RootPostError("confirm_required");', replace: "" }]],
    ["a doctored vault record is used", "R11", [{ file: "lib/fc/rootSigner/store.ts", find: '  if ("0x" + publicKeyHex(r.priv) !== r.key) throw new Error', replace: '  if (false) throw new Error' }]],
    ["the route reads the body on a server", "R3", [{ file: "app/api/fc/root/route.ts", find: '  // FIRST, before the body is read: no server holds or uses the root\'s key\n  if (typeof window === "undefined") return deviceOnly();', replace: "  await req.json().catch(() => null);\n  if (typeof window === \"undefined\") return deviceOnly();" }]],
    // PERSONA SEPARATION FOR WRITES
    ["a root write goes out while a persona acts", "R12", [{ file: F, find: '  if (acting) throw new RootPostError("acting_persona");', replace: "" }]],
    ["no last word: a switch during signing lets the write go", "R12", [{ file: F, find: "  // the last word before the bytes leave: a switch to a persona while this was being signed stops it\n  await notActing(rt);", replace: "" }]],
    ["an unreadable jar counts as not acting", "R12", [{ file: F, find: "    acting = true; // unknown: nothing goes out as the root", replace: "    acting = false;" }]],
    ["an own persona's cast is liked as the root", "R12", [{ file: F, find: '  if (own.has(target.fid)) throw new RootPostError("own_persona");', replace: "" }]],
    ["a reply's parent is not checked against the personas", "R12", [{ file: F, find: '  if (body.type === "CastAdd") return body.parent ?? null;', replace: '  if (body.type === "CastAdd") return null;' }]],
    ["an unreadable persona list lets a targeted write go", "R12", [{ file: F, find: "    throw new RootPostError(\"vault\"); // the list cannot be read: a write naming another account does not go", replace: "    return;" }]],
  ];
  await check("M", "MUTATIONS: each guard removed in the bundle only — the check that covers it FAILS (" + runs.length + " mutations)", async () => {
    const survived = [];
    for (const [label, target, muts] of runs) {
      const r = spawnSync(process.execPath, [SELF, "--only=" + (target === "R5" || target === "R3" ? target : "R4,R5," + target)], {
        cwd: ROOT,
        env: { ...process.env, ROOTPOST_MUTATION: JSON.stringify(muts), ROOTPOST_UNIT_QUIET: "1", KEYSTORE_DIR: "" },
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

console.log = keepLog;
console.warn = keepWarn;
console.error = keepErr;
vServer.close();
await net.close();
rmSync(tmp, { recursive: true, force: true });
const summary = `${passed}/${passed + failed} post-as-you unit checks passed` + (failed ? ` — FAILED: ${failedIds.join(",")}` : "");
console.log((QUIET ? "" : "\n") + summary);
process.exit(failed ? 1 : 0);
