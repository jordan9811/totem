// PERSONA LAUNCH P2 (BYX) — node-only unit harness for "Bring your X v1": U1–U7, U9, U10 and the G0/G1 guards.
//
// Bundles the REAL modules with esbuild — lib/x/{archiveParse,archiveZip,shelf,follows,importer,match,indexClient,
// identity,attestations,sync}.ts, lib/vault/{chunkedDoc,vault}.ts, lib/crypto/vaultCipher.ts, lib/adapters/mock/
// persist.ts, lib/crosspost/destinations.ts, app/api/x/{link,import}/route.ts — and replaces what is stateful around
// them (the store, the keystore's vault key, the graph adapter, the persona↔fid vault, the active persona) with
// in-memory mocks. fetch is an in-memory VALIDATOR (GET/PUT /state/:ns with the real 256 KiB limit, and the X index
// routes): any other URL fails the run. The index builder (U6) is the REAL validator/xindex.js against the in-process
// stub (scripts/lib/x-index-stub.mjs). Nothing leaves this machine.
//
//   node scripts/unit-x-v1.mjs              every check, then the MUTATION pass: each guard broken on purpose in a temp
//                                           copy (the repo is never touched) must turn its named checks red
//   ONLY=U4,U5 node scripts/unit-x-v1.mjs   just those checks (no mutation pass)
//   MUT=none node scripts/unit-x-v1.mjs     the checks without the mutation pass
// Exit 0 = every check passed AND every mutation was caught.
//
// PERSONA LAUNCH P2 wave-1 review fixes, each with the mutation that must turn it red:
//   R1/R2  no lost update: two toggles together, an import beside a toggle (W1-R1; mutations unlockedupdate, commitcopy)
//   R3a-c  a stale cache never silently replaces another tab's save, and never tears the live slot (W1-R3; noreconcile)
//   R3d    a vanished index after a seen save is a rollback, never an empty document (W1-R3; vanishedasempty)
//   R4     two saves of one namespace land in call order through a 503 retry (W1-R4; nochain)
//   U5d    a stale-counter 409 is re-signed and retried, for a write and a chunked read (W1-R4; nostaleretry,
//          nostalereadretry)
//   Q1     the reserved follow queue survives load, commit, rematch and the seeding door (W1-R6; queuedropped)
//   G0f/g  the owner service and the empty world are not the rig: no fixture link, archive, raw ingest, tamper hook, X
//          destination or MigrationPanel — and the rig has all six (W1-R5; ownerfixtures, emptyfixtures, pageeverywhere)
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PLANT, TWEET_CANARY, makeArchiveFiles, makeZip, synthTweets, synthFollowing, synthIndexRows } from "./lib/x-archive-synth.mjs";
import { createIndexStub } from "./lib/x-index-stub.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = mkdtempSync(path.join(os.tmpdir(), "layers-x-unit-"));
process.on("exit", () => rmSync(HERE, { recursive: true, force: true }));
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
const ROOT_N = ROOT.split(path.sep).join("/");
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const quiet = { log() {}, warn() {}, error() {} };

// ------------------------------------------------------------------------------------------------ the world (reset per check)
const VURL = "http://validator.unit";
function freshWorld() {
  const key = new Uint8Array(32).fill(7);
  return {
    vaultKey: key,
    goodKey: key,
    /** the in-memory validator: namespace → entries */
    vstate: new Map(),
    puts: [], // {ns, bytes}
    gets: [],
    /** fetch knobs: return "network" | a status | {status, body} | undefined for a request (url, method) */
    fail: null,
    /** what GET /x/fc-index serves: {text, etag} | {status} */
    index: { status: 503 },
    indexMeta: { available: false },
    state: {
      xImportSessions: new Map(),
      xImportedPosts: new Map(),
      xImportedPrivate: new Map(),
      xMigrationSource: new Map(),
      xSensitiveQueue: new Map(),
      xAttestations: new Map(),
      xUnlinkedHandles: new Set(),
      destinationBindings: new Map(),
      xSyncCursor: new Map(),
      seq: 0,
    },
    persisted: [],
    claims: [],
    private: new Set(["p_priv"]),
    acting: "p_main",
    personas: ["p_main", "p_alt", "p_priv"],
    fidRecords: [],
    ownExtra: new Set(),
  };
}
globalThis.__XU = freshWorld();
const W = () => globalThis.__XU;

const json = (status, obj, headers = {}) => {
  const text = obj === undefined ? "" : typeof obj === "string" ? obj : JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
};
globalThis.fetch = async (u, init = {}) => {
  const url = String(u);
  const method = (init.method || "GET").toUpperCase();
  if (!url.startsWith(VURL + "/")) throw new Error("unit: a request left the harness: " + url);
  const w = W();
  const p = url.slice(VURL.length);
  if (w.fail) {
    const f = w.fail(p, method);
    if (f === "network") throw new TypeError("fetch failed (simulated)");
    if (typeof f === "number") return json(f, { error: "simulated " + f });
    if (f && typeof f === "object") return json(f.status, f.body);
  }
  if (p.startsWith("/state/")) {
    const ns = decodeURIComponent(p.slice(7));
    if (method === "GET") {
      w.gets.push(ns);
      return json(200, { entries: w.vstate.get(ns) ?? {} });
    }
    if (method === "PUT") {
      const body = String(init.body ?? "");
      const bytes = new TextEncoder().encode(body).length;
      w.puts.push({ ns, bytes });
      if (bytes > 262144) return json(413, { error: "body too large", limit: 262144, namespace: ns });
      const entries = JSON.parse(body).entries;
      if (Object.keys(entries).length === 0) w.vstate.delete(ns);
      else w.vstate.set(ns, entries);
      return json(200, { ok: true });
    }
  }
  if (p === "/x/fc-index") {
    if (w.index.status !== 200) return json(w.index.status, { error: "index not built" });
    const inm = init.headers?.["If-None-Match"] ?? init.headers?.["if-none-match"];
    if (inm && inm === w.index.etag) return json(304, undefined, { etag: w.index.etag });
    return json(200, w.index.text, { etag: w.index.etag });
  }
  if (p === "/x/fc-index/meta") return json(200, w.indexMeta);
  return json(404, { error: "not in the unit validator" });
};

// ------------------------------------------------------------------------------------------------ mocks
const MOCKDIR = path.join(HERE, "mocks");
mkdirSync(MOCKDIR, { recursive: true });
const MOCKS = {
  "server-only": `export {};`,
  "next/server": `
export class NextResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; }
  static json(obj, init = {}) { const r = new NextResponse(JSON.stringify(obj), init); r.jsonBody = obj; return r; }
  async json() { return this.jsonBody; }
}
export class NextRequest {
  constructor(url, init = {}) { this.url = url; this.nextUrl = new URL(url); this._body = init.body; this.headers = new Headers(init.headers ?? {}); }
  async json() { if (this._body === undefined) throw new Error("no body"); return JSON.parse(this._body); }
}`,
  "lib/identity/keystore": `
const W = () => globalThis.__XU;
export function vaultKeyBytes() { return W().vaultKey; }
export function listPersonas() { return W().personas.map((id) => ({ id, nonce: "n-" + id, kind: W().private.has(id) ? "private" : "public", name: id, handle: id })); }
export function ownPersonaIds() { return W().personas.slice(); }
export function getPersona(id) { return W().personas.includes(id) ? { id, handle: id, name: id, kind: W().private.has(id) ? "private" : "public" } : null; }`,
  "lib/adapters/mock/store": `
const W = () => globalThis.__XU;
export function state() { return W().state; }
export async function persistNs(ns) { W().persisted.push(ns); }
export async function hydrate() {}
export const SEED_PERSONAS = [];
export const SEED_VIEWER = { get personas() { return W().personas; }, get activePersonaId() { return W().acting; } };
export const personaById = new Map();
export const personaByHandle = new Map();`,
  "lib/adapters/registry": `
const W = () => globalThis.__XU;
export const adapters = { graph: {
  async listClaims(p) { return W().claims.filter((c) => c.personaId === p); },
  async addClaim(personaId, category, label, value, source) { W().claims.push({ personaId, category, label, value, source }); },
  async getConsent() { return false; },
} };`,
  "lib/adapters/retry": `export async function retryAdapter(fn) { return fn(); }`,
  "lib/identity/personaKind": `
const W = () => globalThis.__XU;
export function isPrivatePersona(id) { return W().private.has(id); }
export function kindOf(id) { return W().private.has(id) ? "private" : "public"; }
export function mayPublishPublicly(id) { return !W().private.has(id); }`,
  "lib/x/migration": `export async function onNewAttestation() { return 0; }`,
  "lib/x/porting": `export async function resolvePendingPorts() {}`,
  "lib/fc/personaFid": `
const W = () => globalThis.__XU;
export async function allPersonaFids() { if (W().vaultThrows) throw new Error("vault: unreadable"); return W().fidRecords.slice(); }
export async function personaFidRecord(id) { if (W().vaultThrows) throw new Error("vault: unreadable"); return W().fidRecords.find((r) => r.personaId === id) ?? null; }
export async function ownAccountFidsWithAnon(records) { const s = new Set(records.filter((r) => r.origin !== "connected").map((r) => r.fid)); for (const f of W().ownExtra) s.add(f); return s; }
export async function connectedRecords() { return W().fidRecords.filter((r) => r.origin === "connected"); }`,
  "lib/fc/writes": `export function configuredMainFid() { return null; }`,
  "lib/adapters/mockUtils": `export async function withMockLatency(fn) { return fn(); }`,
  "lib/x/spend": `export async function guardedRead() { return { cost: 0 }; } export class SpendCapError extends Error {}`,
  "lib/activePersona": `export function activeSeedPersonaId() { return globalThis.__XU.acting; }`,
  "lib/views/social.server": `export async function shelfPage() { return { rows: [], nextOffset: null, shown: 0, counts: { total: 0, retweets: 0, replies: 0 } }; }`,
  // the import-x page (G0f/G0g render its server component): its panels are marked stand-ins
  "components/settings/Chrome": `export function SettingsHeader() { return null; } SettingsHeader.unitMark = "SettingsHeader";`,
  "components/settings/XImportWizard": `export function XImportWizard() { return null; } XImportWizard.unitMark = "XImportWizard";`,
  "components/settings/XPeoplePanel": `export function XPeoplePanel() { return null; } XPeoplePanel.unitMark = "XPeoplePanel";`,
  "components/settings/MigrationPanel": `export function MigrationPanel() { return null; } MigrationPanel.unitMark = "MigrationPanel";`,
  "components/settings/ColdStorePanel": `export function ColdStorePanel() { return null; } ColdStorePanel.unitMark = "ColdStorePanel";`,
};
const mockFile = {};
for (const [name, src] of Object.entries(MOCKS)) {
  const f = path.join(MOCKDIR, name.replace(/[\\/]/g, "__") + ".mjs");
  writeFileSync(f, src);
  mockFile[name] = f;
}

const ENTRY = path.join(HERE, "entry.ts");
writeFileSync(
  ENTRY,
  `export * as parse from "@/lib/x/archiveParse";
export * as zip from "@/lib/x/archiveZip";
export * as chunk from "@/lib/vault/chunkedDoc";
export * as persist from "@/lib/adapters/mock/persist";
export * as vault from "@/lib/vault/vault";
export * as shelf from "@/lib/x/shelf";
export * as follows from "@/lib/x/follows";
export * as importer from "@/lib/x/importer";
export * as match from "@/lib/x/match";
export * as idx from "@/lib/x/indexClient";
export * as identity from "@/lib/x/identity";
export * as att from "@/lib/x/attestations";
export * as sync from "@/lib/x/sync";
export * as dest from "@/lib/crosspost/destinations";
export * as linkRoute from "@/app/api/x/link/route";
export * as importRoute from "@/app/api/x/import/route";
export * as envc from "@/lib/platform/env-contract";
export * as importXPage from "@/app/(main)/settings/import-x/page";
export { NextRequest } from "next/server";
`
);

// ------------------------------------------------------------------------------------------------ mutations
/** each guard, broken on purpose: the named checks MUST go red */
const MUTATIONS = [
  { name: "presize", file: "lib/adapters/mock/persist.ts", edits: [["if (bytes > STATE_BODY_LIMIT_BYTES) throw new PersistError(ns, 413, bytes);", ""]], expect: ["U5a"] },
  { name: "noretry", file: "lib/adapters/mock/persist.ts", edits: [["export const FLUSH_RETRY_MS = [250, 500, 1000];", "export const FLUSH_RETRY_MS: number[] = [];"]], expect: ["U5b"] },
  { name: "silentflush", file: "lib/adapters/mock/persist.ts", edits: [["    await putState(ns, sealed);\n  });", "    await putState(ns, sealed).catch(() => undefined);\n  });"]], expect: ["U5c"] },
  { name: "nogencheck", file: "lib/vault/chunkedDoc.ts", edits: [["if (inner.gen !== m.gen || inner.i !== i || inner.n !== m.n || typeof inner._ !== \"string\")", "if (typeof inner._ !== \"string\")"], ["if (utf8Bytes(json) !== m.bytes || sha256Hex(json) !== m.sha256)", "if (false)"]], expect: ["U4e"] },
  { name: "missingasempty", file: "lib/vault/chunkedDoc.ts", edits: [["if (!entries) throw new ChunkReadError(name, `${label} missing`);", "if (!entries) return \"\";"]], expect: ["U4c"] },
  { name: "samesslot", file: "lib/vault/chunkedDoc.ts", edits: [["const gen = cur.gen + 1;", "const gen = Math.max(1, cur.gen);"]], expect: ["U4b"] },
  { name: "accountspread", file: "lib/x/archiveParse.ts", edits: [["  return {\n    username,\n    accountId,", "  return {\n    ...a,\n    username,\n    accountId,"]], expect: ["U2"] },
  { name: "numberids", file: "lib/x/archiveParse.ts", edits: [["    tweets.push({\n      id,", "    tweets.push({\n      id: String(Number(id)),"]], expect: ["U1"] },
  { name: "bigslice", file: "lib/x/archiveZip.ts", edits: [["export const READ_SLICE_BYTES = 8 * 1024 * 1024;", "export const READ_SLICE_BYTES = 64 * 1024 * 1024;"]], expect: ["U3b"] },
  { name: "nocrc", file: "lib/x/archiveZip.ts", edits: [["if (crc32(outChunks) !== e.crc)", "if (false)"]], expect: ["U3c"] },
  { name: "noack", file: "lib/x/importer.ts", edits: [["if (opts.acknowledgedFingerprintWarning !== true)", "if (false)"]], expect: ["U10b"] },
  { name: "nocap", file: "lib/x/importer.ts", edits: [["if (claimed > cap && !st.newestOnly[lane]) throw", "if (false) throw"], ["if (total > cap && !st.newestOnly[lane]) throw", "if (false) throw"]], expect: ["U10a"] },
  { name: "fixtureverifies", file: "lib/x/importer.ts", edits: [["  if (a.method === \"fixture\") return { verified: false, verifiedBy: null, testLink: true };\n", ""]], expect: ["G0d"] },
  { name: "noown", file: "lib/x/match.ts", edits: [["const isOwn = own.has(fid);", "const isOwn = false;"]], expect: ["U7a"] },
  { name: "partialindex", file: "lib/x/indexClient.ts", edits: [["if (parts.length !== n) throw", "if (false) throw"]], expect: ["U7b"] },
  { name: "xeverywhere", file: "lib/crosspost/destinations.ts", edits: [["  return xRigFixturesAvailable();\n}", "  return true;\n}"]], expect: ["G0b"] },
  { name: "synclive", file: "lib/x/sync.ts", edits: [["  if (process.env.X_API_CLIENT_ID)\n    throw", "  if (false)\n    throw"]], expect: ["G0c"] },
  { name: "nostale", file: "lib/x/identity.ts", edits: [["return markAttestationStale(a.handle, !present);", "return a;"]], expect: ["U9b"] },
  { name: "linkeverywhere", file: "app/api/x/link/route.ts", edits: [["  return xRigFixturesAvailable();", "  return true;"]], expect: ["G0a"] },
  { name: "fixtureeverywhere", file: "app/api/x/import/route.ts", edits: [["  return xRigFixturesAvailable();", "  return true;"]], expect: ["G0e"] },
  // ---- PERSONA LAUNCH P2 wave-1 review fixes
  // W1-R1: a mutation applied to a copy read OUTSIDE the lock (the old read-modify-write) loses one of two toggles
  { name: "unlockedupdate", file: "lib/vault/chunkedDoc.ts", edits: [["  return locked(name, () => writeLocked<T>(name, mutate, \"update\"));", "  return readDoc<T>(name).then((r) => { const next = mutate(r.doc === null ? null : structuredClone(r.doc)); return locked(name, () => writeLocked<T>(name, () => next, \"update\")); });"]], expect: ["R1"] },
  // W1-R1: commitSession's archive record written from a copy taken BEFORE the shelf save (the pre-fix commit)
  { name: "commitcopy", file: "lib/x/importer.ts", edits: [["  await loadShelf();\n  if (want.has(\"following\") && follows.length > 0) await loadFollows();", "  const __snap = (await loadShelf()).meta;\n  if (want.has(\"following\") && follows.length > 0) await loadFollows();"], ["  await updateArchiveMeta((stored) => {\n    const cur = stored.byPersona[personaId];", "  await updateArchiveMeta((stored0) => {\n    const stored = __snap;\n    const cur = stored.byPersona[personaId];"]], expect: ["R2"] },
  // W1-R3: no live-manifest check before a save
  { name: "noreconcile", file: "lib/vault/chunkedDoc.ts", edits: [["  if (!fresh) cur = await reconcileWithLive(name, cur, mode);", ""]], expect: ["R3a", "R3b", "R3c"] },
  { name: "vanishedasempty", file: "lib/vault/chunkedDoc.ts", edits: [["  if (!m && seen > 0) throw new ChunkReadError(name, `the index of its pieces is gone after save ${seen}`);\n", ""]], expect: ["R3d"] },
  // W1-R4: no per-namespace order
  { name: "nochain", file: "lib/adapters/mock/persist.ts", edits: [["  const run = prior.catch(() => undefined).then(task);\n  chains.set(ns, run);", "  const run = task();\n  chains.set(ns, run);"]], expect: ["R4"] },
  { name: "nostaleretry", file: "lib/adapters/mock/persist.ts", edits: [["    if (stale) {\n      last = new PersistError(ns, res.status, bytes, `couldn't save ${ns}: the validator refused it (HTTP 409: ${named})`);\n      continue;\n    }\n", ""]], expect: ["U5d"] },
  { name: "nostalereadretry", file: "lib/vault/chunkedDoc.ts", edits: [["    if (res.status === 409 && (await staleCounter(res))) continue;\n", ""]], expect: ["U5d"] },
  // W1-R6: the queue emptied on load and on save (the pre-fix follows.ts)
  { name: "queuedropped", file: "lib/x/follows.ts", edits: [["  return { ...r.doc, queue: storedQueue(r.doc) };", "  return { ...r.doc, queue: [] };"], ["    return next === UNCHANGED ? UNCHANGED : { ...next, queue: base.queue };", "    return next === UNCHANGED ? UNCHANGED : { ...next, queue: [] };"]], expect: ["Q1"] },
  // W1-R5: the one predicate without its owner-service / empty-world halves, and the page that ignores it
  { name: "ownerfixtures", file: "lib/x/attestations.ts", edits: [["typeof window === \"undefined\" && !isOwnerService() && !isEmptyWorld();", "typeof window === \"undefined\" && !isEmptyWorld();"]], expect: ["G0f"] },
  { name: "emptyfixtures", file: "lib/x/attestations.ts", edits: [["typeof window === \"undefined\" && !isOwnerService() && !isEmptyWorld();", "typeof window === \"undefined\" && !isOwnerService();"]], expect: ["G0g"] },
  { name: "pageeverywhere", file: "app/(main)/settings/import-x/page.tsx", edits: [["  const rig = xRigFixturesAvailable();", "  const rig = process.env.ZK_DEV_HOOKS === \"true\";"]], expect: ["G0f", "G0g"] },
];

async function bundle(mut) {
  const mutatedFile = {};
  if (mut) {
    let src = readFileSync(path.join(ROOT, mut.file), "utf8").replace(/\r\n/g, "\n");
    for (const [from, to] of mut.edits) {
      if (!src.includes(from)) throw new Error(`MUT ${mut.name}: anchor not found in ${mut.file}: ${from.slice(0, 80)}`);
      src = src.split(from).join(to);
    }
    const dir = path.posix.dirname(mut.file);
    src = src.replace(/from "(\.\.?\/[^"]+)"/g, (_, rel) => `from "@/${path.posix.normalize(path.posix.join(dir, rel))}"`);
    src = src.replace(/import\("(\.\.?\/[^"]+)"\)/g, (_, rel) => `import("@/${path.posix.normalize(path.posix.join(dir, rel))}")`);
    const f = path.join(MOCKDIR, "MUT__" + mut.name + path.extname(mut.file));
    writeFileSync(f, src);
    mutatedFile[mut.file.replace(/\.(ts|tsx)$/, "")] = f;
  }
  const plugin = {
    name: "x-unit-mocks",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (mockFile[args.path]) return { path: mockFile[args.path] };
        let abs = null;
        if (args.path.startsWith("@/")) abs = path.join(ROOT_N, args.path.slice(2));
        else if (args.path.startsWith(".") && args.importer && !args.importer.startsWith(MOCKDIR)) abs = path.resolve(path.dirname(args.importer), args.path);
        if (!abs) return undefined;
        const rel = path.relative(ROOT_N, abs).split(path.sep).join("/").replace(/\.(ts|tsx|mjs|js)$/, "");
        if (mockFile[rel]) return { path: mockFile[rel] };
        if (mutatedFile[rel]) return { path: mutatedFile[rel] };
        return undefined;
      });
    },
  };
  const out = path.join(HERE, `bundle-${mut ? mut.name : "main"}.mjs`);
  await build({
    absWorkingDir: ROOT_N,
    entryPoints: [ENTRY],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT_N, "tsconfig.json"),
    plugins: [plugin],
    jsx: "automatic",
    // a MUTATED copy lives in the temp dir: its JSX runtime import must still resolve from the repo
    nodePaths: [path.join(ROOT_N, "node_modules")],
    loader: { ".json": "json" },
    logLevel: "error",
  });
  return import(pathToFileURL(out).href + "?" + Date.now());
}

// ------------------------------------------------------------------------------------------------ helpers
const files = makeArchiveFiles({ seed: 7 });
const tweetsOrig = synthTweets(7);
const followOrig = synthFollowing(7);
function blobOf(buf, name) {
  return new File([buf], name, { type: name.endsWith(".zip") ? "application/zip" : "text/javascript" });
}
async function expectReject(p, re, label) {
  try {
    await p;
  } catch (e) {
    if (re && !re.test(String(e && e.message))) throw new Error(`${label}: rejected with the wrong reason: ${e && e.message}`);
    return e;
  }
  throw new Error(`${label}: did not reject`);
}
const reqOf = (M, url, body) => new M.NextRequest("http://localhost" + url, body === undefined ? {} : { body: JSON.stringify(body) });
async function call(M, route, method, url, body) {
  const res = await route[method](reqOf(M, url, body));
  return { status: res.status, json: await res.json() };
}
/** the stub index → served by the in-memory validator, as the device would download it */
let builtIndex = null;
async function buildStubIndex(rows) {
  const { openDb } = require(path.join(ROOT, "validator", "db.js"));
  const { buildIndex } = require(path.join(ROOT, "validator", "xindex.js"));
  const db = openDb(":memory:");
  const dir = mkdtempSync(path.join(HERE, "idx-"));
  const stub = createIndexStub({ rows, throttleOnce: false });
  const st = { dir, buf: null, meta: null };
  const meta = await buildIndex(db, st, { sourceUrl: "http://stub.test", fnamesUrl: "http://stub.test", fetchImpl: stub.fetchFor("http://stub.test"), sleep: async () => {}, minIntervalMs: 0, log: quiet });
  return { meta, text: gunzipSync(st.buf).toString("utf8"), etag: '"' + meta.sha256 + '"' };
}
function serveIndex(ix) {
  W().index = { status: 200, text: ix.text, etag: ix.etag };
  W().indexMeta = { available: true, builtAt: ix.meta.builtAt, rows: ix.meta.rows, fnameCoverage: ix.meta.fnameCoverage };
}

// ------------------------------------------------------------------------------------------------ the checks
const CHECKS = [
  {
    id: "U1",
    name: "U1 parse: tweets.js 1,800 + tweets-part1.js 1,200 (BOM) → 3,000 unique, ids byte-equal STRINGS, 400 RT / 600 replies; legacy tweet.js/tweet-part1.js the same; overlapping parts dedupe",
    async fn(M) {
      const a = M.parse.parseTweetsDetailed(files["data/tweets.js"]);
      const b = M.parse.parseTweetsDetailed(files["data/tweets-part1.js"]);
      assert(a.tweets.length === 1800 && b.tweets.length === 1200, `parts ${a.tweets.length}+${b.tweets.length}`);
      assert(files["data/tweets-part1.js"].charCodeAt(0) === 0xfeff, "the BOM is planted");
      const merged = M.parse.mergeTweetParts([a.tweets, b.tweets]);
      assert(merged.length === 3000, "merged " + merged.length);
      const want = new Set(tweetsOrig.map((t) => t.tweet.id_str));
      assert(merged.every((t) => typeof t.id === "string" && want.has(t.id)), "an id is not a byte-equal string (Number() would round 19 digits)");
      assert(merged.filter((t) => t.isRetweet).length === 400, "retweets");
      assert(merged.filter((t) => t.replyToId && !t.isRetweet).length === 600, "replies");
      assert(merged[0].createdAt >= merged[merged.length - 1].createdAt, "newest first");
      const legacy = makeArchiveFiles({ seed: 7, legacy: true });
      const la = M.parse.parseTweets(legacy["data/tweet.js"]);
      const lb = M.parse.parseTweets(legacy["data/tweet-part1.js"]);
      assert(M.parse.mergeTweetParts([la, lb]).length === 3000, "legacy naming");
      const dup = M.parse.mergeTweetParts([a.tweets, a.tweets.slice(0, 10), b.tweets]);
      assert(dup.length === 3000, "overlap not deduped: " + dup.length);
      const d = M.parse.parseXDate("Sat Mar 12 18:01:00 +0000 2022");
      assert(d === Date.UTC(2022, 2, 12, 18, 1, 0), "created_at parsed by hand");
      return "3,000 posts, ids exact";
    },
  },
  {
    id: "U2",
    name: "U2 privacy boundary: parseAccount returns EXACTLY {username, accountId, displayName, createdAt}; the planted email and phone appear nowhere in it, nor in the whole parsed archive",
    async fn(M) {
      const acc = M.parse.parseAccount(files["data/account.js"]);
      assert(JSON.stringify(Object.keys(acc).sort()) === JSON.stringify(["accountId", "createdAt", "displayName", "username"]), "keys: " + Object.keys(acc));
      assert(files["data/account.js"].includes(PLANT.account.email) && files["data/account.js"].includes(PLANT.account.phoneNumber), "the email and phone are planted in account.js");
      const s = JSON.stringify(acc);
      assert(!s.includes(PLANT.account.email) && !s.includes(PLANT.account.phoneNumber), "email/phone leaked from parseAccount");
      assert(acc.accountId === PLANT.account.accountId && acc.username === PLANT.account.username, "the four facts");
      const { zip } = makeZip(files, { junkMB: 1 });
      const parsed = await M.zip.readArchive(blobOf(zip, "a.zip"));
      const all = JSON.stringify(parsed);
      assert(!all.includes(PLANT.account.email) && !all.includes(PLANT.account.phoneNumber), "email/phone leaked from readArchive");
      assert(!all.includes("a private DM"), "a DM was read");
    },
  },
  {
    id: "U3a",
    name: "U3 ZIP: the wanted files inflate BYTE-EQUAL; the counts are the planted ones; the 20 MB of media is listed but never read; manifest + legacy + folder paths agree",
    async fn(M) {
      const { zip, entries } = makeZip(files, { junkMB: 20 });
      const blob = blobOf(zip, "twitter.zip");
      for (const name of ["data/account.js", "data/tweets.js", "data/tweets-part1.js", "data/following.js"]) {
        const t = await M.zip.readZipText(blob, name);
        assert(t === files[name], name + " is not byte-equal");
      }
      const reads = [];
      const seen = [];
      const parsed = await M.zip.readArchive(blob, { onRead: (s, e, why) => reads.push([s, e, why]), onEntry: (n, w) => seen.push([n, w]) });
      const c = parsed.counts;
      assert(c.posts === 3000 && c.retweets === 400 && c.replies === 600 && c.following === 1000 && c.likes === 1000 && c.interests === 5, "counts " + JSON.stringify(c));
      assert(parsed.partsSeen === 2, "parts " + parsed.partsSeen);
      const junk = entries.filter((e) => e.name.includes("tweets_media/"));
      assert(junk.length === 20, "20 junk entries planted");
      assert(junk.every((j) => seen.some(([n, w]) => n === j.name && w === false)), "every junk entry is listed, unwanted");
      for (const j of junk) {
        const lo = j.offset;
        const hi = j.offset + 30 + Buffer.byteLength(j.name) + j.compSize;
        assert(!reads.some(([s, e, why]) => why !== "end" && why !== "directory" && s < hi && e > lo), "a junk entry was read: " + j.name);
      }
      const totalRead = reads.filter(([, , why]) => why === "data" || why === "header").reduce((a, [s, e]) => a + (e - s), 0);
      assert(totalRead < 3 * 1024 * 1024, "read " + totalRead + " bytes of a " + zip.length + "-byte archive");
      assert(!parsed.files.includes("direct-messages.js") && !parsed.files.includes("follower.js"), "an unwanted file was read: " + parsed.files);
      const legacy = makeZip(makeArchiveFiles({ seed: 7, legacy: true }), { junkMB: 0 }).zip;
      assert((await M.zip.readArchive(blobOf(legacy, "legacy.zip"))).counts.posts === 3000, "legacy zip");
      const folder = Object.entries(files).map(([name, text]) => {
        const f = new File([text], name.split("/").pop());
        Object.defineProperty(f, "webkitRelativePath", { value: "twitter-2026/" + name });
        return f;
      });
      const fp = await M.zip.readArchive(folder);
      assert(JSON.stringify(fp.counts) === JSON.stringify(c), "the folder path disagrees: " + JSON.stringify(fp.counts));
      return `read ${totalRead} of ${zip.length} bytes`;
    },
  },
  {
    id: "U3b",
    name: "U3 bounds: every read is at most 8 MiB (a 9 MiB stored tweets.js is read in two slices); an archive of 4 GB or more is refused with the folder instruction; an entry over 512 MiB is refused with its size",
    async fn(M) {
      const pad = " ".repeat(9 * 1024 * 1024);
      const big = { "data/account.js": files["data/account.js"], "data/tweets.js": files["data/tweets.js"].replace("window.YTD.tweets.part0 = ", "window.YTD.tweets.part0 = " + pad) };
      // deflated: the 9 MiB entry compresses small, but it inflates through the same bounded path
      const { zip } = makeZip(big, { junkMB: 0 });
      const reads = [];
      await M.zip.readZipText(blobOf(zip, "big.zip"), "data/tweets.js", { onRead: (s, e) => reads.push(e - s) });
      const parsed = await M.zip.readArchive(blobOf(zip, "big.zip"), { onRead: (s, e) => reads.push(e - s) });
      assert(parsed.counts.posts === 1800, "the padded file still parses");
      assert(reads.every((n) => n <= 8 * 1024 * 1024), "a read over 8 MiB: " + Math.max(...reads));
      const fake = { size: 2 ** 32, name: "huge.zip", slice: () => new Blob([]) };
      await expectReject(M.zip.readArchive(fake), /over 4 GB; extract it and pick its data folder instead/, "4 GB");
      // an entry whose directory says 600 MiB
      const small = makeZip({ "data/account.js": files["data/account.js"], "data/tweets.js": files["data/tweets.js"] }, { junkMB: 0 }).zip;
      const z = Buffer.from(small);
      const cdOff = z.readUInt32LE(z.length - 22 + 16);
      let p = cdOff;
      for (let k = 0; k < 2; k++) {
        const nameLen = z.readUInt16LE(p + 28);
        const name = z.subarray(p + 46, p + 46 + nameLen).toString();
        if (name === "data/tweets.js") z.writeUInt32LE(600 * 1024 * 1024, p + 24);
        p += 46 + nameLen + z.readUInt16LE(p + 30) + z.readUInt16LE(p + 32);
      }
      await expectReject(M.zip.readArchive(blobOf(z, "lying.zip")), /600 MB, over the 512 MB/, "512 MiB");
      // the 8 MiB bound on DATA reads, measured on a STORED 9 MiB entry
      const storedBuf = storedZip({ "data/account.js": files["data/account.js"], "data/tweets.js": big["data/tweets.js"] });
      const dataReads = [];
      const sp = await M.zip.readArchive(blobOf(storedBuf, "stored.zip"), { onRead: (s, e, why) => why === "data" && dataReads.push(e - s) });
      assert(sp.counts.posts === 1800, "stored entry parses");
      assert(dataReads.length >= 2 && dataReads.every((n) => n <= 8 * 1024 * 1024), "data reads " + JSON.stringify(dataReads));
      return dataReads.length + " data reads for a 9 MiB entry";
    },
  },
  {
    id: "U3c",
    name: "U3 integrity: a ZIP entry whose bytes were altered is refused (CRC-32), never half-read",
    async fn(M) {
      const z = storedZip({ "data/account.js": files["data/account.js"], "data/following.js": files["data/following.js"] });
      const buf = Buffer.from(z);
      const at = buf.indexOf(Buffer.from("1800000000000000"));
      assert(at > 0, "found a byte to alter");
      buf[at + 3] = buf[at + 3] === 0x31 ? 0x32 : 0x31;
      await expectReject(M.zip.readArchive(blobOf(buf, "altered.zip")), /checksum does not match/, "crc");
    },
  },
  {
    id: "U4a",
    name: "U4 chunked doc: a 3,000-post shelf seals into n ≥ 8 pieces, EVERY PUT under 256 KiB (also a worst-case CJK/emoji/quote document), and a COLD read returns it exactly; names stay bounded over many saves",
    async fn(M) {
      const posts = tweetsOrig.map((t) => ({ personaId: "p_main", id: t.tweet.id_str, text: t.tweet.full_text, createdAt: 1, replyToId: null, isRetweet: false, links: [], favoriteCount: 1, retweetCount: 1, importedAt: 1 }));
      const doc = { v: 1, posts, likes: [] };
      const r = await M.chunk.writeDoc("xShelf", doc);
      assert(r.n >= 8, "pieces " + r.n);
      assert(W().puts.length > 0 && W().puts.every((p) => p.bytes < 262144), "a PUT over 256 KiB: " + Math.max(...W().puts.map((p) => p.bytes)));
      M.chunk.resetXDocsCache();
      const back = await M.chunk.readDoc("xShelf");
      assert(JSON.stringify(back.doc) === JSON.stringify(doc), "the cold read differs");
      const worst = { v: 1, posts: Array.from({ length: 4000 }, (_, i) => ({ id: String(i), text: "日本語のテキスト 🚀🔥 \"\\\" ".repeat(20) })), likes: [] };
      W().puts.length = 0;
      await M.chunk.writeDoc("xWorst", worst);
      const maxPut = Math.max(...W().puts.map((p) => p.bytes));
      assert(maxPut < 262144, "worst-case PUT " + maxPut);
      M.chunk.resetXDocsCache();
      assert(JSON.stringify((await M.chunk.readDoc("xWorst")).doc) === JSON.stringify(worst), "worst-case round trip");
      for (let k = 0; k < 4; k++) await M.chunk.writeDoc("xShelf", { ...doc, likes: [{ k }] });
      const names = [...W().vstate.keys()].filter((n) => n.startsWith("xShelf."));
      const everPut = new Set(W().puts.map((p) => p.ns).filter((n) => n.startsWith("xShelf.")));
      assert(everPut.size <= 2 * r.n + 1, "names grew with saves: " + everPut.size);
      assert(names.length === r.n + 1, "after clean-up exactly one generation + the manifest is stored: " + names.length);
      return `${r.n} pieces, largest PUT ${Math.max(...W().puts.map((p) => p.bytes))} B, worst-case ${maxPut} B`;
    },
  },
  {
    id: "U4b",
    name: "U4 torn write: a save that dies at piece 3 of generation 2 leaves generation 1 readable (cold), byte for byte",
    async fn(M) {
      const doc1 = { v: 1, posts: tweetsOrig.map((t) => ({ personaId: "p_main", id: t.tweet.id_str, text: t.tweet.full_text, createdAt: 1, replyToId: null, isRetweet: false, links: [], favoriteCount: 1, retweetCount: 1, importedAt: 1 })), likes: [] };
      const w1 = await M.chunk.writeDoc("xShelf", doc1);
      assert(w1.gen === 1 && w1.n >= 4, "gen 1 with ≥ 4 pieces: " + JSON.stringify(w1));
      const doc2 = { ...doc1, likes: [{ changed: true }] };
      W().fail = (p, m) => (m === "PUT" && p === "/state/xShelf.g0.2" ? "network" : undefined);
      await expectReject(M.chunk.writeDoc("xShelf", doc2), /could not be reached/, "torn write");
      W().fail = null;
      M.chunk.resetXDocsCache();
      const back = await M.chunk.readDoc("xShelf");
      assert(back.gen === 1, "the live generation moved: " + back.gen);
      assert(JSON.stringify(back.doc) === JSON.stringify(doc1), "generation 1 is not intact");
      // and the next save completes over the torn one
      await M.chunk.writeDoc("xShelf", doc2);
      M.chunk.resetXDocsCache();
      assert(JSON.stringify((await M.chunk.readDoc("xShelf")).doc) === JSON.stringify(doc2), "the save after the torn one");
    },
  },
  {
    id: "U4c",
    name: "U4 a MISSING piece throws 'chunk k of n missing - nothing was changed' (never an empty or shorter document)",
    async fn(M) {
      const doc = { v: 1, posts: tweetsOrig.map((t) => ({ personaId: "p_main", id: t.tweet.id_str, text: t.tweet.full_text, createdAt: 1, replyToId: null, isRetweet: false, links: [], favoriteCount: 1, retweetCount: 1, importedAt: 1 })), likes: [] };
      const w = await M.chunk.writeDoc("xShelf", doc);
      assert(w.n >= 4, "pieces " + w.n);
      W().vstate.delete(`xShelf.g${w.gen % 2}.3`);
      M.chunk.resetXDocsCache();
      await expectReject(M.chunk.readDoc("xShelf"), new RegExp(`chunk 4 of ${w.n} missing\\) - nothing was changed`), "missing piece");
    },
  },
  {
    id: "U4d",
    name: "U4 the WRONG KEY throws (the pieces exist, sealed under another root's key); a plaintext piece is refused as not sealed; no save seals over an unreadable document",
    async fn(M) {
      const doc = { v: 1, posts: [{ id: "1", text: "hello " + TWEET_CANARY }], likes: [] };
      await M.chunk.writeDoc("xShelf", doc);
      M.chunk.resetXDocsCache();
      W().vaultKey = new Uint8Array(32).fill(9);
      await expectReject(M.chunk.readDoc("xShelf"), /could not be opened with this identity's key/, "wrong key");
      const before = JSON.stringify([...W().vstate.entries()]);
      await expectReject(M.chunk.writeDoc("xShelf", { v: 1, posts: [], likes: [] }), /could not be opened/, "a save over an unreadable doc");
      assert(JSON.stringify([...W().vstate.entries()]) === before, "the refused save wrote something");
      W().vaultKey = W().goodKey;
      M.chunk.resetXDocsCache();
      W().vstate.set("xShelf.g1.0", { _: "plaintext " + TWEET_CANARY });
      await expectReject(M.chunk.readDoc("xShelf"), /chunk 1 of 1 is not sealed/, "plaintext piece");
    },
  },
  {
    id: "U4e",
    name: "U4 a piece from ANOTHER save (an older generation's ciphertext put back in the same slot) is refused by name",
    async fn(M) {
      const a = { v: 1, posts: [{ id: "a", text: "first" }], likes: [] };
      await M.chunk.writeDoc("xShelf", a); // gen 1 → slot 1
      const old = W().vstate.get("xShelf.g1.0");
      await M.chunk.writeDoc("xShelf", { ...a, posts: [{ id: "b", text: "second" }] }); // gen 2 → slot 0
      await M.chunk.writeDoc("xShelf", { ...a, posts: [{ id: "c", text: "third" }] }); // gen 3 → slot 1
      W().vstate.set("xShelf.g1.0", old); // the operator replays gen 1's piece in gen 3's place
      M.chunk.resetXDocsCache();
      await expectReject(M.chunk.readDoc("xShelf"), /chunk 1 of 1 is from another save/, "replayed piece");
    },
  },
  {
    id: "U3L",
    name: "LEGACY: posts imported before the shelf (store namespace xImportedPosts) are read with their resurface state and carried into the shelf on its next save; that namespace is never written",
    async fn(M) {
      W().state.xImportedPosts.set("p_main:111", { id: "111", personaId: "p_main", text: "an old import", createdAt: 1000, replyToId: null, links: [], favoriteCount: 1, retweetCount: 0, provenance: "x-archive", importedAt: 5, archiveHandle: "oldhandle", verified: false, resurfaced: true, resurfacedAt: 4242 });
      const posts = await M.importer.importedPostsForAsync("p_main");
      assert(posts.length === 1 && posts[0].resurfaced && posts[0].resurfacedAt === 4242 && posts[0].archiveHandle === "oldhandle", "legacy read " + JSON.stringify(posts));
      // a save carries it into the shelf: with the legacy namespace emptied afterwards, the post is still there
      await M.shelf.saveShelf((await M.shelf.loadShelf()).shelf);
      await M.shelf.saveArchiveMeta((await M.shelf.loadShelf()).meta);
      W().state.xImportedPosts.clear();
      M.chunk.resetXDocsCache();
      const after = await M.importer.importedPostsForAsync("p_main");
      assert(after.length === 1 && after[0].id === "111" && after[0].resurfacedAt === 4242, "not carried into the shelf: " + JSON.stringify(after));
      assert(!W().persisted.includes("xImportedPosts"), "the legacy namespace was written");
    },
  },
  {
    id: "U5a",
    name: "U5 loud flush: a namespace over 256 KiB throws PersistError naming the namespace and its KB — BEFORE anything is sent",
    async fn(M) {
      const huge = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => ["k" + i, "v".repeat(100)]));
      const e = await expectReject(M.persist.flush("grants", huge), /couldn't save grants: \d+ KB is over the 256 KB limit/, "413");
      assert(e instanceof M.persist.PersistError && e.status === 413 && e.ns === "grants" && e.bytes > 262144, "PersistError fields");
      assert(W().puts.length === 0, "a PUT was sent anyway");
      await expectReject(M.persist.flushVault("personaFids", { _: "x".repeat(300000) }), /over the body limit/, "flushVault size check");
      assert(W().puts.length === 0, "flushVault sent it anyway");
    },
  },
  {
    id: "U5b",
    name: "U5 a network error is retried 3 times (4 attempts) then thrown; a 503 then 200 lands on the retry; a 409 is thrown at once",
    async fn(M) {
      let n = 0;
      W().fail = (p, m) => (m === "PUT" ? (n++, "network") : undefined);
      await expectReject(M.persist.flush("likes", { a: true }), /could not be reached/, "network");
      assert(n === 4, "attempts " + n);
      let k = 0;
      W().fail = (p, m) => (m === "PUT" && k++ < 1 ? 503 : undefined);
      await M.persist.flush("likes", { a: true });
      assert(k === 2 && W().vstate.has("likes"), "the retry landed");
      let j = 0;
      W().fail = (p, m) => (m === "PUT" ? (j++, 409) : undefined);
      await expectReject(M.persist.flush("likes", { a: true }), /refused it \(HTTP 409/, "409");
      assert(j === 1, "a 4xx was retried: " + j);
      W().fail = null;
    },
  },
  {
    id: "U5c",
    name: "U5 flush is LOUD: a refused save throws (the old flush answered nothing); the constant equals the validator's",
    async fn(M) {
      W().fail = (p, m) => (m === "PUT" ? 400 : undefined);
      await expectReject(M.persist.flush("rules", { r: 1 }), /couldn't save rules/, "loud");
      W().fail = null;
      const lim = require(path.join(ROOT, "validator", "limits.js"));
      assert(M.persist.STATE_BODY_LIMIT_BYTES === lim.STATE_BODY_LIMIT_BYTES, "constants differ");
    },
  },
  {
    id: "U6",
    name: "U6 index builder (the REAL validator/xindex.js on the in-process stub): 3 pages by cursor, the 429 honoured, a schema break aborts and KEEPS the old file with meta.lastError, the fname release applied, coverage computed",
    async fn() {
      const { openDb } = require(path.join(ROOT, "validator", "db.js"));
      const { buildIndex } = require(path.join(ROOT, "validator", "xindex.js"));
      const db = openDb(":memory:");
      const dir = mkdtempSync(path.join(HERE, "u6-"));
      const st = { dir, buf: null, meta: null };
      const rows = synthIndexRows({ noise: 2400 });
      const stub = createIndexStub({ rows, extraTransfers: [{ username: "planted-three", to: 0 }] });
      const sleeps = [];
      const meta = await buildIndex(db, st, { sourceUrl: "http://s", fnamesUrl: "http://s", fetchImpl: stub.fetchFor("http://s"), sleep: async (ms) => sleeps.push(ms), minIntervalMs: 0, log: quiet });
      assert(meta.pages === 3 && meta.rows === 2407, "pages/rows " + meta.pages + "/" + meta.rows);
      assert(stub.state.calls.filter((c) => c.path === "/fc/account-verifications").length === 4 && sleeps.includes(1000), "the 429 was not honoured");
      const doc = JSON.parse(gunzipSync(st.buf).toString());
      const xid = doc.xid.split(","), fn = doc.fn.split(",");
      assert(fn[xid.indexOf("1600000000000000003")] === "", "the release was not applied");
      assert(meta.fnameCoverage > 0 && meta.fnameCoverage < 1, "coverage " + meta.fnameCoverage);
      const first = st.buf;
      stub.setBreakPage(1);
      await expectReject(buildIndex(db, st, { sourceUrl: "http://s", fnamesUrl: "http://s", fetchImpl: stub.fetchFor("http://s"), sleep: async () => {}, minIntervalMs: 0, log: quiet }), /page 1/, "schema break");
      assert(st.buf === first, "the old file was replaced");
      assert(st.meta.lastError && st.meta.lastError.page === 1, "meta.lastError " + JSON.stringify(st.meta.lastError));
      assert(readFileSync(path.join(dir, "fc-index.v1.json.gz")).equals(first), "the old file on disk changed");
    },
  },
  {
    id: "U7a",
    name: "U7 matcher: exactly the 7 planted matches of 1,000 follows, ids exact strings; an OWN fid is state 'own' (counted, never offered); the stored matches survive a cold read",
    async fn(M) {
      builtIndex ??= await buildStubIndex(synthIndexRows({ noise: 2400 }));
      serveIndex(builtIndex);
      await M.follows.saveFollows({ v: 1, byPersona: { p_main: { ids: followOrig, importedAt: 1 } }, matches: {}, queue: [] });
      W().ownExtra = new Set([900104]);
      const a = await M.match.rematch("p_main", { force: true });
      assert(a.index.available === true, "index unavailable");
      assert(a.counts.follows === 1000 && a.counts.matched === 7 && a.counts.own === 1 && a.counts.unmatched === 993, "counts " + JSON.stringify(a.counts));
      const want = [...PLANT.realFollows, ...PLANT.fakeFollows].map((f) => f.xid).sort();
      assert(JSON.stringify(a.items.map((i) => i.xId).sort()) === JSON.stringify(want), "items " + a.items.map((i) => i.xId));
      assert(a.items.find((i) => i.fid === 900104)?.state === "own", "own not marked");
      assert(a.items.filter((i) => i.state === "new").length === 6, "new");
      M.chunk.resetXDocsCache();
      const s = await M.match.matchStatus("p_main");
      assert(s.counts.matched === 7 && s.lastMatchedAt, "stored matches lost");
    },
  },
  {
    id: "U7b",
    name: "U7 never fail open: a CUT-SHORT index download matches nothing and keeps the old matches; an unbuilt index is {available:false} (no '0 matches'); an unreadable vault refuses (no own set guessed)",
    async fn(M) {
      builtIndex ??= await buildStubIndex(synthIndexRows({ noise: 2400 }));
      serveIndex(builtIndex);
      await M.follows.saveFollows({ v: 1, byPersona: { p_main: { ids: followOrig, importedAt: 1 } }, matches: {}, queue: [] });
      await M.match.rematch("p_main", { force: true });
      const cut = JSON.parse(builtIndex.text);
      cut.xid = cut.xid.split(",").slice(0, 100).join(",");
      M.idx.resetXIndexCache();
      W().index = { status: 200, text: JSON.stringify(cut), etag: '"cut"' };
      await expectReject(M.match.rematch("p_main", { force: true }), /incomplete download/, "partial index");
      M.chunk.resetXDocsCache();
      assert((await M.match.matchStatus("p_main")).counts.matched === 7, "the old matches were replaced");
      M.idx.resetXIndexCache();
      W().index = { status: 503 };
      W().indexMeta = { available: false };
      const un = await M.match.rematch("p_main", { force: true });
      assert(un.index.available === false && un.counts.matched === 7, "unbuilt index: " + JSON.stringify(un.index));
      W().vaultThrows = true;
      await expectReject(M.match.rematch("p_main", { force: true }), /vault/, "unreadable vault");
      W().vaultThrows = false;
    },
  },
  {
    id: "U9a",
    name: "U9 identity: the persona's OWN fid found in the index → its X account; the click attests method farcaster-verified with proofRef fc-index:<builtAt>:fid:<fid>; a private persona and a second persona are refused; a matching archive then lands VERIFIED",
    async fn(M) {
      builtIndex ??= await buildStubIndex(synthIndexRows({ noise: 2400 }));
      serveIndex(builtIndex);
      W().fidRecords = [{ personaId: "p_main", fid: 900104, origin: "fixture" }, { personaId: "p_alt", fid: 900104, origin: "fixture" }, { personaId: "p_priv", fid: 900103, origin: "fixture" }];
      const ident = await M.identity.xIdentityFor("p_main");
      assert(ident.fid === 900104 && ident.x?.handle === "planted_four" && ident.x.platformId === "1600000000000000004", "identity " + JSON.stringify(ident.x));
      const a = await M.identity.attestFromIndex("p_main");
      assert(a.method === "farcaster-verified" && a.proofRef === `fc-index:${builtIndex.meta.builtAt}:fid:900104`, "attestation " + JSON.stringify(a));
      assert(M.att.attestationLabel(a) === "verified on Farcaster", "label");
      await expectReject(M.identity.attestFromIndex("p_priv"), /private personas cannot carry/, "private");
      await expectReject(M.identity.attestFromIndex("p_alt"), /already attested to another persona/, "one persona per handle");
      const v = M.importer.linkStatusFor("p_main", { username: "planted_four", accountId: "1600000000000000004" });
      assert(v.verified && v.verifiedBy === "farcaster-verified", "the matching archive is verified");
      const w = M.importer.linkStatusFor("p_main", { username: "planted_four", accountId: "1999" });
      assert(!w.verified, "an archive of ANOTHER X account id with the same handle was verified");
    },
  },
  {
    id: "U9b",
    name: "U9 stale: a later index WITHOUT the row hides the badge (staleSince) and KEEPS the attestation; the row back clears it",
    async fn(M) {
      builtIndex ??= await buildStubIndex(synthIndexRows({ noise: 2400 }));
      serveIndex(builtIndex);
      W().fidRecords = [{ personaId: "p_main", fid: 900104, origin: "fixture" }];
      await M.identity.attestFromIndex("p_main");
      const without = await buildStubIndex(synthIndexRows({ noise: 2400 }).filter((r) => r.fid !== 900104));
      M.idx.resetXIndexCache();
      serveIndex(without);
      const ident = await M.identity.xIdentityFor("p_main", { force: true });
      const a = await M.identity.reconcileStaleness("p_main", ident);
      assert(a && a.staleSince && a.method === "farcaster-verified", "not marked stale: " + JSON.stringify(a));
      assert(M.att.attestationFor("p_main"), "the attestation was removed");
      assert(M.att.attestationLabel(a) === "no longer verified on Farcaster" && !M.att.attestationIsVerifying(a), "a stale row still verifies");
      M.idx.resetXIndexCache();
      serveIndex(builtIndex);
      const back = await M.identity.reconcileStaleness("p_main", await M.identity.xIdentityFor("p_main", { force: true }));
      assert(back && back.staleSince === null, "the row came back but the mark stayed");
    },
  },
  {
    id: "U10a",
    name: "U10 caps: 20,001 posts are refused WITH the count (nothing staged, nothing written); 'import the newest N' keeps exactly the newest N",
    async fn(M) {
      const s = await M.importer.newImportSession("p_main");
      const before = W().puts.length;
      await expectReject(M.importer.stagePosts(s.id, [], { total: 20001 }), /20,001 posts, more than the 20,000 this import takes\. Nothing was kept/, "over cap");
      assert(W().puts.length === before, "something was written");
      process.env.X_IMPORT_MAX_POSTS = "50";
      try {
        const s2 = await M.importer.newImportSession("p_main");
        await M.importer.stageAccount(s2.id, { username: "synth_yeak", accountId: PLANT.account.accountId, displayName: "S", createdAt: null });
        const posts = M.parse.mergeTweetParts([M.parse.parseTweets(files["data/tweets.js"])]).slice(0, 120);
        await expectReject(M.importer.stagePosts(s2.id, posts.slice(0, 60), { total: 120 }), /120 posts, more than the 50/, "over cap at stage");
        await M.importer.stagePosts(s2.id, posts.slice(0, 50), { total: 120, newestOnly: true });
        const r = await M.importer.commitSession(s2.id, ["posts"], {});
        assert(r.landed.posts === 50, "landed " + r.landed.posts);
        const shelf = (await M.shelf.loadShelf()).shelf;
        const ids = new Set(shelf.posts.map((p) => p.id));
        assert(posts.slice(0, 50).every((p) => ids.has(p.id)), "not the newest 50");
      } finally {
        delete process.env.X_IMPORT_MAX_POSTS;
      }
    },
  },
  {
    id: "U10b",
    name: "U10 the follow list needs the fingerprint warning ACKNOWLEDGED, and a private persona never takes it (409, nothing written); with the ack it lands sealed — the at-rest bytes carry no tweet text, raw X id or email",
    async fn(M) {
      const s = await M.importer.newImportSession("p_main");
      await M.importer.stageAccount(s.id, { username: "synth_yeak", accountId: PLANT.account.accountId, displayName: "S", createdAt: null });
      await M.importer.stageFollowing(s.id, followOrig.slice(0, 2000), { total: 1000 });
      await M.importer.stagePosts(s.id, M.parse.parseTweets(files["data/tweets.js"]).slice(0, 300), { total: 300 });
      const before = W().puts.length;
      await expectReject(M.importer.commitSession(s.id, ["posts", "following"], {}), /understand a follow list is a fingerprint/, "no ack");
      await expectReject(M.importer.commitSession(s.id, ["following"], { personaId: "p_priv", acknowledgedFingerprintWarning: true }), /private persona never follows/, "private");
      assert(W().puts.length === before, "a refused commit wrote something");
      await expectReject(M.importer.stageFollowing(s.id, [Number(followOrig[0])]), /not an X id/, "a numeric id is refused, never converted");
      const r = await M.importer.commitSession(s.id, ["posts", "following"], { acknowledgedFingerprintWarning: true });
      assert(r.landed.following === 1000 && r.landed.posts === 300, "landed " + JSON.stringify(r.landed));
      const pieces = [...W().vstate.entries()].filter(([n]) => /^x(Shelf|Follows|Archive)\./.test(n));
      assert(pieces.length >= 6 && pieces.every(([, e]) => e.__whole && typeof e.__whole.ct === "string"), "the sealed pieces exist as ciphertext");
      const atRest = JSON.stringify([...W().vstate.entries()]);
      assert(!atRest.includes(TWEET_CANARY), "tweet text at rest");
      assert(!followOrig.slice(0, 50).some((id) => atRest.includes(id)) && !atRest.includes("9615352"), "a raw X id at rest");
      assert(!atRest.includes(PLANT.account.email) && !atRest.includes(PLANT.account.accountId), "account facts at rest");
    },
  },
  {
    id: "G0a",
    name: "G0 the fixture link exists on the RIG only: GET says fixtureAvailable true with dev hooks and false without; a fixture link off the rig is refused 404; a rig link is method 'fixture', proofRef fixture:users/me:<id>, labelled 'test link, not verified'",
    async fn(M) {
      delete process.env.ZK_DEV_HOOKS;
      const off = await call(M, M.linkRoute, "GET", "/api/x/link");
      assert(off.json.fixtureAvailable === false, "off-rig fixtureAvailable " + off.json.fixtureAvailable);
      const refused = await call(M, M.linkRoute, "POST", "/api/x/link", { action: "link", fixtureHandle: "someone" });
      assert(refused.status === 404, "off-rig link " + refused.status);
      process.env.ZK_DEV_HOOKS = "true";
      try {
        const on = await call(M, M.linkRoute, "GET", "/api/x/link");
        assert(on.json.fixtureAvailable === true, "rig fixtureAvailable");
        const linked = await call(M, M.linkRoute, "POST", "/api/x/link", { action: "link", fixtureHandle: "rig_handle" });
        assert(linked.status === 200, "rig link " + linked.status + " " + JSON.stringify(linked.json));
        const a = linked.json.attestation;
        assert(a.method === "fixture" && /^fixture:users\/me:\d+$/.test(a.proofRef), "attestation " + JSON.stringify(a));
        assert(linked.json.label === "test link, not verified", "label " + linked.json.label);
      } finally {
        delete process.env.ZK_DEV_HOOKS;
      }
    },
  },
  {
    id: "G0b",
    name: "G0 the X destination is listed on the rig only (an attestation bound it either way)",
    async fn(M) {
      W().state.destinationBindings.set("p_main", ["x_mock", "x"]);
      delete process.env.ZK_DEV_HOOKS;
      const off = M.dest.boundDestinationsFor("p_main").map((d) => d.id);
      assert(!off.includes("x") && off.includes("x_mock"), "off-rig " + off);
      process.env.ZK_DEV_HOOKS = "true";
      const on = M.dest.boundDestinationsFor("p_main").map((d) => d.id);
      delete process.env.ZK_DEV_HOOKS;
      assert(on.includes("x"), "rig " + on);
    },
  },
  {
    id: "G0c",
    name: "G0 sync is never 'live': with X_API_CLIENT_ID set it refuses; without, it says fixture",
    async fn(M) {
      W().state.xAttestations.set("h", { platform: "x", handle: "h", platformUserId: "1", personaId: "p_main", verifiedAt: 1, method: "fixture", proofRef: "fixture:users/me:1" });
      process.env.X_API_CLIENT_ID = "unit-fake-client-id";
      try {
        await expectReject(M.sync.syncOwnedReads("p_main", "bookmarks"), /live X sync is not built/, "live label");
      } finally {
        delete process.env.X_API_CLIENT_ID;
      }
      const r = await M.sync.syncOwnedReads("p_main", "bookmarks");
      assert(r.mode === "fixture", "mode " + r.mode);
    },
  },
  {
    id: "G0d",
    name: "G0 a fixture link NEVER earns a verified import (same handle, same id: still 'test link'); the must-not-ship lists both carry the X credentials",
    async fn(M) {
      W().state.xAttestations.set("synth_yeak", { platform: "x", handle: "synth_yeak", platformUserId: PLANT.account.accountId, personaId: "p_main", verifiedAt: 1, method: "fixture", proofRef: "fixture:users/me:1" });
      const st = M.importer.linkStatusFor("p_main", { username: "synth_yeak", accountId: PLANT.account.accountId });
      assert(!st.verified && st.testLink, "a fixture link verified: " + JSON.stringify(st));
      for (const n of ["X_API_CLIENT_ID", "X_API_CLIENT_SECRET"]) assert(M.envc.MUST_NOT_SHIP.includes(n), "app list lacks " + n);
      const vc = require(path.join(ROOT, "validator", "env-contract.js"));
      for (const n of ["X_API_CLIENT_ID", "X_API_CLIENT_SECRET"]) assert(vc.MUST_NOT_SHIP.includes(n), "validator list lacks " + n);
      assert(JSON.stringify([...M.envc.MUST_NOT_SHIP].sort()) === JSON.stringify([...vc.MUST_NOT_SHIP].sort()), "the two lists differ");
      assert(M.envc.contractViolations({ NODE_ENV: "production", LAYERS_REQUIRE_SIG: "true", X_API_CLIENT_ID: "x" }).includes("X_API_CLIENT_ID"), "not refused at boot");
    },
  },
  {
    id: "G0e",
    name: "G0 the fixture archive and raw-file ingest exist on the rig only: off the rig both answer 404 'not on this site'; the summary says fixtureAvailable false",
    async fn(M) {
      delete process.env.ZK_DEV_HOOKS;
      const b = await call(M, M.importRoute, "POST", "/api/x/import", { action: "begin" });
      assert(b.status === 200, "begin " + b.status + JSON.stringify(b.json));
      const fx = await call(M, M.importRoute, "POST", "/api/x/import", { action: "ingestFixture", sessionId: b.json.sessionId });
      assert(fx.status === 404 && fx.json.error === "not on this site", "ingestFixture off-rig " + fx.status);
      const raw = await call(M, M.importRoute, "POST", "/api/x/import", { action: "ingest", sessionId: b.json.sessionId, name: "account.js", content: files["data/account.js"] });
      assert(raw.status === 404, "ingest off-rig " + raw.status);
      const sum = await call(M, M.importRoute, "GET", "/api/x/import?view=summary");
      assert(sum.status === 200 && sum.json.fixtureAvailable === false, "summary " + JSON.stringify(sum.json).slice(0, 200));
      assert(!JSON.stringify(sum.json).includes(PLANT.account.email), "the summary carries the email");
    },
  },
  // ---------------------------------------------------------------------------- PERSONA LAUNCH P2 review fixes (wave 1)
  {
    id: "R1",
    name: "R1 RACE (review W1-R1): two resurface toggles on two different posts, sent together — BOTH survive a cold read",
    async fn(M) {
      const shelf = { v: 1, posts: ["101", "102"].map((id) => ({ personaId: "p_main", id, text: "t" + id, createdAt: 1, replyToId: null, isRetweet: false, links: [], favoriteCount: 0, retweetCount: 0, importedAt: 1 })), likes: [] };
      await M.shelf.saveShelf(shelf);
      await M.shelf.saveArchiveMeta({ v: 1, byPersona: { p_main: { account: { username: "me", accountId: "1", displayName: "me", createdAt: null }, importedAt: 1, lanes: ["posts"], resurfaced: {} } } });
      await Promise.all([M.importer.setResurfaced("p_main", "101", true), M.importer.setResurfaced("p_main", "102", true)]);
      M.chunk.resetXDocsCache();
      const back = await M.importer.importedPostsForAsync("p_main");
      const on = back.filter((p) => p.resurfaced).map((p) => p.id).sort();
      assert(JSON.stringify(on) === JSON.stringify(["101", "102"]), "only " + JSON.stringify(on) + " survived; the other toggle was silently overwritten");
    },
  },
  {
    id: "R2",
    name: "R2 RACE (review W1-R1): persona B's import commits while persona A's resurface toggle lands — A's toggle AND B's import both survive a cold read",
    async fn(M) {
      const shelf = { v: 1, posts: [{ personaId: "p_main", id: "201", text: "a", createdAt: 1, replyToId: null, isRetweet: false, links: [], favoriteCount: 0, retweetCount: 0, importedAt: 1 }], likes: [] };
      await M.shelf.saveShelf(shelf);
      await M.shelf.saveArchiveMeta({ v: 1, byPersona: { p_main: { account: { username: "me", accountId: "1", displayName: "me", createdAt: null }, importedAt: 1, lanes: ["posts"], resurfaced: {} } } });
      const s = await M.importer.newImportSession("p_alt");
      await M.importer.stageAccount(s.id, { username: "alt", accountId: "2", displayName: "alt" });
      await M.importer.stagePosts(s.id, [{ id: "301", text: "b", createdAt: 2 }]);
      await Promise.all([M.importer.commitSession(s.id, ["posts"], { personaId: "p_alt" }), M.importer.setResurfaced("p_main", "201", true)]);
      M.chunk.resetXDocsCache();
      const a = await M.importer.importedPostsForAsync("p_main");
      assert(a.length === 1 && a[0].resurfaced, "A's resurface toggle was lost: " + JSON.stringify(a.map((p) => [p.id, p.resurfaced])));
      const b = await M.importer.importedPostsForAsync("p_alt");
      assert(b.length === 1 && b[0].id === "301" && b[0].archiveHandle === "alt", "B's import was lost: " + JSON.stringify(b));
    },
  },
  {
    id: "R3a",
    name: "R3 STALE CACHE (review W1-R3): another tab of the root saved since this process read the follow list; this process's CHANGE re-reads and applies itself — the other tab's list survives beside it",
    async fn(M) {
      await M.chunk.readDoc("xFollows"); // this tab: cached, absent (gen 0)
      const mine = globalThis.__layersXDocs.get("xFollows");
      const snap = { ...mine, occupied: [...mine.occupied] };
      // the OTHER tab's import (same validator, same root)
      await M.follows.updateFollows((d) => ({ ...d, byPersona: { ...d.byPersona, p_main: { ids: ["1", "2", "3"], importedAt: 1 } } }));
      // ...but this tab still holds its pre-import copy
      globalThis.__layersXDocs.set("xFollows", snap);
      globalThis.__layersXDocGens.set("xFollows", 0);
      await M.follows.updateFollows((d) => ({ ...d, byPersona: { ...d.byPersona, p_alt: { ids: ["9"], importedAt: 2 } } }));
      M.chunk.resetXDocsCache();
      const back = await M.follows.loadFollows();
      assert(back.byPersona.p_main && back.byPersona.p_main.ids.length === 3, "the other tab's follow list for p_main is gone: " + JSON.stringify(back.byPersona));
      assert(back.byPersona.p_alt && back.byPersona.p_alt.ids[0] === "9", "this tab's change was lost: " + JSON.stringify(back.byPersona));
    },
  },
  {
    id: "R3b",
    name: "R3 STALE CACHE (review W1-R3): a whole-document REPLACE from a stale copy is REFUSED in plain words, writes nothing, and drops the stale copy (the next read is cold)",
    async fn(M) {
      await M.chunk.readDoc("xFollows");
      const mine = globalThis.__layersXDocs.get("xFollows");
      const snap = { ...mine, occupied: [...mine.occupied] };
      await M.follows.updateFollows((d) => ({ ...d, byPersona: { ...d.byPersona, p_main: { ids: ["1", "2", "3"], importedAt: 1 } } }));
      globalThis.__layersXDocs.set("xFollows", snap);
      globalThis.__layersXDocGens.set("xFollows", 0);
      const putsBefore = W().puts.length;
      await expectReject(M.chunk.writeDoc("xFollows", { v: 1, byPersona: { p_alt: { ids: ["9"], importedAt: 2 } }, matches: {}, queue: [] }), /changed in another tab or on another device since this page read it - nothing was changed/, "stale replace");
      assert(W().puts.length === putsBefore, "the refused replace wrote " + (W().puts.length - putsBefore) + " piece(s)");
      assert(!globalThis.__layersXDocs.has("xFollows"), "the stale copy was kept in the cache");
      const cold = M.chunk.xDocColdReads();
      const back = await M.follows.loadFollows();
      assert(M.chunk.xDocColdReads() === cold + 1, "the read after the refusal was not cold");
      assert(back.byPersona.p_main && !back.byPersona.p_alt, "the stored list changed: " + JSON.stringify(back.byPersona));
    },
  },
  {
    id: "R3c",
    name: "R3 STALE WRITER NEVER TOUCHES THE LIVE SLOT (review W1-R3): a stale save that TEARS leaves the other tab's save readable cold, byte for byte — no piece of the live slot was written",
    async fn(M) {
      const mk = (tag) => ({ v: 1, posts: tweetsOrig.slice(0, 1500).map((t) => ({ personaId: "p_main", id: t.tweet.id_str, text: tag + t.tweet.full_text, createdAt: 1, replyToId: null, isRetweet: false, links: [], favoriteCount: 1, retweetCount: 1, importedAt: 1 })), likes: [] });
      const a = mk("A ");
      const w1 = await M.chunk.writeDoc("xShelf", a); // this tab's own save: gen 1, slot 1
      assert(w1.gen === 1 && w1.n >= 2, "gen 1 with at least 2 pieces: " + JSON.stringify(w1));
      const mine = globalThis.__layersXDocs.get("xShelf");
      const snap = { ...mine, occupied: [...mine.occupied] };
      const b = mk("B ");
      const w2 = await M.chunk.updateDoc("xShelf", () => b); // the OTHER tab: gen 2, slot 0 (the live slot now)
      assert(w2.gen === 2, "other tab gen " + w2.gen);
      globalThis.__layersXDocs.set("xShelf", snap); // this tab still believes gen 1 is live
      globalThis.__layersXDocGens.set("xShelf", 1);
      const live = `xShelf.g${w2.gen % 2}.`;
      const putsBefore = W().puts.length;
      // the stale tab's save tears at its second piece, whichever slot it aims at
      W().fail = (p, m) => (m === "PUT" && /^\/state\/xShelf\.g[01]\.1$/.test(p) ? "network" : undefined);
      await expectReject(M.chunk.updateDoc("xShelf", (d) => ({ ...d, likes: [{ stale: true }] })), /could not be reached/, "torn stale save");
      W().fail = null;
      const touched = W().puts.slice(putsBefore).map((p) => p.ns).filter((ns) => ns.startsWith(live) || ns === "xShelf.m");
      assert(touched.length === 0, "the stale save wrote into the live slot: " + touched.join(","));
      M.chunk.resetXDocsCache();
      const back = await M.chunk.readDoc("xShelf");
      assert(back.gen === 2 && JSON.stringify(back.doc) === JSON.stringify(b), "the other tab's save is no longer readable intact (gen " + back.gen + ")");
    },
  },
  {
    id: "R3d",
    name: "R3 A VANISHED INDEX is a rollback, not an empty document: after this process saw save 2, an absent manifest THROWS on read, and a save refuses (nothing written)",
    async fn(M) {
      await M.chunk.writeDoc("xArchive", { v: 1, byPersona: { p_main: { account: { username: "me", accountId: "1", displayName: "me", createdAt: null }, importedAt: 1, lanes: ["posts"], resurfaced: {} } } });
      await M.chunk.updateDoc("xArchive", (d) => ({ ...d, v: 1 }));
      globalThis.__layersXDocs.delete("xArchive"); // the cached copy is gone; the generation this process saw is not
      W().vstate.delete("xArchive.m"); // the operator drops the index
      await expectReject(M.chunk.readDoc("xArchive"), /the index of its pieces is gone after save 2/, "vanished index read");
      const putsBefore = W().puts.length;
      await expectReject(M.shelf.updateArchiveMeta((m) => ({ ...m, byPersona: {} })), /gone after save 2/, "save over a vanished index");
      assert(W().puts.length === putsBefore, "a save went out over the vanished index");
    },
  },
  {
    id: "R4",
    name: "R4 REORDER (review W1-R4): two saves of one namespace in flight, the older one's first PUT meets a 503 — the NEWER body is what the validator keeps, and both calls resolve",
    async fn(M) {
      let n = 0;
      W().fail = (p, method) => (method === "PUT" && p === "/state/accountLinks" && n++ === 0 ? 503 : undefined);
      const older = M.persist.flushVault("accountLinks", { _: { v: "older" } });
      await new Promise((r) => setTimeout(r, 20));
      const newer = M.persist.flushVault("accountLinks", { _: { v: "newer" } });
      await Promise.all([older, newer]);
      W().fail = null;
      const kept = W().vstate.get("accountLinks");
      assert(kept && kept._ && kept._.v === "newer", "the validator kept " + JSON.stringify(kept) + " after the newer save had landed");
      // the same through flush (sealed): the slot is taken at the call, before the seal's dynamic import
      let k = 0;
      W().fail = (p, method) => (method === "PUT" && p === "/state/likes" && k++ === 0 ? 503 : undefined);
      const o2 = M.persist.flush("likes", { v: "older" });
      const n2 = M.persist.flush("likes", { v: "newer" });
      await Promise.all([o2, n2]);
      W().fail = null;
      const opened = M.vault.unsealAny("likes", W().vstate.get("likes"));
      assert(opened && opened.v === "newer", "flush kept " + JSON.stringify(opened));
    },
  },
  {
    id: "U5d",
    name: "U5 a 409 STALE COUNTER (a concurrent signed request on the same name took a later counter) is re-signed and retried, for a write and for a chunked read; any other 409 is still thrown at once",
    async fn(M) {
      let k = 0;
      W().fail = (p, m) => (m === "PUT" && p === "/state/likes" && k++ === 0 ? { status: 409, body: { error: "stale counter (last accepted 4503599627370500)" } } : undefined);
      await M.persist.flush("likes", { a: true });
      assert(k === 2 && W().vstate.has("likes"), "the write was not retried after a stale counter: attempts " + k);
      await M.chunk.writeDoc("xShelf", { v: 1, posts: [{ id: "1", text: "x" }], likes: [] });
      M.chunk.resetXDocsCache();
      let g = 0;
      W().fail = (p, m) => (m === "GET" && p === "/state/xShelf.m" && g++ === 0 ? { status: 409, body: { error: "stale counter (last accepted 7)" } } : undefined);
      const back = await M.chunk.readDoc("xShelf");
      assert(g === 2 && back.gen === 1, "the chunked read was not retried after a stale counter: attempts " + g);
      let j = 0;
      W().fail = (p, m) => (m === "PUT" ? (j++, { status: 409, body: { error: "no device-auth anchor registered" } }) : undefined);
      await expectReject(M.persist.flush("likes", { b: true }), /HTTP 409: no device-auth anchor/, "other 409");
      assert(j === 1, "a non-stale 409 was retried: " + j);
      W().fail = null;
    },
  },
  {
    id: "Q1",
    name: "Q1 hide, never delete (review W1-R6): a follow queue stored by the later G5 wave survives a load, an import commit, a rematch and the seeding door — cold",
    async fn(M) {
      builtIndex ??= await buildStubIndex(synthIndexRows({ noise: 2400 }));
      serveIndex(builtIndex);
      const queued = [{ fid: 777, xId: "1700000000000000007", state: "queued", at: 5 }];
      await M.chunk.writeDoc("xFollows", { v: 1, byPersona: {}, matches: {}, queue: queued }); // as the G5 wave stores it
      M.chunk.resetXDocsCache();
      assert(JSON.stringify((await M.follows.loadFollows()).queue) === JSON.stringify(queued), "load dropped the queue");
      const s = await M.importer.newImportSession("p_main");
      await M.importer.stageAccount(s.id, { username: "synth_yeak", accountId: PLANT.account.accountId, displayName: "S", createdAt: null });
      await M.importer.stageFollowing(s.id, followOrig.slice(0, 50), { total: 50 });
      await M.importer.commitSession(s.id, ["following"], { acknowledgedFingerprintWarning: true });
      await M.match.rematch("p_main", { force: true });
      await M.follows.saveFollows({ v: 1, byPersona: { p_alt: { ids: ["5"], importedAt: 3 } }, matches: {}, queue: [] });
      M.chunk.resetXDocsCache();
      const back = await M.follows.loadFollows();
      assert(JSON.stringify(back.queue) === JSON.stringify(queued), "the stored queue was erased: " + JSON.stringify(back.queue));
      assert(back.byPersona.p_main?.ids.length === 50 && back.byPersona.p_alt && back.matches.p_main, "the writes themselves did not land: " + Object.keys(back.byPersona));
    },
  },
  {
    id: "G0f",
    name: "G0 THE OWNER SERVICE IS NOT THE RIG (review W1-R5): dev hooks on + the owner secret → no fixture link, no fixture archive / raw ingest / chunk tamper (404), no X destination, no MigrationPanel; the same process without the secret (the rig) offers all of them",
    async fn(M) {
      return shapeCheck(M, { ZK_DEV_HOOKS: "true", OWNER_ACCESS_SECRET: "unit-owner-secret" }, "owner service");
    },
  },
  {
    id: "G0g",
    name: "G0 THE EMPTY WORLD IS NOT THE RIG (review W1-R5): dev hooks on + LAYERS_WORLD=empty → the same four conveniences absent (404s); the rig offers them",
    async fn(M) {
      return shapeCheck(M, { ZK_DEV_HOOKS: "true", LAYERS_WORLD: "empty" }, "empty world");
    },
  },
];

/**
 * W1-R5: probe every X fixture convenience under `env`, then under the plain rig (dev hooks only) — absent in the
 * first, present in the second (the vacuity check: a probe that could not see them would pass the first half alone).
 */
async function shapeCheck(M, env, label) {
  const keys = ["ZK_DEV_HOOKS", "OWNER_ACCESS_SECRET", "LAYERS_WORLD"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const setEnv = (e) => {
    for (const k of keys) {
      if (e[k] === undefined) delete process.env[k];
      else process.env[k] = e[k];
    }
  };
  const probe = async () => {
    const link = await call(M, M.linkRoute, "GET", "/api/x/link");
    const linkPost = await call(M, M.linkRoute, "POST", "/api/x/link", { action: "link", fixtureHandle: "shape_probe" });
    const sum = await call(M, M.importRoute, "GET", "/api/x/import?view=summary");
    const fixture = await call(M, M.importRoute, "POST", "/api/x/import", { action: "ingestFixture", sessionId: "ximp_shape_probe" });
    const ingest = await call(M, M.importRoute, "POST", "/api/x/import", { action: "ingest", sessionId: "ximp_shape_probe", name: "account.js", content: "" });
    const tamper = await call(M, M.importRoute, "POST", "/api/x/import", { action: "devTamperChunk", ns: "xShelf.g0.0" });
    const restore = await call(M, M.importRoute, "POST", "/api/x/import", { action: "devRestoreChunk", ns: "xShelf.g0.0" });
    W().state.destinationBindings.set("p_main", ["x_mock", "x"]);
    const xDest = M.dest.boundDestinationsFor("p_main").some((d) => d.id === "x");
    const tree = M.importXPage.default();
    const kids = [].concat(tree?.props?.children ?? []);
    if (!kids.some((c) => c && c.type && c.type.unitMark === "XImportWizard")) throw new Error("the page did not render (no wizard among " + kids.length + " children)");
    const migration = kids.some((c) => c && c.type && c.type.unitMark === "MigrationPanel");
    return { link: link.json.fixtureAvailable, linkPost: linkPost.status, summary: sum.json?.fixtureAvailable, fixture: fixture.status, ingest: ingest.status, tamper: tamper.status, restore: restore.status, xDest, migration };
  };
  try {
    setEnv(env);
    const off = await probe();
    const leaks = [];
    if (off.link !== false) leaks.push("the fixture link is offered");
    if (off.linkPost !== 404) leaks.push("a fixture link was made (" + off.linkPost + ")");
    if (off.summary !== false) leaks.push("the import summary offers the fixture archive");
    for (const k of ["fixture", "ingest", "tamper", "restore"]) if (off[k] !== 404) leaks.push(k + " answered " + off[k]);
    if (off.xDest) leaks.push("the X destination is listed");
    if (off.migration) leaks.push("MigrationPanel renders");
    assert(leaks.length === 0, label + ": " + leaks.join("; "));
    setEnv({ ZK_DEV_HOOKS: "true" });
    const on = await probe();
    const missing = [];
    if (on.link !== true) missing.push("fixture link");
    if (on.linkPost !== 200) missing.push("link POST " + on.linkPost);
    if (on.summary !== true) missing.push("fixture archive");
    for (const k of ["fixture", "ingest", "tamper", "restore"]) if (on[k] === 404) missing.push(k);
    if (!on.xDest) missing.push("X destination");
    if (!on.migration) missing.push("MigrationPanel");
    assert(missing.length === 0, "VACUOUS: the rig itself lacks " + missing.join(", "));
    return label + ": all absent; the rig has all of them";
  } finally {
    setEnv(saved);
  }
}

// a STORED zip (method 0) for the byte-bound and integrity checks
function storedZip(map) {
  const { zip, entries } = makeZip(map, { junkMB: 0 });
  // rebuild with method 0 by re-writing each entry stored: simplest is a fresh tiny writer
  const chunks = [];
  const central = [];
  let off = 0;
  const { crc32 } = require("node:zlib");
  for (const [name, text] of Object.entries(map)) {
    const raw = Buffer.from(text, "utf8");
    const nm = Buffer.from(name);
    const crc = crc32(raw) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(10, 4);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(raw.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nm.length, 26);
    chunks.push(lh, nm, raw);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(raw.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, nm);
    off += 30 + nm.length + raw.length;
  }
  void zip;
  void entries;
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(map).length, 8);
  end.writeUInt16LE(Object.keys(map).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...chunks, cd, end]);
}

async function runChecks(M, which) {
  const results = new Map();
  for (const c of CHECKS) {
    if (which && !which.includes(c.id)) continue;
    globalThis.__XU = freshWorld();
    M.chunk.resetXDocsCache();
    M.idx.resetXIndexCache();
    M.importer.resetImportStaging();
    try {
      const extra = await c.fn(M);
      results.set(c.id, { ok: true, extra });
    } catch (e) {
      results.set(c.id, { ok: false, err: e && e.message ? e.message.split("\n")[0] : String(e) });
    }
  }
  return results;
}

process.env.VALIDATOR_URL = VURL;
process.env.KEYSTORE_DIR = path.join(HERE, "keystore");
delete process.env.LAYERS_REQUIRE_SIG;
delete process.env.ZK_DEV_HOOKS;
delete process.env.LAYERS_WORLD;
// nothing ambient may make this process read as the owner service (lib/world-flag.ts isOwnerService / isHostedRig)
for (const k of ["OWNER_ACCESS_SECRET", "LAYERS_HOSTED", "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"]) delete process.env[k];
delete process.env.X_API_CLIENT_ID;
delete process.env.X_IMPORT_MAX_POSTS;
delete process.env.X_IMPORT_MAX_FOLLOWS;
delete process.env.X_IMPORT_MAX_LIKES;

let M;
try {
  M = await bundle(null);
} catch (e) {
  console.log("cannot bundle: " + (e && e.message ? e.message.split("\n").slice(0, 6).join(" | ") : String(e)));
  process.exit(2);
}
console.log("\nBYX v1 unit harness (node-only; the validator and the index sources are in-process)");
const results = await runChecks(M, ONLY.length ? ONLY : null);
let passed = 0;
let failed = 0;
for (const c of CHECKS) {
  const r = results.get(c.id);
  if (!r) continue;
  if (r.ok) passed++;
  else failed++;
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${c.name}${r.ok ? (typeof r.extra === "string" ? " — " + r.extra : "") : " — " + r.err}`);
}
console.log(`\n${passed}/${passed + failed} checks passed`);

let caught = 0;
const missed = [];
if (!ONLY.length && process.env.MUT !== "none") {
  console.log("\nMUTATION PASS — each guard broken on purpose; its named checks must go RED");
  for (const mut of MUTATIONS) {
    let MM;
    try {
      MM = await bundle(mut);
    } catch (e) {
      missed.push(mut.name);
      console.log(`  ERROR ${mut.name}: ${(e && e.message ? e.message : String(e)).split("\n")[0]}`);
      continue;
    }
    const r = await runChecks(MM, mut.expect);
    const red = mut.expect.filter((id) => r.get(id) && !r.get(id).ok);
    const ok = red.length === mut.expect.length;
    if (ok) caught++;
    else missed.push(mut.name);
    console.log(`  ${ok ? "CAUGHT" : "MISSED"} ${mut.name} (${mut.file}) → ${mut.expect.map((id) => id + (r.get(id)?.ok ? " stayed green" : " red")).join(", ")}`);
  }
  console.log(`\n${caught}/${MUTATIONS.length} mutations caught`);
}
globalThis.__XU = freshWorld();
process.exit(failed === 0 && missed.length === 0 ? 0 : 1);
