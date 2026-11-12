// PERSONA LAUNCH P6 — node-only unit harness: LAUNCH ON TEST DATA (the simulated registrar, chain, thin relay, batch
// reveal, reader, self-link exception, post mode). No servers on pinned ports, no network: the client modules are
// bundled with esbuild (the repo's devDependency, the @/ paths from tsconfig.json) with their stateful neighbours replaced
// by in-memory mocks; the validator's modules are required as they are, over an in-memory database (the real migrations)
// and, where the wire matters, an in-process express app on an EPHEMERAL port.
//
//   node scripts/unit-launch.mjs          (npm run test:launch-unit once the verify agent adds the script)
//
// What it proves (every guard also has a MUTATION — a deliberately broken COPY of the module built in a temp directory,
// never the repo file — whose named check MUST go red, so no check here passes vacuously):
//   K  KEYS: fcRecoverySeed is deterministic per (seed, nonce); recovery ≠ custody ≠ signer, as keys and as addresses;
//      the keystore's recovery address re-derives, keyMaterialForLeakTest carries it; rings' inbox/PSK material is
//      deterministic, distinct per nonce and from each other, leak-listed, and a linked device has none
//   R  THE REQUEST, BOTH SIDES (a DELIBERATE DUPLICATE pair): canonical form and launchCommit byte-equal client ↔
//      validator; the shape rules agree on every near miss; a request the CLIENT builds and signs (viem) is accepted by
//      the VALIDATOR's own EIP-712 recovery; the deadline is QUANTIZED to a day (two clicks hours apart, same request)
//   S  THE SCHEDULE AND THE $0 LEDGER: 5,000 CSPRNG draws all due in [arrival + 2 h, arrival + 47.5 h]; nothing registers
//      at +1 h 59 m; registered by +48 h; one spend row per batch with usd_cents 0; every live entry point refuses
//   P  THE PREVIEW WRITES AND FETCHES NOTHING: it lists exactly this persona's posts (not a sibling's) from the own-rows
//      mirror of the complete anon list (fix W2-LAUNCH-REVEAL-200 — a mirror that never completed refuses), labels tiers
//      by FOLLOWERS (fix UX-L7), counts the crowd intersection and asks for an acknowledgement when it cannot (fix LP-4),
//      says what it will post (fix UX-L8), and never says "only creates its account" while posts are on the way (UX-L4)
//   B  THE BATCH REVEAL, BOTH SIDES: canonical pinned; the client's request is accepted end to end by the validator over
//      the wire, the sibling's row untouched; a bad signature is refused; the batch-size limit is one number on both
//      sides and a persona past it is revealed in full, sorted parts (fix W2-LAUNCH-REVEAL-200)
//   X  THE SELF-LINK EXCEPTION: a launched account may quote its OWN revealed originals, at most 10; an 11th, a sibling's
//      anon post, its own unrevealed post, any quote by another account and an unreadable list are refused — and an
//      OLDER own post past the newest page is found through the mirror, a target found nowhere before the first complete
//      read is refused (fix W2-LAUNCH-SELFLINK-FAILOPEN)
//   V  THE LAUNCHED ACCOUNT'S RECORD (fix LP-1): read from its sealed launch record (the merged view) — never written to
//      personaFids; one fid, one persona across both; an unreadable queue refuses
//   F  THE READER: a key the chain does not list renders NOTHING (plain anon); the registered key renders "chain"
//   T  THE THIN RELAY: the registered key's CastAdd is accepted; a wrong key, a bad signature, a stale timestamp and the
//      live universe are refused
//   M  POST MODE (D2): a launched persona is preset anon and must choose; 'direct' allowed; the picker's sentence is the
//      server's, word for word
//   Q  THE PENDING LAUNCH RECORD: in memory at the click (no immediate persist), never listed by queueStatus, never
//      pruned with the anon submissions; each anon post's outcome tells "on the way" from "refused" (device-local)
//   L  THE TICK, END TO END on the in-process validator: queued → waiting (the accepted submission) → nothing before the
//      batch → registered (the record: origin layers-launch, self-custody signer, recovery) → revealed (every one of
//      THIS persona's posts in one batch, none of the sibling's) → profiled (the custody-signed name on the simulated
//      name server, the profile through the thin relay) → done (the launch cast, then the chosen quote-casts). And the
//      review fixes: NO personaFids write and NO per-fid chain read when the registration is noticed (LP-1); posts older
//      than the newest 200 are revealed (REVEAL-200); a lost record is ADOPTED from the registrations list (NO-ADOPTION);
//      a step after registration is never terminal (UX-L6); a launch past 72 h keeps waiting (NO-ADOPTION); a name-server
//      error is retried, never read as "name taken" (FNAME-TRANSIENT)
//   A  THE SINGLE REVEAL refuses a launched account (fix UX-L2): a launch reveals together, never one post at a time
//   C  THE CONFIRM (fixes LP-4, UX-L5, NO-ADOPTION): no recent preview → refused; a crowd the preview could not count →
//      refused without the acknowledgement; a stalled or failed launch may be launched again (the stalled record is
//      replaced); one with an account never; "Try again" after registration
//   U  THE SCREENS: a failed or stalled launch does not take over the page (UX-L5); the launch cast claims no reveal when
//      none happened (UX-L8); the proof page's keys and addresses wrap on a phone (UX-L10)
//   N  NO REAL NETWORK: every request any of the above made went to the in-process validator — none to Neynar,
//      Optimism, the fname server or any other host
import { createRequire, Module } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, generateKeyPairSync, randomBytes, sign as edSign } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = mkdtempSync(path.join(os.tmpdir(), "layers-launch-unit-"));
process.on("exit", () => rmSync(HERE, { recursive: true, force: true }));
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
for (const k of ["FC_TEST_FID", "FC_ANON_FID", "FC_CONNECT_APP_FID", "LAYERS_WORLD", "ZK_MODE", "ZK_JITTER_MIN_MS", "ZK_JITTER_MAX_MS"]) delete process.env[k];

// ------------------------------------------------------------------------------------------------ the network recorder
const netLog = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  netLog.push(String(url instanceof URL ? url.href : typeof url === "string" ? url : url.url));
  return realFetch(url, init);
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
async function bundle(entrySrc, mocks = {}, patches = {}, extra = {}) {
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
    name: "launch-unit-mocks",
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
  await build({
    absWorkingDir: ROOT,
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT, "tsconfig.json"),
    plugins: [plugin],
    loader: { ".json": "json" },
    logLevel: "error",
    nodePaths: [path.join(ROOT, "node_modules")],
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
    ...extra,
  });
  return import(pathToFileURL(out).href);
}

// ------------------------------------------------------------------------------------------------ shared state + validator
const LU = (globalThis.__LU = { calls: [], writes: [] });
process.env.ZK_DEV_HOOKS = "true";
const registrar = require(path.join(ROOT, "validator", "registrar.js"));
const simchain = require(path.join(ROOT, "validator", "simchain.js"));
const { verifyEd25519 } = require(path.join(ROOT, "validator", "crypto.js"));
const { openDb } = require(path.join(ROOT, "validator", "db.js"));
const express = require("express");
const viem = await import(pathToFileURL(require.resolve("viem/accounts")).href);
const HOUR = 3_600_000;
const DAY = 86_400_000;
const db = openDb(":memory:");
const vlog = [];
const vapp = express();
vapp.use((req, res, next) => {
  vlog.push(req.method + " " + req.originalUrl);
  next();
});
vapp.use(express.json());
// fix W2-LAUNCH-FNAME-TRANSIENT: the name server can fail TRANSIENTLY (a 500 "name not recorded") when a test asks it to
vapp.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/sim-chain/fname" && LU.fnameFail > 0) {
    LU.fnameFail--;
    return res.status(500).json({ error: "name not recorded: the simulated disk is full" });
  }
  next();
});
simchain.mountSimChain(vapp, db);
registrar.mountRegistrar(vapp, db, { devHooks: true });
// the PUBLIC anon list, EXACTLY as validator/zk.js serves it: the NEWEST 200 relayed rows (fix W2-LAUNCH-REVEAL-200: the
// harness used to serve every row, so no check could see a post fall off the end of the feed list)
vapp.get("/zk/anon-casts", (req, res) => {
  const rows = db.prepare("SELECT cast_hash, text, epoch, relayed_at, network_hash, fid, attributed_fid, attributed_at, attributed_signer, tree, tree_size, attributed_batch FROM zk_anon_casts WHERE mode = ? AND status = 'relayed' ORDER BY relayed_at DESC, cast_hash ASC LIMIT 200").all(String(req.query.mode || "fixture"));
  res.json({ casts: rows.map((r) => ({ hash: r.network_hash, castHash: r.cast_hash, text: r.text, at: r.relayed_at, fid: r.fid, epoch: r.epoch, attributedFid: r.attributed_fid ?? null, attributedAt: r.attributed_at ?? null, attributedSigner: r.attributed_signer ?? null, tree: r.tree ?? null, treeSize: r.tree_size ?? null, attributedBatch: r.attributed_batch ?? null })) });
});
vapp.post("/zk/anon/reveal", (req, res) => {
  const b = req.body || {};
  if (b.batch !== true) return res.status(400).json({ error: "single reveals are zk.js's" });
  const r = registrar.revealBatch(db, b);
  res.status(r.status).json(r.json);
});
const vserver = await new Promise((resolve) => {
  const s = vapp.listen(0, "127.0.0.1", () => resolve(s));
});
const VBASE = "http://127.0.0.1:" + vserver.address().port;
process.env.VALIDATOR_URL = VBASE;

const edKey = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex"), seed: privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32) };
};
const newAccount = () => viem.privateKeyToAccount("0x" + randomBytes(32).toString("hex"));

// ================================================================================================ K — keys
console.log("\nK — the recovery key, and rings' inbox material");
const K_ENTRY = `export * as kdf from "@/lib/crypto/kdf";\nexport * as ks from "@/lib/identity/keystore";\n`;
process.env.KEYSTORE_DIR = path.join(HERE, "keystore");
const Kx = await bundle(K_ENTRY, { "server-only": `export {};` });
await check("K1 fcRecoverySeed is deterministic per (seed, nonce); recovery, custody and signer differ (keys and addresses); the keystore's recovery address re-derives and is leak-listed", () => {
  const seed = new Uint8Array(randomBytes(32));
  const a = Buffer.from(Kx.kdf.fcRecoverySeed(seed, "n1")).toString("hex");
  assert(a === Buffer.from(Kx.kdf.fcRecoverySeed(seed, "n1")).toString("hex"), "not deterministic");
  assert(a !== Buffer.from(Kx.kdf.fcRecoverySeed(seed, "n2")).toString("hex"), "the nonce does not separate personas");
  const c = Buffer.from(Kx.kdf.fcCustodySeed(seed, "n1")).toString("hex");
  const s = Buffer.from(Kx.kdf.fcSignerSeed(seed, "n1")).toString("hex");
  assert(a !== c && a !== s && c !== s, "recovery, custody and signer seeds collide");
  const p = Kx.ks.createPersona({ name: "Launcher", handle: "launcher_k" });
  const rec = Kx.ks.fcRecoveryAddress(p.id);
  const cus = Kx.ks.fcCustodyAddress(p.id);
  assert(/^0x[0-9a-fA-F]{40}$/.test(rec) && rec !== cus, "the recovery address is the custody address");
  Kx.ks.forgetCachedKeystore();
  assert(Kx.ks.fcRecoveryAddress(p.id) === rec, "the recovery address did not re-derive from the stored seed");
  const needles = Kx.ks.keyMaterialForLeakTest();
  const f = JSON.parse(readFileSync(path.join(process.env.KEYSTORE_DIR, "root.json"), "utf8"));
  const recHex = Buffer.from(Kx.kdf.fcRecoverySeed(new Uint8Array(Buffer.from(f.rootSecretHex, "hex")), p.nonce)).toString("hex");
  assert(needles.includes(recHex), "keyMaterialForLeakTest does not carry the recovery key");
  const linked = Kx.ks.linkMaterial();
  assert(linked.personaKeys[p.id].fcRecovery === recHex, "a linked device would not receive the recovery key");
  return "recovery " + rec.slice(0, 10) + "…";
});
await check("K2 rings' inbox material (applied here for rings): deterministic per nonce, IKM ≠ PSK, nonces separate, leak-listed", () => {
  const a = Kx.ks.ringInboxMaterial("ring-1");
  const b = Kx.ks.ringInboxMaterial("ring-1");
  const c = Kx.ks.ringInboxMaterial("ring-2");
  const hex = (u) => Buffer.from(u).toString("hex");
  assert(hex(a.ikm) === hex(b.ikm) && hex(a.psk) === hex(b.psk), "not deterministic");
  assert(hex(a.ikm) !== hex(a.psk), "IKM equals PSK");
  assert(hex(a.ikm) !== hex(c.ikm) && hex(a.psk) !== hex(c.psk), "two rings share material");
  const leak = Kx.ks.ringMaterialForLeakTest(["ring-1", "ring-2"]);
  assert(leak.length === 4 && leak.includes(hex(a.ikm)) && leak.includes(hex(c.psk)), "ringMaterialForLeakTest is incomplete");
  assert(hex(Kx.kdf.ringNoteKeySeed(new Uint8Array(32).fill(7), "x")) !== hex(Kx.kdf.ringInboxSeed(new Uint8Array(32).fill(7), "x")), "the note-key branch equals the inbox branch");
});
await mutation("K1 / the recovery branch derived on the custody branch's info string", async () => {
  const M = await bundle(K_ENTRY, { "server-only": `export {};` }, { "lib/crypto/kdf.ts": [['return derive(seed, "fc-recovery/" + nonce);', 'return derive(seed, "fc-custody/" + nonce);']] });
  const seed = new Uint8Array(randomBytes(32));
  assert(Buffer.from(M.kdf.fcRecoverySeed(seed, "n")).toString("hex") !== Buffer.from(M.kdf.fcCustodySeed(seed, "n")).toString("hex"), "recovery equals custody");
});

// ================================================================================================ R — the request
console.log("\nR — the launch request, client ↔ validator");
const persona = { id: "p_launcher", handle: "launcher_one", name: "Launcher One", bio: "a persona", avatarUrl: "https://api.dicebear.com/x.svg?seed=launcher" };
const keys = { custody: newAccount(), recovery: newAccount(), signer: edKey() };
LU.persona = persona;
LU.keys = keys;
const KEYS_MOCK = `
const L = globalThis.__LU;
export function isKeystoreRootedPersona(id) { return id === L.persona.id; }
export function fcCustodyAddressFor(id) { return id === L.persona.id ? L.keys.custody.address : null; }
export function fcRecoveryAddressFor(id) { return id === L.persona.id ? L.keys.recovery.address : null; }
export function fcSignerPublicKeyFor(id) { return id === L.persona.id ? L.keys.signer.pubHex : null; }
export async function signCustodyTypedDataFor(id, typed) { L.calls.push(["signCustody", typed.primaryType]); return id === L.persona.id ? L.keys.custody.signTypedData(typed) : null; }
export function signAsFcSignerFor(id, canonical) { return id === L.persona.id ? L.edSign(canonical) : null; }
export function isViewerPersona(id) { return id === L.persona.id || id === "p_sibling"; }`;
LU.edSign = (canonical) => edSign(null, Buffer.from(canonical, "utf8"), keys.signer.privateKey).toString("hex");
const REQ_MOCKS = {
  "server-only": `export {};`,
  "lib/identity/keys": KEYS_MOCK,
  "lib/identity/keystore": `export function getPersona(id) { const L = globalThis.__LU; return id === L.persona.id ? { ...L.persona, kind: "public", nonce: "n" } : null; }`,
  "lib/identity/personaKind": `export function kindOf(id) { return id === globalThis.__LU.persona.id ? "public" : "unknown"; }`,
  "lib/fc/personaFid": `export async function personaFidRecord() { return null; } export async function mainNameDerivation() { return null; }`,
};
const R_ENTRY = `export * as req from "@/lib/launch/request";\nexport * as rev from "@/lib/launch/reveal";\n`;
const Rx = await bundle(R_ENTRY, REQ_MOCKS);
const sample = (o = {}) => ({ v: 1, mode: "fixture", custody: "0x" + "a1".repeat(20), recovery: "0x" + "b2".repeat(20), signerKey: "c3".repeat(32), fname: "launcher-one", profile: { displayName: "Ünïcode “name”", bio: "line one\nline two — 🎉", pfpUrl: "https://example.com/p.png" }, registerSig: "0x" + "d4".repeat(65), addSig: "0x" + "e5".repeat(65), deadlineDay: 20_500, ...o });
await check("R1 canonical form and launchCommit are byte-equal on both sides (unicode, newlines, quotes); the commit is sha256('layers-launch-request/1|' + request)", () => {
  for (const o of [sample(), sample({ fname: "x", profile: { displayName: "", bio: "", pfpUrl: "" } }), sample({ mode: "live" })]) {
    const c = Rx.req.canonicalLaunchRequest(o);
    const v = registrar.canonicalLaunchRequest(o);
    assert(c === v, "canonical differs:\n" + c + "\n" + v);
    assert(Rx.req.launchCommitOf(c) === registrar.launchCommitOf(v), "launchCommit differs");
    assert(Rx.req.launchCommitOf(c) === createHash("sha256").update("layers-launch-request/1|" + c, "utf8").digest("hex"), "the commit is not the documented hash");
  }
});
await check("R2 the shape rules agree on both sides for every near miss (and the valid shape passes both)", () => {
  const good = Rx.req.canonicalLaunchRequest(sample());
  assert(Rx.req.launchRequestShapeProblem(good) === null && registrar.launchRequestShapeProblem(good) === null, "a valid shape is refused");
  const misses = [
    sample({ v: 2 }),
    sample({ custody: "0x" + "A1".repeat(20) }),
    sample({ recovery: "0x" + "a1".repeat(20) }),
    sample({ signerKey: "c3".repeat(31) }),
    sample({ fname: "-lead" }),
    sample({ fname: "UPPER" }),
    sample({ fname: "a".repeat(17) }),
    sample({ profile: { displayName: "x".repeat(33), bio: "", pfpUrl: "" } }),
    sample({ profile: { displayName: "", bio: "y".repeat(257), pfpUrl: "" } }),
    sample({ profile: { displayName: "", bio: "", pfpUrl: "http://plain.example/p.png" } }),
    sample({ registerSig: "0x" + "d4".repeat(64) }),
    sample({ deadlineDay: 1.5 }),
    sample({ mode: "staging" }),
  ].map((o) => Rx.req.canonicalLaunchRequest(o));
  misses.push(JSON.stringify(JSON.parse(good), null, 2), good.replace('{"v":1,', '{"personaId":"p_x","v":1,'), good + " ".repeat(2048));
  for (const m of misses) {
    const c = Rx.req.launchRequestShapeProblem(m);
    const v = registrar.launchRequestShapeProblem(m);
    assert(c !== null && v !== null, "a near miss passed: client " + c + " / validator " + v + " — " + m.slice(0, 120));
  }
  return misses.length + " near misses refused by both";
});
// the click: NOW (the request's quantized deadline is judged against the sim clock in S2 — a fixed date would age out)
LU.now = Date.now();
await check("R3 a request the CLIENT builds and signs (viem, the persona's custody key) is ACCEPTED by the validator's own EIP-712 recovery; it names no persona id, no handle, no root", async () => {
  const b = await Rx.req.buildLaunchRequest(persona.id, {}, "fixture", LU.now);
  assert(b.ok, "the build refused: " + b.reason);
  assert(registrar.validateLaunchRequest(b.request) === null, "the validator refused the client's request: " + registrar.validateLaunchRequest(b.request));
  assert(registrar.launchCommitOf(b.request) === b.launchCommit, "the commits differ");
  for (const needle of [persona.id, persona.handle, "root"]) assert(!b.request.includes(needle), "the request carries " + needle);
  assert(b.fname === "launcher-one", "the fname was not derived from the handle: " + b.fname);
  // the validator's own recovery of each signature, against viem
  const req = JSON.parse(b.request);
  const deadline = req.deadlineDay * 86_400;
  assert(simchain.recoverAddress(simchain.registerDigest({ to: req.custody, recovery: req.recovery, nonce: 0, deadline }), req.registerSig) === keys.custody.address.toLowerCase(), "Register recovers to someone else");
  LU.request = b;
  return "commit " + b.launchCommit.slice(0, 12) + "…";
});
/**
 * PERSONA LAUNCH wave 3 (L8): THE DEADLINE IS QUANTIZED TO A WEEK. It is public calldata on the real Bundler: "click day +
 * 4" let anyone read the click's DAY off it (deadline − 4), cutting the 2–48 h registration cover to a day and splitting
 * every batch by click day. Now every click in one 7-day stretch carries the same deadline: a multiple of 7 (days since
 * 1970), at least 4 and at most 10 days after the click's day — so it still outlasts the 48-hour window.
 */
async function deadlineScenario(Rq) {
  const at = (d, h = 9) => Date.UTC(2026, 9, d, h, 4, 5);
  const a = await Rq.req.buildLaunchRequest(persona.id, {}, "fixture", Date.UTC(2026, 9, 11, 1, 2, 3));
  const b = await Rq.req.buildLaunchRequest(persona.id, {}, "fixture", at(11));
  assert(a.ok && b.ok, "refused");
  // the pin kept: two clicks 8 hours apart on one day build the SAME request (the click time is in no byte of it)
  assert(a.request === b.request, "two clicks on one day produced different requests");
  // 14 consecutive click days: every deadline is a 7-day boundary, 4 to 10 days out, and they take only 2 or 3 values
  const seen = new Map();
  for (let d = 1; d <= 14; d++) {
    const day = Math.floor(at(d) / DAY);
    const dl = Rq.req.deadlineDayFor(at(d));
    assert(dl % 7 === 0, `the deadline for Oct ${d} is not a 7-day boundary: ${dl}`);
    assert(dl - day >= 4 && dl - day <= 10, `the deadline for Oct ${d} is ${dl - day} days out (must be 4 to 10)`);
    seen.set(dl, (seen.get(dl) ?? 0) + 1);
  }
  assert(seen.size <= 3 && [...seen.values()].every((n) => n >= 1) && [...seen.values()].some((n) => n === 7), "14 click days did not fall into 7-day stretches sharing one deadline: " + JSON.stringify([...seen]));
  // so a deadline no longer names the click day: clicks on DIFFERENT days of one stretch build the same request
  const stretch = [...Array(14).keys()].map((i) => i + 1).filter((d) => Rq.req.deadlineDayFor(at(d)) === Rq.req.deadlineDayFor(at(11)));
  assert(stretch.length === 7, "the click's 7-day stretch: " + JSON.stringify(stretch));
  const other = await Rq.req.buildLaunchRequest(persona.id, {}, "fixture", at(stretch.find((d) => d !== 11)));
  assert(other.ok && other.request === a.request, "two clicks on different days of one 7-day stretch produced different requests (the deadline names the click day)");
  return `deadlines ${[...seen.keys()].join(", ")} for 14 click days; the click's day is not in the request`;
}
await check("R4 THE DEADLINE IS QUANTIZED TO A WEEK (L8): two clicks on one day build the SAME request (the pin kept); every deadline is a 7-day boundary 4 to 10 days out; the 7 click days of one stretch build the same request — the deadline never names the click day", () => deadlineScenario(Rx));
await mutation("R4 / the deadline taken from the click's second", async () => deadlineScenario(await bundle(R_ENTRY, REQ_MOCKS, { "lib/launch/request.ts": [["return 7 * (Math.floor((Math.floor(nowMs / DAY) + 3) / 7) + 1);", "return 20_000 + (Math.floor(nowMs / 1000) % 50_000);"]] })));
await mutation("R4 / the deadline back to the click's day + 4", async () => deadlineScenario(await bundle(R_ENTRY, REQ_MOCKS, { "lib/launch/request.ts": [["return 7 * (Math.floor((Math.floor(nowMs / DAY) + 3) / 7) + 1);", "return Math.floor(nowMs / DAY) + 4;"]] })));
/** the registrar's mirror (L8): a deadline that is not a 7-day boundary is refused — it would publish the click's day */
async function registrarDeadlineScenario(reg) {
  // a request built by an OLD client (deadline = click day + 4), on a click day where that is not a week boundary
  const OLD = await bundle(R_ENTRY, REQ_MOCKS, { "lib/launch/request.ts": [["return 7 * (Math.floor((Math.floor(nowMs / DAY) + 3) / 7) + 1);", "return Math.floor(nowMs / DAY) + 4;"]] });
  let click = Date.now();
  while ((Math.floor(click / DAY) + 4) % 7 === 0) click += DAY;
  const old = await OLD.req.buildLaunchRequest(persona.id, {}, "fixture", click);
  assert(old.ok && JSON.parse(old.request).deadlineDay % 7 !== 0, "setup: the old client's deadline is a week boundary by chance");
  assert(reg.validateLaunchRequest(old.request) === null, "setup: the old request is not otherwise valid: " + reg.validateLaunchRequest(old.request));
  reg.resetFixture(db, "fixture");
  const offset = click - Date.now();
  if (offset > 0) reg.advanceClock(db, "fixture", offset);
  let refused = null;
  try {
    reg.enqueueLaunch(db, "fixture", old.request, old.launchCommit, 1);
  } catch (e) {
    refused = e;
  }
  assert(refused && /not a 7-day boundary/.test(refused.message), "the registrar took a day-quantized deadline: " + (refused ? refused.message : "ACCEPTED"));
  assert(db.prepare("SELECT COUNT(*) AS n FROM launch_queue WHERE mode = 'fixture'").get().n === 0, "the refused request left a row");
  // control: the same persona's request from THIS client (a week deadline) is taken
  const now = await Rx.req.buildLaunchRequest(persona.id, {}, "fixture", click);
  reg.enqueueLaunch(db, "fixture", now.request, now.launchCommit, 1);
  assert(db.prepare("SELECT COUNT(*) AS n FROM launch_queue WHERE mode = 'fixture'").get().n === 1, "the week-quantized request was not queued");
  reg.resetFixture(db, "fixture");
  return "a click-day deadline refused, a week deadline queued";
}
await check("R5 L8 the registrar's mirror: a request whose deadline is not a 7-day boundary (an old client's click day + 4) is refused before any row — it would publish the click's day; this client's request is queued", () => registrarDeadlineScenario(registrar));
await mutation("R5 / the registrar's week check removed (validator/registrar.js)", async () => {
  const file = path.join(ROOT, "validator", "registrar.js");
  let src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const from = '  if (!deadlineIsQuantized(r.deadlineDay)) throw new Error("the launch request\'s deadline is not a 7-day boundary — it would publish the day the launch was clicked");\n';
  if (!src.includes(from)) throw new Error("patch anchor not found in validator/registrar.js: the week check");
  src = src.split(from).join("");
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  await registrarDeadlineScenario(m.exports);
});
await mutation("R3 / the client's Add typed data drifts from the validator's (keyType as uint8)", async () => {
  const M = await bundle(R_ENTRY, REQ_MOCKS, { "lib/launch/request.ts": [['{ name: "keyType", type: "uint32" }', '{ name: "keyType", type: "uint8" }']] });
  const b = await M.req.buildLaunchRequest(persona.id, {}, "fixture", LU.now);
  assert(registrar.validateLaunchRequest(b.request) === null, "the validator refused the client's request: " + registrar.validateLaunchRequest(b.request));
});

// ================================================================================================ S — schedule + ledger
console.log("\nS — the sim clock, the schedule, the $0 ledger, no live mode");
await check("S1 5,000 CSPRNG draws: every due time is a batch moment in [arrival + 2 h, arrival + 47.5 h] and they spread over the window", () => {
  const seed = randomBytes(32).toString("hex");
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 5000; i++) {
    const a = Date.UTC(2026, 0, 1) + Math.floor(Math.random() * 300 * DAY);
    const d = registrar.assignDueAt(seed, a);
    assert(d - a >= 2 * HOUR && d - a <= 47.5 * HOUR, "out of the window: " + (d - a) / HOUR);
    lo = Math.min(lo, d - a);
    hi = Math.max(hi, d - a);
  }
  assert(lo < 6 * HOUR && hi > 36 * HOUR, "the draws do not spread");
  return `${(lo / HOUR).toFixed(1)} h to ${(hi / HOUR).toFixed(1)} h`;
});
await check("S2 the client's request queued on the sim clock: nothing at +1 h 59 m; registered by +48 h with the persona's key vouched by the registrar app fid; one $0 spend row (simulated)", () => {
  registrar.resetFixture(db, "fixture");
  const b = LU.request;
  // the request's deadline (the click's day + 4) is checked against the SIM clock: start the sim clock on that day
  const offset = LU.now - Date.now();
  if (offset > 0) registrar.advanceClock(db, "fixture", offset);
  const t0 = registrar.simNow(db, "fixture");
  registrar.enqueueLaunch(db, "fixture", b.request, b.launchCommit, 1);
  registrar.advanceClock(db, "fixture", 2 * HOUR - 60_000);
  assert(registrar.runDueBatches(db, "fixture").registered === 0, "registered before 2 hours");
  registrar.advanceClock(db, "fixture", t0 + 48 * HOUR - registrar.simNow(db, "fixture"));
  assert(registrar.runDueBatches(db, "fixture").registered === 1, "not registered by 48 hours");
  const fid = simchain.fidOfCustody(db, "fixture", b.custody);
  const k = simchain.keysOf(db, "fixture", fid);
  assert(k.length === 1 && k[0].key === keys.signer.pubHex && k[0].requestFid === simchain.REGISTRAR_APP_FID, "the key is not the persona's, vouched by the app fid");
  const spend = db.prepare("SELECT usd_cents, simulated, items FROM registrar_spend").all();
  assert(spend.length === 1 && spend[0].usd_cents === 0 && spend[0].simulated === 1, "the ledger is not one $0 simulated row: " + JSON.stringify(spend));
  LU.fid = fid;
  return "fid " + fid;
});
await mutation("S2 / the due time drawn from [arrival, arrival + 47.5 h] (the 2-hour floor removed)", async () => {
  // the PURE schedule with the floor removed: some draw lands under 2 hours
  const seed = randomBytes(32).toString("hex");
  const broken = (a) => {
    const c = registrar.batchMomentsBetween(seed, a, a + 47.5 * HOUR);
    return c[Math.floor(Math.random() * c.length)];
  };
  for (let i = 0; i < 2000; i++) {
    const a = Date.UTC(2026, 0, 1) + Math.floor(Math.random() * 300 * DAY);
    const d = broken(a);
    assert(d - a >= 2 * HOUR, "due " + ((d - a) / 60000).toFixed(0) + " min after arrival");
  }
});
await check("S3 NO LIVE MODE: enqueue, the batch loop, the registrations read, the chain read and a batch reveal all refuse the live universe", async () => {
  assert(throwsSync(() => registrar.enqueueLaunch(db, "live", LU.request.request, LU.request.launchCommit, 1)), "enqueue live");
  assert(throwsSync(() => registrar.runDueBatches(db, "live")), "batches live");
  assert(throwsSync(() => simchain.keysOf(db, "live", 1)), "chain live");
  assert(registrar.revealBatch(db, { batch: true, mode: "live" }).status === 400, "reveal live");
  for (const p of ["/registrar/registrations?mode=live", "/sim-chain/keys?mode=live&fid=1", "/sim-chain/fid?mode=live&fid=1", "/registrar/reveal-batches?mode=live&fid=1"]) {
    const r = await fetch(VBASE + p);
    assert(r.status === 400, p + " answered " + r.status);
  }
});
function throwsSync(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ================================================================================================ P — the preview
console.log("\nP — the preview writes and fetches nothing: the own-rows mirror of the complete anon list");
const rows = [
  { hash: "0xanon1", castHash: "11".repeat(32), text: "first post", at: Date.UTC(2026, 9, 1, 9), fid: 1, epoch: 1, attributedFid: null, attributedAt: null, tree: "attest:fc.reach/gte-10k", treeSize: 312 },
  { hash: "0xanon2", castHash: "22".repeat(32), text: "second post", at: Date.UTC(2026, 9, 2, 14), fid: 1, epoch: 2, attributedFid: null, attributedAt: null, tree: "tier-2", treeSize: 60 },
  { hash: "0xanon3", castHash: "33".repeat(32), text: "sibling's post", at: Date.UTC(2026, 9, 2, 15), fid: 1, epoch: 2, attributedFid: null, attributedAt: null, tree: "tier-2", treeSize: 60 },
];
LU.rows = rows;
const MINE_DEFAULT = [rows[0].castHash, rows[1].castHash, "44".repeat(32)]; // the last one is still waiting to be relayed
LU.mine = [...MINE_DEFAULT];
LU.outcomes = {};
LU.crowdLocal = null;
// this DEVICE's own-rows mirror holds BOTH personas' relayed rows (the sibling's post is this device's too): picking the
// persona's own is the preview's job
const mirrorOf = (rs, complete = true) => ({
  complete,
  readAt: Date.now(),
  rows: new Map(rs.map((r) => [r.castHash, { hash: r.hash, castHash: r.castHash, text: r.text, at: r.at, epoch: r.epoch, tree: r.tree, treeSize: r.treeSize }])),
  byNetwork: new Map(rs.map((r) => [r.hash, r.castHash])),
});
LU.mirror = { mode: "fixture", value: mirrorOf(rows) };
const PREVIEW_MOCKS = {
  ...REQ_MOCKS,
  "lib/identity/postMode": `export function isOwnPostingPersona(id) { return id === globalThis.__LU.persona.id; } export function handleOfPersona(id) { return id === globalThis.__LU.persona.id ? globalThis.__LU.persona.handle : null; }`,
  "lib/zk/anonAttribution": `export async function attributionCastHashesFor(id) { globalThis.__LU.calls.push(["attributionCastHashesFor", id]); return id === globalThis.__LU.persona.id ? [...globalThis.__LU.mine] : []; }`,
  // the device-local crowd pins (fix LP-4): a running intersection of LU.crowdLocal members, or none
  // … and the posts that count covers ("anon-post-covered|<persona>", final verify LP-4): LU.crowdCovered, else every post
  "lib/zk/localPins": `export function intersectionFor(mode, key) { const L = globalThis.__LU; L.calls.push(["intersectionFor", mode, key]); if (key.startsWith("anon-post-covered|")) return L.crowdLocal === null ? null : [...(L.crowdCovered ?? L.mine)]; return L.crowdLocal === null ? null : Array.from({ length: L.crowdLocal }, (_, i) => String(i)); }`,
  "lib/zk/validatorClient": `export async function fetchAnonCasts(mode) { globalThis.__LU.calls.push(["fetchAnonCasts", mode]); return globalThis.__LU.rows.map((r) => ({ ...r })); }`,
  "lib/launch/tick": `export function anonMirror(mode) { const L = globalThis.__LU; L.calls.push(["anonMirror", mode]); return L.mirror && L.mirror.mode === mode ? L.mirror.value : null; }`,
  // (wave 3, UXH-4: the sealed X records and the X submissions, read by the preview's copies line)
  "lib/zk/anon/queue": `export async function anonPostOutcomes(hs) { return new Map(hs.map((h) => [h, globalThis.__LU.outcomes[h] ?? "queued"])); }
export async function xRecords(mode) { return (globalThis.__LU.xrecs ?? []).filter((r) => !mode || r.mode === mode).map((r) => ({ ...r })); }
export async function xSubmissionItems() { return (globalThis.__LU.xsubs ?? []).map((q) => ({ ...q })); }`,
  "lib/adapters/mock/store": `export async function hydrate() {} export function state() { throw new Error("the preview touched the store"); } export async function persistNs(ns) { globalThis.__LU.writes.push(ns); }`,
  "lib/adapters/mock/persist": `export async function flushVault(ns) { globalThis.__LU.writes.push(ns); } export async function fetchState() { throw new Error("the preview read the vault"); }`,
};
const P_ENTRY = `export * as preview from "@/lib/launch/preview";\nexport * as req from "@/lib/launch/request";\n`;
async function previewScenario(Px) {
  LU.calls = [];
  LU.writes = [];
  LU.outcomes = {};
  LU.crowdLocal = null;
  LU.mine = [...MINE_DEFAULT];
  LU.mirror = { mode: "fixture", value: mirrorOf(rows) };
  Px.preview.resetPreviewVerdicts();
  const before = netLog.length;
  const p = await Px.preview.launchPreview(persona.id, "fixture");
  assert(p.ok, "refused: " + p.reason);
  assert(JSON.stringify(p.posts.map((x) => x.castHash)) === JSON.stringify([rows[0].castHash, rows[1].castHash]), "the preview does not list exactly this persona's relayed posts: " + JSON.stringify(p.posts.map((x) => x.text)));
  assert(p.waiting === 1 && p.refused === 0, "the post still waiting to be relayed is not counted (waiting " + p.waiting + ", refused " + p.refused + ")");
  // fix UX-L7: the tier is FOLLOWERS, in the reach model's own words
  assert(p.posts[0].tierLabel === "10k+ followers tier (312 accounts when you posted)", "tier label: " + p.posts[0].tierLabel);
  assert(p.narrows.some((n) => /posting hours: 09:00, 14:00 UTC/.test(n)) && p.narrows.some((n) => /windows/.test(n)) && p.narrows.some((n) => /writing style/.test(n)), "what launch narrows is incomplete: " + JSON.stringify(p.narrows));
  // fix LP-4: two crowds (fc.reach/gte-10k in epoch 1, tier-2 in epoch 2) and no device-local count — not "one of 60"
  assert(p.crowd.crowds === 2 && p.crowd.exact === false && p.crowd.size === 60 && p.crowd.needsAck === true && /at most 60/.test(p.crowd.ackSentence ?? ""), "the crowd: " + JSON.stringify(p.crowd));
  assert(p.narrows.some((n) => /2 different crowds/.test(n) && /at most 60, possibly far fewer/.test(n)), "the preview overstates the crowd: " + JSON.stringify(p.narrows));
  assert(Px.preview.previewVerdictFor(persona.id, "fixture")?.needsAck === true, "the preview left no verdict for the confirm to check the acknowledgement against");
  // the device-local intersection is read under the key the proof layer writes ("anon-post|<persona>", fix LP-4)
  assert(LU.calls.some((c) => c[0] === "intersectionFor" && c[1] === "fixture" && c[2] === "anon-post|" + persona.id), "the preview did not ask the device-local pins for this persona's crowd: " + JSON.stringify(LU.calls.filter((c) => c[0] === "intersectionFor")));
  // … and a device-local count, when there is one, is the crowd (exact): 72 in common, at least the floor — no acknowledgement
  LU.crowdLocal = 72;
  LU.mine = [rows[0].castHash, rows[1].castHash];
  const counted = await Px.preview.launchPreview(persona.id, "fixture");
  assert(counted.ok && counted.crowd.exact === true && counted.crowd.size === 60 && counted.crowd.needsAck === false, "a device-local count was not used: " + JSON.stringify(counted.crowd));
  LU.crowdLocal = 3;
  const few = await Px.preview.launchPreview(persona.id, "fixture");
  assert(few.ok && few.crowd.exact === true && few.crowd.size === 3 && few.crowd.needsAck === true && few.narrows.some((n) => /fewer than 50 accounts/.test(n)), "an intersection of 3 did not ask for the acknowledgement: " + JSON.stringify(few.crowd));
  // final verify (LP-4): a count that does NOT cover one of the posts (proved on another device, or before the count was
  // kept) is not the crowd — unknown, and the acknowledgement is asked for
  LU.crowdLocal = 72;
  LU.crowdCovered = [rows[0].castHash];
  const partly = await Px.preview.launchPreview(persona.id, "fixture");
  assert(partly.ok && partly.crowd.exact === false && partly.crowd.needsAck === true, "a count covering one of two posts was taken as the crowd: " + JSON.stringify(partly.crowd));
  LU.crowdCovered = undefined;
  LU.crowdLocal = null;
  LU.mine = [...MINE_DEFAULT];
  // fix UX-L8: what the launch posts on Farcaster by itself, said before the confirm
  assert(p.history === Px.req.LAUNCH_HISTORY_SENTENCE && /one launch cast/.test(p.history), "the preview does not say what the launch posts: " + p.history);
  assert(p.staysHidden.length === 5 && /2 to 48 hours/.test(p.timing) && /not set up yet/.test(p.price) && /simulated registrar/.test(p.notice), "the preview's fixed sentences are missing");
  assert(p.account.fname === "launcher-one" && p.account.displayName === persona.name, "the account section: " + JSON.stringify(p.account));
  assert(LU.writes.length === 0, "the preview wrote: " + LU.writes.join(", "));
  assert(netLog.length === before, "the preview made a network request: " + netLog.slice(before).join(", "));
  // fix W2-LAUNCH-REVEAL-200: NOTHING fetched — not even the newest-200 list; the posts come from the mirror
  assert(!LU.calls.some((c) => c[0] === "fetchAnonCasts"), "the preview fetched the newest-200 anon list: " + JSON.stringify(LU.calls));
  assert(LU.calls.some((c) => c[0] === "anonMirror" && c[1] === "fixture"), "positive control: the preview never read the mirror");
  assert(!LU.calls.some((c) => c[0] === "signCustody"), "the preview signed something");
  // fix LP-4 with NOTHING on the way (posts on the way make any count unknown by themselves): two crowds are still not
  // "one of 60" — the intersection is unknown and the acknowledgement is still asked for
  LU.mine = [rows[0].castHash, rows[1].castHash];
  const settled = await Px.preview.launchPreview(persona.id, "fixture");
  assert(settled.ok && settled.waiting === 0 && settled.crowd.exact === false && settled.crowd.size === 60 && settled.crowd.needsAck === true, "two crowds counted as one when nothing is on the way: " + JSON.stringify(settled.crowd));
  LU.mine = [...MINE_DEFAULT];
  // fail closed: a mirror that has not finished ONE complete read of the list refuses — never a partial list
  LU.mirror = { mode: "fixture", value: mirrorOf(rows, false) };
  const partial = await Px.preview.launchPreview(persona.id, "fixture");
  assert(!partial.ok && partial.code === "not_read_yet", "a preview built from an unfinished read: " + JSON.stringify(partial).slice(0, 160));
  LU.mirror = { mode: "fixture", value: mirrorOf(rows) };
}
const Px = await bundle(P_ENTRY, PREVIEW_MOCKS);
await check("P1 the preview lists exactly this persona's relayed anon posts (not the sibling's) from the mirror with dates and FOLLOWER tiers, counts the one still waiting, reports the crowd INTERSECTION (and asks for the acknowledgement), says what it posts, what narrows and what stays hidden — writes nothing, signs nothing, FETCHES nothing, and refuses while the mirror is incomplete", () => previewScenario(Px));
await mutation("P1 / the preview joins EVERY row of the device's mirror (the persona filter removed)", async () => {
  const M = await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/preview.ts": [["const posts: LaunchPreviewPost[] = mine\n    .map((h) => mirror.rows.get(h))", "const posts: LaunchPreviewPost[] = [...mirror.rows.keys()]\n    .map((h) => mirror.rows.get(h))"]] });
  await previewScenario(M);
});
await mutation("P1 / the preview builds from an UNFINISHED mirror (the fail-closed guard removed)", async () => {
  const M = await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/preview.ts": [["if (!mirror || !mirror.complete) return { ok: false, status: 503, code: \"not_read_yet\"", "if (!mirror) return { ok: false, status: 503, code: \"not_read_yet\""]] });
  await previewScenario(M);
});
await mutation("P1 / the local count trusted for posts it does not cover", async () => {
  const M = await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/preview.ts": [["if (castHashes.some((h) => !covered.has(h))) return null;", ""]] });
  await previewScenario(M);
});
await mutation("P1 / the crowd is the smallest single tree again (the intersection ignored: 'one of 60')", async () => {
  const M = await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/preview.ts": [["  } else {\n    size = smallest;\n    exact = false;\n  }", "  } else {\n    size = smallest;\n    exact = true;\n  }"]] });
  await previewScenario(M);
});

async function nothingYetScenario(Px2) {
  LU.calls = [];
  LU.mirror = { mode: "fixture", value: mirrorOf([]) }; // nothing of the persona's relayed yet
  LU.mine = ["44".repeat(32), "55".repeat(32)];
  LU.outcomes = { ["55".repeat(32)]: "refused" };
  try {
    const p = await Px2.preview.launchPreview(persona.id, "fixture");
    assert(p.ok && p.posts.length === 0 && p.waiting === 1 && p.refused === 1, "counts: " + JSON.stringify({ posts: p.posts?.length, waiting: p.waiting, refused: p.refused }));
    assert(!p.narrows.some((n) => /only creates its account/.test(n)), "the preview says 'launching only creates its account' while a post is on the way: " + JSON.stringify(p.narrows));
    assert(p.narrows.some((n) => /still on the way/.test(n) && /revealed too/.test(n)), "the post on the way is not said to be revealed too: " + JSON.stringify(p.narrows));
    assert(p.narrows.some((n) => /refused and never posted/.test(n)), "the refused post is not reported apart from 'on the way'");
    assert(p.crowd.needsAck === true, "a crowd that cannot be known yet asked for no acknowledgement");
    // positive control: with nothing at all to reveal it DOES say so
    LU.mine = [];
    const empty = await Px2.preview.launchPreview(persona.id, "fixture");
    assert(empty.ok && empty.narrows.some((n) => /only creates its account/.test(n)) && empty.crowd.needsAck === false, "with nothing to reveal: " + JSON.stringify(empty.narrows));
  } finally {
    LU.mine = [...MINE_DEFAULT];
    LU.outcomes = {};
    LU.mirror = { mode: "fixture", value: mirrorOf(rows) };
  }
}
await check("P2 (UX-L4) with posts still on the way and none relayed, the preview never says 'launching only creates its account': it says they will be revealed too, and reports a REFUSED post apart (it stays private)", () => nothingYetScenario(Px));
await mutation("P2 / 'only creates its account' whenever nothing is relayed yet (the waiting count ignored)", async () => {
  const M = await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/preview.ts": [["if (!posts.length && waiting === 0) narrows.push(", "if (!posts.length) narrows.push("]] });
  await nothingYetScenario(M);
});

function tierCases(Px3) {
  const t = Px3.preview.tierLabel;
  assert(t("attest:fc.reach/gte-10k", 312) === "10k+ followers tier (312 accounts when you posted)", t("attest:fc.reach/gte-10k", 312));
  assert(t("attest:x.reach/gte-1k", 55) === "1k+ followers on X tier (55 accounts when you posted)", "x.reach drops 'on X': " + t("attest:x.reach/gte-1k", 55));
  assert(t("attest:fc.reach/gte-100k", null) === "100k+ followers tier", t("attest:fc.reach/gte-100k", null));
  assert(t("tier-2", 60) === "basic check, tier 2 (60 accounts when you posted)", t("tier-2", 60));
  assert(t(null, 70) === "basic check (70 accounts when you posted)", t(null, 70));
  for (const tree of ["attest:fc.reach/gte-1k", "attest:x.reach/gte-10k"]) assert(!/accounts tier/.test(t(tree, 99)), "the bucket is called an ACCOUNTS tier: " + t(tree, 99));
}
await check("P3 (UX-L7) a reach tier is labelled by FOLLOWERS in the reach model's own words ('10k+ followers tier', '… on X tier'), never '10k+ accounts tier'", () => tierCases(Px));
await mutation("P3 / the old regex label ('10k+ accounts tier')", async () => {
  const M = await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/preview.ts": [["if (reach) return `${pickerLabel(reach.issuer, reach.bucket)} tier${size}`;", "if (reach) return `${reach.bucket.replace(\"gte-\", \"\")}+ accounts tier${size}`;"]] });
  tierCases(M);
});

function crowdCases(Px4) {
  const c = Px4.preview.launchCrowd;
  const one = c([{ tree: "t", epoch: 1, treeSize: 80 }, { tree: "t", epoch: 1, treeSize: 80 }], null, 50, 0);
  assert(one.exact && one.size === 80 && !one.needsAck && one.crowds === 1, "one crowd: " + JSON.stringify(one));
  const two = c([{ tree: "a", epoch: 1, treeSize: 60 }, { tree: "b", epoch: 1, treeSize: 55 }], null, 50, 0);
  assert(!two.exact && two.size === 55 && two.needsAck && /at most 55/.test(two.ackSentence ?? ""), "two trees: " + JSON.stringify(two));
  const epochs = c([{ tree: "a", epoch: 1, treeSize: 60 }, { tree: "a", epoch: 2, treeSize: 60 }], null, 50, 0);
  assert(!epochs.exact && epochs.needsAck, "one tree in two epochs was counted as one crowd: " + JSON.stringify(epochs));
  const local = c([{ tree: "a", epoch: 1, treeSize: 60 }, { tree: "b", epoch: 1, treeSize: 55 }], 72, 50, 0);
  assert(local.exact && local.size === 55 && !local.needsAck, "a device-local count over the floor: " + JSON.stringify(local));
  const below = c([{ tree: "a", epoch: 1, treeSize: 60 }, { tree: "b", epoch: 1, treeSize: 55 }], 3, 50, 0);
  assert(below.exact && below.size === 3 && below.needsAck && /fewer than Totem's floor of 50/.test(below.ackSentence ?? ""), "an intersection of 3: " + JSON.stringify(below));
  const onTheWay = c([{ tree: "t", epoch: 1, treeSize: 80 }], null, 50, 2);
  assert(!onTheWay.exact && onTheWay.needsAck, "posts still on the way left the crowd 'exact': " + JSON.stringify(onTheWay));
}
await check("P4 (LP-4) the crowd: one (tree, epoch) is exact; two trees or two epochs are NOT (at most the smallest — acknowledgement needed); a device-local intersection is exact and one under the floor of 50 needs the acknowledgement; posts on the way make it unknown", () => crowdCases(Px));
await mutation("P4 / a device-local intersection under the floor passes without the acknowledgement", async () => {
  const M = await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/preview.ts": [["const below = size !== null && size < floor;", "const below = false;"]] });
  crowdCases(M);
});

/**
 * PERSONA LAUNCH wave 3 — what the confirm screen says, three more lines:
 *   UXH-4  the persona's copies to @totem on X (the same words as the posts a launch reveals) — "N copies … can match"
 *          with one, absent with none; a copy that never reached the outbox (refused, expired) and another persona's
 *          copy, or a standalone X post, are not counted
 *   UXH-14 one reach line PER ISSUER (Farcaster and X followers both named), the highest bucket proved for each
 *   L3     a single REACH crowd is not "exact" without the device-local count (its band can be far smaller than the tree)
 */
async function confirmLinesScenario(Px5) {
  LU.calls = [];
  LU.writes = [];
  LU.outcomes = {};
  LU.crowdLocal = null;
  LU.crowdCovered = undefined;
  const xRow = { hash: "0xanon9", castHash: "99".repeat(32), text: "an X-boosted post", at: Date.UTC(2026, 9, 3, 10), fid: 1, epoch: 3, attributedFid: null, attributedAt: null, tree: "attest:x.reach/gte-1k", treeSize: 140 };
  const lowRow = { hash: "0xanon8", castHash: "88".repeat(32), text: "a 1k fc post", at: Date.UTC(2026, 9, 3, 11), fid: 1, epoch: 3, attributedFid: null, attributedAt: null, tree: "attest:fc.reach/gte-1k", treeSize: 250 };
  LU.mine = [rows[0].castHash, rows[1].castHash, xRow.castHash, lowRow.castHash];
  LU.mirror = { mode: "fixture", value: mirrorOf([...rows, xRow, lowRow]) };
  try {
    // no copies yet: no X line
    LU.xrecs = [];
    LU.xsubs = [];
    const none = await Px5.preview.launchPreview(persona.id, "fixture");
    assert(none.ok && !none.narrows.some((n) => /@totem on X/.test(n)), "an X line with no copies: " + JSON.stringify(none.narrows));
    // UXH-14: one line per issuer, the HIGHEST bucket proved — fc.reach 10k+ (not the 1k+ post), x.reach 1k+
    const reachLines = none.narrows.filter((n) => /^Your boosted posts carried/.test(n));
    assert(reachLines.length === 2, "not one reach line per issuer: " + JSON.stringify(reachLines));
    assert(/10k\+ followers tier/.test(reachLines[0]) && /\(Farcaster followers\)/.test(reachLines[0]) && /1k\+ followers on X tier/.test(reachLines[1]) && /\(X followers\)/.test(reachLines[1]), "the per-issuer lines: " + JSON.stringify(reachLines));
    // UXH-4: one copy of this persona's post counts; a refused one, an expired one, a sibling's and a standalone do not
    const rec = (xHash, o) => ({ mode: "fixture", xHash, personaId: persona.id, copyOf: rows[0].castHash, at: 1, settled: null, ...o });
    LU.xrecs = [
      rec("a1".repeat(32)),
      rec("a2".repeat(32), { settled: { status: "sent", outcome: "refused", sentAt: 1 } }),
      rec("a3".repeat(32)),
      rec("a4".repeat(32), { personaId: "p_sibling" }),
      rec("a5".repeat(32), { copyOf: null }),
      rec("a6".repeat(32), { copyOf: "ee".repeat(32) }),
    ];
    LU.xsubs = [{ id: "q3", xHash: "a3".repeat(32), status: "refused", outcome: "expired", epoch: 3, mode: "fixture", sentAt: null }];
    const one = await Px5.preview.launchPreview(persona.id, "fixture");
    const xl = one.narrows.filter((n) => /@totem on X/.test(n));
    assert(xl.length === 1 && /^1 copy you sent to @totem on X has the same words as these posts: once launched, anyone can match it to @/.test(xl[0]) && /\(test data: nothing reached X\)\.$/.test(xl[0]), "the X copy line: " + JSON.stringify(xl));
    // L3: one reach crowd alone is NOT exact (a default-tier post's band may be far smaller than its tree)
    const c = Px5.preview.launchCrowd;
    const single = c([{ tree: "attest:fc.reach/gte-10k", epoch: 1, treeSize: 80 }], null, 50, 0);
    assert(!single.exact && single.needsAck && /at most 80/.test(single.ackSentence ?? ""), "a single reach crowd was taken as exact: " + JSON.stringify(single));
    const plainOne = c([{ tree: "tier-2", epoch: 1, treeSize: 80 }], null, 50, 0);
    assert(plainOne.exact && !plainOne.needsAck, "the control: a single plain crowd is no longer exact: " + JSON.stringify(plainOne));
    return "per-issuer reach lines; one X copy counted (refused, expired, sibling, standalone, foreign copy not); a single reach crowd is an upper bound";
  } finally {
    LU.mine = [...MINE_DEFAULT];
    LU.mirror = { mode: "fixture", value: mirrorOf(rows) };
    LU.xrecs = [];
    LU.xsubs = [];
  }
}
await check("P5 wave 3: the confirm screen names the persona's copies to @totem on X (UXH-4: one counted copy → the line; refused / expired / a sibling's / standalone ones not counted; none → no line), one reach line PER ISSUER with the highest bucket proved (UXH-14), and a single reach crowd is an upper bound, not exact (L3)", () => confirmLinesScenario(Px));
await mutation("P5 / the X copies line dropped (UXH-4)", async () => confirmLinesScenario(await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/preview.ts": [["  if (copies > 0)\n    narrows.push(", "  if (false)\n    narrows.push("]] })));
await mutation("P5 / copies that never reached the outbox counted too", async () => confirmLinesScenario(await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/preview.ts": [["    if (neverReached(subOf.get(r.xHash)) || neverReached(r.settled)) continue;\n", ""]] })));
await mutation("P5 / one reach line for the smallest tree again (UXH-14)", async () => confirmLinesScenario(await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/preview.ts": [["      if (!cur || r.rank > curRank || (r.rank === curRank && (p.treeSize ?? Infinity) < (cur.treeSize ?? Infinity))) byIssuer.set(r.issuer, p);", "      if (!cur || (p.treeSize ?? Infinity) < (cur.treeSize ?? Infinity)) byIssuer.set(r.issuer, p);"]] })));
await mutation("P5 / a single reach crowd exact again (L3)", async () => confirmLinesScenario(await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/preview.ts": [["} else if (sets.size === 1 && smallest !== null && !posts.some((p) => parseReachTree(p.tree))) {", "} else if (sets.size === 1 && smallest !== null) {"]] })));

// ================================================================================================ B — the batch reveal
console.log("\nB — the batch reveal, client ↔ validator");
await check("B1 the reveal canonical and the cast-list hash are byte-equal on both sides (order-independent: the list is sorted)", () => {
  const hs = ["ff".repeat(32), "01".repeat(32), "aa".repeat(32)];
  assert(Rx.rev.castListHash(hs) === registrar.castListHash(hs) && Rx.rev.castListHash(hs) === Rx.rev.castListHash([...hs].reverse()), "cast-list hash differs or depends on order");
  assert(Rx.rev.revealBatchCanonical("fixture", 7000001, "ab".repeat(32), hs) === registrar.revealBatchCanonical("fixture", 7000001, "ab".repeat(32), hs), "canonical differs");
});
async function revealScenario(Bx) {
  // three relayed rows on the in-process validator: two of this persona's, one of a sibling's
  db.prepare("DELETE FROM zk_anon_casts WHERE mode = 'fixture'").run();
  db.prepare("DELETE FROM zk_reveal_batches WHERE mode = 'fixture'").run();
  const items = [0, 1, 2].map((i) => {
    const secret = randomBytes(32).toString("hex");
    const castHash = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, attribution_commitment) VALUES ('fixture', ?, ?, 1, ?, ?, 1, 'relayed', ?)").run(castHash, "post " + i, HOUR, "0xanonb" + i, createHash("sha256").update("layers-anon-attribution/1|" + secret).digest("hex"));
    return { castHash, secret };
  });
  const before = netLog.length;
  // sent in DESCENDING order: the canonical sorts, so a side that forgot to sort is caught deterministically
  const ours = items.slice(0, 2).sort((x, y) => (x.castHash < y.castHash ? 1 : -1));
  const r = await Bx.rev.sendBatchReveal(persona.id, LU.fid, "fixture", ours);
  assert(r.ok && r.revealed === 2, "the validator refused the client's batch: " + JSON.stringify(r));
  assert(netLog.length === before, "the reveal used the shared fetch pool, not the isolated socket");
  const got = db.prepare("SELECT cast_hash, attributed_fid, attributed_batch, attributed_signer FROM zk_anon_casts WHERE mode = 'fixture' ORDER BY cast_hash").all();
  const sib = got.find((x) => x.cast_hash === items[2].castHash);
  assert(sib.attributed_fid === null, "the sibling's row was revealed");
  for (const it of items.slice(0, 2)) {
    const row = got.find((x) => x.cast_hash === it.castHash);
    assert(row.attributed_fid === LU.fid && row.attributed_batch === r.batchHash && row.attributed_signer === keys.signer.pubHex, "a row of ours was not revealed under the registered key: " + JSON.stringify(row));
  }
  const stored = registrar.revealBatchesFor(db, "fixture", LU.fid)[0];
  assert(verifyEd25519(stored.signature, registrar.revealBatchCanonical("fixture", LU.fid, stored.signer, stored.castHashes), stored.signer), "the stored batch signature does not verify on the validator's own check");
}
await check("B2 END TO END over the wire: the client's batch (signed by the registered key, isolated socket) is accepted; every one of this persona's rows revealed with the batch hash; the sibling's untouched", () => revealScenario(Rx));
await mutation("B2 / the client hashes the cast list in the order given, unsorted (one side drifts)", async () => {
  const M = await bundle(R_ENTRY, REQ_MOCKS, { "lib/launch/reveal.ts": [['update([...castHashes].sort().join(",")', 'update([...castHashes].join(",")']] });
  await revealScenario(M);
});
async function partsScenario(Bx) {
  // the batch-size limit is ONE number on both sides (a DELIBERATE DUPLICATE pair)
  assert(Bx.rev.REVEAL_BATCH_MAX_ITEMS === registrar.MAX_BATCH_ITEMS, `client ${Bx.rev.REVEAL_BATCH_MAX_ITEMS} / validator ${registrar.MAX_BATCH_ITEMS}`);
  const items = Array.from({ length: 3200 }, () => ({ castHash: randomBytes(32).toString("hex"), secret: "00".repeat(32) }));
  const parts = Bx.rev.revealParts(items);
  assert(parts.length === 3 && parts[0].length === 1500 && parts[1].length === 1500 && parts[2].length === 200, "parts: " + parts.map((x) => x.length).join(","));
  const flat = parts.flat().map((x) => x.castHash);
  assert(new Set(flat).size === 3200 && JSON.stringify(flat) === JSON.stringify([...flat].sort()), "the parts lost, repeated or did not sort the posts (a retry would rebuild different parts)");
  assert(Bx.rev.revealParts(items.slice(0, 1500)).length === 1, "1,500 posts did not fit ONE batch");
  // one batch over the limit is refused BEFORE anything is signed or sent
  const v = vlog.length;
  const r = await Bx.rev.sendBatchReveal(persona.id, 7000001, "fixture", items.slice(0, 1501));
  assert(!r.ok && /at most 1500/.test(r.reason ?? "") && vlog.length === v, "an over-limit batch was sent: " + JSON.stringify(r).slice(0, 160));
}
await check("B4 (W2-LAUNCH-REVEAL-200) the reveal's batch limit is one number on both sides (1,500, inside the validator's body limit); a persona past it is revealed in full, sorted parts; one batch over it is refused before anything is sent", () => partsScenario(Rx));
await mutation("B4 / the client's limit drifts from the validator's (500)", async () => {
  const M = await bundle(R_ENTRY, REQ_MOCKS, { "lib/launch/reveal.ts": [["export const REVEAL_BATCH_MAX_ITEMS = 1500;", "export const REVEAL_BATCH_MAX_ITEMS = 500;"]] });
  await partsScenario(M);
});
await check("B3 a batch whose signature is wrong, or whose key the KeyRegistry does not list, is refused and reveals nothing", async () => {
  db.prepare("UPDATE zk_anon_casts SET attributed_fid = NULL, attributed_batch = NULL, attributed_signer = NULL WHERE mode = 'fixture'").run();
  db.prepare("DELETE FROM zk_reveal_batches WHERE mode = 'fixture'").run();
  const real = LU.edSign;
  try {
    const stray = edKey();
    LU.edSign = (c) => edSign(null, Buffer.from(c, "utf8"), stray.privateKey).toString("hex");
    const one = db.prepare("SELECT cast_hash FROM zk_anon_casts WHERE mode = 'fixture' LIMIT 1").get();
    const r = await Rx.rev.sendBatchReveal(persona.id, LU.fid, "fixture", [{ castHash: one.cast_hash, secret: "00".repeat(32) }]);
    assert(!r.ok && r.status === 400, "a bad signature was not refused: " + JSON.stringify(r));
    assert(db.prepare("SELECT COUNT(*) AS n FROM zk_anon_casts WHERE attributed_fid IS NOT NULL").get().n === 0, "something was revealed");
  } finally {
    LU.edSign = real;
  }
});

// ================================================================================================ X — the self-link exception
console.log("\nX — R9's one exception: a launched account quotes its own revealed originals, at most 10");
const LAUNCHED = { personaId: persona.id, fid: 7000001, fname: "launcher-one", origin: "layers-launch", mode: "fixture", custodyAddress: "0x" + "a1".repeat(20), signer: { kind: "self-custody", derivedPubHex: "c3".repeat(32), registered: true, simulated: true } };
LU.records = [LAUNCHED];
LU.anonRows = [
  { hash: "0xown1", castHash: "a1".repeat(32), attributedFid: 7000001, attributedBatch: "bb".repeat(32) }, // own, revealed
  { hash: "0xown2", castHash: "a2".repeat(32), attributedFid: null, attributedBatch: null }, // own, NOT revealed
  { hash: "0xsib1", castHash: "a3".repeat(32), attributedFid: null, attributedBatch: null }, // a sibling's
  { hash: "0xstranger", castHash: "a4".repeat(32), attributedFid: null, attributedBatch: null }, // someone else's
];
LU.ownAnon = new Map([["a1".repeat(32), persona.id], ["a2".repeat(32), persona.id], ["a3".repeat(32), "p_sibling"], ["a5".repeat(32), "p_sibling"], ["a6".repeat(32), persona.id]]);
LU.quotes = 0;
LU.anonThrows = false;
const X_MOCKS = {
  "server-only": `export {};`,
  "lib/identity/keys": KEYS_MOCK,
  "lib/adapters/devControls": `export function consumeFcPublishDrop() { return false; }`,
  "lib/adapters/neynar/mode": `export function isLiveContent() { return false; } export function writeEnabled() { return false; }`,
  "lib/adapters/mock/store": `export async function hydrate() {} export function state() { const L = globalThis.__LU; return { fcAttribution: new Map(), fcWrites: new Map(), zkQueue: new Map([...L.ownAnon].map(([h, p]) => ["zka_" + h, { id: "zka_" + h, claimKind: "anon-attribution", attribution: { secret: "s", commitment: "c", text: "t", personaId: p } }])) }; } export async function persistNs() {} export const postByHash = new Map();`,
  "lib/ports": `export function validatorUrl() { return "http://anon-list.invalid"; }`,
  "lib/fc/personaFid": `
const L = globalThis.__LU;
export async function allPersonaFids() { return L.records.map((r) => ({ ...r })); }
export async function personaFidRecord(id) { const r = L.records.find((x) => x.personaId === id); return r ? { ...r } : null; }
export async function personaOfFid(fid) { return L.records.find((x) => x.fid === fid)?.personaId ?? null; }
export async function connectedRecords() { return []; }
export async function ownAccountFidsWithAnon(records) { return new Set(records.map((r) => r.fid)); }`,
  "lib/fc/networkMode": `export function personaNetworkMode() { return "per-persona-fid"; }`,
  "lib/fc/thinRelay": `export function quoteCastCount() { return globalThis.__LU.quotes; }`,
  "lib/data": `export function findLocalCast() { return null; }`,
  "lib/identity/personaKind": `export function kindOf() { return "public"; }`,
};
const X_ENTRY = `export { assertNoSelfLink, LAUNCH_QUOTE_LIMIT } from "@/lib/fc/writes";\n`;
// the public anon list's NEWEST page the guard reads, and the registrar's complete read of the rows attributed to an
// account, served to the bundle's fetch (a host that does not exist: never the network)
const anonListFetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("http://anon-list.invalid/zk/anon-casts")) {
    if (LU.anonThrows) throw new Error("validator unreachable");
    return new Response(JSON.stringify({ casts: LU.anonRows.map((r) => ({ ...r })) }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.startsWith("http://anon-list.invalid/registrar/anon-casts")) {
    if (LU.anonThrows) throw new Error("validator unreachable");
    const fid = Number(new URL(u).searchParams.get("attributedFid"));
    return new Response(JSON.stringify({ casts: [...LU.anonRows, ...LU.olderRows].filter((r) => r.attributedFid === fid).map((r) => ({ ...r })), next: null }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
};
// fix W2-LAUNCH-SELFLINK-FAILOPEN: OLDER posts of this device, PAST the newest page — a sibling's and the persona's own
// unrevealed one. Only the launch tick's own-rows mirror of the complete list knows them.
LU.olderRows = [
  { hash: "0xsibold", castHash: "a5".repeat(32), attributedFid: null, attributedBatch: null },
  { hash: "0xownold", castHash: "a6".repeat(32), attributedFid: null, attributedBatch: null },
];
function setXMirror(complete) {
  const own = [...LU.anonRows.filter((r) => LU.ownAnon.has(r.castHash)), ...LU.olderRows];
  globalThis.__layersLaunchAnonMirror = { fixture: { complete, readAt: Date.now(), rows: new Map(own.map((r) => [r.castHash, { hash: r.hash, castHash: r.castHash }])), byNetwork: new Map(own.map((r) => [r.hash, r.castHash])) } };
}
async function selfLinkScenario(Xx) {
  const saved = globalThis.fetch;
  globalThis.fetch = anonListFetch;
  setXMirror(true);
  try {
    await selfLinkCases(Xx);
  } finally {
    globalThis.fetch = saved;
    globalThis.__layersLaunchAnonMirror = undefined;
  }
}
async function selfLinkCases(Xx) {
  const refused = async (actor, target) => {
    try {
      await Xx.assertNoSelfLink(actor, target, "fixture");
      return null;
    } catch (e) {
      return e.message;
    }
  };
  assert(Xx.LAUNCH_QUOTE_LIMIT === 10, "the limit is not 10");
  LU.quotes = 0;
  assert((await refused(persona.id, { quoteHash: "0xown1", text: "q" })) === null, "quoting its own revealed original was refused");
  LU.quotes = 9;
  assert((await refused(persona.id, { quoteHash: "0xown1", text: "q" })) === null, "the 10th quote was refused");
  LU.quotes = 10;
  assert(/at most 10/.test((await refused(persona.id, { quoteHash: "0xown1", text: "q" })) ?? ""), "an 11th quote was allowed");
  LU.quotes = 0;
  assert(/OTHER personas/.test((await refused(persona.id, { quoteHash: "0xsib1", text: "q" })) ?? ""), "quoting a sibling's anon post was allowed");
  assert(/OTHER personas/.test((await refused(persona.id, { parentHash: "0xsib1", text: "r" })) ?? ""), "replying to a sibling's anon post was allowed");
  assert(/OTHER personas/.test((await refused(persona.id, { targetHash: "0xsib1" })) ?? ""), "liking a sibling's anon post was allowed");
  assert(/did not reveal|that one is not/.test((await refused(persona.id, { quoteHash: "0xown2", text: "q" })) ?? ""), "quoting an UNREVEALED own post was allowed");
  assert(/did not reveal/.test((await refused(persona.id, { parentHash: "0xown2", text: "r" })) ?? ""), "replying to an unrevealed own post was allowed");
  assert(/that one is not/.test((await refused(persona.id, { quoteHash: "0xstranger", text: "q" })) ?? ""), "quoting a stranger's anon post through the exception was allowed");
  assert((await refused(persona.id, { parentHash: "0xstranger", text: "r" })) === null, "a reply to a stranger's anon post was refused (it links nothing of ours)");
  assert(/only as a launched account/.test((await refused("p_sibling", { quoteHash: "0xown1", text: "q" })) ?? ""), "a non-launched account quoted");
  // fix W2-LAUNCH-SELFLINK-FAILOPEN: OLDER own posts, not on the newest page, are still this device's — found via the mirror
  assert(/OTHER personas/.test((await refused(persona.id, { parentHash: "0xsibold", text: "r" })) ?? ""), "replying to a sibling's OLDER anon post (past the newest page) was allowed");
  assert(/OTHER personas/.test((await refused(persona.id, { targetHash: "0xsibold" })) ?? ""), "liking a sibling's OLDER anon post was allowed");
  assert(/did not reveal/.test((await refused(persona.id, { parentHash: "0xownold", text: "r" })) ?? ""), "replying to its own OLDER unrevealed anon post was allowed");
  // a target found NOWHERE: once the whole list has been read it is nobody's (a stranger's ordinary cast) …
  assert((await refused(persona.id, { parentHash: "0xnowhere", text: "r" })) === null, "a reply to a stranger's ordinary cast was refused after the complete read");
  // … but before this device has finished reading the whole list once, it might be one of its own: refused (fail closed)
  setXMirror(false);
  try {
    assert(/could not check/.test((await refused(persona.id, { parentHash: "0xnowhere", text: "r" })) ?? ""), "a target found nowhere passed before this device had read the whole list (fail open)");
  } finally {
    setXMirror(true);
  }
  LU.anonThrows = true;
  assert(/could not check/.test((await refused(persona.id, { quoteHash: "0xown1", text: "q" })) ?? ""), "an unreadable anon list did not refuse (fail open)");
  LU.anonThrows = false;
}
const Xx = await bundle(X_ENTRY, X_MOCKS);
await check("X1 a launched account quotes its OWN revealed originals (the 1st and 10th allowed), and an 11th, a sibling's post (quote, reply, like — also an OLDER one past the newest page), its own unrevealed post (also an older one), a stranger's post through the exception, a quote by another account, a target found nowhere before the first complete read and an unreadable list are ALL refused", () => selfLinkScenario(Xx));
await mutation("X1 / the quote count bound removed", async () => {
  const M = await bundle(X_ENTRY, X_MOCKS, { "lib/fc/writes.ts": [["if (quoteCastCount(rec.fid) >= LAUNCH_QUOTE_LIMIT)", "if (false)"]] });
  await selfLinkScenario(M);
});
await mutation("X1 / the sibling rule removed", async () => {
  const M = await bundle(X_ENTRY, X_MOCKS, { "lib/fc/writes.ts": [["if (row && poster !== undefined && poster !== actingPersonaId)", "if (false)"]] });
  await selfLinkScenario(M);
});
await mutation("X1 / the guard looks only at the newest page again (the own-rows mirror ignored)", async () => {
  const M = await bundle(X_ENTRY, X_MOCKS, { "lib/fc/writes.ts": [["const ownCastHash = mirror?.byNetwork.get(hash) ?? (mirror?.rows.has(hash) || ownAnon.has(hash) ? hash : undefined);", "const ownCastHash: string | undefined = undefined;"]] });
  await selfLinkScenario(M);
});
await mutation("X1 / a target found nowhere passes before the first complete read (fail open)", async () => {
  const M = await bundle(X_ENTRY, X_MOCKS, { "lib/fc/writes.ts": [["if (!row && !mirror?.complete) throw cannotCheck(", "if (false) throw cannotCheck("]] });
  await selfLinkScenario(M);
});

// ================================================================================================ F — the reader
console.log("\nF — the reader: a key the chain does not list renders nothing");
LU.chain = { account: { fid: 7000001, custody: "0x" + "a1".repeat(20), recovery: "0x" + "b2".repeat(20), registeredAt: 1, storageUnits: 1, fname: "launcher-one" }, keys: [{ key: "c3".repeat(32), keyType: 1, requestFid: 7000000, addedAt: 1, removedAt: null }] };
const F_MOCKS = {
  "server-only": `export {};`,
  "lib/vault/vault": `export function decryptNamespace() { return {}; } export function encryptNamespace() { return {}; }`,
  "lib/adapters/mock/persist": `export async function fetchState() { return { status: 404, ok: false }; } export async function flushVault() { throw new Error("the reader wrote"); }`,
  "lib/identity/handleStem": `export function derivedFromMain() { return false; }`,
  "lib/zk/config": `export function zkMode() { return "fixture"; }`,
  "lib/fc/chain/source": `export function chainSource() { const L = globalThis.__LU; return { kind: "fixture", account: async (fid) => (fid === L.chain.account.fid ? { ...L.chain.account } : null), keysOf: async (fid) => (fid === L.chain.account.fid ? L.chain.keys.map((k) => ({ ...k })) : []), fidOfCustody: async () => null, fidOfName: async () => null }; }`,
  "lib/identity/keystore": `export function getPersona() { return null; }`,
  "lib/adapters/mock/store": `export const personaById = new Map(); export async function hydrate() {} export function state() { return { zkQueue: new Map() }; }`,
  "lib/identity/keys": KEYS_MOCK,
  "lib/identity/personaKind": `export function kindOf() { return "public"; }`,
};
const F_ENTRY = `export { publicProfileForFid } from "@/lib/fc/personaFid";\n`;
async function readerScenario(Fx) {
  // the profile the account's key published through the thin relay (the relay's in-process table)
  globalThis.__layersThinRelay = { log: [], userData: new Map([[7000001, { display: "Launcher One", pfp: "https://example.com/p.png" }]]) };
  const ok = await Fx.publicProfileForFid(7000001, "c3".repeat(32));
  assert(ok && ok.checkable === "chain" && ok.fname === "launcher-one" && ok.name === "Launcher One", "the registered key did not render as a chain-checked reveal: " + JSON.stringify(ok));
  const forged = await Fx.publicProfileForFid(7000001, "dd".repeat(32));
  assert(forged === null, "a key the chain does not list rendered a name: " + JSON.stringify(forged));
  const removed = { ...LU.chain.keys[0], removedAt: 5 };
  const saved = LU.chain.keys;
  LU.chain.keys = [removed];
  try {
    assert((await Fx.publicProfileForFid(7000001, "c3".repeat(32))) === null, "a REMOVED key still renders");
  } finally {
    LU.chain.keys = saved;
  }
  assert((await Fx.publicProfileForFid(7000001, null)) === null, "no key rendered a name");
}
const Fx = await bundle(F_ENTRY, F_MOCKS);
await check("F1 a reveal signed by the registered key renders 'chain' with the chain's name; a forged key, a removed key and no key render NOTHING (plain anon)", () => readerScenario(Fx));
await mutation("F1 / the reader trusts any key (hasActiveKey always true)", async () => {
  const M = await bundle(F_ENTRY, F_MOCKS, { "lib/fc/chain/types.ts": [["return keys.some((x) => x.key.toLowerCase() === k && x.removedAt === null);", "return true;"]] });
  await readerScenario(M);
});

// ================================================================================================ V — the launched account's record
console.log("\nV — the launched account is read from its sealed launch record, never written to personaFids (LP-1)");
LU.vaultWrites = [];
LU.vstate = { zkQueue: new Map() };
const V_MOCKS = {
  "server-only": `export {};`,
  "lib/vault/vault": `export function decryptNamespace() { return {}; } export function encryptNamespace() { return { sealed: true }; }`,
  "lib/adapters/mock/persist": `export async function fetchState() { return { status: 404, ok: false }; } export async function flushVault(ns) { globalThis.__LU.vaultWrites.push(ns); }`,
  "lib/identity/handleStem": `export function derivedFromMain() { return false; }`,
  "lib/zk/config": `export function zkMode() { return "fixture"; }`,
  "lib/adapters/mock/store": `export const personaById = new Map(); export async function hydrate() {} export function state() { return globalThis.__LU.vstate; }`,
  "lib/identity/keystore": `export function getPersona() { return null; }`,
  "lib/identity/keys": KEYS_MOCK,
  "lib/identity/personaKind": `export function kindOf() { return "public"; }`,
  "lib/fc/chain/source": F_MOCKS["lib/fc/chain/source"],
};
const V_ENTRY = `export * as pf from "@/lib/fc/personaFid";\n`;
async function mergedScenario(Vx) {
  LU.vaultWrites = [];
  Vx.pf.resetPersonaFidCache();
  const launched = { mode: "fixture", personaId: persona.id, launchCommit: "dd".repeat(32), custody: "0x" + "a1".repeat(20), recovery: "0x" + "b2".repeat(20), signerKey: "c3".repeat(32), fid: 7000009, registeredHour: 500000, fnameSet: "launcher-one", stage: "registered" };
  const proving = { ...launched, personaId: "p_other", launchCommit: "ee".repeat(32), fid: null, registeredHour: null, fnameSet: null, stage: "proving" };
  // the sealed queue, as lib/zk/anon/queue.ts keeps it (claimKind "persona-launch-pending", the record under `launch`)
  LU.vstate = {
    zkQueue: new Map([
      ["zkl_" + launched.launchCommit, { id: "zkl_" + launched.launchCommit, claimKind: "persona-launch-pending", launch: launched }],
      ["zkl_" + proving.launchCommit, { id: "zkl_" + proving.launchCommit, claimKind: "persona-launch-pending", launch: proving }],
    ]),
  };
  const rec = await Vx.pf.personaFidRecord(persona.id);
  assert(
    rec && rec.origin === "layers-launch" && rec.fid === 7000009 && rec.fname === "launcher-one" && rec.signer.kind === "self-custody" && rec.signer.derivedPubHex === "c3".repeat(32) && rec.custodyAddress === launched.custody && rec.launch.recoveryAddress === launched.recovery && rec.createdAt === 500000 * HOUR,
    "the launched account is not read from its sealed record: " + JSON.stringify(rec)
  );
  assert((await Vx.pf.personaFidRecord("p_other")) === null, "a launch still proving (no fid) became an account");
  assert((await Vx.pf.allPersonaFids()).length === 1 && (await Vx.pf.personaOfFid(7000009)) === persona.id && (await Vx.pf.ownFidSignerPublicKey(7000009)) === "c3".repeat(32), "the merged view is not used by every reader");
  assert(LU.vaultWrites.length === 0, "reading the launched account wrote personaFids");
  // no launch path can write personaFids, and one fid stays one persona across the vault AND the sealed records
  let threw = null;
  try {
    await Vx.pf.recordPersonaFid({ ...rec });
  } catch (e) {
    threw = e.message;
  }
  assert(threw && /never written to personaFids/.test(threw) && LU.vaultWrites.length === 0, "a launched account could be written to personaFids: " + threw);
  threw = null;
  try {
    await Vx.pf.recordPersonaFid({ personaId: "p_new", fid: 7000009, fname: null, origin: "fixture", custodyAddress: "0x" + "f1".repeat(20), signer: { kind: "neynar-managed", uuid: "u", derivedPubHex: "aa".repeat(32), derivedRegistered: false }, registrant: "x", funder: "y", createdAt: 1, mode: "fixture" });
  } catch (e) {
    threw = e.message;
  }
  assert(threw && /already mapped/.test(threw), "another account could take the launched account's fid: " + threw);
  // an unreadable sealed queue REFUSES — never "no launched accounts" (an account the guards did not know would fail open)
  const saved = LU.vstate;
  LU.vstate = null;
  threw = null;
  try {
    await Vx.pf.allPersonaFids();
  } catch (e) {
    threw = e.message;
  }
  LU.vstate = saved;
  assert(threw, "an unreadable sealed queue read as 'no launched accounts' (fail open)");
  // a store state with NO queue map at all holds no sealed record: no launched accounts, and no throw
  LU.vstate = {};
  const none = await Vx.pf.allPersonaFids();
  LU.vstate = saved;
  assert(Array.isArray(none) && none.length === 0, "a store with no queue map: " + JSON.stringify(none));
}
const Vx = await bundle(V_ENTRY, V_MOCKS);
await check("V1 (LP-1) the launched account (fid, custody, recovery, self-custody signer, accepted name) is READ from its sealed launch record by every personaFids reader — nothing writes personaFids for it (a layers-launch record is refused there), a launch still proving is no account, one fid stays one persona, and an unreadable queue refuses", () => mergedScenario(Vx));
await mutation("V1 / the merged view dropped (only the vault's records: the launched account vanishes from every guard)", async () => {
  const M = await bundle(V_ENTRY, V_MOCKS, { "lib/fc/personaFid.ts": [["  return [...items, ...launched];", "  return [...items];"]] });
  await mergedScenario(M);
});
await check("V2 the sealed-record kind personaFid.ts reads is the queue's (a DELIBERATE DUPLICATE pair)", () => {
  const q = /export const LAUNCH_KIND = "([^"]+)"/.exec(readFileSync(path.join(ROOT, "lib/zk/anon/queue.ts"), "utf8"))?.[1];
  const f = /const LAUNCH_RECORD_KIND = "([^"]+)"/.exec(readFileSync(path.join(ROOT, "lib/fc/personaFid.ts"), "utf8"))?.[1];
  assert(q && q === f, `queue "${q}" / personaFid "${f}"`);
});

// ================================================================================================ T — the thin relay
console.log("\nT — the thin relay");
LU.simCasts = [];
const T_MOCKS = {
  "server-only": `export {};`,
  "lib/fc/chain/source": F_MOCKS["lib/fc/chain/source"],
  "lib/fc/writes": `export function recordSimNetworkCast(c) { globalThis.__LU.simCasts.push(c); return { deduped: false }; }`,
};
const T_ENTRY = `export * as relay from "@/lib/fc/thinRelay";\n`;
async function relayScenario(Tx) {
  Tx.relay.resetThinRelay();
  LU.simCasts = [];
  const signer = edKey();
  LU.chain.keys = [{ key: signer.pubHex, keyType: 1, requestFid: 7000000, addedAt: 1, removedAt: null }];
  const msg = (key, over = {}) => {
    const m = { type: "CastAdd", fid: 7000001, signerPubKey: key.pubHex, timestamp: Date.now(), text: "hello from my own account", parentHash: null, quoteHash: null, ...over };
    return { ...m, signature: edSign(null, Buffer.from(Tx.relay.thinCanonical("fixture", m), "utf8"), key.privateKey).toString("hex") };
  };
  const ok = await Tx.relay.submitThinMessage("fixture", msg(signer));
  assert(ok.ok && LU.simCasts.length === 1 && LU.simCasts[0].fid === 7000001, "the registered key's CastAdd was not accepted: " + JSON.stringify(ok));
  const wrong = await Tx.relay.submitThinMessage("fixture", msg(edKey()));
  assert(!wrong.ok && wrong.code === "wrong-key", "a key the chain does not list was accepted: " + JSON.stringify(wrong));
  const bad = msg(signer);
  bad.text = "tampered after signing";
  const tam = await Tx.relay.submitThinMessage("fixture", bad);
  assert(!tam.ok && tam.code === "bad-signature", "a tampered message was accepted: " + JSON.stringify(tam));
  const stale = await Tx.relay.submitThinMessage("fixture", msg(signer, { timestamp: Date.now() - 3 * HOUR }));
  assert(!stale.ok && stale.code === "stale", "a backdated message was accepted");
  const live = await Tx.relay.submitThinMessage("live", msg(signer));
  assert(!live.ok && live.code === "live", "the live universe was accepted");
  assert(LU.simCasts.length === 1, "a refused message reached the sim network");
}
const Tx = await bundle(T_ENTRY, T_MOCKS);
await check("T1 the registered key's CastAdd lands in the sim network; a wrong key, a tampered message, a backdated one and the live universe are refused and reach nothing", () => relayScenario(Tx));
await mutation("T1 / the relay skips the KeyRegistry check", async () => {
  const M = await bundle(T_ENTRY, T_MOCKS, { "lib/fc/thinRelay.ts": [["if (!account || !hasActiveKey(keys, m.signerPubKey))", "if (!account)"]] });
  await relayScenario(M);
});

// ================================================================================================ M — post mode
console.log("\nM — post mode after launch (D2)");
LU.pm = { origin: "layers-launch", explicit: null };
const M_MOCKS = {
  "server-only": `export {};`,
  "lib/identity/keystore": `export function getPersona(id) { const L = globalThis.__LU; return id === L.persona.id ? { ...L.persona, kind: "public", postMode: L.pm.explicit ?? undefined } : null; } export function isOwnPersona(id) { return id === globalThis.__LU.persona.id; } export function updatePersona() { return null; }`,
  "lib/identity/personaKind": `export function kindOf() { return "public"; }`,
  "lib/adapters/mock/store": `export const SEED_VIEWER = { personas: [] }; export const personaById = new Map();`,
  "lib/world-flag": `export function isEmptyWorld() { return false; }`,
  "lib/world": `export function isRealPersona() { return false; }`,
  "lib/fc/personaFid": `export async function personaFidRecord(id) { const L = globalThis.__LU; return id === L.persona.id && L.pm.origin ? { personaId: id, fid: 7000001, origin: L.pm.origin, mode: "fixture" } : null; }`,
};
Object.assign(M_MOCKS, {
  "lib/identity/rootRoster": `export async function ownRootId() { return "root_own"; } export async function rootOfPersona() { return "root_own"; } export async function personaRecord() { return null; } export async function recordPersona() {}`,
  "lib/identity/roster": `export async function syncRoster() {}`,
  "lib/session": `export async function getSession() { return { rootId: null, personas: [], active: null }; }`,
  "lib/activePersona": `export function activeSeedPersonaId() { return null; }`,
});
const M_ENTRY = `export * as pm from "@/lib/identity/postMode";\n`;
async function modeScenario(Mx) {
  LU.pm = { origin: "layers-launch", explicit: null };
  assert((await Mx.pm.effectivePostMode(persona.id)) === "anon", "a launched persona with no choice is not preset anon");
  const v = await Mx.pm.postModeView(persona.id);
  assert(v.launched === true && v.choiceRequired === true && v.mode === "anon" && v.options.includes("direct"), "view: " + JSON.stringify(v));
  LU.pm.explicit = "direct";
  const d = await Mx.pm.postModeView(persona.id);
  assert(d.choiceRequired === false && d.mode === "direct", "an explicit direct still requires a choice: " + JSON.stringify(d));
  LU.pm = { origin: "fixture", explicit: null };
  assert((await Mx.pm.effectivePostMode(persona.id)) === "direct", "an ACQUIRED account no longer defaults to direct");
  assert((await Mx.pm.postModeView(persona.id)).choiceRequired === false, "an acquired account requires a choice");
}
const Mx = await bundle(M_ENTRY, M_MOCKS);
await check("M1 a launched persona is PRESET anon and must choose (choiceRequired); 'direct' is offered and, once chosen, the choice is made; an acquired account still defaults to direct", () => modeScenario(Mx));
await mutation("M1 / the launched preset removed (a launched persona defaults to direct like any account)", async () => {
  const M = await bundle(M_ENTRY, M_MOCKS, { "lib/identity/postMode.ts": [['if (origin === "layers-launch") return "anon";', ""]] });
  await modeScenario(M);
});
await check("M2 the picker's 'going back to anon' sentence is the server's, word for word (a client component cannot import the server's)", () => {
  const server = /DIRECT_IS_ONE_WAY_SENTENCE = "([^"]+)"/.exec(readFileSync(path.join(ROOT, "lib/identity/postMode.ts"), "utf8"))?.[1];
  const client = /DIRECT_IS_ONE_WAY_SENTENCE = "([^"]+)"/.exec(readFileSync(path.join(ROOT, "components/PostModePicker.tsx"), "utf8"))?.[1];
  assert(server && server === client && server === "Going back to anon after posting directly is weak: your writing style is public now.", `server "${server}" / picker "${client}"`);
});

// ================================================================================================ Q — the pending launch record
console.log("\nQ — the pending launch record rides the sealed queue on its deferred schedule");
LU.state = { zkQueue: new Map() };
LU.persisted = [];
const Q_MOCKS = {
  "server-only": `export {};`,
  "lib/adapters/mock/store": `export async function hydrate() {} export function state() { return globalThis.__LU.state; } export async function persistNs(ns) { globalThis.__LU.persisted.push(ns); }`,
};
const Q_ENTRY = `export * as q from "@/lib/zk/anon/queue";\n`;
const sampleLaunch = () => ({ mode: "fixture", personaId: persona.id, launchCommit: "cc".repeat(32), request: "{}", custody: "0x" + "a1".repeat(20), recovery: "0x" + "b2".repeat(20), signerKey: "c3".repeat(32), fname: "launcher-one", profile: { displayName: "", bio: "", pfpUrl: "" }, quoteOriginals: [], window: "w1", confirmedAt: Date.now(), stage: "proving", stageAt: Date.now(), nextAt: 0, fid: null, registeredHour: null, batchHash: null, revealed: 0, history: { launchCastHash: null, quoted: [] }, attempts: 0, reason: null, log: [] });
async function queueScenario(Qx) {
  LU.state = { zkQueue: new Map() };
  LU.persisted = [];
  await Qx.q.putLaunchRecord(sampleLaunch());
  assert(LU.persisted.length === 0, "the launch record was persisted at the click: " + LU.persisted.join(","));
  assert((await Qx.q.launchRecords()).length === 1, "the record is not kept in memory");
  const st = await Qx.q.queueStatus();
  assert(st.items.length === 0 && st.sent === 0, "queueStatus lists the launch record as a submission: " + JSON.stringify(st.items));
  assert((await Qx.q.anonSlotsUsed("fixture", 40)).size === 0, "the launch record holds an anon slot");
  await Qx.q.pruneSettledAnonItems("fixture", 40);
  assert((await Qx.q.launchRecords()).length === 1, "the launch record was pruned with the anon submissions");
  const u = await Qx.q.updateLaunchRecord("cc".repeat(32), { stage: "queued" }, "proved");
  assert(u && u.stage === "queued" && u.log.length === 1 && LU.persisted.length === 0, "an update wrote at once or lost the log");
}
const Qx = await bundle(Q_ENTRY, Q_MOCKS);
await check("Q1 putLaunchRecord keeps the record in memory and persists nothing at the click; queueStatus never lists it; it holds no anon slot; the anon pruning never drops it; updates schedule (never perform) the write", () => queueScenario(Qx));
await mutation("Q1 / queueStatus lists the launch record", async () => {
  const M = await bundle(Q_ENTRY, Q_MOCKS, { "lib/zk/anon/queue.ts": [["q.claimKind !== ATTRIBUTION_KIND && q.claimKind !== LAUNCH_KIND", "q.claimKind !== ATTRIBUTION_KIND"]] });
  await queueScenario(M);
});
await mutation("Q1 / the pruning drops every settled record of a closed window (the anon-post filter removed)", async () => {
  const M = await bundle(Q_ENTRY, Q_MOCKS, { "lib/zk/anon/queue.ts": [['    if (q.mode !== mode || q.claimKind !== "anon-post") continue;\n    if (q.status !== "sent" && q.status !== "refused") continue; // a queued submission will still be sent', '    if (q.mode !== mode) continue;\n    if (q.status !== "sent" && q.status !== "refused") continue; // a queued submission will still be sent']] });
  await queueScenario(M);
});

async function outcomesScenario(Qx2) {
  LU.state = { zkQueue: new Map() };
  const h = (c) => c.repeat(64);
  const sub = (castHash, status, outcome) => LU.state.zkQueue.set("zkq_" + castHash.slice(0, 8), { id: "zkq_" + castHash.slice(0, 8), mode: "fixture", claimKind: "anon-post", personaId: "anon", epoch: 1, envelope: { publicInputs: { castHash } }, notBefore: 0, motivatedAt: 0, createdAt: 0, status, sentAt: null, outcome });
  const att = (castHash, settled) => LU.state.zkQueue.set("zka_" + castHash, { id: "zka_" + castHash, mode: "fixture", claimKind: "anon-attribution", personaId: "anon", epoch: 0, envelope: null, notBefore: 0, motivatedAt: 0, createdAt: 0, status: "sent", sentAt: null, outcome: null, attribution: { secret: "s", commitment: "c", text: "t", personaId: persona.id, ...(settled ? { settled } : {}) } });
  sub(h("a"), "queued", null);
  sub(h("b"), "sent", "accepted");
  sub(h("c"), "sent", "replay");
  sub(h("d"), "sent", "refused");
  sub(h("e"), "refused", "transport-error");
  att(h("f"), { status: "sent", outcome: "refused", sentAt: 1 }); // pruned: its outcome kept on the sealed record
  att(h("9"), { status: "sent", outcome: "accepted", sentAt: 1 });
  att(h("8"), null); // no submission yet: still wanted
  const m = await Qx2.q.anonPostOutcomes([h("a"), h("b"), h("c"), h("d"), h("e"), h("f"), h("9"), h("8")]);
  const want = { a: "queued", b: "accepted", c: "replay", d: "refused", e: "refused", f: "refused", 9: "accepted", 8: "queued" };
  for (const [k, v] of Object.entries(want)) assert(m.get(h(k)) === v, `post ${k}: ${m.get(h(k))}, want ${v}`);
}
await check("Q2 (W2-LAUNCH-REVEAL-200) each anon post's outcome, device-local: queued (or still wanted) and accepted are on the way, a replay is undecided, a refusal — on the submission or kept on its pruned sealed record — is NEVER 'on the way'", () => outcomesScenario(Qx));
await mutation("Q2 / a refused post counted as on the way", async () => {
  const M = await bundle(Q_ENTRY, Q_MOCKS, { "lib/zk/anon/queue.ts": [[': status === "sent" && outcome === "replay" ? "replay" : "refused";', ': status === "sent" && outcome === "replay" ? "replay" : "queued";']] });
  await outcomesScenario(M);
});

// ================================================================================================ L — the tick, end to end
console.log("\nL — the launch tick, end to end on the in-process validator");
LU.lstate = { zkQueue: new Map() };
LU.recorded = [];
LU.published = [];
LU.fnameFail = 0;
const L_MOCKS = {
  "server-only": `export {};`,
  "lib/identity/keys": KEYS_MOCK,
  "lib/adapters/mock/store": `export async function hydrate() {} export function state() { return globalThis.__LU.lstate; } export async function persistNs() {}`,
  "lib/zk/validatorClient": `
export async function fetchEpoch() { return { epochMs: 21600000, msRemaining: 21000000, epoch: 1 }; }
export async function fetchAnonCasts(mode) { const r = await fetch(process.env.VALIDATOR_URL + "/zk/anon-casts?mode=" + mode); return (await r.json()).casts; }`,
  // fix LP-1: the tick must never write personaFids — recordPersonaFid is a recorder, and the check asserts it stays empty
  "lib/fc/personaFid": `
const L = globalThis.__LU;
export async function recordPersonaFid(rec) { L.recorded.push(JSON.parse(JSON.stringify(rec))); }
export async function personaFidRecord() { return null; }
export async function mainNameDerivation() { return null; }`,
  "lib/fc/writes": `
export async function publishFcCast(text, kind, parent, opts) { globalThis.__LU.published.push({ text, kind, quoteOf: opts?.quoteOf ?? null, personaId: opts?.personaId }); return { hash: "0xpub" + globalThis.__LU.published.length, deduped: false, mode: "fixture", fid: 1 }; }
export function recordSimNetworkCast() { return { deduped: false }; }`,
  "lib/zk/gate": `export function wantedLaunchRequests() { return []; } export function requestLaunchProof() { return { ok: true }; }`,
  "lib/identity/personaKind": REQ_MOCKS["lib/identity/personaKind"],
  "lib/identity/keystore": `export function getPersona(id) { const L = globalThis.__LU; return id === L.persona.id ? { ...L.persona, kind: "public", nonce: "n" } : null; } export function listPersonas() { const L = globalThis.__LU; return [{ ...L.persona, kind: "public", nonce: "n" }]; }`,
};
const L_ENTRY = `export * as tick from "@/lib/launch/tick";\nexport * as q from "@/lib/zk/anon/queue";\nexport * as relay from "@/lib/fc/thinRelay";\nexport * as chain from "@/lib/fc/chain/fixture";\n`;
const hourNow = () => Math.floor(Date.now() / HOUR) * HOUR;

/**
 * A fresh launch world on the in-process validator. The persona's two relayed posts and a sibling's are OLD (400 hours
 * ago), each sealed in this device's queue; `strangers` other people's relayed posts are all NEWER (over 200 of them push
 * the persona's out of the newest-200 feed list). The request is built and queued at the registrar; `record` puts the
 * pending launch record (at `recordStage`, its submission accepted).
 */
async function launchWorld(Lx, { strangers = 0, record = true, recordStage = "queued", stageAt = Date.now() } = {}) {
  registrar.resetFixture(db, "fixture");
  db.prepare("DELETE FROM zk_anon_casts WHERE mode = 'fixture'").run();
  LU.lstate = { zkQueue: new Map() };
  LU.recorded = [];
  LU.published = [];
  LU.fnameFail = 0;
  Lx.relay.resetThinRelay();
  Lx.chain.resetChainFixtureCache(); // the simulated chain was just reset: a cached key list would describe the old one
  Lx.tick.resetLaunchReads(); // a new world: the next tick reads both public lists from the start
  const base = hourNow() - 400 * HOUR;
  const mk = (personaId, i) => {
    const secret = randomBytes(32).toString("hex");
    const castHash = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, attribution_commitment) VALUES ('fixture', ?, ?, 1, ?, ?, 1, 'relayed', ?)").run(castHash, personaId + " post " + i, base + i * HOUR, "0xanonl" + castHash.slice(0, 8), createHash("sha256").update("layers-anon-attribution/1|" + secret).digest("hex"));
    LU.lstate.zkQueue.set("zka_" + castHash, { id: "zka_" + castHash, mode: "fixture", claimKind: "anon-attribution", personaId: "anon", epoch: 0, envelope: null, notBefore: 0, motivatedAt: 0, createdAt: 0, status: "sent", sentAt: null, outcome: null, attribution: { secret, commitment: "c", text: "t", personaId } });
    return castHash;
  };
  const mine = [mk(persona.id, 0), mk(persona.id, 1)];
  const sib = mk("p_sibling", 2);
  if (strangers) {
    const ins = db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, attribution_commitment) VALUES ('fixture', ?, ?, 1, ?, ?, 1, 'relayed', ?)");
    db.exec("BEGIN");
    for (let i = 0; i < strangers; i++) ins.run(randomBytes(32).toString("hex"), "a stranger's post " + i, hourNow() - (i % 300) * HOUR, "0xst" + i, randomBytes(32).toString("hex"));
    db.exec("COMMIT");
  }
  const b = await Rx.req.buildLaunchRequest(persona.id, {}, "fixture", Date.now());
  assert(b.ok, "build: " + b.reason);
  const t0 = registrar.simNow(db, "fixture");
  registrar.enqueueLaunch(db, "fixture", b.request, b.launchCommit, 1);
  if (record) {
    LU.lstate.zkQueue.set("zkq_launch", { id: "zkq_launch", mode: "fixture", claimKind: "persona-launch", personaId: "anon", epoch: 1, envelope: { publicInputs: { launchCommit: b.launchCommit } }, notBefore: 0, motivatedAt: 0, createdAt: 0, status: "sent", sentAt: 1, outcome: "accepted" });
    await Lx.q.putLaunchRecord({ mode: "fixture", personaId: persona.id, launchCommit: b.launchCommit, request: b.request, custody: b.custody, recovery: b.recovery, signerKey: b.signerKey, fname: b.fname, profile: { displayName: "Launcher One", bio: "a persona", pfpUrl: "https://example.com/p.png" }, quoteOriginals: [mine[1]], window: "w1", confirmedAt: Date.now(), stage: recordStage, stageAt, nextAt: 0, fid: null, registeredHour: null, batchHash: null, revealed: 0, history: { launchCastHash: null, quoted: [] }, attempts: 0, reason: null, log: [] });
  }
  return { b, t0, mine, sib };
}
const runBatch = (t0) => {
  registrar.advanceClock(db, "fixture", Math.max(0, t0 + 48 * HOUR - registrar.simNow(db, "fixture")));
  registrar.runDueBatches(db, "fixture");
};
const recOf = async (Lx) => (await Lx.q.launchRecords()).filter((r) => r.personaId === persona.id).sort((a, b) => b.confirmedAt - a.confirmedAt)[0];
/** tick until the record reaches `stage` (at most `max` ticks) */
async function tickUntil(Lx, stage, max = 8) {
  for (let i = 0; i < max; i++) {
    const r = await recOf(Lx);
    if (r && r.stage === stage) return r;
    await Lx.tick.launchTick("fixture", { now: Date.now() + 24 * HOUR });
  }
  const r = await recOf(Lx);
  assert(r && r.stage === stage, `never reached ${stage}: ${r?.stage} — ${r?.reason}`);
  return r;
}

async function tickScenario(Lx) {
  const { b, t0, mine, sib } = await launchWorld(Lx);
  const later = Date.now() + 24 * HOUR;
  await Lx.tick.launchTick("fixture", { now: later });
  assert((await recOf(Lx)).stage === "waiting", "the accepted submission did not move it to waiting: " + (await recOf(Lx)).stage);
  await Lx.tick.launchTick("fixture", { now: later });
  assert((await recOf(Lx)).stage === "waiting", "registered before the registrar's batch");
  runBatch(t0);
  const fid = simchain.fidOfCustody(db, "fixture", b.custody);
  assert(fid, "the registrar did not register it");
  const v0 = vlog.length;
  await Lx.tick.launchTick("fixture", { now: later });
  const r1 = await recOf(Lx);
  assert(r1.stage === "registered" && r1.fid === fid, "not recorded as registered: " + JSON.stringify([r1.stage, r1.fid, r1.reason]));
  assert(r1.custody === b.custody && r1.recovery === b.recovery && r1.signerKey === keys.signer.pubHex, "the sealed record is not this persona's account");
  // fix LP-1: the moment the registration is noticed NOTHING is written to personaFids (the sealed launch record IS the
  // account's record, on the queue's deferred write) and NOTHING is read about the new fid — only the uniform reads ran
  assert(LU.recorded.length === 0, "the registration was written to personaFids at once (the beacon): " + JSON.stringify(LU.recorded));
  const seen = vlog.slice(v0);
  assert(!seen.some((l) => /\/sim-chain\//.test(l)), "the device read the new fid off the chain the moment it noticed it: " + seen.filter((l) => /sim-chain/.test(l)).join(", "));
  assert(seen.some((l) => l.startsWith("GET /registrar/registrations")) && seen.some((l) => l.startsWith("GET /registrar/anon-casts")), "positive control: the uniform reads did not run: " + seen.join(", "));
  await Lx.tick.launchTick("fixture", { now: later + 1000 });
  const r2 = await recOf(Lx);
  assert(r2.stage === "revealed" && r2.revealed === 2 && r2.batchHash && !r2.leftOut, "not revealed: " + JSON.stringify([r2.stage, r2.revealed, r2.reason, r2.leftOut]));
  const rws = db.prepare("SELECT cast_hash, attributed_fid, attributed_batch FROM zk_anon_casts WHERE mode = 'fixture'").all();
  for (const h of mine) assert(rws.find((x) => x.cast_hash === h).attributed_fid === fid, "a post of the persona was not revealed");
  assert(rws.find((x) => x.cast_hash === sib).attributed_fid === null, "the SIBLING's post was revealed");
  await Lx.tick.launchTick("fixture", { now: later + 2000 });
  const r3 = await recOf(Lx);
  assert(r3.stage === "profiled", "not profiled: " + JSON.stringify([r3.stage, r3.reason]));
  // fix LP-1: the accepted name rides the SEALED record (no personaFids save at name time either)
  assert(simchain.fidInfo(db, "fixture", fid).fname === b.fname && r3.fnameSet === b.fname && LU.recorded.length === 0, "the name was not set on the simulated name server, or not kept on the sealed record");
  assert(Lx.relay.userDataFor(fid).display === "Launcher One", "the profile did not go through the thin relay");
  await Lx.tick.launchTick("fixture", { now: later + 3000 });
  const r4 = await recOf(Lx);
  assert(r4.stage === "done", "not done: " + JSON.stringify([r4.stage, r4.reason]));
  assert(LU.published.length === 2 && LU.published[0].quoteOf === null && /\/proof\/\d+$/.test(LU.published[0].text) && /revealed/.test(LU.published[0].text), "the launch cast is not first, linking the proof: " + JSON.stringify(LU.published));
  const quoted = LU.published[1];
  assert(quoted.quoteOf === "0xanonl" + mine[1].slice(0, 8), "the quote is not of the chosen original (by its network hash): " + JSON.stringify(quoted));
  assert(LU.published.every((p) => p.personaId === persona.id), "a history cast went out as another account");
}
const Lx = await bundle(L_ENTRY, L_MOCKS);
await check("L1 the tick walks a launch end to end on the in-process validator: waiting → (nothing before the batch) → registered — with NO personaFids write and NO per-fid chain read (LP-1) — → BOTH of the persona's posts revealed in one batch, the sibling's not → the custody-signed name (kept on the sealed record) and the profile → the launch cast, then the chosen quote", () => tickScenario(Lx));
await mutation("L1 / the batch reveal gathers EVERY sealed secret (the persona filter removed)", async () => {
  const M = await bundle(L_ENTRY, L_MOCKS, { "lib/zk/anon/queue.ts": [["if (q.claimKind !== ATTRIBUTION_KIND || !q.attribution || q.attribution.personaId !== personaId || q.mode !== mode) continue;", "if (q.claimKind !== ATTRIBUTION_KIND || !q.attribution || q.mode !== mode) continue;"]] });
  await tickScenario(M);
});
await mutation("L1 / the registration noticed with a per-fid chain read again (the LP-1 beacon)", async () => {
  const M = await bundle(L_ENTRY, L_MOCKS, {
    "lib/launch/tick.ts": [
      [
        "    if (hit.custody !== rec.custody || !hit.keys.includes(rec.signerKey) || hit.recovery !== rec.recovery) throw new Error(\"the registered account does not list this persona's key\");",
        "    await (await import(\"@/lib/fc/chain/source\")).chainSource(mode).keysOf(hit.fid);\n    if (hit.custody !== rec.custody || !hit.keys.includes(rec.signerKey) || hit.recovery !== rec.recovery) throw new Error(\"the registered account does not list this persona's key\");",
      ],
    ],
  });
  await tickScenario(M);
});
await mutation("L1 / the registration written to personaFids at once again (the LP-1 beacon)", async () => {
  const M = await bundle(L_ENTRY, L_MOCKS, {
    "lib/launch/tick.ts": [
      [
        'await moveTo(rec, "registered", { fid: hit.fid, registeredHour: hit.hour, nextAt: await jitterFrom(now) }, `registered as fid ${hit.fid} (simulated chain)`, report);',
        'await (await import("@/lib/fc/personaFid")).recordPersonaFid({ personaId: rec.personaId, fid: hit.fid, origin: "layers-launch" } as never);\n    await moveTo(rec, "registered", { fid: hit.fid, registeredHour: hit.hour, nextAt: await jitterFrom(now) }, `registered as fid ${hit.fid} (simulated chain)`, report);',
      ],
    ],
  });
  await tickScenario(M);
});

async function tickScenarioWrongKey(Lx2) {
  // the account the registrar made for this custody lists ANOTHER key: the tick must refuse it, and say so
  const { t0, b } = await launchWorld(Lx2, { recordStage: "waiting" });
  runBatch(t0);
  db.prepare("UPDATE sim_chain_keys SET key = ? WHERE mode = 'fixture' AND key = ?").run("ee".repeat(32), b.signerKey);
  await Lx2.tick.launchTick("fixture", { now: Date.now() + 24 * HOUR });
  const r = await recOf(Lx2);
  assert(r.stage === "waiting" && r.fid === null, "an account whose KeyRegistry does not list the persona's key was taken as the persona's: " + JSON.stringify([r.stage, r.fid]));
  // positive control: the tick DID see the registration and refused it (not merely missed it)
  assert(/does not list this persona's key/.test(r.reason ?? ""), "the tick never reached the check (reason: " + r.reason + ")");
}
await check("L2 an account whose registered keys are NOT the persona's key is never taken as the persona's (checked locally from the registrations list; the tick refuses, and retries)", () => tickScenarioWrongKey(Lx));
await mutation("L2 / the tick takes the account without checking it lists the persona's key", async () => {
  const M = await bundle(L_ENTRY, L_MOCKS, { "lib/launch/tick.ts": [["if (hit.custody !== rec.custody || !hit.keys.includes(rec.signerKey) || hit.recovery !== rec.recovery)", "if (false)"]] });
  await tickScenarioWrongKey(M);
});

async function olderThan200Scenario(Lx3) {
  // 620 newer posts by other people: the persona's two are NOT on the newest-200 feed list (positive control below)
  const { t0, b, mine } = await launchWorld(Lx3, { strangers: 620 });
  const newest = (await (await fetch(VBASE + "/zk/anon-casts?mode=fixture")).json()).casts;
  assert(newest.length === 200 && !newest.some((c) => mine.includes(c.castHash)), "positive control: the persona's posts are on the newest-200 list, so this check would prove nothing");
  await Lx3.tick.launchTick("fixture", { now: Date.now() + 24 * HOUR });
  runBatch(t0);
  await tickUntil(Lx3, "revealed");
  const r = await recOf(Lx3);
  const fid = simchain.fidOfCustody(db, "fixture", b.custody);
  assert(r.revealed === 2, "the reveal left out the persona's older posts: revealed " + r.revealed + " — " + r.reason);
  for (const h of mine) assert(db.prepare("SELECT attributed_fid FROM zk_anon_casts WHERE cast_hash = ?").get(h).attributed_fid === fid, "an older post of the persona was not revealed");
  const m = Lx3.tick.anonMirror("fixture");
  assert(m && m.complete && m.rows.size === 3, "the own-rows mirror does not hold this device's three posts after reading 2 pages: " + (m && m.rows.size));
}
await check("L3 (W2-LAUNCH-REVEAL-200) with 620 newer posts by other people, the persona's two OLDER posts — off the newest-200 feed list — are still revealed in the batch: the tick pages the complete list and keeps this device's own rows", () => olderThan200Scenario(Lx));
await mutation("L3 / the reveal's 'relayed' oracle is the newest-200 feed list again", async () => {
  const M = await bundle(L_ENTRY, L_MOCKS, {
    "lib/launch/tick.ts": [
      [
        "const ready = secrets.filter((s) => mirror.rows.has(s.castHash));",
        'const { fetchAnonCasts } = await import("@/lib/zk/validatorClient");\n    const newest200 = new Set((await fetchAnonCasts(mode)).map((r) => r.castHash));\n    const ready = secrets.filter((s) => newest200.has(s.castHash));',
      ],
    ],
  });
  await olderThan200Scenario(M);
});

async function adoptionScenario(Lx4) {
  // the registrar ACCEPTED the request, but this device lost its launch record (a restart inside the deferred persist)
  const { t0, b, mine } = await launchWorld(Lx4, { record: false });
  // a re-proof of the same launch is accepted by the registrar (idempotent), not refused into "failed"
  const re = registrar.enqueueLaunch(db, "fixture", b.request, b.launchCommit, 1);
  assert(re.existing === "queued", "the registrar refused a repeat for the same custody");
  runBatch(t0);
  assert((await Lx4.q.launchRecords()).length === 0, "positive control: a record exists, so this check would prove nothing");
  await Lx4.tick.launchTick("fixture", { now: Date.now() + 24 * HOUR });
  const r = await recOf(Lx4);
  const fid = simchain.fidOfCustody(db, "fixture", b.custody);
  assert(r && r.adopted === true && r.stage === "registered" && r.fid === fid && r.custody === b.custody && r.recovery === b.recovery, "the persona's registered account was not adopted: " + JSON.stringify(r && [r.stage, r.fid, r.adopted]));
  await tickUntil(Lx4, "revealed");
  for (const h of mine) assert(db.prepare("SELECT attributed_fid FROM zk_anon_casts WHERE cast_hash = ?").get(h).attributed_fid === fid, "the adopted launch did not reveal the persona's posts");
}
await check("L4 (W2-LAUNCH-NO-ADOPTION) a launch whose record this device LOST is adopted from the registrations list (the persona's derived custody, key and recovery on a registered account) and walks on to the reveal; a re-proof of it is accepted by the registrar", () => adoptionScenario(Lx));
await mutation("L4 / no adoption (a lost record leaves the persona unlaunchable for good)", async () => {
  const M = await bundle(L_ENTRY, L_MOCKS, { "lib/launch/tick.ts": [["  if (regs && regs.length) {\n    try {\n      report.adopted = await adoptOrphans(", "  if (false) {\n    try {\n      report.adopted = await adoptOrphans("]] });
  await adoptionScenario(M);
});

async function neverTerminalScenario(Lx5) {
  const { t0, b } = await launchWorld(Lx5);
  await Lx5.tick.launchTick("fixture", { now: Date.now() + 24 * HOUR });
  runBatch(t0);
  await tickUntil(Lx5, "registered");
  // the reveal fails on every attempt (the key is removed from the account for a while): 22 attempts, past the old 20
  db.prepare("UPDATE sim_chain_keys SET removed_at = 1 WHERE mode = 'fixture' AND key = ?").run(b.signerKey);
  for (let i = 0; i < 22; i++) await Lx5.tick.launchTick("fixture", { now: Date.now() + 24 * HOUR });
  const r = await recOf(Lx5);
  assert(r.stage === "registered" && r.attempts >= 22, "a step after registration ended the launch: " + JSON.stringify([r.stage, r.attempts]));
  assert(/^Your account exists, but revealing your anonymous posts hasn't gone through yet/.test(r.reason ?? "") && /Totem keeps trying/.test(r.reason ?? ""), "the reason does not say what exists: " + r.reason);
  assert(r.nextAt > Date.now() + 60 * 60_000, "no back-off between retries (next at +" + Math.round((r.nextAt - Date.now()) / 60000) + " min)");
  // the key is back: the very next attempt reveals
  db.prepare("UPDATE sim_chain_keys SET removed_at = NULL WHERE mode = 'fixture' AND key = ?").run(b.signerKey);
  await tickUntil(Lx5, "revealed");
}
await check("L5 (UX-L6) after registration a failing step is NEVER terminal: 22 failed reveals later the launch is still 'registered', says the account exists and Totem keeps trying, backs off between attempts — and reveals as soon as it can", () => neverTerminalScenario(Lx));
await mutation("L5 / a step after registration gives up after 20 attempts again", async () => {
  const M = await bundle(L_ENTRY, L_MOCKS, { "lib/launch/tick.ts": [["if (POST_REGISTRATION.has(rec.stage) || rec.fid !== null) {", "if (false) {"]] });
  await neverTerminalScenario(M);
});

async function stalledScenario(Lx6) {
  // accepted 73 hours ago, never registered (the registrar is late, or dropped it): KEEP WATCHING, never "failed"
  await launchWorld(Lx6, { recordStage: "waiting", stageAt: Date.now() - 73 * HOUR });
  await Lx6.tick.launchTick("fixture", { now: Date.now() + 24 * HOUR });
  const r = await recOf(Lx6);
  assert(r.stage === "waiting" && r.reason === Lx6.tick.STALLED_REASON, "a launch past its promise was ended: " + JSON.stringify([r.stage, r.reason]));
  assert(/keeps watching/.test(r.reason) && /launch again/.test(r.reason), "the stalled words do not say both: " + r.reason);
}
await check("L6 (W2-LAUNCH-NO-ADOPTION) a launch still unregistered 72 hours after the registrar accepted it keeps WAITING (watched, never ended), and says the owner may launch again", () => stalledScenario(Lx));
await mutation("L6 / a launch past 72 hours is ended as 'failed' again", async () => {
  const M = await bundle(L_ENTRY, L_MOCKS, { "lib/launch/tick.ts": [["await updateLaunchRecord(rec.launchCommit, { reason: STALLED_REASON }, \"no registration after \"", "await updateLaunchRecord(rec.launchCommit, { stage: \"failed\", reason: STALLED_REASON }, \"no registration after \""]] });
  await stalledScenario(M);
});

async function fnameTransientScenario(Lx7) {
  const { t0, b } = await launchWorld(Lx7);
  await Lx7.tick.launchTick("fixture", { now: Date.now() + 24 * HOUR });
  runBatch(t0);
  await tickUntil(Lx7, "revealed");
  const fid = simchain.fidOfCustody(db, "fixture", b.custody);
  LU.fnameFail = 1; // the name server answers 500 "name not recorded" once
  await Lx7.tick.launchTick("fixture", { now: Date.now() + 24 * HOUR });
  const r = await recOf(Lx7);
  assert(LU.fnameFail === 0, "positive control: the name server was never asked");
  assert(r.stage === "revealed" && r.attempts === 1 && /setting its name and profile hasn't gone through yet/.test(r.reason ?? ""), "a name-server error was read as 'name taken': " + JSON.stringify([r.stage, r.attempts, r.reason]));
  assert(simchain.fidInfo(db, "fixture", fid).fname === null, "the name was set despite the error");
  const done = await tickUntil(Lx7, "profiled");
  assert(simchain.fidInfo(db, "fixture", fid).fname === b.fname && done.fnameSet === b.fname, "the retry did not set the name");
}
await check("L7 (W2-LAUNCH-FNAME-TRANSIENT) a name-server error (500) is retried — the account is not left nameless as if the name were taken — and the next attempt sets the name", () => fnameTransientScenario(Lx));
await mutation("L7 / every name-server error read as 'name taken' again", async () => {
  const M = await bundle(L_ENTRY, L_MOCKS, { "lib/fc/thinRelay.ts": [['res.status === 409 ? "refused" : res.status === 403 ? "wrong-key" : "chain"', 'res.status === 409 ? "refused" : res.status === 403 ? "wrong-key" : "refused"']] });
  await fnameTransientScenario(M);
});

// ================================================================================================ A — the single reveal
console.log("\nA — a launched account never reveals one post at a time (UX-L2)");
LU.astate = { zkQueue: new Map() };
LU.arec = null;
const A_MOCKS = {
  "server-only": `export {};`,
  // keystoreDir / vaultKeyBytes: the device-local crowd pins (lib/zk/localPins.ts) and the vault are in this bundle's graph
  "lib/identity/keystore": `export function isOwnPersona(id) { return id === globalThis.__LU.persona.id; } export function keystoreDir() { return process.env.KEYSTORE_DIR; } export function vaultKeyBytes() { return new Uint8Array(32).fill(9); }`,
  "lib/adapters/mock/store": `export const SEED_VIEWER = { personas: [] }; export async function hydrate() {} export function state() { return globalThis.__LU.astate; } export async function persistNs() {}`,
  "lib/fc/personaFid": `export async function personaFidRecord() { return globalThis.__LU.arec; }`,
  "lib/identity/keys": KEYS_MOCK,
  "lib/identity/postMode": `export function handleOfPersona(id) { return id === globalThis.__LU.persona.id ? globalThis.__LU.persona.handle : null; }`,
};
const A_ENTRY = `export * as attr from "@/lib/zk/anonAttribution";\n`;
async function singleRevealScenario(Ax) {
  const castHash = randomBytes(32).toString("hex");
  LU.astate = { zkQueue: new Map([["zka_" + castHash, { id: "zka_" + castHash, mode: "fixture", claimKind: "anon-attribution", personaId: "anon", epoch: 0, envelope: null, notBefore: 0, motivatedAt: 0, createdAt: 1, status: "sent", sentAt: null, outcome: null, attribution: { secret: "ab".repeat(32), commitment: "c", text: "t", personaId: persona.id } }]]) };
  const before = vlog.length;
  LU.arec = { personaId: persona.id, fid: 7000001, origin: "layers-launch", mode: "fixture" };
  const r = await Ax.attr.revealAttribution(castHash, persona.id, "fixture");
  assert(!r.ok && /reveals its anonymous posts together, at launch/.test(r.reason ?? ""), "a launched account revealed one post on its own: " + JSON.stringify(r));
  assert(vlog.length === before, "the refused single reveal still reached the validator: " + vlog.slice(before).join(", "));
  // positive control: an ACQUIRED account (not launched) does reach the validator's single reveal
  LU.arec = { personaId: persona.id, fid: 9000001, origin: "fixture", mode: "fixture" };
  const other = await Ax.attr.revealAttribution(castHash, persona.id, "fixture");
  assert(vlog.slice(before).some((l) => l.startsWith("POST /zk/anon/reveal")), "positive control: an acquired account's single reveal never reached the validator: " + JSON.stringify(other));
}
const Ax = await bundle(A_ENTRY, A_MOCKS);
await check("A1 (UX-L2) the one-post reveal REFUSES a launched account before anything is signed or sent (a launch reveals together, D7); an acquired account still reaches the validator (positive control)", () => singleRevealScenario(Ax));
await mutation("A1 / a launched account may reveal one post at a time again", async () => {
  const M = await bundle(A_ENTRY, A_MOCKS, { "lib/zk/anonAttribution.ts": [['if (rec.origin === "layers-launch") return { ok: false, reason: "a launched account reveals', 'if (false) return { ok: false, reason: "a launched account reveals']] });
  await singleRevealScenario(M);
});
// final verify (UX-L2, the UI half): the reveal picker never OFFERS a launched account (the server refusal above is the
// guard; this keeps the control from offering a choice that can only be refused). Structural: the picker's filter over
// GET /api/fc/persona's records excludes origin "layers-launch", and those records carry `origin` (merged view).
function revealPickerScan(src) {
  const i = src.indexOf('fetch("/api/fc/persona"');
  assert(i > 0, "the picker no longer reads GET /api/fc/persona — re-anchor this check");
  const filt = src.slice(i, i + 900);
  assert(/\.filter\([^\n]*rec\.origin !== "layers-launch"/.test(filt), "the reveal picker offers launched accounts (no origin filter on the persona records)");
  return "origin !== layers-launch";
}
await check("A2 (UX-L2, UI) the one-post reveal picker never offers a launched account", () => revealPickerScan(readFileSync(path.join(ROOT, "components/AnonRevealControl.tsx"), "utf8")));
await mutation("A2 / the picker's launched-account filter removed", async () => revealPickerScan(readFileSync(path.join(ROOT, "components/AnonRevealControl.tsx"), "utf8").replace(' && rec.origin !== "layers-launch"', "")));
// final verify (UX-L1, launch's half): the no-undo sentence shown before the typed confirm says that posts made while the
// launch is pending are revealed too (the composer's launch line says the same, lib/zk/gate.ts launchRevealSentence)
function noUndoScan(fn) {
  const s = fn("pat");
  assert(/^Launching @pat is permanent\./.test(s) && /no undo/.test(s), "the no-undo sentence lost its core: " + s);
  assert(/any you post as @pat before its account appears/.test(s), "the no-undo sentence does not say pending-launch posts are revealed too: " + s);
  return s.slice(0, 60) + "…";
}
await check("W1 (UX-L1) the no-undo sentence says posts made before the account appears become public too", () => noUndoScan(Px.req.noUndoSentence));
await mutation("W1 / the no-undo sentence back to 'every anonymous post @x made' only", async () => {
  const M = await bundle(P_ENTRY, PREVIEW_MOCKS, { "lib/launch/request.ts": [[", and any you post as @${handle} before its account appears,", ""]] });
  noUndoScan(M.req.noUndoSentence);
});

// ================================================================================================ C — the confirm
console.log("\nC — the confirm stands on the preview's verdict; a stalled or failed launch may be launched again");
LU.cstate = { zkQueue: new Map() };
LU.verdict = null;
LU.proofAsks = [];
const C_MOCKS = {
  ...REQ_MOCKS,
  // the queue's transport (and through it the vault) is in this bundle's graph: the keystore mock carries what they import
  "lib/identity/keystore": `export function getPersona(id) { const L = globalThis.__LU; return id === L.persona.id ? { ...L.persona, kind: "public", nonce: "n" } : null; } export function keystoreDir() { return process.env.KEYSTORE_DIR; } export function vaultKeyBytes() { return new Uint8Array(32).fill(9); }`,
  "lib/platform/env-contract": `export function isPublicDeployment() { return false; }`,
  "lib/adapters/registry": `export function currentRepImpl() { return "zk"; }`,
  "lib/identity/postMode": PREVIEW_MOCKS["lib/identity/postMode"],
  "lib/zk/prefetch": `export function cachedSnapshot() { return { epoch: { epoch: 4000 } }; }`,
  "lib/adapters/mock/store": `export async function hydrate() {} export function state() { return globalThis.__LU.cstate; } export async function persistNs() {}`,
  "lib/launch/preview": `export function previewVerdictFor() { return globalThis.__LU.verdict; }`,
  "lib/zk/anonAttribution": `export async function attributionCastHashesFor() { return []; }`,
  "lib/zk/gate": `export function requestLaunchProof(c) { globalThis.__LU.proofAsks.push(c); return { ok: true }; }`,
};
const C_ENTRY = `export * as confirm from "@/lib/launch/confirm";\nexport * as q from "@/lib/zk/anon/queue";\n`;
async function confirmScenario(Cx) {
  const fresh = () => {
    LU.cstate = { zkQueue: new Map() };
    LU.proofAsks = [];
  };
  const typed = "@" + persona.handle;
  const live = async () => (await Cx.q.launchRecords()).filter((r) => r.stage !== "failed");
  // no recent preview: refused, nothing asked for
  fresh();
  LU.verdict = null;
  let r = await Cx.confirm.confirmLaunch(persona.id, typed, {});
  assert(!r.ok && r.code === "preview" && LU.proofAsks.length === 0 && (await Cx.q.launchRecords()).length === 0, "a confirm without a preview went through: " + JSON.stringify(r));
  // fix LP-4: a crowd the preview could not count — refused without the explicit acknowledgement (true, not truthy)
  LU.verdict = { needsAck: true };
  r = await Cx.confirm.confirmLaunch(persona.id, typed, {});
  assert(!r.ok && r.code === "crowd" && LU.proofAsks.length === 0, "a confirm without the crowd acknowledgement went through: " + JSON.stringify(r));
  r = await Cx.confirm.confirmLaunch(persona.id, typed, { acknowledgeCrowd: "yes" });
  assert(!r.ok && r.code === "crowd", "a truthy acknowledgement that is not `true` passed");
  r = await Cx.confirm.confirmLaunch(persona.id, typed, { acknowledgeCrowd: true });
  assert(r.ok && LU.proofAsks.length === 1 && (await live()).length === 1, "the acknowledged confirm did not go through: " + JSON.stringify(r));
  // a launch under way is not launched again
  r = await Cx.confirm.confirmLaunch(persona.id, typed, { acknowledgeCrowd: true });
  assert(!r.ok && r.code === "already", "a launch under way was launched again");
  // fix NO-ADOPTION / UX-L5: STALLED past the registrar's promise with no account — may be launched again, and the stalled
  // record is REPLACED (not walked beside the new one)
  fresh();
  LU.verdict = { needsAck: false };
  await Cx.q.putLaunchRecord({ ...sampleLaunch(), launchCommit: "f0".repeat(32), stage: "waiting", stageAt: Date.now() - 73 * HOUR, window: "w1", confirmedAt: Date.now() - 74 * HOUR });
  const st = await Cx.confirm.launchStatusFor(persona.id);
  assert(st.canLaunchAgain === true && /keeps watching/.test(st.words), "a stalled launch's status does not offer launching again: " + JSON.stringify(st));
  r = await Cx.confirm.confirmLaunch(persona.id, typed, {});
  assert(r.ok, "a stalled launch could not be launched again: " + JSON.stringify(r));
  const old = (await Cx.q.launchRecords()).find((x) => x.launchCommit === "f0".repeat(32));
  assert(old && old.stage === "failed" && /Replaced by a newer launch/.test(old.reason ?? ""), "the stalled record is still walked beside the new one: " + JSON.stringify(old && [old.stage, old.reason]));
  assert((await live()).length === 1, "two launches of one persona are under way");
  // a wait still inside the promise is not launched again; a launch that failed before registration may be; one whose
  // account EXISTS never
  fresh();
  await Cx.q.putLaunchRecord({ ...sampleLaunch(), launchCommit: "f1".repeat(32), stage: "waiting", stageAt: Date.now() - 3 * HOUR, window: "w1" });
  assert((await Cx.confirm.confirmLaunch(persona.id, typed, {})).code === "already", "a launch inside its 48 hours was launched again");
  fresh();
  await Cx.q.putLaunchRecord({ ...sampleLaunch(), launchCommit: "f2".repeat(32), stage: "failed", window: "w1" });
  assert((await Cx.confirm.launchStatusFor(persona.id)).canLaunchAgain === true, "a failed launch's status does not offer launching again");
  assert((await Cx.confirm.confirmLaunch(persona.id, typed, {})).ok, "a launch that failed before registration could not be launched again");
  fresh();
  await Cx.q.putLaunchRecord({ ...sampleLaunch(), launchCommit: "f3".repeat(32), stage: "failed", fid: 7000001, window: "w1" });
  assert((await Cx.confirm.confirmLaunch(persona.id, typed, {})).code === "already", "a launch whose account EXISTS could be launched again");
  // fix UX-L6: a step after registration that has not gone through says what exists; "Try again" brings it forward
  fresh();
  await Cx.q.putLaunchRecord({ ...sampleLaunch(), launchCommit: "f4".repeat(32), stage: "registered", fid: 7000001, attempts: 3, nextAt: Date.now() + HOUR, reason: "Your account exists, but revealing your anonymous posts hasn't gone through yet (x). Totem keeps trying.", window: "w1" });
  const s = await Cx.confirm.launchStatusFor(persona.id);
  assert(s.retrying === true && s.canLaunchAgain === false && /^Your account exists, but revealing/.test(s.words), "the status after registration: " + JSON.stringify(s));
  assert((await Cx.confirm.retryLaunchNow(persona.id)).ok === true && (await Cx.q.launchRecords())[0].nextAt === 0, "'Try again' did not bring the step forward");
  fresh();
  await Cx.q.putLaunchRecord({ ...sampleLaunch(), launchCommit: "f5".repeat(32), stage: "waiting", window: "w1" });
  assert((await Cx.confirm.retryLaunchNow(persona.id)).ok === false, "'Try again' was offered with no account to try for");
}
const Cx = await bundle(C_ENTRY, C_MOCKS);
await check("C1 (LP-4, UX-L5, UX-L6, NO-ADOPTION) the confirm needs a recent preview and, when that preview could not count the crowd, the explicit acknowledgement; a launch past the registrar's promise or failed before registration may be launched again (the stalled record is replaced), one with an account never; after registration the status says what exists and 'Try again' brings the step forward", () => confirmScenario(Cx));
await mutation("C1 / the crowd acknowledgement not required", async () => {
  const M = await bundle(C_ENTRY, C_MOCKS, { "lib/launch/confirm.ts": [['if (verdict.needsAck && input.acknowledgeCrowd !== true) return no(400, "crowd"', 'if (false) return no(400, "crowd"']] });
  await confirmScenario(M);
});
await mutation("C1 / a stalled launch can never be launched again", async () => {
  const M = await bundle(C_ENTRY, C_MOCKS, { "lib/launch/confirm.ts": [["return r.stage === \"waiting\" && now - r.stageAt > WAITING_STALLED_MS_FOR_CONFIRM;", "return false;"]] });
  await confirmScenario(M);
});
await mutation("C1 / the stalled record keeps being walked beside the new launch", async () => {
  const M = await bundle(C_ENTRY, C_MOCKS, { "lib/launch/confirm.ts": [['if (existing && existing.stage !== "failed") await updateLaunchRecord(', 'if (false) await updateLaunchRecord(']] });
  await confirmScenario(M);
});
await check("C2 the confirm's stall threshold is the tick's (a DELIBERATE DUPLICATE pair)", () => {
  const t = /export const WAITING_STALLED_MS = (\d+) \* HOUR;/.exec(readFileSync(path.join(ROOT, "lib/launch/tick.ts"), "utf8"))?.[1];
  const c = /const WAITING_STALLED_MS_FOR_CONFIRM = (\d+) \* 3_600_000;/.exec(readFileSync(path.join(ROOT, "lib/launch/confirm.ts"), "utf8"))?.[1];
  assert(t && c && t === c, `tick ${t} h / confirm ${c} h`);
});

// ================================================================================================ U — the screens
console.log("\nU — the screens");
const U_MOCKS = {
  "next/link": `export default function Link() { return null; }`,
  "components/launch/LaunchConfirm": `export function LaunchConfirm() { return null; }`,
  "components/launch/LaunchStatus": `export function LaunchStatus() { return null; }`,
};
const U_ENTRY = `export { statusTakesOver } from "@/components/launch/LaunchPreview";\n`;
function takeoverCases(Ux) {
  const t = Ux.statusTakesOver;
  assert(t({ stage: "failed", canLaunchAgain: true }) === false, "a failed launch took over the page (no way back to the preview)");
  assert(t({ stage: "waiting", canLaunchAgain: true }) === false, "a stalled launch took over the page");
  assert(t({ stage: "waiting", canLaunchAgain: false }) === true, "a launch under way did not show its status");
  assert(t({ stage: "done", canLaunchAgain: false }) === true, "a launched persona did not show its status");
  assert(t({ stage: "failed", canLaunchAgain: false }) === true, "a failed launch WITH an account (the tick resumes it) did not show its status");
  assert(t(null) === false && t(undefined) === false, "no launch showed a status");
}
const Ux = await bundle(U_ENTRY, U_MOCKS, {}, { jsx: "automatic" });
await check("U1 (UX-L5) a launch that failed before registration, or stalled with no account, does NOT take over the launch page: the preview stays reachable (its reason shown above it); a launch under way or done shows its status", () => takeoverCases(Ux));
await mutation("U1 / any status takes over the page again", async () => {
  const M = await bundle(U_ENTRY, U_MOCKS, { "components/launch/LaunchPreview.tsx": [["return !!status && status.canLaunchAgain !== true;", "return !!status;"]] }, { jsx: "automatic" });
  takeoverCases(M);
});
const H_ENTRY = `export { launchCastText } from "@/lib/launch/history";\n`;
const H_MOCKS = { "server-only": `export {};` };
function castTextCases(Hx) {
  const none = Hx.launchCastText(7000001, 0, "https://layers.example");
  const two = Hx.launchCastText(7000001, 2, "https://layers.example");
  assert(!/revealed/i.test(none) && /\/proof\/7000001$/.test(none), "with nothing revealed the launch cast still claims a reveal: " + none);
  assert(/revealed/.test(two) && /\/proof\/7000001$/.test(two), "the launch cast after a reveal: " + two);
}
const Hx = await bundle(H_ENTRY, H_MOCKS);
await check("U2 (UX-L8) the launch cast claims a reveal only when one happened; both forms link the proof page", () => castTextCases(Hx));
await mutation("U2 / the launch cast claims a reveal whatever was revealed", async () => {
  const M = await bundle(H_ENTRY, H_MOCKS, { "lib/launch/history.ts": [["return revealed > 0 ? `Launched. My anonymous posts are revealed, with proof: ${proof}` : `Launched. Proof of this account: ${proof}`;", "return `Launched. My anonymous posts are revealed, with proof: ${proof}`;"]] });
  castTextCases(M);
});
const PP_ENTRY = `import { renderToStaticMarkup } from "react-dom/server";\nimport { createElement } from "react";\nimport { ProofPage } from "@/components/launch/ProofPage";\nexport const html = (props) => renderToStaticMarkup(createElement(ProofPage, props));\n`;
function proofWrapCases(PPx) {
  const key = "c3".repeat(32);
  const proof = { fid: 7000001, mode: "fixture", simulated: true, account: { fid: 7000001, custody: "0x" + "a1".repeat(20), recovery: "0x" + "b2".repeat(20), fname: "launcher-one", registeredAt: 1 }, keys: [{ key, requestFid: 7000000, active: true }], batches: [], posts: [] };
  const html = PPx.html({ fid: 7000001, proof, error: null });
  const tag = (testid) => new RegExp(`<[a-z]+ [^>]*data-testid="${testid}"[^>]*>`).exec(html)?.[0] ?? "";
  assert(/class="[^"]*\bbreak-all\b/.test(tag("proof-account")) && html.includes("0x" + "a1".repeat(20)), "the account line (42-character addresses) does not wrap: " + tag("proof-account"));
  assert(/class="[^"]*\bbreak-all\b/.test(tag("proof-keys")) && html.includes(key), "the key list (64-hex keys) does not wrap: " + tag("proof-keys"));
}
const PPx = await bundle(PP_ENTRY, {}, {}, { jsx: "automatic" });
await check("U3 (UX-L10) the proof page's account line and key list WRAP (break-all) — unbroken addresses and keys never push a phone screen sideways", () => proofWrapCases(PPx));
await mutation("U3 / the account line without break-all", async () => {
  const M = await bundle(PP_ENTRY, {}, { "components/launch/ProofPage.tsx": [['<p data-testid="proof-account" className="break-all">', '<p data-testid="proof-account">']] }, { jsx: "automatic" });
  proofWrapCases(M);
});

// ================================================================================================ N — no real network
console.log("\nN — no real network");
await check("N1 every request this harness's code made went to the in-process validator — none to Neynar, Optimism, the fname server or any other host", () => {
  const hosts = new Set(netLog.map((u) => new URL(u).host));
  for (const h of hosts) assert(h === new URL(VBASE).host, "a request left for " + h);
  for (const u of netLog) assert(!/neynar|optimism|fnames\.farcaster|alchemy|infura|warpcast|farcaster\.xyz|mainnet|base\.org/i.test(u), "a request to a real network: " + u);
  assert(vlog.some((l) => l.startsWith("POST /zk/anon/reveal")), "the positive control is missing: the reveal never reached the in-process validator");
  return `${netLog.length} fetch call(s) + ${vlog.length} request(s) on the in-process validator, all local`;
});

vserver.close();
console.log(`\n${passed}/${passed + failed} launch unit checks passed${failed ? `, ${failed} FAILED: ${failures.join(" | ")}` : ""}`);
process.exitCode = failed ? 1 : 0;
