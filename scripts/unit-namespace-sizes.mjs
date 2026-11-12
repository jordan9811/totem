// PERSONA LAUNCH P2 (BYX G1) — THE NAMESPACE SIZE AUDIT (node-only).
//
// The validator now refuses a state PUT over 256 KiB (validator/limits.js) and the persist client refuses to send one
// (lib/adapters/mock/persist.ts PersistError). This audit makes sure no ordinary namespace is anywhere near that line:
// it hydrates the REAL store (lib/adapters/mock/store.ts) from the demo seed — every hydrate seeder runs, as on the rig —
// against an in-memory validator, then seals every SERIALIZERS namespace exactly as persistNs would send it (sealWhole,
// or encryptNamespace for a vault namespace) and asserts each body is under 256 KiB with at least 25% headroom. It also
// checks every PUT the seeders actually sent during hydrate.
//
// Non-vacuous: every namespace in persist.ts's Namespace union must appear in the table (and nothing else), and at
// least 80 records must have been measured — an empty store would pass any size check.
//
//   node scripts/unit-namespace-sizes.mjs     prints the table; exit 0 = every namespace fits with headroom
//
// PERSONA LAUNCH P2 (review W1-R4) — TOGGLE-BACK, on the same real store: a like then an unlike in quick succession
// (S0 → S1 sent, still in flight → S0 again) must leave the validator at S0. persistNs used to compare the second dump
// with the last LANDED body (S0), skip it, and let S1 land after. The check asserts the window is real (the first PUT
// had not landed when the second persist ran) and then runs itself once more in a child process on a store bundled
// WITHOUT the in-flight comparison (NS_TOGGLE_MUT=1), which must turn it red. MUT=none skips that child.
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = mkdtempSync(path.join(os.tmpdir(), "layers-ns-sizes-"));
process.on("exit", () => rmSync(HERE, { recursive: true, force: true }));
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
const ROOT_N = ROOT.split(path.sep).join("/");

const LIMIT = 262144;
const HEADROOM = 0.25;
const MIN_ROWS = 80;

// ------------------------------------------------------------------------------------------------ the in-memory validator
const VURL = "http://validator.ns-sizes";
const vstate = new Map();
const puts = [];
const json = (status, obj) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => obj, text: async () => JSON.stringify(obj) });
globalThis.fetch = async (u, init = {}) => {
  const url = String(u);
  const method = (init.method || "GET").toUpperCase();
  if (!url.startsWith(VURL)) throw new Error("ns-sizes: a request left the harness: " + url);
  const p = url.slice(VURL.length);
  if (p === "/state" && method === "GET") return json(200, { state: Object.fromEntries(vstate) });
  if (p === "/state" && method === "DELETE") {
    vstate.clear();
    return json(200, { ok: true });
  }
  if (p.startsWith("/state/")) {
    const ns = decodeURIComponent(p.slice(7));
    if (method === "GET") return json(200, { entries: vstate.get(ns) ?? {} });
    if (method === "PUT") {
      const body = String(init.body ?? "");
      const bytes = new TextEncoder().encode(body).length;
      puts.push({ ns, bytes });
      if (bytes > LIMIT) return json(413, { error: "body too large", limit: LIMIT, namespace: ns });
      vstate.set(ns, JSON.parse(body).entries);
      return json(200, { ok: true });
    }
  }
  // the seeders' other validator calls (stakes, zk, rep) — answered empty; a seeder that needs more is best-effort
  if (method === "GET") return json(200, {});
  return json(200, { ok: true });
};

// ------------------------------------------------------------------------------------------------ mocks + bundle
const MOCKDIR = path.join(HERE, "mocks");
mkdirSync(MOCKDIR, { recursive: true });
const MOCKS = {
  "server-only": `export {};`,
  "next/headers": `export function cookies() { return { get: () => undefined, set() {}, delete() {}, getAll: () => [] }; } export function headers() { return new Headers(); }`,
  "next/server": `export class NextResponse { static json(o, i = {}) { return { status: i.status ?? 200, json: async () => o }; } } export class NextRequest {}`,
  // the data layer's only React is cache() (server-component memoisation) — the device bundle's shim, the same idea
  react: `export function cache(fn) { return fn; } export default { cache };`,
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
  [
    `export * as store from "@/lib/adapters/mock/store";`,
    `export * as vault from "@/lib/vault/vault";`,
    // the hydrate seeders, called one by one after hydrate so a seeder that fails is NAMED (hydrate runs them in one
    // best-effort block, where the first failure silently skips the rest)
    `export { seedGrantGraph } from "@/lib/identity/seedGrants";`,
    `export { seedPrivateWorld } from "@/lib/private/seed";`,
    `export { backfillSeededFollows } from "@/lib/eventlog/log";`,
    `export { seedAlgoMarketplace } from "@/lib/algo/seed";`,
    `export { seedCuratorFeeds } from "@/lib/curators/annotations";`,
    `export { seedIssuanceDraft } from "@/lib/curators/issuance";`,
    `export { seedRefutations } from "@/lib/refutation/edges";`,
    `export { seedFilterPack } from "@/lib/packs/service";`,
    `export { seedDestinationBindings } from "@/lib/crosspost/destinations";`,
    `export { seedInfoFi } from "@/lib/market/infofi";`,
    `export { seedLenses } from "@/lib/lens/service";`,
    `export { adapters } from "@/lib/adapters/registry";`,
  ].join("\n") + "\n"
);
// W1-R4's mutation (the child run): persistNs's dirty check WITHOUT the in-flight comparison — the pre-fix store
const TOGGLE_MUT = process.env.NS_TOGGLE_MUT === "1";
const TOGGLE_ANCHOR = `  if (pending) {
    if (pending.serialized === serialized) return pending.done; // the body already on its way is this one
  } else if (lastFlushed.get(ns) === serialized) return; // nothing changed — checked on PLAINTEXT`;
const plugin = {
  name: "ns-sizes-mocks",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => (mockFile[args.path] ? { path: mockFile[args.path] } : undefined));
    if (TOGGLE_MUT)
      b.onLoad({ filter: /lib[\\/]adapters[\\/]mock[\\/]store\.ts$/ }, (args) => {
        const src = readFileSync(args.path, "utf8").replace(/\r\n/g, "\n");
        if (!src.includes(TOGGLE_ANCHOR)) throw new Error("NS_TOGGLE_MUT: the anchor is gone from store.ts");
        return { contents: src.replace(TOGGLE_ANCHOR, "  void pending;\n  if (lastFlushed.get(ns) === serialized) return; // MUTATED: the pre-fix dirty check"), loader: "ts" };
      });
  },
};
process.env.VALIDATOR_URL = VURL;
process.env.KEYSTORE_DIR = path.join(HERE, "keystore"); // a FRESH device keystore, never the rig's
process.env.ZK_DEV_HOOKS = "true"; // the rig's demo world, seeders and all
process.env.NODE_ENV = "test";
delete process.env.LAYERS_REQUIRE_SIG;
delete process.env.LAYERS_WORLD;
delete process.env.DATA_SOURCE;

const OUT = path.join(HERE, "bundle.mjs");
try {
  await build({
    absWorkingDir: ROOT_N,
    entryPoints: [ENTRY],
    outfile: OUT,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT_N, "tsconfig.json"),
    plugins: [plugin],
    loader: { ".json": "json" },
    logLevel: "error",
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  });
} catch (e) {
  console.log("cannot bundle: " + (e && e.message ? e.message.split("\n").slice(0, 8).join(" | ") : String(e)));
  process.exit(2);
}
const B = await import(pathToFileURL(OUT).href);
const { store, vault } = B;

await store.hydrate();

/** W1-R4 TOGGLE-BACK: S0 landed → S1 persisted (not awaited) → S0 persisted → what does the validator hold? */
async function toggleBack() {
  const s = store.state();
  const H = "0xtoggle" + Date.now().toString(16);
  await store.persistNs("likes"); // the baseline S0 has landed (or already had)
  s.likes.add(H);
  const putsBefore = puts.length;
  const p1 = store.persistNs("likes"); // S1: queued, not landed
  s.likes.delete(H);
  const window = puts.length === putsBefore; // the first PUT has not even been sent: the race window is real
  const p2 = store.persistNs("likes"); // S0 again
  await Promise.all([p1, p2]);
  const stored = vault.unsealAny("likes", vstate.get("likes"));
  return { window, stale: !!stored && Object.prototype.hasOwnProperty.call(stored, H), opened: !!stored };
}
if (TOGGLE_MUT) {
  const r = await toggleBack();
  console.log("TOGGLE " + JSON.stringify(r));
  process.exit(0);
}
const seeded = [];
for (const name of ["seedGrantGraph", "seedPrivateWorld", "backfillSeededFollows", "seedAlgoMarketplace", "seedCuratorFeeds", "seedIssuanceDraft", "seedRefutations", "seedFilterPack", "seedDestinationBindings", "seedInfoFi", "seedLenses"]) {
  try {
    await (name === "backfillSeededFollows" ? B[name](store.SEED_VIEWER.activePersonaId) : B[name]());
    seeded.push(name);
  } catch (e) {
    console.log(`  note: seeder ${name} failed in this harness: ${(e && e.message ? e.message : String(e)).split("\n")[0].slice(0, 160)}`);
  }
}
// a device in ordinary use: every seeded persona opens its modes and rules (the presets seed lazily, through the
// adapters persistNs path — the PUTs below are the real ones), so the audit measures more than the bare seed
const retry = async (fn) => {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 5) throw e;
    }
  }
};
let opened = 0;
for (const pid of store.SEED_VIEWER.personas) {
  try {
    await retry(() => B.adapters.mode.list(pid));
    await retry(() => B.adapters.mode.getActive(pid));
    await retry(() => B.adapters.rules.list(pid));
    opened++;
  } catch (e) {
    console.log("  note: opening the modes of " + pid + " failed: " + String(e && e.message).slice(0, 120));
  }
}
const dumps = store.auditNamespaceDumps();

// ------------------------------------------------------------------------------------------------ the expected set
const persistSrc = readFileSync(path.join(ROOT, "lib", "adapters", "mock", "persist.ts"), "utf8");
const union = /export type Namespace =([\s\S]*?);\n/.exec(persistSrc.replace(/\r\n/g, "\n"));
const expected = new Set([...(union ? union[1] : "").matchAll(/"([A-Za-z0-9]+)"/g)].map((m) => m[1]));

const rows = [];
let records = 0;
let failures = 0;
for (const [ns, { payload, vault: isVault }] of Object.entries(dumps)) {
  const sealed = isVault ? vault.encryptNamespace(ns, payload) : vault.sealWhole(ns, payload);
  const bytes = new TextEncoder().encode(JSON.stringify({ entries: sealed })).length;
  const n = Object.keys(payload).filter((k) => k !== "__seq").length;
  records += n;
  const headroom = 1 - bytes / LIMIT;
  const ok = headroom >= HEADROOM;
  if (!ok) failures++;
  rows.push({ ns, n, bytes, headroom, ok, isVault });
}
rows.sort((a, b) => b.bytes - a.bytes);
console.log("\nNamespace size audit — every SERIALIZERS namespace sealed as persistNs sends it (limit 256 KiB, headroom ≥ 25%)\n");
console.log("  " + "namespace".padEnd(24) + "records".padStart(9) + "bytes".padStart(10) + "headroom".padStart(10) + "  sealed as");
for (const r of rows) console.log(`  ${r.ok ? " " : "!"}${r.ns.padEnd(23)}${String(r.n).padStart(9)}${String(r.bytes).padStart(10)}${(Math.round(r.headroom * 1000) / 10 + "%").padStart(10)}  ${r.isVault ? "per record" : "whole"}`);

const missing = [...expected].filter((ns) => !(ns in dumps));
const extra = Object.keys(dumps).filter((ns) => !expected.has(ns));
const bigPut = puts.filter((p) => p.bytes > LIMIT * (1 - HEADROOM));
console.log(`\n  ${rows.length} namespaces measured (${expected.size} in persist.ts's Namespace union), ${records} records`);
console.log(`  personas whose modes and rules were opened: ${opened}/${store.SEED_VIEWER.personas.length}`);
console.log(`  seeders run: ${seeded.length}/11 (${seeded.join(", ")})`);
console.log(`  ${puts.length} PUTs sent by hydrate's seeders, largest ${puts.length ? Math.max(...puts.map((p) => p.bytes)) : 0} B`);

let bad = 0;
const fail = (m) => {
  bad++;
  console.log("  FAIL  " + m);
};
if (expected.size < 60) fail(`the Namespace union parsed to only ${expected.size} names — the audit cannot tell what it should measure`);
if (missing.length) fail("namespaces in the union but not measured: " + missing.join(", "));
if (extra.length) fail("namespaces measured but not in the union: " + extra.join(", "));
if (records < MIN_ROWS) fail(`only ${records} records measured (< ${MIN_ROWS}): the seed did not load, the audit would be vacuous`);
if (failures) fail(`${failures} namespace(s) without 25% headroom under the 256 KiB limit`);
if (bigPut.length) fail("seeder PUTs without headroom: " + bigPut.map((p) => `${p.ns} ${p.bytes} B`).join(", "));
// the checker itself can go red: a namespace of 2,000 × 100-character records (what an X follow list in a store
// namespace would have been) sealed the same way must be flagged
const probe = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => ["k" + i, "v".repeat(100)]));
const probeBytes = new TextEncoder().encode(JSON.stringify({ entries: vault.sealWhole("probe", probe) })).length;
if (1 - probeBytes / LIMIT >= HEADROOM) fail(`the checker did not flag a ${probeBytes}-byte namespace`);
else console.log(`  self-test: a ${probeBytes}-byte probe namespace is flagged (the check can fail)`);

// W1-R4 TOGGLE-BACK, then its mutation in a child process
const tb = await toggleBack();
if (!tb.opened) fail("toggle-back: the stored likes namespace could not be opened");
else if (!tb.window) fail("toggle-back: the first PUT landed before the second persist ran — the race window was not exercised (vacuous)");
else if (tb.stale) fail("toggle-back: the validator kept the LIKED body after the unlike (the second persist was skipped as 'unchanged')");
else console.log("  toggle-back: S0 → S1 (in flight) → S0 leaves the validator at S0 (review W1-R4)");
if (process.env.MUT !== "none") {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, NS_TOGGLE_MUT: "1" }, encoding: "utf8", timeout: 600_000 });
  const line = /TOGGLE (\{.*\})/.exec(child.stdout ?? "");
  const m = line ? JSON.parse(line[1]) : null;
  if (!m) fail("toggle-back mutation: the child run said nothing (" + String(child.stderr ?? child.error ?? "").split("\n")[0].slice(0, 160) + ")");
  else if (!m.window || !m.stale) fail("toggle-back mutation MISSED: without the in-flight comparison the check stayed green " + JSON.stringify(m));
  else console.log("  toggle-back mutation: CAUGHT (the pre-fix dirty check leaves the validator liked)");
}
console.log(bad === 0 ? `\nPASS: ${rows.length}/${rows.length} namespaces under 256 KiB with ≥ 25% headroom (${records} records measured)` : `\n${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);
