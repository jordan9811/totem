// CONNECTOR SETUP — node-only unit harness for lib/fc/connector.server.ts, app/api/fc/connector/route.ts and the
// sealed-connector branch of lib/fc/connect.ts. NO NETWORK: global fetch is replaced by an in-process fake of the
// Optimism JSON-RPC (eth_chainId, eth_getBalance, eth_call for IdGateway.price / IdRegistry.idOf / custodyOf,
// eth_estimateGas, eth_gasPrice, eth_maxPriorityFeePerGas, eth_getTransactionCount, eth_sendRawTransaction,
// eth_getTransactionReceipt), of the fname registry (GET/POST /transfers, the UserNameProof signature verified) and
// of the three Neynar calls a QR connect starts with; ANY other URL fails the run. Every call is recorded, so a check
// can say "zero eth_sendRawTransaction" and mean it.
//
// WHY THESE CHECKS: the connector flow's whole point is that the owner turns on QR connect WITHOUT handling a key.
// So the harness proves, in order:
//   GATE     refused on a public deployment, inside the browser device, on the rig (no owner secret), with writes
//            unarmed — and admitted on an armed owner service
//   ENV      the environment names win when set (create refuses; connect.ts signs with the env key), and a half-set
//            pair is reported, never fallen through
//   CREATE   create seals a custody key AND a separate recovery key and returns only the custody ADDRESS; a second
//            create generates nothing (idempotent); a vault that cannot be read or holds unreadable records REFUSES
//            and never lets a second key be sealed over the first; a dead RPC leaves the stage "created"
//   REGISTER typed REGISTER only; refused unfunded (both the status margin and the live gas estimate), on the wrong
//            chain, and when the custody or recovery address is one Totem already uses; funded, it sends EXACTLY ONE
//            IdGateway.register(recovery) signed by the custody key, reads the fid back and seals it; a second
//            register sends nothing; a reverted receipt is reported and allows a retry
//   RESUME   a sealed registration whose receipt the process never saw is finished from the receipt (zero sends), a
//            pending one waits, a 15-minute-stale one is re-sent once, an fid already onchain is adopted
//   FNAME    "layers" anywhere, the test account's stem, a persona's name, main's stem and a taken name are refused;
//            a neutral name is a signed UserNameProof the registry can verify; renaming is refused
//   CONNECT  lib/fc/connect.ts picks the sealed connector when the env names are unset — not before it is
//            registered, never when the vault cannot be read — and a QR connect start signs the key request with it
//            (the fake Neynar verifies the signature recovers to custodyOf(C)) without the key ever leaving the module
//   ROUTE    the owner-session check (401 without a live session), the body limits, the error shape, 404 in the device
//   LEAK     no generated or synthetic private key appears in any response, status view, error message, console line
//            or argv; what reaches the validator for "fcConnector" is ciphertext-shaped and holds no key
//
//   node scripts/unit-connector.mjs
//
// The modules are bundled with esbuild (the repo's devDependency; `server-only` and next/server shimmed, the @/ paths
// from tsconfig.json) with their heavy neighbours stubbed: the vault (an AES-GCM stand-in with the real record shape
// and the real "none readable → throw" rule), the validator persistence (in memory, with failure knobs), the keystore,
// the derived keys, the store. `viem/accounts` is wrapped so every generatePrivateKey() result is known to the leak
// scan — the harness never learns a key any other way. The env is set per case on THIS process only.
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
const viem = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const { decodeFunctionData, encodeFunctionData, encodeFunctionResult, formatEther, keccak256, parseTransaction, recoverTransactionAddress, recoverTypedDataAddress, toHex } = viem;

// ---------------------------------------------------------------------------------------------------- reporting
let passed = 0;
let failed = 0;
const failures = [];
async function check(name, fn) {
  try {
    const extra = await fn();
    passed++;
    console.log(`  PASS  ${name}${typeof extra === "string" ? " — " + extra : ""}`);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name} — ${e && e.message ? e.message : String(e)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
/** the promise must reject with this code (or a message/code matching the RegExp); returns the error */
async function rejects(p, codeOrRe, label = "") {
  let err = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`${label} did not reject (expected ${codeOrRe})`);
  const code = err && err.code;
  const msg = (err && err.message) || "";
  const hit = codeOrRe instanceof RegExp ? codeOrRe.test(msg) || codeOrRe.test(String(code)) : code === codeOrRe;
  if (!hit) throw new Error(`${label} rejected with the wrong thing: code=${code} msg=${msg.slice(0, 220)}`);
  outputs.push(msg);
  return err;
}

// everything the harness ever saw come OUT of the modules: scanned for keys at the end
const outputs = [];
const seen = (v) => {
  outputs.push(typeof v === "string" ? v : JSON.stringify(v));
  return v;
};
const consoleLines = [];
for (const level of ["log", "error", "warn", "info"]) {
  const real = console[level].bind(console);
  console[level] = (...a) => {
    const s = a.map(String).join(" ");
    consoleLines.push(s);
    if (!/^\[(connector|connect)\]/.test(s)) real(...a);
  };
}

// ---------------------------------------------------------------------------------------------------- the bundle
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-connector-unit-"));
const S = (n) => path.join(tmp, n);
const VIEM_ACCOUNTS = path.join(ROOT, "node_modules/viem/_esm/accounts/index.js").split(path.sep).join("/");
const stubs = {
  "server-only.ts": "export {};\n",
  "next-server.ts": `export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }
}
export class NextRequest extends Request {
  get cookies() {
    const raw = this.headers.get("cookie") ?? "";
    const map = new Map<string, string>();
    for (const part of raw.split(";")) {
      const p = part.trim();
      const i = p.indexOf("=");
      if (i > 0) map.set(p.slice(0, i), p.slice(i + 1));
    }
    return { get: (name: string) => (map.has(name) ? { name, value: map.get(name) as string } : undefined) };
  }
}
`,
  // the vault stand-in: a fixed TEST key (the real lib/vault/vault.ts derives it from the keystore), the real record
  // shape, the real per-record drop and the real "records present, none readable → throw" rule
  "vault.ts": `import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
const KEY = Buffer.alloc(32, 7);
export function encryptNamespace(ns: string, plaintext: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, record] of Object.entries(plaintext)) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", KEY, iv);
    c.setAAD(Buffer.from(ns + "|" + id));
    const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(record))), c.final(), c.getAuthTag()]);
    out[id] = { v: 1, ns, id, nonce: iv.toString("hex"), ct: ct.toString("base64") };
  }
  return out;
}
export function decryptNamespace(ns: string, stored: Record<string, unknown>): Record<string, unknown> {
  const ids = Object.keys(stored);
  const out: Record<string, unknown> = {};
  let ok = 0;
  for (const id of ids) {
    const r = stored[id] as { v?: number; ns?: string; id?: string; nonce?: string; ct?: string } | null;
    try {
      if (!r || r.v !== 1 || r.ns !== ns || r.id !== id || typeof r.nonce !== "string" || typeof r.ct !== "string") continue;
      const buf = Buffer.from(r.ct, "base64");
      const d = createDecipheriv("aes-256-gcm", KEY, Buffer.from(r.nonce, "hex"));
      d.setAAD(Buffer.from(ns + "|" + id));
      d.setAuthTag(buf.subarray(buf.length - 16));
      out[id] = JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString());
      ok++;
    } catch {
      /* dropped, as the real vault drops a record it cannot read */
    }
  }
  if (ids.length && ok === 0) throw new Error("vault: every record in " + ns + " failed to decrypt (wrong key)");
  return out;
}
export function sealWhole(ns: string, entries: Record<string, unknown>) { return encryptNamespace(ns, entries); }
export const VAULT_NAMESPACES: ReadonlySet<string> = new Set();
export function isVaultNamespace(ns: string) { return VAULT_NAMESPACES.has(ns); }
export function unsealAny() { return null; }
`,
  "persist.ts": `export const validatorStore = new Map<string, Record<string, unknown>>();
export const persistKnobs = { failReads: 0, flushes: 0, failFlushes: 0, flushed: [] as { ns: string; entries: Record<string, unknown> }[] };
export async function fetchState(ns: string): Promise<{ status: number; ok: boolean; json: () => Promise<any> }> {
  if (persistKnobs.failReads > 0) {
    persistKnobs.failReads--;
    return { status: 503, ok: false, json: async () => ({ error: "down" }) };
  }
  const entries = validatorStore.get(ns);
  if (!entries) return { status: 404, ok: false, json: async () => ({}) };
  return { status: 200, ok: true, json: async () => ({ entries: JSON.parse(JSON.stringify(entries)) }) };
}
export async function flushVault(ns: string, entries: Record<string, unknown>): Promise<void> {
  if (persistKnobs.failFlushes > 0) {
    persistKnobs.failFlushes--;
    throw new Error('vault flush of "' + ns + '" was refused by the validator: HTTP 503');
  }
  persistKnobs.flushes++;
  persistKnobs.flushed.push({ ns, entries: JSON.parse(JSON.stringify(entries)) });
  validatorStore.set(ns, JSON.parse(JSON.stringify(entries)));
}
export async function flush(ns: string, entries: Record<string, unknown>): Promise<void> { return flushVault(ns, entries); }
export async function signedWriteHeaders(): Promise<Record<string, string>> { return {}; }
export function sealedNamespaces(): Set<string> { return new Set(); }
`,
  "keystore.ts": `import { createHash } from "node:crypto";
export type PersonaKind = "public" | "private";
export interface KeystorePersona { id: string; nonce: string; kind: PersonaKind; name: string; handle: string; avatarUrl: string | null; bio: string | null; cluster: string | null; createdAt: number; forkedFrom: string | null }
export const ks: { personas: KeystorePersona[] } = { personas: [] };
export function listPersonas(): KeystorePersona[] { return ks.personas.map((p) => ({ ...p })); }
export function getPersona(id: string): KeystorePersona | null { const p = ks.personas.find((x) => x.id === id); return p ? { ...p } : null; }
export function isOwnPersona(id: string): boolean { return ks.personas.some((p) => p.id === id); }
export function ownPersonaIds(): string[] { return ks.personas.map((p) => p.id); }
export function createPersona(input: { name: string; handle: string; kind?: PersonaKind; avatarUrl?: string | null; bio?: string | null; cluster?: string | null; nonce?: string; forkedFrom?: string | null }): KeystorePersona {
  const nonce = input.nonce ?? createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 32);
  const p: KeystorePersona = { id: "p_" + createHash("sha256").update("root:" + nonce).digest("hex").slice(0, 32), nonce, kind: input.kind ?? "public", name: input.name, handle: input.handle, avatarUrl: input.avatarUrl ?? null, bio: input.bio ?? null, cluster: input.cluster ?? null, createdAt: Date.now(), forkedFrom: input.forkedFrom ?? null };
  ks.personas.push(p);
  return { ...p };
}
export const FIXTURE_CONNECT_NONCE_PREFIX = "fixture-connect:";
export function vaultKeyBytes(): Uint8Array { return new Uint8Array(32); }
`,
  "keys.ts": `import { createHash } from "node:crypto";
import { isOwnPersona } from "@/lib/identity/keystore";
const h = (s: string) => createHash("sha256").update(s).digest("hex");
export function fcSignerPublicKeyFor(id: string): string | null { return isOwnPersona(id) ? h("signer:" + id) : null; }
export function fcCustodyAddressFor(id: string): string | null { return isOwnPersona(id) ? "0x" + h("custody:" + id).slice(0, 40) : null; }
export function isKeystoreRootedPersona(id: string): boolean { return isOwnPersona(id); }
export function isViewerPersona(id: string): boolean { return isOwnPersona(id); }
export async function signCustodyTypedDataFor(): Promise<string | null> { return null; }
export function signForPersona(): string | null { return "sig"; }
`,
  "personaKind.ts": `import { getPersona } from "@/lib/identity/keystore";
export type PersonaKind = "public" | "private" | "unknown";
export function kindOf(id: string | null | undefined): PersonaKind { if (!id) return "unknown"; const p = getPersona(id); return p ? (p.kind === "private" ? "private" : "public") : "unknown"; }
`,
  "misc.ts": `export const localCasts = new Map<string, unknown>();
export function findLocalCast(hash: string): unknown { return localCasts.get(hash) ?? null; }
export function consumeFcPublishDrop(): boolean { return false; }
export async function syncRoster(): Promise<void> {}
`,
  "store.ts": `export const SEED_VIEWER = { personas: ["persona_seed_a"], activePersonaId: "persona_seed_a", rootId: "root_seed", fid: 9152 };
export const personaById = new Map<string, { id: string; handle: string }>([["persona_seed_a", { id: "persona_seed_a", handle: "seed_a" }]]);
export const personaByHandle = new Map<string, unknown>([["seed_a", {}]]);
export const postByHash = new Map<string, unknown>();
const S = { fcAttribution: new Map(), fcWrites: new Map() };
export function state() { return S; }
export async function hydrate(): Promise<void> {}
export async function persistNs(): Promise<void> {}
`,
  "zk-config.ts": `export function zkMode(): string { return "fixture"; }
export function anonSnapshot(): null { return null; }
`,
  // viem/accounts, wrapped: the module under test keeps the real functions, and every key it generates is recorded
  // for the leak scan (the harness never learns a key any other way — not from a response, not from the store)
  "viem-accounts.ts": `import * as real from ${JSON.stringify(VIEM_ACCOUNTS)};
export * from ${JSON.stringify(VIEM_ACCOUNTS)};
export function generatePrivateKey(): \`0x\${string}\` {
  const k = real.generatePrivateKey();
  ((globalThis as unknown as { __unitGeneratedKeys?: string[] }).__unitGeneratedKeys ??= []).push(k);
  return k;
}
`,
  "entry.ts": `export * as connector from "@/lib/fc/connector.server";
export * as connect from "@/lib/fc/connect";
export * as pf from "@/lib/fc/personaFid";
export * as route from "@/app/api/fc/connector/route";
export * as ownerAccess from "@/lib/platform/owner-access";
export * as persistStub from "@/lib/adapters/mock/persist";
export * as ksStub from "@/lib/identity/keystore";
export * as vaultStub from "@/lib/vault/vault";
export * as nextStub from "next/server";
`,
};
for (const [name, src] of Object.entries(stubs)) writeFileSync(S(name), src);
// MUTATION TESTING (the test-vacuity lesson): CONNECTOR_MUTATION='{"file":"lib/fc/connector.server.ts","find":"…","replace":"…"}'
// rewrites ONE source file IN THE BUNDLE ONLY — the repo is never touched — so a check can be shown to fail when the
// rule it guards is removed. An anchor that does not match aborts the run: a mutation can never silently not apply.
const mutation = process.env.CONNECTOR_MUTATION ? JSON.parse(process.env.CONNECTOR_MUTATION) : null;
const mutatePlugin = {
  name: "mutate",
  setup(b) {
    if (!mutation) return;
    const { readFileSync } = require("node:fs");
    let applied = false;
    b.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
      if (!args.path.split(path.sep).join("/").endsWith(mutation.file)) return undefined;
      const src = readFileSync(args.path, "utf8").replace(/\r\n/g, "\n");
      if (!src.includes(mutation.find)) throw new Error("MUTATION ANCHOR NOT FOUND in " + mutation.file + ": " + mutation.find);
      applied = true;
      return { contents: src.replace(mutation.find, mutation.replace), loader: args.path.endsWith(".tsx") ? "tsx" : "ts", resolveDir: path.dirname(args.path) };
    });
    b.onEnd(() => {
      if (!applied) throw new Error("MUTATION FILE NOT IN THE BUNDLE: " + mutation.file);
    });
  },
};
let M;
try {
  const out = S("bundle.mjs");
  await build({
    plugins: [mutatePlugin],
    absWorkingDir: ROOT,
    entryPoints: [S("entry.ts")],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT, "tsconfig.json"),
    logLevel: "error",
    nodePaths: [path.join(ROOT, "node_modules")],
    alias: {
      "server-only": S("server-only.ts"),
      "next/server": S("next-server.ts"),
      "viem/accounts": S("viem-accounts.ts"),
      "@/lib/vault/vault": S("vault.ts"),
      "@/lib/adapters/mock/persist": S("persist.ts"),
      "@/lib/identity/keystore": S("keystore.ts"),
      "@/lib/identity/keys": S("keys.ts"),
      "@/lib/identity/personaKind": S("personaKind.ts"),
      "@/lib/identity/roster": S("misc.ts"),
      "@/lib/adapters/mock/store": S("store.ts"),
      "@/lib/data": S("misc.ts"),
      "@/lib/zk/config": S("zk-config.ts"),
    },
  });
  M = await import(pathToFileURL(out).href);
} catch (e) {
  console.log("cannot bundle the connector modules: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
rmSync(tmp, { recursive: true, force: true });
const { connector, connect, pf, route, ownerAccess, persistStub, ksStub, vaultStub, nextStub } = M;
for (const [n, f] of Object.entries({ connectorStatus: connector.connectorStatus, createConnector: connector.createConnector, registerConnector: connector.registerConnector, nameConnector: connector.nameConnector, sealedConnectorForConnect: connector.sealedConnectorForConnect, resetConnectorCache: connector.resetConnectorCache, connectorGate: connector.connectorGate, connectStatus: connect.connectStatus, startConnect: connect.startConnect, GET: route.GET, POST: route.POST })) {
  if (typeof f !== "function") {
    console.log(`the connector modules no longer export ${n} — this harness cannot run`);
    process.exit(2);
  }
}
const generatedKeys = () => (globalThis.__unitGeneratedKeys ??= []);

// ---------------------------------------------------------------------------------------------------- env
const BASE_ENV = { ...process.env };
const ENV_NAMES = [
  "NODE_ENV", "ZK_DEV_HOOKS", "OWNER_ACCESS_SECRET", "OWNER_SESSION_DAYS", "ENABLE_FC_WRITE", "ENABLE_WRITE", "NEYNAR_API_KEY", "FC_TEST_FID", "FC_TEST_SIGNER_UUID",
  "FC_TEST_FNAME", "FC_CONNECT_APP_FID", "FC_CONNECT_APP_CUSTODY_KEY", "FC_CONNECT_RPC_URL", "FC_CONNECT_SPONSOR", "FC_CONNECT_RELAYERS", "FC_LAYERS_ADDRESSES",
  "FC_RESERVED_FIDS", "FC_ANON_FID", "LAYERS_WORLD", "PERSONA_NETWORK_MODE", "DATA_SOURCE", "NEYNAR_SIGNER_UUID", "FC_TEST_CUSTODY_PRIVATE_KEY", "NEYNAR_VIEWER_FID",
  "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "LAYERS_HOSTED",
];
function setEnv(vars) {
  for (const k of Object.keys(process.env)) if (!(k in BASE_ENV)) delete process.env[k];
  for (const k of ENV_NAMES) delete process.env[k];
  Object.assign(process.env, vars);
}
const SECRET = "unit-owner-secret-0123456789abcdef"; // a test value, never a real passphrase
const NEYNAR_KEY = "unit-test-neynar-key-not-real";
const RPC = "https://rpc.unit.invalid/";
const APP_WALLET = "0x60a5a799062017bdccc892f1832d94fd5923ebf8"; // a test value here; production reads FC_LAYERS_ADDRESSES
const OWNER_ENV = {
  NODE_ENV: "production",
  ZK_DEV_HOOKS: "true",
  OWNER_ACCESS_SECRET: SECRET,
  ENABLE_FC_WRITE: "true",
  NEYNAR_API_KEY: NEYNAR_KEY,
  FC_TEST_FID: "3348985",
  FC_TEST_SIGNER_UUID: "throwaway-signer-uuid",
  FC_TEST_FNAME: "layers-test-852c",
  FC_CONNECT_RPC_URL: RPC,
  FC_LAYERS_ADDRESSES: APP_WALLET,
  FC_RESERVED_FIDS: "3348983,3348984,3348986,3348987,3348988,3348990,3348991",
  FC_ANON_FID: "777777",
};
const RIG_ENV = { NODE_ENV: "development", ZK_DEV_HOOKS: "true", FC_TEST_FID: "3348985", FC_TEST_FNAME: "layers-test-852c" };

// ---------------------------------------------------------------------------------------------------- the fake network
const ID_GATEWAY = "0x00000000fc25870c6ed6b6c7e41fb078b7656f69";
const ID_REGISTRY = "0x00000000fc6c5f01fc30151999387bb99a9f489b";
const PRICE = 77733916415441n; // IdGateway.price() as read 2026-10-07
const GAS_ESTIMATE = 250000n;
const GAS_PRICE = 100000000n; // 0.1 gwei
const PRIORITY = 1000000n;
const ETH = (s) => viem.parseEther(s);
const GATEWAY_ABI = [
  { type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ name: "price", type: "uint256" }] },
  { type: "function", name: "register", stateMutability: "payable", inputs: [{ name: "recovery", type: "address" }], outputs: [{ name: "fid", type: "uint256" }, { name: "overpayment", type: "uint256" }] },
];
const REGISTRY_ABI = [
  { type: "function", name: "idOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "fid", type: "uint256" }] },
  { type: "function", name: "custodyOf", stateMutability: "view", inputs: [{ name: "fid", type: "uint256" }], outputs: [{ name: "owner", type: "address" }] },
];
const FNAME_DOMAIN = { name: "Farcaster name verification", version: "1", chainId: 1, verifyingContract: "0xe3be01d99baa8db9905b33a3ca391238234b79d1" };
const FNAME_TYPES = { UserNameProof: [{ name: "name", type: "string" }, { name: "timestamp", type: "uint256" }, { name: "owner", type: "address" }] };
const SKR_DOMAIN = { name: "Farcaster SignedKeyRequestValidator", version: "1", chainId: 10, verifyingContract: "0x00000000FC700472606ED4fA22623Acf62c60553" };
const SKR_TYPES = { SignedKeyRequest: [{ name: "requestFid", type: "uint256" }, { name: "key", type: "bytes" }, { name: "deadline", type: "uint256" }] };
const lc = (s) => String(s ?? "").toLowerCase();
const hexQty = (n) => "0x" + BigInt(n).toString(16);

const chain = {
  chainId: 10,
  balances: new Map(), // address → wei
  fids: new Map(), // custody address → fid
  nextFid: 900001,
  nonces: new Map(),
  calls: [], // every RPC method
  sent: [], // decoded raw transactions
  receipts: new Map(), // hash → { status }
  pending: new Map(), // hash → null answers still to give before it mines
  receiptMode: "mined", // mined | revert | never | pending:<n>
  down: 0, // HTTP 500 answers still to give
  rejectSend: null, // a JSON-RPC error message eth_sendRawTransaction answers with (nothing broadcast)
  reset() {
    this.rejectSend = null;
    this.chainId = 10;
    this.balances = new Map();
    this.fids = new Map();
    this.nextFid = 900001;
    this.nonces = new Map();
    this.calls = [];
    this.sent = [];
    this.receipts = new Map();
    this.pending = new Map();
    this.receiptMode = "mined";
    this.down = 0;
  },
  count(method) {
    return this.calls.filter((m) => m === method).length;
  },
  custodyOf(fid) {
    for (const [a, f] of this.fids) if (f === Number(fid)) return a;
    return "0x0000000000000000000000000000000000000000";
  },
  mine(hash) {
    const tx = this.sent.find((t) => t.hash === hash);
    if (!tx) return;
    if (this.receiptMode === "revert") {
      this.receipts.set(hash, { status: "0x0" });
      return;
    }
    this.receipts.set(hash, { status: "0x1" });
    if (tx.to === ID_GATEWAY && tx.value === PRICE && tx.fn === "register" && !this.fids.has(tx.from)) this.fids.set(tx.from, this.nextFid++);
  },
};
async function rpcAnswer(body) {
  const { method, params, id } = body;
  chain.calls.push(method);
  const ok = (result) => json(200, { jsonrpc: "2.0", id, result });
  const err = (message) => json(200, { jsonrpc: "2.0", id, error: { code: -32000, message } });
  switch (method) {
    case "eth_chainId":
      return ok(hexQty(chain.chainId));
    case "eth_getBalance":
      return ok(hexQty(chain.balances.get(lc(params[0])) ?? 0n));
    case "eth_call": {
      const { to, data } = params[0];
      if (lc(to) === ID_GATEWAY) {
        const { functionName } = decodeFunctionData({ abi: GATEWAY_ABI, data });
        if (functionName === "price") return ok(encodeFunctionResult({ abi: GATEWAY_ABI, functionName: "price", result: PRICE }));
      }
      if (lc(to) === ID_REGISTRY) {
        const { functionName, args } = decodeFunctionData({ abi: REGISTRY_ABI, data });
        if (functionName === "idOf") return ok(encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "idOf", result: BigInt(chain.fids.get(lc(args[0])) ?? 0) }));
        if (functionName === "custodyOf") return ok(encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "custodyOf", result: chain.custodyOf(args[0]) }));
      }
      return err("unexpected eth_call");
    }
    case "eth_estimateGas":
      return ok(hexQty(GAS_ESTIMATE));
    case "eth_gasPrice":
      return ok(hexQty(GAS_PRICE));
    case "eth_maxPriorityFeePerGas":
      return ok(hexQty(PRIORITY));
    case "eth_getTransactionCount":
      return ok(hexQty(chain.nonces.get(lc(params[0])) ?? 0));
    case "eth_sendRawTransaction": {
      const raw = params[0];
      if (chain.rejectSend) return err(chain.rejectSend); // the node refuses the bytes: nothing is broadcast
      const tx = parseTransaction(raw);
      const from = lc(await recoverTransactionAddress({ serializedTransaction: raw }));
      const hash = keccak256(raw);
      let fn = null;
      try {
        fn = decodeFunctionData({ abi: GATEWAY_ABI, data: tx.data }).functionName;
      } catch {
        fn = null;
      }
      const decoded = { hash, from, to: lc(tx.to), value: tx.value, data: tx.data, chainId: tx.chainId, nonce: tx.nonce, gas: tx.gas, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas, type: tx.type, fn, recovery: fn === "register" ? lc(decodeFunctionData({ abi: GATEWAY_ABI, data: tx.data }).args[0]) : null };
      chain.sent.push(decoded);
      chain.nonces.set(from, (chain.nonces.get(from) ?? 0) + 1);
      if (chain.receiptMode === "mined" || chain.receiptMode === "revert") chain.mine(hash);
      else if (chain.receiptMode.startsWith("pending:")) chain.pending.set(hash, Number(chain.receiptMode.slice(8)));
      return ok(hash);
    }
    case "eth_getTransactionReceipt": {
      const hash = lc(params[0]);
      const found = [...chain.receipts.entries()].find(([h]) => lc(h) === hash);
      if (found) return ok({ status: found[1].status, blockNumber: "0x1", transactionHash: found[0] });
      const pend = [...chain.pending.entries()].find(([h]) => lc(h) === hash);
      if (pend) {
        if (pend[1] <= 0) {
          chain.pending.delete(pend[0]);
          chain.mine(pend[0]);
          const r = chain.receipts.get(pend[0]);
          return ok({ status: r.status, blockNumber: "0x1", transactionHash: pend[0] });
        }
        chain.pending.set(pend[0], pend[1] - 1);
      }
      return ok(null);
    }
    default:
      net.unexpected.push("rpc " + method);
      return err("unexpected method " + method);
  }
}

const fnames = {
  transfers: new Map(), // name → transfer[]
  posts: [],
  down: 0,
  reset() {
    this.transfers = new Map();
    this.posts = [];
    this.down = 0;
  },
};
async function fnameAnswer(method, u, body) {
  if (fnames.down > 0) {
    fnames.down--;
    return json(503, { error: "down" });
  }
  if (method === "GET" && u.pathname === "/transfers") return json(200, { transfers: fnames.transfers.get(u.searchParams.get("name")) ?? [] });
  if (method === "POST" && u.pathname === "/transfers") {
    fnames.posts.push(body);
    const { name, from, to, fid, owner, timestamp, signature } = body;
    if (!/^[a-z0-9][a-z0-9-]{0,15}$/.test(String(name))) return json(400, { code: "VALIDATION_FAILURE", error: "invalid name" });
    const cur = fnames.transfers.get(name) ?? [];
    if (cur.length && Number(cur[cur.length - 1].to) !== 0) return json(400, { code: "TOO_MANY_NAMES", error: "name is taken" });
    let recovered = "";
    try {
      recovered = lc(await recoverTypedDataAddress({ domain: FNAME_DOMAIN, types: FNAME_TYPES, primaryType: "UserNameProof", message: { name, timestamp: BigInt(timestamp), owner }, signature }));
    } catch {
      recovered = "";
    }
    if (recovered !== lc(owner)) return json(400, { code: "VALIDATION_FAILURE", error: "invalid signature" });
    if (lc(chain.custodyOf(fid)) !== lc(owner)) return json(400, { code: "VALIDATION_FAILURE", error: "owner is not the custody of fid" });
    const t = { id: fnames.posts.length, timestamp, username: name, owner: lc(owner), from: Number(from), to: Number(to), user_signature: signature, server_signature: "0x" };
    fnames.transfers.set(name, [...cur, t]);
    return json(200, { transfer: t });
  }
  net.unexpected.push(method + " " + u.href);
  return json(404, { error: "unexpected fname path" });
}

const net = {
  unexpected: [],
  users: new Map(),
  signers: new Map(),
  reset() {
    this.unexpected = [];
    this.users = new Map();
    this.signers = new Map();
  },
  addUser(u) {
    const user = { object: "user", fid: u.fid, username: u.username, display_name: u.display_name ?? null, pfp_url: "https://example.invalid/pfp.png", custody_address: u.custody_address, profile: { bio: { text: u.bio ?? "bio of " + u.username } }, verified_addresses: { eth_addresses: u.verified ?? [], sol_addresses: [], primary: { eth_address: null, sol_address: null } } };
    this.users.set("u:" + u.username, user);
    this.users.set("f:" + u.fid, user);
  },
};
async function neynarAnswer(method, u, init, body) {
  const headers = new Headers(init.headers || {});
  if (headers.get("x-api-key") !== NEYNAR_KEY) return json(401, { message: "bad key" });
  const p = u.pathname.replace("/v2/farcaster", "");
  if (method === "GET" && p === "/user/by_username") {
    const user = net.users.get("u:" + u.searchParams.get("username"));
    return user ? json(200, { user }) : json(404, { message: "User not found" });
  }
  if (method === "GET" && p === "/user/bulk") {
    const user = net.users.get("f:" + u.searchParams.get("fids"));
    return json(200, { users: user ? [user] : [] });
  }
  if (method === "POST" && p === "/signer") {
    const uuid = "uuid-" + toHex(crypto.getRandomValues(new Uint8Array(8))).slice(2);
    const public_key = toHex(crypto.getRandomValues(new Uint8Array(32)));
    net.signers.set(uuid, { status: "generated", fid: null, public_key });
    return json(200, { signer_uuid: uuid, public_key, status: "generated" });
  }
  if (method === "POST" && p === "/signer/signed_key") {
    const s = net.signers.get(body.signer_uuid);
    if (!s) return json(404, { message: "signer not found" });
    const custody = chain.custodyOf(body.app_fid);
    let recovered = "";
    try {
      recovered = lc(await recoverTypedDataAddress({ domain: SKR_DOMAIN, types: SKR_TYPES, primaryType: "SignedKeyRequest", message: { requestFid: BigInt(body.app_fid), key: s.public_key, deadline: BigInt(body.deadline) }, signature: body.signature }));
    } catch {
      recovered = "";
    }
    if (recovered !== lc(custody)) return json(400, { message: "requestSigner does not match app custody address" });
    Object.assign(s, { status: "pending_approval", app_fid: Number(body.app_fid), deadline: Number(body.deadline), signature: body.signature, verifiedAgainst: lc(custody) });
    return json(200, { signer_uuid: body.signer_uuid, public_key: s.public_key, status: "pending_approval", signer_approval_url: "https://client.farcaster.xyz/deeplinks/signed-key-request?token=" + toHex(crypto.getRandomValues(new Uint8Array(12))) });
  }
  if (method === "GET" && p === "/signer") {
    const s = net.signers.get(u.searchParams.get("signer_uuid"));
    if (!s) return json(404, { message: "signer not found" });
    return json(200, { signer_uuid: u.searchParams.get("signer_uuid"), public_key: s.public_key, status: s.status, fid: s.fid ?? undefined });
  }
  net.unexpected.push(method + " " + u.href);
  return json(404, { message: "unexpected neynar path " + p });
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (url === RPC) {
    if (chain.down > 0) {
      chain.down--;
      chain.calls.push(body.method);
      return json(500, { error: "rpc down" });
    }
    return rpcAnswer(body);
  }
  const u = new URL(url);
  if (u.origin === "https://fnames.farcaster.xyz") return fnameAnswer(method, u, body);
  if (u.origin === "https://api.neynar.com") return neynarAnswer(method, u, init, body);
  net.unexpected.push(method + " " + url);
  throw new Error("UNEXPECTED NETWORK CALL: " + method + " " + url);
};

// ---------------------------------------------------------------------------------------------------- state helpers
const NS = "fcConnector";
function resetAll() {
  persistStub.validatorStore.clear();
  persistStub.persistKnobs.failReads = 0;
  persistStub.persistKnobs.failFlushes = 0;
  persistStub.persistKnobs.flushes = 0; // `flushed` is kept across resets: L2 scans every sealed write of the run
  pf.resetPersonaFidCache();
  connector.resetConnectorCache();
  connect.resetConnectFixture();
  ksStub.ks.personas.length = 0;
  chain.reset();
  fnames.reset();
  net.reset();
  globalThis.__layersCastAuthorCache = new Map();
  globalThis.__layersNameFidCache = new Map();
}
/** the sealed record as the validator holds it, decrypted with the stub's key (what the next process would load) */
function storedRecord() {
  const entries = persistStub.validatorStore.get(NS);
  if (!entries) return null;
  const plain = vaultStub.decryptNamespace(NS, entries);
  return plain._?.m?.record ?? null;
}
const syntheticKeys = [];
/** a record the harness seals itself (a crash state, a clashing address): its keys are the harness's own throwaways */
function sealSynthetic(over = {}) {
  const custodyKey = generatePrivateKey();
  const recoveryKey = generatePrivateKey();
  syntheticKeys.push(custodyKey, recoveryKey);
  const rec = {
    v: 1,
    custodyKey,
    recoveryKey,
    address: lc(privateKeyToAccount(custodyKey).address),
    recoveryAddress: lc(privateKeyToAccount(recoveryKey).address),
    createdAt: Date.now() - 60_000,
    fid: null,
    registeredAt: null,
    registerTx: null,
    registerSentAt: null,
    fname: null,
    namedAt: null,
    note: null,
    ...over,
  };
  persistStub.validatorStore.set(NS, vaultStub.encryptNamespace(NS, { _: { m: { record: rec }, pad: "" } }));
  connector.resetConnectorCache();
  return rec;
}
/** create + fund + register on the fake chain: the connector as the owner leaves it after arm-connector.ps1 */
async function registered() {
  const c = seen(await connector.createConnector());
  chain.balances.set(c.address, ETH("0.0005"));
  return seen(await connector.registerConnector("REGISTER"));
}
async function personaWithFid({ fid, fname, custodyAddress, origin = "fixture" }) {
  const p = ksStub.createPersona({ name: fname, handle: fname.replace(/-/g, "_"), kind: "public" });
  await pf.recordPersonaFid({ personaId: p.id, fid, fname, origin, custodyAddress, signer: { kind: "neynar-managed", uuid: "uuid-" + fid, derivedPubHex: "00".repeat(32), derivedRegistered: true }, registrant: "neynar-sponsor", funder: "neynar-sponsor", createdAt: Date.now(), mode: "fixture" });
  return p;
}
const FUNDING = (address) => `Send about 0.0005 ETH on OPTIMISM to ${address} from an exchange withdrawal; never from the Neynar wallet, your main wallet or a persona.`;

// the owner session the route checks: the REAL owner-access module, with a state source the harness registers
const EPOCH = "ab".repeat(16);
ownerAccess.registerOwnerStateSource(async () => ({ epoch: EPOCH, slots: [] }));
const COOKIE = ownerAccess.OWNER_COOKIE;
let ownerCookie = null;
async function cookieHeader() {
  ownerCookie ??= await ownerAccess.mintOwnerCookie(SECRET, { epoch: EPOCH, via: "p" });
  return `${COOKIE}=${ownerCookie}`;
}
async function call(method, body, { cookie = true, raw } = {}) {
  const headers = {};
  if (cookie) headers.cookie = await cookieHeader();
  const init = { method, headers };
  if (method === "POST") {
    headers["content-type"] = "application/json";
    init.body = raw !== undefined ? raw : JSON.stringify(body);
  }
  const req = new nextStub.NextRequest("http://owner.local/api/fc/connector", init);
  const res = await (method === "GET" ? route.GET(req) : route.POST(req));
  const text = await res.text();
  outputs.push(text);
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, data, text, cacheControl: res.headers.get("cache-control") };
}

console.log("CONNECTOR SETUP — unit harness (no network; fake Optimism RPC, fname registry and Neynar, in-process)\n");

// ==================================================================================================== GATE
console.log("GATE — where it runs");
await check("G1 a public deployment refuses: status unavailable (public_site, next = the reason), create rejects, nothing fetched", async () => {
  resetAll();
  setEnv({ NODE_ENV: "production" });
  const st = seen(await connector.connectorStatus());
  assert(!st.available && st.code === "public_site" && st.stage === "none" && st.next === st.reason, "status " + JSON.stringify(st));
  await rejects(connector.createConnector(), "public_site", "create");
  assert(chain.calls.length === 0 && net.unexpected.length === 0, "network touched");
});
await check("G2 inside the browser device (window defined): the gate says device, create rejects, the route answers 404 to GET and POST", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  globalThis.window = {};
  try {
    assert((await connector.connectorGate()).code === "device", "gate");
    await rejects(connector.createConnector(), "device", "create");
    const g = await call("GET");
    const p = await call("POST", { action: "create" });
    assert(g.status === 404 && g.data.code === "device" && p.status === 404, `route ${g.status}/${p.status}`);
  } finally {
    delete globalThis.window;
  }
  assert(persistStub.persistKnobs.flushes === 0, "something was sealed");
});
await check("G3 the laptop rig (no owner secret) refuses: not_owner_service — the fixture connector is the rig's, nothing to create", async () => {
  resetAll();
  setEnv(RIG_ENV);
  assert(connect.connectGate().mode === "fixture", "the rig's connect gate should be fixture");
  const st = seen(await connector.connectorStatus());
  assert(!st.available && st.code === "not_owner_service", JSON.stringify(st));
  await rejects(connector.createConnector(), "not_owner_service", "create");
});
await check("G4 the owner service with writes NOT armed refuses (writes_unarmed, 409) — connecting gives the account nothing to do", async () => {
  resetAll();
  setEnv({ ...OWNER_ENV, ENABLE_FC_WRITE: "false" });
  const st = seen(await connector.connectorStatus());
  assert(!st.available && st.code === "writes_unarmed", JSON.stringify(st));
  const e = await rejects(connector.createConnector(), "writes_unarmed", "create");
  assert(e.status === 409, "status " + e.status);
});
await check("G5 the armed owner service is admitted: stage none, source none, next names arm-connector.ps1, no key names in the view", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const g = await connector.connectorGate();
  assert(g.ok, JSON.stringify(g));
  const st = seen(await connector.connectorStatus());
  assert(st.available && st.stage === "none" && st.source === "none" && !st.envSet && st.address === null && /arm-connector\.ps1/.test(st.next), JSON.stringify(st));
  assert(!("custodyKey" in st) && !("recoveryKey" in st), "key fields in the view");
});

// ==================================================================================================== ENV
console.log("\nENV — the environment names win when set");
await check("E1 FC_CONNECT_APP_FID + the key set: create refuses (env_connector_set 409), status.source env, connect.ts signs with the env key", async () => {
  resetAll();
  const key = generatePrivateKey();
  syntheticKeys.push(key);
  setEnv({ ...OWNER_ENV, FC_CONNECT_APP_FID: "424242", FC_CONNECT_APP_CUSTODY_KEY: key });
  const st = seen(await connector.connectorStatus());
  assert(st.envSet && st.source === "env" && st.stage === "none", JSON.stringify(st));
  const e = await rejects(connector.createConnector(), "env_connector_set", "create");
  assert(e.status === 409 && persistStub.persistKnobs.flushes === 0, "sealed something, or status " + e.status);
  const cs = seen(await connect.connectStatus());
  assert(cs.connector.configured && cs.connector.source === "env" && cs.connector.appFid === 424242, JSON.stringify(cs.connector));
});
await check("E2 a half-set pair (the fid name only): create still refuses, and connect.ts reports it instead of falling through to the sealed record", async () => {
  resetAll();
  setEnv({ ...OWNER_ENV, FC_CONNECT_APP_FID: "424242" });
  await rejects(connector.createConnector(), "env_connector_set", "create");
  const cs = seen(await connect.connectStatus());
  assert(!cs.connector.configured && /FC_CONNECT_APP_CUSTODY_KEY is not set/.test(cs.connector.reason), JSON.stringify(cs.connector));
});

// ==================================================================================================== CREATE
console.log("\nCREATE — the keys sealed, the address out");
await check("C1 create: stage unfunded, the custody ADDRESS and a different recovery address, fid null, the exact funding sentence, the chain read (balance 0, the price), one sealed write holding ciphertext only", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const before = generatedKeys().length;
  const st = seen(await connector.createConnector());
  assert(st.stage === "unfunded" && /^0x[0-9a-f]{40}$/.test(st.address) && /^0x[0-9a-f]{40}$/.test(st.recoveryAddress) && st.address !== st.recoveryAddress && st.fid === null, JSON.stringify(st));
  assert(st.funding && st.funding.amountEth === "0.0005" && st.funding.chain === "Optimism" && st.funding.instruction === FUNDING(st.address), "funding " + JSON.stringify(st.funding));
  assert(st.chain && st.chain.ok && st.chain.balanceEth === "0" && st.chain.priceWei === PRICE.toString() && st.chain.priceEth === formatEther(PRICE) && BigInt(st.chain.requiredWei) > PRICE && st.chain.shortfallEth === formatEther(BigInt(st.chain.requiredWei)), "chain " + JSON.stringify(st.chain));
  assert(generatedKeys().length === before + 2, `generated ${generatedKeys().length - before} key(s), expected 2 (custody + recovery)`);
  assert(persistStub.persistKnobs.flushes === 1, "flushes " + persistStub.persistKnobs.flushes);
  const entries = persistStub.validatorStore.get(NS);
  const rec = entries && entries._;
  assert(rec && rec.v === 1 && typeof rec.ct === "string" && typeof rec.nonce === "string", "the stored record is not ciphertext-shaped");
  assert(storedRecord().address === st.address && /^0x[0-9a-f]{64}$/.test(storedRecord().custodyKey), "the sealed record does not hold the keys");
  assert(privateKeyToAccount(storedRecord().custodyKey).address.toLowerCase() === st.address, "the sealed custody key is not the key of the address returned");
  return `address ${st.address.slice(0, 10)}…, price ${st.chain.priceEth} ETH, required ${st.chain.requiredEth} ETH`;
});
await check("C2 create again (and a status read): the same address, NO new key, NO new sealed write — idempotent", async () => {
  const keys = generatedKeys().length;
  const flushes = persistStub.persistKnobs.flushes;
  const first = storedRecord();
  const again = seen(await connector.createConnector());
  const st = seen(await connector.connectorStatus());
  assert(again.address === first.address && st.address === first.address && again.stage === "unfunded", "address changed");
  assert(generatedKeys().length === keys && persistStub.persistKnobs.flushes === flushes, "a key was generated or sealed again");
  connector.resetConnectorCache(); // a NEW process: loads the record from the validator and still creates nothing
  const fresh = seen(await connector.createConnector());
  assert(fresh.address === first.address && generatedKeys().length === keys && persistStub.persistKnobs.flushes === flushes, "a new process created a second connector");
});
await check("C3 the stage follows the balance: the price alone is still unfunded (the shortfall named), price + margin is funded; the view's required amount is the one the register step judges first", async () => {
  const st0 = seen(await connector.connectorStatus());
  chain.balances.set(st0.address, PRICE);
  const st1 = seen(await connector.connectorStatus());
  assert(st1.stage === "unfunded" && st1.chain.shortfallEth !== null && BigInt(st1.chain.balanceWei) === PRICE, JSON.stringify(st1.chain));
  chain.balances.set(st0.address, BigInt(st1.chain.requiredWei));
  const st2 = seen(await connector.connectorStatus());
  assert(st2.stage === "funded" && st2.chain.shortfallEth === null && /REGISTER/.test(st2.next), JSON.stringify(st2));
  assert(chain.count("eth_getBalance") >= 3 && chain.count("eth_call") >= 3, "the chain was not read on each status");
});
await check("C4 a vault that cannot be read REFUSES (vault_unavailable 503, retryable) for status and create, seals nothing — and once readable again create returns the EXISTING record, never a second key", async () => {
  const keys = generatedKeys().length;
  const flushes = persistStub.persistKnobs.flushes;
  const first = storedRecord();
  connector.resetConnectorCache();
  persistStub.persistKnobs.failReads = 3;
  const e1 = await rejects(connector.connectorStatus(), "vault_unavailable", "status");
  assert(e1.status === 503 && e1.retryable === true, "status " + e1.status + " retryable " + e1.retryable);
  persistStub.persistKnobs.failReads = 3;
  await rejects(connector.createConnector(), "vault_unavailable", "create");
  assert(generatedKeys().length === keys && persistStub.persistKnobs.flushes === flushes, "a key was generated or sealed while the vault could not be read");
  const back = seen(await connector.createConnector());
  assert(back.address === first.address && generatedKeys().length === keys, "a second connector was created after the outage");
});
await check("C5 a namespace that holds records none of which is readable is a CORRUPTED vault: refused, never treated as empty, nothing sealed over it", async () => {
  const keys = generatedKeys().length;
  const flushes = persistStub.persistKnobs.flushes;
  const good = persistStub.validatorStore.get(NS);
  persistStub.validatorStore.set(NS, { _: { v: 1, ns: NS, id: "_", nonce: "00".repeat(12), ct: Buffer.from("garbage").toString("base64") } });
  connector.resetConnectorCache();
  await rejects(connector.createConnector(), "vault_unavailable", "create");
  await rejects(connector.connectorStatus(), "vault_unavailable", "status");
  assert(generatedKeys().length === keys && persistStub.persistKnobs.flushes === flushes, "sealed over a corrupted namespace");
  persistStub.validatorStore.set(NS, good);
  connector.resetConnectorCache();
});
await check("C6 the RPC down: the stage is 'created' with the chain's reason, the next step says so, and create still answers (the keys do not wait for the chain)", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  chain.down = 20;
  const st = seen(await connector.createConnector());
  assert(st.stage === "created" && st.chain && st.chain.ok === false && /could not be read|answered/.test(st.chain.reason) && /could not be read/.test(st.next), JSON.stringify({ stage: st.stage, chain: st.chain, next: st.next }));
  chain.down = 0;
  const st2 = seen(await connector.connectorStatus());
  assert(st2.stage === "unfunded" && st2.address === st.address, "did not recover");
});

// ==================================================================================================== REGISTER
console.log("\nREGISTER — typed, funded, exactly one transaction");
await check("R1 without the typed word: confirm_required (400), nothing sent", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  seen(await connector.createConnector());
  const e = await rejects(connector.registerConnector(""), "confirm_required", "register");
  assert(e.status === 400 && chain.sent.length === 0, "sent " + chain.sent.length);
  await rejects(connector.registerConnector("register"), "confirm_required", "lowercase");
});
await check("R2 unfunded: refused (unfunded, 409) with the funding sentence; ZERO eth_sendRawTransaction", async () => {
  const st = seen(await connector.connectorStatus());
  const e = await rejects(connector.registerConnector("REGISTER"), "unfunded", "register");
  assert(e.status === 409 && e.message.includes(FUNDING(st.address)) && /Nothing was sent/.test(e.message), e.message);
  assert(chain.count("eth_sendRawTransaction") === 0, "a transaction was sent");
});
await check("R3 the RPC answers for another chain: wrong_chain, nothing sent (even when funded)", async () => {
  const st = seen(await connector.connectorStatus());
  chain.balances.set(st.address, ETH("0.0005"));
  chain.chainId = 1;
  const e = await rejects(connector.registerConnector("REGISTER"), "wrong_chain", "register");
  assert(/chain 1, not Optimism \(10\)/.test(e.message) && chain.count("eth_sendRawTransaction") === 0, e.message);
  chain.chainId = 10;
});
await check("R4 a balance past the status margin but short of today's gas estimate: refused (unfunded) naming the gas, nothing sent", async () => {
  const st = seen(await connector.connectorStatus());
  chain.balances.set(st.address, BigInt(st.chain.requiredWei)); // = price + the status margin: "funded" on the status line
  assert((await connector.connectorStatus()).stage === "funded", "not funded on the status line");
  const e = await rejects(connector.registerConnector("REGISTER"), "unfunded", "register");
  assert(/today's gas/.test(e.message) && /L1 data fee/.test(e.message) && chain.count("eth_sendRawTransaction") === 0, e.message);
});
await check("R5 funded: EXACTLY ONE raw transaction — from the custody address, to IdGateway, value = price, data = register(recovery), chain 10, EIP-1559 — the fid read back from IdRegistry.idOf and sealed; the view says registered", async () => {
  const st = seen(await connector.connectorStatus());
  chain.balances.set(st.address, ETH("0.0005"));
  const out = seen(await connector.registerConnector("REGISTER"));
  assert(chain.sent.length === 1, "sent " + chain.sent.length);
  const tx = chain.sent[0];
  assert(tx.from === st.address && tx.to === ID_GATEWAY && tx.value === PRICE && tx.chainId === 10 && tx.type === "eip1559", JSON.stringify({ from: tx.from, to: tx.to, value: String(tx.value), chainId: tx.chainId, type: tx.type }));
  assert(tx.fn === "register" && tx.recovery === st.recoveryAddress, "data is not register(recoveryAddress)");
  assert(tx.data === encodeFunctionData({ abi: GATEWAY_ABI, functionName: "register", args: [st.recoveryAddress] }), "calldata differs");
  assert(tx.gas >= (GAS_ESTIMATE * 13n) / 10n && tx.maxFeePerGas >= GAS_PRICE && tx.maxPriorityFeePerGas === PRIORITY, "gas fields " + JSON.stringify({ gas: String(tx.gas), maxFee: String(tx.maxFeePerGas), tip: String(tx.maxPriorityFeePerGas) }));
  const fid = chain.fids.get(st.address);
  assert(out.stage === "registered" && out.fid === fid && out.registerTx === tx.hash && out.source === "sealed" && out.funding === null && /QR connect is ready/.test(out.next), JSON.stringify({ stage: out.stage, fid: out.fid, tx: out.registerTx, next: out.next }));
  const rec = storedRecord();
  assert(rec.fid === fid && rec.registerTx === tx.hash && rec.registeredAt && rec.note === null, "the sealed record was not updated");
  return `fid ${fid}, tx ${tx.hash.slice(0, 12)}…`;
});
await check("R6 register again (and in a new process): idempotent — the same fid, no second transaction", async () => {
  const fid = (await connector.connectorStatus()).fid;
  const again = seen(await connector.registerConnector("REGISTER"));
  connector.resetConnectorCache();
  const fresh = seen(await connector.registerConnector("REGISTER"));
  assert(again.fid === fid && fresh.fid === fid && chain.sent.length === 1, `sent ${chain.sent.length}`);
  assert(chain.count("eth_sendRawTransaction") === 1, "a second send");
});
await check("R7 a REVERTED registration: the hash and the revert named in the note, the record back to funded (no fid), exactly one send — then a retry sends once more and registers", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const c = seen(await connector.createConnector());
  chain.balances.set(c.address, ETH("0.0005"));
  chain.receiptMode = "revert";
  const out = seen(await connector.registerConnector("REGISTER"));
  assert(out.stage === "funded" && out.fid === null && out.registerTx === null && /REVERTED/.test(out.note) && out.note.includes(chain.sent[0].hash), JSON.stringify({ stage: out.stage, note: out.note }));
  assert(/REGISTER/.test(out.next) && out.chain && out.chain.ok, "the view after a revert did not re-read the balance: " + out.next);
  assert(chain.sent.length === 1, "sent " + chain.sent.length);
  chain.receiptMode = "mined";
  const retry = seen(await connector.registerConnector("REGISTER"));
  assert(retry.stage === "registered" && retry.fid === chain.fids.get(c.address) && retry.note === null && chain.sent.length === 2 && chain.sent[1].nonce === 1, JSON.stringify({ stage: retry.stage, sent: chain.sent.length, nonce: chain.sent[1] && chain.sent[1].nonce }));
});

await check("R8 the node REFUSES the raw transaction (insufficient funds at today's fee): rpc_error, the sealed hash cleared at once (stage funded, not registering), the note says nothing was sent — and a retry sends once and registers", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const c = seen(await connector.createConnector());
  chain.balances.set(c.address, ETH("0.0005"));
  chain.rejectSend = "insufficient funds for gas * price + value";
  const e = await rejects(connector.registerConnector("REGISTER"), "rpc_error", "register");
  assert(e.retryable === true && chain.sent.length === 0, "sent " + chain.sent.length);
  const st = seen(await connector.connectorStatus());
  assert(st.stage === "funded" && st.registerTx === null && /refused the registration transaction/.test(st.note) && /Nothing was sent/.test(st.note), JSON.stringify({ stage: st.stage, tx: st.registerTx, note: st.note }));
  chain.rejectSend = null;
  const out = seen(await connector.registerConnector("REGISTER"));
  assert(out.stage === "registered" && chain.sent.length === 1 && out.note === null, JSON.stringify({ stage: out.stage, sent: chain.sent.length }));
});
await check("R9 the node answers 'already known' (an earlier send DID reach the network): the hash is KEPT (stage registering), and the receipt settles it with ZERO further sends", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const c = seen(await connector.createConnector());
  chain.balances.set(c.address, ETH("0.0005"));
  chain.rejectSend = "already known";
  await rejects(connector.registerConnector("REGISTER"), "rpc_error", "register");
  const st = seen(await connector.connectorStatus());
  assert(st.stage === "registering" && /^0x[0-9a-f]{64}$/.test(st.registerTx), JSON.stringify({ stage: st.stage, tx: st.registerTx }));
  chain.rejectSend = null;
  chain.receipts.set(st.registerTx, { status: "0x1" });
  chain.fids.set(c.address, 900999);
  const done = seen(await connector.connectorStatus());
  assert(done.stage === "registered" && done.fid === 900999 && chain.count("eth_sendRawTransaction") === 1, JSON.stringify({ stage: done.stage, fid: done.fid, sends: chain.count("eth_sendRawTransaction") }));
});

// ==================================================================================================== RESUME
console.log("\nRESUME — a registration the process lost track of");
await check("X1 a sealed hash whose receipt landed meanwhile (a crash between the send and the receipt): a STATUS read finishes it — the fid sealed, ZERO sends", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const rec = sealSynthetic({ registerTx: "0x" + "11".repeat(32), registerSentAt: Date.now() - 30_000 });
  chain.receipts.set(rec.registerTx, { status: "0x1" });
  chain.fids.set(rec.address, 900777);
  const st = seen(await connector.connectorStatus());
  assert(st.stage === "registered" && st.fid === 900777 && st.registerTx === rec.registerTx, JSON.stringify({ stage: st.stage, fid: st.fid }));
  assert(chain.count("eth_sendRawTransaction") === 0 && storedRecord().fid === 900777, "sent something, or not sealed");
});
await check("X2 a sealed hash still unmined: status says 'registering' at once (no wait, no send); register waits for the receipt and finishes WITHOUT a second send", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const rec = sealSynthetic({ registerTx: "0x" + "22".repeat(32), registerSentAt: Date.now() - 30_000 });
  chain.balances.set(rec.address, ETH("0.0005"));
  const st = seen(await connector.connectorStatus());
  assert(st.stage === "registering" && st.fid === null && /waiting to be mined/.test(st.next), JSON.stringify({ stage: st.stage, next: st.next }));
  // the receipt lands on the second poll (RECEIPT_POLL_MS between polls): the fake mines a hash it never saw sent
  chain.sent.push({ hash: rec.registerTx, from: rec.address, to: ID_GATEWAY, value: PRICE, fn: "register" });
  chain.pending.set(rec.registerTx, 1);
  const out = seen(await connector.registerConnector("REGISTER"));
  assert(out.stage === "registered" && out.fid === chain.fids.get(rec.address) && out.registerTx === rec.registerTx, JSON.stringify({ stage: out.stage, fid: out.fid }));
  assert(chain.count("eth_sendRawTransaction") === 0, "a second send");
  return "the receipt was polled; nothing was re-sent";
});
await check("X3 a sealed hash 16 minutes old with no receipt is treated as DROPPED: register sends ONCE more (fresh nonce), the note says so, then registers", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const old = "0x" + "33".repeat(32);
  const rec = sealSynthetic({ registerTx: old, registerSentAt: Date.now() - 16 * 60 * 1000 });
  chain.balances.set(rec.address, ETH("0.0005"));
  const out = seen(await connector.registerConnector("REGISTER"));
  assert(chain.sent.length === 1 && chain.sent[0].from === rec.address && chain.sent[0].hash !== old, "re-send " + JSON.stringify(chain.sent.map((t) => t.hash)));
  assert(out.stage === "registered" && out.fid === chain.fids.get(rec.address) && out.registerTx === chain.sent[0].hash, JSON.stringify({ stage: out.stage, tx: out.registerTx }));
  assert(storedRecord().fid === out.fid, "not sealed");
});
await check("X4 an fid already onchain for the custody address (the record lost it): register adopts it from IdRegistry.idOf, ZERO sends, nothing spent", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const rec = sealSynthetic();
  chain.fids.set(rec.address, 900888);
  const out = seen(await connector.registerConnector("REGISTER"));
  assert(out.stage === "registered" && out.fid === 900888 && chain.count("eth_sendRawTransaction") === 0 && storedRecord().fid === 900888, JSON.stringify({ stage: out.stage, fid: out.fid, sends: chain.count("eth_sendRawTransaction") }));
});

// ==================================================================================================== FNAME
console.log("\nFNAME — a neutral name, or none");
await check("F1 a name that says layers is refused (name_says_layers 409) in any case or position; nothing reaches the registry", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  await registered();
  for (const n of ["layers", "layers-bridge", "mylayers", "LaYeRs1", "@layers2"]) {
    const e = await rejects(connector.nameConnector(n), "name_says_layers", n);
    assert(e.status === 409, n + " status " + e.status);
  }
  assert(fnames.posts.length === 0, "a transfer was posted");
});
await check("F2 the fname grammar: empty, 17 characters, an underscore, a leading hyphen, a space → bad_name (400); case is folded, not refused", async () => {
  for (const n of ["", "a".repeat(17), "quiet_bridge", "-quiet", "quiet bridge", "quiet.bridge"]) {
    const e = await rejects(connector.nameConnector(n), "bad_name", JSON.stringify(n));
    assert(e.status === 400, n + " status " + e.status);
  }
});
await check("F3 before registration: not_registered (a name needs its fid); before creation: not_created", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  await rejects(connector.nameConnector("quiet-bridge"), "not_created", "no record");
  seen(await connector.createConnector());
  const e = await rejects(connector.nameConnector("quiet-bridge"), "not_registered", "unregistered");
  assert(e.status === 409 && fnames.posts.length === 0, "posted");
});
await check("F4 the shared test account's name (FC_TEST_FNAME) and its stem are refused; a persona's own fname is refused; a stem of main's name is refused", async () => {
  resetAll();
  setEnv({ ...OWNER_ENV, FC_TEST_FNAME: "quietbee" });
  await registered();
  await rejects(connector.nameConnector("quietbee"), "name_is_test_account", "the test name");
  await rejects(connector.nameConnector("quietbee2"), "name_is_test_account", "its stem");
  await personaWithFid({ fid: 123456, fname: "sparrow", custodyAddress: "0x" + "aa".repeat(20) });
  await rejects(connector.nameConnector("sparrow"), "name_is_persona", "a persona's name");
  await personaWithFid({ fid: 515151, fname: "jordan", custodyAddress: "0x" + "bb".repeat(20), origin: "connected" });
  const e = await rejects(connector.nameConnector("jordan2"), "name_stem", "main's stem");
  assert(/jordan/.test(e.message) && fnames.posts.length === 0, e.message);
});
await check("F5 a taken name (the registry's latest transfer has a non-zero `to`) is refused (name_taken); a registry that cannot answer is retryable and records nothing", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  await registered();
  fnames.transfers.set("taken", [{ to: 123 }]);
  await rejects(connector.nameConnector("taken"), "name_taken", "taken");
  fnames.transfers.set("released", [{ to: 123 }, { to: 0 }]);
  fnames.down = 1;
  const e = await rejects(connector.nameConnector("released"), "fname_registry_unavailable", "down");
  assert(e.retryable === true && e.status === 503 && fnames.posts.length === 0 && storedRecord().fname === null, "recorded on an outage");
});
await check("F6 a neutral name: ONE signed UserNameProof the registry verifies (owner = the custody address = custodyOf(fid), from 0, to fid), the stage named, the name sealed", async () => {
  const st = seen(await connector.connectorStatus());
  const out = seen(await connector.nameConnector("Quiet-Bridge"));
  assert(fnames.posts.length === 1, "posts " + fnames.posts.length);
  const p = fnames.posts[0];
  assert(p.name === "quiet-bridge" && p.from === 0 && p.to === st.fid && p.fid === st.fid && lc(p.owner) === st.address && /^0x[0-9a-f]{130}$/.test(p.signature) && Number.isInteger(p.timestamp), JSON.stringify({ ...p, signature: "…" }));
  assert(out.stage === "named" && out.fname === "quiet-bridge" && out.namedAt && storedRecord().fname === "quiet-bridge", JSON.stringify({ stage: out.stage, fname: out.fname }));
  assert((fnames.transfers.get("quiet-bridge") ?? []).length === 1, "the registry did not record the transfer");
});
await check("F7 the same name again is idempotent (no second transfer); another name is refused (already_named) — renaming is not built", async () => {
  const same = seen(await connector.nameConnector("quiet-bridge"));
  assert(same.fname === "quiet-bridge" && fnames.posts.length === 1, "posted again");
  const e = await rejects(connector.nameConnector("other-name"), "already_named", "rename");
  assert(e.status === 409 && fnames.posts.length === 1, "posted a rename");
});

// ==================================================================================================== ADDRESS
console.log("\nADDRESS — nothing shared with the other accounts");
await check("A1 a custody address that is a Totem address (FC_LAYERS_ADDRESSES): register refuses (connector_shares_wallet 409), nothing sent", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const rec = sealSynthetic();
  process.env.FC_LAYERS_ADDRESSES = APP_WALLET + "," + rec.address;
  chain.balances.set(rec.address, ETH("0.0005"));
  const e = await rejects(connector.registerConnector("REGISTER"), "connector_shares_wallet", "register");
  assert(e.status === 409 && /custody address is a Totem address/.test(e.message) && chain.count("eth_sendRawTransaction") === 0, e.message);
});
await check("A2 a custody address that is a persona's custody, and a recovery address that is main's custody: both refused, nothing sent", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const rec = sealSynthetic();
  chain.balances.set(rec.address, ETH("0.0005"));
  await personaWithFid({ fid: 123456, fname: "sparrow", custodyAddress: rec.address });
  const e1 = await rejects(connector.registerConnector("REGISTER"), "connector_shares_wallet", "persona");
  assert(/a persona's custody address/.test(e1.message), e1.message);
  resetAll();
  setEnv(OWNER_ENV);
  const rec2 = sealSynthetic();
  chain.balances.set(rec2.address, ETH("0.0005"));
  await personaWithFid({ fid: 515151, fname: "jordan", custodyAddress: rec2.recoveryAddress, origin: "connected" });
  const e2 = await rejects(connector.registerConnector("REGISTER"), "connector_shares_wallet", "main");
  assert(/recovery address is your main account's custody address/.test(e2.message) && chain.count("eth_sendRawTransaction") === 0, e2.message);
});

// ==================================================================================================== CONNECT.TS
console.log("\nCONNECT — lib/fc/connect.ts picks the sealed connector");
await check("S1 no record, env unset: connect reports no connector with the script to run; start refuses (connector_unconfigured)", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const cs = seen(await connect.connectStatus());
  assert(cs.available && cs.mode === "live" && cs.connector && !cs.connector.configured && cs.connector.source === null && cs.connector.setup === null && /arm-connector\.ps1/.test(cs.connector.reason) && /never handle a key/.test(cs.connector.reason), JSON.stringify(cs.connector));
  const e = await rejects(connect.startConnect({ handle: "jordan-main" }), "connector_unconfigured", "start");
  assert(/arm-connector\.ps1/.test(e.message) && chain.calls.length === 0, e.message);
});
await check("S2 created but not registered: still not configured — the setup's public state (stage, address) and the funding sentence in the reason; no chain read on the connect page", async () => {
  const c = seen(await connector.createConnector());
  chain.calls.length = 0;
  const cs = seen(await connect.connectStatus());
  assert(!cs.connector.configured && cs.connector.setup && cs.connector.setup.stage === "created" && cs.connector.setup.address === c.address && cs.connector.setup.fid === null, JSON.stringify(cs.connector));
  assert(cs.connector.reason.includes(FUNDING(c.address)) && /not registered yet/.test(cs.connector.reason), cs.connector.reason);
  assert(chain.calls.length === 0, "the connect page read the chain: " + chain.calls.join(","));
  await rejects(connect.startConnect({ handle: "jordan-main" }), "connector_unconfigured", "start");
});
await check("S3 registered: configured, source sealed, appFid = the fid, setup.stage registered, setup.fid; the handle carries fid, address and ONE signing operation", async () => {
  const c = seen(await connector.connectorStatus());
  chain.balances.set(c.address, ETH("0.0005"));
  const r = seen(await connector.registerConnector("REGISTER"));
  const cs = seen(await connect.connectStatus());
  assert(cs.connector.configured && cs.connector.source === "sealed" && cs.connector.fixture === false && cs.connector.appFid === r.fid && cs.connector.setup.stage === "registered" && cs.connector.setup.fid === r.fid && cs.connector.reason === null, JSON.stringify(cs.connector));
  const h = await connector.sealedConnectorForConnect();
  assert(h.ok && h.fid === r.fid && h.address === c.address && typeof h.signKeyRequest === "function" && !("custodyKey" in h) && !("key" in h), "handle " + JSON.stringify(Object.keys(h)));
});
await check("S4 a QR connect START with the sealed connector: the key request's signature recovers to custodyOf(C) at the fake Neynar, the session names appFid = C — and the key never left the module", async () => {
  const st = seen(await connector.connectorStatus());
  net.addUser({ fid: 515151, username: "jordan-main", display_name: "Jordan", custody_address: "0x" + "ab".repeat(20), verified: ["0x" + "cd".repeat(20)] });
  net.addUser({ fid: st.fid, username: "quiet-bridge", display_name: "quiet bridge", custody_address: st.address });
  const cs = seen(await connect.startConnect({ handle: "@jordan-main" }));
  assert(cs.session && cs.session.stage === "pending_approval" && cs.session.appFid === st.fid && cs.session.appUsername === "quiet-bridge" && cs.session.expectedFid === 515151 && cs.session.approval && /client\.farcaster\.xyz/.test(cs.session.approval.url), JSON.stringify(cs.session && { stage: cs.session.stage, appFid: cs.session.appFid }));
  const signer = [...net.signers.values()].find((s) => s.status === "pending_approval");
  assert(signer && signer.verifiedAgainst === st.address && signer.app_fid === st.fid, "the fake Neynar did not verify a request signed by the sealed custody");
  assert(net.unexpected.length === 0, "unexpected calls: " + net.unexpected.join(" | "));
  return `requestFid ${st.fid}, requestSigner ${st.address.slice(0, 10)}…`;
});
await check("S5 the connector's profile says layers on Neynar: start refuses (connector_named_layers) — the sealed path keeps every connect-time check", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const r = await registered();
  net.addUser({ fid: 515151, username: "jordan-main", display_name: "Jordan", custody_address: "0x" + "ab".repeat(20) });
  net.addUser({ fid: r.fid, username: "bridge", display_name: "Layers bridge", custody_address: r.address });
  await rejects(connect.startConnect({ handle: "jordan-main" }), "connector_named_layers", "start");
  assert(net.signers.size === 0, "a signer was created before the refusal");
});
await check("S6 the vault unreadable: connect reports 'could not be read' (configured false, setup null) and start refuses — it never reads as 'no connector'", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  await registered();
  connector.resetConnectorCache();
  persistStub.persistKnobs.failReads = 3;
  const cs = seen(await connect.connectStatus());
  assert(!cs.connector.configured && /could not be read/.test(cs.connector.reason) && cs.connector.setup === null && !/arm-connector/.test(cs.connector.reason), JSON.stringify(cs.connector));
  persistStub.persistKnobs.failReads = 3;
  const e = await rejects(connect.startConnect({ handle: "jordan-main" }), "connector_unconfigured", "start");
  assert(/could not be read/.test(e.message), e.message);
});
await check("S7 the env names set beside a sealed, registered record: the ENVIRONMENT connector signs (source env, its fid), the sealed one is reported as not used", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  await registered();
  const key = generatePrivateKey();
  syntheticKeys.push(key);
  process.env.FC_CONNECT_APP_FID = "424242";
  process.env.FC_CONNECT_APP_CUSTODY_KEY = key;
  const cs = seen(await connect.connectStatus());
  assert(cs.connector.configured && cs.connector.source === "env" && cs.connector.appFid === 424242, JSON.stringify(cs.connector));
  const st = seen(await connector.connectorStatus());
  assert(st.envSet && st.source === "env" && /not used/.test(st.next), st.next);
});
await check("S8 the sealed connector's custody moved onchain (custodyOf(C) differs): start refuses connector_key_mismatch naming the sealed account, nothing started", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const r = await registered();
  net.addUser({ fid: 515151, username: "jordan-main", display_name: "Jordan", custody_address: "0x" + "ab".repeat(20) });
  chain.fids.delete(r.address);
  chain.fids.set("0x" + "ee".repeat(20), r.fid);
  const e = await rejects(connect.startConnect({ handle: "jordan-main" }), "connector_key_mismatch", "start");
  assert(/this service holds for the connector/.test(e.message) && !/FC_CONNECT_APP_CUSTODY_KEY/.test(e.message) && net.signers.size === 0, e.message);
});

// ==================================================================================================== ROUTE
console.log("\nROUTE — /api/fc/connector");
await check("RT1 without a live owner session: 401 owner_login_required for GET and POST, nothing sealed", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const g = await call("GET", undefined, { cookie: false });
  const p = await call("POST", { action: "create" }, { cookie: false });
  assert(g.status === 401 && g.data.code === "owner_login_required" && p.status === 401 && p.data.code === "owner_login_required", `${g.status}/${p.status}`);
  const bad = await call("GET", undefined, { cookie: false, raw: undefined });
  assert(bad.status === 401 && persistStub.persistKnobs.flushes === 0, "sealed without a session");
});
await check("RT2 with the owner session: GET 200 (stage none, no-store); POST create 200 with the address and the funding sentence; the JSON carries no key field", async () => {
  const g = await call("GET");
  assert(g.status === 200 && g.data.stage === "none" && g.data.available === true && g.cacheControl === "no-store", JSON.stringify({ status: g.status, cc: g.cacheControl }));
  const p = await call("POST", { action: "create" });
  assert(p.status === 200 && p.data.stage === "unfunded" && /^0x[0-9a-f]{40}$/.test(p.data.address) && p.data.funding.instruction === FUNDING(p.data.address), p.text.slice(0, 200));
  assert(!/custodyKey|recoveryKey|privateKey/.test(p.text), "a key field in the response");
  const rec = storedRecord();
  assert(!p.text.includes(rec.custodyKey) && !p.text.includes(rec.custodyKey.slice(2)) && !p.text.includes(rec.recoveryKey.slice(2)), "a key value in the response");
});
await check("RT3 malformed JSON → 400; an unknown action → 400; a body over 4 KB → 413; nothing sealed by any of them", async () => {
  const flushes = persistStub.persistKnobs.flushes;
  const a = await call("POST", undefined, { raw: "{not json" });
  const b = await call("POST", { action: "explode" });
  const c = await call("POST", undefined, { raw: JSON.stringify({ action: "create", pad: "x".repeat(5000) }) });
  assert(a.status === 400 && a.data.code === "bad_request" && b.status === 400 && b.data.code === "bad_request" && c.status === 413, `${a.status}/${b.status}/${c.status}`);
  assert(persistStub.persistKnobs.flushes === flushes, "sealed");
});
await check("RT4 the library's refusals come back as JSON with code + retryable: register without the word → 400 confirm_required; unfunded → 409 unfunded; a name before registration → 409 not_registered", async () => {
  const a = await call("POST", { action: "register" });
  const b = await call("POST", { action: "register", confirm: "REGISTER" });
  const c = await call("POST", { action: "fname", name: "quiet-bridge" });
  assert(a.status === 400 && a.data.code === "confirm_required" && a.data.retryable === false, a.text);
  assert(b.status === 409 && b.data.code === "unfunded" && /Nothing was sent/.test(b.data.error), b.text);
  assert(c.status === 409 && c.data.code === "not_registered", c.text);
  assert(chain.count("eth_sendRawTransaction") === 0 && fnames.posts.length === 0, "something was sent");
});
await check("RT5 funded, through the route: register → 200 registered with the fid; fname 'layers-x' → 409 name_says_layers; fname → 200 named; a second register sends nothing", async () => {
  const st = (await call("GET")).data;
  chain.balances.set(st.address, ETH("0.0005"));
  const r = await call("POST", { action: "register", confirm: "REGISTER" });
  assert(r.status === 200 && r.data.stage === "registered" && r.data.fid === chain.fids.get(st.address), r.text.slice(0, 200));
  const bad = await call("POST", { action: "fname", name: "layers-x" });
  assert(bad.status === 409 && bad.data.code === "name_says_layers" && fnames.posts.length === 0, bad.text);
  const n = await call("POST", { action: "fname", name: "quiet-bridge" });
  assert(n.status === 200 && n.data.stage === "named" && n.data.fname === "quiet-bridge", n.text.slice(0, 200));
  const again = await call("POST", { action: "register", confirm: "REGISTER" });
  assert(again.status === 200 && chain.sent.length === 1, "sent " + chain.sent.length);
  return `fid ${r.data.fid} @quiet-bridge`;
});
await check("RT6 without an owner secret (the rig shape) the route checks no cookie and the library refuses: GET 200 available:false, POST create 403 not_owner_service", async () => {
  resetAll();
  setEnv(RIG_ENV);
  const g = await call("GET", undefined, { cookie: false });
  const p = await call("POST", { action: "create" }, { cookie: false });
  assert(g.status === 200 && g.data.available === false && g.data.code === "not_owner_service" && p.status === 403 && p.data.code === "not_owner_service", `${g.status}/${p.status} ${p.text.slice(0, 120)}`);
});
await check("RT7 a cookie minted under ANOTHER passphrase is no session: 401", async () => {
  resetAll();
  setEnv(OWNER_ENV);
  const foreign = await ownerAccess.mintOwnerCookie("another-secret-not-this-service-xyz", { epoch: EPOCH, via: "p" });
  const req = new nextStub.NextRequest("http://owner.local/api/fc/connector", { headers: { cookie: `${COOKIE}=${foreign}` } });
  const res = await route.GET(req);
  outputs.push(await res.text());
  assert(res.status === 401, "status " + res.status);
});

// ==================================================================================================== LEAK
console.log("\nLEAK — the keys stayed where they were sealed");
await check("L1 no private key (every one generated by the module, every synthetic one) appears in any response, status view, error message, console line or argv", async () => {
  const keys = [...generatedKeys(), ...syntheticKeys];
  assert(keys.length >= 10, "too few keys known to the scan: " + keys.length);
  const hay = [...outputs, ...consoleLines, ...process.argv];
  const hits = [];
  for (const k of keys) {
    const bare = k.slice(2);
    for (let i = 0; i < hay.length; i++) if (hay[i] && (hay[i].includes(bare) || hay[i].toLowerCase().includes(bare.toLowerCase()))) hits.push(i);
  }
  assert(hits.length === 0, "a key appeared in " + hits.length + " output(s)");
  return `${keys.length} keys, ${hay.length} outputs scanned`;
});
await check("L2 every write to the validator for fcConnector was ciphertext-shaped and carried no key in the clear; every status view and route body lacks the key field names", async () => {
  const keys = [...generatedKeys(), ...syntheticKeys].map((k) => k.slice(2).toLowerCase());
  const writes = persistStub.persistKnobs.flushed.filter((f) => f.ns === NS);
  assert(writes.length >= 5, "too few sealed writes recorded: " + writes.length);
  for (const w of writes) {
    const r = w.entries._;
    assert(r && r.v === 1 && typeof r.ct === "string" && typeof r.nonce === "string" && r.ns === NS, "a write that is not ciphertext-shaped");
    const s = JSON.stringify(w.entries).toLowerCase();
    for (const k of keys) assert(!s.includes(k), "a key in the clear in a sealed write");
  }
  for (const o of outputs) assert(!/"(custodyKey|recoveryKey)"/.test(o), "a key FIELD in an output: " + o.slice(0, 120));
  return `${writes.length} sealed writes checked`;
});

setEnv({});
console.log(`\n${passed}/${passed + failed} connector unit checks passed${failed ? " — FAILED: " + failures.join("; ") : ""}`);
process.exit(failed ? 1 : 0);
