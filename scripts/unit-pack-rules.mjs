// A FILTER PACK'S POST RULES IN THE SAMPLE FEED — lib/feed.ts buildFeed IN ONE PROCESS: the real feed, the real mock
// store over the seeded world, the real rules evaluator, the real pack resolver (lib/packs/rules.ts), the real export,
// sanitizer and import preview, bundled with esbuild. Stood in for: the persist layer (an in-memory validator), React's
// `cache` (lib's two uses only), the two live-content reads (the relay's discovery read and the direct live feed, so the
// live pass runs on planted network casts), the device's content-source and Neynar switches (a node process never
// meets the browser device that sets them), and the validator's public anon list (empty). No server, no port; no request
// leaves the process.
//
// Before lib/packs/rules.ts a pack's `artifact.rules` were signed, sanitized, stored and exported, and never evaluated:
// an attached pack's post rules did nothing in either pass (U1 and U2 fail on that code: the first mutations put it back).
// The real Following runs them through the same loader list: scripts/unit-hub-read.mjs H22.
//
//   U1 SEEDED PASS: an attached pack's hide rule hides exactly what the same rule hides as the mode's own; its push-down
//      rule moves exactly what the same mode rule moves; its flag rule changes nothing; attached to one stored mode it
//      changes that mode's feed and leaves another mode's as it was; detached, the feed is what it was
//   U2 LIVE PASS: on network casts (the relay's discovery base, as on the public site, and the direct live feed) a
//      pack's text rule hides the matching casts exactly as the same mode rule does; a pack's author-tier hide rule
//      fails closed exactly as the mode's own does: no relay read and "filtered" (relay), every unattributed cast
//      hidden (direct)
//   U3 THE GUARDRAILS AGAIN, NEVER A CRASH: a stored pack rule that would pin, banner, carry an unknown action, reach a
//      protected field or cannot be walked is INERT (the feed builds, the pack's other rule still hides, nothing is
//      pinned or bannered) and inertRules names it by the pack, in its own sentence
//   U4 PREVIEW: a signed pack exported with a hide rule keeps it through the sanitizer; the mandatory preview counts the
//      posts it removes (pct exact against the window, samples among them); `hides` stays the accounts its predicates
//      filter, and a pack with both counts the union; imported and attached, the feed is what the preview said
//   M  MUTATIONS: each guard removed in the BUNDLE ONLY, and the check that covers it must then FAIL
//
//   node scripts/unit-pack-rules.mjs            (npm run test:pack-rules-unit)
//   node scripts/unit-pack-rules.mjs --only=U2
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
const MUTATIONS = process.env.PACKRULES_MUTATION ? JSON.parse(process.env.PACKRULES_MUTATION) : [];
const QUIET = process.env.PACKRULES_UNIT_QUIET === "1";
const out = (l) => (QUIET ? undefined : console.log(l));

let passed = 0;
let failed = 0;
const failedIds = [];
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
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-packrules-unit-"));
process.env.KEYSTORE_DIR = path.join(tmp, "keystore");
const S = (n) => path.join(tmp, n);
const REAL = {
  persist: path.join(ROOT, "lib", "adapters", "mock", "persist"),
  content: path.join(ROOT, "lib", "adapters", "neynar", "content"),
  mode: path.join(ROOT, "lib", "adapters", "neynar", "mode"),
  sw: path.join(ROOT, "lib", "fc", "source", "switch"),
  vclient: path.join(ROOT, "lib", "zk", "validatorClient"),
};
const stubs = {
  "server-only.ts": "export {};\n",
  "react-cache.ts": "export const cache = <T,>(f: T): T => f;\n",
  // the validator, in memory: every namespace starts empty, so the store hydrates the seeded (demo) world
  "persist.ts": `export const validatorStore = new Map<string, Record<string, unknown>>();
export const STATE_BODY_LIMIT_BYTES = 262144;
export const FLUSH_RETRY_MS = [250, 500, 1000];
export class PersistError extends Error {}
export async function fetchState(ns: string): Promise<{ status: number; ok: boolean; json: () => Promise<any> }> {
  const entries = validatorStore.get(ns);
  return { status: 200, ok: true, json: async () => ({ entries: entries ? JSON.parse(JSON.stringify(entries)) : {} }) };
}
export async function flushVault(ns: string, entries: Record<string, unknown>): Promise<void> { validatorStore.set(ns, JSON.parse(JSON.stringify(entries))); }
export async function flush(ns: string, entries: Record<string, unknown>): Promise<void> { return flushVault(ns, entries); }
export async function signedWriteHeaders(): Promise<Record<string, string>> { return {}; }
export async function signedReadHeaders(): Promise<Record<string, string>> { return {}; }
export async function deviceSignedWriteHeaders(): Promise<Record<string, string>> { return {}; }
export async function enrollWithSeed(): Promise<string> { return ""; }
export function sealedNamespaces(): Set<string> { return new Set(); }
export function markSealedName(): void {}
export function resetEnvelopeBootstrap(): void {}
export function hydratedNamespace(): undefined { return undefined; }
export function hydratedNamespaceAt(): undefined { return undefined; }
export function forgetHydratedNamespace(): void {}
export async function loadAll(): Promise<Record<string, Record<string, unknown>>> { return Object.fromEntries(validatorStore); }
export async function loadAllStrict(): Promise<Record<string, Record<string, unknown>>> { return Object.fromEntries(validatorStore); }
export async function wipeAll(): Promise<void> { validatorStore.clear(); }
`,
  // the switches the browser device sets, one control for both: the relay as For You's base, as on the public site
  "ctl.ts": `export const sourceCtl = { relay: false };
`,
  // the two live reads, planted: everything else of the module is the real one
  "content-stub.ts": `export * from ${JSON.stringify(REAL.content)};
export const liveCtl = { casts: [] as any[], relayReads: 0, liveReads: 0 };
const copy = () => JSON.parse(JSON.stringify(liveCtl.casts));
export async function relayDiscovery(): Promise<any> { liveCtl.relayReads++; return { value: copy(), stale: false, state: "live" }; }
export async function liveFeed(_fid: number, _limit = 25): Promise<any> { liveCtl.liveReads++; return { value: copy(), stale: false }; }
`,
  "mode-stub.ts": `export * from ${JSON.stringify(REAL.mode)};
import { contentSource as realContentSource } from ${JSON.stringify(REAL.mode)};
import { sourceCtl } from ${JSON.stringify(S("ctl.ts"))};
export function contentSource(): "seed" | "neynar" | "relay" { return sourceCtl.relay && realContentSource() === "seed" ? "relay" : realContentSource(); }
`,
  "switch-stub.ts": `export * from ${JSON.stringify(REAL.sw)};
import { sourceCtl } from ${JSON.stringify(S("ctl.ts"))};
export function deviceNeynarOn(surface: string): boolean { return sourceCtl.relay && surface === "forYou"; }
`,
  // the validator's public anon list, empty: without a validator the read throws, the feed's private/anon merge is
  // skipped whole (fail closed), and with it the final sort that places pushed-down posts
  "vclient-stub.ts": `export * from ${JSON.stringify(REAL.vclient)};
export async function fetchAnonCasts(_mode: unknown): Promise<any[]> { return []; }
`,
  "entry.ts": `export { buildFeed } from "@/lib/feed";
export { state, SEED_VIEWER, personaById } from "@/lib/adapters/mock/store";
export { adapters } from "@/lib/adapters/registry";
export { setLatencyInjection, setFailureRateOverride } from "@/lib/adapters/devControls";
export { setDataSourceOverride } from "@/lib/adapters/neynar/mode";
export { sourceCtl } from ${JSON.stringify(S("ctl.ts"))};
export { liveCtl } from "@/lib/adapters/neynar/content";
export { exportPack, storePack } from "@/lib/packs/service";
export { sanitizeArtifact } from "@/lib/algo/artifact";
export { previewArtifact } from "@/lib/algo/service";
`,
};
for (const [n, src] of Object.entries(stubs)) writeFileSync(S(n), src);
const STUB_FILES = new Set(["content-stub.ts", "mode-stub.ts", "switch-stub.ts", "vclient-stub.ts"].map((n) => S(n)));
const redirectPlugin = {
  name: "redirect",
  setup(b) {
    const target = (spec, resolveDir) => (spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec.startsWith(".") ? path.resolve(resolveDir, spec) : null);
    b.onResolve({ filter: /^react$/ }, (a) => (a.importer.startsWith(path.join(ROOT, "lib")) ? { path: S("react-cache.ts") } : undefined));
    b.onResolve({ filter: /(persist|content|mode|switch|validatorClient)$/ }, (a) => {
      if (STUB_FILES.has(a.importer)) return undefined;
      const t = target(a.path, a.resolveDir);
      if (t === REAL.persist) return { path: S("persist.ts") };
      if (t === REAL.content) return { path: S("content-stub.ts") };
      if (t === REAL.mode) return { path: S("mode-stub.ts") };
      if (t === REAL.sw) return { path: S("switch-stub.ts") };
      if (t === REAL.vclient) return { path: S("vclient-stub.ts") };
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
let M;
try {
  await build({
    plugins: [redirectPlugin, mutatePlugin],
    absWorkingDir: ROOT,
    entryPoints: [S("entry.ts")],
    outfile: S("bundle.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT, "tsconfig.json"),
    logLevel: "error",
    nodePaths: [path.join(ROOT, "node_modules")],
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
    alias: { "server-only": S("server-only.ts") },
  });
  M = await import(pathToFileURL(S("bundle.mjs")).href);
  if (MUTATIONS.length && applied.size !== MUTATIONS.length) throw new Error("MUTATION FILE NOT IN THE BUNDLE");
} catch (e) {
  console.log("cannot bundle the feed: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
// the rig's synthetic latency and 2% failure are the retry discipline's demonstration, not what is measured here
M.setLatencyInjection([0, 0]);
M.setFailureRateOverride(0);

// ---------------------------------------------------------------------------------------------------- helpers
const viewer = M.SEED_VIEWER.activePersonaId;
const s = M.state();
const active = await M.adapters.mode.getActive(viewer);
const posts = (r) => r.cards.filter((c) => c.kind === "post" && c.cast && !c.private).map((c) => c.cast);
const H = (r) => posts(r).map((c) => c.hash).join(",");
const feed = (o = {}) => M.buildFeed(viewer, { surface: "discovery", limit: 40, ...o });
const has = (c, w) => c.text.toLowerCase().includes(w.toLowerCase());
const clause = (field, op, value) => ({ combinator: "AND", clauses: [{ field, op, value }] });
const pr = (name, action, root) => ({ name, action, root });
const asInline = (rules) => rules.map((r, i) => ({ id: "inline_" + i, createdAt: 0, ...r }));
let packN = 0;
/** a pack as the store holds one after import (signature checked at import, not here; the feed reads the store) */
const plantPack = (name, rules, extra = {}) => {
  const id = "pack_unit_" + ++packN;
  s.filterPacks.set(id, { id, importedAt: 0, artifact: { kind: "filter_pack", schemaVersion: 1, name, summary: "", authorPersonaId: viewer, authorHandle: "unit", algoVersion: 1, ranking: active.ranking, rules, modeFlags: {}, createdAt: 0, signature: "unit", ...extra } });
  return id;
};
const baseline = await feed({ modeOverride: active });
// a word one of the top cards carries, and one a later card carries (so a push-down visibly moves it)
const wordOf = (c) => (c.text.match(/[A-Za-z]{8,}/) ?? [])[0];
const top = posts(baseline);
const HIDE_WORD = top.map(wordOf).find((w) => w && top.filter((c) => has(c, w)).length >= 1);
const DOWN_WORD = top.slice(0, 5).map(wordOf).find((w) => w && w !== HIDE_WORD && !has(top[top.length - 1], w));
if (!HIDE_WORD || !DOWN_WORD) {
  console.log("the seeded window carries no usable word: " + JSON.stringify(top.slice(0, 5).map((c) => c.text)));
  process.exit(2);
}
out(`\nPACK RULES UNIT — a filter pack's post rules in lib/feed.ts, in one process over the seeded world${MUTATIONS.length ? "  [MUTATED BUNDLE]" : ""} (words: ${HIDE_WORD}, ${DOWN_WORD})`);

// ---------------------------------------------------------------------------------------------------- U1
await check("U1", "SEEDED PASS: an attached pack's hide rule hides exactly what the same rule hides as the mode's own; its push-down rule moves exactly what the same mode rule moves; its flag rule changes nothing; attached to one stored mode it changes that mode's feed and leaves another's as it was; detached, the feed is what it was", async () => {
  const HIDE = pr("Mute " + HIDE_WORD, "hide", clause("post.text", "contains", HIDE_WORD.toUpperCase()));
  const DOWN = pr("Later " + DOWN_WORD, "downrank", clause("post.text", "contains", DOWN_WORD));
  const FLAG = pr("Mark all", "flag", clause("post.age", "gte", 0));
  const before = top.filter((c) => has(c, HIDE_WORD)).length;
  // hide
  const pHide = plantPack("Hide pack", [HIDE]);
  const viaPack = await feed({ modeOverride: { ...active, filterPackIds: [pHide] } });
  const viaMode = await feed({ modeOverride: active, inlineRules: asInline([HIDE]) });
  assert(before > 0 && posts(viaMode).filter((c) => has(c, HIDE_WORD)).length === 0, "the mode rule itself hid nothing (vacuous): " + before);
  assert(H(viaPack) === H(viaMode), "the pack's hide rule decided differently from the same mode rule: " + posts(viaPack).filter((c) => has(c, HIDE_WORD)).length + " of " + before + " still shown");
  assert((viaPack.inertRules ?? []).length === 0, "a good pack rule was said as inert: " + JSON.stringify(viaPack.inertRules));
  // push down
  const pDown = plantPack("Down pack", [DOWN]);
  const downPack = await feed({ modeOverride: { ...active, filterPackIds: [pDown] } });
  const downMode = await feed({ modeOverride: active, inlineRules: asInline([DOWN]) });
  assert(H(downMode) !== H(baseline), "the mode's push-down moved nothing (vacuous)");
  assert(H(downPack) === H(downMode), "the pack's push-down decided differently from the same mode rule");
  // flag: membership and order unchanged
  const pFlag = plantPack("Flag pack", [FLAG]);
  const flagPack = await feed({ modeOverride: { ...active, filterPackIds: [pFlag] } });
  assert(H(flagPack) === H(baseline), "a flag rule moved the feed");
  // per mode, on the STORED modes (no override): attached to one, the other is as it was; detached, back
  const modes = await M.adapters.mode.list(viewer);
  const other = modes.find((m) => m.id !== active.id);
  assert(other, "the viewer has one mode");
  const activeBefore = await feed();
  await M.adapters.mode.setActive(viewer, other.id);
  const otherBefore = await feed();
  await M.adapters.mode.setActive(viewer, active.id);
  await M.adapters.mode.update(active.id, { filterPackIds: [pHide] });
  const attached = await feed();
  await M.adapters.mode.setActive(viewer, other.id);
  const otherAfter = await feed();
  await M.adapters.mode.setActive(viewer, active.id);
  await M.adapters.mode.update(active.id, { filterPackIds: active.filterPackIds ?? [] });
  const detached = await feed();
  assert(posts(activeBefore).some((c) => has(c, HIDE_WORD)) && posts(attached).filter((c) => has(c, HIDE_WORD)).length === 0, "the stored mode with the pack still shows the muted posts");
  assert(H(otherAfter) === H(otherBefore), "attaching the pack to " + active.name + " changed " + other.name);
  assert(H(detached) === H(activeBefore), "detached, the feed is not what it was");
  return `hid ${before} posts as the mode rule does; push-down equal; flag inert; ${active.name} changed, ${other.name} not; detached = before`;
});

// ---------------------------------------------------------------------------------------------------- U2
await check("U2", "LIVE PASS: on network casts (the relay's discovery base, as on the public site, and the direct live feed) a pack's text rule hides the matching casts exactly as the same mode rule does; a pack's author-tier hide rule fails closed as the mode's own does: no relay read and 'filtered' (relay), every unattributed cast hidden (direct)", async () => {
  const tpl = top[0];
  const now = Date.now();
  const texts = ["gm frens", "AIRDROP claim now", "a thread on rollups", "airdrop season again", "coffee first", "stars tonight"];
  M.liveCtl.casts = texts.map((text, k) => ({
    ...tpl,
    hash: "0x" + (k + 1).toString(16).padStart(40, "a"),
    network: true,
    personaId: undefined,
    tier: undefined,
    text,
    timestamp: now - (k + 1) * 60_000,
    likes: 3,
    recasts: 1,
    embeds: [],
    replyingTo: undefined,
    parentHash: undefined,
    truncate: false,
    author: { ...tpl.author, fid: 900_001 + k, username: "net" + k, displayName: "Net " + k },
  }));
  const planted = new Set(M.liveCtl.casts.map((c) => c.hash));
  const net = (r) => posts(r).filter((c) => planted.has(c.hash)).map((c) => c.text).sort().join("|");
  const TEXT = pr("No airdrops", "hide", clause("post.text", "contains", "airdrop"));
  const TIER = pr("No low tiers", "hide", clause("author.tier", "lt", 3));
  const pText = plantPack("Network pack", [TEXT]);
  const pTier = plantPack("Tier pack", [TIER]);
  try {
    // (a) THE RELAY BASE (the public site's discovery)
    M.sourceCtl.relay = true;
    const rb = await feed({ modeOverride: active });
    assert(rb.liveSource.source === "relay" && rb.liveSource.state === "live" && net(rb).split("|").length === 6, "the relay base: " + JSON.stringify({ src: rb.liveSource, n: net(rb) }));
    const rPack = await feed({ modeOverride: { ...active, filterPackIds: [pText] } });
    const rMode = await feed({ modeOverride: active, inlineRules: asInline([TEXT]) });
    assert(net(rMode) === "a thread on rollups|coffee first|gm frens|stars tonight", "the mode rule on the relay base: " + net(rMode));
    assert(net(rPack) === net(rMode), "the pack's rule on the relay base: " + net(rPack));
    const reads0 = M.liveCtl.relayReads;
    const tPack = await feed({ modeOverride: { ...active, filterPackIds: [pTier] } });
    const readsPack = M.liveCtl.relayReads - reads0;
    const tMode = await feed({ modeOverride: active, inlineRules: asInline([TIER]) });
    const readsMode = M.liveCtl.relayReads - reads0 - readsPack;
    assert(readsMode === 0 && tMode.liveSource.state === "filtered" && net(tMode) === "", "the mode's author rule on the relay: " + JSON.stringify({ readsMode, src: tMode.liveSource }));
    assert(readsPack === 0 && tPack.liveSource.state === "filtered" && net(tPack) === "", "the pack's author rule on the relay: " + JSON.stringify({ readsPack, src: tPack.liveSource, n: net(tPack) }));
    M.sourceCtl.relay = false;
    // (b) THE DIRECT LIVE FEED (the rig and the owner service)
    M.setDataSourceOverride("neynar");
    const db = await feed({ modeOverride: active });
    assert(net(db).split("|").length === 6, "the direct base: " + net(db));
    const dPack = await feed({ modeOverride: { ...active, filterPackIds: [pText] } });
    const dMode = await feed({ modeOverride: active, inlineRules: asInline([TEXT]) });
    assert(net(dPack) === net(dMode) && net(dMode).split("|").length === 4, "the pack's rule on the direct feed: " + JSON.stringify({ pack: net(dPack), mode: net(dMode) }));
    const dTier = await feed({ modeOverride: { ...active, filterPackIds: [pTier] } });
    assert(net(dTier) === "", "the pack's author rule let unattributed casts through: " + net(dTier));
  } finally {
    M.sourceCtl.relay = false;
    M.setDataSourceOverride(null);
    M.liveCtl.casts = [];
  }
  return "relay: 2 of 6 hidden as the mode rule hides them, the author rule makes no read ('filtered'); direct: the same, all hidden";
});

// ---------------------------------------------------------------------------------------------------- U3
await check("U3", "THE GUARDRAILS AGAIN, NEVER A CRASH: a stored pack rule that would pin, banner, carry an unknown action, reach a protected field or cannot be walked is INERT (the feed builds, the pack's other rule still hides, nothing pinned or bannered) and inertRules names it by the pack", async () => {
  const ok = pr("Mute " + HIDE_WORD, "hide", clause("post.text", "contains", HIDE_WORD));
  const okOnly = await feed({ modeOverride: { ...active, filterPackIds: [plantPack("Good pack", [ok])] } });
  const bad = [
    ["pin", pr("Top slot", "pin", clause("post.age", "gte", 0)), /would pin or banner posts/],
    ["banner", pr("Push", "banner", clause("post.age", "gte", 0)), /would pin or banner posts/],
    ["unknown action", pr("Boost", "boost", clause("post.age", "gte", 0)), /carries an action \("boost"\) a pack may not/],
    ["protected field", pr("Who", "hide", clause("identity.rootId", "neq", "x")), /reads something a rule isn't allowed to read/],
    ["unwalkable tree", pr("Broken", "hide", { op: "and", conditions: [] }), /can't be read/],
    ["a negated broken tree", pr("Flip", "hide", { combinator: "AND", negate: true, clauses: [{ combinator: "OR" }] }), /can't be read/],
  ];
  for (const [what, rule, why] of bad) {
    const id = plantPack("Bad pack", [ok, rule]);
    let r;
    try {
      r = await feed({ modeOverride: { ...active, name: "Work", filterPackIds: [id] } });
    } catch (e) {
      throw new Error("a pack rule with " + what + " crashed the feed: " + (e && e.message));
    }
    assert(H(r) === H(okOnly) && posts(r).length > 0, "a pack rule with " + what + " changed the feed (" + posts(r).length + " posts vs " + posts(okOnly).length + ")");
    assert((r.pinnedHashes ?? []).length === 0 && (r.previewStrip ?? []).length === 0, "a pack rule with " + what + " pinned or bannered: " + JSON.stringify({ pinned: r.pinnedHashes, strip: (r.previewStrip ?? []).length }));
    const inert = r.inertRules ?? [];
    assert(inert.length === 1 && inert[0].id === "pack:" + id + ":1" && /^Pack "Bad pack" carries a rule \("/.test(inert[0].sentence) && why.test(inert[0].sentence) && /so that rule does nothing: it hides and moves no post\.$/.test(inert[0].sentence), "a pack rule with " + what + " not said: " + JSON.stringify(inert));
  }
  return bad.length + " stored pack rules outside the guardrails: the feed built, the good rule ran, each named by its pack";
});

// ---------------------------------------------------------------------------------------------------- U4
await check("U4", "PREVIEW: a signed pack exported with a hide rule keeps it through the sanitizer; the preview counts the posts it removes (pct exact against the window, samples among them); `hides` stays the accounts its predicates filter, and a pack with both counts the union; imported and attached, the feed is what the preview said", async () => {
  const author = [...M.personaById.values()].find((p) => p.handle === "footnote_feiler");
  assert(author, "no seeded author with a fixture key");
  const RULE = { name: "Mute " + HIDE_WORD, action: "hide", root: clause("post.text", "contains", HIDE_WORD) };
  const art = M.exportPack({ name: "Mute pack", summary: "", authorPersonaId: author.id, authorHandle: author.handle, rules: [RULE], attestationPredicates: [], curatorSubscriptions: [] });
  const san = M.sanitizeArtifact(art);
  assert(san.artifact && san.artifact.rules.length === 1 && san.violations.length === 0, "the sanitizer: " + JSON.stringify(san.violations));
  const current = await feed();
  const win = posts(current);
  const hit = new Set(win.filter((c) => has(c, HIDE_WORD)).map((c) => c.hash));
  const pv = await M.previewArtifact(art, viewer);
  const wantPct = win.length ? Math.round((hit.size / win.length) * 100) : 0;
  assert(hit.size > 0 && pv.total === win.length && pv.pct === wantPct && pv.hides === 0, "the rule pack's preview: " + JSON.stringify({ total: pv.total, pct: pv.pct, want: wantPct, hides: pv.hides, hit: hit.size }));
  assert(pv.samples.length === Math.min(3, hit.size) && pv.samples.every((x) => hit.has(x.hash)), "the samples: " + JSON.stringify(pv.samples.map((x) => x.hash)));
  // predicates and a rule: `hides` = the accounts, pct = the union
  const population = JSON.parse(readFileSync(path.join(ROOT, "seed", "data", "graph.json"), "utf8")).audiencePopulation;
  const holders = new Set(population.filter((e) => e.claims.includes("espresso")).map((e) => e.personaId));
  const both = M.exportPack({ name: "Both pack", summary: "", authorPersonaId: author.id, authorHandle: author.handle, rules: [RULE], attestationPredicates: [{ claim: "espresso", mode: "holding" }], curatorSubscriptions: [] });
  const pb = await M.previewArtifact(both, viewer);
  const union = win.filter((c) => hit.has(c.hash) || (c.personaId && holders.has(c.personaId))).length;
  assert(holders.size > 0 && pb.hides === holders.size && pb.pct === Math.round((union / win.length) * 100), "the union preview: " + JSON.stringify({ hides: pb.hides, holders: holders.size, pct: pb.pct, union, total: win.length }));
  // imported and attached: the activation outcome is the preview's
  const pack = M.storePack(san.artifact);
  await M.adapters.mode.update(active.id, { filterPackIds: [pack.id] });
  const after = await feed();
  await M.adapters.mode.update(active.id, { filterPackIds: active.filterPackIds ?? [] });
  assert(posts(after).every((c) => !hit.has(c.hash)), "the attached pack left posts the preview counted");
  return `${hit.size} of ${win.length} posts (${pv.pct}%), 0 accounts; with espresso holders: ${pb.hides} accounts, ${pb.pct}%`;
});

// ---------------------------------------------------------------------------------------------------- M
if (!MUTATIONS.length && ONLY.length === 0) {
  const F = "lib/feed.ts";
  const PF = "lib/packs/rules.ts";
  const AS = "lib/algo/service.ts";
  const NOT_RUN = [{ file: F, find: "  const packed = packRules(attachedPacks);\n  rules.push(...packed.run);", replace: "  const packed = packRules(attachedPacks);" }];
  const runs = [
    ["an attached pack's post rules not run in the seeded pass (the finding)", "U1", NOT_RUN],
    ["an attached pack's post rules not run in the live pass (the finding)", "U2", NOT_RUN],
    ["the fail-closed author question skips a pack's rules (strangers through, the relay read)", "U2", [{ file: F, find: '  const authorHideRuleExists = rules.some((r) => r.action === "hide" && !isDeliveryRule(r) && referencesAuthor(r.root));', replace: '  const authorHideRuleExists = rules.some((r) => r.action === "hide" && !isDeliveryRule(r) && !r.id.startsWith("pack:") && referencesAuthor(r.root));' }]],
    ["a pack's inert rules left unsaid", "U3", [{ file: F, find: "  const inertRules: InertRule[] = [...owned.inert, ...packed.inert];", replace: "  const inertRules: InertRule[] = [...owned.inert];" }]],
    ["a pack rule may pin or banner", "U3", [{ file: PF, find: 'new Set(["hide", "downrank", "flag"])', replace: 'new Set(["hide", "downrank", "flag", "pin", "banner"])' }, { file: PF, find: '  if (r.action === "pin" || r.action === "banner") return "would pin or banner posts, which only your own delivery settings may do";\n', replace: "" }]],
    ["a pack rule reaching a protected field runs", "U3", [{ file: PF, find: '  if (problem === "field") return "reads something a rule isn\'t allowed to read";\n', replace: "" }]],
    ["a pack rule the evaluator cannot walk handed to it (unsaid)", "U3", [{ file: PF, find: '  if (problem === "shape") return "can\'t be read";\n', replace: "" }]],
    ["the preview ignores the pack's post rules (it says 0% and the pack then hides posts)", "U4", [{ file: AS, find: "    if (postRules.length) {\n      const candidate", replace: "    if (false) {\n      const candidate" }]],
  ];
  await check("M", "MUTATIONS: each guard removed in the bundle only — the check that covers it FAILS (" + runs.length + " mutations)", async () => {
    const survived = [];
    for (const [label, target, muts] of runs) {
      const r = spawnSync(process.execPath, [SELF, "--only=" + target], {
        cwd: ROOT,
        env: { ...process.env, PACKRULES_MUTATION: JSON.stringify(muts), PACKRULES_UNIT_QUIET: "1", KEYSTORE_DIR: "" },
        encoding: "utf8",
        timeout: 300_000,
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

rmSync(tmp, { recursive: true, force: true });
const summary = `${passed}/${passed + failed} pack-rules unit checks passed` + (failed ? ` — FAILED: ${failedIds.join(",")}` : "");
console.log((QUIET ? "" : "\n") + summary);
process.exit(failed ? 1 : 0);
