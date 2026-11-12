// PERSONA LAUNCH P1 (SIWF) — THE SIGN IN WITH FARCASTER VERIFIER, FLOW, SEALED RECORD AND ROUTE, CALLED DIRECTLY.
//
// research/spec-siwf-passkey-first-2026-10-08.txt TESTS A, plus the plan delta (U10) and the accountLinks discipline
// (U11). Bundles lib/fc/siwf/{verify,flow,links}.ts, lib/identity/{rootHeadshot,mainName,keystore}.ts and
// app/api/fc/siwf/route.ts with esbuild (the unit-connector.mjs recipe: `server-only` shimmed, next/server stubbed,
// the validator replaced by an in-memory stub of lib/adapters/mock/persist.ts). The keystore, the vault cipher, the
// sealed pins and the recovery roster are the REAL modules, on a temporary KEYSTORE_DIR.
//
// THE NETWORK IS FAKE AND CLOSED: fetch is replaced by an in-process Farcaster relay (POST /v1/channel, GET
// /v1/channel/status with a Bearer token) and an Optimism JSON-RPC (eth_chainId; eth_call for IdRegistry.idOf,
// KeyRegistry.keyDataOf and the ERC-6492 universal validator, deployless or at an address). ANY other URL fails the
// run. Real keys (viem) sign real SIWE messages (viem/siwe createSiweMessage).
//
//   U1  custody positive control: verifies; the sealed record has exactly the allowed keys (no signature, message, ip,
//       token, custody, verifications); the public self persona is minted ONCE across two finishes (a failed seal, then
//       the retry); the recovery roster and the device roster carry publicSelf
//   U2  auth-address positive control (keyDataOf keyType 2, state 1): verified, one keyDataOf, zero idOf
//   U3  the refusal matrix (every code; one case per message field): each asserts the code, NO accountLinks flush and
//       NO public-self persona; the chain-unavailable cases recover on retry and seal exactly one record
//   U4  RPC accounting: the EOA path makes ZERO RPC calls for the signature and exactly one idOf; a contract-wallet
//       signature makes the ERC-6492 call
//   U5  the relay and RPC URL rules (and the server's device hints): refused values make NO fetch and are never echoed
//   U6  the server refusal: a public server answers 404 device_only WITHOUT reading the body (a body that throws on
//       read); the rig answers (positive control); the owner service refuses with its sentence
//   U7  no token, signature, message text or signer address in any thrown or answered message, or any log line
//   U8  REFERENCE CROSS-CHECK against @farcaster/auth-client 0.7.1 verifySignInMessage (devDependency; never bundled)
//   U9  accountLinks: the empty and the one-link record seal to the same 1,024 ciphertext bytes
//   U10 rootHeadshot(): the sealed facts; null after a disconnect; THROWS on an unreadable namespace (device and owner)
//   U11 accountLinks discipline: a deleted-but-pinned namespace is refused; a failed seal adopts nothing; a 409 re-reads
//       first; the uniform-presence seal happens once
//   U13 THE INLINE SAVE AND THE CARD'S CLOCK (review UX-13..16; components/device/SaveMoment.tsx + FarcasterSignIn.tsx,
//       a second bundle): saveWithPasskey asks custody.status() first and, while the ways-in list is unknown (or the
//       status cannot be read, or says nothing), refuses "paused" WITHOUT reaching savePasskey (the OS prompt); no
//       WebAuthn is refused the same way; custody's errors become plain words; the wrap-path sentence and the strip's
//       keep note never say "24 words" or "anywhere"; pollStep makes exactly ONE final poll past the deadline;
//       shownSession shows a still-open request past its deadline as expired with no QR, and words it as the device does
//   U14 THE LANDING PROMISE (review UX-7): siwfOfferedHere() is true only where the device offers the sign-in live
//       (FC_SIWF "on"), and Landing.tsx renders landing-siwf only behind it
//   M   MUTATIONS: each guard is removed in the BUNDLE ONLY (the repo is never touched) and the check that covers it must
//       then fail — a check that cannot fail is not evidence
//
//   node scripts/unit-siwf.mjs                (npm run test:siwf-unit)
//   node scripts/unit-siwf.mjs --only=U3,U9   (a subset; the mutation runs use this)
//   SIWF_MUTATION='[{"file":"…","find":"…","replace":"…"}]' node scripts/unit-siwf.mjs --only=U10
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
const viem = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const { createSiweMessage } = require("viem/siwe");

const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length).split(",").filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const MUTATIONS = process.env.SIWF_MUTATION ? JSON.parse(process.env.SIWF_MUTATION) : [];
const QUIET = process.env.SIWF_UNIT_QUIET === "1";

let passed = 0;
let failed = 0;
const failedIds = [];
function out(line) {
  if (!QUIET) console.log(line);
}
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

// ---------------------------------------------------------------------------------------------------- the bundle
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-siwf-unit-"));
const KS_DIR = path.join(tmp, "keystore");
process.env.KEYSTORE_DIR = KS_DIR; // the REAL keystore and sealed pins live here (read at module load)
const S = (name) => path.join(tmp, name);
const stubs = {
  "server-only.ts": "export {};\n",
  "next-server.ts": `export class NextResponse {
  status: number; body: unknown; headers: Record<string, string>;
  constructor(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) { this.status = init.status ?? 200; this.body = body; this.headers = init.headers ?? {}; }
  static json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) { return new NextResponse(body, init); }
}
export class NextRequest {
  nextUrl: URL; method: string; private raw: string | undefined;
  constructor(url: string, init: { method?: string; body?: string } = {}) { this.nextUrl = new URL(url); this.method = init.method ?? "GET"; this.raw = init.body; }
  async json() { return JSON.parse(this.raw ?? ""); }
  async text() { return this.raw ?? ""; }
}
`,
  "persist.ts": `export const validatorStore = new Map<string, Record<string, unknown>>();
export const knobs = { failReads: 0, emptyAs200: true, failFlushFor: {} as Record<string, number>, conflictOnce: null as null | { ns: string; before: () => void }, flushed: [] as { ns: string; entries: Record<string, unknown> }[], reads: 0 };
export async function fetchState(ns: string): Promise<{ status: number; ok: boolean; json: () => Promise<any> }> {
  knobs.reads++;
  if (knobs.failReads > 0) { knobs.failReads--; return { status: 503, ok: false, json: async () => ({ error: "down" }) }; }
  const entries = validatorStore.get(ns);
  if (!entries) return knobs.emptyAs200 ? { status: 200, ok: true, json: async () => ({ entries: {} }) } : { status: 404, ok: false, json: async () => ({}) };
  return { status: 200, ok: true, json: async () => ({ entries: JSON.parse(JSON.stringify(entries)) }) };
}
export async function flushVault(ns: string, entries: Record<string, unknown>): Promise<void> {
  if (knobs.conflictOnce && knobs.conflictOnce.ns === ns) { const c = knobs.conflictOnce; knobs.conflictOnce = null; c.before(); throw new Error('vault flush of "' + ns + '" was refused by the validator: HTTP 409'); }
  if ((knobs.failFlushFor[ns] ?? 0) > 0) { knobs.failFlushFor[ns]--; throw new Error('vault flush of "' + ns + '" was refused by the validator: HTTP 503'); }
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
  // lib/fc/personaFid.ts reaches these lazily (record checks the harness never makes); stubbed so the bundle does not
  // pull the seeded world in behind them
  "personaKind.ts": `export type PersonaKind = "public" | "private" | "unknown";
export function kindOf(): PersonaKind { return "public"; }
`,
  "keys.ts": `export function isKeystoreRootedPersona(): boolean { return false; }
export function fcSignerPublicKeyFor(): string | null { return null; }
`,
  "zk-config.ts": `export function zkMode(): string { return "fixture"; }
export function anonSnapshot(): null { return null; }
`,
  "entry.ts": `export * as verify from "@/lib/fc/siwf/verify";
export * as flow from "@/lib/fc/siwf/flow";
export * as links from "@/lib/fc/siwf/links";
export * as headshot from "@/lib/identity/rootHeadshot";
export * as mainName from "@/lib/identity/mainName";
export * as ks from "@/lib/identity/keystore";
export * as vault from "@/lib/vault/vault";
export * as pins from "@/lib/vault/sealedPins";
export * as pf from "@/lib/fc/personaFid";
export * as route from "@/app/api/fc/siwf/route";
export * as persistStub from "@/lib/adapters/mock/persist";
export * as rosterStub from "@/lib/identity/rootRoster";
export * as nextStub from "next/server";
`,
};
for (const [name, src] of Object.entries(stubs)) writeFileSync(S(name), src);

// PERSONA LAUNCH P1 (review UX-13..16): the UI half — the inline save's gate and words (components/device/
// SaveMoment.tsx) and the sign-in card's clock (components/device/FarcasterSignIn.tsx) — is a SECOND bundle (JSX,
// next/link stubbed: nothing here renders, the pure helpers are called directly). React itself is bundled in.
writeFileSync(S("next-link.ts"), "export default function Link(_props: unknown): null { return null; }\n");
writeFileSync(
  S("ui-entry.ts"),
  `export * as moment from "@/components/device/SaveMoment";
export * as card from "@/components/device/FarcasterSignIn";
`
);

// MUTATION TESTING: rewrites a source file IN THE BUNDLE ONLY. An anchor that does not match aborts the run. Applied
// mutations are counted across BOTH bundles (a UI-file mutation is in the second one), and checked after both.
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
let M;
let UI;
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
    // the storage layer require()s node:fs: an ESM bundle needs a real require
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
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
  M = await import(pathToFileURL(outFile).href);
  const uiFile = S("ui-bundle.mjs");
  await build({
    plugins: [mutatePlugin],
    absWorkingDir: ROOT,
    entryPoints: [S("ui-entry.ts")],
    outfile: uiFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT, "tsconfig.json"),
    jsx: "automatic", // tsconfig says "preserve" (Next compiles JSX itself); node needs it compiled
    logLevel: "error",
    nodePaths: [path.join(ROOT, "node_modules")],
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
    alias: { "next/link": S("next-link.ts") },
  });
  UI = await import(pathToFileURL(uiFile).href);
  if (MUTATIONS.length && mutationsApplied.size !== MUTATIONS.length) throw new Error("MUTATION FILE NOT IN THE BUNDLE");
} catch (e) {
  console.log("cannot bundle the Sign in with Farcaster modules: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
const { verify, flow, links, headshot, mainName, ks, vault, pins, pf, route, persistStub, rosterStub, nextStub } = M;
for (const [n, f] of Object.entries({
  verifySiwf: verify.verifySiwf,
  startSiwf: flow.startSiwf,
  pollSiwf: flow.pollSiwf,
  siwfStatus: flow.siwfStatus,
  relayUrlRule: flow.relayUrlRule,
  rpcUrlRule: flow.rpcUrlRule,
  siwfDeviceHints: flow.siwfDeviceHints,
  mainLink: links.mainLink,
  sealAccountLinksDoc: links.sealAccountLinksDoc,
  rootHeadshot: headshot.rootHeadshot,
  GET: route.GET,
  POST: route.POST,
  siwfOfferedHere: flow.siwfOfferedHere,
  saveWithPasskey: UI.moment.saveWithPasskey,
  plainSaveError: UI.moment.plainSaveError,
  passkeySavedSentence: UI.moment.passkeySavedSentence,
  pollStep: UI.card.pollStep,
  shownSession: UI.card.shownSession,
})) {
  if (typeof f !== "function") {
    console.log(`the Sign in with Farcaster modules no longer export ${n} — this harness cannot run`);
    process.exit(2);
  }
}

out("\nSIWF UNIT — Sign in with Farcaster, called in-process (fake relay + fake Optimism RPC; no request leaves)" + (MUTATIONS.length ? "  [MUTATED BUNDLE]" : ""));

// ---------------------------------------------------------------------------------------------------- the fake network
const RELAY = "https://relay.farcaster.xyz";
const RPC = "https://mainnet.optimism.io";
const ORIGIN = "https://app.example.test";
const HOST = "app.example.test";
const lc = (s) => String(s ?? "").toLowerCase();
const ID_REG = lc(verify.ID_REGISTRY);
const KEY_REG = lc(verify.KEY_REGISTRY);
const VALIDATOR_BYTECODE = lc(viem.erc6492SignatureValidatorByteCode);

const net = {
  relays: new Set([RELAY]),
  rpcs: new Set([RPC]),
  channels: new Map(),
  calls: [], // every request: { kind, method?, url }
  unexpected: [],
  channelUrl: (token) => "https://farcaster.xyz/~/siwf?channelToken=" + token,
  echoNonce: null, // override the relay's echoed nonce
  relayDown: 0,
  rpcDown: 0, // transport failures
  rpcErrorOnce: null, // a JSON-RPC error object for the next call
  chainId: "0xa",
  custody: new Map(), // address -> fid
  keyData: new Map(), // `${fid}|${address}` -> { state, keyType }
  wallets: new Map(), // contract wallet address -> owner EOA address
  badIdOf: false,
  reset() {
    this.channels.clear();
    this.calls = [];
    this.unexpected = [];
    this.channelUrl = (token) => "https://farcaster.xyz/~/siwf?channelToken=" + token;
    this.echoNonce = null;
    this.relayDown = 0;
    this.rpcDown = 0;
    this.rpcErrorOnce = null;
    this.chainId = "0xa";
    this.badIdOf = false;
    this.relays = new Set([RELAY]);
    this.rpcs = new Set([RPC]);
  },
};
const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rpcCalls = (pred) => net.calls.filter((c) => c.kind === "rpc" && pred(c)).length;

function decodeCall(call) {
  const to = lc(call.to);
  const data = lc(call.data);
  if (to === ID_REG) {
    const d = viem.decodeFunctionData({ abi: verify.ID_REGISTRY_ABI, data });
    return { what: "idOf", address: lc(d.args[0]) };
  }
  if (to === KEY_REG) {
    const d = viem.decodeFunctionData({ abi: verify.KEY_REGISTRY_ABI, data });
    return { what: "keyDataOf", fid: Number(d.args[0]), key: lc(d.args[1]) };
  }
  if (!to && data.startsWith(VALIDATOR_BYTECODE)) {
    const [signer, hash, sig] = viem.decodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "bytes" }], "0x" + data.slice(VALIDATOR_BYTECODE.length));
    return { what: "6492", signer: lc(signer), hash, sig };
  }
  if (to && data.startsWith(lc(viem.encodeFunctionData({ abi: viem.erc6492SignatureValidatorAbi, functionName: "isValidSig", args: [viem.zeroAddress, viem.zeroHash, "0x"] })).slice(0, 10))) {
    const d = viem.decodeFunctionData({ abi: viem.erc6492SignatureValidatorAbi, data });
    return { what: "6492", signer: lc(d.args[0]), hash: d.args[1], sig: d.args[2], at: to };
  }
  return { what: "other" };
}

async function contractValid(signer, hash, sig) {
  // the fake smart account: valid iff the first 65 bytes recover to its owner and the signature is 97 bytes long;
  // a plain EOA (not a wallet) is checked the way the real universal validator does: ecrecover
  const raw = lc(sig).slice(2);
  try {
    if (net.wallets.has(signer)) {
      if (raw.length !== 194) return false;
      const rec = lc(await viem.recoverAddress({ hash, signature: "0x" + raw.slice(0, 130) }));
      return rec === net.wallets.get(signer);
    }
    if (raw.length !== 130) return false;
    return lc(await viem.recoverAddress({ hash, signature: sig })) === signer;
  } catch {
    return false;
  }
}

async function rpcAnswer(body) {
  const { id, method, params } = body;
  const call = method === "eth_call" ? decodeCall(params[0] ?? {}) : { what: method };
  net.calls.push({ kind: "rpc", method, what: call.what });
  if (net.rpcDown > 0) {
    net.rpcDown--;
    return jsonRes(502, { error: "down" });
  }
  if (net.rpcErrorOnce) {
    const error = net.rpcErrorOnce;
    net.rpcErrorOnce = null;
    return jsonRes(200, { jsonrpc: "2.0", id, error });
  }
  if (method === "eth_chainId") return jsonRes(200, { jsonrpc: "2.0", id, result: net.chainId });
  if (method === "eth_blockNumber") return jsonRes(200, { jsonrpc: "2.0", id, result: "0x10" });
  if (method === "eth_getCode") return jsonRes(200, { jsonrpc: "2.0", id, result: "0x" });
  if (method !== "eth_call") return jsonRes(200, { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
  if (call.what === "idOf") {
    if (net.badIdOf) return jsonRes(200, { jsonrpc: "2.0", id, result: "0x1234" });
    const fid = net.custody.get(call.address) ?? 0;
    return jsonRes(200, { jsonrpc: "2.0", id, result: viem.encodeFunctionResult({ abi: verify.ID_REGISTRY_ABI, functionName: "idOf", result: BigInt(fid) }) });
  }
  if (call.what === "keyDataOf") {
    const address = "0x" + call.key.slice(-40);
    const kd = net.keyData.get(call.fid + "|" + address) ?? { state: 0, keyType: 0 };
    return jsonRes(200, { jsonrpc: "2.0", id, result: viem.encodeFunctionResult({ abi: verify.KEY_REGISTRY_ABI, functionName: "keyDataOf", result: kd }) });
  }
  if (call.what === "6492") {
    const ok = await contractValid(call.signer, call.hash, call.sig);
    if (call.at) return jsonRes(200, { jsonrpc: "2.0", id, result: viem.encodeFunctionResult({ abi: viem.erc6492SignatureValidatorAbi, functionName: "isValidSig", result: ok }) });
    return jsonRes(200, { jsonrpc: "2.0", id, result: ok ? "0x01" : "0x00" });
  }
  return jsonRes(200, { jsonrpc: "2.0", id, error: { code: 3, message: "execution reverted" } });
}

async function fakeFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const method = String(init.method || "GET").toUpperCase();
  const u = new URL(url);
  const headers = new Headers(init.headers || {});
  if (net.rpcs.has(u.origin) && (u.pathname === "/" || u.pathname === "")) {
    if (method !== "POST") throw new Error("rpc: not a POST");
    const body = JSON.parse(init.body);
    if (Array.isArray(body)) throw new Error("rpc: batching is not expected");
    return rpcAnswer(body);
  }
  if (net.relays.has(u.origin)) {
    net.calls.push({ kind: "relay", method, path: u.pathname, url, credentials: init.credentials, referrerPolicy: init.referrerPolicy, auth: headers.get("authorization") });
    if (u.search) net.unexpected.push("relay request with a query: " + url);
    if (method === "POST" && u.pathname === "/v1/channel") {
      const b = JSON.parse(init.body);
      const token = "unit-token-" + viem.toHex(globalThis.crypto.getRandomValues(new Uint8Array(10))).slice(2);
      needles.add(token); // EVERY token the relay ever mints is a needle, whether or not a wallet completed its channel
      net.channels.set(token, { ...b, completed: null });
      return jsonRes(201, { channelToken: token, url: net.channelUrl(token), nonce: net.echoNonce ?? b.nonce });
    }
    if (method === "GET" && u.pathname === "/v1/channel/status") {
      if (net.relayDown > 0) {
        net.relayDown--;
        return jsonRes(503, { error: "down" });
      }
      const token = (headers.get("authorization") || "").replace(/^Bearer /, "");
      const ch = net.channels.get(token);
      if (!ch) return jsonRes(401, { error: "unknown channel" });
      if (!ch.completed) return jsonRes(202, { state: "pending", nonce: ch.nonce, url: net.channelUrl(token) });
      return jsonRes(200, ch.completed);
    }
  }
  net.unexpected.push(method + " " + url);
  throw new Error("UNEXPECTED NETWORK CALL: " + method + " " + url);
}
const realFetch = globalThis.fetch; // U12 only: to the in-process loopback stub on an ephemeral port
globalThis.fetch = fakeFetch;

// ---------------------------------------------------------------------------------------------------- the visitor
const logs = [];
let clockOffset = 0;
const now = () => Date.now() + clockOffset;
function deviceRuntime(env = { FC_SIWF: "on" }) {
  flow.__setSiwfRuntimeForTests({ device: true, env, fetch: fakeFetch, now, log: (l) => logs.push(l) });
}
const answers = []; // every thrown or answered message, for U7
function seen(x) {
  answers.push(typeof x === "string" ? x : JSON.stringify(x));
  return x;
}

// keys: A = custody of fid 990777 ("alice"); B = alice's auth address; C = a stranger; D = owner of a smart wallet W
const keyA = generatePrivateKey();
const keyB = generatePrivateKey();
const keyC = generatePrivateKey();
const keyD = generatePrivateKey();
const keyE = generatePrivateKey(); // custody of fid 990888 ("bob")
const A = privateKeyToAccount(keyA);
const B = privateKeyToAccount(keyB);
const C = privateKeyToAccount(keyC);
const D = privateKeyToAccount(keyD);
const E = privateKeyToAccount(keyE);
const W = "0x" + "77".repeat(20);
const ALICE = { fid: 990777, username: "alice", displayName: "Alice Example", pfpUrl: "https://i.imgur.com/alice.png", bio: "hello" };
const BOB = { fid: 990888, username: "bob", displayName: "Bob", pfpUrl: null, bio: null };
function chainReset() {
  net.custody = new Map([
    [lc(A.address), ALICE.fid],
    [lc(E.address), BOB.fid],
    [lc(W), ALICE.fid],
  ]);
  net.keyData = new Map([[ALICE.fid + "|" + lc(B.address), { state: 1, keyType: 2 }]]);
  net.wallets = new Map([[lc(W), lc(D.address)]]);
}
const needles = new Set(); // tokens, signatures, message lines and addresses — U7 greps every answer for them
for (const acc of [A, B, C, D, E]) {
  needles.add(lc(acc.address));
  needles.add(acc.address);
}

/** the wallet side: complete the newest channel with a doctored (or honest) signed message */
async function authenticate(opts = {}) {
  const [token, ch] = [...net.channels.entries()].at(-1);
  const who = opts.as ?? ALICE;
  const signerAcc = opts.signerAccount ?? A;
  const address = opts.address ?? signerAcc.address;
  const fields = {
    domain: opts.domain ?? ch.domain,
    address,
    statement: opts.statement === undefined ? "Farcaster Auth" : opts.statement,
    uri: opts.uri ?? ch.siweUri,
    version: "1",
    chainId: opts.chainId ?? 10,
    nonce: opts.messageNonce ?? ch.nonce,
    issuedAt: new Date(now() + (opts.issuedOffsetMs ?? 0)),
    ...(opts.noExpiration ? {} : { expirationTime: opts.expirationTime ?? new Date(ch.expirationTime) }),
    ...(opts.notBefore ? { notBefore: opts.notBefore } : {}),
    resources: opts.resources ?? [`farcaster://fid/${who.fid}`],
  };
  let message = createSiweMessage(fields);
  if (opts.editMessage) message = opts.editMessage(message);
  let signature;
  if (opts.contractWallet) {
    const s = await D.signMessage({ message });
    signature = s + "00".repeat(32); // 97 bytes: the fake smart account's format
  } else {
    signature = await (opts.signWith ?? signerAcc).signMessage({ message });
  }
  needles.add(token);
  needles.add(signature);
  needles.add(signature.slice(2, 66));
  needles.add(message.split("\n")[0]);
  ch.completed = {
    state: "completed",
    nonce: opts.statusNonce ?? ch.nonce,
    url: net.channelUrl(token),
    message: opts.dropMessage ? undefined : message,
    signature: opts.dropSignature ? undefined : signature,
    authMethod: opts.authMethod ?? "custody",
    fid: opts.statusFid ?? who.fid,
    username: who.username,
    displayName: who.displayName,
    pfpUrl: who.pfpUrl,
    bio: who.bio,
    custody: lc(A.address),
    verifications: ["0x" + "99".repeat(20)],
    metadata: { ip: "203.0.113.9", userAgent: "UnitAgent/1.0" },
    signatureParams: { siweUri: ch.siweUri, domain: ch.domain, nonce: ch.nonce },
  };
  return { token, message, signature };
}

/** a clean slate: the stub validator, the caches, the session, the keystore's public selves, the fake network */
function resetAll() {
  persistStub.validatorStore.clear();
  persistStub.knobs.failReads = 0;
  persistStub.knobs.emptyAs200 = true;
  persistStub.knobs.failFlushFor = {};
  persistStub.knobs.conflictOnce = null;
  persistStub.knobs.flushed.length = 0;
  rosterStub.rosterCalls.length = 0;
  links.resetAccountLinksCache();
  pf.resetPersonaFidCache();
  pins.resetSealedPins();
  flow.resetSiwf();
  for (const p of ks.listPersonas()) if (p.publicSelf) dropPersona(p.id);
  for (const p of ks.listPersonas()) if (!["you_unit", "private_unit"].includes(p.handle)) dropPersona(p.id);
  net.reset();
  chainReset();
  clockOffset = 0;
  deviceRuntime();
}
function dropPersona(id) {
  // the keystore has no delete: rebuild it from the same seed without that persona (a rig-only shortcut)
  const seed = ks.rootMaterialForLeakTest()[0];
  ks.restoreFromRecovery(seed, ks.listPersonas().filter((p) => p.id !== id));
}
const publicSelves = () => ks.listPersonas().filter((p) => p.publicSelf === true);
const linkFlushes = () => persistStub.knobs.flushed.filter((f) => f.ns === "accountLinks");

async function start() {
  const req = new nextStub.NextRequest(ORIGIN + "/api/fc/siwf", { method: "POST", body: JSON.stringify({ action: "start" }) });
  const res = await route.POST(req);
  seen(res.body);
  return res;
}
async function post(body) {
  const res = await route.POST(new nextStub.NextRequest(ORIGIN + "/api/fc/siwf", { method: "POST", body: JSON.stringify(body) }));
  seen(res.body);
  return res;
}
async function poll() {
  const s = flow.__siwfSessionIdForTests?.() ?? (await flow.siwfStatus()).session?.id;
  return post({ action: "poll", sessionId: s });
}
/** start, authenticate as the wallet, poll once: the session view after that poll */
async function signIn(opts = {}) {
  const st = await start();
  if (st.status !== 200) return { start: st, view: null };
  await authenticate(opts);
  const p = await poll();
  return { start: st, view: p.body, res: p };
}

// the identity this harness boots: two ordinary personas
ks.createPersona({ name: "You", handle: "you_unit", kind: "public" });
ks.createPersona({ name: "You, privately", handle: "private_unit", kind: "private" });
resetAll();

// ---------------------------------------------------------------------------------------------------- U1
const ALLOWED_LINK_KEYS = ["kind", "fid", "fname", "displayName", "pfpUrl", "bio", "personaId", "authMethod", "signer", "nonceHash", "messageHash", "verifiedAt", "verifier", "disconnectedAt"].sort();
function storedLinks() {
  const entries = persistStub.validatorStore.get("accountLinks");
  if (!entries) return null;
  const plain = vault.decryptNamespace("accountLinks", entries);
  return plain._?.m ?? null;
}

await check("U1", "custody positive control: verified; the sealed record carries only the allowed keys; the public self is minted ONCE across a failed seal and its retry; both rosters carry publicSelf", async () => {
  resetAll();
  persistStub.knobs.failFlushFor = { accountLinks: 1 }; // the first seal fails: verified, kept in memory, retried
  const st0 = await start();
  assert(st0.status === 200, "start answered " + st0.status + " " + JSON.stringify(st0.body).slice(0, 160));
  assert(st0.body?.session?.approval?.qr?.path && !JSON.stringify(st0.body).includes("unit-token-"), "the start view lacks the QR or carries the token");
  // the phone link is ASKED for (it carries the channel token): an allowlisted Farcaster host
  const ap = await route.POST(new nextStub.NextRequest(ORIGIN + "/api/fc/siwf", { method: "POST", body: JSON.stringify({ action: "approval", sessionId: st0.body.session.id }) }));
  assert(ap.status === 200 && (ap.body?.url ?? "").startsWith("https://farcaster.xyz/"), "the approval link: " + ap.status + " " + JSON.stringify(ap.body).slice(0, 100));
  await authenticate();
  const r = { start: st0, view: (await poll()).body };
  assert(r.view?.session?.stage === "checking" && r.view.session.code === "siwf_seal", "a failed seal is not 'verified but not saved': " + JSON.stringify(r.view?.session));
  const mintedOnce = publicSelves();
  assert(mintedOnce.length === 1, "the first finish minted " + mintedOnce.length + " public self persona(s)");
  const second = (await poll()).body;
  assert(second.session?.stage === "verified", "the retry did not verify: " + JSON.stringify(second.session));
  assert(second.moment === "signed-in", "the verifying answer does not carry the signed-in moment");
  assert(publicSelves().length === 1 && publicSelves()[0].id === mintedOnce[0].id, "the retry minted another persona");
  const p = publicSelves()[0];
  assert(p.nonce === "siwf-main/v1|" + ALICE.fid && p.handle === "alice" && p.kind === "public", "persona shape: " + JSON.stringify({ nonce: p.nonce, handle: p.handle, kind: p.kind }));
  const doc = storedLinks();
  assert(doc && doc.v === 1 && doc.links.length === 1, "no sealed link: " + JSON.stringify(doc));
  const l = doc.links[0];
  const keys = Object.keys(l).sort();
  assert(JSON.stringify(keys) === JSON.stringify(ALLOWED_LINK_KEYS), "the sealed link's keys are not exactly the allowed set: " + keys.join(","));
  assert(l.fid === ALICE.fid && l.fname === "alice" && l.personaId === p.id && l.authMethod === "custody" && l.signer === lc(A.address) && l.disconnectedAt === null, "link facts: " + JSON.stringify(l));
  assert(/^[0-9a-f]{64}$/.test(l.nonceHash) && /^[0-9a-f]{64}$/.test(l.messageHash), "the hashes are not sha256 hex");
  const sealedPlain = JSON.stringify(doc);
  for (const banned of ["203.0.113.9", "UnitAgent", "99".repeat(20), "wants you to sign in", "unit-token-"]) assert(!sealedPlain.includes(banned), "the sealed record carries " + banned);
  assert(!sealedPlain.includes([...needles].find((n) => /^0x[0-9a-f]{130}$/i.test(n)) ?? "zz"), "the sealed record carries a signature");
  // the recovery roster (identityRoster, real syncRoster) and the device roster both name the public self
  const roster = vault.decryptNamespace("identityRoster", persistStub.validatorStore.get("identityRoster"))._?.m ?? {};
  assert(roster[p.id]?.publicSelf === true, "the sealed recovery roster does not carry publicSelf");
  const rc = rosterStub.rosterCalls.filter((c) => c.id === p.id);
  assert(rc.length >= 1 && rc[0].rec?.publicSelf === true && rc[0].rootId === "root_unit", "the device roster record lacks publicSelf: " + JSON.stringify(rc));
  const st = (await flow.siwfStatus());
  assert(st.link?.fname === "alice" && st.link?.disconnected === false && !("signer" in st.link), "the status view: " + JSON.stringify(st.link));
  return `persona ${p.handle} minted once over 2 finishes; record keys = ${keys.length}, ${linkFlushes().length} accountLinks seal(s)`;
});

// ---------------------------------------------------------------------------------------------------- U2
await check("U2", "auth-address positive control: keyDataOf (keyType 2, state 1) verifies — one keyDataOf, zero idOf", async () => {
  resetAll();
  const r = await signIn({ signerAccount: B, authMethod: "authAddress" });
  assert(r.view?.session?.stage === "verified", "not verified: " + JSON.stringify(r.view?.session));
  const kd = rpcCalls((c) => c.what === "keyDataOf");
  const io = rpcCalls((c) => c.what === "idOf");
  assert(kd === 1 && io === 0, `keyDataOf ${kd}, idOf ${io}`);
  assert(storedLinks()?.links[0]?.authMethod === "authAddress", "the record does not say authAddress");
  return "1 keyDataOf, 0 idOf";
});

// ---------------------------------------------------------------------------------------------------- U3
/** a refusal: the code, no accountLinks flush, no public self persona */
async function refusedWith(code, opts, how = "poll") {
  resetAll();
  if (opts.before) await opts.before();
  const flushesBefore = linkFlushes().length;
  const selvesBefore = publicSelves().length;
  let got;
  if (how === "start") {
    const st = await start();
    got = st.body?.code;
    assert(st.status >= 400, code + ": start answered " + st.status);
    assert(!st.body?.session, code + ": a refused start left a session");
  } else {
    const r = await signIn(opts);
    assert(r.start.status === 200, code + ": start answered " + r.start.status + " " + JSON.stringify(r.start.body).slice(0, 120));
    got = r.view?.session?.code;
    if (code !== "siwf_chain_unavailable") assert(r.view?.session?.stage === "refused", code + ": stage " + r.view?.session?.stage);
  }
  assert(got === code, `expected ${code}, got ${got}`);
  assert(linkFlushes().length === flushesBefore, code + ": an accountLinks record was sealed");
  assert(publicSelves().length === selvesBefore, code + ": a public self persona was minted");
}

await check("U3", "the refusal matrix: every code, one case per message field; nothing sealed, nothing minted; chain-unavailable recovers on retry and seals exactly one record", async () => {
  const cases = [];
  const run = async (label, code, opts, how) => {
    await refusedWith(code, opts, how);
    cases.push(label);
  };
  // the positive control first: an untouched sign-in verifies (without it every refusal below is vacuous)
  resetAll();
  assert((await signIn()).view?.session?.stage === "verified", "the positive control did not verify");
  // 2, 3: the relay's channel
  await run("url host", "siwf_url", { before: () => void (net.channelUrl = (t) => "https://evil.example/siwf?channelToken=" + t) }, "start");
  await run("url scheme", "siwf_url", { before: () => void (net.channelUrl = (t) => "javascript:alert(1)//" + t) }, "start");
  await run("relay nonce", "siwf_message", { before: () => void (net.echoNonce = "NotOurNonce12345") }, "start");
  // 5: completed without message / signature
  await run("no message", "siwf_message", { dropMessage: true });
  await run("no signature", "siwf_message", { dropSignature: true });
  // 6: every SIWE field
  await run("domain", "siwf_message", { domain: "evil.example" });
  await run("uri origin", "siwf_message", { uri: "https://evil.example/device" });
  await run("statement (legacy)", "siwf_message", { statement: "Farcaster Connect" });
  await run("statement missing", "siwf_message", { statement: null });
  await run("version", "siwf_message", { editMessage: (m) => m.replace("\nVersion: 1\n", "\nVersion: 2\n") });
  await run("chain id", "siwf_message", { chainId: 1 });
  await run("message nonce", "siwf_message", { messageNonce: "OtherNonce000000" });
  await run("status nonce", "siwf_message", { statusNonce: "OtherNonce000000" });
  await run("no fid resource", "siwf_message", { resources: ["https://example.com/x"] });
  await run("two fid resources", "siwf_message", { resources: [`farcaster://fid/${ALICE.fid}`, `farcaster://fid/${ALICE.fid}`] });
  await run("prose fids form", "siwf_message", { resources: [`farcaster://fids/${ALICE.fid}`] });
  await run("resource fid ≠ status fid", "siwf_message", { statusFid: BOB.fid });
  await run("issued 11 min ago", "siwf_message", { issuedOffsetMs: -11 * 60_000 });
  await run("issued 3 min ahead", "siwf_message", { issuedOffsetMs: 3 * 60_000 });
  await run("expired", "siwf_message", { expirationTime: new Date(Date.now() - 1000) });
  await run("expiry past our deadline", "siwf_message", { expirationTime: new Date(Date.now() + 60 * 60_000) });
  await run("not before (future)", "siwf_message", { notBefore: new Date(Date.now() + 60_000) });
  // 7: the signature
  await run("EOA recovers to another", "siwf_signature", { signWith: C });
  // a smart-account signature its wallet rejects (the wallet's owner is C; D signed)
  await run("contract wallet says no", "siwf_signature", { address: W, contractWallet: true, before: () => void net.wallets.set(lc(W), lc(C.address)) });
  // 9: the chain says another account
  await run("idOf another fid", "siwf_fid_mismatch", { signerAccount: E, as: { ...ALICE } });
  await run("keyDataOf state 0", "siwf_fid_mismatch", { signerAccount: B, authMethod: "authAddress", before: () => void net.keyData.set(ALICE.fid + "|" + lc(B.address), { state: 0, keyType: 2 }) });
  await run("keyDataOf keyType 1", "siwf_fid_mismatch", { signerAccount: B, authMethod: "authAddress", before: () => void net.keyData.set(ALICE.fid + "|" + lc(B.address), { state: 1, keyType: 1 }) });
  await run("unknown authMethod", "siwf_fid_mismatch", { authMethod: "magic" });
  // 10: one main per root — a live link refuses a start; a tombstone refuses another account
  await run("one main (live)", "siwf_one_main", {
    before: async () => {
      await signIn();
      flow.resetSiwf();
    },
  }, "start");
  await run("one main (tombstone, another fid)", "siwf_one_main", {
    signerAccount: E,
    as: BOB,
    before: async () => {
      await signIn();
      await post({ action: "disconnect", confirm: "DISCONNECT" });
      persistStub.knobs.flushed.length = 0;
    },
  });
  // 11: a persona sharing the name's stem refuses the sign-in (rename it first)
  await run("handle stem", "siwf_handle_stem", { before: () => void ks.createPersona({ name: "Alice two", handle: "alice2", kind: "public" }) });
  // 12: a linked device cannot add an account
  {
    resetAll();
    const seed = ks.rootMaterialForLeakTest()[0];
    const keep = ks.listPersonas();
    ks.installLinkedRoot({ anchorPubHex: "ab".repeat(32), rootId: "root_linked", vaultKeyHex: "cd".repeat(32), zkMasterHex: null, delegation: null, personaKeys: {} }, []);
    try {
      const st = await start();
      assert(st.status === 409 && st.body?.code === "siwf_linked_device", "a linked device was not refused: " + st.status + " " + st.body?.code);
      assert(net.calls.length === 0, "a linked device made a request");
    } finally {
      ks.restoreFromRecovery(seed, keep);
    }
    cases.push("linked device");
  }
  // 8: the chain could not be read — retryable; the SAME approval seals exactly one record once the chain answers
  const chainCases = [
    ["rpc unreachable", () => void (net.rpcDown = 2)],
    ["JSON-RPC error", () => void (net.rpcErrorOnce = { code: -32000, message: "header not found" })],
    ["wrong chain id", () => void (net.chainId = "0x1")],
    ["undecodable idOf", () => void (net.badIdOf = true)],
  ];
  for (const [label, arm] of chainCases) {
    resetAll();
    assert((await start()).status === 200, label + ": start");
    await authenticate();
    arm();
    const first = (await poll()).body;
    assert(first.session?.code === "siwf_chain_unavailable" && first.session.retryable === true && first.session.stage !== "verified", label + ": " + JSON.stringify(first.session));
    assert(linkFlushes().length === 0 && publicSelves().length === 0, label + ": something was recorded on an unchecked chain");
    net.chainId = "0xa";
    net.badIdOf = false;
    const retry = (await poll()).body;
    assert(retry.session?.stage === "verified", label + ": the retry did not verify: " + JSON.stringify(retry.session));
    assert(linkFlushes().length === 1 && publicSelves().length === 1, label + `: ${linkFlushes().length} seal(s), ${publicSelves().length} persona(s) after the retry`);
    cases.push(label + " (recovered)");
  }
  return cases.length + " cases: " + cases.join(", ");
});

// ---------------------------------------------------------------------------------------------------- U4
await check("U4", "RPC accounting: an EOA signature costs ZERO RPC calls and the custody check exactly one idOf; a contract-wallet signature makes the ERC-6492 call", async () => {
  resetAll();
  const r = await signIn();
  assert(r.view?.session?.stage === "verified", "EOA path not verified");
  const rpc = net.calls.filter((c) => c.kind === "rpc");
  const sixes = rpc.filter((c) => c.what === "6492").length;
  const idOf = rpc.filter((c) => c.what === "idOf").length;
  const other = rpc.filter((c) => !["6492", "idOf", "eth_chainId"].includes(c.what) && c.method !== "eth_chainId");
  assert(sixes === 0, sixes + " ERC-6492 call(s) for an EOA signature");
  assert(idOf === 1, idOf + " idOf calls");
  assert(other.length === 0, "unexpected RPC calls: " + JSON.stringify(other));
  assert(rpc.filter((c) => c.method === "eth_chainId").length === 1, "eth_chainId not read exactly once");
  // relay hygiene: credentials omitted, no referrer, the token only in the Authorization header
  const relay = net.calls.filter((c) => c.kind === "relay");
  assert(relay.length >= 2 && relay.every((c) => c.credentials === "omit" && c.referrerPolicy === "no-referrer"), "a relay request carried credentials or a referrer");
  assert(relay.filter((c) => c.path === "/v1/channel/status").every((c) => /^Bearer unit-token-/.test(c.auth || "")), "a status read lacked the Bearer token");
  assert(net.unexpected.length === 0, "unexpected: " + net.unexpected.join(" | "));
  // the second session reuses the chain check (eth_chainId once per session's process memory)
  resetAll();
  const w = await signIn({ address: W, contractWallet: true });
  assert(w.view?.session?.stage === "verified", "the contract-wallet path did not verify: " + JSON.stringify(w.view?.session));
  const six = net.calls.filter((c) => c.kind === "rpc" && c.what === "6492").length;
  assert(six === 1, six + " ERC-6492 calls for a contract-wallet signature");
  return `EOA: 0 signature calls + 1 idOf + 1 chainId; contract wallet: ${six} ERC-6492 call`;
});

// ---------------------------------------------------------------------------------------------------- U5
await check("U5", "relay and RPC URL rules: defaults, loopback, a bare https RPC origin pass; keyed, userinfo, query, path, non-loopback relays and anything non-default on a hosted platform are refused BY NAME with no request", async () => {
  const ok = (r) => r.ok;
  const rows = [
    ["relay default", flow.relayUrlRule("", false), true],
    ["relay default spelled", flow.relayUrlRule("https://relay.farcaster.xyz/", false), true],
    ["relay loopback http", flow.relayUrlRule("http://127.0.0.1:4321", false), true],
    ["relay localhost https", flow.relayUrlRule("https://localhost:4321/", false), true],
    ["relay elsewhere", flow.relayUrlRule("https://relay.example.com", false), false],
    ["relay with path", flow.relayUrlRule("http://127.0.0.1:4321/v1", false), false],
    ["relay userinfo", flow.relayUrlRule("http://u:p@127.0.0.1:4321", false), false],
    ["relay query", flow.relayUrlRule("http://127.0.0.1:4321/?x=1", false), false],
    ["relay loopback on hosted", flow.relayUrlRule("http://127.0.0.1:4321", true), false],
    ["relay default on hosted", flow.relayUrlRule("", true), true],
    ["rpc default", flow.rpcUrlRule("", false), true],
    ["rpc bare https origin", flow.rpcUrlRule("https://rpc.example.org", false), true],
    ["rpc loopback http", flow.rpcUrlRule("http://127.0.0.1:4321", false), true],
    ["rpc keyed path", flow.rpcUrlRule("https://opt-mainnet.g.alchemy.com/v2/SECRETKEY123", false), false],
    ["rpc keyed query", flow.rpcUrlRule("https://rpc.example.org/?apikey=SECRETKEY123", false), false],
    ["rpc userinfo", flow.rpcUrlRule("https://SECRETKEY123@rpc.example.org", false), false],
    ["rpc plain http elsewhere", flow.rpcUrlRule("http://rpc.example.org", false), false],
    ["rpc https origin on hosted", flow.rpcUrlRule("https://rpc.example.org", true), false],
  ];
  const wrong = rows.filter(([, r, expect]) => ok(r) !== expect).map(([l]) => l);
  assert(!wrong.length, "wrong verdicts: " + wrong.join(", "));
  // in the device: a refused relay or RPC makes NO request and the status says bad_config
  for (const [name, value] of [["FC_SIWF_RELAY_URL", "https://relay.example.com"], ["FC_SIWF_RPC_URL", "https://opt-mainnet.g.alchemy.com/v2/SECRETKEY123"]]) {
    resetAll();
    logs.length = 0;
    deviceRuntime({ FC_SIWF: "on", [name]: value });
    const st = await flow.siwfStatus();
    assert(st.available === false && st.code === "bad_config", name + ": status " + JSON.stringify(st).slice(0, 120));
    const s = await start();
    assert(s.status === 503 && s.body?.code === "bad_config", name + ": start answered " + s.status);
    assert(net.calls.length === 0, name + ": " + net.calls.length + " request(s) made");
    assert(logs.some((l) => l === `[siwf] bad_config (${name})`), name + ": no log line naming the variable: " + JSON.stringify(logs));
    assert(!JSON.stringify([st, s.body, logs]).includes("SECRETKEY123") && !JSON.stringify([st, s.body, logs]).includes("relay.example.com"), name + ": the refused value was echoed");
  }
  // a loopback relay set by the server is used, and only it
  resetAll();
  net.relays = new Set(["http://127.0.0.1:4321"]);
  net.rpcs = new Set(["http://127.0.0.1:4321"]);
  deviceRuntime({ FC_SIWF: "on", FC_SIWF_RELAY_URL: "http://127.0.0.1:4321", FC_SIWF_RPC_URL: "http://127.0.0.1:4321" });
  const loop = await signIn();
  assert(loop.view?.session?.stage === "verified", "the loopback stub path did not verify: " + JSON.stringify(loop.view?.session));
  // the SERVER's hints: what the page is handed
  const hints = (env) => flow.siwfDeviceHints(env);
  const h1 = hints({ NODE_ENV: "production", FC_SIWF_RPC_URL: "https://opt-mainnet.g.alchemy.com/v2/SECRETKEY123" });
  assert(h1.FC_SIWF === "bad_config" && h1.FC_SIWF_BAD === "FC_SIWF_RPC_URL" && !JSON.stringify(h1).includes("SECRETKEY123"), "keyed RPC hint: " + JSON.stringify(h1));
  const h2 = hints({ NODE_ENV: "production", RAILWAY_ENVIRONMENT: "production", FC_SIWF_RELAY_URL: "http://127.0.0.1:4321" });
  assert(h2.FC_SIWF === "bad_config" && !("FC_SIWF_RELAY_URL" in h2), "hosted loopback hint: " + JSON.stringify(h2));
  const h3 = hints({ NODE_ENV: "production", FC_SIWF_RELAY_URL: "http://127.0.0.1:4321", FC_SIWF_RPC_URL: "http://127.0.0.1:4321" });
  assert(h3.FC_SIWF === "on" && h3.FC_SIWF_RELAY_URL === "http://127.0.0.1:4321" && h3.FC_SIWF_RPC_URL === "http://127.0.0.1:4321", "local stub hint: " + JSON.stringify(h3));
  const h4 = hints({ NODE_ENV: "production" });
  assert(JSON.stringify(h4) === JSON.stringify({ FC_SIWF: "on" }), "default hint: " + JSON.stringify(h4));
  const h5 = hints({ NODE_ENV: "production", FC_SIWF: "off" });
  assert(h5.FC_SIWF === "off", "off hint: " + JSON.stringify(h5));
  return rows.length + " URL rules, 2 device refusals with 0 requests, 5 server hints";
});

// ---------------------------------------------------------------------------------------------------- U6
await check("U6", "the server refusal: a public server answers 404 device_only WITHOUT reading the body; the rig answers (positive control); the owner service refuses with its sentence", async () => {
  resetAll();
  flow.__setSiwfRuntimeForTests(null); // a Node server, not the device (no window here)
  const saved = { NODE_ENV: process.env.NODE_ENV, ZK_DEV_HOOKS: process.env.ZK_DEV_HOOKS, OWNER_ACCESS_SECRET: process.env.OWNER_ACCESS_SECRET, LAYERS_WORLD: process.env.LAYERS_WORLD };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  try {
    // positive control: the rig (hooks, no owner secret) answers start in fixture mode — it READS the body
    process.env.NODE_ENV = "production";
    process.env.ZK_DEV_HOOKS = "true";
    delete process.env.OWNER_ACCESS_SECRET;
    delete process.env.LAYERS_WORLD;
    const rig = await route.POST(new nextStub.NextRequest("http://localhost:3001/api/fc/siwf", { method: "POST", body: JSON.stringify({ action: "start" }) }));
    assert(rig.status === 200 && rig.body?.mode === "fixture" && rig.body?.session?.stage === "pending", "the rig did not answer start: " + rig.status + " " + JSON.stringify(rig.body).slice(0, 160));
    flow.resetSiwf();
    // the public server: 404 before the body is touched
    delete process.env.ZK_DEV_HOOKS;
    let read = 0;
    const trap = {
      nextUrl: new URL("https://app.example.test/api/fc/siwf"),
      method: "POST",
      json: async () => {
        read++;
        throw new Error("the body was read");
      },
      text: async () => {
        read++;
        throw new Error("the body was read");
      },
      get body() {
        read++;
        throw new Error("the body was read");
      },
    };
    const res = await route.POST(trap);
    assert(res.status === 404 && res.body?.code === "device_only", "public POST answered " + res.status + " " + JSON.stringify(res.body));
    assert(read === 0, "the body was read " + read + " time(s)");
    const g = await route.GET();
    assert(g.status === 404 && g.body?.code === "device_only", "public GET answered " + g.status);
    // the owner service
    process.env.ZK_DEV_HOOKS = "true";
    process.env.OWNER_ACCESS_SECRET = "x".repeat(32);
    const own = await route.POST(new nextStub.NextRequest("https://owner.example.test/api/fc/siwf", { method: "POST", body: JSON.stringify({ action: "start" }) }));
    assert(own.status === 403 && own.body?.code === "owner" && /Settings > Connect your Farcaster account/.test(own.body?.error), "owner service: " + own.status + " " + JSON.stringify(own.body));
    return "rig 200 fixture; public 404 device_only with 0 body reads (POST and GET); owner 403";
  } finally {
    restore();
    deviceRuntime();
  }
});

// ---------------------------------------------------------------------------------------------------- U9
await check("U9", "accountLinks: the empty record and a one-link record (worst-case fields) seal to the same 1,024 ciphertext bytes; so does the record a sign-in sealed", async () => {
  const ctBytes = (entries) => {
    const keys = Object.keys(entries);
    assert(keys.length === 1 && keys[0] === "_", "not one opaque record: " + keys.join(","));
    return entries._.ct.length / 2;
  };
  const empty = ctBytes(links.sealAccountLinksDoc({ v: 1, links: [] }));
  const big = links.fitLink({
    kind: "farcaster",
    fid: 999999999999,
    fname: "a-very-long-ens-name-that-is-allowed.eth",
    displayName: "Ünïcödé 🌈 ".repeat(10),
    pfpUrl: "https://imagedelivery.net/" + "x".repeat(220),
    bio: "🌈".repeat(160),
    personaId: "p_" + "f".repeat(32),
    authMethod: "authAddress",
    signer: "0x" + "ab".repeat(20),
    nonceHash: "c".repeat(64),
    messageHash: "d".repeat(64),
    verifiedAt: 1_760_000_000_000,
    verifier: { rpcHost: "mainnet.optimism.io" },
    disconnectedAt: 1_760_000_000_000,
  });
  const one = ctBytes(links.sealAccountLinksDoc({ v: 1, links: [big] }));
  assert(empty === 1024 && one === 1024, `empty ${empty} bytes, one link ${one} bytes`);
  resetAll();
  await signIn();
  const stored = ctBytes(persistStub.validatorStore.get("accountLinks"));
  assert(stored === 1024, "the sealed sign-in record is " + stored + " bytes");
  return "empty 1024, one worst-case link 1024, a real sign-in's record 1024";
});

// ---------------------------------------------------------------------------------------------------- U10
await check("U10", "rootHeadshot(): the signed-in account's fname/displayName/pfp from the sealed record; null after a disconnect; THROWS on an unreadable namespace (device), and the owner service's connected record the same way", async () => {
  resetAll();
  assert((await headshot.rootHeadshot()) === null, "a root with no link has a headshot");
  await signIn();
  const h = await headshot.rootHeadshot();
  assert(h && h.source === "farcaster" && h.fname === "alice" && h.displayName === "Alice Example" && h.pfpUrl === ALICE.pfpUrl, "headshot: " + JSON.stringify(h));
  assert(!JSON.stringify(h).includes(String(ALICE.fid)), "the headshot carries the fid");
  await post({ action: "disconnect", confirm: "DISCONNECT" });
  assert((await headshot.rootHeadshot()) === null, "a disconnected main still has a headshot");
  // unreadable: the cache dropped, every read fails
  links.resetAccountLinksCache();
  persistStub.knobs.failReads = 99;
  let threw = false;
  try {
    await headshot.rootHeadshot();
  } catch {
    threw = true;
  }
  persistStub.knobs.failReads = 0;
  assert(threw, "an unreadable namespace answered a headshot (null-as-empty) instead of throwing");
  // a pinned namespace the operator deleted: refused, never "no headshot"
  links.resetAccountLinksCache();
  persistStub.validatorStore.delete("accountLinks");
  threw = false;
  try {
    await headshot.rootHeadshot();
  } catch {
    threw = true;
  }
  assert(threw, "a deleted-but-pinned namespace answered a headshot");
  // the owner service: the connected publicSelf record (lib/fc/personaFid.ts), on a Node server
  resetAll();
  flow.__setSiwfRuntimeForTests(null);
  const persona = ks.createPersona({ name: "Owner Main", handle: "owner_main", kind: "public", avatarUrl: "https://i.imgur.com/o.png" });
  const rec = { personaId: persona.id, fid: 4242, fname: "ownermain", origin: "connected", custodyAddress: "0x" + "11".repeat(20), signer: { kind: "neynar-managed", uuid: "u", derivedPubHex: "00".repeat(32), derivedRegistered: true }, registrant: "owner", funder: "owner", createdAt: 1, mode: "fixture", connected: { publicSelf: true, requestFid: 1, requestSigner: "0x" + "22".repeat(20), signerPublicKey: "0x" + "33".repeat(32), keyAddTx: null, submittedBy: null, approvedAt: 1, verifiedAt: 1, disconnectedAt: null } };
  persistStub.validatorStore.set("personaFids", vault.encryptNamespace("personaFids", { _: { m: { items: [rec], nextFixtureFid: 9_000_000 }, pad: "" } }));
  pf.resetPersonaFidCache();
  try {
    const oh = await headshot.rootHeadshot();
    assert(oh && oh.fname === "ownermain" && oh.displayName === "Owner Main" && oh.pfpUrl === "https://i.imgur.com/o.png", "owner headshot: " + JSON.stringify(oh));
    rec.connected.disconnectedAt = 2;
    persistStub.validatorStore.set("personaFids", vault.encryptNamespace("personaFids", { _: { m: { items: [rec], nextFixtureFid: 9_000_000 }, pad: "" } }));
    pf.resetPersonaFidCache();
    assert((await headshot.rootHeadshot()) === null, "a disconnected connected main has a headshot");
    pf.resetPersonaFidCache();
    persistStub.knobs.failReads = 99;
    threw = false;
    try {
      await headshot.rootHeadshot();
    } catch {
      threw = true;
    }
    persistStub.knobs.failReads = 0;
    assert(threw, "an unreadable personaFids record answered a headshot");
  } finally {
    dropPersona(persona.id);
    deviceRuntime();
  }
  return "device: facts / null after disconnect / throws (unreadable, deleted-but-pinned); owner: facts / null / throws";
});

// ---------------------------------------------------------------------------------------------------- U11
await check("U11", "accountLinks discipline: uniform presence seals the empty record once; a deleted-but-pinned or corrupted namespace is refused; a failed seal adopts nothing; a 409 re-reads first and applies the change to the newer copy", async () => {
  resetAll();
  assert((await links.ensureAccountLinksNamespace()) === "sealed", "a fresh root did not seal the empty record");
  assert((await links.ensureAccountLinksNamespace()) === "present", "the second call sealed again");
  assert(linkFlushes().length === 1, linkFlushes().length + " seals for uniform presence");
  // deleted but pinned (both shapes the validator can answer: 200 {} and 404)
  for (const as200 of [true, false]) {
    links.resetAccountLinksCache();
    persistStub.knobs.emptyAs200 = as200;
    const kept = persistStub.validatorStore.get("accountLinks");
    persistStub.validatorStore.delete("accountLinks");
    let threw = false;
    try {
      await links.mainLink();
    } catch {
      threw = true;
    }
    assert(threw, "a deleted-but-pinned namespace (" + (as200 ? "200 {}" : "404") + ") read as empty");
    persistStub.validatorStore.set("accountLinks", kept);
  }
  persistStub.knobs.emptyAs200 = true;
  // corrupted: a record nothing can read
  links.resetAccountLinksCache();
  const kept = persistStub.validatorStore.get("accountLinks");
  persistStub.validatorStore.set("accountLinks", { _: { v: 1, ns: "accountLinks", id: "_", nonce: "00".repeat(12), ct: "11".repeat(80) } });
  let threw = false;
  try {
    await links.mainLink();
  } catch {
    threw = true;
  }
  assert(threw, "a corrupted record read as no link");
  persistStub.validatorStore.set("accountLinks", kept);
  links.resetAccountLinksCache();
  // a failed seal adopts nothing
  await signIn();
  const before = await links.mainLink();
  persistStub.knobs.failFlushFor = { accountLinks: 1 };
  let refused = false;
  try {
    await links.updateAccountLinks((doc) => ({ v: 1, links: [{ ...doc.links[0], disconnectedAt: 123 }] }));
  } catch {
    refused = true;
  }
  assert(refused, "a refused flush did not throw");
  assert((await links.mainLink()).disconnectedAt === before.disconnectedAt, "a failed seal was adopted by the cache");
  // 409: someone sealed a newer copy; the change is re-applied to THAT copy, never sealed over it
  persistStub.knobs.conflictOnce = {
    ns: "accountLinks",
    before: () => {
      const newer = { ...before, displayName: "Changed Elsewhere" };
      persistStub.validatorStore.set("accountLinks", links.sealAccountLinksDoc({ v: 1, links: [newer] }));
    },
  };
  const sealed = await links.updateAccountLinks((doc) => ({ v: 1, links: [{ ...doc.links[0], disconnectedAt: 456 }] }));
  assert(sealed.links[0].displayName === "Changed Elsewhere" && sealed.links[0].disconnectedAt === 456, "the 409 retry did not build on the newer copy: " + JSON.stringify(sealed.links[0]).slice(0, 160));
  return "uniform presence once; deleted (200/404) and corrupted refused; failed seal not adopted; 409 re-read";
});

// ---------------------------------------------------------------------------------------------------- U8
await check("U8", "REFERENCE CROSS-CHECK: our verdict vs @farcaster/auth-client 0.7.1 verifySignInMessage on the same vectors and the same fake chain — never looser, stricter only where named", async () => {
  let ac;
  try {
    ac = require("@farcaster/auth-client");
  } catch {
    throw new Error("@farcaster/auth-client is not installed (devDependency 0.7.1, installed by the verify agent's pre-flight) — the reference cross-check did not run");
  }
  // PERSONA LAUNCH P1 (verify): the package's "exports" map does not export ./package.json, so the version is read by
  // walking up from its resolved entry to the package.json that names it (never a guessed node_modules path)
  let pkg = null;
  for (let dir = path.dirname(require.resolve("@farcaster/auth-client")); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    try {
      const cand = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      if (cand.name === "@farcaster/auth-client") { pkg = cand; break; }
    } catch { /* no package.json at this level */ }
  }
  assert(pkg, "the reference's package.json was not found above its entry point");
  assert(pkg.version === "0.7.1", "the reference is " + pkg.version + ", not 0.7.1");
  const client = ac.createAppClient({ relay: RELAY, ethereum: ac.viemConnector({ rpcUrl: RPC }) });
  // vectors: [label, authenticate options, the deliberate stricter rule when our verdict may differ]
  const vectors = [
    ["custody positive", {}],
    ["auth address positive", { signerAccount: B, authMethod: "authAddress" }],
    ["contract wallet positive", { address: W, contractWallet: true }],
    ["domain", { domain: "evil.example" }],
    ["message nonce", { messageNonce: "OtherNonce000000" }],
    ["chain id", { chainId: 1 }],
    ["no fid resource", { resources: ["https://example.com/x"] }],
    ["two fid resources", { resources: [`farcaster://fid/${ALICE.fid}`, `farcaster://fid/${BOB.fid}`] }],
    ["expired", { expirationTime: new Date(Date.now() - 1000) }],
    ["not before (future)", { notBefore: new Date(Date.now() + 60_000) }],
    ["EOA recovers to another", { signWith: C }],
    ["idOf another fid", { signerAccount: E }],
    ["keyDataOf state 0", { signerAccount: B, authMethod: "authAddress", arm: () => net.keyData.set(ALICE.fid + "|" + lc(B.address), { state: 0, keyType: 2 }) }],
    ["statement (legacy)", { statement: "Farcaster Connect" }, "legacy statement refused (D-SIWF: implementation form only)"],
    ["uri origin", { uri: "https://evil.example/device" }, "the uri must be on our origin"],
    ["issued 11 min ago", { issuedOffsetMs: -11 * 60_000 }, "issuedAt window"],
    ["expiry past our deadline", { expirationTime: new Date(Date.now() + 60 * 60_000) }, "expiry bounded by our deadline"],
    ["prose fids form", { resources: [`farcaster://fids/${ALICE.fid}`] }, null],
  ];
  const diffs = [];
  const looser = [];
  for (const [label, opts, stricter] of vectors) {
    resetAll();
    if (opts.arm) opts.arm();
    const st = await start();
    const { message, signature } = await authenticate(opts);
    const ours = ((await poll()).body.session?.stage ?? "") === "verified";
    const ch = [...net.channels.values()].at(-1);
    const ref = await client.verifySignInMessage({ nonce: ch.nonce, domain: HOST, message, signature, acceptAuthAddress: true });
    const theirs = ref && ref.success === true && !ref.isError;
    assert(st.status === 200, label + ": start");
    // PERSONA LAUNCH P1 (verify): non-vacuity — the positive vectors must verify on BOTH sides, or a reference that
    // refused everything (a wiring fault in this harness) would agree with an over-strict verifier and pass
    if (label.endsWith("positive")) assert(ours && theirs, label + ": ours " + ours + ", the reference " + theirs + " (both must accept)");
    if (ours === theirs) continue;
    if (ours && !theirs) looser.push(label);
    else if (stricter) diffs.push(label);
    else looser.push(label + " (an unnamed difference)");
  }
  assert(!looser.length, "our verifier differs from the reference outside the named rules: " + looser.join(", "));
  return `${vectors.length} vectors; equal verdicts except the named stricter rules: ${diffs.join(", ") || "none"}`;
});

// ---------------------------------------------------------------------------------------------------- U12
await check("U12", "the LIVE network path end to end against scripts/lib/siwf-stub.mjs (in-process, an ephemeral loopback port): verified with zero stub violations; the custody path costs 1 channel, ≥1 Bearer status reads, 1 eth_chainId, 1 idOf, 0 keyDataOf; a wrong fid is refused", async () => {
  const { startSiwfStub, STUB_ACCOUNTS, signForChannel } = await import(pathToFileURL(path.join(ROOT, "scripts/lib/siwf-stub.mjs")).href);
  const s = await startSiwfStub({ port: 0, log: () => {} });
  try {
    resetAll();
    deviceRuntime({ FC_SIWF: "on", FC_SIWF_RELAY_URL: s.url, FC_SIWF_RPC_URL: s.url });
    flow.__setSiwfRuntimeForTests({ device: true, env: { FC_SIWF: "on", FC_SIWF_RELAY_URL: s.url, FC_SIWF_RPC_URL: s.url }, fetch: realFetch, now, log: (l) => logs.push(l) });
    const st = await start();
    if (st.status !== 200) throw new Error("start against the stub: " + st.status + " " + JSON.stringify(st.body).slice(0, 160));
    const ch = s.stub.snapshot().channels[0];
    const { message, signature } = await signForChannel(ch, STUB_ACCOUNTS.alice);
    await realFetch(s.url + "/v1/channel/authenticate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channelToken: ch.token, message, signature, fid: 990777, username: "stubalice", displayName: "Stub Alice", authMethod: "custody" }) });
    const v = (await poll()).body;
    if (v.session?.stage !== "verified" || v.link?.fname !== "stubalice") throw new Error("not verified against the stub: " + JSON.stringify(v.session));
    const snap = s.stub.snapshot();
    if (snap.violations.length) throw new Error("stub violations: " + JSON.stringify(snap.violations));
    const c = snap.counts;
    if (c.channelPosts !== 1 || c.statusGets < 1 || c.chainId !== 1 || c.idOf !== 1 || c.keyDataOf !== 0 || c.otherCalls !== 0) throw new Error("counts: " + JSON.stringify(c));
    // a wrong fid (bob's custody signs for alice's fid) is refused against the same stub
    resetAll();
    flow.__setSiwfRuntimeForTests({ device: true, env: { FC_SIWF: "on", FC_SIWF_RELAY_URL: s.url, FC_SIWF_RPC_URL: s.url }, fetch: realFetch, now, log: (l) => logs.push(l) });
    await start();
    const ch2 = s.stub.snapshot().channels[0];
    const bad = await signForChannel(ch2, STUB_ACCOUNTS.bob, { fid: 990777 });
    await realFetch(s.url + "/v1/channel/authenticate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channelToken: ch2.token, ...bad, fid: 990777, username: "stubalice", authMethod: "custody" }) });
    const r = (await poll()).body;
    if (r.session?.stage !== "refused" || r.session.code !== "siwf_fid_mismatch") throw new Error("the wrong fid: " + JSON.stringify(r.session));
    return `counts ${JSON.stringify(c)}; wrong fid refused; 0 violations`;
  } finally {
    await s.close();
    deviceRuntime();
  }
});

// ---------------------------------------------------------------------------------------------------- U7
await check("U7", "no token, signature, message text or signer address in any thrown or answered message, or any log line", async () => {
  // positive control: the scan finds a planted needle (without it, an empty scan would pass)
  const list = [...needles].filter((n) => typeof n === "string" && n.length >= 12);
  assert(list.length >= 10, "too few needles collected (" + list.length + ") — the earlier checks did not run");
  const planted = "an error mentioning " + list.find((n) => n.startsWith("unit-token-"));
  assert(list.some((n) => planted.includes(n)), "the scan cannot see a planted token");
  // the corpus: every route answer, every view, every log line, plus the fixed sentence table
  const corpus = [...answers, ...logs, JSON.stringify(flow.SENTENCES), JSON.stringify(verify.VERIFY_SENTENCES)];
  assert(answers.length >= 50, "only " + answers.length + " answers were recorded");
  const hits = [];
  for (const text of corpus) for (const n of list) if (text.includes(n)) hits.push(n.slice(0, 18) + "… in " + text.slice(0, 80));
  assert(!hits.length, hits.length + " leak(s): " + hits.slice(0, 3).join(" | "));
  // thrown errors from the verifier itself (direct calls with doctored input)
  const thrown = [];
  for (const bad of [
    { message: "x".repeat(40), signature: "0x" + "ab".repeat(65), fid: 1, nonce: "n", authMethod: "custody" },
    { message: "garbage " + list[0], signature: "0x" + "ab".repeat(65), fid: 1, nonce: "n", authMethod: "custody" },
  ]) {
    try {
      await verify.verifySiwf(bad, { domain: HOST, origin: ORIGIN, nonce: "n", deadlineMs: Date.now() + 1e6, nowMs: Date.now() }, { rpc: async () => "0x", chainChecked: true });
    } catch (e) {
      thrown.push(String(e.message));
    }
  }
  assert(thrown.length === 2 && thrown.every((m) => !list.some((n) => m.includes(n))), "a verifier error carries a value: " + thrown.join(" | "));
  return `${corpus.length} answers/log lines scanned for ${list.length} needles: none`;
});

// ---------------------------------------------------------------------------------------------------- U13
await check("U13", "THE INLINE SAVE AND THE CARD'S CLOCK: the save asks status first and refuses 'paused' with NO passkey prompt while the ways-in list is unknown; plain words; no '24 words'; exactly one final poll past the deadline; a dead QR is shown expired", async () => {
  const { moment, card } = UI;
  const calls = { status: 0, save: 0 };
  let statusAnswer = null;
  let saveImpl = async () => ({ methodId: "pk:unit", path: "prf", attached: false });
  const fake = {
    info: { restored: false, persistent: false },
    custody: {
      status: async () => {
        calls.status++;
        if (statusAnswer instanceof Error) throw statusAnswer;
        return statusAnswer;
      },
      savePasskey: async () => {
        calls.save++;
        return saveImpl();
      },
    },
  };
  // the page's window, for momentDevice() only; restored after (the flow's runtime reads `window` to decide "device")
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const priorWindow = globalThis.window;
  globalThis.window = { __layersDevice: fake };
  const attempt = async () => {
    try {
      return { ok: true, v: await moment.saveWithPasskey() };
    } catch (e) {
      return { ok: false, e: String(e && e.message) };
    }
  };
  let wrapSentence = "";
  try {
    // positive control FIRST: a status that says the list was read lets exactly one save through (without it every
    // refusal below could be a gate that refuses everything)
    statusAnswer = { methodsUnknown: false, webauthn: true };
    let r = await attempt();
    assert(r.ok && calls.save === 1 && calls.status === 1 && r.v === moment.SAVED_SENTENCE, "the positive control: " + JSON.stringify(r) + " " + JSON.stringify(calls));
    // the gate (UX-16): unknown / unsaid / unreadable status → paused, and the OS prompt is never reached
    for (const [label, ans] of [
      ["methodsUnknown true", { methodsUnknown: true, webauthn: true }],
      ["methodsUnknown missing", { webauthn: true }],
      ["status throws", new Error("custody: the validator did not list this root's methods (503)")],
      ["status answers null", null],
    ]) {
      statusAnswer = ans;
      const before = calls.save;
      r = await attempt();
      assert(!r.ok && r.e === moment.SAVE_PAUSED, label + ": " + JSON.stringify(r));
      assert(calls.save === before, label + ": savePasskey (the OS passkey prompt) was reached " + (calls.save - before) + " time(s)");
    }
    statusAnswer = { methodsUnknown: false, webauthn: false };
    const beforeNoPk = calls.save;
    r = await attempt();
    assert(!r.ok && r.e === moment.SAVE_NO_PASSKEY && calls.save === beforeNoPk, "no WebAuthn: " + JSON.stringify(r));
    // a device without status() is "not ready", never an ungated save
    const savedStatus = fake.custody.status;
    delete fake.custody.status;
    const beforeNoStatus = calls.save;
    r = await attempt();
    fake.custody.status = savedStatus;
    assert(!r.ok && r.e === moment.SAVE_NOT_READY && calls.save === beforeNoStatus, "no status(): " + JSON.stringify(r));
    // plain words: custody's failures mapped (the strip prefixes "Not saved: ")
    statusAnswer = { methodsUnknown: false, webauthn: true };
    const cancelled = Object.assign(new Error("The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client."), { name: "NotAllowedError" });
    for (const [err, want] of [
      [cancelled, moment.SAVE_CANCELLED],
      [new Error("this passkey has no PRF and the server offers no wrap path — use a social login or a PRF-capable passkey"), moment.SAVE_UNSUPPORTED],
      [new Error("custody: the validator did not list this root's methods (503)"), moment.SAVE_PAUSED],
      [new Error("wrap path: release refused (500) upstream detail"), moment.SAVE_FAILED],
    ]) {
      saveImpl = async () => {
        throw err;
      };
      r = await attempt();
      assert(!r.ok && r.e === want, "custody error " + JSON.stringify(err.message.slice(0, 40)) + " became " + JSON.stringify(r.e));
    }
    for (const s of [moment.SAVE_PAUSED, moment.SAVE_NOT_READY, moment.SAVE_NO_PASSKEY, moment.SAVE_CANCELLED, moment.SAVE_UNSUPPORTED, moment.SAVE_FAILED])
      assert(!/PRF|wrap|social login|validator|custody|HTTP|\(\d{3}\)|24 words/i.test(s), "a consumer refusal carries jargon: " + s);
    // the words (UX-15): the wrap path points at device linking, never the 24 words; nothing promises "anywhere"
    saveImpl = async () => ({ methodId: "pk:unit2", path: "wrap", attached: false });
    r = await attempt();
    assert(r.ok && /link it from Your device › Devices/.test(r.v), "the wrap-path sentence: " + JSON.stringify(r));
    wrapSentence = r.v;
    assert(moment.passkeySavedSentence({ path: "prf", attached: true }) === moment.SAVED_ATTACHED_SENTENCE, "the attach sentence");
  } finally {
    if (hadWindow) globalThis.window = priorWindow;
    else delete globalThis.window;
  }
  const consumer = [moment.KEEP_NOTE, moment.KEEP_TOAST, moment.SAVED_SENTENCE, moment.SAVED_ATTACHED_SENTENCE, moment.WRAP_PATH_SENTENCE, wrapSentence];
  for (const s of consumer) assert(!/24 words/i.test(s) && !/\banywhere\b/i.test(s), "a consumer save sentence says '24 words' or 'anywhere': " + s);
  assert(/beyond this browser/.test(moment.KEEP_NOTE) && /beyond this browser/.test(moment.KEEP_TOAST), "the keep note/toast: " + moment.KEEP_NOTE + " | " + moment.KEEP_TOAST);
  assert(moment.UNLOCK_HREF === "/device#unlock", "the unlock link goes to " + moment.UNLOCK_HREF);
  // the clock (UX-14)
  const D = 1_000_000_000;
  const P = card.POLL_MS;
  assert(card.pollStep(D - 1, D, false) === "poll" && card.pollStep(D + P, D, false) === "poll", "before the deadline (+ one poll's grace) a tick polls");
  assert(card.pollStep(D + P + 1, D, false) === "final", "past the deadline the first tick is the final poll, not silence");
  assert(card.pollStep(D + 600_000, D, true) === "stop", "after the final poll, nothing");
  // a tab ticking every POLL_MS from before the deadline to ten minutes past it: polls, then exactly ONE final, then none
  let finalSent = false;
  const steps = [];
  for (let t = D - 4 * P; t <= D + 600_000; t += P) {
    const s = card.pollStep(t, D, finalSent);
    if (s === "final") finalSent = true;
    if (s !== "stop") steps.push(s);
  }
  assert(steps.filter((s) => s === "final").length === 1 && steps.at(-1) === "final" && steps.filter((s) => s === "poll").length >= 4, "the simulated tab: " + steps.join(","));
  // ... and a tab that comes back after the deadline (the Farcaster app returned it late): its first tick is the final poll
  assert(card.pollStep(D + 15 * 60_000, D, false) === "final", "a tab returning late makes the final poll");
  const qr = { qr: { viewBox: 25, path: "M0 0h1v1H0z" } };
  const pending = { id: "s1", stage: "pending", deadline: D, code: null, note: null, retryable: false, approval: qr };
  assert(card.shownSession(pending, D) === pending && card.shownSession(pending, D + P) === pending, "before the deadline the request is shown as answered (the same object)");
  for (const stage of ["pending", "checking"]) {
    const late = card.shownSession({ ...pending, stage }, D + P + 1);
    assert(late.stage === "expired" && late.approval === null && late.code === "siwf_expired" && late.note === card.EXPIRED_NOTE && late.retryable === false, stage + " past the deadline: " + JSON.stringify(late));
  }
  for (const stage of ["verified", "refused", "expired"]) {
    const done = { ...pending, stage, approval: null };
    assert(card.shownSession(done, D + 600_000) === done, stage + " is shown as answered");
  }
  assert(card.shownSession(null, D) === null, "no request, nothing shown");
  // the card and the device word an expired request the same way
  assert(card.EXPIRED_NOTE === flow.SENTENCES.siwf_expired, "the card's expired note differs from the device's: " + card.EXPIRED_NOTE + " | " + flow.SENTENCES.siwf_expired);
  return `${calls.save} save(s) reached the prompt across ${calls.status} status read(s) (only the allowed ones); ${steps.length} ticks, one final`;
});

// ---------------------------------------------------------------------------------------------------- U14
await check("U14", "THE LANDING PROMISE: siwfOfferedHere() is true only where the device offers Sign in with Farcaster live; Landing.tsx renders landing-siwf only behind it", async () => {
  const offered = (env) => flow.siwfOfferedHere(env);
  const savedWorld = process.env.LAYERS_WORLD;
  delete process.env.LAYERS_WORLD;
  try {
    // positive controls: the public default, and a loopback stub on an unhosted machine
    assert(offered({ NODE_ENV: "production" }) === true, "the public default is not offered");
    assert(offered({ NODE_ENV: "production", FC_SIWF_RELAY_URL: "http://127.0.0.1:4321", FC_SIWF_RPC_URL: "http://127.0.0.1:4321" }) === true, "the loopback stub is not offered");
    const no = [
      ["the kill switch", { NODE_ENV: "production", FC_SIWF: "off" }],
      ["the kill switch (OFF)", { NODE_ENV: "production", FC_SIWF: "OFF" }],
      ["the kill switch (false)", { NODE_ENV: "production", FC_SIWF: "false" }],
      ["a refused relay URL", { NODE_ENV: "production", FC_SIWF_RELAY_URL: "https://example.invalid" }],
      ["a keyed RPC URL", { NODE_ENV: "production", FC_SIWF_RPC_URL: "https://opt-mainnet.g.alchemy.com/v2/SECRETKEY123" }],
      ["a loopback override on a hosted platform", { NODE_ENV: "production", RAILWAY_ENVIRONMENT: "production", FC_SIWF_RELAY_URL: "http://127.0.0.1:4321" }],
      ["the rig (fixture: its app pages run no device)", { NODE_ENV: "production", ZK_DEV_HOOKS: "true" }],
      ["the owner service", { NODE_ENV: "production", ZK_DEV_HOOKS: "true", OWNER_ACCESS_SECRET: "o".repeat(64) }],
    ];
    for (const [label, env] of no) assert(offered(env) === false, label + " promises the sign-in (hints " + JSON.stringify(flow.siwfDeviceHints(env)) + ")");
  } finally {
    if (savedWorld === undefined) delete process.env.LAYERS_WORLD;
    else process.env.LAYERS_WORLD = savedWorld;
  }
  // the landing renders the sentence ONLY behind the predicate (a server component: read, not rendered, here; the
  // prod-shape suite P16 renders it with FC_SIWF=off and by default)
  const src = readFileSync(path.join(ROOT, "components/landing/Landing.tsx"), "utf8").replace(/\r\n/g, "\n");
  const at = src.indexOf('data-testid="landing-siwf"');
  assert(at > 0, "Landing.tsx no longer renders landing-siwf");
  assert(src.indexOf('data-testid="landing-siwf"', at + 1) < 0, "Landing.tsx renders landing-siwf twice");
  assert(/\{siwfOfferedHere\(\)\s*\?\s*\(\s*<p\b[^>]*$/.test(src.slice(Math.max(0, at - 300), at)), "landing-siwf is not rendered behind {siwfOfferedHere() ? (...) : null}");
  assert(/import \{ siwfOfferedHere \} from "@\/lib\/fc\/siwf\/flow";/.test(src), "Landing.tsx does not import siwfOfferedHere from the flow");
  return "2 offered, 8 not; the sentence is gated";
});

// ---------------------------------------------------------------------------------------------------- M: mutations
if (!MUTATIONS.length && want("M")) {
  const SELF = fileURLToPath(import.meta.url);
  const runs = [
    ["rootHeadshot answers null on a read error", "U10", [{ file: "lib/identity/rootHeadshot.ts", find: "  const link = await mainLink(); // THROWS on an unreadable namespace: never null-as-empty\n", replace: "  let link; try { link = await mainLink(); } catch { return null; }\n" }]],
    ["the verifier drops the nonce check", "U3", [{ file: "lib/fc/siwf/verify.ts", find: 'if (typeof m.nonce !== "string" || m.nonce !== expect.nonce || c.nonce !== expect.nonce) fail("siwf_message");', replace: "" }]],
    ["the verifier drops the domain check", "U3", [{ file: "lib/fc/siwf/verify.ts", find: 'if (typeof m.domain !== "string" || m.domain !== expect.domain) fail("siwf_message");', replace: "" }]],
    ["EOA signatures go onchain (ERC-6492) instead of local recovery", "U4", [{ file: "lib/fc/siwf/verify.ts", find: "  if (sig.length === 132) {", replace: "  if (false) {" }]],
    ["accountLinks loses its padding", "U9", [{ file: "lib/fc/siwf/links.ts", find: '{ _: { m: doc, pad: " ".repeat(pad) } }', replace: '{ _: { m: doc, pad: "" } }' }]],
    ["the route reads the body before refusing", "U6", [{ file: "app/api/fc/siwf/route.ts", find: '  // FIRST, before the body is read: a public server never verifies a sign-in, and never reads what was sent to it\n  if (typeof window === "undefined" && isPublicDeployment()) return deviceOnly();', replace: '  await req.json().catch(() => null);\n  if (typeof window === "undefined" && isPublicDeployment()) return deviceOnly();' }]],
    ["any https relay is honoured", "U5", [{ file: "lib/fc/siwf/flow.ts", find: '  if ((u.protocol === "http:" || u.protocol === "https:") && isLoopbackHost(u.hostname)) return { ok: true, url: u.origin, host: u.host };\n  return { ok: false };\n}\n\n/** FC_SIWF_RPC_URL', replace: '  if (u.protocol === "http:" || u.protocol === "https:") return { ok: true, url: u.origin, host: u.host };\n  return { ok: false };\n}\n\n/** FC_SIWF_RPC_URL' }]],
    ["a wrong chain id passes", "U3", [{ file: "lib/fc/siwf/verify.ts", find: 'if (typeof id !== "string" || !/^0x[0-9a-fA-F]+$/.test(id) || parseInt(id, 16) !== SIWF_CHAIN_ID) fail("siwf_chain_unavailable");', replace: "" }]],
    // U7 scans what the earlier checks answered: the relay-nonce refusal is in U3, so U3 runs first (U7 must be the one that fails)
    ["an error carries the channel token", "U3,U7", [{ file: "lib/fc/siwf/flow.ts", find: 'if (ch.nonce !== nonce) throw new SiwfError("siwf_message");', replace: 'if (ch.nonce !== nonce) throw new SiwfError("siwf_message", "bad relay nonce for " + ch.channelToken);' }]],
    ["the stem rule is skipped at sign-in", "U3", [{ file: "lib/fc/siwf/flow.ts", find: "  if (clash)\n    throw new SiwfError(\n      \"siwf_handle_stem\",", replace: "  if (false)\n    throw new SiwfError(\n      \"siwf_handle_stem\"," }]],
    ["one main is not enforced", "U3", [
      { file: "lib/fc/siwf/flow.ts", find: '  if (link && link.fid !== v.fid) throw new SiwfError("siwf_one_main");', replace: "" },
      { file: "lib/fc/siwf/flow.ts", find: '      if (doc.links[0] && doc.links[0].fid !== v.fid) throw new SiwfError("siwf_one_main");', replace: "" },
    ]],
    ["a deleted-but-pinned namespace reads as empty", "U11", [{ file: "lib/fc/siwf/links.ts", find: '          if (wasEverSealed(ACCOUNT_LINKS_NS))\n            throw new Error("vault: accountLinks is EMPTY', replace: '          if (false)\n            throw new Error("vault: accountLinks is EMPTY' }]],
    ["a failed seal is adopted by the cache", "U11", [{ file: "lib/fc/siwf/links.ts", find: "  const sealed = sealAccountLinksDoc(doc);\n  await flushVault(NS, sealed);", replace: "  const sealed = sealAccountLinksDoc(doc);\n  g.__layersAccountLinks = { doc, present: true };\n  await flushVault(NS, sealed);" }]],
    ["the sealed record keeps the signature", "U1", [{ file: "lib/fc/siwf/flow.ts", find: "    messageHash: v.messageHash,\n    verifiedAt: rt.now(),", replace: "    messageHash: v.messageHash,\n    signature: \"kept\",\n    verifiedAt: rt.now()," }]],
    // PERSONA LAUNCH P1 (review UX-7, UX-13..16): the UI half (the second bundle) and the landing promise
    ["the inline save skips the ways-in gate (UX-16)", "U13", [{ file: "components/device/SaveMoment.tsx", find: "  if (!st || st.methodsUnknown !== false) throw new Error(SAVE_PAUSED);\n", replace: "" }]],
    ["the inline save ignores a missing WebAuthn (UX-16)", "U13", [{ file: "components/device/SaveMoment.tsx", find: "  if (st.webauthn !== true) throw new Error(SAVE_NO_PASSKEY);\n", replace: "" }]],
    ["custody's own message reaches the consumer (UX-16)", "U13", [{ file: "components/device/SaveMoment.tsx", find: "    throw new Error(plainSaveError(e));", replace: "    throw e;" }]],
    ["the wrap-path sentence sends the visitor to the 24 words (UX-15)", "U13", [{ file: "components/device/SaveMoment.tsx", find: 'export const WRAP_PATH_SENTENCE = " This passkey works on this device. To use Totem on another device, link it from Your device › Devices.";', replace: 'export const WRAP_PATH_SENTENCE = " This passkey can\'t carry it to another device, so keep your 24 words (Your device › Advanced). To use Totem on another device, link it from Your device › Devices.";' }]],
    ["the keep note promises 'anywhere' again (UX-15)", "U13", [{ file: "components/device/SaveMoment.tsx", find: 'export const KEEP_NOTE = "kept in this browser only; a passkey keeps it safe beyond this browser";', replace: 'export const KEEP_NOTE = "kept in this browser only; a passkey keeps it safe beyond this browser and reaches it anywhere";' }]],
    ["the card stops at the deadline with no final poll (UX-14)", "U13", [{ file: "components/device/FarcasterSignIn.tsx", find: '  return finalSent ? "stop" : "final";', replace: '  return "stop";' }]],
    ["a dead QR is shown past the deadline (UX-14)", "U13", [{ file: "components/device/FarcasterSignIn.tsx", find: '  if (!s || (s.stage !== "pending" && s.stage !== "checking") || now <= s.deadline + POLL_MS) return s;', replace: "  if (s || !s) return s;" }]],
    ["the landing promises the sign-in wherever it is not switched off (UX-7)", "U14", [{ file: "lib/fc/siwf/flow.ts", find: '  return siwfDeviceHints(env).FC_SIWF === "on";', replace: '  return siwfDeviceHints(env).FC_SIWF !== "off";' }]],
  ];
  await check("M", "MUTATIONS: each guard removed in the bundle only — the check that covers it FAILS (" + runs.length + " mutations)", async () => {
    const survived = [];
    for (const [label, target, muts] of runs) {
      const r = spawnSync(process.execPath, [SELF, "--only=" + target], {
        cwd: ROOT,
        env: { ...process.env, SIWF_MUTATION: JSON.stringify(muts), SIWF_UNIT_QUIET: "1", KEYSTORE_DIR: "" },
        encoding: "utf8",
        timeout: 240_000,
      });
      const tail = (r.stdout || "").trim().split("\n").pop() || "";
      const mustFail = target.split(",").pop();
      if (r.status === 2) survived.push(label + " (the mutation could not be applied: " + (r.stdout || r.stderr || "").trim().slice(0, 160) + ")");
      else if (r.status === 0) survived.push(label + " (" + mustFail + " still passed)");
      else if (!new RegExp("FAILED: .*\\b" + mustFail + "\\b").test(tail)) survived.push(label + " (the run failed, but not " + mustFail + ": " + tail + ")");
    }
    assert(!survived.length, survived.length + " mutation(s) survived: " + survived.join(" | "));
    return runs.length + " mutations, each caught by its check";
  });
}

rmSync(tmp, { recursive: true, force: true });
const summary = `${passed}/${passed + failed} SIWF unit checks passed` + (failed ? ` — FAILED: ${failedIds.join(",")}` : "");
console.log((QUIET ? "" : "\n") + summary);
process.exit(failed ? 1 : 0);
