// PERSONA LAUNCH P5 (reach tiers + the For You boost) and the wave-2 PROOF-PATH SEAMS the reach track landed (the P4 ring
// note, the P6 launch request) — node-only unit harness. No servers on pinned ports, no network: the client modules are
// bundled with esbuild (the repo's devDependency, the @/ paths from tsconfig.json) with their stateful neighbours
// replaced by in-memory mocks; the validator's own functions are required straight from validator/zk.js, and its
// mutation scenarios run an in-process app on an EPHEMERAL port (createApp(":memory:"), like node --test does).
//
//   node scripts/unit-reach.mjs                      (npm run test:reach-unit once the verify agent adds the script)
//   REACH_SCOPE_MUT=tree node scripts/unit-reach.mjs  (runs S1 against a build that PUTS THE TREE IN THE SCOPE: it must go red)
//
// What it proves, in order (most guards also have a MUTATION (three do not yet: see SECURITY-POSTURE's reach section) — a deliberately broken copy of the module, built in a temp
// directory, never the repo file — whose named check MUST go red, so no check here can pass vacuously):
//   T  THE OFFER (lib/reach/trees.ts): nested buckets, the default is the highest OFFERED bucket, the floor at 49/50 on
//      the census SIZE (never clearsFloor), un-honoured / unaccepted issuers never offered, the plain-words reason, the
//      refusal codes; a 100k account holding all three defaults to gte-100k at 50 members and to gte-10k at 49
//   G  THE COMPOSE GATE (lib/zk/gate.ts requestAnonPost): an unknown, un-held, un-honoured, unaccepted or under-floor
//      tree is refused BEFORE the ring note is read, the secret minted or anything written — `force` included; the
//      chosen tree is the wanted claim's and the tick proves it from that tree's own snapshot
//   N  THE RING NOTE SEAM (P4): an unreadable or wrong-size note refuses before the mint; the claim binds sha256 over the
//      RAW 256 bytes; the envelope's payload is exactly {text, nonce, note}
//   L  THE LAUNCH REQUEST SEAM (P6): requestLaunchProof validates and fetches nothing; the tick proves persona-launch as
//      'anon' over the plain tree with payload {request}; one launch per window (the next one waits for the next window)
//   P  THE PROVER (real lib/zk/prove.ts): the anon tree allowlist; the cohort floor AND the reach floor at prove time
//      (an owner service at ZK_ANON_FLOOR=1 still never proves into a reach tier of 2); the note hash required and bound;
//      persona-launch's rules; message and scope parity with validator/zk.js for both kinds
//   S  THE SCOPE EXCLUDES THE TREE: one slot under two trees is ONE scope (client and validator); REACH_SCOPE_MUT=tree
//   B  THE BUDGET: anon posts into two reach trees + a launch request in one epoch all reserve; a persona's third distinct
//      non-anon partition is still refused
//   Z  THE SIZE: the worst-case anon post (320 escaped characters + a 512-hex note + a live-shaped proof) and the worst-case
//      launch request fit the constant 4096-byte body through lib/zk/anon/submit.ts paddedBody; an oversize one is null
//   F  THE BOOST (lib/reach/boost.ts): the label rule (honoured by key, the floor, the census agreeing) — a row forged with
//      tree_size 49 shows neither label nor boost; the order is deterministic (shuffled input, same order), discovery only,
//      BELOW demote / pin / quiet, ties on the cast hash
//   I  THE ISSUERS: fid facts (the cohort spread: exactly 49 in gte-100k), fc.reach (nested buckets, the 0.7 score entry,
//      the root's own main account only, one account per root), x.reach (fixture only); the held cache; the resets
//   V  THE VALIDATOR, mutated: the reach floor removed, and the tree put in the scope — each turns its check red
//   R  THE PICKER renders only the offered tiers (never one under the floor), a reason alone, or nothing
//   K  THE TICK PUBLISHES ONCE (PUBLIC GO-LIVE, final verify; the real lib/zk/prefetch.ts): a reader landing mid-tick meets
//      the previous tick's complete snapshot, never a new-epoch one with no plain size (which offered no reach tier)
import { createRequire } from "node:module";
import Module from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = mkdtempSync(path.join(os.tmpdir(), "layers-reach-unit-"));
process.on("exit", () => rmSync(HERE, { recursive: true, force: true }));
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
for (const k of ["ZK_ANON_POST_SLOTS", "ZK_ANON_POST_WINDOW_EPOCHS", "ZK_ANON_POST_TREE", "ZK_GATE_TIER", "ZK_ANON_FLOOR", "ZK_REACH_FLOOR", "ZK_ANON_REACH_ISSUERS", "ZK_PROOF_BUDGET", "LAYERS_WORLD", "ATTEST_FID_SOURCE"]) delete process.env[k];
const SCOPE_MUT = process.env.REACH_SCOPE_MUT === "tree";

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
    // wave 3: a broken copy that does not even BUILD proves nothing about the check
    assert(!/^Build failed/.test(String(threw.message ?? "")), "the mutated copy did not build — " + String(threw.message).slice(0, 200));
    return String(threw.message ?? threw).slice(0, 120);
  });
}

// ------------------------------------------------------------------------------------------------ the bundler
let bundleSeq = 0;
/** bundle `entrySrc` with `mocks` (specifier or repo path without extension → module source) and `patches` (repo file →
 *  [[from, to], …] applied to a COPY in the temp dir; relative imports in the copy are rewritten to their @/ form) */
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
    patched[file.replace(/\.(ts|tsx)$/, "")] = f;
  }
  const plugin = {
    name: "reach-unit-mocks",
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
  // nodePaths (wave 3): a PATCHED copy lives in the temp dir — its bare imports resolve from the repo's node_modules
  await build({ absWorkingDir: ROOT, entryPoints: [entry], outfile: out, bundle: true, format: "esm", platform: "node", target: ["node20"], tsconfig: path.join(ROOT, "tsconfig.json"), plugins: [plugin], nodePaths: [path.join(ROOT, "node_modules")], loader: { ".json": "json" }, logLevel: "error", ...buildOpts });
  return import(pathToFileURL(out).href);
}
/** import a bundle with some environment set at its module load (config is read once, at import) */
async function bundleWithEnv(vars, ...args) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return await bundle(...args);
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

// the validator's own functions (CJS, required as-is)
process.env.ZK_DEV_HOOKS = "true";
const vz = require(path.join(ROOT, "validator", "zk.js"));
delete process.env.ZK_DEV_HOOKS;

const TEN = "attest:fc.reach/gte-10k";
const HUNDRED = "attest:fc.reach/gte-100k";
const ONE = "attest:fc.reach/gte-1k";
const XTEN = "attest:x.reach/gte-10k";
const PLAIN = "tier-2";
const hex = (n) => randomBytes(n).toString("hex");
const sha = (s) => createHash("sha256").update(s).digest("hex");

// ================================================================================================ T — the offer
const TREES_ENTRY = `export * as trees from "@/lib/reach/trees";\n`;
const TR = await bundle(TREES_ENTRY);
const census = (sizes) => Object.entries(sizes).map(([tree, size]) => ({ tree, size }));
function offerScenario(Tx) {
  const t = Tx.trees;
  // nested buckets by followers
  assert(JSON.stringify(t.reachBucketsFor(150_000)) === JSON.stringify(["gte-1k", "gte-10k", "gte-100k"]), "a 150k account is not issued all three: " + JSON.stringify(t.reachBucketsFor(150_000)));
  assert(JSON.stringify(t.reachBucketsFor(25_000)) === JSON.stringify(["gte-1k", "gte-10k"]), "a 25k account");
  assert(t.reachBucketsFor(999).length === 0 && t.reachBucketsFor(null).length === 0 && t.reachBucketsFor(NaN).length === 0, "below 1k or unknown supports a bucket");
  assert(t.reachBucketsFor(1000).length === 1 && t.reachBucketsFor(100_000).length === 3, "the thresholds are inclusive");
  // a 100k account holding all three: the default follows the floor on the 100k+ census
  const held = [ONE, TEN, HUNDRED];
  // PERSONA LAUNCH wave 3 (L3): every census here is BAND-consistent (the plain tree 251, gte-1k 181, gte-10k 121): each
  // tier leaves at least the floor in the band below it, so the floor alone decides these cases
  const base = { held, floor: 50, plainTree: PLAIN, issuers: ["fc.reach", "x.reach"], plainSize: 251 };
  const at50 = t.offeredAnonTrees({ ...base, census: census({ [ONE]: 181, [TEN]: 121, [HUNDRED]: 50 }) });
  assert(at50.defaultTree === HUNDRED, "with 50 in gte-100k the default is not gte-100k: " + at50.defaultTree);
  assert(JSON.stringify(at50.offered.map((o) => o.tree)) === JSON.stringify([HUNDRED, TEN, ONE]), "offered order: " + JSON.stringify(at50.offered.map((o) => o.tree)));
  assert(at50.reason === null, "a reason when nothing is held back: " + at50.reason);
  const at49 = t.offeredAnonTrees({ ...base, census: census({ [ONE]: 181, [TEN]: 120, [HUNDRED]: 49 }) });
  assert(at49.defaultTree === TEN, "with 49 in gte-100k the default is not gte-10k: " + at49.defaultTree);
  assert(!at49.offered.some((o) => o.tree === HUNDRED), "a 49-member tier was OFFERED");
  assert(at49.reason === "Not enough accounts are in the 100k+ tier yet, so your posts are boosted as 10k+.", "the reason: " + at49.reason);
  // the validator's clearsFloor boolean is never read: a census entry that says clearsFloor:true at 49 is still not offered
  const lying = t.offeredAnonTrees({ ...base, census: [{ tree: HUNDRED, size: 49, clearsFloor: true }, { tree: TEN, size: 120, clearsFloor: false }] });
  assert(!lying.offered.some((o) => o.tree === HUNDRED) && lying.offered.some((o) => o.tree === TEN), "the offer followed clearsFloor, not the size: " + JSON.stringify(lying.offered));
  // nothing held at all is offered; a held tier the census does not list is not offered
  assert(t.offeredAnonTrees({ ...base, held: [], census: census({ [TEN]: 120 }) }).offered.length === 0, "an un-held tier was offered");
  assert(t.offeredAnonTrees({ ...base, held: [TEN], census: census({}) }).offered.length === 0, "a tier missing from the census was offered");
  // everything under the floor: plain tree, "not boosted"
  const none = t.offeredAnonTrees({ ...base, held: [ONE], census: census({ [ONE]: 3 }) });
  assert(none.defaultTree === PLAIN && none.reason === "Not enough accounts are in the 1k+ tier yet, so your posts are not boosted.", JSON.stringify(none));
  // issuers: an issuer the client does not honour or the validator does not accept is never offered
  assert(t.offeredAnonTrees({ ...base, issuers: ["x.reach"], census: census({ [TEN]: 120 }) }).offered.length === 0, "an unaccepted issuer was offered");
  assert(t.offeredAnonTrees({ ...base, issuers: [], census: census({ [TEN]: 120 }) }).offered.length === 0, "an empty issuer list offered a tier");
  // x.reach sits below fc.reach in a tie; a lookalike issuer's tree is never a reach tree
  const both = t.offeredAnonTrees({ ...base, held: [XTEN, TEN], census: census({ [XTEN]: 60, [TEN]: 60 }) });
  assert(both.defaultTree === TEN && both.offered[1].tree === XTEN && both.offered[1].label === "10k+ followers on X", JSON.stringify(both.offered));
  assert(t.parseReachTree("attest:onchain.foo/gte-10k") === null && t.parseReachTree("attest:fc.reach/gte-5k") === null && t.parseReachTree(TEN).rank === 2, "parseReachTree");
  // no census yet (no tick): nothing offered, and it says so
  const early = t.offeredAnonTrees({ ...base, census: null });
  assert(early.offered.length === 0 && early.defaultTree === PLAIN && /next sync/.test(early.reason), JSON.stringify(early));
  // the refusal codes and words
  const inp = { ...base, census: census({ [ONE]: 181, [TEN]: 120, [HUNDRED]: 49 }) };
  assert(t.reachRefusal(PLAIN, inp) === null && t.reachRefusal(TEN, inp) === null, "an offered tree was refused");
  assert(t.reachRefusal("attest:onchain.foo/x", inp).code === "bad-tree", "an unknown tree is not bad-tree");
  assert(t.reachRefusal(HUNDRED, inp).code === "reach" && /Not enough accounts are in the 100k\+ tier/.test(t.reachRefusal(HUNDRED, inp).reason), "an under-floor tree: " + JSON.stringify(t.reachRefusal(HUNDRED, inp)));
  assert(/isn't in the 1k\+ followers tier/.test(t.reachRefusal(ONE, { ...inp, held: [TEN] }).reason), "an un-held tree's words");
  assert(/isn't available here/.test(t.reachRefusal(TEN, { ...inp, issuers: ["x.reach"] }).reason), "an unaccepted issuer's words");
  assert(t.reachLabel("fc.reach", "gte-10k") === "posted by an account with 10k+ followers", "the label words");
  return `default ${at50.defaultTree.slice(-8)} at 50, ${at49.defaultTree.slice(-7)} at 49`;
}
console.log("\nT — the offer (lib/reach/trees.ts)");
await check("T1 nested buckets; a 100k account holding all three defaults to gte-100k at 50 members and to gte-10k at 49 (with the plain words); the floor is on the census SIZE, never clearsFloor; un-held, unlisted, unhonoured, unaccepted and lookalike trees are never offered; no census, no offer; the refusal codes", () => offerScenario(TR));
await mutation("T1 / the floor compared one below (a 49-member tier offered)", async () => offerScenario(await bundle(TREES_ENTRY, {}, { "lib/reach/trees.ts": [["n === undefined || n < 0 || n < floor) {", "n === undefined || n < 0 || n < floor - 1) {"]] })));

/**
 * PERSONA LAUNCH wave 3 (L3) — THE BAND RULE. The default is the highest tier offered, so a post at a lower tier comes
 * from that tier's BAND (its members who hold nothing offered above it). 55 in gte-1k with 52 of them in gte-10k: both
 * trees clear the floor of 50, yet a gte-1k post would come from one of THREE accounts. So gte-10k is not offered (nor
 * the default) while that band is under the floor; the same rule holds between the plain tree and the reach tiers.
 */
function bandScenario(Tx) {
  const t = Tx.trees;
  const base = { floor: 50, plainTree: PLAIN, issuers: ["fc.reach", "x.reach"] };
  // THE FINDING'S CENSUS: 55 / 52 under a plain tree of 200 — gte-10k is NOT offered, the default is gte-1k
  const f = t.offeredAnonTrees({ ...base, held: [ONE, TEN], plainSize: 200, census: census({ [ONE]: 55, [TEN]: 52 }) });
  assert(f.defaultTree === ONE && JSON.stringify(f.offered.map((o) => o.tree)) === JSON.stringify([ONE]), "with 55 / 52 the 10k+ tier is offered (or the default): " + JSON.stringify({ def: f.defaultTree, offered: f.offered.map((o) => o.tree) }));
  assert(/isn't offered yet: too few accounts are in the tier below it alone/.test(f.reason ?? "") && /boosted as 1k\+/.test(f.reason ?? ""), "the plain-words reason for a band: " + f.reason);
  const why = t.reachRefusal(TEN, { ...base, held: [ONE, TEN], plainSize: 200, census: census({ [ONE]: 55, [TEN]: 52 }) });
  assert(why && why.code === "reach" && /isn't offered yet/.test(why.reason), "a post forced into the band-breaking tier is not refused: " + JSON.stringify(why));
  // the population-level chain says why, for every tier (held or not)
  const chain = t.offerableChain({ floor: 50, plainSize: 200, census: census({ [ONE]: 55, [TEN]: 52, [HUNDRED]: 0 }) });
  assert(chain.get(ONE) === null && chain.get(TEN) === "band" && chain.get(HUNDRED) === "floor", "the chain: " + JSON.stringify([...chain]));
  // CONTROL — the same tiers once the band holds: 110 / 52 offers both, default gte-10k
  const ok = t.offeredAnonTrees({ ...base, held: [ONE, TEN], plainSize: 200, census: census({ [ONE]: 110, [TEN]: 52 }) });
  assert(ok.defaultTree === TEN && ok.offered.length === 2 && ok.reason === null, "a band of 58 still withheld the 10k+ tier: " + JSON.stringify(ok));
  // the PLAIN tree is the bottom rung: 60 roots, 55 in gte-1k — a plain post would come from five; nothing is offered
  const p = t.offeredAnonTrees({ ...base, held: [ONE], plainSize: 60, census: census({ [ONE]: 55 }) });
  assert(p.offered.length === 0 && p.defaultTree === PLAIN, "gte-1k offered while the plain tree's band is 5: " + JSON.stringify(p));
  // a SKIPPED tier: the next is compared with the last OFFERED one (gte-100k against gte-1k when gte-10k is skipped)
  // (gte-10k at 160 leaves a band of 40 → skipped; gte-100k at 120 is judged against gte-1k's 200 — a band of 80 — not
  // against the skipped 160, which would leave 40)
  const skip = t.offerableChain({ floor: 50, plainSize: 400, census: census({ [ONE]: 200, [TEN]: 160, [HUNDRED]: 120 }) });
  assert(skip.get(ONE) === null && skip.get(TEN) === "band" && skip.get(HUNDRED) === null, "a skipped tier broke the chain: " + JSON.stringify([...skip]));
  // per ISSUER: x.reach's chain is its own
  const x = t.offerableChain({ floor: 50, plainSize: 200, census: census({ [ONE]: 55, [TEN]: 52, "attest:x.reach/gte-1k": 120, [XTEN]: 60 }) });
  assert(x.get(TEN) === "band" && x.get(XTEN) === null, "the issuers' chains are mixed: " + JSON.stringify([...x]));
  // no plain size on the tick: nothing offered (never judged without the bottom rung)
  const blind = t.offeredAnonTrees({ ...base, held: [ONE, TEN], census: census({ [ONE]: 200, [TEN]: 100 }) });
  assert(blind.offered.length === 0 && /next sync/.test(blind.reason ?? ""), "offered without the plain tree's size: " + JSON.stringify(blind));
  return "55/52 → gte-1k only (default gte-1k); 110/52 → both; the plain tree's band; a skipped tier; per issuer; no plain size → nothing";
}
await check("T2 L3 THE BAND RULE: a 55 / 52 census (both over the floor) offers gte-1k only — gte-10k is neither offered nor the default, and a post forced into it is refused in plain words; with a band of 58 both are offered; the plain tree's band counts; a skipped tier is skipped; per issuer; no plain size on the tick offers nothing", () => bandScenario(TR));
await mutation("T2 / the band check dropped from the chain (only the floor left)", async () => bandScenario(await bundle(TREES_ENTRY, {}, { "lib/reach/trees.ts": [["      if (below - n < floor) {", "      if (false) {"]] })));
await mutation("T2 / a skipped tier compared with the tier below it anyway", async () => bandScenario(await bundle(TREES_ENTRY, {}, { "lib/reach/trees.ts": [['        out.set(t, "band");\n        continue;', '        out.set(t, "band");\n        below = n;\n        continue;']] })));
await mutation("T2 / the plain tree's size not required", async () => bandScenario(await bundle(TREES_ENTRY, {}, { "lib/reach/trees.ts": [['if (input.census === null || typeof input.plainSize !== "number") {', "if (input.census === null) {"]] })));
await mutation("T1 / the default is the LOWEST offered bucket", async () => offerScenario(await bundle(TREES_ENTRY, {}, { "lib/reach/trees.ts": [["const top = offered[0] ?? null;", "const top = offered[offered.length - 1] ?? null;"]] })));
await mutation("T1 / the issuer filter dropped", async () => offerScenario(await bundle(TREES_ENTRY, {}, { "lib/reach/trees.ts": [["const allowed = input.issuers ? new Set(input.issuers) : null;", "const allowed = null;"]] })));

// ================================================================================================ G / N / L — the gate
const T = (globalThis.__RU = {});
function resetWorld() {
  Object.assign(T, {
    rep: "zk",
    snap: null,
    state: { zkQueue: new Map() },
    persisted: [],
    proveCalls: [],
    held: [],
    honoured: new Set(["fc.reach", "x.reach"]),
    noteMode: "random",
    noteCalls: 0,
    launchOutcomes: [],
    pins: new Map(),
    pinsThrow: false,
    pinWrites: 0,
    personas: new Map([
      ["p_one", { own: true, kind: "public", handle: "one" }],
      ["p_two", { own: true, kind: "public", handle: "two" }],
    ]),
  });
}
resetWorld();
const H6 = 6 * 3_600_000;
function snapAt(epoch, sizes = {}, o = {}) {
  const buckets = Object.entries(sizes).map(([tree, size]) => ({ issuer: tree.slice(7, tree.indexOf("/")), bucket: tree.slice(tree.indexOf("/") + 1), tree, size, floor: 50, clearsFloor: size >= 50 }));
  // PERSONA LAUNCH P6 (fix LP-4): each tree's members are real lists now (the tick intersects them per true persona) —
  // nested prefixes of one commitment space ("m0", "m1", …: a reach tree of size s is m0..m(s-1), the plain tree 400),
  // or o.members[tree] when a scenario needs a different crowd
  const membersOf = (tree) => o.members?.[tree] ?? Array.from({ length: tree === PLAIN ? 400 : sizes[tree] ?? 0 }, (_, i) => "m" + i);
  const mk = (tree) => ({ mode: "fixture", tree, epoch: { mode: "fixture", epoch, epochMs: H6, msRemaining: H6 - 60_000 }, members: { mode: "fixture", tree, epoch, root: "1", members: membersOf(tree) }, history: { pubkey: "", entries: [] }, validatorKey: "", anonHead: null, anonHeadError: null, buckets, bucketsError: null, issuers: [{ id: "fc.reach", pubkey: "key-fc.reach" }, { id: "x.reach", pubkey: "key-x.reach" }], anonConfig: { tree: PLAIN, windowEpochs: 1, maxChars: 320, liveRelay: true, fid: 0, slotsPerWindow: 4, ...(o.noReachIssuers ? {} : { reachIssuers: ["fc.reach", "x.reach"] }) }, anonConfigError: null, fetchedAt: Date.now(), ms: 1 });
  const s = mk(PLAIN);
  s.extra = Object.fromEntries([PLAIN, ...Object.keys(sizes)].map((t) => [t, mk(t)]));
  // PERSONA LAUNCH wave 3 (L3): the tick stamps the plain tree's size on every snapshot it read (lib/zk/prefetch.ts) — the
  // reach offer's band rule needs it (no plain size = nothing offered); o.plainSize: false leaves it off
  const plainSize = o.plainSize === false ? undefined : { mode: "fixture", tree: PLAIN, epoch, size: membersOf(PLAIN).length };
  for (const one of [s, ...Object.values(s.extra)]) if (plainSize) one.plainSize = plainSize;
  return s;
}
const GATE_MOCKS = {
  "server-only": `export {};`,
  // PERSONA LAUNCH P6 (fix LP-4): the device-local crowd pins — T.pins ("mode:key" → members); T.pinsThrow: the write fails
  "lib/zk/localPins": `export function intersectionFor(m, k) { const v = globalThis.__RU.pins.get(m + ":" + k); return v ? [...v] : null; }
export function setIntersection(m, k, members) { const T = globalThis.__RU; T.pinWrites++; if (T.pinsThrow) throw new Error("the device pins could not be written"); T.pins.set(m + ":" + k, [...members]); }`,
  "lib/adapters/registry": `export function currentRepImpl() { return globalThis.__RU.rep; } export function setRepImplOverride() {}`,
  "lib/attest/subscriber": `export function isHonoredIssuer(id, key) { return globalThis.__RU.honoured.has(id) && key === "key-" + id; } export function setHonoredIssuersOverride() {}`,
  "lib/attest/proven": `export function clearProvenAttestations() {} export async function refreshProvenAttestations() { return {}; }`,
  "lib/attest/onboarding": `export function clearsOnboarding() { return { clears: false, by: null }; }`,
  "lib/zk/validatorClient": `export async function fetchEligibilityMap() { return {}; } export async function fetchEpoch() { throw new Error("no fetch at compose or tick time in this harness"); }`,
  "lib/zk/anon/relayAccount": `export const SEED_SELF_FID = 9152; export function relayAccountVerdict() { return { detail: "" }; } export function relayJoinRefusesPosting() { return false; }`,
  "lib/zk/anon/relay": `export function setRelayOverride() {}`,
  "lib/zk/prefetch": `export function cachedSnapshot(mode) { const s = globalThis.__RU.snap; return s && s.mode === mode ? s : null; } export function ensurePrefetchLoop() {} export function resetPrefetch() {}`,
  "lib/zk/privacy": `export async function ownIdentityFacts() { return {}; }`,
  "lib/adapters/neynar/mode": `export function writeEnabled() { return false; }`,
  "lib/adapters/mock/store": `
const T = globalThis.__RU;
export async function hydrate() {}
export function state() { return T.state; }
export async function persistNs(ns) { T.persisted.push(ns); }
export const SEED_VIEWER = { personas: ["persona_viewer_main"], activePersonaId: "persona_viewer_main" };
export const personaById = new Map();`,
  "lib/zk/anon/submit": `export async function submitAnonymous() { return { outcome: "accepted" }; }`,
  "lib/identity/keystore": `
export function listPersonas() { return [...globalThis.__RU.personas.entries()].map(([id, p]) => ({ id, handle: p.handle })); }
export function isOwnPersona(id) { return !!globalThis.__RU.personas.get(id)?.own; }`,
  "lib/fc/personaFid": `export async function personaFidMap() { return {}; } export async function personaFidRecord() { return null; }`,
  "lib/identity/keys": `export function fcSignerPublicKeyFor() { return null; } export function signAsFcSignerFor() { return null; }`,
  "lib/identity/postMode": `export async function anonPersonaRefusal(id) { return globalThis.__RU.personas.get(id)?.own ? null : { code: "persona", status: 403, message: "not yours" }; }
export function handleOfPersona(id) { return globalThis.__RU.personas.get(id)?.handle ?? null; }`,
  // the ring note (rings' module): random, unreadable, or the wrong size — counted, so "before the note" is checkable
  "lib/rings/note": `
export async function noteForPost() {
  const T = globalThis.__RU; T.noteCalls++;
  if (T.noteMode === "throw") throw new Error("the rings document is unreadable");
  const b = new Uint8Array(T.noteMode === "short" ? 255 : 256); globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}`,
  "lib/reach/held": `export function heldReachTrees() { return [...globalThis.__RU.held]; } export async function refreshHeldReach() { return { trees: () => [...globalThis.__RU.held], error: null }; } export function resetReachCaches() {}`,
  // PERSONA LAUNCH P6 (UX-L1): no launch is under way in this harness (scripts/unit-anon-slots.mjs L drives that path)
  "lib/launch/confirm": `export function noteLaunchOutcome(commit, o) { globalThis.__RU.launchOutcomes.push({ commit, ...o }); }
export async function launchUnderWay() { return false; }`,
  // the prover: records the request (and the snapshot's tree) and builds the scope with the REAL registry
  "lib/zk/prove": `
import { scopeString } from "@/lib/zk/scopes";
import { slotQualifier } from "@/lib/zk/anon/slots";
import { anonPostWindowOf } from "@/lib/zk/config";
export async function prepareAndProve(req, snap) {
  const T = globalThis.__RU;
  T.proveCalls.push({ ...req, snapTree: snap ? snap.tree : null });
  const epoch = snap.epoch.epoch;
  const scope = req.claimKind === "persona-launch" ? scopeString("persona-launch", epoch, undefined, anonPostWindowOf(epoch)) : scopeString("anon-post", epoch, undefined, slotQualifier(anonPostWindowOf(epoch), req.slot));
  return { ok: true, epoch, budget: {}, cohort: {}, envelope: { v: 1, mode: req.mode, claimKind: req.claimKind, nullifier: "n|" + scope,
    publicInputs: { mode: req.mode, claimKind: req.claimKind, tree: req.tree, epoch, merkleTreeRoot: "1", scope, message: "1", personaId: req.personaId, gateId: req.gateId, challenge: "epoch-" + epoch, castHash: req.castHash, attributionCommitment: req.attributionCommitment, slot: req.slot, noteHash: req.noteHash, launchCommit: req.launchCommit },
    proof: { scheme: "layers-zk-fixture/1", tag: "t" } } };
}`,
};
const GATE_ENTRY = `export * as gate from "@/lib/zk/gate";
export * as queue from "@/lib/zk/anon/queue";
`;
const G = await bundle(GATE_ENTRY, GATE_MOCKS);
const secrets = () => [...T.state.zkQueue.values()].filter((q) => q.claimKind === "anon-attribution");
const queuedOf = (kind) => [...T.state.zkQueue.values()].filter((q) => q.claimKind === kind && q.envelope);

async function gateReachScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.held = [TEN, HUNDRED];
  T.snap = snapAt(40, { [ONE]: 200, [TEN]: 120, [HUNDRED]: 49 });
  const refusals = [
    ["an unknown tree", { tree: "attest:onchain.foo/gte-10k" }, "bad-tree"],
    ["a tree this root does not hold", { tree: ONE }, "reach"],
    ["a tree under the floor (49)", { tree: HUNDRED }, "reach"],
    ["a tree under the floor, forced", { tree: HUNDRED, force: true }, "reach"],
  ];
  for (const [name, o, code] of refusals) {
    const before = { s: secrets().length, p: T.persisted.length, n: T.noteCalls };
    const r = await Gx.gate.requestAnonPost("a boosted post " + name, { personaId: "p_one", ...o });
    assert(!r.ok && r.code === code, `${name}: ` + JSON.stringify(r));
    assert(secrets().length === before.s && T.persisted.length === before.p, `${name}: a secret was minted or something written`);
    assert(T.noteCalls === before.n, `${name}: the ring note was read before the refusal`);
  }
  assert(/Not enough accounts are in the 100k\+ tier yet/.test((await Gx.gate.requestAnonPost("again", { personaId: "p_one", tree: HUNDRED })).reason), "the floor refusal's words");
  // an issuer this client does not honour by key, or the validator does not accept: refused
  T.honoured = new Set(["x.reach"]);
  assert((await Gx.gate.requestAnonPost("unhonoured", { personaId: "p_one", tree: TEN })).code === "reach", "an un-honoured issuer's tree was accepted");
  T.honoured = new Set(["fc.reach", "x.reach"]);
  T.snap = snapAt(40, { [ONE]: 200, [TEN]: 120, [HUNDRED]: 49 }, { noReachIssuers: true });
  assert((await Gx.gate.requestAnonPost("unaccepted", { personaId: "p_one", tree: TEN })).code === "reach", "a tree the validator does not accept was accepted");
  // POSITIVE CONTROLS: the same root, 50 in gte-100k → accepted; the tick proves it from THAT tree's snapshot
  T.snap = snapAt(40, { [ONE]: 200, [TEN]: 121, [HUNDRED]: 50 });
  const ok = await Gx.gate.requestAnonPost("boosted as a 100k account", { personaId: "p_one", tree: HUNDRED });
  assert(ok.ok && ok.tree === HUNDRED, "the 50-member tier was refused: " + JSON.stringify(ok));
  const plain = await Gx.gate.requestAnonPost("no boost", { personaId: "p_two" });
  assert(plain.ok && plain.tree === PLAIN, "no tree named is not the plain tree: " + JSON.stringify(plain));
  const queued = await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  assert(queued === 2, "the tick did not queue both: " + queued + " " + JSON.stringify(Gx.gate.gateAttempts().slice(-3)));
  const call = T.proveCalls.find((c) => c.castHash === ok.castHash);
  assert(call && call.tree === HUNDRED && call.snapTree === HUNDRED, "the boosted post was not proved from its own tree's snapshot: " + JSON.stringify(call && { tree: call.tree, snapTree: call.snapTree }));
  const env = queuedOf("anon-post").find((q) => q.envelope.publicInputs.castHash === ok.castHash).envelope;
  assert(env.publicInputs.tree === HUNDRED, "the envelope does not carry the chosen tree");
  return "refusals before the note and the mint; the 50-member tier proved from its own snapshot";
}
console.log("\nG — the compose gate refuses a tree before anything is minted");
await check("G1 an unknown, un-held, under-floor (49) — even forced —, un-honoured or unaccepted tree is refused before the ring note is read, the secret minted or anything written; at 50 the same post is accepted and the tick proves it from that tree's snapshot", () => gateReachScenario(G));
await mutation("G1 / the reach check skipped in requestAnonPost", async () => gateReachScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (bad) return { ok: false, code: bad.code, reason: bad.reason };", ""]] })));
await mutation("G1 / the tick proves a reach post from the gate tree's snapshot", async () => gateReachScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["const useSnapA = w.tree === snap.tree ? snap : extra[w.tree];", "const useSnapA = snap;"], ["const useSnap = w.tree === snap.tree ? snap : extra[w.tree];", "const useSnap = snap;"]] })));

async function noteScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(41);
  for (const [mode, why] of [["throw", /couldn't read your rings/], ["short", /not 256 bytes/]]) {
    T.noteMode = mode;
    const r = await Gx.gate.requestAnonPost("note " + mode, { personaId: "p_one" });
    assert(!r.ok && r.code === "unavailable" && why.test(r.reason), `${mode}: ` + JSON.stringify(r));
    assert(secrets().length === 0 && T.persisted.length === 0, `${mode}: a secret was minted or something written`);
  }
  T.noteMode = "random";
  const ok = await Gx.gate.requestAnonPost("with a note", { personaId: "p_one" });
  assert(ok.ok, JSON.stringify(ok));
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  const env = queuedOf("anon-post")[0].envelope;
  const call = T.proveCalls.at(-1);
  assert(Object.keys(env.payload).sort().join(",") === "nonce,note,text", "the payload is not exactly {text, nonce, note}: " + Object.keys(env.payload));
  assert(/^[0-9a-f]{512}$/.test(env.payload.note), "the note is not 256 bytes of hex");
  const raw = createHash("sha256").update(Buffer.from(env.payload.note, "hex")).digest("hex");
  assert(call.noteHash === raw, "the bound noteHash is not sha256 over the RAW 256 bytes");
  assert(env.publicInputs.noteHash === raw, "the envelope's noteHash differs from the payload note's hash");
  return "noteHash = sha256(raw 256 bytes); payload {text, nonce, note}";
}
console.log("\nN — the ring note seam (P4)");
await check("N1 an unreadable or 255-byte note refuses before the mint (no secret, no write); a good note's sha256 over the RAW bytes is what the prover binds, and the payload is exactly {text, nonce, note}", () => noteScenario(G));
await mutation("N1 / the note hashed as UTF-8 hex text instead of raw bytes", async () => noteScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [['createHash("sha256").update(note, "hex").digest("hex")', 'createHash("sha256").update(note).digest("hex")']] })));
await mutation("N1 / the note size check removed", async () => noteScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [['if (typeof note !== "string" || !/^[0-9a-f]{512}$/.test(note)) {', "if (false) {"]] })));

async function launchScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(50);
  const c1 = hex(32);
  const c2 = hex(32);
  for (const [commit, req, why] of [["zz", "r", /64 lowercase hex/], [c1, "", /empty/], [c1, "x".repeat(2049), /2048 bytes/], [c1.toUpperCase(), "r", /64 lowercase hex/]]) {
    const r = Gx.gate.requestLaunchProof(commit, req);
    assert(!r.ok && why.test(r.reason), JSON.stringify(r));
  }
  assert(Gx.gate.wantedLaunchRequests().length === 0, "a refused launch request is wanted");
  const reqA = JSON.stringify({ v: 1, launch: "A", pad: "é".repeat(10) });
  assert(Gx.gate.requestLaunchProof(c1, reqA).ok && Gx.gate.requestLaunchProof(c2, '{"v":1,"launch":"B"}').ok, "a good launch request was refused");
  assert(T.proveCalls.length === 0 && T.persisted.length === 0, "requestLaunchProof proved or wrote something");
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  const launches = queuedOf("persona-launch");
  assert(launches.length === 1, "one window queued " + launches.length + " launch requests");
  const env = launches[0].envelope;
  const call = T.proveCalls.find((c) => c.claimKind === "persona-launch");
  assert(call.personaId === "anon" && call.gateId === "persona-launch" && call.tree === PLAIN && call.slot === undefined && call.launchCommit === c1, "the launch proof request: " + JSON.stringify(call));
  assert(JSON.stringify(env.payload) === JSON.stringify({ request: reqA }), "the launch payload is not exactly {request}: " + JSON.stringify(env.payload));
  assert(T.launchOutcomes.some((o) => o.commit === c1 && o.stage === "queued" && o.queuedId), "no queued outcome for the first launch: " + JSON.stringify(T.launchOutcomes));
  assert(T.launchOutcomes.some((o) => o.commit === c2 && o.stage === "once"), "the second launch in the window was not held for the next: " + JSON.stringify(T.launchOutcomes));
  assert(Gx.gate.wantedLaunchRequests().includes(c2), "the second launch request was dropped instead of waiting for the next window");
  // the next window: it proves
  T.snap = snapAt(51);
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  assert(queuedOf("persona-launch").length === 2 && !Gx.gate.wantedLaunchRequests().includes(c2), "the next window did not prove the waiting launch");
  return "one per window; the next waits";
}
console.log("\nL — the launch request seam (P6)");
await check("L1 requestLaunchProof refuses a bad commitment, an empty or >2048-byte request and fetches/proves/writes nothing; the tick proves persona-launch as 'anon' over the plain tree with no slot and payload exactly {request}; a second launch in the window waits for the next one (outcome 'once') and proves there", () => launchScenario(G));
await mutation("L1 / one-launch-per-window check removed from the tick", async () => launchScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (await launchSubmittedThisWindow(snap.mode, snap.epoch.epoch)) {", "if (false) {"]] })));
await check("L2 STRUCTURAL (accept-z5 check 6's rule): the requestEligibility..runWantedProofs text of gate.ts holds no fetch*( / prepareAndProve / validatorClient token, and requestLaunchProof lies outside it", () => {
  const gate = readFileSync(path.join(ROOT, "lib/zk/gate.ts"), "utf8");
  const a = gate.indexOf("export function requestEligibility");
  const b = gate.indexOf("export async function runWantedProofs");
  assert(a > 0 && b > a, "the slice anchors moved");
  const slice = gate.slice(a, b);
  assert(!/(^|[^A-Za-z])fetch\w*\(|prepareAndProve|validatorClient/.test(slice), "the trigger slice fetches or proves");
  const l = gate.indexOf("export function requestLaunchProof");
  assert(l > b, "requestLaunchProof sits inside the scanned slice");
});

// ================================================================================================ C — the crowd (fix LP-4)
// PERSONA LAUNCH P6 (fix LP-4, the proof layer's half, applied by the final verify): the tick keeps a device-local running
// intersection of the members of every tree a TRUE persona's anon posts were proved in ("anon-post|<persona>", the key
// lib/launch/preview.ts reads), and refuses — terminally, in plain words, before the prover — a REACH proof that would take
// it under ZK_REACH_FLOOR; the plain tree is never refused; the narrowing is recorded BEFORE the post is queued.
const C_ENTRY = GATE_ENTRY + `export * as outcomes from "@/lib/zk/anon/outcomes";\n`;
const range = (a, b) => Array.from({ length: b - a }, (_, i) => "m" + (a + i));
async function crowdScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  Gx.outcomes.resetAnonOutcomes();
  T.held = [TEN, ONE];
  const key = (p) => "fixture:anon-post|" + p;
  // 1. p_one's first boosted post: its crowd starts as the 10k+ tree's 120 members, recorded when it is queued
  T.snap = snapAt(60, { [ONE]: 200, [TEN]: 120 });
  const a = await Gx.gate.requestAnonPost("first boosted", { personaId: "p_one", tree: TEN });
  assert(a.ok, JSON.stringify(a));
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  assert(queuedOf("anon-post").length === 1, "the first boosted post was not queued");
  assert((T.pins.get(key("p_one")) ?? []).length === 120, "the first post's crowd was not recorded under anon-post|<persona>: " + JSON.stringify([...T.pins.keys()]));
  // 2. the next epoch's 10k+ tree shares exactly 50 of those members: allowed at the floor (50), the crowd narrows to 50
  T.snap = snapAt(61, { [ONE]: 200, [TEN]: 120 }, { members: { [TEN]: [...range(70, 120), ...range(500, 570)] } });
  const b = await Gx.gate.requestAnonPost("at the floor", { personaId: "p_one", tree: TEN });
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  assert(queuedOf("anon-post").length === 2, "a post that keeps exactly 50 in common was refused: " + JSON.stringify(Gx.outcomes.anonOutcome(b.castHash)));
  assert(T.pins.get(key("p_one")).length === 50, "the crowd did not narrow to 50: " + T.pins.get(key("p_one")).length);
  // 3. a 10k+ tree sharing 49 of the 50: REFUSED, terminally, in plain words, before the prover; no slot spent, the secret
  //    deleted, the recorded crowd unchanged
  T.snap = snapAt(62, { [ONE]: 200, [TEN]: 120 }, { members: { [TEN]: [...range(71, 120), ...range(600, 671)] } });
  const proves = T.proveCalls.length;
  const c = await Gx.gate.requestAnonPost("under the floor", { personaId: "p_one", tree: TEN });
  assert(c.ok, "the composer refused (the crowd is the tick's decision): " + JSON.stringify(c));
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  const oc = Gx.outcomes.anonOutcome(c.castHash);
  assert(queuedOf("anon-post").length === 2, "a reach post that narrows the crowd to 49 was QUEUED");
  assert(T.proveCalls.length === proves, "the prover ran for a post the crowd check refuses");
  assert(oc && oc.stage === "dropped" && oc.lastStage === "cohort", "not a terminal cohort refusal: " + JSON.stringify(oc));
  assert(/only 49 accounts/.test(oc.reason) && /fewer than 50/.test(oc.reason) && /lower boost or no boost/.test(oc.reason) && !/attest:|tree|intersection/.test(oc.reason), "the refusal is not in plain words: " + oc.reason);
  assert(!secrets().some((s) => s.attribution?.text === "under the floor"), "the refused post's reveal secret was kept");
  assert(T.pins.get(key("p_one")).length === 50, "a refused post narrowed the recorded crowd");
  // the posts the count COVERS ride beside it (the launch preview trusts the count only for posts it covers)
  const cov = T.pins.get("fixture:anon-post-covered|p_one") ?? [];
  assert(cov.includes(a.castHash) && cov.includes(b.castHash) && !cov.includes(c.castHash) && cov.length === 2, "the covered posts are not exactly the two proved ones: " + JSON.stringify(cov));
  // 4. the same persona, NO boost, against that same snapshot: the plain tree is never refused (the choice the words name)
  const d = await Gx.gate.requestAnonPost("no boost after the refusal", { personaId: "p_one" });
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  assert(queuedOf("anon-post").length === 3, "the plain-tree post was refused: " + JSON.stringify(Gx.outcomes.anonOutcome(d.castHash)));
  // 5. another persona of the same root keeps its OWN crowd: its first 10k+ post on the same snapshot is proved
  const e = await Gx.gate.requestAnonPost("p_two boosted", { personaId: "p_two", tree: TEN });
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  assert(queuedOf("anon-post").length === 4 && T.pins.get(key("p_two")).length === 120, "a sibling persona inherited p_one's crowd: " + JSON.stringify(Gx.outcomes.anonOutcome(e.castHash)));
  // 6. the pins write fails: nothing is queued (the narrowing is recorded BEFORE the queue), the post stays wanted
  T.pinsThrow = true;
  const f = await Gx.gate.requestAnonPost("pins unwritable", { personaId: "p_two" });
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  const of = Gx.outcomes.anonOutcome(f.castHash);
  assert(queuedOf("anon-post").length === 4, "a post was queued although its crowd could not be recorded");
  assert(of && of.stage === "retrying", "an unwritable pin is not a retry: " + JSON.stringify(of));
  T.pinsThrow = false;
  // 7. a PLAIN post takes p_one's crowd under the floor (50 → 45; the plain tree is never refused). A boost whose tree
  //    holds all 45 narrows nothing more — allowed (it reveals nothing a launch would not already); a boost whose tree
  //    holds 44 of them narrows it further under the floor — refused
  T.snap = snapAt(63, { [ONE]: 200, [TEN]: 120 }, { members: { [PLAIN]: [...range(75, 120), ...range(200, 400)] } });
  const g7 = await Gx.gate.requestAnonPost("plain narrows", { personaId: "p_one" });
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  assert(Gx.outcomes.anonOutcome(f.castHash)?.stage === "queued", "the post whose pin write failed was not proved on the next tick: " + JSON.stringify(Gx.outcomes.anonOutcome(f.castHash)));
  assert(queuedOf("anon-post").length === 6 && Gx.outcomes.anonOutcome(g7.castHash)?.stage === "queued" && T.pins.get(key("p_one")).length === 45, "the plain post was refused or did not narrow to 45: " + JSON.stringify(Gx.outcomes.anonOutcome(g7.castHash)));
  T.snap = snapAt(64, { [ONE]: 200, [TEN]: 120 }, { members: { [TEN]: [...range(75, 120), ...range(700, 775)] } });
  const h7 = await Gx.gate.requestAnonPost("boost that narrows nothing", { personaId: "p_one", tree: TEN });
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  assert(queuedOf("anon-post").length === 7, "a boost that narrows the crowd no further was refused: " + JSON.stringify(Gx.outcomes.anonOutcome(h7.castHash)));
  T.snap = snapAt(65, { [ONE]: 200, [TEN]: 120 }, { members: { [TEN]: [...range(76, 120), ...range(800, 876)] } });
  const i7 = await Gx.gate.requestAnonPost("boost that narrows to 44", { personaId: "p_one", tree: TEN });
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  const oi = Gx.outcomes.anonOutcome(i7.castHash);
  assert(queuedOf("anon-post").length === 7 && oi?.stage === "dropped" && oi.lastStage === "cohort" && /only 44 accounts/.test(oi.reason), "a boost narrowing an under-floor crowd further was not refused: " + JSON.stringify(oi));
  return "120 → 50 allowed at the floor; 49 refused terminally before the prover; plain never refused (50 → 45); a boost narrowing nothing more allowed, one narrowing to 44 refused; per-persona; write before queue";
}
console.log("\nC — the crowd a launch would reveal (fix LP-4)");
await check("C1 the tick records each true persona's running crowd under anon-post|<persona> (the key lib/launch/preview.ts reads) and refuses, terminally and in plain words, BEFORE the prover, a reach post that would leave fewer than 50 in common (50 is allowed); the plain tree is never refused; a sibling persona keeps its own crowd; an unwritable pin queues nothing", async () => crowdScenario(await bundle(C_ENTRY, GATE_MOCKS)));
await mutation("C1 / the crowd refusal removed", async () => crowdScenario(await bundle(C_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (parseReachTree(w.tree) && crowdNext.length < ZK_REACH_FLOOR && (prev === null || crowdNext.length < prev.length)) {", "if (false) {"]] })));
await mutation("C1 / a boost refused although it narrows nothing more (the narrowing condition dropped)", async () => crowdScenario(await bundle(C_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [[" && (prev === null || crowdNext.length < prev.length)) {", ") {"]] })));
await mutation("C1 / the floor compared one below (49 allowed)", async () => crowdScenario(await bundle(C_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["crowdNext.length < ZK_REACH_FLOOR && (prev", "crowdNext.length < ZK_REACH_FLOOR - 1 && (prev"]] })));
await mutation("C1 / the narrowed crowd never recorded", async () => crowdScenario(await bundle(C_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["pins.setIntersection(snap.mode, crowdKey, crowdNext);", ""]] })));
await mutation("C1 / the covered posts never recorded", async () => crowdScenario(await bundle(C_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["pins.setIntersection(snap.mode, coveredKey,", "void (snap.mode, coveredKey,"]] })));
await mutation("C1 / the narrowing recorded AFTER the queue", async () => crowdScenario(await bundle(C_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["        if (crowdKey && crowdNext) {\n          const pins = await import(\"./localPins\");", "        if (false) {\n          const pins = await import(\"./localPins\");"],["        ensureDrainLoop();\n        attempt.queuedId = item.id;", "        ensureDrainLoop();\n        if (crowdKey && crowdNext) { const pins = await import(\"./localPins\"); pins.setIntersection(snap.mode, crowdKey, crowdNext); const ck = \"anon-post-covered|\" + crowdKey.slice(10); pins.setIntersection(snap.mode, ck, [...new Set([...(pins.intersectionFor(snap.mode, ck) ?? []), w.castHash as string])]); }\n        attempt.queuedId = item.id;"]] })));
await mutation("C1 / the crowd keyed by tree instead of the true persona", async () => crowdScenario(await bundle(C_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["crowdKey = \"anon-post|\" + sealed.personaId;", "crowdKey = \"anon-post|\" + w.tree;"]] })));

/**
 * PERSONA LAUNCH wave 3 (L3) — THE BAND IN THE CROWD A LAUNCH READS. A post made at the tree that was this root's DEFAULT
 * (the highest tier offered to it) comes, to anyone who knows the census, from that tree's band: its members who hold no
 * offered tier above it — and after a launch that inference is exact for this persona. So the device-local crowd narrows
 * to the band; a post made BELOW its default keeps the whole tree (the band would exclude its own author); the plain tree
 * at its default loses every offered reach tier; a band that cannot be worked out leaves the post NOT covered (the
 * launch preview then calls the crowd unknown and asks for the acknowledgement).
 */
async function bandCrowdScenario(Gx) {
  const key = (p) => "fixture:anon-post|" + p;
  const covered = (p) => T.pins.get("fixture:anon-post-covered|" + p) ?? [];
  const idx = (m) => Number(m.slice(1));
  const fresh = async (held) => {
    resetWorld();
    await Gx.gate.resetZkRuntimeOverrides();
    Gx.outcomes.resetAnonOutcomes();
    T.held = held;
  };
  // (a) the root holds gte-1k only — its default — and gte-10k (m0..m119) is offered to others: the band is m120..m199
  await fresh([ONE]);
  T.snap = snapAt(70, { [ONE]: 200, [TEN]: 120 });
  const a = await Gx.gate.requestAnonPost("a 1k post at its default", { personaId: "p_one", tree: ONE });
  assert(a.ok, "setup: " + JSON.stringify(a));
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  const ca = T.pins.get(key("p_one")) ?? [];
  assert(ca.length === 80 && ca.every((m) => idx(m) >= 120 && idx(m) < 200), "a default-tier post's crowd is not its band (gte-1k without gte-10k): " + ca.length);
  assert(covered("p_one").includes(a.castHash), "the band post is not covered");
  // (b) BELOW its default (it holds gte-10k too; gte-1k by choice): the whole tree — the band would exclude its author
  await fresh([ONE, TEN]);
  T.snap = snapAt(71, { [ONE]: 200, [TEN]: 120 });
  const b = await Gx.gate.requestAnonPost("a 1k post below its default", { personaId: "p_one", tree: ONE });
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  assert((T.pins.get(key("p_one")) ?? []).length === 200 && covered("p_one").includes(b.castHash), "a post below its default was narrowed to a band its author is not in: " + (T.pins.get(key("p_one")) ?? []).length);
  // (c) the PLAIN tree at its default (no tier held): minus every offered reach tier — m200..m399
  await fresh([]);
  T.snap = snapAt(72, { [ONE]: 200, [TEN]: 120 });
  const c = await Gx.gate.requestAnonPost("a plain post at its default", { personaId: "p_one" });
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  const cc = T.pins.get(key("p_one")) ?? [];
  assert(cc.length === 200 && cc.every((m) => idx(m) >= 200), "a default plain post's crowd still holds the offered reach tiers' members: " + cc.length);
  assert(covered("p_one").includes(c.castHash), "the plain band post is not covered");
  // (d) an offered tier ABOVE with no snapshot on this tick: the band cannot be worked out — not covered (fail closed)
  await fresh([ONE]);
  T.snap = snapAt(73, { [ONE]: 200, [TEN]: 120 });
  delete T.snap.extra[TEN];
  const d = await Gx.gate.requestAnonPost("a band that cannot be worked out", { personaId: "p_one", tree: ONE });
  await Gx.gate.runWantedProofs(T.snap, T.snap.extra);
  assert(queuedOf("anon-post").length === 1, "setup: the post was not proved");
  assert(!covered("p_one").includes(d.castHash), "a post whose band could not be worked out was marked covered (the preview would call its crowd exact)");
  return "default 1k post → its band of 80; below its default → the whole 200; default plain → 200 (reach tiers removed); an unread tier above → not covered";
}
await check("C3 L3: the crowd a launch reads narrows to the BAND of a post made at its default tier (the tree's members who hold no offered tier above it — exact for the persona once launched); a post below its default keeps the whole tree; the plain tree at its default loses the offered reach tiers; a band that cannot be worked out leaves the post uncovered", async () => bandCrowdScenario(await bundle(C_ENTRY, GATE_MOCKS)));
await mutation("C3 / the band not subtracted (the whole tree kept)", async () => bandCrowdScenario(await bundle(C_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["for (const m of s.members.members) cur.delete(m);", ""]] })));
await mutation("C3 / the band applied to a post below its default too", async () => bandCrowdScenario(await bundle(C_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (offeredAnonTrees(offerIn).defaultTree === w.tree) {", "if (true) {"]] })));
await mutation("C3 / a post marked covered when its band could not be worked out", async () => bandCrowdScenario(await bundle(C_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (bandKnown) pins.setIntersection(snap.mode, coveredKey,", "if (true) pins.setIntersection(snap.mode, coveredKey,"]] })));
await mutation("C1 / the refusal retried for 150 ticks instead of ending in plain words", async () => crowdScenario(await bundle(C_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["await anonRefused(key, w, snap.mode, \"cohort\", reason, true);", "await anonRefused(key, w, snap.mode, \"cohort\", reason, false);"]] })));
await check("C2 STRUCTURAL: the key the tick writes (gate.ts) is the key the launch preview reads (lib/launch/preview.ts ANON_CROWD_KEY_PREFIX)", () => {
  const gate = readFileSync(path.join(ROOT, "lib/zk/gate.ts"), "utf8");
  const prev = readFileSync(path.join(ROOT, "lib/launch/preview.ts"), "utf8");
  const m = prev.match(/export const ANON_CROWD_KEY_PREFIX = "([^"]+)";/);
  assert(m, "ANON_CROWD_KEY_PREFIX not found in lib/launch/preview.ts");
  assert(gate.includes(`crowdKey = "${m[1]}" + sealed.personaId;`), `gate.ts does not write the crowd under "${m[1]}" + the sealed persona`);
  return `"${m[1]}"`;
});

const SCOPES = await bundle(`export * as scopes from "@/lib/zk/scopes";
`);
await check("L3 THE REGISTRY ENTRY: persona-launch is registered onePerHuman with a disclosed linkage; its scope takes the window ALONE on both sides (w<n> → layers/zk-scope/v1|persona-launch/w<n>, byte-equal to the validator's), refuses a slot, junk or a persona; the unqualified form (accept-z0's registry walk and the self-test) is the epoch form; its feature never equals anon-post's", () => {
  const s = SCOPES.scopes;
  const e = s.SCOPE_REGISTRY.find((x) => x.id === "persona-launch");
  assert(e && e.onePerHuman === true && e.feature === "persona-launch" && /disclosed/.test(e.linkage) && /no slot, no persona, no tree/.test(e.linkage), "the registry entry: " + JSON.stringify(e));
  assert(Object.isFrozen(e), "the entry is not frozen");
  for (const ep of [0, 5, 81234]) {
    const c = s.scopeString("persona-launch", ep, undefined, "w" + ep);
    assert(c === "layers/zk-scope/v1|persona-launch/w" + ep, "client: " + c);
    assert(c === vz.scopeString({ feature: "persona-launch", onePerHuman: true }, ep, undefined, vz.anonPostWindowOf(ep)), "the validator's launch scope differs at epoch " + ep);
  }
  assert(s.scopeString("persona-launch", 7) === "layers/zk-scope/v1|persona-launch|7", "the unqualified form changed");
  for (const [q, p] of [["w5/s0", undefined], ["5", undefined], ["w", undefined], ["w5", "p_x"]]) {
    let threw = false;
    try {
      s.scopeString("persona-launch", 5, p, q);
    } catch {
      threw = true;
    }
    assert(threw, `qualifier ${q} with persona ${p} was accepted`);
  }
  // the anon-post linkage now says the tree is deliberately not in the scope
  assert(/THE TREE IS DELIBERATELY NOT IN THE SCOPE/.test(s.SCOPE_REGISTRY.find((x) => x.id === "anon-post").linkage), "the anon-post linkage does not state the tree rule");
});

// ================================================================================================ P / S — the real prover
const PROVE_MOCKS = {
  "server-only": `export {};`,
  "lib/identity/keystore": `export function isOwnPersona(id) { return id === "p_x"; }`,
  "lib/adapters/mock/store": `export const SEED_VIEWER = { personas: ["persona_viewer_main"], activePersonaId: "persona_viewer_main" };`,
  "lib/zk/identity": `export function zkCommitment() { return "7"; }`,
  "lib/zk/rootHistory": `export function verifyRootAgainstHistoryWith() { return { ok: true }; } export async function verifyRootAgainstHistory() { throw new Error("no fetch with a snapshot"); }`,
  "lib/zk/validatorClient": `export async function fetchEpoch() { throw new Error("no fetch with a snapshot"); } export async function fetchMembers() { throw new Error("no fetch with a snapshot"); }`,
  "lib/zk/localPins": `
const P = (globalThis.__RUP ??= { cohorts: new Map(), budgets: new Map(), inter: new Map() });
export function cohortFor(m, t) { return P.cohorts.get(m + "|" + t) ?? null; }
export function setCohort(m, t, r) { P.cohorts.set(m + "|" + t, r); }
export function budgetFor(k) { return P.budgets.get(k) ?? []; }
export function setBudget(k, u) { P.budgets.set(k, [...u]); }
export function intersectionFor(m, p) { return P.inter.get(m + "|" + p) ?? null; }
export function setIntersection(m, p, x) { P.inter.set(m + "|" + p, [...x]); }`,
  "lib/zk/transport": `
export async function transportFor(mode) {
  return {
    mode,
    async prove(kind, pub) { return { v: 1, mode, claimKind: kind, publicInputs: pub, nullifier: "1", proof: { scheme: "layers-zk-fixture/1", tag: "t" } }; },
    async verify() { return { ok: true }; },
  };
}`,
};
const PROVE_ENTRY = `export * as prove from "@/lib/zk/prove";
export * as cohort from "@/lib/zk/cohort";
export * as budget from "@/lib/zk/budget";
export * as config from "@/lib/zk/config";
`;
const PR = await bundle(PROVE_ENTRY, PROVE_MOCKS);
function membersOf(n, Px) {
  const list = ["7", ...Array.from({ length: n - 1 }, (_, i) => String(1000 + i))];
  return { list, root: Px.cohort.rootOfMembers(list) };
}
function proveSnap(tree, epoch, n, Px) {
  const m = membersOf(n, Px);
  return { mode: "fixture", tree, epoch: { mode: "fixture", epoch, epochMs: H6, msRemaining: H6 - 60_000 }, members: { mode: "fixture", tree, epoch, root: m.root, members: m.list }, history: { pubkey: "k", entries: [] }, validatorKey: "k", anonHead: null, anonHeadError: null, buckets: [], bucketsError: null, issuers: [], anonConfig: null, anonConfigError: null, fetchedAt: Date.now(), ms: 1 };
}
const anonReq = (tree, slot, o = {}) => ({ claimKind: "anon-post", tree, personaId: "anon", gateId: "anon-post", mode: "fixture", castHash: "a".repeat(64), attributionCommitment: "b".repeat(64), noteHash: "c".repeat(64), slot, ...o });
const freshPins = () => (globalThis.__RUP = { cohorts: new Map(), budgets: new Map(), inter: new Map() });

async function proverScenario(Px) {
  freshPins();
  let ep = 300;
  // the allowlist: plain and reach trees prove; a lookalike issuer's tree is refused at 'scope'
  for (const tree of [PLAIN, TEN, XTEN]) {
    const out = await Px.prove.prepareAndProve(anonReq(tree, 0), proveSnap(tree, ep, 60, Px));
    assert(out.ok, `${tree}: ` + JSON.stringify(out));
    ep++;
  }
  const look = await Px.prove.prepareAndProve(anonReq("attest:onchain.foo/gte-10k", 0), proveSnap("attest:onchain.foo/gte-10k", ep++, 60, Px));
  assert(!look.ok && look.stage === "scope", "a lookalike tree was proved: " + JSON.stringify(look));
  // the cohort floor at prove time: 49 members refused at 'cohort', 50 proved (a fresh tree, first sight)
  const r49 = await Px.prove.prepareAndProve(anonReq(HUNDRED, 1), proveSnap(HUNDRED, ep, 49, Px));
  assert(!r49.ok && r49.stage === "cohort", "a 49-member reach tree was proved: " + JSON.stringify(r49));
  freshPins();
  const r50 = await Px.prove.prepareAndProve(anonReq(HUNDRED, 1), proveSnap(HUNDRED, ep, 50, Px));
  assert(r50.ok, "a 50-member reach tree was refused: " + JSON.stringify(r50));
  // the note hash: required on anon-post, refused elsewhere; the message binds it — parity with the validator
  const noNote = await Px.prove.prepareAndProve(anonReq(TEN, 2, { noteHash: undefined }), proveSnap(TEN, ep, 60, Px));
  assert(!noNote.ok && noNote.stage === "scope" && /note hash/.test(noNote.reason), "an anon post without a note hash: " + JSON.stringify(noNote));
  const plainNote = await Px.prove.prepareAndProve({ claimKind: "tier-membership", tree: PLAIN, personaId: "p_x", gateId: "foryou", mode: "fixture", noteHash: "c".repeat(64) }, proveSnap(PLAIN, ep, 60, Px));
  assert(!plainNote.ok && /note hash is only valid/.test(plainNote.reason), "a note hash on a plain claim: " + JSON.stringify(plainNote));
  const env = r50.envelope;
  const v = vz.expectedPublicValues(env.publicInputs);
  assert(v.scope === env.publicInputs.scope && v.message === env.publicInputs.message, "the anon-post scope/message differ from the validator's derivation");
  assert(env.publicInputs.noteHash === "c".repeat(64) && vz.canonicalPublicInputs(env.publicInputs).endsWith("|1|" + "c".repeat(64)), "the canonical tail does not end with slot|noteHash");
  // a changed noteHash changes the message (it is bound)
  assert(vz.expectedPublicValues({ ...env.publicInputs, noteHash: "d".repeat(64) }).message !== env.publicInputs.message, "the message does not bind the note hash");
  // persona-launch: 'anon', the plain tree, a commitment, no slot; scope persona-launch/w<n>; parity with the validator
  const lreq = { claimKind: "persona-launch", tree: PLAIN, personaId: "anon", gateId: "persona-launch", mode: "fixture", launchCommit: "e".repeat(64) };
  const lok = await Px.prove.prepareAndProve(lreq, proveSnap(PLAIN, ep + 1, 60, Px));
  assert(lok.ok, "a launch request was refused: " + JSON.stringify(lok));
  const lv = vz.expectedPublicValues(lok.envelope.publicInputs);
  assert(lv.scope === lok.envelope.publicInputs.scope && lv.message === lok.envelope.publicInputs.message, "the launch scope/message differ from the validator's");
  for (const [name, o, stage] of [["a persona", { personaId: "p_x" }, "persona"], ["a reach tree", { tree: TEN }, "scope"], ["no commitment", { launchCommit: undefined }, "scope"], ["a slot", { slot: 0 }, "scope"]]) {
    const r = await Px.prove.prepareAndProve({ ...lreq, ...o }, proveSnap(o.tree ?? PLAIN, ep + 1, 60, Px));
    assert(!r.ok && r.stage === stage, `launch with ${name}: ` + JSON.stringify(r));
  }
  const lOnAnon = await Px.prove.prepareAndProve(anonReq(TEN, 3, { launchCommit: "e".repeat(64) }), proveSnap(TEN, ep + 2, 60, Px));
  assert(!lOnAnon.ok && /launch commitment is only valid/.test(lOnAnon.reason), "a launch commitment on an anon post: " + JSON.stringify(lOnAnon));
  return "allowlist, floor 49/50, note bound, launch rules — parity with the validator";
}
console.log("\nP — the prover (real lib/zk/prove.ts)");
await check("P1 plain and reach trees prove, a lookalike issuer's tree is refused; a 49-member reach tree is refused at 'cohort' and the same at 50 proves; the note hash is required on anon posts, refused elsewhere and bound into the message (validator parity); persona-launch proves as 'anon' over the plain tree with its commitment and is refused with a persona, a reach tree, no commitment or a slot (validator parity)", () => proverScenario(PR));
await mutation("P1 / the anon tree allowlist dropped from the prover", async () => proverScenario(await bundle(PROVE_ENTRY, PROVE_MOCKS, { "lib/zk/prove.ts": [["if (!anonTreeAllowed(req.tree)) return", "if (false) return"]] })));
await mutation("P1 / the note hash left out of the anon message", async () => proverScenario(await bundle(PROVE_ENTRY, PROVE_MOCKS, { "lib/zk/prove.ts": [['"attr:" + req.attributionCommitment, "note:" + req.noteHash, challenge', '"attr:" + req.attributionCommitment, challenge']] })));

async function ownerFloorScenario(Px) {
  freshPins();
  // the owner service's shape: ZK_ANON_FLOOR=1 (a crowd of one it discloses). The plain tree with 2 members proves …
  const plain = await Px.prove.prepareAndProve(anonReq(PLAIN, 0), proveSnap(PLAIN, 400, 2, Px));
  assert(plain.ok, "the owner's plain tree (2 members, ZK_ANON_FLOOR=1) was refused: " + JSON.stringify(plain));
  // … a reach tier of 2 never does (the reach floor is its own, 50), and the floors read back as such
  const reach = await Px.prove.prepareAndProve(anonReq(TEN, 1), proveSnap(TEN, 400, 2, Px));
  assert(!reach.ok && reach.stage === "cohort" && /reach floor 50/.test(reach.reason), "a reach tier of 2 was proved on the owner's shape: " + JSON.stringify(reach));
  assert(Px.config.ZK_ANON_FLOOR === 1 && Px.config.ZK_REACH_FLOOR === 50, `floors ${Px.config.ZK_ANON_FLOOR}/${Px.config.ZK_REACH_FLOOR}`);
}
await check("P2 the owner service's shape (ZK_ANON_FLOOR=1): the plain anon tree of 2 proves, a reach tier of 2 is refused at 'cohort' (the reach floor stays 50 — a tier of one would name the owner's main account)", async () => ownerFloorScenario(await bundleWithEnv({ ZK_ANON_FLOOR: "1" }, PROVE_ENTRY, PROVE_MOCKS)));
await mutation("P2 / the reach floor removed from the prover", async () => ownerFloorScenario(await bundleWithEnv({ ZK_ANON_FLOOR: "1" }, PROVE_ENTRY, PROVE_MOCKS, { "lib/zk/prove.ts": [['if (req.claimKind === "anon-post" && parseReachTree(req.tree) && members.members.length < ZK_REACH_FLOOR) {', "if (false) {"]] })));

const SCOPE_TREE_PATCH = { "lib/zk/prove.ts": [["slotQualifier(anonPostWindowOf(epoch), req.slot as number)) // no persona, NO TREE", "slotQualifier(anonPostWindowOf(epoch), req.slot as number)) + \"|\" + req.tree // MUTATION: the tree in the scope"]] };
async function scopeScenario(Px) {
  freshPins();
  const a = await Px.prove.prepareAndProve(anonReq(PLAIN, 2), proveSnap(PLAIN, 500, 60, Px));
  const b = await Px.prove.prepareAndProve(anonReq(TEN, 2), proveSnap(TEN, 500, 60, Px));
  const c = await Px.prove.prepareAndProve(anonReq(XTEN, 2), proveSnap(XTEN, 500, 60, Px));
  assert(a.ok && b.ok && c.ok, "a same-slot post under another tree was refused: " + JSON.stringify([a, b, c].filter((x) => !x.ok)));
  assert(a.envelope.publicInputs.scope === b.envelope.publicInputs.scope && b.envelope.publicInputs.scope === c.envelope.publicInputs.scope, "one (window, slot) under three trees gave different scopes — the tree is in the scope");
  // the validator derives the same one scope for every tree (so its replay rule is the slot's, whatever the tree)
  for (const e of [a, b, c]) assert(vz.expectedPublicValues(e.envelope.publicInputs).scope === e.envelope.publicInputs.scope, "the validator's scope differs for " + e.envelope.publicInputs.tree);
  // and the K slots of the window are K distinct scopes over different trees
  const d = await Px.prove.prepareAndProve(anonReq(TEN, 3), proveSnap(TEN, 500, 60, Px));
  assert(d.ok && d.envelope.publicInputs.scope !== b.envelope.publicInputs.scope, "two slots under one tree share a scope");
  return "one scope per (window, slot) whatever the tree";
}
console.log("\nS — the scope excludes the tree");
await check(`S1 one (window, slot) proved under the plain tree, fc.reach/gte-10k and x.reach/gte-10k is ONE scope on the client and on the validator; different slots stay distinct${SCOPE_MUT ? " [REACH_SCOPE_MUT=tree: running against the build that PUTS THE TREE IN THE SCOPE — this check must be red]" : ""}`, async () => scopeScenario(SCOPE_MUT ? await bundle(PROVE_ENTRY, PROVE_MOCKS, SCOPE_TREE_PATCH) : PR));
await mutation("S1 / the tree put in the anon scope (REACH_SCOPE_MUT=tree)", async () => scopeScenario(await bundle(PROVE_ENTRY, PROVE_MOCKS, SCOPE_TREE_PATCH)));

// ================================================================================================ B — the budget
async function budgetScenario(Px) {
  freshPins();
  const b = Px.budget;
  const E = 600;
  for (const [kind, tree, gate] of [["anon-post", TEN, "anon-post"], ["anon-post", HUNDRED, "anon-post"], ["anon-post", PLAIN, "anon-post"], ["persona-launch", PLAIN, "persona-launch"]]) {
    const r = b.reserveBudget("fixture", "anon", E, b.predicateOf(kind, tree, gate));
    assert(r.ok, `${kind} into ${tree} was refused by the device budget: ` + JSON.stringify(r));
  }
  // through the prover too: two reach trees + a launch request in one epoch, all proved
  freshPins();
  for (const req of [anonReq(TEN, 0), anonReq(HUNDRED, 1), { claimKind: "persona-launch", tree: PLAIN, personaId: "anon", gateId: "persona-launch", mode: "fixture", launchCommit: "e".repeat(64) }]) {
    const out = await Px.prove.prepareAndProve(req, proveSnap(req.tree, E, 60, Px));
    assert(out.ok, `${req.claimKind} into ${req.tree} refused: ` + JSON.stringify(out));
  }
  // a NAMED persona's third distinct partition is still an intersection event: refused
  freshPins();
  assert(b.reserveBudget("fixture", "p_x", E, b.predicateOf("tier-membership", PLAIN, "foryou")).ok, "the first partition");
  assert(b.reserveBudget("fixture", "p_x", E, b.predicateOf("attestation", "attest:a.b/c", "attest:a.b/c")).ok, "the second partition");
  const third = b.reserveBudget("fixture", "p_x", E, b.predicateOf("attestation", "attest:a.b/d", "attest:a.b/d"));
  assert(!third.ok && /budget exhausted/.test(third.reason), "a persona's third distinct partition was not refused: " + JSON.stringify(third));
  return "anon: one partition whatever the tree; launch: its own; a persona's 3rd refused";
}
console.log("\nB — the device budget");
await check("B1 anon posts into two reach trees (and the plain one) plus a launch request in one epoch all reserve — directly and through the prover; a named persona's third distinct non-anon partition is still refused", () => budgetScenario(PR));
await mutation("B1 / the tree restored in the anon partition", async () => budgetScenario(await bundle(PROVE_ENTRY, PROVE_MOCKS, { "lib/zk/budget.ts": [['if (claimKind === "anon-post") return `${claimKind}|*|${gateId}`;', ""]] })));

// ================================================================================================ Z — the size
const SUBMIT_MOCKS = {
  "server-only": `export {};`,
  "lib/zk/anon/client": `export function recordAnonSubmission() {}`,
  "lib/zk/anon/pow": `export function solvePow() { return { nonce: "0", ms: 0, attempts: 0 }; }`,
  // PERSONA LAUNCH P7 (the prover's lib/zk/anon/submit.ts asks the relay which channel it is on): the node channel here
  "lib/zk/anon/relay": `export function currentRelay() { return { kind: "direct", async send() { throw new Error("no send"); } }; } export function relayConfig() { return { kind: "direct" }; } export function relayChannel() { return "node"; } export function inBrowserDevice() { return false; }`,
};
const SUB = await bundle(`export * as submit from "@/lib/zk/anon/submit";\nexport * as config from "@/lib/zk/config";\n`, SUBMIT_MOCKS);
function sizeScenario(Sx) {
  const big = (n) => "9".repeat(n);
  const proof = { scheme: "semaphore-v4", merkleTreeDepth: 20, points: Array.from({ length: 8 }, () => big(77)) };
  const pub = { mode: "live", claimKind: "anon-post", tree: HUNDRED, epoch: 99_999_999, merkleTreeRoot: big(77), scope: big(75), message: big(75), personaId: "anon", gateId: "anon-post", challenge: "epoch-99999999", castHash: "a".repeat(64), attributionCommitment: "b".repeat(64), slot: 15, noteHash: "c".repeat(64) };
  const sizes = [];
  // the worst text the validator accepts is 320 UTF-16 units each JSON-escaped to 6 bytes (a control character or a
  // lone surrogate); 3-byte characters, emoji and quotes are cheaper — each must fit
  for (const [name, text] of [["320 control characters (6 bytes each, escaped)", "\u0001".repeat(320)], ["320 lone surrogates", "\ud800".repeat(320)], ["320 three-byte characters", "中".repeat(320)], ["160 four-byte emoji", "\u{1F600}".repeat(160)], ["320 quotes", '"'.repeat(320)]]) {
    assert(text.length <= 320, name + " is longer than the validator allows");
    const env = { v: 1, mode: "live", claimKind: "anon-post", publicInputs: pub, nullifier: big(77), proof, payload: { text, nonce: "d".repeat(32), note: "e".repeat(512) } };
    const body = Sx.submit.paddedBody(env);
    assert(body !== null && body.length === Sx.config.ZK_SUBMIT_BYTES && Sx.config.ZK_SUBMIT_BYTES === 4096, `the worst-case anon post (${name}) does not fit the constant body`);
    sizes.push(Buffer.byteLength(JSON.stringify({ envelope: env, p: "" })));
  }
  const lpub = { mode: "live", claimKind: "persona-launch", tree: "attest:onchain.wallet-age/gt2y", epoch: 99_999_999, merkleTreeRoot: big(77), scope: big(75), message: big(75), personaId: "anon", gateId: "persona-launch", challenge: "epoch-99999999", launchCommit: "a".repeat(64) };
  // launch's max request is 2048 bytes; lib/launch/request.ts keeps its JSON-ESCAPED form within 2300 (its own budget)
  for (const [name, request] of [["a 2048-byte request", "x".repeat(2048)], ["a request whose escaped form is 2300 bytes", '"'.repeat(1150)]]) {
    const env = { v: 1, mode: "live", claimKind: "persona-launch", publicInputs: lpub, nullifier: big(77), proof, payload: { request } };
    assert(Sx.submit.paddedBody(env)?.length === 4096, `the worst-case launch request (${name}) does not fit`);
    sizes.push(Buffer.byteLength(JSON.stringify({ envelope: env, p: "" })));
  }
  // an envelope that cannot fit is refused (null), never sent unpadded
  const over = { v: 1, mode: "live", claimKind: "anon-post", publicInputs: pub, nullifier: big(77), proof, payload: { text: "\u0001".repeat(400), nonce: "d".repeat(32), note: "e".repeat(512) } };
  assert(Sx.submit.paddedBody(over) === null, "an oversize envelope was padded");
  return `largest ${Math.max(...sizes)} of 4096 bytes (anon worst ${Math.max(...sizes.slice(0, 5))}, launch worst ${Math.max(...sizes.slice(5))})`;
}
console.log("\nZ — the constant request size");
await check("Z1 the worst-case anon post (320 escaped characters, the 512-hex note, a live-shaped proof, the longest reach tree, an 8-digit epoch, slot 15) and the worst-case launch request (2048 bytes; 2300 escaped) fit the constant 4096-byte body through paddedBody; an oversize envelope is null — never sent unpadded", () => sizeScenario(SUB));

// ================================================================================================ F — the boost
const BOOST = await bundle(`export * as boost from "@/lib/reach/boost";\n`);
const ctx = (o = {}) => ({ honoured: (id) => id === "fc.reach", floor: 50, census: { epoch: 70, sizes: { [TEN]: 120, [HUNDRED]: 50 } }, ...o });
function labelScenario(Bx) {
  const b = Bx.boost;
  const lab = b.reachLabelFor({ tree: TEN, treeSize: 120, epoch: 70 }, ctx());
  assert(lab && lab.label === "posted by an account with 10k+ followers" && lab.bucket === "gte-10k" && lab.treeSize === 120, JSON.stringify(lab));
  // a row forged with tree_size 49 — no label (so no boost)
  assert(b.reachLabelFor({ tree: HUNDRED, treeSize: 49, epoch: 60 }, ctx()) === null, "a forged 49-member row got a label");
  assert(b.reachLabelFor({ tree: HUNDRED, treeSize: 50, epoch: 60 }, ctx()) !== null, "a 50-member row from another epoch lost its label");
  // the census of the SAME epoch disagrees: no label (the client's own read wins)
  assert(b.reachLabelFor({ tree: TEN, treeSize: 400, epoch: 70 }, ctx()) === null, "a row whose size disagrees with this epoch's census kept its label");
  // an issuer not honoured by key; the plain tree; an unknown tree; a missing size
  assert(b.reachLabelFor({ tree: XTEN, treeSize: 500, epoch: 1 }, ctx()) === null, "an un-honoured issuer got a label");
  for (const row of [{ tree: PLAIN, treeSize: 900 }, { tree: "attest:onchain.foo/gte-10k", treeSize: 900 }, { tree: TEN, treeSize: null }, { tree: TEN }, null]) assert(b.reachLabelFor(row, ctx()) === null, "labelled: " + JSON.stringify(row));
  // no census at all: the recorded size alone decides (A-REACH-LABEL-TRUSTS-TREE-SIZE)
  assert(b.reachLabelFor({ tree: TEN, treeSize: 50, epoch: 70 }, ctx({ census: null })) !== null, "no census: a 50-member row lost its label");
  return "label only for honoured, ≥ floor, census-agreeing rows";
}
// the feed's final sort over a small timeline
const HOUR = 3_600_000;
function timeline(Bx) {
  const lab = (tree, size) => Bx.boost.reachLabelFor({ tree, treeSize: size, epoch: 1 }, ctx({ census: null }));
  const now = 1_800_000_000_000;
  const cards = [
    { id: "seed-new", cast: { hash: "h-seed-new", timestamp: now - 10 * 60_000 } },
    { id: "seed-1h", cast: { hash: "h-seed-1h", timestamp: now - 1 * HOUR - 60_000 } },
    { id: "seed-3h", cast: { hash: "h-seed-3h", timestamp: now - 3 * HOUR } },
    { id: "anon-10k", cast: { hash: "0xanon1", castHash: "c1".repeat(32), anon: true, timestamp: now - 2 * HOUR - 20 * 60_000, reach: lab(TEN, 120) } },
    { id: "anon-plain", cast: { hash: "0xanon2", castHash: "c2".repeat(32), anon: true, timestamp: now - 2 * HOUR } },
    { id: "anon-forged", cast: { hash: "0xanon3", castHash: "c3".repeat(32), anon: true, timestamp: now - 2 * HOUR - 20 * 60_000, reach: lab(HUNDRED, 49) } },
    { id: "anon-100k-quiet", cast: { hash: "0xanon4", castHash: "c4".repeat(32), anon: true, timestamp: now - 2 * HOUR - 20 * 60_000, reach: lab(HUNDRED, 60) } },
    { id: "anon-tie-b", cast: { hash: "0xanon5", castHash: "bb".repeat(32), anon: true, timestamp: now - 5 * HOUR } },
    { id: "anon-tie-a", cast: { hash: "0xanon6", castHash: "aa".repeat(32), anon: true, timestamp: now - 5 * HOUR } },
    { id: "seed-pinned-old", cast: { hash: "h-pin", timestamp: now - 9 * HOUR } },
    { id: "seed-demoted-new", cast: { hash: "h-dem", timestamp: now - 60_000 } },
  ];
  return cards;
}
const sortWith = (Bx, cards, discovery) =>
  [...cards]
    .sort(Bx.boost.makeFinalComparator({ sunk: (c) => c.id === "seed-demoted-new", pinned: (c) => c.id === "seed-pin-old" || c.id === "seed-pinned-old", quiet: (c) => c.id === "anon-100k-quiet", discovery }))
    .map((c) => c.id);
function orderScenario(Bx) {
  const cards = timeline(Bx);
  assert(cards.find((c) => c.id === "anon-forged").cast.reach === null, "the forged 49-member row carries a label");
  const order = sortWith(Bx, cards, true);
  // pinned first, demoted last, the quieted 100k card above only the demoted one (below every un-quieted card)
  assert(order[0] === "seed-pinned-old", "pin is not above the boost: " + order.join(","));
  assert(order.at(-1) === "seed-demoted-new" && order.at(-2) === "anon-100k-quiet", "demote/quiet are not below the boost: " + order.join(","));
  // the 10k+ card (2 h 20 min old, +2 h) sorts as if 20 min old: below the 10-min seed, above the 1-h one
  assert(order.indexOf("anon-10k") > order.indexOf("seed-new") && order.indexOf("anon-10k") < order.indexOf("seed-1h"), "the 10k+ boost is not a 2-hour head start: " + order.join(","));
  // the forged row and the plain anon card got no boost: below the 1 h seed, above the 3 h one
  for (const id of ["anon-forged", "anon-plain"]) assert(order.indexOf(id) > order.indexOf("seed-1h") && order.indexOf(id) < order.indexOf("seed-3h"), `${id} moved: ` + order.join(","));
  // ties between anon cards break on the cast hash: aa… before bb…, c2… before c3…
  assert(order.indexOf("anon-tie-a") < order.indexOf("anon-tie-b") && order.indexOf("anon-plain") < order.indexOf("anon-forged"), "ties are not by cast hash: " + order.join(","));
  // DETERMINISTIC: any input order gives the same output
  for (let i = 0; i < 25; i++) {
    const shuffled = [...cards].sort(() => (randomBytes(1)[0] & 1 ? 1 : -1));
    assert(JSON.stringify(sortWith(Bx, shuffled, true)) === JSON.stringify(order), "a shuffled input sorted differently");
  }
  // DISCOVERY ONLY: on the following surface nobody moves — the 10k+ card sits with the other 2 h anon cards
  const following = sortWith(Bx, cards, false);
  assert(following.indexOf("anon-10k") > following.indexOf("seed-1h"), "the boost applied on the following surface: " + following.join(","));
  // with no label anywhere the comparator IS the old sort (demote, pin, quiet, newest first; equal times keep their order)
  // over the order the feed actually builds: anon cards arrive as the validator lists them — newest first, then by cast
  // hash inside an hour — so for them the hash tie-break and "keep the order they came in" are the same thing
  const anonFirst = (a, b) => (b.cast.timestamp - a.cast.timestamp) || (a.cast.castHash < b.cast.castHash ? -1 : a.cast.castHash > b.cast.castHash ? 1 : 0);
  const plain = [...cards.filter((c) => !c.cast.anon), ...cards.filter((c) => c.cast.anon).sort(anonFirst)].map((c) => ({ ...c, cast: { ...c.cast, reach: null } }));
  const old = [...plain].sort((a, b) => {
    const da = a.id === "seed-demoted-new" ? 1 : 0, db = b.id === "seed-demoted-new" ? 1 : 0;
    if (da !== db) return da - db;
    const pa = a.id === "seed-pinned-old" ? 0 : 1, pb = b.id === "seed-pinned-old" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const qa = a.id === "anon-100k-quiet" ? 1 : 0, qb = b.id === "anon-100k-quiet" ? 1 : 0;
    if (qa !== qb) return qa - qb;
    return (b.cast.timestamp ?? 0) - (a.cast.timestamp ?? 0);
  }).map((c) => c.id);
  assert(JSON.stringify(sortWith(Bx, plain, true)) === JSON.stringify(old), "without labels the order differs from the sort it replaced: " + sortWith(Bx, plain, true).join(",") + " vs " + old.join(","));
  return order.join(" > ");
}
console.log("\nF — the For You boost and its label");
await check("F1 the label: honoured by key, at or above the floor, agreeing with this epoch's census — a row forged with tree_size 49, a disagreeing size, an un-honoured issuer, the plain tree, an unknown tree or no size get none", () => labelScenario(BOOST));
await check("F2 the order: pin above the boost, quiet and demote below it; a 10k+ card gets a 2-hour head start, the forged 49 row and plain anon cards none; anon ties break on the cast hash; 25 shuffled inputs give one order; the following surface is untouched; with no label it is exactly the old sort", () => orderScenario(BOOST));
await mutation("F1 / the label's floor dropped", async () => labelScenario(await bundle(`export * as boost from "@/lib/reach/boost";\n`, {}, { "lib/reach/boost.ts": [["size < ctx.floor) return null;", "size < 0) return null;"]] })));
await mutation("F1 / the census agreement dropped", async () => labelScenario(await bundle(`export * as boost from "@/lib/reach/boost";\n`, {}, { "lib/reach/boost.ts": [["c.sizes[t.tree] !== size) return null;", "false) return null;"]] })));
await mutation("F2 / the boost applied on every surface", async () => orderScenario(await bundle(`export * as boost from "@/lib/reach/boost";\n`, {}, { "lib/reach/boost.ts": [["(o.discovery ? reachBoostMs(c.cast?.reach ?? null) : 0)", "reachBoostMs(c.cast?.reach ?? null)"]] })));
await mutation("F2 / the boost placed above quiet", async () =>
  orderScenario(
    await bundle(`export * as boost from "@/lib/reach/boost";\n`, {}, {
      "lib/reach/boost.ts": [["    const qa = o.quiet(a) ? 1 : 0;\n    const qb = o.quiet(b) ? 1 : 0;\n    if (qa !== qb) return qa - qb;\n    const ea = effective(a);\n    const eb = effective(b);\n    if (ea !== eb) return eb - ea;", "    const ea = effective(a);\n    const eb = effective(b);\n    if (Math.abs(ea - eb) > 3_000_000) return eb - ea;\n    const qa = o.quiet(a) ? 1 : 0;\n    const qb = o.quiet(b) ? 1 : 0;\n    if (qa !== qb) return qa - qb;\n    if (ea !== eb) return eb - ea;"]],
    })
  )
);
await mutation("F2 / ties left to the input order", async () => orderScenario(await bundle(`export * as boost from "@/lib/reach/boost";\n`, {}, { "lib/reach/boost.ts": [["return ka < kb ? -1 : ka > kb ? 1 : 0;", "return 0;"]] })));

// ================================================================================================ I — the issuers, the facts, the held cache
const ISSUER_MOCKS = {
  "server-only": `export {};`,
  "lib/zk/validatorClient": `export async function fetchEpoch() { return { epoch: globalThis.__RI.epoch, epochMs: 21600000, msRemaining: 1000000 }; }
export async function fetchIssuers() { throw new Error("no validator in this harness"); } export async function registerIssuerOnValidator() { throw new Error("no validator in this harness"); }
export async function fetchAttestedMap() { throw new Error("no validator in this harness"); } export async function fetchMembers() { throw new Error("no validator in this harness"); } export async function submitAttestations() { throw new Error("no validator in this harness"); }`,
  "lib/platform/storage": `
const F = () => (globalThis.__RIF ??= new Map());
export const storage = { exists: (f) => F().has(f), readText: (f) => { if (!F().has(f)) throw new Error("ENOENT " + f); return F().get(f); }, writeText: (f, s) => { F().set(f, s); }, list: () => [] };`,
  // a family key's public half is sha256("pub-" + id) — 64 hex, so the subscriber's PINNED honour patterns can match it
  "lib/attest/issuerKey": `import { createHash } from "node:crypto";
const pub = (id) => createHash("sha256").update("pub-" + id).digest("hex");
export function issuerKeyFor(id) { return { id, privHex: "00", pubHex: pub(id) }; } export function signWithKey(rec, canonical) { return "sig:" + rec.id + ":" + canonical.length; }
export function issuerKey(id) { return issuerKeyFor(id); } export function issuerPublicKey(id) { return pub(id); } export function signAsIssuer(id, canonical) { return "sig:" + id + ":" + canonical.length; }`,
  "lib/fc/personaFid": `export async function connectedRecords() { const r = globalThis.__RI.connected; if (r === "throw") throw new Error("vault: unreadable 9200001"); return r; }`,
  "lib/fc/siwf/flow": `export function siwfGate() { return { ok: globalThis.__RI.siwf === true }; }`,
  "lib/fc/siwf/links": `export async function mainLink() { const l = globalThis.__RI.link; if (l === "throw") throw new Error("accountLinks unreadable"); return l; }`,
  "lib/attest/vault": `export async function myAttestations(mode) { return globalThis.__RI.vault.filter((a) => !mode || a.mode === mode); }`,
};
const ISSUER_ENTRY = `export * as fc from "@/lib/attest/issuers/fcReach";
export * as x from "@/lib/attest/issuers/xReach";
export * as fixture from "@/lib/attest/fid/fixture";
export * as source from "@/lib/attest/fid/source";
export * as held from "@/lib/reach/held";
export * as registry from "@/lib/attest/registry";
export * as subscriber from "@/lib/attest/subscriber";
`;
const RI = (globalThis.__RI = {});
const resetIssuerWorld = () => {
  Object.assign(RI, { epoch: 90, connected: [], siwf: true, link: { fid: 9_200_001, disconnectedAt: null }, vault: [] });
  globalThis.__RIF = new Map();
};
resetIssuerWorld();
process.env.ZK_DEV_HOOKS = "true";
const I = await bundle(ISSUER_ENTRY, ISSUER_MOCKS);
const subjectOf = (commitment, o = {}) => ({ mode: "fixture", commitment, ...o });
const PUBKEY = (id) => sha("pub-" + id);
async function issuerScenario(Ix) {
  resetIssuerWorld();
  Ix.held.resetReachCaches();
  // fid facts: fixture-main is a 100k+ account with a clearing score; an unknown fid is still refused (never a guess)
  const main = await Ix.fixture.fixtureFidFacts.facts(9_200_001);
  assert(main.followerCount === 150_000 && main.score >= 0.7, "fixture-main facts: " + JSON.stringify(main));
  assert((await Ix.fixture.fixtureFidFacts.facts(3)).followerCount === 630336, "a recorded user's follower count");
  let unknown = false;
  try {
    await Ix.fixture.fixtureFidFacts.facts(987654321);
  } catch {
    unknown = true;
  }
  assert(unknown, "an unknown fid got facts");
  // the cohort spread: of 150 decoys, EXACTLY 49 clear the score AND sit in gte-100k, ≥ 50 in gte-10k and gte-1k
  const n = { "gte-1k": 0, "gte-10k": 0, "gte-100k": 0 };
  for (let i = 0; i < 150; i++) {
    const f = Ix.fixture.fixtureFidFacts.cohortFacts("c" + i, i);
    if (f.score < 0.7) continue;
    if (f.followerCount >= 1000) n["gte-1k"]++;
    if (f.followerCount >= 10_000) n["gte-10k"]++;
    if (f.followerCount >= 100_000) n["gte-100k"]++;
  }
  assert(n["gte-100k"] === 49 && n["gte-10k"] >= 50 && n["gte-1k"] >= 50, "the cohort spread: " + JSON.stringify(n));
  // fc.reach: the root's own main (signed in) — nested, three buckets, one family key, the claim never the count
  const r1 = await Ix.fc.fcReachIssuer.issue(subjectOf("111"));
  assert(Array.isArray(r1) && r1.map((a) => a.bucket).join(",") === "gte-1k,gte-10k,gte-100k", "a 100k account: " + JSON.stringify(r1));
  assert(r1.every((a) => a.issuerId === "fc.reach" && a.issuerPubkey === PUBKEY("reach") && !JSON.stringify(a.claim).includes("150000")), "the issuance carries the count or the wrong key");
  assert(r1[0].expiryEpoch === 90 + 1 + 8, "expiry: " + r1[0].expiryEpoch);
  // ONE ACCOUNT PER ROOT: a second root binding the same account is refused
  const r2 = await Ix.fc.fcReachIssuer.issue(subjectOf("222"));
  assert(!Array.isArray(r2) && /one account per identity/.test(r2.reason), "a second root bound the same account: " + JSON.stringify(r2));
  // … while the same root renews
  assert(Array.isArray(await Ix.fc.fcReachIssuer.issue(subjectOf("111"))), "the same root could not renew");
  // the SCORE entry: below 0.7 nothing is issued, in plain words
  Ix.fixture.setFixtureFidOverride(9_200_001, { score: 0.69 });
  const low = await Ix.fc.fcReachIssuer.issue(subjectOf("111"));
  assert(!Array.isArray(low) && /below 0.7/.test(low.reason), "a 0.69 score was issued: " + JSON.stringify(low));
  // followers: 50k → two buckets; 999 → none
  Ix.fixture.setFixtureFidOverride(9_200_001, { followers: 50_000 });
  assert((await Ix.fc.fcReachIssuer.issue(subjectOf("111"))).map((a) => a.bucket).join(",") === "gte-1k,gte-10k", "a 50k account");
  Ix.fixture.setFixtureFidOverride(9_200_001, { followers: 999 });
  assert(/fewer than 1,000/.test((await Ix.fc.fcReachIssuer.issue(subjectOf("111"))).reason), "a 999-follower account");
  Ix.fixture.setFixtureFidOverride(9_200_001, null);
  // CONTROL: only the root's OWN main — a request naming another fid is refused; no main, a disconnected main, an
  // unreadable record: refused (the reason never quotes a fid)
  assert(/Only your own Farcaster account/.test((await Ix.fc.fcReachIssuer.issue(subjectOf("111", { fids: [{ fid: 3, challengeSig: "x" }] }))).reason), "another fid was accepted");
  RI.link = null;
  assert(/Sign in with your Farcaster account first/.test((await Ix.fc.fcReachIssuer.issue(subjectOf("333"))).reason), "no main account was issued");
  RI.link = { fid: 9_200_001, disconnectedAt: 123 };
  assert(/Sign in with your Farcaster account first/.test((await Ix.fc.fcReachIssuer.issue(subjectOf("333"))).reason), "a disconnected main was issued");
  RI.link = "throw";
  const unread = await Ix.fc.fcReachIssuer.issue(subjectOf("333"));
  assert(/Couldn't read your Farcaster account/.test(unread.reason) && !/9200001/.test(unread.reason), "an unreadable record: " + JSON.stringify(unread));
  // the owner service's connected public-self record is the main there (and its disconnect is honoured)
  RI.link = null;
  RI.connected = [{ fid: 9_200_001, origin: "connected", connected: { publicSelf: true, disconnectedAt: null } }];
  assert(Array.isArray(await Ix.fc.fcReachIssuer.issue(subjectOf("111"))), "the connected main was not used");
  RI.connected = [{ fid: 9_200_001, origin: "connected", connected: { publicSelf: true, disconnectedAt: 5 } }];
  assert(!Array.isArray(await Ix.fc.fcReachIssuer.issue(subjectOf("111"))), "a disconnected connected main was used");
  RI.connected = "throw";
  assert(/Couldn't read/.test((await Ix.fc.fcReachIssuer.issue(subjectOf("111"))).reason), "an unreadable vault was not refused");
  RI.connected = [];
  RI.link = { fid: 9_200_001, disconnectedAt: null };
  // the decoy cohort (dev hooks, fixture only) by index
  const c0 = await Ix.fc.fcReachIssuer.issue(subjectOf("999", { cohort: true, cohortIndex: 1 }));
  assert(Array.isArray(c0) && c0.length === 3, "cohort index 1 is a 100k decoy: " + JSON.stringify(c0));
  // x.reach: fixture-main's verified handle at 42k → two buckets; live facts → refused, nothing issued
  const xr = await Ix.x.xReachIssuer.issue(subjectOf("111"));
  assert(Array.isArray(xr) && xr.map((a) => a.bucket).join(",") === "gte-1k,gte-10k" && xr[0].issuerId === "x.reach", "x.reach: " + JSON.stringify(xr));
  Ix.source.setFidSourceOverride("live");
  assert(/xAI/.test((await Ix.x.xReachIssuer.issue(subjectOf("111"))).reason), "x.reach issued on live facts");
  Ix.source.setFidSourceOverride(null);
  // the registry holds both; the default honour list pins each by EXACT id to the reach key
  assert(Ix.registry.builtinIssuer("fc.reach")?.publicKey === PUBKEY("reach") && Ix.registry.builtinIssuer("x.reach")?.publicKey === PUBKEY("reach"), "the registry lacks a reach issuer");
  assert(Ix.subscriber.isHonoredIssuer("fc.reach", PUBKEY("reach")) && Ix.subscriber.isHonoredIssuer("x.reach", PUBKEY("reach")), "a reach issuer is not honoured by default");
  assert(!Ix.subscriber.isHonoredIssuer("fc.reach", PUBKEY("someone-else")) && !Ix.subscriber.isHonoredIssuer("fc.reachx", PUBKEY("reach")) && !Ix.subscriber.isHonoredIssuer("x.reach", PUBKEY("stranger")) && !Ix.subscriber.isHonoredIssuer("fc.reach", null), "honour by id alone, or under another key");
  return "nested; 0.7 entry; own main only; one account per root; cohort 49 in 100k; x.reach fixture only";
}
async function heldScenario(Ix) {
  resetIssuerWorld();
  Ix.held.resetReachCaches();
  // the held cache is filled ONLY by a refresh (the vault) or an issuance — a read before either is empty
  assert(Ix.held.heldReachTrees("fixture", 95).length === 0, "held before any refresh");
  RI.vault = [
    { mode: "fixture", issuerId: "fc.reach", bucket: "gte-10k", issueEpoch: 90, expiryEpoch: 99 },
    { mode: "fixture", issuerId: "fc.reach", bucket: "gte-100k", issueEpoch: 94, expiryEpoch: 103 },
    { mode: "fixture", issuerId: "onchain.wallet-age", bucket: "gt2y", issueEpoch: 90, expiryEpoch: 99 },
    { mode: "live", issuerId: "fc.reach", bucket: "gte-1k", issueEpoch: 90, expiryEpoch: 99 },
  ];
  await Ix.held.refreshHeldReach("fixture");
  // active = issueWindowStart(issueEpoch) <= epoch < expiry: at 95 gte-10k and gte-100k (from 95); at 94 only gte-10k; at 99 only gte-100k
  assert(JSON.stringify(Ix.held.heldReachTrees("fixture", 95).sort()) === JSON.stringify([HUNDRED, TEN].sort()), "at 95: " + Ix.held.heldReachTrees("fixture", 95));
  assert(JSON.stringify(Ix.held.heldReachTrees("fixture", 94)) === JSON.stringify([TEN]), "at 94: " + Ix.held.heldReachTrees("fixture", 94));
  assert(JSON.stringify(Ix.held.heldReachTrees("fixture", 99)) === JSON.stringify([HUNDRED]), "at 99 (gte-10k expired): " + Ix.held.heldReachTrees("fixture", 99));
  assert(Ix.held.heldReachTrees("live", 95).length === 0, "the live universe read the fixture cache (no live refresh ran)");
  await Ix.held.noteReachIssued("fixture", [{ issuerId: "x.reach", bucket: "gte-1k", issueEpoch: 95, expiryEpoch: 104 }]);
  assert(Ix.held.heldReachTrees("fixture", 96).includes("attest:x.reach/gte-1k"), "an issuance was not noted as held from its activation");
  // THE RESET (resetSeed / reloadIdentity / resetZk): arm the cache and both fixture knobs, reset, read back empty
  Ix.fixture.setFixtureFidOverride(9_200_001, { followers: 5 });
  Ix.x.setFixtureXFollowers(9_200_001, 7);
  Ix.held.resetReachCaches();
  assert(Ix.held.heldReachTrees("fixture", 96).length === 0, "the held cache survived the reset");
  assert(Ix.fixture.fixtureFidOverrides().length === 0, "a fid-facts override survived the reset");
  assert((await Ix.x.xReachIssuer.issue(subjectOf("444"))).map((a) => a.bucket).join(",") === "gte-1k,gte-10k", "the X follower override survived the reset");
  return "active window, per universe; reset clears the cache and the knobs";
}
console.log("\nI — the issuers, the fid facts and the held cache");
await check("I1 fid facts (fixture-main 100k+, recorded counts, an unknown fid refused, the cohort spread: exactly 49 in gte-100k); fc.reach: a 100k account gets all three nested buckets under the reach key with no count in the claim; one account per root; the 0.7 score entry; 50k → two buckets, 999 → none; only the root's own main (SIWF link or the connected public self; disconnected or unreadable refused, no fid in the words); cohort by index; x.reach fixture only; registry + default honour by exact id and key", () => issuerScenario(I));
await check("I2 the held cache: filled only by a vault refresh or an issuance; active from issueWindowStart(issueEpoch) until expiry; per universe; resetReachCaches clears it AND the fixture knobs (arm, reset, read back empty)", () => heldScenario(I));
// PERSONA LAUNCH (wave 2 close): in the public site's browser device the reach issuers neither register nor issue
// (the visitor's own key would squat the open registry's "fc.reach" id); other issuers and the server host are unchanged
async function hostOnlyScenario(Ix) {
  const fcI = Ix.registry.builtinIssuer("fc.reach"), xI = Ix.registry.builtinIssuer("x.reach"), other = Ix.registry.builtinIssuer("neynar.score");
  assert(Ix.registry.issuerUnavailableHere("fc.reach") === null, "on a server host fc.reach must stay available");
  const hadWindow = "window" in globalThis;
  globalThis.window = {};
  try {
    for (const iss of [fcI, xI]) {
      const r = await Ix.registry.ensureRegistered(iss, "fixture"); // the harness's registerIssuerOnValidator THROWS if reached
      assert(r.status === 403 && r.json?.code === "issuer_not_here" && /public site/.test(String(r.json?.error)), iss.id + " registered inside the browser device: " + JSON.stringify(r));
    }
    assert(typeof Ix.registry.issuerUnavailableHere("fc.reach") === "string" && Ix.registry.issuerUnavailableHere("x.reach"), "the reach issuers are not host-only");
    assert(other && Ix.registry.issuerUnavailableHere(other.id) === null, "a non-reach issuer was blocked in the device");
  } finally {
    if (!hadWindow) delete globalThis.window;
  }
  return "fc.reach and x.reach refuse to register in the browser device (403 issuer_not_here, the validator never asked); other issuers and the server host unchanged";
}
await check("I3 HOST-ONLY: in the public site's browser device fc.reach and x.reach refuse to register (403 issuer_not_here, the validator is never asked) — a visitor's own key cannot claim the open registry's reach ids; on a server host and for other issuers nothing changes", () => hostOnlyScenario(I));
/** PERSONA LAUNCH wave 3 (L3): the rig's cohort (scripts/accept-reach.mjs seeds 300) is spread for the BAND rule too */
function cohortBandScenario(Ix) {
  const n = { "gte-1k": 0, "gte-10k": 0, "gte-100k": 0, under: 0, failed: 0 };
  for (let i = 0; i < 300; i++) {
    const f = Ix.fixture.fixtureFidFacts.cohortFacts("c" + i, i);
    if (f.score < 0.7) {
      n.failed++;
      continue;
    }
    if (f.followerCount >= 100_000) n["gte-100k"]++;
    if (f.followerCount >= 10_000) n["gte-10k"]++;
    if (f.followerCount >= 1000) n["gte-1k"]++;
    else n.under++;
  }
  assert(n["gte-100k"] === 49 && n["gte-10k"] === 120 && n["gte-1k"] === 180 && n.under === 90 && n.failed === 30, "the 300-decoy spread: " + JSON.stringify(n));
  // with the rig's root at 50k (gte-1k + gte-10k) and at 150k (all three): every band at least the floor of 50
  const t = TR.trees;
  for (const [label, sizes] of [["50k", { [ONE]: 181, [TEN]: 121, [HUNDRED]: 49 }], ["150k", { [ONE]: 181, [TEN]: 121, [HUNDRED]: 50 }]]) {
    // the plain anon tree on the rig is tier-2: about 270 of the 300 decoys (validator/zk.js seeds a tenth at tier 1) —
    // judged here at 240, well under that, and gte-1k (181) still leaves 59 beyond it
    const chain = t.offerableChain({ floor: 50, plainSize: 240, census: census(sizes) });
    assert(chain.get(ONE) === null && chain.get(TEN) === null && chain.get(HUNDRED) === (label === "50k" ? "floor" : null), `the rig's tiers at ${label}: ` + JSON.stringify([...chain]));
  }
  return JSON.stringify(n);
}
await check("I4 L3: the rig's 300-decoy cohort is spread for the band rule — exactly 49 in gte-100k, 120 in gte-10k, 180 in gte-1k, 90 under 1k and 30 failing the score — so with the root at 50k or 150k every offered tier leaves the floor in the band below it", () => cohortBandScenario(I));
await mutation("I4 / the wave-2 spread (every decoy past the first 120 at 2.5k)", async () => cohortBandScenario(await bundle(ISSUER_ENTRY, ISSUER_MOCKS, { "lib/attest/fid/fixture.ts": [["return j < 49 ? 150_000 : j < 120 ? 25_000 : j < 180 ? 2_500 : 500;", "return j < 49 ? 150_000 : j < 120 ? 25_000 : 2_500;"]] })));
await mutation("I3 / the browser-device refusal dropped", async () => hostOnlyScenario(await bundle(ISSUER_ENTRY, ISSUER_MOCKS, { "lib/attest/registry.ts": [["if (typeof window !== \"undefined\" && HOST_ONLY_ISSUERS.has(issuerId))", "if (false)"]] })));
await mutation("I1 / one account per root dropped (boundElsewhere skipped)", async () => issuerScenario(await bundle(ISSUER_ENTRY, ISSUER_MOCKS, { "lib/attest/issuers/fcReach.ts": [["if (boundElsewhere(FC_REACH_ID, String(fid), subject.commitment, epoch, REACH_VALIDITY_EPOCHS)) {", "if (false) {"]] })));
await mutation("I1 / the score entry dropped", async () => issuerScenario(await bundle(ISSUER_ENTRY, ISSUER_MOCKS, { "lib/attest/issuers/fcReach.ts": [["facts.score < REACH_MIN_SCORE) {", "facts.score < 0) {"]] })));
await mutation("I1 / a request's own fid trusted over the main account", async () => issuerScenario(await bundle(ISSUER_ENTRY, ISSUER_MOCKS, { "lib/attest/issuers/fcReach.ts": [["if (subject.fids && subject.fids.some((p) => Number(p.fid) !== fid)) return", "if (false) return"]] })));
await mutation("I2 / resetReachCaches forgets the fixture knobs", async () => heldScenario(await bundle(ISSUER_ENTRY, ISSUER_MOCKS, { "lib/reach/held.ts": [["gg.__layersFidFactsOverrides?.clear();", ""]] })));
delete process.env.ZK_DEV_HOOKS;

// ================================================================================================ V — the validator, mutated
// The validator's reach guards, run against the REAL validator/zk.js and against in-memory compiled COPIES with one guard
// broken (Module#_compile under the real filename, so its relative requires resolve as the real file's do).
function patchedValidatorZk(edits) {
  const file = path.join(ROOT, "validator", "zk.js");
  let src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error("patch anchor not found in validator/zk.js: " + from.slice(0, 90));
    src = src.split(from).join(to);
  }
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  return m.exports;
}
const VENV = { ZK_DEV_HOOKS: "true", ZK_ANON_POST_TREE: "valid", ZK_ANON_FLOOR: "3", ZK_REACH_FLOOR: "3", ZK_ANON_REACH_ISSUERS: undefined };
const vPrev = {};
for (const [k, v] of Object.entries(VENV)) {
  vPrev[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}
const { createApp } = require(path.join(ROOT, "validator", "server.js"));
const { Identity } = require("@semaphore-protocol/identity");
const { poseidon2 } = require("poseidon-lite");
const { generateKeyPairSync, sign: cryptoSign } = require("node:crypto");
const app = createApp(":memory:");
const server = await new Promise((resolve) => {
  const s = app.app.listen(0, "127.0.0.1", () => resolve(s));
});
const VB = "http://127.0.0.1:" + server.address().port;
const vapi = async (method, p, body) => {
  const r = await fetch(VB + p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
};
const signHex = (c, k) => cryptoSign(null, Buffer.from(c, "utf8"), k).toString("hex");
const vField = (domain, c) => (BigInt("0x" + createHash("sha256").update(`layers-zk-field/1|${domain}|${c}`).digest("hex")) >> 8n).toString(10);
const vTag = (canonical, n) => createHash("sha256").update(["layers-zk-fixture/1", canonical, n, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
const anchor = keys();
const reachKeys = keys();
const ROOTID = new Identity("unit-reach-root");
let VEP = null;
try {
  await vapi("POST", "/device/auth-anchor", { pubkey: anchor.pubHex });
  const r = await vapi("POST", "/roots", { fid: 717171, signerUuid: "unit-reach" });
  const c = ROOTID.commitment.toString(10);
  const at = Date.now();
  await vapi("POST", "/zk/register", { mode: "fixture", commitment: c, rootId: r.json.rootId, issuedAt: at, signature: signHex(["layers-zk-register/1", "fixture", c, r.json.rootId, String(at)].join("|"), anchor.privateKey), anchorPubKey: anchor.pubHex });
  // PERSONA LAUNCH wave 3 (L3): 8 decoys — the plain tree (9) leaves the floor of 3 in the band under fc.reach/gte-10k (4)
  await vapi("POST", "/zk/dev/seed-decoys", { mode: "fixture", count: 8 });
  await vapi("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  const ep = (await vapi("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const schema = { type: "object" };
  const reg = { mode: "fixture", id: "fc.reach", displayName: "fc.reach", claimSchema: schema, buckets: ["gte-1k", "gte-10k", "gte-100k"], validityEpochs: 8, pubkey: reachKeys.pubHex };
  await vapi("POST", "/zk/issuers", { ...reg, sig: signHex(["layers-zk-issuer/1", "fixture", "fc.reach", "fc.reach", createHash("sha256").update(JSON.stringify(schema)).digest("hex"), reg.buckets.join(","), "8", reachKeys.pubHex].join("|"), reachKeys.privateKey) });
  // L3: x.reach too, to hold a BAND-breaking pair of its own (gte-1k 5, gte-10k 4: a band of 1 under the floor of 3)
  const xreg = { ...reg, id: "x.reach", displayName: "x.reach" };
  await vapi("POST", "/zk/issuers", { ...xreg, sig: signHex(["layers-zk-issuer/1", "fixture", "x.reach", "x.reach", createHash("sha256").update(JSON.stringify(schema)).digest("hex"), reg.buckets.join(","), "8", reachKeys.pubHex].join("|"), reachKeys.privateKey) });
  const decoy = (i) => new Identity("layers-zk-decoy/" + i).commitment.toString(10);
  const issue = (bucket, list, issuer = "fc.reach") => {
    const parts = list.map((cm) => {
      const a = { issuer, bucket, commitment: cm, claimHash: sha("v|" + issuer + bucket + cm), issuedEpoch: ep, expiresEpoch: ep + 9 };
      return { ...a, sig: signHex(["layers-zk-attest/2", "fixture", a.issuer, a.bucket, a.commitment, a.claimHash, String(a.issuedEpoch), String(a.expiresEpoch)].join("|"), reachKeys.privateKey) };
    });
    const ia = Date.now();
    return vapi("POST", "/zk/attest", { mode: "fixture", attestations: parts, issuedAt: ia, signature: signHex(["layers-zk-attest-submit/1", "fixture", sha(JSON.stringify(parts)), String(ia)].join("|"), anchor.privateKey), anchorPubKey: anchor.pubHex });
  };
  await issue("gte-10k", [c, decoy(0), decoy(1), decoy(2)]);
  await issue("gte-100k", [c, decoy(0)]);
  await issue("gte-1k", [c, decoy(0), decoy(1), decoy(2), decoy(3)], "x.reach");
  await issue("gte-10k", [c, decoy(0), decoy(1), decoy(2)], "x.reach");
  await vapi("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  VEP = (await vapi("GET", "/zk/epoch?mode=fixture")).json.epoch;
} catch (e) {
  console.log("  (validator setup failed: " + e.message + ")");
}
async function vEnvelope(tree, slot) {
  const m = (await vapi("GET", "/zk/members?mode=fixture&tree=" + encodeURIComponent(tree))).json;
  const text = "unit reach " + hex(6);
  const nonce = sha("n|" + text).slice(0, 32);
  const castHash = createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex");
  const attr = sha("a|" + text);
  const note = hex(256);
  const noteHash = createHash("sha256").update(Buffer.from(note, "hex")).digest("hex");
  const scopeC = `layers/zk-scope/v1|anon-post/w${VEP}/s${slot}`;
  const challenge = "epoch-" + VEP;
  const pub = { mode: "fixture", claimKind: "anon-post", tree, epoch: VEP, merkleTreeRoot: m.root, scope: vField("scope", scopeC), message: vField("message", ["anon", "anon-post", "cast:" + castHash, "attr:" + attr, "note:" + noteHash, challenge, m.root].join("|")), personaId: "anon", gateId: "anon-post", challenge, castHash, attributionCommitment: attr, slot, noteHash };
  const nullifier = poseidon2([BigInt(vz.semaphoreHash(vField("scope", scopeC))), ROOTID.secretScalar]).toString(10);
  const canonical = ["layers-zk-public/1", pub.mode, pub.claimKind, pub.tree, String(pub.epoch), pub.merkleTreeRoot, pub.scope, pub.message, pub.personaId, pub.gateId, pub.challenge, pub.castHash, pub.attributionCommitment, String(pub.slot), pub.noteHash].join("|");
  return { v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: vTag(canonical, nullifier) }, payload: { text, nonce, note } };
}
async function validatorScenario(impl) {
  assert(VEP !== null, "the validator setup did not complete");
  // every run in a FRESH window (all four slots free), so each step's answer is its own guard's
  await vapi("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  VEP = (await vapi("GET", "/zk/epoch?mode=fixture")).json.epoch;
  // slot 0: the same (window, slot) under two trees — accepted once, then a replay (the tree is not in the scope)
  const first = await vEnvelope(TEN, 0);
  const a = await impl.verifyAndRecord(app.db, first);
  assert(a.status === 200, "an allowed reach tree: " + JSON.stringify(a));
  const second = await vEnvelope("valid", 0);
  assert(second.nullifier === first.nullifier, "the harness built different nullifiers for one slot");
  const b = await impl.verifyAndRecord(app.db, second);
  assert(b.status === 409, "the same slot under another tree was not a replay: " + JSON.stringify(b));
  // slot 1: a tree outside the allowlist (tier-1 — this root IS a leaf of it) is refused by the claim binding
  const t1 = await impl.verifyAndRecord(app.db, await vEnvelope("tier-1", 1));
  assert(t1.status === 400 && /claim binding/.test(t1.json.error), "tier-1 accepted as an anon tree: " + JSON.stringify(t1));
  // slot 2: under the floor (gte-100k has 2 < 3) — refused before the nullifier
  const u = await impl.verifyAndRecord(app.db, await vEnvelope(HUNDRED, 2));
  assert(u.status === 400 && /crowd floor/.test(u.json.error), "an under-floor reach tree: " + JSON.stringify(u));
  // slot 3: L3 THE BAND — x.reach/gte-10k (4) clears the floor, but leaves only 1 in x.reach/gte-1k (5) below it: a
  // gte-1k post would come from that one account — refused before the nullifier
  const band = await vEnvelope(XTEN, 3);
  const bv = await impl.verifyAndRecord(app.db, band);
  assert(bv.status === 400 && /would leave only 1 accounts in attest:x\.reach\/gte-1k below it/.test(bv.json.error), "a band-breaking reach tree: " + JSON.stringify(bv));
  // control: the tier below it (x.reach/gte-1k: 5 of the plain tree's 9, a band of 4) is accepted in the same slot
  const below = await impl.verifyAndRecord(app.db, await vEnvelope("attest:x.reach/gte-1k", 3));
  assert(below.status === 200, "the tier below the band-breaking one was refused: " + JSON.stringify(below));
  return "two trees, one slot: 200 then 409; tier-1 400; under-floor 400; band-breaking 400 (the tier below 200)";
}
console.log("\nV — the validator's reach guards, mutated");
await check("V1 the REAL validator: the same (window, slot) under a reach tree and then the plain tree is accepted once and then a 409 replay; a tree outside the allowlist (tier-1) is refused by the claim binding; a reach tree under the floor is refused (400, crowd floor); L3: a tier that leaves fewer than the floor in the tier below it is refused (400, its band) while that tier below is accepted", () => validatorScenario(vz));
await mutation("V1 / the validator's reach floor removed", async () => validatorScenario(patchedValidatorZk([["if (isReachTree(p.tree) && treeSize < reachFloor())", "if (false)"]])));
await mutation("V1 / the validator's band check removed (L3)", async () => validatorScenario(patchedValidatorZk([["    if (band) return { status: 400, json: { error: anonNote(`anon-post: ${band} — refused`) } };", ""]])));
await mutation("V1 / the validator's band compared against the tier's own size (a band of n - n)", async () => validatorScenario(patchedValidatorZk([["    const band = below - n;", "    const band = n;"]])));
await mutation("V1 / the tree put in the validator's anon scope", async () => validatorScenario(patchedValidatorZk([['p.claimKind === "anon-post" ? anonSlotQualifier(p.epoch, p.slot) :', 'p.claimKind === "anon-post" ? anonSlotQualifier(p.epoch, p.slot) + "|" + p.tree :']])));
await mutation("V1 / the tree allowlist dropped (an un-allowed tree accepted)", async () => validatorScenario(patchedValidatorZk([["const anonTreeAllowed = (tree) => tree === anonPostTree() || isReachTree(tree);", "const anonTreeAllowed = (tree) => true;"]])));
await new Promise((r) => server.close(r));
for (const [k, v] of Object.entries(vPrev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;

// ================================================================================================ R — the picker
// React itself is NOT bundled (react-dom/server needs node's stream): the component is built to CommonJS with React
// external, and loaded with the repo's node_modules on the resolution path, so it renders with the repo's own React
// PERSONA LAUNCH wave 3 (final verify, UXH-12): built from a SOURCE so a mutation can build a broken copy in the temp dir
let pickerBuilds = 0;
async function buildPicker(patches = []) {
  let src = readFileSync(path.join(ROOT, "components/ReachPicker.tsx"), "utf8");
  for (const [a, b] of patches) {
    if (!src.includes(a)) throw new Error("patch anchor not found in components/ReachPicker.tsx: " + a.slice(0, 60));
    src = src.split(a).join(b);
  }
  const n = ++pickerBuilds;
  const entry = path.join(HERE, "ReachPicker-" + n + ".tsx");
  writeFileSync(entry, src);
  const out = path.join(HERE, "picker-" + n + ".cjs");
  await build({ absWorkingDir: ROOT, entryPoints: [entry], outfile: out, bundle: true, format: "cjs", platform: "node", target: ["node20"], jsx: "automatic", tsconfig: path.join(ROOT, "tsconfig.json"), external: ["react", "react/jsx-runtime", "react-dom"], logLevel: "error" });
  process.env.NODE_PATH = path.join(ROOT, "node_modules");
  Module._initPaths();
  const { ReachPicker } = require(out);
  const { renderToStaticMarkup } = require("react-dom/server");
  const { createElement } = require("react");
  return { render: (props) => renderToStaticMarkup(createElement(ReachPicker, { onChange() {}, ...props })) };
}
const PICK = await buildPicker();
function pickerScenario(Px) {
  const offered = [{ tree: TEN, label: "10k+ followers", size: 120 }, { tree: ONE, label: "1k+ followers", size: 135 }];
  const html = Px.render({ offered, value: TEN, plainTree: PLAIN, reason: "Not enough accounts are in the 100k+ tier yet, so your posts are boosted as 10k+." });
  assert(html.includes('data-testid="reach-option-gte-10k"') && html.includes('data-testid="reach-option-gte-1k"') && html.includes('data-testid="reach-option-none"'), "the offered options: " + html.slice(0, 200));
  assert(!html.includes("gte-100k"), "an un-offered (under-floor) tier was rendered");
  assert(/Boost as:/.test(html) && /posted by an account with 10k\+ followers/.test(html) && html.includes("Not enough accounts are in the 100k+ tier yet"), "the words");
  // UXH-12 (wave 3 final verify): the default is the highest tier — the smallest crowd — so its size is said beside it
  assert(html.includes('data-testid="composer-reach-crowd"') && html.includes('data-size="120"') && html.includes("120 accounts are in the 10k+ followers tier: anyone can tell this post came from one of them, never which one."), "UXH-12: the chosen tier's crowd size is not said: " + html.slice(0, 400));
  const lower = Px.render({ offered, value: ONE, plainTree: PLAIN, reason: null });
  assert(lower.includes('data-size="135"') && lower.includes("135 accounts are in the 1k+ followers tier"), "UXH-12: the crowd line does not follow the chosen tier");
  assert(!Px.render({ offered, value: PLAIN, plainTree: PLAIN, reason: null }).includes("composer-reach-crowd"), "UXH-12: a tier's crowd line under no boost");
  assert(!Px.render({ offered: [{ tree: TEN, label: "10k+ followers", size: Number.NaN }], value: TEN, plainTree: PLAIN, reason: null }).includes("composer-reach-crowd"), "UXH-12: a crowd line from a size that is not a number");
  const reasonOnly = Px.render({ offered: [], value: PLAIN, plainTree: PLAIN, reason: "Not enough accounts are in the 1k+ tier yet, so your posts are not boosted." });
  assert(!reasonOnly.includes("reach-option-") && reasonOnly.includes('data-testid="composer-reach-reason"'), "with nothing offered only the reason renders: " + reasonOnly);
  assert(Px.render({ offered: [], value: PLAIN, plainTree: PLAIN, reason: null }) === "", "with nothing to say the picker renders nothing");
  return "only offered tiers; a reason alone; or nothing";
}
console.log("\nR — the picker");
await check("R1 the picker renders exactly the offered tiers plus 'no boost' (never one under the floor), the boost's meaning in plain words, the chosen tier's crowd size (UXH-12), a reason alone when nothing is offered, and nothing at all when there is nothing to say", () => pickerScenario(PICK));
await mutation("R1 / the chosen tier's crowd size is not said (UXH-12)", async () => pickerScenario(await buildPicker([["if (!chosen || typeof chosen.size", "if (true || !chosen || typeof chosen.size"]])));
await mutation("R1 / the crowd line says the DEFAULT tier's size whatever is chosen (UXH-12)", async () => pickerScenario(await buildPicker([["const chosen = value !== plainTree ? offered.find((o) => o.tree === value) : undefined;", "const chosen = value !== plainTree ? offered[0] : undefined;"]])));
await mutation("R1 / a size that is not a number is shown (UXH-12)", async () => pickerScenario(await buildPicker([['typeof chosen.size !== "number" || !Number.isFinite(chosen.size)', "false"]])));

// ================================================================================================ K — the tick publishes once
// PUBLIC GO-LIVE (final verify): lib/zk/prefetch.ts runTick used to make every tree's snapshot cachedSnapshot()'s answer as
// it was read, BEFORE stamping the plain tree's size on it, so a reader landing mid-tick (GET /api/reach, the composer, GET
// /api/anon) met a new-epoch snapshot with no plain size and was offered no reach tier at all ("checked at the next sync").
// accept-reach check 3 caught it under load on the rig (twice). The REAL prefetch module, its network and neighbours mocked:
// a tick blocked inside an extra tree's read must leave the previous tick's complete snapshot as the answer; once it lands,
// the new snapshot carries its own epoch's plain size; a tick that throws after its first read still publishes what it read.
const TICK_MOCKS = {
  "server-only": "export {};",
  "lib/zk/validatorClient": `
const T = () => globalThis.__tickUnit;
export async function fetchEpoch() { return { epoch: T().epoch, startsAt: 0, endsAt: 0 }; }
export async function fetchMembers(mode, tree) {
  if (T().block && tree === T().block.tree) { T().block.entered(); await T().block.release; }
  return { members: T().members[tree] ?? [] };
}
export async function fetchHistory() { return { pubkey: "aa", entries: [] }; }
export async function fetchValidatorKey() { return "bb"; }
export async function fetchAttestBuckets() { return { buckets: [{ issuer: "fc.reach", bucket: "gte-1k", size: 55 }] }; }
export async function fetchIssuers() { return { issuers: [{ id: "fc.reach", pubkey: "cc" }] }; }
export async function fetchAnonPostConfig() { return {}; }
export async function fetchXOutboxConfig() { return {}; }
export async function fetchXOutboxList() { return []; }
`,
  "lib/zk/anon/relay": "export async function anonymousHead() { return null; }",
  "lib/attest/subscriber": "export function isHonoredIssuer() { return true; }",
  "lib/device/bootState": "export function announceZkTick() {}",
  "lib/zk/gate": `
export const gateTree = () => "tier-2";
export const anonPostTree = () => "tier-2";
export const wantedTrees = () => [];
export async function runWantedProofs() { return 0; }
`,
  "lib/zk/identity": "export function promotePendingIdentity() { if (globalThis.__tickUnit.throwAfterGate) throw new Error('a planted failure after the first read'); return false; }",
  "lib/zk/anon/universe": "export function liveUniverseHinted() { return false; }",
  "lib/zk/registration": "export async function registerCommitment() { throw new Error('not on this tick: the live universe is not hinted here'); }",
  "lib/launch/tick": "export async function launchTick() {}",
  "lib/rings/tick": 'export async function ringsTick() { return { drop: "ok", anonList: "ok", publish: "none" }; }',
};
const TICK_ENTRY = `export * as pf from "@/lib/zk/prefetch";\n`;
async function tickScenario(Px) {
  const pf = Px.pf;
  globalThis.__layersZkPrefetch = undefined; // the module keeps its state on globalThis: each bundle starts clean
  const U = (globalThis.__tickUnit = { epoch: 7, members: { "tier-2": ["a", "b", "c"], "attest:fc.reach/gte-1k": ["a"] }, block: null, throwAfterGate: false });
  // tick 1 (epoch 7): complete and stamped
  await pf.prefetchTick("fixture");
  const t1 = pf.cachedSnapshot("fixture");
  assert(t1 && t1.epoch.epoch === 7 && t1.plainSize?.epoch === 7 && t1.plainSize.size === 3, "tick 1 did not publish a stamped snapshot: " + JSON.stringify(t1 && { epoch: t1.epoch, plainSize: t1.plainSize }));
  // tick 2 (epoch 8): blocked inside the extra tree's read, AFTER the gate tree's read
  U.epoch = 8;
  U.members["tier-2"] = ["a", "b", "c", "d"];
  let entered;
  const inside = new Promise((r) => (entered = r));
  let release;
  U.block = { tree: "attest:fc.reach/gte-1k", entered, release: new Promise((r) => (release = r)) };
  const running = pf.prefetchTick("fixture");
  await inside;
  const mid = pf.cachedSnapshot("fixture");
  assert(mid !== null, "mid-tick the cache is empty");
  const midStamped = mid.plainSize && mid.plainSize.epoch === mid.epoch.epoch;
  assert(midStamped, "mid-tick a reader meets a snapshot with no plain size for its epoch (the reach offer then offers nothing): epoch " + mid.epoch.epoch + ", plainSize " + JSON.stringify(mid.plainSize ?? null));
  assert(mid === t1, "mid-tick the answer is not the previous tick's snapshot (epoch " + mid.epoch.epoch + ")");
  release();
  U.block = null;
  await running;
  const t2 = pf.cachedSnapshot("fixture");
  assert(t2 && t2.epoch.epoch === 8 && t2.plainSize?.epoch === 8 && t2.plainSize.size === 4, "tick 2 did not publish its own stamped snapshot: " + JSON.stringify(t2 && { epoch: t2.epoch, plainSize: t2.plainSize }));
  assert(t2.tree === "attest:fc.reach/gte-1k", "the published snapshot is not the last tree read (what the cache held at a tick's end before): " + t2.tree);
  // tick 3 (epoch 9): throws after the gate tree's read — what it read is still the answer, as before
  U.epoch = 9;
  U.throwAfterGate = true;
  const r3 = await pf.prefetchTick("fixture");
  U.throwAfterGate = false;
  const t3 = pf.cachedSnapshot("fixture");
  assert(r3.ok === false && t3 && t3.epoch.epoch === 9 && t3.tree === "tier-2", "a tick that threw after its first read did not leave that read as the answer: " + JSON.stringify({ ok: r3.ok, epoch: t3?.epoch?.epoch, tree: t3?.tree }));
  return "mid-tick: the previous tick's snapshot (epoch 7, stamped); after: epoch 8 stamped (4 members); a throwing tick publishes what it read";
}
console.log("\nK — the tick publishes once (PUBLIC GO-LIVE, final verify)");
await check("K1 a reader landing mid-tick (after the gate tree's read, inside an extra tree's) meets the PREVIOUS tick's complete snapshot, never a new-epoch one with no plain size; the tick then publishes its last-read snapshot once, stamped with its own epoch's plain size; a tick that throws after its first read still publishes what it read", async () => tickScenario(await bundle(TICK_ENTRY, TICK_MOCKS)));
await mutation("K1 / every read published as it lands (the old behaviour: the gate tree's snapshot is the answer before it is stamped)", async () => tickScenario(await bundle(TICK_ENTRY, TICK_MOCKS, { "lib/zk/prefetch.ts": [["const snap = await prefetchOnce(mode, gateTree(), { publish: false });", "const snap = await prefetchOnce(mode, gateTree());"], ["extra[tree] = await prefetchOnce(mode, tree, { publish: false });", "extra[tree] = await prefetchOnce(mode, tree);"]] })));
await mutation("K1 / a tick that throws before publishing publishes nothing", async () => tickScenario(await bundle(TICK_ENTRY, TICK_MOCKS, { "lib/zk/prefetch.ts": [["    if (unpublished) s.snapshots[mode] = unpublished;\n", ""]] })));

// ------------------------------------------------------------------------------------------------ total
console.log(`\n${passed}/${passed + failed} reach unit checks passed${failed ? " — FAILED: " + failures.join("; ") : ""}`);
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 50).unref?.();
