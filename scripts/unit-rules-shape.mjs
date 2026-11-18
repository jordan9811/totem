// A MALFORMED RULE NEVER CRASHES A FEED — refused at every door that stores one, inert and SAID where one is already
// stored, IN ONE PROCESS, with nothing real.
//
// The defect: POST /api/rules validated `body.root` with validateRuleGroup, which read a missing clause list as "no
// clauses, no violations" (`group.clauses ?? []`). A root like `{ op: "and", conditions: [...] }` (the shape
// scripts/accept-hub-read-prod.mjs HR18 itself stored) or `{ combinator: "AND" }` was stored, and evaluateGroup
// (`group.clauses.map`) threw on it: attached to a mode, every build of the sample feed threw (a 503 on the timeline,
// surviving restarts), and the real Following refused its whole page. PATCH /api/modes was another door: an
// `activationRule` is a rule tree the sample feed evaluates on every load, and the patch was stored unchecked.
//
// Two bundles of the real modules (esbuild), their stores stood in for:
//   ROUTES  lib/rules/evaluate.ts, app/api/rules/route.ts, app/api/rules/preview/route.ts, app/api/modes/route.ts,
//           lib/algo/artifact.ts and lib/fc/hubRead/mode.ts, the adapters a recorder (a write that reaches one is a
//           write the gate let through)
//   FEED    lib/feed.ts buildFeed over the real mock store and the seeded world, the persist layer an in-memory
//           validator, React's `cache` an identity, the validator's anon list empty (no server, no port)
//
//   S1 THE EVALUATOR NEVER THROWS: every malformed shape (the ones that threw before: S1's positive control is the
//      mutation that removes the guard) is INERT: evaluateGroup is false whatever its negate, a broken group nested in a
//      negated one does not flip the tree to "everything", ruleActions decides nothing, fieldsOf reads nothing and
//      describeGroup says it cannot be read; every well-formed tree evaluates as before
//   S2 validateRuleGroup refuses the SHAPE by name (no clause list, a clause list that is not an array, a combinator
//      other than AND/OR, a null or non-object condition, a condition with no field or op, the same nested), never
//      throws, agrees with isWellFormedGroup, and passes every well-formed tree (the presets included)
//   S3 POST /api/rules: each malformed root → 400 malformed_rule in the shape sentence, nothing stored; a protected field
//      → 400 from the field check; no root, a body that is not a JSON object → 400; the action allowlist unchanged; a
//      well-formed root → 200 and stored once, verbatim
//   S4 POST /api/rules/preview: a malformed root → 400 malformed_rule, the evaluator never reached; a well-formed one counts
//   S5 PATCH /api/modes: a malformed activationRule → 400 malformed_rule, a protected field → 400, the mode never
//      updated; a clock rule, `null` (clear) and a patch without one pass through verbatim
//   S6 THE ALGO AND PACK IMPORT SANITIZER (lib/algo/artifact.ts): a malformed rule root, a non-object rule entry and a
//      rule with no root are fatal to the import (never a TypeError); a well-formed artifact survives with its rule
//   S7 AN ALREADY-STORED RULE IS INERT AND SAID (runnableRules, the one question both feeds ask): a tree that cannot be
//      walked and one reaching a protected field are left out, each with its sentence, the rest run in order; on the real
//      Following (lib/fc/hubRead/mode.ts) the page under such a mode is the page without the rule, and its line names it
//      ("inert", ahead of the Farcaster gaps)
//   S8 THE SAMPLE FEED (lib/feed.ts): a mode naming a stored malformed hide rule, a negated malformed rule, a rule
//      reaching a protected field and a good mute builds (no throw): the good rule hides exactly what it hides alone, the
//      three inert ones hide nothing, and inertRules names each with its sentence; a malformed activation rule never
//      throws the build; a mode with only good rules says nothing
//   M  MUTATIONS: each guard removed in the BUNDLE ONLY, and the check that covers it must then FAIL
//
//   node scripts/unit-rules-shape.mjs            (npm run test:rules-shape-unit)
//   node scripts/unit-rules-shape.mjs --only=S3
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
const MUTATIONS = process.env.RULESHAPE_MUTATION ? JSON.parse(process.env.RULESHAPE_MUTATION) : [];
const QUIET = process.env.RULESHAPE_UNIT_QUIET === "1";

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
// ONE bundle: the real modules over the real mock store and the seeded world. Stood in for: the persist layer (an
// in-memory validator), React's `cache` (an identity), the validator's public anon list (empty), Next's request and
// response objects, and the acting identity (a fixed persona, as the routes read it). No server, no port.
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-ruleshape-unit-"));
process.env.KEYSTORE_DIR = path.join(tmp, "keystore");
const S = (n) => path.join(tmp, n);
const REAL = {
  persist: path.join(ROOT, "lib", "adapters", "mock", "persist"),
  vclient: path.join(ROOT, "lib", "zk", "validatorClient"),
};
const stubs = {
  "server-only.ts": "export {};\n",
  "react-cache.ts": "export const cache = <T,>(f: T): T => f;\n",
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
  "active-persona.ts": `export const personaCtl = { id: "" };
export function activeSeedPersonaId(): string { return personaCtl.id; }
`,
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
  // the validator's public anon list, empty (the feed's anon merge is then skipped whole: fail closed)
  "vclient-stub.ts": `export * from ${JSON.stringify(REAL.vclient)};
export async function fetchAnonCasts(_mode: unknown): Promise<any[]> { return []; }
`,
  "entry.ts": `export * as evaluate from "@/lib/rules/evaluate";
export * as rulesRoute from "@/app/api/rules/route";
export * as previewRoute from "@/app/api/rules/preview/route";
export * as modesRoute from "@/app/api/modes/route";
export * as artifact from "@/lib/algo/artifact";
export * as hubMode from "@/lib/fc/hubRead/mode";
export * as nextStub from "next/server";
export * as personaStub from "@/lib/activePersona";
export { buildFeed } from "@/lib/feed";
export { state, SEED_VIEWER } from "@/lib/adapters/mock/store";
export { adapters } from "@/lib/adapters/registry";
export { setLatencyInjection, setFailureRateOverride } from "@/lib/adapters/devControls";
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
const VSTUB = S("vclient-stub.ts");
const redirectPlugin = {
  name: "redirect",
  setup(b) {
    const target = (spec, resolveDir) => (spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec.startsWith(".") ? path.resolve(resolveDir, spec) : null);
    b.onResolve({ filter: /^react$/ }, (a) => (a.importer.startsWith(path.join(ROOT, "lib")) ? { path: S("react-cache.ts") } : undefined));
    b.onResolve({ filter: /(persist|validatorClient)$/ }, (a) => {
      if (a.importer === VSTUB) return undefined;
      const t = target(a.path, a.resolveDir);
      if (t === REAL.persist) return { path: S("persist.ts") };
      if (t === REAL.vclient) return { path: VSTUB };
      return undefined;
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
    alias: { "server-only": S("server-only.ts"), "next/server": S("next-server.ts"), "@/lib/activePersona": S("active-persona.ts") },
  });
  M = await import(pathToFileURL(S("bundle.mjs")).href);
  if (MUTATIONS.length && applied.size !== MUTATIONS.length) throw new Error("MUTATION FILE NOT IN THE BUNDLE");
} catch (e) {
  console.log("cannot bundle the rule-shape modules: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
// the rig's synthetic latency and 2% failure are the retry discipline's demonstration, not what is measured here
M.setLatencyInjection([0, 0]);
M.setFailureRateOverride(0);
const VIEWER = M.SEED_VIEWER.activePersonaId;
M.personaStub.personaCtl.id = VIEWER;

out("\nRULE SHAPE UNIT — a malformed rule never crashes a feed: refused at every door, inert and said where already stored" + (MUTATIONS.length ? "  [MUTATED BUNDLE]" : ""));

// ---------------------------------------------------------------------------------------------------- the cases
const COND = { field: "post.text", op: "contains", value: "zebrafish" };
/** [label, root]: every one of these threw inside the evaluator's walk when stored (M's first mutation proves it) */
const MALFORMED = [
  ["{op, conditions} (accept-hub-read-prod's old rule)", { op: "and", conditions: [{ field: "text", cmp: "contains", value: "x" }] }],
  ["{combinator} alone (the GATE 5 F-4 case)", { combinator: "AND" }],
  ["a clause list that is a string", { combinator: "AND", clauses: "post.text contains x" }],
  ["a clause list that is an object", { combinator: "OR", clauses: { 0: COND } }],
  ["a null clause", { combinator: "AND", clauses: [null] }],
  ["a nested group with no clause list", { combinator: "AND", clauses: [COND, { combinator: "OR" }] }],
  ["a nested null clause", { combinator: "AND", clauses: [{ combinator: "OR", clauses: [COND, null] }] }],
];
/** [label, root]: shapes that are not rules (no AND/OR, no field/op): refused, never stored, inert if stored */
const NOT_RULES = [
  ["a lowercase combinator", { combinator: "and", clauses: [COND] }],
  ["an unknown combinator", { combinator: "XOR", clauses: [COND] }],
  ["a condition with no op", { combinator: "AND", clauses: [{ field: "post.text", value: "x" }] }],
  ["a condition with no field", { combinator: "AND", clauses: [{ op: "eq", value: 1 }] }],
  ["a clause that is a number", { combinator: "AND", clauses: [7] }],
];
const BAD = [...MALFORMED, ...NOT_RULES];
const WELL = [
  ["a muted word", { combinator: "AND", clauses: [COND] }],
  ["an empty group (matches nothing)", { combinator: "OR", clauses: [] }],
  ["negate over a list", { combinator: "AND", negate: true, clauses: [{ field: "author.cluster", op: "in", value: ["crypto", "history"] }] }],
  ["nested groups", { combinator: "OR", clauses: [COND, { combinator: "AND", clauses: [{ field: "post.age", op: "gt", value: 1440 }, { field: "author.tier", op: "lt", value: 3 }] }] }],
  ["an activation rule", { combinator: "AND", clauses: [{ field: "clock.hourUTC", op: "gte", value: 18 }] }],
];
const PROTECTED = { combinator: "AND", clauses: [{ field: "identity.rootId", op: "neq", value: "x" }] };
const ctx = {
  post: { hash: "0xabc", topicId: null, isUpdate: false, hasMedia: false, ageMinutes: 5, text: "a zebrafish post" },
  author: { personaId: "p_author", tier: 2, cluster: "tech" },
  viewer: { personaId: null, followingPersonaIds: [] },
  clock: { hourUTC: 19 },
};
const tryIt = (fn) => {
  try {
    return { v: fn() };
  } catch (e) {
    return { e };
  }
};
const R_ = () => M;

await check("S1", "THE EVALUATOR NEVER THROWS: every malformed shape is INERT (false whatever its negate; a broken group nested in a negated one does not flip the tree; ruleActions decides nothing; fieldsOf reads nothing; describeGroup says it cannot be read); every well-formed tree evaluates as before", async () => {
  const { evaluate } = R_();
  const wrong = [];
  for (const [label, root] of BAD) {
    for (const r of [root, { ...root, negate: true }]) {
      const g = tryIt(() => evaluate.evaluateGroup(r, ctx));
      if (g.e) wrong.push("evaluateGroup threw on " + label + (r.negate ? " (negated)" : "") + ": " + g.e.message);
      else if (g.v !== false) wrong.push("evaluateGroup matched " + label + (r.negate ? " (negated)" : ""));
      const a = tryIt(() => evaluate.ruleActions(["hide", "pin", "banner", "downrank"].map((action) => ({ action, root: r })), ctx));
      if (a.e) wrong.push("ruleActions threw on " + label + ": " + a.e.message);
      else if (Object.values(a.v).some(Boolean)) wrong.push("ruleActions decided " + JSON.stringify(a.v) + " on " + label);
    }
    const f = tryIt(() => evaluate.fieldsOf(root));
    if (f.e || !Array.isArray(f.v) || f.v.length) wrong.push("fieldsOf on " + label + ": " + (f.e ? f.e.message : JSON.stringify(f.v)));
    const d = tryIt(() => evaluate.describeGroup(root));
    if (d.e || !/can't be read/.test(String(d.v))) wrong.push("describeGroup on " + label + ": " + (d.e ? d.e.message : d.v));
  }
  // a broken group INSIDE a negated well-formed one: the whole tree is inert (never "not (false)" = every post)
  const nestedNeg = { combinator: "AND", negate: true, clauses: [{ combinator: "OR" }] };
  if (evaluate.evaluateGroup(nestedNeg, ctx) !== false) wrong.push("a broken group nested in a negated one matched every post");
  if (evaluate.ruleActions([{ action: "hide", root: nestedNeg }], ctx).hide) wrong.push("a negated tree around a broken group hid the post");
  // the positive control: the well-formed trees evaluate exactly as the evaluator always read them
  const expect = { "a muted word": true, "an empty group (matches nothing)": false, "negate over a list": true, "nested groups": true, "an activation rule": true };
  for (const [label, root] of WELL) {
    const g = tryIt(() => evaluate.evaluateGroup(root, ctx));
    if (g.e) wrong.push(label + " threw: " + g.e.message);
    else if (g.v !== expect[label]) wrong.push(label + " evaluated " + g.v + ", not " + expect[label]);
  }
  const hide = evaluate.ruleActions([{ action: "hide", root: WELL[0][1] }, { action: "downrank", root: WELL[3][1] }], ctx);
  if (!hide.hide || !hide.downrank || hide.pin || hide.banner) wrong.push("ruleActions on well-formed rules: " + JSON.stringify(hide));
  if (evaluate.fieldsOf(WELL[3][1]).sort().join() !== "author.tier,post.age,post.text") wrong.push("fieldsOf on nested groups: " + evaluate.fieldsOf(WELL[3][1]));
  if (evaluate.describeGroup(WELL[0][1]) !== "text contains zebrafish") wrong.push("describeGroup changed: " + evaluate.describeGroup(WELL[0][1]));
  assert(!wrong.length, wrong.join(" | "));
  return BAD.length + " shapes (and their negations) inert, never thrown; " + WELL.length + " well-formed trees evaluate as before";
});

await check("S2", "validateRuleGroup REFUSES THE SHAPE by name, never throws, agrees with isWellFormedGroup on every case, and passes every well-formed tree (presets included)", async () => {
  const { evaluate } = R_();
  const wrong = [];
  const fieldsOf = (vs) => vs.map((v) => v.field).join(",");
  const expectField = {
    "{op, conditions} (accept-hub-read-prod's old rule)": "clauses",
    "{combinator} alone (the GATE 5 F-4 case)": "clauses",
    "a clause list that is a string": "clauses",
    "a clause list that is an object": "clauses",
    "a null clause": "clause",
    "a nested group with no clause list": "clauses",
    "a nested null clause": "clause",
    "a lowercase combinator": "combinator",
    "an unknown combinator": "combinator",
    "a condition with no op": "post.text",
    "a condition with no field": "clause",
    "a clause that is a number": "clause",
  };
  for (const [label, root] of BAD) {
    const r = tryIt(() => evaluate.validateRuleGroup(root));
    if (r.e) {
      wrong.push(label + ": validateRuleGroup threw " + r.e.message);
      continue;
    }
    const vs = r.v;
    if (!Array.isArray(vs) || vs.length === 0) wrong.push(label + ": no violation (it would be stored)");
    else if (!vs.some((v) => v.field === expectField[label])) wrong.push(label + ": violations name " + fieldsOf(vs) + ", not " + expectField[label]);
    else if (vs.some((v) => !/refused/.test(v.reason))) wrong.push(label + ": a violation does not say refused: " + JSON.stringify(vs));
    if (evaluate.isWellFormedGroup(root) !== false) wrong.push(label + ": isWellFormedGroup accepted it");
  }
  for (const v of [undefined, null, "AND", 7, []]) {
    const r = tryIt(() => evaluate.validateRuleGroup(v));
    if (r.e) {
      wrong.push(JSON.stringify(v ?? null) + " as the root: threw " + r.e.message);
      continue;
    }
    if (!r.v.length || r.v[0].field !== "root") wrong.push(JSON.stringify(v ?? null) + " as the root: " + JSON.stringify(r.v));
    if (evaluate.isWellFormedGroup(v) !== false) wrong.push(JSON.stringify(v ?? null) + " as the root: isWellFormedGroup accepted it");
  }
  for (const [label, root] of WELL) {
    const vs = evaluate.validateRuleGroup(root);
    if (vs.length) wrong.push(label + ": refused " + JSON.stringify(vs));
    if (evaluate.isWellFormedGroup(root) !== true) wrong.push(label + ": isWellFormedGroup refused it");
  }
  // the presets every persona's modes name (lib/adapters/mock/presets.ts), read as text: all pass both checks
  const presetSrc = readFileSync(path.join(ROOT, "lib/adapters/mock/presets.ts"), "utf8").replace(/\r\n/g, "\n");
  const presetRoots = [...presetSrc.matchAll(/root: (\{[\s\S]*?\n {4}\}),/g)].map((m) => m[1]);
  assert(presetRoots.length >= 4, "could not read the preset roots (" + presetRoots.length + ")");
  for (const src of presetRoots) {
    const root = Function("SEED_STORY_ID", "return (" + src + ");")("story_seed");
    if (evaluate.validateRuleGroup(root).length || !evaluate.isWellFormedGroup(root)) wrong.push("a preset refused: " + src.replace(/\s+/g, " "));
  }
  // and the field guardrail still names what a protected rule reached for
  const prot = evaluate.validateRuleGroup(PROTECTED);
  if (prot.length !== 1 || !/disclosure\/grant/.test(prot[0].reason)) wrong.push("the protected-field refusal changed: " + JSON.stringify(prot));
  assert(!wrong.length, wrong.join(" | "));
  return BAD.length + " shapes + 5 non-object roots refused by name, " + (WELL.length + presetRoots.length) + " well-formed trees (" + presetRoots.length + " presets) pass";
});

const req = (url, method, body) => new M.nextStub.NextRequest("http://localhost" + url, { method, body: typeof body === "string" ? body : JSON.stringify(body) });
/** what the rules store holds (the real mock store): a write the gate let through is a row here */
const storedRules = () => [...M.state().rules.values()].filter((r) => r.personaId === VIEWER);
// the evaluator's count for a preview: a spy around the real one (not a write, so not wrapped by the persist proxy)
const previewed = [];
{
  const real = M.adapters.rules.previewCount;
  M.adapters.rules.previewCount = async (root) => {
    previewed.push(root);
    return real.call(M.adapters.rules, root);
  };
}

await check("S3", "POST /api/rules: each malformed root → 400 malformed_rule in the shape sentence, nothing stored; a protected field → 400 from the field check; no root / a body that is not a JSON object → 400; the action allowlist unchanged; a well-formed root → 200, stored once, verbatim", async () => {
  const { rulesRoute, evaluate } = M;
  const wrong = [];
  const n0 = storedRules().length;
  for (const [label, root] of BAD) {
    let r;
    try {
      r = await rulesRoute.POST(req("/api/rules", "POST", { name: "bad " + label, action: "hide", root }));
    } catch (e) {
      wrong.push(label + ": the route threw " + (e && e.message));
      continue;
    }
    if (r.status !== 400 || r.body?.code !== "malformed_rule") wrong.push(label + ": " + r.status + " " + JSON.stringify(r.body));
    else if (r.body.error !== evaluate.RULE_SHAPE_REFUSED_SENTENCE) wrong.push(label + ": refused, but not by the shape gate: " + r.body.error);
  }
  for (const [label, body] of [["no root", { name: "x", action: "hide" }], ["a null root", { name: "x", action: "hide", root: null }], ["a body that is not JSON", "{not json"], ["a JSON array body", [1, 2]], ["a JSON string body", '"hide"']]) {
    let r;
    try {
      r = await rulesRoute.POST(req("/api/rules", "POST", body));
    } catch (e) {
      wrong.push(label + ": the route threw " + (e && e.message));
      continue;
    }
    if (r.status !== 400 || r.body?.code !== "malformed_rule" || !/^Rule refused/.test(String(r.body?.error))) wrong.push(label + ": " + r.status + " " + JSON.stringify(r.body));
  }
  const prot = await rulesRoute.POST(req("/api/rules", "POST", { name: "grab", action: "hide", root: PROTECTED }));
  if (prot.status !== 400 || prot.body?.code !== "malformed_rule" || !/disclosure\/grant/.test(String(prot.body?.error))) wrong.push("a protected field: " + prot.status + " " + JSON.stringify(prot.body));
  // the action allowlist still answers first, in its own words
  const pin = await rulesRoute.POST(req("/api/rules", "POST", { name: "pin", action: "pin", root: WELL[0][1] }));
  if (pin.status !== 400 || pin.body?.code !== "action_not_creatable") wrong.push("a pin rule: " + pin.status + " " + JSON.stringify(pin.body));
  const leaked = storedRules().length - n0;
  if (leaked) wrong.push(leaked + " refused rule(s) STORED: " + JSON.stringify(storedRules().slice(n0).map((r) => r.name)));
  for (const [label, root] of WELL) {
    const before = storedRules().length;
    const r = await rulesRoute.POST(req("/api/rules", "POST", { name: "good " + label, action: "hide", root }));
    const now = storedRules();
    const row = now.find((x) => x.id === r.body?.rule?.id);
    if (r.status !== 200 || !row) wrong.push(label + ": " + r.status + " " + JSON.stringify(r.body));
    else if (now.length !== before + 1 || JSON.stringify(row.root) !== JSON.stringify(root) || row.name !== "good " + label) wrong.push(label + ": stored " + JSON.stringify(row));
  }
  assert(!wrong.length, wrong.join(" | "));
  return BAD.length + " shapes + 5 bodies refused 400 malformed_rule, 0 stored; the field and action refusals unchanged; " + WELL.length + " well-formed stored once each, verbatim";
});

await check("S4", "POST /api/rules/preview: a malformed root → 400 malformed_rule and the evaluator is never reached; a well-formed root is counted", async () => {
  const { previewRoute, evaluate } = M;
  const wrong = [];
  previewed.length = 0;
  for (const [label, root] of BAD) {
    let r;
    try {
      r = await previewRoute.POST(req("/api/rules/preview", "POST", { root }));
    } catch (e) {
      wrong.push(label + ": the route threw " + (e && e.message));
      continue;
    }
    if (r.status !== 400 || r.body?.code !== "malformed_rule" || r.body?.error !== evaluate.RULE_SHAPE_REFUSED_SENTENCE) wrong.push(label + ": " + r.status + " " + JSON.stringify(r.body));
  }
  if (previewed.length) wrong.push(previewed.length + " malformed root(s) reached the evaluator's count");
  const ok = await previewRoute.POST(req("/api/rules/preview", "POST", { root: WELL[3][1] }));
  if (ok.status !== 200 || typeof ok.body?.count !== "number" || !(ok.body.count > 0) || previewed.length !== 1) wrong.push("a well-formed preview: " + ok.status + " " + JSON.stringify(ok.body));
  assert(!wrong.length, wrong.join(" | "));
  return BAD.length + " refused before the evaluator; a well-formed preview counted " + ok.body?.count;
});

await check("S5", "PATCH /api/modes: a malformed activationRule → 400 malformed_rule and the mode is never updated; a protected field → 400; a clock rule, null (clear) and a patch without one pass through", async () => {
  const { modesRoute } = M;
  const wrong = [];
  const made = await M.adapters.mode.create({ personaId: VIEWER, name: "Shape unit", isPreset: false, ranking: { recency: 0.4, engagement: 0.3, authorAffinity: 0.2, clusterAffinity: 0.1 }, ruleIds: [], notificationPolicy: "all", actionButtonSlots: { composer: [], nav: [] }, pinnedPersonaId: null, showTrending: true, calmRanking: false });
  const stored = async () => JSON.stringify(await M.adapters.mode.get(made.id));
  const s0 = await stored();
  for (const [label, root] of BAD) {
    let r;
    try {
      r = await modesRoute.PATCH(req("/api/modes", "PATCH", { modeId: made.id, patch: { activationRule: root, activationEnabled: true } }));
    } catch (e) {
      wrong.push(label + ": the route threw " + (e && e.message));
      continue;
    }
    if (r.status !== 400 || r.body?.code !== "malformed_rule") wrong.push(label + ": " + r.status + " " + JSON.stringify(r.body));
    else if (!/^Activation rule refused: its conditions must be/.test(String(r.body.error))) wrong.push(label + ": refused, but not by the shape gate: " + r.body.error);
  }
  const prot = await modesRoute.PATCH(req("/api/modes", "PATCH", { modeId: made.id, patch: { activationRule: { combinator: "AND", clauses: [{ field: "grants.tier", op: "eq", value: 1 }] }, activationEnabled: true } }));
  if (prot.status !== 400 || prot.body?.code !== "malformed_rule" || !/^Activation rule refused: attempts to reach the disclosure\/grant layer/.test(String(prot.body?.error))) wrong.push("a protected field: " + prot.status + " " + JSON.stringify(prot.body));
  if ((await stored()) !== s0) wrong.push("a refused patch changed the stored mode: " + (await stored()));
  for (const [label, patch, readBack] of [
    ["a clock rule", { activationRule: WELL[4][1], activationEnabled: true }, (m) => JSON.stringify(m.activationRule) === JSON.stringify(WELL[4][1]) && m.activationEnabled === true],
    ["null (clear)", { activationRule: null, activationEnabled: false }, (m) => m.activationRule === null && m.activationEnabled === false],
    ["a patch without one", { name: "Shape unit renamed" }, (m) => m.name === "Shape unit renamed"],
  ]) {
    const r = await modesRoute.PATCH(req("/api/modes", "PATCH", { modeId: made.id, patch }));
    const m = await M.adapters.mode.get(made.id);
    if (r.status !== 200 || !readBack(m)) wrong.push(label + ": " + r.status + " " + JSON.stringify(m));
  }
  await M.adapters.mode.delete(made.id).catch(() => {});
  assert(!wrong.length, wrong.join(" | "));
  return BAD.length + " shapes + a protected field refused, the mode unchanged; 3 good patches stored";
});

await check("S6", "THE ALGO AND PACK IMPORT SANITIZER: a malformed rule root, a non-object rule entry and a rule with no root are fatal to the import (never a TypeError); a well-formed artifact survives with its rule", async () => {
  const { artifact } = R_();
  const wrong = [];
  const base = { kind: "algo", schemaVersion: 1, name: "Imported", ranking: { recency: 0.4, engagement: 0.3, authorAffinity: 0.2, clusterAffinity: 0.1 }, modeFlags: {}, createdAt: 0, signature: "" };
  for (const kind of ["algo", "filter_pack"]) {
    const good = artifact.sanitizeArtifact({ ...base, kind, rules: [{ name: "mute", action: "hide", root: WELL[0][1] }] });
    if (!good.artifact || good.artifact.rules.length !== 1 || good.violations.length) wrong.push("a well-formed " + kind + ": " + JSON.stringify(good));
    for (const [label, root] of BAD) {
      const r = tryIt(() => artifact.sanitizeArtifact({ ...base, kind, rules: [{ name: "mute", action: "hide", root: WELL[0][1] }, { name: "bad", action: "hide", root }] }));
      if (r.e) {
        wrong.push(kind + " " + label + ": the sanitizer threw " + r.e.message);
        continue;
      }
      if (r.v.artifact !== null) wrong.push(kind + " " + label + ": the import survived with " + JSON.stringify(r.v.artifact.rules));
      if (!r.v.violations.some((v) => v.where === 'rule "bad"')) wrong.push(kind + " " + label + ": no violation names the rule: " + JSON.stringify(r.v.violations));
    }
    for (const [label, entry] of [["a null rule entry", null], ["a string rule entry", "hide everything"], ["a rule with no root", { name: "rootless", action: "hide" }]]) {
      const r = tryIt(() => artifact.sanitizeArtifact({ ...base, kind, rules: [entry] }));
      if (r.e) {
        wrong.push(kind + " " + label + ": the sanitizer threw " + r.e.message);
        continue;
      }
      if (r.v.artifact !== null || !r.v.violations.length) wrong.push(kind + " " + label + ": " + JSON.stringify(r.v));
    }
  }
  assert(!wrong.length, wrong.join(" | "));
  return "algo and pack: " + BAD.length + " malformed roots + 3 bad entries fatal to the import, never thrown; a good artifact survives";
});

const ruleOf = (id, name, action, root) => ({ id, name, action, root, createdAt: 0 });

await check("S7", "AN ALREADY-STORED RULE IS INERT AND SAID (runnableRules): a tree that cannot be walked and one reaching a protected field are left out, each with its sentence, the rest run in order; on the real Following the page is the page without it, and the mode's line names it ('inert', ahead of the Farcaster gaps)", async () => {
  const { evaluate, hubMode } = R_();
  const wrong = [];
  const good1 = ruleOf("r_good1", "Mute zebrafish", "hide", WELL[0][1]);
  const broken = ruleOf("r_broken", "Old mute", "hide", MALFORMED[0][1]);
  const prot = ruleOf("r_prot", "Who", "hide", PROTECTED);
  const good2 = ruleOf("r_good2", "Old last", "downrank", { combinator: "AND", clauses: [{ field: "post.age", op: "gt", value: 60 }] });
  const unnamed = ruleOf("r_unnamed", "", "hide", { combinator: "AND", clauses: [null] });
  const split = evaluate.runnableRules([good1, broken, prot, good2, unnamed]);
  if (split.run.map((r) => r.id).join() !== "r_good1,r_good2") wrong.push("ran: " + split.run.map((r) => r.id));
  if (split.inert.map((r) => r.id).join() !== "r_broken,r_prot,r_unnamed") wrong.push("left out: " + split.inert.map((r) => r.id));
  const say = Object.fromEntries(split.inert.map((r) => [r.id, r.sentence]));
  if (say.r_broken !== 'Rule "Old mute" can\'t be read, so it does nothing: it hides and moves no post. Delete it in Settings and make it again.') wrong.push("the shape sentence: " + say.r_broken);
  if (say.r_prot !== 'Rule "Who" reads something a rule isn\'t allowed to read, so it does nothing: it hides and moves no post. Delete it in Settings.') wrong.push("the field sentence: " + say.r_prot);
  if (!/^Rule "without a name" can't be read/.test(say.r_unnamed ?? "")) wrong.push("an unnamed rule's sentence: " + say.r_unnamed);
  // on the real Following (lib/fc/hubRead/mode.ts, what the loader hands it): the page under the mode is the page with
  // only the runnable rules, the inert ones are said first, in the evaluator's sentence
  const now = Date.now();
  const posts = [
    { hash: "0x01", fid: 11, ts: now - 60_000, text: "a zebrafish here", reply: false, embeds: 0 },
    { hash: "0x02", fid: 12, ts: now - 120_000, text: "plain words", reply: false, embeds: 0 },
    { hash: "0x03", fid: 13, ts: now - 3 * 3600_000, text: "an older post", reply: false, embeds: 0 },
  ];
  // (an engagement weight, so the line also carries a Farcaster gap the inert rules must come before)
  const spec = (rules, inertRules) => ({ id: "m", name: "Unit", ranking: { recency: 1, engagement: 0.3, authorAffinity: 0, clusterAffinity: 0 }, calmRanking: false, longformOnly: false, hideReplies: false, kingOfTheHill: false, rules, inertRules, deliveryRules: [], tiers: new Map(), tiersUnreadable: false, lens: { id: "c", name: null, source: "canonical", spec: null, missing: false }, packs: [] });
  const withInert = hubMode.shapeForMode(posts, spec(split.run, split.inert), { now, want: 10 });
  const onlyGood = hubMode.shapeForMode(posts, spec([good1, good2], []), { now, want: 10 });
  const h = (s) => s.items.map((p) => p.hash).join();
  if (h(withInert) !== h(onlyGood) || h(withInert) !== "0x02,0x03" || withInert.hidden !== 1) wrong.push("the page under the mode: " + h(withInert) + " vs " + h(onlyGood) + " hidden " + withInert.hidden);
  const g = withInert.gaps;
  const inertGaps = g.filter((x) => x.kind === "inert");
  if (inertGaps.map((x) => x.term).join("|") !== "Old mute|Who|" || inertGaps.some((x, i) => x.sentence !== split.inert[i].sentence)) wrong.push("the inert gaps: " + JSON.stringify(inertGaps));
  const firstOther = g.findIndex((x) => x.kind !== "inert");
  if (firstOther !== inertGaps.length || !g.some((x) => x.kind === "ranking" && x.term === "engagement")) wrong.push("the inert rules are not said first, ahead of the Farcaster gaps: " + JSON.stringify(g.map((x) => x.kind + ":" + x.term)));
  if (hubMode.gapsFor(spec(split.run, split.inert), "foryou").filter((x) => x.kind === "inert").length !== 3) wrong.push("For You drops the inert rules from its line");
  // the raw broken rule handed straight to the shaper (as an older loader would have): it still never throws, hides nothing
  // (the protected one is the loader's to leave out: handed over raw, its unknown field reads null and `neq` matches)
  const raw = tryIt(() => hubMode.shapeForMode(posts, spec([broken], []), { now, want: 10 }));
  if (raw.e) wrong.push("the shaper threw on a broken rule: " + raw.e.message);
  else if (raw.v.hidden !== 0) wrong.push("a broken rule handed to the shaper hid " + raw.v.hidden);
  assert(!wrong.length, wrong.join(" | "));
  return "2 run, 3 left out with their sentences; Following = the page without them, said first (Following and For You)";
});

await check("S8", "THE SAMPLE FEED (lib/feed.ts): a mode naming a stored malformed hide rule, a negated malformed one, a rule reaching a protected field and a good mute builds without a throw; the mute hides exactly what it hides alone, the inert ones hide nothing, inertRules names each with its sentence; a malformed activation rule never throws the build; good rules only: nothing said", async () => {
  const viewer = M.SEED_VIEWER.activePersonaId;
  const s = M.state();
  const active = await M.adapters.mode.getActive(viewer);
  const posts = (r) => r.cards.filter((c) => c.kind === "post" && c.cast && !c.private).map((c) => c.cast);
  const H = (r) => posts(r).map((c) => c.hash).join(",");
  const feed = (o = {}) => M.buildFeed(viewer, { surface: "discovery", limit: 40, ...o });
  const base = await feed({ modeOverride: { ...active, ruleIds: [] } });
  // a word on the page, so the good mute is not vacuous
  const word = posts(base).map((c) => (c.text.match(/[A-Za-z]{8,}/) ?? [])[0]).find(Boolean);
  assert(word, "the seeded window carries no usable word");
  const put = (id, name, action, root) => {
    s.rules.set(id, { id, name, action, root, createdAt: 0, personaId: viewer });
    return id;
  };
  const mute = put("rule_unit_mute", "Mute " + word, "hide", { combinator: "AND", clauses: [{ field: "post.text", op: "contains", value: word }] });
  const broken = put("rule_unit_broken", "Old mute", "hide", { op: "and", conditions: [{ field: "text", cmp: "contains", value: word }] });
  const negBroken = put("rule_unit_negbroken", "Only stars", "hide", { combinator: "AND", negate: true, clauses: [{ combinator: "OR" }] });
  const prot = put("rule_unit_prot", "Who", "hide", PROTECTED);
  const alone = await feed({ modeOverride: { ...active, ruleIds: [mute] } });
  assert(posts(base).some((c) => c.text.includes(word)) && !posts(alone).some((c) => c.text.includes(word)), "the good mute alone hid nothing (vacuous)");
  // the three inert ones, with the mute: built, never thrown
  let mixed;
  try {
    mixed = await feed({ modeOverride: { ...active, ruleIds: [broken, mute, negBroken, prot] } });
  } catch (e) {
    throw new Error("the feed threw on a stored malformed rule: " + (e && e.message));
  }
  const wrong = [];
  if (H(mixed) !== H(alone)) wrong.push("the page under the inert rules differs from the mute alone (" + posts(mixed).length + " vs " + posts(alone).length + " posts)");
  const said = (mixed.inertRules ?? []).map((r) => r.id + "=" + r.sentence);
  const wantSaid = [
    broken + '=Rule "Old mute" can\'t be read, so it does nothing: it hides and moves no post. Delete it in Settings and make it again.',
    negBroken + '=Rule "Only stars" can\'t be read, so it does nothing: it hides and moves no post. Delete it in Settings and make it again.',
    prot + '=Rule "Who" reads something a rule isn\'t allowed to read, so it does nothing: it hides and moves no post. Delete it in Settings.',
  ];
  if (said.join("|") !== wantSaid.join("|")) wrong.push("inertRules: " + JSON.stringify(mixed.inertRules));
  // only the inert ones: the page is the page with no rule at all (nothing hidden, nothing blanked)
  const onlyInert = await feed({ modeOverride: { ...active, ruleIds: [broken, negBroken, prot] } });
  if (H(onlyInert) !== H(base) || !posts(onlyInert).length) wrong.push("the inert rules alone changed the page (" + posts(onlyInert).length + " vs " + posts(base).length + ")");
  // good rules only: nothing said
  if ((alone.inertRules ?? []).length !== 0) wrong.push("a good rule was said as inert: " + JSON.stringify(alone.inertRules));
  // a stored malformed ACTIVATION rule (applyActivationRuleIfDue runs on every build of the active mode): never thrown
  const owned = await M.adapters.mode.list(viewer);
  const other = owned.find((m) => m.id !== active.id);
  assert(other, "the viewer has one mode");
  const before = { rule: other.activationRule, on: other.activationEnabled };
  await M.adapters.mode.update(other.id, { activationRule: { combinator: "AND", clauses: [null] }, activationEnabled: true });
  try {
    const act = await feed();
    if ((await M.adapters.mode.getActive(viewer)).id !== active.id) wrong.push("a malformed activation rule switched the mode");
    if (!posts(act).length) wrong.push("the build under a malformed activation rule is empty");
  } catch (e) {
    wrong.push("a malformed activation rule threw the build: " + (e && e.message));
  } finally {
    await M.adapters.mode.update(other.id, { activationRule: before.rule ?? null, activationEnabled: !!before.on });
  }
  assert(!wrong.length, wrong.join(" | "));
  return `the mute hid what it hides alone; 3 inert rules hid nothing and were named; a malformed activation rule built`;
});

if (!MUTATIONS.length && ONLY.length === 0) {
  const EV = "lib/rules/evaluate.ts";
  const RR = "app/api/rules/route.ts";
  const FD = "lib/feed.ts";
  const HM = "lib/fc/hubRead/mode.ts";
  const SHAPE_BLOCK = '  if (!Array.isArray(g.clauses)) {\n    out.push({ where, field: "clauses", reason: "has no list of conditions — refused" });\n    return out;\n  }\n  for (const clause of g.clauses as unknown[]) {';
  const runs = [
    ["the evaluator walks a tree it cannot walk (the crash)", "S1", [{ file: EV, find: "  if (!isWellFormedGroup(group)) return false;\n  return evalGroup(group, ctx);", replace: "  return evalGroup(group, ctx);" }]],
    ["the evaluator's guard checked per group, not per tree (a negated tree around a broken group matches everything)", "S1", [
      { file: EV, find: "  if (!isWellFormedGroup(group)) return false;\n  return evalGroup(group, ctx);", replace: "  return evalGroup(group, ctx);" },
      { file: EV, find: "function evalGroup(group: RuleGroup, ctx: EvalContext): boolean {\n", replace: "function evalGroup(group: RuleGroup, ctx: EvalContext): boolean {\n  if (!Array.isArray((group as { clauses?: unknown }).clauses) || (group.combinator !== \"AND\" && group.combinator !== \"OR\") || group.clauses.some((c) => !c || typeof c !== \"object\")) return false;\n" },
    ]],
    ["fieldsOf walks a broken tree", "S1", [{ file: EV, find: "  if (!isWellFormedGroup(group)) return [];\n  const out = new Set<RuleField>();", replace: "  const out = new Set<RuleField>();" }]],
    ["describeGroup throws on a broken tree (the saved-rules screen)", "S1", [{ file: EV, find: '  if (!isWellFormedGroup(group)) return "(this rule can\'t be read, so it does nothing: delete it and make it again)";\n', replace: "" }]],
    ["validateRuleGroup reads a missing clause list as no clauses (the defect)", "S2", [{ file: EV, find: SHAPE_BLOCK, replace: "  for (const clause of ((g.clauses as unknown[]) ?? [])) {" }]],
    ["validateRuleGroup does not check the combinator", "S2", [{ file: EV, find: '  if (g.combinator !== "AND" && g.combinator !== "OR")\n    out.push(', replace: "  if (false)\n    out.push(" }]],
    ["validateRuleGroup reads a non-object root", "S2", [{ file: EV, find: '  if (!group || typeof group !== "object" || Array.isArray(group)) return [{ where, field: "root", reason: "not a rule group — refused" }];', replace: "" }]],
    ["validateRuleGroup reads a null condition", "S2", [{ file: EV, find: '    if (!clause || typeof clause !== "object" || Array.isArray(clause)) {\n      out.push({ where, field: "clause", reason: "a condition that is neither a condition nor a group — refused" });\n      continue;\n    }', replace: "" }]],
    ["validateRuleGroup accepts a condition with no field or op", "S2", [{ file: EV, find: '    if (typeof c.field !== "string" || typeof c.op !== "string") {', replace: "    if (false) {" }]],
    ["isWellFormedGroup accepts a missing clause list", "S3", [{ file: EV, find: '  if ((g.combinator !== "AND" && g.combinator !== "OR") || !Array.isArray(g.clauses)) return false;', replace: '  if (g.combinator !== "AND" && g.combinator !== "OR") return false;\n  if (!Array.isArray(g.clauses)) return true;' }]],
    ["the route's shape gate removed (the field check refuses it in other words)", "S3", [{ file: RR, find: "  if (!isWellFormedGroup(body.root)) return", replace: "  if (false) return" }]],
    ["the route's shape gate AND the validator's shape check removed (stored)", "S3", [
      { file: RR, find: "  if (!isWellFormedGroup(body.root)) return", replace: "  if (false) return" },
      { file: EV, find: SHAPE_BLOCK, replace: "  for (const clause of ((g.clauses as unknown[]) ?? [])) {" },
    ]],
    ["the route's field check removed", "S3", [{ file: RR, find: "  const violations = validateRuleGroup(body.root);\n  if (violations.length)", replace: "  const violations = validateRuleGroup(body.root);\n  if (false)" }]],
    ["the route reads a body that is not an object", "S3", [{ file: RR, find: '  if (!body || typeof body !== "object" || Array.isArray(body)) return', replace: "  if (false) return" }]],
    ["the preview's shape gate removed", "S4", [{ file: "app/api/rules/preview/route.ts", find: "  if (!isWellFormedGroup(root)) return", replace: "  if (false) return" }]],
    ["PATCH /api/modes stores an activation rule the evaluator cannot walk", "S5", [{ file: "app/api/modes/route.ts", find: "    if (!isWellFormedGroup(activation)) return", replace: "    if (false) return" }]],
    ["PATCH /api/modes stores an activation rule reaching a protected field", "S5", [{ file: "app/api/modes/route.ts", find: "    if (violations.length) return NextResponse.json({ error: \"Activation rule refused: \"", replace: "    if (false) return NextResponse.json({ error: \"Activation rule refused: \"" }]],
    ["the importer reads a non-object rule entry", "S6", [{ file: "lib/algo/artifact.ts", find: '    if (!r || typeof r !== "object" || Array.isArray(r)) {', replace: "    if (false) {" }]],
    ["a stored rule reaching a protected field runs", "S7", [{ file: EV, find: "  return validateRuleGroup(root).length ? \"field\" : null;", replace: "  return null;" }]],
    ["an inert rule left unsaid on the real Following", "S7", [{ file: HM, find: '  for (const r of spec.inertRules ?? []) out.push({ kind: "inert", term: r.name, sentence: r.sentence });', replace: "" }]],
    ["the sample feed runs its stored rules unchecked", "S8", [{ file: FD, find: "  const owned = runnableRules(stored);", replace: "  const owned = { run: stored, inert: [] as InertRule[] };" }]],
    ["the sample feed's author question walks a broken tree by hand (the build throws)", "S8", [
      { file: FD, find: "  const owned = runnableRules(stored);", replace: "  const owned = { run: stored, inert: [] as InertRule[] };" },
      { file: FD, find: "  const referencesAuthor = (grp: Rule[\"root\"]): boolean => fieldsOf(grp).some((f) => /^author\\./.test(f));", replace: "  const referencesAuthor = (grp: Rule[\"root\"]): boolean =>\n    grp.clauses.some((c) => (\"combinator\" in c ? referencesAuthor(c) : /^author\\./.test(c.field)));" },
    ]],
    ["the sample feed does not say its inert rules", "S8", [{ file: FD, find: "  const inertRules: InertRule[] = [...owned.inert, ...packed.inert];", replace: "  const inertRules: InertRule[] = [...packed.inert];" }]],
  ];
  await check("M", "MUTATIONS: each guard removed in the bundle only — the check that covers it FAILS (" + runs.length + " mutations)", async () => {
    const survived = [];
    for (const [label, target, muts] of runs) {
      const r = spawnSync(process.execPath, [SELF, "--only=" + target], {
        cwd: ROOT,
        env: { ...process.env, RULESHAPE_MUTATION: JSON.stringify(muts), RULESHAPE_UNIT_QUIET: "1", KEYSTORE_DIR: "" },
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
const summary = `${passed}/${passed + failed} rule-shape unit checks passed` + (failed ? ` — FAILED: ${failedIds.join(",")}` : "");
console.log((QUIET ? "" : "\n") + summary);
process.exit(failed ? 1 : 0);
