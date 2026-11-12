// PERSONA LAUNCH P3 — node-only unit harness: THE INDEXED ANON SCOPE (D4), PERSONA-SCOPED ANON POSTING and the POST
// MODE (D2). No servers, no ports, no network: the client modules are bundled with esbuild (the repo's devDependency,
// the @/ paths from tsconfig.json) with their stateful neighbours replaced by in-memory mocks, and the validator's own
// functions are required straight from validator/zk.js.
//
//   node scripts/unit-anon-slots.mjs          (npm run test:anon-slots-unit once the verify agent adds the script)
//
// What it proves, in order (every guard also has a MUTATION below — a deliberately broken copy of the module, built in
// a temp directory, never the repo file — whose named check MUST go red, so no check here can pass vacuously):
//   S  SCOPES, BOTH SIDES (a DELIBERATE DUPLICATE pair): for every window and every slot i < K the client's and the
//      validator's anon-post scope strings, their field values and the canonical public inputs are byte-equal; s<K>, a
//      non-integer slot, a negative slot and the BARE w<n> are refused by BOTH; the unqualified client scope (the
//      self-test's) is unchanged and the validator refuses it
//   U  pickFreeSlot draws UNIFORMLY over the free slots (4,000 CSPRNG draws, chi-square) — never lowest-first — and
//      uses the platform CSPRNG, never Math.random
//   B  ONE BUDGET PER PERSON: K posts from two personas are accepted and the (K+1)th is refused 'window' with the
//      plain sentence, BEFORE the reveal secret is minted and with no write; the tick gives the K posts K DISTINCT
//      slots; no persona id on any envelope, every sealed record names its persona; a new window opens a new budget;
//      a forced post re-uses a spent slot (so the VALIDATOR answers replay); persona refusals (Totem only, private,
//      public self, not yours) come before anything is minted
//   K  THE CLIENT NEVER ADOPTS THE VALIDATOR'S K: a snapshot whose K differs refuses composing ('unavailable') and is
//      never proved for (retrying, stage 'slots'); and a source rule over lib/zk + app/api/anon: every slot-choosing
//      call passes ZK_ANON_POST_SLOTS, and a served K appears only in a comparison against it
//   M  POST MODE (D2): the default is anon without an own account and direct with one; explicit private is read
//      without touching the account record; an unreadable account record THROWS (never "anon"); the anon refusals;
//      setPostMode validates before writing, writes keystore → root roster → sealed identity roster in that order, and
//      a failed roster sync is an ERROR (loud), never a quiet success
//   D  deliveryFor answers Totem only, reason post_mode_private, for an EXPLICIT private mode (armed, no account read)
//      and the DEFAULT never changes its answer; PRIV-2: an account-owning persona reaches its own account only by
//      default or in 'direct' — an EXPLICIT 'anon' answers Totem only (post_mode_anon)
//   R  PRIV-1 — A REPLAY IS NEVER "POST IT AGAIN": the status line says "not confirmed" for relayed null/false (only true
//      is green) and never advises re-posting; a forced slot collision that comes back as a replay makes those words
//      refused device-locally ('replayed'), before any mint or write, and still after the submission is pruned
//   P  PRIV-3 — THE SEALED QUEUE IS PRUNED: a tick drops the closed window's settled anon submissions (never the open
//      window's, never a queued one) and keeps every reveal record with how its post ended
//   C  UX-2 — THE RELAY'S OWN CAPS: the live lifetime cap (relayed + pending) and the daily cap make posting unavailable
//      before the post; the validator's cap refusals (read from its source) become plain words; the route asks
//   N  PRIV-2 / UX-3 / PRIV-4 — WHAT THE COMPOSER SAYS: the "by default … stays in Totem" note only when the delivery
//      line agrees and the reason is not deployment-wide; no save moment after an anonymous post
//   L  UX-L1 — A POST DURING A LAUNCH: while a persona's launch is under way (lib/launch/confirm.ts launchUnderWay) its
//      anon post is revealed with the rest, so the line must say so and the post must carry what the line said: a post
//      whose line said "attributed to no one" is refused 'launch' before any mint or write (force too), one whose line
//      said "will be revealed" is accepted and marked; a stale "will be revealed" (no launch now) is refused; unreadable
//      launch state refuses (never fail open); and a source rule over the route and the composer: the launch branch of
//      the audience line comes before "attributed to no one", the post carries the line's claim, the ring line's
//      "Everyone else sees @anon." is not shown during a launch
//   T  PERSONA LAUNCH P7 (UXH-2) — IN A TAB, "membership" ENDS THE POST: a tick whose proof meets stage 'membership'
//      while the gate runs in a browser tab (globalThis.window set) drops the post on the FIRST tick with the plain
//      in-tab sentence that hands the words back (lib/zk/anon/availability.ts anonDroppedInTabSentence) and keeps no
//      reveal secret; the same tick on a server-side device keeps it retrying with its secret
//   V  THE VALIDATOR'S SHAPE KNOBS: relay cadence public 30 min / 30 min spread, rig and owner shape 60 min / 0; the
//      lifetime cap 1 on every non-public shape with the variable unset or blank, none on the public shape unless set;
//      the daily cap's day bucketing over the epoch clock
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = mkdtempSync(path.join(os.tmpdir(), "layers-anon-slots-unit-"));
process.on("exit", () => rmSync(HERE, { recursive: true, force: true }));
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
// the client's K and window are read at module load: the defaults (K = 4, one epoch per window)
for (const k of ["ZK_ANON_POST_SLOTS", "ZK_ANON_POST_WINDOW_EPOCHS", "ZK_ANON_POST_TREE", "ZK_GATE_TIER", "ZK_ANON_POST_DAILY_CAP", "ZK_ANON_POST_LIVE_CAP", "ZK_ANON_RELAY_INTERVAL_MS", "ZK_ANON_RELAY_SPREAD_MS", "LAYERS_WORLD"]) delete process.env[k];

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
/** a MUTATION: the scenario must FAIL against the broken copy */
async function mutation(name, run) {
  let threw = null;
  try {
    await run();
  } catch (e) {
    threw = e;
  }
  await check(`MUTATION ${name} → the check goes red`, async () => {
    assert(threw !== null, "the broken copy PASSED — the check is vacuous");
    // a mutation whose anchor is gone never built a broken copy: that is not red, it is untested
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
    let src = readFileSync(path.join(ROOT, file), "utf8");
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
    name: "anon-slots-mocks",
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

// the validator's own functions (CJS, required as-is)
process.env.ZK_DEV_HOOKS = "true";
const vz = require(path.join(ROOT, "validator", "zk.js"));
delete process.env.ZK_DEV_HOOKS;
const VENTRY = { feature: "anon-post", onePerHuman: true };

// ================================================================================================ S — scopes, both sides
const CLIENT_ENTRY = `export * as scopes from "@/lib/zk/scopes";
export * as slots from "@/lib/zk/anon/slots";
export * as config from "@/lib/zk/config";
export * as hash from "@/lib/zk/hash";
export { canonicalPublicInputs } from "@/lib/zk/transport/types";
`;
const C = await bundle(CLIENT_ENTRY);
const K = C.config.ZK_ANON_POST_SLOTS;

async function scopeParity(Cx) {
  const k = Cx.config.ZK_ANON_POST_SLOTS;
  assert(k === 4 && vz.anonPostSlots() === 4, `K is not 4 on both sides (client ${k}, validator ${vz.anonPostSlots()})`);
  let n = 0;
  for (const epoch of [0, 1, 7, 40, 4095, 123456789]) {
    const w = Cx.config.anonPostWindowOf(epoch);
    for (let i = 0; i < k; i++) {
      const q = Cx.slots.slotQualifier(w, i);
      const c = Cx.scopes.scopeString("anon-post", epoch, undefined, q);
      const v = vz.scopeString(VENTRY, epoch, undefined, vz.anonSlotQualifier(epoch, i));
      assert(c === v, `scope differs at epoch ${epoch} slot ${i}: client ${c} validator ${v}`);
      assert(Cx.hash.fieldOf("scope", c).toString(10) === vz.fieldOf("scope", v), "scope field value differs");
      // PERSONA LAUNCH P4: the canonical tail is …|slot|noteHash — the ring note's hash follows the slot on both sides
      const p = { mode: "fixture", claimKind: "anon-post", tree: "tier-2", epoch, merkleTreeRoot: "7", scope: "1", message: "2", personaId: "anon", gateId: "anon-post", challenge: "epoch-" + epoch, castHash: "a".repeat(64), attributionCommitment: "b".repeat(64), slot: i, noteHash: "c".repeat(64) };
      assert(Cx.canonicalPublicInputs(p) === vz.canonicalPublicInputs(p), "canonical public inputs differ");
      assert(Cx.canonicalPublicInputs(p).endsWith("|" + i + "|" + "c".repeat(64)), "the canonical form does not bind the slot (then the note hash)");
      n++;
    }
    // K slots give K distinct scopes in one window, and the window separates them
    const all = new Set(Array.from({ length: k }, (_, i) => Cx.scopes.scopeString("anon-post", epoch, undefined, Cx.slots.slotQualifier(w, i))));
    assert(all.size === k, "the K slots of a window are not K distinct scopes");
  }
  // a slot-less anon envelope's canonical form is NOT the slot-0 form (the tag cannot be lifted)
  const base = { mode: "fixture", claimKind: "anon-post", tree: "t", epoch: 1, merkleTreeRoot: "1", scope: "1", message: "1", personaId: "anon", gateId: "anon-post", challenge: "epoch-1", castHash: "a".repeat(64), attributionCommitment: "b".repeat(64) };
  assert(Cx.canonicalPublicInputs(base) === vz.canonicalPublicInputs(base) && Cx.canonicalPublicInputs(base) !== Cx.canonicalPublicInputs({ ...base, slot: 0 }), "a missing slot canonicalises like slot 0");
  return `${n} (window, slot) pairs byte-equal`;
}
function bothRefuse(Cx) {
  const k = Cx.config.ZK_ANON_POST_SLOTS;
  for (const q of ["w5", `w5/s${k}`, "w5/s1.5", "w5/s-1", "w5/x1", "5/s1", "w5/s", "w5/s100"]) {
    let c = false;
    let v = false;
    try {
      Cx.scopes.scopeString("anon-post", 5, undefined, q);
    } catch {
      c = true;
    }
    try {
      vz.scopeString(VENTRY, 5, undefined, q);
    } catch {
      v = true;
    }
    assert(c && v, `qualifier ${q}: client ${c ? "refused" : "ACCEPTED"}, validator ${v ? "refused" : "ACCEPTED"}`);
  }
  for (const [w, i] of [["w5", 1.5], ["w5", -1], ["w5", "1"], ["5", 1], ["w5", 100]]) {
    let t = false;
    try {
      Cx.slots.slotQualifier(w, i);
    } catch {
      t = true;
    }
    assert(t, `slotQualifier(${w}, ${JSON.stringify(i)}) did not refuse`);
  }
  // the unqualified client call is the self-test's legacy string; the validator never verifies it
  assert(Cx.scopes.scopeString("anon-post", 5) === "layers/zk-scope/v1|anon-post|5", "the unqualified anon-post scope changed (selftest / accept-z0 rely on it)");
  let vu = false;
  try {
    vz.scopeString(VENTRY, 5, undefined, undefined);
  } catch {
    vu = true;
  }
  assert(vu, "the validator accepted an unqualified anon-post scope");
  // a persona on a onePerHuman scope still fails closed
  let pp = false;
  try {
    Cx.scopes.scopeString("anon-post", 5, "p_x", "w5/s0");
  } catch {
    pp = true;
  }
  assert(pp, "a persona id was accepted on the anon-post scope");
}

console.log("\nS — the indexed scope, both sides");
await check("S1 for every window and slot i < K the client's and the validator's scope strings, field values and canonical public inputs (which bind the slot) are byte-equal", () => scopeParity(C));
await check("S2 s<K>, a non-integer, a negative and a malformed slot and the BARE w<n> are refused by BOTH sides; the unqualified client scope is unchanged and the validator refuses it", () => bothRefuse(C));
await mutation("S2 / client accepts s<K> (the K bound removed from lib/zk/scopes.ts)", async () => {
  const M = await bundle(CLIENT_ENTRY, {}, { "lib/zk/scopes.ts": [["if (slot >= ZK_ANON_POST_SLOTS)", "if (slot >= 99)"]] });
  bothRefuse(M);
});
await mutation("S2 / client accepts the bare w<n> again", async () => {
  const M = await bundle(CLIENT_ENTRY, {}, {
    "lib/zk/scopes.ts": [
      ["if (!ANON_SLOT_QUALIFIER_RE.test(qualifier))", "if (!/^w\\d{1,12}(\\/s\\d{1,2})?$/.test(qualifier))"],
      ['const slot = Number(qualifier.slice(qualifier.indexOf("/s") + 2));', 'const slot = qualifier.includes("/s") ? Number(qualifier.slice(qualifier.indexOf("/s") + 2)) : 0;'],
    ],
  });
  bothRefuse(M);
});
await mutation("S1 / the slot dropped from the client's canonical public inputs", async () => {
  const M = await bundle(CLIENT_ENTRY, {}, { "lib/zk/transport/types.ts": [[', p.slot === undefined || p.slot === null ? "" : String(p.slot), p.noteHash ?? ""] : []),', ', p.noteHash ?? ""] : []),']] });
  await scopeParity(M);
});

// ================================================================================================ U — uniform slot choice
function uniformity(pick) {
  const used = new Set([1]);
  const N = 4000;
  const counts = new Map([[0, 0], [2, 0], [3, 0]]);
  for (let i = 0; i < N; i++) {
    const s = pick(used, 4);
    assert(counts.has(s), `drew slot ${s}, which is not free (used: 1)`);
    counts.set(s, counts.get(s) + 1);
  }
  const e = N / 3;
  const chi2 = [...counts.values()].reduce((a, c) => a + (c - e) ** 2 / e, 0);
  // df = 2: P(chi2 > 27.6) = 1e-6 under uniformity — a sweep never flakes on it, and lowest-first scores 8000
  assert(chi2 < 27.6, `not uniform over the free slots: ${JSON.stringify([...counts])} (chi2 ${chi2.toFixed(1)})`);
  // and a full window has no slot
  assert(pick(new Set([0, 1, 2, 3]), 4) === null, "a full window still gave a slot");
  return `${JSON.stringify(Object.fromEntries(counts))}, chi2 ${chi2.toFixed(2)}`;
}
console.log("\nU — the slot is drawn uniformly over the free ones");
await check("U1 pickFreeSlot: 4,000 CSPRNG draws with slot 1 spent land uniformly on {0, 2, 3} (chi-square, p > 1e-6); a full window gives null", () => uniformity((u, k) => C.slots.pickFreeSlot(u, k)));
await check("U2 the draw is the platform CSPRNG (crypto.getRandomValues, rejection-sampled), never Math.random; slots.ts is pure (no server-only, no process.env, no node: import)", () => {
  const src = readFileSync(path.join(ROOT, "lib/zk/anon/slots.ts"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
  assert(/getRandomValues/.test(code), "slots.ts does not use getRandomValues");
  assert(!/Math\.random/.test(code), "slots.ts uses Math.random");
  assert(!/server-only|process\.env|from "node:/.test(code), "slots.ts is not browser-safe");
  // and csprngIndex itself is uniform over a non-power-of-two range
  const c = [0, 0, 0];
  for (let i = 0; i < 3000; i++) c[C.slots.csprngIndex(3)]++;
  assert(c.every((x) => x > 850 && x < 1150), "csprngIndex(3) is biased: " + JSON.stringify(c));
});
await mutation("U1 / lowest-free-first slot choice", async () => {
  const M = await bundle(CLIENT_ENTRY, {}, { "lib/zk/anon/slots.ts": [["return free[rand(free.length)];", "return free[0];"]] });
  uniformity((u, k) => M.slots.pickFreeSlot(u, k));
});

// ================================================================================================ B / K — the gate
const T = (globalThis.__AS = {});
function resetWorld() {
  Object.assign(T, {
    rep: "zk",
    writeEnabled: false,
    snap: null,
    state: { zkQueue: new Map() },
    persisted: [],
    proveCalls: [],
    sends: [],
    proveFails: null,
    submitOutcome: null,
    // UX-L1: no launch under way unless a scenario says so; the launch state readable
    launching: new Set(),
    launchThrows: false,
    personas: new Map([
      ["p_one", { own: true, kind: "public", handle: "one" }],
      ["p_two", { own: true, kind: "public", handle: "two" }],
      ["p_layers", { own: true, kind: "public", handle: "layersonly", mode: "private" }],
      ["p_priv", { own: true, kind: "private", handle: "privy" }],
      ["p_self", { own: true, kind: "public", handle: "me", publicSelf: true }],
    ]),
  });
  // wave 3: the drain's record of the last tick's epoch (lib/zk/anon/queue.ts noteCurrentEpoch) is per scenario too
  globalThis.__layersZkCurrentEpoch = {};
}
resetWorld();
const H6 = 6 * 3_600_000;
const snapAt = (epoch, k = 4) => ({ mode: "fixture", tree: "tier-2", epoch: { mode: "fixture", epoch, epochMs: H6, msRemaining: H6 - 60_000 }, members: { mode: "fixture", tree: "tier-2", epoch, root: "1", members: [] }, history: { pubkey: "", entries: [] }, validatorKey: "", anonHead: null, anonHeadError: null, buckets: [], bucketsError: null, issuers: [], anonConfig: { tree: "tier-2", windowEpochs: 1, maxChars: 320, liveRelay: true, fid: 0, slotsPerWindow: k }, anonConfigError: null, fetchedAt: Date.now(), ms: 1 });
const GATE_MOCKS = {
  "server-only": `export {};`,
  // PERSONA LAUNCH P6 (fix LP-4): the device-local crowd pins the tick keeps per true persona — in memory here (the real
  // module reads the keystore directory; scripts/unit-reach.mjs C1 drives the refusal)
  "lib/zk/localPins": `const P = (globalThis.__ASPINS ??= new Map()); export function intersectionFor(m, k) { const v = P.get(m + ":" + k); return v ? [...v] : null; } export function setIntersection(m, k, members) { P.set(m + ":" + k, [...members]); }`,
  // PERSONA LAUNCH P4: the ring note — 256 CSPRNG bytes as 512 hex (a post with no ring), like lib/rings/note.ts randomNote
  "lib/rings/note": `export async function noteForPost() { const b = new Uint8Array(256); globalThis.crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); }`,
  // PERSONA LAUNCH P5: no reach tier is held in this harness (scripts/unit-reach.mjs drives the reach path)
  "lib/reach/held": `export function heldReachTrees() { return []; } export async function refreshHeldReach() { return { trees: () => [], error: null }; } export function resetReachCaches() {}`,
  // PERSONA LAUNCH P6: the launch track's outcome log
  // PERSONA LAUNCH P6 (UX-L1): is a persona's launch under way — T.launching (persona ids); T.launchThrows: unreadable
  "lib/launch/confirm": `export function noteLaunchOutcome() {}
export async function launchUnderWay(id) { const T = globalThis.__AS; if (T.launchThrows) throw new Error("the sealed queue did not open"); return T.launching.has(id); }`,
  "lib/adapters/registry": `export function currentRepImpl() { return globalThis.__AS.rep; } export function setRepImplOverride() {}`,
  "lib/attest/subscriber": `export function isHonoredIssuer() { return false; } export function setHonoredIssuersOverride() {}`,
  "lib/attest/proven": `export function clearProvenAttestations() {} export async function refreshProvenAttestations() { return {}; }`,
  "lib/attest/onboarding": `export function clearsOnboarding() { return { clears: false, by: null }; }`,
  "lib/zk/validatorClient": `export async function fetchEligibilityMap() { return {}; } export async function fetchEpoch() { const s = globalThis.__AS.snap; if (!s) throw new Error("no epoch in this harness"); return s.epoch; }`,
  "lib/zk/anon/relayAccount": `export const SEED_SELF_FID = 9152; export function relayAccountVerdict() { return { detail: "" }; } export function relayJoinRefusesPosting() { return false; }`,
  "lib/zk/anon/relay": `export function setRelayOverride() {}`,
  "lib/zk/prefetch": `export function cachedSnapshot(mode) { const s = globalThis.__AS.snap; return s && s.mode === mode ? s : null; } export function ensurePrefetchLoop() {} export function resetPrefetch() {}`,
  "lib/zk/privacy": `export async function ownIdentityFacts() { return {}; }`,
  "lib/adapters/neynar/mode": `export function writeEnabled() { return globalThis.__AS.writeEnabled; }`,
  "lib/adapters/mock/store": `
const T = globalThis.__AS;
export async function hydrate() {}
export function state() { return T.state; }
export async function persistNs(ns) { T.persisted.push(ns); }
export const SEED_VIEWER = { personas: ["persona_viewer_main"], activePersonaId: "persona_viewer_main" };
export const personaById = new Map();`,
  // the validator's answer: "accepted" unless a scenario sets T.submitOutcome (a forced slot collision answers "replay")
  "lib/zk/anon/submit": `export async function submitAnonymous(env) { globalThis.__AS.sends.push(env); return { outcome: globalThis.__AS.submitOutcome ?? "accepted" }; }`,
  "lib/identity/keystore": `
export function listPersonas() { return [...globalThis.__AS.personas.entries()].map(([id, p]) => ({ id, handle: p.handle })); }
export function isOwnPersona(id) { return !!globalThis.__AS.personas.get(id)?.own; }`,
  "lib/fc/personaFid": `export async function personaFidMap() { return {}; } export async function personaFidRecord() { return null; }`,
  "lib/identity/keys": `export function fcSignerPublicKeyFor() { return null; } export function signAsFcSignerFor() { return null; }`,
  // the persona refusals, with the REAL rule's shape (lib/identity/postMode.ts is unit-tested on its own in M below)
  "lib/identity/postMode": `
export async function anonPersonaRefusal(id) {
  const p = globalThis.__AS.personas.get(id);
  if (!p || !p.own) return { code: "persona", status: 403, message: "That isn't one of your personas." };
  if (p.publicSelf) return { code: "persona", status: 403, message: "Your Farcaster account is read-only here; switch to a persona" };
  if (p.kind !== "public") return { code: "persona", status: 403, message: "@" + p.handle + " is a private persona" };
  if (p.mode === "private") return { code: "post-mode", status: 409, message: "@" + p.handle + " is set to post in Totem only." };
  return null;
}
export function handleOfPersona(id) { return globalThis.__AS.personas.get(id)?.handle ?? null; }`,
  // the prover: records the request and builds the anon scope with the REAL registry (a bad slot throws there)
  "lib/zk/prove": `
import { scopeString } from "@/lib/zk/scopes";
import { slotQualifier } from "@/lib/zk/anon/slots";
import { anonPostWindowOf } from "@/lib/zk/config";
export async function prepareAndProve(req, snap) {
  const T = globalThis.__AS;
  T.proveCalls.push({ ...req });
  if (T.proveFails) return { ok: false, stage: T.proveFails, reason: "mock refusal" };
  const epoch = snap.epoch.epoch;
  const scope = scopeString("anon-post", epoch, undefined, slotQualifier(anonPostWindowOf(epoch), req.slot));
  return { ok: true, epoch, budget: {}, cohort: {}, envelope: { v: 1, mode: req.mode, claimKind: req.claimKind, nullifier: "n|" + scope,
    publicInputs: { mode: req.mode, claimKind: req.claimKind, tree: req.tree, epoch, merkleTreeRoot: "1", scope, message: "1", personaId: req.personaId, gateId: req.gateId, challenge: "epoch-" + epoch, castHash: req.castHash, attributionCommitment: req.attributionCommitment, slot: req.slot, noteHash: req.noteHash },
    proof: { scheme: "layers-zk-fixture/1", tag: "t" } } };
}`,
};
const GATE_ENTRY = `export * as gate from "@/lib/zk/gate";
export * as config from "@/lib/zk/config";
export * as queue from "@/lib/zk/anon/queue";
export * as attribution from "@/lib/zk/anonAttribution";
export * as outcomes from "@/lib/zk/anon/outcomes";
`;
const G = await bundle(GATE_ENTRY, GATE_MOCKS);

const anonItems = () => [...T.state.zkQueue.values()].filter((q) => q.claimKind === "anon-post");
const secrets = () => [...T.state.zkQueue.values()].filter((q) => q.claimKind === "anon-attribution");

async function budgetScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(40);
  const hashes = [];
  for (const [i, who] of ["p_one", "p_two", "p_one", "p_two"].entries()) {
    const r = await Gx.gate.requestAnonPost(`anonymous post number ${i}`, { personaId: who });
    assert(r.ok, `post ${i} as ${who} refused: ${JSON.stringify(r)}`);
    hashes.push(r.castHash);
  }
  assert(secrets().length === 4, "four posts did not mint four reveal secrets");
  // the (K+1)th — from a persona that has used only two — is refused before anything is minted or written
  const persistedBefore = T.persisted.length;
  const fifth = await Gx.gate.requestAnonPost("the fifth", { personaId: "p_two" });
  assert(!fifth.ok && fifth.code === "window", "the fifth post in the window was not refused 'window': " + JSON.stringify(fifth));
  assert(fifth.reason === "You have used all 4 anonymous posts for this 6-hour window. They are shared across your personas.", "the refusal sentence: " + fifth.reason);
  assert(secrets().length === 4 && T.persisted.length === persistedBefore, "the refused post minted a secret or wrote something");
  // the tick: four DISTINCT slots, from this snapshot; no persona on any envelope; each sealed record names its persona
  const queued = await Gx.gate.runWantedProofs(T.snap, {});
  assert(queued === 4, "the tick did not queue the four posts: " + queued + " " + JSON.stringify(Gx.gate.gateAttempts().slice(-4)));
  const slotsUsed = anonItems().map((q) => q.envelope.publicInputs.slot);
  assert(new Set(slotsUsed).size === 4 && slotsUsed.every((s) => Number.isInteger(s) && s >= 0 && s < 4), "the four posts did not get four distinct slots: " + JSON.stringify(slotsUsed));
  const nulls = new Set(anonItems().map((q) => q.envelope.nullifier));
  assert(nulls.size === 4, "four slots did not give four distinct scopes (nullifier stand-ins)");
  for (const q of anonItems()) {
    const s = JSON.stringify(q.envelope);
    assert(!s.includes("p_one") && !s.includes("p_two"), "a persona id rides an envelope: " + s.slice(0, 160));
    assert(q.envelope.publicInputs.personaId === "anon" && q.personaId === "anon", "the submission names something other than 'anon'");
  }
  const byPersona = (id) => secrets().filter((q) => q.attribution.personaId === id).map((q) => q.id.slice(4)).sort();
  assert(JSON.stringify(byPersona("p_one")) === JSON.stringify([hashes[0], hashes[2]].sort()), "p_one's sealed records are not its two posts");
  assert(JSON.stringify((await Gx.attribution.attributionCastHashesFor("p_two")).sort()) === JSON.stringify([hashes[1], hashes[3]].sort()), "attributionCastHashesFor(p_two) is not p_two's two posts");
  assert(secrets().every((q) => q.personaId === "anon" && q.envelope === null), "a sealed record carries a persona outside its attribution");
  assert((await Gx.queue.anonSlotsUsed("fixture", 40)).size === 4, "anonSlotsUsed does not see the four spent slots");
  // after the tick the window is still full; a NEW window is a new budget
  const after = await Gx.gate.requestAnonPost("still full", { personaId: "p_one" });
  assert(!after.ok && after.code === "window", "a post after the tick was not refused: " + JSON.stringify(after));
  T.snap = snapAt(41);
  const next = await Gx.gate.requestAnonPost("a new window", { personaId: "p_one" });
  assert(next.ok, "the next window refused a post: " + JSON.stringify(next));
  return `slots ${JSON.stringify(slotsUsed)}`;
}
async function forceScenario(Gx) {
  // continues from budgetScenario: window 40 full, window 41 has one wanted post
  await Gx.gate.runWantedProofs(T.snap, {}); // prove the window-41 post
  T.snap = snapAt(40);
  const spent = new Set(anonItems().filter((q) => q.epoch === 40).map((q) => q.envelope.publicInputs.slot));
  const f = await Gx.gate.requestAnonPost("forced past the client", { personaId: "p_one", force: true });
  assert(f.ok, "a forced post was refused by the client: " + JSON.stringify(f));
  await Gx.gate.runWantedProofs(T.snap, {});
  const last = T.proveCalls[T.proveCalls.length - 1];
  assert(last.castHash === f.castHash && spent.has(last.slot), `the forced post did not re-use a spent slot (slot ${last.slot}, spent ${JSON.stringify([...spent])})`);
}
async function personaScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(40);
  const cases = [["p_layers", "post-mode", /set to post in Totem only/], ["p_priv", "persona", /private/], ["p_self", "persona", /read-only here; switch to a persona/], ["p_stranger", "persona", /isn't one of your personas/], ["", "persona", /isn't one of your personas/]];
  for (const [who, code, re] of cases) {
    const r = await Gx.gate.requestAnonPost("as " + who, { personaId: who });
    assert(!r.ok && r.code === code && re.test(r.reason), `${who || "(none)"}: ${JSON.stringify(r)}`);
  }
  assert(secrets().length === 0 && T.persisted.length === 0, "a refused persona minted a secret or wrote something");
  T.rep = "mock";
  const off = await Gx.gate.requestAnonPost("rep off", { personaId: "p_one" });
  assert(!off.ok && off.code === "unavailable" && secrets().length === 0, "posting without the proof layer: " + JSON.stringify(off));
}
async function kMismatchScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(40, 4);
  const ok = await Gx.gate.requestAnonPost("composed while K agreed", { personaId: "p_one" });
  assert(ok.ok, "setup: " + JSON.stringify(ok));
  T.snap = snapAt(40, 8); // the validator now serves K = 8; the client's K is 4
  const r = await Gx.gate.requestAnonPost("composed after it changed", { personaId: "p_one" });
  assert(!r.ok && r.code === "unavailable" && /8/.test(r.reason) && /4/.test(r.reason), "a served K of 8 did not make posting unavailable: " + JSON.stringify(r));
  assert(secrets().length === 1, "the refused post minted a secret");
  const q = await Gx.gate.runWantedProofs(T.snap, {});
  assert(q === 0 && T.proveCalls.length === 0, "a post was proved under a validator whose K differs (slot chosen from it?)");
  const o = Gx.outcomes.anonOutcome(ok.castHash);
  assert(o && o.stage === "retrying" && o.lastStage === "slots", "the wanted post is not retrying at stage 'slots': " + JSON.stringify(o));
}

console.log("\nB — one budget per person, slots at the tick, the persona sealed");
await check("B1 K posts from two personas are accepted; the (K+1)th is refused 'window' with the plain sentence before any secret or write; the tick gives K distinct slots; no persona on any envelope; each sealed record names its persona; a new window opens a new budget", () => budgetScenario(G));
await check("B2 a FORCED post (dev hooks) past a full window re-uses a SPENT slot, so the validator is the one that refuses it as a replay", () => forceScenario(G));
await check("B3 persona refusals come first — Totem only (409 post-mode), private, the read-only public self, not yours, none — and the proof layer off: nothing minted, nothing written", () => personaScenario(G));
await mutation("B1 / the K-per-window refusal removed from requestAnonPost", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (windowFull(used + waiting, ZK_ANON_POST_SLOTS)) return", "if (false) return"]] });
  await budgetScenario(M);
});
await mutation("B1 / the tick ignoring the spent slots (every post of the tick drawn from an empty set, lowest first: all slot 0 — deterministic)", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["const free = pickFreeSlot(used, ZK_ANON_POST_SLOTS);", "const free = pickFreeSlot(new Set(), ZK_ANON_POST_SLOTS, () => 0);"]] });
  await budgetScenario(M);
});
await mutation("B3 / the persona check skipped", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (refusal) return { ok: false, code: refusal.code, reason: refusal.message };", ""]] });
  await personaScenario(M);
});

console.log("\nK — the client never adopts the validator's K");
await check("K1 a snapshot whose K differs from the client's makes composing 'unavailable' (nothing minted) and is never proved for (retrying at stage 'slots')", () => kMismatchScenario(G));
await mutation("K1 / both K comparisons removed from lib/zk/gate.ts", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["servedK !== ZK_ANON_POST_SLOTS", "false"]] });
  await kMismatchScenario(M);
});
/** the SOURCE RULE: every slot-choosing call passes the client's own K, and a served K appears only in a comparison */
function kSourceViolations(files) {
  const out = [];
  for (const [file, src] of files) {
    for (const m of src.matchAll(/\b(pickFreeSlot|freeSlots|windowFull)\(([^;\n]*?)\)/g)) {
      if (/function\s*$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
      const args = m[2].split(",").map((s) => s.trim());
      if (args[args.length - 1] !== "ZK_ANON_POST_SLOTS") out.push(`${file}: ${m[0]} — K is not the client's own`);
    }
    for (const m of src.matchAll(/\bwindowFullSentence\(([^,;\n]*)/g)) if (m[1].trim() !== "ZK_ANON_POST_SLOTS") out.push(`${file}: ${m[0]} — K is not the client's own`);
    src.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*\*)/.test(line) || !/slotsPerWindow|servedK/.test(line)) return;
      const ok = /!==\s*ZK_ANON_POST_SLOTS/.test(line) || /^\s*const servedK\s*=/.test(line) || /slotsPerWindow:\s*ZK_ANON_POST_SLOTS/.test(line) || /^\s*const reason = `[^`]*\$\{servedK\}/.test(line) || /^\s*return \{ ok: false, code: "unavailable", reason: `[^`]*\$\{servedK\}/.test(line);
      if (!ok) out.push(`${file}:${i + 1}: a served K used outside a comparison: ${line.trim().slice(0, 120)}`);
    });
  }
  return out;
}
const K_FILES = ["lib/zk/gate.ts", "lib/zk/prove.ts", "lib/zk/anon/queue.ts", "lib/zk/anonAttribution.ts", "app/api/anon/route.ts"];
await check("K2 SOURCE RULE over lib/zk/{gate,prove,anonAttribution,anon/queue}.ts and app/api/anon/route.ts: every pickFreeSlot / freeSlots / windowFull / windowFullSentence call passes ZK_ANON_POST_SLOTS, and a served K (slotsPerWindow / servedK) appears only in a comparison against it", () => {
  const files = K_FILES.map((f) => [f, readFileSync(path.join(ROOT, f), "utf8")]);
  const calls = files.reduce((n, [, s]) => n + (s.match(/\bpickFreeSlot\(/g) ?? []).length, 0);
  assert(calls >= 1, "no pickFreeSlot call found — the rule would pass over nothing");
  const v = kSourceViolations(files);
  assert(v.length === 0, v.join(" | "));
  return `${calls} pickFreeSlot call(s) checked`;
});
await mutation("K2 / the tick choosing slots with the served K", async () => {
  const src = readFileSync(path.join(ROOT, "lib/zk/gate.ts"), "utf8");
  const bad = src.replace("const free = pickFreeSlot(used, ZK_ANON_POST_SLOTS);", "const free = pickFreeSlot(used, servedK ?? ZK_ANON_POST_SLOTS);");
  assert(bad !== src, "mutation anchor missing");
  const v = kSourceViolations([["lib/zk/gate.ts (mutated)", bad]]);
  assert(v.length === 0, v.join(" | "));
});

// ================================================================================================ T — a tab outside the crowd
// PERSONA LAUNCH P7 (UXH-2, final verify): lib/zk/gate.ts anonRefused — in a TAB stage "membership" is terminal
const TAB_ENTRY = GATE_ENTRY + `export { anonDroppedInTabSentence } from "@/lib/zk/anon/availability";
`;
const GT = await bundle(TAB_ENTRY, GATE_MOCKS);
async function tabMembershipScenario(Gx, inTab) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(40);
  const words = "a post written in a tab that is not in the crowd";
  const r = await Gx.gate.requestAnonPost(words, { personaId: "p_one" });
  assert(r.ok, "setup: " + JSON.stringify(r));
  assert(secrets().length === 1, "setup: no reveal secret was minted");
  T.proveFails = "membership";
  const hadWindow = "window" in globalThis;
  if (inTab && !hadWindow) globalThis.window = {};
  try {
    await Gx.gate.runWantedProofs(T.snap, {});
  } finally {
    if (inTab && !hadWindow) delete globalThis.window;
  }
  assert(T.proveCalls.length === 1, "the tick did not try to prove the post once: " + T.proveCalls.length);
  const o = Gx.outcomes.anonOutcome(r.castHash);
  if (inTab) {
    assert(o && o.stage === "dropped" && o.lastStage === "membership", "in a tab the post did not end at stage 'membership' on the first tick: " + JSON.stringify(o));
    assert(o.reason === Gx.anonDroppedInTabSentence(words), "the in-tab line is not the plain sentence with the words handed back: " + JSON.stringify(o.reason));
    assert(o.reason.includes(words), "the words were not handed back");
    assert(secrets().length === 0, "a post that will never be sent kept its reveal secret");
    assert(anonItems().length === 0, "a dropped post was queued");
    return "dropped on tick 1 with the words handed back; no secret kept";
  }
  assert(o && o.stage === "retrying" && o.lastStage === "membership", "on a server-side device the post did not keep retrying: " + JSON.stringify(o));
  assert(secrets().length === 1, "a retrying post lost its reveal secret");
  return "retrying, secret kept";
}
console.log("\nT — in a tab, a root outside the crowd ends the post at once (UXH-2)");
await check("T1 in a TAB a tick that meets stage 'membership' drops the post on the FIRST tick with the in-tab sentence that hands the words back, and keeps no reveal secret", () => tabMembershipScenario(GT, true));
await check("T2 on a SERVER-SIDE device the same tick keeps the post retrying (registration joins the crowd from the next window)", () => tabMembershipScenario(GT, false));
await mutation("T1 / the in-tab membership branch removed from lib/zk/gate.ts anonRefused", async () => {
  const M = await bundle(TAB_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [['if (stage === "membership" && typeof window !== "undefined") {', "if (false) {"]] });
  await tabMembershipScenario(M, true);
});
await mutation("T2 / the branch made unconditional (a server-side device would drop a post it could still send)", async () => {
  const M = await bundle(TAB_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [['if (stage === "membership" && typeof window !== "undefined") {', 'if (stage === "membership") {']] });
  await tabMembershipScenario(M, false);
});

// ================================================================================================ M — the post mode
const PM = (globalThis.__PM = {});
function resetPM() {
  Object.assign(PM, {
    ks: new Map([
      ["p_nofid", { id: "p_nofid", handle: "nofid", name: "No Fid", kind: "public", avatarUrl: null, bio: null, createdAt: 1 }],
      ["p_fid", { id: "p_fid", handle: "hasfid", name: "Has Fid", kind: "public", avatarUrl: null, bio: null, createdAt: 2 }],
      ["p_lo", { id: "p_lo", handle: "layersonly", name: "LO", kind: "public", postMode: "private", avatarUrl: null, bio: null, createdAt: 3 }],
      ["p_privkind", { id: "p_privkind", handle: "privy", name: "Privy", kind: "private", avatarUrl: null, bio: null, createdAt: 4 }],
      ["p_self", { id: "p_self", handle: "me", name: "Me", kind: "public", publicSelf: true, avatarUrl: null, bio: null, createdAt: 5 }],
    ]),
    fids: new Set(["p_fid"]),
    fidReads: 0,
    fidThrows: false,
    writes: [],
    rootOf: new Map([["p_nofid", "root_a"], ["p_fid", "root_a"], ["p_lo", "root_a"], ["p_privkind", "root_a"]]),
    rosterRecords: new Map(),
    rosterThrows: false,
    syncThrows: false,
    emptyWorld: false,
    real: new Set(),
    sessionRoot: null,
    sessionActive: null,
    acting: "p_nofid",
  });
}
resetPM();
const PM_MOCKS = {
  "server-only": `export {};`,
  "lib/identity/keystore": `
const PM = globalThis.__PM;
export function getPersona(id) { const p = PM.ks.get(id); return p ? { ...p } : null; }
export function isOwnPersona(id) { return PM.ks.has(id); }
export function updatePersona(id, patch) { const p = PM.ks.get(id); if (!p) return null; PM.writes.push(["keystore", id, { ...patch }]); PM.ks.set(id, { ...p, ...patch }); return { ...p, ...patch }; }`,
  "lib/identity/personaKind": `
const PM = globalThis.__PM;
export function kindOf(id) { const p = PM.ks.get(id); if (p) return p.kind === "private" ? "private" : "public"; return id === "persona_viewer_main" ? "public" : "unknown"; }`,
  "lib/adapters/mock/store": `export const SEED_VIEWER = { personas: ["persona_viewer_main"], activePersonaId: "persona_viewer_main" }; export const personaById = new Map([["persona_viewer_main", { handle: "yeak__" }]]);`,
  "lib/world-flag": `export function isEmptyWorld() { return globalThis.__PM.emptyWorld; }`,
  "lib/world": `export function isRealPersona(id) { return globalThis.__PM.real.has(id); }`,
  "lib/fc/personaFid": `
const PM = globalThis.__PM;
export async function personaFidRecord(id) { if (PM.fidThrows) throw new Error("persona↔fid records unavailable (validator answered 503) — refusing rather than treating the vault as empty"); PM.fidReads++; return PM.fids.has(id) ? { personaId: id, fid: 900001, mode: "fixture" } : null; }`,
  "lib/identity/rootRoster": `
const PM = globalThis.__PM;
export async function ownRootId() { return "root_own"; }
export async function rootOfPersona(id) { return PM.rootOf.get(id) ?? null; }
export async function personaRecord(id) { return PM.rosterRecords.get(id) ?? null; }
export async function recordPersona(root, id, rec) { if (PM.rosterThrows) throw new Error("roster unreadable — refusing to seal"); PM.writes.push(["roster", root, id, { ...rec }]); PM.rosterRecords.set(id, { ...rec }); }`,
  "lib/identity/roster": `export async function syncRoster() { const PM = globalThis.__PM; if (PM.syncThrows) throw new Error('vault flush of "identityRoster" was refused by the validator: HTTP 503'); PM.writes.push(["sync"]); }`,
  "lib/session": `export async function getSession() { const PM = globalThis.__PM; return { rootId: PM.sessionRoot, personas: [], active: PM.sessionActive ? { id: PM.sessionActive } : null }; }`,
  "lib/activePersona": `export function activeSeedPersonaId() { return globalThis.__PM.acting; }`,
};
const PM_ENTRY = `export * as pm from "@/lib/identity/postMode";\n`;
const P = await bundle(PM_ENTRY, PM_MOCKS);

async function modeDefaults(Px) {
  resetPM();
  assert((await Px.pm.effectivePostMode("p_nofid")) === "anon", "a persona without its own account does not default to anon (D2)");
  assert((await Px.pm.effectivePostMode("p_fid")) === "direct", "a persona with its own account does not default to direct");
  const reads = PM.fidReads;
  assert((await Px.pm.effectivePostMode("p_lo")) === "private" && PM.fidReads === reads, "an explicit private mode was not answered from the keystore alone");
  assert((await Px.pm.effectivePostMode("p_self")) === null, "the read-only public self has a post mode");
  assert((await Px.pm.effectivePostMode("p_privkind")) === "private", "a private persona's mode is not private");
  PM.fidThrows = true;
  let threw = false;
  try {
    await Px.pm.effectivePostMode("p_nofid");
  } catch {
    threw = true;
  }
  assert(threw, "an unreadable account record defaulted instead of throwing (fail open)");
  PM.fidThrows = false;
  const v = await Px.pm.postModeView("p_fid");
  assert(v.mode === "direct" && v.explicit === false && v.ownAccount === true && JSON.stringify(v.options) === JSON.stringify(["anon", "private", "direct"]) && v.settable, "view: " + JSON.stringify(v));
  const n = await Px.pm.postModeView("p_nofid");
  assert(JSON.stringify(n.options) === JSON.stringify(["anon", "private"]), "a persona without an account is offered 'direct'");
}
async function anonRefusals(Px) {
  resetPM();
  const r = async (id) => Px.pm.anonPersonaRefusal(id);
  assert((await r("p_nofid")) === null && (await r("p_fid")) === null, "a default or direct persona may not post anonymously");
  const lo = await r("p_lo");
  assert(lo && lo.code === "post-mode" && lo.status === 409 && /@layersonly is set to post in Totem only/.test(lo.message), "explicit private: " + JSON.stringify(lo));
  const pk = await r("p_privkind");
  assert(pk && pk.code === "persona" && pk.status === 403, "private persona: " + JSON.stringify(pk));
  const me = await r("p_self");
  assert(me && me.message === "Your Farcaster account is read-only here; switch to a persona", "public self: " + JSON.stringify(me));
  const st = await r("p_stranger");
  assert(st && st.status === 403, "a stranger's persona: " + JSON.stringify(st));
  assert((await r("persona_viewer_main")) === null, "the seeded viewer (the rig's self) may not post anonymously on the demo rig");
  PM.emptyWorld = true;
  assert((await r("persona_viewer_main"))?.status === 403, "under LAYERS_WORLD=empty the seed's persona was treated as the owner's");
  PM.real.add("p_nofid");
  assert((await r("p_nofid")) === null, "under LAYERS_WORLD=empty a REAL persona was refused");
  PM.sessionActive = "p_nofid";
  assert((await Px.pm.defaultPostingPersonaId()) === "p_nofid", "the empty world's default persona is not the session's");
  PM.emptyWorld = false;
  assert((await Px.pm.defaultPostingPersonaId()) === "p_nofid", "the demo world's default persona is not the acting one");
}
async function setModeScenario(Px) {
  resetPM();
  const bad = await Px.pm.setPostMode("p_nofid", "loud");
  assert(!bad.ok && bad.status === 400 && PM.writes.length === 0, "a bad mode: " + JSON.stringify(bad));
  const direct = await Px.pm.setPostMode("p_nofid", "direct");
  assert(!direct.ok && direct.status === 409 && direct.code === "no_account" && PM.writes.length === 0, "'direct' without an own account was not refused before any write: " + JSON.stringify(direct));
  const self = await Px.pm.setPostMode("p_self", "anon");
  assert(!self.ok && self.status === 403 && PM.writes.length === 0, "the public self's mode was settable");
  const seeded = await Px.pm.setPostMode("persona_viewer_main", "private");
  assert(!seeded.ok && seeded.code === "not_in_keystore" && PM.writes.length === 0, "a seeded persona outside the keystore: " + JSON.stringify(seeded));
  const pk = await Px.pm.setPostMode("p_privkind", "anon");
  assert(!pk.ok && pk.code === "private_persona" && PM.writes.length === 0, "a private persona set to anon: " + JSON.stringify(pk));
  const ok = await Px.pm.setPostMode("p_nofid", "private");
  assert(ok.ok && ok.view.mode === "private" && ok.view.explicit === true, "set private: " + JSON.stringify(ok));
  const kinds = PM.writes.map((w) => w[0]).join(",");
  assert(kinds === "keystore,roster,sync", "the writes are not keystore → root roster → identity roster: " + kinds);
  assert(PM.writes[0][2].postMode === "private" && PM.writes[1][1] === "root_a" && PM.writes[1][3].postMode === "private" && PM.writes[1][3].handle === "nofid", "the records do not carry the mode: " + JSON.stringify(PM.writes));
  assert((await Px.pm.effectivePostMode("p_nofid")) === "private", "the explicit mode was not read back");
  const fd = await Px.pm.setPostMode("p_fid", "direct");
  assert(fd.ok && fd.view.mode === "direct", "'direct' with an own account: " + JSON.stringify(fd));
  // no root anywhere: refused BEFORE the keystore is touched
  PM.writes = [];
  PM.rootOf.delete("p_lo");
  let threw = false;
  try {
    await Px.pm.setPostMode("p_lo", "anon");
  } catch {
    threw = true;
  }
  assert(threw && PM.writes.length === 0 && PM.ks.get("p_lo").postMode === "private", "a persona filed under no root was changed anyway");
}
async function loudSync(Px) {
  resetPM();
  PM.syncThrows = true;
  let threw = null;
  try {
    await Px.pm.setPostMode("p_nofid", "private");
  } catch (e) {
    threw = e;
  }
  assert(threw && /identityRoster/.test(threw.message), "a failed sealed-roster sync was a quiet success (the recovery would forget the choice)");
  resetPM();
  PM.rosterThrows = true;
  threw = null;
  try {
    await Px.pm.setPostMode("p_nofid", "private");
  } catch (e) {
    threw = e;
  }
  assert(threw, "a failed root-roster write was a quiet success");
}

console.log("\nM — the post mode (D2)");
await check("M1 defaults: anon without an own account, direct with one; explicit private read from the keystore alone; the public self has none; a private persona is private; an unreadable account record THROWS; the options offer 'direct' only with an account", () => modeDefaults(P));
await check("M2 anon refusals: Totem only (409 post-mode), private, the public self (SIWF's sentence), a stranger; the seed's persona is ours on the demo rig only, real personas under LAYERS_WORLD=empty; the default persona is the acting one (the session's under the empty world)", () => anonRefusals(P));
await check("M3 setPostMode validates BEFORE writing (bad mode, 'direct' without an account, the public self, a demo persona, a private persona set public, no root) and writes keystore → root roster → sealed identity roster with the mode on each", () => setModeScenario(P));
await check("M4 LOUD: a sealed identity roster that refuses the write, or a root roster that cannot be sealed, is an ERROR — never a quiet success", () => loudSync(P));
await mutation("M3 / 'direct' allowed without an own account", async () => {
  const M = await bundle(PM_ENTRY, PM_MOCKS, { "lib/identity/postMode.ts": [['if (mode === "direct" && !(await ownsAccount(personaId))) {', "if (false) {"]] });
  await setModeScenario(M);
});
await mutation("M4 / the sealed roster sync swallowed", async () => {
  const M = await bundle(PM_ENTRY, PM_MOCKS, { "lib/identity/postMode.ts": [["await syncRoster(); // LOUD", "await syncRoster().catch(() => undefined); // LOUD"]] });
  await loudSync(M);
});
await mutation("M1 / the default without an account becomes 'direct'", async () => {
  const M = await bundle(PM_ENTRY, PM_MOCKS, { "lib/identity/postMode.ts": [['return origin !== null ? "direct" : "anon";', 'return "direct";']] });
  await modeDefaults(M);
});

// ================================================================================================ D — deliveryFor
const DL = (globalThis.__DL = {});
function resetDL() {
  Object.assign(DL, {
    armed: true,
    reads: 0,
    ks: new Map([
      ["p_lo", { id: "p_lo", handle: "layersonly", kind: "public", postMode: "private" }],
      ["p_def", { id: "p_def", handle: "default", kind: "public" }],
      ["p_anon", { id: "p_anon", handle: "anonmode", kind: "public", postMode: "anon" }],
      // PRIV-2: personas WITH their own (live, signed) account — the default, and each explicit mode
      ["p_acct", { id: "p_acct", handle: "acctdefault", kind: "public" }],
      ["p_acct_direct", { id: "p_acct_direct", handle: "acctdirect", kind: "public", postMode: "direct" }],
      ["p_acct_anon", { id: "p_acct_anon", handle: "acctanon", kind: "public", postMode: "anon" }],
      ["p_acct_private", { id: "p_acct_private", handle: "acctprivate", kind: "public", postMode: "private" }],
    ]),
  });
}
resetDL();
const DL_MOCKS = {
  "server-only": `export {};`,
  "next/server": `export class NextResponse { static json(obj, init = {}) { return { status: init.status ?? 200, body: obj }; } }`,
  "lib/adapters/mock/store": `export const personaById = new Map(); export async function persistNs() {} export function state() { return { fcAttribution: new Map(), fcWrites: new Map() }; }`,
  "lib/identity/keystore": `export function getPersona(id) { const p = globalThis.__DL.ks.get(id); return p ? { ...p } : null; }`,
  "lib/identity/keys": `export function isViewerPersona(id) { return globalThis.__DL.ks.has(id); } export function signForPersona() { return "sig"; }`,
  "lib/identity/personaKind": `export function kindOf(id) { const p = globalThis.__DL.ks.get(id); return p ? p.kind : "unknown"; }`,
  "lib/adapters/neynar/mode": `export function isLiveContent() { return false; } export function writeEnabled() { return globalThis.__DL.armed; }`,
  "lib/fc/networkMode": `export function personaNetworkMode() { return "per-persona-fid"; }`,
  "lib/fc/personaFid": `
export async function personaFidRecord(id) { globalThis.__DL.reads++; return String(id).startsWith("p_acct") ? { personaId: id, fid: 777001, fname: "acct-one", mode: "live", origin: "minted", signer: { kind: "neynar-managed", uuid: "u-1" } } : null; }
export async function allPersonaFids() { return []; } export async function connectedRecords() { return []; }
export async function ownAccountFidsWithAnon() { return new Set(); } export async function personaOfFid() { return null; }`,
  "lib/fc/writes": `
export class FcIdentityError extends Error {} export class FcRetryCheckError extends Error {} export class FcRetryUnconfirmedError extends Error {}
export const MAIN_UNKNOWN_SENTENCE = "main unknown"; export async function assertOwnFidIdentity() { return { origin: "persona", fid: 777001 }; } export function configuredMainFid() { return null; }
export function fcSimNetworkCasts() { return []; } export function isDefinitiveFailure() { return false; } export function throwawayCreds() { return null; }`,
  "lib/fc/writeLedger": `export class FcWriteCapError extends Error {} export const fcWrites = {};`,
  "lib/fc/attribution": `export function attributionCanonical() { return ""; }`,
  "lib/fc/networkTarget": `export async function isNetworkCastTarget() { return false; } export function isNetworkHashShape() { return false; }`,
  "lib/world-flag": `export function isEmptyWorld() { return false; }`,
  "lib/data": `export function findLocalCast() { return null; }`,
  "lib/adapters/neynar/content": `export class NeynarError extends Error {} export async function liveCast() { throw new NeynarError("no"); }`,
};
const D_ENTRY = `export * as fd from "@/app/api/actions/farcasterDelivery";\n`;
const D = await bundle(D_ENTRY, DL_MOCKS);
async function deliveryScenario(Dx) {
  resetDL();
  const lo = await Dx.fd.deliveryFor("p_lo");
  assert(lo.to === "layers" && lo.reason === "post_mode_private" && lo.message === "Saved in Totem only — @layersonly is set to post in Totem only", "explicit private: " + JSON.stringify(lo));
  assert(DL.reads === 0, "an explicit private mode read the account record");
  const like = Dx.fd.forVerb(lo, "like");
  assert(like.message === "Liked in Totem only — @layersonly is set to post in Totem only", "per verb: " + like.message);
  // the DEFAULT never changes the answer: no account → no_account, exactly as before P3
  const def = await Dx.fd.deliveryFor("p_def");
  assert(def.reason === "no_account", "p_def: the default changed deliveryFor: " + JSON.stringify(def));
  // PRIV-2: a persona WITH its own account reaches it by default and in 'direct' — and in no other mode. An EXPLICIT
  // 'anon' keeps it in Totem (post_mode_anon) without reading the account record: an unticked or failed anon toggle
  // never publishes under the name the owner opted out of
  for (const id of ["p_acct", "p_acct_direct"]) {
    const d = await Dx.fd.deliveryFor(id);
    assert(d.to === "farcaster" && d.fid === 777001, `${id}: the account-owning persona does not reach its own account: ` + JSON.stringify(d));
  }
  DL.reads = 0;
  const an = await Dx.fd.deliveryFor("p_acct_anon");
  assert(an.to === "layers" && an.reason === "post_mode_anon" && an.message === "Saved in Totem only — @acctanon is set to post through @anon", "PRIV-2: an account-owning persona set to 'anon' is not kept in Totem: " + JSON.stringify(an));
  assert(DL.reads === 0, "an explicit anon mode read the account record");
  assert(Dx.fd.forVerb(an, "like").message === "Liked in Totem only — @acctanon is set to post through @anon", "per verb (anon): " + Dx.fd.forVerb(an, "like").message);
  const pr = await Dx.fd.deliveryFor("p_acct_private");
  assert(pr.to === "layers" && pr.reason === "post_mode_private", "an account-owning persona set private: " + JSON.stringify(pr));
  // an explicit anon WITHOUT an account says so too (the persona chose @anon; it is not "missing an account")
  const na = await Dx.fd.deliveryFor("p_anon");
  assert(na.reason === "post_mode_anon", "p_anon (no account, explicit anon): " + JSON.stringify(na));
  // the Composer's PUB-1 check: a post shown as Totem-only that would now go to Farcaster is refused, and vice versa
  assert(Dx.fd.deliveryChanged({ to: "layers", personaId: "p_acct_anon", fid: null }, an) === null, "Totem-only both ways must pass");
  // writes off: Totem only with NO I/O, explicit mode or not
  DL.armed = false;
  DL.reads = 0;
  const off = await Dx.fd.deliveryFor("p_lo");
  assert(off.reason === "writes_off" && DL.reads === 0, "writes off: " + JSON.stringify(off));
}
console.log("\nD — deliveryFor and the post mode");
await check("D1 an EXPLICIT 'private' post mode answers Totem only (post_mode_private, every verb) without reading the account record; PRIV-2: an account-owning persona reaches its own account by default and in 'direct' only — an EXPLICIT 'anon' answers Totem only (post_mode_anon, '@x is set to post through @anon'), no account read; the default is unchanged; writes off stays I/O-free", () => deliveryScenario(D));
await mutation("D1 / the post_mode_private answer removed", async () => {
  const M = await bundle(D_ENTRY, DL_MOCKS, { "app/api/actions/farcasterDelivery.ts": [['if (getPersona(id)?.postMode === "private") return layers("post_mode_private");', ""]] });
  await deliveryScenario(M);
});
await mutation("D1 / PRIV-2: the post_mode_anon answer removed (an account-owning persona in 'anon' publishes on its own account)", async () => {
  const M = await bundle(D_ENTRY, DL_MOCKS, { "app/api/actions/farcasterDelivery.ts": [['if (getPersona(id)?.postMode === "anon") return layers("post_mode_anon");', ""]] });
  await deliveryScenario(M);
});

// ================================================================================================ R — a replay is never "post it again"
// PRIV-1: the status line after a replay, and the device-local guard against sending replayed words again
const VALIDATOR_SRC = readFileSync(path.join(ROOT, "validator", "zk.js"), "utf8");
/** the validator's OWN cap refusal sentences (read from its source: a reworded refusal cannot slip past the mapping) */
const VALIDATOR_CAP_REASONS = [...VALIDATOR_SRC.matchAll(/new Error\("(anon relay refused: [^"]*\((?:ZK_ANON_POST_LIVE_CAP|ZK_ANON_POST_DAILY_CAP)\)[^"]*)"\)/g)].map((m) => m[1]);
const STATUS_MOCKS = {
  react: `export function useEffect() {} export function useState(v) { return [v, () => {}]; }`,
  "react/jsx-runtime": `export function jsx() { return null; } export const jsxs = jsx; export const Fragment = "fragment";`,
};
const STATUS_ENTRY = `export * as st from "@/components/AnonPostStatus";\n`;
const S = await bundle(STATUS_ENTRY, STATUS_MOCKS, {}, { jsx: "automatic" });
async function statusScenario(Sx) {
  assert(VALIDATOR_CAP_REASONS.length === 2, "the validator's two cap refusals were not found in validator/zk.js: " + JSON.stringify(VALIDATOR_CAP_REASONS));
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);
  const timing = { nextTickWithinMs: 750_000, jitterMaxMs: 900_000, relayIntervalMs: 3_600_000, relaySlotJitterMaxMs: 600_000, relaySpreadMs: 0 };
  const replay = (relayed, sentAt = now - 60_000) => Sx.st.describeAnonStatus({ status: "sent", item: { status: "sent", outcome: "replay", notBefore: sentAt - 1000, sentAt }, outcome: null, validatorRefusal: null, relayed, timing }, now);
  const n = replay(null);
  assert(n.tone === "wait", "relayed:null rendered tone '" + n.tone + "' (a failed public-list read read as posted): " + n.text);
  const fresh = replay(false);
  assert(fresh.tone === "wait" && /keeps checking until/.test(fresh.text), "relayed:false inside the relay deadline is not 'not confirmed yet': " + JSON.stringify(fresh));
  const late = replay(false, now - 3 * 3_600_000);
  assert(late.tone !== "ok", "relayed:false past the deadline rendered ok");
  for (const d of [n, fresh, late]) {
    assert(!/^Not posted/.test(d.text), "a replay was concluded 'not posted' from the relayed-only, newest-200 list: " + d.text);
    assert(!/post it again|takes the next free slot/i.test(d.text), "a replay line advises posting again: " + d.text);
    assert(/Don't post the same words again/.test(d.text), "a replay line does not warn against sending the same words: " + d.text);
  }
  const yes = replay(true);
  assert(yes.tone === "ok" && /posted once/.test(yes.text), "relayed:true is not the green 'posted once': " + JSON.stringify(yes));
  // UX-2: the validator's cap refusals, in plain words — no variable name, no "you can post it again"
  for (const reason of VALIDATOR_CAP_REASONS) {
    const d = Sx.st.describeAnonStatus({ status: "sent", item: { status: "sent", outcome: "refused", notBefore: now - 5000, sentAt: now - 1000 }, outcome: null, validatorRefusal: { reason, at: now }, relayed: null, timing }, now);
    assert(d.tone === "bad" && !/[A-Z][A-Z0-9]*_[A-Z0-9_]+/.test(d.text) && !/you can post it again/.test(d.text) && /refused the same way/.test(d.text), "a cap refusal: " + d.text);
  }
  return `null → ${n.tone}, false → ${fresh.tone}/${late.tone}, true → ${yes.tone}`;
}
async function replayWordsScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(40);
  // the window, full: K posts from two personas, proved and accepted
  for (const [i, who] of ["p_one", "p_two", "p_one", "p_two"].entries()) {
    const r = await Gx.gate.requestAnonPost(`filler number ${i}`, { personaId: who });
    assert(r.ok, "setup: filler " + i + " " + JSON.stringify(r));
  }
  await Gx.gate.runWantedProofs(T.snap, {});
  await Gx.queue.drainQueue(Date.now() + 86_400_000, Infinity);
  // a FORCED post re-uses a spent slot: what a second device of this person drawing the same slot is to the validator
  const words = "the words that collided";
  const f = await Gx.gate.requestAnonPost(words, { personaId: "p_one", force: true });
  assert(f.ok, "setup: the forced post " + JSON.stringify(f));
  await Gx.gate.runWantedProofs(T.snap, {});
  T.submitOutcome = "replay";
  await Gx.queue.drainQueue(Date.now() + 86_400_000, Infinity);
  T.submitOutcome = null;
  const item = anonItems().find((q) => q.envelope.publicInputs.castHash === f.castHash);
  assert(item && item.status === "sent" && item.outcome === "replay", "setup: the forced post did not come back as a replay: " + JSON.stringify(item && { status: item.status, outcome: item.outcome }));
  const before = { secrets: secrets().length, persisted: T.persisted.length, wanted: Gx.gate.wantedAnonPosts().length };
  // the same words — plain, forced, re-spaced and re-cased — are refused before anything is minted, wanted or written
  for (const [text, force] of [[words, false], [words, true], ["  The WORDS   that collided ", false]]) {
    const r = await Gx.gate.requestAnonPost(text, { personaId: "p_two", force });
    assert(!r.ok && r.code === "replayed" && /link/.test(r.reason ?? ""), `replayed words were taken again (${JSON.stringify(text)}, force ${force}): ` + JSON.stringify(r));
  }
  assert(secrets().length === before.secrets && T.persisted.length === before.persisted && Gx.gate.wantedAnonPosts().length === before.wanted, "a refused replayed-words post minted, wanted or wrote something");
  // other words are not this guard's business (forced past the full window, the client takes them)
  const other = await Gx.gate.requestAnonPost("entirely different words", { personaId: "p_two", force: true });
  assert(other.ok, "different words were refused: " + JSON.stringify(other));
  // the guard outlives the submission: the window closes, the tick prunes the replayed submission (PRIV-3), and the
  // words are still refused — from the outcome kept on the sealed reveal record
  T.snap = snapAt(41);
  await Gx.gate.runWantedProofs(T.snap, {});
  assert(!anonItems().some((q) => q.envelope.publicInputs.castHash === f.castHash), "setup: the replayed submission was not pruned when its window closed");
  const after = await Gx.gate.requestAnonPost(words, { personaId: "p_one" });
  assert(!after.ok && after.code === "replayed", "after pruning, the replayed words were taken again: " + JSON.stringify(after));
}
console.log("\nR — a replay is never 'post it again' (PRIV-1)");
await check("R1 the status line after a replay: relayed null or false is 'not confirmed' (tone wait, never 'Not posted', never 'post it again', always 'don't post the same words again'); only relayed true is the green 'posted once'; the validator's cap refusals (read from validator/zk.js) are plain words without a variable name and without 'you can post it again'", () => statusScenario(S));
await check("R2 a forced slot collision that comes back as a replay: the same words (plain, forced, re-spaced, re-cased) are refused 'replayed' before any mint, wanted entry or write; other words pass; after the window closes and the submission is pruned, the words are still refused", () => replayWordsScenario(G));
await mutation("R1 / a failed public-list read reads as posted (relayed null → the green line)", async () => {
  const M = await bundle(STATUS_ENTRY, STATUS_MOCKS, { "components/AnonPostStatus.tsx": [["if (s.relayed === true) return { tone: \"ok\"", "if (s.relayed !== false) return { tone: \"ok\""]] }, { jsx: "automatic" });
  await statusScenario(M);
});
await mutation("R1 / the cap refusal shown with 'you can post it again'", async () => {
  const M = await bundle(STATUS_ENTRY, STATUS_MOCKS, { "components/AnonPostStatus.tsx": [["if (r?.cap) return", "if (false) return"]] }, { jsx: "automatic" });
  await statusScenario(M);
});
await mutation("R2 / the replayed-words guard removed from requestAnonPost", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (seen === \"replay\") return { ok: false, code: \"replayed\", reason: REPLAYED_WORDS_SENTENCE };", ""]] });
  await replayWordsScenario(M);
});
await mutation("R2 / the guard forgets a replay once its submission is pruned", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [["} else if (q.claimKind === ATTRIBUTION_KIND && q.attribution?.settled) {", "} else if (false) {"]] });
  await replayWordsScenario(M);
});

// PERSONA LAUNCH wave 3 (L7): words the validator RECEIVED AND REFUSED are refused device-locally too; words of a post
// that never left the device (expired here before it was sent, or a transport error) are not
async function refusedWordsScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(50);
  // (a) refused by the validator after it read the whole envelope
  const words = "words the validator refused";
  const a = await Gx.gate.requestAnonPost(words, { personaId: "p_one" });
  assert(a.ok, "setup: " + JSON.stringify(a));
  await Gx.gate.runWantedProofs(T.snap, {});
  T.submitOutcome = "refused";
  await Gx.queue.drainQueue(Date.now() + 86_400_000, Infinity);
  T.submitOutcome = null;
  const item = anonItems().find((q) => q.envelope.publicInputs.castHash === a.castHash);
  assert(item && item.status === "sent" && item.outcome === "refused", "setup: the post did not come back refused: " + JSON.stringify(item && { s: item.status, o: item.outcome }));
  const before = { secrets: secrets().length, persisted: T.persisted.length, wanted: Gx.gate.wantedAnonPosts().length };
  for (const [text, force] of [[words, false], ["  Words THE validator   refused", true]]) {
    const r = await Gx.gate.requestAnonPost(text, { personaId: "p_two", force });
    assert(!r.ok && r.code === "replayed" && r.reason === Gx.gate.REFUSED_WORDS_SENTENCE, `refused words were taken again (${JSON.stringify(text)}): ` + JSON.stringify(r));
  }
  assert(secrets().length === before.secrets && T.persisted.length === before.persisted && Gx.gate.wantedAnonPosts().length === before.wanted, "the refused-words refusal minted, wanted or wrote something");
  // … and still after the window closes and the submission is pruned (from the outcome kept on the sealed record)
  T.snap = snapAt(51);
  await Gx.gate.runWantedProofs(T.snap, {});
  assert(!anonItems().some((q) => q.envelope.publicInputs.castHash === a.castHash), "setup: the refused submission was not pruned");
  const pruned = await Gx.gate.requestAnonPost(words, { personaId: "p_one" });
  assert(!pruned.ok && pruned.reason === Gx.gate.REFUSED_WORDS_SENTENCE, "after pruning, the refused words were taken again: " + JSON.stringify(pruned));
  // (b) a TRANSPORT error (the channel was never reached three times): nothing was seen — the words are usable
  const tw = "words that never reached the channel";
  const t = await Gx.gate.requestAnonPost(tw, { personaId: "p_one" });
  await Gx.gate.runWantedProofs(T.snap, {});
  T.submitOutcome = "transport-error";
  for (let i = 0; i < 3; i++) await Gx.queue.drainQueue(Date.now() + 86_400_000 + i * 120_000, Infinity);
  T.submitOutcome = null;
  const ti = anonItems().find((q) => q.envelope.publicInputs.castHash === t.castHash);
  assert(ti && ti.status === "refused" && ti.outcome === "transport-error", "setup: " + JSON.stringify(ti && { s: ti.status, o: ti.outcome }));
  const t2 = await Gx.gate.requestAnonPost(tw, { personaId: "p_one", force: true });
  assert(t2.ok, "words that never reached the channel were refused: " + JSON.stringify(t2));
  // (c) EXPIRED on the device before it was sent (its epoch ended): never seen — usable
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(60);
  const ew = "words whose window ended first";
  const e = await Gx.gate.requestAnonPost(ew, { personaId: "p_one" });
  await Gx.gate.runWantedProofs(T.snap, {});
  Gx.queue.noteCurrentEpoch("fixture", 61); // the next tick read a later epoch
  await Gx.queue.drainQueue(Date.now() + 86_400_000, Infinity);
  const ei = anonItems().find((q) => q.envelope.publicInputs.castHash === e.castHash);
  assert(ei && ei.status === "refused" && ei.outcome === "expired" && T.sends.length === 0, "setup: the stale post was not expired unsent: " + JSON.stringify(ei && { s: ei.status, o: ei.outcome, sends: T.sends.length }));
  T.snap = snapAt(61);
  const e2 = await Gx.gate.requestAnonPost(ew, { personaId: "p_one" });
  assert(e2.ok, "the words of a post that never left the device were refused: " + JSON.stringify(e2));
  return "refused words refused (before and after the prune); words of a transport error and of an expired post usable";
}
await check("R3 L7: words whose envelope the validator RECEIVED AND REFUSED are refused 'replayed' with their own plain sentence, before any mint, wanted entry or write — before and after the prune; words that never reached the validator (a transport error, a post expired on the device) are not", () => refusedWordsScenario(G));
/** PERSONA LAUNCH wave 3 (L7): the status line for a post the device EXPIRED before sending, and for one the validator
 *  received and refused — never the channel's bare "refused", and never "post it again" for words the validator has seen */
function expiredLineScenario(Sx) {
  const now = Date.now();
  const timing = { nextTickWithinMs: 750_000, jitterMaxMs: 900_000, relayIntervalMs: 3_600_000, relaySlotJitterMaxMs: 600_000, relaySpreadMs: 0 };
  const line = (item, extra = {}) => Sx.st.describeAnonStatus({ status: item.status, item: { notBefore: now - 5000, sentAt: item.status === "sent" ? now - 1000 : null, ...item }, outcome: null, validatorRefusal: null, relayed: null, timing, ...extra }, now);
  const exp = line({ status: "refused", outcome: "expired" });
  assert(exp.tone === "bad" && exp.text === Sx.st.EXPIRED_NEVER_SENT && /never left this device/.test(exp.text) && !/validator refused/.test(exp.text), "an expired post's line: " + exp.text);
  // the same on the public site's tab (host "tab"): still "never left", not the closed-tab refusal
  assert(line({ status: "refused", outcome: "expired" }, { host: "tab" }).text === Sx.st.EXPIRED_NEVER_SENT, "an expired post in a tab reads as a validator refusal");
  const seen = line({ status: "sent", outcome: "refused" });
  assert(/validator refused it/.test(seen.text) && /write it differently/.test(seen.text) && !/you can post it again/.test(seen.text), "a refused-after-received post invites the same words again: " + seen.text);
  const transport = line({ status: "refused", outcome: "transport-error" });
  assert(/could not be reached three times/.test(transport.text) && /you can post it again/.test(transport.text), "a post that never reached the channel: " + transport.text);
  return "expired → 'never left this device'; received and refused → 'write it differently'; never reached → 'post it again'";
}
await check("R4 L7: the anonymous post's status line says an EXPIRED post never left the device (and may go again), a post the validator received and refused must be written differently (its words are refused now), and one that never reached the channel may be posted again", () => expiredLineScenario(S));
await mutation("R4 / the expired branch dropped from the status line", async () => expiredLineScenario(await bundle(STATUS_ENTRY, STATUS_MOCKS, { "components/AnonPostStatus.tsx": [['    if (i.status === "refused" && i.outcome === "expired") return { tone: "bad", text: EXPIRED_NEVER_SENT };\n', ""]] }, { jsx: "automatic" })));
await mutation("R3 / the refused-words guard removed from requestAnonPost", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (seen === \"refused\") return { ok: false, code: \"replayed\", reason: REFUSED_WORDS_SENTENCE };", ""]] });
  await refusedWordsScenario(M);
});
await mutation("R3 / a validator refusal read as 'never seen'", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [['if (outcome === "refused" || outcome === "malformed") return "refused";', ""]] });
  await refusedWordsScenario(M);
});
await mutation("R3 / an expired (never sent) post's words blocked too", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [['  if (status !== "sent") return null;\n  if (outcome === "replay") return "replay";', '  if (outcome === "replay") return "replay";\n  if (outcome === "expired") return "refused";']] });
  await refusedWordsScenario(M);
});

// ================================================================================================ P — the sealed queue is pruned
// PRIV-3: a closed window's settled anon submissions leave the sealed zkQueue (their outcome stays on the reveal record)
async function pruneScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(40);
  const a = await Gx.gate.requestAnonPost("prune me one", { personaId: "p_one" });
  const b = await Gx.gate.requestAnonPost("prune me two", { personaId: "p_two" });
  await Gx.gate.runWantedProofs(T.snap, {});
  await Gx.queue.drainQueue(Date.now() + 86_400_000, Infinity); // a and b: sent, accepted
  const c = await Gx.gate.requestAnonPost("still queued", { personaId: "p_one" });
  await Gx.gate.runWantedProofs(T.snap, {}); // c: queued, never drained
  assert(a.ok && b.ok && c.ok && anonItems().length === 3, "setup: " + anonItems().length);
  // the window is OPEN: a tick prunes nothing (the slots still count)
  await Gx.gate.runWantedProofs(T.snap, {});
  assert(anonItems().length === 3, "a submission of the OPEN window was pruned — its slot would be free again");
  const sizeBefore = JSON.stringify(Object.fromEntries(T.state.zkQueue)).length;
  // the window CLOSES: the next tick (its own snapshot, nothing wanted) prunes the two settled ones, keeps the queued one
  T.snap = snapAt(41);
  await Gx.gate.runWantedProofs(T.snap, {});
  const left = anonItems().map((q) => q.envelope.publicInputs.castHash);
  assert(left.length === 1 && left[0] === c.castHash, "the closed window's settled submissions were not pruned (or the queued one was): " + JSON.stringify(left));
  assert(secrets().length === 3, "a reveal record was pruned with its submission (the reveal needs it)");
  for (const h of [a.castHash, b.castHash]) {
    const rec = await Gx.queue.attributionRecord(h);
    assert(rec && /^[0-9a-f]+$/.test(rec.secret) && rec.settled && rec.settled.status === "sent" && rec.settled.outcome === "accepted" && typeof rec.settled.sentAt === "number", "how the post ended was not kept on its reveal record: " + JSON.stringify(rec && rec.settled));
  }
  const sizeAfter = JSON.stringify(Object.fromEntries(T.state.zkQueue)).length;
  assert(sizeAfter < sizeBefore, `the sealed queue did not shrink (${sizeBefore} → ${sizeAfter})`);
  assert(JSON.stringify((await Gx.attribution.attributionCastHashesFor("p_one")).sort()) === JSON.stringify([a.castHash, c.castHash].sort()), "the reveal list lost a post after pruning");
  return `${sizeBefore} → ${sizeAfter} bytes of plaintext`;
}
console.log("\nP — the sealed queue is pruned (PRIV-3)");
await check("P1 a tick prunes the CLOSED window's settled anon submissions (never the open window's, never a queued one), keeps every reveal record with how its post ended, and the plaintext shrinks", () => pruneScenario(G));
await mutation("P1 / the tick never prunes", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["await pruneSettledAnonItems(snap.mode, snap.epoch.epoch);", "void pruneSettledAnonItems;"]] });
  await pruneScenario(M);
});
await mutation("P1 / the open window pruned too", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [["if (!Number.isFinite(w) || w >= current) continue;", "if (!Number.isFinite(w)) continue;"]] });
  await pruneScenario(M);
});
await mutation("P1 / the outcome not kept on the reveal record", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [["rec.attribution = { ...rec.attribution, settled: { status: q.status, outcome: q.outcome, sentAt: q.sentAt } };", ""]] });
  await pruneScenario(M);
});

// PERSONA LAUNCH wave 3 (L4): the reveal record — kept for good — holds NO TEXT: its size does not grow with the post's
// words, and a record written before wave 3 is folded to the words hash on the next tick (the replay guard still works)
async function noTextScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(70);
  const short = await Gx.gate.requestAnonPost("short", { personaId: "p_one" });
  const long = await Gx.gate.requestAnonPost("a much longer post ".repeat(15).trim(), { personaId: "p_one" });
  assert(short.ok && long.ok, "setup: " + JSON.stringify({ short, long }));
  const rec = (h) => T.state.zkQueue.get("zka_" + h);
  for (const h of [short.castHash, long.castHash]) {
    const a = rec(h).attribution;
    assert(a.text === "" && /^[0-9a-f]{32}$/.test(a.words ?? ""), "a reveal record keeps its post's text (or no words hash): " + JSON.stringify({ text: a.text, words: a.words }));
  }
  const size = (h) => JSON.stringify({ ...rec(h), id: "x", createdAt: 0, motivatedAt: 0, attribution: { ...rec(h).attribution, secret: "s", commitment: "c" } }).length;
  assert(size(short.castHash) === size(long.castHash), `a reveal record's size follows its words (${size(short.castHash)} vs ${size(long.castHash)} bytes)`);
  assert(!JSON.stringify(Object.fromEntries([...T.state.zkQueue].filter(([k]) => k.startsWith("zka_")))).includes("much longer"), "a post's words are in a sealed reveal record");
  // a PRE-WAVE-3 record (text kept), settled as a replay: the next tick folds it — text gone, words hash in its place —
  // and its words are still refused
  const legacyHash = "77".repeat(32);
  T.state.zkQueue.set("zka_" + legacyHash, { id: "zka_" + legacyHash, mode: "fixture", claimKind: "anon-attribution", personaId: "anon", epoch: 0, envelope: null, notBefore: 0, motivatedAt: 1, createdAt: 1, status: "sent", sentAt: null, outcome: null, attribution: { secret: "ab".repeat(32), commitment: "cd".repeat(32), text: "Legacy  words kept in full", personaId: "p_two", settled: { status: "sent", outcome: "replay", sentAt: 1 } } });
  await Gx.gate.runWantedProofs(T.snap, {});
  const folded = rec(legacyHash).attribution;
  assert(folded.text === "" && folded.words === Gx.queue.anonWordsHash("legacy words kept in full"), "the pre-wave-3 record was not folded: " + JSON.stringify({ text: folded.text, words: folded.words }));
  const again = await Gx.gate.requestAnonPost("legacy WORDS kept in full", { personaId: "p_one", force: true });
  assert(!again.ok && again.code === "replayed", "the folded record's replayed words were taken again: " + JSON.stringify(again));
  // the reveal still reads every secret (by cast hash; no text is needed)
  const secretsOf = await Gx.queue.attributionSecretsFor("p_one", "fixture");
  assert(secretsOf.length === 2 && secretsOf.every((x) => !("text" in x) && /^[0-9a-f]{64}$/.test(x.secret)), "the reveal's secrets: " + JSON.stringify(secretsOf.map((x) => Object.keys(x))));
  return `record size ${size(short.castHash)} bytes for a 5- and a ${"a much longer post ".repeat(15).trim().length}-character post alike; a legacy record folded, its words still refused`;
}
await check("P2 L4: a sealed reveal record keeps NO text — a 5-character and a 284-character post leave records of the same size, carrying only a 128-bit words hash; a record written before wave 3 is folded on the next tick and its replayed words stay refused; the reveal still reads every secret", () => noTextScenario(G));
await mutation("P2 / the reveal record keeping its post's text again", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [['const attribution: SealedAttribution = { secret: rec.secret, commitment: rec.commitment, text: "",', "const attribution: SealedAttribution = { secret: rec.secret, commitment: rec.commitment, text: rec.text,"]] });
  await noTextScenario(M);
});
/**
 * PERSONA LAUNCH wave 3 (L4) — THE SEALED QUEUE'S SIZE IS ONE CONSTANT (lib/adapters/mock/store.ts zkQueuePadTarget): a
 * device with ONE post in its window and a device with sixty lifetime posts plus a full window pad to the same size.
 * The power-of-two classes stepped with lifetime posts (reveal records are kept for good). NON-VACUOUS: the second queue's
 * plaintext is over twice the old first class (16 KiB) — the old padding would have stepped at least twice.
 */
const { createHash: nodeHash } = await import("node:crypto");
const STORE_ENTRY = `export { zkQueuePadTarget, ZKQ_CHUNK } from "@/lib/adapters/mock/store";\n`;
async function constantSizeScenario(Gx, St) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(80);
  const inner = () => JSON.stringify(Object.fromEntries(T.state.zkQueue)).length;
  const one = await Gx.gate.requestAnonPost("x".repeat(300), { personaId: "p_one" });
  assert(one.ok, "setup: " + JSON.stringify(one));
  await Gx.gate.runWantedProofs(T.snap, {});
  const small = inner();
  // sixty lifetime posts later (their sealed reveal records) and a FULL window of in-window submissions
  for (let i = 0; i < 60; i++) {
    const h = nodeHash("sha256").update("lifetime " + i).digest("hex");
    await Gx.queue.putAttributionRecord({ mode: "fixture", castHash: h, secret: h, commitment: h, text: "y".repeat(320), at: i, personaId: i % 2 ? "p_one" : "p_two" });
  }
  for (let i = 0; i < 3; i++) assert((await Gx.gate.requestAnonPost("z".repeat(300) + i, { personaId: "p_two" })).ok, "setup: in-window post " + i);
  await Gx.gate.runWantedProofs(T.snap, {});
  const big = inner();
  assert(big > 2 * 16 * 1024, `the busy queue's plaintext (${big} bytes) is too small to have stepped the old classes twice — the comparison would prove nothing`);
  const a = St.zkQueuePadTarget(small);
  const b = St.zkQueuePadTarget(big);
  assert(a === b && a === St.ZKQ_CHUNK, `the padded size follows the posts: ${small} → ${a} bytes, ${big} → ${b} bytes`);
  // past one chunk it grows by WHOLE chunks (the stated residual), never by a power-of-two class of its own
  assert(St.zkQueuePadTarget(St.ZKQ_CHUNK) === 2 * St.ZKQ_CHUNK && St.zkQueuePadTarget(2 * St.ZKQ_CHUNK - 65) === 2 * St.ZKQ_CHUNK, "the overflow is not whole chunks");
  return `${small} and ${big} plaintext bytes both pad to ${a}`;
}
await check("P3 L4: the sealed queue pads to ONE constant size — one post in its window and sixty lifetime posts plus a full window pad alike (64 KiB); past one chunk it grows by whole chunks", async () => constantSizeScenario(G, await bundle(STORE_ENTRY, { "server-only": `export {};` })));
await mutation("P3 / the power-of-two classes again (lib/adapters/mock/store.ts)", async () =>
  constantSizeScenario(G, await bundle(STORE_ENTRY, { "server-only": `export {};` }, { "lib/adapters/mock/store.ts": [["  return ZKQ_CHUNK * Math.max(1, Math.ceil((innerLength + 64) / ZKQ_CHUNK));", "  let t = 16 * 1024;\n  while (t < innerLength + 64) t *= 2;\n  return t;"]] }))
);
await mutation("P2 / the pre-wave-3 records never folded", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [['    if (typeof a.text === "string" && a.text) {\n      const words = wordsOf(a);', '    if (false) {\n      const words = wordsOf(a);']] });
  await noTextScenario(M);
});

// ================================================================================================ C — the relay's own caps
// UX-2: the lifetime live cap and the daily cap make anon posting unavailable BEFORE the post, in plain words
function capScenario(Cx) {
  const r = Cx.slots.relayCapReason;
  const one = r("live", { cap: 1, relayed: 0, pending: 1 });
  assert(typeof one === "string" && !/[A-Z][A-Z0-9]*_[A-Z0-9_]+/.test(one), "cap 1 with one PENDING row (the owner service after its first post) is not a reason: " + one);
  assert(typeof r("live", { cap: 1, relayed: 1, pending: 0 }) === "string", "cap 1 with one relayed row is not a reason");
  assert(r("live", { cap: 1, relayed: 0, pending: 0 }) === null, "room left was refused");
  // this device's posts the validator has not counted yet (wanted, queued, sent since the read) count too
  assert(typeof r("live", { cap: 1, relayed: 0, pending: 0 }, 1) === "string", "cap 1 with one post of this device on its way is not a reason");
  assert(/tomorrow/.test(r("fixture", { dailyCap: 500, dailyUsed: 499 }, 1) ?? ""), "the daily cap with this device's waiting post is not a reason");
  assert(r("live", { cap: 2, relayed: 0, pending: 0 }, 1) === null, "a waiting post refused with room left");
  assert(r("fixture", { cap: 1, relayed: 3, pending: 3 }) === null, "the lifetime cap applied off the live universe");
  assert(r("live", { cap: null, relayed: 9, pending: 9 }) === null, "no lifetime cap (the public shape) was refused");
  assert(/tomorrow/.test(r("fixture", { dailyCap: 500, dailyUsed: 500 }) ?? ""), "the daily cap reached is not a reason");
  assert(r("live", { dailyCap: 500, dailyUsed: 499 }) === null, "the daily cap refused with room left");
  assert(r("live", {}) === null && r("live", null) === null, "an unsigned read (no counts) refused — the validator still refuses at submission");
  assert(/3 posts/.test(r("live", { cap: 3, relayed: 2, pending: 1 }) ?? ""), "cap 3 reached does not name 3");
  assert(/switched off/.test(r("live", { cap: 0 }) ?? ""), "cap 0 is not 'switched off'");
  for (const reason of VALIDATOR_CAP_REASONS) {
    const p = Cx.slots.plainRelayRefusal(reason);
    assert(p.cap === true && !/[A-Z][A-Z0-9]*_[A-Z0-9_]+/.test(p.text), "the validator's cap refusal is not plain words: " + JSON.stringify(p));
  }
  const other = Cx.slots.plainRelayRefusal("anon relay refused: the setting (ZK_SOMETHING_ELSE) blocks it and FOO_BAR too");
  assert(other.cap === false && !/ZK_SOMETHING_ELSE|FOO_BAR/.test(other.text), "a variable name survived the plain-words mapping: " + other.text);
  assert(Cx.slots.cadenceSentence(4, 6) === "Up to 4 every 6 hours, shared across your personas.", "the cadence sentence without a lifetime cap changed (accept-anon-slots check 6 reads it)");
  assert(Cx.slots.cadenceSentence(4, 6, 1) === "Up to 4 every 6 hours, shared across your personas. For now the anonymous account is limited to 1 post in total.", "the cadence sentence does not say the lifetime cap: " + Cx.slots.cadenceSentence(4, 6, 1));
}
/** the route's unavailable chain asks the relay's budget, after the deployment-wide reason, and answers the lifetime cap */
function routeCapViolations(src) {
  const out = [];
  const off = src.indexOf("if (deploymentOff) unavailableReason = deploymentOff.reason;");
  const cap = src.indexOf("else if (capReason) unavailableReason = capReason;");
  if (src.indexOf("const capReason = relayCapReason(mode, config, wantedAnonPosts().length + (await anonPostsAhead(mode, readAt)));") < 0) out.push("capReason is not relayCapReason(mode, config, <wanted + this device's posts not yet counted>)");
  if (off < 0) out.push("the deployment-wide reason does not head the unavailable chain");
  if (cap < 0) out.push("the unavailable chain does not ask relayCapReason(mode, config, <this device's posts not yet counted>)");
  if (src.indexOf("const readAt = Date.now();") < 0 || src.indexOf("const readAt = Date.now();") > src.indexOf("const config = await fetchAnonPostConfig(mode);")) out.push("readAt is not taken before the config read (a post sent during the read would be counted twice or not at all)");
  if (off >= 0 && cap >= 0 && cap < off) out.push("the cap is asked before the deployment-wide reason");
  if (!/lifetimeCap: mode === "live" && typeof config\.cap === "number" \? config\.cap : null/.test(src)) out.push("GET /api/anon does not answer lifetimeCap");
  if (!/anonDeploymentOff: true/.test(src)) out.push("GET /api/anon does not answer anonDeploymentOff");
  return out;
}
console.log("\nC — the relay's own caps (UX-2)");
await check("C1 relayCapReason: the live lifetime cap counts relayed AND pending (cap 1 + one pending = no more), the daily cap, nothing on an unsigned read or off the live universe; the validator's own cap refusals map to plain words; the cadence sentence says the lifetime cap", () => capScenario(C));
await check("C2 SOURCE RULE over app/api/anon/route.ts: the unavailable chain is headed by the deployment-wide reason and asks relayCapReason(mode, config, wanted + this device's posts not yet counted, read from before the config read); the answer carries lifetimeCap and anonDeploymentOff", () => {
  const v = routeCapViolations(readFileSync(path.join(ROOT, "app/api/anon/route.ts"), "utf8"));
  assert(v.length === 0, v.join(" | "));
});
await mutation("C1 / the pending rows not counted against the lifetime cap", async () => {
  const M = await bundle(CLIENT_ENTRY, {}, { "lib/zk/anon/slots.ts": [["count(c.relayed) + count(c.pending) + ahead >= c.cap", "count(c.relayed) + ahead >= c.cap"]] });
  capScenario(M);
});
await mutation("C2 / the route never asks the relay's budget", async () => {
  const src = readFileSync(path.join(ROOT, "app/api/anon/route.ts"), "utf8").replace("else if (capReason) unavailableReason = capReason;", "");
  const v = routeCapViolations(src);
  assert(v.length === 0, v.join(" | "));
});

/** UX-2 at compose time: the relay's cap is judged from the LAST TICK's signed config plus this device's posts the
 *  validator has not counted yet — refused 'relay-cap' with nothing minted, instead of a 202 that clears the box */
async function composeCapScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  try {
    // the daily cap (every universe): one left at the last tick → one post composes, the next is refused
    T.snap = { ...snapAt(40), anonConfig: { ...snapAt(40).anonConfig, dailyCap: 2, dailyUsed: 1 } };
    const d1 = await Gx.gate.requestAnonPost("the last one today", { personaId: "p_one" });
    assert(d1.ok, "the daily cap refused with one left: " + JSON.stringify(d1));
    const s0 = secrets().length;
    const d2 = await Gx.gate.requestAnonPost("one past today's cap", { personaId: "p_two" });
    assert(!d2.ok && d2.code === "relay-cap" && /tomorrow/.test(d2.reason ?? "") && !/[A-Z][A-Z0-9]*_[A-Z0-9_]+/.test(d2.reason ?? ""), "the daily cap with this device's waiting post was not refused 'relay-cap' in plain words: " + JSON.stringify(d2));
    assert(secrets().length === s0 && T.persisted.length === 0, "the refused post minted or wrote something");
    // the LIVE lifetime cap of 1 (the owner service): the first post composes; the second is refused while the first
    // is still wanted, still once it is queued and sent (the snapshot predates it), and once the validator counts it
    resetWorld();
    await Gx.gate.resetZkRuntimeOverrides();
    Gx.config.setZkModeOverride("live");
    T.writeEnabled = true;
    const liveSnap = (extra) => ({ ...snapAt(40), mode: "live", anonConfig: { ...snapAt(40).anonConfig, cap: 1, relayed: 0, pending: 0, ...extra }, fetchedAt: Date.now() - 1000 });
    T.snap = liveSnap({});
    const l1 = await Gx.gate.requestAnonPost("the first live post", { personaId: "p_one" });
    assert(l1.ok, "the first live post under cap 1 was refused: " + JSON.stringify(l1));
    const wantedTwice = await Gx.gate.requestAnonPost("a second while the first waits", { personaId: "p_two" });
    assert(!wantedTwice.ok && wantedTwice.code === "relay-cap", "a second post while the first is WANTED was taken under cap 1: " + JSON.stringify(wantedTwice));
    await Gx.gate.runWantedProofs(T.snap, {});
    await Gx.queue.drainQueue(Date.now() + 86_400_000, Infinity); // sent and accepted AFTER the snapshot was read
    const sentTwice = await Gx.gate.requestAnonPost("a second once the first was sent", { personaId: "p_two" });
    assert(!sentTwice.ok && sentTwice.code === "relay-cap", "a second post once the first was SENT (after the snapshot) was taken under cap 1: " + JSON.stringify(sentTwice));
    T.snap = { ...liveSnap({ pending: 1 }), fetchedAt: Date.now() + 1000 };
    const counted = await Gx.gate.requestAnonPost("a second once the validator counts the first", { personaId: "p_two" });
    assert(!counted.ok && counted.code === "relay-cap" && /checked that post/.test(counted.reason ?? ""), "a second post once the validator COUNTS the first was taken under cap 1: " + JSON.stringify(counted));
    // raised to 2 (the owner checked the first post): room again
    T.snap = { ...liveSnap({ cap: 2, pending: 1 }), fetchedAt: Date.now() + 1000 };
    const raised = await Gx.gate.requestAnonPost("after the limit was raised", { personaId: "p_two" });
    assert(raised.ok, "a raised cap still refused: " + JSON.stringify(raised));
  } finally {
    T.writeEnabled = false;
    await Gx.gate.resetZkRuntimeOverrides();
  }
}
await check("C3 AT COMPOSE TIME (no fetch): the daily cap and the live lifetime cap, from the last tick's signed config plus this device's posts not yet counted (wanted, queued, sent since the read), refuse 'relay-cap' in plain words with nothing minted or written; a raised cap has room again", () => composeCapScenario(G));
await mutation("C3 / the compose-time cap check removed", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (capReason) return { ok: false, code: \"relay-cap\"", "if (false) return { ok: false, code: \"relay-cap\""]] });
  await composeCapScenario(M);
});
await mutation("C3 / this device's sent-since-the-read posts not counted", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["const ahead = waiting + (await anonPostsAhead(snap.mode, snap.fetchedAt));", "const ahead = waiting;"]] });
  await composeCapScenario(M);
});

// ================================================================================================ N — what the composer says
// PRIV-2 / UX-3: the "posts through @anon by default; this post stays in Totem" note; PRIV-4: no save moment after an
// anonymous post
const DLINE_ENTRY = `export * as dl from "@/components/deliveryLine";\n`;
const NL = await bundle(DLINE_ENTRY);
function noteScenario(Nx) {
  const f = Nx.dl.anonDefaultNoteShown;
  const base = { available: false, deploymentOff: false, postAsMode: "anon", where: { to: "layers" } };
  assert(f(base) === true, "the note is not shown when everything agrees");
  assert(f({ ...base, where: { to: "farcaster" } }) === false, "PRIV-2: the note says 'stays in Totem' while the delivery line says Farcaster");
  assert(f({ ...base, where: null }) === false, "the note is shown before the delivery line answered");
  assert(f({ ...base, where: { to: "unknown" } }) === false, "the note is shown over a failed delivery line");
  assert(f({ ...base, deploymentOff: true }) === false, "UX-3: 'by default' said where nothing posts through @anon");
  assert(f({ ...base, available: true }) === false && f({ ...base, available: null }) === false, "the note is shown while anonymous posting is available or unknown");
  assert(f({ ...base, postAsMode: "direct" }) === false && f({ ...base, postAsMode: null }) === false, "the note is shown for a persona not in 'anon' mode");
}
/** the Composer: the note only under anonDefaultNoteShown(...), and (PRIV-4) no save moment in the anon branch */
function composerViolations(raw) {
  const src = raw.replace(/\r\n/g, "\n");
  const out = [];
  if ((src.match(/data-testid="composer-anon-default-note"/g) ?? []).length !== 1) out.push("composer-anon-default-note is not rendered from exactly one place");
  if (!/\{anonDefaultNoteShown\(\{[^}]*\bwhere \}\) && \(\s*<span data-testid="composer-anon-default-note">/.test(src)) out.push("the default note is not guarded by anonDefaultNoteShown({ …, where })");
  const start = src.indexOf("if (anon && !isPrivate && !replyToHash) {");
  const end = start < 0 ? -1 : src.indexOf("\n        return;\n      }", start);
  if (start < 0 || end < 0) return [...out, "the anon branch of submit() was not found"];
  const branch = src.slice(start, end);
  if (!branch.includes('fetch("/api/anon"')) out.push("the slice is not the anon branch (no POST /api/anon in it)");
  if (/layers:moment|MOMENT_EVENT|dispatchEvent/.test(branch.replace(/\/\/[^\n]*/g, ""))) out.push("PRIV-4: the anon branch dispatches a save moment");
  if (!/dispatchEvent\(new CustomEvent\("layers:moment"/.test(src.slice(end))) out.push("the plain post's moment is gone too (the rule would pass over a composer with none)");
  return out;
}
console.log("\nN — what the composer says (PRIV-2, UX-3, PRIV-4)");
await check("N1 anonDefaultNoteShown: the 'posts through @anon by default; this post stays in Totem' note only while anonymous posting is unavailable for a non-deployment reason, for a persona in 'anon' mode, AND the delivery line answered Totem", () => noteScenario(NL));
await check("N2 SOURCE RULE over components/Composer.tsx: the note renders from one place, guarded by anonDefaultNoteShown({ …, where }); the anon branch of submit() dispatches no layers:moment (PRIV-4) while the plain post keeps its moment", () => {
  const v = composerViolations(readFileSync(path.join(ROOT, "components/Composer.tsx"), "utf8"));
  assert(v.length === 0, v.join(" | "));
});
await mutation("N1 / the note ignores the delivery line (the pre-PRIV-2 rule)", async () => {
  const M = await bundle(DLINE_ENTRY, {}, { "components/deliveryLine.ts": [[' && !!x.where && x.where.to === "layers"', ""]] });
  noteScenario(M);
});
await mutation("N1 / the note ignores a deployment-wide reason (UX-3)", async () => {
  const M = await bundle(DLINE_ENTRY, {}, { "components/deliveryLine.ts": [["x.deploymentOff !== true && ", ""]] });
  noteScenario(M);
});
await mutation("N2 / the note back on the mode alone", async () => {
  // PERSONA LAUNCH wave 3 (UXH-11, final verify): the guard now passes the composer's own anonOff (a tab outside the crowd
  // is off too) — the anchor follows it, and a missing anchor is loud (it was silently vacuous for one run)
  const anchor = "anonDefaultNoteShown({ available: anonLabel.available, deploymentOff: anonOff, postAsMode: postAs?.mode, where })";
  const raw = readFileSync(path.join(ROOT, "components/Composer.tsx"), "utf8");
  if (!raw.includes(anchor)) throw new Error("patch anchor not found in components/Composer.tsx: " + anchor.slice(0, 80));
  const src = raw.replace(anchor, 'postAs?.mode === "anon"');
  const v = composerViolations(src);
  assert(v.length === 0, v.join(" | "));
});
await mutation("N2 / PRIV-4: the save moment back in the anon branch", async () => {
  const src = readFileSync(path.join(ROOT, "components/Composer.tsx"), "utf8").replace("// PERSONA LAUNCH P3 (PRIV-4): NO save moment here.", 'window.dispatchEvent(new CustomEvent("layers:moment", { detail: { kind: "post" } })); //');
  const v = composerViolations(src);
  assert(v.length === 0, v.join(" | "));
});

// ================================================================================================ L — UX-L1: a post during a launch
async function launchScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(40);
  T.launching = new Set(["p_one"]);
  // a line that said "attributed to no one" (no claim) for a persona whose launch IS under way: refused, nothing minted
  const stale = await Gx.gate.requestAnonPost("posted during the launch", { personaId: "p_one" });
  assert(!stale.ok && stale.code === "launch", "a post whose line said 'attributed to no one' was accepted during its persona's launch: " + JSON.stringify(stale));
  assert(/^@one is being launched, so this post will become public as @one's, with every other anonymous post @one made/.test(stale.reason) && /Nothing was sent\./.test(stale.reason), "the refusal does not say, in plain words, that the post would be revealed: " + stale.reason);
  assert(secrets().length === 0 && T.persisted.length === 0 && Gx.gate.wantedAnonPosts().length === 0, "the refused post minted a secret, wrote, or became wanted");
  // force (a rig) does not bypass it
  const forced = await Gx.gate.requestAnonPost("forced during the launch", { personaId: "p_one", force: true });
  assert(!forced.ok && forced.code === "launch", "force bypassed the launch binding: " + JSON.stringify(forced));
  // the line said it: accepted and marked; the sealed record names the persona the batch reveal reads
  const acked = await Gx.gate.requestAnonPost("posted during the launch, knowingly", { personaId: "p_one", launchPending: true });
  assert(acked.ok && acked.launchPending === true, "a post whose line said it would be revealed was refused or not marked: " + JSON.stringify(acked));
  assert(secrets().length === 1 && secrets()[0].attribution.personaId === "p_one", "the acknowledged post's sealed record is not p_one's");
  // the other direction: a stale "will be revealed" for a persona with no launch under way (it failed, or already revealed)
  const wrongWay = await Gx.gate.requestAnonPost("the launch is over", { personaId: "p_two", launchPending: true });
  assert(!wrongWay.ok && wrongWay.code === "launch" && /^@two isn't waiting for a launch to reveal its posts any more, so this post would stay anonymous\. Nothing was sent\./.test(wrongWay.reason), "a stale 'will be revealed' line was not refused in plain words: " + JSON.stringify(wrongWay));
  assert(secrets().length === 1, "the stale-claim refusal minted a secret");
  // POSITIVE CONTROL: no launch, no claim — accepted and NOT marked (the guard does not simply refuse everything)
  const plain = await Gx.gate.requestAnonPost("no launch here", { personaId: "p_two" });
  assert(plain.ok && plain.launchPending === false, "a plain post with no launch was refused or marked: " + JSON.stringify(plain));
  // NEVER FAIL OPEN: unreadable launch state refuses before anything is minted, with or without the claim
  const before = secrets().length;
  T.launchThrows = true;
  for (const lp of [undefined, true, false]) {
    const r = await Gx.gate.requestAnonPost("launch state unreadable " + String(lp), { personaId: "p_two", launchPending: lp });
    assert(!r.ok && r.code === "unavailable" && /being launched/.test(r.reason), "an unreadable launch state did not refuse (claim " + String(lp) + "): " + JSON.stringify(r));
  }
  assert(secrets().length === before, "the unreadable-state refusal minted a secret");
  T.launchThrows = false;
  return "stale line refused both ways (force too), the acknowledged post accepted and marked, unreadable state refused";
}
const LAUNCH_GUARD = 'if (launchPending !== (opts.launchPending === true)) return { ok: false, code: "launch", reason: launchChangedSentence(handleOfPersona(personaId), launchPending) };';
const LAUNCH_READ_REFUSAL = 'return { ok: false, code: "unavailable", reason: "couldn\'t check whether this persona is being launched (" + (e as Error).message + ") — refusing rather than posting unchecked" };';
/** the route and the composer: what the line says during a launch, and that the post carries it */
function launchSourceViolations(routeRaw, composerRaw) {
  const route = routeRaw.replace(/\r\n/g, "\n");
  const comp = composerRaw.replace(/\r\n/g, "\n");
  const out = [];
  // the route: the line's facts from the launch seam and the shared sentence; the POST passes the claim through
  if (!/launchPending = \(await \(await import\("@\/lib\/launch\/confirm"\)\)\.launchUnderWay\(personaId\)\) === true;/.test(route)) out.push("route: postAs does not read launchUnderWay(personaId)");
  if (!route.includes("launchNotice: launchPending ? launchRevealSentence(v.handle) : null")) out.push("route: postAs.launchNotice is not the gate's launchRevealSentence");
  if (!route.includes("launchPending: body.launchPending === true });")) out.push("route: POST does not pass the line's launch claim to requestAnonPost");
  if (!/\blaunch: 409\b/.test(route)) out.push("route: the 'launch' refusal is not a 409");
  // the composer: the launch branch precedes "attributed to no one"; the post carries the claim; the ring line steps aside
  if (!comp.includes("const launchPendingNow = anon && anonLabel?.postAs?.launchPending === true;")) out.push("composer: launchPendingNow is not read from postAs.launchPending");
  if (!comp.includes("launchPending: o.launchPending === true,")) out.push("composer: readPostAs drops launchPending");
  const launchBranch = comp.indexOf(") : launchPendingNow && anonLabel?.postAs ? (");
  const noOne = comp.indexOf("attributed to no one by hubs");
  if (launchBranch < 0 || noOne < 0 || launchBranch > noOne) out.push("composer: the audience line's launch branch does not come before 'attributed to no one'");
  if ((comp.match(/attributed to no one by hubs/g) ?? []).length !== 1) out.push("composer: 'attributed to no one' is said from more than one place");
  if (!/data-testid="composer-launch-reveal">\{launchRevealLine\(/.test(comp)) out.push("composer: the launch line does not render launchRevealLine (the server's sentence)");
  const start = comp.indexOf("if (anon && !isPrivate && !replyToHash) {");
  const end = start < 0 ? -1 : comp.indexOf("\n        return;\n      }", start);
  const branch = start < 0 || end < 0 ? "" : comp.slice(start, end);
  if (!branch.includes("if (anonLabel?.postAs?.launchPending === true) body.launchPending = true;")) out.push("composer: the anonymous post does not carry what the line said about the launch");
  if (!branch.includes('if (j?.code === "launch") setAnonTick((t) => t + 1);')) out.push("composer: a 'launch' refusal does not read the line again");
  if (!/\(!launchPendingNow \|\| !!anonLabel\?\.postAs\?\.ringsError\) && \(\s*<div className="mb-2 px-1">\s*<RingAudienceLine/.test(comp)) out.push("composer: the ring line ('Everyone else sees @anon.') is not held back during a launch");
  return out;
}
const readSrc = (f) => readFileSync(path.join(ROOT, f), "utf8");
console.log("\nL — UX-L1: a post made during its persona's launch");
await check("L1 the line is bound to the click: during a launch a post whose line said 'attributed to no one' is refused 'launch' before any mint, write or wanted entry (force too) with the plain sentence; the acknowledged post is accepted and marked; a stale 'will be revealed' is refused; no launch + no claim is accepted (control); unreadable launch state refuses (never fail open)", () => launchScenario(G));
await mutation("L1 / the launch binding removed from requestAnonPost", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [[LAUNCH_GUARD, ""]] });
  await launchScenario(M);
});
await mutation("L1 / only the dangerous direction checked (a stale 'will be revealed' passes)", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (launchPending !== (opts.launchPending === true)) return", "if (launchPending && opts.launchPending !== true) return"]] });
  await launchScenario(M);
});
await mutation("L1 / force bypasses the launch binding", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (launchPending !== (opts.launchPending === true)) return", "if (!opts.force && launchPending !== (opts.launchPending === true)) return"]] });
  await launchScenario(M);
});
await mutation("L1 / unreadable launch state read as 'no launch' (fail open)", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [[LAUNCH_READ_REFUSAL, "launchPending = false; void e;"]] });
  await launchScenario(M);
});
await check("L2 SOURCE RULE over app/api/anon/route.ts and components/Composer.tsx: postAs.launchPending/launchNotice come from launchUnderWay and the gate's sentence; POST passes the claim; the audience line's launch branch precedes the one 'attributed to no one'; the post carries the claim and a 'launch' refusal re-reads the line; the ring line steps aside during a launch", () => {
  const v = launchSourceViolations(readSrc("app/api/anon/route.ts"), readSrc("components/Composer.tsx"));
  assert(v.length === 0, v.join(" | "));
});
await mutation("L2 / the composer back to 'attributed to no one' during a launch (the launch branch gone)", async () => {
  const v = launchSourceViolations(readSrc("app/api/anon/route.ts"), readSrc("components/Composer.tsx").replace(") : launchPendingNow && anonLabel?.postAs ? (", ") : false ? ("));
  assert(v.length === 0, v.join(" | "));
});
await mutation("L2 / the anonymous post no longer carries the line's claim", async () => {
  const v = launchSourceViolations(readSrc("app/api/anon/route.ts"), readSrc("components/Composer.tsx").replace("if (anonLabel?.postAs?.launchPending === true) body.launchPending = true;", ""));
  assert(v.length === 0, v.join(" | "));
});
await mutation("L2 / the route drops the claim before the gate", async () => {
  const v = launchSourceViolations(readSrc("app/api/anon/route.ts").replace(", launchPending: body.launchPending === true });", " });"), readSrc("components/Composer.tsx"));
  assert(v.length === 0, v.join(" | "));
});
await mutation("L2 / the ring line's 'Everyone else sees @anon.' shown during a launch", async () => {
  const v = launchSourceViolations(readSrc("app/api/anon/route.ts"), readSrc("components/Composer.tsx").replace("(!launchPendingNow || !!anonLabel?.postAs?.ringsError) && ", ""));
  assert(v.length === 0, v.join(" | "));
});

// ================================================================================================ V — the validator's shape knobs
function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
console.log("\nV — the validator's knobs by deployment shape (validator/zk.js)");
await check("V1 relay cadence: public 30-minute slots with a 30-minute spread; the rig 60 / 0; the owner shape 60 / 0; the environment overrides any shape", () => {
  const M = 60_000;
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined }, () => assert(vz.anonRelayIntervalMs() === 30 * M && vz.anonRelaySpreadMs() === 30 * M, "public"));
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: "true" }, () => assert(vz.anonRelayIntervalMs() === 60 * M && vz.anonRelaySpreadMs() === 0, "owner / rig (production build)"));
  withEnv({ NODE_ENV: undefined, ZK_DEV_HOOKS: "true" }, () => assert(vz.anonRelayIntervalMs() === 60 * M && vz.anonRelaySpreadMs() === 0, "rig (dev)"));
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_RELAY_INTERVAL_MS: "3600000", ZK_ANON_RELAY_SPREAD_MS: "0" }, () => assert(vz.anonRelayIntervalMs() === 60 * M && vz.anonRelaySpreadMs() === 0, "public, overridden"));
});
await check("V2 lifetime live cap: 1 on the owner and rig shapes with ZK_ANON_POST_LIVE_CAP unset or blank (the owner service keeps 1 if the variable is lost), the raised value when set; NONE on the public shape unless set explicitly", () => {
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: "true", ZK_ANON_POST_LIVE_CAP: undefined }, () => assert(vz.anonLiveCap() === 1, "owner, unset: " + vz.anonLiveCap()));
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: "true", ZK_ANON_POST_LIVE_CAP: "" }, () => assert(vz.anonLiveCap() === 1, "owner, blank: " + vz.anonLiveCap()));
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: "true", ZK_ANON_POST_LIVE_CAP: "7" }, () => assert(vz.anonLiveCap() === 7, "owner, raised"));
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_POST_LIVE_CAP: undefined }, () => assert(vz.anonLiveCap() === null, "public, unset"));
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_POST_LIVE_CAP: "2" }, () => assert(vz.anonLiveCap() === 2, "public, explicit"));
  withEnv({}, () => assert(vz.anonDailyCap() === 500, "the daily cap default is not 500"));
});
await check("V3 the daily cap's day is the epoch's day on the validator's (shifted) clock: four 6-hour epochs a day, every epoch inside its own bucket, consecutive days tiling", () => {
  assert(JSON.stringify(vz.anonDayEpochRange(8, H6)) === "[8,12]" && JSON.stringify(vz.anonDayEpochRange(11, H6)) === "[8,12]" && JSON.stringify(vz.anonDayEpochRange(12, H6)) === "[12,16]", "6-hour buckets");
  for (let e = 0; e < 500; e++) {
    const [lo, hi] = vz.anonDayEpochRange(e, H6);
    assert(lo <= e && e < hi && hi - lo === 4, `epoch ${e}: [${lo}, ${hi})`);
  }
});

console.log(`\n${passed}/${passed + failed} anon-slots unit checks passed${failed ? ` — FAILED: ${failures.join("; ")}` : ""}`);
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 50).unref?.();
