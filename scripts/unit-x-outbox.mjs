// PERSONA LAUNCH P8 — node-only unit harness: THE @totem X OUTBOX (fixture only — nothing here reaches X or any network
// but an in-process validator on an ephemeral loopback port, never a pinned one).
//
//   node scripts/unit-x-outbox.mjs          (npm run test:x-outbox-unit once the verify agent adds the script)
//
// The client modules are bundled with esbuild (the repo's devDependency, the @/ paths from tsconfig.json) with their
// stateful neighbours replaced by in-memory mocks; the validator's own modules are required straight from validator/.
// Every guard has a MUTATION below — a deliberately broken copy of the module (built in a temp directory or compiled in
// memory under the real filename, never the repo file) whose named check MUST go red, so no check passes vacuously.
//
//   P  THE TEXT POLICY, BOTH SIDES (a DELIBERATE DUPLICATE pair): one corpus (named cases + 400 seeded fuzz strings)
//      through lib/x/outbox/policy.ts and validator/xoutbox.js gives byte-equal answers; the named cases say what they
//      must (mention, two links, http, bare link, > 280, a paragraph, three hashtags, a long quote, a bare link alone, a
//      control character, an over-long link, an over-size text refused; quote-and-link accepted)
//   H  THE HASH, THE SCOPE, THE CANONICAL FORM, THE MESSAGE: xHash equal on three sides and never the cast hash; the
//      x-anon-post scope and its field value equal on both sides for every window, distinct from every anon-post slot's;
//      the canonical public inputs equal and ending |xHash|slot; s<K_X>, a bare window and a negative slot refused by
//      both; the real lib/zk/prove.ts proves an X copy as 'anon' over the plain tree only, with the validator's own
//      scope and message
//   B  THE CLAIM BINDING on the real validator (verifyAndRecord over createApp(":memory:")): live 503 before anything;
//      a reach tree, an extra payload key, a tampered text, a slot ≥ K_X, a bare-window scope, the anon kinds' fields on
//      an X copy, xHash on every other kind, the policy — each refused by the guard that owns it, and the honest
//      envelope accepted afterwards with the same nullifier (nothing consumed)
//   G  requestXAnonPost REFUSES BEFORE ANY MINT OR WRITE: availability, the live universe, the browser device, the
//      persona, the policy, an outbox not read, a served K_X that differs, the X window (K_X), the daily cap — no X
//      record, no wanted entry, no persisted namespace
//   T  THE TICK: an X copy proves the plain tree with a uniform free X slot (K_X = 2: two copies, two slots, a third
//      refused); the payload is exactly {text, nonce}; X slots and anon-post slots are counted apart (K anon posts and
//      K_X copies all go in one window); a copy folds into its persona's crowd count, a standalone X post does not
//   Q  THE QUEUE SEAMS: the BROWSER device re-jitters overdue items on its first drain (inside the epoch clamp) while
//      the node drain sends them; settled X submissions of a closed window are pruned onto the sealed record;
//      queueStatus never lists an X record
//   Q3-5, B3 (wave 3) THE EPOCH END, THE EXPIRY, THE RESUMED DRAIN, REPEATED WORDS: an item's epoch end is the
//      snapshot's; the boot re-jitter keeps no-grace items before it; a no-grace item whose epoch is over is expired on
//      the device and never sent; a tick re-arms the drain for a hydrated queued item; repeated words are a 400 refusal
//      that frees the X slot
//   V / O (wave 3) THE VIEW AND THE OFFER: the view is compartment-scoped and carries no personaId / copyOf; no moderator
//      means not offered; a rejected copy is not final
//   M  MODERATION: the moderator key is the HKDF branch "layers/x-moderator/1" of the vault key; a decision signed on
//      the device verifies on the validator; forged, replayed for another id, an unregistered key and a stale hour are
//      refused; the same signed decision twice is a replay; M2 (wave 3): moderate/2's fresh nonce lets reject → approve →
//      reject land in one hour
//   D  MIGRATION 26 on a copy of a wave-2 database (the rig's own validator DB when there is one): up adds exactly its
//      four tables and changes no other row; down drops exactly them; a re-run is a no-op; an up interrupted before its
//      version row re-runs cleanly
//   S  SOURCE RULES: validator/xoutbox.js and lib/x/outbox/** import no socket/http/fetch and name no X API host; the
//      X slot choice passes the client's own K_X and a served K_X is only ever compared; the route imports nothing but
//      next/server at its top; the composer's box defaults off, shows only with "Post anonymously" ticked, and sends
//      the copy only after the anonymous post's 202
//   Z  THE SIZE: the worst-case X copy the policy takes fits the anonymous channel's constant 4096-byte body
import { createRequire, Module } from "node:module";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = mkdtempSync(path.join(os.tmpdir(), "layers-x-outbox-unit-"));
process.on("exit", () => rmSync(HERE, { recursive: true, force: true }));
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
// both sides read these at call or load time: the defaults, a plain anon tree that is every active root ("valid")
for (const k of ["ZK_ANON_POST_SLOTS", "ZK_X_ANON_POST_SLOTS", "ZK_ANON_POST_WINDOW_EPOCHS", "ZK_GATE_TIER", "X_OUTBOX_MODERATORS", "X_OUTBOX_DAILY_CAP", "X_OUTBOX_RELAY_SPREAD_MS", "LAYERS_WORLD", "ZK_ANON_POST", "LAYERS_REQUIRE_SIG", "NODE_ENV", "ZK_ANON_REACH_ISSUERS"]) delete process.env[k];
process.env.ZK_ANON_POST_TREE = "valid";
const PLAIN = "valid";

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
async function bundle(entrySrc, mocks = {}, patches = {}) {
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
    name: "x-outbox-mocks",
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
  // nodePaths: a PATCHED copy lives in the temp dir, outside the repo — its bare imports (@noble/…) resolve from the repo's
  // node_modules (wave 3: without it a patched moderation.ts failed to BUILD, and its mutation went "red" vacuously)
  await build({ absWorkingDir: ROOT, entryPoints: [entry], outfile: out, bundle: true, format: "esm", platform: "node", target: ["node20"], tsconfig: path.join(ROOT, "tsconfig.json"), plugins: [plugin], loader: { ".json": "json" }, logLevel: "error", nodePaths: [path.join(ROOT, "node_modules")] });
  return import(pathToFileURL(out).href);
}
/** a validator module compiled in memory with edits, under its REAL filename (its relative requires resolve as the real file's) */
function patchedValidator(file, edits) {
  const abs = path.join(ROOT, "validator", file);
  let src = readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error(`patch anchor not found in validator/${file}: ` + from.slice(0, 90));
    src = src.split(from).join(to);
  }
  const m = new Module(abs, null);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(src, abs);
  return m.exports;
}

// the validator, in process (dev hooks on: the rig's shape), on an ephemeral loopback port
process.env.ZK_DEV_HOOKS = "true";
const vz = require(path.join(ROOT, "validator", "zk.js"));
const vx = require(path.join(ROOT, "validator", "xoutbox.js"));
const vmig = require(path.join(ROOT, "validator", "migrations.js"));
const { createApp } = require(path.join(ROOT, "validator", "server.js"));
const VAPP = createApp(":memory:");
const vserver = await new Promise((resolve) => {
  const s = VAPP.app.listen(0, "127.0.0.1", () => resolve(s));
});
const VB = "http://127.0.0.1:" + vserver.address().port;
const vapi = async (method, p, body) => {
  const r = await fetch(VB + p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
await vapi("POST", "/zk/dev/seed-decoys", { mode: "fixture", count: 6 });
await vapi("POST", "/zk/dev/advance-epoch", { mode: "fixture" });

// ================================================================================================ P — the policy
const POLICY = await bundle(`export * as policy from "@/lib/x/outbox/policy";\n`);
const NAMED = [
  // [name, text, expected: "ok:<kind>" | a regex the refusal matches]
  ["a plain post", "a plain thought, nothing more", "ok:post"],
  ["quote and link", "this is the bit worth reading https://example.org/a/b?c=d", "ok:quote-link"],
  ["link mid-sentence with trailing punctuation", "read https://example.org/x. it is short", "ok:quote-link"],
  ["an @mention", "agree with @someone here", /mention/],
  ["a fullwidth mention", "agree with ＠someone here", /mention/],
  ["an email is a bare link, not a mention", "write to me at me@example.org", /https/],
  ["two links", "one https://a.example.org two https://b.example.org", /one link/],
  ["an http link", "see http://example.org now", /https/],
  ["a bare domain", "see example.org now", /https/],
  ["three hashtags", "#one #two #three", /two hashtags/],
  ["two hashtags", "#one #two fine", "ok:post"],
  ["a paragraph break", "first part\n\nsecond part", /One paragraph/],
  ["one line break", "first line\nsecond line", "ok:post"],
  ["281 weighted", "x".repeat(281), /too long for X: 281/],
  ["280 weighted", "x".repeat(280), "ok:post"],
  ["141 CJK (282 weighted)", "見".repeat(141), /too long for X: 282/],
  ["140 CJK (280 weighted)", "見".repeat(140), "ok:post"],
  ["a link counts 23 whatever its length", "y".repeat(199) + " https://example.org/" + "z".repeat(400), "ok:quote-link"],
  ["a link with 201 own characters", "q".repeat(201) + " https://example.org/a", /200 characters/],
  ["a link with 200 own characters", "q".repeat(199) + " https://example.org/a", "ok:quote-link"],
  ["a link alone", "https://example.org/a", /words of your own/],
  ["a control character", "bell\u0007 here", /can't show/],
  ["a tab", "tab\there", /can't show/],
  ["a line separator", "line\u{2028}sep", /can't show/],
  ["an over-long link", "look https://example.org/" + "a".repeat(600), /link is too long/],
  ["an over-size text", "\u0001".repeat(10), /can't show/],
  ["over 2048 escaped bytes", '"'.repeat(1100), /too long to send/],
  ["empty", "   ", /Write something/],
  ["not a string", null, /Write something/],
];
/** 400 seeded strings over the policy's edge alphabet (deterministic: the same corpus every run) */
function fuzzCorpus() {
  let seed = 0x5eed1234;
  const rnd = (n) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % n;
  };
  // mostly benign pieces, with the policy's edges mixed in at about one piece in ten (so both sides see plenty of each)
  const benign = ["word ", "x", "見", "😀", " ", "é", "ß", '"', "\\", "\n", " #tag", "&#x", "ok. "];
  const risky = ["@a", " https://e.org/p ", "http://e.org", "e.org ", "\n\n", "\u0001", " ＃t", "a.com/x ", " https://e.org/" + "q".repeat(600)];
  const out = [];
  for (let i = 0; i < 400; i++) {
    let s = "";
    const len = 1 + rnd(30);
    for (let j = 0; j < len; j++) s += rnd(10) === 0 ? risky[rnd(risky.length)] : benign[rnd(benign.length)];
    if (rnd(8) === 0) s = s.repeat(1 + rnd(20));
    out.push(s);
  }
  return out;
}
const FUZZ = fuzzCorpus();
function policyScenario(clientShape, validatorShape) {
  let n = 0;
  for (const [name, text, want] of NAMED) {
    const c = clientShape(text);
    const v = validatorShape(text);
    assert(JSON.stringify(c) === JSON.stringify(v), `${name}: client ${JSON.stringify(c).slice(0, 160)} ≠ validator ${JSON.stringify(v).slice(0, 160)}`);
    if (typeof want === "string") assert(c.ok && "ok:" + c.kind === want, `${name}: expected ${want}, got ${JSON.stringify(c).slice(0, 160)}`);
    else assert(!c.ok && want.test(c.reason), `${name}: expected a refusal matching ${want}, got ${JSON.stringify(c).slice(0, 160)}`);
    n++;
  }
  let ok = 0;
  for (const text of FUZZ) {
    const c = clientShape(text);
    const v = validatorShape(text);
    assert(JSON.stringify(c) === JSON.stringify(v), `fuzz ${JSON.stringify(text).slice(0, 60)}: client ${JSON.stringify(c).slice(0, 120)} ≠ validator ${JSON.stringify(v).slice(0, 120)}`);
    if (c.ok) ok++;
    n++;
  }
  assert(ok > 20 && ok < FUZZ.length - 20, `the fuzz corpus is one-sided (${ok} of ${FUZZ.length} accepted) — it would not tell two policies apart`);
  return `${n} texts byte-equal (${ok} of ${FUZZ.length} fuzz strings accepted)`;
}
console.log("\nP — the text policy, both sides");
await check("P1 one corpus (29 named cases, 400 seeded fuzz strings) gives byte-equal answers from lib/x/outbox/policy.ts and validator/xoutbox.js, and each named case is accepted or refused as the owner's rule says", () => policyScenario((t) => POLICY.policy.xPostShape(t), (t) => vx.xPostShape(t)));
const CLIENT_GUARDS = [
  ["the mention refusal", "if (X_MENTION_RE.test(text)) return", "if (false) return"],
  ["the https-only refusal", "if (links.some((u) => !/^https:\\/\\//i.test(u))) return", "if (false) return"],
  ["the one-link refusal", "if (links.length > 1) return", "if (false) return"],
  ["the link-length bound", "[...u].length > X_MAX_LINK_CHARS", "[...u].length > 1e9"],
  ["the hashtag limit", "if (tags.length > X_MAX_HASHTAGS) return", "if (false) return"],
  ["the paragraph refusal", "if (X_PARAGRAPH_RE.test(text)) return", "if (false) return"],
  ["the 280 limit", "if (weighted > X_MAX_WEIGHTED) return", "if (false) return"],
  ["a link weighing 23", "weighted += xWeigh(before) + X_URL_WEIGHT;", "weighted += xWeigh(before) + url.length;"],
  ["the 200-character quote", "if ([...own].length > X_QUOTE_MAX_CHARS) return", "if (false) return"],
  ["the words-of-your-own rule", "if (!own) return", "if (false) return"],
  ["the control-character refusal", "if (X_CONTROL_RE.test(text)) return", "if (false) return"],
  ["the escaped-size bound", "- 2 > X_MAX_TEXT_BYTES) return", "- 2 > 1e9) return"],
];
for (const [name, from, to] of CLIENT_GUARDS) {
  await mutation(`P1 / the client's ${name} removed (lib/x/outbox/policy.ts)`, async () => {
    const M = await bundle(`export * as policy from "@/lib/x/outbox/policy";\n`, {}, { "lib/x/outbox/policy.ts": [[from, to]] });
    policyScenario((t) => M.policy.xPostShape(t), (t) => vx.xPostShape(t));
  });
}
await mutation("P1 / the VALIDATOR's mention refusal removed (validator/xoutbox.js)", async () => {
  const P = patchedValidator("xoutbox.js", [["if (X_MENTION_RE.test(text)) return", "if (false) return"]]);
  policyScenario((t) => POLICY.policy.xPostShape(t), (t) => P.xPostShape(t));
});
await mutation("P1 / the VALIDATOR's quote limit removed (validator/xoutbox.js)", async () => {
  const P = patchedValidator("xoutbox.js", [["if ([...own].length > X_QUOTE_MAX_CHARS) return", "if (false) return"]]);
  policyScenario((t) => POLICY.policy.xPostShape(t), (t) => P.xPostShape(t));
});

// ================================================================================================ H — hash, scope, canonical, message
const CLIENT = await bundle(`export * as scopes from "@/lib/zk/scopes";
export * as slots from "@/lib/zk/anon/slots";
export * as config from "@/lib/zk/config";
export * as hash from "@/lib/zk/hash";
export * as policy from "@/lib/x/outbox/policy";
export { canonicalPublicInputs } from "@/lib/zk/transport/types";
`);
const XENTRY = { feature: "x-anon-post", onePerHuman: true };
const AENTRY = { feature: "anon-post", onePerHuman: true };
function hashScenario(Cx) {
  // the xHash, three sides, and never the cast hash
  for (const [i, text] of [...NAMED.map((x) => x[1]).filter((t) => typeof t === "string"), ...FUZZ.slice(0, 50)].entries()) {
    const nonce = createHash("sha256").update("nonce" + i).digest("hex").slice(0, 32);
    const c = Cx.policy.xHashOf(text, nonce);
    assert(c === vx.xHashOf(text, nonce) && c === vz.xAnonHash(text, nonce), `xHash differs for ${JSON.stringify(text).slice(0, 40)}`);
    assert(c !== createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex"), "an X copy's id equals its Farcaster cast hash");
  }
  const k = Cx.config.ZK_X_ANON_POST_SLOTS;
  assert(k === 1 && vz.xAnonPostSlots() === 1, `K_X is not 1 on both sides (client ${k}, validator ${vz.xAnonPostSlots()})`);
  let n = 0;
  for (const epoch of [0, 1, 7, 40, 4095, 123456789]) {
    const w = Cx.config.anonPostWindowOf(epoch);
    const c = Cx.scopes.scopeString("x-anon-post", epoch, undefined, Cx.slots.xSlotQualifier(w, 0));
    const v = vz.scopeString(XENTRY, epoch, undefined, vz.xSlotQualifier(epoch, 0));
    assert(c === v, `X scope differs at epoch ${epoch}: client ${c} validator ${v}`);
    assert(Cx.hash.fieldOf("scope", c).toString(10) === vz.fieldOf("scope", v), "X scope field value differs");
    // never an anon-post slot's scope, for ANY of the K anon slots
    for (let i = 0; i < Cx.config.ZK_ANON_POST_SLOTS; i++) assert(vz.fieldOf("scope", vz.scopeString(AENTRY, epoch, undefined, vz.anonSlotQualifier(epoch, i))) !== vz.fieldOf("scope", v), `the X scope equals anon-post slot ${i}'s at epoch ${epoch}`);
    const p = { mode: "fixture", claimKind: "x-anon-post", tree: PLAIN, epoch, merkleTreeRoot: "7", scope: "1", message: "2", personaId: "anon", gateId: "x-anon-post", challenge: "epoch-" + epoch, xHash: "a".repeat(64), slot: 0 };
    assert(Cx.canonicalPublicInputs(p) === vz.canonicalPublicInputs(p), "canonical public inputs differ for an X copy");
    assert(Cx.canonicalPublicInputs(p).endsWith("|" + "a".repeat(64) + "|0"), "the canonical form does not end |xHash|slot");
    const { slot: _s, ...noSlot } = p;
    assert(Cx.canonicalPublicInputs(noSlot) === vz.canonicalPublicInputs(noSlot) && Cx.canonicalPublicInputs(noSlot) !== Cx.canonicalPublicInputs(p), "a slot-less X envelope canonicalises like slot 0");
    n++;
  }
  // refused by both: s<K_X>, the bare window, a negative / malformed slot
  for (const q of ["w5/s1", "w5", "w5/s-1", "w5/s", "5/s0", "w5/s100"]) {
    let c = false;
    let v = false;
    try {
      Cx.scopes.scopeString("x-anon-post", 5, undefined, q);
    } catch {
      c = true;
    }
    try {
      vz.scopeString(XENTRY, 5, undefined, q);
    } catch {
      v = true;
    }
    assert(c && v, `X qualifier ${q}: client ${c ? "refused" : "ACCEPTED"}, validator ${v ? "refused" : "ACCEPTED"}`);
  }
  // the unqualified client call is the self-test's / accept-z0's legacy string; a persona on it fails closed
  assert(Cx.scopes.scopeString("x-anon-post", 5) === "layers/zk-scope/v1|x-anon-post|5", "the unqualified x-anon-post scope is not the registry walk's form");
  let pp = false;
  try {
    Cx.scopes.scopeString("x-anon-post", 5, "p_x", "w5/s0");
  } catch {
    pp = true;
  }
  assert(pp, "a persona id was accepted on the x-anon-post scope");
  const entry = Cx.scopes.SCOPE_REGISTRY.find((e) => e.id === "x-anon-post");
  assert(entry && entry.feature === "x-anon-post" && entry.onePerHuman === true && /disclosed/.test(entry.linkage), "the registry entry is not a onePerHuman entry with a disclosed linkage line");
  return `${n} windows byte-equal; never an anon-post slot's scope`;
}
console.log("\nH — the hash, the scope, the canonical form, the message");
await check("H1 xHash equal on three sides (policy.ts, xoutbox.js, zk.js) and never the cast hash; the x-anon-post scope, its field value and the canonical public inputs (…|xHash|slot) equal on both sides for every window and never an anon-post slot's scope; s<K_X>, the bare window and malformed slots refused by both; the registry entry is onePerHuman and discloses the sibling link", () => hashScenario(CLIENT));
await mutation("H1 / the X part dropped from the client's canonical public inputs (lib/zk/transport/types.ts)", async () => {
  const M = await bundle(`export * as scopes from "@/lib/zk/scopes";\nexport * as slots from "@/lib/zk/anon/slots";\nexport * as config from "@/lib/zk/config";\nexport * as hash from "@/lib/zk/hash";\nexport * as policy from "@/lib/x/outbox/policy";\nexport { canonicalPublicInputs } from "@/lib/zk/transport/types";\n`, {}, { "lib/zk/transport/types.ts": [['...(p.claimKind === "x-anon-post" ? [p.xHash ?? "", p.slot === undefined || p.slot === null ? "" : String(p.slot)] : []),', ""]] });
  hashScenario(M);
});
await mutation("H1 / the client's K_X bound removed (lib/zk/scopes.ts)", async () => {
  const M = await bundle(`export * as scopes from "@/lib/zk/scopes";\nexport * as slots from "@/lib/zk/anon/slots";\nexport * as config from "@/lib/zk/config";\nexport * as hash from "@/lib/zk/hash";\nexport * as policy from "@/lib/x/outbox/policy";\nexport { canonicalPublicInputs } from "@/lib/zk/transport/types";\n`, {}, { "lib/zk/scopes.ts": [["if (xslot >= ZK_X_ANON_POST_SLOTS)", "if (xslot >= 99)"]] });
  hashScenario(M);
});
await mutation("H1 / the client's X hash under the cast hash's domain (lib/x/outbox/policy.ts)", async () => {
  const M = await bundle(`export * as scopes from "@/lib/zk/scopes";\nexport * as slots from "@/lib/zk/anon/slots";\nexport * as config from "@/lib/zk/config";\nexport * as hash from "@/lib/zk/hash";\nexport * as policy from "@/lib/x/outbox/policy";\nexport { canonicalPublicInputs } from "@/lib/zk/transport/types";\n`, {}, { "lib/x/outbox/policy.ts": [['const X_DOMAIN = "layers-x-anon/1|";', 'const X_DOMAIN = "layers-anon-cast/1|";']] });
  hashScenario(M);
});

// ---- the real prover
const H6 = 6 * 3_600_000;
const PROVE_MOCKS = {
  "server-only": `export {};`,
  "lib/identity/keystore": `export function isOwnPersona(id) { return id === "p_x"; }`,
  "lib/adapters/mock/store": `export const SEED_VIEWER = { personas: ["persona_viewer_main"], activePersonaId: "persona_viewer_main" };`,
  "lib/zk/identity": `export function zkCommitment() { return "7"; }`,
  "lib/zk/rootHistory": `export function verifyRootAgainstHistoryWith() { return { ok: true }; } export async function verifyRootAgainstHistory() { throw new Error("no fetch with a snapshot"); }`,
  "lib/zk/validatorClient": `export async function fetchEpoch() { throw new Error("no fetch with a snapshot"); } export async function fetchMembers() { throw new Error("no fetch with a snapshot"); }`,
  "lib/zk/localPins": `
const P = (globalThis.__XUP ??= { cohorts: new Map(), budgets: new Map(), inter: new Map() });
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
const PROVE_ENTRY = `export * as prove from "@/lib/zk/prove";\nexport * as cohort from "@/lib/zk/cohort";\nexport * as budget from "@/lib/zk/budget";\n`;
const PR = await bundle(PROVE_ENTRY, PROVE_MOCKS);
function proveSnap(Px, tree, epoch, n = 60) {
  const list = ["7", ...Array.from({ length: n - 1 }, (_, i) => String(1000 + i))];
  const root = Px.cohort.rootOfMembers(list);
  return { mode: "fixture", tree, epoch: { mode: "fixture", epoch, epochMs: H6, msRemaining: H6 - 60_000 }, members: { mode: "fixture", tree, epoch, root, members: list }, history: { pubkey: "k", entries: [] }, validatorKey: "k", anonHead: null, anonHeadError: null, buckets: [], bucketsError: null, issuers: [], anonConfig: null, anonConfigError: null, fetchedAt: Date.now(), ms: 1 };
}
const xReq = (o = {}) => ({ claimKind: "x-anon-post", tree: PLAIN, personaId: "anon", gateId: "x-anon-post", mode: "fixture", xHash: "a".repeat(64), slot: 0, ...o });
async function proverScenario(Px) {
  globalThis.__XUP = { cohorts: new Map(), budgets: new Map(), inter: new Map() };
  const ok = await Px.prove.prepareAndProve(xReq(), proveSnap(Px, PLAIN, 500));
  assert(ok.ok, "an X copy was refused: " + JSON.stringify(ok));
  const pub = ok.envelope.publicInputs;
  const v = vz.expectedPublicValues(pub);
  assert(v.scope === pub.scope && v.message === pub.message, "the X scope/message differ from the validator's own derivation");
  assert(pub.personaId === "anon" && pub.xHash === "a".repeat(64) && pub.slot === 0 && pub.castHash === undefined && pub.noteHash === undefined, "the X public inputs carry the wrong fields: " + JSON.stringify(pub));
  assert(vz.expectedPublicValues({ ...pub, xHash: "b".repeat(64) }).message !== pub.message, "the message does not bind the xHash");
  for (const [name, o, stage] of [
    ["a persona", { personaId: "p_x" }, "persona"],
    ["a reach tree", { tree: "attest:fc.reach/gte-10k" }, "scope"],
    ["no xHash", { xHash: undefined }, "scope"],
    ["X slot 1 (K_X = 1)", { slot: 1 }, "scope"],
    ["no slot", { slot: undefined }, "scope"],
    ["a cast hash", { castHash: "c".repeat(64) }, "scope"],
    ["a note hash", { noteHash: "c".repeat(64) }, "scope"],
  ]) {
    const r = await Px.prove.prepareAndProve(xReq(o), proveSnap(Px, o.tree ?? PLAIN, 501));
    assert(!r.ok && r.stage === stage, `an X copy with ${name}: ` + JSON.stringify(r));
  }
  // an xHash on an anon post is refused
  const onAnon = await Px.prove.prepareAndProve({ claimKind: "anon-post", tree: PLAIN, personaId: "anon", gateId: "anon-post", mode: "fixture", castHash: "a".repeat(64), attributionCommitment: "b".repeat(64), noteHash: "c".repeat(64), slot: 0, xHash: "d".repeat(64) }, proveSnap(Px, PLAIN, 502));
  assert(!onAnon.ok && /X hash is only valid/.test(onAnon.reason), "an xHash on an anon post: " + JSON.stringify(onAnon));
  // the device budget: an anon post, its X copy and a launch request in one epoch all reserve (the X copy shares the
  // anon posts' partition — it names no persona)
  const ep = 503;
  const a = await Px.prove.prepareAndProve({ claimKind: "anon-post", tree: PLAIN, personaId: "anon", gateId: "anon-post", mode: "fixture", castHash: "a".repeat(64), attributionCommitment: "b".repeat(64), noteHash: "c".repeat(64), slot: 0 }, proveSnap(Px, PLAIN, ep));
  const l = await Px.prove.prepareAndProve({ claimKind: "persona-launch", tree: PLAIN, personaId: "anon", gateId: "persona-launch", mode: "fixture", launchCommit: "e".repeat(64) }, proveSnap(Px, PLAIN, ep));
  const x = await Px.prove.prepareAndProve(xReq(), proveSnap(Px, PLAIN, ep));
  assert(a.ok && l.ok && x.ok, "an anon post, its X copy and a launch request in one epoch did not all reserve: " + JSON.stringify([a.ok || a.reason, l.ok || l.reason, x.ok || x.reason]));
  return "scope and message = the validator's; persona, reach tree, missing xHash, slot ≥ K_X, the anon fields refused; budget shared with anon posts";
}
await check("H2 the real lib/zk/prove.ts proves an X copy as 'anon' over the plain tree only, with the validator's own scope and message (xHash bound); a persona, a reach tree, no xHash, X slot ≥ K_X, no slot, a cast or note hash are refused; an xHash on an anon post is refused; an anon post, its X copy and a launch request share one epoch's device budget", () => proverScenario(PR));
await mutation("H2 / the plain-tree-only rule dropped from the prover", async () => proverScenario(await bundle(PROVE_ENTRY, PROVE_MOCKS, { "lib/zk/prove.ts": [["if (req.tree !== ZK_ANON_POST_TREE) return { ok: false, stage: \"scope\", reason: `an X copy proves", "if (false) return { ok: false, stage: \"scope\", reason: `an X copy proves"]] })));
await mutation("H2 / the X message binding something else than x:<xHash>", async () => proverScenario(await bundle(PROVE_ENTRY, PROVE_MOCKS, { "lib/zk/prove.ts": [['messageParts = [ANON_PERSONA, "x-anon-post", "x:" + req.xHash, challenge, members.root];', 'messageParts = [ANON_PERSONA, "x-anon-post", challenge, members.root];']] })));
await mutation("H2 / the X copy given its own budget partition again (lib/zk/budget.ts)", async () => proverScenario(await bundle(PROVE_ENTRY, PROVE_MOCKS, { "lib/zk/budget.ts": [['if (claimKind === "x-anon-post") return predicateOf("anon-post", tree, "anon-post");', ""]] })));

// ================================================================================================ B — the claim binding, on the real validator
async function plainTree() {
  const m = await vapi("GET", "/zk/members?mode=fixture&tree=" + PLAIN);
  assert(m.status === 200, "members: " + JSON.stringify(m.json));
  return { epoch: m.json.epoch, root: m.json.root };
}
let personSeq = 0;
function xEnvelope(o) {
  const nonce = o.nonce ?? randomBytes(16).toString("hex");
  const xHash = o.xHash ?? vz.xAnonHash(o.text, nonce);
  const slot = o.slot ?? 0;
  const qual = o.bareWindow ? vz.anonPostWindowOf(o.epoch) : `${vz.anonPostWindowOf(o.epoch)}/s${slot}`;
  const scopeStr = `layers/zk-scope/v1|x-anon-post/${qual}`;
  const scope = vz.fieldOf("scope", scopeStr);
  const challenge = "epoch-" + o.epoch;
  const message = vz.fieldOf("message", ["anon", "x-anon-post", "x:" + xHash, challenge, o.root].join("|"));
  const pub = { mode: o.mode ?? "fixture", claimKind: "x-anon-post", tree: o.tree ?? PLAIN, epoch: o.epoch, merkleTreeRoot: o.root, scope, message, personaId: "anon", gateId: "x-anon-post", challenge, xHash, slot, ...(o.extraPub || {}) };
  const nullifier = vz.fieldOf("unit-nullifier", scopeStr + "|" + (o.person ?? "p"));
  const tag = vz.fixtureTag(vz.canonicalPublicInputs(pub), nullifier);
  return { v: 1, mode: pub.mode, claimKind: "x-anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag }, payload: { text: o.text, nonce, ...(o.extraPayload || {}) } };
}
/** [name, build(base) → envelope, status, a regex the error must match — the guard that OWNS the refusal] */
function bindingCases(base) {
  const anonText = "an anon post";
  const anonNonce = "e".repeat(32);
  const anonNote = "f".repeat(512);
  const castHash = createHash("sha256").update("layers-anon-cast/1|" + anonNonce + "|" + anonText, "utf8").digest("hex");
  const noteHash = createHash("sha256").update(Buffer.from(anonNote, "hex")).digest("hex");
  return [
    ["live (not built) — before any binding", () => xEnvelope({ ...base, mode: "live" }), 503, /not built/],
    ["a reach tree (X carries no boost)", () => xEnvelope({ ...base, tree: "attest:fc.reach/gte-10k" }), 400, /never a reach tier/],
    ["an extra payload key (a ring note)", () => xEnvelope({ ...base, extraPayload: { note: "e".repeat(512) } }), 400, /exactly the text and its nonce/],
    ["a tampered text", () => { const e = xEnvelope(base); e.payload.text = base.text + "!"; return e; }, 400, /does not hash to xHash/],
    ["X slot 1 (K_X = 1)", () => xEnvelope({ ...base, slot: 1 }), 400, /slot required, an integer from 0 to 0/],
    ["a bare-window scope", () => xEnvelope({ ...base, bareWindow: true }), 400, /canonical derivation/],
    ["a castHash on an X copy", () => xEnvelope({ ...base, extraPub: { castHash: "a".repeat(64) } }), 400, /castHash is not valid on an x-anon-post/],
    ["a noteHash on an X copy", () => xEnvelope({ ...base, extraPub: { noteHash: "a".repeat(64) } }), 400, /noteHash is not valid on an x-anon-post/],
    ["a launchCommit on an X copy", () => xEnvelope({ ...base, extraPub: { launchCommit: "a".repeat(64) } }), 400, /launchCommit is not valid on an x-anon-post/],
    ["another gate id", () => xEnvelope({ ...base, extraPub: { gateId: "anon-post" } }), 400, /gateId must be 'x-anon-post'/],
    // the policy, refused BEFORE the binding (the transaction's own re-check words its refusal differently — B2)
    ["the policy: two links", () => xEnvelope({ ...base, text: "one https://a.example.org two https://b.example.org" }), 400, /^x-anon-post: A post to X can carry one link/],
    ["the policy: an @mention", () => xEnvelope({ ...base, text: "hello @someone" }), 400, /^x-anon-post: Posts to @totem on X can't mention/],
    ["the policy: over 280", () => xEnvelope({ ...base, text: "y".repeat(281) }), 400, /^x-anon-post: That's too long for X/],
    ["the policy: a full repost (paragraphs)", () => xEnvelope({ ...base, text: "para one\n\npara two" }), 400, /^x-anon-post: One paragraph/],
    ["xHash on an anon post", () => ({ v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: { mode: "fixture", claimKind: "anon-post", tree: PLAIN, epoch: base.epoch, merkleTreeRoot: base.root, scope: "1", message: "1", personaId: "anon", gateId: "anon-post", challenge: "epoch-" + base.epoch, castHash, attributionCommitment: "b".repeat(64), slot: 0, noteHash, xHash: "d".repeat(64) }, nullifier: "5", proof: { scheme: "layers-zk-fixture/1", tag: "t" }, payload: { text: anonText, nonce: anonNonce, note: anonNote } }), 400, /xHash is only valid on an x-anon-post/],
    ["xHash on a launch request", () => ({ v: 1, mode: "fixture", claimKind: "persona-launch", publicInputs: { mode: "fixture", claimKind: "persona-launch", tree: PLAIN, epoch: base.epoch, merkleTreeRoot: base.root, scope: "1", message: "1", personaId: "anon", gateId: "persona-launch", challenge: "epoch-" + base.epoch, launchCommit: "a".repeat(64), xHash: "d".repeat(64) }, nullifier: "5", proof: { scheme: "layers-zk-fixture/1", tag: "t" }, payload: { request: "{}" } }), 400, /xHash is only valid on an x-anon-post/],
    ["xHash on a tier proof", () => ({ v: 1, mode: "fixture", claimKind: "tier-membership", publicInputs: { mode: "fixture", claimKind: "tier-membership", tree: "tier-2", epoch: base.epoch, merkleTreeRoot: base.root, scope: "1", message: "1", personaId: "p_x", gateId: "foryou", challenge: "epoch-" + base.epoch, xHash: "d".repeat(64) }, nullifier: "5", proof: { scheme: "layers-zk-fixture/1", tag: "t" } }), 400, /xHash is only valid on an x-anon-post/],
  ];
}
async function bindingScenario(verify) {
  vx.resetFixture(VAPP.db, "fixture");
  const { epoch, root } = await plainTree();
  const person = "binding-" + ++personSeq;
  const base = { text: "an honest copy " + randomBytes(3).toString("hex"), nonce: randomBytes(16).toString("hex"), epoch, root, person };
  for (const [name, mk, status, re] of bindingCases(base)) {
    const r = await verify(VAPP.db, mk());
    assert(r.status === status && re.test(String(r.json?.error ?? "")), `${name}: expected ${status} ${re}, got ${r.status} ${JSON.stringify(r.json)}`);
  }
  assert(VAPP.db.prepare("SELECT COUNT(*) AS n FROM x_outbox WHERE mode = 'fixture'").get().n === 0, "a refused envelope left an outbox row");
  const honest = await verify(VAPP.db, xEnvelope(base));
  assert(honest.status === 200, "the honest envelope was refused after the near misses (something was consumed): " + JSON.stringify(honest.json));
  const again = await verify(VAPP.db, xEnvelope({ ...base, text: base.text + " again", nonce: undefined }));
  assert(again.status === 409 && /replay/.test(again.json.error), "a second copy in the person's one X slot was not a replay: " + JSON.stringify(again.json));
  return `${bindingCases(base).length} near misses refused by their own guard; the honest copy accepted; its slot's second use a replay`;
}
console.log("\nB — the claim binding, on the real validator");
await check("B1 live (503, not built) first; a reach tree, an extra payload key, a tampered text, X slot ≥ K_X, a bare-window scope, the anon kinds' fields, another gate id and the policy refused by the guard that owns each; xHash refused on every other kind; then the honest envelope is accepted (nothing consumed) and a second copy in the slot is a replay", () => bindingScenario((db, env) => vz.verifyAndRecord(db, env)));
const VZ_GUARDS = [
  ["the live refusal", 'if (mode !== "fixture") return { status: 503, json: { error: "X posting is not built: only test data, and nothing reaches X" } };', ""],
  ["the plain-tree rule", "if (p.tree !== anonPostTree()) return { status: 400, json: { error: `x-anon-post: an X copy proves the plain anon tree", "if (false) return { status: 400, json: { error: `x-anon-post: an X copy proves the plain anon tree"],
  ["the exact payload shape", "Object.keys(env.payload).length !== 2) return", "Object.keys(env.payload).length < 2) return"],
  ["the xHash check", "if (xAnonHash(text, nonce) !== p.xHash) return", "if (false) return"],
  ["the X slot bound", 'if (!isXSlot(p.slot)) return { status: 400, json: { error: "x-anon-post: slot required', 'if (false) return { status: 400, json: { error: "x-anon-post: slot required'],
  ["the policy call", "if (why !== null) return { status: 400, json: { error: \"x-anon-post: \" + why } };", ""],
  ["xHash refused on an anon post", "    // PERSONA LAUNCH P8: an X copy's hash rides only its own claim kind\n    if (p.xHash !== undefined) return", "    if (false) return"],
];
for (const [name, from, to] of VZ_GUARDS) {
  await mutation(`B1 / the validator's ${name} removed (validator/zk.js)`, async () => {
    const P = patchedValidator("zk.js", [[from, to]]);
    await bindingScenario((db, env) => P.verifyAndRecord(db, env));
  });
}
/** the outbox's OWN checks inside the record transaction (enqueueX), independent of zk.js's pre-binding ones */
function enqueueScenario(X) {
  const db = VAPP.db;
  vx.resetFixture(db, "fixture");
  const nonce = "a".repeat(32);
  const good = "the outbox's own check " + randomBytes(3).toString("hex");
  const tryEnq = (mode, payload, h) => {
    db.exec("BEGIN");
    try {
      X.enqueueX(db, mode, payload, h, 1);
      db.exec("COMMIT");
      return null;
    } catch (e) {
      db.exec("ROLLBACK");
      return e;
    }
  };
  const cases = [
    ["live", "live", { text: good, nonce }, vx.xHashOf(good, nonce), 503, /not built/],
    ["a payload whose hash is not xHash", "fixture", { text: good + "!", nonce }, vx.xHashOf(good, nonce), 400, /does not hash/],
    ["the policy", "fixture", { text: "a @mention", nonce }, vx.xHashOf("a @mention", nonce), 400, /^the outbox refused the text: Posts to @totem/],
    ["a malformed nonce", "fixture", { text: good, nonce: "x" }, vx.xHashOf(good, "x"), 400, /malformed/],
  ];
  for (const [name, mode, payload, h, status, re] of cases) {
    const e = tryEnq(mode, payload, h);
    assert(e && e.status === status && re.test(e.message), `${name}: ${e ? e.status + " " + e.message : "ACCEPTED"}`);
  }
  assert(db.prepare("SELECT COUNT(*) AS n FROM x_outbox WHERE mode = 'fixture'").get().n === 0, "a refused enqueue left a row");
  assert(tryEnq("fixture", { text: good, nonce }, vx.xHashOf(good, nonce)) === null, "the honest copy was refused");
  const again = tryEnq("fixture", { text: good, nonce }, vx.xHashOf(good, nonce));
  assert(again && again.status === 409 && /already in the X outbox/.test(again.message), "the same id twice: " + (again ? again.message : "ACCEPTED"));
  const n2 = "b".repeat(32);
  const dup = tryEnq("fixture", { text: "  " + good.toUpperCase(), nonce: n2 }, vx.xHashOf("  " + good.toUpperCase(), n2));
  // W3-X-DUP-AS-REPLAY: repeated WORDS are a content refusal (400 → the channel's 'refused'), never a 409 (→ 'replay',
  // which the device counts as a spent X slot)
  assert(dup && dup.status === 400 && /already went to the X outbox/.test(dup.message), "the same words again (must be 400, a refusal — never 409, a replay): " + (dup ? dup.status + " " + dup.message : "ACCEPTED"));
  const row = db.prepare("SELECT status, created_hour, kind, url, decided_hour, due_at, posted_id, posted_hour FROM x_outbox WHERE mode = 'fixture'").get();
  assert(row.status === "review" && row.created_hour % 3_600_000 === 0 && row.kind === "post" && row.url === null && row.decided_hour === null && row.due_at === null && row.posted_id === null, "the new row is not a bare 'review' row with an hour-grained time: " + JSON.stringify({ ...row }));
  return "live, a mismatched hash, the policy, a malformed nonce refused in the transaction; the honest copy taken; its id twice and its words again refused";
}
await check("B2 the outbox's own checks inside the record transaction (enqueueX): live 503, a payload not hashing to xHash, the policy (worded as the outbox's own refusal), a malformed nonce; the honest copy lands as a bare 'review' row with an hour-grained time; the same id again is a 409 (it IS in the outbox) and the same words under another nonce a 400 (a refusal, never a replay)", () => enqueueScenario(vx));
for (const [name, from, to] of [
  ["policy re-check", 'if (!shape.ok) throw Object.assign(new Error("the outbox refused the text: " + shape.reason), { status: 400 });', ""],
  ["duplicate check", "if (recentDuplicate(db, mode, payload.text)) throw", "if (false) throw"],
  ["fixture-only assertion", 'if (mode !== "fixture") throw Object.assign(new Error(NOT_BUILT), { status: 503 });', ""],
]) {
  await mutation(`B2 / the outbox's ${name} removed (validator/xoutbox.js)`, async () => enqueueScenario(patchedValidator("xoutbox.js", [[from, to]])));
}
await mutation("B2 / repeated words answered 409 again (the X slot burned as a 'replay')", async () =>
  enqueueScenario(patchedValidator("xoutbox.js", [['X treats repeats as spam"), { status: 400 });', 'X treats repeats as spam"), { status: 409 });']]))
);

// ================================================================================================ G / T — the gate
const T = (globalThis.__XO = {});
function resetWorld() {
  Object.assign(T, {
    rep: "zk",
    state: { zkQueue: new Map() },
    persisted: [],
    proveCalls: [],
    sends: [],
    snap: null,
    xsnap: null,
    personas: new Map([
      ["p_one", { own: true, kind: "public", handle: "one" }],
      ["p_two", { own: true, kind: "public", handle: "two" }],
      ["p_layers", { own: true, kind: "public", handle: "layersonly", mode: "private" }],
      ["p_priv", { own: true, kind: "private", handle: "privy" }],
    ]),
  });
  globalThis.__XOPINS = new Map();
  // wave 3: the drain's record of the last tick's epoch (lib/zk/anon/queue.ts noteCurrentEpoch) is per scenario too
  globalThis.__layersZkCurrentEpoch = {};
}
resetWorld();
const snapAt = (epoch, members = ["7", "8", "9"]) => ({ mode: "fixture", tree: PLAIN, epoch: { mode: "fixture", epoch, epochMs: H6, msRemaining: H6 - 60_000 }, members: { mode: "fixture", tree: PLAIN, epoch, root: "1", members }, history: { pubkey: "", entries: [] }, validatorKey: "", anonHead: null, anonHeadError: null, buckets: [], bucketsError: null, issuers: [], anonConfig: { tree: PLAIN, windowEpochs: 1, maxChars: 320, liveRelay: true, fid: 0, slotsPerWindow: 4 }, anonConfigError: null, fetchedAt: Date.now(), ms: 1 });
const xsnapOf = (o = {}) => ({ mode: "fixture", config: { mode: "fixture", testData: true, transport: "fixture", live: false, xSlotsPerWindow: 1, dailyCap: 50, dailyUsed: 0, postedToday: 0, relayIntervalMs: 3_600_000, relaySpreadMs: 0, moderated: true, moderators: [], ...o }, list: [], error: null, fetchedAt: Date.now() });
const GATE_MOCKS = {
  "server-only": `export {};`,
  "lib/zk/localPins": `const P = () => globalThis.__XOPINS; export function intersectionFor(m, k) { const v = P().get(m + ":" + k); return v ? [...v] : null; } export function setIntersection(m, k, members) { P().set(m + ":" + k, [...members]); }`,
  "lib/rings/note": `export async function noteForPost() { const b = new Uint8Array(256); globalThis.crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); }`,
  "lib/reach/held": `export function heldReachTrees() { return []; } export async function refreshHeldReach() { return { trees: () => [], error: null }; } export function resetReachCaches() {}`,
  "lib/launch/confirm": `export function noteLaunchOutcome() {} export async function launchUnderWay() { return false; }`,
  "lib/adapters/registry": `export function currentRepImpl() { return globalThis.__XO.rep; } export function setRepImplOverride() {}`,
  "lib/attest/subscriber": `export function isHonoredIssuer() { return false; } export function setHonoredIssuersOverride() {}`,
  "lib/attest/proven": `export function clearProvenAttestations() {} export async function refreshProvenAttestations() { return {}; }`,
  "lib/attest/onboarding": `export function clearsOnboarding() { return { clears: false, by: null }; }`,
  "lib/zk/validatorClient": `export async function fetchEligibilityMap() { return {}; } export async function fetchEpoch() { const s = globalThis.__XO.snap; if (!s) throw new Error("no epoch in this harness"); return s.epoch; }`,
  "lib/zk/anon/relayAccount": `export const SEED_SELF_FID = 9152; export function relayAccountVerdict() { return { detail: "" }; } export function relayJoinRefusesPosting() { return false; }`,
  "lib/zk/anon/relay": `export function setRelayOverride() {}`,
  "lib/zk/prefetch": `export function cachedSnapshot(mode) { const s = globalThis.__XO.snap; return s && s.mode === mode ? s : null; } export function cachedXOutbox(mode) { const s = globalThis.__XO.xsnap; return s && s.mode === mode ? s : null; } export function ensurePrefetchLoop() {} export function resetPrefetch() {}`,
  "lib/zk/privacy": `export async function ownIdentityFacts() { return {}; }`,
  "lib/adapters/neynar/mode": `export function writeEnabled() { return false; }`,
  "lib/adapters/mock/store": `
const T = globalThis.__XO;
export async function hydrate() {}
export function state() { return T.state; }
export async function persistNs(ns) { T.persisted.push(ns); }
export const SEED_VIEWER = { personas: ["persona_viewer_main"], activePersonaId: "persona_viewer_main" };
export const personaById = new Map();`,
  "lib/zk/anon/submit": `export async function submitAnonymous(env) { globalThis.__XO.sends.push(env); return { outcome: globalThis.__XO.submitOutcome ?? "accepted" }; }`,
  "lib/identity/keystore": `
export function listPersonas() { return [...globalThis.__XO.personas.entries()].map(([id, p]) => ({ id, handle: p.handle })); }
export function isOwnPersona(id) { return !!globalThis.__XO.personas.get(id)?.own; }`,
  "lib/fc/personaFid": `export async function personaFidMap() { return {}; } export async function personaFidRecord() { return null; }`,
  "lib/identity/keys": `export function fcSignerPublicKeyFor() { return null; } export function signAsFcSignerFor() { return null; }`,
  "lib/identity/postMode": `
export async function anonPersonaRefusal(id) {
  const p = globalThis.__XO.personas.get(id);
  if (!p || !p.own) return { code: "persona", status: 403, message: "That isn't one of your personas." };
  if (p.kind !== "public") return { code: "persona", status: 403, message: "@" + p.handle + " is a private persona" };
  if (p.mode === "private") return { code: "post-mode", status: 409, message: "@" + p.handle + " is set to post in Totem only." };
  return null;
}
export function handleOfPersona(id) { return globalThis.__XO.personas.get(id)?.handle ?? null; }`,
  // the prover: records the request and builds the scope with the REAL registry (a bad slot throws there)
  "lib/zk/prove": `
import { scopeString } from "@/lib/zk/scopes";
import { slotQualifier, xSlotQualifier } from "@/lib/zk/anon/slots";
import { anonPostWindowOf } from "@/lib/zk/config";
export async function prepareAndProve(req, snap) {
  const T = globalThis.__XO;
  T.proveCalls.push({ ...req });
  const epoch = snap.epoch.epoch;
  const x = req.claimKind === "x-anon-post";
  const scope = x ? scopeString("x-anon-post", epoch, undefined, xSlotQualifier(anonPostWindowOf(epoch), req.slot)) : scopeString("anon-post", epoch, undefined, slotQualifier(anonPostWindowOf(epoch), req.slot));
  const pub = { mode: req.mode, claimKind: req.claimKind, tree: req.tree, epoch, merkleTreeRoot: "1", scope, message: "1", personaId: req.personaId, gateId: req.gateId, challenge: "epoch-" + epoch, slot: req.slot, ...(x ? { xHash: req.xHash } : { castHash: req.castHash, attributionCommitment: req.attributionCommitment, noteHash: req.noteHash }) };
  return { ok: true, epoch, budget: {}, cohort: {}, envelope: { v: 1, mode: req.mode, claimKind: req.claimKind, nullifier: "n|" + scope, publicInputs: pub, proof: { scheme: "layers-zk-fixture/1", tag: "t" } } };
}`,
};
const GATE_ENTRY = `export * as gate from "@/lib/zk/gate";
export * as config from "@/lib/zk/config";
export * as queue from "@/lib/zk/anon/queue";
export * as outcomes from "@/lib/zk/anon/outcomes";
`;
const G = await bundle(GATE_ENTRY, GATE_MOCKS);
const xRecs = () => [...T.state.zkQueue.values()].filter((q) => q.claimKind === "x-anon-record");
const xSubs = () => [...T.state.zkQueue.values()].filter((q) => q.claimKind === "x-anon-post");
const anonSubs = () => [...T.state.zkQueue.values()].filter((q) => q.claimKind === "anon-post");
async function refusalScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(40);
  T.xsnap = xsnapOf();
  const nothing = (label) => {
    assert(xRecs().length === 0, label + ": an X record was minted");
    assert(Gx.gate.wantedXPosts().length === 0, label + ": a wanted entry was made");
    assert(T.persisted.length === 0, label + ": something was persisted");
  };
  const tryOne = async (label, text, opts, code, re) => {
    const r = await Gx.gate.requestXAnonPost(text, opts);
    assert(!r.ok && r.code === code && re.test(r.reason ?? ""), `${label}: ${JSON.stringify(r)}`);
    nothing(label);
  };
  // availability: the proof layer off
  T.rep = "mock";
  await tryOne("anonymous posting off", "a fine copy", { personaId: "p_one" }, "unavailable", /off/);
  T.rep = "zk";
  // the live universe: nothing reaches X — not even proved
  Gx.config.setZkModeOverride("live");
  await tryOne("the live universe", "a fine copy", { personaId: "p_one" }, "unavailable", /test data only/);
  Gx.config.setZkModeOverride(null);
  // the browser device (D-X-PUBLIC-OFF)
  globalThis.window = {};
  try {
    await tryOne("the browser device", "a fine copy", { personaId: "p_one" }, "unavailable", /isn't on this preview/);
  } finally {
    delete globalThis.window;
  }
  // the persona
  await tryOne("a stranger persona", "a fine copy", { personaId: "p_nope" }, "persona", /isn't one of your personas/);
  await tryOne("a private persona", "a fine copy", { personaId: "p_priv" }, "persona", /private/);
  await tryOne("a Totem-only persona", "a fine copy", { personaId: "p_layers" }, "post-mode", /Totem only/);
  // the policy
  await tryOne("an @mention", "hey @one look", { personaId: "p_one" }, "bad-text", /mention/);
  await tryOne("two links", "a https://a.example.org b https://b.example.org", { personaId: "p_one" }, "bad-text", /one link/);
  await tryOne("a full repost", "para\n\npara", { personaId: "p_one" }, "bad-text", /One paragraph/);
  await tryOne("a malformed copyOf", "a fine copy", { personaId: "p_one", copyOf: "nope" }, "copy", /isn't one of your anonymous posts/);
  // the outbox not read on the last tick: refused, never a pass
  T.xsnap = null;
  await tryOne("the outbox not read", "a fine copy", { personaId: "p_one" }, "unavailable", /couldn't be read/);
  T.xsnap = { ...xsnapOf(), config: null, error: "boom" };
  await tryOne("the outbox unreadable", "a fine copy", { personaId: "p_one" }, "unavailable", /couldn't be read/);
  // a served K_X that differs: paused, never adopted
  T.xsnap = xsnapOf({ xSlotsPerWindow: 2 });
  await tryOne("a served K_X of 2", "a fine copy", { personaId: "p_one" }, "unavailable", /allows 2 per window and this app allows 1/);
  // the daily cap from the last read
  T.xsnap = xsnapOf({ dailyUsed: 50 });
  await tryOne("the daily cap", "a fine copy", { personaId: "p_one" }, "relay-cap", /used up/);
  // PERSONA LAUNCH wave 3 (UXH-6): no moderator = nothing would ever go out — refused, not queued to wait forever; a
  // config that does not say is not a yes
  T.xsnap = xsnapOf({ moderated: false, moderators: [] });
  await tryOne("no moderator", "a fine copy", { personaId: "p_one" }, "unavailable", /^No moderator is set up for @totem on X yet, so a copy would never go out\.$/);
  T.xsnap = xsnapOf({ moderated: undefined });
  await tryOne("the moderator state unread", "a fine copy", { personaId: "p_one" }, "unavailable", /^Couldn't read whether @totem on X has a moderator/);
  // a copy names one of THIS persona's own anonymous posts: not a stranger's hash, not a sibling persona's post
  T.xsnap = xsnapOf();
  await tryOne("a copyOf that is no post of this device", "a fine copy", { personaId: "p_one", copyOf: "c".repeat(64) }, "copy", /this persona's anonymous posts/);
  const sib = await Gx.gate.requestAnonPost("the sibling post", { personaId: "p_one" });
  assert(sib.ok, "setup: the sibling anon post: " + JSON.stringify(sib));
  await tryOne("a copyOf of another persona's post", "a fine copy", { personaId: "p_two", copyOf: sib.castHash }, "copy", /this persona's anonymous posts/);
  // the X window: the first copy goes (minted in memory, nothing persisted), the second is refused before any mint
  const first = await Gx.gate.requestXAnonPost("the first copy", { personaId: "p_one", copyOf: sib.castHash });
  assert(first.ok && /^[0-9a-f]{64}$/.test(first.xHash), "the first copy was refused: " + JSON.stringify(first));
  assert(xRecs().length === 1 && T.persisted.length === 0, "the accepted copy wrote something at compose time (or minted no record)");
  const rec = xRecs()[0];
  assert(rec.x.personaId === "p_one" && rec.x.copyOf === sib.castHash && rec.personaId === "anon" && rec.envelope === null, "the sealed X record is not (persona, copyOf) with the constant 'anon' outside it: " + JSON.stringify(rec));
  const second = await Gx.gate.requestXAnonPost("a second copy", { personaId: "p_two" });
  assert(!second.ok && second.code === "window" && /already sent a post to @totem on X/.test(second.reason), "the second copy in the window (another persona) was not refused 'window': " + JSON.stringify(second));
  assert(xRecs().length === 1 && Gx.gate.wantedXPosts().length === 1, "the refused second copy minted something");
  return "15 refusals before any mint or write; the first copy minted in memory only; the second refused 'window'";
}
console.log("\nG — requestXAnonPost refuses before any mint or write");
await check("G1 every refusal (proof layer off, the live universe, the browser device, a persona that may not post, the policy, a malformed copyOf, the outbox unread, a served K_X that differs, the daily cap, no moderator or an unread moderator state, the X window) happens before any X record, wanted entry or write; the first copy is minted in memory only, sealed with its persona and copyOf", () => refusalScenario(G));
const GATE_GUARDS = [
  ["the X window check", "if (xWindowFull(used + waiting, ZK_X_ANON_POST_SLOTS)) return", "if (false) return"],
  ["the daily cap check", "if (xSnap.config.dailyUsed + ahead >= xSnap.config.dailyCap) return", "if (false) return"],
  ["the outbox-not-read refusal", "if (!xSnap || !xSnap.config) return { ok: false, code: \"unavailable\"", "if (false) return { ok: false, code: \"unavailable\""],
  ["the live-universe refusal", 'if (mode !== "fixture") return { ok: false, code: "unavailable", reason: X_NOT_BUILT_SENTENCE };', ""],
  ["the browser-device refusal", "if (typeof window !== \"undefined\" || avail.previewOnly) return", "if (false) return"],
  ["the policy check", "if (!shape.ok) return { ok: false, code: \"bad-text\", reason: shape.reason };", "if (false) return { ok: false, code: \"bad-text\", reason: \"\" };"],
  ["the copy-of-this-persona's-post check", "if (!sibling || sibling.personaId !== personaId) return", "if (false) return"],
  ["the moderator check (UXH-6)", "if (xSnap.config.moderated !== true) return", "if (false) return"],
  ["the served K_X comparison", "if (typeof servedXSlots === \"number\" && servedXSlots !== ZK_X_ANON_POST_SLOTS) {\n    return { ok: false, code: \"unavailable\"", "if (false) {\n    return { ok: false, code: \"unavailable\""],
];
for (const [name, from, to] of GATE_GUARDS) {
  await mutation(`G1 / ${name} removed from requestXAnonPost`, async () => refusalScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [[from, to]] })));
}

// ---- T — the tick
async function tickScenario(Gx, kx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(60, ["7", "8", "9", "10"]);
  T.xsnap = xsnapOf({ xSlotsPerWindow: kx });
  // K anon posts and K_X X copies in ONE window: the two budgets are apart. The order is the test: an X copy is QUEUED
  // before the anon posts are composed (a budget that counted it as an anon slot would refuse the Kth anon post), and
  // the remaining copies are composed after the anon posts are QUEUED (one that counted anon slots would refuse them)
  const x0 = await Gx.gate.requestXAnonPost("copy 0", { personaId: "p_one" });
  assert(x0.ok, "the first X copy: " + JSON.stringify(x0));
  let queued = await Gx.gate.runWantedProofs(T.snap, {});
  const anon = [];
  for (const [i, who] of ["p_one", "p_two", "p_one", "p_two"].entries()) {
    const r = await Gx.gate.requestAnonPost("anon " + i, { personaId: who });
    assert(r.ok, "anon post " + i + " (with an X copy queued): " + JSON.stringify(r));
    anon.push(r.castHash);
  }
  queued += await Gx.gate.runWantedProofs(T.snap, {});
  for (let i = 1; i < kx; i++) {
    const r = await Gx.gate.requestXAnonPost("copy " + i, { personaId: i % 2 ? "p_two" : "p_one", copyOf: anon[i] });
    assert(r.ok, "X copy " + i + " (with K anon posts queued): " + JSON.stringify(r));
  }
  const over = await Gx.gate.requestXAnonPost("one too many", { personaId: "p_one" });
  assert(!over.ok && over.code === "window", "the (K_X+1)th copy was not refused: " + JSON.stringify(over));
  queued += await Gx.gate.runWantedProofs(T.snap, {});
  assert(queued === 4 + kx, `the ticks queued ${queued}, not ${4 + kx}: ` + JSON.stringify(Gx.gate.gateAttempts().slice(-6)));
  const xslots = xSubs().map((q) => q.envelope.publicInputs.slot);
  assert(new Set(xslots).size === kx && xslots.every((s) => Number.isInteger(s) && s >= 0 && s < kx), `the ${kx} copies did not get ${kx} distinct X slots: ${JSON.stringify(xslots)}`);
  for (const q of xSubs()) {
    const e = q.envelope;
    assert(e.claimKind === "x-anon-post" && e.publicInputs.tree === PLAIN && e.publicInputs.personaId === "anon" && q.personaId === "anon", "an X submission is not 'anon' over the plain tree: " + JSON.stringify(e.publicInputs));
    assert(JSON.stringify(Object.keys(e.payload).sort()) === JSON.stringify(["nonce", "text"]), "an X payload is not exactly {text, nonce}: " + JSON.stringify(Object.keys(e.payload)));
    assert(!JSON.stringify(e).includes("p_one") && !JSON.stringify(e).includes("p_two") && !JSON.stringify(e).includes(anon[0]), "an X envelope carries a persona or its sibling's cast hash");
    assert(/^w\d+\/s\d$/.test(e.publicInputs.scope.split("x-anon-post/")[1] ?? "") || /x-anon-post\/w\d+\/s\d/.test(e.nullifier), "the X scope is not x-anon-post/w<n>/s<i>");
  }
  // X slots and anon slots counted apart, both ways
  assert((await Gx.queue.anonSlotsUsed("fixture", 60)).size === 4, "anonSlotsUsed counted an X copy (or lost an anon post)");
  assert((await Gx.queue.xSlotsUsed("fixture", 60)).size === kx, "xSlotsUsed counted an anon post (or lost an X copy)");
  assert(anonSubs().length === 4, "the anon posts were not all queued");
  // independent moments: every submission has its own notBefore
  assert(new Set([...anonSubs(), ...xSubs()].map((q) => q.notBefore)).size === 4 + kx, "two submissions share a send moment");
  // a COPY folds into its persona's crowd count (the anon posts already set it); a standalone post does not
  const crowd = globalThis.__XOPINS.get("fixture:anon-post|p_one");
  assert(Array.isArray(crowd) && crowd.length > 0, "the copy's persona has no crowd count");
  return `${kx} copies, ${kx} distinct X slots; 4 anon posts in their own slots; payload {text, nonce}`;
}
async function foldScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.xsnap = xsnapOf();
  // the persona's crowd so far: {7, 8, 9, 99}; its anon post (epoch 61) proves over a tree holding all of them, so its own
  // fold leaves the crowd as it was; the COPY, proved a window later over {7, …, 11}, narrows it to {7, 8, 9}
  globalThis.__XOPINS.set("fixture:anon-post|p_one", ["7", "8", "9", "99"]);
  T.snap = snapAt(61, ["7", "8", "9", "99", "100"]);
  const sib = await Gx.gate.requestAnonPost("the sibling", { personaId: "p_one" });
  assert(sib.ok, "setup: " + JSON.stringify(sib));
  await Gx.gate.runWantedProofs(T.snap, {});
  assert(JSON.stringify(globalThis.__XOPINS.get("fixture:anon-post|p_one")) === JSON.stringify(["7", "8", "9", "99"]), "setup: the anon post's own fold changed the crowd");
  T.snap = snapAt(62, ["7", "8", "9", "10", "11"]);
  const c = await Gx.gate.requestXAnonPost("a copy", { personaId: "p_one", copyOf: sib.castHash });
  assert(c.ok, JSON.stringify(c));
  await Gx.gate.runWantedProofs(T.snap, {});
  assert(JSON.stringify(globalThis.__XOPINS.get("fixture:anon-post|p_one")) === JSON.stringify(["7", "8", "9"]), "the copy did not narrow its persona's crowd to the intersection: " + JSON.stringify(globalThis.__XOPINS.get("fixture:anon-post|p_one")));
  // a standalone post (no copyOf) is folded into nothing
  globalThis.__XOPINS.set("fixture:anon-post|p_two", ["7", "99"]);
  T.snap = snapAt(63, ["7", "8"]);
  const s = await Gx.gate.requestXAnonPost("standalone words", { personaId: "p_two" });
  assert(s.ok, JSON.stringify(s));
  await Gx.gate.runWantedProofs(T.snap, {});
  assert(JSON.stringify(globalThis.__XOPINS.get("fixture:anon-post|p_two")) === JSON.stringify(["7", "99"]), "a standalone X post changed its persona's crowd");
  return "a copy narrows its persona's crowd; a standalone post does not";
}
console.log("\nT — the tick");
const KX2_ENV = async (fn) => {
  process.env.ZK_X_ANON_POST_SLOTS = "2";
  try {
    return await fn();
  } finally {
    delete process.env.ZK_X_ANON_POST_SLOTS;
  }
};
const G2 = await KX2_ENV(() => bundle(GATE_ENTRY, GATE_MOCKS));
await check("T1 (K_X = 2) K anon posts and K_X X copies all go in one window; the (K_X+1)th copy is refused; the tick gives the copies distinct X slots, proves them as 'anon' over the plain tree with exactly {text, nonce}, and every submission its own moment; anonSlotsUsed and xSlotsUsed each count only their own", () => KX2_ENV(() => tickScenario(G2, 2)));
await check("T2 (K_X = 1) the same with one X copy", () => tickScenario(G, 1));
await check("T3 a COPY narrows its persona's crowd count (the device-local intersection a launch reads) to its tree's members; a standalone X post folds into nothing", () => foldScenario(G));
await mutation("T1 / the tick ignoring the spent X slots (every copy drawn from an empty set, lowest first)", async () => {
  const M = await KX2_ENV(() => bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["let xSlot = pickFreeXSlot(xUsed, ZK_X_ANON_POST_SLOTS);", "let xSlot = pickFreeXSlot(new Set(), ZK_X_ANON_POST_SLOTS, () => 0);"]] }));
  await KX2_ENV(() => tickScenario(M, 2));
});
await mutation("T1 / anonSlotsUsed counting X copies too (lib/zk/anon/queue.ts)", async () => {
  const M = await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [['.filter((q) => q.mode === mode && q.claimKind === "anon-post")\n    .map((q) => ({ window: anonPostWindowOf(q.epoch)', '.filter((q) => q.mode === mode && (q.claimKind === "anon-post" || q.claimKind === "x-anon-post"))\n    .map((q) => ({ window: anonPostWindowOf(q.epoch)']] });
  await tickScenario(M, 1);
});
await mutation("T1 / xSlotsUsed counting anon posts too (lib/zk/anon/queue.ts)", async () => {
  const M = await KX2_ENV(() => bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [['.filter((q) => q.mode === mode && q.claimKind === "x-anon-post")\n    .map((q) => ({ window: anonPostWindowOf(q.epoch)', '.filter((q) => q.mode === mode && (q.claimKind === "x-anon-post" || q.claimKind === "anon-post"))\n    .map((q) => ({ window: anonPostWindowOf(q.epoch)']] }));
  await KX2_ENV(() => tickScenario(M, 2));
});
await mutation("T1 / the X payload carrying a ring note like an anon post", async () => tickScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["out.envelope.payload = { text: w.text as string, nonce: w.nonce as string };", "out.envelope.payload = { text: w.text as string, nonce: w.nonce as string, note: \"00\" } as never;"]] }), 1));
await mutation("T3 / the copy's crowd fold dropped", async () => foldScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (xCrowdKey && xCrowdNext) (await import(\"./localPins\")).setIntersection(snap.mode, xCrowdKey, xCrowdNext);", ""]] })));
await mutation("T3 / every X post folded, copy or not", async () => foldScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/gate.ts": [["if (w.copyOf && w.xPersonaId) {", "if (w.xPersonaId) {"]] })));

// ================================================================================================ Q — the queue seams
async function rejitterScenario(Gx) {
  resetWorld();
  const Q = Gx.queue;
  // two queued submissions, both overdue (their moments were before the tab closed); one carries its epoch shape
  const env = (i) => ({ v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: { mode: "fixture", claimKind: "anon-post", epoch: 70, personaId: "anon", castHash: String(i).repeat(64).slice(0, 64), slot: i }, nullifier: "n" + i, proof: {} });
  const a = await Q.enqueueSubmission(env(1), { epochShape: { epochMs: H6, msRemaining: H6 / 2 }, persist: "now" });
  const b = await Q.enqueueSubmission(env(2), { epochShape: null, persist: "now" });
  const now = Date.now();
  for (const it of [a, b]) T.state.zkQueue.get(it.id).notBefore = now - 60_000;
  // THE BROWSER DEVICE: the first drain re-jitters what is overdue — nothing leaves in the boot burst
  globalThis.__layersZkBootRejittered = false;
  globalThis.window = {};
  let r;
  try {
    r = await Q.drainQueue(now, Infinity);
  } finally {
    delete globalThis.window;
  }
  assert(r.sent === 0 && T.sends.length === 0, `the browser's first drain sent ${r.sent} overdue item(s) inside the boot burst`);
  const na = T.state.zkQueue.get(a.id).notBefore;
  const nb = T.state.zkQueue.get(b.id).notBefore;
  const lo = Number(process.env.ZK_JITTER_MIN_MS ?? 30_000);
  const hi = Number(process.env.ZK_JITTER_MAX_MS ?? 900_000);
  const t1 = Date.now();
  for (const [x, n] of [["a", na], ["b", nb]]) assert(n >= now + lo && n <= t1 + hi, `item ${x}'s new moment is outside [now + jitter min, now + jitter max]: ${n - now} ms`);
  assert(na !== nb, "the two overdue items got the same new moment (a batch, not a jitter)");
  // a later drain (the moments have come) sends them
  const r2 = await Q.drainQueue(Math.max(na, nb) + 1, Infinity);
  assert(r2.sent === 2, "the re-jittered items were not sent once due: " + JSON.stringify(r2));
  // THE NODE RIG: an overdue item IS sent at the first drain (device-restart and z5 rely on it)
  resetWorld();
  globalThis.__layersZkBootRejittered = false;
  const c = await Q.enqueueSubmission(env(3), { epochShape: null, persist: "now" });
  T.state.zkQueue.get(c.id).notBefore = Date.now() - 60_000;
  const r3 = await Q.drainQueue(Date.now(), Infinity);
  assert(r3.sent === 1, "the node drain held back an overdue item");
  return "browser: 0 sent at boot, both re-jittered and sent later; node: the overdue item sent";
}
async function pruneScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(80);
  T.xsnap = xsnapOf();
  const r = await Gx.gate.requestXAnonPost("prune me later", { personaId: "p_one" });
  assert(r.ok, JSON.stringify(r));
  await Gx.gate.runWantedProofs(T.snap, {});
  await Gx.queue.drainQueue(Date.now() + 24 * 3_600_000, Infinity);
  assert(xSubs().length === 1 && xSubs()[0].status === "sent", "setup: the X copy was not sent");
  // the queue status never lists the sealed X record (it lists the submission)
  const qs = await Gx.queue.queueStatus();
  assert(qs.items.every((i) => !i.id.startsWith("zkx_")), "queueStatus lists a sealed X record");
  assert(qs.items.some((i) => xSubs().some((q) => q.id === i.id)), "queueStatus lost the X submission itself");
  // the same window: kept (its slot still counts)
  await Gx.gate.runWantedProofs(snapAt(80), {});
  assert(xSubs().length === 1, "an X submission of the OPEN window was pruned");
  // the next window: pruned, its outcome kept on the sealed record
  await Gx.gate.runWantedProofs(snapAt(81), {});
  assert(xSubs().length === 0, "a settled X submission of a closed window was kept");
  const rec = await Gx.queue.xRecord(r.xHash);
  assert(rec && rec.settled && rec.settled.status === "sent" && rec.settled.outcome === "accepted", "the sealed X record lost how its copy ended: " + JSON.stringify(rec));
  return "kept while its window is open; pruned after, its outcome on the sealed record; queueStatus never lists the record";
}
console.log("\nQ — the queue seams");
await check("Q1 the BROWSER device re-jitters every overdue queued item on its first drain (nothing leaves inside a reopened tab's boot burst; the item's epoch clamp holds) and sends them once due; the NODE rig's first drain sends an overdue item as before", () => rejitterScenario(G));
await check("Q2 a settled X submission is kept while its window is open and pruned after it closes, its outcome copied onto the sealed X record; queueStatus lists the submission and never the sealed record", () => pruneScenario(G));
await mutation("Q1 / the browser's boot re-jitter switched off", async () => rejitterScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [["    rejitterOverdueOnBoot(Date.now());\n", "\n"]] })));
await mutation("Q1 / the re-jitter run on the node rig too", async () => rejitterScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [['if (typeof window !== "undefined" && !g.__layersZkBootRejittered) {', "if (!g.__layersZkBootRejittered) {"]] })));
await mutation("Q2 / queueStatus listing the sealed X records", async () => pruneScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [[" && q.claimKind !== X_RECORD_KIND);", ");"]] })));
await mutation("Q2 / the prune dropping the open window's X submission", async () => pruneScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [["if (!(Number.isFinite(its) && its < open)) continue;", "if (!Number.isFinite(its)) continue;"]] })));
await mutation("Q2 / the prune not copying the outcome onto the record", async () => pruneScenario(await bundle(GATE_ENTRY, GATE_MOCKS, { "lib/zk/anon/queue.ts": [["if (rec && rec.claimKind === X_RECORD_KIND && rec.x) rec.x = { ...rec.x, settled: { status: q.status, outcome: q.outcome, sentAt: q.sentAt } };", ""]] })));

// ---- PERSONA LAUNCH wave 3: the queue's epoch end (W3-REJITTER-NO-GRACE), the expiry (L7), the drain's resume
const qEnv = (kind, i, epoch = 70) => ({ v: 1, mode: "fixture", claimKind: kind, publicInputs: { mode: "fixture", claimKind: kind, epoch, personaId: "anon", ...(kind === "x-anon-post" ? { xHash: String(i).repeat(64).slice(0, 64) } : kind === "anon-post" ? { castHash: String(i).repeat(64).slice(0, 64) } : {}), slot: 0 }, nullifier: "nq" + kind + i, proof: {}, ...(kind === "anon-post" ? { payload: { text: "words " + i, nonce: "a".repeat(32), note: "0".repeat(512) } } : {}) });
const MARGIN = Number(process.env.ZK_ANON_EPOCH_EDGE_MARGIN_MS ?? 300_000);
async function noGraceRejitterScenario(Gx) {
  resetWorld();
  const Q = Gx.queue;
  // (a) the epoch END is the snapshot's: fetchedAt + msRemaining, never enqueue time + msRemaining
  const fetchedAt = Date.now() - 90_000;
  const a = await Q.enqueueSubmission(qEnv("tier-membership", 9), { epochShape: { epochMs: H6, msRemaining: H6 / 2, fetchedAt }, persist: "now" });
  const je = T.state.zkQueue.get(a.id).jitterEpoch;
  assert(je && je.endsAt === fetchedAt + H6 / 2, `the epoch end is not the snapshot's (fetchedAt + msRemaining): ${je && je.endsAt - fetchedAt}`);
  // (b) THE BOOT RE-JITTER, 6 MINUTES LEFT: every no-grace kind's new moment stays before its epoch's end less the margin
  resetWorld();
  const left = 6 * 60_000;
  const items = [];
  for (let i = 0; i < 8; i++) for (const kind of ["anon-post", "x-anon-post", "persona-launch"]) items.push(await Q.enqueueSubmission(qEnv(kind, i), { epochShape: { epochMs: H6, msRemaining: left }, persist: "now" }));
  // and one GRACE kind beside them (a tier claim keeps the configured window: the validator gives it a grace epoch)
  const grace = await Q.enqueueSubmission(qEnv("tier-membership", 8), { epochShape: { epochMs: H6, msRemaining: left }, persist: "now" });
  const now = Date.now();
  for (const it of [...items, grace]) T.state.zkQueue.get(it.id).notBefore = now - 60_000;
  const moved = Q.rejitterOverdueOnBoot(Date.now());
  assert(moved === items.length + 1, `the boot re-jitter moved ${moved} of ${items.length + 1} overdue items`);
  const late = [];
  const nbs = new Set();
  for (const it of items) {
    const q = T.state.zkQueue.get(it.id);
    nbs.add(q.notBefore);
    if (!(q.notBefore < q.jitterEpoch.endsAt - MARGIN + 1000)) late.push(`${q.claimKind} ${Math.round((q.notBefore - now) / 1000)} s (the epoch ends in ${Math.round((q.jitterEpoch.endsAt - now) / 1000)} s)`);
    if (q.notBefore < now) late.push("a moment in the past");
  }
  assert(late.length === 0, `${late.length} no-grace item(s) re-jittered past their epoch's end: ${late.slice(0, 3).join("; ")}`);
  assert(nbs.size > items.length / 2, "the bounded moments collapsed to one point (a fixed offset, not a jitter)");
  return `${items.length} no-grace items re-jittered inside the ${left / 60_000} min left (less the ${MARGIN / 60_000} min margin); the end is fetchedAt + msRemaining`;
}
async function expiryScenario(Gx) {
  resetWorld();
  const Q = Gx.queue;
  // epoch 70 is over by its own end; epoch 71 is the current one, as the last tick recorded it
  Q.noteCurrentEpoch("fixture", 71);
  const over = { epochMs: H6, msRemaining: 1_000, fetchedAt: Date.now() - 5_000 }; // ended 4 s ago
  const live = { epochMs: H6, msRemaining: H6 - 60_000 };
  const byEnd = {};
  for (const kind of ["anon-post", "x-anon-post", "persona-launch"]) byEnd[kind] = await Q.enqueueSubmission(qEnv(kind, 1, 71), { epochShape: over, persist: "now" });
  const behind = {};
  for (const kind of ["anon-post", "x-anon-post", "persona-launch"]) behind[kind] = await Q.enqueueSubmission(qEnv(kind, 2, 70), { epochShape: live, persist: "now" });
  const graceOld = await Q.enqueueSubmission(qEnv("tier-membership", 3, 70), { epochShape: over, persist: "now" });
  const fresh = await Q.enqueueSubmission(qEnv("anon-post", 4, 71), { epochShape: live, persist: "now" });
  for (const q of T.state.zkQueue.values()) q.notBefore = Date.now() - 1_000;
  // the RIG's flush ("as if at now + 24 h") must not expire anything by its moved clock: only the real one counts
  const r = await Q.drainQueue(Date.now() + 24 * 3_600_000, Infinity);
  const sentKinds = T.sends.map((e) => e.claimKind + "@" + e.publicInputs.epoch).sort();
  assert(JSON.stringify(sentKinds) === JSON.stringify(["anon-post@71", "tier-membership@70"]), "what went on the wire: " + JSON.stringify(sentKinds) + " (report " + JSON.stringify(r) + ")");
  for (const [label, set] of [["ended by its own epoch end", byEnd], ["behind the snapshot's epoch", behind]]) {
    for (const kind of ["anon-post", "x-anon-post"]) {
      const q = T.state.zkQueue.get(set[kind].id);
      assert(q && q.status === "refused" && q.outcome === "expired" && q.sentAt === null, `${kind} ${label} was not expired locally: ${JSON.stringify(q && { status: q.status, outcome: q.outcome, sentAt: q.sentAt })}`);
    }
    assert(!T.state.zkQueue.has(set["persona-launch"].id), `the launch request ${label} was not dropped (its launch record asks for a fresh proof)`);
  }
  assert(T.state.zkQueue.get(fresh.id).status === "sent" && T.state.zkQueue.get(graceOld.id).status === "sent", "a current item or a grace kind was held back");
  // the status words: an expired X copy never left the device and may be sent again
  const st = Gx.status.xCopyStatus({ row: null, item: { status: "refused", outcome: "expired" }, settled: null, outcome: null, wanted: false });
  assert(st.state === "expired" && st.final === true && /never left this device/.test(st.sentence) && /test data/.test(st.sentence), "the expired copy's sentence: " + JSON.stringify(st));
  // an expired anon post's words were never seen: the words guard does not block them (a refused-after-send one does)
  assert((await Q.anonWordsSeen("words 1")) === null, "the words of a post that never left the device are blocked");
  return "6 no-grace items expired (anon post, X copy: refused/expired; launch: dropped) by their end or the snapshot's epoch; the current one and the grace kind sent; a rig flush expires nothing by its moved clock";
}
async function resumeScenario(Gx) {
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  // a queued submission HYDRATED from the sealed queue (a restart): nothing enqueued in this process, the loop not armed
  T.snap = snapAt(90);
  const item = { id: "zkq_resume1", mode: "fixture", claimKind: "x-anon-post", personaId: "anon", epoch: 90, envelope: qEnv("x-anon-post", 7, 90), notBefore: Date.now() - 1_000, motivatedAt: 0, createdAt: 0, status: "queued", sentAt: null, outcome: null };
  T.state.zkQueue.set(item.id, item);
  if (globalThis.__layersZkDrainTimer) clearInterval(globalThis.__layersZkDrainTimer);
  globalThis.__layersZkDrainTimer = null;
  assert(Gx.gate.wantedXPosts().length === 0 && Gx.gate.wantedAnonPosts().length === 0, "setup: something is wanted");
  // ONE tick, nothing wanted, nothing enqueued
  const queued = await Gx.gate.runWantedProofs(T.snap, {});
  assert(queued === 0, "the tick queued something");
  assert(globalThis.__layersZkDrainTimer, "the tick did not arm the drain loop for the hydrated queued item");
  // the loop sends it once it is due (its own 5 s cadence)
  for (let i = 0; i < 40 && T.state.zkQueue.get(item.id).status === "queued"; i++) await new Promise((r) => setTimeout(r, 250));
  assert(T.state.zkQueue.get(item.id).status === "sent" && T.sends.length === 1, "the armed loop did not send the hydrated item: " + JSON.stringify({ status: T.state.zkQueue.get(item.id).status, sends: T.sends.length }));
  // an EMPTY queue arms nothing (the loop is not started for no reason)
  resetWorld();
  clearInterval(globalThis.__layersZkDrainTimer);
  globalThis.__layersZkDrainTimer = null;
  await Gx.gate.runWantedProofs(snapAt(90), {});
  assert(!globalThis.__layersZkDrainTimer, "the tick armed the loop with nothing queued");
  return "a hydrated queued item: the tick arms the loop and the loop sends it; an empty queue arms nothing";
}
async function dupRefusedScenario(Gx) {
  // the VALIDATOR: the same words under another person's copy — a 400 (content), never a 409 (replay); the channel maps
  // 409 alone to 'replay' (validator/anon.js classify)
  vx.resetFixture(VAPP.db, "fixture");
  const { epoch, root } = await plainTree();
  const words = "the same words twice " + randomBytes(3).toString("hex");
  const first = await vz.verifyAndRecord(VAPP.db, xEnvelope({ text: words, epoch, root, person: "dup-a-" + ++personSeq }));
  assert(first.status === 200, "setup: the first copy: " + JSON.stringify(first.json));
  const second = await vz.verifyAndRecord(VAPP.db, xEnvelope({ text: words, epoch, root, person: "dup-b-" + ++personSeq }));
  assert(second.status === 400 && /already went to the X outbox/.test(second.json?.error ?? ""), "the repeated words were not a 400 refusal: " + second.status + " " + JSON.stringify(second.json));
  const anonSrc = readFileSync(path.join(ROOT, "validator", "anon.js"), "utf8");
  assert(/if \(r\.status === 409\) return "replay";\s*\n\s*return "refused";/.test(anonSrc), "the channel's classify no longer maps 409 alone to 'replay' (this check reads it)");
  // THE DEVICE: a copy the validator refused holds NO X slot — a second, distinct copy in the same window goes
  resetWorld();
  await Gx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(95);
  T.xsnap = xsnapOf();
  T.submitOutcome = "refused";
  try {
    const c1 = await Gx.gate.requestXAnonPost(words, { personaId: "p_one" });
    assert(c1.ok, "setup: " + JSON.stringify(c1));
    await Gx.gate.runWantedProofs(T.snap, {});
    await Gx.queue.drainQueue(Date.now() + 24 * 3_600_000, Infinity);
    const sub = xSubs()[0];
    assert(sub && sub.status === "sent" && sub.outcome === "refused", "setup: the copy did not end refused: " + JSON.stringify(sub && { s: sub.status, o: sub.outcome }));
    assert((await Gx.queue.xSlotsUsed("fixture", 95)).size === 0, "a refused copy still holds the X slot");
    const st = Gx.status.xCopyStatus({ row: null, item: { status: sub.status, outcome: sub.outcome }, settled: null, outcome: null, wanted: false });
    assert(st.state === "refused" && !/already used/.test(st.sentence), "the refused copy's line says its slot was used: " + st.sentence);
    const c2 = await Gx.gate.requestXAnonPost("other words entirely", { personaId: "p_one" });
    assert(c2.ok, "a second, distinct copy in the same window was refused after a refusal: " + JSON.stringify(c2));
  } finally {
    delete T.submitOutcome;
  }
  return "the validator answers repeated words 400; the device keeps the X slot free and says 'refused'; a second copy goes";
}
const GATE_ENTRY_S = GATE_ENTRY + `export * as status from "@/lib/x/outbox/status";\n`;
const GS = await bundle(GATE_ENTRY_S, GATE_MOCKS);
console.log("\nQ — the queue's epoch end, the expiry, the resumed drain (wave 3)");
await check("Q3 W3-REJITTER-NO-GRACE: an item's epoch end is the SNAPSHOT's (fetchedAt + msRemaining); with 6 minutes left, the boot re-jitter keeps every anon post, X copy and launch request before that end less the margin (spread, never one point)", () => noGraceRejitterScenario(GS));
await mutation("Q3 / the boot re-jitter not bounded by the epoch end", async () => noGraceRejitterScenario(await bundle(GATE_ENTRY_S, GATE_MOCKS, { "lib/zk/anon/queue.ts": [["const m = boundedSendMoment(now, w, NO_GRACE_KINDS.has(q.claimKind), je?.endsAt ?? null);", "const m = now + uniformInt(w.lo, w.hi);"]] })));
await mutation("Q3 / the epoch end taken from the enqueue time again", async () => noGraceRejitterScenario(await bundle(GATE_ENTRY_S, GATE_MOCKS, { "lib/zk/anon/queue.ts": [["ep.fetchedAt <= now ? ep.fetchedAt : now) + ep.msRemaining", "ep.fetchedAt <= now ? now : now) + ep.msRemaining"]] })));
await check("Q4 L7: before any drain picks, a queued no-grace item whose epoch is over (its own end, or behind the last tick's epoch) is EXPIRED on the device and never put on the wire — anon post and X copy 'refused/expired', a launch request dropped (its record asks again); a current item and a grace kind still go; a rig's 'now + 24 h' flush expires nothing; the expired copy's line says it never left the device, and its words stay usable", () => expiryScenario(GS));
await mutation("Q4 / the expiry sweep removed from the drain", async () => expiryScenario(await bundle(GATE_ENTRY_S, GATE_MOCKS, { "lib/zk/anon/queue.ts": [["  expireStaleNoGraceItems(Date.now(), currentEpochOf);\n", "\n"]] })));
await mutation("Q4 / the expiry judged by the caller's moved clock", async () => expiryScenario(await bundle(GATE_ENTRY_S, GATE_MOCKS, { "lib/zk/anon/queue.ts": [["  expireStaleNoGraceItems(Date.now(), currentEpochOf);\n", "  expireStaleNoGraceItems(now, currentEpochOf);\n"]] })));
await mutation("Q4 / only the item's own end checked (the last tick's later epoch ignored)", async () => expiryScenario(await bundle(GATE_ENTRY_S, GATE_MOCKS, { "lib/zk/anon/queue.ts": [["(typeof cur === \"number\" && Number.isFinite(cur) && q.epoch < cur)", "false"]] })));
await check("Q5 W3-DRAIN-NOT-RESUMED: a queued item hydrated after a restart, nothing wanted and nothing enqueued — one tick arms the drain loop and the loop sends it; an empty queue arms nothing", () => resumeScenario(GS));
await mutation("Q5 / the tick's drain resume removed", async () => resumeScenario(await bundle(GATE_ENTRY_S, GATE_MOCKS, { "lib/zk/gate.ts": [["    await resumeDrainIfQueued({ mode: snap.mode, epoch: snap.epoch.epoch });\n", "\n"]] })));
await check("B3 W3-X-DUP-AS-REPLAY: repeated words from another copy are a 400 at the validator (a refusal, never a replay); on the device that copy ends 'refused', holds no X slot, its line never says the slot was used, and a second distinct copy in the window goes", () => dupRefusedScenario(GS));
await mutation("B3 / the validator answering repeated words 409 (a replay)", async () => {
  const P = patchedValidator("xoutbox.js", [['X treats repeats as spam"), { status: 400 });', 'X treats repeats as spam"), { status: 409 });']]);
  const save = vz.verifyAndRecord;
  // the patched outbox is required by zk.js through its own module cache: route the record step through the patched copy
  const zp = patchedValidator("zk.js", [['function xoutboxModule() {\n  return require("./xoutbox");\n}', "function xoutboxModule() {\n  return globalThis.__XO_PATCHED_OUTBOX;\n}"]]);
  globalThis.__XO_PATCHED_OUTBOX = P;
  try {
    vz.verifyAndRecord = zp.verifyAndRecord;
    await dupRefusedScenario(GS);
  } finally {
    vz.verifyAndRecord = save;
    delete globalThis.__XO_PATCHED_OUTBOX;
  }
});
await mutation("B3 / the device counting a refused copy as a held X slot", async () => dupRefusedScenario(await bundle(GATE_ENTRY_S, GATE_MOCKS, { "lib/zk/anon/slots.ts": [['item.status === "sent" && (item.outcome === "accepted" || item.outcome === "replay")', 'item.status === "sent" && (item.outcome === "accepted" || item.outcome === "replay" || item.outcome === "refused")']] })));

// ================================================================================================ V / O — the device's view and offer
// (PERSONA LAUNCH wave 3: UXH-1 the view's compartment scope, UXH-6 no moderator = not offered, UXH-7 rejected not final)
const VIEW_MOCKS = {
  ...GATE_MOCKS,
  "lib/identity/chrome": `export async function visibleOwnPersonaIds() { const v = globalThis.__XO.visible; if (v === "throw") throw new Error("the chrome record is unreadable"); return [...(v ?? [])]; }`,
  "lib/world-flag": `export function isEmptyWorld() { return false; }`,
};
const VIEW_ENTRY = GATE_ENTRY + `export * as request from "@/lib/x/outbox/request";\nexport * as status from "@/lib/x/outbox/status";\n`;
const VIEW = await bundle(VIEW_ENTRY, VIEW_MOCKS);
async function viewScenario(Vx) {
  resetWorld();
  await Vx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(100);
  T.xsnap = xsnapOf();
  T.visible = ["p_one", "p_two"];
  // one copy as p_one (a copy of its own anon post) and one as its SIBLING p_two (forced past the window: a rig's door)
  const sib = await Vx.gate.requestAnonPost("the anon post one copied", { personaId: "p_one" });
  assert(sib.ok, "setup: " + JSON.stringify(sib));
  const a = await Vx.gate.requestXAnonPost("a copy as one", { personaId: "p_one", copyOf: sib.castHash });
  const b = await Vx.gate.requestXAnonPost("a copy as the sibling", { personaId: "p_two", force: true });
  assert(a.ok && b.ok, "setup: " + JSON.stringify({ a, b }));
  // the positive control: the unscoped view (both personas visible) lists both
  const both = await Vx.request.xOutboxView(null);
  assert(both.items.length === 2, "the control: both copies are not listed with both personas visible: " + JSON.stringify(both.items));
  // COMPARTMENT: only p_one visible — the sibling's copy is absent from the list AND from the single read
  T.visible = ["p_one"];
  const one = await Vx.request.xOutboxView(null);
  assert(one.items.length === 1 && one.items[0].xHash === a.xHash, "the compartment view lists a sibling's copy: " + JSON.stringify(one.items.map((i) => i.xHash)));
  const bare = JSON.stringify(one);
  assert(!bare.includes(b.xHash) && !bare.includes("p_two") && !bare.includes("p_one") && !bare.includes(sib.castHash), "the compartment view carries the sibling's copy, a persona id or the copied post's hash");
  assert(one.items.every((i) => !("personaId" in i) && !("copyOf" in i)), "an item still carries personaId / copyOf");
  const mine = (await Vx.request.xOutboxView(a.xHash)).item;
  assert(mine.state === "wanted", "the control: this persona's own copy reads as " + mine.state);
  const hidden = (await Vx.request.xOutboxView(b.xHash)).item;
  const never = (await Vx.request.xOutboxView("9".repeat(64))).item;
  assert(hidden.state === "unknown" && JSON.stringify({ ...hidden, xHash: null }) === JSON.stringify({ ...never, xHash: null }), "the single read tells a hidden sibling's copy from a hash this device never sent: " + JSON.stringify({ hidden, never }));
  // a DROPPED sibling copy (no sealed record any more, only its log entry) stays hidden too
  T.state.zkQueue.delete("zkx_" + b.xHash);
  const dropped = (await Vx.request.xOutboxView(b.xHash)).item;
  assert(dropped.state === "unknown" && dropped.lastStage === null, "a dropped sibling copy's log shows through the compartment: " + JSON.stringify(dropped));
  // never fail open: an unreadable scope is a refusal, not an unscoped list
  T.visible = "throw";
  let threw = null;
  try {
    await Vx.request.xOutboxView(null);
  } catch (e) {
    threw = e;
  }
  assert(threw && threw instanceof Vx.request.XOutboxScopeError, "an unreadable scope did not refuse: " + (threw ? threw.message : "an answer came back"));
  return "both listed unscoped; the compartment shows one, and the sibling's copy reads like a hash never sent (dropped too); an unreadable scope refuses";
}
async function offerScenario(Vx) {
  resetWorld();
  await Vx.gate.resetZkRuntimeOverrides();
  T.snap = snapAt(100);
  T.visible = ["p_one"];
  T.xsnap = xsnapOf();
  const on = await Vx.request.xOffered();
  assert(on.offered === true, "the control: a moderated outbox is not offered: " + JSON.stringify(on));
  T.xsnap = xsnapOf({ moderated: false, moderators: [] });
  const off = await Vx.request.xOffered();
  assert(off.offered === false && off.reason === Vx.gate.X_NO_MODERATOR_SENTENCE && off.scope === "now", "no moderator but offered: " + JSON.stringify(off));
  T.xsnap = null;
  const unread = await Vx.request.xOffered();
  assert(unread.offered === false && unread.reason === Vx.gate.X_MODERATION_UNREAD_SENTENCE, "an unread outbox was offered: " + JSON.stringify(unread));
  // the settings panel still reads the outbox when nobody moderates (it is where a moderator is set up)
  T.xsnap = xsnapOf({ moderated: false, moderators: [] });
  const v = await Vx.request.xOutboxView(null);
  assert(v.offered === false && Array.isArray(v.items) && v.config?.moderated === false, "the view stopped answering when nobody moderates: " + JSON.stringify(v).slice(0, 200));
  // UXH-7: a rejected copy is NOT final (the moderator may still approve it)
  const rj = Vx.status.xCopyStatus({ row: { status: "rejected", hour: 3_600_000, postedId: null, text: null }, item: null, settled: null, outcome: null, wanted: false });
  assert(rj.state === "rejected" && rj.final === false && /^Not approved \(test data\)/.test(rj.sentence), "a rejected copy reads as final: " + JSON.stringify(rj));
  return "offered with a moderator; not offered (in plain words) without one or unread; the view still answers; rejected is not final";
}
console.log("\nV / O — the device's view and its offer (wave 3)");
await check("V1 UXH-1: the X outbox view is scoped like every own-data view — under a compartment a sibling persona's copy is absent from the list and its single read is indistinguishable from a hash never sent (dropped copies too); no item carries personaId or copyOf; an unreadable scope refuses", () => viewScenario(VIEW));
await mutation("V1 / the view's persona scope removed", async () => viewScenario(await bundle(VIEW_ENTRY, VIEW_MOCKS, { "lib/x/outbox/request.ts": [["(await xRecords(mode)).filter((r) => r.personaId !== null && visible.has(r.personaId))", "(await xRecords(mode))"]] })));
await mutation("V1 / the single read's log not scoped (a dropped sibling copy shows through)", async () => viewScenario(await bundle(VIEW_ENTRY, VIEW_MOCKS, { "lib/x/outbox/request.ts": [['const o = o0 && typeof o0.personaId === "string" && visible.has(o0.personaId) ? o0 : null;', "const o = o0;"]] })));
await mutation("V1 / an unreadable scope read as everything", async () => viewScenario(await bundle(VIEW_ENTRY, VIEW_MOCKS, { "lib/x/outbox/request.ts": [['throw new XOutboxScopeError("couldn\'t read which of your personas this view may show (" + (e as Error).message + ")");', "visible = new Set([\"p_one\", \"p_two\"]);"]] })));
await check("O1 UXH-6/7: the X copy is offered only where the outbox has a moderator (from the last check's read; unread is not a yes), said in plain words otherwise; the settings view still answers without one; a rejected copy's status is not final", () => offerScenario(VIEW));
await mutation("O1 / xOffered not asking whether a moderator exists", async () => offerScenario(await bundle(VIEW_ENTRY, VIEW_MOCKS, { "lib/x/outbox/request.ts": [["if (cfg.moderated !== true) return { offered: false, reason: X_NO_MODERATOR_SENTENCE, scope: \"now\" };", ""], ["if (!cfg || typeof cfg.moderated !== \"boolean\") return { offered: false, reason: X_MODERATION_UNREAD_SENTENCE, scope: \"now\" };", ""]] })));
await mutation("O1 / a rejected copy final again", async () => offerScenario(await bundle(VIEW_ENTRY, VIEW_MOCKS, { "lib/x/outbox/status.ts": [['return { ...base, state: "rejected", final: false,', 'return { ...base, state: "rejected", final: true,']] })));

// ================================================================================================ M — moderation
const VAULT_KEY = new Uint8Array(createHash("sha256").update("unit-x-outbox vault key").digest());
const MOD_MOCKS = { "server-only": `export {};`, "lib/identity/keystore": `export function vaultKeyBytes() { return globalThis.__XOVK; }` };
globalThis.__XOVK = VAULT_KEY;
const MOD = await bundle(`export * as mod from "@/lib/x/outbox/moderation";\n`, MOD_MOCKS);
async function moderationScenario(Mx, moderateFn) {
  const db = VAPP.db;
  vx.resetFixture(db, "fixture");
  const { epoch, root } = await plainTree();
  // two rows to decide (through the real verifyAndRecord)
  const rows = [];
  for (let i = 0; i < 2; i++) {
    const e = xEnvelope({ text: "moderate me " + i + " " + randomBytes(3).toString("hex"), epoch, root, person: "mod-" + ++personSeq });
    assert((await vz.verifyAndRecord(db, e)).status === 200, "setup: a row was refused");
    rows.push(e.publicInputs.xHash);
  }
  // the key: HKDF(vault key, "layers/x-moderator/1"); never the vault key itself
  const { hkdf } = await import("@noble/hashes/hkdf");
  const { sha256 } = await import("@noble/hashes/sha2");
  const want = Buffer.from(hkdf(sha256, VAULT_KEY, new Uint8Array(0), new TextEncoder().encode("layers/x-moderator/1"), 32)).toString("hex");
  assert(Buffer.from(Mx.mod.moderatorSeedFor(VAULT_KEY)).toString("hex") === want && want !== Buffer.from(VAULT_KEY).toString("hex"), "the moderator seed is not HKDF(vault key, 'layers/x-moderator/1')");
  const pub = await Mx.mod.moderatorPublicKey();
  assert(/^[0-9a-f]{64}$/.test(pub), "no moderator public key");
  // the canonicals are byte-identical (wave 3: moderate/2 binds the decision's nonce)
  const cn = "c".repeat(32);
  assert(Mx.mod.moderateCanonical("fixture", rows[0], "approve", 5, cn) === vx.moderateCanonical("fixture", rows[0], "approve", 5, cn) && Mx.mod.reviewCanonical("fixture", 5, pub) === vx.reviewCanonical("fixture", 5, pub), "the moderation canonicals differ between the device and the validator");
  assert(vx.moderateCanonical("fixture", rows[0], "approve", 5, cn).endsWith("|" + cn) && vx.moderateCanonical("fixture", rows[0], "approve", 5, cn) !== vx.moderateCanonical("fixture", rows[0], "approve", 5, "d".repeat(32)), "the nonce is not in the signed canonical");
  // unregistered: refused
  const signed = await Mx.mod.signModeration("fixture", rows[0], "approve");
  const unreg = moderateFn(db, signed, { devHooks: true });
  assert(unreg.status === 403, "an unregistered key's decision: " + JSON.stringify(unreg));
  db.prepare("INSERT OR IGNORE INTO x_outbox_moderators (mode, pubkey, added_hour) VALUES ('fixture', ?, 0)").run(pub);
  // forged: a flipped bit
  const forged = { ...signed, sig: signed.sig.slice(0, 10) + (signed.sig[10] === "0" ? "1" : "0") + signed.sig.slice(11) };
  const f = moderateFn(db, forged, { devHooks: true });
  assert(f.status === 403 && /does not verify/.test(f.json.error), "a forged decision: " + JSON.stringify(f));
  // replayed for ANOTHER id
  const other = moderateFn(db, { ...signed, id: rows[1] }, { devHooks: true });
  assert(other.status === 403 && /does not verify/.test(other.json.error), "a decision lifted onto another id: " + JSON.stringify(other));
  // another decision with the same signature
  const flipped = moderateFn(db, { ...signed, decision: "reject" }, { devHooks: true });
  assert(flipped.status === 403, "a signature lifted onto another decision: " + JSON.stringify(flipped));
  // a stale hour
  const stale = await Mx.mod.signModeration("fixture", rows[0], "approve", Date.now() - 5 * 3_600_000);
  assert(moderateFn(db, stale, { devHooks: true }).status === 400, "a decision signed five hours ago was taken");
  // a stranger's key, registered nowhere, whose signature verifies
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const spub = spki.subarray(spki.length - 32).toString("hex");
  const h = Math.floor(Date.now() / 3_600_000);
  const sn = randomBytes(16).toString("hex");
  const s = moderateFn(db, { mode: "fixture", id: rows[0], decision: "approve", issuedHour: h, nonce: sn, pubkey: spub, sig: cryptoSign(null, Buffer.from(vx.moderateCanonical("fixture", rows[0], "approve", h, sn)), privateKey).toString("hex") }, { devHooks: true });
  assert(s.status === 403 && /not a moderator/.test(s.json.error), "a stranger's verifying signature: " + JSON.stringify(s));
  // wave 3: a decision without its nonce (or a malformed one) is refused before the signature is even read
  const { nonce: _n, ...noNonce } = signed;
  const nn = moderateFn(db, noNonce, { devHooks: true });
  assert(nn.status === 400 && /nonce/.test(nn.json.error), "a decision without a nonce: " + JSON.stringify(nn));
  assert(moderateFn(db, { ...signed, nonce: "zz" }, { devHooks: true }).status === 400, "a malformed nonce was read");
  // and a nonce swapped under the same signature does not verify (the nonce is signed)
  assert(moderateFn(db, { ...signed, nonce: "e".repeat(32) }, { devHooks: true }).status === 403, "a swapped nonce verified");
  // with dev hooks OFF a dev-registered key is no moderator (only X_OUTBOX_MODERATORS counts)
  assert(moderateFn(db, signed, { devHooks: false }).status === 403, "a dev-registered key moderated with dev hooks off");
  // the honest decision, once
  const ok = moderateFn(db, signed, { devHooks: true });
  assert(ok.status === 200, "the honest decision: " + JSON.stringify(ok));
  assert(db.prepare("SELECT status FROM x_outbox WHERE mode = 'fixture' AND id = ?").get(rows[0]).status === "approved", "the row did not move to approved");
  const again = moderateFn(db, signed, { devHooks: true });
  assert(again.status === 409, "the same signed decision twice: " + JSON.stringify(again));
  // X_OUTBOX_MODERATORS: a configured public key moderates with dev hooks off
  process.env.X_OUTBOX_MODERATORS = "zz, " + pub.toUpperCase();
  try {
    const r2 = await Mx.mod.signModeration("fixture", rows[1], "reject");
    const cfg = moderateFn(db, r2, { devHooks: false });
    assert(cfg.status === 200, "a configured moderator key was refused: " + JSON.stringify(cfg));
  } finally {
    delete process.env.X_OUTBOX_MODERATORS;
  }
  return "derivation pinned; canonicals equal; unregistered, forged, lifted, stale, stranger, dev-key-without-hooks refused; honest once; replay refused; configured key works";
}
console.log("\nM — moderation");
await check("M1 the moderator key is HKDF(vault key, 'layers/x-moderator/1'); a decision signed on the device verifies on the validator; unregistered, forged, lifted onto another id or decision, stale, a stranger's key and a dev key without dev hooks are refused; the honest decision lands once and its replay is refused; a key in X_OUTBOX_MODERATORS moderates", () => moderationScenario(MOD, (db, b, o) => vx.moderate(db, b, o)));
await mutation("M1 / the validator's signature check removed (validator/xoutbox.js)", async () => {
  const P = patchedValidator("xoutbox.js", [["if (!verifyEd25519(sig, moderateCanonical(mode, id, decision, issuedHour, nonce), pubkey)) return", "if (false) return"]]);
  await moderationScenario(MOD, (db, b, o) => P.moderate(db, b, o));
});
await mutation("M1 / the replay check removed (validator/xoutbox.js)", async () => {
  const P = patchedValidator("xoutbox.js", [['if (db.prepare("SELECT 1 FROM x_outbox_decisions WHERE mode = ? AND signature = ?").get(mode, sig)) return', "if (false) return"]]);
  await moderationScenario(MOD, (db, b, o) => P.moderate(db, b, o));
});
await mutation("M1 / the moderator list check removed (validator/xoutbox.js)", async () => {
  const P = patchedValidator("xoutbox.js", [['if (!mods.includes(pubkey)) return { status: 403, json: { error: "that key is not a moderator here" } };', ""]]);
  await moderationScenario(MOD, (db, b, o) => P.moderate(db, b, o));
});
await mutation("M1 / the device's moderator key under another info string (lib/x/outbox/moderation.ts)", async () => {
  const M = await bundle(`export * as mod from "@/lib/x/outbox/moderation";\n`, MOD_MOCKS, { "lib/x/outbox/moderation.ts": [['export const X_MODERATOR_INFO = "layers/x-moderator/1";', 'export const X_MODERATOR_INFO = "layers/vault/1";']] });
  await moderationScenario(M, (db, b, o) => vx.moderate(db, b, o));
});
await mutation("M1 / the validator no longer requiring the nonce (validator/xoutbox.js)", async () => {
  const P = patchedValidator("xoutbox.js", [['if (!MOD_NONCE_RE.test(nonce)) return { status: 400, json: { error: "the decision must carry a fresh 32-hex nonce — sign it again" } };', ""]]);
  await moderationScenario(MOD, (db, b, o) => P.moderate(db, b, o));
});

/** W3-X-MOD-SAME-HOUR: reject → approve → reject on ONE row inside one hour (the stale-tab sequence), signed on the device */
async function sameHourScenario(Mx, moderateFn, reviewFn = (db, q, o) => vx.review(db, q, o)) {
  const db = VAPP.db;
  vx.resetFixture(db, "fixture");
  const { epoch, root } = await plainTree();
  const e = xEnvelope({ text: "decide me three times " + randomBytes(3).toString("hex"), epoch, root, person: "same-hour-" + ++personSeq });
  assert((await vz.verifyAndRecord(db, e)).status === 200, "setup: the row was refused");
  const id = e.publicInputs.xHash;
  const pub = await Mx.mod.moderatorPublicKey();
  db.prepare("INSERT OR IGNORE INTO x_outbox_moderators (mode, pubkey, added_hour) VALUES ('fixture', ?, 0)").run(pub);
  const at = Date.now(); // one hour for all three
  const sigs = [];
  for (const [i, decision, want] of [[1, "reject", "rejected"], [2, "approve", "approved"], [3, "reject", "rejected"]]) {
    const signed = await Mx.mod.signModeration("fixture", id, decision, at);
    sigs.push(signed.sig);
    const r = moderateFn(db, signed, { devHooks: true });
    assert(r.status === 200 && r.json.status === want, `decision ${i} (${decision}) in the same hour: ${r.status} ${JSON.stringify(r.json)}`);
  }
  assert(db.prepare("SELECT status FROM x_outbox WHERE mode = 'fixture' AND id = ?").get(id).status === "rejected", "the row did not end rejected (the corrective decision was lost)");
  assert(new Set(sigs).size === 3, "two of the three decisions signed byte-identically");
  // a rejected row is listed in the moderator's review read (UXH-7: the panel's "Not approved" list), approve-able
  const rv = await Mx.mod.signReview("fixture");
  const list = reviewFn(db, rv, { devHooks: true });
  assert(list.status === 200 && list.json.items.some((x) => x.id === id && x.status === "rejected"), "the rejected row is not in the moderator's review list: " + JSON.stringify(list.json).slice(0, 200));
  return "reject → approve → reject in one hour: each accepted, the row ends rejected; three distinct signatures; the rejected row is in the review list";
}
console.log("\nM — the same decision twice in one hour (wave 3)");
await check("M2 W3-X-MOD-SAME-HOUR: on one row, reject → approve → reject inside ONE hour (a stale second tab's sequence) — every decision is accepted and the row ends 'rejected', each signature distinct (moderate/2's fresh nonce); the not-approved row stays in the moderator's review list (UXH-7)", () => sameHourScenario(MOD, (db, b, o) => vx.moderate(db, b, o)));
await mutation("M2 / the nonce dropped from BOTH canonicals (deterministic signatures again)", async () => {
  const M = await bundle(`export * as mod from "@/lib/x/outbox/moderation";\n`, MOD_MOCKS, { "lib/x/outbox/moderation.ts": [['["layers-x-moderate/2", mode, id, decision, String(issuedHour), String(nonce)].join("|")', '["layers-x-moderate/2", mode, id, decision, String(issuedHour), ""].join("|")']] });
  const P = patchedValidator("xoutbox.js", [['["layers-x-moderate/2", mode, id, decision, String(issuedHour), String(nonce)].join("|")', '["layers-x-moderate/2", mode, id, decision, String(issuedHour), ""].join("|")']]);
  await sameHourScenario(M, (db, b, o) => P.moderate(db, b, o));
});
await mutation("M2 / the review read listing only waiting and approved rows again", async () => {
  const P = patchedValidator("xoutbox.js", [["(status IN ('review', 'approved') OR (status = 'rejected' AND decided_hour >= ?))", "(status IN ('review', 'approved') OR (0 AND decided_hour >= ?))"]]);
  await sameHourScenario(MOD, (db, b, o) => P.moderate(db, b, o), (db, q, o) => P.review(db, q, o));
});

// ================================================================================================ D — migration 26 on a wave-2 database
const { DatabaseSync } = await import("node:sqlite");
const X_TABLES = ["x_fixture_posts", "x_outbox", "x_outbox_decisions", "x_outbox_moderators"];
/** a copy of a wave-2 database: the rig's validator DB when present (a consistent snapshot through VACUUM INTO), with
 *  every migration above 25 rolled back (26 and anything newer); else a fresh one rolled back the same way */
function wave2Copy() {
  const out = path.join(HERE, "wave2-" + randomBytes(4).toString("hex") + ".db");
  let source = "a fresh database";
  const rig = path.join(ROOT, "validator", "layers.db");
  if (existsSync(rig)) {
    try {
      const src = new DatabaseSync(rig, { readOnly: true });
      try {
        src.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
        source = "the rig's validator database";
      } finally {
        src.close();
      }
    } catch {
      source = "a fresh database";
    }
  }
  if (!existsSync(out)) {
    const d = new DatabaseSync(out);
    d.close();
  }
  const { openDb } = require(path.join(ROOT, "validator", "db.js"));
  // openDb migrates to the newest version; roll every version above the wave-2 schema (25) back, newest first, version
  // rows too. PUBLIC GO-LIVE: newer migrations now sit above 26 (relay's 29 'anon_public_safety'; 27 and 28 stay reserved
  // for the parked tracks), so rolling back 26 alone left a newer database and this check could never run. A version the
  // module has no down for is a loud error (migrateDown's own), never skipped.
  const o = openDb(out);
  try {
    const applied = o.prepare("SELECT version FROM schema_version WHERE version > 25 ORDER BY version DESC").all().map((r) => r.version);
    for (const v of applied) {
      vmig.migrateDown(o, v);
      o.prepare("DELETE FROM schema_version WHERE version = ?").run(v);
    }
  } finally {
    o.close();
  }
  return { file: out, source };
}
/** run `fn` with the migrations module seeing versions up to `top` only (its MIGRATIONS array, restored after): D1 is about
 *  migration 26 alone, and the newer ones are other tracks' — they must neither run nor be counted here */
function throughVersion(M, top, fn) {
  const all = M.MIGRATIONS.splice(0, M.MIGRATIONS.length);
  M.MIGRATIONS.push(...all.filter((m) => m.version <= top));
  try {
    return fn();
  } finally {
    M.MIGRATIONS.splice(0, M.MIGRATIONS.length, ...all);
  }
}
function migrationScenario(M, copy = null) {
  // the copy is made BEFORE throughVersion narrows the module (its rollback needs every newer migration's down)
  const { file, source } = copy ?? wave2Copy();
  const d = new DatabaseSync(file);
  try {
    const tables = () => d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
    // every table but migration 26's own, the runner's version table and SQLite's sequence table
    const counts = () => Object.fromEntries(tables().filter((t) => !X_TABLES.includes(t) && t !== "sqlite_sequence" && t !== "schema_version").map((t) => [t, d.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
    const v = d.prepare("SELECT MAX(version) AS v FROM schema_version").get().v;
    assert(v === 25, `${source} is not at the wave-2 schema (version ${v})`);
    for (const t of X_TABLES) assert(!tables().includes(t), "the wave-2 copy already has " + t);
    const before = counts();
    const r = M.migrate(d);
    assert(r.ran === 1 && r.current === 26, "migration 26 did not run exactly once: " + JSON.stringify(r));
    for (const t of X_TABLES) assert(tables().includes(t), t + " missing after up");
    assert(JSON.stringify(counts()) === JSON.stringify(before), "up changed rows of another table");
    assert(M.migrate(d).ran === 0, "a re-run was not a no-op");
    // an up interrupted before its version row (the tables exist, no row): re-runs cleanly
    d.prepare("DELETE FROM schema_version WHERE version = 26").run();
    assert(M.migrate(d).ran === 1, "a crashed 26 did not re-run");
    M.migrateDown(d, 26);
    for (const t of X_TABLES) assert(!tables().includes(t), t + " survived down");
    assert(JSON.stringify(counts()) === JSON.stringify(before), "down changed rows of another table");
    return `${source}: up adds 4 tables, re-run no-op, crash re-run clean, down drops exactly them (${Object.keys(before).length} other tables untouched)`;
  } finally {
    d.close();
  }
}
function mutatedMigrations(edits) {
  const file = path.join(ROOT, "validator", "migrations.js");
  let src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error("patch anchor not found in validator/migrations.js: " + from.slice(0, 90));
    src = src.split(from).join(to);
  }
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  return m.exports;
}
console.log("\nD — migration 26 on a wave-2 database");
await check("D1 migration 26 on a copy of a wave-2 database: up adds exactly the four X tables and changes no other row, a re-run is a no-op, an up interrupted before its version row re-runs cleanly, down drops exactly them", () => { const copy = wave2Copy(); return throughVersion(vmig, 26, () => migrationScenario(vmig, copy)); });
await mutation("D1 / migration 26's up without IF NOT EXISTS (a crashed run could not boot)", async () => { const M = mutatedMigrations([["CREATE TABLE IF NOT EXISTS x_outbox (", "CREATE TABLE x_outbox ("]]); const copy = wave2Copy(); return throughVersion(M, 26, () => migrationScenario(M, copy)); });
await mutation("D1 / migration 26's down leaving a table behind", async () => { const M = mutatedMigrations([["        DROP TABLE IF EXISTS x_outbox_moderators;\n", ""]]); const copy = wave2Copy(); return throughVersion(M, 26, () => migrationScenario(M, copy)); });

// ================================================================================================ S — source rules
const listFiles = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? listFiles(path.join(dir, n)) : [path.join(dir, n)]));
const OFFLINE_FILES = ["validator/xoutbox.js", ...listFiles(path.join(ROOT, "lib", "x", "outbox")).map((f) => path.relative(ROOT, f).split(path.sep).join("/"))];
function offlineViolations(files) {
  const out = [];
  for (const [f, raw] of files) {
    const code = raw.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
    if (/require\(\s*["'](node:)?(https?|net|tls|dgram|http2|undici)["']\s*\)|from\s+["'](node:)?(https?|net|tls|dgram|http2|undici)["']|\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(code)) out.push(f + ": reaches the network");
    if (/(?:^|[^a-z0-9.-])(?:api\.)?(?:x|twitter)\.com\b/i.test(raw)) out.push(f + ": names an X API host");
  }
  return out;
}
console.log("\nS — source rules");
await check("S1 validator/xoutbox.js and lib/x/outbox/** import no socket, http, tls or fetch and name no X API host (comments included for the host)", () => {
  const files = OFFLINE_FILES.map((f) => [f, readFileSync(path.join(ROOT, f), "utf8")]);
  assert(files.length >= 5, "the rule would pass over nothing: " + OFFLINE_FILES.join(","));
  const v = offlineViolations(files);
  assert(v.length === 0, v.join(" | "));
  return files.length + " files";
});
await mutation("S1 / a fetch added to the outbox", async () => {
  const v = offlineViolations([["validator/xoutbox.js (mutated)", readFileSync(path.join(ROOT, "validator/xoutbox.js"), "utf8") + '\nfetch("https://api.example.org");\n']]);
  assert(v.length === 0, v.join(" | "));
});
await mutation("S1 / the X API host named in the policy", async () => {
  const v = offlineViolations([["lib/x/outbox/policy.ts (mutated)", readFileSync(path.join(ROOT, "lib/x/outbox/policy.ts"), "utf8") + '\nconst HOST = "' + "api." + "x" + ".com" + '";\n']]);
  assert(v.length === 0, v.join(" | "));
});
/** THE X K RULE: every X slot choice passes the client's own K_X, and a served K_X is only ever compared with it */
function xkViolations(src) {
  const out = [];
  for (const m of src.matchAll(/\b(pickFreeXSlot|xWindowFull)\(([^;\n]*?)\)/g)) {
    if (/function\s*$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
    const args = m[2].split(",").map((s) => s.trim());
    if (args[1] !== "ZK_X_ANON_POST_SLOTS") out.push(`${m[0]} — K_X is not the client's own`);
  }
  for (const m of src.matchAll(/\bxWindowFullSentence\(([^,;\n]*)/g)) if (m[1].trim() !== "ZK_X_ANON_POST_SLOTS") out.push(`${m[0]} — K_X is not the client's own`);
  src.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*\*)/.test(line) || !/xSlotsPerWindow|servedXSlots/.test(line)) return;
    const ok = /servedXSlots !== ZK_X_ANON_POST_SLOTS/.test(line) || /^\s*const servedXSlots = [\w?.]+\.xSlotsPerWindow;$/.test(line) || /\$\{servedXSlots\}/.test(line);
    if (!ok) out.push(`line ${i + 1}: a served K_X used outside a comparison: ${line.trim().slice(0, 120)}`);
  });
  return out;
}
await check("S2 THE X K RULE over lib/zk/gate.ts: every pickFreeXSlot / xWindowFull / xWindowFullSentence call passes ZK_X_ANON_POST_SLOTS, and a served K_X appears only in a comparison against it (and the anon K rule's names are not used for X)", () => {
  const src = readFileSync(path.join(ROOT, "lib/zk/gate.ts"), "utf8");
  const calls = (src.match(/\bpickFreeXSlot\(/g) ?? []).length;
  assert(calls >= 1, "no pickFreeXSlot call — the rule would pass over nothing");
  const v = xkViolations(src);
  assert(v.length === 0, v.join(" | "));
  return calls + " X slot choice(s) checked";
});
await mutation("S2 / the tick choosing X slots with the served K_X", async () => {
  const src = readFileSync(path.join(ROOT, "lib/zk/gate.ts"), "utf8");
  const bad = src.replace("let xSlot = pickFreeXSlot(xUsed, ZK_X_ANON_POST_SLOTS);", "let xSlot = pickFreeXSlot(xUsed, servedXSlots ?? ZK_X_ANON_POST_SLOTS);");
  assert(bad !== src, "mutation anchor missing");
  const v = xkViolations(bad);
  assert(v.length === 0, v.join(" | "));
});
function uiViolations(route, composer, toggle) {
  const out = [];
  const top = route.replace(/\r\n/g, "\n").split("\n").filter((l) => /^import\s/.test(l));
  if (top.length !== 1 || !/^import \{ NextRequest, NextResponse \} from "next\/server";$/.test(top[0])) out.push("route: a top-level import other than next/server: " + top.join(" | "));
  if (!/const \[xCopy, setXCopy\] = useState\(false\);/.test(composer)) out.push("composer: the X box does not default off");
  if (!/<XOutboxToggle show=\{anon && [^}]*\}/.test(composer)) out.push("composer: the X box is not gated on 'Post anonymously'");
  if (!/!deviceIsThePage/.test((composer.match(/<XOutboxToggle show=\{[^}]*\}/) ?? [""])[0])) out.push("composer: the X box shows in the public browser device");
  const ok = composer.indexOf("if (res.ok) {", composer.indexOf("if (anon && !isPrivate && !replyToHash) {"));
  const send = composer.indexOf("if (xCopy) await sendXCopy(");
  if (ok < 0 || send < ok) out.push("composer: the copy is not sent after the anonymous post's 202");
  if (!toggle.includes('"Also post to @totem on X — test data: nothing reaches X"')) out.push("toggle: the label is not the test-data label");
  if (!toggle.includes('"A copy on X has the same words: if you launch this persona, it will read as yours too. Posts to X are never revealed by a launch."')) out.push("toggle: the note about the same words is missing");
  if (/useState\(true\)/.test(toggle)) out.push("toggle: something defaults on");
  return out;
}
const rs = (f) => readFileSync(path.join(ROOT, f), "utf8");
await check("S3 the route imports only next/server at its top (it is bundled into the browser device); the composer's X box defaults off, shows only with 'Post anonymously' ticked and never in the browser device, and the copy is sent only after the anonymous post's 202; the toggle says 'test data' and what a copy costs", () => {
  const v = uiViolations(rs("app/api/x/outbox/route.ts"), rs("components/Composer.tsx"), rs("components/XOutboxToggle.tsx"));
  assert(v.length === 0, v.join(" | "));
});
await mutation("S3 / the X box defaulting on", async () => {
  const v = uiViolations(rs("app/api/x/outbox/route.ts"), rs("components/Composer.tsx").replace("const [xCopy, setXCopy] = useState(false);", "const [xCopy, setXCopy] = useState(true);"), rs("components/XOutboxToggle.tsx"));
  assert(v.length === 0, v.join(" | "));
});
/** PERSONA LAUNCH wave 3 (UXH-5): the copy's words are checked BEFORE the anonymous post is sent, and Post is held */
function xFirstViolations(composer, toggle) {
  const out = [];
  const branch = composer.indexOf("if (anon && !isPrivate && !replyToHash) {");
  const check = composer.indexOf('(await import("@/lib/x/outbox/policy")).validateXText(text)', branch);
  const post = composer.indexOf('fetch("/api/anon", { method: "POST"', branch);
  if (branch < 0 || post < 0) out.push("composer: the anonymous submit branch was not found (the rule would check nothing)");
  else if (check < 0 || check > post) out.push("composer: the X copy's words are not checked before the anonymous post is sent");
  const stop = composer.slice(check, post);
  if (check >= 0 && !/if \(problem\) \{[\s\S]*?return;\s*\}/.test(stop)) out.push("composer: a failing X copy check does not stop the anonymous post");
  if (!/disabled=\{[^}]*\|\| xHold\}/.test(composer)) out.push("composer: Post is not held while the copy's words fail (xHold)");
  if (!/const xHold = anon && xCopy && \(xCheckedFor !== text \|\| xProblem !== null\);/.test(composer)) out.push("composer: xHold is not 'ticked and not yet checked, or failing'");
  if (!/problem=\{xCopy && text\.trim\(\) \? xProblem : null\}/.test(composer)) out.push("composer: the toggle is not told why the copy fails");
  if (!toggle.includes('data-testid="composer-x-problem"')) out.push("toggle: the reason is not shown under the box");
  return out;
}
await check("S4 UXH-5: with the X box ticked the composer runs the outbox's rules on the copy BEFORE the anonymous post is sent (a failure returns before /api/anon), holds Post while the words fail or are not checked yet, and shows the reason under the box", () => {
  const v = xFirstViolations(rs("components/Composer.tsx"), rs("components/XOutboxToggle.tsx"));
  assert(v.length === 0, v.join(" | "));
});
await mutation("S4 / the copy checked only after the anonymous post (the old order)", async () => {
  const c = rs("components/Composer.tsx").replace('(await import("@/lib/x/outbox/policy")).validateXText(text)', "null");
  assert(xFirstViolations(c, rs("components/XOutboxToggle.tsx")).length === 0, xFirstViolations(c, rs("components/XOutboxToggle.tsx")).join(" | "));
});
await mutation("S4 / Post not held while the copy fails", async () => {
  const c = rs("components/Composer.tsx").replace("|| overLimit || xHold}", "|| overLimit}");
  assert(xFirstViolations(c, rs("components/XOutboxToggle.tsx")).length === 0, xFirstViolations(c, rs("components/XOutboxToggle.tsx")).join(" | "));
});
await mutation("S3 / a node-only import at the route's top", async () => {
  const v = uiViolations('import { createHash } from "node:crypto";\n' + rs("app/api/x/outbox/route.ts"), rs("components/Composer.tsx"), rs("components/XOutboxToggle.tsx"));
  assert(v.length === 0, v.join(" | "));
});

// ================================================================================================ N — under the network guard
// The rig suite runs a guarded validator on :4057; here the same flow runs in a CHILD node process with the guard
// preloaded (NODE_OPTIONS --require scripts/lib/net-guard.cjs), on an in-process validator listening on an EPHEMERAL
// loopback port: submit → a moderator's approval → relay-now → posted, then the guard's log. Only the positive control
// may be in it.
const CHILD = path.join(HERE, "guarded-flow.cjs");
writeFileSync(
  CHILD,
  `"use strict";
process.env.ZK_DEV_HOOKS = "true";
process.env.ZK_ANON_POST_TREE = "valid";
process.env.VALIDATOR_POLLER = "off";
const path = require("node:path");
const ROOT = ${JSON.stringify(ROOT)};
const { createApp } = require(path.join(ROOT, "validator", "server.js"));
const vz = require(path.join(ROOT, "validator", "zk.js"));
const { generateKeyPairSync, sign, randomBytes } = require("node:crypto");
const app = createApp(path.join(process.env.GUARD_TMP, "v.db"));
const srv = app.app.listen(0, "127.0.0.1", async () => {
  const B = "http://127.0.0.1:" + srv.address().port;
  const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const out = {};
  try {
    await call("POST", "/zk/dev/seed-decoys", { mode: "fixture", count: 4 });
    await call("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
    const m = (await call("GET", "/zk/members?mode=fixture&tree=valid")).json;
    const text = "a guarded copy";
    const nonce = randomBytes(16).toString("hex");
    const xHash = vz.xAnonHash(text, nonce);
    const scopeStr = "layers/zk-scope/v1|x-anon-post/" + vz.anonPostWindowOf(m.epoch) + "/s0";
    const pub = { mode: "fixture", claimKind: "x-anon-post", tree: "valid", epoch: m.epoch, merkleTreeRoot: m.root, scope: vz.fieldOf("scope", scopeStr), message: vz.fieldOf("message", ["anon", "x-anon-post", "x:" + xHash, "epoch-" + m.epoch, m.root].join("|")), personaId: "anon", gateId: "x-anon-post", challenge: "epoch-" + m.epoch, xHash, slot: 0 };
    const nul = vz.fieldOf("n", scopeStr);
    out.submit = (await call("POST", "/zk/submit", { envelope: { v: 1, mode: "fixture", claimKind: "x-anon-post", publicInputs: pub, nullifier: nul, proof: { scheme: "layers-zk-fixture/1", tag: vz.fixtureTag(vz.canonicalPublicInputs(pub), nul) }, payload: { text, nonce } } })).status;
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" });
    const pk = spki.subarray(spki.length - 32).toString("hex");
    await call("POST", "/x/outbox/dev/moderator", { mode: "fixture", pubkey: pk });
    const h = Math.floor(Date.now() / 3600000);
    const mn = randomBytes(16).toString("hex");
    out.moderate = (await call("POST", "/x/outbox/moderate", { mode: "fixture", id: xHash, decision: "approve", issuedHour: h, nonce: mn, pubkey: pk, sig: sign(null, Buffer.from(["layers-x-moderate/2", "fixture", xHash, "approve", String(h), mn].join("|")), privateKey).toString("hex") })).status;
    out.relay = (await call("POST", "/x/outbox/dev/relay-now", { mode: "fixture" })).json;
    out.row = ((await call("GET", "/x/outbox?mode=fixture")).json.items || []).find((r) => r.id === xHash) || null;
    if (process.env.GUARD_MUTATE === "1") await fetch("https://api.example.org/leak").catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  } catch (e) {
    out.error = e.message;
  }
  out.guard = globalThis.__netGuard ? globalThis.__netGuard.entries : null;
  process.stdout.write("RESULT " + JSON.stringify(out) + "\\n");
  srv.close();
  process.exit(0);
});
`
);
async function guardedFlow(mutate) {
  const { spawnSync } = await import("node:child_process");
  const tmp = mkdtempSync(path.join(HERE, "guard-"));
  const env = { ...process.env, NODE_OPTIONS: "--require ./scripts/lib/net-guard.cjs", NET_GUARD_SELFTEST: "1", GUARD_TMP: tmp, GUARD_MUTATE: mutate ? "1" : "0" };
  for (const k of Object.keys(env)) if (/^(NEYNAR_|FC_|ENABLE_|RAILWAY_|LAYERS_REQUIRE_SIG|NODE_ENV)/.test(k)) delete env[k];
  const r = spawnSync(process.execPath, [CHILD], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  assert(line, "the guarded child produced no result: " + (r.stderr || "").slice(-400));
  const out = JSON.parse(line.slice(7));
  assert(!out.error, "the guarded flow failed: " + out.error);
  // (posted ≤ 1: the outbox's own hourly slot could take the row a moment earlier at a top of the hour)
  assert(out.submit === 200 && out.moderate === 200 && out.relay?.posted <= 1 && out.relay.destination === "fixture" && out.row?.status === "posted", "the guarded flow did not end posted through the fixture: " + JSON.stringify(out));
  const control = (out.guard ?? []).filter((e) => e.selftest === true);
  const real = (out.guard ?? []).filter((e) => e.selftest !== true);
  assert(out.guard && control.length >= 2, "the guard's positive control is missing (was it loaded?): " + JSON.stringify(out.guard));
  assert(real.length === 0, "the guarded flow reached for the network: " + JSON.stringify(real));
  return `submit → approve → relay → posted; guard: ${control.length} control entries, 0 real`;
}
console.log("\nN — under the network guard");
await check("N1 in a child process with scripts/lib/net-guard.cjs preloaded, an in-process validator (ephemeral loopback port, temp DB, the rep poller off) runs submit → moderate → relay → posted through the fixture transport; the guard recorded its positive control and NOTHING else", () => guardedFlow(false));
await mutation("N1 / the same flow with one non-loopback fetch in it (the check reads the guard's log)", async () => guardedFlow(true));

// ================================================================================================ Z — the size
const SUBMIT_MOCKS = {
  "server-only": `export {};`,
  "lib/zk/anon/client": `export function recordAnonSubmission() {}`,
  "lib/zk/anon/pow": `export function solvePow() { return { nonce: "0", ms: 0, attempts: 0 }; }`,
  "lib/zk/anon/relay": `export function currentRelay() { return { kind: "direct", async send() { throw new Error("no send"); } }; } export function relayConfig() { return { kind: "direct" }; } export function relayChannel() { return "node"; } export function inBrowserDevice() { return false; }`,
};
const SUB = await bundle(`export * as submit from "@/lib/zk/anon/submit";\nexport * as config from "@/lib/zk/config";\n`, SUBMIT_MOCKS);
/** the largest texts a policy takes, against the real paddedBody: a link weighs 23 whatever it holds, so the worst copy is
 *  a few words beside a link of escaped-to-6-bytes characters (lone surrogates) as long as the size bound allows; also
 *  280 three-byte weight-1 characters (U+0800) and 200 words beside a 512-character ASCII link */
function sizeScenario(shape, maxBytes) {
  const big = (n) => "9".repeat(n);
  const proof = { scheme: "semaphore-v4", merkleTreeDepth: 20, points: Array.from({ length: 8 }, () => big(77)) };
  const pub = { mode: "live", claimKind: "x-anon-post", tree: "attest:onchain.wallet-age/gt2y", epoch: 99_999_999, merkleTreeRoot: big(77), scope: big(75), message: big(75), personaId: "anon", gateId: "x-anon-post", challenge: "epoch-99999999", xHash: "a".repeat(64), slot: 3 };
  const surrogates = Math.min(512 - 20, Math.floor((maxBytes - 40) / 6));
  const texts = [
    ["a link of " + surrogates + " escaped-to-6-bytes characters", "w".repeat(10) + " https://example.org/" + "\ud800".repeat(surrogates)],
    ["280 three-byte characters", "ࠀ".repeat(280)],
    ["200 words beside a 512-character link", "w".repeat(199) + " https://example.org/" + "p".repeat(512 - 20)],
  ];
  const sizes = [];
  for (const [name, text] of texts) {
    const s = shape(text);
    assert(s.ok, `the policy refused the worst case it should take (${name}): ${s.reason}`);
    const env = { v: 1, mode: "live", claimKind: "x-anon-post", publicInputs: pub, nullifier: big(77), proof, payload: { text, nonce: "d".repeat(32) } };
    const body = SUB.submit.paddedBody(env);
    assert(body !== null && body.length === 4096, `the worst-case X copy (${name}) does not fit the constant body`);
    sizes.push(new TextEncoder().encode(JSON.stringify({ envelope: env, p: "" })).length);
  }
  // one escaped byte past the bound is refused (the bound is live, not decorative)
  const past = "w".repeat(10) + " https://example.org/" + "\ud800".repeat(Math.floor((maxBytes - 30) / 6) + 2);
  assert(!shape(past).ok, "a text past the escaped-size bound was taken");
  return `largest ${Math.max(...sizes)} of 4096 bytes`;
}
console.log("\nZ — the constant request size");
await check("Z1 the worst-case X copies the policy takes (a link of lone surrogates up to the escaped-size bound, 280 three-byte characters, 200 words beside a 512-character link) fit the anonymous channel's constant 4096-byte body; past the bound is refused", () => sizeScenario((t) => vx.xPostShape(t), vx.X_MAX_TEXT_BYTES));
await mutation("Z1 / the escaped-size bound raised to 4096 bytes (the largest copy would no longer fit)", async () => {
  const P = patchedValidator("xoutbox.js", [["const X_MAX_TEXT_BYTES = 2048;", "const X_MAX_TEXT_BYTES = 4096;"]]);
  sizeScenario((t) => P.xPostShape(t), 4096);
});

// ------------------------------------------------------------------------------------------------ done
vserver.close();
try {
  VAPP.db.close();
} catch {
  /* closed */
}
console.log(`\n${passed}/${passed + failed} x-outbox unit checks passed${failed ? ", " + failed + " FAILED — " + failures.join("; ") : ""}`);
process.exitCode = failed ? 1 : 0;
