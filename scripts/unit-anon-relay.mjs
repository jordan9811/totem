// PUBLIC GO-LIVE (the relay track) — node-only unit harness: THE PUBLIC @anon RELAY, its caps, its filter, its reports and
// takedowns, the fid gate and the kill switches. Nothing here reaches any network: the validator runs in this process on an
// ephemeral loopback port, and the Neynar / Optimism it talks to is scripts/lib/neynar-anon-stub.mjs on loopback.
//
//   node scripts/unit-anon-relay.mjs          (npm run test:anon-relay-unit once the verify agent adds the script)
//
// The client modules are bundled with esbuild (the @/ paths from tsconfig.json) with their stateful neighbours mocked; the
// validator's own modules are required from validator/. EVERY GUARD HAS A MUTATION — a deliberately broken copy (a client
// module patched in a temp directory, a validator module compiled in memory under its real filename and swapped into the
// require cache) whose named check MUST go red, so no check passes vacuously.
//
//   E  THE ENV CONTRACT: the public app refuses the agent's signer and key (APP_ONLY_REFUSES), a public fid alone is
//      clean; the public validator accepts the relay credential and still refuses a second write credential
//   R  THE RELAY: unarmed (no switch) nothing ever posts; armed, a pending row leaves EXACTLY ONCE under the agent's signer
//      uuid and key; a real live post is held PENDING (zero calls) until its slot, then leaves once; the app's code never
//      posts (a source scan for Neynar's cast endpoint and an x-api-key in every app-side anon module, itself mutated)
//   C  THE CAPS: the global daily cap, K per person per window, the agent's lifetime cap (required, and counted inside the
//      insert transaction — real live proofs), each refused before the nullifier is consumed
//   F  THE FILTER: the validator's and the tab's copies give the same answer over one corpus (named cases + seeded fuzz);
//      each rule refuses its case; the validator refuses before consuming anything and logs the rule and the hour only
//   P  REPORTS: the per-address budget; the fixed reasons; no reporter column
//   T  TAKEDOWNS: REMOVE hides at once, keeps the row, deletes from Farcaster ONCE through the agent signer; a key not in
//      ANON_MODERATORS is refused; a decision signed by the tab's lib/zk/anon/moderation.ts verifies on the validator
//   G  THE FID GATE: one commitment per fid, a leaf from the NEXT epoch, a newer sign-in replaces; the domain, the nonce
//      binding and the replay each refused; joinNonceFor equal on both sides
//   K  THE KILL SWITCHES: the validator's (ZK_ANON_RELAY_LIVE removed: liveRelay false, nothing posts) and the app's
//      (ZK_ANON_POST=off: anonymous posting off in a tab even when everything else says live)
//   A  THE TAB: live only with the app's hint AND the last tick's liveRelay; today's words otherwise; an armed live post is
//      not preview-only; PUBLIC_LIVE turns the test universe off; a live envelope leaves a tab only when armed; the hint's
//      names and values are checked; where a post goes, in words (destination)
//   PUBLIC GO-LIVE review fixes (the relay track):
//   R4 a disarm DROPS the queue (ASM-3): re-arming never publishes a backlog no moderator could see
//   V  THE GATED TREE ONLY (ASM-1): a live post into a self-issued reach tree is refused on the gated shape (a real proof);
//      the live config offers no reach issuer and the reach ids cannot be registered in the live universe
//   T4 the kill switch never stops a removal (ASM-4); only a revoked key makes removals wait
//   G4-G8 THE CROWD IDENTITY (PRIV-LIVE-1): the join binds Identity(HKDF(zk master, "layers/anon-fid-tree/1")), never the
//      root's registered commitment (G6: no /zk/register body carries it); prove.ts and the in-tab transport prove the
//      gated tree with it only; the tab's signed leave verifies on the validator and drops the leaf next epoch (ASM-5)
//   L  P2 a tab never sends the device-signed read that names a refused post (PRIV-LIVE-2); P3 the crowd join is sent only
//      after record() sealed the sign-in (PRIV-LIVE-3); M2 a moderator in a live tab removes a test post by its universe
//      (ASM-2C)
import { createRequire, Module } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = mkdtempSync(path.join(os.tmpdir(), "layers-anon-relay-unit-"));
process.on("exit", () => rmSync(HERE, { recursive: true, force: true }));
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
for (const k of ["FC_ANON_FID", "FC_ANON_SIGNER_UUID", "FC_ANON_NEYNAR_KEY", "ZK_ANON_RELAY_LIVE", "ZK_ANON_POST_LIVE_CAP", "FC_ANON_NEYNAR_BASE_URL", "NEYNAR_API_KEY", "NEYNAR_SIGNER_UUID", "ENABLE_FC_WRITE", "ANON_MODERATORS", "ZK_ANON_FID_GATE", "APP_URL", "ANON_FID_RPC_URL", "FC_HUB_URL", "ZK_ANON_TRANSPORT", "ANON_FILTER_SCAM_DOMAINS", "ZK_ANON_POST_SLOTS", "ZK_ANON_POST_DAILY_CAP", "LAYERS_HOSTED", "ZK_ANON_POST", "ZK_ANON_UNIVERSE", "PUBLIC_LIVE", "NODE_ENV", "ZK_GATE_TIER", "ZK_ANON_POST_WINDOW_EPOCHS", "LAYERS_REQUIRE_SIG"]) delete process.env[k];
process.env.ZK_DEV_HOOKS = "true";
process.env.ZK_ANON_POST_TREE = "valid";
process.env.ZK_ANON_FLOOR = "1";

const rawLog = console.log;
console.log = (...a) => {
  if (typeof a[0] === "string" && /^\[validator\] (migration \d+|listening)/.test(a[0])) return;
  rawLog(...a);
};
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
/** a MUTATION: the scenario must FAIL against the broken copy (and the copy must have applied and built) */
async function mutation(name, run, expect = null) {
  let threw = null;
  try {
    await run();
  } catch (e) {
    threw = e;
  }
  await check(`MUTATION ${name} → the check goes red`, async () => {
    assert(threw !== null, "the broken copy PASSED — the check is vacuous");
    assert(!/^patch anchor not found/.test(String(threw.message ?? "")), "the mutation did not apply — " + threw.message);
    assert(!/^Build failed/.test(String(threw.message ?? "")), "the mutated copy did not build — " + String(threw.message).slice(0, 200));
    // the RIGHT check must go red (a mutation that fails on furniture — a stale tree, a missing leaf — proves nothing)
    if (expect) assert(expect.test(String(threw.message ?? threw)), "it went red for another reason: " + String(threw.message ?? threw).slice(0, 200));
    return String(threw.message ?? threw).slice(0, 120);
  });
}

// ------------------------------------------------------------------------------------------------ the bundler
let bundleSeq = 0;
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
    name: "anon-relay-mocks",
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
  await build({ absWorkingDir: ROOT, entryPoints: [entry], outfile: out, bundle: true, format: "esm", platform: "node", target: ["node20"], tsconfig: path.join(ROOT, "tsconfig.json"), plugins: [plugin], loader: { ".json": "json" }, logLevel: "error", nodePaths: [path.join(ROOT, "node_modules")] });
  return import(pathToFileURL(out).href);
}
/** a validator module compiled in memory with edits, under its REAL filename, SWAPPED into the require cache while `fn`
 *  runs (a module that requires it lazily — zk.js → anonpublic.js, anonpublic.js → zk.js — then gets the broken copy) */
async function withPatchedValidator(file, edits, fn) {
  const abs = path.join(ROOT, "validator", file);
  let src = readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error(`patch anchor not found in validator/${file}: ` + from.slice(0, 90));
    src = src.split(from).join(to);
  }
  const m = new Module(abs, null);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  const orig = require.cache[abs];
  require.cache[abs] = m;
  m._compile(src, abs);
  m.loaded = true;
  try {
    return await fn(m.exports);
  } finally {
    if (orig) require.cache[abs] = orig;
    else delete require.cache[abs];
  }
}
/** a FRESH copy of validator/zk.js (its own tree cache) — every scenario that freezes an epoch's tree uses one */
const freshZk = (fn) => withPatchedValidator("zk.js", [], fn);
const asBrowser = async (fn) => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const prev = globalThis.window;
  globalThis.window = globalThis;
  try {
    return await fn();
  } finally {
    if (had) globalThis.window = prev;
    else delete globalThis.window;
  }
};
async function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

// ------------------------------------------------------------------------------------------------ the validator, the stub
const vz = require(path.join(ROOT, "validator", "zk.js"));
const vap = require(path.join(ROOT, "validator", "anonpublic.js"));
const vf = require(path.join(ROOT, "validator", "anon-filter.js"));
const vc = require(path.join(ROOT, "validator", "env-contract.js"));
const { openDb } = require(path.join(ROOT, "validator", "db.js"));
const { createApp } = require(path.join(ROOT, "validator", "server.js"));
const { Identity } = require("@semaphore-protocol/identity");
const { Group } = require("@semaphore-protocol/group");
const { poseidon2 } = require("poseidon-lite");
const { startNeynarAnonStub, SELECTOR_ID_OF, SELECTOR_KEY_DATA_OF } = await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "neynar-anon-stub.mjs")).href);
const STUB_KEY = "anonstub-unit-relay-000001";
const AGENT_UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d";
const AGENT_FID = 812345;
const stub = await startNeynarAnonStub({ key: STUB_KEY, signers: { [AGENT_UUID]: { fid: AGENT_FID } } });
const AGENT_ENV = () => ({ FC_ANON_FID: String(AGENT_FID), FC_ANON_SIGNER_UUID: AGENT_UUID, FC_ANON_NEYNAR_KEY: STUB_KEY, ZK_ANON_RELAY_LIVE: "on", ZK_ANON_POST_LIVE_CAP: "50", FC_ANON_NEYNAR_BASE_URL: stub.baseUrl, ZK_ANON_RELAY_INTERVAL_MS: "86400000" });
const VAPP = createApp(":memory:");
const vserver = await new Promise((resolve) => {
  const s = VAPP.app.listen(0, "127.0.0.1", () => resolve(s));
});
const VB = "http://127.0.0.1:" + vserver.address().port;
const vapi = async (method, p, body) => {
  const r = await fetch(VB + p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// fixture and live envelopes over a world written straight into a database (test furniture: active this epoch)
const fieldOf = (domain, canonical) => (BigInt("0x" + createHash("sha256").update(`layers-zk-field/1|${domain}|${canonical}`).digest("hex")) >> 8n).toString(10);
const fixtureTag = (canonical, nullifier) => createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
let rootSeq = 0;
function world(db, mode, people, Z) {
  if (!Z) throw new Error("world() needs the zk module the scenario verifies with (a shared tree cache reads a stale tree)");
  const ep = Z.epochInfo(db, mode).epoch;
  for (const who of people) {
    const id = "root_unit_" + ++rootSeq;
    db.prepare("INSERT OR IGNORE INTO roots (id, fid, signer_uuid, created_at) VALUES (?, ?, ?, ?)").run(id, 880000 + rootSeq, "unit-" + rootSeq, Date.now());
    db.prepare("INSERT OR IGNORE INTO zk_registrations (mode, commitment, root_id, registered_at, epoch_registered, active_from_epoch) VALUES (?, ?, ?, 0, ?, ?)").run(mode, who.commitment.toString(10), id, ep - 1, ep);
  }
  const trees = Z.buildTrees(db, mode, ep);
  return { ep, root: String(trees.valid.group.root ?? "0"), members: trees.valid.members };
}
let textSeq = 0;
function anonParts(w, slot, text) {
  const t = text ?? "unit relay post " + ++textSeq + " " + Date.now().toString(36);
  const nonce = randomBytes(16).toString("hex");
  const castHash = createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + t, "utf8").digest("hex");
  const attributionCommitment = createHash("sha256").update("attr|" + nonce).digest("hex");
  const note = randomBytes(256).toString("hex");
  const noteHash = createHash("sha256").update(Buffer.from(note, "hex")).digest("hex");
  return { t, nonce, castHash, attributionCommitment, note, noteHash };
}
function fixtureEnvelope(w, who, slot, text) {
  const x = anonParts(w, slot, text);
  const pub = { mode: "fixture", claimKind: "anon-post", tree: "valid", epoch: w.ep, merkleTreeRoot: w.root, personaId: "anon", gateId: "anon-post", challenge: "epoch-" + w.ep, castHash: x.castHash, attributionCommitment: x.attributionCommitment, noteHash: x.noteHash, slot };
  let ex;
  try {
    ex = vz.expectedPublicValues(pub);
  } catch {
    // a slot outside K: build the scope by hand so the binding (not this helper) is the one that refuses it
    ex = { scope: fieldOf("scope", `layers/zk-scope/v1|anon-post/w${w.ep}/s${slot}`), message: fieldOf("message", ["anon", "anon-post", "cast:" + x.castHash, "attr:" + x.attributionCommitment, "note:" + x.noteHash, "epoch-" + w.ep, w.root].join("|")) };
  }
  Object.assign(pub, { scope: ex.scope, message: ex.message });
  const nullifier = poseidon2([BigInt(vz.semaphoreHash(pub.scope)), who.secretScalar]).toString(10);
  return { v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(vz.canonicalPublicInputs(pub), nullifier) }, payload: { text: x.t, nonce: x.nonce, note: x.note } };
}
const ART = path.join(ROOT, ".zk-artifacts");
const WASM = path.join(ART, "semaphore-20.wasm");
const ZKEY = path.join(ART, "semaphore-20.zkey");
const HAVE_ARTIFACTS = existsSync(WASM) && existsSync(ZKEY);
async function liveEnvelope(w, who, slot, text, tree = "valid") {
  if (!HAVE_ARTIFACTS) throw new Error("no cached proving artifacts in .zk-artifacts (npm run bench:zk once): the live checks cannot run, and a skipped check would be vacuous");
  const { generateProof } = require("@semaphore-protocol/proof");
  const x = anonParts(w, slot, text);
  const pub = { mode: "live", claimKind: "anon-post", tree, epoch: w.ep, merkleTreeRoot: w.root, personaId: "anon", gateId: "anon-post", challenge: "epoch-" + w.ep, castHash: x.castHash, attributionCommitment: x.attributionCommitment, noteHash: x.noteHash, slot };
  const ex = vz.expectedPublicValues(pub);
  Object.assign(pub, { scope: ex.scope, message: ex.message });
  const proof = await generateProof(who, new Group(w.members.map((m) => BigInt(m))), BigInt(pub.message), BigInt(pub.scope), 20, { wasm: WASM, zkey: ZKEY });
  return { v: 1, mode: "live", claimKind: "anon-post", publicInputs: pub, nullifier: String(proof.nullifier), proof: { scheme: "semaphore-v4", merkleTreeDepth: proof.merkleTreeDepth, points: proof.points.map(String) }, payload: { text: x.t, nonce: x.nonce, note: x.note } };
}
const hasNullifier = (db, mode, n) => !!db.prepare("SELECT 1 FROM zk_nullifiers WHERE mode = ? AND nullifier = ?").get(mode, n);
const publishes = (from = 0) => stub.calls().slice(from).filter((c) => c.op === "publish");
const keypair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
};
const signHex = (canonical, priv) => cryptoSign(null, Buffer.from(canonical, "utf8"), priv).toString("hex");

// ------------------------------------------------------------------------------------------------ the client bundles
const SERVER_ONLY = { "server-only": "export {};" };
const AV_MOCKS = { "lib/adapters/registry": "export function currentRepImpl() { return globalThis.__AVR ?? 'mock'; }" };
const AV = await bundle(`export * from "@/lib/zk/anon/availability";\n`, AV_MOCKS);
const UNI = await bundle(`export * from "@/lib/zk/anon/universe";\n`);
const TC = await bundle(`export * from "@/lib/zk/anon/textCheck";\n`);
const ENVC = await bundle(`export * from "@/lib/platform/env-contract";\n`);
const VAULT_KEY = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 255);
globalThis.__ARVK = VAULT_KEY;
const MOD_MOCKS = { ...SERVER_ONLY, "lib/identity/keystore": "export function vaultKeyBytes() { return globalThis.__ARVK; }" };
const MODC = await bundle(`export * from "@/lib/zk/anon/moderation";\n`, MOD_MOCKS);
const FJ_MOCKS = { ...SERVER_ONLY, "lib/identity/keystore": "export function zkMasterBytes() { if (!globalThis.__FJM) throw new Error(\"no zk master here\"); return globalThis.__FJM; }", "lib/zk/identity": "export function zkCommitment() { return globalThis.__FJC; }", "lib/zk/validatorClient": "export async function postFidJoin(b) { (globalThis.__FJP ??= []).push(b); return globalThis.__FJR ?? { status: 201, json: { ok: true, activeFromEpoch: 7 } }; } export async function postFidLeave(b) { (globalThis.__FJL ??= []).push(b); return globalThis.__FJLR ?? { status: 200, json: { ok: true, leftFromEpoch: 9 } }; }" };
const FJ = await bundle(`export * from "@/lib/zk/anon/fcJoin";\n`, FJ_MOCKS);
const SUB = await bundle(`export { liveEnvelopeMayLeaveTab } from "@/lib/zk/anon/submit";\n`, SERVER_ONLY);

console.log("\nE — the env contract");
const PUB_APP = { NODE_ENV: "production", LAYERS_REQUIRE_SIG: "true" };
async function envScenario(E) {
  assert(E.contractViolations({ ...PUB_APP }).length === 0, "the clean public app is refused: " + JSON.stringify(E.contractViolations(PUB_APP)));
  for (const n of ["FC_ANON_SIGNER_UUID", "FC_ANON_NEYNAR_KEY"]) {
    const v = E.contractViolations({ ...PUB_APP, [n]: "set-" + n });
    assert(v.length === 1 && v[0] === n, `the public app with ${n} set: ${JSON.stringify(v)}`);
    assert(E.contractViolations({ ...PUB_APP, [n]: "off" }).length === 0, n + "=off refused the app");
  }
  assert(E.contractViolations({ ...PUB_APP, FC_ANON_FID: "812345" }).length === 0, "a public fid refused the app");
  // the validator half
  const pubVal = { ...PUB_APP, FC_ANON_FID: "1", FC_ANON_SIGNER_UUID: AGENT_UUID, FC_ANON_NEYNAR_KEY: STUB_KEY, ZK_ANON_RELAY_LIVE: "on" };
  assert(vc.contractViolations(pubVal).length === 0, "the validator refused the relay credential: " + JSON.stringify(vc.contractViolations(pubVal)));
  assert(JSON.stringify(vc.contractViolations({ ...pubVal, NEYNAR_API_KEY: "x-123456789" })) === JSON.stringify(["NEYNAR_API_KEY"]), "a second write credential was not refused");
  return "app: signer and key refused, fid clean; validator: credential clean, NEYNAR_API_KEY refused";
}
await check("E1 the public app refuses the agent's signer and key (and a public fid is clean); the public validator holds the credential and refuses a second", () => envScenario(ENVC));
await mutation("E1 / the app-only list emptied", async () => envScenario(await bundle(`export * from "@/lib/platform/env-contract";\n`, {}, { "lib/platform/env-contract.ts": [['  "FC_ANON_SIGNER_UUID", // PUBLIC GO-LIVE: the anon agent\'s signer (validator only)\n  "FC_ANON_NEYNAR_KEY", // PUBLIC GO-LIVE: the agent-only Neynar app\'s key (validator only)\n', ""]] })));

console.log("\nR — the relay");
function insertPending(db, castHash, text, hidden = false) {
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, hidden_at) VALUES ('live', ?, ?, 0, 0, '', ?, 'pending', ?)").run(castHash, text, AGENT_FID, hidden ? 3_600_000 : null);
}
async function unarmedScenario() {
  const db = VAPP.db;
  db.prepare("UPDATE zk_anon_casts SET status = 'failed' WHERE mode = 'live' AND status = 'pending'").run();
  const h0 = createHash("sha256").update("r1-unarmed|" + Date.now() + Math.random()).digest("hex");
  insertPending(db, h0, "an unarmed post");
  const from = stub.calls().length;
  await withEnv({ ...AGENT_ENV(), ZK_ANON_RELAY_LIVE: undefined }, () => vapi("POST", "/zk/dev/relay-now"));
  assert(publishes(from).length === 0, "an UNARMED relay posted: " + JSON.stringify(publishes(from)));
  // PUBLIC GO-LIVE (ASM-3): the post that was waiting is DROPPED ('failed'), never published by a later arm
  assert(db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(h0).status === "failed", "an unarmed public relay kept the waiting row (it would go out on the next arm)");
  // armed: a post queued now leaves exactly once, under the agent's signer and key; a second slot sends nothing
  const h = createHash("sha256").update("r1|" + Date.now() + Math.random()).digest("hex");
  insertPending(db, h, "an armed post");
  await withEnv(AGENT_ENV(), async () => {
    await vapi("POST", "/zk/dev/relay-now");
    await vapi("POST", "/zk/dev/relay-now");
  });
  const p = publishes(from);
  assert(p.length === 1 && p[0].keyOk && p[0].signerKnown && p[0].text === "an armed post", "armed publishes: " + JSON.stringify(p));
  const row = db.prepare("SELECT status, fid, network_hash FROM zk_anon_casts WHERE cast_hash = ?").get(h);
  assert(row.status === "relayed" && row.fid === AGENT_FID && row.network_hash === p[0].hash, "the relayed row: " + JSON.stringify(row));
  return "unarmed: 0 calls, the waiting row dropped; armed: 1 publish under the agent signer";
}
await check("R1 unarmed (no ZK_ANON_RELAY_LIVE) NOTHING posts and the waiting row is dropped; armed, a pending row leaves exactly once under the agent's signer and key, and a second slot sends nothing", unarmedScenario);
await mutation("R1 / the relay's switch not required", () => withPatchedValidator("anonpublic.js", [['    if (sw !== "on") problems.push(sw ? "ZK_ANON_RELAY_LIVE is not on" : "ZK_ANON_RELAY_LIVE is unset (the relay\'s switch)");\n', ""]], () => unarmedScenario()), /an UNARMED relay posted/);

async function slotScenario(Z) {
  return withEnv(AGENT_ENV(), async () => {
    // createApp requires ./zk when it is called, so this validator mounts the copy under test (Z)
    const { app, db } = createApp(":memory:");
    const srv = await new Promise((resolve) => {
      const s2 = app.listen(0, "127.0.0.1", () => resolve(s2));
    });
    try {
      const who = new Identity("unit-relay-slot-" + Date.now() + Math.random());
      const w = world(db, "live", [who], Z);
      const env = await liveEnvelope(w, who, 0, "a live post that waits for its slot " + Date.now());
      const from = stub.calls().length;
      const r = await Z.verifyAndRecord(db, env);
      assert(r.status === 200, "the live post was not accepted: " + JSON.stringify(r));
      assert(db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(env.publicInputs.castHash)?.status === "pending", "the accepted live post is not PENDING (it must wait for the relay's slot)");
      assert(publishes(from).length === 0, "the post left at submission time");
      await fetch("http://127.0.0.1:" + srv.address().port + "/zk/dev/relay-now", { method: "POST" });
      const p = publishes(from);
      assert(p.length === 1 && p[0].text === env.payload.text, "after the slot: " + JSON.stringify(p));
      return "pending, 0 calls; at the slot: 1 publish";
    } finally {
      srv.close();
    }
  });
}
await check("R2 a real live post (Groth16, the pinned artifacts) is held PENDING with zero calls until the relay's slot, then leaves exactly once", () => freshZk((Z) => slotScenario(Z)), /not PENDING/);
await mutation("R2 / the live row stored as relayed at submission (no slot)", () => withPatchedValidator("zk.js", [['anonRow = { status: "pending", hash: "", fid: acct.fid, relayedAt: 0 };', 'anonRow = { status: "relayed", hash: "0xunit", fid: acct.fid, relayedAt: 0 };']], (Z) => slotScenario(Z)));

/** the app-side anon code: every file under lib/zk/anon, the anon routes and the composer-side helpers */
function appAnonSources() {
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) files.push(p);
    }
  };
  walk(path.join(ROOT, "lib", "zk", "anon"));
  walk(path.join(ROOT, "app", "api", "anon"));
  for (const f of ["lib/zk/gate.ts", "lib/zk/prefetch.ts", "components/zk/AnonReportButton.tsx", "components/settings/AnonModerationPane.tsx"]) files.push(path.join(ROOT, f));
  return files.map((f) => ({ file: path.relative(ROOT, f), text: readFileSync(f, "utf8") }));
}
function appNeverPostsScenario(sources) {
  const bad = [];
  for (const { file, text } of sources) {
    if (/\/v2\/farcaster\/cast\b/.test(text) || /api\.neynar\.com/.test(text) || /["']x-api-key["']/.test(text) || /FC_ANON_NEYNAR_KEY|FC_ANON_SIGNER_UUID/.test(text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""))) bad.push(file);
  }
  assert(sources.length >= 15, "the scan covers too few files to mean anything: " + sources.length);
  assert(bad.length === 0, "app-side anon code that could post or read the relay credential: " + bad.join(", "));
  return sources.length + " app-side files carry no Neynar cast endpoint, no x-api-key and no relay credential";
}
await check("R3 the app server never posts: no app-side anon module names Neynar's cast endpoint, an x-api-key or the relay credential (the public app refuses the credential at boot: E1)", () => appNeverPostsScenario(appAnonSources()));
await mutation("R3 / an app-side module that posts to Neynar", async () => appNeverPostsScenario([...appAnonSources(), { file: "lib/zk/anon/doctored.ts", text: 'await fetch("https://api.neynar.com/v2/farcaster/cast", { headers: { "x-api-key": k } });' }]));

// PUBLIC GO-LIVE (ASM-3): a disarm DROPS the queue — re-arming never publishes a backlog no moderator could see
async function disarmDropScenario() {
  return withEnv(AGENT_ENV(), async () => {
    // createApp requires ./zk when it is called, so this validator mounts the copy under test
    const { app, db } = createApp(":memory:");
    const srv = await new Promise((resolve) => {
      const s2 = app.listen(0, "127.0.0.1", () => resolve(s2));
    });
    const relayNow = () => fetch("http://127.0.0.1:" + srv.address().port + "/zk/dev/relay-now", { method: "POST" });
    try {
      const h = createHash("sha256").update("r4|" + Date.now() + Math.random()).digest("hex");
      insertPending(db, h, "queued before the disarm");
      const from = stub.calls().length;
      await withEnv({ ZK_ANON_RELAY_LIVE: undefined }, relayNow);
      await relayNow();
      await relayNow();
      assert(publishes(from).length === 0, "re-arming published the post queued before the disarm: " + JSON.stringify(publishes(from)));
      assert(db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(h).status === "failed", "the disarmed relay did not drop the queued post");
      return "queued, disarmed, re-armed: 0 publishes, the row failed";
    } finally {
      srv.close();
    }
  });
}
await check("R4 a disarm DROPS the queue (ASM-3): a post waiting for its slot is marked failed by the disarmed relay; re-arming publishes nothing", () => freshZk(() => disarmDropScenario()));
await mutation("R4 / the disarmed relay keeps its queue (the UPDATE dropped)", () => withPatchedValidator("zk.js", [[`const dropped = db.prepare("UPDATE zk_anon_casts SET status = 'failed' WHERE mode = 'live' AND status = 'pending'").run();`, "const dropped = { changes: 0 };"]], () => disarmDropScenario()), /re-arming published/);

console.log("\nC — the caps");
async function dailyScenario(Z) {
  const db = openDb(":memory:");
  const a = new Identity("unit-daily-a");
  const b = new Identity("unit-daily-b");
  const w = world(db, "fixture", [a, b], Z);
  return withEnv({ ZK_ANON_POST_DAILY_CAP: "1" }, async () => {
    const r1 = await Z.verifyAndRecord(db, fixtureEnvelope(w, a, 0));
    assert(r1.status === 200, "the first post of the day: " + JSON.stringify(r1));
    const e2 = fixtureEnvelope(w, b, 0);
    const r2 = await Z.verifyAndRecord(db, e2);
    assert(r2.status === 503 && /ZK_ANON_POST_DAILY_CAP/.test(r2.json.error), "the (cap+1)th post: " + JSON.stringify(r2));
    assert(!hasNullifier(db, "fixture", e2.nullifier), "the capped post consumed its nullifier");
    return "cap 1: the second post refused 503, nothing consumed";
  });
}
await check("C1 the global DAILY cap (ZK_ANON_POST_DAILY_CAP) refuses the (cap+1)th post inside the insert transaction, nothing consumed", () => freshZk((Z) => dailyScenario(Z)), /the \(cap\+1\)th post/);
await mutation("C1 / the daily cap not counted", () => withPatchedValidator("zk.js", [["if (anonDailyUsed(db, mode, p.epoch) >= anonDailyCap())", "if (false && anonDailyUsed(db, mode, p.epoch) >= anonDailyCap())"]], (Z) => dailyScenario(Z)));

async function kScenario(Z) {
  const db = openDb(":memory:");
  const a = new Identity("unit-k-a");
  const w = world(db, "fixture", [a], Z);
  const K = Z.anonPostSlots();
  assert(K === 4, "the default K is 4 (D4): " + K);
  for (let s = 0; s < K; s++) {
    const r = await Z.verifyAndRecord(db, fixtureEnvelope(w, a, s));
    assert(r.status === 200, "slot " + s + ": " + JSON.stringify(r));
  }
  const over = fixtureEnvelope(w, a, K);
  const r = await Z.verifyAndRecord(db, over);
  assert(r.status === 400 && !hasNullifier(db, "fixture", over.nullifier), "the (K+1)th post (slot " + K + "): " + JSON.stringify(r));
  return K + " posts in one window accepted, the next refused";
}
await check("C2 K = 4 per person per 6-hour window: four slots accepted, the fifth refused before anything is consumed", () => freshZk((Z) => kScenario(Z)), /the \(K\+1\)th post/);
await mutation("C2 / slots past K accepted", () => withPatchedValidator("zk.js", [["const isAnonSlot = (slot) => Number.isInteger(slot) && slot >= 0 && slot < anonPostSlots();", "const isAnonSlot = (slot) => Number.isInteger(slot) && slot >= 0 && slot < 99;"]], (Z) => kScenario(Z)));

async function lifetimeScenario(Z) {
  const db = openDb(":memory:");
  const a = new Identity("unit-life-" + Date.now() + Math.random());
  const w = world(db, "live", [a], Z);
  return withEnv({ ...AGENT_ENV(), ZK_ANON_POST_LIVE_CAP: "1" }, async () => {
    const r1 = await Z.verifyAndRecord(db, await liveEnvelope(w, a, 0));
    assert(r1.status === 200, "the first live post: " + JSON.stringify(r1));
    const e2 = await liveEnvelope(w, a, 1);
    const r2 = await Z.verifyAndRecord(db, e2);
    assert(r2.status === 503 && /ZK_ANON_POST_LIVE_CAP/.test(r2.json.error), "the second live post under cap 1: " + JSON.stringify(r2));
    assert(!hasNullifier(db, "live", e2.nullifier), "the capped live post consumed its nullifier");
    return "cap 1: the second live post refused 503, nothing consumed";
  });
}
await check("C3 the agent's LIFETIME cap is counted inside the insert transaction (real live proofs): cap 1 → the second post refused, nothing consumed", () => freshZk((Z) => lifetimeScenario(Z)), /the second live post under cap 1/);
await mutation("C3 / the lifetime cap not counted", () => withPatchedValidator("zk.js", [["if (lifetime !== null && n >= lifetime)", "if (false && lifetime !== null && n >= lifetime)"]], (Z) => lifetimeScenario(Z)));
function capRequiredScenario(P) {
  const env = { ...AGENT_ENV() };
  delete env.ZK_ANON_POST_LIVE_CAP;
  const a = P.relayAccount(env);
  assert(a.kind === "agent" && a.armed === false && a.problems.some((p) => /ZK_ANON_POST_LIVE_CAP is unset/.test(p)), "the agent path armed without a lifetime cap: " + JSON.stringify(a.problems));
  return "unarmed, naming the cap";
}
await check("C4 the agent path does not arm without an explicit lifetime cap", () => capRequiredScenario(vap));
await mutation("C4 / the cap not required", () => withPatchedValidator("anonpublic.js", [['    if (agentLifetimeCap(env) === null) problems.push("ZK_ANON_POST_LIVE_CAP is unset (the public relay needs an explicit lifetime cap)");\n', ""]], (P) => capRequiredScenario(P)), /armed without a lifetime cap/);

// PUBLIC GO-LIVE (ASM-1): on the fid-gated shape a live anon post proves the gated plain tree ONLY — a self-issued reach
// tree (first-come issuer registration, an anchor-signed issuance) would be a crowd of the poster's own making
async function gatedTreeScenario(Z) {
  const db = openDb(":memory:");
  const GATED = { ...AGENT_ENV(), ZK_ANON_FID_GATE: "on", APP_URL: "https://layers.example" };
  return withEnv(GATED, async () => {
    const ep = Z.epochInfo(db, "live").epoch;
    db.prepare("INSERT INTO zk_issuers (mode, id, display_name, schema_json, buckets_json, validity_epochs, pubkey, sig, registered_at) VALUES ('live', 'fc.reach', 'Self-issued', '{}', ?, 100, ?, 'x', 0)").run(JSON.stringify(["gte-1k", "gte-10k", "gte-100k"]), "cd".repeat(32));
    const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const attacker = new Identity("v1-attacker-" + tag);
    const reachers = [attacker, ...Array.from({ length: 49 }, (_, i) => new Identity("v1-reach-" + tag + "-" + i))];
    reachers.forEach((who, i) => {
      const rootId = "root_v1_" + tag + "_" + i;
      db.prepare("INSERT INTO roots (id, fid, signer_uuid, created_at) VALUES (?, ?, ?, 0)").run(rootId, 970000 + i, "v1-" + tag + "-" + i);
      db.prepare("INSERT INTO zk_registrations (mode, commitment, root_id, registered_at, epoch_registered, active_from_epoch) VALUES ('live', ?, ?, 0, ?, ?)").run(who.commitment.toString(10), rootId, ep - 1, ep);
      db.prepare("INSERT INTO zk_attestations (mode, issuer, bucket, commitment, claim_hash, issued_epoch, active_from_epoch, expires_epoch, revoked_from_epoch, sig, created_at) VALUES ('live', 'fc.reach', 'gte-1k', ?, ?, ?, ?, ?, NULL, 'x', 0)").run(who.commitment.toString(10), "ab".repeat(32), ep - 1, ep, ep + 100);
    });
    for (let i = 0; i < 110; i++) db.prepare("INSERT INTO zk_anon_fid_members (mode, fid, commitment, joined_epoch) VALUES ('live', ?, ?, ?)").run(860000 + i, new Identity("v1-crowd-" + tag + "-" + i).commitment.toString(10), ep - 1);
    const trees = Z.buildTrees(db, "live", ep);
    const tree = "attest:fc.reach/gte-1k";
    const reach = trees[tree];
    assert(reach && reach.members.length === 50, "furniture: the self-issued reach tree has " + (reach ? reach.members.length : "no") + " members");
    assert(trees.valid.members.length >= 100 && !trees.valid.members.includes(attacker.commitment.toString(10)), "furniture: the gated plain tree");
    const env = await liveEnvelope({ ep, root: String(reach.group.root ?? "0"), members: reach.members }, attacker, 0, "a post from a crowd of my own making " + tag, tree);
    const r = await Z.verifyAndRecord(db, env);
    assert(r.status === 400 && r.json.code === "gated-tree", "a live post into a self-issued reach tree on the gated shape: " + JSON.stringify(r));
    assert(!hasNullifier(db, "live", env.nullifier), "the refused post consumed its nullifier");
    return "refused 400 gated-tree before the nullifier (a real live proof into a 50-leaf self-issued tree)";
  });
}
await check("V1 on the fid-gated shape a live anon post into a SELF-ISSUED reach tree (50 leaves, the gated plain tree over 100) is refused before the nullifier (ASM-1)", () => freshZk((Z) => gatedTreeScenario(Z)), /self-issued reach tree/);
await mutation("V1 / the gated-tree guard removed", () => withPatchedValidator("zk.js", [["    if (gatedLiveTreeRefused(mode, p.tree)) {", "    if (false) {"]], (Z) => gatedTreeScenario(Z)), /a live post into a self-issued reach tree/);
function reachConfigScenario(Z, P) {
  return withEnv({ ZK_ANON_FID_GATE: "on" }, () => {
    assert(JSON.stringify(Z.anonReachIssuersFor("live")) === "[]", "a gated live universe offers reach issuers: " + JSON.stringify(Z.anonReachIssuersFor("live")));
    assert(JSON.stringify(Z.anonReachIssuersFor("fixture")) === JSON.stringify(["fc.reach", "x.reach"]), "the test universe lost its reach issuers");
    assert(P.issuerRegistrationRefusal("live", "fc.reach") && P.issuerRegistrationRefusal("live", "x.reach"), "a gated validator lets the reach ids be registered in the live universe");
    assert(P.issuerRegistrationRefusal("fixture", "fc.reach") === null && P.issuerRegistrationRefusal("live", "onchain.wallet-age") === null, "the refusal is wider than the reach ids in the live universe");
    return "live: no reach issuer, the ids reserved; fixture: unchanged";
  });
}
await check("V2 a gated validator's live config offers no reach issuer and the reach ids cannot be registered in its live universe; the test universe is unchanged (ASM-1)", () => reachConfigScenario(vz, vap));
await mutation("V2 / the reach ids first-come again in the live universe", () => withPatchedValidator("anonpublic.js", [['  if (mode === "live" && fidGateOn(env) && RESERVED_LIVE_ISSUERS.includes(String(id))) return', "  if (false) return"]], (P) => reachConfigScenario(vz, P)), /lets the reach ids be registered/);

console.log("\nF — the filter");
const FILTER_CASES = [
  ["a plain post", "a plain thought about the weather", null],
  ["the canary (a slur stand-in)", "words and layersfiltercanary here", "slur"],
  ["leetspeak", "l4yersf1ltercanary.", "slur"],
  ["a symbol swap", "so layersf!lterc@nary, then", "slur"],
  ["a swap that makes another word", "layersfiltercanary! (the ! is an i)", null],
  ["a NANP phone", "call (555) 123-4567 tonight", "phone"],
  ["an international phone", "ring +44 20 7946 0958", "phone"],
  ["a date is not a phone", "see you 2026-10-17 at 10:30", null],
  ["a big number is not a phone", "the price was 1000000000 wei", null],
  ["an email", "write to someone@example.com please", "email"],
  ["an ENS name is not an email", "gm @vitalik.eth and hi@dwr.eth", null],
  ["a street address", "they live at 221 Baker Street", "address"],
  ["a lower-case road is not an address", "I ran 5 miles down the road", null],
  ["a scam link", "claim at https://warpcast-airdrop.xyz/now", "scam-url"],
  ["a bare scam domain", "go to claim-coinbase.io today", "scam-url"],
  ["a brand's own site", "read warpcast.com/dwr and support.coinbase.com", null],
];
function fuzzCorpus() {
  let seed = 0x5eed4242;
  const rnd = (n) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % n);
  const benign = ["word ", "x", "見", "😀", " ", "é", "12", "-", ".", "(", ")", "+", "@", "ok "];
  const risky = ["layersfiltercanary", " (555) 123-4567 ", " +1 202 555 0143", " a@b.co ", " 10 Main Street ", " https://farcaster-airdrop.xyz ", " warpcast.com "];
  const out = [];
  for (let i = 0; i < 300; i++) {
    let s = "";
    const len = 1 + rnd(25);
    for (let j = 0; j < len; j++) s += rnd(12) === 0 ? risky[rnd(risky.length)] : benign[rnd(benign.length)];
    out.push(s);
  }
  return out;
}
const FUZZ = fuzzCorpus();
function filterParityScenario(validatorCheck, clientCheck) {
  let refusedN = 0;
  for (const [name, text, want] of FILTER_CASES) {
    const v = validatorCheck(text);
    const c = clientCheck(text);
    assert((v?.rule ?? null) === want, `${name}: the validator said ${JSON.stringify(v)}, want ${want}`);
    assert((c?.rule ?? null) === want, `${name}: the tab said ${JSON.stringify(c)}, want ${want}`);
    if (v) assert(v.sentence === c.sentence, `${name}: the two sentences differ`);
  }
  for (const text of FUZZ) {
    const v = validatorCheck(text);
    const c = clientCheck(text);
    assert(JSON.stringify(v) === JSON.stringify(c), `fuzz ${JSON.stringify(text).slice(0, 60)}: validator ${JSON.stringify(v)} ≠ tab ${JSON.stringify(c)}`);
    if (v) refusedN++;
  }
  assert(refusedN > 15 && refusedN < FUZZ.length - 15, "the fuzz corpus is one-sided (" + refusedN + " of " + FUZZ.length + " refused)");
  return `${FILTER_CASES.length} named + ${FUZZ.length} fuzz texts, the same answer on both sides (${refusedN} fuzz refused)`;
}
await check("F1 the validator's filter and the tab's give the same answer over one corpus, and each named case is what it must be", () => filterParityScenario((t) => vf.checkAnonFilter(t, {}), (t) => TC.anonFilterRefusal(t)));
for (const [rule, edits] of [
  ["slur", [["  for (const w of normalizedWords(text)) if (SLUR_HASHES.has(slurHash(w))) return { rule: \"slur\", sentence: RULE_BY_ID.slur.sentence };\n", ""]]],
  ["phone", [["  if (hasPhone(text)) return { rule: \"phone\", sentence: RULE_BY_ID.phone.sentence };\n", ""]]],
  ["email", [["  if (hasEmail(text)) return { rule: \"email\", sentence: RULE_BY_ID.email.sentence };\n", ""]]],
  ["address", [["  if (ADDRESS_RE.test(text)) return { rule: \"address\", sentence: RULE_BY_ID.address.sentence };\n", ""]]],
  ["scam-url", [["    if (BUILTIN_SCAM_RE.test(h)) return { rule: \"scam-url\", sentence: RULE_BY_ID[\"scam-url\"].sentence };\n", ""]]],
]) {
  await mutation(`F1 / the validator's ${rule} rule removed`, () => withPatchedValidator("anon-filter.js", edits, (F) => filterParityScenario((t) => F.checkAnonFilter(t, {}), (t) => TC.anonFilterRefusal(t))), new RegExp("the validator said null, want " + rule));
}
await mutation("F1 / the tab's phone rule removed", async () => {
  const T2 = await bundle(`export * from "@/lib/zk/anon/textCheck";\n`, {}, { "lib/zk/anon/textCheck.ts": [["  if (hasPhone(text)) return { rule: \"phone\", sentence: ANON_FILTER_SENTENCES.phone };\n", ""]] });
  return filterParityScenario((t) => vf.checkAnonFilter(t, {}), (t) => T2.anonFilterRefusal(t));
});
async function validatorFilterScenario(Z) {
  const db = openDb(":memory:");
  const a = new Identity("unit-filter-a");
  const w = world(db, "fixture", [a], Z);
  const bad = fixtureEnvelope(w, a, 0, "a post with layersfiltercanary in it");
  const r = await Z.verifyAndRecord(db, bad);
  assert(r.status === 400 && r.json.code === "filter" && r.json.rule === "slur", "the filtered post: " + JSON.stringify(r));
  assert(!hasNullifier(db, "fixture", bad.nullifier), "the filter's refusal consumed the nullifier");
  const log = db.prepare("SELECT * FROM zk_anon_filter_log").all().map((x) => ({ ...x }));
  assert(log.length === 1 && log[0].rule === "slur" && log[0].created_hour % 3_600_000 === 0 && Object.keys(log[0]).sort().join(",") === "created_hour,id,mode,rule", "the filter log: " + JSON.stringify(log));
  const good = fixtureEnvelope(w, a, 0, "the same slot with clean words");
  assert((await Z.verifyAndRecord(db, good)).status === 200, "the clean post in the same slot was refused");
  return "refused 400 before the nullifier; logged rule + hour only";
}
await check("F2 the validator refuses a filtered post before the nullifier is consumed and logs the rule and the hour only", () => freshZk((Z) => validatorFilterScenario(Z)), /the filtered post/);
await mutation("F2 / the validator's filter hook removed", () => withPatchedValidator("zk.js", [['const refusedBy = require("./anon-filter").checkAnonFilter(env.payload.text, process.env);', "const refusedBy = null;"]], (Z) => validatorFilterScenario(Z)));

console.log("\nP — reports");
function reportScenario(P) {
  const db = openDb(":memory:");
  const casts = [];
  for (let i = 0; i < P.REPORTS_PER_ADDRESS_PER_HOUR + 1; i++) {
    const h = createHash("sha256").update("rep|" + i).digest("hex");
    db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('fixture', ?, 'reportable', 0, 0, '0xr', 0, 'relayed')").run(h);
    casts.push(h);
  }
  const addr = "unit-address-" + Math.random();
  assert(P.report(db, { mode: "fixture", castHash: casts[0], reason: "because" }, addr).status === 400, "a reason off the list was taken");
  let last = null;
  for (const h of casts) last = P.report(db, { mode: "fixture", castHash: h, reason: "spam" }, addr);
  assert(last.status === 429, "past the per-address budget: " + JSON.stringify(last));
  const cols = db.prepare("PRAGMA table_info(zk_anon_reports)").all().map((c) => c.name).sort().join(",");
  assert(cols === "cast_hash,created_hour,id,mode,reason", "the reports table: " + cols);
  return P.REPORTS_PER_ADDRESS_PER_HOUR + " taken, the next 429; reasons fixed; no reporter column";
}
await check("P1 reports: a reason off the fixed list is refused, the per-address budget answers 429 past " + vap.REPORTS_PER_ADDRESS_PER_HOUR + " an hour, and nothing names the reporter", () => reportScenario(vap));
await mutation("P1 / the per-address budget removed", () => withPatchedValidator("anonpublic.js", [["  if (bucket.n >= REPORTS_PER_ADDRESS_PER_HOUR) return", "  if (false) return"]], (P) => reportScenario(P)));
await mutation("P1 / the fixed reasons not checked", () => withPatchedValidator("anonpublic.js", [["  if (!REPORT_REASONS.includes(reason)) return", "  if (false) return"]], (P) => reportScenario(P)));

console.log("\nT — takedowns");
const MOD = keypair();
const decision = (mode, castHash, d, k = MOD) => {
  const issuedHour = Math.floor(Date.now() / 3_600_000);
  const nonce = randomBytes(16).toString("hex");
  return { mode, castHash, decision: d, issuedHour, nonce, pubkey: k.pubHex, sig: signHex(vap.takedownCanonical(mode, castHash, d, issuedHour, nonce), k.privateKey) };
};
async function takedownScenario(P) {
  const db = openDb(":memory:");
  const env = { ...AGENT_ENV(), ANON_MODERATORS: MOD.pubHex };
  const acct = P.relayAccount(env);
  const sent = await P.anonTransport(acct, env).publish("a post to take down " + Math.random(), randomBytes(8).toString("hex"));
  const h = createHash("sha256").update("takedown|" + sent.hash).digest("hex");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('live', ?, 'a post to take down', 0, 0, ?, ?, 'relayed')").run(h, sent.hash, AGENT_FID);
  const from = stub.calls().length;
  const r = P.decide(db, decision("live", h, "remove"), { env });
  assert(r.status === 200 && r.json.deleteState === "pending", "remove: " + JSON.stringify(r));
  assert(P.oneCast(db, { mode: "live", hash: h }).status === 404, "a removed post is still readable");
  await P.deleteDue(db, env);
  await P.deleteDue(db, env);
  const dels = stub.calls().slice(from).filter((c) => c.op === "delete");
  assert(dels.length === 1 && dels[0].keyOk && dels[0].target === sent.hash, "deletes: " + JSON.stringify(dels));
  const row = db.prepare("SELECT hidden_at, text FROM zk_anon_casts WHERE cast_hash = ?").get(h);
  assert(row && row.hidden_at > 0 && row.text === "a post to take down", "the row was not KEPT hidden: " + JSON.stringify(row));
  assert(db.prepare("SELECT delete_state FROM zk_anon_takedowns WHERE cast_hash = ?").get(h).delete_state === "deleted");
  return "hidden at once, kept, one DELETE under the agent key";
}
await check("T1 REMOVE hides the post at once, keeps the row, and deletes it from Farcaster exactly ONCE through the agent signer", () => takedownScenario(vap));
await mutation("T1 / REMOVE does not hide", () => withPatchedValidator("anonpublic.js", [['    db.prepare("UPDATE zk_anon_casts SET hidden_at = ? WHERE mode = ? AND cast_hash = ? AND hidden_at IS NULL").run(decidedHour, mode, castHash);\n', ""]], (P) => takedownScenario(P)));
await mutation("T1 / a delete that never records its outcome (sent again next pass)", () => withPatchedValidator("anonpublic.js", [['db.prepare("UPDATE zk_anon_takedowns SET delete_state = ?, attempts = ? WHERE mode = \'live\' AND cast_hash = ? AND decision = \'remove\'").run(state, attempts, d.castHash);', "void state;"]], (P) => takedownScenario(P)));
function notModeratorScenario(P) {
  const db = openDb(":memory:");
  const h = createHash("sha256").update("not-mod").digest("hex");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('fixture', ?, 'x', 0, 0, '0xm', 0, 'relayed')").run(h);
  const stranger = keypair();
  const r = P.decide(db, decision("fixture", h, "remove", stranger), { env: { ANON_MODERATORS: MOD.pubHex } });
  assert(r.status === 403, "a key not in ANON_MODERATORS decided: " + JSON.stringify(r));
  assert(db.prepare("SELECT hidden_at FROM zk_anon_casts WHERE cast_hash = ?").get(h).hidden_at === null, "it was hidden anyway");
  return "403, nothing hidden";
}
await check("T2 a key that is not in ANON_MODERATORS is refused", () => notModeratorScenario(vap));
await mutation("T2 / the moderator list not checked", () => withPatchedValidator("anonpublic.js", [['  if (!mods.includes(pubkey)) return { status: 403, json: { error: "that key is not a moderator here" } };\n  if (!verifyEd25519(sig, takedownCanonical(', '  if (!verifyEd25519(sig, takedownCanonical(']], (P) => notModeratorScenario(P)));
async function clientSignedScenario(M) {
  const db = openDb(":memory:");
  const h = createHash("sha256").update("client-signed").digest("hex");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('fixture', ?, 'x', 0, 0, '0xc', 0, 'relayed')").run(h);
  const pub = await M.anonModeratorPublicKey();
  const seedHex = Buffer.from(M.anonModeratorSeedFor(VAULT_KEY)).toString("hex");
  assert(seedHex === Buffer.from(require("@noble/hashes/hkdf").hkdf(require("@noble/hashes/sha2").sha256, VAULT_KEY, new Uint8Array(0), new TextEncoder().encode("layers/anon-moderator/1"), 32)).toString("hex"), "the moderator seed is not the HKDF branch layers/anon-moderator/1");
  const signed = await M.signTakedown("fixture", h, "keep");
  const r = vap.decide(db, signed, { env: { ANON_MODERATORS: pub } });
  assert(r.status === 200, "a decision signed by the tab's moderation.ts: " + JSON.stringify(r));
  const review = await M.signAnonReview("fixture");
  const rv = vap.review(db, review, { env: { ANON_MODERATORS: pub } });
  assert(rv.status === 200, "a review signed by the tab: " + JSON.stringify(rv));
  return "the tab's signatures verify on the validator";
}
await check("T3 a decision and a review signed by the tab's lib/zk/anon/moderation.ts (HKDF branch layers/anon-moderator/1) verify on the validator", () => clientSignedScenario(MODC));
await mutation("T3 / the tab's takedown canonical drifted", async () => clientSignedScenario(await bundle(`export * from "@/lib/zk/anon/moderation";\n`, MOD_MOCKS, { "lib/zk/anon/moderation.ts": [['["layers-anon-takedown/1", mode, castHash, decision, String(issuedHour), String(nonce)]', '["layers-anon-takedown/2", mode, castHash, decision, String(issuedHour), String(nonce)]']] })), /does not verify/);
// PUBLIC GO-LIVE (ASM-4): the kill switch (ZK_ANON_RELAY_LIVE off: arm-public-anon.ps1 -Disarm) stops new posts, never a
// removal — a delete needs the agent's credential alone. Only with the key REVOKED (-Disarm -RevokeKey) do removals wait.
async function disarmedDeleteScenario(P) {
  const db = openDb(":memory:");
  const env = { ...AGENT_ENV(), ANON_MODERATORS: MOD.pubHex };
  const off = { ...env };
  delete off.ZK_ANON_RELAY_LIVE;
  const revoked = { ...off };
  delete revoked.FC_ANON_NEYNAR_KEY;
  delete revoked.FC_ANON_SIGNER_UUID;
  // 1. the switch off, the key kept: the delete goes at once, while the browser's live door stays shut
  const a = await P.anonTransport(P.relayAccount(env), env).publish("removed with the switch off " + Math.random(), randomBytes(8).toString("hex"));
  const ha = createHash("sha256").update("switched-off|" + a.hash).digest("hex");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('live', ?, 'removed with the switch off', 0, 0, ?, ?, 'relayed')").run(ha, a.hash, AGENT_FID);
  let from = stub.calls().length;
  assert(P.decide(db, decision("live", ha, "remove"), { env: off }).status === 200, "remove with the switch off was refused");
  await P.deleteDue(db, off);
  let dels = stub.calls().slice(from).filter((c) => c.op === "delete");
  assert(dels.length === 1 && dels[0].target === a.hash && dels[0].keyOk, "with the switch off the removal did not reach Farcaster (the kill switch stopped a delete): " + JSON.stringify(dels));
  assert(db.prepare("SELECT delete_state FROM zk_anon_takedowns WHERE cast_hash = ?").get(ha).delete_state === "deleted", "the switched-off delete was not recorded deleted");
  assert(P.liveWebDoorOpen(off) === false, "the browser's live door is open with the switch off");
  // 2. the key revoked: waiting, no attempt counted, no call; the key back (switch still off): one DELETE
  const sent = await P.anonTransport(P.relayAccount(env), env).publish("removed while revoked " + Math.random(), randomBytes(8).toString("hex"));
  const h = createHash("sha256").update("revoked|" + sent.hash).digest("hex");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('live', ?, 'removed while revoked', 0, 0, ?, ?, 'relayed')").run(h, sent.hash, AGENT_FID);
  from = stub.calls().length;
  assert(P.decide(db, decision("live", h, "remove"), { env: revoked }).status === 200, "remove with the key revoked was refused");
  for (let i = 0; i < P.DELETE_MAX_ATTEMPTS + 2; i++) await P.deleteDue(db, revoked);
  const t = db.prepare("SELECT delete_state, attempts FROM zk_anon_takedowns WHERE cast_hash = ?").get(h);
  assert(t.delete_state === "waiting" && t.attempts === 0, "revoked passes: " + JSON.stringify(t) + " (want waiting, 0 attempts)");
  assert(stub.calls().slice(from).filter((c) => c.op === "delete").length === 0, "a DELETE left a validator with no key");
  await P.deleteDue(db, off);
  dels = stub.calls().slice(from).filter((c) => c.op === "delete");
  assert(dels.length === 1 && dels[0].target === sent.hash, "the key back: " + JSON.stringify(dels));
  return "switch off: 1 DELETE at once; key revoked: waiting, 0 attempts, 0 calls; key back: 1 DELETE";
}
await check("T4 the kill switch never stops a removal (ASM-4): with ZK_ANON_RELAY_LIVE off the delete goes at once; with the key revoked it waits (no DELETE, no attempt counted, never a false 'unknown') and goes once the key is back", () => disarmedDeleteScenario(vap));
await mutation("T4 / deletes gated on the relay's switch again", () => withPatchedValidator("anonpublic.js", [["    const tr = deleteCredentialReady(acct, env) ? anonTransport(acct, env) : null;", "    const tr = relayReady(acct) ? anonTransport(acct, env) : null;"]], (P) => disarmedDeleteScenario(P)), /the kill switch stopped a delete/);
await mutation("T4 / keyless passes counted as attempts", () => withPatchedValidator("anonpublic.js", [["    if (!tr) {\n      db.prepare(\"UPDATE zk_anon_takedowns SET delete_state = 'waiting'", "    if (false) {\n      db.prepare(\"UPDATE zk_anon_takedowns SET delete_state = 'waiting'"]], (P) => disarmedDeleteScenario(P)), /revoked passes/);

console.log("\nG — the fid gate");
const viemAccounts = await import("viem/accounts");
const { createSiweMessage } = await import("viem/siwe");
const ACCT = viemAccounts.privateKeyToAccount("0x" + "44".repeat(32));
const chain = await startNeynarAnonStub({ key: STUB_KEY, custody: { [ACCT.address.toLowerCase()]: 7001 } });
const GATE_ENV = { ZK_ANON_FID_GATE: "on", APP_URL: "https://layers.example", ANON_FID_RPC_URL: chain.rpcUrl };
async function signedJoin(P, { fid = 7001, commitment, salt = randomBytes(16).toString("hex"), domain = "layers.example", uri = "https://layers.example/device", nonce }) {
  const message = createSiweMessage({ domain, address: ACCT.address, statement: "Farcaster Auth", uri, version: "1", chainId: 10, nonce: nonce ?? P.joinNonceFor(commitment, salt), issuedAt: new Date(), resources: ["farcaster://fid/" + fid] });
  return { mode: "live", fid, commitment, salt, authMethod: "custody", message, signature: await ACCT.signMessage({ message }) };
}
async function gateScenario(P) {
  P.__resetForTests();
  const db = openDb(":memory:");
  const c1 = new Identity("gate-1-" + Math.random()).commitment.toString(10);
  const c2 = new Identity("gate-2-" + Math.random()).commitment.toString(10);
  const j1 = await P.fidJoin(db, await signedJoin(P, { commitment: c1 }), GATE_ENV);
  assert(j1.status === 201, "the join: " + JSON.stringify(j1));
  const ep = vz.epochInfo(db, "live").epoch;
  assert(!P.fidGateMembers(db, "live", ep, GATE_ENV).includes(c1), "a join became a leaf in the CURRENT epoch");
  assert(JSON.stringify(P.fidGateMembers(db, "live", ep + 1, GATE_ENV)) === JSON.stringify([c1]), "the next epoch's members: " + JSON.stringify(P.fidGateMembers(db, "live", ep + 1, GATE_ENV)));
  db.prepare("UPDATE zk_anon_fid_members SET joined_epoch = joined_epoch - 2").run();
  const j2 = await P.fidJoin(db, await signedJoin(P, { commitment: c2 }), GATE_ENV);
  assert(j2.status === 201 && j2.json.replaced === true, "the newer sign-in: " + JSON.stringify(j2));
  assert(JSON.stringify(P.fidGateMembers(db, "live", ep + 1, GATE_ENV)) === JSON.stringify([c2]), "one commitment per fid, the newer one: " + JSON.stringify(P.fidGateMembers(db, "live", ep + 1, GATE_ENV)));
  return "joined from the next epoch; replaced by a newer sign-in; one per fid";
}
await check("G1 a verified sign-in joins one commitment per fid, a leaf from the NEXT epoch; a newer sign-in replaces it", () => gateScenario(vap));
await mutation("G1 / a join that is a leaf in its own epoch", () => withPatchedValidator("anonpublic.js", [["WHERE mode = 'live' AND joined_epoch < ? AND (left_epoch IS NULL", "WHERE mode = 'live' AND joined_epoch <= ? AND (left_epoch IS NULL"]], (P) => gateScenario(P)));
async function gateRefusalScenario(P) {
  P.__resetForTests();
  const db = openDb(":memory:");
  const c = new Identity("gate-ref-" + Math.random()).commitment.toString(10);
  const dom = await P.fidJoin(db, await signedJoin(P, { commitment: c, domain: "evil.example" }), GATE_ENV);
  assert(dom.json.code === "fid-join-message", "a foreign domain: " + JSON.stringify(dom));
  const uri = await P.fidJoin(db, await signedJoin(P, { commitment: c, uri: "https://evil.example/device" }), GATE_ENV);
  assert(uri.json.code === "fid-join-message", "a foreign URI: " + JSON.stringify(uri));
  const unbound = await P.fidJoin(db, await signedJoin(P, { commitment: c, nonce: "PlainRandomNonce" }), GATE_ENV);
  assert(unbound.json.code === "fid-join-message", "an unbound nonce: " + JSON.stringify(unbound));
  const body = await signedJoin(P, { commitment: c });
  assert((await P.fidJoin(db, body, GATE_ENV)).status === 201, "the honest join (control) was refused");
  const again = await P.fidJoin(db, body, GATE_ENV);
  assert(again.json.code === "fid-join-replay", "a replayed sign-in: " + JSON.stringify(again));
  return "domain, URI, nonce binding, replay: each refused; the honest join taken";
}
await check("G2 a foreign domain, a foreign URI, an unbound nonce and a replayed sign-in are each refused (the honest join is the control)", () => gateRefusalScenario(vap));
await mutation("G2 / the domain not checked", () => withPatchedValidator("anonpublic.js", [[' || m.domain !== site.host) return no(400, "message");', ') return no(400, "message");']], (P) => gateRefusalScenario(P)), /a foreign domain/);
await mutation("G2 / the URI not checked", () => withPatchedValidator("anonpublic.js", [['  if (uriOrigin !== site.origin) return no(400, "message");\n', ""]], (P) => gateRefusalScenario(P)), /a foreign URI/);
await mutation("G2 / the nonce binding not checked", () => withPatchedValidator("anonpublic.js", [['  if (m.nonce !== joinNonceFor(commitment, salt)) return no(400, "message");\n', ""]], (P) => gateRefusalScenario(P)), /an unbound nonce/);
await mutation("G2 / the replay not checked", () => withPatchedValidator("anonpublic.js", [['  if (seenJoinMessages.has(mh)) return no(409, "replay");\n', ""]], (P) => gateRefusalScenario(P)), /a replayed sign-in/);
function nonceParityScenario(F) {
  for (let i = 0; i < 50; i++) {
    const c = BigInt("0x" + randomBytes(31).toString("hex")).toString(10);
    const s = randomBytes(16).toString("hex");
    const a = vap.joinNonceFor(c, s);
    const b = F.joinNonceFor(c, s);
    assert(a === b && /^[A-Za-z0-9]{16}$/.test(a), "the two joinNonceFor differ: " + a + " ≠ " + b);
  }
  return "50 pairs equal, 16 base62 characters";
}
await check("G3 joinNonceFor is the same on the tab (lib/zk/anon/fcJoin.ts) and the validator", () => nonceParityScenario(FJ));
await mutation("G3 / the tab's join nonce drifted", async () => nonceParityScenario(await bundle(`export * from "@/lib/zk/anon/fcJoin";\n`, FJ_MOCKS, { "lib/zk/anon/fcJoin.ts": [['"layers-anon-fid-join/1|"', '"layers-anon-fid-join/2|"']] })));
// PRIV-LIVE-1: the crowd identity the join binds — Identity(HKDF-SHA256(zk master, "layers/anon-fid-tree/1")), the harness's
// own derivation (never the root identity's commitment, which is registered under the root)
const CROWD_MASTER = new Uint8Array(32).map((_, i) => (i * 11 + 9) & 255);
const crowdCommitmentOf = (master) => new Identity(require("@noble/hashes/hkdf").hkdf(require("@noble/hashes/sha2").sha256, master, new Uint8Array(0), new TextEncoder().encode("layers/anon-fid-tree/1"), 32)).commitment.toString(10);
await check("G4 the tab joins only for a sign-in whose nonce it bound — binding its CROWD identity's commitment, never the root's — records the validator's answer, and forgets nothing it did not start", async () => {
  FJ.resetFcJoin();
  globalThis.__FJM = CROWD_MASTER;
  globalThis.__FJC = new Identity(CROWD_MASTER).commitment.toString(10); // the ROOT identity's (lib/zk/identity.ts zkCommitment)
  const C = crowdCommitmentOf(CROWD_MASTER);
  assert(C !== globalThis.__FJC, "furniture: the crowd identity equals the root identity");
  globalThis.__FJP = [];
  const bound = await FJ.fcJoinNonce();
  assert(bound && bound.nonce === FJ.joinNonceFor(C, bound.salt), "the bound nonce does not bind the crowd commitment");
  await FJ.fcJoinAfterSignIn({ message: "m", signature: "s", fid: 5, authMethod: "custody", nonce: "SomeOtherNonce00" });
  assert(globalThis.__FJP.length === 0, "a sign-in it did not bind was sent");
  await FJ.fcJoinAfterSignIn({ message: "m", signature: "s", fid: 5, authMethod: "custody", nonce: bound.nonce });
  assert(globalThis.__FJP.length === 1 && globalThis.__FJP[0].commitment === C && globalThis.__FJP[0].salt === bound.salt, "the join sent: " + JSON.stringify(globalThis.__FJP));
  const st = FJ.fcJoinState(C);
  assert(st && st.registered === true && st.activeFromEpoch === 7, "the recorded state: " + JSON.stringify(st));
  return "bound → sent once → recorded";
});

// ASM-5 — leaving: the tab's signed leave (lib/zk/anon/fcJoin.ts signFidLeave, the crowd identity's own key) verifies on the
// validator, and from the next epoch the commitment is not a leaf
async function leaveScenario(P, F) {
  P.__resetForTests();
  F.resetFcJoin();
  globalThis.__FJM = CROWD_MASTER;
  const db = openDb(":memory:");
  const c = F.anonFidTreeCommitment();
  assert(c === crowdCommitmentOf(CROWD_MASTER), "the tab's crowd commitment is not the HKDF branch's identity");
  const ep = vz.epochInfo(db, "live").epoch;
  db.prepare("INSERT INTO zk_anon_fid_members (mode, fid, commitment, joined_epoch) VALUES ('live', 7101, ?, ?)").run(c, ep - 2);
  assert(P.fidGateMembers(db, "live", ep + 1, GATE_ENV).includes(c), "furniture: the joined commitment is not a leaf");
  const body = F.signFidLeave();
  assert(!JSON.stringify(body).includes(F.anonFidTreeSecretScalarForProver().toString(10)), "the leave carries the secret scalar");
  const r = P.fidLeave(db, body, GATE_ENV);
  assert(r.status === 200, "the tab's leave on the validator: " + JSON.stringify(r));
  assert(P.fidGateMembers(db, "live", ep, GATE_ENV).includes(c), "the leave changed the frozen current epoch");
  assert(!P.fidGateMembers(db, "live", ep + 1, GATE_ENV).includes(c), "after the leave the commitment is still a leaf of the next epoch");
  return "the tab's leave verified; not a leaf from the next epoch";
}
await check("G5 a leave signed by the tab's crowd identity verifies on the validator and the commitment is not a leaf from the next epoch (ASM-5)", () => leaveScenario(vap, FJ));
await mutation("G5 / the validator's tree ignores the leave", () => withPatchedValidator("anonpublic.js", [["AND (left_epoch IS NULL OR left_epoch > ?) ORDER BY", "AND (left_epoch IS NULL OR left_epoch > ? OR 1) ORDER BY"]], (P) => leaveScenario(P, FJ)), /still a leaf/);
await mutation("G5 / the tab's leave canonical drifted", async () => leaveScenario(vap, await bundle(`export * from "@/lib/zk/anon/fcJoin";\n`, FJ_MOCKS, { "lib/zk/anon/fcJoin.ts": [['["layers-anon-fid-leave/1", mode, commitment, String(issuedHour)]', '["layers-anon-fid-leave/2", mode, commitment, String(issuedHour)]']] })), /the tab's leave on the validator/);
// ASM-5 (final verify): a LIVE root revocation sends the crowd's leave FIRST (the crowd commitment is never registered, so a
// root revocation cannot reach it), and carries its answer; a fixture revocation sends none. lib/zk/registration.ts.
const REG_MOCKS = {
  ...SERVER_ONLY,
  "lib/identity/keystore": "export function deviceAuthPublicKey() { return 'pk'; } export function signAsDeviceAuth() { return 'sig'; } export function setZkIdentityIndex() {}",
  "lib/data": "export function getSelf() { return { fid: 1 }; }",
  "lib/zk/config": "export const VALIDATOR_URL = 'http://127.0.0.1:9'; export const ZK_MODE = 'fixture';",
  "lib/zk/identity": "export function zkCommitment() { return '42'; }",
  "lib/identity/rootRoster": "export async function rootForFid() { return 'root-1'; } export async function recordRoot() {}",
  "lib/validator": "export async function registerRoot() { return null; }",
  "lib/zk/validatorClient": "export async function postRegistration() { throw new Error('not here'); } export async function postRevocation(b) { (globalThis.__RGO ??= []).push('revoke:' + b.mode); return { status: 200, json: { revokedFromEpoch: 5 } }; }",
  "lib/zk/anon/fcJoin": "export async function fcLeaveCrowd() { (globalThis.__RGO ??= []).push('leave'); return globalThis.__RGL ?? { ok: true, status: 200, leftFromEpoch: 9, error: null }; }",
};
async function revokeLeaveScenario(R) {
  globalThis.__RGO = [];
  delete globalThis.__RGL;
  let r = await R.revokeCommitment("live");
  assert(JSON.stringify(globalThis.__RGO) === JSON.stringify(["leave", "revoke:live"]), "a live revocation's order: " + JSON.stringify(globalThis.__RGO));
  assert(r.ok === true && r.crowdLeave && r.crowdLeave.ok === true && r.crowdLeave.leftFromEpoch === 9, "the live revocation does not carry the leave's answer: " + JSON.stringify(r));
  // a refused leave never stops the revocation (it is said, never thrown)
  globalThis.__RGO = [];
  globalThis.__RGL = { ok: false, status: 404, leftFromEpoch: null, error: "not a member" };
  r = await R.revokeCommitment("live");
  assert(r.ok === true && r.crowdLeave && r.crowdLeave.ok === false && JSON.stringify(globalThis.__RGO) === JSON.stringify(["leave", "revoke:live"]), "a refused leave: " + JSON.stringify([r, globalThis.__RGO]));
  globalThis.__RGO = [];
  r = await R.revokeCommitment("fixture");
  assert(JSON.stringify(globalThis.__RGO) === JSON.stringify(["revoke:fixture"]) && r.crowdLeave === null, "a fixture revocation sent a leave: " + JSON.stringify([r, globalThis.__RGO]));
  return "live: leave, then revoke, the answer carried (refused: said, revocation unchanged); fixture: no leave";
}
// PRIV-LIVE-1 (final verify): a SERVER-SIDE live prover (lib/zk/transport/live.ts) proves a witness that declares the
// crowd identity with the crowd's master and checks the nullifier against the crowd's secret; every other witness is the
// root's. The prover child is faked (it records the job and answers a 7-point body, so self-verification refuses AFTER
// the nullifier check: "self-verification failed" means the nullifier matched the secret the check expects).
const LT_MOCKS = {
  ...SERVER_ONLY,
  "node:child_process": "import { EventEmitter } from 'node:events'; export function fork() { const c = new EventEmitter(); c.stderr = null; c.kill = () => {}; c.send = (job) => { (globalThis.__LTJOBS ??= []).push(job); setTimeout(() => c.emit('message', { ok: true, result: { proof: { merkleTreeDepth: 20, merkleTreeRoot: '555', nullifier: globalThis.__LTNULL, message: job.message, scope: job.scope, points: ['1','2','3','4','5','6','7'] }, ms: 1 } }), 0); }; return c; }",
  "lib/zk/artifacts": "export async function ensureArtifacts() { return { wasm: 'w', zkey: 'z' }; }",
  "lib/zk/ceremony": "export function loadPinnedVkey() { return {}; }",
  "lib/zk/config": "export const MERKLE_TREE_DEPTH = 20;",
  "lib/zk/identity": "export function zkMasterHexForProver() { return 'ROOT-MASTER'; } export function zkSecretScalarForProver() { return 111n; }",
  "lib/zk/anon/fcJoin": "export function anonFidTreeMasterHexForProver() { return 'CROWD-MASTER'; } export function anonFidTreeSecretScalarForProver() { return 222n; }",
  "lib/zk/nullifier": "export function nullifierFor(scope, secret) { return BigInt(secret) * 1000n + 7n; }",
};
async function liveProverScenario(L) {
  const pi = { mode: "live", claimKind: "anon-post", scope: "12345", message: "67890", merkleTreeRoot: "555" };
  const run = async (witness, nullifier) => {
    globalThis.__LTJOBS = [];
    globalThis.__LTNULL = nullifier;
    try {
      await L.liveTransport.prove("anon-post", pi, witness);
      return { job: globalThis.__LTJOBS[0], error: "no error" };
    } catch (e) {
      return { job: globalThis.__LTJOBS[0], error: String(e.message ?? e) };
    }
  };
  let r = await run({ members: ["1", "2"], identity: "anon-fid-tree" }, "222007");
  assert(r.job?.privateKeyHex === "CROWD-MASTER" && /self-verification failed/.test(r.error), "a crowd witness: " + JSON.stringify({ key: r.job?.privateKeyHex, error: r.error }));
  r = await run({ members: ["1", "2"], identity: "anon-fid-tree" }, "111007");
  assert(/formula drift/.test(r.error), "a crowd witness answered with the ROOT's nullifier was accepted: " + r.error);
  r = await run({ members: ["1", "2"] }, "111007");
  assert(r.job?.privateKeyHex === "ROOT-MASTER" && /self-verification failed/.test(r.error), "a witness that declares nothing: " + JSON.stringify({ key: r.job?.privateKeyHex, error: r.error }));
  r = await run({ members: ["1", "2"], identity: "root" }, "111007");
  assert(r.job?.privateKeyHex === "ROOT-MASTER" && /self-verification failed/.test(r.error), "a root witness: " + JSON.stringify({ key: r.job?.privateKeyHex, error: r.error }));
  return "crowd witness → the crowd's master and secret (the root's nullifier refused); undeclared and root → the root's";
}
const LT = await bundle(`export { liveTransport } from "@/lib/zk/transport/live";\n`, LT_MOCKS);
await check("G8 a server-side live prover proves a crowd witness with the crowd identity and checks its nullifier against the crowd's secret; every other witness is the root's (PRIV-LIVE-1)", () => liveProverScenario(LT));
await mutation("G8 / the server prover ignores the declared identity", async () => liveProverScenario(await bundle(`export { liveTransport } from "@/lib/zk/transport/live";\n`, LT_MOCKS, { "lib/zk/transport/live.ts": [["      privateKeyHex: crowd ? anonFidTreeMasterHexForProver() : zkMasterHexForProver(),", "      privateKeyHex: zkMasterHexForProver(),"]] })), /a crowd witness/);
await mutation("G8 / the nullifier is checked against the root's secret", async () => liveProverScenario(await bundle(`export { liveTransport } from "@/lib/zk/transport/live";\n`, LT_MOCKS, { "lib/zk/transport/live.ts": [["nullifierFor(scope, crowd ? anonFidTreeSecretScalarForProver() : zkSecretScalarForProver())", "nullifierFor(scope, zkSecretScalarForProver())"]] })), /a crowd witness/);
const REG = await bundle(`export { revokeCommitment } from "@/lib/zk/registration";\n`, REG_MOCKS);
await check("G7 a live root revocation sends the crowd's leave first and carries its answer; a fixture revocation sends none (ASM-5)", () => revokeLeaveScenario(REG));
await mutation("G7 / the revocation forgets the crowd", async () => revokeLeaveScenario(await bundle(`export { revokeCommitment } from "@/lib/zk/registration";\n`, REG_MOCKS, { "lib/zk/registration.ts": [['  if (mode === "live") crowdLeave = await (await import("./anon/fcJoin")).fcLeaveCrowd();\n', ""]] })), /order/);
await mutation("G7 / every universe leaves", async () => revokeLeaveScenario(await bundle(`export { revokeCommitment } from "@/lib/zk/registration";\n`, REG_MOCKS, { "lib/zk/registration.ts": [['  if (mode === "live") crowdLeave = await', "  if (true) crowdLeave = await"]] })), /fixture revocation sent a leave/);

// PRIV-LIVE-1 — the commitment a device joins the crowd with never appears in any /zk/register body from that device
const G6_MOCKS = {
  ...SERVER_ONLY,
  "lib/identity/keystore": [
    "export function zkMasterBytes() { return globalThis.__G6M; }",
    "export function zkMasterBytesFromSeedHex() { return globalThis.__G6M; }",
    "export function rootHandle() { return 'root-handle-g6'; }",
    "export function zkIdentityIndex() { return 0; }",
    "export function setZkIdentityIndex() {}",
    "export function zkIdentityPending() { return null; }",
    "export function setZkIdentityPending() {}",
    "export function deviceAuthPublicKey() { return 'aa'.repeat(32); }",
    "export function signAsDeviceAuth() { return 'bb'.repeat(64); }",
  ].join("\n"),
  "lib/data": "export function getSelf() { return { fid: 1 }; }",
  "lib/identity/rootRoster": "export async function rootForFid() { return 'root_g6'; } export async function recordRoot() {}",
  "lib/validator": "export async function registerRoot() { return 'root_g6'; }",
  "lib/zk/validatorClient": [
    "export async function postRegistration(b) { globalThis.__G6REG.push(b); return { status: 201, json: { ok: true, epochRegistered: 4, activeFromEpoch: 5 } }; }",
    "export async function postRevocation() { return { status: 200, json: { ok: true } }; }",
    "export async function postFidJoin(b) { globalThis.__G6JOIN.push(b); return { status: 201, json: { ok: true, activeFromEpoch: 5 } }; }",
  ].join("\n"),
};
const G6_ENTRY = `export * as reg from "@/lib/zk/registration";\nexport * as fj from "@/lib/zk/anon/fcJoin";\n`;
async function registerBodyScenario(M) {
  globalThis.__G6M = new Uint8Array(32).map((_, i) => (i * 13 + 5) & 255);
  globalThis.__G6REG = [];
  globalThis.__G6JOIN = [];
  M.fj.resetFcJoin();
  const reg = await M.reg.registerCommitment("live"); // what lib/zk/prefetch.ts startLiveUniverseAtBoot sends from every tab
  assert(reg.ok, "furniture: the registration: " + JSON.stringify(reg));
  const bound = await M.fj.fcJoinNonce();
  await M.fj.fcJoinAfterSignIn({ message: "m", signature: "s", fid: 42, authMethod: "custody", nonce: bound.nonce });
  const joined = globalThis.__G6JOIN.map((b) => b.commitment);
  const registered = globalThis.__G6REG.map((b) => b.commitment);
  assert(joined.length === 1 && registered.length === 1, "furniture: joins " + joined.length + ", registrations " + registered.length);
  assert(registered[0] === new Identity(globalThis.__G6M).commitment.toString(10), "furniture: the registration is not the root identity's commitment");
  assert(!registered.includes(joined[0]), "the commitment the crowd was joined with was also REGISTERED under the root (the validator could join fid -> commitment -> root): " + joined[0]);
  assert(joined[0] === crowdCommitmentOf(globalThis.__G6M), "the joined commitment is not Identity(HKDF(master, layers/anon-fid-tree/1))");
  return "joined " + joined[0].slice(0, 10) + "… ≠ registered " + registered[0].slice(0, 10) + "…";
}
await check("G6 the commitment a device joins the live crowd with (Farcaster) never appears in a /zk/register body from that device (PRIV-LIVE-1)", async () => registerBodyScenario(await bundle(G6_ENTRY, G6_MOCKS)));
await mutation("G6 / the join binds the registered root commitment again", async () => registerBodyScenario(await bundle(G6_ENTRY, G6_MOCKS, { "lib/zk/anon/fcJoin.ts": [["    const commitment = anonFidTreeCommitment();\n    if (typeof commitment", '    const commitment = (await import("@/lib/zk/identity")).zkCommitment();\n    if (typeof commitment']] })), /also REGISTERED under the root/);

// PRIV-LIVE-1 — which identity proves: the gated live plain tree by the crowd identity ONLY (prove.ts' membership step);
// the in-tab transport proves with the identity prove.ts declared
function membershipScenario(F) {
  const ROOT = "111111";
  const FID = "222222";
  const base = { mode: "live", tree: "valid", plainTree: "valid", rootCommitment: ROOT, fidCommitment: () => FID };
  let m = F.anonMembershipFor({ ...base, members: [ROOT], fidGate: true });
  assert(!m.ok && m.reason === F.ANON_FID_NOT_JOINED, "a gated live tree proved by the ROOT identity: " + JSON.stringify(m));
  m = F.anonMembershipFor({ ...base, members: [ROOT, FID], fidGate: true });
  assert(m.ok && m.identity === "anon-fid-tree" && m.commitment === FID, "gated, both leaves: " + JSON.stringify(m));
  m = F.anonMembershipFor({
    ...base,
    members: [ROOT],
    fidGate: true,
    fidCommitment: () => {
      throw new Error("no keystore");
    },
  });
  assert(!m.ok && /couldn't be read/.test(m.reason), "gated, an unreadable crowd identity fell back to the root: " + JSON.stringify(m));
  m = F.anonMembershipFor({ ...base, members: [ROOT], fidGate: undefined });
  assert(m.ok && m.identity === "root", "an older validator (no fidGate said): " + JSON.stringify(m));
  m = F.anonMembershipFor({ ...base, mode: "fixture", members: [FID, ROOT], fidGate: true });
  assert(m.ok && m.identity === "root", "the test universe: " + JSON.stringify(m));
  m = F.anonMembershipFor({ ...base, tree: "tier-2", members: [FID, ROOT], fidGate: true });
  assert(m.ok && m.identity === "root", "a tier tree: " + JSON.stringify(m));
  let asked = 0;
  const p0 = F.proverIdentityFor({ mode: "live", tree: "valid", plainTree: "valid", members: [ROOT, FID], rootCommitment: () => ROOT, fidCommitment: () => (asked++, FID) });
  assert(p0.identity === "root" && asked === 0, "undeclared with the root a leaf: " + JSON.stringify(p0) + " (crowd identity derived " + asked + "x)");
  const p1 = F.proverIdentityFor({ declared: "anon-fid-tree", mode: "live", tree: "valid", plainTree: "valid", members: [ROOT, FID], rootCommitment: () => ROOT, fidCommitment: () => FID });
  assert(p1.identity === "anon-fid-tree" && p1.commitment === FID, "declared crowd identity: " + JSON.stringify(p1));
  const p2 = F.proverIdentityFor({ mode: "live", tree: "valid", plainTree: "valid", members: [FID], rootCommitment: () => ROOT, fidCommitment: () => FID });
  assert(p2.identity === "anon-fid-tree", "undeclared, only the crowd identity a leaf: " + JSON.stringify(p2));
  return "gated: crowd only (never the root, not even on an unreadable keystore); elsewhere the root";
}
await check("G7 the gated live plain tree is proved by the crowd identity ONLY — never the root's, even when the root is a leaf there or the crowd identity is unreadable; every other tree by the root's (PRIV-LIVE-1)", () => membershipScenario(FJ));
await mutation("G7 / a gated tree falls back to the root identity", async () => membershipScenario(await bundle(`export * from "@/lib/zk/anon/fcJoin";\n`, FJ_MOCKS, { "lib/zk/anon/fcJoin.ts": [["    if (o.fidGate === true) return { ok: false, reason: unreadable ?", "    if (false) return { ok: false, reason: unreadable ?"]] })), /proved by the ROOT identity/);
const BT_MOCKS = { ...SERVER_ONLY, "lib/identity/keystore": "export function zkMasterBytes() { return globalThis.__FJM; }", "lib/zk/validatorClient": "export async function postFidJoin() { return { status: 500, json: null }; } export async function postFidLeave() { return { status: 500, json: null }; }", "lib/zk/identity": "export function zkCommitment() { return globalThis.__FJC; } export function zkSecretScalarForProver() { return 1n; }" };
const BT_ENTRY = `export * from "@/lib/zk/transport/browser";\n`;
async function transportIdentityScenario(B) {
  globalThis.__FJM = CROWD_MASTER;
  globalThis.__FJC = new Identity(CROWD_MASTER).commitment.toString(10);
  const C = crowdCommitmentOf(CROWD_MASTER);
  const hadWorker = Object.prototype.hasOwnProperty.call(globalThis, "Worker");
  const prevWorker = globalThis.Worker;
  delete globalThis.Worker; // a job past the membership check then refuses for want of a worker, never "not a member"
  const pub = { mode: "live", claimKind: "anon-post", tree: "valid", epoch: 1, merkleTreeRoot: "1", scope: "1", message: "1", personaId: "anon", gateId: "anon-post", challenge: "epoch-1" };
  const tryProve = async (witness) => {
    try {
      await B.browserTransport("live").prove("anon-post", pub, witness);
      return "PROVED";
    } catch (e) {
      return e.message;
    }
  };
  try {
    const crowd = await tryProve({ members: [C], identity: "anon-fid-tree" });
    assert(!/not a member/.test(crowd) && [B.NO_WORKER, B.PROVER_NOT_LOADED, B.FILES_NOT_LOADED].includes(crowd), "the crowd identity's leaf was refused by the transport: " + crowd);
    const root = await tryProve({ members: [C], identity: "root" });
    assert(/not a member/.test(root), "the root identity proved a tree it is not a leaf of: " + root);
    return "crowd identity: past membership (then no worker); root on the same tree: not a member";
  } finally {
    if (hadWorker) globalThis.Worker = prevWorker;
  }
}
await check("G8 the in-tab transport proves the live plain tree with the identity prove.ts declared — the crowd identity's leaf passes, the root's is refused there (PRIV-LIVE-1)", async () => transportIdentityScenario(await bundle(BT_ENTRY, BT_MOCKS)));
await mutation("G8 / the transport proves with the root identity whatever was declared", async () => transportIdentityScenario(await bundle(BT_ENTRY, BT_MOCKS, { "lib/zk/transport/browser.ts": [["      const commitment = pick.commitment;", "      const commitment = zkCommitment();"]] })), /refused by the transport/);

console.log("\nK — the kill switches");
async function validatorKillScenario(P) {
  const on = P.relayAccount(AGENT_ENV());
  assert(P.relayReady(on) === true, "armed is not ready");
  const env = { ...AGENT_ENV() };
  delete env.ZK_ANON_RELAY_LIVE;
  const off = P.relayAccount(env);
  assert(P.relayReady(off) === false && P.liveWebDoorOpen(env) === false, "with the switch removed the relay is still ready");
  const cfg = await withEnv({ ...AGENT_ENV(), ZK_ANON_RELAY_LIVE: undefined }, () => vapi("GET", "/zk/anon-post/config?mode=live"));
  assert(cfg.json?.liveRelay === false, "the config still says liveRelay: " + JSON.stringify(cfg.json));
  return "switch removed: not ready, the browser door shut, config liveRelay false";
}
await check("K1 the validator's kill switch: ZK_ANON_RELAY_LIVE removed → the relay is not ready, the browser's live door is shut, the config says liveRelay false (and R1: nothing posts)", () => validatorKillScenario(vap));
await mutation("K1 / readiness ignoring the arming", () => withPatchedValidator("anonpublic.js", [[": !!(acct.fid && acct.signerUuid && acct.apiKey && acct.armed && !acct.foreignSigner));", ": !!(acct.fid && acct.signerUuid && acct.apiKey && !acct.foreignSigner));"]], (P) => validatorKillScenario(P)));

console.log("\nA — the tab");
const COMMIT = "424242";
const CROWD = Array.from({ length: 60 }, (_, i) => String(1000 + i));
const liveSnap = (members, liveRelay = true) => ({ mode: "live", tree: "valid", fetchedAt: Date.now(), epoch: { epoch: 100, epochMs: 6 * 3_600_000, msRemaining: 3_600_000 }, members: { members }, anonConfig: { liveRelay, tree: "valid" } });
async function tabScenario(A2) {
  globalThis.__AVR = "mock";
  return asBrowser(() => withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_UNIVERSE: undefined, PUBLIC_LIVE: undefined, ZK_ANON_FLOOR: undefined }, async () => {
    // no hint: today's words, whatever the snapshot says
    let a = A2.anonPostingAvailability({ mode: "live", snap: liveSnap([...CROWD, COMMIT]), commitment: COMMIT });
    assert(!a.on && a.reason === A2.ANON_OFF_BROWSER_LIVE && a.scope === "deployment", "no hint: " + JSON.stringify(a));
    a = A2.anonPostingAvailability({ mode: "live" });
    assert(!a.on && a.reason === A2.ANON_OFF_BROWSER_LIVE, "no hint, the gate's call: " + JSON.stringify(a));
    await withEnv({ ZK_ANON_UNIVERSE: "live" }, async () => {
      // hint, relay unarmed at the last check: today's words
      a = A2.anonPostingAvailability({ mode: "live", snap: liveSnap([...CROWD, COMMIT], false), commitment: COMMIT });
      assert(!a.on && a.reason === A2.ANON_OFF_BROWSER_LIVE, "hint, relay unarmed: " + JSON.stringify(a));
      a = A2.anonPostingAvailability({ mode: "live", liveRelay: false });
      assert(!a.on && a.reason === A2.ANON_OFF_BROWSER_LIVE, "hint, the gate's call, relay unarmed: " + JSON.stringify(a));
      // no check yet: checking
      a = A2.anonPostingAvailability({ mode: "live", snap: null, commitment: COMMIT });
      assert(!a.on && a.code === "checking", "hint, no check yet: " + JSON.stringify(a));
      // armed: a leaf of a crowd over the floor is ON and NOT preview-only
      a = A2.anonPostingAvailability({ mode: "live", snap: liveSnap([...CROWD, COMMIT]), commitment: COMMIT });
      assert(a.on && a.previewOnly === false, "hint + armed + a leaf: " + JSON.stringify(a));
      a = A2.anonPostingAvailability({ mode: "live", liveRelay: true });
      assert(a.on && a.previewOnly === false, "hint + armed, the gate's call: " + JSON.stringify(a));
      // not a leaf: sign in with Farcaster first; joined: the time it opens
      a = A2.anonPostingAvailability({ mode: "live", snap: liveSnap(CROWD), commitment: COMMIT });
      assert(!a.on && a.reason === A2.ANON_LIVE_SIGN_IN_FIRST && a.code === "crowd", "not a leaf: " + JSON.stringify(a));
      // PUBLIC GO-LIVE (onboard F2): signed in with Farcaster, no join known in this tab (a reload forgets the join's outcome)
      a = A2.anonPostingAvailability({ mode: "live", snap: liveSnap(CROWD), commitment: COMMIT, signedIn: true });
      assert(!a.on && a.reason === A2.ANON_LIVE_MAYBE_JOINED && a.code === "crowd" && a.availableFrom === undefined, "signed in, no join known: " + JSON.stringify(a));
      a = A2.anonPostingAvailability({ mode: "live", snap: liveSnap(CROWD), commitment: COMMIT, signedIn: false });
      assert(!a.on && a.reason === A2.ANON_LIVE_SIGN_IN_FIRST, "not signed in (false): " + JSON.stringify(a));
      // a known failed join still says it failed, signed in or not
      a = A2.anonPostingAvailability({ mode: "live", snap: liveSnap(CROWD), commitment: COMMIT, signedIn: true, join: { registered: false, activeFromEpoch: null, error: "refused" } });
      assert(!a.on && a.reason === A2.ANON_LIVE_JOIN_FAILED, "signed in, a failed join: " + JSON.stringify(a));
      a = A2.anonPostingAvailability({ mode: "live", snap: liveSnap(CROWD), commitment: COMMIT, join: { registered: true, activeFromEpoch: 101, error: null }, timeText: () => "2:00 PM" });
      assert(!a.on && /^You've joined the anonymous crowd with Farcaster, and you can post anonymously from 2:00 PM/.test(a.reason) && typeof a.availableFrom === "number", "joined: " + JSON.stringify(a));
      // a crowd under the floor
      a = A2.anonPostingAvailability({ mode: "live", snap: liveSnap(["1", COMMIT]), commitment: COMMIT });
      assert(!a.on && /opens once at least 50 people/.test(a.reason), "under the floor: " + JSON.stringify(a));
      // the app's kill switch wins over everything
      await withEnv({ ZK_ANON_POST: "off" }, async () => {
        const k = A2.anonPostingAvailability({ mode: "live", snap: liveSnap([...CROWD, COMMIT]), commitment: COMMIT });
        assert(!k.on && k.reason === A2.ANON_OFF_SWITCH, "ZK_ANON_POST=off: " + JSON.stringify(k));
      });
    });
    // PUBLIC_LIVE: the test universe is off in a tab; without it the preview stays as it was
    await withEnv({ PUBLIC_LIVE: "true" }, async () => {
      const p = A2.anonPostingAvailability({ mode: "fixture" });
      assert(!p.on && p.reason === A2.ANON_OFF_LIVE_PRODUCT_TEST, "PUBLIC_LIVE, test universe: " + JSON.stringify(p));
      // PUBLIC GO-LIVE (onboard F11): the live site's own words for an unarmed relay (never "this preview")
      await withEnv({ ZK_ANON_UNIVERSE: "live" }, async () => {
        const r = A2.anonPostingAvailability({ mode: "live", liveRelay: false });
        assert(!r.on && r.reason === A2.ANON_OFF_LIVE_RELAY_OFF && r.scope === "deployment" && !/preview/.test(r.reason), "PUBLIC_LIVE, live hint, relay unarmed: " + JSON.stringify(r));
      });
    });
    const prev = A2.anonPostingAvailability({ mode: "fixture" });
    assert(prev.on && prev.previewOnly === true, "the preview's test universe changed: " + JSON.stringify(prev));
    return "no hint / unarmed: today's words; armed: on, not preview-only; sign-in, join and floor sentences; PUBLIC_LIVE: test off; ZK_ANON_POST=off wins";
  }));
}
await check("A1 a tab posts live ONLY with the app's hint AND the last tick's liveRelay; otherwise today's ANON_OFF_BROWSER_LIVE; armed it is not preview-only; PUBLIC_LIVE turns the test universe off; ZK_ANON_POST=off wins", () => tabScenario(AV));
await mutation("A1 / the hint not required", async () => tabScenario(await bundle(`export * from "@/lib/zk/anon/availability";\n`, AV_MOCKS, { "lib/zk/anon/availability.ts": [['      if (mode === "live" && liveUniverseHinted() && (o.liveRelay === true || liveRelayIn(o.snap))) {', '      if (mode === "live" && (o.liveRelay === true || liveRelayIn(o.snap))) {']] })), /^no hint/);
await mutation("A1 / the relay's arming not required", async () => tabScenario(await bundle(`export * from "@/lib/zk/anon/availability";\n`, AV_MOCKS, { "lib/zk/anon/availability.ts": [['      if (mode === "live" && liveUniverseHinted() && (o.liveRelay === true || liveRelayIn(o.snap))) {', '      if (mode === "live" && liveUniverseHinted()) {']] })), /relay unarmed/);
await mutation("A1 / the app's kill switch ignored", async () => tabScenario(await bundle(`export * from "@/lib/zk/anon/availability";\n`, AV_MOCKS, { "lib/zk/anon/availability.ts": [['    if (sw === "off") return off("deployment", ANON_OFF_SWITCH,', '    if (false) return off("deployment", ANON_OFF_SWITCH,']] })), /ZK_ANON_POST=off/);
await mutation("A1 / PUBLIC_LIVE not honoured", async () => tabScenario(await bundle(`export * from "@/lib/zk/anon/availability";\n`, AV_MOCKS, { "lib/zk/anon/availability.ts": [["      if (publicLiveHere()) return off(", "      if (false) return off("]] })), /PUBLIC_LIVE, test universe/);
await mutation("A1 (F2) / the signed-in sentence dropped", async () => tabScenario(await bundle(`export * from "@/lib/zk/anon/availability";\n`, AV_MOCKS, { "lib/zk/anon/availability.ts": [["  if (o.signedIn === true) return off(", "  if (false) return off("]] })), /signed in, no join known/);
await mutation("A1 (F2) / the signed-in sentence said before a known failed join", async () => tabScenario(await bundle(`export * from "@/lib/zk/anon/availability";\n`, AV_MOCKS, { "lib/zk/anon/availability.ts": [["  if (j && typeof j.error === \"string\" && j.error) return off(\"now\", ANON_LIVE_JOIN_FAILED,", "  if (o.signedIn !== true && j && typeof j.error === \"string\" && j.error) return off(\"now\", ANON_LIVE_JOIN_FAILED,"]] })), /a failed join/);
await mutation("A1 (F11) / the live site says 'preview' again", async () => tabScenario(await bundle(`export * from "@/lib/zk/anon/availability";\n`, AV_MOCKS, { "lib/zk/anon/availability.ts": [["          publicLiveHere() ? ANON_OFF_LIVE_RELAY_OFF : ANON_OFF_BROWSER_LIVE,", "          ANON_OFF_BROWSER_LIVE,"]] })), /relay unarmed/);
async function submitScenario(S) {
  delete globalThis.__layersZkPrefetch;
  await withEnv({ ZK_ANON_UNIVERSE: undefined }, async () => {
    globalThis.__layersZkPrefetch = { snapshots: { live: { mode: "live", anonConfig: { liveRelay: true } } } };
    assert(S.liveEnvelopeMayLeaveTab() === false, "no hint: a live envelope may leave");
  });
  await withEnv({ ZK_ANON_UNIVERSE: "live" }, async () => {
    globalThis.__layersZkPrefetch = { snapshots: { live: { mode: "live", anonConfig: { liveRelay: false } } } };
    assert(S.liveEnvelopeMayLeaveTab() === false, "hint, relay unarmed: a live envelope may leave");
    globalThis.__layersZkPrefetch = { snapshots: {} };
    assert(S.liveEnvelopeMayLeaveTab() === false, "hint, no check yet: a live envelope may leave");
    globalThis.__layersZkPrefetch = { snapshots: { live: { mode: "live", anonConfig: { liveRelay: true } } } };
    assert(S.liveEnvelopeMayLeaveTab() === true, "hint + armed: a live envelope may NOT leave");
  });
  delete globalThis.__layersZkPrefetch;
  return "only hint + armed";
}
await check("A2 a live envelope leaves a tab only with the hint AND the last tick's liveRelay: true", () => submitScenario(SUB));
await mutation("A2 / the tab's live door always open", async () => submitScenario(await bundle(`export { liveEnvelopeMayLeaveTab } from "@/lib/zk/anon/submit";\n`, SERVER_ONLY, { "lib/zk/anon/submit.ts": [["  if (!liveUniverseHinted()) return false;\n", "  return true;\n"]] })));
function hintScenario(U) {
  assert(JSON.stringify(U.anonUniverseHints({})) === "{}", "unset forwards something");
  assert(JSON.stringify(U.anonUniverseHints({ ZK_ANON_UNIVERSE: " LIVE " })) === JSON.stringify({ ZK_ANON_UNIVERSE: "live", ZK_MODE: "live" }), "live: " + JSON.stringify(U.anonUniverseHints({ ZK_ANON_UNIVERSE: "live" })));
  const junk = U.anonUniverseHints({ ZK_ANON_UNIVERSE: "https://evil.example/?k=SECRET" });
  assert(JSON.stringify(junk) === JSON.stringify({ ZK_ANON_UNIVERSE: "invalid" }), "a junk value was forwarded: " + JSON.stringify(junk));
  assert(U.liveUniverseHinted({ ZK_ANON_UNIVERSE: "invalid" }) === false && U.liveUniverseHinted({ ZK_ANON_UNIVERSE: "live" }) === true);
  return "checked names and values only";
}
await check("A3 the app's hint forwards only checked names and values (live → ZK_MODE=live; anything else → invalid, read as not live)", () => hintScenario(UNI));
await mutation("A3 / the raw value forwarded", async () => hintScenario(await bundle(`export * from "@/lib/zk/anon/universe";\n`, {}, { "lib/zk/anon/universe.ts": [['  return { ZK_ANON_UNIVERSE: "invalid" };', "  return { ZK_ANON_UNIVERSE: String(env.ZK_ANON_UNIVERSE) };"]] })));
function destinationScenario(U) {
  const base = { on: true, previewOnly: false, mode: "live", host: "tab", liveRelay: true, reason: null, withinMinutes: 75 };
  let d = U.anonDestinationFor(base);
  assert(d.destination === "farcaster" && d.destinationSentence === U.DESTINATION_FARCASTER && /within about 75 minutes/.test(d.postedSentence), "armed live: " + JSON.stringify(d));
  d = U.anonDestinationFor({ ...base, liveRelay: false });
  assert(d.destination === "off" && d.postedSentence === null, "live, relay unarmed: " + JSON.stringify(d));
  d = U.anonDestinationFor({ ...base, mode: "fixture", previewOnly: true });
  assert(d.destination === "layers" && d.destinationSentence === U.DESTINATION_LAYERS_PREVIEW && /Nothing is posted to Farcaster/.test(d.destinationSentence), "the preview: " + JSON.stringify(d));
  d = U.anonDestinationFor({ ...base, on: false, reason: "Anonymous posting is switched off on this site." });
  assert(d.destination === "off" && d.destinationSentence === "Anonymous posting is switched off on this site.", "off: " + JSON.stringify(d));
  return "farcaster only when armed; layers says nothing reaches Farcaster; off carries the reason";
}
await check("A4 where a post goes, in words: farcaster only when live AND armed; the preview says it stays in Totem; off carries availability's reason", () => destinationScenario(UNI));
await mutation("A4 / farcaster without the relay's arming", async () => destinationScenario(await bundle(`export * from "@/lib/zk/anon/universe";\n`, {}, { "lib/zk/anon/universe.ts": [['  if (o.mode === "live" && o.liveRelay === true && !o.previewOnly)', '  if (o.mode === "live" && !o.previewOnly)']] })));

console.log("\nL — what a tab tells the validator, and when");
const NEXT_SERVER = { "next/server": "export class NextRequest {}\nexport const NextResponse = { json: (body, init) => ({ status: (init && init.status) || 200, body }) };" };
// PRIV-LIVE-2: a TAB's status read of a refused post never sends the device-signed config read that names the post
const ROUTE_MOCKS = {
  ...SERVER_ONLY,
  ...NEXT_SERVER,
  "lib/zk/config": "export const VALIDATOR_URL = 'http://validator.p2.test'; export const ZK_PREFETCH_MS = 600000; export const ZK_JITTER_MAX_MS = 1000; export const ZK_ANON_POST_SLOTS = 4; export function zkMode() { return 'live'; }",
  "lib/adapters/mock/persist": "export async function signedReadHeaders() { return { 'x-layers-device': 'dev-p2', 'x-layers-sig': 'sig-p2' }; }",
  "lib/zk/anon/queue": "export async function anonPostItems() { return globalThis.__P2ITEMS; } export async function attributionRecord() { return null; } export async function attributionCastHashes() { return []; } export async function anonPostsAhead() { return 0; }",
  "lib/zk/gate": "export function wantedAnonPosts() { return []; } export function anonPostTree() { return 'valid'; } export function anonWindowHours() { return 6; } export async function requestAnonPost() { return { ok: false }; } export function reachOfferInputFor() { return {}; } export function launchRevealSentence() { return ''; }",
  "lib/zk/prefetch": "export function cachedSnapshot() { return null; } export async function prefetchTick() {} export function ensurePrefetchLoop() {}",
  "lib/zk/anon/outcomes": "export function anonOutcome() { return null; } export function anonOutcomes() { return []; }",
  "lib/zk/anon/universe": "export function castUrlFor() { return null; } export function anonDestinationFor() { return {}; }",
  "lib/zk/anon/availability": "export const ANON_PREVIEW_SENTENCE = 'preview'; export const ANON_OFF_TREE_MISMATCH = 'mismatch'; export function anonPostingAvailability() { return { on: false }; }",
  "lib/zk/anon/fcJoin": "export function fcJoinState() { return null; } export function anonFidTreeCommitment() { return '0'; } export async function fcLeaveCrowd() { return { ok: false }; }",
  "lib/zk/anon/relayAccount": "export const SEED_SELF_FID = 9152; export function relayJoinRefusesPosting() { return false; } export function relayAccountVerdict() { return {}; }",
  "lib/zk/anon/slots": "export function relayCapReason() { return null; }",
  "lib/zk/anonAttribution": "export async function revealableCastHashes() { return []; } export async function revealAttribution() { return { ok: false }; }",
  "lib/zk/identity": "export function zkCommitment() { return '0'; }",
  "lib/zk/privacy": "export async function privacyConditions() { return { conditions: [] }; } export async function ownIdentityFacts() { return {}; }",
  "lib/zk/registration": "export async function registerCommitment() { return { ok: false, status: 0 }; }",
  "lib/fc/siwf/links": "export async function mainLink() { return null; } export async function xLink() { return null; }",
  "lib/adapters/mock/store": "export async function hydrate() {} export function state() { return { zkQueue: new Map() }; }",
  "lib/identity/postMode": "export async function defaultPostingPersonaId() { return null; } export function isOwnPostingPersona() { return false; } export async function anonPersonaRefusal() { return null; } export function handleOfPersona() { return null; } export async function postModeView() { return {}; }",
  "lib/launch/confirm": "export async function launchUnderWay() { return false; }",
  "lib/reach/held": "export async function refreshHeldReach() { return {}; }",
  "lib/reach/trees": "export function offeredAnonTrees() { return { offered: [] }; }",
  "lib/rings/model": "export async function ringsSeeingPosts() { return []; }",
  "lib/world-flag": "export function isOwnerService() { return false; } export function isEmptyWorld() { return false; }",
};
const ROUTE_ENTRY = `export * from "@/app/api/anon/route";\n`;
async function tabRefusalReadScenario(R) {
  const h = createHash("sha256").update("p2|" + Math.random()).digest("hex");
  globalThis.__P2ITEMS = [{ id: "zka_" + h, castHash: h, status: "sent", outcome: "refused", epoch: 3, notBefore: 0, sentAt: Date.now(), personaId: null }];
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), headers: { ...(init.headers || {}) } });
    return new Response(JSON.stringify({ tree: "valid", lastRefusal: { reason: "groth16 verification failed", at: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const signed = () => seen.filter((x) => x.headers["x-layers-device"] || x.headers["x-layers-sig"]);
  try {
    const req = { nextUrl: new URL("http://x/api/anon?castHash=" + h) };
    // CONTROL: a server-side device makes its signed read (so the check below can see one)
    const srv = await R.GET(req);
    assert(signed().length === 1 && signed()[0].url.includes("castHash=" + h) && srv.body.validatorRefusal, "control: the server-side device did not make its signed read: " + JSON.stringify(seen));
    seen.length = 0;
    const tab = await asBrowser(() => R.GET(req));
    assert(signed().length === 0, "a TAB's status read of a refused post sent a device-signed request naming it: " + JSON.stringify(signed().map((x) => x.url)));
    assert(tab.body.host === "tab" && tab.body.validatorRefusal === null, "the tab's answer: " + JSON.stringify(tab.body).slice(0, 240));
    return "server: 1 signed read; tab: none (the generic refusal line)";
  } finally {
    globalThis.fetch = realFetch;
  }
}
await check("P2 a TAB's status read of a refused post sends NO device-signed request naming it (a server-side device still reads its reason) (PRIV-LIVE-2)", async () => tabRefusalReadScenario(await bundle(ROUTE_ENTRY, ROUTE_MOCKS)));
await mutation("P2 / the host condition dropped", async () => tabRefusalReadScenario(await bundle(ROUTE_ENTRY, ROUTE_MOCKS, { "app/api/anon/route.ts": [['    if (reads && host === "server" && item && item.status === "sent" && item.outcome === "refused") {', '    if (reads && item && item.status === "sent" && item.outcome === "refused") {']] })), /a TAB's status read/);

// PRIV-LIVE-3: the live crowd's join is sent only after record() SEALED the sign-in
const FLOW_MOCKS = {
  ...SERVER_ONLY,
  "lib/qr": "export function qrSvgPath() { return { viewBox: 1, path: '' }; }",
  "lib/world-flag": "export function isEmptyWorld() { return false; } export function isOwnerService() { return false; }",
  "lib/identity/keystore": [
    "export function isLinkedDevice() { return false; }",
    "export const FIXTURE_SIWF_NONCE_PREFIX = 'fixture-siwf:';",
    "export function listPersonas() { return globalThis.__FLP; }",
    "export function getPersona(id) { return globalThis.__FLP.find((p) => p.id === id) ?? null; }",
    "export function createPersona(o) { const p = { id: 'p_' + globalThis.__FLP.length, createdAt: 0, ...o }; globalThis.__FLP.push(p); return p; }",
    "export function updatePersona(id, o) { const p = globalThis.__FLP.find((x) => x.id === id); if (p) Object.assign(p, o); return p ?? null; }",
  ].join("\n"),
  // SIGN IN WITH X: the record also answers xLink() (none here: this root never signed in with X)
  "lib/fc/siwf/links": "export async function mainLink() { return globalThis.__FLL ?? null; } export async function xLink() { return null; } export async function updateAccountLinks(fn) { const doc = fn({ v: 1, links: globalThis.__FLL ? [globalThis.__FLL] : [] }); globalThis.__FLL = doc.links[0] ?? null; }",
  "lib/adapters/mock/store": "export const personaByHandle = new Map();",
  "lib/identity/roster": "export async function syncRoster() {}",
  "lib/session": "export async function getSession() { return { rootId: null }; }",
  "lib/identity/rootRoster": "export async function recordPersona() {}",
  "lib/zk/anon/universe": "export function liveUniverseHinted() { return true; }",
  "lib/zk/anon/fcJoin": "export async function fcJoinNonce() { return { nonce: 'JoinBound1234567', salt: '00'.repeat(16) }; } export async function fcJoinAfterSignIn(i) { globalThis.__FLJ.push(i); }",
};
const FLOW_ENTRY = `export * from "@/lib/fc/siwf/flow";\n`;
async function flowJoinScenario(FL) {
  FL.__setSiwfRuntimeForTests({ env: { FC_SIWF: "fixture", LAYERS_DEVICE_DEBUG: "1", CUSTODY_FIXTURE_PROVIDER: "allow" } });
  const run = async (link) => {
    FL.resetSiwf();
    globalThis.__FLP = [];
    globalThis.__FLL = link;
    globalThis.__FLJ = [];
    const v = await FL.startSiwf({ origin: "http://localhost:3001", host: "localhost:3001" }); // the pinned app port (runner-test 5 refuses the default-port literal)
    const id = v.session && v.session.id;
    assert(id, "furniture: no sign-in session: " + JSON.stringify(v));
    await FL.fixtureApproveSiwf({ sessionId: id, fid: FL.FIXTURE_SIWF_MAIN.fid });
    const after = await FL.pollSiwf(id);
    await new Promise((r) => setTimeout(r, 30)); // the join is fire-and-forget: give it its turn
    return after;
  };
  try {
    // a sign-in record() refuses: another Farcaster account is already linked to this identity (siwf_one_main)
    const other = { kind: "farcaster", fid: FL.FIXTURE_SIWF_OTHER.fid, fname: null, displayName: null, pfpUrl: null, bio: null, personaId: "p_other", authMethod: "custody", signer: "0x" + "00".repeat(20), nonceHash: "x", messageHash: "y", verifiedAt: 0, verifier: { rpcHost: "x" }, disconnectedAt: null };
    const refused = await run(other);
    assert(refused.session && refused.session.stage === "refused" && refused.session.code === "siwf_one_main", "furniture: the sign-in was not refused at record: " + JSON.stringify(refused.session));
    assert(globalThis.__FLJ.length === 0, "a sign-in record() REFUSED told the validator the account (a /zk/anon/fid-join was sent): " + JSON.stringify(globalThis.__FLJ.map((j) => j.fid)));
    // CONTROL: the same sign-in with nothing linked is recorded, and joins exactly once with the bound nonce
    const ok = await run(null);
    assert(ok.session && ok.session.stage === "verified", "control: not verified: " + JSON.stringify(ok.session));
    assert(globalThis.__FLJ.length === 1 && globalThis.__FLJ[0].nonce === "JoinBound1234567" && globalThis.__FLJ[0].fid === FL.FIXTURE_SIWF_MAIN.fid, "control: the recorded sign-in did not join exactly once: " + JSON.stringify(globalThis.__FLJ));
    return "refused at record: no join sent; recorded: one join, after the seal";
  } finally {
    FL.__setSiwfRuntimeForTests(null);
  }
}
await check("P3 a sign-in that record() refuses (another account already linked) sends NO /zk/anon/fid-join; a recorded one joins exactly once, after the seal (PRIV-LIVE-3)", async () => flowJoinScenario(await bundle(FLOW_ENTRY, FLOW_MOCKS)));
await mutation("P3 / the join sent at verification again (before record)", async () => flowJoinScenario(await bundle(FLOW_ENTRY, FLOW_MOCKS, { "lib/fc/siwf/flow.ts": [["        s.completion = null; // the relay's answer leaves memory", '        if (s.joinInput) { const early = s.joinInput; void import("@/lib/zk/anon/fcJoin").then((m) => m.fcJoinAfterSignIn(early)).catch(() => undefined); }\n        s.completion = null; // the relay\'s answer leaves memory']] })), /REFUSED told the validator/);

// ASM-2C: a moderator in a LIVE tab removes a TEST-universe post by naming its universe (signed into the decision)
const MODR_MOCKS = {
  ...SERVER_ONLY,
  ...NEXT_SERVER,
  "lib/zk/config": "export function zkMode() { return 'live'; }",
  "lib/identity/keystore": "export function vaultKeyBytes() { return globalThis.__ARVK; }",
  "lib/world-flag": "export function isEmptyWorld() { return false; }",
  "lib/zk/validatorClient": [
    "async function j(method, p, body) { const r = await fetch(globalThis.__MRVB + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); let json = null; try { json = await r.json(); } catch { json = null; } return { status: r.status, json }; }",
    "export async function fetchAnonPublicStatus(mode) { return (await j('GET', '/zk/anon/public-status?mode=' + mode)).json; }",
    "export async function postAnonModeration(body) { return j('POST', '/zk/anon/moderation', body); }",
    "export async function fetchAnonModeration(q) { return j('GET', '/zk/anon/moderation?mode=' + q.mode + '&issuedHour=' + q.issuedHour + '&pubkey=' + q.pubkey + '&sig=' + q.sig); }",
    "export async function anonDevModerator() { return { status: 403, json: {} }; }",
  ].join("\n"),
};
const MODR_ENTRY = `export * from "@/app/api/anon/moderation/route";\n`;
async function universeTakedownScenario(R) {
  globalThis.__MRVB = VB;
  const tabKey = await MODC.anonModeratorPublicKey();
  const h = createHash("sha256").update("m2|" + Math.random()).digest("hex");
  VAPP.db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('fixture', ?, 'a test post left on a live site', 0, 0, '0xm2', 0, 'relayed')").run(h);
  return withEnv({ ANON_MODERATORS: tabKey }, async () => {
    const post = (body) => R.POST({ json: async () => body });
    // CONTROL: the tab's own universe (live) does not hold the post — the gap the finding names
    const miss = await post({ action: "decide", castHash: h, decision: "remove" });
    assert(miss.status === 404, "control: the live tab removed a test post by its own universe: " + JSON.stringify(miss));
    assert((await vapi("GET", "/zk/anon-cast?mode=fixture&hash=" + h)).status === 200, "control: the test post is not showing");
    const r = await post({ action: "decide", castHash: h, decision: "remove", universe: "fixture" });
    assert(r.status === 200 && r.body.deleteState === "not-on-network", "a moderator in a live tab could not remove a test-universe post by naming its universe: " + JSON.stringify(r));
    assert((await vapi("GET", "/zk/anon-cast?mode=fixture&hash=" + h)).status === 404, "the test post still shows after the removal");
    const bad = await post({ action: "decide", castHash: h, decision: "remove", universe: "elsewhere" });
    assert(bad.status === 400, "an unknown universe was taken: " + JSON.stringify(bad));
    return "own universe: 404; explicit fixture: removed, the one-cast read 404; an unknown universe 400";
  });
}
await check("M2 a moderator in a live tab removes a test-universe post by naming its universe, and /zk/anon-cast?mode=fixture then answers 404 (ASM-2C)", async () => universeTakedownScenario(await bundle(MODR_ENTRY, MODR_MOCKS)));
await mutation("M2 / the route ignores the named universe", async () => universeTakedownScenario(await bundle(MODR_ENTRY, MODR_MOCKS, { "app/api/anon/moderation/route.ts": [['  const mode: "fixture" | "live" = body.universe === "live" || body.universe === "fixture" ? body.universe : tabMode;', '  const mode: "fixture" | "live" = tabMode;']] })), /could not remove a test-universe post/);

console.log("\nS — the stub");
await check("S1 the stub's registry selectors are validator/anonpublic.js's call data (the same bytes viem encodes: validator/test/anonpublic.test.js)", () => {
  assert(vap.idOfCallData(ACCT.address).startsWith(SELECTOR_ID_OF) && vap.keyDataOfCallData(1, ACCT.address).startsWith(SELECTOR_KEY_DATA_OF), "selector drift");
  return SELECTOR_ID_OF + ", " + SELECTOR_KEY_DATA_OF;
});

await chain.close();
await stub.close();
vserver.close();
console.log(`\nanon-relay unit: ${passed} passed, ${failed} failed`);
for (const f of failures) console.log("  FAIL " + f);
const curve = globalThis.curve_bn128;
if (curve && typeof curve.terminate === "function") await curve.terminate();
process.exit(failed ? 1 : 0);
